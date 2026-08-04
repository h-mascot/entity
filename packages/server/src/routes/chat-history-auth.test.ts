import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import type { RequestOrgBinding } from '../request-permissions';

const tmpDbPath = path.join(os.tmpdir(), `entity-chat-history-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalChatAgentRuntime = process.env.ENTITY_CHAT_AGENT_RUNTIME;

process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.ENTITY_CHAT_AGENT_RUNTIME = '0';

const NO_GRANT_AGENT = 'no-grant-agent';

function accessFor(binding: RequestOrgBinding): { allowed: boolean; reason?: string } {
  // THE-931: an agent principal with no org/team assignments is denied chat
  // history access. Everyone else (incl. the local admin in dev mode) is allowed.
  if (binding.principal.principal_id === NO_GRANT_AGENT) {
    return { allowed: false, reason: 'no assignments' };
  }
  return { allowed: true };
}

describe('chat history authorization (THE-931)', () => {
  let server: http.Server;
  let baseUrl = '';
  let channelId = '';

  beforeAll(async () => {
    const { registerChatRoutes } = await import('./chat');
    const app = express();
    app.use(express.json());
    registerChatRoutes({ app, chatHistoryAccess: accessFor });

    baseUrl = await new Promise<string>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('failed to bind');
        resolve(`http://127.0.0.1:${address.port}/api/chat`);
      });
    });

    // Seed a channel + message as an authorized principal.
    const cat = await fetch(`${baseUrl}/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Auth Test' }),
    });
    const category = (await cat.json()).category;
    const ch = await fetch(`${baseUrl}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'auth-channel', categoryId: category.id }),
    });
    channelId = (await ch.json()).channel.id;

    await fetch(`${baseUrl}/channels/${channelId}/read`, { method: 'POST' });
    // Create a message directly via the send route would trigger agent runtime; instead
    // insert through the repo-less public surface by sending with agent runtime off.
    // The send route still stores the user message even when no agent replies, so use it.
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

  function authedHeaders(extra: Record<string, string> = {}) {
    return { 'x-entity-org-id': 'default-org', ...extra };
  }
  function deniedHeaders(extra: Record<string, string> = {}) {
    return authedHeaders({ 'x-entity-principal-id': NO_GRANT_AGENT, ...extra });
  }

  it('denies list-all channels for a no-assignment agent (token-auth posture)', async () => {
    const res = await fetch(`${baseUrl}/channels`, { headers: deniedHeaders() });
    expect(res.status).toBe(403);
    const payload = (await res.json()) as { code?: string };
    expect(payload.code).toBe('permission_denied');
  });

  it('allows list-all channels for an authorized principal', async () => {
    const res = await fetch(`${baseUrl}/channels`, { headers: authedHeaders() });
    expect(res.status).toBe(200);
  });

  it('returns a uniform 404 for unauthorized AND missing channel messages (no-leak)', async () => {
    const unauthorized = await fetch(`${baseUrl}/channels/${channelId}/messages`, { headers: deniedHeaders() });
    const missing = await fetch(`${baseUrl}/channels/does-not-exist/messages`, { headers: authedHeaders() });

    expect(unauthorized.status).toBe(404);
    expect(missing.status).toBe(404);
    // Identical body shape — no existence leak.
    expect(await unauthorized.json()).toEqual(await missing.json());
  });

  it('allows an authorized principal to read existing channel messages', async () => {
    const res = await fetch(`${baseUrl}/channels/${channelId}/messages`, { headers: authedHeaders() });
    expect(res.status).toBe(200);
  });

  it('returns a uniform 404 for unauthorized single-message lookup', async () => {
    const unauthorized = await fetch(`${baseUrl}/messages/anything`, { headers: deniedHeaders() });
    const missing = await fetch(`${baseUrl}/messages/anything`, { headers: authedHeaders() });
    expect(unauthorized.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await unauthorized.json()).toEqual(await missing.json());
  });
});
