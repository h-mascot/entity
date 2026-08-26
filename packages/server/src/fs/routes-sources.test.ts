import express, { Router } from 'express';
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

async function withSourceAndFileServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  vi.resetModules();
  const { registerSourceRoutes } = await import('./routes-sources');
  const { registerFileRoutes } = await import('./routes-files');
  const app = express();
  app.use(express.json());
  registerSourceRoutes(app);
  const router = Router();
  registerFileRoutes(router);
  app.use('/api/fs', router);
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

  it('clamps local source capabilities on create and update to the server-derived policy', async () => {
    const workspaceRoot = await makeTempRoot();
    const dbRoot = await makeTempRoot();
    process.env.WORKSPACE = workspaceRoot;
    process.env.ENTITY_TASK_DB_PATH = path.join(dbRoot, 'entity.sqlite');

    await withSourceAndFileServer(async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/fs/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'workspace-docs',
          displayName: 'Workspace Docs',
          type: 'local',
          basePath: workspaceRoot,
          capabilities: JSON.stringify({ read: true, write: true, list: true, search: true }),
        }),
      });
      expect(created.status).toBe(201);
      const createdBody = (await created.json()) as { capabilities: string };
      expect(JSON.parse(createdBody.capabilities)).toMatchObject({ read: true, write: true, list: true, search: true });

      const updated = await fetch(`${baseUrl}/api/fs/sources/workspace-docs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Workspace Docs Updated',
          capabilities: JSON.stringify({ read: true, write: true, list: true, search: true }),
        }),
      });
      expect(updated.status).toBe(200);
      const updatedBody = (await updated.json()) as { capabilities: string };
      expect(JSON.parse(updatedBody.capabilities)).toMatchObject({ read: true, write: true, list: true, search: true });
    });
  });

  it('inherits read-only policy for aliases of protected local roots', async () => {
    const workspaceRoot = await makeTempRoot();
    const wikiRoot = path.join(workspaceRoot, 'wiki');
    const dbRoot = await makeTempRoot();
    const wikiAliasRoot = path.join(workspaceRoot, 'wiki-alias-root');
    await fs.promises.mkdir(wikiRoot, { recursive: true });
    await fs.promises.symlink(wikiRoot, wikiAliasRoot, 'dir');
    process.env.WORKSPACE = workspaceRoot;
    process.env.ENTITY_TASK_DB_PATH = path.join(dbRoot, 'entity.sqlite');

    await withSourceServer(async (baseUrl) => {
      const create = (id: string, basePath: string, capabilities?: string) =>
        fetch(`${baseUrl}/api/fs/sources`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, displayName: id, type: 'local', basePath, capabilities }),
        });
      expect((await create('protected-wiki', wikiRoot, JSON.stringify({ readOnly: true }))).status).toBe(201);
      const alias = await create('wiki-alias', wikiRoot);
      expect(alias.status).toBe(201);
      const body = (await alias.json()) as { capabilities: string };
      expect(JSON.parse(body.capabilities)).toMatchObject({ readOnly: true, write: false });
      const symlinkAlias = await create('wiki-symlink-alias', wikiAliasRoot);
      expect(symlinkAlias.status).toBe(201);
      const symlinkBody = (await symlinkAlias.json()) as { capabilities: string };
      expect(JSON.parse(symlinkBody.capabilities)).toMatchObject({ readOnly: true, write: false });
    });
  });

  it('prevents deletion or adapter-type replacement of trusted config-managed sources', async () => {
    const {
      capabilitiesForStorage,
      localSourceOverlapsReadOnlyRoot,
      sourceCanBeDeleted,
      sourceTypeCanBeChanged,
    } = await import('./routes-sources');
    const configured = JSON.stringify({ source: 'entity.config.yaml', readOnly: true, agentBindings: ['assistant'] });
    expect(sourceCanBeDeleted(configured)).toBe(false);
    expect(sourceCanBeDeleted(JSON.stringify({ readOnly: true }))).toBe(true);
    expect(sourceTypeCanBeChanged(configured, 'local', 'http-markdown')).toBe(false);
    expect(sourceTypeCanBeChanged(configured, 'local', 'local')).toBe(true);
    expect(JSON.parse(capabilitiesForStorage('http-markdown', '{}', null, configured) ?? '{}')).toMatchObject({
      source: 'entity.config.yaml',
      agentBindings: ['assistant'],
    });
    const readOnlySource = {
      type: 'local' as const,
      base_path: '/workspace/wiki',
      capabilities: configured,
    };
    expect(localSourceOverlapsReadOnlyRoot('/workspace/wiki', [readOnlySource])).toBe(true);
    expect(localSourceOverlapsReadOnlyRoot('/workspace/wiki/subdir', [readOnlySource])).toBe(true);
    expect(localSourceOverlapsReadOnlyRoot('/workspace', [readOnlySource])).toBe(true);
    expect(localSourceOverlapsReadOnlyRoot('/other', [readOnlySource])).toBe(false);
  });

  it('preserves trusted config-managed read-only policy on client updates', async () => {
    const { capabilitiesForStorage } = await import('./routes-sources');
    const stored = capabilitiesForStorage(
      'local',
      JSON.stringify({ readOnly: false }),
      process.cwd(),
      JSON.stringify({ source: 'entity.config.yaml', readOnly: true, agentBindings: ['assistant'] }),
    );

    expect(JSON.parse(stored ?? '{}')).toMatchObject({
      source: 'entity.config.yaml',
      readOnly: true,
      write: false,
      agentBindings: ['assistant'],
    });
  });
});

describe("placeholder source connectors", () => {
  it("labels placeholder connectors as not implemented in listings and typed test diagnostics", async () => {
    const workspaceRoot = await makeTempRoot();
    const dbRoot = await makeTempRoot();
    process.env.WORKSPACE = workspaceRoot;
    process.env.ENTITY_TASK_DB_PATH = path.join(dbRoot, "entity.sqlite");

    await withSourceServer(async (baseUrl) => {
      const createdGithub = await fetch(`${baseUrl}/api/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "GitHub upstream",
          type: "github",
          baseUrl: "https://github.com/example/example",
        }),
      });
      expect(createdGithub.status).toBe(201);
      const github = (await createdGithub.json()) as { id: string; implemented?: boolean };
      expect(github.implemented).toBe(false);

      const createdLocal = await fetch(`${baseUrl}/api/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "Workspace docs",
          type: "local",
          basePath: workspaceRoot,
        }),
      });
      expect(createdLocal.status).toBe(201);
      const local = (await createdLocal.json()) as { id: string; implemented?: boolean };
      expect(local.implemented).toBe(true);

      const listed = await fetch(`${baseUrl}/api/sources?includeDisabled=true`);
      const payload = (await listed.json()) as { sources: Array<{ id: string; implemented?: boolean }> };
      const listedGithub = payload.sources.find((item) => item.id === github.id);
      const listedLocal = payload.sources.find((item) => item.id === local.id);
      expect(listedGithub?.implemented).toBe(false);
      expect(listedLocal?.implemented).toBe(true);

      const tested = await fetch(`${baseUrl}/api/sources/${github.id}/test`, { method: "POST" });
      expect(tested.status).toBe(200);
      const result = (await tested.json()) as { status: string; message: string; code?: string; connectorType?: string };
      expect(result.status).toBe("error");
      expect(result.message).toContain("not implemented");
      expect(result.code).toBe("CONNECTOR_NOT_IMPLEMENTED");
      expect(result.connectorType).toBe("github");

      await fetch(`${baseUrl}/api/sources/${github.id}`, { method: "DELETE" });
      await fetch(`${baseUrl}/api/sources/${local.id}`, { method: "DELETE" });
    });
  });

  it("fails the connection test closed for unimplemented adapters instead of reporting healthy", async () => {
    const dbRoot = await makeTempRoot();
    process.env.ENTITY_TASK_DB_PATH = path.join(dbRoot, "test.db");

    await withSourceServer(async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "GitHub upstream",
          type: "github",
          baseUrl: "https://github.com/example/example",
          authType: "bearer",
          authRef: "env:GITHUB_TOKEN",
        }),
      });
      expect(created.status).toBe(201);
      const source = (await created.json()) as { id: string };
      expect(source.id).toBeTruthy();

      const tested = await fetch(`${baseUrl}/api/sources/${source.id}/test`, { method: "POST" });
      expect(tested.status).toBe(200);
      const result = (await tested.json()) as { status: string; message: string };
      expect(result.status).toBe("error");
      expect(result.message).toContain("not implemented");

      // Health must be persisted as error so Admin and the wizard cannot show a fake-healthy source.
      const listed = await fetch(`${baseUrl}/api/sources?includeDisabled=true`);
      const payload = (await listed.json()) as { sources: Array<{ id: string; health: string }> };
      const stored = payload.sources.find((item) => item.id === source.id);
      expect(stored?.health).toBe("error");

      await fetch(`${baseUrl}/api/sources/${source.id}`, { method: "DELETE" });
    });
  });
});
