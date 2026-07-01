import type { Express } from "express";
import type { AgentTriggerEvent } from "../agent";
import { buildAgentCapabilityCard } from "../agent/agent-capability-card";
import { mergeRegistryAgentDisplay } from "../agent/agent-display";
import { asyncHandler } from "../middleware/async-handler";

interface RegisterAgentRegistryRoutesDeps {
  agentRegistryRepo: any;
  moduleRegistryRepo: any;
  openClawBaseUrl: string;
  mentionTimeoutMs: number;
  logActivity: (input: any) => unknown;
  broadcast: (message: unknown) => void;
  toWorkspaceRelativePath: (filePath: string) => string;
}

interface RegisterAgentControlRoutesDeps {
  AGENT_CONFIG: { enabled: boolean };
  parsePositiveId: (value: unknown) => number | null;
  taskAgent: any;
  taskSyncLayer: any;
}

function parseAgentTriggerEvent(value: unknown): AgentTriggerEvent | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "review_check" ||
    normalized === "review_hygiene" ||
    normalized === "ownership_check" ||
    normalized === "stale_scan" ||
    normalized === "manual"
  ) {
    return normalized;
  }

  return null;
}


export function registerAgentRegistryRoutes(app: Express, deps: RegisterAgentRegistryRoutesDeps): void {
  const {
    agentRegistryRepo,
    moduleRegistryRepo,
    openClawBaseUrl: OPENCLAW,
    mentionTimeoutMs: MENTION_TIMEOUT_MS,
    logActivity,
    broadcast,
    toWorkspaceRelativePath,
  } = deps;

  app.post("/api/mention", asyncHandler(async (req, res) => {
    const { document, instruction, context, author } = req.body;

    const mentionRegex = /@(\w+)/g;
    const matches =
      typeof instruction === "string" ? instruction.match(mentionRegex) : null;
    const mentions = matches
      ? [...new Set(matches.map((m: string) => m.slice(1)))]
      : [];

    if (mentions.length === 0) {
      return res.json({ success: true, mentions: [] });
    }

    const results: Array<{ agent: string; success?: boolean; error?: string }> =
      [];

    for (const mentionedAgent of mentions) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), MENTION_TIMEOUT_MS);
      try {
        const response = await fetch(`${OPENCLAW}/hooks/docs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            agent: mentionedAgent,
            document,
            instruction,
            context,
            author: author || "User",
            timestamp: new Date().toISOString(),
          }),
        });

        results.push({ agent: mentionedAgent, success: response.ok });
        logActivity({
          source: "agent",
          type: "tool_call",
          action: `Triggered @${mentionedAgent}`,
          description: `Sent mention workflow for ${toWorkspaceRelativePath(String(document || "unknown document"))}.`,
          filePath: typeof document === "string" ? document : undefined,
          agentName: mentionedAgent,
          agentEmoji: "🤖",
        });
        broadcast({
          type: "mention:triggered",
          agent: mentionedAgent,
          document,
          instruction,
        });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.name === "AbortError"
              ? `Mention request timed out after ${MENTION_TIMEOUT_MS}ms`
              : err.message
            : "Unknown error";
        results.push({ agent: mentionedAgent, error: message });
      } finally {
        clearTimeout(timeout);
      }
    }

    return res.json({ success: true, mentions: results });
  }));

  app.get("/api/agents/registry", (_req, res) => {
    const list = agentRegistryRepo.listAgents();
    return res.json({ list });
  });

  app.get("/api/modules", (_req, res) => {
    const list = moduleRegistryRepo.listModules();
    return res.json({ list });
  });

  app.get("/api/modules/:slug/skills", (req, res) => {
    const module = moduleRegistryRepo
      .listModules()
      .find((entry: { slug: string }) => entry.slug === String(req.params.slug));
    if (!module) {
      return res.status(404).json({ error: "Module not found." });
    }
    const skills = moduleRegistryRepo.listModuleSkillRefs(module.id);
    return res.json({ module, skills });
  });

  app.get("/api/agents/:id/grants", (req, res) => {
    const agentId = String(req.params.id);
    const agent =
      agentRegistryRepo.getAgent(agentId) ??
      agentRegistryRepo.getAgentBySlug(agentId);
    if (!agent) {
      return res.status(404).json({ error: "Agent not found." });
    }
    const grants = moduleRegistryRepo.listAgentModuleGrants(agent.id);
    return res.json({ agent, grants });
  });

  app.get("/api/agents", asyncHandler(async (_req, res) => {
    const registryAgents = agentRegistryRepo.listAgents();
    const modules = moduleRegistryRepo.listModules();
    const registryByKey = new Map<string, any>();
    const allGrantsByAgentId = new Map<
      string,
      {
        enabled: number;
        capabilities: ReturnType<typeof buildAgentCapabilityCard>;
      }
    >();
    for (const agent of registryAgents) {
      const grants = moduleRegistryRepo.listAgentModuleGrants(agent.id);
      const enabledCount = grants.filter(
        (g: { enabled: boolean }) => g.enabled,
      ).length;
      const capabilities = buildAgentCapabilityCard({ agent, grants, modules });
      allGrantsByAgentId.set(agent.id, { enabled: enabledCount, capabilities });
      registryByKey.set(agent.id.toLowerCase(), agent);
      registryByKey.set(agent.slug.toLowerCase(), agent);
    }
    try {
      const response = await fetch(`${OPENCLAW}/api/agents`);
      const data = (await response.json()) as { list?: any[] };
      const seen = new Set<string>();
      const list = [...(data.list || []), ...registryAgents]
        .filter((entry: any) => {
          const key = String(entry.id || entry.slug || "").toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((entry: any) => {
          const registryAgent = registryByKey.get(
            String(entry.id || entry.slug || "").toLowerCase(),
          );
          const grantsInfo = registryAgent
            ? allGrantsByAgentId.get(registryAgent.id)
            : undefined;
          return mergeRegistryAgentDisplay({
            entry,
            registryAgent,
            capabilities: grantsInfo?.capabilities ?? {
              adapterType: entry.adapter_type,
              runtimeType: entry.runtime_type,
              status: entry.status,
              moduleCount: 0,
              capabilityLabels: [],
              permissionLabels: [],
              scopeLabels: [],
            },
          });
        });
      res.json({ ...data, list });
    } catch {
      res.json({
        list: registryAgents.map((entry: { id: string; avatar_url: string | null }) => {
          const grants = moduleRegistryRepo.listAgentModuleGrants(entry.id);
          return {
            ...entry,
            avatarUrl: entry.avatar_url || undefined,
            capabilities: buildAgentCapabilityCard({ agent: entry, grants, modules }),
          };
        }),
      });
    }
  }));

  app.get("/api/agents/:id/activity", asyncHandler(async (req, res) => {
    const { id } = req.params;
    try {
      const response = await fetch(
        `${OPENCLAW}/api/sessions/${id}/activity?limit=10`,
      );
      const data = await response.json();
      res.json(data);
    } catch {
      res.json([]);
    }
  }));}

export function registerAgentControlRoutes(app: Express, prefix: "" | "/api", deps: RegisterAgentControlRoutesDeps): void {
  const { AGENT_CONFIG, parsePositiveId, taskAgent, taskSyncLayer } = deps;
  const base = `${prefix}/agent`;

  app.post(`${base}/trigger`, asyncHandler(async (req, res) => {
    const event = parseAgentTriggerEvent(req.body?.event);
    if (!event) {
      return res.status(400).json({
        error:
          "event must be review_check, review_hygiene, ownership_check, stale_scan, or manual",
      });
    }

    const hasTaskId = Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "taskId",
    );
    const taskId = hasTaskId ? parsePositiveId(req.body?.taskId) : undefined;
    if (hasTaskId && req.body?.taskId !== null && taskId === null) {
      return res
        .status(400)
        .json({ error: "taskId must be a positive integer when provided" });
    }

    if (!AGENT_CONFIG.enabled) {
      return res.status(503).json({
        error: "entity agent is disabled (set ENTITY_AGENT_ENABLED=true)",
      });
    }

    try {
      const result = await taskAgent.trigger({
        event,
        taskId: typeof taskId === "number" ? taskId : undefined,
      });
      return res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const status = message.includes("task not found")
        ? 404
        : message.includes("invalid")
          ? 400
          : 500;
      return res.status(status).json({ error: message });
    }
  }));

  app.get(`${base}/settings`, (_req, res) => {
    try {
      return res.json(taskAgent.getSettings());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.patch(`${base}/settings`, (req, res) => {
    const body = req.body ?? {};
    try {
      const settings = taskAgent.updateSettings({
        provider: typeof body.provider === "string" ? body.provider : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
        clearApiKey: body.clearApiKey === true,
        baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
        clearBaseUrl: body.clearBaseUrl === true,
        staleThresholdHours:
          body.staleThresholdHours && typeof body.staleThresholdHours === "object"
            ? {
                doing: body.staleThresholdHours.doing,
                review: body.staleThresholdHours.review,
              }
            : undefined,
        maxActionsPerScan: body.maxActionsPerScan,
      });
      return res.json(settings);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(400).json({ error: message });
    }
  });

  app.get(`${base}/status`, (_req, res) => {
    try {
      const status = taskAgent.getStatus();
      return res.json({
        lastRun: status.lastRun,
        totalActions: status.totalActions,
        provider: status.provider,
        model: status.model,
        enabled: status.enabled,
        apiKeyConfigured: status.apiKeyConfigured,
        apiKeySource: status.apiKeySource,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.get(`${base}/log`, asyncHandler(async (req, res) => {
    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

    try {
      const rawEntries = taskAgent.getLog(limit) as any[];
      // Enrich with task name + assignee
      const taskIds = [
        ...new Set(rawEntries.filter((e) => e.taskId).map((e) => e.taskId!)),
      ];
      const taskMap = new Map<number, { name: string; assignee: string }>();
      for (const tid of taskIds as number[]) {
        try {
          const t = await taskSyncLayer.getTask(tid);
          if (t)
            taskMap.set(tid, {
              name: t.name,
              assignee: t.assignee ?? "unassigned",
            });
        } catch {
          /* skip */
        }
      }
      const entries = rawEntries.map((entry: any) => {
        const task = entry.taskId ? taskMap.get(entry.taskId) : undefined;
        return {
          timestamp: entry.timestamp,
          event: entry.event,
          taskId: entry.taskId,
          taskName: task?.name ?? null,
          taskAssignee: task?.assignee ?? null,
          action: entry.action,
          result: entry.result,
          model: entry.model,
          tokensUsed: entry.tokensUsed,
        };
      });
      return res.json({ entries });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));
}


