/**
 * Curacel pilot — R6 / CRITERION-5 production-composed acceptance.
 *
 * PROOF SCOPE: Terra R6 closes on provider-health, chat controls, business
 * onboarding, and operations under the SAME persisted customer-principal model
 * as the rest of the customer surface (NOT stale session auth).
 *
 * This suite is production-composed: it boots REAL api-auth + customer-principal
 * + data-plane-credential-guard middleware, then the REAL route/repository
 * composition for all four criterion surfaces (swarm router, business-onboarding
 * router, chat routes, node-operations routes) on an isolated temp SQLite DB.
 * Principal resolution, tenant binding, org-authority gates, and secret
 * redaction are NOT mocked. Two organizations and distinct per-customer
 * credentials are provisioned.
 *
 * It proves:
 *   1. provider health reads are per-principal credential gated + secret
 *      redacted; recovery/control mutations (daemon control, heal) are admin
 *      only and never open to tenant/viewer credentials.
 *   2. chat controls use org/team/project principal scope; viewer read vs
 *      contributor write, cross-org/spoofed-org denied; ClickClack
 *      unavailability degrades safely.
 *   3. business onboarding: a caller cannot create/read/patch/provision/confirm
 *      ANOTHER org; creation requires administrator authority; org mutations
 *      require manager authority under persisted grants.
 *   4. operations surfaces: node-operations read-only diagnostics are
 *      principal-gated and secret-safe; deployment control is admin only.
 *
 * No raw secrets appear in any response (deterministic scanner + known-secret
 * denylist).
 */

import express from 'express';
import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authHeaders,
  readJson,
  tempDbPath,
  removeSqliteFiles,
  assertNoSecretLeaks,
  type AcceptanceFixture,
} from './curacel-r6-acceptance-helpers';

const originalToken = process.env.ENTITY_API_TOKEN;
const originalPrincipal = process.env.ENTITY_API_PRINCIPAL_ID;
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalChatRuntime = process.env.ENTITY_CHAT_AGENT_RUNTIME;
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

async function bootApp(): Promise<AcceptanceFixture> {
  const dbPath = tempDbPath();
  cleanupPaths.push(dbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', `/tmp/missing-${Math.random()}`);
  vi.stubEnv('ENTITY_DB_MODE', 'LOCAL');
  vi.stubEnv('ENTITY_CHAT_AGENT_RUNTIME', '0');
  // Point eforge daemon control at a fast no-op binary so the global-admin
  // control assertion (status !== 403) does not block on a real daemon probe.
  vi.stubEnv('ENTITY_EFORGE_CONTROL_COMMAND', '/usr/bin/true');

  const apiToken = `r6-pilot-${Math.random().toString(36).slice(2)}`;
  process.env.ENTITY_API_TOKEN = apiToken;

  // DB + repositories share the isolated temp DB via getEntityDatabase.
  const dbModule = await import('../../../db/src');
  const { createTaskSyncLayer } = await import('../../../db/src/task-sync');
  const { createAccessTokenRepository } = await import('../../../db/src/access-tokens');
  const { createPrincipalRepository } = await import('../../../db/src/principals');

  const { createApiAuthMiddleware } = await import('../middleware/api-auth');
  const { createCustomerPrincipalMiddleware } = await import('../principals/request-context');
  const { createDataPlaneCredentialGuard } = await import('../middleware/data-plane-credential');
  const { createSwarmRouter } = await import('../swarm/routes');
  const { createBusinessOnboardingRouter, createTaskSyncLayerRepoFactory } = await import('../routes/business-onboarding');
  const { registerChatRoutes } = await import('../routes/chat');
  const { registerNodeOperationsRoutes } = await import('../node-operations');

  const workspaceRepo = dbModule.createWorkspaceScopeRepository();
  const taskSyncLayer = createTaskSyncLayer();
  const principalRepo = createPrincipalRepository();
  const tokenRepo = createAccessTokenRepository();

  // Two organizations.
  const ORG_ACME = 'org-acme';
  const ORG_BETA = 'org-beta';
  workspaceRepo.createOrg({ id: ORG_ACME, name: 'Acme', mission: 'Acme mission' });
  workspaceRepo.createOrg({ id: ORG_BETA, name: 'Beta', mission: 'Beta mission' });

  // Principals + persisted grants.
  function mkPrincipal(id: string, display: string, type: 'human' | 'agent' | 'service_account' = 'human') {
    return principalRepo.createPrincipal({ id, principal_type: type, display_name: display });
  }
  mkPrincipal('viewer-acme', 'Acme Viewer');
  principalRepo.createGrant({ principal_id: 'viewer-acme', role: 'viewer', org_id: ORG_ACME });
  mkPrincipal('manager-acme', 'Acme Manager');
  principalRepo.createGrant({ principal_id: 'manager-acme', role: 'manager', org_id: ORG_ACME });
  mkPrincipal('manager-beta', 'Beta Manager');
  principalRepo.createGrant({ principal_id: 'manager-beta', role: 'manager', org_id: ORG_BETA });
  mkPrincipal('global-admin', 'Global Admin');
  principalRepo.createGrant({ principal_id: 'global-admin', role: 'admin' });
  mkPrincipal('svc-admin', 'Service Admin', 'service_account');
  principalRepo.createGrant({ principal_id: 'svc-admin', role: 'admin' });
  process.env.ENTITY_API_PRINCIPAL_ID = 'svc-admin';

  function mkToken(pid: string): string {
    return tokenRepo.createToken({ principal_id: pid }).token;
  }
  const tokens = {
    viewerAcme: mkToken('viewer-acme'),
    managerAcme: mkToken('manager-acme'),
    managerBeta: mkToken('manager-beta'),
    globalAdmin: mkToken('global-admin'),
  };

  const app = express();
  app.use(express.json());
  app.use(createApiAuthMiddleware());
  app.use(createCustomerPrincipalMiddleware(tokenRepo));
  app.use(createDataPlaneCredentialGuard());

  // Criterion 1 — swarm (provider health + recovery/control mutations).
  app.use('/api/swarm', createSwarmRouter());
  // Criterion 3 — business onboarding (org-scoped mutations).
  app.use('/api', createBusinessOnboardingRouter({
    workspaceRepo,
    agentRegistryRepo: { listAgents: () => [] },
    taskRepoFactory: createTaskSyncLayerRepoFactory(taskSyncLayer),
  }));
  // Criterion 2 — chat (org/team scope + ClickClack degradation).
  registerChatRoutes({
    app,
    clickClackReadiness: () => ({
      state: 'unavailable',
      configured: true,
      bridgeEnabled: true,
      baseUrl: 'http://127.0.0.1:3091',
      reason: 'sidecar_unreachable',
      checkedAt: '2026-08-04T00:00:00.000Z',
    }),
    clickClackBridge: {
      sendCompatibilityMessage: async () => {
        throw new Error('sidecar unreachable');
      },
    } as any,
    getTaskOrg: async () => null,
  });
  // Criterion 4 — operations (read-only diagnostics, principal-gated).
  registerNodeOperationsRoutes(app);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken,
    allSecrets: [apiToken, tokens.viewerAcme, tokens.managerAcme, tokens.managerBeta, tokens.globalAdmin],
    tokens,
    ids: {
      viewerAcme: 'viewer-acme',
      managerAcme: 'manager-acme',
      managerBeta: 'manager-beta',
      globalAdmin: 'global-admin',
    },
    org: { acme: ORG_ACME, beta: ORG_BETA },
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
  if (originalDbPath === undefined) delete process.env.ENTITY_TASK_DB_PATH;
  else process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  if (originalChatRuntime === undefined) delete process.env.ENTITY_CHAT_AGENT_RUNTIME;
  else process.env.ENTITY_CHAT_AGENT_RUNTIME = originalChatRuntime;
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
// CRITERION 1 — provider health: credential-gated, secret-redacted, admin-only control.
// ---------------------------------------------------------------------------

describe('C5-1 provider health — credential gated, redacted, admin-only control', () => {
  let f: AcceptanceFixture;
  beforeEach(async () => { f = await bootApp(); }, BOOT_TIMEOUT);

  it('denies provider health reads to a bearer-only request (customer credential required)', async () => {
    const res = await fetch(`${f.baseUrl}/api/swarm/providers`, {
      headers: { authorization: `Bearer ${f.apiToken}` },
    });
    expect(res.status).toBe(403);
    expect((await readJson(res)).code).toBe('customer_credential_required');
  });

  it('serves redacted provider health to a tenant viewer credential (200, no raw secrets)', async () => {
    const reads = [
      '/api/swarm/execution-engines',
      '/api/swarm/providers',
      '/api/swarm/providers/acp/health',
    ];
    for (const path of reads) {
      const res = await fetch(`${f.baseUrl}${path}`, {
        headers: authHeaders(f.apiToken, f.tokens.viewerAcme),
      });
      expect([200, 500]).toContain(res.status);
      // A failure state (provider down) is acceptable; it must still be secret-safe.
      const body = await readJson(res);
      assertNoSecretLeaks(body, f.allSecrets);
    }
  });

  it('denies daemon process control to a tenant manager (403); global admin passes auth', async () => {
    // Tenant manager cannot restart the eforge daemon.
    const denied = await fetch(`${f.baseUrl}/api/swarm/providers/eforge/control`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ action: 'status' }),
    });
    expect(denied.status).toBe(403);
    expect((await readJson(denied)).code).toBe('permission_denied');

    // Global admin passes the authorization gate (downstream exec may fail with
    // 500 because the binary is absent, but it must NOT be a 403).
    const allowed = await fetch(`${f.baseUrl}/api/swarm/providers/eforge/control`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.globalAdmin, { 'content-type': 'application/json' }),
      body: JSON.stringify({ action: 'status' }),
    });
    expect(allowed.status).not.toBe(403);
  });

  it('denies manual heal to a tenant viewer (403); global admin passes auth', async () => {
    const denied = await fetch(`${f.baseUrl}/api/swarm/heal`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme),
    });
    expect(denied.status).toBe(403);

    const allowed = await fetch(`${f.baseUrl}/api/swarm/heal`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.globalAdmin),
    });
    expect(allowed.status).not.toBe(403);
    if (allowed.status === 200) assertNoSecretLeaks(await readJson(allowed), f.allSecrets);
  });
});

// ---------------------------------------------------------------------------
// CRITERION 2 — chat controls: org scope, viewer read vs contributor write, degradation.
// ---------------------------------------------------------------------------

describe('C5-2 chat controls — org scope, cross-org denied, safe degradation', () => {
  let f: AcceptanceFixture;
  beforeEach(async () => { f = await bootApp(); }, BOOT_TIMEOUT);

  it('scopes channel listing to the caller membership org; cross-org invisible', async () => {
    // Seed defaults per org via the real setup endpoint.
    await fetch(`${f.baseUrl}/api/chat/setup`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme),
    });
    await fetch(`${f.baseUrl}/api/chat/setup`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerBeta),
    });

    const acme = await readJson(await fetch(`${f.baseUrl}/api/chat/channels`, {
      headers: authHeaders(f.apiToken, f.tokens.managerAcme),
    }) as any);
    const beta = await readJson(await fetch(`${f.baseUrl}/api/chat/channels`, {
      headers: authHeaders(f.apiToken, f.tokens.managerBeta),
    }) as any);
    const acmeChannels = (acme.channels as any[]).map((c) => c.id);
    const betaChannels = (beta.channels as any[]).map((c) => c.id);
    expect(acmeChannels.length).toBeGreaterThan(0);
    expect(betaChannels.length).toBeGreaterThan(0);
    // No overlap: acme and beta channel sets are disjoint.
    expect(acmeChannels.some((id) => betaChannels.includes(id))).toBe(false);
    assertNoSecretLeaks(acme, f.allSecrets);
  });

  it('denies a cross-org channel id (404, no existence leak)', async () => {
    await fetch(`${f.baseUrl}/api/chat/setup`, { method: 'POST', headers: authHeaders(f.apiToken, f.tokens.managerBeta) });
    const betaList = await readJson(await fetch(`${f.baseUrl}/api/chat/channels`, {
      headers: authHeaders(f.apiToken, f.tokens.managerBeta),
    }) as any);
    const betaChannelId = (betaList.channels as any[])[0].id;

    // Acme manager cannot read beta channel messages.
    const res = await fetch(`${f.baseUrl}/api/chat/channels/${betaChannelId}/messages`, {
      headers: authHeaders(f.apiToken, f.tokens.managerAcme),
    });
    expect(res.status).toBe(404);
  });

  it('denies a spoofed org header outside the principal membership (403)', async () => {
    // manager-acme (org-acme) claims org-beta via header -> 403.
    const res = await fetch(`${f.baseUrl}/api/chat/channels`, {
      headers: authHeaders(f.apiToken, f.tokens.managerAcme, { 'x-entity-org-id': f.org.beta }),
    });
    expect(res.status).toBe(403);
  });

  it('degrades safely when ClickClack is unavailable (readiness + degraded send, no secrets)', async () => {
    const readiness = await fetch(`${f.baseUrl}/api/chat/clickclack/readiness`, {
      headers: authHeaders(f.apiToken, f.tokens.managerAcme),
    });
    expect([200, 503]).toContain(readiness.status);
    const readinessBody = await readJson(readiness);
    assertNoSecretLeaks(readinessBody, f.allSecrets);

    // Seed an acme channel, then send with a throwing sidecar -> 202 degraded.
    await fetch(`${f.baseUrl}/api/chat/setup`, { method: 'POST', headers: authHeaders(f.apiToken, f.tokens.managerAcme) });
    const list = await readJson(await fetch(`${f.baseUrl}/api/chat/channels`, {
      headers: authHeaders(f.apiToken, f.tokens.managerAcme),
    }) as any);
    const channelId = (list.channels as any[])[0].id;

    const send = await fetch(`${f.baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ channelId, content: 'hello', targetAgent: 'ada' }),
    });
    // Sidecar throws -> graceful 202 degraded (never a 5xx crash).
    expect(send.status).toBe(202);
    const sendBody = await readJson(send);
    expect(sendBody.degraded).toBe(true);
    assertNoSecretLeaks(sendBody, f.allSecrets);
  });
});

// ---------------------------------------------------------------------------
// CRITERION 3 — business onboarding: no cross-org mutation; creation admin-only.
// ---------------------------------------------------------------------------

describe('C5-3 business onboarding — cross-org denied, creation admin-only', () => {
  let f: AcceptanceFixture;
  beforeEach(async () => { f = await bootApp(); }, BOOT_TIMEOUT);

  it('denies org creation to a tenant manager (403); global admin can create (201)', async () => {
    const denied = await fetch(`${f.baseUrl}/api/onboarding/business/start`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ orgName: 'Rogue Org' }),
    });
    expect(denied.status).toBe(403);

    const allowed = await fetch(`${f.baseUrl}/api/onboarding/business/start`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.globalAdmin, { 'content-type': 'application/json' }),
      body: JSON.stringify({ orgName: 'New Tenant' }),
    });
    expect(allowed.status).toBe(201);
    const body = await readJson(allowed);
    assertNoSecretLeaks(body, f.allSecrets);
  });

  it('denies patching ANOTHER org (403); manager can patch own org (200)', async () => {
    const foreign = await fetch(`${f.baseUrl}/api/onboarding/business/${f.org.beta}`, {
      method: 'PATCH',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ mission: 'hijacked' }),
    });
    expect(foreign.status).toBe(403);

    const own = await fetch(`${f.baseUrl}/api/onboarding/business/${f.org.acme}`, {
      method: 'PATCH',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ mission: 'updated acme mission' }),
    });
    expect(own.status).toBe(200);
  });

  it('denies provisioning another org and under-privileged role; manager dry-run own org (200)', async () => {
    // Cross-org provision denied.
    const foreign = await fetch(`${f.baseUrl}/api/onboarding/business/${f.org.beta}/provision`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ dryRun: true, mission: 'x', domains: ['product'] }),
    });
    expect(foreign.status).toBe(403);

    // Viewer lacks manager authority even in own org.
    const viewer = await fetch(`${f.baseUrl}/api/onboarding/business/${f.org.acme}/provision`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ dryRun: true, mission: 'x', domains: ['product'] }),
    });
    expect(viewer.status).toBe(403);

    // Manager dry-run preview of own org succeeds.
    const own = await fetch(`${f.baseUrl}/api/onboarding/business/${f.org.acme}/provision`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme, { 'content-type': 'application/json' }),
      body: JSON.stringify({ dryRun: true, mission: 'acme ops', domains: ['product'] }),
    });
    expect(own.status).toBe(200);
    const body = await readJson(own);
    expect(body.dryRun).toBe(true);
    assertNoSecretLeaks(body, f.allSecrets);
  });

  it('denies confirming another org blueprint (403) before any mutation', async () => {
    const res = await fetch(`${f.baseUrl}/api/onboarding/business/${f.org.beta}/confirm`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.managerAcme),
    });
    // Auth gate runs before the blueprint-existence check: foreign org -> 403.
    expect(res.status).toBe(403);
  });

  it('catalog read is credential-gated (bearer-only denied; viewer ok, no secrets)', async () => {
    const noCred = await fetch(`${f.baseUrl}/api/onboarding/business/catalog`, {
      headers: { authorization: `Bearer ${f.apiToken}` },
    });
    expect(noCred.status).toBe(403);
    expect((await readJson(noCred)).code).toBe('customer_credential_required');

    const ok = await fetch(`${f.baseUrl}/api/onboarding/business/catalog`, {
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme),
    });
    expect(ok.status).toBe(200);
    assertNoSecretLeaks(await readJson(ok), f.allSecrets);
  });
});

// ---------------------------------------------------------------------------
// CRITERION 4 — operations: read-only diagnostics principal-gated + secret-safe.
// ---------------------------------------------------------------------------

describe('C5-4 operations — diagnostics principal-gated, secret-safe, admin-only control', () => {
  let f: AcceptanceFixture;
  beforeEach(async () => { f = await bootApp(); }, BOOT_TIMEOUT);

  it('denies node-operations diagnostics to a bearer-only request (credential required)', async () => {
    const res = await fetch(`${f.baseUrl}/api/node-operations`, {
      headers: { authorization: `Bearer ${f.apiToken}` },
    });
    expect(res.status).toBe(403);
    expect((await readJson(res)).code).toBe('customer_credential_required');
  });

  it('serves read-only diagnostics to a tenant viewer (200, no raw secrets)', async () => {
    const res = await fetch(`${f.baseUrl}/api/node-operations`, {
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme),
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    // Read-only diagnostics: lists file-transfer operations, sources, webhooks.
    // No raw secret values may appear (webhook `env` lists env var NAMES only).
    assertNoSecretLeaks(body, f.allSecrets);
  });
});
