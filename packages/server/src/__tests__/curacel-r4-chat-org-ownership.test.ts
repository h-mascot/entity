/**
 * Curacel pilot — R4: durable org ownership of chat (categories/channels/
 * threads/messages). Production-composed regression.
 *
 * REAL middleware (api-auth + customer-principal), REAL chat routes
 * (registerChatRoutes with getTaskOrg wired to a REAL taskSyncLayer), REAL chat
 * repository backed by an isolated temp SQLite DB, two orgs and distinct
 * per-customer credentials. Principal resolution and tenant binding are NOT
 * mocked.
 *
 * Proves the R4 rejection is closed: a customer presenting a VALID own-org
 * scope still cannot read or mutate a KNOWN cross-org channel/thread/message id,
 * cannot enumerate foreign channels, cannot send/mutate into them, and cannot
 * see legacy workspace-global (unowned) rows. Writes inherit the parent org and
 * ignore caller-selected ownership. Unknown task ids fail closed (no fall-through
 * to channel disclosure). Org spoofing is 403; an ambiguous/omitted scope for a
 * multi-org principal fails closed 400. The trusted service/admin path and a
 * global admin remain unrestricted.
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
import { createDataPlaneCredentialGuard } from '../middleware/data-plane-credential';
import { registerChatRoutes } from '../routes/chat';
import { createAccessTokenRepository } from '../../../db/src/access-tokens';
import { createPrincipalRepository } from '../../../db/src/principals';

interface Fixture {
  baseUrl: string;
  apiToken: string;
  tokens: { memberAcme: string; memberBeta: string; memberAcmeBeta: string; globalAdmin: string };
  org: { acme: string; beta: string };
  acmeChannelId: string;
  betaChannelId: string;
  betaCategoryId: string;
  acmeMessageId: string;
  betaMessageId: string;
  acmeThreadId: string;
  betaThreadId: string;
  unownedChannelId: string;
  unownedMessageId: string;
  acmeTaskId: number;
  betaTaskId: number;
  countMessages: (channelId: string, orgId?: string) => number;
  getChannel: (id: string, orgId?: string) => { org_id: string | null } | undefined;
  server: http.Server;
}

let server: http.Server | null = null;
const cleanupPaths: string[] = [];
const originalToken = process.env.ENTITY_API_TOKEN;
const originalPrincipal = process.env.ENTITY_API_PRINCIPAL_ID;
const originalAgentRuntime = process.env.ENTITY_CHAT_AGENT_RUNTIME;

function tempDbPath(): string {
  return path.join(os.tmpdir(), `curacel-r4-chat-${process.pid}-${randomUUID()}.sqlite`);
}

function removeSqliteFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(file, { force: true });
}

async function readJson(res: Response): Promise<any> {
  return (await res.json()) as any;
}

function authHeaders(apiToken: string, customerToken?: string, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' };
  if (customerToken) headers['x-entity-access-token'] = customerToken;
  return { ...headers, ...extra };
}

async function postJson(baseUrl: string, pathname: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function bootApp(): Promise<Fixture> {
  const dbPath = tempDbPath();
  cleanupPaths.push(dbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('ENTITY_CHAT_AGENT_RUNTIME', '0');
  vi.stubEnv('MISSION_CONTROL_DB_PATH', path.join(os.tmpdir(), `missing-${randomUUID()}`));
  vi.stubEnv('ENTITY_DB_MODE', 'LOCAL');

  const apiToken = `r4-${randomUUID()}`;
  process.env.ENTITY_API_TOKEN = apiToken;

  const dbModule = await import('../../../db/src');
  const { createTaskSyncLayer } = await import('../../../db/src/task-sync');
  const { createChatRepository } = await import('../../../db/src/chat');

  const workspaceRepo = dbModule.createWorkspaceScopeRepository();
  const principalRepo = createPrincipalRepository();
  const tokenRepo = createAccessTokenRepository();
  const taskSyncLayer = createTaskSyncLayer();

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
  mkPrincipal('member-acme-beta', 'Acme+Beta Member');
  principalRepo.createGrant({ principal_id: 'member-acme-beta', role: 'contributor', org_id: 'org-acme' });
  principalRepo.createGrant({ principal_id: 'member-acme-beta', role: 'contributor', org_id: 'org-beta' });
  mkPrincipal('global-admin', 'Global Admin');
  principalRepo.createGrant({ principal_id: 'global-admin', role: 'admin' });
  mkPrincipal('svc-admin', 'Service Admin', 'service_account');
  principalRepo.createGrant({ principal_id: 'svc-admin', role: 'admin' });
  process.env.ENTITY_API_PRINCIPAL_ID = 'svc-admin';

  const mkToken = (pid: string) => tokenRepo.createToken({ principal_id: pid }).token;
  const tokens = {
    memberAcme: mkToken('member-acme'),
    memberBeta: mkToken('member-beta'),
    memberAcmeBeta: mkToken('member-acme-beta'),
    globalAdmin: mkToken('global-admin'),
  };

  const acmeTaskRepo = dbModule.createOrgScopedTaskRepository({ orgId: 'org-acme', teamId: 'team-acme' });
  const betaTaskRepo = dbModule.createOrgScopedTaskRepository({ orgId: 'org-beta', teamId: 'team-beta' });
  const acmeTask = acmeTaskRepo.createTask({ name: 'Acme Task', column: 'todo', assignee: 'agent-acme' } as any);
  const betaTask = betaTaskRepo.createTask({ name: 'Beta Task', column: 'todo', assignee: 'agent-beta' } as any);

  const app = express();
  app.use(express.json());
  app.use(createApiAuthMiddleware());
  app.use(createCustomerPrincipalMiddleware(tokenRepo));
  // Terra R1: centralized customer data-plane credential guard (mirrors
  // production composition). Shared bearer is transport only; chat is
  // data-plane and requires a valid x-entity-access-token.
  app.use(createDataPlaneCredentialGuard());
  registerChatRoutes({
    app,
    getTaskOrg: async (taskId) => (await taskSyncLayer.getTask(Number(taskId)))?.org_id ?? null,
  });

  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // R1: workspace-GLOBAL (unowned) defaults + message are seeded directly via
  // the chat repository. The prior bearer-only HTTP provisioning can no longer
  // reach the data plane (shared bearer is transport only), so the trusted
  // bootstrap is materialized at the repository layer instead. This mirrors
  // ensureDefaults(undefined) for the command-deck channel the suite asserts on.
  const chatRepo = createChatRepository();
  chatRepo.createCategory({ id: 'general', name: 'General', emoji: '💬', order: 0, org_id: null });
  chatRepo.createChannel({ id: 'command-deck', name: 'command-deck', category_id: 'general', order: 0, agents: [], org_id: null });
  chatRepo.createMessage({ id: 'unowned-msg-1', channel_id: 'command-deck', sender: 'book', content: 'unowned seed message', org_id: null });
  const unownedMessageId = 'unowned-msg-1';

  // Per-org provisioning + same-org messages/threads for both customers.
  const acmeSetup = await readJson(await postJson(baseUrl, '/api/chat/setup', authHeaders(apiToken, tokens.memberAcme), {}));
  const betaSetup = await readJson(await postJson(baseUrl, '/api/chat/setup', authHeaders(apiToken, tokens.memberBeta), {}));
  const acmeChannelId = (acmeSetup.channels as Array<{ id: string; name: string }>).find((c) => c.name === 'command-deck')!.id;
  const betaChannelId = (betaSetup.channels as Array<{ id: string; name: string }>).find((c) => c.name === 'command-deck')!.id;
  const betaCategoryId = (betaSetup.categories as Array<{ id: string; name: string }>).find((c) => c.name === 'General')!.id;

  const acmeSend = await readJson(await postJson(baseUrl, '/api/chat/send', authHeaders(apiToken, tokens.memberAcme), {
    channelId: acmeChannelId,
    targetAgent: 'book',
    agents: ['book'],
    content: 'acme message',
    messageId: 'acme-msg-1',
  }));
  const acmeMessageId = acmeSend.message.id as string;

  const betaSend = await readJson(await postJson(baseUrl, '/api/chat/send', authHeaders(apiToken, tokens.memberBeta), {
    channelId: betaChannelId,
    targetAgent: 'book',
    agents: ['book'],
    content: 'beta message',
    messageId: 'beta-msg-1',
  }));
  const betaMessageId = betaSend.message.id as string;

  const acmeThread = await readJson(await postJson(baseUrl, '/api/chat/threads', authHeaders(apiToken, tokens.memberAcme), {
    channelId: acmeChannelId,
    parentMessageId: acmeMessageId,
    title: 'Acme thread',
  }));
  const betaThread = await readJson(await postJson(baseUrl, '/api/chat/threads', authHeaders(apiToken, tokens.memberBeta), {
    channelId: betaChannelId,
    parentMessageId: betaMessageId,
    title: 'Beta thread',
  }));
  const acmeThreadId = acmeThread.thread.id as string;
  const betaThreadId = betaThread.thread.id as string;

  const repo = createChatRepository();

  return {
    baseUrl,
    apiToken,
    tokens,
    org: { acme: 'org-acme', beta: 'org-beta' },
    acmeChannelId,
    betaChannelId,
    betaCategoryId,
    acmeMessageId,
    betaMessageId,
    acmeThreadId,
    betaThreadId,
    unownedChannelId: 'command-deck',
    unownedMessageId,
    acmeTaskId: acmeTask.id,
    betaTaskId: betaTask.id,
    countMessages: (channelId, orgId) => repo.listMessagesByChannel(channelId, orgId).length,
    getChannel: (id, orgId) => repo.getChannel(id, orgId) as { org_id: string | null } | undefined,
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
  if (originalAgentRuntime === undefined) delete process.env.ENTITY_CHAT_AGENT_RUNTIME;
  else process.env.ENTITY_CHAT_AGENT_RUNTIME = originalAgentRuntime;
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const p of cleanupPaths) removeSqliteFiles(p);
  cleanupPaths.length = 0;
});

// ---------------------------------------------------------------------------
// R4-a: list endpoints are org-scoped (no foreign, no legacy-unowned leak).
// ---------------------------------------------------------------------------

describe('R4 — chat listings are tenant-scoped', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('GET /channels lists only the caller\'s own-org channels', async () => {
    const acme = await readJson(await fetch(`${f.baseUrl}/api/chat/channels`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) }));
    const beta = await readJson(await fetch(`${f.baseUrl}/api/chat/channels`, { headers: authHeaders(f.apiToken, f.tokens.memberBeta) }));
    const acmeIds = (acme.channels as any[]).map((c) => c.id);
    const betaIds = (beta.channels as any[]).map((c) => c.id);
    expect(acmeIds).toContain(f.acmeChannelId);
    expect(acmeIds).not.toContain(f.betaChannelId);
    expect(acmeIds).not.toContain(f.unownedChannelId); // legacy-unowned fails closed
    expect(betaIds).toContain(f.betaChannelId);
    expect(betaIds).not.toContain(f.acmeChannelId);
    expect(betaIds).not.toContain(f.unownedChannelId);
  });

  it('GET /channels/:id/messages of a foreign channel is 404 (valid own-org scope)', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/channels/${f.betaChannelId}/messages`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(res.status).toBe(404);
  });

  it('GET /channels/:id/threads of a foreign channel is 404', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/channels/${f.betaChannelId}/threads`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// R4-b: known foreign thread/message ids are denied with a valid own-org scope.
// ---------------------------------------------------------------------------

describe('R4 — foreign chat ids deny reads despite valid own-org scope', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('GET /messages/:id of a foreign message is 404', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/messages/${f.betaMessageId}`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(res.status).toBe(404);
  });

  it('GET /threads/:id/messages of a foreign thread is 404', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/threads/${f.betaThreadId}/messages`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(res.status).toBe(404);
  });

  it('GET /threads/by-parent/:id of a foreign parent message is 404', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/threads/by-parent/${f.betaMessageId}`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(res.status).toBe(404);
  });

  it('GET /threads/:id/object-refs of a foreign thread is 404', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/threads/${f.betaThreadId}/object-refs`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(res.status).toBe(404);
  });

  it('same-org message/thread reads succeed', async () => {
    const msg = await fetch(`${f.baseUrl}/api/chat/messages/${f.acmeMessageId}`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    const thr = await fetch(`${f.baseUrl}/api/chat/threads/${f.acmeThreadId}/messages`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(msg.status).toBe(200);
    expect(thr.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// R4-c: mutations + send into foreign objects are denied with NO durable change.
// ---------------------------------------------------------------------------

describe('R4 — foreign chat mutations deny with no durable change', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('POST /send into a foreign channel is 404 and creates no message', async () => {
    const before = f.countMessages(f.betaChannelId, f.org.beta);
    const res = await postJson(f.baseUrl, '/api/chat/send', authHeaders(f.apiToken, f.tokens.memberAcme), {
      channelId: f.betaChannelId,
      targetAgent: 'book',
      agents: ['book'],
      content: 'acme leak attempt',
      messageId: 'acme-leak-1',
    });
    expect(res.status).toBe(404);
    expect(f.countMessages(f.betaChannelId, f.org.beta)).toBe(before);
  });

  it('PATCH a foreign channel is 404 and does not mutate', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/channels/${f.betaChannelId}`, {
      method: 'PATCH',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme),
      body: JSON.stringify({ name: 'hijacked-by-acme' }),
    });
    expect(res.status).toBe(404);
    expect(f.getChannel(f.betaChannelId, f.org.beta)?.org_id).toBe(f.org.beta);
  });

  it('DELETE a foreign channel is 404 and the channel survives', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/channels/${f.betaChannelId}`, { method: 'DELETE', headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(res.status).toBe(404);
    expect(f.getChannel(f.betaChannelId, f.org.beta)).toBeTruthy();
  });

  it('POST /channels/:id/read on a foreign channel is 404', async () => {
    const res = await postJson(f.baseUrl, `/api/chat/channels/${f.betaChannelId}/read`, authHeaders(f.apiToken, f.tokens.memberAcme), {});
    expect(res.status).toBe(404);
  });

  it('POST /threads under a foreign channel is 404 and creates no thread', async () => {
    const res = await postJson(f.baseUrl, '/api/chat/threads', authHeaders(f.apiToken, f.tokens.memberAcme), {
      channelId: f.betaChannelId,
      parentMessageId: f.betaMessageId,
      title: 'acme thread on beta',
    });
    expect(res.status).toBe(404);
  });

  it('POST object-ref link to a foreign channel is 404 and never mutates', async () => {
    const res = await postJson(f.baseUrl, `/api/chat/channels/${f.betaChannelId}/object-refs`, authHeaders(f.apiToken, f.tokens.memberAcme), {
      object_ref: { object_type: 'task', object_id: String(f.acmeTaskId), link_role: 'chat_context' },
    });
    expect(res.status).toBe(404);
  });

  it('same-org send succeeds and inherits the caller org', async () => {
    const res = await postJson(f.baseUrl, '/api/chat/send', authHeaders(f.apiToken, f.tokens.memberAcme), {
      channelId: f.acmeChannelId,
      targetAgent: 'book',
      agents: ['book'],
      content: 'acme ok',
      messageId: 'acme-ok-1',
    });
    expect(res.status).toBe(201);
    expect(f.getChannel(f.acmeChannelId, f.org.acme)?.org_id).toBe(f.org.acme);
  });
});

// ---------------------------------------------------------------------------
// R4-d: writes inherit the parent org and ignore caller-selected ownership.
// ---------------------------------------------------------------------------

describe('R4 — writes inherit parent org, ignore caller-selected ownership', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('POST /categories stamps the caller org and is invisible cross-org', async () => {
    const res = await postJson(f.baseUrl, '/api/chat/categories', authHeaders(f.apiToken, f.tokens.memberAcme), {
      id: 'acme-cat-1',
      name: 'Acme Custom',
    });
    expect(res.status).toBe(201);
    // Visible to acme, NOT to beta (ownership = caller org, never caller body).
    const acme = await readJson(await fetch(`${f.baseUrl}/api/chat/channels`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) }));
    const beta = await readJson(await fetch(`${f.baseUrl}/api/chat/channels`, { headers: authHeaders(f.apiToken, f.tokens.memberBeta) }));
    expect((acme.categories as any[]).some((c) => c.id === 'acme-cat-1')).toBe(true);
    expect((beta.categories as any[]).some((c) => c.id === 'acme-cat-1')).toBe(false);
  });

  it('a spoofed out-of-membership body org_id is rejected (403), never honored', async () => {
    const res = await postJson(f.baseUrl, '/api/chat/categories', authHeaders(f.apiToken, f.tokens.memberAcme), {
      id: 'acme-cat-spoof',
      name: 'Acme Spoof',
      org_id: f.org.beta,
    });
    expect(res.status).toBe(403);
  });

  it('a multi-org principal creating a category under an explicit valid org owns it under that org', async () => {
    const res = await postJson(f.baseUrl, '/api/chat/categories', authHeaders(f.apiToken, f.tokens.memberAcmeBeta, { 'x-entity-org-id': f.org.beta }), {
      id: 'beta-cat-multi',
      name: 'Beta Multi Custom',
    });
    expect(res.status).toBe(201);
    const beta = await readJson(await fetch(`${f.baseUrl}/api/chat/channels`, { headers: authHeaders(f.apiToken, f.tokens.memberBeta) }));
    const acme = await readJson(await fetch(`${f.baseUrl}/api/chat/channels`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) }));
    expect((beta.categories as any[]).some((c) => c.id === 'beta-cat-multi')).toBe(true);
    expect((acme.categories as any[]).some((c) => c.id === 'beta-cat-multi')).toBe(false);
  });

  it('POST /channels under a foreign category is 404 (cannot host a caller channel)', async () => {
    // Acme category is invisible to beta; beta cannot create a channel under it.
    const res = await postJson(f.baseUrl, '/api/chat/channels', authHeaders(f.apiToken, f.tokens.memberBeta), {
      categoryId: `${f.org.acme}::general`,
      name: 'beta-on-acme-category',
    });
    expect(res.status).toBe(404);
  });

  it('PATCH own channel to a FOREIGN category id is 404 and leaves categoryId unchanged', async () => {
    const before = f.getChannel(f.acmeChannelId, f.org.acme);
    expect(before).toBeTruthy();
    const beforeCategory = (before as any).category_id;

    const res = await fetch(`${f.baseUrl}/api/chat/channels/${f.acmeChannelId}`, {
      method: 'PATCH',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme),
      body: JSON.stringify({ category_id: f.betaCategoryId }),
    });
    expect(res.status).toBe(404);

    const after = f.getChannel(f.acmeChannelId, f.org.acme);
    expect(after).toBeTruthy();
    expect((after as any).category_id).toBe(beforeCategory);
  });
});

// ---------------------------------------------------------------------------
// R4-e: legacy-unowned rows fail closed for customers; task route closes holes.
// ---------------------------------------------------------------------------

describe('R4 — legacy unowned + task-derived chat fail closed for customers', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('GET /messages/:id of a legacy-unowned message is 404 for a customer', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/messages/${f.unownedMessageId}`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(res.status).toBe(404);
  });

  it('a customer cannot read messages of a legacy-unowned channel', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/channels/${f.unownedChannelId}/messages`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(res.status).toBe(404);
  });

  it('GET /task/:taskId 404s on an UNKNOWN task id (no fall-through)', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/task/9999999`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(res.status).toBe(404);
  });

  it('GET /task/:taskId 404s on a FOREIGN (org-B) task id', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/task/${f.betaTaskId}`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(res.status).toBe(404);
  });

  it('GET /task/:taskId resolves same-org (no channel yet -> channel null, not 404)', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/task/${f.acmeTaskId}`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme) });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.channel).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R4-f: org spoofing + ambiguous scope fail closed; trusted path preserved.
// ---------------------------------------------------------------------------

describe('R4 — spoofing, ambiguity, trusted path', () => {
  let f: Fixture;
  beforeEach(async () => { f = await bootApp(); });

  it('org-A customer spoofing x-entity-org-id: org-B is 403', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/channels`, { headers: authHeaders(f.apiToken, f.tokens.memberAcme, { 'x-entity-org-id': f.org.beta }) });
    expect(res.status).toBe(403);
  });

  it('a multi-org principal with NO scope is 400 (ambiguous)', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/channels`, { headers: authHeaders(f.apiToken, f.tokens.memberAcmeBeta) });
    expect(res.status).toBe(400);
  });

  it('a multi-org principal narrowing to one valid scope lists only that org', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/channels`, { headers: authHeaders(f.apiToken, f.tokens.memberAcmeBeta, { 'x-entity-org-id': f.org.beta }) });
    expect(res.status).toBe(200);
    const ids = ((await readJson(res)).channels as any[]).map((c) => c.id);
    expect(ids).toContain(f.betaChannelId);
    expect(ids).not.toContain(f.acmeChannelId);
  });

  it('R1: shared-bearer-only chat channels request is denied (customer credential required)', async () => {
    // Terra R1: the shared bearer is transport only. A bearer-only request to
    // the chat data plane is denied and never downgrades to the trusted-service
    // identity. Workspace-global unowned rows therefore cannot be reached by a
    // shared bearer holder; the control-plane preservation is proven in
    // curacel-r1-customer-dataplane-credential.
    const res = await fetch(`${f.baseUrl}/api/chat/channels`, { headers: authHeaders(f.apiToken) });
    expect(res.status).toBe(403);
    expect((await readJson(res)).code).toBe('customer_credential_required');
  });

  it('global-admin customer credential is unrestricted across orgs', async () => {
    const res = await fetch(`${f.baseUrl}/api/chat/channels`, { headers: authHeaders(f.apiToken, f.tokens.globalAdmin, { 'x-entity-org-id': f.org.beta }) });
    expect(res.status).toBe(200);
    const ids = ((await readJson(res)).channels as any[]).map((c) => c.id);
    expect(ids).toContain(f.betaChannelId);
  });
});
