import express, { Router } from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileSourceRecord, FileSourceRepository } from '../../../db/src/file-sources';

const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

afterEach(() => {
  if (typeof originalDbPath === 'undefined') {
    delete process.env.ENTITY_TASK_DB_PATH;
  } else {
    process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  }
});

function source(overrides: Partial<FileSourceRecord> = {}): FileSourceRecord {
  const timestamp = '2026-06-30T22:45:00.000Z';
  return {
    id: 'workspace',
    display_name: 'Workspace',
    type: 'local',
    base_url: null,
    base_path: '/workspace',
    auth_type: 'none',
    auth_ref: null,
    enabled: true,
    icon: null,
    capabilities: '{}',
    health: 'ok',
    last_synced_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

describe('file routes', () => {
  it('uses the runtime DB path when routes are registered after bootstrap', async () => {
    vi.resetModules();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-file-routes-'));
    const preBootstrapDbPath = path.join(tempRoot, 'pre-bootstrap.sqlite');
    const runtimeDbPath = path.join(tempRoot, 'runtime.sqlite');
    const workspaceRoot = path.join(tempRoot, 'workspace');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'alpha.md'), '# Alpha\n');

    process.env.ENTITY_TASK_DB_PATH = preBootstrapDbPath;
    const { registerFileRoutes } = await import('./routes-files');

    process.env.ENTITY_TASK_DB_PATH = runtimeDbPath;
    const { createFileSourceRepository } = await import('../../../db/src/file-sources');
    const repo = createFileSourceRepository();
    repo.createSource({
      id: 'workspace',
      display_name: 'Workspace',
      type: 'local',
      base_path: workspaceRoot,
      enabled: true,
    });

    const app = express();
    const router = Router();
    registerFileRoutes(router);
    app.use('/api/fs', router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/fs/tree?sourceId=workspace&path=`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { nodes: Array<{ name: string }> };
      expect(body.nodes.map((node) => node.name)).toContain('alpha.md');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('returns a visible error for missing sources instead of leaving the request open', async () => {
    const { registerFileRoutes } = await import('./routes-files');
    const updateSource = vi.fn(() => undefined);
    const repo: FileSourceRepository = {
      listSources: vi.fn(() => []),
      getSource: vi.fn(() => undefined),
      createSource: vi.fn(() => source()),
      updateSource,
      setEnabled: vi.fn(() => undefined),
      deleteSource: vi.fn(() => false),
    };

    const app = express();
    const router = Router();
    registerFileRoutes(router, { sourceRepo: repo });
    app.use('/api/fs', router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/fs/tree?sourceId=missing&path=`);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'Source not found.' });
      expect(updateSource).toHaveBeenCalledWith('missing', expect.objectContaining({ health: 'degraded' }));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
