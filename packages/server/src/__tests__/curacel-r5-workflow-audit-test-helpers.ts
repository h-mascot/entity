/**
 * Curacel pilot — R5 workflow-audit test composition helpers.
 *
 * Boots the REAL production middleware stack in composition order
 * (createApiAuthMiddleware -> createCustomerPrincipalMiddleware ->
 * createDataPlaneCredentialGuard) plus REAL task routes
 * (registerTaskRoutes + registerStrategicRoutes on a REAL taskSyncLayer
 * backed by an isolated temp SQLite DB), the REAL review-gate router,
 * the REAL handoff router, the REAL task-comment repository, the REAL
 * activity logger, and REAL project/history repositories. Principal
 * resolution, tenant binding, durable actor attribution, and task
 * repositories are NOT mocked. Only non-security tangentials are stubbed,
 * never on the authorization or attribution path.
 *
 * Extracted from curacel-r5-workflow-audit.test.ts to keep the proof file
 * focused. No assertion/auth weakening lives here — this is pure fixture
 * composition + durable-surface read helpers.
 */

import express from 'express';
import http from 'http';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, vi } from 'vitest';

import { createApiAuthMiddleware } from '../middleware/api-auth';
import { createCustomerPrincipalMiddleware } from '../principals/request-context';
import { createDataPlaneCredentialGuard } from '../middleware/data-plane-credential';
import { registerTaskRoutes, registerStrategicRoutes } from '../routes/tasks';
import { createActivityLogger } from '../routes/activity-log';
import { createTaskReviewGateRouter } from '../routes/task-review-gates';
import { createTaskHandoffRouter } from '../routes/task-handoffs';
import { createAccessTokenRepository } from '../../../db/src/access-tokens';
import { createPrincipalRepository } from '../../../db/src/principals';
import { buildTaskMutationActivityEvent } from '../activity-events';
import * as realHelpers from '../routes/task-helpers';
import * as pagination from '../task-pagination';
import * as dedupe from '../task-dedupe';
import * as taskProjects from '../task-projects';
import * as accountability from '../task-accountability';
import { normalizeTaskOutputLinks } from '../task-output-links';
import {
  AGENT_CONFIG,
  getPrimaryReviewReason,
  hasAssignedOwner,
  isActiveTaskColumn,
  isReviewGatedTask,
  shouldValidateReviewEntryOnTransition,
  validateReviewCompletion,
  validateReviewEntry,
} from '../agent';

export interface Fixture {
  baseUrl: string;
  apiToken: string;
  tokens: {
    memberAcme: string;
    reviewerAcme: string;
    approverAcme: string;
    viewerAcme: string;
    memberBeta: string;
  };
  org: { acme: string; beta: string; teamAcme: string; teamBeta: string };
  projectId: number;
  reviewableTaskId: number;
  handoffTargetTaskId: number;
  betaTaskId: number;
  taskCommentRepository: { listComments: (id: number) => any[] };
  activityRepository: { listActivitiesByTaskId: (id: number, limit?: number) => any[] };
  handoffRepo: { get: (orgId: string, id: string) => any };
  getTask: (id: number) => Promise<any>;
  /** Production durable task_history writer (same module instance the GET
   * /history route reads). Exposed so a test can seed a durable audit row. */
  addTaskHistory: (
    taskId: number,
    field: string,
    oldValue?: string | null,
    newValue?: string | null,
    changedBy?: string | null,
  ) => unknown;
  teardown: () => Promise<void>;
  server: http.Server;
}

// Captured once at helper load, before any test mutates the process env.
const ORIGINAL_API_TOKEN = process.env.ENTITY_API_TOKEN;
const ORIGINAL_API_PRINCIPAL = process.env.ENTITY_API_PRINCIPAL_ID;

function tempDbPath(): string {
  return path.join(os.tmpdir(), `curacel-r5-${process.pid}-${randomUUID()}.sqlite`);
}
function removeSqliteFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(file, { force: true });
}

export async function readJson(res: Response): Promise<any> {
  return (await res.json()) as any;
}

export function authHeaders(
  apiToken: string,
  customerToken?: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiToken}`,
    'content-type': 'application/json',
  };
  if (customerToken) headers['x-entity-access-token'] = customerToken;
  return { ...headers, ...extra };
}

// Spoofed durable-attribution fields appended to every write to prove ignored.
export const SPOOF: Record<string, string> = {
  'x-entity-actor': 'spoofed-actor',
  'x-entity-actor-type': 'human',
};
export function spoofBody(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    actor_principal_id: 'spoofed-actor',
    actorPrincipalId: 'spoofed-actor',
    actor: 'spoofed-actor',
    author: 'spoofed-author',
    user: 'spoofed-user',
    agent_name: 'spoofed-agent',
    ...extra,
  });
}

function buildTaskRouteDeps(
  dbModule: typeof import('../../../db/src'),
  taskSyncLayer: any,
  workspaceRepo: any,
  activityRepository: any,
  evidenceArtifactRepository: any,
  taskCommentRepository: any,
  logActivity: (input: any) => unknown,
) {
  const stub = () => undefined;
  return {
    AGENT_CONFIG,
    WORKSPACE: os.tmpdir(),
    broadcast: () => {},
    buildTaskPreview: realHelpers.buildTaskPreview,
    deriveSubtaskBreakdown: realHelpers.deriveSubtaskBreakdown,
    evidenceArtifactRepository,
    isValidTaskColumn: realHelpers.isValidTaskColumn,
    mergeTaskMetadataWithParentLink: realHelpers.mergeTaskMetadataWithParentLink,
    normalizeBlockerReasonInput: realHelpers.normalizeBlockerReasonInput,
    phase2FlagEnabled: () => false,
    phase2Flags: {},
    pluginHooks: { emit: stub, on: stub, registerModule: stub },
    withReceiptArtifactRef: realHelpers.withReceiptArtifactRef,
    registerCrewRoutes: stub,
    activityEventService: { recordEvent: stub, listEvents: () => [] },
    activityRepository,
    addTaskProject: stub,
    buildMergeAuditNote: dedupe.buildMergeAuditNote,
    buildOwnerAccountabilityInbox: accountability.buildOwnerAccountabilityInbox,
    buildTaskMutationActivityEvent,
    buildTaskPaginationMeta: pagination.buildTaskPaginationMeta,
    buildTaskProjectLabel: taskProjects.buildTaskProjectLabel,
    capitalizeColumn: realHelpers.capitalizeColumn,
    commentMentionResponder: async () => undefined,
    completeTaskWithReceipt: undefined,
    createProject: dbModule.createProject,
    createRoadmap: stub,
    createRoadmapItem: stub,
    deleteProject: dbModule.deleteProject,
    deleteRoadmap: stub,
    deleteRoadmapItem: stub,
    deriveTaskWorkDomain: taskProjects.deriveTaskWorkDomain,
    enrichTasksWithSubtaskSummary: realHelpers.enrichTasksWithSubtaskSummary,
    findTaskDuplicateCandidates: dedupe.findTaskDuplicateCandidates,
    getPrimaryReviewReason,
    getProjects: dbModule.getProjects,
    getRoadmaps: () => [],
    getTaskActorFromRequest: (req: any) => realHelpers.getTaskActorFromRequest(req, 'Human'),
    getTaskHistory: dbModule.getTaskHistory,
    getTaskProjects: () => [],
    hasAssignedOwner,
    isActiveTaskColumn,
    isReviewGatedTask,
    logActivity,
    normalizeBlockedInput: realHelpers.normalizeBlockedInput,
    normalizeTaskOutputLinks,
    paginateTasks: pagination.paginateTasks,
    parsePositiveId: realHelpers.parsePositiveId,
    parsePositiveIdList: realHelpers.parsePositiveIdList,
    parseTaskAccountabilityForCreate: accountability.parseTaskAccountabilityForCreate,
    parseTaskAccountabilityUpdates: accountability.parseTaskAccountabilityUpdates,
    parseTaskId: realHelpers.parseTaskId,
    parseTaskPaginationQuery: pagination.parseTaskPaginationQuery,
    readParentTaskId: realHelpers.readParentTaskId,
    removeTaskProject: stub,
    replaceTaskProjects: stub,
    shouldValidateReviewEntryOnTransition,
    statusForStrategicError: realHelpers.statusForStrategicError,
    syncTaskProjectAssignments: taskProjects.syncTaskProjectAssignments,
    taskAgent: { assessReview: async () => ({ verdict: 'VALID' }) },
    taskCommentRepository,
    taskHasProjectName: taskProjects.taskHasProjectName,
    taskSyncLayer,
    updateRoadmapItem: stub,
    validateReviewCompletion,
    validateReviewEntry,
    validateTaskAccountability: accountability.validateTaskAccountability,
    validateTaskDoneReviewGateState: dbModule.validateTaskDoneReviewGateState,
    workspaceRepo,
  };
}

function buildStrategicRouteDeps(dbModule: typeof import('../../../db/src'), taskSyncLayer: any) {
  const stub = () => undefined;
  return {
    createCrew: stub,
    createProject: dbModule.createProject,
    createRoadmap: stub,
    createRoadmapItem: stub,
    deleteProject: dbModule.deleteProject,
    deleteRoadmap: stub,
    deleteRoadmapItem: stub,
    getCrews: () => [],
    getProjects: dbModule.getProjects,
    getRoadmaps: () => [],
    getSubscribersForCrew: () => [],
    getSubscriptionsForAgent: () => [],
    getTaskHistory: dbModule.getTaskHistory,
    parsePositiveId: realHelpers.parsePositiveId,
    parsePositiveIdList: realHelpers.parsePositiveIdList,
    parseTaskId: realHelpers.parseTaskId,
    registerCrewRoutes: stub,
    statusForStrategicError: realHelpers.statusForStrategicError,
    subscribeToCrew: stub,
    taskSyncLayer,
    unsubscribeFromCrew: stub,
    updateRoadmapItem: stub,
  };
}

export async function bootApp(): Promise<Fixture> {
  const dbPath = tempDbPath();
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', path.join(os.tmpdir(), `missing-${randomUUID()}`));
  vi.stubEnv('ENTITY_DB_MODE', 'LOCAL');

  const apiToken = `r5-${randomUUID()}`;
  process.env.ENTITY_API_TOKEN = apiToken;

  const dbModule = await import('../../../db/src');
  const { createTaskSyncLayer } = await import('../../../db/src/task-sync');

  const workspaceRepo = dbModule.createWorkspaceScopeRepository();
  const activityRepository = dbModule.createActivityRepository();
  const evidenceArtifactRepository = dbModule.createEvidenceArtifactRepository();
  const taskCommentRepository = dbModule.createTaskCommentRepository();
  const handoffRepo = dbModule.createTaskHandoffRepository();
  const taskSyncLayer = createTaskSyncLayer();
  const logActivity = createActivityLogger({ activityRepository, broadcast: () => {} });

  const principalRepo = createPrincipalRepository();
  const tokenRepo = createAccessTokenRepository();

  workspaceRepo.createOrg({ id: 'org-acme', name: 'Acme' });
  workspaceRepo.createOrg({ id: 'org-beta', name: 'Beta' });
  workspaceRepo.createTeam({ orgId: 'org-acme' }, { id: 'team-acme', name: 'Acme Claims' });
  workspaceRepo.createTeam({ orgId: 'org-beta' }, { id: 'team-beta', name: 'Beta Claims' });

  const mkPrincipal = (
    id: string,
    display: string,
    type: 'human' | 'agent' | 'service_account' = 'human',
  ) => principalRepo.createPrincipal({ id, principal_type: type, display_name: display });
  mkPrincipal('member-acme', 'Acme Member');
  principalRepo.createGrant({ principal_id: 'member-acme', role: 'contributor', org_id: 'org-acme' });
  mkPrincipal('reviewer-acme', 'Acme Reviewer');
  principalRepo.createGrant({ principal_id: 'reviewer-acme', role: 'manager', org_id: 'org-acme' });
  mkPrincipal('approver-acme', 'Acme Approver');
  principalRepo.createGrant({ principal_id: 'approver-acme', role: 'manager', org_id: 'org-acme' });
  mkPrincipal('viewer-acme', 'Acme Viewer');
  principalRepo.createGrant({ principal_id: 'viewer-acme', role: 'viewer', org_id: 'org-acme' });
  mkPrincipal('member-beta', 'Beta Member');
  principalRepo.createGrant({ principal_id: 'member-beta', role: 'manager', org_id: 'org-beta' });
  mkPrincipal('svc-admin', 'Service Admin', 'service_account');
  principalRepo.createGrant({ principal_id: 'svc-admin', role: 'admin' });
  process.env.ENTITY_API_PRINCIPAL_ID = 'svc-admin';

  const mkToken = (pid: string) => tokenRepo.createToken({ principal_id: pid }).token;
  const tokens = {
    memberAcme: mkToken('member-acme'),
    reviewerAcme: mkToken('reviewer-acme'),
    approverAcme: mkToken('approver-acme'),
    viewerAcme: mkToken('viewer-acme'),
    memberBeta: mkToken('member-beta'),
  };

  const acmeTaskRepo = dbModule.createOrgScopedTaskRepository({ orgId: 'org-acme', teamId: 'team-acme' });
  const betaTaskRepo = dbModule.createOrgScopedTaskRepository({ orgId: 'org-beta', teamId: 'team-beta' });
  const acmeProject = dbModule.createProject({
    name: 'Acme Claims Project',
    org_id: 'org-acme',
    team_id: 'team-acme',
  });

  const policyInputs = {
    layers: {
      team: { reviewer_pool_principal_ids: ['reviewer-acme'] },
      project: { approver_principal_id: 'approver-acme' },
      task: { assignee_principal_id: 'agent-acme', submitted_by_principal_id: 'agent-acme' },
    },
  };
  const reviewable = acmeTaskRepo.createTask({
    name: 'Acme gated claim',
    column: 'review',
    assignee: 'agent-acme',
    review_required: true,
    review_state: 'pending',
    human_gate_required: true,
    human_gate_state: 'pending',
    policy_inputs_json: JSON.stringify(policyInputs),
    owner_principal_id: 'approver-acme',
    owner_principal_type: 'human',
    initiator_principal_id: 'agent-acme',
    initiator_type: 'agent',
    executor_principal_id: 'agent-acme',
    assignment_state: 'assigned',
    worktype: 'customer_success',
    risk_level: 'high',
    agent_trust_level: 'standard',
  } as any);
  const handoffTarget = acmeTaskRepo.createTask({
    name: 'Acme handoff target',
    column: 'todo',
    assignee: 'agent-acme',
  } as any);
  const betaTask = betaTaskRepo.createTask({ name: 'Beta claim', column: 'todo', assignee: 'agent-beta' } as any);

  const taskRouteDeps = buildTaskRouteDeps(
    dbModule,
    taskSyncLayer,
    workspaceRepo,
    activityRepository,
    evidenceArtifactRepository,
    taskCommentRepository,
    logActivity,
  );
  const strategicRouteDeps = buildStrategicRouteDeps(dbModule, taskSyncLayer);

  const app = express();
  app.use(express.json());
  app.use(createApiAuthMiddleware());
  app.use(createCustomerPrincipalMiddleware(tokenRepo));
  app.use(createDataPlaneCredentialGuard());
  registerTaskRoutes(app as any, '/api', taskRouteDeps as any);
  registerStrategicRoutes(app as any, '/api', strategicRouteDeps as any);
  app.use(
    '/api/tasks',
    createTaskReviewGateRouter({
      getTask: (id: number) => taskSyncLayer.getTask(id),
      updateTask: (id: number, updates: any) => taskSyncLayer.updateTask(id, updates),
      activityRepository,
      defaultActor: 'Human',
    }),
  );
  // Handoff router defines '/tasks/:taskId/handoffs'; mount at '/api' so the
  // intended client path '/api/tasks/:taskId/handoffs' is reachable (mirrors
  // the accepted curacel-auth-tenant-acceptance composition). The router's
  // actor-resolution + repository persistence is identical regardless of mount.
  app.use(
    '/api',
    createTaskHandoffRouter({
      handoffRepo,
      taskStore: { getTask: (id: number) => taskSyncLayer.getTask(id) },
      resolveTargetAgent: () => true,
      defaultActor: 'system',
    }),
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  const teardown = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (ORIGINAL_API_TOKEN === undefined) delete process.env.ENTITY_API_TOKEN;
    else process.env.ENTITY_API_TOKEN = ORIGINAL_API_TOKEN;
    if (ORIGINAL_API_PRINCIPAL === undefined) delete process.env.ENTITY_API_PRINCIPAL_ID;
    else process.env.ENTITY_API_PRINCIPAL_ID = ORIGINAL_API_PRINCIPAL;
    vi.unstubAllEnvs();
    vi.resetModules();
    removeSqliteFiles(dbPath);
  };

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken,
    tokens,
    org: { acme: 'org-acme', beta: 'org-beta', teamAcme: 'team-acme', teamBeta: 'team-beta' },
    projectId: acmeProject.id,
    reviewableTaskId: reviewable.id,
    handoffTargetTaskId: handoffTarget.id,
    betaTaskId: betaTask.id,
    taskCommentRepository,
    activityRepository,
    handoffRepo,
    getTask: async (id: number) => {
      const t = await taskSyncLayer.getTask(id);
      if (!t) throw new Error(`task ${id} not found`);
      return t;
    },
    addTaskHistory: dbModule.addTaskHistory,
    teardown,
    server,
  };
}

/** Find a durable activity for a task by canonical activity_event_type. */
export function findActivity(f: Fixture, taskId: number, eventType: string): any | undefined {
  return f.activityRepository.listActivitiesByTaskId(taskId).find((a) => a.activity_event_type === eventType);
}

/** Read the durable actor_principal_id from an activity event payload. */
export function activityActorPrincipalId(activity: any | undefined): unknown {
  if (!activity) return undefined;
  const raw = activity.activity_event_payload_json;
  if (typeof raw !== 'string') return undefined;
  try {
    return (JSON.parse(raw) as Record<string, unknown>)?.actor_principal_id;
  } catch {
    return undefined;
  }
}

/** Create an Acme workflow task as member-acme; returns the new task id. */
export async function createWorkflowTask(
  f: Fixture,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const res = await fetch(`${f.baseUrl}/api/tasks`, {
    method: 'POST',
    headers: authHeaders(f.apiToken, f.tokens.memberAcme),
    body: JSON.stringify({
      name,
      org_id: f.org.acme,
      team_id: f.org.teamAcme,
      create_anyway: true,
      initiator_principal_id: 'member-acme',
      owner_principal_id: 'member-acme',
      owner_principal_type: 'human',
      ...extra,
    }),
  });
  expect(res.status).toBe(201);
  return (await readJson(res)).id as number;
}
