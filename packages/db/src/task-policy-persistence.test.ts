import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let activeDbPath: string | null = null;

function sqliteFiles(dbPath: string): string[] {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

async function loadDbModule(): Promise<typeof import('./index')> {
  activeDbPath = path.join(os.tmpdir(), `entity-task-policy-${process.pid}-${randomUUID()}.sqlite`);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', path.join(os.tmpdir(), `missing-${randomUUID()}.sqlite`));
  return import('./index');
}

afterEach(async () => {
  if (activeDbPath) {
    try {
      const { getEntityDatabase } = await import('./entity-db');
      getEntityDatabase().close();
    } catch {
      // Best-effort cleanup after a failed test import.
    }
    for (const file of sqliteFiles(activeDbPath)) {
      fs.rmSync(file, { force: true });
    }
  }
  activeDbPath = null;
  vi.resetModules();
  vi.unstubAllEnvs();
});

const protectedActions = [
  {
    label: 'claims',
    effect: {
      type: 'other',
      target_system: 'claims_decision',
      sensitivity: 'confidential',
    },
  },
  {
    label: 'finance',
    effect: {
      type: 'financial_commitment',
      target_system: 'finance_ledger',
      sensitivity: 'financial',
    },
  },
  {
    label: 'customer communication',
    effect: {
      type: 'email_send',
      target_system: 'customer_email',
      sensitivity: 'customer',
    },
  },
] as const;

function externalEffectJson(effect: (typeof protectedActions)[number]['effect']): string {
  return JSON.stringify([{
    ...effect,
    risk_level: 'high',
    required_gate: true,
    requested_actor_principal_id: 'agent-atlas',
    resolution_state: 'gate_pending',
  }]);
}

describe('task policy persistence', () => {
  it.each(protectedActions)(
    'persists resolved review and human-gate requirements when creating a $label action',
    async ({ label, effect }) => {
      const db = await loadDbModule();
      const tasks = db.createTaskRepository();

      const task = tasks.createTask({
        name: `${label} external action`,
        external_side_effects_json: externalEffectJson(effect),
        review_required: false,
        human_gate_required: false,
      });
      const resolution = db.resolveTaskPolicy(db.buildTaskPolicyInputEnvelope(task));

      expect(resolution).toMatchObject({
        review_required: true,
        human_gate_required: true,
      });
      expect(tasks.getTask(task.id)).toMatchObject({
        review_required: true,
        review_state: 'pending',
        human_gate_required: true,
        human_gate_state: 'pending',
      });
    },
  );

  it.each(protectedActions)(
    'persists resolved review and human-gate requirements when updating to a $label action',
    async ({ label, effect }) => {
      const db = await loadDbModule();
      const tasks = db.createTaskRepository();
      const task = tasks.createTask({ name: `${label} draft` });

      const updated = tasks.updateTask(task.id, {
        external_side_effects_json: externalEffectJson(effect),
        review_required: false,
        human_gate_required: false,
      });
      expect(updated).toBeDefined();
      const resolution = db.resolveTaskPolicy(db.buildTaskPolicyInputEnvelope(updated!));

      expect(resolution).toMatchObject({
        review_required: true,
        human_gate_required: true,
      });
      expect(tasks.getTask(task.id)).toMatchObject({
        review_required: true,
        review_state: 'pending',
        human_gate_required: true,
        human_gate_state: 'pending',
      });
    },
  );
});
