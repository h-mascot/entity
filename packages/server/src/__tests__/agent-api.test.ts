import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import http from 'http';
import express from 'express';
import { parseShareToken } from '../routes/agent-api';

let tmpDbPath: string;
const originalEnv = process.env.ENTITY_TASK_DB_PATH;

function setupDb() {
  tmpDbPath = path.join(os.tmpdir(), `entity-agent-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
}

function cleanupDb() {
  if (originalEnv !== undefined) process.env.ENTITY_TASK_DB_PATH = originalEnv;
  else delete process.env.ENTITY_TASK_DB_PATH;

  try { fs.unlinkSync(tmpDbPath); } catch {}
  try { fs.unlinkSync(tmpDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(tmpDbPath + '-shm'); } catch {}
}

async function withApi<T>(fn: (baseUrl: string) => Promise<T>) {
  vi.resetModules();
  const { createAgentApiRouter } = await import('../routes/agent-api');

  const app = express();
  app.use(express.json());
  app.use('/api', createAgentApiRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to start server');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    return await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function json(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data: any = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { res, data };
}

describe('agent-api token parsing', () => {
  it('reads bearer token', () => {
    const req: any = { headers: { authorization: 'Bearer tk_abc' }, query: {} };
    expect(parseShareToken(req)).toBe('tk_abc');
  });

  it('falls back to X-Share-Token', () => {
    const req: any = { headers: { 'x-share-token': 'tk_header' }, query: {} };
    expect(parseShareToken(req)).toBe('tk_header');
  });

  it('falls back to query token', () => {
    const req: any = { headers: {}, query: { token: 'tk_query' } };
    expect(parseShareToken(req)).toBe('tk_query');
  });
});

describe('agent-api routes', () => {
  beforeEach(() => setupDb());
  afterEach(() => cleanupDb());

  it('supports document CRUD + markdown read', async () => {
    await withApi(async (base) => {
      const created = await json('POST', `${base}/api/documents`, {
        title: 'Test Doc',
        content: '# Intro\n\nhello',
        by: 'human:henry',
      });
      expect(created.res.status).toBe(201);
      expect(created.data.slug).toBeTruthy();
      expect(created.data.accessToken).toMatch(/^tk_/);

      const slug = created.data.slug as string;
      const token = created.data.accessToken as string;

      const read = await json('GET', `${base}/api/documents/${slug}`, undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(read.res.status).toBe(200);
      expect(read.data.title).toBe('Test Doc');
      expect(read.data.content).toContain('hello');

      const md = await fetch(`${base}/api/documents/${slug}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/markdown' },
      });
      expect(md.status).toBe(200);
      expect(md.headers.get('content-type')).toContain('text/markdown');
      expect(await md.text()).toContain('# Intro');

      const patch = await json('PATCH', `${base}/api/documents/${slug}`, { visibility: 'public' }, {
        Authorization: `Bearer ${token}`,
      });
      expect(patch.res.status).toBe(200);
      expect(patch.data.visibility).toBe('public');

      const del = await json('DELETE', `${base}/api/documents/${slug}`, undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(del.res.status).toBe(200);
      expect(del.data.success).toBe(true);

      const missing = await json('GET', `${base}/api/documents/${slug}`, undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(missing.res.status).toBe(404);
    });
  });

  it('enforces auth and validates bad input', async () => {
    await withApi(async (base) => {
      const created = await json('POST', `${base}/api/documents`, {
        title: 'Secure Doc',
        content: 'secret',
        visibility: 'shared',
        by: 'human:henry',
      });
      const slug = created.data.slug as string;
      const token = created.data.accessToken as string;

      const unauthorized = await json('GET', `${base}/api/documents/${slug}`);
      expect(unauthorized.res.status).toBe(401);
      expect(unauthorized.data.code).toBe('UNAUTHORIZED');

      const badToken = await json('GET', `${base}/api/documents/${slug}`, undefined, {
        Authorization: 'Bearer tk_wrong',
      });
      expect(badToken.res.status).toBe(401);

      const invalidVisibility = await json('PATCH', `${base}/api/documents/${slug}`, { visibility: 'oops' }, {
        Authorization: `Bearer ${token}`,
      });
      expect(invalidVisibility.res.status).toBe(400);
      expect(invalidVisibility.data.code).toBe('INVALID_VISIBILITY');

      const invalidBy = await json('POST', `${base}/api/documents`, { title: 'Bad', by: 'henry' });
      expect(invalidBy.res.status).toBe(400);
      expect(invalidBy.data.code).toBe('CREATE_FAILED');

      const notFound = await json('GET', `${base}/api/documents/does-not-exist`, undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(notFound.res.status).toBe(404);
    });
  });

  it('handles block editing operations and stale conflicts', async () => {
    await withApi(async (base) => {
      const created = await json('POST', `${base}/api/documents`, {
        title: 'Blocks',
        content: 'Alpha\n\nBeta',
        by: 'human:henry',
      });
      const slug = created.data.slug as string;
      const token = created.data.accessToken as string;

      const snapshot1 = await json('GET', `${base}/api/documents/${slug}/snapshot`, undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(snapshot1.res.status).toBe(200);
      expect(snapshot1.data.blocks.length).toBe(2);

      const first = snapshot1.data.blocks[0];
      const second = snapshot1.data.blocks[1];

      const edit = await json('POST', `${base}/api/documents/${slug}/edit/v2`, {
        by: 'ai:ada',
        baseRevision: snapshot1.data.revision,
        operations: [
          { op: 'replace_block', ref: first.id, block: { markdown: 'Alpha updated' } },
          { op: 'insert_after', ref: second.id, blocks: [{ markdown: 'Gamma' }] },
        ],
      }, {
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': 'idem-1',
      });
      expect(edit.res.status).toBe(200);
      expect(edit.data.blocks.some((b: any) => b.markdown === 'Gamma')).toBe(true);

      const replay = await json('POST', `${base}/api/documents/${slug}/edit/v2`, {
        by: 'ai:ada',
        baseRevision: edit.data.revision,
        operations: [
          { op: 'replace_block', ref: first.id, block: { markdown: 'IGNORED' } },
        ],
      }, {
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': 'idem-1',
      });
      expect(replay.res.status).toBe(200);
      expect(replay.data.revision).toBe(edit.data.revision);

      const stale = await json('POST', `${base}/api/documents/${slug}/edit/v2`, {
        by: 'ai:ada',
        baseRevision: snapshot1.data.revision,
        operations: [{ op: 'delete_block', ref: second.id }],
      }, {
        Authorization: `Bearer ${token}`,
      });
      expect(stale.res.status).toBe(409);
      expect(stale.data.code).toBe('STALE_REVISION');

      const missingBase = await json('POST', `${base}/api/documents/${slug}/edit/v2`, {
        by: 'ai:ada',
        operations: [{ op: 'delete_block', ref: second.id }],
      }, {
        Authorization: `Bearer ${token}`,
      });
      expect(missingBase.res.status).toBe(409);
      expect(missingBase.data.code).toBe('STALE_REVISION');

      const badOps = await json('POST', `${base}/api/documents/${slug}/edit`, {
        by: 'ai:ada',
        operations: [],
      }, { Authorization: `Bearer ${token}` });
      expect(badOps.res.status).toBe(400);
      expect(badOps.data.code).toBe('INVALID_OPERATIONS');
    });
  });

  it('supports collaboration ops, presence, events, and authorship in state', async () => {
    await withApi(async (base) => {
      const created = await json('POST', `${base}/api/documents`, {
        title: 'Collab',
        content: 'Hello world',
        by: 'human:henry',
      });
      const slug = created.data.slug as string;
      const token = created.data.accessToken as string;

      const c1 = await json('POST', `${base}/api/documents/${slug}/ops`, {
        by: 'ai:ada',
        type: 'comment.add',
        text: 'Looks good',
      }, { Authorization: `Bearer ${token}` });
      expect(c1.res.status).toBe(200);

      const c2 = await json('POST', `${base}/api/documents/${slug}/ops`, {
        by: 'human:henry',
        type: 'suggestion.add',
        text: 'Maybe rename section',
      }, { Authorization: `Bearer ${token}` });
      expect(c2.res.status).toBe(200);

      const c3 = await json('POST', `${base}/api/documents/${slug}/ops`, {
        by: 'ai:ada',
        type: 'rewrite.apply',
      }, { Authorization: `Bearer ${token}` });
      expect(c3.res.status).toBe(200);

      const badOp = await json('POST', `${base}/api/documents/${slug}/ops`, {
        by: 'ai:ada',
        type: 'invalid.op',
      }, { Authorization: `Bearer ${token}` });
      expect(badOp.res.status).toBe(400);
      expect(badOp.data.code).toBe('INVALID_OP');

      const presence = await json('POST', `${base}/api/documents/${slug}/presence`, {
        by: 'ai:ada',
        status: 'typing',
        cursor: { blockId: 'b1' },
      }, { Authorization: `Bearer ${token}` });
      expect(presence.res.status).toBe(200);
      expect(presence.data.presence.agent_id).toBe('ai:ada');

      const events = await json('GET', `${base}/api/documents/${slug}/events/pending`, undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(events.res.status).toBe(200);
      expect(events.data.events.length).toBeGreaterThan(0);

      const ids = events.data.events.slice(0, 2).map((e: any) => e.id);
      const ack = await json('POST', `${base}/api/documents/${slug}/events/ack`, { eventIds: ids }, {
        Authorization: `Bearer ${token}`,
      });
      expect(ack.res.status).toBe(200);
      expect(ack.data.acknowledged).toBe(ids.length);

      const state = await json('GET', `${base}/api/documents/${slug}/state`, undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(state.res.status).toBe(200);
      expect(state.data.comments.length).toBeGreaterThan(0);
      expect(state.data.presence.length).toBeGreaterThan(0);
      expect(Array.isArray(state.data.authors)).toBe(true);
      expect(state.data.authors.some((a: any) => a.name === 'henry')).toBe(true);
    });
  });

  it('exposes discovery endpoint', async () => {
    await withApi(async (base) => {
      const res = await fetch(`${base}/api/.well-known/agent.json`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toContain('Agent API');
      expect(data.endpoints.create).toBe('/api/documents');
      expect(Array.isArray(data.auth)).toBe(true);
    });
  });
});
