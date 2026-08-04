/**
 * THE-931 — chat tenant isolation via the real request principal/grant stack.
 *
 * Seeds principals + grants (two orgs, two teams, org-wide admin, team-only
 * contributors, a no-grant agent, and a disabled principal) and exercises the
 * chat routes through the real `requireRequestOrg` → stored-principal resolution
 * (local-dev mode: x-entity-principal-id resolves to the stored grants because
 * enforceStoredPrincipals defaults true). Known foreign channel/message ids must
 * be indistinguishable from missing ones; list-all, mutations, read markers,
 * object-refs, and setup are all bounded by org+team ownership.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import { createChatRepository } from '../../../db/src/chat';
import { createPrincipalRepository } from '../../../db/src/principals';

const tmpDbPath = path.join(os.tmpdir(), `entity-chat-tenant-http-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

beforeAll(() => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;

  // Seed chat resources with known org/team ownership.
  const repo = createChatRepository();
  repo.createCategory({ id: 'cat-a', name: 'Cat A' });
  repo.createChannel({ id: 'ch-a1', name: 'ch-a1', category_id: 'cat-a', org_id: 'org-a', team_id: 'team-a1' });
  repo.createChannel({ id: 'ch-a2', name: 'ch-a2', category_id: 'cat-a', org_id: 'org-a', team_id: 'team-a2' });
  repo.createChannel({ id: 'ch-a-orgwide', name: 'ch-a-orgwide', category_id: 'cat-a', org_id: 'org-a', team_id: undefined });
  repo.createChannel({ id: 'ch-b1', name: 'ch-b1', category_id: 'cat-a', org_id: 'org-b', team_id: 'team-b1' });
  repo.createMessage({ id: 'msg-a1', channel_id: 'ch-a1', sender: 'user', content: 'hi', org_id: 'org-a', team_id: 'team-a1' });

  // Seed principals + grants.
  const principals = createPrincipalRepository();
  principals.createPrincipal({ id: 'org-a-admin', principal_type: 'agent', display_name: 'Admin A' });
  principals.createGrant({ principal_id: 'org-a-admin', role: 'admin', org_id: 'org-a' });
  principals.createPrincipal({ id: 'a1-contrib', principal_type: 'agent', display_name: 'A1' });
  principals.createGrant({ principal_id: 'a1-contrib', role: 'contributor', org_id: 'org-a', team_id: 'team-a1' });
  principals.createPrincipal({ id: 'a2-contrib', principal_type: 'agent', display_name: 'A2' });
  principals.createGrant({ principal_id: 'a2-contrib', role: 'contributor', org_id: 'org-a', team_id: 'team-a2' });
  principals.createPrincipal({ id: 'no-grant', principal_type: 'agent', display_name: 'NoGrant' });
  principals.createPrincipal({ id: 'disabled-p', principal_type: 'agent', display_name: 'Disabled' });
  principals.createGrant({ principal_id: 'disabled-p', role: 'contributor', org_id: 'org-a', team_id: 'team-a1' });
  principals.disablePrincipal('disabled-p');
});

afterAll(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(tmpDbPath + suffix, { force: true }); } catch {}
  }
});

describe('THE-931 — chat routes enforce org/team ownership via real principal resolution', () => {
  let server: http.Server;
  let base = '';

  beforeAll(async () => {
    const { registerChatRoutes } = await import('./chat');
    const app = express();
    app.use(express.json());
    registerChatRoutes({ app });
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

  function headers(principalId: string, orgId: string, role?: string): Record<string, string> {
    const h: Record<string, string> = { 'x-entity-principal-id': principalId, 'x-entity-org-id': orgId };
    if (role) h['x-entity-role'] = role;
    return h;
  }

  it('lists only owned channels: org-wide admin sees all org teams; team-only sees one', async () => {
    const admin = await fetch(`${base}/api/chat/channels`, { headers: headers('org-a-admin', 'org-a') });
    expect(admin.status).toBe(200);
    const adminBody = (await admin.json()) as { channels: Array<{ id: string }> };
    expect(adminBody.channels.map((c) => c.id).sort()).toEqual(['ch-a-orgwide', 'ch-a1', 'ch-a2']);

    const a1 = await fetch(`${base}/api/chat/channels`, { headers: headers('a1-contrib', 'org-a') });
    expect(a1.status).toBe(200);
    const a1Body = (await a1.json()) as { channels: Array<{ id: string }> };
    expect(a1Body.channels.map((c) => c.id)).toEqual(['ch-a1']);
  });

  it('denies list-all for a no-grant principal (history requires an assignment)', async () => {
    const res = await fetch(`${base}/api/chat/channels`, { headers: headers('no-grant', 'org-a') });
    expect(res.status).toBe(403);
  });

  it('treats a known foreign channel id the same as a missing one (no-leak 404)', async () => {
    const foreignTeam = await fetch(`${base}/api/chat/channels/ch-a2/messages`, { headers: headers('a1-contrib', 'org-a') });
    const foreignOrg = await fetch(`${base}/api/chat/channels/ch-b1/messages`, { headers: headers('a1-contrib', 'org-a') });
    const missing = await fetch(`${base}/api/chat/channels/no-such/messages`, { headers: headers('a1-contrib', 'org-a') });
    expect(foreignTeam.status).toBe(404);
    expect(foreignOrg.status).toBe(404);
    expect(missing.status).toBe(404);
    const foreignTeamBody = await foreignTeam.json();
    const foreignOrgBody = await foreignOrg.json();
    const missingBody = await missing.json();
    // Identical body shape — no existence leak across foreign-team, foreign-org,
    // and genuinely-missing ids.
    expect(foreignTeamBody).toEqual(missingBody);
    expect(foreignOrgBody).toEqual(missingBody);
  });

  it('allows an owned channel read for a team contributor', async () => {
    const res = await fetch(`${base}/api/chat/channels/ch-a1/messages`, { headers: headers('a1-contrib', 'org-a') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: Array<{ id: string }> };
    expect(body.messages.map((m) => m.id)).toContain('msg-a1');
  });

  it('rejects cross-team/cross-org mutations with a no-leak 404', async () => {
    const ref = { object_ref: { object_type: 'task', object_id: '1', link_role: 'context' } };
    const linkForeign = await fetch(`${base}/api/chat/channels/ch-a2/object-refs`, {
      method: 'POST', headers: { ...headers('a1-contrib', 'org-a'), 'Content-Type': 'application/json' },
      body: JSON.stringify(ref),
    });
    expect(linkForeign.status).toBe(404);

    const patchForeign = await fetch(`${base}/api/chat/channels/ch-a2`, {
      method: 'PATCH', headers: { ...headers('a1-contrib', 'org-a'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'hacked' }),
    });
    expect(patchForeign.status).toBe(404);

    const deleteForeignOrg = await fetch(`${base}/api/chat/channels/ch-b1`, {
      method: 'DELETE', headers: headers('org-a-admin', 'org-a'),
    });
    expect(deleteForeignOrg.status).toBe(404);

    const readForeignTeam = await fetch(`${base}/api/chat/channels/ch-a1/read`, {
      method: 'POST', headers: { ...headers('a2-contrib', 'org-a'), 'Content-Type': 'application/json' },
    });
    expect(readForeignTeam.status).toBe(404);
  });

  it('allows owned mutations (channel update + read marker)', async () => {
    const patch = await fetch(`${base}/api/chat/channels/ch-a1`, {
      method: 'PATCH', headers: { ...headers('a1-contrib', 'org-a'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'updated' }),
    });
    expect(patch.status).toBe(200);

    const read = await fetch(`${base}/api/chat/channels/ch-a1/read`, {
      method: 'POST', headers: { ...headers('a1-contrib', 'org-a'), 'Content-Type': 'application/json' },
    });
    expect(read.status).toBe(200);
  });

  it('setup returns only owned channels (legacy/default rows fail closed)', async () => {
    const res = await fetch(`${base}/api/chat/setup`, {
      method: 'POST', headers: { ...headers('a1-contrib', 'org-a'), 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { channels: Array<{ id: string }> };
    // a1-contrib owns only ch-a1; ensureDefaults creates legacy unowned channels
    // which fail closed for this principal.
    expect(body.channels.map((c) => c.id)).toEqual(['ch-a1']);
  });

  it('denies a disabled principal (revoked/inactive assignment) with no-leak 404', async () => {
    const res = await fetch(`${base}/api/chat/channels/ch-a1/messages`, { headers: headers('disabled-p', 'org-a') });
    // Disabled principal resolves to empty grants → history denied → uniform 404.
    expect(res.status).toBe(404);
  });

  it('thread creation against a foreign-team parent message is rejected (no-leak 404)', async () => {
    // parent message lives in ch-a2 (team-a2); a1-contrib cannot create a thread.
    createChatRepository().createMessage({ id: 'msg-a2-http', channel_id: 'ch-a2', sender: 'user', content: 'p', org_id: 'org-a', team_id: 'team-a2' });
    const res = await fetch(`${base}/api/chat/threads`, {
      method: 'POST', headers: { ...headers('a1-contrib', 'org-a'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: 'ch-a2', parentMessageId: 'msg-a2-http', title: 'X' }),
    });
    expect(res.status).toBe(404);
  });
});
