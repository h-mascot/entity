import { randomUUID } from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatNoiseControlRouter } from './chat-noise-controls';

const dbPaths: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()))));
  try {
    const { getEntityDatabase } = await import('../../../db/src/entity-db');
    getEntityDatabase().close();
  } catch {}
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of dbPaths.splice(0)) {
    for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      fs.rmSync(candidate, { force: true });
    }
  }
});

async function setup() {
  const dbPath = path.join(os.tmpdir(), `entity-chat-noise-route-${randomUUID()}.sqlite`);
  dbPaths.push(dbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  const db = await import('../../../db/src');
  const chat = db.createChatRepository();
  const history = db.createChatHistoryAccessRepository();
  const imports = db.createAgentImportRepository();
  const noise = db.createChatNoiseControlRepository();
  chat.createCategory({ id: 'category-a', name: 'Category A' });
  chat.createChannel({
    id: 'channel-a',
    name: 'Channel A',
    category_id: 'category-a',
    agents: ['agent-a'],
  });
  history.upsertChannelScope({
    org_id: 'org-a',
    team_id: 'team-a',
    channel_id: 'channel-a',
    scoped_by_user_id: 'operator-a',
  });
  imports.upsertMapping({
    org_id: 'org-a',
    source: 'runtime-fleet',
    external_id: 'agent-a',
    agent_id: 'agent-a',
    team_ids: ['team-a'],
    module_ids: [],
    channel_ids: ['channel-a'],
    review_policy: { required: false, human_gate_required: false },
    imported_by_user_id: 'operator-a',
  });
  // Luna-high F6: agent-b is imported by ANOTHER organization (org-b); a
  // cooldown row for it must not be clearable through org-a's management
  // route just because the channel scope is org-a's.
  imports.upsertMapping({
    org_id: 'org-b',
    source: 'runtime-fleet',
    external_id: 'agent-b',
    agent_id: 'agent-b',
    team_ids: ['team-b'],
    module_ids: [],
    channel_ids: [],
    review_policy: { required: false, human_gate_required: false },
    imported_by_user_id: 'operator-b',
  });

  const app = express();
  app.use(express.json());
  app.use('/api', createChatNoiseControlRouter({
    noiseRepo: noise,
    historyAccessRepo: history,
    importRepo: imports,
    chatRepo: chat,
    skipAdminAuth: true,
  }));
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  const request = async (pathname: string, init: RequestInit = {}) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${pathname}`, init);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  return { noise, request };
}

const json = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('chat noise-control real repository routes', () => {
  it('configures and clears cooldown and mute policies with audit records', async () => {
    const ctx = await setup();
    const cooldownPath = '/orgs/org-a/chat-noise-controls/channels/channel-a/agents/agent-a/cooldown';
    expect((await ctx.request(cooldownPath, json({ cooldownSeconds: 60 }))).status).toBe(200);
    expect(ctx.noise.getCooldown('org-a', 'channel-a', 'agent-a')).toMatchObject({
      cooldown_seconds: 60,
    });
    const cleared = await ctx.request(cooldownPath, { method: 'DELETE' });
    expect(cleared).toMatchObject({ status: 200, body: { cleared: true } });
    expect(ctx.noise.getCooldown('org-a', 'channel-a', 'agent-a')).toBeUndefined();

    const channelMutePath = '/orgs/org-a/chat-noise-controls/channels/channel-a/mute';
    expect((await ctx.request(channelMutePath, json({ muted: true, reason: 'Pause' }))).status).toBe(200);
    expect(ctx.noise.getActiveChannelMute('org-a', 'channel-a', 'team-a')).toBeDefined();
    expect((await ctx.request(channelMutePath, json({ muted: false, reason: 'Resume' }))).status).toBe(200);
    expect(ctx.noise.getActiveChannelMute('org-a', 'channel-a', 'team-a')).toBeUndefined();

    const audit = await ctx.request('/orgs/org-a/chat-noise-controls/audit');
    expect(audit.status).toBe(200);
    expect(audit.body.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'cooldown_configured' }),
      expect.objectContaining({ action: 'cooldown_cleared' }),
      expect.objectContaining({ action: 'mute_set' }),
      expect.objectContaining({ action: 'mute_cleared' }),
    ]));
  });

  // Luna-high F6: cooldown deletion must apply the same agent mapping/org/team
  // validation as creation. A cooldown for an agent imported by another
  // organization must survive a delete issued through this org's route.
  it('refuses to clear a cooldown for an agent mapped to another organization', async () => {
    const ctx = await setup();
    // The foreign-agent cooldown exists in org-a's channel namespace (e.g.
    // written by the automated noise engine before the mapping moved, or by a
    // pre-validation writer).
    ctx.noise.configureCooldown({
      org_id: 'org-a',
      team_id: 'team-a',
      channel_id: 'channel-a',
      agent_id: 'agent-b',
      cooldown_seconds: 300,
      configured_by_user_id: 'engine',
    });
    expect(ctx.noise.getCooldown('org-a', 'channel-a', 'agent-b')).toMatchObject({
      cooldown_seconds: 300,
    });

    const denied = await ctx.request(
      '/orgs/org-a/chat-noise-controls/channels/channel-a/agents/agent-b/cooldown',
      { method: 'DELETE' },
    );
    expect(denied.status).toBe(404);
    expect(denied.body).toMatchObject({ code: 'AGENT_NOT_FOUND' });

    // The target cooldown remains intact and no clear audit was written (the
    // only audit entry is the engine's original configuration record).
    expect(ctx.noise.getCooldown('org-a', 'channel-a', 'agent-b')).toMatchObject({
      cooldown_seconds: 300,
    });
    const audit = await ctx.request('/orgs/org-a/chat-noise-controls/audit');
    expect(audit.body.audit).toEqual([
      expect.objectContaining({ action: 'cooldown_configured', agent_id: 'agent-b' }),
    ]);
    expect(JSON.stringify(audit.body.audit)).not.toContain('cooldown_cleared');
  });
});
