import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
const originalMissionControlDbPath = process.env.MISSION_CONTROL_DB_PATH;
const testDbPaths: string[] = [];

function useTestDatabase(): string {
  const dbPath = path.join(
    os.tmpdir(),
    `entity-engineering-seed-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
  testDbPaths.push(dbPath);
  process.env.ENTITY_TASK_DB_PATH = dbPath;
  process.env.MISSION_CONTROL_DB_PATH =
    '/tmp/nonexistent-entity-engineering-seed-mc.sqlite';
  return dbPath;
}

afterEach(() => {
  if (originalDbPath === undefined) delete process.env.ENTITY_TASK_DB_PATH;
  else process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  if (originalMissionControlDbPath === undefined) {
    delete process.env.MISSION_CONTROL_DB_PATH;
  } else {
    process.env.MISSION_CONTROL_DB_PATH = originalMissionControlDbPath;
  }

  for (const dbPath of testDbPaths.splice(0)) {
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
  }
  vi.resetModules();
});

describe('Entity Engineering project seed', () => {
  it('creates the exact default-scoped project once across repeated bootstrap', async () => {
    useTestDatabase();
    const dbModule = await import('./index');
    const scope = {
      orgId: dbModule.DEFAULT_WORKSPACE_ORG_ID,
      teamId: dbModule.DEFAULT_WORKSPACE_TEAM_ID,
    };

    const firstRepository = dbModule.createWorkspaceScopeRepository();
    expect(
      firstRepository
        .listProjects(scope)
        .filter((project) => project.project_key === 'entity-engineering'),
    ).toEqual([
      expect.objectContaining({
        org_id: dbModule.DEFAULT_WORKSPACE_ORG_ID,
        team_id: dbModule.DEFAULT_WORKSPACE_TEAM_ID,
        name: 'Entity Engineering',
        lifecycle_state: 'active',
        project_key: 'entity-engineering',
        work_domain: 'engineering',
      }),
    ]);

    const secondRepository = dbModule.createWorkspaceScopeRepository();
    expect(
      secondRepository
        .listProjects(scope)
        .filter((project) => project.project_key === 'entity-engineering'),
    ).toHaveLength(1);
  });

  it('adds the seed without updating a pre-existing business project', async () => {
    const dbPath = useTestDatabase();
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id TEXT NOT NULL DEFAULT 'default-org',
        team_id TEXT NOT NULL DEFAULT 'default-team',
        name TEXT NOT NULL,
        color TEXT,
        lifecycle_state TEXT NOT NULL DEFAULT 'active',
        project_key TEXT,
        work_domain TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO projects (
        org_id,
        team_id,
        name,
        color,
        lifecycle_state,
        project_key,
        work_domain,
        created_at
      ) VALUES (
        'default-org',
        'default-team',
        'Business Operations',
        '#123456',
        'review',
        'business-operations',
        'business-ops',
        '2026-01-02T03:04:05Z'
      );
    `);
    legacyDb.close();

    const dbModule = await import('./index');
    const repository = dbModule.createWorkspaceScopeRepository();
    const projects = repository.listProjects({
      orgId: dbModule.DEFAULT_WORKSPACE_ORG_ID,
      teamId: dbModule.DEFAULT_WORKSPACE_TEAM_ID,
    });

    expect(
      projects.find((project) => project.project_key === 'business-operations'),
    ).toMatchObject({
      name: 'Business Operations',
      color: '#123456',
      lifecycle_state: 'review',
      work_domain: 'business-ops',
      created_at: '2026-01-02T03:04:05.000Z',
    });
    expect(
      projects.filter((project) => project.project_key === 'entity-engineering'),
    ).toHaveLength(1);
  });
});
