import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let activeDbPath: string | null = null;
let cleanupDbPaths: string[] = [];

function sqliteFiles(dbPath: string): string[] {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

function removeSqliteFiles(dbPath: string): void {
  for (const file of sqliteFiles(dbPath)) {
    fs.rmSync(file, { force: true });
  }
}

function tempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

async function loadDbModule(): Promise<typeof import('./index')> {
  activeDbPath = tempDbPath('entity-db-activity-report');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', tempDbPath('missing-mission-control'));
  return import('./index');
}

afterEach(async () => {
  const dbPathToClose = activeDbPath;
  if (dbPathToClose) {
    const closePath = tempDbPath('entity-db-activity-report-close');
    cleanupDbPaths.push(closePath);
    vi.stubEnv('ENTITY_TASK_DB_PATH', closePath);
    try {
      const { getEntityDatabase } = await import('./entity-db');
      getEntityDatabase().close();
    } catch {
      // Best-effort cleanup after a failed test import.
    }
  }

  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of cleanupDbPaths) {
    removeSqliteFiles(dbPath);
  }
  activeDbPath = null;
  cleanupDbPaths = [];
});

interface ActivityReportFixture {
  db: typeof import('./index');
  orgAId: string;
  orgBId: string;
  orgATeam1: string;
  orgATeam2: string;
  taskA1: number;
  taskA2: number;
  taskB1: number;
}

async function loadFixture(): Promise<ActivityReportFixture> {
  const db = await loadDbModule();
  const workspace = db.createWorkspaceScopeRepository();
  workspace.createOrg({ id: 'org-a', name: 'Org A' });
  workspace.createOrg({ id: 'org-b', name: 'Org B' });
  workspace.createTeam({ orgId: 'org-a' }, { id: 'team-a1', name: 'Team A1' });
  workspace.createTeam({ orgId: 'org-a' }, { id: 'team-a2', name: 'Team A2' });

  const tasks = db.createTaskRepository();
  const taskA1 = tasks.createTask({ name: 'Org A task 1', org_id: 'org-a', team_id: 'team-a1' }).id;
  const taskA2 = tasks.createTask({ name: 'Org A task 2', org_id: 'org-a', team_id: 'team-a2' }).id;
  const taskB1 = tasks.createTask({ name: 'Org B task 1', org_id: 'org-b', team_id: 'default-team' }).id;

  const activities = db.createActivityRepository();
  activities.createActivity({
    source: 'task',
    type: 'task_created',
    action: 'task.created',
    description: 'A1 created by Ada',
    task_id: taskA1,
    agent_name: 'Ada',
    activity_event_payload: { actor_principal_id: 'Ada', actor_type: 'human', task_id: taskA1 },
  });
  activities.createActivity({
    source: 'agent',
    type: 'file_edit',
    action: 'file.edited',
    description: 'A2 edited by Spock',
    task_id: taskA2,
    agent_name: 'Spock',
    activity_event_payload: { actor_principal_id: 'Spock', actor_type: 'agent', task_id: taskA2 },
  });
  activities.createActivity({
    source: 'task',
    type: 'task_completed',
    action: 'task.completed',
    description: 'B1 completed with no principal',
    task_id: taskB1,
    agent_name: 'Scotty',
  });
  activities.createActivity({
    source: 'agent',
    type: 'message_sent',
    action: 'message.sent',
    description: 'Unscoped activity without a task',
  });

  return { db, orgAId: 'org-a', orgBId: 'org-b', orgATeam1: 'team-a1', orgATeam2: 'team-a2', taskA1, taskA2, taskB1 };
}

describe('activity repository filtered listing (MC #1369)', () => {
  it('scopes activities to an org via the tasks join and reports the total', async () => {
    const { db, taskA1, taskA2 } = await loadFixture();
    const activities = db.createActivityRepository();

    const result = activities.listActivitiesFiltered({ orgId: 'org-a' });
    expect(result.total).toBe(2);
    expect(result.activities.map((activity) => activity.task_id).sort()).toEqual([taskA1, taskA2].sort());
  });

  it('scopes to a team within an org', async () => {
    const { db, taskA1 } = await loadFixture();
    const activities = db.createActivityRepository();

    const result = activities.listActivitiesFiltered({ orgId: 'org-a', teamId: 'team-a1' });
    expect(result.total).toBe(1);
    expect(result.activities[0].task_id).toBe(taskA1);
  });

  it('filters by actor principal from the structured payload or agent_name', async () => {
    const { db } = await loadFixture();
    const activities = db.createActivityRepository();

    const byPayloadActor = activities.listActivitiesFiltered({ actor: 'Ada' });
    expect(byPayloadActor.total).toBe(1);
    expect(byPayloadActor.activities[0].agent_name).toBe('Ada');

    const byAgentName = activities.listActivitiesFiltered({ actor: 'Scotty' });
    expect(byAgentName.total).toBe(1);
    expect(byAgentName.activities[0].description).toBe('B1 completed with no principal');
  });

  it('filters by source, type, and taskId', async () => {
    const { db, taskA2 } = await loadFixture();
    const activities = db.createActivityRepository();

    expect(activities.listActivitiesFiltered({ source: 'task' }).total).toBe(2);
    expect(activities.listActivitiesFiltered({ type: 'file_edit' }).total).toBe(1);
    expect(activities.listActivitiesFiltered({ type: 'file_edit', source: 'task' }).total).toBe(0);

    const byTask = activities.listActivitiesFiltered({ taskId: taskA2 });
    expect(byTask.total).toBe(1);
    expect(byTask.activities[0].action).toBe('file.edited');
  });

  it('applies from/to date bounds', async () => {
    const { db } = await loadFixture();
    const activities = db.createActivityRepository();

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    expect(activities.listActivitiesFiltered({ from: tomorrow }).total).toBe(0);
    expect(activities.listActivitiesFiltered({ to: yesterday }).total).toBe(0);
    expect(activities.listActivitiesFiltered({ from: yesterday, to: tomorrow }).total).toBe(4);
  });

  it('paginates with limit/offset and keeps total across pages', async () => {
    const { db } = await loadFixture();
    const activities = db.createActivityRepository();

    const pageOne = activities.listActivitiesFiltered({ limit: 2, offset: 0 });
    expect(pageOne.activities).toHaveLength(2);
    expect(pageOne.total).toBe(4);

    const pageTwo = activities.listActivitiesFiltered({ limit: 2, offset: 2 });
    expect(pageTwo.activities).toHaveLength(2);
    expect(pageTwo.total).toBe(4);

    const ids = [...pageOne.activities, ...pageTwo.activities].map((activity) => activity.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('returns an empty result set for out-of-range offsets', async () => {
    const { db } = await loadFixture();
    const activities = db.createActivityRepository();

    const result = activities.listActivitiesFiltered({ offset: 500 });
    expect(result.activities).toEqual([]);
    expect(result.total).toBe(4);
  });
});

describe('activity repository report aggregation (MC #1369)', () => {
  it('aggregates totals, byActor, byAction, byDay, bySource, and byType', async () => {
    const { db } = await loadFixture();
    const activities = db.createActivityRepository();

    const report = activities.getActivityReport({ orgId: 'org-a' });
    expect(report.totals.count).toBe(2);
    expect(report.byActor.map((row) => row.actor).sort()).toEqual(['Ada', 'Spock']);
    expect(report.byActor.map((row) => row.count)).toEqual([1, 1]);
    expect(report.byAction.map((row) => row.action).sort()).toEqual(['file.edited', 'task.created']);
    expect(report.bySource).toEqual([{ source: 'agent', count: 1 }, { source: 'task', count: 1 }]);
    expect(report.byType.map((row) => row.type).sort()).toEqual(['file_edit', 'task_created']);
    expect(report.byDay).toHaveLength(1);
    expect(report.byDay[0].count).toBe(2);
    expect(report.byDay[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('falls back to agent_name for the actor label when the payload lacks a principal', async () => {
    const { db } = await loadFixture();
    const activities = db.createActivityRepository();

    const report = activities.getActivityReport({ orgId: 'org-b' });
    expect(report.totals.count).toBe(1);
    expect(report.byActor).toEqual([{ actor: 'Scotty', count: 1 }]);
  });

  it('respects the same filters as the filtered listing', async () => {
    const { db } = await loadFixture();
    const activities = db.createActivityRepository();

    const report = activities.getActivityReport({ actor: 'Ada' });
    expect(report.totals.count).toBe(1);
    expect(report.byAction).toEqual([{ action: 'task.created', count: 1 }]);
  });

  it('returns zeroed aggregation for a window that matches nothing', async () => {
    const { db } = await loadFixture();
    const activities = db.createActivityRepository();

    const report = activities.getActivityReport({ from: '2999-01-01' });
    expect(report.totals.count).toBe(0);
    expect(report.byActor).toEqual([]);
    expect(report.byAction).toEqual([]);
    expect(report.byDay).toEqual([]);
    expect(report.bySource).toEqual([]);
    expect(report.byType).toEqual([]);
  });
});
