import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerConfigRoutes } from './routes';

const db = new Database(':memory:');

vi.mock('../../../db/src/entity-db', () => ({
  getEntityDatabase: (initializer?: (database: Database.Database) => void) => {
    initializer?.(db);
    return db;
  },
}));

function createServer() {
  const app = express();
  app.use(express.json());
  registerConfigRoutes(app);
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

describe('config routes', () => {
  beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS app_settings');
    db.exec('DROP TABLE IF EXISTS entity_agents');
    vi.stubEnv('PORT', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns effective config with source metadata', async () => {
    const server = await createServer();
    try {
      const res = await fetch(`${server.baseUrl}/api/config/effective`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.settings.profile.displayName).toBe('Entity Workspace');
      expect(body.sources['profile.displayName'].source).toBe('default');
    } finally {
      await server.close();
    }
  });

  it('saves DB-backed runtime profile and safe server patches', async () => {
    const server = await createServer();
    try {
      const res = await fetch(`${server.baseUrl}/api/settings/config/runtime`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: { displayName: 'Portable Entity', ownerName: 'Ops' },
          server: { publicBaseUrl: 'https://entity.example.test' },
          tasks: { defaultAssignee: 'agent-alpha' },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.settings.profile.displayName).toBe('Portable Entity');
      expect(body.settings.profile.ownerName).toBe('Ops');
      expect(body.settings.server.publicBaseUrl).toBe('https://entity.example.test');
      expect(body.settings.tasks.defaultAssignee).toBe('agent-alpha');
      expect(body.sources['profile.displayName'].source).toBe('database');
      expect(body.sources['server.publicBaseUrl'].source).toBe('database');
      expect(body.sources['tasks.defaultAssignee'].source).toBe('database');
    } finally {
      await server.close();
    }
  });

  it('includes DB-backed agents in effective config visibility', async () => {
    db.exec(`
      CREATE TABLE entity_agents (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL,
        avatar_url TEXT,
        description TEXT,
        adapter_type TEXT,
        runtime_type TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        instructions_path TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO entity_agents (id, slug, name, emoji, avatar_url, description, adapter_type, runtime_type, status)
      VALUES ('agent-alpha', 'agent-alpha', 'Agent Alpha', '🤖', NULL, 'General operator', 'local', 'cli', 'active');
    `);

    const server = await createServer();
    try {
      const res = await fetch(`${server.baseUrl}/api/config/effective`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.settings.agents).toEqual([
        expect.objectContaining({
          id: 'agent-alpha',
          name: 'Agent Alpha',
          role: 'General operator',
          enabled: true,
          gateway: expect.objectContaining({ type: 'local', tokenRef: '[REDACTED]' }),
        }),
      ]);
      expect(body.sources['agents'].source).toBe('database');
      expect(body.sources['agents[0].name'].source).toBe('database');
    } finally {
      await server.close();
    }
  });

  it('includes DB-backed file sources in effective config visibility', async () => {
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
        health TEXT NOT NULL DEFAULT 'ok',
        last_synced_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO file_sources (id, display_name, type, base_url, base_path, enabled, icon)
      VALUES ('docs', 'Portable Docs', 'local', NULL, './docs', 1, '📄');
    `);

    const server = await createServer();
    try {
      const res = await fetch(`${server.baseUrl}/api/config/effective`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.settings.fileSources).toEqual([
        expect.objectContaining({
          id: 'docs',
          displayName: 'Portable Docs',
          type: 'local',
          basePath: './docs',
          baseUrl: null,
          enabled: true,
        }),
      ]);
      expect(body.sources['fileSources'].source).toBe('database');
      expect(body.sources['fileSources[0].basePath'].source).toBe('database');
    } finally {
      await server.close();
    }
  });

  it('rejects invalid runtime patches', async () => {
    const server = await createServer();
    try {
      const res = await fetch(`${server.baseUrl}/api/settings/config/runtime`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: { port: -1 } }),
      });
      expect(res.status).toBe(400);
    } finally {
      await server.close();
    }
  });
});
