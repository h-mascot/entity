import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerNodeOperationsRoutes } from './node-operations';
import { resetFsMetricsForTests, recordFsOperation } from './fs/metrics';

let db: Database.Database;
let dbPath: string;

vi.mock('../../db/src/entity-db', () => ({
  getEntityDatabase: (initializer?: (database: Database.Database) => void) => {
    initializer?.(db);
    return db;
  },
}));

function createServer() {
  const app = express();
  app.use(express.json());
  registerNodeOperationsRoutes(app);
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No test server address');
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

describe('node operations routes', () => {
  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `entity-node-ops-${Date.now()}-${Math.random()}.db`);
    db = new Database(dbPath);
    db.exec('DROP TABLE IF EXISTS file_sources');
    resetFsMetricsForTests();
    vi.stubEnv('ENTITY_OPENCLAW_WEBHOOK_TOKEN', 'test-token');
    vi.stubEnv('WEBHOOK_DEPLOY_TOKEN', 'deploy-token');
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore */ }
    }
    vi.unstubAllEnvs();
  });

  it('surfaces file-transfer capabilities, metrics, and webhook ingress status', async () => {
    db.exec(`
      CREATE TABLE file_sources (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        type TEXT NOT NULL,
        base_url TEXT,
        base_path TEXT,
        auth_type TEXT NOT NULL DEFAULT 'none',
        auth_ref TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        icon TEXT,
        capabilities TEXT NOT NULL DEFAULT '{}',
        health TEXT NOT NULL DEFAULT 'unknown',
        last_synced_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO file_sources (id, display_name, type, base_path, enabled, capabilities, health)
      VALUES ('workspace', 'Workspace', 'local', '/tmp/entity-test', 1, '{}', 'ok');
    `);
    recordFsOperation({ operation: 'fs.file', sourceId: 'workspace', durationMs: 12, success: true });

    const server = await createServer();
    try {
      const res = await fetch(`${server.baseUrl}/api/node-operations`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.fileTransfer.enabled).toBe(true);
      expect(body.fileTransfer.operations.map((op: any) => op.id)).toEqual(
        expect.arrayContaining(['file_fetch', 'dir_list', 'dir_fetch', 'file_write'])
      );
      const workspaceSource = body.fileTransfer.sources.find((source: any) => source.id === 'workspace');
      expect(workspaceSource).toBeDefined();
      expect(workspaceSource.operations['fs.file'].count).toBe(1);
      expect(body.webhooks.routes.find((route: any) => route.id === 'openclaw-review-result').auth).toBe('bearer-token');
      expect(body.webhooks.routes.find((route: any) => route.id === 'entity-deploy-webhook').enabled).toBe(true);
    } finally {
      await server.close();
    }
  });
});
