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
    `entity-work-domain-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
  testDbPaths.push(dbPath);
  process.env.ENTITY_TASK_DB_PATH = dbPath;
  process.env.MISSION_CONTROL_DB_PATH = '/tmp/nonexistent-entity-work-domain-mc.sqlite';
  return dbPath;
}

afterEach(() => {
  if (originalDbPath === undefined) delete process.env.ENTITY_TASK_DB_PATH;
  else process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  if (originalMissionControlDbPath === undefined) delete process.env.MISSION_CONTROL_DB_PATH;
  else process.env.MISSION_CONTROL_DB_PATH = originalMissionControlDbPath;

  for (const dbPath of testDbPaths.splice(0)) {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${dbPath}${suffix}`, { force: true });
      } catch {
        // Best-effort cleanup for temporary SQLite files.
      }
    }
  }
  vi.resetModules();
});

describe('work-domain project migration', () => {
  it('adds nullable classification fields and indexes idempotently without backfilling legacy projects', async () => {
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO projects (org_id, team_id, name, color)
      VALUES ('default-org', 'default-team', 'Legacy Project', '#123456');
    `);
    legacyDb.close();

    const dbModule = await import('./index');
    const repository = dbModule.createWorkspaceScopeRepository();
    const legacyProject = repository
      .listProjects({ orgId: 'default-org', teamId: 'default-team' })
      .find((project) => project.name === 'Legacy Project');

    expect(legacyProject).toMatchObject({
      project_key: null,
      work_domain: null,
    });

    dbModule.createWorkspaceScopeRepository();

    const inspectionDb = new Database(dbPath, { readonly: true });
    const columns = inspectionDb
      .prepare('PRAGMA table_info(projects)')
      .all() as Array<{ name: string }>;
    const indexes = inspectionDb
      .prepare('PRAGMA index_list(projects)')
      .all() as Array<{ name: string; unique: number; partial: number }>;
    inspectionDb.close();

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['project_key', 'work_domain']),
    );
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'idx_projects_org_team_project_key',
          unique: 1,
          partial: 1,
        }),
        expect.objectContaining({
          name: 'idx_projects_org_team_work_domain',
          unique: 0,
        }),
      ]),
    );
    expect(indexes.filter((index) => index.name === 'idx_projects_org_team_project_key')).toHaveLength(1);
    expect(indexes.filter((index) => index.name === 'idx_projects_org_team_work_domain')).toHaveLength(1);
  });

  it('persists only normalized nullable project keys and work domains', async () => {
    useTestDatabase();
    const dbModule = await import('./index');
    const repository = dbModule.createWorkspaceScopeRepository();
    const scope = {
      orgId: dbModule.DEFAULT_WORKSPACE_ORG_ID,
      teamId: dbModule.DEFAULT_WORKSPACE_TEAM_ID,
    };

    const classified = repository.createProject(scope, {
      name: 'Engineering Platform',
      project_key: 'engineering-platform',
      work_domain: 'engineering',
    });
    expect(classified).toMatchObject({
      project_key: 'engineering-platform',
      work_domain: 'engineering',
    });

    for (const projectKey of ['', 'Engineering', '-engineering', 'engineering--platform', 'x'.repeat(65)]) {
      expect(() =>
        repository.createProject(scope, {
          name: `Invalid ${projectKey || 'empty'}`,
          project_key: projectKey,
        }),
      ).toThrow('project_key must be a normalized lowercase slug');
    }

    expect(() =>
      repository.createProject(scope, {
        name: 'Invalid domain',
        work_domain: 'Engineering',
      }),
    ).toThrow('work_domain must be a normalized lowercase slug');
  });

  it('enforces project-key uniqueness within an org and team only', async () => {
    useTestDatabase();
    const dbModule = await import('./index');
    const repository = dbModule.createWorkspaceScopeRepository();
    const orgA = repository.createOrg({ id: 'org-a', name: 'Org A' });
    const orgB = repository.createOrg({ id: 'org-b', name: 'Org B' });
    const teamA = repository.createTeam({ orgId: orgA.id }, { id: 'team-a', name: 'Team A' });
    const teamB = repository.createTeam({ orgId: orgA.id }, { id: 'team-b', name: 'Team B' });
    const teamC = repository.createTeam({ orgId: orgB.id }, { id: 'team-c', name: 'Team C' });

    repository.createProject(
      { orgId: orgA.id, teamId: teamA.id },
      { name: 'First', project_key: 'shared-key' },
    );

    expect(() =>
      repository.createProject(
        { orgId: orgA.id, teamId: teamA.id },
        { name: 'Duplicate', project_key: 'shared-key' },
      ),
    ).toThrow();

    expect(
      repository.createProject(
        { orgId: orgA.id, teamId: teamB.id },
        { name: 'Other Team', project_key: 'shared-key' },
      ).project_key,
    ).toBe('shared-key');
    expect(
      repository.createProject(
        { orgId: orgB.id, teamId: teamC.id },
        { name: 'Other Org', project_key: 'shared-key' },
      ).project_key,
    ).toBe('shared-key');

    const sameScopeSecond = repository.createProject(
      { orgId: orgA.id, teamId: teamA.id },
      { name: 'Second unique project', project_key: 'second-key' },
    );
    expect(() =>
      repository.updateProject(
        { orgId: orgA.id, teamId: teamA.id },
        sameScopeSecond.id,
        { project_key: 'shared-key' },
      ),
    ).toThrow();
  });

  it('updates, clears, lists, and reads project classification in scope', async () => {
    useTestDatabase();
    const dbModule = await import('./index');
    const repository = dbModule.createWorkspaceScopeRepository();
    const scope = {
      orgId: dbModule.DEFAULT_WORKSPACE_ORG_ID,
      teamId: dbModule.DEFAULT_WORKSPACE_TEAM_ID,
    };
    const project = repository.createProject(scope, {
      name: 'Classification lifecycle',
      project_key: 'classification-lifecycle',
      work_domain: 'engineering',
    });

    expect(
      repository.updateProject(scope, project.id, {
        project_key: 'classification-updated',
        work_domain: 'platform',
      }),
    ).toMatchObject({
      project_key: 'classification-updated',
      work_domain: 'platform',
    });
    expect(repository.getProject(scope, project.id)).toMatchObject({
      project_key: 'classification-updated',
      work_domain: 'platform',
    });
    expect(repository.listProjects(scope)).toContainEqual(
      expect.objectContaining({
        id: project.id,
        project_key: 'classification-updated',
        work_domain: 'platform',
      }),
    );

    expect(
      repository.updateProject(scope, project.id, {
        project_key: null,
        work_domain: null,
      }),
    ).toMatchObject({
      project_key: null,
      work_domain: null,
    });
    expect(() =>
      repository.updateProject(scope, project.id, { work_domain: 'Platform' }),
    ).toThrow('work_domain must be a normalized lowercase slug');
  });

  it('preserves classification on task links and rejects same-org cross-team assignment', async () => {
    useTestDatabase();
    const dbModule = await import('./index');
    const repository = dbModule.createWorkspaceScopeRepository();
    const org = repository.createOrg({ id: 'scoped-org', name: 'Scoped Org' });
    const teamA = repository.createTeam({ orgId: org.id }, { id: 'scoped-team-a', name: 'Team A' });
    const teamB = repository.createTeam({ orgId: org.id }, { id: 'scoped-team-b', name: 'Team B' });
    const scopeA = { orgId: org.id, teamId: teamA.id };
    const scopeB = { orgId: org.id, teamId: teamB.id };
    const projectA = repository.createProject(scopeA, {
      name: 'Team A Engineering',
      project_key: 'team-a-engineering',
      work_domain: 'engineering',
    });
    const projectB = repository.createProject(scopeB, {
      name: 'Team B Engineering',
      project_key: 'team-b-engineering',
      work_domain: 'engineering',
    });
    const attemptedScopeEscape = repository.createProject(scopeA, {
      name: 'Cannot escape team scope',
      team_id: teamB.id,
      project_key: 'scope-bound-project',
    });
    expect(attemptedScopeEscape.team_id).toBe(teamA.id);
    const task = dbModule.createOrgScopedTaskRepository(scopeA).createTask({
      name: 'Scoped assignment',
    });
    const legacyPathTask = dbModule.createOrgScopedTaskRepository(scopeA).createTask({
      name: 'Legacy assignment path',
    });

    expect(repository.addTaskProject(scopeA, task.id, projectA.id)).toBe(true);
    expect(repository.addTaskProject(scopeA, task.id, projectB.id)).toBe(false);
    expect(dbModule.addTaskProject(legacyPathTask.id, projectA.id)).toBe(true);
    expect(dbModule.addTaskProject(legacyPathTask.id, projectB.id)).toBe(false);
    const replaceTaskProjects = (
      dbModule as unknown as {
        replaceTaskProjects: (taskId: number, projectIds: readonly number[]) => unknown;
      }
    ).replaceTaskProjects;
    expect(() => replaceTaskProjects(legacyPathTask.id, [projectB.id])).toThrow(
      'projects must belong to the task org and team',
    );
    expect(dbModule.getTaskProjects(legacyPathTask.id).map((project) => project.id)).toEqual([
      projectA.id,
    ]);
    expect(repository.getTaskProjects(scopeA, task.id)).toEqual([
      expect.objectContaining({
        id: projectA.id,
        project_key: 'team-a-engineering',
        work_domain: 'engineering',
      }),
    ]);
    expect(repository.getTaskProjects(scopeB, task.id)).toEqual([]);
    expect(repository.getProject(scopeB, projectA.id)).toBeUndefined();
    expect(repository.updateProject(scopeB, projectA.id, { work_domain: 'general' })).toBeUndefined();
    expect(repository.getProject(scopeA, projectA.id)?.work_domain).toBe('engineering');
  });

  it('clears primary references and recomputes compatibility labels when a project is deleted', async () => {
    useTestDatabase();
    const dbModule = await import('./index');
    const repository = dbModule.createWorkspaceScopeRepository();
    const scope = {
      orgId: dbModule.DEFAULT_WORKSPACE_ORG_ID,
      teamId: dbModule.DEFAULT_WORKSPACE_TEAM_ID,
    };
    const deletedProject = repository.createProject(scope, {
      name: 'Delete Me',
      project_key: 'delete-me',
      work_domain: 'engineering',
    });
    const retainedProject = repository.createProject(scope, {
      name: 'Keep Me',
      project_key: 'keep-me',
      work_domain: 'general',
    });
    const tasks = dbModule.createOrgScopedTaskRepository(scope);
    const mixedTask = tasks.createTask({
      name: 'Mixed project task',
      project_id: deletedProject.id,
      project: 'Delete Me, Keep Me',
    });
    const deletedOnlyTask = tasks.createTask({
      name: 'Deleted-only task',
      project_id: deletedProject.id,
      project: 'Delete Me',
    });
    expect(repository.addTaskProject(scope, mixedTask.id, deletedProject.id)).toBe(true);
    expect(repository.addTaskProject(scope, mixedTask.id, retainedProject.id)).toBe(true);
    expect(repository.addTaskProject(scope, deletedOnlyTask.id, deletedProject.id)).toBe(true);

    expect(dbModule.deleteProject(deletedProject.id)).toBe(true);

    expect(tasks.getTask(mixedTask.id)).toMatchObject({
      project_id: null,
      project: 'Keep Me',
      projects: [
        expect.objectContaining({
          id: retainedProject.id,
          project_key: 'keep-me',
          work_domain: 'general',
        }),
      ],
    });
    expect(tasks.getTask(deletedOnlyTask.id)).toMatchObject({
      project_id: null,
      project: 'General',
      projects: [],
    });
  });

  it('preserves classification through the legacy local project create and list path', async () => {
    useTestDatabase();
    const dbModule = await import('./index');

    const created = dbModule.createProject({
      name: 'Legacy API Engineering',
      project_key: 'legacy-api-engineering',
      work_domain: 'engineering',
    });

    expect(created).toMatchObject({
      project_key: 'legacy-api-engineering',
      work_domain: 'engineering',
    });
    expect(dbModule.getProjects()).toContainEqual(
      expect.objectContaining({
        id: created.id,
        project_key: 'legacy-api-engineering',
        work_domain: 'engineering',
      }),
    );
    expect(() =>
      dbModule.createProject({
        name: 'Legacy invalid classification',
        project_key: 'Legacy-Invalid',
      }),
    ).toThrow('project_key must be a normalized lowercase slug');
  });
});
