import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { FileSourceRecord } from '../../../db/src/file-sources';
import type { FsFileOwnershipRecord } from '../../../db/src/file-ownership';

const originalDocsWorkRoot = process.env.DOCS_WORK_ROOT;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

async function withDocsServer(workRoot: string) {
  vi.resetModules();
  process.env.DOCS_WORK_ROOT = workRoot;
  const { registerDocsApiRoutes } = await import('./docs');
  const app = express();
  app.use(express.json());
  registerDocsApiRoutes(app);

  let server: ReturnType<typeof app.listen>;
  const baseUrl = await new Promise<string>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind docs test server');
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function rawGetStatus(baseUrl: string, requestPath: string): Promise<number> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: requestPath,
        method: 'GET',
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

afterEach(() => {
  vi.resetModules();
  if (originalDocsWorkRoot === undefined) {
    delete process.env.DOCS_WORK_ROOT;
  } else {
    process.env.DOCS_WORK_ROOT = originalDocsWorkRoot;
  }

  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});

describe('docs routes', () => {
  it('does not expose a team-owned upload through the source docs API', async () => {
    const { registerDocsApiRoutes } = await import('./docs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-upload-'));
    const source: FileSourceRecord = {
      id: 'workspace', display_name: 'Workspace', type: 'local', base_url: null, base_path: root,
      auth_type: 'none', auth_ref: null, enabled: true, icon: null, capabilities: '{}', health: 'ok',
      last_synced_at: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    };
    const ownership: FsFileOwnershipRecord = {
      source_id: 'workspace', path: 'uploads/org-a/team-a/secret.md', org_id: 'org-a', team_id: 'team-a',
      owner_principal_id: 'team-a-owner', display_name: 'secret.md', origin: 'upload',
      uploaded_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    };
    fs.mkdirSync(path.join(root, 'uploads/org-a/team-a'), { recursive: true });
    fs.writeFileSync(path.join(root, ownership.path), 'team-a secret');
    vi.stubEnv('ENTITY_FS_LOCAL_SOURCE_ROOTS', root);
    const app = express();
    app.use((req, _res, next) => {
      req.entityCustomerPrincipal = {
        principalId: 'team-b-reader', principalType: 'human', orgIds: ['org-a'], isGlobalAdmin: false,
        permission: { principal_id: 'team-b-reader', grants: [{ role: 'viewer', org_id: 'org-a', team_id: 'team-b' }] },
      };
      next();
    });
    app.use(express.json());
    registerDocsApiRoutes(app, {
      sourceRepo: { getSource: vi.fn(() => source), listSources: vi.fn(() => [source]) },
      ownershipRepo: { getOwnership: vi.fn(() => ownership) },
    });
    const server = app.listen(0);
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/docs/source/workspace/${ownership.path}`);
    const foreignResponse = await fetch(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/docs/source/workspace/${ownership.path}`, {
      headers: { 'x-entity-org-id': 'org-b' },
    });
    server.close();
    expect(response.status).toBe(404);
    expect(foreignResponse.status).toBe(403);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('fails closed for a workspace docs symlink alias across overlapping sources', async () => {
    const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-empty-'));
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-workspace-'));
    const nestedRoot = path.join(workspaceRoot, 'nested');
    const aliasRoot = path.join(workspaceRoot, 'nested-alias');
    const uploadPath = 'uploads/org-a/team-a/secret.md';
    fs.mkdirSync(path.join(nestedRoot, 'uploads/org-a/team-a'), { recursive: true });
    fs.writeFileSync(path.join(nestedRoot, uploadPath), 'team-a secret');
    fs.symlinkSync(nestedRoot, aliasRoot, 'dir');
    // Put the real workspace in an allowed docs root so this exercises the
    // resolved-file branch before any source fallback is attempted.
    vi.stubEnv('DOCS_WORK_ROOT', workspaceRoot);
    vi.resetModules();

    try {
      const { registerDocsApiRoutes } = await import('./docs');
      const workspace: FileSourceRecord = {
        id: 'workspace', display_name: 'Workspace', type: 'local', base_url: null, base_path: workspaceRoot,
        auth_type: 'none', auth_ref: null, enabled: true, icon: null, capabilities: '{}', health: 'ok',
        last_synced_at: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      };
      const nested: FileSourceRecord = { ...workspace, id: 'nested', display_name: 'Nested', base_path: nestedRoot, enabled: false };
      const ownership: FsFileOwnershipRecord = {
        source_id: 'nested', path: uploadPath, org_id: 'org-a', team_id: 'team-a',
        owner_principal_id: 'team-a-owner', display_name: 'secret.md', origin: 'upload',
        uploaded_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      };
      const app = express();
      app.use((req, _res, next) => {
        req.entityCustomerPrincipal = {
          principalId: 'team-b-reader', principalType: 'human', orgIds: ['org-a'], isGlobalAdmin: false,
          permission: { principal_id: 'team-b-reader', grants: [{ role: 'viewer', org_id: 'org-a', team_id: 'team-b' }] },
        };
        next();
      });
      registerDocsApiRoutes(app, {
        sourceRepo: { getSource: vi.fn(), listSources: vi.fn(() => [workspace, nested]) },
        ownershipRepo: { getOwnership: vi.fn((sourceId: string) => sourceId === 'nested' ? ownership : undefined) },
      });
      const server = app.listen(0);
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/docs/workspace/nested-alias/${uploadPath}`);
      server.close();
      expect(response.status).toBe(404);
    } finally {
      fs.rmSync(docsRoot, { recursive: true, force: true });
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('does not allow Henry/Enterprise-specific workspace paths as product defaults', () => {
    const source = fs.readFileSync(path.join(__dirname, 'docs.ts'), 'utf-8');

    const privateWorkspaceRoot = path.join('/Users', 'enterprise', 'clawd');
    const privateCheckoutRoot = path.join('/Users', 'enterprise', 'Code', 'Entity');

    expect(source).not.toContain(privateWorkspaceRoot);
    expect(source).not.toContain(privateCheckoutRoot);
  });

  it('does not let an unrelated local source veto a valid fallback candidate', async () => {
    const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-fallback-root-'));
    const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-fallback-candidate-'));
    const unrelatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-fallback-unrelated-'));
    const fallbackPath = 'uploads/org-a/team-a/fallback-owned.md';
    fs.mkdirSync(path.join(candidateRoot, path.dirname(fallbackPath)), { recursive: true });
    fs.writeFileSync(path.join(candidateRoot, fallbackPath), '# Owned fallback\n');
    const originalWorkspaceRoot = process.env.ENTITY_WORKSPACE_ROOT;
    process.env.DOCS_WORK_ROOT = docsRoot;
    process.env.ENTITY_WORKSPACE_ROOT = docsRoot;
    vi.resetModules();

    try {
      const { registerDocsApiRoutes } = await import('./docs');
      const sourceOne: FileSourceRecord = {
        id: 'candidate', display_name: 'Candidate', type: 'local', base_url: null, base_path: candidateRoot,
        auth_type: 'none', auth_ref: null, enabled: true, icon: null, capabilities: '{}', health: 'ok',
        last_synced_at: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      };
      const sourceTwo: FileSourceRecord = { ...sourceOne, id: 'unrelated', display_name: 'Unrelated', base_path: unrelatedRoot };
      const ownership: FsFileOwnershipRecord = {
        source_id: sourceOne.id, path: fallbackPath, org_id: 'org-a', team_id: 'team-a',
        owner_principal_id: 'owner-a', display_name: path.basename(fallbackPath), origin: 'upload',
        uploaded_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      };
      const app = express();
      app.use((req, _res, next) => {
        req.headers['x-entity-org-id'] = 'org-a';
        req.entityCustomerPrincipal = {
          principalId: 'team-a-reader', principalType: 'human', orgIds: ['org-a'], isGlobalAdmin: false,
          permission: { principal_id: 'team-a-reader', grants: [{ role: 'viewer', org_id: 'org-a', team_id: 'team-a' }] },
        };
        next();
      });
      registerDocsApiRoutes(app, {
        sourceRepo: {
          getSource: vi.fn((id: string) => id === sourceOne.id ? sourceOne : sourceTwo),
          listSources: vi.fn(() => [sourceOne, sourceTwo]),
        },
        ownershipRepo: {
          getOwnership: vi.fn((sourceId: string, filePath: string) => sourceId === ownership.source_id && filePath === ownership.path ? ownership : undefined),
        },
      });
      const server = app.listen(0);
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind docs fallback test server');
      try {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/docs/workspace/${fallbackPath}`);
        const body = await response.json() as { content?: string; error?: string };
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.content).toContain('Owned fallback');
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    } finally {
      if (originalWorkspaceRoot === undefined) delete process.env.ENTITY_WORKSPACE_ROOT;
      else process.env.ENTITY_WORKSPACE_ROOT = originalWorkspaceRoot;
      delete process.env.DOCS_WORK_ROOT;
      fs.rmSync(docsRoot, { recursive: true, force: true });
      fs.rmSync(candidateRoot, { recursive: true, force: true });
      fs.rmSync(unrelatedRoot, { recursive: true, force: true });
    }
  });

  it('serves output docs from DOCS_WORK_ROOT instead of the repo workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-root-'));
    fs.mkdirSync(path.join(root, 'output'), { recursive: true });
    fs.writeFileSync(path.join(root, 'output', 'report.md'), '# Output Report\n\nLoaded from clawd output.');

    const server = await withDocsServer(root);
    try {
      const response = await fetch(`${server.baseUrl}/api/docs/output/report.md`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.root).toBe('output');
      expect(payload.content).toContain('Loaded from clawd output.');
    } finally {
      await server.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows benign punctuation inside source filenames while rejecting exact traversal segments', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-root-'));
    const server = await withDocsServer(root);

    try {
      expect(
        await rawGetStatus(
          server.baseUrl,
          '/docs/source/workspace/reports/report..final.md',
        ),
      ).not.toBe(403);
      expect(
        await rawGetStatus(
          server.baseUrl,
          '/docs/source/workspace/reports/draft.md~',
        ),
      ).not.toBe(403);

      expect(
        await rawGetStatus(
          server.baseUrl,
          '/docs/source/workspace/reports/%2E%2E/report.md',
        ),
      ).toBe(403);
      expect(
        await rawGetStatus(
          server.baseUrl,
          '/docs/source/workspace/reports/%7E/report.md',
        ),
      ).toBe(403);
    } finally {
      await server.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows consecutive dots in source-backed API filenames while rejecting traversal segments', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-root-'));
    const server = await withDocsServer(root);

    try {
      expect(
        await rawGetStatus(
          server.baseUrl,
          '/api/docs/source/workspace/reports/report..final.md',
        ),
      ).not.toBe(403);
      expect(
        await rawGetStatus(
          server.baseUrl,
          '/api/docs/source/workspace/reports/%2E%2E/report.md',
        ),
      ).toBe(403);
      expect(
        await rawGetStatus(
          server.baseUrl,
          '/api/docs/source/workspace/reports%5C..%5Csecret.md',
        ),
      ).toBe(403);
    } finally {
      await server.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports missing OpenAI TTS configuration without falling back to another provider', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-root-'));
    fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(root, 'memory', 'note.md'), '# Note\n\nSpeak this text.');
    delete process.env.OPENAI_API_KEY;

    const server = await withDocsServer(root);
    try {
      const response = await fetch(`${server.baseUrl}/api/docs/memory/note.md/tts?provider=openai`);
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toMatch(/OPENAI_API_KEY/);
    } finally {
      await server.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
