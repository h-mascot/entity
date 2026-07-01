import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalWorkspace = process.env.WORKSPACE;
const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-source-routes-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  if (typeof originalDbPath === 'undefined') {
    delete process.env.ENTITY_TASK_DB_PATH;
  } else {
    process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  }
  if (typeof originalWorkspace === 'undefined') {
    delete process.env.WORKSPACE;
  } else {
    process.env.WORKSPACE = originalWorkspace;
  }
  await Promise.all(tempRoots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
  vi.resetModules();
});

async function withSourceServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  vi.resetModules();
  const { registerSourceRoutes } = await import('./routes-sources');
  const app = express();
  app.use(express.json());
  registerSourceRoutes(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed to bind');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('source registration routes', () => {
  it('rejects local sources outside the workspace allowlist and accepts workspace roots', async () => {
    const workspaceRoot = await makeTempRoot();
    const dbRoot = await makeTempRoot();
    process.env.WORKSPACE = workspaceRoot;
    process.env.ENTITY_TASK_DB_PATH = path.join(dbRoot, 'entity.sqlite');

    await withSourceServer(async (baseUrl) => {
      const rejected = await fetch(`${baseUrl}/api/fs/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'etc',
          displayName: 'Etc',
          type: 'local',
          basePath: '/etc',
        }),
      });
      expect(rejected.status).toBe(400);
      await expect(rejected.json()).resolves.toMatchObject({
        error: 'Local source basePath must stay inside an allowlisted root.',
      });

      const accepted = await fetch(`${baseUrl}/api/fs/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'workspace-docs',
          displayName: 'Workspace Docs',
          type: 'local',
          basePath: workspaceRoot,
        }),
      });
      expect(accepted.status).toBe(201);
      await expect(accepted.json()).resolves.toMatchObject({
        id: 'workspace-docs',
        basePath: workspaceRoot,
      });
    });
  });
});
