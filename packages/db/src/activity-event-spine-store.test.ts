import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let activeDbPath: string | null = null;
const cleanupDbPaths: string[] = [];

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

async function loadStoreModule(): Promise<typeof import('./activity-event-spine-store')> {
  activeDbPath = tempDbPath('entity-spine-store-test');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  return import('./activity-event-spine-store');
}

afterEach(async () => {
  const dbPathToClose = activeDbPath;
  if (dbPathToClose) {
    const closePath = tempDbPath('entity-spine-store-close');
    cleanupDbPaths.push(closePath);
    vi.stubEnv('ENTITY_TASK_DB_PATH', closePath);
    try {
      const { getEntityDatabase } = await import('./entity-db');
      getEntityDatabase().close();
    } catch {
      // best-effort
    }
  }
  activeDbPath = null;
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dbPath of cleanupDbPaths.splice(0)) {
    removeSqliteFiles(dbPath);
  }
});

describe('THE-870 / WP1-C-02 ActivityEvent spine store', () => {
  it('appends spine events with auto sequence and lists them in order', async () => {
    const { createActivityEventSpineRepository } = await loadStoreModule();
    const repo = createActivityEventSpineRepository();

    const first = repo.appendForTask(12, {
      eventType: 'plan',
      actorType: 'agent',
      actorPrincipalId: 'runner-1',
      payload: { step: 'outline' },
      payloadRef: 'artifact:plan-1',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.reason);
    expect(first.event).toMatchObject({
      taskId: 12,
      eventType: 'plan',
      sequence: 0,
      payloadRef: 'artifact:plan-1',
      actor: { type: 'agent', principalId: 'runner-1' },
    });

    const second = repo.appendForTask(12, {
      eventType: 'progress',
      actor: { type: 'system' },
      timestamp: '2026-07-31T01:00:00.000Z',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.reason);
    expect(second.event.sequence).toBe(1);

    const listed = repo.listForTask(12);
    expect(listed.empty).toBe(false);
    expect(listed.degraded).toBe(false);
    expect(listed.events.map((event) => event.eventType)).toEqual(['plan', 'progress']);
    expect(listed.events.map((event) => event.sequence)).toEqual([0, 1]);
  });

  it('returns explicit empty state when a task has no spine events', async () => {
    const { createActivityEventSpineRepository } = await loadStoreModule();
    const repo = createActivityEventSpineRepository();

    const listed = repo.listForTask(99);
    expect(listed).toEqual({
      taskId: 99,
      events: [],
      empty: true,
      degraded: false,
      warnings: [],
    });
  });

  it('fails closed on unknown event type and invalid task id', async () => {
    const { createActivityEventSpineRepository } = await loadStoreModule();
    const repo = createActivityEventSpineRepository();

    expect(repo.appendForTask(1, { eventType: 'status_changed' })).toEqual({
      ok: false,
      reason: 'unknown_or_missing_event_type',
      degraded: true,
    });
    expect(repo.appendForTask(0, { eventType: 'status' })).toEqual({
      ok: false,
      reason: 'missing_or_invalid_task_id',
      degraded: true,
    });
    expect(repo.appendForTask(1, { eventType: 'blocker', sequence: -1 })).toEqual({
      ok: false,
      reason: 'missing_or_invalid_sequence',
      degraded: true,
    });

    const listed = repo.listForTask(-3);
    expect(listed.empty).toBe(true);
    expect(listed.degraded).toBe(true);
    expect(listed.warnings[0]?.code).toBe('missing_or_invalid_task_id');
  });

  it('rejects duplicate explicit sequences without mutating prior rows', async () => {
    const { createActivityEventSpineRepository } = await loadStoreModule();
    const repo = createActivityEventSpineRepository();

    const first = repo.appendForTask(7, { eventType: 'log', sequence: 5 });
    expect(first.ok).toBe(true);

    const duplicate = repo.appendForTask(7, { eventType: 'proof', sequence: 5 });
    expect(duplicate).toEqual({
      ok: false,
      reason: 'duplicate_sequence_for_task',
      degraded: true,
    });

    const listed = repo.listForTask(7);
    expect(listed.events).toHaveLength(1);
    expect(listed.events[0]?.eventType).toBe('log');
  });

  it('deletes task-scoped spine events so recycled task ids stay clean', async () => {
    const { createActivityEventSpineRepository } = await loadStoreModule();
    const repo = createActivityEventSpineRepository();

    expect(repo.appendForTask(3, { eventType: 'status' }).ok).toBe(true);
    expect(repo.deleteForTask(3)).toBe(1);
    expect(repo.listForTask(3).empty).toBe(true);
  });
});
