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
});
