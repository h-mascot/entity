/**
 * THE-930 (blockers 1 & 2) — `/api/chat/send` trust boundary.
 *
 * Caller-supplied sender/senderEmoji/timestamp/isLocal must NEVER be persisted
 * as authoritative identity/time; they are derived from the server-resolved
 * principal/target and the server clock. A failed sidecar delivery must release
 * every reservation so an immediate retry is not suppressed as duplicate-concurrent
 * and does not consume the cooldown window.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import { createAgentNoiseGuard } from './agent-noise-guard';
import type { ClickClackChatBridge, ClickClackCompatibilityInput, ClickClackCompatibilityResult } from '../clickclack/bridge';

const tmpDbPath = path.join(os.tmpdir(), `entity-chat-send-trust-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalChatAgentRuntime = process.env.ENTITY_CHAT_AGENT_RUNTIME;

process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.ENTITY_CHAT_AGENT_RUNTIME = '0';

/** Server-resolved principal id used in local-dev (no API token, no stored principals). */
const EXPECTED_SENDER = 'entity-local-user';

function makeBridge(behaviour: {
  failOnce?: boolean;
  reply?: (input: ClickClackCompatibilityInput) => ClickClackCompatibilityResult['messages'];
}): { bridge: ClickClackChatBridge; calls: ClickClackCompatibilityInput[]; thrown: () => number } {
  const state = { thrown: 0 };
  const calls: ClickClackCompatibilityInput[] = [];
  const bridge: ClickClackChatBridge = {
    async sendCompatibilityMessage(input) {
      calls.push(input);
      if (behaviour.failOnce && state.thrown === 0) {
        state.thrown += 1;
        throw new Error('sidecar exploded');
      }
      const messages = behaviour.reply
        ? behaviour.reply(input)
        : input.targets.map((agent, i) => ({
          id: `reply-${input.messageId}-${i}`,
          channelId: input.channelId,
          sender: agent,
          content: `ok ${agent}`,
          createdAt: new Date().toISOString(),
        }));
      return {
        message: {
          id: input.messageId ?? 'cc-root',
          channelId: input.channelId,
          sender: 'clickclack',
          content: input.content,
          createdAt: new Date().toISOString(),
        },
        messages,
        clickclack: {
          mode: 'dev-sidecar',
          baseUrl: 'http://127.0.0.1:3091',
          workspaceId: 'ws',
          channelId: input.channelId,
          humanUserId: 'human',
          agentUserIds: {},
        },
      };
    },
  };
  return { bridge, calls, thrown: () => state.thrown };
}

describe('/api/chat/send trust boundary (THE-930 blockers 1 & 2)', () => {
  // ── Sidecar path ──────────────────────────────────────────────────────
  describe('sidecar path', () => {
    let server: http.Server;
    let baseUrl = '';
    let channelId = '';

    beforeAll(async () => {
      const { registerChatRoutes } = await import('./chat');
      const { bridge } = makeBridge({});
      const app = express();
      app.use(express.json());
      registerChatRoutes({
        app,
        clickClackBridge: bridge,
        agentNoiseGuard: createAgentNoiseGuard({ cooldownMs: 0 }),
      });
      baseUrl = await new Promise<string>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (!address || typeof address === 'string') throw new Error('failed to bind');
          resolve(`http://127.0.0.1:${address.port}/api/chat`);
        });
      });
      const cat = await (await fetch(`${baseUrl}/categories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'trust-cat', name: 'Trust' }),
      })).json();
      const ch = await (await fetch(`${baseUrl}/channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'trust-channel', name: 'trust-channel', categoryId: cat.category.id }),
      })).json();
      channelId = ch.channel.id;
    });

    afterAll(async () => {
      if (server) await new Promise<void>((r, e) => server.close((err) => (err ? e(err) : r())));
    });

    it('ignores a forged caller sender/senderEmoji/timestamp/isLocal and uses the server principal + clock', async () => {
      const before = Date.now();
      const forged = '1999-01-01T00:00:00.000Z';
      const res = await fetch(`${baseUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          content: 'hello sidecar',
          targetAgent: 'ada',
          sender: 'ATTACKER',
          senderEmoji: '😈',
          timestamp: forged,
          isLocal: true,
        }),
      });
      expect(res.status).toBe(201);
      const payload = (await res.json()) as {
        message: { sender: string; senderEmoji?: string; timestamp: string; isLocal: boolean };
      };
      // Sender is the server-resolved principal, never the forged body value.
      expect(payload.message.sender).toBe(EXPECTED_SENDER);
      expect(payload.message.sender).not.toBe('ATTACKER');
      // Emoji is a server default, never the forged emoji.
      expect(payload.message.senderEmoji).not.toBe('😈');
      // Timestamp is the server clock, not the forged historical value.
      expect(payload.message.timestamp).not.toBe(forged);
      const ts = Date.parse(payload.message.timestamp);
      expect(Number.isFinite(ts)).toBe(true);
      expect(ts).toBeGreaterThanOrEqual(before - 1000);
      // isLocal is server-derived (resolved model), not the forged true.
      expect(payload.message.isLocal).toBe(false);
    });
  });

  // ── Native path ───────────────────────────────────────────────────────
  describe('native path', () => {
    let server: http.Server;
    let baseUrl = '';
    let channelId = '';

    beforeAll(async () => {
      const { registerChatRoutes } = await import('./chat');
      const app = express();
      app.use(express.json());
      registerChatRoutes({
        app,
        // No clickClackBridge -> native reply path (runtime disabled above).
        agentNoiseGuard: createAgentNoiseGuard({ cooldownMs: 0 }),
      });
      baseUrl = await new Promise<string>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (!address || typeof address === 'string') throw new Error('failed to bind');
          resolve(`http://127.0.0.1:${address.port}/api/chat`);
        });
      });
      const cat = await (await fetch(`${baseUrl}/categories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'native-cat', name: 'Native' }),
      })).json();
      const ch = await (await fetch(`${baseUrl}/channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'native-channel', name: 'native-channel', categoryId: cat.category.id }),
      })).json();
      channelId = ch.channel.id;
    });

    afterAll(async () => {
      if (server) await new Promise<void>((r, e) => server.close((err) => (err ? e(err) : r())));
    });

    it('ignores a forged caller sender/timestamp on the native path too', async () => {
      const before = Date.now();
      const forged = '2099-12-31T23:59:59.000Z';
      const res = await fetch(`${baseUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          content: 'hello native',
          targetAgent: 'ada',
          sender: 'IMPOSTOR',
          senderEmoji: '💀',
          timestamp: forged,
          isLocal: true,
        }),
      });
      expect(res.status).toBe(201);
      const payload = (await res.json()) as {
        message: { sender: string; senderEmoji?: string; timestamp: string; isLocal: boolean };
        messages: Array<{ sender: string }>;
      };
      expect(payload.message.sender).toBe(EXPECTED_SENDER);
      expect(payload.message.sender).not.toBe('IMPOSTOR');
      expect(payload.message.senderEmoji).not.toBe('💀');
      expect(payload.message.timestamp).not.toBe(forged);
      expect(Date.parse(payload.message.timestamp)).toBeGreaterThanOrEqual(before - 1000);
      // The agent reply is still server-resolved.
      expect(payload.messages.some((m) => m.sender === 'ada')).toBe(true);
    });
  });

  // ── Sidecar failure must release reservations (blocker 2) ──────────────
  describe('sidecar failure releases reservations', () => {
    let server: http.Server;
    let baseUrl = '';
    let channelId = '';
    let harness: ReturnType<typeof makeBridge>;

    beforeAll(async () => {
      const { registerChatRoutes } = await import('./chat');
      harness = makeBridge({ failOnce: true });
      const app = express();
      app.use(express.json());
      registerChatRoutes({
        app,
        clickClackBridge: harness.bridge,
        // Large cooldown so a leaked reservation / consumed cooldown would
        // visibly suppress the immediate retry.
        agentNoiseGuard: createAgentNoiseGuard({ cooldownMs: 60_000 }),
      });
      baseUrl = await new Promise<string>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (!address || typeof address === 'string') throw new Error('failed to bind');
          resolve(`http://127.0.0.1:${address.port}/api/chat`);
        });
      });
      const cat = await (await fetch(`${baseUrl}/categories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'leak-cat', name: 'Leak' }),
      })).json();
      const ch = await (await fetch(`${baseUrl}/channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'leak-channel', name: 'leak-channel', categoryId: cat.category.id }),
      })).json();
      channelId = ch.channel.id;
    });

    afterAll(async () => {
      if (server) await new Promise<void>((r, e) => server.close((err) => (err ? e(err) : r())));
    });

    it('first call fails (degraded) and the immediate retry is NOT suppressed as duplicate-concurrent', async () => {
      // First send: sidecar throws -> 202 degraded, but reservations must be released.
      const first = await fetch(`${baseUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, content: 'flaky send', targetAgent: 'ada' }),
      });
      expect(first.status).toBe(202);
      expect(harness.thrown()).toBe(1);

      // Immediate retry of the SAME (agent, channel, content): must not be
      // suppressed as duplicate-concurrent, and must not be cooldown-blocked
      // (the failed delivery consumed no cooldown).
      const retry = await fetch(`${baseUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, content: 'flaky send', targetAgent: 'ada' }),
      });
      expect(retry.status).toBe(201);
      const payload = (await retry.json()) as {
        messages: Array<{ sender: string }>;
        suppressed: Array<{ agent: string; reason: string }>;
      };
      expect(payload.messages.some((m) => m.sender === 'ada')).toBe(true);
      expect(payload.suppressed).toEqual([]);
    });
  });
});

afterAll(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
  if (originalChatAgentRuntime !== undefined) process.env.ENTITY_CHAT_AGENT_RUNTIME = originalChatAgentRuntime;
  else delete process.env.ENTITY_CHAT_AGENT_RUNTIME;
  try { fs.rmSync(tmpDbPath, { force: true }); } catch {}
});
