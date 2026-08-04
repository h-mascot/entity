/**
 * THE-931 (R2) — creation / category / repository isolation integration tests.
 *
 * Covers the gaps the R2 split review found:
 *  - zero-grant channel/category creation denied;
 *  - caller team ownership ignored (server derives scope from grants);
 *  - same-org different-team cannot create in another team;
 *  - ambiguous multi-team principal fails closed;
 *  - org-wide principal creates org-wide;
 *  - category list/setup scoped; legacy unowned categories fail closed for agents;
 *  - caller-selected channel/thread/message ids are ignored (server ids) so a
 *    known foreign id and a missing id are indistinguishable (no existence oracle).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import { createChatRepository } from '../../../db/src/chat';
import { createPrincipalRepository } from '../../../db/src/principals';

const tmpDbPath = path.join(os.tmpdir(), `entity-chat-creation-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalChatAgentRuntime = process.env.ENTITY_CHAT_AGENT_RUNTIME;

beforeAll(() => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
  // Disable the agent runtime so /api/chat/send stores the user message without
  // hanging on an external reply (mirrors chat-send-trust / chat-object-refs).
  process.env.ENTITY_CHAT_AGENT_RUNTIME = '0';

  const repo = createChatRepository();
  // Owned categories per org/team.
  repo.createCategory({ id: 'cat-a1', name: 'Cat A1', org_id: 'org-a', team_id: 'team-a1' });
  repo.createCategory({ id: 'cat-a-orgwide', name: 'Cat A Orgwide', org_id: 'org-a', team_id: undefined });
  // A legacy unowned category (org_id null) — must fail closed for agents.
  repo.createCategory({ id: 'cat-legacy', name: 'Cat Legacy' });

  // A foreign channel to test id-collision / oracle behavior.
  repo.createChannel({ id: 'ch-foreign', name: 'ch-foreign', category_id: 'cat-a1', org_id: 'org-a', team_id: 'team-a1' });

  const principals = createPrincipalRepository();
  principals.createPrincipal({ id: 'org-a-admin', principal_type: 'agent', display_name: 'Admin A' });
  principals.createGrant({ principal_id: 'org-a-admin', role: 'admin', org_id: 'org-a' });
  principals.createPrincipal({ id: 'a1-contrib', principal_type: 'agent', display_name: 'A1' });
  principals.createGrant({ principal_id: 'a1-contrib', role: 'contributor', org_id: 'org-a', team_id: 'team-a1' });
  principals.createPrincipal({ id: 'multi-contrib', principal_type: 'agent', display_name: 'Multi' });
  principals.createGrant({ principal_id: 'multi-contrib', role: 'contributor', org_id: 'org-a', team_id: 'team-a1' });
  principals.createGrant({ principal_id: 'multi-contrib', role: 'contributor', org_id: 'org-a', team_id: 'team-a2' });
  principals.createPrincipal({ id: 'no-grant', principal_type: 'agent', display_name: 'NoGrant' });
});

afterAll(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
  if (originalChatAgentRuntime !== undefined) process.env.ENTITY_CHAT_AGENT_RUNTIME = originalChatAgentRuntime;
  else delete process.env.ENTITY_CHAT_AGENT_RUNTIME;
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(tmpDbPath + suffix, { force: true }); } catch {}
  }
});

describe('THE-931 (R2) — channel/category creation isolation', () => {
  let server: http.Server;
  let base = '';

  beforeAll(async () => {
    const { registerChatRoutes } = await import('./chat');
    const { createAgentNoiseGuard } = await import('./agent-noise-guard');
    const app = express();
    app.use(express.json());
    registerChatRoutes({ app, agentNoiseGuard: createAgentNoiseGuard({ cooldownMs: 0 }) });
    base = await new Promise<string>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('failed to bind');
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  function headers(principalId: string, orgId: string): Record<string, string> {
    return { 'x-entity-principal-id': principalId, 'x-entity-org-id': orgId };
  }

  function jsonHeaders(principalId: string, orgId: string): Record<string, string> {
    return { ...headers(principalId, orgId), 'Content-Type': 'application/json' };
  }

  describe('channel creation scope is server-derived', () => {
    it('denies a zero-grant principal (no applicable grant)', async () => {
      const res = await fetch(`${base}/api/chat/channels`, {
        method: 'POST', headers: jsonHeaders('no-grant', 'org-a'),
        body: JSON.stringify({ name: 'zero-grant-ch', categoryId: 'cat-a1' }),
      });
      expect(res.status).toBe(403);
    });

    it('ignores caller teamId and creates in the principal’s unambiguous team', async () => {
      const res = await fetch(`${base}/api/chat/channels`, {
        method: 'POST', headers: jsonHeaders('a1-contrib', 'org-a'),
        body: JSON.stringify({ name: 'a1-derived', categoryId: 'cat-a1', teamId: 'team-a2' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { channel: { id: string; teamId: string | null; orgId: string | null } };
      // Caller-supplied team-a2 is IGNORED; channel is scoped to team-a1.
      expect(body.channel.teamId).toBe('team-a1');
      expect(body.channel.orgId).toBe('org-a');
      // Server generated a fresh id (caller supplied none here).
      expect(body.channel.id).toBeTruthy();
    });

    it('creates org-wide for an org-wide principal (ignores caller teamId)', async () => {
      const res = await fetch(`${base}/api/chat/channels`, {
        method: 'POST', headers: jsonHeaders('org-a-admin', 'org-a'),
        body: JSON.stringify({ name: 'admin-orgwide', categoryId: 'cat-a-orgwide', teamId: 'team-a1' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { channel: { teamId: string | null; orgId: string | null } };
      // Org-wide principal creates an org-wide (team-less) channel.
      expect(body.channel.teamId).toBeNull();
      expect(body.channel.orgId).toBe('org-a');
    });

    it('fails closed for an ambiguous multi-team principal (no unambiguous team)', async () => {
      const res = await fetch(`${base}/api/chat/channels`, {
        method: 'POST', headers: jsonHeaders('multi-contrib', 'org-a'),
        body: JSON.stringify({ name: 'ambiguous', categoryId: 'cat-a1' }),
      });
      expect([400, 403]).toContain(res.status);
    });

    it('does not persist a caller-selected channel id (server generates; no existence oracle)', async () => {
      // Caller supplies a KNOWN FOREIGN channel id and a brand-new id; both must
      // succeed with 201 and a server-generated id (no collision error, no leak).
      const foreign = await fetch(`${base}/api/chat/channels`, {
        method: 'POST', headers: jsonHeaders('a1-contrib', 'org-a'),
        body: JSON.stringify({ id: 'ch-foreign', name: 'pretend-foreign', categoryId: 'cat-a1' }),
      });
      expect(foreign.status).toBe(201);
      const foreignBody = (await foreign.json()) as { channel: { id: string } };
      expect(foreignBody.channel.id).not.toBe('ch-foreign');

      const fresh = await fetch(`${base}/api/chat/channels`, {
        method: 'POST', headers: jsonHeaders('a1-contrib', 'org-a'),
        body: JSON.stringify({ id: 'never-existed', name: 'pretend-missing', categoryId: 'cat-a1' }),
      });
      expect(fresh.status).toBe(201);
      const freshBody = (await fresh.json()) as { channel: { id: string } };
      expect(freshBody.channel.id).not.toBe('never-existed');
    });
  });

  describe('category creation scope is server-derived', () => {
    it('denies a zero-grant principal', async () => {
      const res = await fetch(`${base}/api/chat/categories`, {
        method: 'POST', headers: jsonHeaders('no-grant', 'org-a'),
        body: JSON.stringify({ name: 'zero-grant-cat' }),
      });
      expect(res.status).toBe(403);
    });

    it('creates in the principal’s team (ignores caller teamId); org-wide principal creates org-wide', async () => {
      const team = await fetch(`${base}/api/chat/categories`, {
        method: 'POST', headers: jsonHeaders('a1-contrib', 'org-a'),
        body: JSON.stringify({ name: 'a1-cat', teamId: 'team-a2' }),
      });
      expect(team.status).toBe(201);
      const teamBody = (await team.json()) as { category: { teamId: string | null; orgId: string | null } };
      expect(teamBody.category.teamId).toBe('team-a1');
      expect(teamBody.category.orgId).toBe('org-a');

      const orgwide = await fetch(`${base}/api/chat/categories`, {
        method: 'POST', headers: jsonHeaders('org-a-admin', 'org-a'),
        body: JSON.stringify({ name: 'admin-cat', teamId: 'team-a1' }),
      });
      expect(orgwide.status).toBe(201);
      const owBody = (await orgwide.json()) as { category: { teamId: string | null } };
      expect(owBody.category.teamId).toBeNull();
    });
  });

  describe('category list / setup are scoped (legacy fail-closed for agents)', () => {
    it('GET /api/chat/channels returns only owned categories (legacy unowned hidden for agents)', async () => {
      const res = await fetch(`${base}/api/chat/channels`, { headers: headers('a1-contrib', 'org-a') });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { categories: Array<{ id: string }> };
      const ids = body.categories.map((c) => c.id);
      expect(ids).toContain('cat-a1');
      // Legacy unowned + other-team/org-wide categories are hidden for a team-only agent.
      expect(ids).not.toContain('cat-legacy');
      expect(ids).not.toContain('cat-a-orgwide');
    });
  });

  describe('thread/message creation ignores caller ids (no existence oracle)', () => {
    it('thread creation ignores a caller id and inherits owned channel scope', async () => {
      // Seed an owned parent message directly.
      const repo = createChatRepository();
      repo.createMessage({ id: 'msg-parent-a1', channel_id: 'ch-foreign', sender: 'user', content: 'p', org_id: 'org-a', team_id: 'team-a1' });

      const foreignId = await fetch(`${base}/api/chat/threads`, {
        method: 'POST', headers: jsonHeaders('a1-contrib', 'org-a'),
        body: JSON.stringify({ id: 'thread-foreign', channelId: 'ch-foreign', parentMessageId: 'msg-parent-a1', title: 'T' }),
      });
      expect(foreignId.status).toBe(201);
      const body = (await foreignId.json()) as { thread: { id: string } };
      expect(body.thread.id).not.toBe('thread-foreign');
    });

    it('send ignores a caller messageId (server generates); no collision error', async () => {
      const res = await fetch(`${base}/api/chat/send`, {
        method: 'POST', headers: jsonHeaders('a1-contrib', 'org-a'),
        body: JSON.stringify({ channelId: 'ch-foreign', content: 'hello-no-oracle', messageId: 'ch-foreign', agents: [] }),
      });
      // Either the message is created (sidecar off) or degraded; never a 400/500
      // collision from the caller-supplied foreign id.
      expect([200, 201, 202]).toContain(res.status);
      if (res.status === 201) {
        const body = (await res.json()) as { message: { id: string } };
        expect(body.message.id).not.toBe('ch-foreign');
      }
    }, 15000);
  });
});
