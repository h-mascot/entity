import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';

const tmpDbPath = path.join(os.tmpdir(), `entity-chat-object-refs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalChatAgentRuntime = process.env.ENTITY_CHAT_AGENT_RUNTIME;

process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.ENTITY_CHAT_AGENT_RUNTIME = '0';

describe('chat ObjectRef links', () => {
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const { registerChatRoutes } = await import('./chat');
    const app = express();
    app.use(express.json());
    registerChatRoutes({
      app,
      clickClackReadiness: () => ({
        state: 'unavailable',
        configured: true,
        bridgeEnabled: true,
        baseUrl: 'http://127.0.0.1:3091',
        reason: 'clickclack_unreachable',
        checkedAt: '2026-05-16T00:00:00.000Z',
      }),
      chatObjectRefAccess: (binding, objectRef) => {
        const role = binding.principal.grants[0]?.role;
        if (objectRef.object_id === 'people-doc' && role === 'viewer') {
          return { allowed: false, reason: 'viewer cannot read linked object' };
        }
        return { allowed: true };
      },
    });

    baseUrl = await new Promise<string>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('failed to bind chat ObjectRef test server');
        }
        resolve(`http://127.0.0.1:${address.port}`);
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

    try {
      fs.rmSync(tmpDbPath, { force: true });
    } catch {
      // Best-effort cleanup for temp sqlite files.
    }
  });

  async function readJson(response: Response): Promise<Record<string, unknown>> {
    return await response.json() as Record<string, unknown>;
  }

  async function createChannelAndThread() {
    await fetch(`${baseUrl}/api/chat/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'entity-links', name: 'Entity Links' }),
    });
    const channelResponse = await fetch(`${baseUrl}/api/chat/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'object-ref-channel', name: 'ObjectRef Channel', categoryId: 'entity-links' }),
    });
    expect(channelResponse.status).toBe(201);
    const threadResponse = await fetch(`${baseUrl}/api/chat/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'object-ref-thread', channelId: 'object-ref-channel', parentMessageId: 'parent-message', title: 'ObjectRef Thread' }),
    });
    expect(threadResponse.status).toBe(201);
  }

  it('links channels and threads to Entity ObjectRefs with role metadata', async () => {
    await createChannelAndThread();
    const headers = {
      'Content-Type': 'application/json',
      'x-entity-org-id': 'entity',
      'x-entity-role': 'manager',
    };

    const channelLinkResponse = await fetch(`${baseUrl}/api/chat/channels/object-ref-channel/object-refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ object_ref: { object_type: 'task', object_id: '77', link_role: 'chat_context' } }),
    });
    const channelLinkJson = await readJson(channelLinkResponse);
    expect(channelLinkResponse.status).toBe(201);
    expect(channelLinkJson).toMatchObject({
      target: { type: 'channel', id: 'object-ref-channel' },
      object_refs: [{ object_type: 'task', object_id: '77', link_role: 'chat_context' }],
      restricted_count: 0,
    });

    const duplicateResponse = await fetch(`${baseUrl}/api/chat/channels/object-ref-channel/object-refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ object_ref: { object_type: 'task', object_id: '77', link_role: 'chat_context' } }),
    });
    expect(duplicateResponse.status).toBe(201);
    expect((await readJson(duplicateResponse)).object_refs).toHaveLength(1);

    const threadLinkResponse = await fetch(`${baseUrl}/api/chat/threads/object-ref-thread/object-refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ object_type: 'evidence_artifact', object_id: 'receipt-77', link_role: 'proof' }),
    });
    expect(threadLinkResponse.status).toBe(201);
    expect(await readJson(threadLinkResponse)).toMatchObject({
      target: { type: 'thread', id: 'object-ref-thread' },
      object_refs: [{ object_type: 'evidence_artifact', object_id: 'receipt-77', link_role: 'proof' }],
      restricted_count: 0,
    });
  });

  it('requires permission before rendering or adding chat-linked context', async () => {
    const managerHeaders = {
      'Content-Type': 'application/json',
      'x-entity-org-id': 'entity',
      'x-entity-role': 'manager',
    };
    const viewerHeaders = {
      'x-entity-org-id': 'entity',
      'x-entity-role': 'viewer',
    };

    const linkResponse = await fetch(`${baseUrl}/api/chat/channels/object-ref-channel/object-refs`, {
      method: 'POST',
      headers: managerHeaders,
      body: JSON.stringify({ object_ref: { object_type: 'native_document', object_id: 'people-doc', link_role: 'source_context' } }),
    });
    expect(linkResponse.status).toBe(201);

    const viewerResponse = await fetch(`${baseUrl}/api/chat/channels/object-ref-channel/object-refs`, {
      headers: viewerHeaders,
    });
    expect(viewerResponse.status).toBe(200);
    expect(await readJson(viewerResponse)).toMatchObject({
      object_refs: [{ object_type: 'task', object_id: '77', link_role: 'chat_context' }],
      restricted_count: 1,
    });

    const deniedResponse = await fetch(`${baseUrl}/api/chat/channels/object-ref-channel/object-refs`, {
      method: 'POST',
      headers: { ...viewerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ object_ref: { object_type: 'native_document', object_id: 'people-doc', link_role: 'source_context' } }),
    });
    expect(deniedResponse.status).toBe(403);
    expect(await readJson(deniedResponse)).toMatchObject({ code: 'permission_denied' });
  });

  it('keeps Entity-owned links readable when ClickClack readiness is unavailable', async () => {
    const readinessResponse = await fetch(`${baseUrl}/api/chat/clickclack/readiness`);
    expect(readinessResponse.status).toBe(200);
    expect(await readJson(readinessResponse)).toMatchObject({
      readiness: { state: 'unavailable', reason: 'clickclack_unreachable' },
    });

    const refsResponse = await fetch(`${baseUrl}/api/chat/threads/object-ref-thread/object-refs`, {
      headers: { 'x-entity-org-id': 'entity', 'x-entity-role': 'manager' },
    });
    expect(refsResponse.status).toBe(200);
    expect(await readJson(refsResponse)).toMatchObject({
      object_refs: [{ object_type: 'evidence_artifact', object_id: 'receipt-77', link_role: 'proof' }],
      restricted_count: 0,
    });
  });

  it('uses default org binding when request org header is absent', async () => {
    const response = await fetch(`${baseUrl}/api/chat/channels/object-ref-channel/object-refs`);
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ restricted_count: expect.any(Number) });
  });
});
