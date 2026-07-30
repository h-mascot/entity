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
  updateRoadmapItem,
  validateTaskDoneReviewGateState,
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
} from "./agent";
import { createCommentMentionResponder } from "./agent/comment-responder";
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
import { runInferenceProviderMigrations } from "./provider-registry/migrations";
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
} from "./config/runtime";
import { registerDocsApiRoutes } from "./routes/docs";
import { createWorktypeRegistryRouter } from "./routes/worktype-registry";
import { createDocumentObjectRouter } from "./document-objects";
import { registerTtsRoutes } from "./routes/tts";
import { registerLegacyFileRoutes } from "./routes/legacy-files";
import { registerDocumentRoutes } from "./routes/documents";
import { closeDocumentsDatabase } from "./documents/db";
import { ensureDevDocumentsToken, shouldProvisionDevDocumentsToken } from "./editor/dev-token";
import { createAgentRegistryRouter } from "./routes/agent-registry";
import { createWorkspaceRouter } from "./routes/workspace";
import { createTaskReviewGateRouter } from "./routes/task-review-gates";
import { registerStrategicRoutes, registerTaskRoutes } from "./routes/tasks";
import {
  buildTaskPreview,
  createWorkspaceRelativePath,
  capitalizeColumn,
  deriveSubtaskBreakdown,
  enrichTasksWithSubtaskSummary,
  isValidTaskColumn,
  mergeTaskMetadataWithParentLink,
  normalizeBlockedInput,
  normalizeBlockerReasonInput,
  normalizeBooleanFlag,
  parsePositiveId,
  parseTaskId,
  parsePositiveIdList,
  readParentTaskId,
  getTaskActorFromRequest,
  statusForStrategicError,
  withReceiptArtifactRef,
} from "./routes/task-helpers";
import { registerAgentControlRoutes, registerAgentRegistryRoutes } from "./routes/agents";
import { registerActivityRoutes, registerDbModeRoutes, registerRuntimeRoutes } from "./routes/runtime";
import { registerDocIntelligenceRoutes } from "./routes/doc-intelligence";
import { registerOperationalStatusRoutes } from "./routes/operational-status";
import { registerSetupClawLeadRoutes } from "./routes/setupclaw";
import { createActivityLogger } from "./routes/activity-log";
import { registerFrontendStaticRoutes } from "./routes/frontend-static";
import { registerAgentMetricsRoute, registerCoreProbeRoutes, registerTestErrorRoute } from "./routes/core";
import { ensureSampleTasks } from "./routes/sample-tasks";
import { ensureSampleDocs } from "./routes/sample-docs";
import { createMigrationCleanupQueueRouter } from "./routes/migration-cleanup-queues";
import {
  phase2FlagEnabled,
  resolvePhase2Flags,
} from "./phase2-flags";
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
import { registerNodeOperationsRoutes } from "./node-operations";
import { registerDocHubTelemetryRoute } from "./doc-hub-telemetry";
import {
  setApiNoStoreHeaders,
} from "./static-cache";
import { createApiAuthMiddleware, createWsAuthHandler, isApiAuthEnabled } from "./middleware/api-auth";
import { assertSecureBindOrThrow } from "./middleware/bind-guard";
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
const HOST = process.env.HOST?.trim() || bootstrapConfig.server.host?.trim() || "127.0.0.1";
process.env.HOST = HOST;
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

registerCoreProbeRoutes(app, phase2Flags);
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


const terminalBridge = createTerminalBridge({
  workspaceRoot: WORKSPACE,
  targets: bootstrapConfig.terminal.targets,
});

registerTerminalRoutes(app, terminalBridge);
registerSetupClawLeadRoutes(app, {
  leadsDir: process.env.SETUPCLAW_LEADS_DIR || path.join(WORKSPACE, "output", "setupclaw-leads"),
});

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
const devDocumentsToken = ensureDevDocumentsToken({ logger: console });
const runtimeConfig = applyRuntimeConfigSeeds({ db: entityDb, fileSourceRepository });
const runtimeConfigBaseDir = path.dirname(process.env.ENTITY_CONFIG || path.resolve(process.cwd(), 'entity.config.yaml'));
ensurePluginSettingsTable(entityDb);
ensurePluginMigrationTable(entityDb);
runInferenceProviderMigrations({
  db: entityDb,
  logger: console,
});
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

function getDefaultTaskActor(): string {
  return (
    process.env.ENTITY_TASK_ACTOR?.trim() ||
    process.env.ENTITY_DEFAULT_ACTOR?.trim() ||
    "Human"
  );
}










const toWorkspaceRelativePath = createWorkspaceRelativePath(WORKSPACE);
const logActivity = createActivityLogger({ activityRepository, broadcast });


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

registerAgentRegistryRoutes(app, {
  agentRegistryRepo,
  moduleRegistryRepo,
  openClawBaseUrl: OPENCLAW,
  mentionTimeoutMs: MENTION_TIMEOUT_MS,
  logActivity,
  broadcast,
  toWorkspaceRelativePath,
});





const taskRouteDeps = {
  AGENT_CONFIG, WORKSPACE, broadcast, buildTaskPreview,
  deriveSubtaskBreakdown, evidenceArtifactRepository, isValidTaskColumn,
  mergeTaskMetadataWithParentLink, normalizeBlockerReasonInput,
  phase2FlagEnabled, phase2Flags, pluginHooks, withReceiptArtifactRef,
  registerCrewRoutes, createCrew, getCrews,
  getSubscribersForCrew, getSubscriptionsForAgent,
  subscribeToCrew, unsubscribeFromCrew,
  activityEventService, activityRepository, addTaskProject,
  buildMergeAuditNote, buildOwnerAccountabilityInbox,
  buildTaskMutationActivityEvent, buildTaskPaginationMeta, buildTaskProjectLabel,
  capitalizeColumn, commentMentionResponder, completeTaskWithReceipt,
  createProject, createRoadmap, createRoadmapItem,
  deleteProject, deleteRoadmap, deleteRoadmapItem,
  enrichTasksWithSubtaskSummary, findTaskDuplicateCandidates,
  getPrimaryReviewReason, getProjects, getRoadmaps,
  getTaskActorFromRequest: (req: Request) => getTaskActorFromRequest(req, getDefaultTaskActor()),
  getTaskHistory, getTaskProjects, hasAssignedOwner,
  isActiveTaskColumn, isReviewGatedTask, logActivity,
  normalizeBlockedInput, normalizeTaskOutputLinks, paginateTasks,
  parsePositiveId, parseTaskId, parsePositiveIdList,
  parseTaskAccountabilityForCreate, parseTaskAccountabilityUpdates,
  parseTaskPaginationQuery, readParentTaskId, removeTaskProject,
  shouldValidateReviewEntryOnTransition, statusForStrategicError,
  syncTaskProjectAssignments, taskAgent, taskCommentRepository,
  taskHasProjectName, taskSyncLayer, updateRoadmapItem,
  validateReviewCompletion, validateReviewEntry,
  validateTaskAccountability, validateTaskDoneReviewGateState,
};
registerDbModeRoutes(app, "", { normalizeDbMode, taskSyncLayer });
registerDbModeRoutes(app, "/api", { normalizeDbMode, taskSyncLayer });
registerRuntimeRoutes(app, "", {
  agentNativeEditorEnabled: AGENT_NATIVE_EDITOR_ENABLED,
  fsMultiSourceEnabled: FS_MULTISOURCE_ENABLED,
  devDocumentsToken,
  shouldExposeDevDocumentsToken: shouldProvisionDevDocumentsToken,
});
registerRuntimeRoutes(app, "/api", {
  agentNativeEditorEnabled: AGENT_NATIVE_EDITOR_ENABLED,
  fsMultiSourceEnabled: FS_MULTISOURCE_ENABLED,
  devDocumentsToken,
  shouldExposeDevDocumentsToken: shouldProvisionDevDocumentsToken,
});
registerAgentControlRoutes(app, "", { AGENT_CONFIG, parsePositiveId, taskAgent, taskSyncLayer });
registerAgentControlRoutes(app, "/api", { AGENT_CONFIG, parsePositiveId, taskAgent, taskSyncLayer });
registerDocIntelligenceRoutes(app, "");
registerDocIntelligenceRoutes(app, "/api");
app.use(createActivityEventRouter(activityEventService));
app.use("/api", createActivityEventRouter(activityEventService));
app.use(createTaskMasterClaimRouter(taskMasterClaimService));
app.use("/api", createTaskMasterClaimRouter(taskMasterClaimService));
registerActivityRoutes(app, "", { activityRepository });
registerActivityRoutes(app, "/api", { activityRepository });
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
registerDocHubTelemetryRoute(app);

const agentStatusInterval = registerOperationalStatusRoutes(app, {
  activityRepository,
  docsRoots: DOCS_ROOTS,
  runtimeConfig,
  runtimeConfigBaseDir,
});

registerTestErrorRoute(app);


registerFrontendStaticRoutes(app);

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
  void (async () => {
    try {
      await ensureSampleDocs();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[Seed] Failed to ensure sample docs:", message);
    }

    await ensureSampleTasks({ logActivity, taskSyncLayer });
  })();

  // Start Swarm self-healer - auto-recover stuck jobs
  import("./swarm/healer")
    .then(({ startHealer }) => {
      startHealer();
    })
    .catch((err: unknown) => {
      console.error("[Swarm] Failed to start healer:", err);
    });
});

registerAgentMetricsRoute(app);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error("[Express] Unhandled route error:", err);
  res.status(500).json({ error: message });
});
