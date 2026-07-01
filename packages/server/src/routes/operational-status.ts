import fs from "fs";
import path from "path";
import type { Express } from "express";
import { buildConfiguredAgentHealthEndpoints, buildConfiguredAgentWorkspaces } from "../config/runtime";
import { asyncHandler } from "../middleware/async-handler";

interface RegisterOperationalStatusRoutesDeps {
  activityRepository: any;
  docsRoots: Record<string, string>;
  runtimeConfig: any;
  runtimeConfigBaseDir: string;
}

export function registerOperationalStatusRoutes(
  app: Express,
  deps: RegisterOperationalStatusRoutesDeps,
): ReturnType<typeof setInterval> {
  const {
    activityRepository,
    docsRoots: DOCS_ROOTS,
    runtimeConfig,
    runtimeConfigBaseDir,
  } = deps;

  // Activity feed (recent across all tasks)
  app.get("/api/activity/recent", asyncHandler(async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 25;
      const activities = activityRepository.listActivities(limit);
      res.json(activities);
    } catch {
      res.json([]);
    }
  }));

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

  app.get("/api/agents/status", asyncHandler(async (_req, res) => {
    res.json({
      agents: Object.entries(agentStatusCache).map(([id, data]) => ({
        id,
        ...data,
      })),
      lastRefresh: new Date().toISOString(),
    });
  }));

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

  app.get("/api/agents/focus", asyncHandler(async (_req, res) => {
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
  }));

  app.get('/api/docs/*', asyncHandler(async (req, res) => {
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
  }));

  return agentStatusInterval;
}
