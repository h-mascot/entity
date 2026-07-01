import dotenv from "dotenv";

// Initialize Sentry early for error tracking
import "./sentry";

import http from "http";
import os from "os";
import path from "path";
import express, { type NextFunction, type Request, type Response } from "express";
import compression from "compression";
import fs from "fs";
import cors from "cors";
import { randomUUID } from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  addTaskProject,
  createActivityRepository,
  createCrew,
  createDocumentObjectRepository,
  createEvidenceArtifactRepository,
  createNotificationRepository,
  createProject,
  createRoadmap,
  createRoadmapItem,
  createWorkspaceScopeRepository,
  createTaskCommentRepository,
  deleteProject,
  deleteRoadmap,
  deleteRoadmapItem,
  getCrews,
  getSubscribersForCrew,
  getSubscriptionsForAgent,
  subscribeToCrew,
  unsubscribeFromCrew,
  getProjects,
  getRoadmaps,
  getTaskHistory,
  getTaskProjects,
  removeTaskProject,
  TASK_COLUMNS,
  updateRoadmapItem,
  validateTaskDoneReviewGateState,
  type ActivityEventPayload,
  type ActivityEventType,
  type ActivityType,
  type TaskRecord,
  type UpdateRoadmapItemInput,
} from "../../db/src";
import { getEntityDatabase } from "../../db/src/entity-db";
import { createFileSourceRepository } from "../../db/src/file-sources";
import { registerFileSystemRoutes } from "./fs";
import { registerEditorModule } from "./editor";
import { createSearchRouter } from "./routes/search";
import {
  AGENT_CONFIG,
  TaskAgent,
  createTaskAgentScheduler,
  getPrimaryReviewReason,
  hasAssignedOwner,
  isActiveTaskColumn,
  isReviewGatedTask,
  shouldValidateReviewEntryOnTransition,
  validateReviewCompletion,
  validateReviewEntry,
  type AgentTriggerEvent,
} from "./agent";
import { buildAgentCapabilityCard } from "./agent/agent-capability-card";
import { createCommentMentionResponder } from "./agent/comment-responder";
import { mergeRegistryAgentDisplay } from "./agent/agent-display";
import {
  buildTaskPaginationMeta,
  paginateTasks,
  parseTaskPaginationQuery,
} from "./task-pagination";
import {
  buildMergeAuditNote,
  findTaskDuplicateCandidates,
} from "./task-dedupe";
import {
  buildTaskProjectLabel,
  syncTaskProjectAssignments,
  taskHasProjectName,
} from "./task-projects";
import {
  buildOwnerAccountabilityInbox,
  parseTaskAccountabilityForCreate,
  parseTaskAccountabilityUpdates,
  validateTaskAccountability,
} from "./task-accountability";
import { PluginHookEmitter } from "./plugins/hooks";
import {
  ensurePluginMigrationTable,
  runPluginMigrations,
} from "./plugins/migrations";
import {
  PluginRegistry,
  ensurePluginSettingsTable,
  mountPluginRoutes,
  registerPluginRuntimeModules,
} from "./plugins/registry";
import { registerPluginManagementRoutes } from "./plugins/routes";
import { registerCrewRoutes } from "./crews-routes";
import { registerChatRoutes } from "./routes/chat";
import { createClickClackBridge } from "./clickclack/bridge";
import { registerClickClackProxyRoutes } from "./clickclack/proxy";
import { registerConfigRoutes } from "./config/routes";
import { createNotificationRouter } from "./routes/notifications";
import { buildEffectiveConfig } from "./config/effective";
import {
  applyBootstrapRuntimeEnv,
  applyRuntimeConfigSeeds,
  buildConfigPluginSettings,
  buildConfiguredAgentHealthEndpoints,
  buildConfiguredAgentWorkspaces,
} from "./config/runtime";
import { registerDocsApiRoutes } from "./routes/docs";
import { createWorktypeRegistryRouter } from "./routes/worktype-registry";
import { createDocumentObjectRouter } from "./document-objects";
import { registerTtsRoutes } from "./routes/tts";
import { registerLegacyFileRoutes } from "./routes/legacy-files";
import { registerDocumentRoutes } from "./routes/documents";
import { closeDocumentsDatabase } from "./documents/db";
import { createAgentRegistryRouter } from "./routes/agent-registry";
import { createWorkspaceRouter } from "./routes/workspace";
import { createTaskReviewGateRouter } from "./routes/task-review-gates";
import { registerStrategicRoutes, registerTaskRoutes } from "./routes/tasks";
import { createMigrationCleanupQueueRouter } from "./routes/migration-cleanup-queues";
import {
  phase2FlagEnabled,
  resolvePhase2Flags,
  serializePhase2FlagDiagnostics,
} from "./phase2-flags";
import { buildPhase2ObservabilityDiagnostics } from "./phase2-observability";
import {
  buildTaskMutationActivityEvent,
  createActivityEventRouter,
  createActivityEventService,
} from "./activity-events";
import {
  createTaskMasterClaimRouter,
  createTaskMasterClaimService,
} from "./task-master-claims";
import { completeTaskWithReceipt } from "./receipt-writer";
import { applySecurityHardening } from "./security";
import { createTerminalBridge, registerTerminalRoutes } from "./terminal";
import { createSwarmRouter } from "./swarm";
import { normalizeTaskOutputLinks } from "./task-output-links";
import { collectAgentMetrics } from "./agent-metrics";
import { registerNodeOperationsRoutes } from "./node-operations";
import {
  resolveFrontendDist,
  sendIndexNoCache,
  setApiNoStoreHeaders,
  setFrontendStaticCacheHeaders,
} from "./static-cache";
import { readReleaseInfo } from "./release-info";
import { createApiAuthMiddleware, createWsAuthHandler, isApiAuthEnabled } from "./middleware/api-auth";
import { assertSecureBindOrThrow } from "./middleware/bind-guard";
import { shouldRegisterTestErrorRoute } from "./test-error-route";
// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
const bootstrapConfig = applyBootstrapRuntimeEnv(process.cwd());

import { createTaskSyncLayer, normalizeDbMode } from "../../db/src/task-sync";
import {
  createAgentRegistryRepository,
  createModuleRegistryRepository,
} from "../../db/src";

const app = express();
const DEFAULT_PORT = 3000;
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const HOST = process.env.HOST?.trim() || "0.0.0.0";
const phase2Flags = resolvePhase2Flags();

applySecurityHardening(app);
app.use(cors());
app.use(compression());
app.use("/api/clickclack", express.raw({ type: "*/*", limit: "50mb" }));
app.use(express.json());
app.use("/api", setApiNoStoreHeaders);
const notificationRepository = createNotificationRepository();

// API authentication — requires ENTITY_API_TOKEN env var; skips when unset (dev mode)
app.use(createApiAuthMiddleware());

// Liveness probe used by entity-doctor, deploy health checks, and the README
// troubleshooting flow. Public (see PUBLIC_EXACT_ROUTES in middleware/api-auth).
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "entity-server",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Release identity probe used by sandbox/prod promotion checks. Public so
// deployment verifiers can prove the live runtime SHA without a bearer token.
app.get("/api/version", (_req, res) => {
  res.json(readReleaseInfo(process.cwd()));
});

function registerPhase2DiagnosticsRoutes(prefix: "" | "/api") {
  app.get(`${prefix}/phase2/diagnostics`, (_req, res) => {
    res.json({
      phase2: {
        ...serializePhase2FlagDiagnostics(phase2Flags),
        observability: buildPhase2ObservabilityDiagnostics(),
      },
    });
  });
}

registerPhase2DiagnosticsRoutes("");
registerPhase2DiagnosticsRoutes("/api");
registerConfigRoutes(app);
app.use("/notifications", createNotificationRouter({ notificationRepository }));
app.use("/api/notifications", createNotificationRouter({ notificationRepository }));
app.use("/api/search", createSearchRouter({ flags: phase2Flags }));
registerDocsApiRoutes(app);

const WORKSPACE = process.env.WORKSPACE || path.resolve(__dirname, "../../..");
const OPENCLAW = process.env.OPENCLAW || 'http://127.0.0.1:18789';
const FS_MULTISOURCE_ENABLED = normalizeBooleanFlag(
  process.env.ENTITY_FS_MULTISOURCE,
  true,
);
const AGENT_NATIVE_EDITOR_ENABLED = normalizeBooleanFlag(
  process.env.ENTITY_AGENT_NATIVE_EDITOR,
  true,
);
const FS_INDEXER_ENABLED = normalizeBooleanFlag(
  process.env.ENTITY_FS_INDEXER_ENABLED,
  true,
);
const FS_INDEX_INTERVAL_MS = Number(
  process.env.ENTITY_FS_INDEX_INTERVAL_MS ?? 300_000,
);
const mentionTimeoutMsRaw = Number(
  process.env.ENTITY_MENTION_TIMEOUT_MS ?? 8_000,
);
const MENTION_TIMEOUT_MS =
  Number.isFinite(mentionTimeoutMsRaw) && mentionTimeoutMsRaw >= 1_000
    ? mentionTimeoutMsRaw
    : 8_000;
const HOME_DIR = process.env.HOME || os.homedir();
// Safe local-first default — no hardcoded private workspace names.
// Actual agent workspace paths are set via ENTITY_WORKSPACE_MAIN/SPOCK/SCOTTY env vars.
const DEFAULT_WORK_ROOT = path.join(HOME_DIR, "entity-workspace");
const DOCS_ROOTS: Record<string, string> = {
  output:
    process.env.DOCS_OUTPUT_ROOT || path.join(DEFAULT_WORK_ROOT, "output"),
  memory:
    process.env.DOCS_MEMORY_ROOT || path.join(DEFAULT_WORK_ROOT, "memory"),
  workspace: process.env.DOCS_WORKSPACE_ROOT || DEFAULT_WORK_ROOT,
};

const wsClients = new Set<WebSocket>();

const SETUPCLAW_LEADS_DIR = process.env.SETUPCLAW_LEADS_DIR || path.join(WORKSPACE, "output", "setupclaw-leads");

function normalizeLeadField(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 4000) : "";
}

function registerSetupClawLeadRoutes(app: express.Express) {
  app.post("/api/setupclaw-london/leads", (req: Request, res: Response) => {
    const now = new Date();
    const lead = {
      id: randomUUID(),
      capturedAt: now.toISOString(),
      name: normalizeLeadField(req.body?.name),
      email: normalizeLeadField(req.body?.email),
      company: normalizeLeadField(req.body?.company),
      preferredDay: normalizeLeadField(req.body?.preferred_day),
      currentStack: normalizeLeadField(req.body?.current_stack),
      firstTask: normalizeLeadField(req.body?.first_task),
      toolsNeeded: normalizeLeadField(req.body?.tools_needed),
      approvalBoundary: normalizeLeadField(req.body?.approval_boundary),
      source: normalizeLeadField(req.body?.source) || "setupclaw-london",
      userAgent: normalizeLeadField(req.get("user-agent")),
      ip: normalizeLeadField(req.ip),
    };

    const requiredFields = [
      lead.name,
      lead.email,
      lead.company,
      lead.preferredDay,
      lead.currentStack,
      lead.firstTask,
      lead.toolsNeeded,
      lead.approvalBoundary,
    ];

    if (requiredFields.some((field) => !field)) {
      res.status(400).json({ ok: false, error: "missing_required_fields" });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
      res.status(400).json({ ok: false, error: "invalid_email" });
      return;
    }

    try {
      fs.mkdirSync(SETUPCLAW_LEADS_DIR, { recursive: true });
      const dayFile = path.join(SETUPCLAW_LEADS_DIR, `${now.toISOString().slice(0, 10)}.jsonl`);
      fs.appendFileSync(dayFile, `${JSON.stringify(lead)}\n`, "utf8");
      res.status(201).json({
        ok: true,
        id: lead.id,
        message: "Setup request saved. An assistant will reply with a setup scope.",
      });
    } catch (err) {
      console.error("[setupclaw] Failed to persist lead", err);
      res.status(500).json({ ok: false, error: "lead_persist_failed" });
    }
  });
}

const terminalBridge = createTerminalBridge({
  workspaceRoot: WORKSPACE,
  targets: bootstrapConfig.terminal.targets,
});

registerTerminalRoutes(app, terminalBridge);
registerSetupClawLeadRoutes(app);

const server = http.createServer(app);
const wsAuthHandler = createWsAuthHandler();
const wss = new WebSocketServer({
  server,
  verifyClient: (info, callback) => {
    if (!wsAuthHandler(info.req as any)) {
      callback(false, 401, "Unauthorized");
      return;
    }
    callback(true);
  },
});
const agentRegistryRepo = createAgentRegistryRepository();
const moduleRegistryRepo = createModuleRegistryRepository();
const workspaceRepo = createWorkspaceScopeRepository();
const documentObjectRepository = createDocumentObjectRepository();
const evidenceArtifactRepository = createEvidenceArtifactRepository();
app.use("/api", createWorkspaceRouter({ workspaceRepo }));
app.use("/api", createAgentRegistryRouter({ agentRegistryRepo, moduleRegistryRepo }));
app.use("/api/document-objects", createDocumentObjectRouter({
  documentRepo: documentObjectRepository,
  artifactRepo: evidenceArtifactRepository,
}));
app.use("/api/migration-cleanup-queues", createMigrationCleanupQueueRouter({ flags: phase2Flags }));
wss.on("connection", (ws) => {
  wsClients.add(ws);
  terminalBridge.handleSocketConnection(ws);
  ws.on("close", () => wsClients.delete(ws));
  console.log(`[WS] Client connected (${wsClients.size} total)`);
});
wss.on("error", (err) => {
  console.error(
    "[WS] Server error:",
    err instanceof Error ? err.message : String(err),
  );
});

function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  wsClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(msg);
      } catch (err) {
        wsClients.delete(ws);
        try {
          ws.terminate();
        } catch {
          // no-op
        }
        console.warn(
          "[WS] Failed to send broadcast message:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  });
}

const taskSyncLayer = createTaskSyncLayer();
const activityRepository = createActivityRepository();
const taskCommentRepository = createTaskCommentRepository();
const fileSourceRepository = createFileSourceRepository();
const activityEventService = createActivityEventService({
  activityRepository,
  getTask: (taskId) => taskSyncLayer.getTask(taskId),
});
const taskMasterClaimService = createTaskMasterClaimService({
  taskSyncLayer,
  activityRepository,
});

// Responds to @agent mentions in task comments (reads the card, replies, optional pickup).
const commentMentionResponder = createCommentMentionResponder({
  getTask: (taskId) => taskSyncLayer.getTask(taskId),
  listComments: (taskId) => taskCommentRepository.listComments(taskId),
  createComment: (input) => taskCommentRepository.createComment(input),
  updateTask: (taskId, fields) => taskSyncLayer.updateTask(taskId, fields),
  listAgents: () => agentRegistryRepo.listAgents(),
  logActivity: (input) => logActivity(input),
  broadcast: (message) => broadcast(message),
});
const entityDb = getEntityDatabase();
const runtimeConfig = applyRuntimeConfigSeeds({ db: entityDb, fileSourceRepository });
const runtimeConfigBaseDir = path.dirname(process.env.ENTITY_CONFIG || path.resolve(process.cwd(), 'entity.config.yaml'));
ensurePluginSettingsTable(entityDb);
ensurePluginMigrationTable(entityDb);
const pluginHooks = new PluginHookEmitter(console);
const startupEffectiveConfig = buildEffectiveConfig({ db: entityDb });
const pluginRegistry = new PluginRegistry({
  db: entityDb,
  logger: console,
  configPluginSettings: buildConfigPluginSettings(startupEffectiveConfig.settings),
});
const loadedPlugins = pluginRegistry.load();
runPluginMigrations({
  db: entityDb,
  logger: console,
  plugins: loadedPlugins,
});
registerPluginRuntimeModules({
  app,
  db: entityDb,
  hooks: pluginHooks,
  logger: console,
  registry: pluginRegistry,
  workspaceRoot: WORKSPACE,
});
// Mount core swarm lifecycle routes (dispatch, accept, reject, cancel, providers)
app.use("/api/swarm", createSwarmRouter());

mountPluginRoutes({
  app,
  db: entityDb,
  hooks: pluginHooks,
  logger: console,
  registry: pluginRegistry,
  workspaceRoot: WORKSPACE,
});
const TASK_COLUMN_SET = new Set<string>(TASK_COLUMNS);

function getDefaultTaskActor(): string {
  return (
    process.env.ENTITY_TASK_ACTOR?.trim() ||
    process.env.ENTITY_DEFAULT_ACTOR?.trim() ||
    "Human"
  );
}

function getTaskActorFromRequest(
  req: express.Request,
  fallback = getDefaultTaskActor(),
): string {
  const entityActor = req.header("X-Entity-Actor");
  if (typeof entityActor === "string" && entityActor.trim()) {
    return entityActor.trim();
  }
  const agentName = req.header("X-Agent-Name");
  if (typeof agentName === "string" && agentName.trim()) {
    return agentName.trim();
  }
  const bodyActor = req.body?.actor;
  if (typeof bodyActor === "string" && bodyActor.trim()) {
    return bodyActor.trim();
  }
  return fallback;
}

function parseTaskId(value: string): number | null {
  return parsePositiveId(value);
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

function parsePositiveId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function buildTaskPreview(input: {
  id?: number;
  name: string;
  description?: string | null;
  brief?: string | null;
  origin_channel?: string | null;
  column?: string | null;
  model?: string | null;
  archived?: boolean;
  assignee?: string | null;
  blocked?: boolean;
  blocker_reason?: string | null;
  due_date?: string | null;
  priority?: string | null;
  estimate_hours?: number | null;
  time_spent?: number | null;
  output?: string | null;
  progress_status?: string | null;
  recurring?: boolean;
  recurring_config?: string | null;
  metadata?: string | null;
  created_at?: string;
  updated_at?: string;
}): TaskRecord {
  const now = new Date().toISOString();
  const normalizedColumn =
    typeof input.column === "string" &&
    TASK_COLUMN_SET.has(input.column.toLowerCase())
      ? input.column.toLowerCase()
      : "backlog";

  return {
    id: input.id ?? 0,
    name: input.name,
    description: input.description ?? null,
    brief: input.brief ?? null,
    origin_channel: input.origin_channel ?? null,
    column: normalizedColumn as TaskRecord["column"],
    model: input.model ?? null,
    archived: input.archived ?? false,
    assignee: input.assignee ?? null,
    blocked: input.blocked ?? false,
    blocker_reason: input.blocker_reason ?? null,
    due_date: input.due_date ?? null,
    priority: input.priority ?? null,
    estimate_hours: input.estimate_hours ?? null,
    time_spent: input.time_spent ?? null,
    output: input.output ?? null,
    progress_status: input.progress_status ?? null,
    recurring: input.recurring ?? false,
    recurring_config: input.recurring_config ?? null,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
    metadata: input.metadata ?? null,
  };
}

function parsePositiveIdList(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    const parsed = parsePositiveId(item);
    if (!parsed) {
      return null;
    }

    if (seen.has(parsed)) {
      continue;
    }

    seen.add(parsed);
    ids.push(parsed);
  }

  return ids;
}

function statusForStrategicError(message: string): number {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("not found")) {
    return 404;
  }

  if (
    normalized.includes("required") ||
    normalized.includes("must be") ||
    normalized.includes("cannot be") ||
    normalized.includes("invalid")
  ) {
    return 400;
  }

  return 500;
}

function isValidTaskColumn(value: unknown): value is string {
  return typeof value === "string" && TASK_COLUMN_SET.has(value.toLowerCase());
}

function normalizeBlockedInput(value: unknown): boolean | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }

  return undefined;
}

function normalizeBlockerReasonInput(value: unknown): string | undefined {
  if (typeof value === "undefined" || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : "";
}

function normalizeBooleanFlag(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (typeof value === "undefined") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }

  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }

  return fallback;
}

function toWorkspaceRelativePath(filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    return filePath;
  }

  const relativePath = path.relative(WORKSPACE, filePath);
  if (relativePath.startsWith("..")) {
    return filePath;
  }

  return relativePath || path.basename(filePath);
}


function capitalizeColumn(column: string): string {
  return column.charAt(0).toUpperCase() + column.slice(1);
}

function parseTaskMetadataRecord(
  metadata: string | null | undefined,
): Record<string, unknown> {
  if (typeof metadata !== "string") {
    return {};
  }

  const trimmed = metadata.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed metadata
  }

  return {};
}

function readParentTaskId(metadata: string | null | undefined): number | null {
  const record = parseTaskMetadataRecord(metadata);
  const candidate = Number(
    record.parent_task_id ?? record.parentTaskId ?? record.parent_id,
  );
  if (!Number.isInteger(candidate) || candidate <= 0) {
    return null;
  }
  return candidate;
}

function enrichTasksWithSubtaskSummary<
  T extends { id: number; metadata: string | null; column: string },
>(
  tasks: T[],
): Array<
  T & {
    parent_task_id: number | null;
    subtask_count: number;
    subtask_done_count: number;
  }
> {
  const childrenByParent = new Map<number, { total: number; done: number }>();

  for (const task of tasks) {
    const parentId = readParentTaskId(task.metadata);
    if (!parentId) {
      continue;
    }
    const entry = childrenByParent.get(parentId) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (task.column === "done") {
      entry.done += 1;
    }
    childrenByParent.set(parentId, entry);
  }

  return tasks.map((task) => {
    const summary = childrenByParent.get(task.id) ?? { total: 0, done: 0 };
    return {
      ...task,
      parent_task_id: readParentTaskId(task.metadata),
      subtask_count: summary.total,
      subtask_done_count: summary.done,
    };
  });
}

function deriveSubtaskBreakdown(parentTask: {
  name: string;
  description: string | null;
  metadata: string | null;
}): string[] {
  const sourceText =
    `${parentTask.name}\n${parentTask.description ?? ""}`.trim();
  if (!sourceText) {
    return [];
  }

  const bulletMatches = Array.from(
    sourceText.matchAll(
      /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+(.+?)(?=$|\n\s*(?:[-*•]|\d+[.)])\s+)/gms,
    ),
  )
    .map((entry) => entry[1]?.trim())
    .filter((entry): entry is string => Boolean(entry && entry.length >= 8));

  if (bulletMatches.length >= 2) {
    return bulletMatches.slice(0, 8);
  }

  const sentenceMatches = sourceText
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 12)
    .slice(0, 6);

  if (sentenceMatches.length >= 2) {
    return sentenceMatches.map((entry, index) => `Step ${index + 1}: ${entry}`);
  }

  return [
    `Clarify scope and acceptance criteria for: ${parentTask.name}`,
    `Implement core work for: ${parentTask.name}`,
    `Validate and attach output evidence for: ${parentTask.name}`,
  ];
}

function mergeTaskMetadataWithParentLink(
  metadata: string | null | undefined,
  parentTaskId: number,
): string {
  const record = parseTaskMetadataRecord(metadata);
  const nextRecord: Record<string, unknown> = {
    ...record,
    parent_task_id: parentTaskId,
  };
  return JSON.stringify(nextRecord);
}

function logActivity(input: {
  source: "agent" | "task";
  type: ActivityType;
  activityEventType?: ActivityEventType | string;
  activityEventPayload?: Partial<ActivityEventPayload> | Record<string, unknown>;
  action: string;
  description: string;
  agentName?: string;
  agentEmoji?: string;
  filePath?: string;
  taskId?: number;
  taskColumn?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const activity = activityRepository.createActivity({
      source: input.source,
      type: input.type,
      activity_event_type: input.activityEventType,
      activity_event_payload: input.activityEventPayload,
      action: input.action,
      description: input.description,
      agent_name: input.agentName || "Entity",
      agent_emoji: input.agentEmoji || "⚡",
      file_path: input.filePath,
      task_id: input.taskId,
      task_column: input.taskColumn,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });
    broadcast({ type: "activity:created", activity });
    return activity;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown activity error";
    console.error("[Activity] Failed to log activity:", message);
    return null;
  }
}

function withReceiptArtifactRef(
  payload: ActivityEventPayload,
  artifactId: string | null | undefined,
  contentHash?: string,
): ActivityEventPayload {
  if (!artifactId) return payload;
  const objectRefs = Array.isArray(payload.object_refs)
    ? [...payload.object_refs]
    : [];
  objectRefs.push({
    object_type: "evidence_artifact",
    object_id: artifactId,
    link_role: "receipt",
  });
  return {
    ...payload,
    object_refs: objectRefs,
    data: {
      ...(payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? payload.data
        : {}),
      receipt_artifact_id: artifactId,
      receipt_content_hash: contentHash,
    },
  };
}

const taskAgent = new TaskAgent({
  taskSyncLayer,
  activityRepository,
  taskCommentRepository,
  workspaceRoot: WORKSPACE,
  docsRoots: DOCS_ROOTS,
  logActivity,
  broadcast,
});
const taskAgentScheduler = createTaskAgentScheduler(taskAgent, {
  enabled: AGENT_CONFIG.enabled,
  intervalMs: AGENT_CONFIG.scanIntervalMs,
});
if (AGENT_CONFIG.enabled) {
  taskAgentScheduler.start();
}

registerLegacyFileRoutes(app, {
  workspaceRoot: WORKSPACE,
  fileSourceRepository,
  logActivity,
  broadcast,
  toWorkspaceRelativePath,
});

app.post("/api/mention", async (req, res) => {
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
});

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

app.get("/api/agents", async (_req, res) => {
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
});

app.get("/api/agents/:id/activity", async (req, res) => {
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
});

function registerActivityRoutes(prefix: "" | "/api") {
  const base = `${prefix}/activities`;

  app.get(base, (req, res) => {
    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

    try {
      const activities = activityRepository.listActivities(limit);
      res.json({ activities });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });
}

function registerDbModeRoutes(prefix: "" | "/api") {
  const base = `${prefix}/db-mode`;

  app.get(base, (_req, res) => {
    res.json({
      mode: taskSyncLayer.getMode(),
      cloudConfigured: taskSyncLayer.hasCloudAdapter(),
    });
  });

  app.post(base, (req, res) => {
    const mode = normalizeDbMode(req.body?.mode ?? null);
    if (!mode && req.body?.mode !== null) {
      return res
        .status(400)
        .json({ error: "mode must be LOCAL, CLOUD, or null" });
    }

    taskSyncLayer.setMode(mode);
    return res.json({
      mode: taskSyncLayer.getMode(),
      cloudConfigured: taskSyncLayer.hasCloudAdapter(),
    });
  });
}

function registerRuntimeRoutes(prefix: "" | "/api") {
  const base = `${prefix}/runtime`;

  app.get(base, (_req, res) => {
    res.json({
      features: {
        fsMultiSourceEnabled: FS_MULTISOURCE_ENABLED,
        agentNativeEditorEnabled: AGENT_NATIVE_EDITOR_ENABLED,
      },
    });
  });
}

function registerAgentRoutes(prefix: "" | "/api") {
  const base = `${prefix}/agent`;

  app.post(`${base}/trigger`, async (req, res) => {
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
  });

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

  app.get(`${base}/log`, async (req, res) => {
    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

    try {
      const rawEntries = taskAgent.getLog(limit);
      // Enrich with task name + assignee
      const taskIds = [
        ...new Set(rawEntries.filter((e) => e.taskId).map((e) => e.taskId!)),
      ];
      const taskMap = new Map<number, { name: string; assignee: string }>();
      for (const tid of taskIds) {
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
      const entries = rawEntries.map((entry) => {
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
  });
}



async function ensureSampleTasks() {
  const sampleTasks = [
    {
      name: "Sample: Product brief review",
      description:
        "Open this card to test editing title, assignee, due date, and description.",
      column: "backlog",
      assignee: "User",
    },
    {
      name: "Sample: QA regression checklist",
      description:
        "Use this to test task detail updates and comments workflow.",
      column: "doing",
      assignee: "Assistant",
    },
    {
      name: "Sample: Weekly planning sync",
      description:
        "Move this card across columns to validate board interactions.",
      column: "review",
      assignee: "Assistant",
    },
  ] as const;

  try {
    const existingTasks = await taskSyncLayer.listTasks();
    const existingNames = new Set(
      existingTasks.map((task) => task.name.trim().toLowerCase()),
    );

    for (const sample of sampleTasks) {
      const normalizedName = sample.name.trim().toLowerCase();
      if (existingNames.has(normalizedName)) {
        continue;
      }

      const created = await taskSyncLayer.createTask({
        name: sample.name,
        description: sample.description,
        column: sample.column,
        assignee: sample.assignee,
      });
      existingNames.add(normalizedName);

      logActivity({
        source: "task",
        type: "task_created",
        action: "Created task",
        description: `${created.name} in ${capitalizeColumn(created.column)}.`,
        taskId: created.id,
        taskColumn: created.column,
        metadata: { seeded: true },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Seed] Failed to ensure sample tasks:", message);
  }
}

const taskRouteDeps = {
  activityEventService,
  activityRepository,
  addTaskProject,
  buildMergeAuditNote,
  buildOwnerAccountabilityInbox,
  buildTaskMutationActivityEvent,
  buildTaskPaginationMeta,
  buildTaskProjectLabel,
  capitalizeColumn,
  commentMentionResponder,
  completeTaskWithReceipt,
  createProject,
  createRoadmap,
  createRoadmapItem,
  deleteProject,
  deleteRoadmap,
  deleteRoadmapItem,
  enrichTasksWithSubtaskSummary,
  findTaskDuplicateCandidates,
  getPrimaryReviewReason,
  getProjects,
  getRoadmaps,
  getTaskActorFromRequest,
  getTaskHistory,
  getTaskProjects,
  hasAssignedOwner,
  isActiveTaskColumn,
  isReviewGatedTask,
  logActivity,
  normalizeBlockedInput,
  normalizeTaskOutputLinks,
  paginateTasks,
  parsePositiveId,
  parsePositiveIdList,
  parseTaskAccountabilityForCreate,
  parseTaskAccountabilityUpdates,
  parseTaskId,
  parseTaskPaginationQuery,
  readParentTaskId,
  removeTaskProject,
  shouldValidateReviewEntryOnTransition,
  statusForStrategicError,
  syncTaskProjectAssignments,
  taskAgent,
  taskCommentRepository,
  taskHasProjectName,
  taskSyncLayer,
  updateRoadmapItem,
  validateReviewCompletion,
  validateReviewEntry,
  validateTaskAccountability,
  validateTaskDoneReviewGateState,
};
registerDbModeRoutes("");
registerDbModeRoutes("/api");
registerRuntimeRoutes("");
registerRuntimeRoutes("/api");
registerAgentRoutes("");
registerAgentRoutes("/api");
app.use(createActivityEventRouter(activityEventService));
app.use("/api", createActivityEventRouter(activityEventService));
app.use(createTaskMasterClaimRouter(taskMasterClaimService));
app.use("/api", createTaskMasterClaimRouter(taskMasterClaimService));
registerActivityRoutes("");
registerActivityRoutes("/api");
app.use("/worktype-registry", createWorktypeRegistryRouter({ flags: phase2Flags }));
app.use("/api/worktype-registry", createWorktypeRegistryRouter({ flags: phase2Flags }));
registerTaskRoutes(app, "", taskRouteDeps);
registerTaskRoutes(app, "/api", taskRouteDeps);
app.use("/tasks", createTaskReviewGateRouter({
  getTask: (taskId) => taskSyncLayer.getTask(taskId),
  updateTask: (taskId, updates) => taskSyncLayer.updateTask(taskId, updates),
  activityRepository,
  defaultActor: getDefaultTaskActor(),
}));
app.use("/api/tasks", createTaskReviewGateRouter({
  getTask: (taskId) => taskSyncLayer.getTask(taskId),
  updateTask: (taskId, updates) => taskSyncLayer.updateTask(taskId, updates),
  activityRepository,
  defaultActor: getDefaultTaskActor(),
}));
registerStrategicRoutes(app, "", taskRouteDeps);
registerStrategicRoutes(app, "/api", taskRouteDeps);
if (!AGENT_NATIVE_EDITOR_ENABLED) {
  registerDocumentRoutes(app, "/api", { workspaceRoot: WORKSPACE });
}
registerFileSystemRoutes(app, {
  enabled: FS_MULTISOURCE_ENABLED,
  workspaceRoot: WORKSPACE,
  indexerEnabled: FS_INDEXER_ENABLED,
  indexIntervalMs: Number.isFinite(FS_INDEX_INTERVAL_MS)
    ? FS_INDEX_INTERVAL_MS
    : 300_000,
});
registerEditorModule(app, {
  enabled: AGENT_NATIVE_EDITOR_ENABLED,
  wsClients,
  openClawBaseUrl: OPENCLAW,
  listAgents: () => agentRegistryRepo.listAgents(),
});
registerPluginManagementRoutes({
  app,
  registry: pluginRegistry,
});
registerNodeOperationsRoutes(app);

// Chat routes
const clickClackBridge = process.env.ENTITY_CHAT_CLICKCLACK_BRIDGE === '1'
  ? createClickClackBridge()
  : undefined;
registerClickClackProxyRoutes(app);
registerChatRoutes({ app, openClawBaseUrl: OPENCLAW, clickClackBridge });


// TTS routes
registerTtsRoutes({ app, db: entityDb });

// Activity feed (recent across all tasks)
app.get("/api/activity/recent", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 25;
    const activities = activityRepository.listActivities(limit);
    res.json(activities);
  } catch {
    res.json([]);
  }
});

// === AGENT STATUS: Real gateway health pings ===

const CONFIGURED_AGENT_HEALTH_ENDPOINTS = buildConfiguredAgentHealthEndpoints(runtimeConfig);
const AGENT_HEALTH_ENDPOINTS: Record<string, string[]> = Object.fromEntries(
  Object.entries(CONFIGURED_AGENT_HEALTH_ENDPOINTS).map(([agentId, urls]) => [
    agentId,
    urls.filter(
      (url, index, list) => Boolean(url) && list.indexOf(url) === index,
    ),
  ]),
);

const agentStatusCache: Record<
  string,
  { status: "online" | "offline"; lastSeen: string; endpoint?: string }
> = {};

async function pingGateway(url: string, timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshAgentStatuses(): Promise<void> {
  const pinged = new Map<string, boolean>();
  for (const [agentId, urls] of Object.entries(AGENT_HEALTH_ENDPOINTS)) {
    let online = false;
    let healthyEndpoint: string | null = null;

    for (const url of urls) {
      if (!url) {
        continue;
      }
      if (pinged.has(url)) {
        online = pinged.get(url)!;
      } else {
        online = await pingGateway(url);
        pinged.set(url, online);
      }
      if (online) {
        healthyEndpoint = url;
        break;
      }
    }

    agentStatusCache[agentId] = {
      status: online ? "online" : "offline",
      lastSeen: online
        ? new Date().toISOString()
        : agentStatusCache[agentId]?.lastSeen || "never",
      endpoint: healthyEndpoint ?? agentStatusCache[agentId]?.endpoint,
    };
  }
}

const agentStatusInterval = setInterval(() => {
  void refreshAgentStatuses();
}, 30_000);
agentStatusInterval.unref();
void refreshAgentStatuses();

app.get("/api/agents/status", async (_req, res) => {
  res.json({
    agents: Object.entries(agentStatusCache).map(([id, data]) => ({
      id,
      ...data,
    })),
    lastRefresh: new Date().toISOString(),
  });
});

// === AGENT FOCUS: Most recently modified file per workspace ===

// Agent workspaces come from entity.config.yaml/admin file-source bindings.
const AGENT_WORKSPACES: Record<string, string> = buildConfiguredAgentWorkspaces(runtimeConfig, runtimeConfigBaseDir);
const AGENT_FOCUS_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".md",
  ".py",
  ".sh",
]);
const AGENT_FOCUS_IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
]);

async function findMostRecentWorkspaceFile(
  workspacePath: string,
  maxDepth: number,
): Promise<{ filePath: string; modifiedAtMs: number } | null> {
  const queue: Array<{ dirPath: string; depth: number }> = [
    { dirPath: workspacePath, depth: 0 },
  ];
  let latest: { filePath: string; modifiedAtMs: number } | null = null;

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      break;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(next.dirPath, {
        withFileTypes: true,
      });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(next.dirPath, entry.name);
      if (entry.isDirectory()) {
        if (
          !AGENT_FOCUS_IGNORED_DIRECTORIES.has(entry.name) &&
          next.depth < maxDepth
        ) {
          queue.push({ dirPath: absolutePath, depth: next.depth + 1 });
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (
        !AGENT_FOCUS_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        continue;
      }

      let stats: fs.Stats;
      try {
        stats = await fs.promises.stat(absolutePath);
      } catch {
        continue;
      }

      if (!latest || stats.mtimeMs > latest.modifiedAtMs) {
        latest = { filePath: absolutePath, modifiedAtMs: stats.mtimeMs };
      }
    }
  }

  return latest;
}

app.get("/api/agents/focus", async (_req, res) => {
  const results: Array<{
    id: string;
    file: string | null;
    lastModified: string | null;
  }> = [];
  const fiveMinutesAgoMs = Date.now() - 5 * 60 * 1000;

  for (const [agentId, wsPath] of Object.entries(AGENT_WORKSPACES)) {
    try {
      const latestFile = await findMostRecentWorkspaceFile(wsPath, 3);
      if (!latestFile || latestFile.modifiedAtMs <= fiveMinutesAgoMs) {
        results.push({ id: agentId, file: null, lastModified: null });
        continue;
      }

      const relativePath = path
        .relative(wsPath, latestFile.filePath)
        .replace(/\\/g, "/");
      results.push({
        id: agentId,
        file: relativePath,
        lastModified: new Date(latestFile.modifiedAtMs).toISOString(),
      });
    } catch {
      results.push({ id: agentId, file: null, lastModified: null });
    }
  }

  res.json({ agents: results });
});

app.get('/api/docs/*', async (req, res) => {
  const wildcardParams = req.params as Record<string, string | undefined>;
  const docPathRaw = wildcardParams['0'];
  if (!docPathRaw || typeof docPathRaw !== 'string') {
    return res.status(400).json({ error: 'Missing docs path' });
  }

  const normalizedDocPath = path
    .normalize(docPathRaw)
    .replace(/^[\\/]+/, '')
    .replace(/^(\.\.(\/|\\|$))+/, '');
  if (
    !normalizedDocPath ||
    normalizedDocPath.includes('..') ||
    path.isAbsolute(normalizedDocPath)
  ) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const [rootKey, ...restSegments] = normalizedDocPath.split('/').filter(Boolean);
  if (!rootKey) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const configuredRoot = DOCS_ROOTS[rootKey];
  if (!configuredRoot) {
    return res.status(404).json({ error: 'Unknown docs root' });
  }

  const resolvedRoot = path.resolve(configuredRoot);
  const relativeDocPath = restSegments.join('/');
  if (!relativeDocPath) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const resolvedDocPath = path.resolve(resolvedRoot, relativeDocPath);
  const relativeToRoot = path.relative(resolvedRoot, resolvedDocPath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return res.status(403).json({ error: 'Path traversal blocked' });
  }

  try {
    const stats = await fs.promises.stat(resolvedDocPath);
    if (!stats.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = await fs.promises.readFile(resolvedDocPath, 'utf-8');
    return res.json({
      content,
      path: normalizedDocPath,
      filename: path.basename(resolvedDocPath),
    });
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }
});


// Test error endpoint for Sentry verification
if (shouldRegisterTestErrorRoute()) {
  app.get("/api/test-error", (_req, res) => {
    console.log("[Test] Sentry test error triggered");
    // Capture message to Sentry
    const { Sentry } = require("./sentry");
    Sentry.captureMessage("Test error from Entity Mission Control", "error");
    res.json({
      success: true,
      message: "Test error sent to Sentry",
      timestamp: new Date().toISOString(),
    });
    // Also throw an uncaught exception to test error handling
    setTimeout(() => {
      throw new Error("Sentry test uncaught exception");
    }, 100);
  });
}

// Serve frontend static files
const frontendDist = resolveFrontendDist();
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist, { setHeaders: setFrontendStaticCacheHeaders }));
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api/')) return next();
    // If request has a file extension, check if the file exists in frontendDist first
    const ext = path.extname(_req.path);
    if (ext) {
      const filePath = path.join(frontendDist, _req.path);
      if (fs.existsSync(filePath)) {
        setFrontendStaticCacheHeaders(res, filePath);
        return res.sendFile(filePath);
      }
    }
    sendIndexNoCache(res, path.join(frontendDist, 'index.html'));
  });
  console.log(`Serving frontend from ${frontendDist}`);
}

let shuttingDown = false;
function shutdown(reason: string, exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  clearInterval(agentStatusInterval);
  taskAgentScheduler.stop();
  closeDocumentsDatabase();
  console.log(`[Server] Shutting down (${reason})`);
  wss.close(() => {
    server.close(() => {
      process.exit(exitCode);
    });
  });
  setTimeout(() => {
    process.exit(exitCode);
  }, 5_000).unref();
}

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[Server] Port ${PORT} is already in use. Set PORT to an open port and retry.`,
    );
    shutdown("startup error: EADDRINUSE", 1);
    return;
  }

  console.error("[Server] Fatal listen error:", err.message);
  shutdown("startup error", 1);
});

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception:", err);
  shutdown("uncaught exception", 1);
});

try {
  assertSecureBindOrThrow({
    host: HOST,
    hasToken: isApiAuthEnabled(),
    allowInsecure: process.env.ENTITY_ALLOW_INSECURE,
    logger: console,
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[Server] Fatal startup security error: ${message}`);
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`Entity server on ${HOST}:${PORT}`);
  console.log(`[WS] Sharing HTTP server on port ${PORT}`);
  console.log(`Workspace: ${WORKSPACE}`);
  console.log(`[Plugins] Registered ${pluginRegistry.list().length} plugin(s)`);
  console.log(
    `Multi-source FS routes: ${FS_MULTISOURCE_ENABLED ? "enabled" : "disabled"}`,
  );
  console.log(
    `Agent-native editor routes: ${AGENT_NATIVE_EDITOR_ENABLED ? "enabled" : "disabled"}`,
  );
  console.log(
    `Entity TaskAgent: ${AGENT_CONFIG.enabled ? "enabled" : "disabled"}`,
  );
  void ensureSampleTasks();

  // Start Swarm self-healer - auto-recover stuck jobs
  import("./swarm/healer")
    .then(({ startHealer }) => {
      startHealer();
    })
    .catch((err: unknown) => {
      console.error("[Swarm] Failed to start healer:", err);
    });
});

// Agent metrics endpoint (health + cost)
app.get("/api/agents/metrics", async (_req, res) => {
  try {
    res.json(collectAgentMetrics());
  } catch (error) {
    res.status(500).json({ error: "Failed to gather metrics" });
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error("[Express] Unhandled route error:", err);
  res.status(500).json({ error: message });
});
