/**
 * Curacel pilot — D-R6-MUTATION-GATES focused proof.
 *
 * Closes the defect slice where the prior R6 repair process exited 0 but made
 * no edits. Proves the two router-level mutation gates that were missing:
 *
 *  1. /api/chat — a non-GET/HEAD/OPTIONS request requires a persisted
 *     CONTRIBUTOR grant for the resolved request org. A customer VIEWER may
 *     still READ (200) but is denied setup/send/create mutations (403); a
 *     manager (>= contributor) succeeds. Trusted service is preserved.
 *
 *  2. /api/swarm — a non-GET/HEAD/OPTIONS request after the external callback
 *     intake requires deployment-control authority. A tenant viewer/manager is
 *     denied representative job + codex/eforge control mutations (403); a
 *     global admin passes auth. The signed callback intake (mounted before the
 *     gate) stays reachable without admin authority.
 *
 * Production-composed: REAL api-auth + customer-principal + data-plane-credential
 * guard + the REAL swarm/chat route composition on an isolated temp SQLite DB.
 * Principal resolution, tenant binding, and the authority gates are NOT mocked.
 */

import express from 'express';
import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authHeaders,
  readJson,
  tempDbPath,
  removeSqliteFiles,
} from './curacel-r6-acceptance-helpers';

interface Fixture {
  baseUrl: string;
  apiToken: string;
  tokens: { viewerAcme: string; managerAcme: string; managerAcmeTeam: string; viewerAcmeTeam: string; globalAdmin: string };
  org: { acme: string };
  server: http.Server;
}

const originalToken = process.env.ENTITY_API_TOKEN;
const originalPrincipal = process.env.ENTITY_API_PRINCIPAL_ID;
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalChatRuntime = process.env.ENTITY_CHAT_AGENT_RUNTIME;
const originalCodexUrl = process.env.CODEX_APP_SERVER_URL;
let server: http.Server | null = null;
const cleanupPaths: string[] = [];

/**
 * Explicit boot-hook timeout. The production-composed boot (real api-auth +
 * customer-principal + data-plane guard + route composition on a fresh temp
 * SQLite DB) is fast in isolation but can exceed vitest's 5s default hook
 * timeout under full-suite parallel contention. 30s is bounded (a genuinely
 * stuck boot still fails the suite instead of hanging) with ample headroom.
 * Applies only to the boot `beforeEach`; request assertions keep vitest's default.
 */
const BOOT_TIMEOUT = 30_000;

async function bootApp(): Promise<Fixture> {
  const dbPath = tempDbPath();
  cleanupPaths.push(dbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', `/tmp/missing-${Math.random()}`);
  vi.stubEnv('ENTITY_DB_MODE', 'LOCAL');
  vi.stubEnv('ENTITY_CHAT_AGENT_RUNTIME', '0');
  // Force the Codex provider's WebSocket constructor to throw synchronously so
  // its healthCheck fails fast (deterministic, no real network I/O). This keeps
  // the production-composed codex/control handler non-hanging under test.
  vi.stubEnv('CODEX_APP_SERVER_URL', 'not-a-valid-url');

  const apiToken = `r6-gates-${Math.random().toString(36).slice(2)}`;
  process.env.ENTITY_API_TOKEN = apiToken;

  const dbModule = await import('../../../db/src');
  const { createAccessTokenRepository } = await import('../../../db/src/access-tokens');
  const { createPrincipalRepository } = await import('../../../db/src/principals');
  const { createApiAuthMiddleware } = await import('../middleware/api-auth');
  const { createCustomerPrincipalMiddleware } = await import('../principals/request-context');
  const { createDataPlaneCredentialGuard } = await import('../middleware/data-plane-credential');
  const { createSwarmRouter } = await import('../swarm/routes');
  const { registerChatRoutes } = await import('../routes/chat');

  const workspaceRepo = dbModule.createWorkspaceScopeRepository();
  const principalRepo = createPrincipalRepository();
  const tokenRepo = createAccessTokenRepository();

  const ORG_ACME = 'org-acme';
  const TEAM_ACME = 'team-acme';
  workspaceRepo.createOrg({ id: ORG_ACME, name: 'Acme', mission: 'Acme mission' });
  workspaceRepo.createTeam({ orgId: ORG_ACME }, { id: TEAM_ACME, name: 'Acme Team' });

  const mk = (id: string, display: string, type: 'human' | 'agent' | 'service_account' = 'human') =>
    principalRepo.createPrincipal({ id, principal_type: type, display_name: display });
  mk('viewer-acme', 'Acme Viewer');
  principalRepo.createGrant({ principal_id: 'viewer-acme', role: 'viewer', org_id: ORG_ACME });
  mk('manager-acme', 'Acme Manager');
  principalRepo.createGrant({ principal_id: 'manager-acme', role: 'manager', org_id: ORG_ACME });
  mk('manager-acme-team', 'Acme Team Manager');
  principalRepo.createGrant({ principal_id: 'manager-acme-team', role: 'manager', org_id: ORG_ACME, team_id: TEAM_ACME });
  mk('viewer-acme-team', 'Acme Team Viewer');
  principalRepo.createGrant({ principal_id: 'viewer-acme-team', role: 'viewer', org_id: ORG_ACME, team_id: TEAM_ACME });
  mk('global-admin', 'Global Admin');
  principalRepo.createGrant({ principal_id: 'global-admin', role: 'admin' });
  mk('svc-admin', 'Service Admin', 'service_account');
  principalRepo.createGrant({ principal_id: 'svc-admin', role: 'admin' });
  process.env.ENTITY_API_PRINCIPAL_ID = 'svc-admin';

  const token = (pid: string) => tokenRepo.createToken({ principal_id: pid }).token;
  const tokens = {
    viewerAcme: token('viewer-acme'),
    managerAcme: token('manager-acme'),
    managerAcmeTeam: token('manager-acme-team'),
    viewerAcmeTeam: token('viewer-acme-team'),
    globalAdmin: token('global-admin'),
  };

  const app = express();
  app.use(express.json());
  app.use(createApiAuthMiddleware());
  app.use(createCustomerPrincipalMiddleware(tokenRepo));
  app.use(createDataPlaneCredentialGuard());
  app.use('/api/swarm', createSwarmRouter());
  registerChatRoutes({ app, getTaskOrg: async () => null });

  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  return { baseUrl: `http://127.0.0.1:${port}`, apiToken, tokens, org: { acme: ORG_ACME }, server };
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
  if (originalDbPath === undefined) delete process.env.ENTITY_TASK_DB_PATH;
  else process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  if (originalChatRuntime === undefined) delete process.env.ENTITY_CHAT_AGENT_RUNTIME;
  else process.env.ENTITY_CHAT_AGENT_RUNTIME = originalChatRuntime;
  if (originalCodexUrl === undefined) delete process.env.CODEX_APP_SERVER_URL;
  else process.env.CODEX_APP_SERVER_URL = originalCodexUrl;
  vi.unstubAllEnvs();
  vi.resetModules();
  // Robust to a timed-out boot: bootApp registers its temp-DB path in
  // `cleanupPaths` BEFORE the heavy composition work, and vitest still runs
  // afterEach after a beforeEach timeout, so a partially-initialized temp DB
  // (incl. -wal/-shm sidecars) is always swept here — no leaked/duplicate DB
  // state carries into the next boot.
  for (const p of cleanupPaths) removeSqliteFiles(p);
  cleanupPaths.length = 0;
});

// ---------------------------------------------------------------------------
// /api/chat — contributor role required for mutations.
// ---------------------------------------------------------------------------

describe('D-R6-MUTATION-GATES /api/chat — contributor role gates writes', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); }, BOOT_TIMEOUT);

  it('viewer can READ channels (GET is exempt from the mutation gate)', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/channels`, {
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme),
    });
    expect(res.status).toBe(200);
  });

  it('viewer is denied setup/send/create mutations (403, contributor required)', async () => {
    const setup = await fetch(`${f.baseUrl}/api/chat/setup`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme),
    });
    expect(setup.status).toBe(403);

    const create = await fetch(`${f.baseUrl}/api/chat/categories`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'Viewer Category' }),
    });
    expect(create.status).toBe(403);

    const send = await fetch(`${f.baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ channelId: 'general', content: 'hi', targetAgent: 'ada' }),
    });
    expect(send.status).toBe(403);
  });

  it('team-scoped manager is allowed (chat writes are repository-scoped, not org-wide)', async () => {
    const setup = await fetch(`${f.baseUrl}/api/chat/setup`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcmeTeam),
    });
    expect(setup.status).toBe(200);

    const send = await fetch(`${f.baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcmeTeam, { 'content-type': 'application/json' }),
      body: JSON.stringify({ channelId: 'general', content: 'hi from team manager', targetAgent: 'ada' }),
    });
    // 404 = passed the gate, denied later by the scoped repo (no owned general channel yet)
    expect([201, 202, 400, 404]).toContain(send.status);
  });

  it('team-scoped viewer is denied chat mutations (403, contributor required)', async () => {
    const setup = await fetch(`${f.baseUrl}/api/chat/setup`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcmeTeam),
    });
    expect(setup.status).toBe(403);
  });

  it('manager (>= contributor) succeeds at setup and create mutations', async () => {
    const setup = await fetch(`${f.baseUrl}/api/chat/setup`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme),
    });
    expect(setup.status).toBe(200);

    const create = await fetch(`${f.baseUrl}/api/chat/categories`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'Manager Category' }),
    });
    expect(create.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// /api/swarm — deployment-control authority required for mutations.
// ---------------------------------------------------------------------------

describe('D-R6-MUTATION-GATES /api/swarm — deployment-control gates writes', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); }, BOOT_TIMEOUT);

  it('viewer can READ jobs (GET is exempt from the mutation gate)', async () => {
    const res = await fetch(`${f.baseUrl}/api/swarm/jobs`, {
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme),
    });
    expect(res.status).toBe(200);
  });

  it('denies representative job create to tenant viewer and manager (403)', async () => {
    for (const tok of [f.tokens.viewerAcme, f.tokens.managerAcme]) {
      const res = await fetch(`${f.baseUrl}/api/swarm/jobs`, {
        method: 'POST',
        headers: authHeaders(f.apiToken, tok, { 'content-type': 'application/json' }),
        body: JSON.stringify({ title: 'Rogue Job', spec: 'x', provider: 'acp' }),
      });
      expect(res.status).toBe(403);
      expect((await readJson(res)).reason).toBe('deployment control requires administrator authority');
    }
  });

  it('denies codex and eforge control to a tenant manager (403)', async () => {
    const codex = await fetch(`${f.baseUrl}/api/swarm/providers/codex/control`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme),
    });
    expect(codex.status).toBe(403);

    const eforge = await fetch(`${f.baseUrl}/api/swarm/providers/eforge/control`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ action: 'status' }),
    });
    expect(eforge.status).toBe(403);
  });

  it('global admin passes auth for job create (201) and codex control (not 403)', async () => {
    const job = await fetch(`${f.baseUrl}/api/swarm/jobs`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.globalAdmin, { 'content-type': 'application/json' }),
      body: JSON.stringify({ title: 'Admin Job', spec: 'x', provider: 'acp' }),
    });
    expect(job.status).toBe(201);

    const codex = await fetch(`${f.baseUrl}/api/swarm/providers/codex/control`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.globalAdmin),
    });
    expect(codex.status).not.toBe(403);
  });

  it('keeps the signed callback intake reachable past the gate (no deployment-control 403)', async () => {
    // The callback intake is mounted BEFORE the gate and handles its own auth.
    // A viewer POST to an intake alias must NOT be blocked by the deployment-
    // control gate; it reaches the intake handler, which rejects unsigned input.
    const res = await fetch(`${f.baseUrl}/api/swarm/jobs/nonexistent/plan`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ summary: 'intake plan' }),
    });
    const body = await readJson(res);
    expect(body.reason).not.toBe('deployment control requires administrator authority');
  });
});
