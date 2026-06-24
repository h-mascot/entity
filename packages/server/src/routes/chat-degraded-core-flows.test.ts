import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import { execFile } from 'child_process';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

const tmpDbPath = path.join(os.tmpdir(), `entity-clickclack-core-flows-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalChatAgentRuntime = process.env.ENTITY_CHAT_AGENT_RUNTIME;

process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
process.env.ENTITY_CHAT_AGENT_RUNTIME = '0';

const mockExecFile = vi.mocked(execFile);

describe('degraded ClickClack core Entity flows', () => {
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const { registerChatRoutes } = await import('./chat');
    const { createDocumentObjectRouter } = await import('../document-objects');
    const { createSearchRouter } = await import('./search');
    const app = express();
    app.use(express.json());
    registerChatRoutes({
      app,
      clickClackReadiness: () => ({
        state: 'unavailable',
        configured: true,
        bridgeEnabled: true,
        baseUrl: 'http://127.0.0.1:3091',
        reason: 'sidecar_unreachable',
        checkedAt: '2026-06-24T06:39:00.000Z',
      }),
      clickClackBridge: {
        sendCompatibilityMessage: async () => {
          throw new Error('sidecar unreachable');
        },
      },
    });
    app.use('/api/document-objects', createDocumentObjectRouter());
    app.use('/api/search', createSearchRouter());

    baseUrl = await new Promise<string>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('failed to bind degraded core-flow test server');
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

  it('keeps chat, docs/proof, and search APIs usable when ClickClack is unavailable', async () => {
    mockExecFile.mockImplementation(((_file: string, _args: readonly string[] | null | undefined, _options: unknown, callback: any) => {
      callback(null, JSON.stringify([{
        file: 'qmd://docs/task-proof.md',
        title: 'Task proof',
        snippet: 'Entity proof stays searchable while chat is unavailable.',
        org_id: 'entity',
      }]), '');
      return {} as any;
    }) as any);

    const readinessResponse = await fetch(`${baseUrl}/api/chat/clickclack/readiness`);
    expect(readinessResponse.status).toBe(200);
    expect(await readinessResponse.json()).toMatchObject({
      readiness: { state: 'unavailable', reason: 'sidecar_unreachable' },
    });

    const setupResponse = await fetch(`${baseUrl}/api/chat/setup`, { method: 'POST' });
    expect(setupResponse.status).toBe(200);
    const setup = await setupResponse.json() as { channels: Array<{ id: string }> };
    const channelId = setup.channels[0]?.id;
    expect(channelId).toBeTruthy();

    const sendResponse = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, content: 'Persist locally despite unavailable ClickClack.' }),
    });
    expect(sendResponse.status).toBe(202);
    expect(await sendResponse.json()).toMatchObject({ degraded: true });

    const nativeDocResponse = await fetch(`${baseUrl}/api/document-objects/native-documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-entity-org-id': 'entity' },
      body: JSON.stringify({
        title: 'Degraded chat work note',
        body: 'Docs remain Entity-owned.',
        content_hash: 'sha256:degradeddoc',
        linked_object_refs: [{ object_type: 'task', object_id: '79', link_role: 'source_context' }],
      }),
    });
    expect(nativeDocResponse.status).toBe(201);
    expect(await nativeDocResponse.json()).toMatchObject({
      nativeDocument: { title: 'Degraded chat work note' },
    });

    const proofResponse = await fetch(`${baseUrl}/api/document-objects/evidence-artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-entity-org-id': 'entity' },
      body: JSON.stringify({
        title: 'Degraded chat proof',
        artifact_kind: 'raw_task_receipt',
        body: 'Proof remains Entity-owned.',
        content_hash: 'sha256:degradedproof',
        linked_object_refs: [{ object_type: 'task', object_id: '79', link_role: 'proof' }],
      }),
    });
    expect(proofResponse.status).toBe(201);
    expect(await proofResponse.json()).toMatchObject({
      evidenceArtifact: { title: 'Degraded chat proof' },
    });

    const searchResponse = await fetch(`${baseUrl}/api/search?q=proof&mode=keyword`, {
      headers: { 'x-entity-org-id': 'entity' },
    });
    expect(searchResponse.status).toBe(200);
    expect(await searchResponse.json()).toMatchObject({
      results: [expect.objectContaining({ title: 'Task proof' })],
    });
  });
});
