import dotenv from "dotenv";

// Initialize Sentry early for error tracking
import "./sentry";

import http from "http";
import os from "os";
import path from "path";
import express, { type Request, type Response } from "express";
import compression from "compression";
import fs from "fs";
import cors from "cors";
import { createHash, randomUUID } from "crypto";
import Database from "better-sqlite3";
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
import { createFileSourceAdapter } from "./fs/adapters/registry";
import {
  assertSourceEnabled,
  normalizeSourceRelativePath,
} from "./fs/security";
import { registerEditorModule } from "./editor";
import { detectContentType } from "./file-types";
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
import { createAgentRegistryRouter } from "./routes/agent-registry";
import { createWorkspaceRouter } from "./routes/workspace";
import { createTaskReviewGateRouter } from "./routes/task-review-gates";
import { createMigrationCleanupQueueRouter } from "./routes/migration-cleanup-queues";
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
import { createApiAuthMiddleware, createWsAuthHandler } from "./middleware/api-auth";
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

registerConfigRoutes(app);
app.use("/notifications", createNotificationRouter({ notificationRepository }));
app.use("/api/notifications", createNotificationRouter({ notificationRepository }));
app.use("/api/search", createSearchRouter());
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
app.use("/api/migration-cleanup-queues", createMigrationCleanupQueueRouter());
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
  updateTask: (taskId, fields) => taskSyncLayer.updateTask(taskId, fields as never),
  listAgents: () => agentRegistryRepo.listAgents(),
  logActivity: (input) => logActivity(input as Parameters<typeof logActivity>[0]),
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
const AUTHOR_SET_VALID = new Set([
  "human",
  "assistant",
  "unknown",
]);
const DOCUMENT_PRESENCE_STATUS_SET = new Set([
  "active",
  "idle",
  "away",
  "offline",
]);
const DOCUMENT_SUGGESTION_TYPE_SET = new Set([
  "insert",
  "replace",
  "delete",
  "other",
]);
const DOCUMENT_SUGGESTION_STATUS_SET = new Set([
  "pending",
  "accepted",
  "rejected",
]);
const DOCUMENT_REVIEW_MODE_SET = new Set(["quick", "deep", "security"]);
const DOCUMENT_REVIEW_STATUS_SET = new Set([
  "pending",
  "running",
  "completed",
  "failed",
]);

type DocumentJsonPrimitive = string | number | boolean | null;
type DocumentJsonValue =
  | DocumentJsonPrimitive
  | DocumentJsonValue[]
  | { [key: string]: DocumentJsonValue };
type SqlRow = Record<string, unknown>;

interface ParsedDocumentId {
  docId: string;
  sourceId: string;
  path: string;
}

let documentsDb: Database.Database | null = null;
let documentsDbPath: string | null = null;

function ensureDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveDocumentsDbPath(): string {
  const customPath = process.env.ENTITY_DOCUMENTS_DB_PATH?.trim();
  if (customPath) {
    return path.resolve(customPath);
  }

  const candidates = [
    path.resolve(process.cwd(), "packages/db/entity-documents.db"),
    path.resolve(WORKSPACE, "packages/db/entity-documents.db"),
    path.resolve(__dirname, "../../db/entity-documents.db"),
    path.resolve(__dirname, "../../../db/entity-documents.db"),
  ];

  for (const candidate of candidates) {
    const directory = path.dirname(candidate);
    if (fs.existsSync(directory)) {
      return candidate;
    }
  }

  return candidates[0];
}

function configureDocumentsDb(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
}

function ensureDocumentsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_sessions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL UNIQUE,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content_hash TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS authorship_ranges (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      author TEXT NOT NULL CHECK(author IN ('human','assistant','unknown')),
      reviewed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS authorship_history (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      range_id TEXT,
      author TEXT NOT NULL,
      diff_json TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_presence (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','idle','away','offline')),
      cursor_json TEXT,
      last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(doc_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS document_comments (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      author TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      selected_text TEXT,
      text TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_comment_replies (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      comment_id TEXT NOT NULL REFERENCES document_comments(id),
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_suggestions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      author TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'replace' CHECK(type IN ('insert','replace','delete','other')),
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      original_text TEXT NOT NULL,
      suggested_text TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_review_runs (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'quick' CHECK(mode IN ('quick','deep','security')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_review_findings (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES document_review_runs(id),
      type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('error','warning','info')),
      message TEXT NOT NULL,
      start_offset INTEGER,
      end_offset INTEGER,
      suggested_fix_json TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','applied','ignored')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_document_sessions_doc_id ON document_sessions(doc_id);
    CREATE INDEX IF NOT EXISTS idx_authorship_ranges_doc_id ON authorship_ranges(doc_id);
    CREATE INDEX IF NOT EXISTS idx_authorship_history_doc_id ON authorship_history(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_presence_doc_id ON document_presence(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_comments_doc_id ON document_comments(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_doc_id ON document_comment_replies(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_comment_id ON document_comment_replies(comment_id);
    CREATE INDEX IF NOT EXISTS idx_document_suggestions_doc_id ON document_suggestions(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_review_runs_doc_id ON document_review_runs(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_review_findings_doc_id ON document_review_findings(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_review_findings_run_id ON document_review_findings(run_id);
  `);
}

function getDocumentsDatabase(): Database.Database {
  const dbPath = resolveDocumentsDbPath();
  if (!documentsDb || documentsDbPath !== dbPath) {
    if (documentsDb) {
      try {
        documentsDb.close();
      } catch {
        // best-effort close
      }
    }

    ensureDirectory(dbPath);
    documentsDb = new Database(dbPath);
    documentsDbPath = dbPath;
    configureDocumentsDb(documentsDb);
    ensureDocumentsSchema(documentsDb);
  }

  return documentsDb;
}

function getDefaultTaskActor(): string {
  return (
    process.env.ENTITY_TASK_ACTOR?.trim() ||
    process.env.ENTITY_DEFAULT_ACTOR?.trim() ||
    "Henry"
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

function resolveWorkspaceMutationPath(rawPath: string): string {
  if (rawPath.includes("\0")) {
    throw new Error("Invalid path.");
  }

  const workspaceRoot = path.resolve(WORKSPACE);
  const resolvedPath = path.resolve(workspaceRoot, rawPath);
  const relativePath = path.relative(workspaceRoot, resolvedPath);

  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("File mutation path must stay inside the workspace.");
  }

  return resolvedPath;
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

type FileVersion = {
  id: string;
  content: string;
  author: string;
  timestamp: string;
  summary: string;
};

type FileVersionMeta = Omit<FileVersion, "content">;

// In-memory version history (last 10 per path).
const fileVersionsByPath = new Map<string, FileVersion[]>();
const MAX_TRACKED_VERSION_FILES = 500;

function generateVersionId(): string {
  try {
    return randomUUID();
  } catch {
    return `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function normalizeVersionAuthor(value: unknown): string {
  if (typeof value !== "string") return "You";
  const trimmed = value.trim();
  return trimmed ? trimmed : "You";
}

function normalizeVersionSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function pushFileVersion(filePath: string, version: FileVersion) {
  const existing = fileVersionsByPath.get(filePath) ?? [];
  existing.unshift(version);
  if (existing.length > 10) {
    existing.length = 10;
  }
  // Keep Map insertion order aligned with recency for cheap eviction.
  fileVersionsByPath.delete(filePath);
  fileVersionsByPath.set(filePath, existing);
  while (fileVersionsByPath.size > MAX_TRACKED_VERSION_FILES) {
    const oldestKey = fileVersionsByPath.keys().next().value as
      | string
      | undefined;
    if (!oldestKey) {
      break;
    }
    fileVersionsByPath.delete(oldestKey);
  }
}

function countLineEdits(
  previousContent: string,
  nextContent: string,
): { added: number; removed: number } {
  const prevLines = previousContent.split("\n");
  const nextLines = nextContent.split("\n");
  const prevLen = prevLines.length;
  const nextLen = nextLines.length;

  if (previousContent === nextContent) {
    return { added: 0, removed: 0 };
  }

  if (prevLen === 0) {
    return { added: nextLen, removed: 0 };
  }

  if (nextLen === 0) {
    return { added: 0, removed: prevLen };
  }

  const n = prevLen;
  const m = nextLen;
  const cellBudget = 2_000_000;
  if (n * m > cellBudget) {
    // Fallback: approximate counts via set diff (handles large files cheaply, but may overcount duplicates).
    const prevSet = new Set(prevLines);
    const nextSet = new Set(nextLines);
    let added = 0;
    let removed = 0;
    for (const line of nextLines) {
      if (!prevSet.has(line)) added += 1;
    }
    for (const line of prevLines) {
      if (!nextSet.has(line)) removed += 1;
    }
    return { added, removed };
  }

  // Compute LCS length with O(min(n, m)) memory.
  const a = prevLines;
  const b = nextLines;
  const small = b.length <= a.length ? b : a;
  const large = b.length <= a.length ? a : b;
  const dp = new Array<number>(small.length + 1).fill(0);

  for (let i = 1; i <= large.length; i += 1) {
    let prev = 0;
    const largeLine = large[i - 1];
    for (let j = 1; j <= small.length; j += 1) {
      const temp = dp[j];
      if (largeLine === small[j - 1]) {
        dp[j] = prev + 1;
      } else {
        dp[j] = Math.max(dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }

  const lcs = dp[small.length];
  const added = nextLen - lcs;
  const removed = prevLen - lcs;
  return { added: Math.max(0, added), removed: Math.max(0, removed) };
}

function buildAutoSaveSummary(
  previousContent: string,
  nextContent: string,
): string {
  const { added, removed } = countLineEdits(previousContent, nextContent);
  if (added === 0 && removed === 0) {
    return "Saved (no changes)";
  }

  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`-${removed}`);
  return `Saved (${parts.join(" ")})`;
}

interface RawFilePayload {
  content: Buffer;
  contentType: string;
  size: number;
  updatedAt?: string;
  fileName: string;
}

function sanitizeContentDispositionFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[\r\n]+/g, " ")
      .replace(/["\\]/g, "_") || "file"
  );
}

function mapFileRouteErrorStatus(message: string): number {
  const normalized = message.trim().toLowerCase();

  if (
    normalized.includes("required") ||
    normalized.includes("invalid") ||
    normalized.includes("allowlisted") ||
    normalized.includes("traversal") ||
    normalized.includes("not a file") ||
    normalized.includes("is a directory") ||
    normalized.includes("eisdir")
  ) {
    return 400;
  }

  if (normalized.includes("disabled")) {
    return 403;
  }

  if (
    normalized.includes("not found") ||
    normalized.includes("does not exist") ||
    normalized.includes("no such file")
  ) {
    return 404;
  }

  return 500;
}

function sendRawFileResponse(res: Response, payload: RawFilePayload): Response {
  const fileName = sanitizeContentDispositionFilename(payload.fileName);
  const contentType = payload.contentType || "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(payload.size));
  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

  if (payload.updatedAt) {
    const updatedAt = new Date(payload.updatedAt);
    if (!Number.isNaN(updatedAt.getTime())) {
      res.setHeader("Last-Modified", updatedAt.toUTCString());
    }
  }

  return res.send(payload.content);
}

async function readRawLocalFile(filePath: string): Promise<RawFilePayload> {
  const [content, stats] = await Promise.all([
    fs.promises.readFile(filePath),
    fs.promises.stat(filePath),
  ]);

  if (!stats.isFile()) {
    throw new Error("Target path is not a file.");
  }

  const detected = detectContentType({ filePath, content });
  return {
    content,
    contentType: detected.contentType,
    size: stats.size,
    updatedAt: stats.mtime.toISOString(),
    fileName: path.basename(filePath) || "file",
  };
}

async function readRawSourceFile(
  sourceId: string,
  relativePath: string,
): Promise<RawFilePayload> {
  const normalizedSourceId = sourceId.trim();
  if (!normalizedSourceId) {
    throw new Error("source is required.");
  }

  const normalizedPath = normalizeSourceRelativePath(relativePath);
  if (!normalizedPath) {
    throw new Error("path required");
  }

  const source = fileSourceRepository.getSource(normalizedSourceId);
  assertSourceEnabled(source);

  const adapter = createFileSourceAdapter(source);
  const fileName = path.posix.basename(normalizedPath) || "file";

  if (typeof adapter.readRaw === "function") {
    const raw = await adapter.readRaw(normalizedPath);
    return {
      content: raw.content,
      contentType: raw.contentType || "application/octet-stream",
      size: raw.size,
      updatedAt: raw.updatedAt,
      fileName,
    };
  }

  const file = await adapter.read(normalizedPath);
  const content = Buffer.from(file.content, "utf-8");
  const detected = detectContentType({
    filePath: normalizedPath,
    headerContentType: file.contentType,
    content,
  });

  return {
    content,
    contentType: detected.contentType,
    size: content.length,
    updatedAt: file.updatedAt,
    fileName,
  };
}

app.get("/api/files", async (req, res) => {
  const rawPath = req.query.path;
  if (typeof rawPath !== "undefined" && typeof rawPath !== "string") {
    return res.status(400).json({ error: "path must be a string" });
  }

  const dirPath = rawPath || WORKSPACE;
  try {
    const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const files = items
      .filter((item) => !item.name.startsWith("."))
      .map((item) => ({
        name: item.name,
        isDirectory: item.isDirectory(),
        path: path.join(dirPath, item.name),
      }));
    return res.json(files);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.get("/api/file/raw", async (req, res) => {
  const requestedPath = req.query.path;
  if (typeof requestedPath !== "string" || !requestedPath) {
    return res.status(400).json({ error: "path required" });
  }

  const sourceId =
    typeof req.query.source === "string"
      ? req.query.source
      : typeof req.query.sourceId === "string"
        ? req.query.sourceId
        : "";

  try {
    const payload = sourceId
      ? await readRawSourceFile(sourceId, requestedPath)
      : await readRawLocalFile(requestedPath);

    return sendRawFileResponse(res, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res
      .status(mapFileRouteErrorStatus(message))
      .json({ error: message });
  }
});

app.get("/api/file", async (req, res) => {
  const filePath = req.query.path;
  if (typeof filePath !== "string") {
    return res.status(400).json({ error: "path required" });
  }

  if (!filePath) {
    return res.status(400).json({ error: "path required" });
  }

  try {
    const [contentBuffer, stats] = await Promise.all([
      fs.promises.readFile(filePath),
      fs.promises.stat(filePath),
    ]);

    if (!stats.isFile()) {
      throw new Error("Target path is not a file.");
    }

    const detected = detectContentType({ filePath, content: contentBuffer });
    return res.json({
      content: detected.isBinary ? "" : contentBuffer.toString("utf-8"),
      size: stats.size,
      mtime: stats.mtime,
      contentType: detected.contentType,
      isBinary: detected.isBinary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res
      .status(mapFileRouteErrorStatus(message))
      .json({ error: message });
  }
});

app.post("/api/files/:path(*)/versions", (req, res) => {
  const filePath = req.params.path;
  if (!filePath) {
    return res.status(400).json({ error: "path required" });
  }

  const content = req.body?.content;
  if (typeof content !== "string") {
    return res.status(400).json({ error: "content required" });
  }

  const author = normalizeVersionAuthor(req.body?.author);
  const summary = normalizeVersionSummary(req.body?.summary) ?? "Snapshot";

  try {
    const resolvedFilePath = resolveWorkspaceMutationPath(filePath);
    const version: FileVersion = {
      id: generateVersionId(),
      content,
      author,
      timestamp: new Date().toISOString(),
      summary,
    };

    pushFileVersion(resolvedFilePath, version);
    return res.json({ version });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res
      .status(mapFileRouteErrorStatus(message))
      .json({ error: message });
  }
});

app.get("/api/files/:path(*)/versions", (req, res) => {
  const filePath = req.params.path;
  if (!filePath) {
    return res.status(400).json({ error: "path required" });
  }

  try {
    const resolvedFilePath = resolveWorkspaceMutationPath(filePath);
    const versions = fileVersionsByPath.get(resolvedFilePath) ?? [];
    const metas: FileVersionMeta[] = versions.map(
      ({ content: _content, ...meta }) => meta,
    );
    return res.json({ versions: metas });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res
      .status(mapFileRouteErrorStatus(message))
      .json({ error: message });
  }
});

app.get("/api/files/:path(*)/versions/:id", (req, res) => {
  const filePath = req.params.path;
  const { id } = req.params;

  if (!filePath) {
    return res.status(400).json({ error: "path required" });
  }

  try {
    const resolvedFilePath = resolveWorkspaceMutationPath(filePath);
    const versions = fileVersionsByPath.get(resolvedFilePath) ?? [];
    const version = versions.find((entry) => entry.id === id);
    if (!version) {
      return res.status(404).json({ error: "version not found" });
    }

    return res.json({ version });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res
      .status(mapFileRouteErrorStatus(message))
      .json({ error: message });
  }
});

app.put("/api/file", async (req, res) => {
  const filePath = req.query.path;
  if (typeof filePath !== "string") {
    return res.status(400).json({ error: "path required" });
  }

  if (!filePath) {
    return res.status(400).json({ error: "path required" });
  }

  const content = req.body?.content;
  if (typeof content !== "string") {
    return res.status(400).json({ error: "content required" });
  }

  const author = normalizeVersionAuthor(req.body?.author);
  const requestSummary = normalizeVersionSummary(req.body?.summary);
  try {
    const resolvedFilePath = resolveWorkspaceMutationPath(filePath);
    // Auto-save a version snapshot before overwriting.
    try {
      const previousContent = await fs.promises.readFile(resolvedFilePath, "utf-8");
      if (previousContent !== content) {
        const version: FileVersion = {
          id: generateVersionId(),
          content: previousContent,
          author,
          timestamp: new Date().toISOString(),
          summary:
            requestSummary ?? buildAutoSaveSummary(previousContent, content),
        };
        pushFileVersion(resolvedFilePath, version);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        // File did not exist yet; no snapshot to capture.
      } else {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.warn(
          "[Versions] Failed to snapshot previous content:",
          message,
        );
      }
    }

    await fs.promises.writeFile(resolvedFilePath, content, "utf-8");
    const relativePath = toWorkspaceRelativePath(resolvedFilePath);
    logActivity({
      source: "agent",
      type: "file_edit",
      action: "Edited file",
      description: `Updated ${relativePath}.`,
      filePath: resolvedFilePath,
      agentName: "Entity",
      agentEmoji: "⚡",
    });
    broadcast({ type: "file:changed", path: resolvedFilePath, content });
    return res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/api/file", async (req, res) => {
  const { path: filePath, content } = req.body;
  if (typeof filePath !== "string" || !filePath) {
    return res.status(400).json({ error: "path required" });
  }

  try {
    const resolvedFilePath = resolveWorkspaceMutationPath(filePath);
    await fs.promises.mkdir(path.dirname(resolvedFilePath), { recursive: true });
    await fs.promises.writeFile(
      resolvedFilePath,
      typeof content === "string" ? content : "",
      "utf-8",
    );
    const relativePath = toWorkspaceRelativePath(resolvedFilePath);
    logActivity({
      source: "agent",
      type: "file_edit",
      action: "Created file",
      description: `Created ${relativePath}.`,
      filePath: resolvedFilePath,
      agentName: "Entity",
      agentEmoji: "⚡",
    });
    broadcast({ type: "file:created", path: resolvedFilePath });
    return res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.delete("/api/file", async (req, res) => {
  const filePath = req.query.path;
  if (typeof filePath !== "string") {
    return res.status(400).json({ error: "path required" });
  }

  if (!filePath) {
    return res.status(400).json({ error: "path required" });
  }

  try {
    const resolvedFilePath = resolveWorkspaceMutationPath(filePath);
    await fs.promises.unlink(resolvedFilePath);
    fileVersionsByPath.delete(resolvedFilePath);
    const relativePath = toWorkspaceRelativePath(resolvedFilePath);
    logActivity({
      source: "agent",
      type: "file_edit",
      action: "Deleted file",
      description: `Deleted ${relativePath}.`,
      filePath: resolvedFilePath,
      agentName: "Entity",
      agentEmoji: "⚡",
    });
    broadcast({ type: "file:deleted", path: resolvedFilePath });
    return res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/api/file/move", async (req, res) => {
  const { from, to } = req.body;
  if (typeof from !== "string" || typeof to !== "string" || !from || !to) {
    return res.status(400).json({ error: "from and to required" });
  }

  try {
    const resolvedFrom = resolveWorkspaceMutationPath(from);
    const resolvedTo = resolveWorkspaceMutationPath(to);
    await fs.promises.rename(resolvedFrom, resolvedTo);
    const existingVersions = fileVersionsByPath.get(resolvedFrom);
    if (existingVersions) {
      fileVersionsByPath.delete(resolvedFrom);
      fileVersionsByPath.set(resolvedTo, existingVersions);
    }
    logActivity({
      source: "agent",
      type: "file_edit",
      action: "Moved file",
      description: `Moved ${toWorkspaceRelativePath(resolvedFrom)} to ${toWorkspaceRelativePath(resolvedTo)}.`,
      filePath: resolvedTo,
      agentName: "Entity",
      agentEmoji: "⚡",
    });
    broadcast({ type: "file:moved", from: resolvedFrom, to: resolvedTo });
    return res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
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

function registerTaskRoutes(prefix: "" | "/api") {
  const tasksBase = `${prefix}/tasks`;

  const serializeDuplicateCandidates = (
    title: string,
    candidates: ReturnType<typeof findTaskDuplicateCandidates>,
  ) => ({
    title,
    count: candidates.length,
    duplicates: candidates.slice(0, 8).map((candidate) => ({
      id: candidate.task.id,
      name: candidate.task.name,
      column: candidate.task.column,
      blocked: candidate.task.blocked,
      assignee: candidate.task.assignee,
      score: Number(candidate.score.toFixed(3)),
      exact: candidate.exact,
      updated_at: candidate.task.updated_at,
    })),
  });

  app.get(`${tasksBase}/duplicates`, async (req, res) => {
    const title =
      typeof req.query.title === "string" ? req.query.title.trim() : "";
    if (!title) {
      return res
        .status(400)
        .json({ error: "title query parameter is required" });
    }

    const excludeTaskId = parsePositiveId(req.query.excludeTaskId);

    try {
      const tasks = await taskSyncLayer.listTasks();
      const candidates = findTaskDuplicateCandidates(title, tasks, {
        excludeTaskId:
          typeof excludeTaskId === "number" ? excludeTaskId : undefined,
      });
      return res.json(serializeDuplicateCandidates(title, candidates));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.get(tasksBase, async (req, res) => {
    const pagination = parseTaskPaginationQuery(req.query);
    if ("error" in pagination) {
      return res.status(400).json({ error: pagination.error });
    }

    try {
      let tasks = await taskSyncLayer.listTasks();
      // Support ?column=X filtering (single column)
      const columnFilter =
        typeof req.query.column === "string"
          ? req.query.column.trim().toLowerCase()
          : null;
      if (columnFilter) {
        tasks = tasks.filter((t) => t.column === columnFilter);
      }
      // Support ?columns=todo,doing,review (multi-column include filter)
      const columnsFilter =
        typeof req.query.columns === "string"
          ? req.query.columns.trim().toLowerCase()
          : null;
      if (columnsFilter) {
        const allowedColumns = new Set(
          columnsFilter
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
        );
        tasks = tasks.filter((t) => allowedColumns.has(t.column));
      }
      // Support ?excludeColumns=done,backlog (multi-column exclude filter)
      const excludeColumnsFilter =
        typeof req.query.excludeColumns === "string"
          ? req.query.excludeColumns.trim().toLowerCase()
          : null;
      if (excludeColumnsFilter) {
        const excludedColumns = new Set(
          excludeColumnsFilter
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
        );
        tasks = tasks.filter((t) => !excludedColumns.has(t.column));
      }

      const projectFilter =
        typeof req.query.project === "string"
          ? req.query.project.trim().toLowerCase()
          : null;
      if (projectFilter && projectFilter !== "all") {
        tasks = tasks.filter((task) => taskHasProjectName(task, projectFilter));
      }

      const enrichedTasks = enrichTasksWithSubtaskSummary(tasks);
      const total = enrichedTasks.length;
      const paginatedTasks = paginateTasks(enrichedTasks, pagination);
      // Only embed activity when explicitly requested (?includeActivity=true)
      // This avoids 296 individual SQLite queries on every poll
      const includeActivity =
        String(req.query.includeActivity ?? "false").toLowerCase() === "true";
      if (includeActivity && (pagination.limit === null || pagination.limit > 500)) {
        return res.status(400).json({
          error: "includeActivity requires an explicit limit of 500 or fewer",
        });
      }
      const result = includeActivity
        ? paginatedTasks.map((task) => ({
            ...task,
            activity: activityRepository.listActivitiesByTaskId(task.id, 20),
          }))
        : paginatedTasks;
      res.json({
        tasks: result,
        ...buildTaskPaginationMeta(total, pagination, result.length),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.get(`${tasksBase}/stale`, async (req, res) => {
    const hoursRaw = Number(req.query.hours);
    const thresholdHours =
      Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : 24;
    const includeBlocked =
      String(req.query.includeBlocked ?? "false").toLowerCase() === "true";

    try {
      const tasks = await taskSyncLayer.listTasks();
      const now = Date.now();
      const stale = tasks
        .filter((task) => {
          if (task.column === "done" || task.column === "backlog") {
            return false;
          }
          if (!includeBlocked && task.blocked) {
            return false;
          }
          const ts = Date.parse(task.updated_at || task.created_at);
          if (Number.isNaN(ts)) {
            return false;
          }
          const ageHours = (now - ts) / (1000 * 60 * 60);
          return ageHours >= thresholdHours;
        })
        .map((task) => {
          const ts = Date.parse(task.updated_at || task.created_at);
          const ageHours = Number.isNaN(ts)
            ? null
            : Number(((now - ts) / (1000 * 60 * 60)).toFixed(1));
          return { ...task, stale_hours: ageHours };
        });

      return res.json({
        threshold_hours: thresholdHours,
        count: stale.length,
        tasks: stale,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.get(`${tasksBase}/owner-inbox`, async (req, res) => {
    const ownerPrincipalId =
      typeof req.query.ownerPrincipalId === "string"
        ? req.query.ownerPrincipalId.trim()
        : typeof req.query.owner_principal_id === "string"
          ? req.query.owner_principal_id.trim()
          : "";
    if (!ownerPrincipalId) {
      return res.status(400).json({ error: "ownerPrincipalId query parameter is required" });
    }

    const stalledHoursRaw = Number(req.query.stalledHours);
    const stalledHours = Number.isFinite(stalledHoursRaw) && stalledHoursRaw > 0 ? stalledHoursRaw : 24;

    try {
      const tasks = await taskSyncLayer.listTasks();
      return res.json(buildOwnerAccountabilityInbox({
        ownerPrincipalId,
        tasks,
        stalledHours,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.get(`${tasksBase}/:id`, async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    try {
      const task = await taskSyncLayer.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      // Always include activity for single-task detail view
      const activity = activityRepository.listActivitiesByTaskId(id, 20);
      const allTasks = await taskSyncLayer.listTasks();
      const subtasks = allTasks.filter(
        (candidate) => readParentTaskId(candidate.metadata) === id,
      );
      const enrichedTask = enrichTasksWithSubtaskSummary([
        task,
        ...subtasks,
      ]).find((entry) => entry.id === id) ?? {
        ...task,
        parent_task_id: readParentTaskId(task.metadata),
        subtask_count: subtasks.length,
        subtask_done_count: subtasks.filter((entry) => entry.column === "done")
          .length,
      };
      return res.json({ ...enrichedTask, activity, subtasks });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(tasksBase, async (req, res) => {
    const {
      name,
      description,
      column,
      assignee,
      metadata,
      blocked,
      blocker_reason,
      project,
      projectIds,
      due_date,
      due_at,
      priority,
      estimate_hours,
      time_spent,
      output,
      brief,
      origin_channel,
      progress_status,
      recurring,
      recurring_config,
      model,
      worktype,
      policy_inputs_json,
      create_anyway,
      dedupe_override,
      createAnyway,
    } = req.body as {
      name?: string;
      description?: string;
      column?: string;
      assignee?: string;
      metadata?: string;
      blocked?: unknown;
      blocker_reason?: unknown;
      project?: string;
      projectIds?: unknown;
      due_date?: string;
      due_at?: string;
      priority?: string;
      estimate_hours?: number;
      time_spent?: number;
      output?: string;
      brief?: string;
      origin_channel?: string;
      progress_status?: string;
      recurring?: unknown;
      recurring_config?: string;
      model?: string;
      worktype?: string;
      policy_inputs_json?: string;
      create_anyway?: unknown;
      dedupe_override?: unknown;
      createAnyway?: unknown;
    };

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "name required" });
    }

    const accountability = parseTaskAccountabilityForCreate(
      req.body as Record<string, unknown>,
      getTaskActorFromRequest(req),
    );
    if ("error" in accountability) {
      return res.status(400).json(accountability);
    }

    const requestedColumn =
      typeof column === "string" ? column.trim().toLowerCase() : "backlog";
    const requestedAssignee = typeof assignee === "string" ? assignee : null;
    const createAnywayOverride =
      normalizeBlockedInput(create_anyway) ??
      normalizeBlockedInput(dedupe_override) ??
      normalizeBlockedInput(createAnyway) ??
      false;

    const accountabilityCheck = validateTaskAccountability({
      column: requestedColumn,
      assignee: requestedAssignee,
      executor_principal_id: accountability.executor_principal_id,
      taskmaster_drivable: accountability.taskmaster_drivable,
      owner_principal_type: accountability.owner_principal_type,
    });
    if (!accountabilityCheck.ok) {
      return res.status(400).json({
        error: accountabilityCheck.error,
        message: accountabilityCheck.message,
      });
    }

    try {
      let requestedProjectIds: number[] | undefined;
      let requestedProjectLabel = project;
      if (typeof projectIds !== "undefined") {
        const parsedProjectIds = parsePositiveIdList(projectIds);
        if (!parsedProjectIds) {
          return res.status(400).json({
            error: "projectIds must be an array of positive integers",
          });
        }
        requestedProjectIds = parsedProjectIds;

        const availableProjects = getProjects();
        const availableProjectIds = new Set(
          availableProjects.map((candidate) => candidate.id),
        );
        for (const candidateId of requestedProjectIds) {
          if (!availableProjectIds.has(candidateId)) {
            return res
              .status(404)
              .json({ error: `project ${candidateId} not found` });
          }
        }

        requestedProjectLabel = buildTaskProjectLabel(
          requestedProjectIds,
          availableProjects,
          "General",
        );
      }

      const normalizedDueDate =
        typeof due_date === "string"
          ? due_date
          : typeof due_at === "string"
            ? due_at
            : undefined;
      const normalizedOutput = normalizeTaskOutputLinks(output) ?? undefined;
      const existingTasks = await taskSyncLayer.listTasks();
      const dedupeCandidates = findTaskDuplicateCandidates(name, existingTasks);
      const exactDuplicate =
        dedupeCandidates.find((candidate) => candidate.exact) ?? null;
      if (!createAnywayOverride && dedupeCandidates.length > 0) {
        return res.status(409).json({
          error: exactDuplicate
            ? "Duplicate task title"
            : "Potential duplicate tasks found",
          message: exactDuplicate
            ? `An active task with the same normalized title already exists (#${exactDuplicate.task.id}).`
            : "Similar active tasks already exist. Merge or use create_anyway=true to create anyway.",
          duplicateType: exactDuplicate ? "exact" : "fuzzy",
          ...serializeDuplicateCandidates(name.trim(), dedupeCandidates),
          allowCreateAnyway: true,
        });
      }
      if (requestedColumn === "review") {
        const reviewAssessment = await taskAgent.assessReview(
          buildTaskPreview({
            name: name.trim(),
            description,
            brief,
            origin_channel,
            column: requestedColumn,
            model,
            assignee: requestedAssignee,
            blocked: normalizeBlockedInput(blocked) ?? false,
            blocker_reason: normalizeBlockerReasonInput(blocker_reason) ?? null,
            due_date: normalizedDueDate,
            priority,
            estimate_hours,
            time_spent,
            output: output ?? null,
            progress_status,
            recurring: normalizeBlockedInput(recurring) ?? false,
            recurring_config,
            metadata,
          }),
        );
        if (reviewAssessment.verdict === "INVALID") {
          return res.status(400).json({
            error: "Invalid review output",
            message: getPrimaryReviewReason(reviewAssessment),
            review: {
              verdict: reviewAssessment.verdict,
              score: reviewAssessment.score,
              taskType: reviewAssessment.taskType,
              evidenceStatus: reviewAssessment.evidenceStatus,
              reasons: reviewAssessment.reasons,
            },
          });
        }
      }
      const task = await taskSyncLayer.createTask({
        name,
        description,
        column,
        assignee,
        ...accountability,
        blocked: normalizeBlockedInput(blocked),
        blocker_reason: normalizeBlockerReasonInput(blocker_reason),
        project: requestedProjectLabel,
        metadata,
        due_date: normalizedDueDate,
        priority,
        estimate_hours,
        time_spent,
        output: normalizedOutput,
        brief,
        origin_channel,
        progress_status,
        recurring: normalizeBlockedInput(recurring),
        recurring_config,
        model,
        worktype,
        policy_inputs_json,
      });

      let responseTask = task;
      if (requestedProjectIds !== undefined) {
        syncTaskProjectAssignments(task.id, [], requestedProjectIds, {
          addTaskProject,
          removeTaskProject,
        });
        responseTask = (await taskSyncLayer.getTask(task.id)) ?? task;
      }

      const activityEvent = buildTaskMutationActivityEvent({
        action: "create",
        task: responseTask,
        actorPrincipalId: getTaskActorFromRequest(req),
      });
      logActivity({
        source: "task",
        type:
          responseTask.column === "done" ? "task_completed" : "task_created",
        activityEventType: activityEvent.eventType,
        activityEventPayload: activityEvent.payload,
        action:
          responseTask.column === "done" ? "Completed task" : "Created task",
        description: `${responseTask.name} in ${capitalizeColumn(responseTask.column)}.`,
        agentName: responseTask.assignee || undefined,
        taskId: responseTask.id,
        taskColumn: responseTask.column,
        metadata: {
          taskName: responseTask.name,
          assignee: responseTask.assignee,
        },
      });
      broadcast({ type: "task:created", task: responseTask });
      await pluginHooks.emit("task:created", { task: responseTask });

      if (AGENT_CONFIG.enabled && responseTask.column === "review") {
        void taskAgent.handleTaskMovedToReview(responseTask).catch((err) => {
          const message =
            err instanceof Error ? err.message : "Unknown agent hook error";
          console.error("[TaskAgent] review_check hook failed:", message);
        });
      }

      return res.status(201).json(responseTask);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  const handleUpdateTask = async (
    req: express.Request,
    res: express.Response,
  ) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const {
      name,
      description,
      column,
      assignee,
      metadata,
      blocked,
      blocker_reason,
      project,
      projectIds,
      due_date,
      due_at,
      priority,
      estimate_hours,
      time_spent,
      output,
      brief,
      origin_channel,
      progress_status,
      recurring,
      recurring_config,
      model,
      worktype,
      policy_inputs_json,
      create_anyway,
      dedupe_override,
      createAnyway,
    } = req.body as {
      name?: string;
      description?: string;
      column?: string;
      assignee?: string;
      metadata?: string;
      blocked?: unknown;
      blocker_reason?: unknown;
      project?: string;
      projectIds?: unknown;
      due_date?: string;
      due_at?: string;
      priority?: string;
      estimate_hours?: number;
      time_spent?: number;
      output?: string;
      brief?: string;
      origin_channel?: string;
      progress_status?: string;
      recurring?: unknown;
      recurring_config?: string;
      model?: string;
      worktype?: string;
      policy_inputs_json?: string;
      create_anyway?: unknown;
      dedupe_override?: unknown;
      createAnyway?: unknown;
    };
    try {
      const existingTask = await taskSyncLayer.getTask(id);
      if (!existingTask) {
        return res.status(404).json({ error: "task not found" });
      }
      const accountabilityUpdates = parseTaskAccountabilityUpdates(
        req.body as Record<string, unknown>,
      );

      let requestedProjectIds: number[] | undefined;
      let requestedProjectLabel = project;
      if (typeof projectIds !== "undefined") {
        const parsedProjectIds = parsePositiveIdList(projectIds);
        if (!parsedProjectIds) {
          return res.status(400).json({
            error: "projectIds must be an array of positive integers",
          });
        }
        requestedProjectIds = parsedProjectIds;

        const availableProjects = getProjects();
        const availableProjectIds = new Set(
          availableProjects.map((candidate) => candidate.id),
        );
        for (const candidateId of requestedProjectIds) {
          if (!availableProjectIds.has(candidateId)) {
            return res
              .status(404)
              .json({ error: `project ${candidateId} not found` });
          }
        }

        requestedProjectLabel = buildTaskProjectLabel(
          requestedProjectIds,
          availableProjects,
          "General",
        );
      }

      const normalizedDueDate =
        typeof due_date === "string"
          ? due_date
          : typeof due_at === "string"
            ? due_at
            : undefined;

      if (column !== undefined && !isValidTaskColumn(column)) {
        return res.status(400).json({ error: "invalid column" });
      }

      // WIP Limit: max 10 tasks in Doing at a time
      const WIP_LIMIT = 10;
      if (column === "doing" && existingTask.column !== "doing") {
        const allTasks = await taskSyncLayer.listTasks();
        const doingCount = allTasks.filter((t) => t.column === "doing").length;
        if (doingCount >= WIP_LIMIT) {
          return res.status(409).json({
            error: "WIP Limit Reached",
            message: `Cannot move to Doing. Currently ${doingCount}/${WIP_LIMIT} tasks in Doing. Move existing tasks to Review/Done first.`,
            doingCount,
            limit: WIP_LIMIT,
          });
        }
      }

      if (typeof name === "string" && !name.trim()) {
        return res.status(400).json({ error: "name cannot be empty" });
      }

      const createAnywayOverride =
        normalizeBlockedInput(create_anyway) ??
        normalizeBlockedInput(dedupe_override) ??
        normalizeBlockedInput(createAnyway) ??
        false;
      const candidateName =
        typeof name === "string" ? name.trim() : existingTask.name;
      if (candidateName) {
        const allTasks = await taskSyncLayer.listTasks();
        const dedupeCandidates = findTaskDuplicateCandidates(
          candidateName,
          allTasks,
          { excludeTaskId: existingTask.id },
        );
        const exactDuplicate =
          dedupeCandidates.find((candidate) => candidate.exact) ?? null;
        if (!createAnywayOverride && dedupeCandidates.length > 0) {
          return res.status(409).json({
            error: exactDuplicate
              ? "Duplicate task title"
              : "Potential duplicate tasks found",
            message: exactDuplicate
              ? `An active task with the same normalized title already exists (#${exactDuplicate.task.id}).`
              : "Similar active tasks already exist. Merge or use create_anyway=true to keep this update.",
            duplicateType: exactDuplicate ? "exact" : "fuzzy",
            ...serializeDuplicateCandidates(candidateName, dedupeCandidates),
            allowCreateAnyway: true,
          });
        }
      }

      const nextColumn =
        typeof column === "string"
          ? column.trim().toLowerCase()
          : existingTask.column;
      const nextAssignee =
        typeof assignee === "string" ? assignee : existingTask.assignee;
      const nextExecutor =
        typeof accountabilityUpdates.executor_principal_id === "string"
          ? accountabilityUpdates.executor_principal_id
          : existingTask.executor_principal_id;
      const nextTaskmasterDrivable =
        typeof accountabilityUpdates.taskmaster_drivable === "boolean"
          ? accountabilityUpdates.taskmaster_drivable
          : Boolean(existingTask.taskmaster_drivable);
      const nextOwnerPrincipalType =
        typeof accountabilityUpdates.owner_principal_type === "string"
          ? accountabilityUpdates.owner_principal_type
          : existingTask.owner_principal_type;
      const existingTaskIsOwnerlessActive =
        isActiveTaskColumn(existingTask.column) &&
        !hasAssignedOwner(existingTask.assignee) &&
        !hasAssignedOwner(existingTask.executor_principal_id ?? null) &&
        !existingTask.taskmaster_drivable;
      const accountabilityCheck = validateTaskAccountability({
        column: nextColumn,
        assignee: nextAssignee,
        executor_principal_id: nextExecutor,
        taskmaster_drivable: nextTaskmasterDrivable,
        owner_principal_type: nextOwnerPrincipalType,
      });
      if (
        !accountabilityCheck.ok &&
        (!existingTaskIsOwnerlessActive ||
          assignee !== undefined ||
          column !== undefined ||
          Object.keys(accountabilityUpdates).length > 0)
      ) {
        return res.status(400).json({
          error: accountabilityCheck.error,
          message: accountabilityCheck.message,
        });
      }

      const movingToReview = shouldValidateReviewEntryOnTransition(
        existingTask.column,
        nextColumn,
      );
      const normalizedOutput = normalizeTaskOutputLinks(output) ?? undefined;
      if (movingToReview) {
        const reviewEntry = validateReviewEntry(
          metadata ?? existingTask.metadata,
        );
        if (!reviewEntry.ok) {
          return res.status(400).json({
            error: "Invalid review packet",
            message: reviewEntry.message ?? "Review packet failed validation.",
            review: reviewEntry.metadata,
          });
        }

        const reviewAssessment = await taskAgent.assessReview(
          buildTaskPreview({
            ...existingTask,
            name: typeof name === "string" ? name.trim() : existingTask.name,
            description: description ?? existingTask.description,
            brief: brief ?? existingTask.brief,
            origin_channel: origin_channel ?? existingTask.origin_channel,
            column: nextColumn,
            model: model ?? existingTask.model,
            assignee: nextAssignee,
            blocked: normalizeBlockedInput(blocked) ?? existingTask.blocked,
            blocker_reason:
              normalizeBlockerReasonInput(blocker_reason) ??
              existingTask.blocker_reason,
            due_date: normalizedDueDate ?? existingTask.due_date,
            priority: priority ?? existingTask.priority,
            estimate_hours: estimate_hours ?? existingTask.estimate_hours,
            time_spent: time_spent ?? existingTask.time_spent,
            output: normalizedOutput ?? existingTask.output,
            progress_status: progress_status ?? existingTask.progress_status,
            recurring:
              normalizeBlockedInput(recurring) ?? existingTask.recurring,
            recurring_config: recurring_config ?? existingTask.recurring_config,
            metadata: metadata ?? existingTask.metadata,
            created_at: existingTask.created_at,
            updated_at: existingTask.updated_at,
          }),
        );
        if (reviewAssessment.verdict === "INVALID") {
          return res.status(400).json({
            error: "Invalid review output",
            message: getPrimaryReviewReason(reviewAssessment),
            review: {
              verdict: reviewAssessment.verdict,
              score: reviewAssessment.score,
              taskType: reviewAssessment.taskType,
              evidenceStatus: reviewAssessment.evidenceStatus,
              reasons: reviewAssessment.reasons,
            },
          });
        }
      }

      const completionMetadata = metadata ?? existingTask.metadata;
      const movingToDone =
        nextColumn === "done" &&
        existingTask.column !== "done";
      if (movingToDone) {
        const reviewGateState = validateTaskDoneReviewGateState(existingTask);
        if (!reviewGateState.ok) {
          return res.status(reviewGateState.status).json({
            error: reviewGateState.code,
            message: reviewGateState.message,
          });
        }
      }
      if (movingToDone && isReviewGatedTask(completionMetadata)) {
        const completionCheck = validateReviewCompletion(
          { ...existingTask, metadata: completionMetadata },
          getTaskActorFromRequest(req),
        );
        if (!completionCheck.ok) {
          return res.status(400).json({
            error: "Invalid review completion",
            message:
              completionCheck.message ?? "Review completion failed validation.",
            review: completionCheck.metadata,
          });
        }
      }

      const taskUpdates = {
        name,
        description,
        column,
        assignee,
        ...accountabilityUpdates,
        blocked: normalizeBlockedInput(blocked),
        blocker_reason: normalizeBlockerReasonInput(blocker_reason),
        project: requestedProjectLabel,
        metadata,
        due_date: normalizedDueDate,
        priority,
        estimate_hours,
        time_spent,
        output: normalizedOutput,
        brief,
        origin_channel,
        progress_status,
        recurring: normalizeBlockedInput(recurring),
        recurring_config,
        model,
        worktype,
        policy_inputs_json,
      };

      let receiptArtifactId: string | null = null;
      let receiptContentHash: string | undefined;
      const task = movingToDone
        ? (await completeTaskWithReceipt(
            {
              previousTask: existingTask,
              nextTask: {
                ...existingTask,
                name: typeof name === "string" ? name.trim() : existingTask.name,
                description: description ?? existingTask.description,
                column: "done",
                assignee: nextAssignee ?? null,
                executor_principal_id: nextExecutor ?? null,
                assignment_state:
                  accountabilityUpdates.assignment_state ?? existingTask.assignment_state,
                metadata: completionMetadata,
                output: normalizedOutput ?? existingTask.output,
                project: requestedProjectLabel ?? existingTask.project,
              },
              actorPrincipalId: getTaskActorFromRequest(req),
              updates: taskUpdates,
            },
            {
              storageRoot: WORKSPACE,
              artifactRepository: evidenceArtifactRepository,
              activityRepository,
              updateTask: (taskId, updates) => taskSyncLayer.updateTask(taskId, updates),
            },
          ).then((result) => {
            receiptArtifactId = result.artifact.id;
            receiptContentHash = result.artifact.content_hash;
            return result.task;
          }))
        : await taskSyncLayer.updateTask(id, taskUpdates);

      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      let responseTask = task;
      if (requestedProjectIds !== undefined) {
        const currentProjectIds = getTaskProjects(task.id).map(
          (currentProject) => currentProject.id,
        );
        syncTaskProjectAssignments(
          task.id,
          currentProjectIds,
          requestedProjectIds,
          {
            addTaskProject,
            removeTaskProject,
          },
        );
        responseTask = (await taskSyncLayer.getTask(task.id)) ?? task;
      }

      const becameDone =
        existingTask.column !== "done" && responseTask.column === "done";
      const activityEvent = buildTaskMutationActivityEvent({
        action: "update",
        previousTask: existingTask,
        task: responseTask,
        actorPrincipalId: getTaskActorFromRequest(req),
      });
      const activityEventPayload = withReceiptArtifactRef(
        activityEvent.payload,
        receiptArtifactId,
        receiptContentHash,
      );
      logActivity({
        source: "task",
        type: becameDone ? "task_completed" : "task_updated",
        activityEventType: activityEvent.eventType,
        activityEventPayload: activityEventPayload,
        action: becameDone ? "Completed task" : "Updated task",
        description: `${responseTask.name} in ${capitalizeColumn(responseTask.column)}.`,
        agentName: responseTask.assignee || undefined,
        taskId: responseTask.id,
        taskColumn: responseTask.column,
        metadata: {
          taskName: responseTask.name,
          assignee: responseTask.assignee,
        },
      });
      broadcast({ type: "task:updated", task: responseTask });
      await pluginHooks.emit("task:updated", {
        previousTask: existingTask,
        task: responseTask,
      });

      if (AGENT_CONFIG.enabled) {
        const movedToReview =
          existingTask.column !== "review" && responseTask.column === "review";
        const missingOutputInReview =
          responseTask.column === "review" &&
          (!responseTask.output || !responseTask.output.trim());
        const activeWithoutOwner =
          isActiveTaskColumn(responseTask.column) &&
          !hasAssignedOwner(responseTask.assignee) &&
          !hasAssignedOwner(responseTask.executor_principal_id ?? null) &&
          !responseTask.taskmaster_drivable;
        if (movedToReview) {
          void taskAgent.handleTaskMovedToReview(responseTask).catch((err) => {
            const message =
              err instanceof Error ? err.message : "Unknown agent hook error";
            console.error("[TaskAgent] review_check hook failed:", message);
          });
        } else if (missingOutputInReview) {
          void taskAgent.handleOutputMissing(responseTask).catch((err) => {
            const message =
              err instanceof Error ? err.message : "Unknown agent hook error";
            console.error("[TaskAgent] output_missing hook failed:", message);
          });
        }

        if (activeWithoutOwner) {
          void taskAgent.handleOwnershipGap(responseTask).catch((err) => {
            const message =
              err instanceof Error ? err.message : "Unknown agent hook error";
            console.error("[TaskAgent] ownership_check hook failed:", message);
          });
        }
      }

      return res.json(responseTask);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  };

  app.put(`${tasksBase}/:id`, handleUpdateTask);
  app.patch(`${tasksBase}/:id`, handleUpdateTask);

  app.post(`${tasksBase}/:id/merge`, async (req, res) => {
    const targetTaskId = parseTaskId(req.params.id);
    if (!targetTaskId) {
      return res.status(400).json({ error: "invalid target task id" });
    }

    const sourceTaskId = parsePositiveId(
      req.body?.sourceTaskId ?? req.body?.source_task_id,
    );
    if (!sourceTaskId) {
      return res
        .status(400)
        .json({ error: "sourceTaskId must be a positive integer" });
    }

    if (sourceTaskId === targetTaskId) {
      return res
        .status(400)
        .json({ error: "source and target tasks must be different" });
    }

    try {
      const targetTask = await taskSyncLayer.getTask(targetTaskId);
      const sourceTask = await taskSyncLayer.getTask(sourceTaskId);
      if (!targetTask || !sourceTask) {
        return res.status(404).json({ error: "task not found" });
      }

      const mergeNote = buildMergeAuditNote(sourceTask, targetTask);
      const targetAuditComment = taskCommentRepository.createComment({
        task_id: targetTask.id,
        body: mergeNote,
        author: "Task Merge Bot",
      });

      const sourceComments = taskCommentRepository.listComments(sourceTask.id);
      let copiedComments = 0;
      for (const comment of sourceComments) {
        const copiedBody = `↪️ Merged from #${sourceTask.id} comment by ${comment.author || "unknown"}:\n${comment.body}`;
        taskCommentRepository.createComment({
          task_id: targetTask.id,
          body: copiedBody,
          author: "Task Merge Bot",
        });
        copiedComments += 1;
      }

      taskCommentRepository.createComment({
        task_id: sourceTask.id,
        body: `🔒 Archived after merge into #${targetTask.id}.`,
        author: "Task Merge Bot",
      });

      const archivedSource = await taskSyncLayer.updateTask(sourceTask.id, {
        archived: true,
        column: "done",
        blocked: false,
        blocker_reason: `Merged into #${targetTask.id}`,
      });

      if (!archivedSource) {
        return res
          .status(500)
          .json({ error: "failed to archive source task after merge" });
      }

      logActivity({
        source: "task",
        type: "task_updated",
        action: "Merged duplicate task",
        description: `Merged task #${sourceTask.id} into #${targetTask.id}.`,
        agentName: targetTask.assignee || undefined,
        taskId: targetTask.id,
        taskColumn: targetTask.column,
        metadata: { sourceTaskId: sourceTask.id, targetTaskId: targetTask.id },
      });

      logActivity({
        source: "task",
        type: "task_updated",
        action: "Archived via merge",
        description: `Archived duplicate task after merge into #${targetTask.id}.`,
        agentName: sourceTask.assignee || undefined,
        taskId: sourceTask.id,
        taskColumn: archivedSource.column,
        metadata: { sourceTaskId: sourceTask.id, targetTaskId: targetTask.id },
      });

      broadcast({
        type: "task:comment",
        taskId: targetTask.id,
        comment: targetAuditComment,
      });
      broadcast({ type: "task:updated", task: archivedSource });
      await pluginHooks.emit("task:updated", {
        previousTask: sourceTask,
        task: archivedSource,
      });

      return res.json({
        merged: true,
        targetTaskId: targetTask.id,
        sourceTaskId: sourceTask.id,
        copiedComments,
        sourceArchived: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.put(`${tasksBase}/:id/move`, async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const column = req.body?.column;
    if (!isValidTaskColumn(column)) {
      return res.status(400).json({ error: "valid column required" });
    }

    try {
      const existingTask = await taskSyncLayer.getTask(id);
      if (!existingTask) {
        return res.status(404).json({ error: "task not found" });
      }

      const accountabilityCheck = validateTaskAccountability({
        column,
        assignee: existingTask.assignee,
        executor_principal_id: existingTask.executor_principal_id,
        taskmaster_drivable: existingTask.taskmaster_drivable,
        owner_principal_type: existingTask.owner_principal_type,
      });
      if (!accountabilityCheck.ok) {
        return res.status(400).json({
          error: accountabilityCheck.error,
          message: accountabilityCheck.message,
        });
      }

      if (shouldValidateReviewEntryOnTransition(existingTask.column, column)) {
        const reviewEntry = validateReviewEntry(existingTask.metadata);
        if (!reviewEntry.ok) {
          return res.status(400).json({
            error: "Invalid review packet",
            message: reviewEntry.message ?? "Review packet failed validation.",
            review: reviewEntry.metadata,
          });
        }

        const reviewAssessment = await taskAgent.assessReview(
          buildTaskPreview({
            ...existingTask,
            column,
          }),
        );
        if (reviewAssessment.verdict === "INVALID") {
          return res.status(400).json({
            error: "Invalid review output",
            message: getPrimaryReviewReason(reviewAssessment),
            review: {
              verdict: reviewAssessment.verdict,
              score: reviewAssessment.score,
              taskType: reviewAssessment.taskType,
              evidenceStatus: reviewAssessment.evidenceStatus,
              reasons: reviewAssessment.reasons,
            },
          });
        }
      }

      if (
        column === "done" &&
        existingTask.column !== "done"
      ) {
        const reviewGateState = validateTaskDoneReviewGateState(existingTask);
        if (!reviewGateState.ok) {
          return res.status(reviewGateState.status).json({
            error: reviewGateState.code,
            message: reviewGateState.message,
          });
        }
      }

      if (
        column === "done" &&
        existingTask.column !== "done" &&
        isReviewGatedTask(existingTask.metadata)
      ) {
        const completionCheck = validateReviewCompletion(
          existingTask,
          getTaskActorFromRequest(req),
        );
        if (!completionCheck.ok) {
          return res.status(400).json({
            error: "Invalid review completion",
            message:
              completionCheck.message ?? "Review completion failed validation.",
            review: completionCheck.metadata,
          });
        }
      }

      let receiptArtifactId: string | null = null;
      let receiptContentHash: string | undefined;
      const task = column === "done" && existingTask.column !== "done"
        ? (await completeTaskWithReceipt(
            {
              previousTask: existingTask,
              nextTask: {
                ...existingTask,
                column: "done",
              },
              actorPrincipalId: getTaskActorFromRequest(req),
              updates: { column: "done" },
            },
            {
              storageRoot: WORKSPACE,
              artifactRepository: evidenceArtifactRepository,
              activityRepository,
              updateTask: (taskId, updates) => taskSyncLayer.updateTask(taskId, updates),
            },
          ).then((result) => {
            receiptArtifactId = result.artifact.id;
            receiptContentHash = result.artifact.content_hash;
            return result.task;
          }))
        : await taskSyncLayer.moveTask(id, column);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      const activityEvent = buildTaskMutationActivityEvent({
        action: "move",
        previousTask: existingTask,
        task,
        actorPrincipalId: getTaskActorFromRequest(req),
      });
      const activityEventPayload = withReceiptArtifactRef(
        activityEvent.payload,
        receiptArtifactId,
        receiptContentHash,
      );
      logActivity({
        source: "task",
        type: task.column === "done" ? "task_completed" : "task_moved",
        activityEventType: activityEvent.eventType,
        activityEventPayload: activityEventPayload,
        action: task.column === "done" ? "Completed task" : "Moved task",
        description: `${task.name} moved to ${capitalizeColumn(task.column)}.`,
        agentName: task.assignee || undefined,
        taskId: task.id,
        taskColumn: task.column,
        metadata: { taskName: task.name, assignee: task.assignee },
      });
      broadcast({ type: "task:moved", taskId: id, column: task.column });
      await pluginHooks.emit("task:moved", {
        previousTask: existingTask,
        task,
        taskId: id,
        fromColumn: existingTask.column,
        toColumn: task.column,
      });

      if (
        AGENT_CONFIG.enabled &&
        existingTask.column !== "review" &&
        task.column === "review"
      ) {
        void taskAgent.handleTaskMovedToReview(task).catch((err) => {
          const message =
            err instanceof Error ? err.message : "Unknown agent hook error";
          console.error("[TaskAgent] review_check hook failed:", message);
        });
      }

      return res.json(task);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.delete(`${tasksBase}/:id`, async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    try {
      const task = await taskSyncLayer.getTask(id);
      const deleted = await taskSyncLayer.deleteTask(id);
      if (!deleted) {
        return res.status(404).json({ error: "task not found" });
      }

      if (task) {
        const activityEvent = buildTaskMutationActivityEvent({
          action: "delete",
          task,
          actorPrincipalId: getTaskActorFromRequest(req),
        });
        logActivity({
          source: "task",
          type: "task_deleted",
          activityEventType: activityEvent.eventType,
          activityEventPayload: activityEvent.payload,
          action: "Deleted task",
          description: `${task.name} removed from ${capitalizeColumn(task.column)}.`,
          agentName: task.assignee || undefined,
          taskId: task.id,
          taskColumn: task.column,
          metadata: { taskName: task.name, assignee: task.assignee },
        });
      }
      broadcast({ type: "task:deleted", taskId: id });
      return res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${tasksBase}/:id/note`, async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const { note } = req.body as { note?: unknown; session_id?: unknown };
    if (typeof note !== "string" || !note.trim()) {
      return res.status(400).json({ error: "note required" });
    }

    try {
      const task = await taskSyncLayer.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      logActivity({
        source: "task",
        type: "task_updated",
        action: "Added note",
        description: note.trim().slice(0, 200),
        agentName: task.assignee || undefined,
        taskId: id,
      });

      const refreshed = await taskSyncLayer.getTask(id);
      if (!refreshed) {
        return res.status(404).json({ error: "task not found" });
      }

      return res.json(refreshed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.get(`${tasksBase}/:id/activity`, async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

    try {
      const activities = activityRepository.listActivitiesByTaskId(id, limit);
      return res.json(activities);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${tasksBase}/:id/activity`, async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const { action, user, details, type, session_id } = req.body as {
      action?: unknown;
      user?: unknown;
      details?: unknown;
      type?: unknown;
      session_id?: unknown;
    };

    if (typeof action !== "string" || !action.trim()) {
      return res.status(400).json({ error: "action required" });
    }

    // Skip raw tool_call logs — they spam the activity table (13K/day)
    if (action.trim() === "tool_call") {
      return res.json({ success: true, skipped: true });
    }

    if (typeof details !== "string" || !details.trim()) {
      return res.status(400).json({ error: "details required" });
    }

    try {
      const task = await taskSyncLayer.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      logActivity({
        source: "task",
        type: "task_updated",
        action: action.trim(),
        description: details.trim(),
        agentName:
          typeof user === "string" && user.trim()
            ? user
            : task.assignee || undefined,
        taskId: id,
        metadata: { user, session_id, activityType: type },
      });

      return res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${tasksBase}/:id/subtasks/auto`, async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const { force } = req.body as { force?: unknown };

    try {
      const parentTask = await taskSyncLayer.getTask(id);
      if (!parentTask) {
        return res.status(404).json({ error: "task not found" });
      }

      const existingTasks = await taskSyncLayer.listTasks();
      const existingSubtasks = existingTasks.filter(
        (entry) => readParentTaskId(entry.metadata) === id,
      );
      if (
        existingSubtasks.length > 0 &&
        normalizeBlockedInput(force) !== true
      ) {
        return res.status(409).json({
          error: "subtasks already exist",
          message: "Use force=true to generate additional subtasks.",
          existingCount: existingSubtasks.length,
          subtasks: existingSubtasks,
        });
      }

      const breakdown = deriveSubtaskBreakdown(parentTask);
      const createdSubtasks = [] as Awaited<
        ReturnType<typeof taskSyncLayer.createTask>
      >[];
      const defaultAssignee = parentTask.assignee ?? "Unassigned";
      const defaultColumn =
        parentTask.column === "done" ? "todo" : parentTask.column;

      for (const step of breakdown) {
        const subtask = await taskSyncLayer.createTask({
          name: step.length > 140 ? `${step.slice(0, 137)}...` : step,
          description: `Auto-generated subtask for #${parentTask.id}: ${parentTask.name}`,
          assignee: defaultAssignee,
          column: isValidTaskColumn(defaultColumn) ? defaultColumn : "todo",
          priority: parentTask.priority ?? "P2",
          model: parentTask.model ?? undefined,
          metadata: mergeTaskMetadataWithParentLink(null, parentTask.id),
        });
        createdSubtasks.push(subtask);
      }

      logActivity({
        source: "task",
        type: "task_updated",
        action: "Generated subtasks",
        description: `Auto-generated ${createdSubtasks.length} subtasks for #${parentTask.id}.`,
        agentName: parentTask.assignee || undefined,
        taskId: parentTask.id,
        taskColumn: parentTask.column,
        metadata: { subtaskIds: createdSubtasks.map((entry) => entry.id) },
      });

      for (const subtask of createdSubtasks) {
        broadcast({ type: "task:created", task: subtask });
      }

      const refreshedTasks = await taskSyncLayer.listTasks();
      const refreshedSubtasks = refreshedTasks.filter(
        (entry) => readParentTaskId(entry.metadata) === id,
      );
      return res.status(201).json({
        taskId: parentTask.id,
        createdCount: createdSubtasks.length,
        subtasks: refreshedSubtasks,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.get(`${tasksBase}/:id/comments`, async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    try {
      const task = await taskSyncLayer.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      const comments = taskCommentRepository.listComments(id);
      return res.json(comments);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${tasksBase}/:id/comments`, async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const { body, author, parent_id } = req.body as {
      body?: unknown;
      author?: unknown;
      parent_id?: unknown;
    };
    if (typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "body required" });
    }

    let parentId: number | null = null;
    if (typeof parent_id !== "undefined" && parent_id !== null) {
      const parsed = Number(parent_id);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return res.status(400).json({ error: "invalid parent_id" });
      }
      parentId = parsed;
    }

    try {
      const task = await taskSyncLayer.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      const comment = taskCommentRepository.createComment({
        task_id: id,
        body: body.trim(),
        author: typeof author === "string" ? author : undefined,
        parent_id: parentId,
      });

      logActivity({
        source: "task",
        type: "task_comment",
        action: "Added comment",
        description: body.trim().slice(0, 200),
        agentName:
          typeof author === "string" && author.trim()
            ? author
            : task?.assignee || undefined,
        taskId: id,
        metadata: { author, taskName: task?.name },
      });
      broadcast({ type: "task:comment", taskId: id, comment });

      // If the comment @mentions an agent, let the agent read the card and reply
      // (and optionally pick up the task). Fire-and-forget so the POST returns fast.
      void commentMentionResponder(id, comment);

      return res.status(201).json(comment);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });
}

function registerStrategicRoutes(prefix: "" | "/api") {
  const roadmapsBase = `${prefix}/roadmaps`;
  const roadmapItemsBase = `${prefix}/roadmap-items`;
  const projectsBase = `${prefix}/projects`;
  const tasksBase = `${prefix}/tasks`;

  registerCrewRoutes({
    app,
    prefix,
    getCrews,
    createCrew,
    subscribeToCrew,
    unsubscribeFromCrew,
    getSubscribersForCrew,
    getSubscriptionsForAgent,
    statusForError: statusForStrategicError,
  });

  app.get(roadmapsBase, (_req, res) => {
    try {
      const roadmaps = getRoadmaps();
      return res.json(roadmaps);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.post(roadmapsBase, (req, res) => {
    const { name, theme, color } = req.body as {
      name?: unknown;
      theme?: unknown;
      color?: unknown;
    };
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name required" });
    }

    if (
      typeof theme !== "undefined" &&
      theme !== null &&
      typeof theme !== "string"
    ) {
      return res.status(400).json({ error: "theme must be a string" });
    }

    if (
      typeof color !== "undefined" &&
      color !== null &&
      typeof color !== "string"
    ) {
      return res.status(400).json({ error: "color must be a string" });
    }

    try {
      const roadmap = createRoadmap({
        name,
        theme: typeof theme === "string" ? theme : undefined,
        color: typeof color === "string" ? color : undefined,
      });
      return res.status(201).json(roadmap);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.delete(`${roadmapsBase}/:id`, (req, res) => {
    const roadmapId = parsePositiveId(req.params.id);
    if (!roadmapId) {
      return res.status(400).json({ error: "invalid roadmap id" });
    }

    try {
      const deleted = deleteRoadmap(roadmapId);
      if (!deleted) {
        return res.status(404).json({ error: "roadmap not found" });
      }

      return res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.post(`${roadmapsBase}/:roadmapId/items`, (req, res) => {
    const roadmapId = parsePositiveId(req.params.roadmapId);
    if (!roadmapId) {
      return res.status(400).json({ error: "invalid roadmap id" });
    }

    const {
      title,
      description,
      priority,
      target_period,
      status,
      linked_task_id,
    } = req.body as {
      title?: unknown;
      description?: unknown;
      priority?: unknown;
      target_period?: unknown;
      status?: unknown;
      linked_task_id?: unknown;
    };

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title required" });
    }

    if (
      typeof description !== "undefined" &&
      description !== null &&
      typeof description !== "string"
    ) {
      return res.status(400).json({ error: "description must be a string" });
    }

    if (
      typeof priority !== "undefined" &&
      priority !== null &&
      typeof priority !== "string"
    ) {
      return res.status(400).json({ error: "priority must be a string" });
    }

    if (
      typeof target_period !== "undefined" &&
      target_period !== null &&
      typeof target_period !== "string"
    ) {
      return res.status(400).json({ error: "target_period must be a string" });
    }

    if (
      typeof status !== "undefined" &&
      status !== null &&
      typeof status !== "string"
    ) {
      return res.status(400).json({ error: "status must be a string" });
    }

    const linkedTaskId =
      typeof linked_task_id === "undefined" || linked_task_id === null
        ? null
        : parsePositiveId(linked_task_id);
    if (
      typeof linked_task_id !== "undefined" &&
      linked_task_id !== null &&
      !linkedTaskId
    ) {
      return res
        .status(400)
        .json({ error: "linked_task_id must be a positive integer" });
    }

    try {
      const roadmapItem = createRoadmapItem(roadmapId, {
        title,
        description: typeof description === "string" ? description : undefined,
        priority: typeof priority === "string" ? priority : undefined,
        target_period:
          typeof target_period === "string" ? target_period : undefined,
        status: typeof status === "string" ? status : undefined,
        linked_task_id: linkedTaskId,
      });
      return res.status(201).json(roadmapItem);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.patch(`${roadmapItemsBase}/:id`, (req, res) => {
    const roadmapItemId = parsePositiveId(req.params.id);
    if (!roadmapItemId) {
      return res.status(400).json({ error: "invalid roadmap item id" });
    }

    const body = req.body as {
      title?: unknown;
      description?: unknown;
      priority?: unknown;
      target_period?: unknown;
      status?: unknown;
      linked_task_id?: unknown;
    };
    const updates: UpdateRoadmapItemInput = {};
    let hasUpdates = false;

    if (typeof body.title !== "undefined") {
      if (typeof body.title !== "string") {
        return res.status(400).json({ error: "title must be a string" });
      }
      updates.title = body.title;
      hasUpdates = true;
    }

    if (typeof body.description !== "undefined") {
      if (body.description !== null && typeof body.description !== "string") {
        return res
          .status(400)
          .json({ error: "description must be a string or null" });
      }
      updates.description = body.description as string | null;
      hasUpdates = true;
    }

    if (typeof body.priority !== "undefined") {
      if (typeof body.priority !== "string") {
        return res.status(400).json({ error: "priority must be a string" });
      }
      updates.priority = body.priority;
      hasUpdates = true;
    }

    if (typeof body.target_period !== "undefined") {
      if (
        body.target_period !== null &&
        typeof body.target_period !== "string"
      ) {
        return res
          .status(400)
          .json({ error: "target_period must be a string or null" });
      }
      updates.target_period = body.target_period as string | null;
      hasUpdates = true;
    }

    if (typeof body.status !== "undefined") {
      if (typeof body.status !== "string") {
        return res.status(400).json({ error: "status must be a string" });
      }
      updates.status = body.status;
      hasUpdates = true;
    }

    if (typeof body.linked_task_id !== "undefined") {
      if (body.linked_task_id === null) {
        updates.linked_task_id = null;
        hasUpdates = true;
      } else {
        const linkedTaskId = parsePositiveId(body.linked_task_id);
        if (!linkedTaskId) {
          return res.status(400).json({
            error: "linked_task_id must be a positive integer or null",
          });
        }
        updates.linked_task_id = linkedTaskId;
        hasUpdates = true;
      }
    }

    if (!hasUpdates) {
      return res.status(400).json({ error: "no updates provided" });
    }

    try {
      const roadmapItem = updateRoadmapItem(roadmapItemId, updates);
      if (!roadmapItem) {
        return res.status(404).json({ error: "roadmap item not found" });
      }

      return res.json(roadmapItem);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.delete(`${roadmapItemsBase}/:id`, (req, res) => {
    const roadmapItemId = parsePositiveId(req.params.id);
    if (!roadmapItemId) {
      return res.status(400).json({ error: "invalid roadmap item id" });
    }

    try {
      const deleted = deleteRoadmapItem(roadmapItemId);
      if (!deleted) {
        return res.status(404).json({ error: "roadmap item not found" });
      }

      return res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.get(projectsBase, (_req, res) => {
    try {
      const projects = getProjects();
      return res.json(projects);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.post(projectsBase, (req, res) => {
    const { name, color } = req.body as { name?: unknown; color?: unknown };
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name required" });
    }

    if (
      typeof color !== "undefined" &&
      color !== null &&
      typeof color !== "string"
    ) {
      return res.status(400).json({ error: "color must be a string" });
    }

    try {
      const project = createProject({
        name,
        color: typeof color === "string" ? color : undefined,
      });
      return res.status(201).json(project);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.delete(`${projectsBase}/:id`, (req, res) => {
    const projectId = parsePositiveId(req.params.id);
    if (!projectId) {
      return res.status(400).json({ error: "invalid project id" });
    }

    try {
      const deleted = deleteProject(projectId);
      if (!deleted) {
        return res.status(404).json({ error: "project not found" });
      }

      return res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.get(`${tasksBase}/:taskId/projects`, async (req, res) => {
    const taskId = parseTaskId(req.params.taskId);
    if (!taskId) {
      return res.status(400).json({ error: "invalid task id" });
    }

    try {
      const task = await taskSyncLayer.getTask(taskId);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      const projects = getTaskProjects(taskId);
      return res.json(projects);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.post(`${tasksBase}/:taskId/projects`, async (req, res) => {
    const taskId = parseTaskId(req.params.taskId);
    if (!taskId) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const { project_id, projectIds } = req.body as {
      project_id?: unknown;
      projectIds?: unknown;
    };

    const task = await taskSyncLayer.getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: "task not found" });
    }

    const allProjectIds = new Set<number>(
      getProjects().map((project) => project.id),
    );

    if (typeof projectIds !== "undefined") {
      const parsedProjectIds = parsePositiveIdList(projectIds);
      if (!parsedProjectIds) {
        return res
          .status(400)
          .json({ error: "projectIds must be an array of positive integers" });
      }

      for (const candidateId of parsedProjectIds) {
        if (!allProjectIds.has(candidateId)) {
          return res
            .status(404)
            .json({ error: `project ${candidateId} not found` });
        }
      }

      try {
        const currentProjects = getTaskProjects(taskId);
        const currentIds = new Set(
          currentProjects.map((project) => project.id),
        );
        const nextIds = new Set(parsedProjectIds);

        for (const currentId of currentIds) {
          if (!nextIds.has(currentId)) {
            removeTaskProject(taskId, currentId);
          }
        }

        for (const nextId of nextIds) {
          if (!currentIds.has(nextId)) {
            addTaskProject(taskId, nextId);
          }
        }

        const projects = getTaskProjects(taskId);
        await taskSyncLayer.updateTask(taskId, {
          project: buildTaskProjectLabel(
            projects.map((project) => project.id),
            getProjects(),
            "General",
          ),
        });
        return res.json(projects);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return res
          .status(statusForStrategicError(message))
          .json({ error: message });
      }
    }

    const projectId = parsePositiveId(project_id);
    if (!projectId) {
      return res
        .status(400)
        .json({ error: "project_id must be a positive integer" });
    }

    if (!allProjectIds.has(projectId)) {
      return res.status(404).json({ error: "project not found" });
    }

    try {
      addTaskProject(taskId, projectId);
      const projects = getTaskProjects(taskId);
      await taskSyncLayer.updateTask(taskId, {
        project: buildTaskProjectLabel(
          projects.map((project) => project.id),
          getProjects(),
          "General",
        ),
      });
      return res.status(201).json(projects);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.delete(`${tasksBase}/:taskId/projects`, async (req, res) => {
    const taskId = parseTaskId(req.params.taskId);
    if (!taskId) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const projectId = parsePositiveId(req.body?.project_id);
    if (!projectId) {
      return res
        .status(400)
        .json({ error: "project_id must be a positive integer" });
    }

    try {
      const task = await taskSyncLayer.getTask(taskId);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      const removed = removeTaskProject(taskId, projectId);
      if (!removed) {
        return res.status(404).json({ error: "task project link not found" });
      }

      const projects = getTaskProjects(taskId);
      await taskSyncLayer.updateTask(taskId, {
        project: buildTaskProjectLabel(
          projects.map((project) => project.id),
          getProjects(),
          "General",
        ),
      });
      return res.json(projects);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.get(`${tasksBase}/:taskId/history`, async (req, res) => {
    const taskId = parseTaskId(req.params.taskId);
    if (!taskId) {
      return res.status(400).json({ error: "invalid task id" });
    }

    try {
      const task = await taskSyncLayer.getTask(taskId);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      const history = getTaskHistory(taskId);
      return res.json(history);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });
}

function registerDocumentRoutes(prefix: "" | "/api") {
  const base = `${prefix}/documents`;
  const documentsDb = getDocumentsDatabase();
  const allCapabilities = {
    read: true,
    write: true,
    rename: true,
    delete: true,
    list: true,
    search: true,
  };

  function toDocumentJsonValue(value: unknown): DocumentJsonValue {
    if (value === null) {
      return null;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => toDocumentJsonValue(entry));
    }

    if (typeof value === "object") {
      const normalized: { [key: string]: DocumentJsonValue } = {};
      for (const [key, entry] of Object.entries(
        value as Record<string, unknown>,
      )) {
        normalized[key] = toDocumentJsonValue(entry);
      }
      return normalized;
    }

    return null;
  }

  function parseStoredJson(
    value: unknown,
    fallback: DocumentJsonValue,
  ): DocumentJsonValue {
    if (value === null || typeof value === "undefined") {
      return fallback;
    }

    if (typeof value === "string") {
      try {
        return toDocumentJsonValue(JSON.parse(value) as unknown);
      } catch {
        return fallback;
      }
    }

    return toDocumentJsonValue(value);
  }

  function toBoolean(value: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return value !== 0;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return (
        normalized === "1" ||
        normalized === "true" ||
        normalized === "yes" ||
        normalized === "on"
      );
    }

    return false;
  }

  function toNumberOrNull(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  function toIntegerOffset(value: unknown): number | null {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      return null;
    }

    return value;
  }

  function parseRequiredRange(
    from: unknown,
    to: unknown,
  ): { from: number; to: number } | null {
    const parsedFrom = toIntegerOffset(from);
    const parsedTo = toIntegerOffset(to);
    if (parsedFrom === null || parsedTo === null || parsedTo < parsedFrom) {
      return null;
    }

    return { from: parsedFrom, to: parsedTo };
  }

  function parseDocumentId(rawDocId: unknown): ParsedDocumentId | null {
    if (typeof rawDocId !== "string") {
      return null;
    }

    const trimmed = rawDocId.trim();
    if (!trimmed) {
      return null;
    }

    const splitIndex = trimmed.indexOf(":");
    if (splitIndex < 0) {
      return {
        docId: `default:${trimmed}`,
        sourceId: "default",
        path: trimmed,
      };
    }

    const sourceIdRaw = trimmed.slice(0, splitIndex).trim();
    const pathRaw = trimmed.slice(splitIndex + 1).trim();
    if (!pathRaw) {
      return null;
    }

    const sourceId = sourceIdRaw || "default";
    return {
      docId: `${sourceId}:${pathRaw}`,
      sourceId,
      path: pathRaw,
    };
  }

  function parseRequiredDocId(
    req: express.Request,
    res: express.Response,
  ): ParsedDocumentId | null {
    const parsed = parseDocumentId(req.params.docId);
    if (!parsed) {
      res.status(400).json({ error: "invalid docId" });
      return null;
    }

    return parsed;
  }

  function getActorFromRequest(
    req: express.Request,
    fallback = "human",
  ): string {
    const header = req.header("X-Entity-Actor");
    if (typeof header !== "string") {
      return fallback;
    }

    const normalized = header.trim();
    return normalized || fallback;
  }

  function normalizeOptionalString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  function ensureSession(parts: ParsedDocumentId) {
    const existing = documentsDb
      .prepare("SELECT * FROM document_sessions WHERE doc_id = ? LIMIT 1")
      .get(parts.docId) as SqlRow | undefined;
    if (existing) {
      return mapSession(existing);
    }

    const id = randomUUID();
    documentsDb
      .prepare(
        `
        INSERT INTO document_sessions (id, doc_id, source_id, path, content_hash, version)
        VALUES (?, ?, ?, ?, NULL, 1)
      `,
      )
      .run(id, parts.docId, parts.sourceId, parts.path);

    const inserted = documentsDb
      .prepare("SELECT * FROM document_sessions WHERE id = ? LIMIT 1")
      .get(id) as SqlRow | undefined;
    if (!inserted) {
      throw new Error("Failed to create document session.");
    }

    return mapSession(inserted);
  }

  function mapSession(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      source_id: String(row.source_id ?? ""),
      path: String(row.path ?? ""),
      content_hash:
        row.content_hash === null ? null : String(row.content_hash ?? ""),
      version: Number(row.version ?? 1),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapAuthorshipRange(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      start_offset: Number(row.start_offset ?? 0),
      end_offset: Number(row.end_offset ?? 0),
      author: String(row.author ?? "unknown"),
      reviewed: toBoolean(row.reviewed),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapAuthorshipHistory(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      range_id: row.range_id === null ? null : String(row.range_id ?? ""),
      author: String(row.author ?? ""),
      diff_json: parseStoredJson(row.diff_json, {}),
      timestamp: String(row.timestamp ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapPresence(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      agent_id: String(row.agent_id ?? ""),
      status: String(row.status ?? "active"),
      cursor_json: parseStoredJson(row.cursor_json, {}),
      last_activity_at: String(row.last_activity_at ?? ""),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapComment(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      author: String(row.author ?? ""),
      start_offset: Number(row.start_offset ?? 0),
      end_offset: Number(row.end_offset ?? 0),
      selected_text:
        row.selected_text === null ? null : String(row.selected_text ?? ""),
      text: String(row.text ?? ""),
      resolved: toBoolean(row.resolved),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapCommentReply(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      comment_id: String(row.comment_id ?? ""),
      author: String(row.author ?? ""),
      text: String(row.text ?? ""),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapSuggestion(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      author: String(row.author ?? ""),
      type: String(row.type ?? "replace"),
      start_offset: Number(row.start_offset ?? 0),
      end_offset: Number(row.end_offset ?? 0),
      original_text: String(row.original_text ?? ""),
      suggested_text: String(row.suggested_text ?? ""),
      reason: row.reason === null ? null : String(row.reason ?? ""),
      status: String(row.status ?? "pending"),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapReviewRun(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      requested_by: String(row.requested_by ?? ""),
      mode: String(row.mode ?? "quick"),
      status: String(row.status ?? "pending"),
      result_json: parseStoredJson(row.result_json, null),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapReviewFinding(row: SqlRow) {
    const startOffset = toNumberOrNull(row.start_offset);
    const endOffset = toNumberOrNull(row.end_offset);
    let range: { from: number; to: number } | null = null;
    if (
      startOffset !== null &&
      endOffset !== null &&
      endOffset >= startOffset
    ) {
      range = { from: startOffset, to: endOffset };
    }

    const suggestedFixCandidate = parseStoredJson(row.suggested_fix_json, null);
    let suggestedFix: { replacement: string } | null = null;
    if (
      suggestedFixCandidate !== null &&
      typeof suggestedFixCandidate === "object" &&
      !Array.isArray(suggestedFixCandidate)
    ) {
      const replacement = (suggestedFixCandidate as Record<string, unknown>)
        .replacement;
      if (typeof replacement === "string") {
        suggestedFix = { replacement };
      }
    }

    const status = String(row.status ?? "open");
    return {
      id: String(row.id ?? ""),
      type: String(row.type ?? "issue"),
      severity: String(row.severity ?? "info"),
      message: String(row.message ?? ""),
      range,
      suggestedFix,
      status,
    };
  }

  function getSnapshot(docId: string) {
    const session = documentsDb
      .prepare("SELECT * FROM document_sessions WHERE doc_id = ? LIMIT 1")
      .get(docId) as SqlRow | undefined;

    const authorshipRanges = (
      documentsDb
        .prepare(
          "SELECT * FROM authorship_ranges WHERE doc_id = ? ORDER BY start_offset ASC, created_at ASC",
        )
        .all(docId) as SqlRow[]
    ).map(mapAuthorshipRange);

    const authorshipHistory = (
      documentsDb
        .prepare(
          "SELECT * FROM authorship_history WHERE doc_id = ? ORDER BY timestamp DESC, updated_at DESC",
        )
        .all(docId) as SqlRow[]
    ).map(mapAuthorshipHistory);

    const presence = (
      documentsDb
        .prepare(
          "SELECT * FROM document_presence WHERE doc_id = ? ORDER BY last_activity_at DESC, created_at ASC",
        )
        .all(docId) as SqlRow[]
    ).map(mapPresence);

    const comments = (
      documentsDb
        .prepare(
          "SELECT * FROM document_comments WHERE doc_id = ? ORDER BY created_at ASC",
        )
        .all(docId) as SqlRow[]
    ).map(mapComment);

    const replies = (
      documentsDb
        .prepare(
          "SELECT * FROM document_comment_replies WHERE doc_id = ? ORDER BY created_at ASC",
        )
        .all(docId) as SqlRow[]
    ).map(mapCommentReply);

    const suggestions = (
      documentsDb
        .prepare(
          "SELECT * FROM document_suggestions WHERE doc_id = ? ORDER BY created_at DESC",
        )
        .all(docId) as SqlRow[]
    ).map(mapSuggestion);

    const reviewRuns = (
      documentsDb
        .prepare(
          "SELECT * FROM document_review_runs WHERE doc_id = ? ORDER BY created_at DESC",
        )
        .all(docId) as SqlRow[]
    ).map(mapReviewRun);

    return {
      session: session ? mapSession(session) : undefined,
      authorship_ranges: authorshipRanges,
      authorship_history: authorshipHistory,
      presence,
      comments,
      comment_replies: replies,
      suggestions,
      review_runs: reviewRuns,
    };
  }

  function percent(part: number, total: number): number {
    if (total <= 0) {
      return 0;
    }

    return Number(((part / total) * 100).toFixed(2));
  }

  function buildAuthorshipStats(
    authorshipRanges: Array<ReturnType<typeof mapAuthorshipRange>>,
  ) {
    const byAuthor: Record<
      string,
      { ranges: number; reviewedRanges: number; coveredCharacters: number }
    > = {};
    let coveredCharacters = 0;
    let reviewedRanges = 0;

    for (const range of authorshipRanges) {
      const span = Math.max(0, range.end_offset - range.start_offset);
      coveredCharacters += span;
      if (range.reviewed) {
        reviewedRanges += 1;
      }

      if (!byAuthor[range.author]) {
        byAuthor[range.author] = {
          ranges: 0,
          reviewedRanges: 0,
          coveredCharacters: 0,
        };
      }

      byAuthor[range.author].ranges += 1;
      byAuthor[range.author].coveredCharacters += span;
      if (range.reviewed) {
        byAuthor[range.author].reviewedRanges += 1;
      }
    }

    return {
      totalRanges: authorshipRanges.length,
      reviewedRanges,
      reviewedPercent: percent(reviewedRanges, authorshipRanges.length),
      coveredCharacters,
      human: percent(byAuthor.human?.coveredCharacters ?? 0, coveredCharacters),
      ada: percent(byAuthor.ada?.coveredCharacters ?? 0, coveredCharacters),
      spock: percent(byAuthor.spock?.coveredCharacters ?? 0, coveredCharacters),
      scotty: percent(
        byAuthor.scotty?.coveredCharacters ?? 0,
        coveredCharacters,
      ),
      byAuthor,
    };
  }

  function buildCommentsSummary(
    comments: Array<ReturnType<typeof mapComment>>,
    replies: Array<ReturnType<typeof mapCommentReply>>,
  ) {
    const total = comments.length;
    const resolved = comments.reduce(
      (count, comment) => count + (comment.resolved ? 1 : 0),
      0,
    );
    return {
      total,
      resolved,
      open: Math.max(0, total - resolved),
      replies: replies.length,
    };
  }

  function buildSuggestionsSummary(
    suggestions: Array<ReturnType<typeof mapSuggestion>>,
  ) {
    const byType = {
      insert: 0,
      replace: 0,
      delete: 0,
      other: 0,
    };

    let open = 0;
    let accepted = 0;
    let rejected = 0;
    for (const suggestion of suggestions) {
      if (suggestion.status === "accepted") {
        accepted += 1;
      } else if (suggestion.status === "rejected") {
        rejected += 1;
      } else {
        open += 1;
      }

      if (
        suggestion.type === "insert" ||
        suggestion.type === "replace" ||
        suggestion.type === "delete"
      ) {
        byType[suggestion.type] += 1;
      } else {
        byType.other += 1;
      }
    }

    return {
      total: suggestions.length,
      open,
      accepted,
      rejected,
      byType,
    };
  }

  function buildReviewSummary(
    reviewRuns: Array<ReturnType<typeof mapReviewRun>>,
  ) {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const run of reviewRuns) {
      if (run.status === "pending") {
        pending += 1;
      } else if (run.status === "running") {
        running += 1;
      } else if (run.status === "completed") {
        completed += 1;
      } else if (run.status === "failed") {
        failed += 1;
      }
    }

    return {
      total: reviewRuns.length,
      pending,
      running,
      completed,
      failed,
      latestRun: reviewRuns[0] ?? null,
    };
  }

  function buildCommentsResponse(docId: string) {
    const comments = (
      documentsDb
        .prepare(
          "SELECT * FROM document_comments WHERE doc_id = ? ORDER BY created_at ASC",
        )
        .all(docId) as SqlRow[]
    ).map(mapComment);
    const replies = (
      documentsDb
        .prepare(
          "SELECT * FROM document_comment_replies WHERE doc_id = ? ORDER BY created_at ASC",
        )
        .all(docId) as SqlRow[]
    ).map(mapCommentReply);

    const repliesByComment = new Map<
      string,
      Array<ReturnType<typeof mapCommentReply>>
    >();
    for (const reply of replies) {
      const list = repliesByComment.get(reply.comment_id) ?? [];
      list.push(reply);
      repliesByComment.set(reply.comment_id, list);
    }

    const threads = comments.map((comment) => ({
      id: comment.id,
      range: {
        from: comment.start_offset,
        to: comment.end_offset,
      },
      text: comment.text,
      author: comment.author,
      createdAt: comment.created_at,
      selectedText: comment.selected_text,
      resolved: comment.resolved,
      replies: (repliesByComment.get(comment.id) ?? []).map((reply) => ({
        id: reply.id,
        author: reply.author,
        text: reply.text,
        createdAt: reply.created_at,
      })),
    }));

    return {
      docId,
      threads,
    };
  }

  function buildSuggestionsResponse(docId: string) {
    const suggestions = (
      documentsDb
        .prepare(
          "SELECT * FROM document_suggestions WHERE doc_id = ? ORDER BY created_at DESC",
        )
        .all(docId) as SqlRow[]
    ).map(mapSuggestion);

    return {
      docId,
      suggestions: suggestions.map((suggestion) => ({
        id: suggestion.id,
        range: {
          from: suggestion.start_offset,
          to: suggestion.end_offset,
        },
        originalText: suggestion.original_text,
        suggestedText: suggestion.suggested_text,
        author: suggestion.author,
        status: suggestion.status,
        type: suggestion.type,
        createdAt: suggestion.created_at,
        updatedAt: suggestion.updated_at,
        reason: suggestion.reason,
      })),
    };
  }

  function buildReviewRunResponse(docId: string, runId: string) {
    const run = documentsDb
      .prepare(
        "SELECT * FROM document_review_runs WHERE doc_id = ? AND id = ? LIMIT 1",
      )
      .get(docId, runId) as SqlRow | undefined;
    if (!run) {
      return null;
    }

    const findings = (
      documentsDb
        .prepare(
          "SELECT * FROM document_review_findings WHERE doc_id = ? AND run_id = ? ORDER BY created_at ASC",
        )
        .all(docId, runId) as SqlRow[]
    ).map(mapReviewFinding);

    return {
      docId,
      run: mapReviewRun(run),
      findings,
    };
  }

  function normalizeSuggestionType(value: unknown): string {
    if (typeof value !== "string") {
      return "replace";
    }

    const normalized = value.trim().toLowerCase();
    if (!DOCUMENT_SUGGESTION_TYPE_SET.has(normalized)) {
      return "replace";
    }

    return normalized;
  }

  function normalizePresenceStatus(
    value: unknown,
    fallback = "active",
  ): string {
    if (typeof value !== "string") {
      return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "disconnected") {
      return "offline";
    }

    if (!DOCUMENT_PRESENCE_STATUS_SET.has(normalized)) {
      return fallback;
    }

    return normalized;
  }

  function normalizeReviewMode(value: unknown): string {
    if (typeof value !== "string") {
      return "quick";
    }

    const normalized = value.trim().toLowerCase();
    if (DOCUMENT_REVIEW_MODE_SET.has(normalized)) {
      return normalized;
    }

    if (normalized === "style" || normalized === "grammar") {
      return "quick";
    }

    if (normalized === "technical") {
      return "deep";
    }

    return "quick";
  }

  app.get(base, (_req, res) => {
    res.json({
      status: "ok",
      feature: "entity.agent_native_editor",
      storage: "sqlite",
      openClawBaseUrl: OPENCLAW,
      routes: {
        health: "/api/documents/health",
        state: "/api/documents/:docId/state",
        edit: "/api/documents/:docId/edit",
        authorship: "/api/documents/:docId/authorship",
        cursor: "/api/documents/:docId/cursor",
        comments: "/api/documents/:docId/comments",
        suggestions: "/api/documents/:docId/suggestions",
        reviews: "/api/documents/:docId/reviews",
      },
    });
  });

  app.get(`${base}/health`, (_req, res) => {
    res.json({
      status: "ok",
      feature: "entity.agent_native_editor",
      storage: "sqlite",
      openClawBaseUrl: OPENCLAW,
    });
  });

  app.get(`${base}/:docId/state`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    try {
      const session = ensureSession(parts);
      const snapshot = getSnapshot(parts.docId);
      const commentsSummary = buildCommentsSummary(
        snapshot.comments,
        snapshot.comment_replies,
      );
      const suggestionsSummary = buildSuggestionsSummary(snapshot.suggestions);
      const reviewSummary = buildReviewSummary(snapshot.review_runs);
      const authorshipStats = buildAuthorshipStats(snapshot.authorship_ranges);

      res.json({
        docId: session.doc_id,
        contentRef: {
          docId: session.doc_id,
          sourceId: session.source_id,
          path: session.path,
          contentHash: session.content_hash,
        },
        sourceId: session.source_id,
        path: session.path,
        capabilities: allCapabilities,
        authorshipStats,
        presence: snapshot.presence,
        commentsSummary,
        suggestionsSummary,
        reviewSummary,
        version: session.version,
        collaboration: snapshot,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.get(`${base}/:docId/comments`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    try {
      ensureSession(parts);
      res.json(buildCommentsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/comments`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const range = parseRequiredRange(req.body?.from, req.body?.to);
    if (!range) {
      return res.status(400).json({
        error: "from/to must be valid non-negative offsets and to >= from",
      });
    }

    if (typeof req.body?.text !== "string" || !req.body.text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const selectedText = Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "selectedText",
    )
      ? normalizeOptionalString(req.body?.selectedText)
      : null;
    const author = getActorFromRequest(req, "human");

    try {
      ensureSession(parts);
      documentsDb
        .prepare(
          `
          INSERT INTO document_comments (
            id, doc_id, author, start_offset, end_offset, selected_text, text, resolved
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `,
        )
        .run(
          randomUUID(),
          parts.docId,
          author,
          range.from,
          range.to,
          selectedText,
          req.body.text.trim(),
        );
      return res.status(201).json(buildCommentsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/comments/:commentId/replies`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const commentId =
      typeof req.params.commentId === "string"
        ? req.params.commentId.trim()
        : "";
    if (!commentId) {
      return res.status(400).json({ error: "commentId is required" });
    }

    if (typeof req.body?.text !== "string" || !req.body.text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const author = getActorFromRequest(req, "human");

    try {
      ensureSession(parts);
      const comment = documentsDb
        .prepare(
          "SELECT id FROM document_comments WHERE doc_id = ? AND id = ? LIMIT 1",
        )
        .get(parts.docId, commentId) as SqlRow | undefined;
      if (!comment) {
        return res.status(404).json({ error: "comment not found" });
      }

      documentsDb
        .prepare(
          `
          INSERT INTO document_comment_replies (id, doc_id, comment_id, author, text)
          VALUES (?, ?, ?, ?, ?)
        `,
        )
        .run(
          randomUUID(),
          parts.docId,
          commentId,
          author,
          req.body.text.trim(),
        );
      return res.status(201).json(buildCommentsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/comments/:commentId/resolve`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const commentId =
      typeof req.params.commentId === "string"
        ? req.params.commentId.trim()
        : "";
    if (!commentId) {
      return res.status(400).json({ error: "commentId is required" });
    }

    if (typeof req.body?.resolved !== "boolean") {
      return res.status(400).json({ error: "resolved must be a boolean" });
    }

    try {
      ensureSession(parts);
      const result = documentsDb
        .prepare(
          `
          UPDATE document_comments
          SET resolved = ?, updated_at = datetime('now')
          WHERE doc_id = ? AND id = ?
        `,
        )
        .run(req.body.resolved ? 1 : 0, parts.docId, commentId);
      if (result.changes === 0) {
        return res.status(404).json({ error: "comment not found" });
      }

      return res.json(buildCommentsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.get(`${base}/:docId/suggestions`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    try {
      ensureSession(parts);
      return res.json(buildSuggestionsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/suggestions`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const range = parseRequiredRange(req.body?.from, req.body?.to);
    if (!range) {
      return res.status(400).json({
        error: "from/to must be valid non-negative offsets and to >= from",
      });
    }

    if (typeof req.body?.originalText !== "string") {
      return res.status(400).json({ error: "originalText is required" });
    }

    if (typeof req.body?.suggestedText !== "string") {
      return res.status(400).json({ error: "suggestedText is required" });
    }

    const author = getActorFromRequest(req, "human");
    const suggestionType = normalizeSuggestionType(req.body?.type);
    const reason = Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "reason",
    )
      ? normalizeOptionalString(req.body?.reason)
      : null;

    try {
      ensureSession(parts);
      documentsDb
        .prepare(
          `
          INSERT INTO document_suggestions (
            id, doc_id, author, type, start_offset, end_offset, original_text, suggested_text, reason, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `,
        )
        .run(
          randomUUID(),
          parts.docId,
          author,
          suggestionType,
          range.from,
          range.to,
          req.body.originalText,
          req.body.suggestedText,
          reason,
        );
      return res.status(201).json(buildSuggestionsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/suggestions/:suggestionId/accept`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const suggestionId =
      typeof req.params.suggestionId === "string"
        ? req.params.suggestionId.trim()
        : "";
    if (!suggestionId) {
      return res.status(400).json({ error: "suggestionId is required" });
    }

    try {
      ensureSession(parts);
      const result = documentsDb
        .prepare(
          `
          UPDATE document_suggestions
          SET status = 'accepted', updated_at = datetime('now')
          WHERE doc_id = ? AND id = ?
        `,
        )
        .run(parts.docId, suggestionId);
      if (result.changes === 0) {
        return res.status(404).json({ error: "suggestion not found" });
      }

      return res.json(buildSuggestionsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/suggestions/:suggestionId/reject`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const suggestionId =
      typeof req.params.suggestionId === "string"
        ? req.params.suggestionId.trim()
        : "";
    if (!suggestionId) {
      return res.status(400).json({ error: "suggestionId is required" });
    }

    try {
      ensureSession(parts);
      const result = documentsDb
        .prepare(
          `
          UPDATE document_suggestions
          SET status = 'rejected', updated_at = datetime('now')
          WHERE doc_id = ? AND id = ?
        `,
        )
        .run(parts.docId, suggestionId);
      if (result.changes === 0) {
        return res.status(404).json({ error: "suggestion not found" });
      }

      return res.json(buildSuggestionsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/reviews`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const mode = normalizeReviewMode(req.body?.mode);
    if (!DOCUMENT_REVIEW_MODE_SET.has(mode)) {
      return res
        .status(400)
        .json({ error: "mode must be quick, deep, or security" });
    }

    const requestedBy = getActorFromRequest(req, "human");
    const runId = randomUUID();
    const resultJson = JSON.stringify({ findings: [] });

    try {
      ensureSession(parts);
      documentsDb
        .prepare(
          `
          INSERT INTO document_review_runs (
            id, doc_id, requested_by, mode, status, result_json
          ) VALUES (?, ?, ?, ?, 'completed', ?)
        `,
        )
        .run(runId, parts.docId, requestedBy, mode, resultJson);

      const response = buildReviewRunResponse(parts.docId, runId);
      if (!response) {
        return res.status(500).json({ error: "failed to create review run" });
      }

      return res.status(201).json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.get(`${base}/:docId/reviews/:runId`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const runId =
      typeof req.params.runId === "string" ? req.params.runId.trim() : "";
    if (!runId) {
      return res.status(400).json({ error: "runId is required" });
    }

    try {
      ensureSession(parts);
      const response = buildReviewRunResponse(parts.docId, runId);
      if (!response) {
        return res.status(404).json({ error: "review run not found" });
      }

      return res.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(
    `${base}/:docId/reviews/:runId/findings/:findingId/apply`,
    (req, res) => {
      const parts = parseRequiredDocId(req, res);
      if (!parts) {
        return;
      }

      const runId =
        typeof req.params.runId === "string" ? req.params.runId.trim() : "";
      const findingId =
        typeof req.params.findingId === "string"
          ? req.params.findingId.trim()
          : "";
      if (!runId || !findingId) {
        return res
          .status(400)
          .json({ error: "runId and findingId are required" });
      }

      try {
        ensureSession(parts);
        const run = documentsDb
          .prepare(
            "SELECT id FROM document_review_runs WHERE doc_id = ? AND id = ? LIMIT 1",
          )
          .get(parts.docId, runId) as SqlRow | undefined;
        if (!run) {
          return res.status(404).json({ error: "review run not found" });
        }

        const result = documentsDb
          .prepare(
            `
          UPDATE document_review_findings
          SET status = 'applied'
          WHERE doc_id = ? AND run_id = ? AND id = ?
        `,
          )
          .run(parts.docId, runId, findingId);
        if (result.changes === 0) {
          return res.status(404).json({ error: "review finding not found" });
        }

        const response = buildReviewRunResponse(parts.docId, runId);
        if (!response) {
          return res.status(404).json({ error: "review run not found" });
        }

        return res.json(response);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return res.status(500).json({ error: message });
      }
    },
  );

  app.post(
    `${base}/:docId/reviews/:runId/findings/:findingId/ignore`,
    (req, res) => {
      const parts = parseRequiredDocId(req, res);
      if (!parts) {
        return;
      }

      const runId =
        typeof req.params.runId === "string" ? req.params.runId.trim() : "";
      const findingId =
        typeof req.params.findingId === "string"
          ? req.params.findingId.trim()
          : "";
      if (!runId || !findingId) {
        return res
          .status(400)
          .json({ error: "runId and findingId are required" });
      }

      try {
        ensureSession(parts);
        const run = documentsDb
          .prepare(
            "SELECT id FROM document_review_runs WHERE doc_id = ? AND id = ? LIMIT 1",
          )
          .get(parts.docId, runId) as SqlRow | undefined;
        if (!run) {
          return res.status(404).json({ error: "review run not found" });
        }

        const result = documentsDb
          .prepare(
            `
          UPDATE document_review_findings
          SET status = 'ignored'
          WHERE doc_id = ? AND run_id = ? AND id = ?
        `,
          )
          .run(parts.docId, runId, findingId);
        if (result.changes === 0) {
          return res.status(404).json({ error: "review finding not found" });
        }

        const response = buildReviewRunResponse(parts.docId, runId);
        if (!response) {
          return res.status(404).json({ error: "review run not found" });
        }

        return res.json(response);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return res.status(500).json({ error: message });
      }
    },
  );

  app.post(`${base}/:docId/edit`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const range = parseRequiredRange(req.body?.from, req.body?.to);
    if (!range) {
      return res.status(400).json({
        error: "from/to must be valid non-negative offsets and to >= from",
      });
    }

    if (typeof req.body?.insert !== "string") {
      return res.status(400).json({ error: "insert is required" });
    }

    const actorId = getActorFromRequest(req, "human");
    const attribution =
      normalizeOptionalString(req.body?.attribution) ?? actorId;
    const clientVersionRaw = req.body?.clientVersion;
    let clientVersion: number | null = null;
    if (typeof clientVersionRaw !== "undefined") {
      if (
        typeof clientVersionRaw !== "number" ||
        !Number.isInteger(clientVersionRaw) ||
        clientVersionRaw < 1
      ) {
        return res.status(400).json({
          error: "clientVersion must be a positive integer when provided",
        });
      }
      clientVersion = clientVersionRaw;
    }

    try {
      const session = ensureSession(parts);
      if (clientVersion !== null && clientVersion !== session.version) {
        return res.status(409).json({
          error: "version mismatch",
          version: session.version,
        });
      }

      const previousVersion = session.version;
      const nextVersion = previousVersion + 1;
      const contentHash = createHash("sha1")
        .update(
          JSON.stringify({
            docId: parts.docId,
            from: range.from,
            to: range.to,
            insert: req.body.insert,
            version: nextVersion,
          }),
        )
        .digest("hex");

      documentsDb
        .prepare(
          `
          UPDATE document_sessions
          SET version = ?, content_hash = ?, updated_at = datetime('now')
          WHERE doc_id = ?
        `,
        )
        .run(nextVersion, contentHash, parts.docId);

      const diffPayload = {
        operation: "edit",
        from: range.from,
        to: range.to,
        insert: req.body.insert,
        previousVersion,
        version: nextVersion,
        attribution,
        actorId,
      };
      documentsDb
        .prepare(
          `
          INSERT INTO authorship_history (
            id, doc_id, range_id, author, diff_json, timestamp, updated_at
          ) VALUES (?, ?, NULL, ?, ?, datetime('now'), datetime('now'))
        `,
        )
        .run(
          randomUUID(),
          parts.docId,
          attribution,
          JSON.stringify(diffPayload),
        );

      const updatedSession = documentsDb
        .prepare("SELECT * FROM document_sessions WHERE doc_id = ? LIMIT 1")
        .get(parts.docId) as SqlRow | undefined;
      if (!updatedSession) {
        return res
          .status(500)
          .json({ error: "document session not found after update" });
      }

      const mappedSession = mapSession(updatedSession);
      return res.json({
        docId: mappedSession.doc_id,
        actorId,
        attribution,
        sourceId: mappedSession.source_id,
        path: mappedSession.path,
        from: range.from,
        to: range.to,
        insert: req.body.insert,
        previousVersion,
        version: mappedSession.version,
        contentHash,
        contentLength: req.body.insert.length,
        updatedAt: mappedSession.updated_at,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/authorship`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const range = parseRequiredRange(req.body?.from, req.body?.to);
    if (!range) {
      return res.status(400).json({
        error: "from/to must be valid non-negative offsets and to >= from",
      });
    }

    if (typeof req.body?.author !== "string") {
      return res.status(400).json({ error: "author is required" });
    }

    const author = req.body.author.trim().toLowerCase();
    if (!AUTHOR_SET_VALID.has(author)) {
      return res.status(400).json({
        error:
          "author must be one of human, assistant, unknown",
      });
    }

    const actorId = getActorFromRequest(req, "human");
    try {
      ensureSession(parts);
      const existing = documentsDb
        .prepare(
          `
          SELECT * FROM authorship_ranges
          WHERE doc_id = ? AND start_offset = ? AND end_offset = ? AND author = ?
          LIMIT 1
        `,
        )
        .get(parts.docId, range.from, range.to, author) as SqlRow | undefined;

      let toggledOff = false;
      let mappedRange: ReturnType<typeof mapAuthorshipRange> | null = null;
      if (existing) {
        documentsDb
          .prepare("DELETE FROM authorship_ranges WHERE id = ?")
          .run(existing.id);
        documentsDb
          .prepare(
            `
            INSERT INTO authorship_history (id, doc_id, range_id, author, diff_json, timestamp, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `,
          )
          .run(
            randomUUID(),
            parts.docId,
            String(existing.id),
            author,
            JSON.stringify({
              operation: "remove_authorship_range",
              from: range.from,
              to: range.to,
              actorId,
            }),
          );
        toggledOff = true;
      } else {
        const rangeId = randomUUID();
        documentsDb
          .prepare(
            `
            INSERT INTO authorship_ranges (
              id, doc_id, start_offset, end_offset, author, reviewed
            ) VALUES (?, ?, ?, ?, ?, 0)
          `,
          )
          .run(rangeId, parts.docId, range.from, range.to, author);

        const inserted = documentsDb
          .prepare("SELECT * FROM authorship_ranges WHERE id = ? LIMIT 1")
          .get(rangeId) as SqlRow | undefined;
        mappedRange = inserted ? mapAuthorshipRange(inserted) : null;
        documentsDb
          .prepare(
            `
            INSERT INTO authorship_history (id, doc_id, range_id, author, diff_json, timestamp, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `,
          )
          .run(
            randomUUID(),
            parts.docId,
            rangeId,
            author,
            JSON.stringify({
              operation: "set_authorship_range",
              from: range.from,
              to: range.to,
              actorId,
            }),
          );
      }

      const snapshot = getSnapshot(parts.docId);
      return res.json({
        docId: parts.docId,
        actorId,
        from: range.from,
        to: range.to,
        author,
        toggledOff,
        range: mappedRange,
        authorshipStats: buildAuthorshipStats(snapshot.authorship_ranges),
        collaboration: snapshot,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/cursor`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const actorId = getActorFromRequest(req, "human");
    const status = normalizePresenceStatus(req.body?.status, "active");
    if (!DOCUMENT_PRESENCE_STATUS_SET.has(status)) {
      return res
        .status(400)
        .json({ error: "status must be active, idle, away, or offline" });
    }

    const payloadRecord: Record<string, DocumentJsonValue> = {};
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "cursor")) {
      payloadRecord.cursor = toDocumentJsonValue(req.body?.cursor);
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "position")) {
      payloadRecord.position = toDocumentJsonValue(req.body?.position);
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "selection")) {
      payloadRecord.selection = toDocumentJsonValue(req.body?.selection);
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "action")) {
      payloadRecord.action = toDocumentJsonValue(req.body?.action);
    }

    const cursorPayload: DocumentJsonValue =
      Object.keys(payloadRecord).length > 0 ? payloadRecord : null;

    try {
      ensureSession(parts);
      documentsDb
        .prepare(
          `
          INSERT INTO document_presence (
            id, doc_id, agent_id, status, cursor_json, last_activity_at
          ) VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(doc_id, agent_id) DO UPDATE SET
            status = excluded.status,
            cursor_json = excluded.cursor_json,
            last_activity_at = datetime('now'),
            updated_at = datetime('now')
        `,
        )
        .run(
          randomUUID(),
          parts.docId,
          actorId,
          status,
          cursorPayload === null ? null : JSON.stringify(cursorPayload),
        );

      const presenceRow = documentsDb
        .prepare(
          "SELECT * FROM document_presence WHERE doc_id = ? AND agent_id = ? LIMIT 1",
        )
        .get(parts.docId, actorId) as SqlRow | undefined;
      if (!presenceRow) {
        return res.status(500).json({ error: "presence update failed" });
      }

      const presence = mapPresence(presenceRow);
      return res.json({
        docId: parts.docId,
        actor: actorId,
        status: presence.status,
        heartbeatAt: presence.last_activity_at,
        presence,
      });
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
app.use("/worktype-registry", createWorktypeRegistryRouter());
app.use("/api/worktype-registry", createWorktypeRegistryRouter());
registerTaskRoutes("");
registerTaskRoutes("/api");
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
registerStrategicRoutes("");
registerStrategicRoutes("/api");
if (!AGENT_NATIVE_EDITOR_ENABLED) {
  registerDocumentRoutes("/api");
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
  if (documentsDb) {
    try {
      documentsDb.close();
      documentsDb = null;
    } catch {
      // best-effort close
    }
  }
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

server.listen(PORT, () => {
  console.log(`Entity server on port ${PORT}`);
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

  // Start file index runner — index all sources on boot, then every 15 minutes
  if (FS_INDEXER_ENABLED) {
    import("./fs/index-runner")
      .then(({ FileIndexRunner }) => {
        const indexRunner = new FileIndexRunner({ maxFilesPerSource: 10000 });
        console.log("[FileIndex] Starting initial index run...");
        indexRunner
          .runOnce()
          .then(() => {
            console.log("[FileIndex] Initial index complete");
          })
          .catch((err: unknown) => {
            console.error("[FileIndex] Initial index error:", err);
          });
        setInterval(
          () => {
            indexRunner.runOnce().catch((err: unknown) => {
              console.error("[FileIndex] Periodic index error:", err);
            });
          },
          15 * 60 * 1000,
        );
      })
      .catch((err: unknown) => {
        console.error("[FileIndex] Failed to load index runner:", err);
      });
  }

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
