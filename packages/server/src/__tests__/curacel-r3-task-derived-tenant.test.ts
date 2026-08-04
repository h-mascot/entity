/**
 * Curacel pilot — R3: tenant isolation of every task-DERIVED route (Terra R3).
 *
 * Production-composed regression: REAL middleware (api-auth + customer-
 * principal), REAL task routes (registerTaskRoutes + registerStrategicRoutes
 * on a REAL taskSyncLayer backed by an isolated temp SQLite DB), REAL task
 * comment / activity / history / project repositories, and a REAL activity
 * logger. Principal resolution and tenant binding are NOT mocked. Two orgs and
 * distinct per-customer credentials are provisioned.
 *
 * Proves EVERY task-derived route (note, activity GET/POST, subtasks/auto,
 * comments GET/POST, merge, projects GET/POST/DELETE, history) and EVERY
 * aggregate/list endpoint (duplicates, stale, owner-inbox) is tenant-
 * authorized: an org-A credential can neither read nor mutate org-B task-
 * derived data by guessed id nor enumerate it via global listings. Cross-org
 * denials leave durable state unchanged. The trusted service/admin path (no
 * customer token) is preserved.
 *
 * Asserts FIXED behavior -> RED pre-repair, GREEN post-repair.
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
import { registerTaskRoutes, registerStrategicRoutes } from '../routes/tasks';
import { createActivityLogger } from '../routes/activity-log';
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
import { createAccessTokenRepository } from '../../../db/src/access-tokens';
import { createPrincipalRepository } from '../../../db/src/principals';

interface Fixture {
  baseUrl: string;
  apiToken: string;
  tokens: { memberAcme: string; memberBeta: string; viewerAcme: string; globalAdmin: string };
  org: { acme: string; beta: string };
  acmeTaskA: number;
  acmeTaskB: number;
  betaTask: number;
  acmeDup: number;
  betaDup: number;
  acmeProjectId: number;
  taskCommentRepository: { listComments: (id: number) => unknown[] };
  activityRepository: { listActivitiesByTaskId: (id: number) => unknown[] };
  countSubtasks: (id: number) => Promise<number>;
  getTask: (id: number) => Promise<any>;
  server: http.Server;
}

let server: http.Server | null = null;
const cleanupPaths: string[] = [];
const originalToken = process.env.ENTITY_API_TOKEN;
const originalPrincipal = process.env.ENTITY_API_PRINCIPAL_ID;

function tempDbPath(): string {
  return path.join(os.tmpdir(), `curacel-r3-${process.pid}-${randomUUID()}.sqlite`);
}

function removeSqliteFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(file, { force: true });
}

async function readJson(res: Response): Promise<any> {
  return (await res.json()) as any;
}

function authHeaders(apiToken: string, customerToken?: string, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${apiToken}` };
  if (customerToken) headers['x-entity-access-token'] = customerToken;
  return { ...headers, ...extra };
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
    // Route does `void commentMentionResponder(id, comment)` -> must be callable.
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

async function bootApp(): Promise<Fixture> {
  const dbPath = tempDbPath();
  cleanupPaths.push(dbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', path.join(os.tmpdir(), `missing-${randomUUID()}`));
  vi.stubEnv('ENTITY_DB_MODE', 'LOCAL');

  const apiToken = `r3-${randomUUID()}`;
  process.env.ENTITY_API_TOKEN = apiToken;

  const dbModule = await import('../../../db/src');
  const { createTaskSyncLayer } = await import('../../../db/src/task-sync');

  const workspaceRepo = dbModule.createWorkspaceScopeRepository();
  const activityRepository = dbModule.createActivityRepository();
  const evidenceArtifactRepository = dbModule.createEvidenceArtifactRepository();
  const taskCommentRepository = dbModule.createTaskCommentRepository();
  const taskSyncLayer = createTaskSyncLayer();
  const logActivity = createActivityLogger({ activityRepository, broadcast: () => {} });

  const principalRepo = createPrincipalRepository();
  const tokenRepo = createAccessTokenRepository();

  workspaceRepo.createOrg({ id: 'org-acme', name: 'Acme' });
  workspaceRepo.createOrg({ id: 'org-beta', name: 'Beta' });
  workspaceRepo.createTeam({ orgId: 'org-acme' }, { id: 'team-acme', name: 'Acme Claims' });
  workspaceRepo.createTeam({ orgId: 'org-beta' }, { id: 'team-beta', name: 'Beta Claims' });

  const mkPrincipal = (id: string, display: string, type: 'human' | 'agent' | 'service_account' = 'human') =>
    principalRepo.createPrincipal({ id, principal_type: type, display_name: display });
  mkPrincipal('member-acme', 'Acme Member');
  principalRepo.createGrant({ principal_id: 'member-acme', role: 'contributor', org_id: 'org-acme' });
  mkPrincipal('member-beta', 'Beta Member');
  principalRepo.createGrant({ principal_id: 'member-beta', role: 'manager', org_id: 'org-beta' });
  mkPrincipal('viewer-acme', 'Acme Viewer');
  principalRepo.createGrant({ principal_id: 'viewer-acme', role: 'viewer', org_id: 'org-acme' });
  mkPrincipal('global-admin', 'Global Admin');
  principalRepo.createGrant({ principal_id: 'global-admin', role: 'admin' });
  mkPrincipal('svc-admin', 'Service Admin', 'service_account');
  principalRepo.createGrant({ principal_id: 'svc-admin', role: 'admin' });
  process.env.ENTITY_API_PRINCIPAL_ID = 'svc-admin';

  const mkToken = (pid: string) => tokenRepo.createToken({ principal_id: pid }).token;
  const tokens = {
    memberAcme: mkToken('member-acme'),
    memberBeta: mkToken('member-beta'),
    viewerAcme: mkToken('viewer-acme'),
    globalAdmin: mkToken('global-admin'),
  };

  const acmeTaskRepo = dbModule.createOrgScopedTaskRepository({ orgId: 'org-acme', teamId: 'team-acme' });
  const betaTaskRepo = dbModule.createOrgScopedTaskRepository({ orgId: 'org-beta', teamId: 'team-beta' });

  const acmeA = acmeTaskRepo.createTask({ name: 'Acme Task A', column: 'todo', assignee: 'agent-acme', owner_principal_id: 'owner-acme', owner_principal_type: 'human' } as any);
  const acmeB = acmeTaskRepo.createTask({ name: 'Acme Task B (merge source)', column: 'todo', assignee: 'agent-acme' } as any);
  const betaT = betaTaskRepo.createTask({ name: 'Beta Task', column: 'todo', assignee: 'agent-beta', owner_principal_id: 'owner-beta', owner_principal_type: 'human' } as any);
  const acmeD = acmeTaskRepo.createTask({ name: 'Tenant Duplicate Target', column: 'todo', assignee: 'agent-acme' } as any);
  const betaD = betaTaskRepo.createTask({ name: 'Tenant Duplicate Target', column: 'todo', assignee: 'agent-beta' } as any);

  taskCommentRepository.createComment({ task_id: acmeA.id, body: 'acme seeded comment', author: 'agent-acme' });
  taskCommentRepository.createComment({ task_id: betaT.id, body: 'beta seeded comment', author: 'agent-beta' });
  logActivity({ source: 'task', type: 'task_updated', action: 'Seeded', description: 'acme seeded activity', taskId: acmeA.id });
  logActivity({ source: 'task', type: 'task_updated', action: 'Seeded', description: 'beta seeded activity', taskId: betaT.id });

  const acmeProject = dbModule.createProject({ name: 'Acme Project', org_id: 'org-acme', team_id: 'team-acme' });

  const taskRouteDeps = buildTaskRouteDeps(dbModule, taskSyncLayer, workspaceRepo, activityRepository, evidenceArtifactRepository, taskCommentRepository, logActivity);
  const strategicRouteDeps = buildStrategicRouteDeps(dbModule, taskSyncLayer);

  const app = express();
  app.use(express.json());
  app.use(createApiAuthMiddleware());
  app.use(createCustomerPrincipalMiddleware(tokenRepo));
  registerTaskRoutes(app as any, '/api', taskRouteDeps as any);
  registerStrategicRoutes(app as any, '/api', strategicRouteDeps as any);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken,
    tokens,
    org: { acme: 'org-acme', beta: 'org-beta' },
    acmeTaskA: acmeA.id,
    acmeTaskB: acmeB.id,
    betaTask: betaT.id,
    acmeDup: acmeD.id,
    betaDup: betaD.id,
    acmeProjectId: acmeProject.id,
    taskCommentRepository,
    activityRepository,
    countSubtasks: async (id: number) => (await taskSyncLayer.listSubtasks(id)).length,
    getTask: async (id: number) => {
      const t = await taskSyncLayer.getTask(id);
      if (!t) throw new Error(`task ${id} not found`);
      return t;
    },
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
// R3-a: aggregate / list endpoints tenant-filtered before serialization.
// ---------------------------------------------------------------------------

describe('R3 — aggregate endpoints tenant-filtered (duplicates / stale / owner-inbox)', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('GET /duplicates returns only caller-org candidates, never cross-org', async () => {
    const url = `${f.baseUrl}/api/tasks/duplicates?title=${encodeURIComponent('Tenant Duplicate Target')}`;
    const acme = await fetch(url, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    const beta = await fetch(url, { headers: authHeaders(f.apiToken, f.tokens.memberBeta) });
    expect(acme.status).toBe(200);
    expect(beta.status).toBe(200);
    const acmeIds = ((await readJson(acme)).duplicates as any[]).map((d) => d.id);
    const betaIds = ((await readJson(beta)).duplicates as any[]).map((d) => d.id);
    expect(acmeIds).toContain(f.acmeDup);
    expect(acmeIds).not.toContain(f.betaDup);
    expect(betaIds).toContain(f.betaDup);
    expect(betaIds).not.toContain(f.acmeDup);
  });

  it('GET /stale returns only caller-org tasks, never cross-org', async () => {
    // Tiny threshold so freshly-created active tasks count as stale.
    const acme = await fetch(`${f.baseUrl}/api/tasks/stale?hours=${1e-9}`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    const beta = await fetch(`${f.baseUrl}/api/tasks/stale?hours=${1e-9}`, { headers: authHeaders(f.apiToken, f.tokens.memberBeta) });
    expect(acme.status).toBe(200);
    expect(beta.status).toBe(200);
    const acmeOrgs = ((await readJson(acme)).tasks as any[]).map((t) => t.org_id);
    const betaOrgs = ((await readJson(beta)).tasks as any[]).map((t) => t.org_id);
    expect(acmeOrgs.length).toBeGreaterThan(0);
    expect(acmeOrgs.every((o) => o === 'org-acme')).toBe(true);
    expect(betaOrgs.length).toBeGreaterThan(0);
    expect(betaOrgs.every((o) => o === 'org-beta')).toBe(true);
  });

  it('GET /owner-inbox reveals no cross-org owner tasks', async () => {
    // stalledHours is tiny so the freshly-seeded active task surfaces as
    // "stalled" for its genuine owner (the inbox only lists tasks needing
    // attention). A cross-org caller must still see nothing.
    const inboxUrl = `${f.baseUrl}/api/tasks/owner-inbox?ownerPrincipalId=owner-acme&stalledHours=${1e-9}`;
    const cross = await fetch(inboxUrl, { headers: authHeaders(f.apiToken, f.tokens.memberBeta) });
    const own = await fetch(inboxUrl, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(cross.status).toBe(200);
    expect(own.status).toBe(200);
    const crossBody = await readJson(cross);
    const ownBody = await readJson(own);
    expect(crossBody.total).toBe(0);
    expect(crossBody.items).toEqual([]);
    expect(ownBody.total).toBeGreaterThanOrEqual(1);
    expect((ownBody.items as any[]).some((i) => i.task.id === f.acmeTaskA)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R3-b: task-derived READS authorize the loaded parent task first.
// ---------------------------------------------------------------------------

describe('R3 — task-derived reads deny cross-org, allow same-org', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('GET /:id/activity denies cross-org (404) and returns activity same-org', async () => {
    const cross = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/activity`, { headers: authHeaders(f.apiToken, f.tokens.memberBeta) });
    const own = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/activity`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(cross.status).toBe(404);
    expect(own.status).toBe(200);
    const activities = await readJson(own);
    expect(Array.isArray(activities)).toBe(true);
    expect(activities.length).toBeGreaterThan(0);
  });

  it('GET /:id/comments denies cross-org (404) and returns comments same-org', async () => {
    const cross = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/comments`, { headers: authHeaders(f.apiToken, f.tokens.memberBeta) });
    const own = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/comments`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(cross.status).toBe(404);
    expect(own.status).toBe(200);
    const comments = await readJson(own);
    expect((comments as any[]).some((c) => c.body === 'acme seeded comment')).toBe(true);
  });

  it('GET /:taskId/projects denies cross-org (404) and returns projects same-org', async () => {
    const cross = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/projects`, { headers: authHeaders(f.apiToken, f.tokens.memberBeta) });
    const own = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/projects`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(cross.status).toBe(404);
    expect(own.status).toBe(200);
  });

  it('GET /:taskId/history denies cross-org (404) and returns history same-org', async () => {
    const cross = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/history`, { headers: authHeaders(f.apiToken, f.tokens.memberBeta) });
    const own = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/history`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(cross.status).toBe(404);
    expect(own.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// R3-c: task-derived MUTATIONS authorize before any durable write.
// ---------------------------------------------------------------------------

describe('R3 — task-derived mutations deny cross-org with no durable change', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('POST /:id/note denies cross-org (404), no activity written; same-org ok', async () => {
    const before = f.activityRepository.listActivitiesByTaskId(f.acmeTaskA).length;
    const cross = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/note`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, { 'content-type': 'application/json' }),
      body: JSON.stringify({ note: 'beta leak attempt' }),
    });
    expect(cross.status).toBe(404);
    expect(f.activityRepository.listActivitiesByTaskId(f.acmeTaskA).length).toBe(before);

    const own = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/note`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ note: 'legit acme note' }),
    });
    expect(own.status).toBe(200);
    expect(f.activityRepository.listActivitiesByTaskId(f.acmeTaskA).length).toBe(before + 1);
  });

  it('POST /:id/activity denies cross-org (404), no activity written; same-org ok', async () => {
    const before = f.activityRepository.listActivitiesByTaskId(f.acmeTaskA).length;
    const cross = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/activity`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, { 'content-type': 'application/json' }),
      body: JSON.stringify({ action: 'Cross leak', details: 'beta attempt' }),
    });
    expect(cross.status).toBe(404);
    expect(f.activityRepository.listActivitiesByTaskId(f.acmeTaskA).length).toBe(before);

    const own = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/activity`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ action: 'Legit update', details: 'acme activity' }),
    });
    expect(own.status).toBe(200);
    expect(f.activityRepository.listActivitiesByTaskId(f.acmeTaskA).length).toBe(before + 1);
  });

  it('POST /:id/subtasks/auto denies cross-org (404), no subtask created; same-org ok', async () => {
    const before = await f.countSubtasks(f.acmeTaskA);
    const cross = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/subtasks/auto`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, { 'content-type': 'application/json' }),
      body: JSON.stringify({ force: true }),
    });
    expect(cross.status).toBe(404);
    expect(await f.countSubtasks(f.acmeTaskA)).toBe(before);

    const own = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/subtasks/auto`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ force: true }),
    });
    expect(own.status).toBe(201);
  });

  it('POST /:id/comments denies cross-org (404), no comment created; same-org ok', async () => {
    const before = f.taskCommentRepository.listComments(f.acmeTaskA).length;
    const cross = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/comments`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, { 'content-type': 'application/json' }),
      body: JSON.stringify({ body: 'beta leak comment' }),
    });
    expect(cross.status).toBe(404);
    expect(f.taskCommentRepository.listComments(f.acmeTaskA).length).toBe(before);

    const own = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/comments`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ body: 'legit acme comment' }),
    });
    expect(own.status).toBe(201);
    expect(f.taskCommentRepository.listComments(f.acmeTaskA).length).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// R3-d: merge + projects mutations authorize both loaded tasks / parent task.
// ---------------------------------------------------------------------------

describe('R3 — merge & projects mutations deny cross-org with no durable change', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('POST /:id/merge denies a cross-org target (404) with no mutation', async () => {
    const targetBefore = await f.getTask(f.acmeTaskA);
    const sourceBefore = await f.getTask(f.betaTask);
    const commentsBefore = f.taskCommentRepository.listComments(f.acmeTaskA).length;
    // member-beta targets an Acme task -> denied on the target task.
    const cross = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/merge`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, { 'content-type': 'application/json' }),
      body: JSON.stringify({ sourceTaskId: f.betaTask }),
    });
    expect(cross.status).toBe(404);
    const targetAfter = await f.getTask(f.acmeTaskA);
    const sourceAfter = await f.getTask(f.betaTask);
    expect(targetAfter.name).toBe(targetBefore.name);
    expect(sourceAfter.archived).toBe(sourceBefore.archived);
    expect(f.taskCommentRepository.listComments(f.acmeTaskA).length).toBe(commentsBefore);
  });

  it('POST /:id/merge denies pulling a cross-org source into an authorized target (404)', async () => {
    const commentsBefore = f.taskCommentRepository.listComments(f.acmeTaskA).length;
    // member-acme is authorized on the Acme target but NOT on the Beta source.
    const cross = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/merge`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ sourceTaskId: f.betaTask }),
    });
    expect(cross.status).toBe(404);
    const sourceAfter = await f.getTask(f.betaTask);
    expect(sourceAfter.archived).toBeFalsy();
    expect(f.taskCommentRepository.listComments(f.acmeTaskA).length).toBe(commentsBefore);
  });

  it('POST /:id/merge succeeds same-org (both tasks authorized)', async () => {
    const res = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/merge`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ sourceTaskId: f.acmeTaskB }),
    });
    expect(res.status).toBe(200);
    const source = await f.getTask(f.acmeTaskB);
    expect(source.archived).toBe(true);
  });

  it('POST /:taskId/projects denies cross-org (404), no link created; same-org ok', async () => {
    const before = (await f.getTask(f.acmeTaskA)).projects ?? [];
    const cross = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/projects`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, { 'content-type': 'application/json' }),
      body: JSON.stringify({ project_id: f.acmeProjectId }),
    });
    expect(cross.status).toBe(404);
    expect(((await f.getTask(f.acmeTaskA)).projects ?? []).length).toBe(before.length);

    const own = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/projects`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ project_id: f.acmeProjectId }),
    });
    expect(own.status).toBe(201);
  });

  it('DELETE /:taskId/projects denies cross-org (404)', async () => {
    // First link a project as an authorized Acme member.
    await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/projects`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ project_id: f.acmeProjectId }),
    });
    const linked = ((await f.getTask(f.acmeTaskA)).projects ?? []).map((p: any) => p.id);
    expect(linked).toContain(f.acmeProjectId);

    const cross = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/projects`, {
      method: 'DELETE',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, { 'content-type': 'application/json' }),
      body: JSON.stringify({ project_id: f.acmeProjectId }),
    });
    expect(cross.status).toBe(404);
    // Link survives the cross-org delete attempt.
    const after = ((await f.getTask(f.acmeTaskA)).projects ?? []).map((p: any) => p.id);
    expect(after).toContain(f.acmeProjectId);
  });
});

// ---------------------------------------------------------------------------
// R3-e: trusted service/admin path (no customer token) preserved; global admin
// unrestricted. Spoofed identity/role headers must not change outcomes.
// ---------------------------------------------------------------------------

describe('R3 — trusted path preserved and global admin unrestricted', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('trusted bearer-only request reads task comments unchanged (PR #71/#72)', async () => {
    const res = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/comments`, {
      headers: { authorization: `Bearer ${f.apiToken}`, 'x-entity-org-id': 'org-acme' },
    });
    expect(res.status).toBe(200);
    const comments = await readJson(res);
    expect((comments as any[]).some((c) => c.body === 'acme seeded comment')).toBe(true);
  });

  it('trusted bearer-only request lists all tasks across both orgs (stale/duplicates unfiltered)', async () => {
    const stale = await fetch(`${f.baseUrl}/api/tasks/stale?hours=${1e-9}`, {
      headers: { authorization: `Bearer ${f.apiToken}` },
    });
    expect(stale.status).toBe(200);
    const orgs = new Set(((await readJson(stale)).tasks as any[]).map((t) => t.org_id));
    expect(orgs.has('org-acme')).toBe(true);
    expect(orgs.has('org-beta')).toBe(true);
  });

  it('global admin customer credential can read another org task (unrestricted)', async () => {
    const res = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/comments`, {
      headers: authHeaders(f.apiToken, f.tokens.globalAdmin),
    });
    expect(res.status).toBe(200);
  });

  it('spoofed x-entity-org-id header cannot widen a customer scope on comments', async () => {
    const res = await fetch(`${f.baseUrl}/api/tasks/${f.acmeTaskA}/comments`, {
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, { 'x-entity-org-id': 'org-acme' }),
    });
    expect(res.status).toBe(404);
  });
});
