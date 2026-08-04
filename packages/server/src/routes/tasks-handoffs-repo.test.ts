/**
 * THE-933 — task handoffs repository: mode-aware persistence, org/team scope,
 * atomic downstream task + edge commit with accountability, target validation.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTaskRepository } from '../../../db/src';
import { createHandoffRepository, type CreateHandoffInput } from '../../../db/src/handoffs';

const tmpDbPath = path.join(os.tmpdir(), `entity-handoffs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

beforeAll(() => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
});

afterAll(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
  try {
    fs.rmSync(tmpDbPath, { force: true });
  } catch {}
});

function setup() {
  const tasks = createTaskRepository();
  const handoffs = createHandoffRepository();
  const task = tasks.createTask({ name: 'handoff-task', org_id: 'default-org', team_id: 'default-team' });
  return { tasks, handoffs, task };
}

describe('task handoffs repository (THE-933)', () => {
  it('creates a local handoff and ignores any caller-supplied cloud id (mode-aware)', () => {
    const { handoffs, task } = setup();
    const input: CreateHandoffInput = {
      taskId: task.id,
      mode: 'local',
      cloudId: 'should-be-ignored',
      sourcePrincipalId: 'ada',
      targetPrincipalId: 'zora',
      orgId: 'default-org',
      teamId: 'default-team',
      note: 'passing ownership',
      createdByPrincipalId: 'ada',
    };
    const record = handoffs.create(input);
    expect(record.mode).toBe('local');
    expect(record.cloud_id).toBeNull();
    expect(record.target_principal_id).toBe('zora');
  });

  it('never reads cloud handoffs from a local query (and vice versa)', () => {
    const { handoffs, task } = setup();
    handoffs.create({ taskId: task.id, mode: 'local', sourcePrincipalId: 'ada', targetPrincipalId: 'zora', orgId: 'default-org', note: 'local' });
    handoffs.create({ taskId: task.id, mode: 'cloud', cloudId: 'C-1', sourcePrincipalId: 'ada', targetPrincipalId: 'spock', orgId: 'default-org', note: 'cloud' });

    const localOnly = handoffs.listForTask(task.id, { mode: 'local', orgId: 'default-org' });
    const cloudOnly = handoffs.listForTask(task.id, { mode: 'cloud', orgId: 'default-org' });

    expect(localOnly.every((h) => h.mode === 'local')).toBe(true);
    expect(cloudOnly.every((h) => h.mode === 'cloud')).toBe(true);
    expect(localOnly).toHaveLength(1);
    expect(cloudOnly).toHaveLength(1);
  });

  it('isolates cloud handoffs by cloud id (cloud id never reads unrelated local handoffs)', () => {
    const { handoffs, task } = setup();
    handoffs.create({ taskId: task.id, mode: 'cloud', cloudId: 'C-1', sourcePrincipalId: 'ada', targetPrincipalId: 'zora', orgId: 'default-org', note: 'c1' });
    handoffs.create({ taskId: task.id, mode: 'cloud', cloudId: 'C-2', sourcePrincipalId: 'ada', targetPrincipalId: 'spock', orgId: 'default-org', note: 'c2' });

    const c1 = handoffs.listForTask(task.id, { mode: 'cloud', orgId: 'default-org', cloudId: 'C-1' });
    const c2 = handoffs.listForTask(task.id, { mode: 'cloud', orgId: 'default-org', cloudId: 'C-2' });
    expect(c1).toHaveLength(1);
    expect(c1[0]!.cloud_id).toBe('C-1');
    expect(c2).toHaveLength(1);
    expect(c2[0]!.cloud_id).toBe('C-2');
  });

  it('rejects cross-org handoffs (org/team scope enforced)', () => {
    const { handoffs, task } = setup();
    expect(() =>
      handoffs.create({ taskId: task.id, mode: 'local', sourcePrincipalId: 'ada', targetPrincipalId: 'zora', orgId: 'other-org', note: 'x' }),
    ).toThrow(/org|scope/i);
  });

  it('validates the target principal (no self-handoff, no missing target)', () => {
    const { handoffs, task } = setup();
    expect(() =>
      handoffs.create({ taskId: task.id, mode: 'local', sourcePrincipalId: 'ada', targetPrincipalId: 'ada', orgId: 'default-org', note: 'self' }),
    ).toThrow(/target|self/i);
    expect(() =>
      handoffs.create({ taskId: task.id, mode: 'local', sourcePrincipalId: 'ada', targetPrincipalId: '   ', orgId: 'default-org', note: 'missing' }),
    ).toThrow(/target/i);
  });

  it('commits the downstream task reassignment + handoff edge atomically with accountability', () => {
    const { tasks, handoffs, task } = setup();
    const before = tasks.getTask(task.id);
    expect(before?.owner_principal_id).not.toBe('zora');

    const record = handoffs.create({
      taskId: task.id,
      mode: 'local',
      sourcePrincipalId: 'ada',
      targetPrincipalId: 'zora',
      orgId: 'default-org',
      note: 'atomic handoff',
      createdByPrincipalId: 'ada',
    });

    // The downstream task owner is updated in the SAME transaction as the edge.
    const after = tasks.getTask(task.id);
    expect(after?.owner_principal_id).toBe('zora');
    expect(record.created_by_principal_id).toBe('ada');
    expect(record.source_principal_id).toBe('ada');
  });

  it('rolls back a handoff by creating a reverse edge (no destructive update)', () => {
    const { handoffs, task } = setup();
    const original = handoffs.create({
      taskId: task.id,
      mode: 'local',
      sourcePrincipalId: 'ada',
      targetPrincipalId: 'zora',
      orgId: 'default-org',
      note: 'forward',
      createdByPrincipalId: 'ada',
    });
    const rollback = handoffs.rollback(original.id, { mode: 'local', orgId: 'default-org' });
    expect(rollback.source_principal_id).toBe('zora');
    expect(rollback.target_principal_id).toBe('ada');
    expect(rollback.note).toMatch(/rollback/i);

    const all = handoffs.listForTask(task.id, { mode: 'local', orgId: 'default-org' });
    expect(all.length).toBe(2);
  });
});
