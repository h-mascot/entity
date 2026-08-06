/**
 * Terra R1 — mandatory customer data-plane credential (composition-faithful HTTP proof).
 *
 * This is the canonical R1 regression. It boots the REAL production middleware
 * stack in composition order — `createApiAuthMiddleware` -> customer-principal
 * -> `createDataPlaneCredentialGuard` — plus REAL representative customer
 * data-plane routers (tasks, review gates, handoffs, document/evidence,
 * workspace, activity events, chat) and the REAL control-plane principal
 * router, all on an isolated temp SQLite DB. Only non-security tangentials are
 * stubbed, never on the authorization path.
 *
 * Invariant under test:
 *   - The deployment-wide `ENTITY_API_TOKEN` is TRANSPORT only. With API auth
 *     enabled, a request bearing ONLY the shared bearer is DENIED (403
 *     `customer_credential_required`) on every representative customer
 *     data-plane surface. The shared bearer never reaches customer data.
 *   - A valid, active, individually revocable `x-entity-access-token` PROCEEDS
 *     to route-level authorization.
 *   - An invalid / revoked / disabled / missing customer credential FAILS
 *     CLOSED (403 `customer_credential_invalid` / `customer_credential_required`)
 *     deterministically and never downgrades to the shared trusted identity.
 *   - The ONLY place the shared bearer + server-trusted principal still
 *     authorizes is the narrow control boundary `/api/admin` (PR #71/#72
 *     `createRequireAdminPrincipal`). It cannot reach the customer data plane.
 *   - Local dev (API auth disabled) remains usable (guard inert).
 *
 * Secrets are synthetic.
 */

import express from 'express';
import http from 'http';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiAuthMiddleware } from '../middleware/api-auth';
import { createCustomerPrincipalMiddleware } from '../principals/request-context';
import { createDataPlaneCredentialGuard } from '../middleware/data-plane-credential';
import { registerTaskRoutes } from '../routes/tasks';
import { createTaskReviewGateRouter } from '../routes/task-review-gates';
import { createTaskHandoffRouter } from '../routes/task-handoffs';
import { createDocumentObjectRouter } from '../document-objects';
import { createWorkspaceRouter } from '../routes/workspace';
import { createActivityEventRouter, createActivityEventService } from '../activity-events';
import { registerChatRoutes } from '../routes/chat';
import { registerPrincipalRoutes } from '../routes/principals';
import { registerCoreProbeRoutes } from '../routes/core';
import { createAccessTokenRepository } from '../../../db/src/access-tokens';
import { createPrincipalRepository } from '../../../db/src/principals';
import * as realHelpers from '../routes/task-helpers';
import { buildTaskMutationActivityEvent } from '../activity-events';
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

interface Fixture {
  baseUrl: string;
  apiToken: string;
  memberAcmeToken: string;
  globalAdminToken: string;
  acmeTaskId: number;
  server: http.Server;
  /** Revoke the member-acme token to exercise revocation fail-closed. */
  revokeMemberAcme: () => void;
  /** Disable the member-acme principal to exercise disabled fail-closed. */
  disableMemberAcme: () => void;
}

let server: http.Server | null = null;
const cleanupPaths: string[] = [];
const origApiToken = process.env.ENTITY_API_TOKEN;
const origPrincipal = process.env.ENTITY_API_PRINCIPAL_ID;

function tempDbPath(): string {
  return path.join(os.tmpdir(), `curacel-r1-${process.pid}-${randomUUID()}.sqlite`);
}
function removeSqliteFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(file, { force: true });
}
async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}
function bearerApi(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...extra };
}
function withCustomer(apiToken: string, customerToken: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${apiToken}`, 'x-entity-access-token': customerToken, ...extra };
}

function buildTaskDeps(dbModule: typeof import('../../../db/src'), taskSyncLayer: any, workspaceRepo: any, activityRepository: any, evidenceArtifactRepository: any) {
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
    createCrew: stub,
    getCrews: () => [],
    getSubscribersForCrew: () => [],
    getSubscriptionsForAgent: () => [],
    subscribeToCrew: stub,
    unsubscribeFromCrew: stub,
    activityEventService: { recordEvent: stub, listEvents: () => [] },
    activityRepository,
    addTaskProject: stub,
    buildMergeAuditNote: dedupe.buildMergeAuditNote,
    buildOwnerAccountabilityInbox: accountability.buildOwnerAccountabilityInbox,
    buildTaskMutationActivityEvent,
    buildTaskPaginationMeta: pagination.buildTaskPaginationMeta,
    buildTaskProjectLabel: taskProjects.buildTaskProjectLabel,
    capitalizeColumn: realHelpers.capitalizeColumn,
    commentMentionResponder: { respondIfMentioned: stub },
    completeTaskWithReceipt: undefined,
    createProject: stub,
    createRoadmap: stub,
    createRoadmapItem: stub,
    deleteProject: stub,
    deleteRoadmap: stub,
    deleteRoadmapItem: stub,
    deriveTaskWorkDomain: taskProjects.deriveTaskWorkDomain,
    enrichTasksWithSubtaskSummary: realHelpers.enrichTasksWithSubtaskSummary,
    findTaskDuplicateCandidates: dedupe.findTaskDuplicateCandidates,
    getPrimaryReviewReason,
    getProjects: () => [],
    getRoadmaps: () => [],
    getTaskActorFromRequest: (req: any) => realHelpers.getTaskActorFromRequest(req, 'Human'),
    getTaskHistory: () => [],
    getTaskProjects: () => [],
    hasAssignedOwner,
    isActiveTaskColumn,
    isReviewGatedTask,
    logActivity: () => undefined,
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
    taskCommentRepository: { listComments: () => [], addComment: stub },
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

async function bootApp(): Promise<Fixture> {
  const dbPath = tempDbPath();
  cleanupPaths.push(dbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', path.join(os.tmpdir(), `missing-${randomUUID()}`));
  vi.stubEnv('ENTITY_DB_MODE', 'LOCAL');

  const apiToken = `r1-${randomUUID()}`;
  process.env.ENTITY_API_TOKEN = apiToken;

  const dbModule = await import('../../../db/src');
  const { createTaskSyncLayer } = await import('../../../db/src/task-sync');

  const workspaceRepo = dbModule.createWorkspaceScopeRepository();
  const activityRepository = dbModule.createActivityRepository();
  const evidenceArtifactRepository = dbModule.createEvidenceArtifactRepository();
  const documentRepo = dbModule.createDocumentObjectRepository();
  const artifactRepo = dbModule.createEvidenceArtifactRepository();
  const handoffRepo = dbModule.createTaskHandoffRepository();
  const taskSyncLayer = createTaskSyncLayer();
  const principalRepo = createPrincipalRepository();
  const tokenRepo = createAccessTokenRepository();

  workspaceRepo.createOrg({ id: 'org-acme', name: 'Acme' });
  workspaceRepo.createOrg({ id: 'org-beta', name: 'Beta' });
  workspaceRepo.createTeam({ orgId: 'org-acme' }, { id: 'team-acme', name: 'Acme Claims' });

  principalRepo.createPrincipal({ id: 'member-acme', principal_type: 'human', display_name: 'Acme Member' });
  principalRepo.createGrant({ principal_id: 'member-acme', role: 'contributor', org_id: 'org-acme' });
  principalRepo.createPrincipal({ id: 'global-admin', principal_type: 'human', display_name: 'Global Admin' });
  principalRepo.createGrant({ principal_id: 'global-admin', role: 'admin' });
  // Server-trusted control-plane principal (PR #71/#72 binding), narrow to admin.
  principalRepo.createPrincipal({ id: 'svc-admin', principal_type: 'service_account', display_name: 'Service Admin' });
  principalRepo.createGrant({ principal_id: 'svc-admin', role: 'admin' });
  process.env.ENTITY_API_PRINCIPAL_ID = 'svc-admin';

  const memberAcmeCreated = tokenRepo.createToken({ principal_id: 'member-acme' });
  const memberAcmeToken = memberAcmeCreated.token;
  const globalAdminToken = tokenRepo.createToken({ principal_id: 'global-admin' }).token;

  const acmeTaskRepo = dbModule.createOrgScopedTaskRepository({ orgId: 'org-acme', teamId: 'team-acme' });
  const acmeTask = acmeTaskRepo.createTask({ name: 'Acme task', column: 'todo', assignee: 'agent-acme' } as any);

  const taskRouteDeps = buildTaskDeps(dbModule, taskSyncLayer, workspaceRepo, activityRepository, evidenceArtifactRepository);
  const activityEventService = createActivityEventService({
    activityRepository,
    getTask: (id: number) => taskSyncLayer.getTask(id),
  });

  const app = express();
  app.use(express.json());
  app.use(createApiAuthMiddleware());
  app.use(createCustomerPrincipalMiddleware(tokenRepo));
  app.use(createDataPlaneCredentialGuard());

  registerCoreProbeRoutes(app, {});

  registerTaskRoutes(app as any, '/api', taskRouteDeps as any);
  app.use('/api/tasks', createTaskReviewGateRouter({
    getTask: (id: number) => taskSyncLayer.getTask(id),
    updateTask: (id: number, updates: any) => taskSyncLayer.updateTask(id, updates),
    activityRepository,
    defaultActor: 'Human',
  }));
  app.use('/api/tasks', createTaskHandoffRouter({
    handoffRepo,
    taskStore: { getTask: (id: number) => taskSyncLayer.getTask(id) },
    resolveTargetAgent: () => true,
    defaultActor: 'system',
  }));
  app.use('/api/document-objects', createDocumentObjectRouter({ documentRepo, artifactRepo }));
  app.use('/api', createWorkspaceRouter({ workspaceRepo }));
  app.use('/api', createActivityEventRouter(activityEventService));
  registerChatRoutes({
    app,
    getTaskOrg: async (taskId) => (await taskSyncLayer.getTask(Number(taskId)))?.org_id ?? null,
  });
  // Control-plane principal management (server-trusted principal binding).
  registerPrincipalRoutes(app);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken,
    memberAcmeToken,
    globalAdminToken,
    acmeTaskId: acmeTask.id,
    server,
    revokeMemberAcme: () => { tokenRepo.revokeToken(memberAcmeCreated.record.id); },
    disableMemberAcme: () => { principalRepo.disablePrincipal('member-acme'); },
  };
}

describe('Terra R1 — mandatory customer data-plane credential (composition-faithful)', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('denies a shared-bearer-only request across every representative data-plane surface', async () => {
    const paths: Array<[string, string, 'GET' | 'POST' | 'PATCH', boolean]> = [
      ['task list', '/api/tasks', 'GET', false],
      ['task read', `/api/tasks/${f.acmeTaskId}`, 'GET', false],
      ['task create', '/api/tasks', 'POST', true],
      ['task mutate', `/api/tasks/${f.acmeTaskId}`, 'PATCH', true],
      ['task review', `/api/tasks/${f.acmeTaskId}/review/accept`, 'POST', true],
      ['task handoff', `/api/tasks/${f.acmeTaskId}/handoffs`, 'POST', true],
      ['document objects', '/api/document-objects', 'GET', false],
      ['evidence artifacts', '/api/document-objects/evidence-artifacts', 'GET', false],
      ['workspace orgs', '/api/orgs', 'GET', false],
      ['activity events', `/api/tasks/${f.acmeTaskId}/activity-events`, 'GET', false],
      ['chat channels', '/api/chat/channels', 'GET', false],
      ['chat messages', '/api/chat/channels/c-1/messages', 'GET', false],
    ];
    for (const [name, p, method, hasBody] of paths) {
      const res = await fetch(`${f.baseUrl}${p}`, {
        method,
        headers: { ...bearerApi(f.apiToken), 'content-type': 'application/json' },
        body: hasBody ? JSON.stringify({ name: 'x' }) : undefined,
      });
      expect(res.status, `${name} (${p}) should be denied`).toBe(403);
      expect((await readJson(res)).code).toBe('customer_credential_required');
    }
  });

  it('a valid customer credential PROCEEDS to route authorization (task list + workspace)', async () => {
    const tasks = await fetch(`${f.baseUrl}/api/tasks`, { headers: withCustomer(f.apiToken, f.memberAcmeToken) });
    expect(tasks.status).toBe(200);
    const list = (await readJson(tasks)).tasks as Array<{ org_id?: string }>;
    expect(list.every((t) => t.org_id === 'org-acme')).toBe(true);

    const orgs = await fetch(`${f.baseUrl}/api/orgs`, { headers: withCustomer(f.apiToken, f.memberAcmeToken) });
    expect(orgs.status).toBe(200);
  });

  it('a global-admin customer credential proceeds unrestricted across orgs', async () => {
    const res = await fetch(`${f.baseUrl}/api/tasks`, { headers: withCustomer(f.apiToken, f.globalAdminToken) });
    expect(res.status).toBe(200);
  });

  it('an INVALID customer credential fails closed (403) and never downgrades', async () => {
    const res = await fetch(`${f.baseUrl}/api/tasks`, {
      headers: withCustomer(f.apiToken, 'ect_not-a-real-token'),
    });
    expect(res.status).toBe(403);
    expect((await readJson(res)).code).toBe('customer_credential_invalid');
  });

  it('a REVOKED customer credential fails closed (403) and never downgrades', async () => {
    f.revokeMemberAcme();
    const res = await fetch(`${f.baseUrl}/api/tasks`, { headers: withCustomer(f.apiToken, f.memberAcmeToken) });
    expect(res.status).toBe(403);
    expect((await readJson(res)).code).toBe('customer_credential_invalid');
  });

  it('a DISABLED-principal customer credential fails closed (403) and never downgrades', async () => {
    f.disableMemberAcme();
    const res = await fetch(`${f.baseUrl}/api/tasks`, { headers: withCustomer(f.apiToken, f.memberAcmeToken) });
    expect(res.status).toBe(403);
    expect((await readJson(res)).code).toBe('customer_credential_invalid');
  });

  it('a MISSING customer credential on the data plane is denied (no silent trusted fallback)', async () => {
    // Shared bearer only — the deterministic fail-closed code for a missing
    // customer credential (vs. an invalid one above).
    const res = await fetch(`${f.baseUrl}/api/tasks`, { headers: bearerApi(f.apiToken) });
    expect(res.status).toBe(403);
    expect((await readJson(res)).code).toBe('customer_credential_required');
  });

  it('the shared bearer + server-trusted principal authorizes ONLY at /api/admin (narrow control boundary)', async () => {
    // Bearer-only on /api/admin/principals passes the data-plane guard
    // (control plane) and authorizes through the server-trusted principal
    // binding (svc-admin, global admin grant). This is the ONLY place the
    // shared bearer still authorizes.
    const admin = await fetch(`${f.baseUrl}/api/admin/principals`, { headers: bearerApi(f.apiToken) });
    expect(admin.status).toBe(200);
    const principals = ((await readJson(admin)).principals as Array<{ id: string }>).map((p) => p.id);
    expect(principals).toContain('svc-admin');

    // The same shared bearer CANNOT reach any representative customer surface.
    for (const p of ['/api/tasks', `/api/tasks/${f.acmeTaskId}`, '/api/orgs', '/api/chat/channels']) {
      const res = await fetch(`${f.baseUrl}${p}`, { headers: bearerApi(f.apiToken) });
      expect(res.status, p).toBe(403);
      expect((await readJson(res)).code).toBe('customer_credential_required');
    }
  });

  it('health and version remain public without any credential', async () => {
    const health = await fetch(`${f.baseUrl}/api/health`);
    expect(health.status).toBe(200);
    const version = await fetch(`${f.baseUrl}/api/version`);
    expect(version.status).toBe(200);
  });
});

describe('Terra R1 — local dev (API auth disabled) remains usable', () => {
  let localServer: http.Server | null = null;

  beforeEach(() => {
    delete process.env.ENTITY_API_TOKEN;
  });

  afterEach(async () => {
    if (localServer) {
      await new Promise<void>((r) => localServer!.close(() => r()));
      localServer = null;
    }
  });

  it('data-plane guard is inert: an unauthenticated task request proceeds', async () => {
    const app = express();
    app.use(express.json());
    app.use(createApiAuthMiddleware());
    app.use(createCustomerPrincipalMiddleware());
    app.use(createDataPlaneCredentialGuard());
    app.get('/api/tasks', (_req, res) => res.json({ tasks: [] }));

    localServer = http.createServer(app);
    await new Promise<void>((resolve) => localServer!.listen(0, '127.0.0.1', resolve));
    const port = (localServer.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/tasks`);
    expect(res.status).toBe(200);
  });
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
  for (const dbPath of cleanupPaths) removeSqliteFiles(dbPath);
  cleanupPaths.length = 0;
  if (origApiToken === undefined) delete process.env.ENTITY_API_TOKEN;
  else process.env.ENTITY_API_TOKEN = origApiToken;
  if (origPrincipal === undefined) delete process.env.ENTITY_API_PRINCIPAL_ID;
  else process.env.ENTITY_API_PRINCIPAL_ID = origPrincipal;
  vi.unstubAllEnvs();
});
