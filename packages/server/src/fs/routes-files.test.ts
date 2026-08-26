import express, { Router } from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileSourceRecord, FileSourceRepository } from '../../../db/src/file-sources';

const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalWorkspace = process.env.WORKSPACE;
const tempRoots: string[] = [];

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
});

async function makeTempRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-file-routes-'));
  tempRoots.push(root);
  return root;
}

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

  it('does not fall through to an unbounded raw read when a local file exceeds the hard ceiling', async () => {
    const workspaceRoot = await makeTempRoot();
    const oversizedPath = path.join(workspaceRoot, 'oversized.bin');
    await fs.promises.writeFile(oversizedPath, 'x');
    await fs.promises.truncate(oversizedPath, (16 * 1024 * 1024) + 1);

    const record = source({ id: 'workspace', base_path: workspaceRoot });
    const repo: FileSourceRepository = {
      listSources: vi.fn(() => [record]),
      getSource: vi.fn((id: string) => id === record.id ? record : undefined),
      createSource: vi.fn(() => record),
      updateSource: vi.fn(() => record),
      setEnabled: vi.fn(() => record),
      deleteSource: vi.fn(() => false),
    };
    const { registerFileRoutes } = await import('./routes-files');
    const app = express();
    const router = Router();
    registerFileRoutes(router, { sourceRepo: repo });
    app.use('/api/fs', router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/fs/file?sourceId=workspace&path=oversized.bin`);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({
        error: 'Source file exceeds the configured read limit of 16777216 bytes.',
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('allows writes for allowlisted local sources and keeps non-allowlisted or non-local sources read-only', async () => {
    const workspaceRoot = await makeTempRoot();
    const outsideRoot = await makeTempRoot();
    process.env.WORKSPACE = workspaceRoot;
    await fs.promises.writeFile(path.join(workspaceRoot, 'demo.md'), '# Demo\n', 'utf-8');
    await fs.promises.writeFile(path.join(outsideRoot, 'external.md'), '# External\n', 'utf-8');

    const sources = new Map<string, FileSourceRecord>([
      ['workspace', source({ id: 'workspace', base_path: workspaceRoot })],
      ['external', source({ id: 'external', base_path: outsideRoot })],
      ['remote', source({ id: 'remote', type: 'github', base_path: null })],
    ]);
    const updateSource: FileSourceRepository['updateSource'] = vi.fn((id, updates) => {
      const existing = sources.get(id);
      if (!existing) {
        return undefined;
      }
      const updated = { ...existing, ...updates } as FileSourceRecord;
      sources.set(id, updated);
      return updated;
    });
    const repo: FileSourceRepository = {
      listSources: vi.fn(() => Array.from(sources.values())),
      getSource: vi.fn((id: string) => sources.get(id)),
      createSource: vi.fn(() => source()),
      updateSource,
      setEnabled: vi.fn(() => undefined),
      deleteSource: vi.fn(() => false),
    };

    const { registerFileRoutes } = await import('./routes-files');
    const app = express();
    app.use(express.json());
    const router = Router();
    registerFileRoutes(router, { sourceRepo: repo });
    app.use('/api/fs', router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const workspaceFile = await fetch(`${baseUrl}/api/fs/file?sourceId=workspace&path=demo.md`);
      expect(workspaceFile.status).toBe(200);
      await expect(workspaceFile.json()).resolves.toMatchObject({ readOnly: false, content: '# Demo\n' });

      const missingFile = await fetch(`${baseUrl}/api/fs/file?sourceId=workspace&path=deleted.md`);
      expect(missingFile.status).toBe(404);
      await expect(missingFile.json()).resolves.toMatchObject({ error: expect.stringContaining('no such file') });

      const workspaceWrite = await fetch(`${baseUrl}/api/fs/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'workspace',
          path: 'demo.md',
          mode: 'overwrite',
          content: '# Edited\n',
        }),
      });
      expect(workspaceWrite.status).toBe(200);
      await expect(fs.promises.readFile(path.join(workspaceRoot, 'demo.md'), 'utf-8')).resolves.toBe('# Edited\n');

      const externalFile = await fetch(`${baseUrl}/api/fs/file?sourceId=external&path=external.md`);
      expect(externalFile.status).toBe(200);
      await expect(externalFile.json()).resolves.toMatchObject({ readOnly: true, content: '# External\n' });

      const externalWrite = await fetch(`${baseUrl}/api/fs/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'external',
          path: 'external.md',
          mode: 'overwrite',
          content: '# Should not write\n',
        }),
      });
      expect(externalWrite.status).toBe(403);
      await expect(externalWrite.json()).resolves.toEqual({ error: 'Source is read-only.' });
      await expect(fs.promises.readFile(path.join(outsideRoot, 'external.md'), 'utf-8')).resolves.toBe('# External\n');

      const remoteWrite = await fetch(`${baseUrl}/api/fs/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'remote',
          path: 'remote.md',
          content: '# Should not write\n',
        }),
      });
      expect(remoteWrite.status).toBe(501);
      await expect(remoteWrite.json()).resolves.toMatchObject({
        code: 'CONNECTOR_NOT_IMPLEMENTED',
        connectorType: 'github',
        error: expect.stringContaining('not implemented'),
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

describe('unimplemented connector operations', () => {
  it('maps placeholder connector operations to typed 501 responses, never a generic 500', async () => {
    const workspaceRoot = await makeTempRoot();
    await fs.promises.writeFile(path.join(workspaceRoot, 'readme.md'), '# Local\n', 'utf-8');

    const sources = new Map<string, FileSourceRecord>([
      ['workspace', source({ id: 'workspace', base_path: workspaceRoot })],
      ['github-upstream', source({ id: 'github-upstream', type: 'github', base_path: null, base_url: 'https://github.com/example/example' })],
      ['s3-upstream', source({ id: 's3-upstream', type: 's3', base_path: null, base_url: 's3://bucket/prefix' })],
    ]);
    const repo: FileSourceRepository = {
      listSources: vi.fn(() => Array.from(sources.values())),
      getSource: vi.fn((id: string) => sources.get(id)),
      createSource: vi.fn(() => source()),
      updateSource: vi.fn(() => undefined),
      setEnabled: vi.fn(() => undefined),
      deleteSource: vi.fn(() => false),
    };

    const { registerFileRoutes } = await import('./routes-files');
    const app = express();
    app.use(express.json());
    const router = Router();
    registerFileRoutes(router, { sourceRepo: repo });
    app.use('/api/fs', router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const githubTree = await fetch(`${baseUrl}/api/fs/tree?sourceId=github-upstream&path=`);
      expect(githubTree.status).toBe(501);
      await expect(githubTree.json()).resolves.toMatchObject({
        code: 'CONNECTOR_NOT_IMPLEMENTED',
        connectorType: 'github',
        error: expect.stringContaining('not implemented'),
      });

      const githubRead = await fetch(`${baseUrl}/api/fs/file?sourceId=github-upstream&path=README.md`);
      expect(githubRead.status).toBe(501);
      await expect(githubRead.json()).resolves.toMatchObject({
        code: 'CONNECTOR_NOT_IMPLEMENTED',
        connectorType: 'github',
      });

      const githubWrite = await fetch(`${baseUrl}/api/fs/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: 'github-upstream', path: 'README.md', content: 'edit' }),
      });
      expect(githubWrite.status).toBe(501);
      await expect(githubWrite.json()).resolves.toMatchObject({
        code: 'CONNECTOR_NOT_IMPLEMENTED',
        connectorType: 'github',
      });

      const githubMkdir = await fetch(`${baseUrl}/api/fs/folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: 'github-upstream', path: 'docs' }),
      });
      expect(githubMkdir.status).toBe(501);
      await expect(githubMkdir.json()).resolves.toMatchObject({
        code: 'CONNECTOR_NOT_IMPLEMENTED',
        connectorType: 'github',
      });

      const s3Tree = await fetch(`${baseUrl}/api/fs/tree?sourceId=s3-upstream&path=`);
      expect(s3Tree.status).toBe(501);
      await expect(s3Tree.json()).resolves.toMatchObject({
        code: 'CONNECTOR_NOT_IMPLEMENTED',
        connectorType: 's3',
      });

      // Supported connectors must keep working in the same deployment.
      const localTree = await fetch(`${baseUrl}/api/fs/tree?sourceId=workspace&path=`);
      expect(localTree.status).toBe(200);
      const localBody = (await localTree.json()) as { nodes: Array<{ name: string }> };
      expect(localBody.nodes.map((node) => node.name)).toContain('readme.md');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
