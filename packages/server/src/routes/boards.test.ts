import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const tmpDbPath = path.join(
  os.tmpdir(),
  `entity-boards-route-${process.pid}-${randomUUID()}.db`,
);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalMcPath = process.env.MISSION_CONTROL_DB_PATH;

let baseUrl = '';
let server: Awaited<ReturnType<express.Express['listen']>>;
let createBoardsRouter: typeof import('./boards').createBoardsRouter;
let getEntityDatabase: typeof import('../../../db/src/entity-db').getEntityDatabase;

beforeAll(async () => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
  process.env.MISSION_CONTROL_DB_PATH = path.join(
    os.tmpdir(),
    `missing-mc-${randomUUID()}.db`,
  );

  ({ createBoardsRouter } = await import('./boards'));
  ({ getEntityDatabase } = await import('../../../db/src/entity-db'));

  const app = express();
  app.use(express.json());
  app.use('/api/boards', createBoardsRouter());

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind test server');
      }
      baseUrl = `http://127.0.0.1:${address.port}/api/boards`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  if (originalDbPath === undefined) {
    delete process.env.ENTITY_TASK_DB_PATH;
  } else {
    process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  }
  if (originalMcPath === undefined) {
    delete process.env.MISSION_CONTROL_DB_PATH;
  } else {
    process.env.MISSION_CONTROL_DB_PATH = originalMcPath;
  }
  for (const file of [tmpDbPath, `${tmpDbPath}-wal`, `${tmpDbPath}-shm`]) {
    fs.rmSync(file, { force: true });
  }
});

beforeEach(() => {
  const db = getEntityDatabase();
  db.exec('DELETE FROM boards');
});

async function json(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { status: res.status, payload };
}

describe('boards API', () => {
  it('lists the seeded General and Analytics defaults on first read', async () => {
    const { status, payload } = await json('GET', '');
    expect(status).toBe(200);
    const boards = (payload as { boards: Array<{ key: string | null }> }).boards;
    expect(boards.map((b) => b.key)).toEqual(['general', 'analytics']);
  });

  it('creates a board from a template with derived view and filter', async () => {
    const { status, payload } = await json('POST', '', {
      name: 'Platform Eng',
      template: 'engineering',
    });
    expect(status).toBe(201);
    expect(payload).toMatchObject({
      name: 'Platform Eng',
      view: 'engineering',
      is_default: false,
      filter_config: { scope: 'workDomain', workDomain: 'engineering' },
    });
  });

  it('rejects an empty board name with 400', async () => {
    const { status, payload } = await json('POST', '', { name: '   ' });
    expect(status).toBe(400);
    expect((payload as { error: string }).error).toMatch(/name is required/i);
  });

  it('updates name and view and reports missing boards with 404', async () => {
    const created = await json('POST', '', { name: 'Sprint', template: 'strategic' });
    const id = (created.payload as { id: number }).id;

    const updated = await json('PATCH', `/${id}`, { name: 'Sprint Plan', view: 'board' });
    expect(updated.status).toBe(200);
    expect(updated.payload).toMatchObject({ id, name: 'Sprint Plan', view: 'board' });

    const missing = await json('PATCH', '/999999', { name: 'x' });
    expect(missing.status).toBe(404);
  });

  it('reorders boards and returns the full ordered list', async () => {
    await json('GET', ''); // seed defaults
    const a = await json('POST', '', { name: 'A' });
    const b = await json('POST', '', { name: 'B' });
    const aid = (a.payload as { id: number }).id;
    const bid = (b.payload as { id: number }).id;

    const { status, payload } = await json('POST', '/reorder', { ids: [bid, aid] });
    expect(status).toBe(200);
    expect(
      (payload as { boards: Array<{ name: string }> }).boards.map((board) => board.name),
    ).toEqual(['B', 'A', 'General', 'Analytics']);
  });

  it('deletes a user board (204), 404s on missing, and refuses defaults with 409', async () => {
    await json('GET', '');
    const created = await json('POST', '', { name: 'Throwaway' });
    const id = (created.payload as { id: number }).id;

    expect((await json('DELETE', `/${id}`)).status).toBe(204);
    expect((await json('DELETE', `/${id}`)).status).toBe(404);

    const list = (await json('GET', '')).payload as { boards: Array<{ key: string | null; id: number }> };
    const general = list.boards.find((b) => b.key === 'general')!;
    const refused = await json('DELETE', `/${general.id}`);
    expect(refused.status).toBe(409);
    expect((refused.payload as { error: string }).error).toMatch(/default/i);
  });

  it('seeds required defaults even when the first call is a create (no prior GET)', async () => {
    const created = await json('POST', '', { name: 'First board' });
    expect(created.status).toBe(201);
    const list = await json('GET', '');
    const keys = ((list.payload as { boards: Array<{ key: string | null }> }).boards).map((b) => b.key);
    expect(keys).toEqual(['general', 'analytics', null]);
    expect((created.payload as { sort_order: number }).sort_order).toBe(2);
  });

  it('isolates boards by request org scope (cross-tenant fail closed)', async () => {
    // Tenant org-a creates a board.
    await json('GET', '', undefined, { 'x-entity-org-id': 'org-a' });
    const aBoard = await json('POST', '', { name: 'Only in A' }, { 'x-entity-org-id': 'org-a' });
    expect(aBoard.status).toBe(201);
    const aId = (aBoard.payload as { id: number }).id;

    // Tenant org-b cannot see, patch, or delete org-a's board.
    const bList = await json('GET', '', undefined, { 'x-entity-org-id': 'org-b' });
    expect(
      ((bList.payload as { boards: Array<{ id: number }> }).boards).some((b) => b.id === aId),
    ).toBe(false);
    expect(
      (await json('PATCH', `/${aId}`, { name: 'hacked' }, { 'x-entity-org-id': 'org-b' })).status,
    ).toBe(404);
    expect(
      (await json('DELETE', `/${aId}`, undefined, { 'x-entity-org-id': 'org-b' })).status,
    ).toBe(404);

    // org-a still owns it (visible in its own list).
    const aList = await json('GET', '', undefined, { 'x-entity-org-id': 'org-a' });
    expect(
      ((aList.payload as { boards: Array<{ id: number; name: string }> }).boards).some(
        (b) => b.id === aId && b.name === 'Only in A',
      ),
    ).toBe(true);
  });
});
