import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
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
  activeDbPath = tempDbPath('entity-db-test');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', tempDbPath('missing-mission-control'));
  return import('./index');
}

function countRows(db: Database.Database, sql: string, taskId: number): number {
  const row = db.prepare(sql).get(taskId) as { count: number };
  return row.count;
}

afterEach(async () => {
  const dbPathToClose = activeDbPath;
  if (dbPathToClose) {
    const closePath = tempDbPath('entity-db-close');
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

describe('task repository persistence', () => {
  it('creates, reads, updates, moves, and deletes tasks with boundary defaults', async () => {
    const db = await loadDbModule();
    const tasks = db.createTaskRepository();

    const created = tasks.createTask({
      name: '  Add DB coverage  ',
      description: '  Exercise core persistence  ',
      column: 'not-a-column',
      priority: '',
      estimate_hours: 0,
      time_spent: 0,
    });

    expect(created.name).toBe('Add DB coverage');
    expect(created.description).toBe('Exercise core persistence');
    expect(created.column).toBe('backlog');
    expect(created.priority).toBe('P2');
    expect(created.estimate_hours).toBe(0);
    expect(created.time_spent).toBe(0);
    expect(tasks.getTask(created.id)).toMatchObject({ id: created.id, name: 'Add DB coverage' });

    const updated = tasks.updateTask(created.id, {
      name: '  Updated task  ',
      description: '   ',
      column: 'doing',
      blocked: true,
      blocker_reason: ' waiting on reviewer ',
      estimate_hours: 1.5,
      time_spent: 0,
    });

    expect(updated).toMatchObject({
      id: created.id,
      name: 'Updated task',
      description: null,
      column: 'doing',
      blocked: true,
      blocker_reason: 'waiting on reviewer',
      estimate_hours: 1.5,
      time_spent: 0,
    });
    expect(tasks.updateTask(999_999, { name: 'missing' })).toBeUndefined();

    expect(tasks.moveTask(created.id, 'review')).toMatchObject({ id: created.id, column: 'review' });
    expect(tasks.deleteTask(created.id)).toBe(true);
    expect(tasks.getTask(created.id)).toBeUndefined();
    expect(tasks.deleteTask(created.id)).toBe(false);
  });

  it('purges child rows before SQLite reuses a deleted task id', async () => {
    const db = await loadDbModule();
    const tasks = db.createTaskRepository();
    const comments = db.createTaskCommentRepository();
    const activities = db.createActivityRepository();
    const spineEvents = db.createActivityEventSpineRepository();
    const rawDbModule = await import('./entity-db');
    const rawDb = rawDbModule.getEntityDatabase();

    const first = tasks.createTask({ name: 'Task with child rows' });
    const project = db.createProject({ name: 'Cleanup Project' });
    comments.createComment({ task_id: first.id, body: ' keep this scoped to the first task ', author: 'Reviewer' });
    activities.createActivity({
      type: 'task_updated',
      action: 'Task touched',
      description: 'Activity row scoped to first task',
      task_id: first.id,
    });
    expect(spineEvents.appendForTask(first.id, { eventType: 'progress' }).ok).toBe(true);
    expect(db.addTaskProject(first.id, project.id)).toBe(true);

    expect(countRows(rawDb, 'SELECT COUNT(*) AS count FROM task_comments WHERE task_id = ?', first.id)).toBe(1);
    expect(countRows(rawDb, 'SELECT COUNT(*) AS count FROM activities WHERE task_id = ?', first.id)).toBe(1);
    expect(countRows(rawDb, 'SELECT COUNT(*) AS count FROM task_activity_spine_events WHERE task_id = ?', first.id)).toBe(1);
    expect(countRows(rawDb, 'SELECT COUNT(*) AS count FROM task_projects WHERE task_id = ?', first.id)).toBe(1);

    expect(tasks.deleteTask(first.id)).toBe(true);
    expect(countRows(rawDb, 'SELECT COUNT(*) AS count FROM task_comments WHERE task_id = ?', first.id)).toBe(0);
    expect(countRows(rawDb, 'SELECT COUNT(*) AS count FROM activities WHERE task_id = ?', first.id)).toBe(0);
    expect(countRows(rawDb, 'SELECT COUNT(*) AS count FROM task_activity_spine_events WHERE task_id = ?', first.id)).toBe(0);
    expect(countRows(rawDb, 'SELECT COUNT(*) AS count FROM task_projects WHERE task_id = ?', first.id)).toBe(0);

    const replacement = tasks.createTask({ name: 'Replacement task' });
    expect(replacement.id).toBe(first.id);
    expect(comments.listComments(replacement.id)).toEqual([]);
    expect(activities.listActivitiesByTaskId(replacement.id)).toEqual([]);
    expect(spineEvents.listForTask(replacement.id).empty).toBe(true);
    expect(db.getTaskProjects(replacement.id)).toEqual([]);
  });

  it('lists subtasks from all supported parent metadata keys and rejects invalid parent ids', async () => {
    const db = await loadDbModule();
    const tasks = db.createTaskRepository();
    const parent = tasks.createTask({ name: 'Parent task' });

    tasks.createTask({ name: 'Snake child', metadata: JSON.stringify({ parent_task_id: parent.id }) });
    tasks.createTask({ name: 'Camel child', metadata: JSON.stringify({ parentTaskId: parent.id }) });
    tasks.createTask({ name: 'Legacy child', metadata: JSON.stringify({ parent_id: parent.id }) });
    tasks.createTask({ name: 'Malformed metadata child', metadata: '{not json' });
    tasks.createTask({ name: 'Unrelated child', metadata: JSON.stringify({ parent_task_id: parent.id + 10 }) });

    expect(tasks.listSubtasks(parent.id).map((task) => task.name).sort()).toEqual([
      'Camel child',
      'Legacy child',
      'Snake child',
    ]);
    expect(tasks.listSubtasks(0)).toEqual([]);
    expect(tasks.listSubtasks(-1)).toEqual([]);
    expect(tasks.listSubtasks(1.5)).toEqual([]);
  });

  it('validates task comment boundaries and normalizes optional parent and author fields', async () => {
    const db = await loadDbModule();
    const tasks = db.createTaskRepository();
    const comments = db.createTaskCommentRepository();
    const task = tasks.createTask({ name: 'Comment parent' });

    expect(() => comments.createComment({ task_id: 0, body: 'not allowed' })).toThrow('task_id must be a positive integer');
    expect(() => comments.createComment({ task_id: task.id, body: '   ' })).toThrow('comment body is required');

    const comment = comments.createComment({ task_id: task.id, body: '  Useful note  ', author: '   ', parent_id: 0 });
    expect(comment).toMatchObject({
      task_id: task.id,
      body: 'Useful note',
      author: 'Human',
      parent_id: null,
    });
    expect(comments.listComments(0)).toEqual([]);
    expect(comments.listComments(task.id, { limit: 0 })).toEqual([comment]);
  });
});
