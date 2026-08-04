import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileSourceRepository } from '../../../db/src/file-sources';
import { registerDocumentConvertRoutes } from './routes-convert';

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-convert-route-'));
  tempRoots.push(root);
  return root;
}

async function requestApp(app: express.Express, body: Record<string, unknown>) {
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const res = await fetch(`http://127.0.0.1:${port}/documents/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  server.close();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

describe('document convert routes', () => {
  let root = '';
  let sourceRepo = createFileSourceRepository();
  let sourceId = '';

  beforeEach(async () => {
    root = await makeTempRoot();
    sourceId = `convert-source-${Date.now()}`;
    vi.stubEnv('ENTITY_FS_LOCAL_SOURCE_ROOTS', root);
    sourceRepo = createFileSourceRepository();
    sourceRepo.createSource({
      id: sourceId,
      display_name: 'Convert Source',
      type: 'local',
      base_path: root,
      enabled: true,
    });
    await fs.promises.writeFile(path.join(root, 'source.md'), '# Source doc\n\nConvert me into a PRD.', 'utf-8');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempRoots.splice(0).map((entry) => fs.promises.rm(entry, { recursive: true, force: true })));
  });

  it('dry-run previews conversion without writing', async () => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, { sourceRepo });
    app.use(router);

    const result = await requestApp(app, {
      sourceId,
      path: 'source.md',
      targetType: 'prd',
      targetName: 'Converted PRD',
      dryRun: true,
    });

    expect(result.status).toBe(200);
    expect(result.body.dryRun).toBe(true);
    expect(result.body.preview).toContain('# Converted PRD');
    await expect(fs.promises.readdir(path.join(root, 'converted'))).rejects.toThrow();
    await expect(fs.promises.readFile(path.join(root, 'source.md'), 'utf-8')).resolves.toContain('Convert me into a PRD.');
  });

  it('creates a converted document while preserving the source file', async () => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, { sourceRepo });
    app.use(router);

    const result = await requestApp(app, {
      sourceId,
      path: 'source.md',
      targetType: 'blog',
      targetName: 'Converted Blog',
    });

    expect(result.status).toBe(201);
    expect(result.body.targetType).toBe('blog');
    const converted = await fs.promises.readFile(path.join(root, result.body.targetPath), 'utf-8');
    expect(converted).toContain('entity_source_path: source.md');
    expect(converted).toContain('## Hook');
    await expect(fs.promises.readFile(path.join(root, 'source.md'), 'utf-8')).resolves.toContain('Convert me into a PRD.');
  });

  it('rejects existing converted targets without overwriting', async () => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, { sourceRepo });
    app.use(router);

    await requestApp(app, {
      sourceId,
      path: 'source.md',
      targetType: 'prd',
      targetName: 'Collision Test',
    });

    const second = await requestApp(app, {
      sourceId,
      path: 'source.md',
      targetType: 'prd',
      targetName: 'Collision Test',
    });

    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/already exists/i);
  });

  it('rejects read-only sources clearly', async () => {
    const blockedRoot = await makeTempRoot();
    const blockedRepo = createFileSourceRepository();
    const blockedId = `blocked-${Date.now()}`;
    blockedRepo.createSource({
      id: blockedId,
      display_name: 'Blocked',
      type: 'local',
      base_path: blockedRoot,
      enabled: true,
    });

    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerDocumentConvertRoutes(router, { sourceRepo: blockedRepo });
    app.use(router);

    const result = await requestApp(app, {
      sourceId: blockedId,
      path: 'source.md',
      targetType: 'prd',
    });

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/read-only/i);
  });
});
