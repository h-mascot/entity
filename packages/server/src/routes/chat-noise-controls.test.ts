import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import { createAgentNoiseGuard } from './agent-noise-guard';

const tmpDbPath = path.join(os.tmpdir(), `entity-chat-noise-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalChatAgentRuntime = process.env.ENTITY_CHAT_AGENT_RUNTIME;

process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.ENTITY_CHAT_AGENT_RUNTIME = '0';

describe('chat agent noise controls (THE-930)', () => {
  let server: http.Server;
  let baseUrl = '';

  let channelId = '';

  beforeAll(async () => {
    const { registerChatRoutes } = await import('./chat');
    const app = express();
    app.use(express.json());
    registerChatRoutes({
      app,
      // spock is muted; ada is free. cooldown off so only mute suppresses here.
      agentNoiseGuard: createAgentNoiseGuard({ cooldownMs: 0, mutedAgents: ['spock'] }),
    });

    baseUrl = await new Promise<string>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('failed to bind');
        resolve(`http://127.0.0.1:${address.port}/api/chat`);
      });
    });

    // Seed a category + channel for sends.
    const cat = await (await fetch(`${baseUrl}/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'noise-cat', name: 'Noise Test' }),
    })).json();
    const ch = await (await fetch(`${baseUrl}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'noise-channel', name: 'noise-channel', categoryId: cat.category.id }),
    })).json();
    channelId = ch.channel.id;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
    else delete process.env.ENTITY_TASK_DB_PATH;
    if (originalChatAgentRuntime !== undefined) process.env.ENTITY_CHAT_AGENT_RUNTIME = originalChatAgentRuntime;
    else delete process.env.ENTITY_CHAT_AGENT_RUNTIME;
    try {
      fs.rmSync(tmpDbPath, { force: true });
    } catch {}
  });

  it('suppresses a muted agent reply and reports it as suppressed', async () => {
    const res = await fetch(`${baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, content: 'hi spock', targetAgent: 'spock' }),
    });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { messages: unknown[]; suppressed: Array<{ agent: string; reason: string }> };
    expect(payload.messages).toHaveLength(0);
    expect(payload.suppressed).toEqual([{ agent: 'spock', reason: 'muted' }]);
  });

  it('still replies for a non-muted agent in the same channel (mixed-target behavior)', async () => {
    const res = await fetch(`${baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, content: 'hello ada', targetAgent: 'ada' }),
    });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { messages: Array<{ sender: string }>; suppressed: unknown[] };
    expect(payload.messages.length).toBe(1);
    expect(payload.messages[0]!.sender).toBe('ada');
    expect(payload.suppressed).toEqual([]);
  });

  it('cannot be bypassed by a forged client sender string (suppression keys on target agent)', async () => {
    // Client claims to BE spock, but the target is ada — ada is not muted, so it replies.
    const res = await fetch(`${baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId,
        content: 'trick',
        targetAgent: 'ada',
        sender: 'spock',
      }),
    });
    const payload = (await res.json()) as { messages: Array<{ sender: string }>; suppressed: unknown[] };
    expect(payload.messages.some((m) => m.sender === 'ada')).toBe(true);
    expect(payload.suppressed).toEqual([]);
  });

  it('exposes noise settings (selected backend + muted/cooldown) and persists PATCH updates', async () => {
    const before = await (await fetch(`${baseUrl}/noise-settings`)).json() as {
      settings: { cooldownMs: number; mutedAgents: string[]; backend: string };
    };
    expect(before.settings.mutedAgents).toContain('spock');
    expect(typeof before.settings.backend).toBe('string');

    const patched = await fetch(`${baseUrl}/noise-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cooldownMs: 5000, mutedAgents: ['zora'] }),
    });
    expect(patched.status).toBe(200);
    const after = (await patched.json()) as {
      settings: { cooldownMs: number; mutedAgents: string[]; backend: string };
    };
    expect(after.settings.cooldownMs).toBe(5000);
    expect(after.settings.mutedAgents).toEqual(['zora']);
  });

  it('rejects a non-admin principal mutating global noise settings (THE-930 admin auth)', async () => {
    // A contributor (not the local admin, no admin grant) must be denied.
    const res = await fetch(`${baseUrl}/noise-settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-entity-principal-id': 'worker-bee',
        'x-entity-role': 'contributor',
      },
      body: JSON.stringify({ cooldownMs: 9999 }),
    });
    expect(res.status).toBe(403);
    const payload = (await res.json()) as { code?: string; error?: string };
    expect(payload.code).toBe('admin_required');
  });
});
