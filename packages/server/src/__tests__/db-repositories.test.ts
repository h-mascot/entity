import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Each test suite uses a unique temp DB file via ENTITY_TASK_DB_PATH
let tmpDbPath: string;
const originalEnv = process.env.ENTITY_TASK_DB_PATH;
const originalMcPath = process.env.MISSION_CONTROL_DB_PATH;

function freshDb() {
  tmpDbPath = path.join(os.tmpdir(), `entity-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
  // Point MC seed to non-existent path so it skips
  process.env.MISSION_CONTROL_DB_PATH = '/tmp/nonexistent-mc.db';
}

function cleanupDb() {
  if (originalEnv !== undefined) {
    process.env.ENTITY_TASK_DB_PATH = originalEnv;
  } else {
    delete process.env.ENTITY_TASK_DB_PATH;
  }
  if (originalMcPath !== undefined) {
    process.env.MISSION_CONTROL_DB_PATH = originalMcPath;
  } else {
    delete process.env.MISSION_CONTROL_DB_PATH;
  }
  try { if (tmpDbPath) fs.unlinkSync(tmpDbPath); } catch {}
  try { if (tmpDbPath) fs.unlinkSync(tmpDbPath + '-wal'); } catch {}
  try { if (tmpDbPath) fs.unlinkSync(tmpDbPath + '-shm'); } catch {}
}

// We need fresh imports each time because the DB module caches the singleton.
// Use dynamic imports inside each describe block.

describe('TaskRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('should create and retrieve a task', async () => {
    // Force fresh module by clearing cache
    const dbMod = await import('../../../../packages/db/src/index');
    // Note: due to singleton caching, the env change should work for first use
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({ name: 'Test Task', description: 'A test', priority: 'P1' });
    expect(task.name).toBe('Test Task');
    expect(task.description).toBe('A test');
    expect(task.priority).toBe('P1');
    expect(task.column).toBe('backlog');
    expect(task.assignee).toBe('Unassigned');
    expect(task.blocked).toBe(false);
    expect(task.archived).toBe(false);
    expect(task.id).toBeGreaterThan(0);

    const fetched = repo.getTask(task.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('Test Task');
  });

  it('should list tasks', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    repo.createTask({ name: 'Task A' });
    repo.createTask({ name: 'Task B' });

    const tasks = repo.listTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    const names = tasks.map(t => t.name);
    expect(names).toContain('Task A');
    expect(names).toContain('Task B');
  });

  it('should update a task', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({ name: 'Original' });
    const updated = repo.updateTask(task.id, { name: 'Updated', blocked: true, blocker_reason: 'waiting' });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Updated');
    expect(updated!.blocked).toBe(true);
    expect(updated!.blocker_reason).toBe('waiting');
  });

  it('should return undefined when updating non-existent task', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    const result = repo.updateTask(99999, { name: 'Nope' });
    expect(result).toBeUndefined();
  });

  it('should move a task to a different column', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({ name: 'Movable' });
    expect(task.column).toBe('backlog');

    const moved = repo.moveTask(task.id, 'doing');
    expect(moved).toBeDefined();
    expect(moved!.column).toBe('doing');
  });

  it('should normalize invalid column to backlog', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({ name: 'Bad Column', column: 'INVALID' });
    expect(task.column).toBe('backlog');
  });

  it('should delete a task', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({ name: 'Deletable' });
    const deleted = repo.deleteTask(task.id);
    expect(deleted).toBe(true);
    expect(repo.getTask(task.id)).toBeUndefined();
  });

  it('should return false when deleting non-existent task', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    expect(repo.deleteTask(99999)).toBe(false);
  });

  it('should handle task with all fields', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'Full Task',
      description: 'Full desc',
      brief: 'A brief',
      origin_channel: 'discord',
      column: 'todo',
      model: 'gpt-4',
      archived: false,
      assignee: 'Ada',
      blocked: true,
      blocker_reason: 'Needs review',
      due_date: '2026-03-01',
      priority: 'P0',
      estimate_hours: 5,
      time_spent: 2,
      output: 'Some output',
      progress_status: 'in-progress',
      recurring: true,
      recurring_config: '{"cron":"0 9 * * *"}',
      metadata: '{"key":"value"}',
    });

    expect(task.column).toBe('todo');
    expect(task.model).toBe('gpt-4');
    expect(task.assignee).toBe('Ada');
    expect(task.blocked).toBe(true);
    expect(task.blocker_reason).toBe('Needs review');
    expect(task.due_date).toBe('2026-03-01');
    expect(task.priority).toBe('P0');
    expect(task.estimate_hours).toBe(5);
    expect(task.time_spent).toBe(2);
    expect(task.recurring).toBe(true);
  });
});

describe('ActivityRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('should create and list activities', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createActivityRepository();

    const activity = repo.createActivity({
      type: 'task_created',
      action: 'Created task',
      description: 'New task was created',
      agent_name: 'Ada',
      agent_emoji: '🔮',
    });

    expect(activity.type).toBe('task_created');
    expect(activity.agent_name).toBe('Ada');
    expect(activity.source).toBe('agent');

    const list = repo.listActivities(10);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].action).toBe('Created task');
  });

  it('should list activities by task id', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createActivityRepository();

    repo.createActivity({ type: 'task_created', action: 'Created', description: 'Task 1', task_id: 42 });
    repo.createActivity({ type: 'task_updated', action: 'Updated', description: 'Task 2', task_id: 99 });

    const list = repo.listActivitiesByTaskId(42);
    expect(list.length).toBe(1);
    expect(list[0].task_id).toBe(42);
  });

  it('should return empty for invalid task id', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createActivityRepository();
    expect(repo.listActivitiesByTaskId(-1)).toEqual([]);
    expect(repo.listActivitiesByTaskId(0)).toEqual([]);
  });

  it('should throw on empty action or description', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createActivityRepository();
    expect(() => repo.createActivity({ type: 'task_created', action: '', description: 'desc' }))
      .toThrow('action and description are required');
    expect(() => repo.createActivity({ type: 'task_created', action: 'act', description: '' }))
      .toThrow('action and description are required');
  });

  it('should clamp limit to 500', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createActivityRepository();
    // Should not throw even with large limit
    const list = repo.listActivities(9999);
    expect(Array.isArray(list)).toBe(true);
  });
});

describe('TaskCommentRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('should create and list comments', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const commentRepo = dbMod.createTaskCommentRepository();
    const taskRepo = dbMod.createTaskRepository();

    const task = taskRepo.createTask({ name: 'Commented Task' });

    const comment = commentRepo.createComment({
      task_id: task.id,
      body: 'This is a comment',
      author: 'Spock',
    });

    expect(comment.body).toBe('This is a comment');
    expect(comment.author).toBe('Spock');
    expect(comment.task_id).toBe(task.id);
    expect(comment.parent_id).toBeNull();

    const comments = commentRepo.listComments(task.id);
    expect(comments.length).toBe(1);
  });

  it('should default author to Human', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const commentRepo = dbMod.createTaskCommentRepository();
    const taskRepo = dbMod.createTaskRepository();
    const task = taskRepo.createTask({ name: 'Task' });

    const comment = commentRepo.createComment({ task_id: task.id, body: 'No author' });
    expect(comment.author).toBe('Human');
  });

  it('should support threaded comments (parent_id)', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const commentRepo = dbMod.createTaskCommentRepository();
    const taskRepo = dbMod.createTaskRepository();
    const task = taskRepo.createTask({ name: 'Thread Task' });

    const parent = commentRepo.createComment({ task_id: task.id, body: 'Parent' });
    const reply = commentRepo.createComment({ task_id: task.id, body: 'Reply', parent_id: parent.id });

    expect(reply.parent_id).toBe(parent.id);
  });

  it('should throw on empty body', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const commentRepo = dbMod.createTaskCommentRepository();
    expect(() => commentRepo.createComment({ task_id: 1, body: '' })).toThrow('comment body is required');
  });

  it('should throw on invalid task_id', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const commentRepo = dbMod.createTaskCommentRepository();
    expect(() => commentRepo.createComment({ task_id: 0, body: 'test' })).toThrow('positive integer');
    expect(() => commentRepo.createComment({ task_id: -1, body: 'test' })).toThrow('positive integer');
  });
});

describe('AgentLogRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('should create and list logs', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createAgentLogRepository();

    const log = repo.createLog({
      event: 'stale_scan',
      action: 'Scanned tasks',
      task_id: 5,
      model: 'gemini-flash',
      tokens_used: 150,
    });

    expect(log.event).toBe('stale_scan');
    expect(log.action).toBe('Scanned tasks');
    expect(log.model).toBe('gemini-flash');
    expect(log.tokens_used).toBe(150);

    const logs = repo.listLogs(10);
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('should get status', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createAgentLogRepository();

    const status1 = repo.getStatus();
    expect(status1.totalActions).toBe(0);
    expect(status1.lastRun).toBeNull();

    repo.createLog({ event: 'scan', action: 'test' });
    const status2 = repo.getStatus();
    expect(status2.totalActions).toBe(1);
    expect(status2.lastRun).not.toBeNull();
  });

  it('should default model to gemini-flash', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createAgentLogRepository();
    const log = repo.createLog({ event: 'test', action: 'test' });
    expect(log.model).toBe('gemini-flash');
  });

  it('should throw on empty event or action', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createAgentLogRepository();
    expect(() => repo.createLog({ event: '', action: 'test' })).toThrow('event is required');
    expect(() => repo.createLog({ event: 'test', action: '' })).toThrow('action is required');
  });
});

// Strategic repo uses a module-level singleton, so all strategic tests must share one DB.
// We set up the DB once at the top of this describe and test everything together.
describe('Strategic Repository (Roadmaps, Projects, History)', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('should handle full roadmap lifecycle', async () => {
    const dbMod = await import('../../../../packages/db/src/index');

    // Create roadmap
    const roadmap = dbMod.createRoadmap({ name: 'Q1 2026', theme: 'Growth', color: '#ff0000' });
    expect(roadmap.name).toBe('Q1 2026');
    expect(roadmap.theme).toBe('Growth');

    // Roadmap items
    const item = dbMod.createRoadmapItem(roadmap.id, {
      title: 'Launch v2',
      description: 'Major release',
      priority: 'P0',
      target_period: 'Q1',
      status: 'in-progress',
    });
    expect(item.title).toBe('Launch v2');
    expect(item.priority).toBe('P0');
    expect(item.roadmap_id).toBe(roadmap.id);

    // List roadmaps with items
    let roadmaps = dbMod.getRoadmaps();
    expect(roadmaps.length).toBeGreaterThanOrEqual(1);
    expect(roadmaps[0].items.length).toBe(1);

    // Update item
    const updated = dbMod.updateRoadmapItem(item.id, { title: 'Changed', status: 'done' });
    expect(updated!.title).toBe('Changed');
    expect(updated!.status).toBe('done');

    // Delete item
    const item2 = dbMod.createRoadmapItem(roadmap.id, { title: 'Delete me' });
    expect(dbMod.deleteRoadmapItem(item2.id)).toBe(true);
    expect(dbMod.deleteRoadmapItem(item2.id)).toBe(false);

    // Delete roadmap cascade
    expect(dbMod.deleteRoadmap(roadmap.id)).toBe(true);
    roadmaps = dbMod.getRoadmaps();
    expect(roadmaps.find(r => r.id === roadmap.id)).toBeUndefined();

    // Validation
    expect(() => dbMod.createRoadmap({ name: '' })).toThrow('name is required');

    // --- Projects ---
    const defaultProjectNames = dbMod.getProjects().map((candidate) => candidate.name);
    expect(defaultProjectNames).toEqual(
      expect.arrayContaining(['Soteria', 'Curacel', 'Personal', 'Moltbot'])
    );

    const project = dbMod.createProject({ name: 'Entity', color: '#3b82f6' });
    expect(project.name).toBe('Entity');

    const projects = dbMod.getProjects();
    expect(projects.length).toBeGreaterThanOrEqual(1);

    // Task-project linking
    const taskRepo = dbMod.createTaskRepository();
    const task = taskRepo.createTask({ name: 'Linked Task' });

    expect(dbMod.addTaskProject(task.id, project.id)).toBe(true);
    expect(dbMod.addTaskProject(task.id, project.id)).toBe(false); // duplicate

    const taskProjects = dbMod.getTaskProjects(task.id);
    expect(taskProjects.length).toBe(1);
    expect(taskProjects[0].name).toBe('Entity');

    const fetchedTask = taskRepo.getTask(task.id);
    expect(fetchedTask?.projects?.map((entry) => entry.name)).toEqual(['Entity']);

    expect(dbMod.removeTaskProject(task.id, project.id)).toBe(true);
    expect(dbMod.getTaskProjects(task.id).length).toBe(0);

    const taskWithoutProjects = taskRepo.getTask(task.id);
    expect(taskWithoutProjects?.projects).toEqual([]);

    expect(dbMod.deleteProject(project.id)).toBe(true);
    expect(dbMod.deleteProject(project.id)).toBe(false);

    expect(() => dbMod.createProject({ name: '' })).toThrow('name is required');

    // --- Task History ---
    const entry = dbMod.addTaskHistory(task.id, 'column', 'backlog', 'doing', 'Ada');
    expect(entry.field).toBe('column');
    expect(entry.old_value).toBe('backlog');
    expect(entry.new_value).toBe('doing');
    expect(entry.changed_by).toBe('Ada');

    const history = dbMod.getTaskHistory(task.id);
    expect(history.length).toBe(1);

    expect(() => dbMod.addTaskHistory(1, '')).toThrow('field is required');
  });
});
