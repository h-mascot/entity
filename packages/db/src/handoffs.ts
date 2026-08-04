/**
 * THE-933 — Task handoffs persistence.
 *
 * Mode-aware (local vs cloud), org/team-scoped, atomic downstream-task +
 * handoff-edge commit with accountability fields. Cloud ids never read or write
 * unrelated local handoffs and vice versa.
 */
import { randomUUID } from 'crypto';
import { getEntityDatabase } from './entity-db';
import type Database from 'better-sqlite3';

export type HandoffMode = 'local' | 'cloud';

export interface HandoffRecord {
  id: string;
  task_id: number;
  mode: HandoffMode;
  cloud_id: string | null;
  source_principal_id: string;
  target_principal_id: string;
  org_id: string;
  team_id: string | null;
  note: string;
  created_by_principal_id: string | null;
  created_at: string;
}

export interface CreateHandoffInput {
  taskId: number;
  mode: HandoffMode;
  /** Ignored for local mode; required for cloud mode. */
  cloudId?: string | null;
  sourcePrincipalId: string;
  targetPrincipalId: string;
  orgId: string;
  teamId?: string | null;
  note?: string;
  createdByPrincipalId?: string | null;
}

export interface HandoffQueryScope {
  mode: HandoffMode;
  orgId: string;
  cloudId?: string | null;
}

export interface HandoffRepository {
  create(input: CreateHandoffInput): HandoffRecord;
  listForTask(taskId: number, scope: HandoffQueryScope): HandoffRecord[];
  get(id: string): HandoffRecord | undefined;
  rollback(id: string, scope: HandoffQueryScope): HandoffRecord;
}

function ensureHandoffSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_handoffs (
      id TEXT PRIMARY KEY,
      task_id INTEGER NOT NULL,
      mode TEXT NOT NULL,
      cloud_id TEXT,
      source_principal_id TEXT NOT NULL,
      target_principal_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      team_id TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_by_principal_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_task_handoffs_task_mode ON task_handoffs(task_id, mode);
    CREATE INDEX IF NOT EXISTS idx_task_handoffs_org ON task_handoffs(org_id);
  `);
}

function normalizePrincipal(value: string): string {
  return String(value ?? '').trim();
}

function mapRow(row: Record<string, unknown>): HandoffRecord {
  return {
    id: String(row.id ?? ''),
    task_id: Number(row.task_id),
    mode: row.mode === 'cloud' ? 'cloud' : 'local',
    cloud_id: typeof row.cloud_id === 'string' && row.cloud_id ? row.cloud_id : null,
    source_principal_id: String(row.source_principal_id ?? ''),
    target_principal_id: String(row.target_principal_id ?? ''),
    org_id: String(row.org_id ?? ''),
    team_id: typeof row.team_id === 'string' && row.team_id ? row.team_id : null,
    note: String(row.note ?? ''),
    created_by_principal_id: typeof row.created_by_principal_id === 'string' ? row.created_by_principal_id : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
  };
}

function assertModeAware(input: CreateHandoffInput): { cloudId: string | null } {
  if (input.mode === 'local') {
    // THE-933: local handoffs never carry a cloud id, even if the caller supplies one.
    return { cloudId: null };
  }
  // cloud mode: a cloud id is required to keep cloud contexts isolated.
  const cloudId = normalizePrincipal(input.cloudId ?? '');
  if (!cloudId) {
    throw new Error('cloud handoffs require a cloudId');
  }
  return { cloudId };
}

export function createHandoffRepository(): HandoffRepository {
  const db = getEntityDatabase(ensureHandoffSchema);

  const insertStmt = db.prepare(`
    INSERT INTO task_handoffs (id, task_id, mode, cloud_id, source_principal_id, target_principal_id, org_id, team_id, note, created_by_principal_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const getByIdStmt = db.prepare('SELECT * FROM task_handoffs WHERE id = ?');
  const listByTaskStmt = db.prepare(`
    SELECT * FROM task_handoffs
    WHERE task_id = ? AND mode = 'local' AND org_id = ?
    ORDER BY datetime(created_at) ASC, id ASC
  `);
  const listByTaskCloudStmt = db.prepare(`
    SELECT * FROM task_handoffs
    WHERE task_id = ? AND mode = 'cloud' AND org_id = ? AND cloud_id = ?
    ORDER BY datetime(created_at) ASC, id ASC
  `);
  const listByTaskCloudAllStmt = db.prepare(`
    SELECT * FROM task_handoffs
    WHERE task_id = ? AND mode = 'cloud' AND org_id = ?
    ORDER BY datetime(created_at) ASC, id ASC
  `);
  const getTaskOrgStmt = db.prepare('SELECT org_id FROM tasks WHERE id = ?');
  const reassignTaskStmt = db.prepare(
    'UPDATE tasks SET owner_principal_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  );

  return {
    create(input) {
      const source = normalizePrincipal(input.sourcePrincipalId);
      const target = normalizePrincipal(input.targetPrincipalId);
      const orgId = normalizePrincipal(input.orgId);
      if (!orgId) throw new Error('handoff orgId is required');

      if (!target) throw new Error('target principal is required');
      if (target === source) throw new Error('target principal must differ from source (no self-handoff)');

      const { cloudId } = assertModeAware(input);

      // Enforce org/team scope against the downstream task.
      const taskRow = getTaskOrgStmt.get(input.taskId) as { org_id?: string } | undefined;
      if (!taskRow) throw new Error('target task does not exist');
      if (String(taskRow.org_id ?? '') !== orgId) {
        throw new Error('handoff is outside the task org scope');
      }

      const id = randomUUID();
      const note = String(input.note ?? '').trim();

      // THE-933: downstream task reassignment + handoff edge commit atomically.
      const tx = db.transaction(() => {
        reassignTaskStmt.run(target, input.taskId);
        insertStmt.run(
          id,
          input.taskId,
          input.mode,
          cloudId,
          source,
          target,
          orgId,
          input.teamId ? normalizePrincipal(input.teamId) : null,
          note,
          input.createdByPrincipalId ? normalizePrincipal(input.createdByPrincipalId) : null,
        );
      });
      tx();

      const row = getByIdStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('failed to create handoff');
      return mapRow(row);
    },

    listForTask(taskId, scope) {
      // Mode-aware: cloud queries never return local handoffs and vice versa.
      // When a cloudId is supplied, scope to it so one cloud context never reads
      // another's handoffs; without a cloudId, return all cloud handoffs for the
      // task+org.
      if (scope.mode === 'cloud') {
        const cloudId = normalizePrincipal(scope.cloudId ?? '');
        const rows = cloudId
          ? (listByTaskCloudStmt.all(taskId, scope.orgId, cloudId) as Array<Record<string, unknown>>)
          : (listByTaskCloudAllStmt.all(taskId, scope.orgId) as Array<Record<string, unknown>>);
        return rows.map(mapRow);
      }
      return (listByTaskStmt.all(taskId, scope.orgId) as Array<Record<string, unknown>>).map(mapRow);
    },

    get(id) {
      const row = getByIdStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapRow(row) : undefined;
    },

    rollback(id, scope) {
      const original = getByIdStmt.get(id) as Record<string, unknown> | undefined;
      if (!original) throw new Error('handoff not found');
      const record = mapRow(original);
      if (record.org_id !== scope.orgId) {
        throw new Error('rollback is outside the org scope');
      }
      // Reverse the edge without destroying history; reassign the task back to the
      // original source so both panels converge.
      const rollbackId = randomUUID();
      const tx = db.transaction(() => {
        reassignTaskStmt.run(record.source_principal_id, record.task_id);
        insertStmt.run(
          rollbackId,
          record.task_id,
          scope.mode,
          scope.mode === 'cloud' ? record.cloud_id : null,
          record.target_principal_id,
          record.source_principal_id,
          record.org_id,
          record.team_id,
          `Rollback of handoff ${record.id}`,
          record.created_by_principal_id,
        );
      });
      tx();
      const row = getByIdStmt.get(rollbackId) as Record<string, unknown> | undefined;
      if (!row) throw new Error('failed to create rollback handoff');
      return mapRow(row);
    },
  };
}
