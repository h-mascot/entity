import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const tmpDbPath = path.join(
  os.tmpdir(),
  `entity-swarm-task-run-${process.pid}-${randomUUID()}.db`,
);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalMcPath = process.env.MISSION_CONTROL_DB_PATH;
const originalAcpBaseUrl = process.env.ACP_BASE_URL;
const originalRunRepo = process.env.ENTITY_SWARM_RUN_REPO;
const originalTrustedHeaders = process.env.ENTITY_TRUST_TENANT_HEADERS;

// Governed execution target for happy-path Run-with-agents tests (BRD-004: the
// dispatch target must come from governed config / request / task metadata, and
// never an example placeholder).
process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.MISSION_CONTROL_DB_PATH = path.join(os.tmpdir(), `missing-mc-${randomUUID()}.db`);
process.env.ACP_BASE_URL = 'http://127.0.0.1:9';
process.env.ENTITY_SWARM_RUN_REPO = 'https://github.com/acme/entity';
delete process.env.EFORGE_API_URL;
delete process.env.EFORGE_WEB_URL;
delete process.env.EFORGE_QUEUE_DIR;

let baseUrl = '';
let server: Awaited<ReturnType<express.Express['listen']>>;
let createSwarmRouter: typeof import('./routes').createSwarmRouter;
let createTaskRepository: typeof import('../../../db/src').createTaskRepository;
let listSwarmJobs: typeof import('./db').listSwarmJobs;
let getEntityDatabase: typeof import('../../../db/src/entity-db').getEntityDatabase;

beforeAll(async () => {
  ({ createSwarmRouter } = await import('./routes'));
  ({ createTaskRepository } = await import('../../../db/src'));
  ({ listSwarmJobs } = await import('./db'));
  ({ getEntityDatabase } = await import('../../../db/src/entity-db'));

  const app = express();
  app.use(express.json());
  app.use('/api/swarm', createSwarmRouter());

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      baseUrl = `http://127.0.0.1:${address.port}/api/swarm`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  if (originalDbPath === undefined) delete process.env.ENTITY_TASK_DB_PATH;
  else process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  if (originalMcPath === undefined) delete process.env.MISSION_CONTROL_DB_PATH;
  else process.env.MISSION_CONTROL_DB_PATH = originalMcPath;
  if (originalAcpBaseUrl === undefined) delete process.env.ACP_BASE_URL;
  else process.env.ACP_BASE_URL = originalAcpBaseUrl;
  if (originalRunRepo === undefined) delete process.env.ENTITY_SWARM_RUN_REPO;
  else process.env.ENTITY_SWARM_RUN_REPO = originalRunRepo;
  if (originalTrustedHeaders === undefined) delete process.env.ENTITY_TRUST_TENANT_HEADERS;
  else process.env.ENTITY_TRUST_TENANT_HEADERS = originalTrustedHeaders;
  for (const file of [tmpDbPath, `${tmpDbPath}-wal`, `${tmpDbPath}-shm`]) {
    fs.rmSync(file, { force: true });
  }
});

beforeEach(() => {
  listSwarmJobs({});
  const db = getEntityDatabase();
  db.exec('DELETE FROM swarm_proofs');
  db.exec('DELETE FROM swarm_jobs');
});

async function json(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { status: res.status, payload };
}

function createTask(name: string, description?: string) {
  const repo = createTaskRepository();
  return repo.createTask({ name, description });
}

describe('POST /api/swarm/tasks/:taskId/run (Run with agents)', () => {
  it('creates a task-linked queued job for an eligible task using the configured target', async () => {
    const task = createTask('Fix login redirect', 'Blank page after SSO');
    const { status, payload } = await json('POST', `/tasks/${task.id}/run`);
    expect(status).toBe(201);
    const job = (payload as { job: { task_id: number; status: string; title: string; repo: string } }).job;
    expect(job.task_id).toBe(task.id);
    expect(['queued', 'draft', 'dispatched']).toContain(job.status);
    expect(job.title).toBe('Run: Fix login redirect');
    // Governed target is used verbatim — never the example placeholder.
    expect(job.repo).toBe('https://github.com/acme/entity');
  });

  it('does not create a duplicate job when an active run already exists (atomic guard)', async () => {
    const task = createTask('One at a time');
    const first = await json('POST', `/tasks/${task.id}/run`);
    expect(first.status).toBe(201);
    const firstId = (first.payload as { job: { id: string } }).job.id;

    // Fire a burst of concurrent requests; the atomic DB invariant must keep
    // exactly one active job regardless of arrival order.
    const concurrent = await Promise.all([
      json('POST', `/tasks/${task.id}/run`),
      json('POST', `/tasks/${task.id}/run`),
      json('POST', `/tasks/${task.id}/run`),
    ]);
    for (const r of concurrent) {
      expect(r.status).toBe(200);
      expect((r.payload as { alreadyActive: boolean }).alreadyActive).toBe(true);
      expect((r.payload as { job: { id: string } }).job.id).toBe(firstId);
    }

    expect(listSwarmJobs({ task_id: task.id })).toHaveLength(1);
  });

  it('allows a new run after the previous job reaches a terminal status', async () => {
    const task = createTask('Run again');
    const first = await json('POST', `/tasks/${task.id}/run`);
    const firstId = (first.payload as { job: { id: string } }).job.id;
    const { updateSwarmJob } = await import('./db');
    updateSwarmJob(firstId, { status: 'done' });

    const second = await json('POST', `/tasks/${task.id}/run`);
    expect(second.status).toBe(201);
    expect((second.payload as { job: { id: string } }).job.id).not.toBe(firstId);
    expect(listSwarmJobs({ task_id: task.id })).toHaveLength(2);
  });

  it('returns 404 for a missing task and 400 for an invalid id', async () => {
    expect((await json('POST', '/tasks/999999/run')).status).toBe(404);
    expect((await json('POST', '/tasks/abc/run')).status).toBe(400);
    expect((await json('POST', '/tasks/0/run')).status).toBe(400);
  });

  it('rejects an ineligible (done) task with 409 TASK_NOT_ELIGIBLE', async () => {
    const task = createTask('Already shipped');
    const repo = createTaskRepository();
    repo.updateTask(task.id, { column: 'done' });

    const { status, payload } = await json('POST', `/tasks/${task.id}/run`);
    expect(status).toBe(409);
    expect((payload as { code: string }).code).toBe('TASK_NOT_ELIGIBLE');
    expect(listSwarmJobs({ task_id: task.id })).toHaveLength(0);
  });

  it('fails closed with 400 NO_EXECUTION_TARGET when no governed target is configured', async () => {
    const task = createTask('Needs a target');
    const prev = process.env.ENTITY_SWARM_RUN_REPO;
    delete process.env.ENTITY_SWARM_RUN_REPO;
    try {
      const { status, payload } = await json('POST', `/tasks/${task.id}/run`);
      expect(status).toBe(400);
      expect((payload as { code: string }).code).toBe('NO_EXECUTION_TARGET');
      expect(listSwarmJobs({ task_id: task.id })).toHaveLength(0);
    } finally {
      process.env.ENTITY_SWARM_RUN_REPO = prev;
    }
  });

  it('fails closed (404) for a task outside the request org scope', async () => {
    // D4: header-based scope is the trusted-proxy path. Enable it so the request
    // org differs from the task's org, then verify Run-with-agents fails closed.
    process.env.ENTITY_TRUST_TENANT_HEADERS = '1';
    const task = createTask('Scoped task');
    const { status } = await json('POST', `/tasks/${task.id}/run`, undefined, {
      'x-entity-org-id': 'some-other-org',
    });
    expect(status).toBe(404);
    expect(listSwarmJobs({ task_id: task.id })).toHaveLength(0);
    delete process.env.ENTITY_TRUST_TENANT_HEADERS;
  });

  it('honours an explicit request-body repo override over governed config', async () => {
    const task = createTask('Override target');
    const { status, payload } = await json('POST', `/tasks/${task.id}/run`, {
      repo: 'https://github.com/acme/override',
      branch: 'feat',
    });
    expect(status).toBe(201);
    expect((payload as { job: { repo: string; branch: string } }).job.repo).toBe(
      'https://github.com/acme/override',
    );
  });
});

describe('task-linked Swarm read scoping (D5)', () => {
  // Header-based scope is the trusted-proxy path (D4). Enable it for these
  // cross-tenant read tests and reset afterwards.
  beforeEach(() => {
    process.env.ENTITY_TRUST_TENANT_HEADERS = '1';
  });
  afterEach(() => {
    delete process.env.ENTITY_TRUST_TENANT_HEADERS;
  });

  async function createTaskLinkedJobWithProof() {
    const task = createTask('Tenant-scoped run', 'Scoped execution');
    // Run in the task's own (default) workspace scope.
    const run = await json('POST', `/tasks/${task.id}/run`, undefined, {
      'x-entity-org-id': 'default-org',
    });
    expect(run.status).toBe(201);
    const jobId = (run.payload as { job: { id: string } }).job.id;
    // Attach a proof so the proofs read has something to protect.
    const proof = await json(
      'POST',
      `/jobs/${jobId}/proof`,
      { commit_sha: 'abc123', build_log: 'green' },
      { 'x-entity-org-id': 'default-org' },
    );
    expect(proof.status).toBe(201);
    return { task, jobId };
  }

  it('blocks cross-tenant GET /jobs/:id detail reads with 404', async () => {
    const { jobId } = await createTaskLinkedJobWithProof();
    const inScope = await json('GET', `/jobs/${jobId}`, undefined, {
      'x-entity-org-id': 'default-org',
    });
    expect(inScope.status).toBe(200);
    const crossTenant = await json('GET', `/jobs/${jobId}`, undefined, {
      'x-entity-org-id': 'some-other-org',
    });
    expect(crossTenant.status).toBe(404);
  });

  it('blocks cross-tenant GET /jobs/:id/proofs reads with 404', async () => {
    const { jobId } = await createTaskLinkedJobWithProof();
    const inScope = await json('GET', `/jobs/${jobId}/proofs`, undefined, {
      'x-entity-org-id': 'default-org',
    });
    expect(inScope.status).toBe(200);
    expect((inScope.payload as { proofs: unknown[] }).proofs).toHaveLength(1);
    const crossTenant = await json('GET', `/jobs/${jobId}/proofs`, undefined, {
      'x-entity-org-id': 'some-other-org',
    });
    expect(crossTenant.status).toBe(404);
  });

  it('blocks cross-tenant GET /jobs?task_id= reads (fail closed, no leak)', async () => {
    const { task } = await createTaskLinkedJobWithProof();
    const inScope = await json('GET', `/jobs?task_id=${task.id}`, undefined, {
      'x-entity-org-id': 'default-org',
    });
    expect(inScope.status).toBe(200);
    expect((inScope.payload as { jobs: unknown[] }).jobs).toHaveLength(1);
    const crossTenant = await json('GET', `/jobs?task_id=${task.id}`, undefined, {
      'x-entity-org-id': 'some-other-org',
    });
    expect(crossTenant.status).toBe(404);
  });

  it('returns 404 when the linked task does not exist (no list leak)', async () => {
    const crossTenant = await json('GET', '/jobs?task_id=999999', undefined, {
      'x-entity-org-id': 'default-org',
    });
    expect(crossTenant.status).toBe(404);
  });
});

describe('unfiltered GET /jobs cross-tenant scoping (D5 g4)', () => {
  beforeEach(() => {
    process.env.ENTITY_TRUST_TENANT_HEADERS = '1';
  });
  afterEach(() => {
    delete process.env.ENTITY_TRUST_TENANT_HEADERS;
  });

  it('filters cross-tenant task-linked jobs out of the unfiltered list while keeping unlinked jobs', async () => {
    // Task-linked job owned by default-org (created through the governed path).
    const task = createTask('Owned execution', 'Scoped run');
    const run = await json('POST', `/tasks/${task.id}/run`, undefined, {
      'x-entity-org-id': 'default-org',
    });
    expect(run.status).toBe(201);
    const linkedJobId = (run.payload as { job: { id: string } }).job.id;

    // Unlinked operational job (no task linkage) — always visible operationally.
    const op = await json('POST', '/jobs', {
      title: 'Operational sweep',
      spec: 'Unlinked operational job',
      repo: 'https://github.com/acme/ops',
      provider: 'symphony',
    });
    expect(op.status).toBe(201);
    const opJobId = (op.payload as { job: { id: string } }).job.id;

    // In-scope request sees both the task-linked job and the unlinked job.
    const inScope = await json('GET', '/jobs', undefined, {
      'x-entity-org-id': 'default-org',
    });
    expect(inScope.status).toBe(200);
    const inScopeIds = (inScope.payload as { jobs: Array<{ id: string }> }).jobs.map((j) => j.id);
    expect(inScopeIds).toContain(linkedJobId);
    expect(inScopeIds).toContain(opJobId);

    // Cross-tenant request must NOT see the task-linked job, but the unlinked
    // operational job remains visible (operational surface retained).
    const crossTenant = await json('GET', '/jobs', undefined, {
      'x-entity-org-id': 'some-other-org',
    });
    expect(crossTenant.status).toBe(200);
    const crossIds = (crossTenant.payload as { jobs: Array<{ id: string }> }).jobs.map((j) => j.id);
    expect(crossIds).not.toContain(linkedJobId);
    expect(crossIds).toContain(opJobId);
  });
});

describe('task-linked mutation cross-tenant scoping (D5 g4)', () => {
  beforeEach(() => {
    process.env.ENTITY_TRUST_TENANT_HEADERS = '1';
  });
  afterEach(() => {
    delete process.env.ENTITY_TRUST_TENANT_HEADERS;
  });

  // Creates a task-linked job owned by default-org and returns its id plus the
  // initial status snapshot for post-mutation unchanged assertions.
  async function createOwnedLinkedJob() {
    const task = createTask('Owned mutable run', 'Scoped mutation target');
    const run = await json('POST', `/tasks/${task.id}/run`, undefined, {
      'x-entity-org-id': 'default-org',
    });
    expect(run.status).toBe(201);
    const jobId = (run.payload as { job: { id: string; status: string } }).job.id;
    const before = (await json('GET', `/jobs/${jobId}`, undefined, {
      'x-entity-org-id': 'default-org',
    }).then((r) => r.payload as { job: { status: string; spec: string } })).job;
    return { task, jobId, beforeStatus: before.status, beforeSpec: before.spec };
  }

  // Every task-linked mutation/control/proof path must fail closed (404) for a
  // cross-tenant caller and leave the job state untouched. Unlinked operational
  // behavior is covered by the existing routes/e2e suites and is intentionally
  // not re-asserted here.
  const cases: Array<{
    name: string;
    method: string;
    path: (jobId: string) => string;
    body?: unknown;
    proofsBefore?: number;
  }> = [
    { name: 'PATCH update', method: 'PATCH', path: (id) => `/jobs/${id}`, body: { spec: 'hacked cross-tenant' } },
    { name: 'DELETE', method: 'DELETE', path: (id) => `/jobs/${id}` },
    { name: 'dispatch', method: 'POST', path: (id) => `/jobs/${id}/dispatch` },
    { name: 'check status', method: 'POST', path: (id) => `/jobs/${id}/check` },
    { name: 'accept', method: 'POST', path: (id) => `/jobs/${id}/accept` },
    { name: 'reject', method: 'POST', path: (id) => `/jobs/${id}/reject`, body: { feedback: 'no' } },
    { name: 'cancel', method: 'POST', path: (id) => `/jobs/${id}/cancel` },
    { name: 'claim', method: 'POST', path: (id) => `/jobs/${id}/claim`, body: { claimed_by: 'x', run_handle: 'x:h' } },
    { name: 'release', method: 'POST', path: (id) => `/jobs/${id}/release` },
    { name: 'status mutation', method: 'POST', path: (id) => `/jobs/${id}/status`, body: { status: 'running' } },
    { name: 'proof', method: 'POST', path: (id) => `/jobs/${id}/proof`, body: { commit_sha: 'abc' } },
    { name: 'complete', method: 'POST', path: (id) => `/jobs/${id}/complete` },
    { name: 'fail', method: 'POST', path: (id) => `/jobs/${id}/fail`, body: { reason: 'boom' } },
  ];

  for (const c of cases) {
    it(`blocks cross-tenant ${c.name} with 404 and leaves the job untouched`, async () => {
      const { jobId, beforeStatus, beforeSpec } = await createOwnedLinkedJob();

      const res = await json(c.method, c.path(jobId), c.body, {
        'x-entity-org-id': 'some-other-org',
      });
      expect(res.status).toBe(404);

      // Job still exists for the in-scope owner and is unchanged.
      const after = await json('GET', `/jobs/${jobId}`, undefined, {
        'x-entity-org-id': 'default-org',
      });
      expect(after.status).toBe(200);
      const afterJob = (after.payload as { job: { status: string; spec: string }; proofs: unknown[] }).job;
      expect(afterJob.status).toBe(beforeStatus);
      expect(afterJob.spec).toBe(beforeSpec);

      // No proof was appended cross-tenant.
      const proofs = await json('GET', `/jobs/${jobId}/proofs`, undefined, {
        'x-entity-org-id': 'default-org',
      });
      expect((proofs.payload as { proofs: unknown[] }).proofs).toHaveLength(0);
    });
  }
});

describe('generic POST /jobs task-linked creation boundary (D5 g4)', () => {
  it('rejects task_id on the generic create path (task linkage is governed)', async () => {
    const task = createTask('Should not link here', 'via generic create');
    const res = await json('POST', '/jobs', {
      title: 'Arbitrary link',
      spec: 'Attempt to bypass governed lifecycle',
      repo: 'https://github.com/acme/entity',
      provider: 'symphony',
      task_id: task.id,
    });
    expect(res.status).toBe(400);
    expect((res.payload as { code?: string }).code).toBe('TASK_LINK_REQUIRES_GOVERNED_PATH');
    // No job was created for this task.
    expect(listSwarmJobs({ task_id: task.id })).toHaveLength(0);
  });

  it('still creates unlinked operational jobs on the generic create path', async () => {
    const res = await json('POST', '/jobs', {
      title: 'Operational job',
      spec: 'Unlinked operational creation is preserved',
      repo: 'https://github.com/acme/ops',
      provider: 'symphony',
    });
    expect(res.status).toBe(201);
    const job = (res.payload as { job: { task_id: number | null } }).job;
    expect(job.task_id).toBeNull();
  });
});

// D8 (remaining D5 callback authorization boundary): a provider callback that
// carries a VALID callback token must still be rejected (404) when its target is
// a task-linked job outside the request tenant scope, and must append no
// ActivityEvent of any kind. Unlinked operational callbacks are preserved.
describe('task-linked callback intake cross-tenant authorization (D5 g5 / D8)', () => {
  const CALLBACK_SECRET = 'd8-callback-secret-0123456789abcdef';
  const ORIGINAL_CALLBACK_TOKEN = process.env.ENTITY_EEPC_CALLBACK_TOKEN;

  beforeEach(() => {
    process.env.ENTITY_TRUST_TENANT_HEADERS = '1';
    process.env.ENTITY_EEPC_CALLBACK_TOKEN = CALLBACK_SECRET;
  });
  afterEach(() => {
    delete process.env.ENTITY_TRUST_TENANT_HEADERS;
    if (ORIGINAL_CALLBACK_TOKEN === undefined) delete process.env.ENTITY_EEPC_CALLBACK_TOKEN;
    else process.env.ENTITY_EEPC_CALLBACK_TOKEN = ORIGINAL_CALLBACK_TOKEN;
  });

  function taskActivityCount(taskId: number): number {
    const rows = getEntityDatabase()
      .prepare('SELECT id FROM activities WHERE task_id = ?')
      .all(taskId);
    return rows.length;
  }

  function callbackBodyFor(
    event: 'plan' | 'progress' | 'proof' | 'status' | 'blocker',
  ): Record<string, unknown> {
    switch (event) {
      case 'plan':
        return { provider: 'symphony', summary: 'plan ok', steps: ['a', 'b'] };
      case 'progress':
        return { provider: 'symphony', summary: 'progress ok', percent: 50 };
      case 'proof':
        return {
          provider: 'symphony',
          summary: 'proof ok',
          commit_sha: 'abc1234',
          test_result: 'pass',
        };
      case 'status':
        return { provider: 'symphony', summary: 'status ok', status: 'running' };
      case 'blocker':
        return { provider: 'symphony', summary: 'blocked ok', reason: 'waiting on review' };
    }
  }

  // Create a task-linked symphony job owned by default-org through the governed
  // Run-with-agents path (the only sanctioned task-linkage lifecycle).
  async function createTaskLinkedSymphonyJob() {
    const task = createTask('Scoped callback run', 'Symphony execution');
    const run = await json(
      'POST',
      `/tasks/${task.id}/run`,
      { provider: 'symphony' },
      { 'x-entity-org-id': 'default-org' },
    );
    expect(run.status).toBe(201);
    const job = (run.payload as { job: { id: string; provider: string; task_id: number } }).job;
    expect(job.provider).toBe('symphony');
    expect(job.task_id).toBe(task.id);
    return { task, jobId: job.id };
  }

  // Both the canonical callback route and every convenience alias must fail
  // closed (404) for a cross-tenant caller carrying a valid provider callback
  // token, and must append no ActivityEvent of any kind.
  const crossTenantCases: Array<{
    name: string;
    path: (id: string) => string;
    event: 'plan' | 'progress' | 'proof' | 'status' | 'blocker';
  }> = [
    { name: 'canonical plan', path: (id) => `/jobs/${id}/callbacks/plan`, event: 'plan' },
    { name: 'canonical progress', path: (id) => `/jobs/${id}/callbacks/progress`, event: 'progress' },
    { name: 'canonical proof', path: (id) => `/jobs/${id}/callbacks/proof`, event: 'proof' },
    { name: 'canonical status', path: (id) => `/jobs/${id}/callbacks/status`, event: 'status' },
    { name: 'canonical blocker', path: (id) => `/jobs/${id}/callbacks/blocker`, event: 'blocker' },
    { name: 'alias plan', path: (id) => `/jobs/${id}/plan`, event: 'plan' },
    { name: 'alias progress', path: (id) => `/jobs/${id}/progress`, event: 'progress' },
    { name: 'alias blocker', path: (id) => `/jobs/${id}/blocker`, event: 'blocker' },
  ];

  for (const c of crossTenantCases) {
    it(`blocks cross-tenant ${c.name} callback with 404 and appends no activity`, async () => {
      const { task, jobId } = await createTaskLinkedSymphonyJob();
      const before = taskActivityCount(task.id);

      const res = await json('POST', c.path(jobId), callbackBodyFor(c.event), {
        'x-entity-org-id': 'some-other-org',
        authorization: `Bearer ${CALLBACK_SECRET}`,
      });
      expect(res.status).toBe(404);

      // No ActivityEvent of any kind (plan/progress/proof/status/blocker) appended.
      expect(taskActivityCount(task.id)).toBe(before);
    });
  }

  it('accepts an in-scope canonical progress callback (positive retained)', async () => {
    const { jobId } = await createTaskLinkedSymphonyJob();
    const res = await json('POST', `/jobs/${jobId}/callbacks/progress`, callbackBodyFor('progress'), {
      'x-entity-org-id': 'default-org',
      authorization: `Bearer ${CALLBACK_SECRET}`,
    });
    expect(res.status).toBe(202);
    expect((res.payload as { ok: boolean }).ok).toBe(true);
  });

  it('accepts an in-scope alias plan callback (positive retained)', async () => {
    const { jobId } = await createTaskLinkedSymphonyJob();
    const res = await json('POST', `/jobs/${jobId}/plan`, callbackBodyFor('plan'), {
      'x-entity-org-id': 'default-org',
      authorization: `Bearer ${CALLBACK_SECRET}`,
    });
    expect(res.status).toBe(202);
    expect((res.payload as { ok: boolean }).ok).toBe(true);
  });

  it('preserves unlinked operational callback behavior regardless of request scope', async () => {
    // Unlinked operational job (no task linkage) is always visible to the
    // operational callback surface — tenant scope must not gate it.
    const op = await json('POST', '/jobs', {
      title: 'Operational sweep',
      spec: 'Unlinked operational callback target',
      repo: 'https://github.com/acme/ops',
      provider: 'symphony',
    });
    expect(op.status).toBe(201);
    const jobId = (op.payload as { job: { id: string; task_id: number | null } }).job.id;
    expect((op.payload as { job: { task_id: number | null } }).job.task_id).toBeNull();

    const res = await json('POST', `/jobs/${jobId}/callbacks/progress`, callbackBodyFor('progress'), {
      'x-entity-org-id': 'some-other-org',
      authorization: `Bearer ${CALLBACK_SECRET}`,
    });
    expect(res.status).toBe(202);
    expect((res.payload as { ok: boolean }).ok).toBe(true);
  });
});
