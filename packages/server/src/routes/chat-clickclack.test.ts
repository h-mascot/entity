import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import { classifyClickClackReadiness, type ClickClackReadinessSnapshot } from '../clickclack/readiness';

const tmpDbPath = path.join(os.tmpdir(), `entity-chat-clickclack-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalChatAgentRuntime = process.env.ENTITY_CHAT_AGENT_RUNTIME;

process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.ENTITY_CHAT_AGENT_RUNTIME = '0';

function readiness(state: ClickClackReadinessSnapshot['state']): ClickClackReadinessSnapshot {
  return {
    state,
    configured: state !== 'not_configured',
    bridgeEnabled: state === 'live' || state === 'degraded' || state === 'unavailable',
    baseUrl: state === 'not_configured' ? null : 'http://127.0.0.1:3091',
    reason: `clickclack_${state}`,
    checkedAt: '2026-05-16T00:00:00.000Z',
  };
}

describe('chat ClickClack compatibility bridge', () => {
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const { registerChatRoutes } = await import('./chat');
    const app = express();
    app.use(express.json());
    registerChatRoutes({
      app,
      clickClackReadiness: () => readiness('live'),
      clickClackBridge: {
        sendCompatibilityMessage: async (input) => ({
          message: {
            id: 'msg_human',
            channelId: 'chn_entity',
            sender: 'user',
            content: input.content,
            createdAt: '2026-05-16T00:00:00.000Z',
          },
          messages: [{
            id: 'msg_agent',
            channelId: 'chn_entity',
            sender: input.targets[0],
            content: `${input.targets[0]} reply through ClickClack`,
            createdAt: '2026-05-16T00:00:01.000Z',
          }],
          clickclack: {
            mode: 'dev-sidecar',
            baseUrl: 'http://127.0.0.1:3091',
            workspaceId: 'wsp_entity',
            channelId: 'chn_entity',
            humanUserId: 'usr_human',
            agentUserIds: { geordi: 'usr_bot_geordi' },
          },
        }),
      },
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('failed to bind test server');
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
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

    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(tmpDbPath + suffix);
      } catch {}
    }
  });

  it('classifies all ClickClack readiness contract states', () => {
    expect(classifyClickClackReadiness({
      bridgeEnabled: true,
      bridgeConfigured: true,
      baseUrl: 'http://127.0.0.1:3091',
      reachable: true,
      now: new Date('2026-05-16T00:00:00.000Z'),
    })).toMatchObject({ state: 'live', reason: 'clickclack_live' });
    expect(classifyClickClackReadiness({
      bridgeEnabled: false,
      bridgeConfigured: true,
      baseUrl: 'http://127.0.0.1:3091',
      now: new Date('2026-05-16T00:00:00.000Z'),
    })).toMatchObject({ state: 'staged', reason: 'clickclack_configured_bridge_disabled' });
    expect(classifyClickClackReadiness({
      bridgeEnabled: true,
      bridgeConfigured: true,
      baseUrl: 'http://127.0.0.1:3091',
      degraded: true,
      reason: 'sidecar slow',
      now: new Date('2026-05-16T00:00:00.000Z'),
    })).toMatchObject({ state: 'degraded', reason: 'sidecar slow' });
    expect(classifyClickClackReadiness({
      bridgeEnabled: true,
      bridgeConfigured: true,
      baseUrl: 'http://127.0.0.1:3091',
      reachable: false,
      now: new Date('2026-05-16T00:00:00.000Z'),
    })).toMatchObject({ state: 'unavailable', reason: 'clickclack_unreachable' });
    expect(classifyClickClackReadiness({
      bridgeEnabled: false,
      bridgeConfigured: false,
      now: new Date('2026-05-16T00:00:00.000Z'),
    })).toMatchObject({ state: 'not_configured', reason: 'clickclack_not_configured' });
  });

  it('reports not configured readiness while preserving local setup state', async () => {
    const { registerChatRoutes } = await import('./chat');
    const app = express();
    app.use(express.json());
    registerChatRoutes({
      app,
      clickClackReadiness: () => readiness('not_configured'),
    });

    let localServer: http.Server | null = null;
    const localBaseUrl = await new Promise<string>((resolve) => {
      localServer = app.listen(0, '127.0.0.1', () => {
        const address = localServer?.address();
        if (!address || typeof address === 'string') {
          throw new Error('failed to bind local readiness test server');
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });

    try {
      const readinessResponse = await fetch(`${localBaseUrl}/api/chat/clickclack/readiness`);
      expect(readinessResponse.status).toBe(200);
      expect(await readinessResponse.json()).toEqual({ readiness: readiness('not_configured') });

      const setupResponse = await fetch(`${localBaseUrl}/api/chat/setup`, { method: 'POST' });
      expect(setupResponse.status).toBe(200);
      const channelsResponse = await fetch(`${localBaseUrl}/api/chat/channels`);
      expect(channelsResponse.status).toBe(200);
    } finally {
      if (localServer) {
        await new Promise<void>((resolve, reject) => localServer?.close((error) => (error ? reject(error) : resolve())));
      }
    }
  }, 15000);

  it('persists the user message when ClickClack delivery fails', async () => {
    const { registerChatRoutes } = await import('./chat');
    const app = express();
    app.use(express.json());
    registerChatRoutes({
      app,
      clickClackReadiness: () => readiness('degraded'),
      clickClackBridge: {
        sendCompatibilityMessage: async () => {
          throw new Error('sidecar down');
        },
      },
    });

    let degradedServer: http.Server | null = null;
    const degradedBaseUrl = await new Promise<string>((resolve) => {
      degradedServer = app.listen(0, '127.0.0.1', () => {
        const address = degradedServer?.address();
        if (!address || typeof address === 'string') {
          throw new Error('failed to bind degraded test server');
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });

    try {
      const setupResponse = await fetch(`${degradedBaseUrl}/api/chat/setup`, { method: 'POST' });
      expect(setupResponse.status).toBe(200);

      const readinessResponse = await fetch(`${degradedBaseUrl}/api/chat/clickclack/readiness`);
      expect(readinessResponse.status).toBe(200);
      expect(await readinessResponse.json()).toEqual({ readiness: readiness('degraded') });

      const response = await fetch(`${degradedBaseUrl}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: 'command-deck',
          targetAgent: 'geordi',
          agents: ['geordi'],
          content: 'persist despite sidecar outage',
          messageId: 'entity-human-degraded-1',
        }),
      });
      const payload = await response.json() as {
        degraded?: boolean;
        error?: string;
        message: { id: string; channelId: string; content: string; status: string };
        messages: Array<unknown>;
      };

      expect(response.status).toBe(202);
      expect(payload.degraded).toBe(true);
      expect(payload.error).toContain('sidecar down');
      expect(payload.message).toMatchObject({
        channelId: 'command-deck',
        content: 'persist despite sidecar outage',
        status: 'sent',
      });
      // THE-931 (R2): the message id is server-generated (caller messageId ignored).
      const degradedId = payload.message.id;
      expect(degradedId).toBeTruthy();
      expect(degradedId).not.toBe('entity-human-degraded-1');
      expect(payload.messages).toEqual([]);

      const historyResponse = await fetch(`${degradedBaseUrl}/api/chat/channels/command-deck/messages`);
      const historyPayload = await historyResponse.json() as {
        messages: Array<{ id: string; sender: string; channelId: string; content: string }>;
      };
      expect(historyPayload.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: degradedId,
          sender: 'entity-local-user',
          channelId: 'command-deck',
          content: 'persist despite sidecar outage',
        }),
      ]));
    } finally {
      if (degradedServer) {
        await new Promise<void>((resolve, reject) => degradedServer?.close((error) => (error ? reject(error) : resolve())));
      }
    }
  }, 15000);

  it('delegates /api/chat/send to ClickClack when a bridge is configured', async () => {
    const readinessResponse = await fetch(`${baseUrl}/api/chat/clickclack/readiness`);
    expect(readinessResponse.status).toBe(200);
    expect(await readinessResponse.json()).toEqual({ readiness: readiness('live') });

    const setupResponse = await fetch(`${baseUrl}/api/chat/setup`, { method: 'POST' });
    expect(setupResponse.status).toBe(200);

    const response = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: 'command-deck',
        targetAgent: 'geordi',
        agents: ['geordi'],
        content: 'prove sidecar send',
        messageId: 'entity-human-1',
      }),
    });
    const payload = await response.json() as {
      message: { id: string; channelId: string; content: string };
      messages: Array<{ sender: string; channelId: string; content: string }>;
      clickclack?: { mode: string; channelId: string };
    };

    expect(response.status).toBe(201);
    // THE-931 (R2): the message id is server-generated (caller messageId ignored).
    expect(payload.message).toMatchObject({ channelId: 'command-deck', content: 'prove sidecar send' });
    expect(payload.message.id).toBeTruthy();
    expect(payload.message.id).not.toBe('entity-human-1');
    const humanId = payload.message.id;
    expect(payload.messages).toEqual([
      expect.objectContaining({ sender: 'geordi', channelId: 'command-deck', content: 'geordi reply through ClickClack' }),
    ]);
    expect(payload.clickclack).toMatchObject({ mode: 'dev-sidecar', channelId: 'chn_entity' });

    const historyResponse = await fetch(`${baseUrl}/api/chat/channels/command-deck/messages`);
    const historyPayload = await historyResponse.json() as {
      messages: Array<{ id: string; sender: string; channelId: string; content: string }>;
    };
    expect(historyPayload.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: humanId, sender: 'entity-local-user', channelId: 'command-deck', content: 'prove sidecar send' }),
      expect.objectContaining({ sender: 'geordi', channelId: 'command-deck', content: 'geordi reply through ClickClack' }),
    ]));
  }, 15000);
});
