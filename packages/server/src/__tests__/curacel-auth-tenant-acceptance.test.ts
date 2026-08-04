/**
 * Curacel pilot — auth/tenant/acceptance repair (Terra B1–B5).
 *
 * Production-composed acceptance: this suite boots REAL middleware (api-auth +
 * customer-principal), REAL task routes (registerTaskRoutes on a REAL
 * taskSyncLayer backed by an isolated temp SQLite DB), the REAL review-gate
 * router (REAL getTask/updateTask + REAL activityRepository), the REAL handoff
 * router (REAL handoffRepo + REAL task store), and the REAL document/evidence
 * router (REAL repos). Principal resolution, tenant binding, task repositories,
 * review authorization, and handoff dependencies are NOT mocked.
 *
 * Only non-security tangential features (agent review assessment, crews,
 * roadmaps, project links, comment mentions) are stubbed, and never on the
 * authorization path. Two organizations and distinct per-customer credentials
 * are provisioned; the suite proves identity spoofing, role boundaries,
 * revocation/disable, and cross-tenant denial FAIL CLOSED with no durable
 * unauthorized mutation.
 *
 * This file is written to assert the FIXED behavior, so it is RED on the
 * pre-repair candidate and GREEN after the customer-principal + tenant
 * authorization guards are wired.
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
import {
  createAccessTokenRepository,
  ensureAccessTokensSchema,
} from '../../../db/src/access-tokens';
import {
  createPrincipalRepository,
  ensurePrincipalsSchema,
} from '../../../db/src/principals';
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
  tokens: {
    reviewerAcme: string;
    viewerAcme: string;
    approverAcme: string;
    memberAcme: string;
    memberBeta: string;
    globalAdmin: string;
  };
  ids: {
    reviewerAcme: string;
    viewerAcme: string;
    approverAcme: string;
    memberAcme: string;
    memberBeta: string;
    globalAdmin: string;
    svcAdmin: string;
  };
  org: { acme: string; beta: string; teamAcme: string; teamBeta: string };
  getAcmeTaskId: () => number;
  getBetaTaskId: () => number;
  acmeReviewableTaskId: () => number;
  server: http.Server;
}

let server: http.Server | null = null;
const cleanupPaths: string[] = [];
const originalToken = process.env.ENTITY_API_TOKEN;
const originalPrincipal = process.env.ENTITY_API_PRINCIPAL_ID;

function tempDbPath(): string {
  return path.join(os.tmpdir(), `curacel-auth-${process.pid}-${randomUUID()}.sqlite`);
}

function removeSqliteFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    fs.rmSync(file, { force: true });
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function authHeaders(apiToken: string, customerToken?: string, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${apiToken}` };
  if (customerToken) headers['x-entity-access-token'] = customerToken;
  return { ...headers, ...extra };
}

/**
 * Build a REAL task-route deps object: real task repository, real workspace
 * scope repo, real activity repo, real pure helpers. Only non-security
 * tangential services are stubbed (never on the authorization path exercised
 * by list/get/create(non-review)/update/move/delete).
 */
function buildRealTaskDeps(dbModule: typeof import('../../../db/src'), taskSyncLayer: any, workspaceRepo: any, activityRepository: any, evidenceArtifactRepository: any) {
  const noBroadcast = () => {};
  const stub = () => undefined;
  return {
    AGENT_CONFIG,
    WORKSPACE: os.tmpdir(),
    broadcast: noBroadcast,
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

  const apiToken = `pilot-${randomUUID()}`;
  process.env.ENTITY_API_TOKEN = apiToken;

  const dbModule = await import('../../../db/src');
  const { createTaskSyncLayer } = await import('../../../db/src/task-sync');

  // Real repositories on the isolated temp DB.
  const workspaceRepo = dbModule.createWorkspaceScopeRepository();
  const activityRepository = dbModule.createActivityRepository();
  const evidenceArtifactRepository = dbModule.createEvidenceArtifactRepository();
  const documentRepo = dbModule.createDocumentObjectRepository();
  const artifactRepo = dbModule.createEvidenceArtifactRepository();
  const handoffRepo = dbModule.createTaskHandoffRepository();
  const taskSyncLayer = createTaskSyncLayer();

  // Principals + access tokens share the same temp DB via getEntityDatabase.
  const principalRepo = createPrincipalRepository();
  const tokenRepo = createAccessTokenRepository();

  // Two organizations, two teams.
  workspaceRepo.createOrg({ id: 'org-acme', name: 'Acme' });
  workspaceRepo.createOrg({ id: 'org-beta', name: 'Beta' });
  workspaceRepo.createTeam({ orgId: 'org-acme' }, { id: 'team-acme', name: 'Acme Claims' });
  workspaceRepo.createTeam({ orgId: 'org-beta' }, { id: 'team-beta', name: 'Beta Claims' });

  // Principals + scoped grants.
  function mkPrincipal(id: string, display: string, type: 'human' | 'agent' | 'service_account' = 'human') {
    return principalRepo.createPrincipal({ id, principal_type: type, display_name: display });
  }
  mkPrincipal('reviewer-acme', 'Acme Reviewer');
  principalRepo.createGrant({ principal_id: 'reviewer-acme', role: 'manager', org_id: 'org-acme' });
  mkPrincipal('viewer-acme', 'Acme Viewer');
  principalRepo.createGrant({ principal_id: 'viewer-acme', role: 'viewer', org_id: 'org-acme' });
  mkPrincipal('approver-acme', 'Acme Approver');
  principalRepo.createGrant({ principal_id: 'approver-acme', role: 'manager', org_id: 'org-acme' });
  mkPrincipal('member-acme', 'Acme Member');
  principalRepo.createGrant({ principal_id: 'member-acme', role: 'contributor', org_id: 'org-acme' });
  mkPrincipal('member-beta', 'Beta Member');
  principalRepo.createGrant({ principal_id: 'member-beta', role: 'manager', org_id: 'org-beta' });
  mkPrincipal('global-admin', 'Global Admin');
  principalRepo.createGrant({ principal_id: 'global-admin', role: 'admin' });
  // Trusted service principal (PR #71/#72 path) — no customer token uses this.
  mkPrincipal('svc-admin', 'Service Admin', 'service_account');
  principalRepo.createGrant({ principal_id: 'svc-admin', role: 'admin' });
  process.env.ENTITY_API_PRINCIPAL_ID = 'svc-admin';

  function mkToken(pid: string): string {
    return tokenRepo.createToken({ principal_id: pid }).token;
  }
  const tokens = {
    reviewerAcme: mkToken('reviewer-acme'),
    viewerAcme: mkToken('viewer-acme'),
    approverAcme: mkToken('approver-acme'),
    memberAcme: mkToken('member-acme'),
    memberBeta: mkToken('member-beta'),
    globalAdmin: mkToken('global-admin'),
  };

  // Seed two tenant tasks directly through the real org-scoped repository so
  // review-gate eligibility (reviewer pool / approver) is genuine.
  const acmeTaskRepo = dbModule.createOrgScopedTaskRepository({ orgId: 'org-acme', teamId: 'team-acme' });
  const betaTaskRepo = dbModule.createOrgScopedTaskRepository({ orgId: 'org-beta', teamId: 'team-beta' });
  const policyInputs = {
    layers: {
      team: { reviewer_pool_principal_ids: ['reviewer-acme'] },
      project: { approver_principal_id: 'approver-acme' },
      task: { assignee_principal_id: 'agent-acme', submitted_by_principal_id: 'agent-acme' },
    },
  };
  const acmeReviewable = acmeTaskRepo.createTask({
    name: 'Acme reviewable claim',
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
  const betaTask = betaTaskRepo.createTask({
    name: 'Beta claim',
    column: 'todo',
    assignee: 'agent-beta',
  } as any);

  // Also one plain acme task for CRUD tests (no review gating).
  const acmePlain = acmeTaskRepo.createTask({
    name: 'Acme plain task',
    column: 'todo',
    assignee: 'agent-acme',
  } as any);

  const taskRouteDeps = buildRealTaskDeps(dbModule, taskSyncLayer, workspaceRepo, activityRepository, evidenceArtifactRepository);

  const app = express();
  app.use(express.json());
  app.use(createApiAuthMiddleware());
  app.use(createCustomerPrincipalMiddleware(tokenRepo));
  // Terra R1: centralized customer data-plane credential guard. The shared
  // bearer is TRANSPORT only; customer data-plane routes require a valid
  // x-entity-access-token. Mounted to mirror production composition.
  app.use(createDataPlaneCredentialGuard());
  registerTaskRoutes(app as any, '/api', taskRouteDeps as any);
  app.use('/api/tasks', createTaskReviewGateRouter({
    getTask: (id: number) => taskSyncLayer.getTask(id),
    updateTask: (id: number, updates: any) => taskSyncLayer.updateTask(id, updates),
    activityRepository,
    defaultActor: 'Human',
  }));
  app.use('/api', createTaskHandoffRouter({
    handoffRepo,
    taskStore: { getTask: (id: number) => taskSyncLayer.getTask(id) },
    resolveTargetAgent: () => true,
    defaultActor: 'system',
  }));
  app.use('/api/document-objects', createDocumentObjectRouter({ documentRepo, artifactRepo }));

  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken,
    tokens,
    ids: {
      reviewerAcme: 'reviewer-acme',
      viewerAcme: 'viewer-acme',
      approverAcme: 'approver-acme',
      memberAcme: 'member-acme',
      memberBeta: 'member-beta',
      globalAdmin: 'global-admin',
      svcAdmin: 'svc-admin',
    },
    org: { acme: 'org-acme', beta: 'org-beta', teamAcme: 'team-acme', teamBeta: 'team-beta' },
    getAcmeTaskId: () => acmePlain.id,
    getBetaTaskId: () => betaTask.id,
    acmeReviewableTaskId: () => acmeReviewable.id,
    server,
  };
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  if (originalToken === undefined) delete process.env.ENTITY_API_TOKEN;
  else process.env.ENTITY_API_TOKEN = originalToken;
  if (originalPrincipal === undefined) delete process.env.ENTITY_API_PRINCIPAL_ID;
  else process.env.ENTITY_API_PRINCIPAL_ID = originalPrincipal;
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const p of cleanupPaths) removeSqliteFiles(p);
  cleanupPaths.length = 0;
});

// ---------------------------------------------------------------------------
// B1: per-request customer principal; identity spoofing denied; revocation.
// ---------------------------------------------------------------------------

describe('B1 — per-request customer principal, spoofing denied, revocation', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('two customer credentials are distinct principals and ignore x-entity-principal-id/role spoofing', async () => {
    // member-acme lists tasks: spoofed identity headers must NOT change who the
    // caller is. The result set is scoped to the resolved principal's org.
    const spoofed = await fetch(`${f.baseUrl}/api/tasks`, {
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, {
        'x-entity-principal-id': 'member-beta',
        'x-entity-role': 'admin',
      }),
    });
    expect(spoofed.status).toBe(200);
    const body = await readJson(spoofed as any);
    const tasks = (body.tasks as any[]).map((t) => t.org_id);
    // Every returned task is in org-acme (member-acme's membership), never beta,
    // despite the spoofed member-beta principal header.
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((o) => o === 'org-acme')).toBe(true);
  });

  it('a presented but revoked access token is denied (fail closed), not degraded to shared identity', async () => {
    // Revoke member-acme's token out of band.
    const tokenRepo = createAccessTokenRepository();
    const records = tokenRepo.listTokensForPrincipal('member-acme');
    expect(records.length).toBe(1);
    expect(tokenRepo.revokeToken(records[0].id)).toBe(true);

    const res = await fetch(`${f.baseUrl}/api/tasks`, {
      headers: authHeaders(f.apiToken, f.tokens.memberAcme),
    });
    expect(res.status).toBe(403);
  });

  it('disabling the bound principal denies a still-live token', async () => {
    const principalRepo = createPrincipalRepository();
    principalRepo.disablePrincipal('member-acme');
    const res = await fetch(`${f.baseUrl}/api/tasks`, {
      headers: authHeaders(f.apiToken, f.tokens.memberAcme),
    });
    expect(res.status).toBe(403);
  });

  it('R1: denies a shared-bearer-only data-plane request (customer credential required)', async () => {
    // Terra R1: ENTITY_API_TOKEN is transport only. A request bearing only the
    // shared bearer (no x-entity-access-token) MUST be denied on the customer
    // data plane and never downgrade to the trusted-service identity. The
    // trusted service/admin path is preserved ONLY on the control plane
    // (admin/principal/setup), proven in curacel-r1-customer-dataplane-credential.
    const res = await fetch(`${f.baseUrl}/api/tasks`, {
      headers: { authorization: `Bearer ${f.apiToken}`, 'x-entity-org-id': 'org-acme' },
    });
    expect(res.status).toBe(403);
    expect((await readJson(res)).code).toBe('customer_credential_required');
  });
});

// ---------------------------------------------------------------------------
// B2: review / human-gate actor is server-derived; unauthorized impersonation denied.
// ---------------------------------------------------------------------------

describe('B2 — review & human-gate actor is server-derived', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('denies a review decision from an unauthorized member impersonating the reviewer via x-entity-actor', async () => {
    const taskId = f.acmeReviewableTaskId();
    const res = await fetch(`${f.baseUrl}/api/tasks/${taskId}/review/accept`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme, {
        'x-entity-actor': 'reviewer-acme',
        'content-type': 'application/json',
      }),
      body: JSON.stringify({ reason: 'try impersonation' }),
    });
    expect(res.status).toBe(403);
    // No durable mutation: review_state stays pending.
    const task = await taskSyncLayerGetTask(f, taskId);
    expect(task.review_state).toBe('pending');
  });

  it('accepts a review from the genuine eligible reviewer and records the server-resolved principal', async () => {
    const taskId = f.acmeReviewableTaskId();
    const res = await fetch(`${f.baseUrl}/api/tasks/${taskId}/review/accept`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.reviewerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ reason: 'evidence ok' }),
    });
    expect(res.status).toBe(200);
    const task = await taskSyncLayerGetTask(f, taskId);
    expect(task.review_state).toBe('accepted');
  });

  it('denies a human-gate approval from a non-approver impersonating approver-acme', async () => {
    const taskId = f.acmeReviewableTaskId();
    const res = await fetch(`${f.baseUrl}/api/tasks/${taskId}/human-gate/approve`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, {
        'x-entity-actor': 'approver-acme',
        'x-entity-actor-type': 'human',
        'content-type': 'application/json',
      }),
      body: JSON.stringify({ reason: 'try' }),
    });
    expect(res.status).toBe(403);
    const task = await taskSyncLayerGetTask(f, taskId);
    expect(task.human_gate_state).toBe('pending');
  });

  it('cross-tenant reviewer cannot decide an acme review even with a spoofed actor', async () => {
    const taskId = f.acmeReviewableTaskId();
    const res = await fetch(`${f.baseUrl}/api/tasks/${taskId}/review/accept`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, {
        'x-entity-actor': 'reviewer-acme',
        'content-type': 'application/json',
      }),
      body: JSON.stringify({ reason: 'cross-tenant' }),
    });
    expect([403, 404]).toContain(res.status);
    const task = await taskSyncLayerGetTask(f, taskId);
    expect(task.review_state).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// B3: tenant isolation of task CRUD across two orgs.
// ---------------------------------------------------------------------------

describe('B3 — task CRUD tenant isolation', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('lists only the caller membership org; cross-org tasks are invisible', async () => {
    const acme = await fetch(`${f.baseUrl}/api/tasks`, {
      headers: authHeaders(f.apiToken, f.tokens.memberAcme),
    });
    const beta = await fetch(`${f.baseUrl}/api/tasks`, {
      headers: authHeaders(f.apiToken, f.tokens.memberBeta),
    });
    expect(acme.status).toBe(200);
    expect(beta.status).toBe(200);
    const acmeOrgs = ((await readJson(acme as any)).tasks as any[]).map((t) => t.org_id);
    const betaOrgs = ((await readJson(beta as any)).tasks as any[]).map((t) => t.org_id);
    expect(acmeOrgs.every((o) => o === 'org-acme')).toBe(true);
    expect(betaOrgs.every((o) => o === 'org-beta')).toBe(true);
  });

  it('denies cross-org get of a task by guessed id', async () => {
    const betaId = f.getBetaTaskId();
    const res = await fetch(`${f.baseUrl}/api/tasks/${betaId}`, {
      headers: authHeaders(f.apiToken, f.tokens.memberAcme),
    });
    expect(res.status).toBe(404);
  });

  it('denies task creation in an org outside the caller membership', async () => {
    const res = await fetch(`${f.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'Cross-org attempt', org_id: 'org-beta', team_id: 'team-beta' }),
    });
    expect(res.status).toBe(403);
  });

  it('allows task creation within the caller membership org', async () => {
    const res = await fetch(`${f.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: 'Legit acme task',
        org_id: 'org-acme',
        team_id: 'team-acme',
        create_anyway: true,
        initiator_principal_id: 'member-acme',
        owner_principal_id: 'member-acme',
        owner_principal_type: 'human',
      }),
    });
    expect(res.status).toBe(201);
    const created = await readJson(res as any);
    expect((created as any).org_id ?? (created.task as any)?.org_id).toBe('org-acme');
  });

  it('denies cross-org update and move; no durable mutation', async () => {
    const acmeId = f.getAcmeTaskId();
    const before = await taskSyncLayerGetTask(f, acmeId);

    const upd = await fetch(`${f.baseUrl}/api/tasks/${acmeId}`, {
      method: 'PUT',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, { 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'hijacked by beta' }),
    });
    expect(upd.status).toBe(404);

    const after = await taskSyncLayerGetTask(f, acmeId);
    expect(after.name).toBe(before.name);
  });

  it('denies cross-org delete; task still exists', async () => {
    const acmeId = f.getAcmeTaskId();
    const del = await fetch(`${f.baseUrl}/api/tasks/${acmeId}`, {
      method: 'DELETE',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta),
    });
    expect(del.status).toBe(404);
    expect(await taskSyncLayerGetTask(f, acmeId)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// B2/B3: handoff actor server-derived + tenant isolation.
// ---------------------------------------------------------------------------

describe('B2/B3 — handoff actor & tenant isolation', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('cross-tenant caller cannot list handoffs for another org task', async () => {
    const acmeId = f.getAcmeTaskId();
    const res = await fetch(`${f.baseUrl}/api/tasks/${acmeId}/handoffs`, {
      headers: authHeaders(f.apiToken, f.tokens.memberBeta),
    });
    expect([403, 404]).toContain(res.status);
  });

  it('an acme member can list handoffs for an acme task (empty chain)', async () => {
    const acmeId = f.getAcmeTaskId();
    const res = await fetch(`${f.baseUrl}/api/tasks/${acmeId}/handoffs`, {
      headers: authHeaders(f.apiToken, f.tokens.memberAcme),
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// B4: document/evidence tenant scope is membership-derived, not caller-selected.
// ---------------------------------------------------------------------------

describe('B4 — document/evidence tenant scope membership-derived', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('creates a document in the caller membership org', async () => {
    const res = await fetch(`${f.baseUrl}/api/document-objects/native-documents`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ title: 'Acme memo', org_id: 'org-acme', content_hash: 'sha256:acme' }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects selecting another org via x-entity-org-id header', async () => {
    const res = await fetch(`${f.baseUrl}/api/document-objects/native-documents`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, {
        'content-type': 'application/json',
        'x-entity-org-id': 'org-beta',
      }),
      body: JSON.stringify({ title: 'Beta leak attempt', content_hash: 'sha256:leak' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects selecting another org via body org_id', async () => {
    const res = await fetch(`${f.baseUrl}/api/document-objects/native-documents`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ title: 'Beta leak via body', org_id: 'org-beta', content_hash: 'sha256:leak2' }),
    });
    expect(res.status).toBe(403);
  });
});

// Helper: read a task through a fresh task sync layer on the same temp DB.
async function taskSyncLayerGetTask(f: Fixture, id: number): Promise<any> {
  const { createTaskSyncLayer } = await import('../../../db/src/task-sync');
  const layer = createTaskSyncLayer();
  const task = await layer.getTask(id);
  if (!task) throw new Error(`task ${id} not found`);
  return task;
}
