/**
 * Task handoffs — tenant-scoped handoff DAG (Curacel pilot capability C-8).
 *
 * Ported from the curacel-readiness-runner slice onto current main. The data
 * model is unchanged: handoffs are org-scoped edges between two tasks in the
 * SAME organization, with a bounded lifecycle (pending -> accepted/blocked/
 * cancelled, accepted -> completed), compare-and-swap version transitions,
 * cycle prevention, transactional ownership transfer on accept, a bounded
 * chain traversal, and a durable transition event log.
 *
 * Adaptation to current main:
 *   - Authorization is main's model (bearer-token middleware + org-scoped
 *     repositories). This module enforces the data-level tenant boundary:
 *     every read/transition is keyed on org_id, and create() rejects edges
 *     whose source/target tasks belong to different organizations. It does
 *     not trust any caller-supplied org header.
 *   - Ownership transfer updates main's canonical task columns
 *     (owner_principal_id/owner_principal_type/executor_principal_id/
 *     assignee/assignment_state).
 *   - The tasks table FK targets tasks(id); main reuses deleted task ids, so
 *     the FK ON DELETE CASCADE cleans up handoffs for recycled ids.
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export const TASK_HANDOFF_STATUSES = ['pending', 'accepted', 'blocked', 'completed', 'cancelled'] as const;
export type TaskHandoffStatus = (typeof TASK_HANDOFF_STATUSES)[number];
export type TaskDependencyStatus = 'waiting' | 'ready' | 'blocked' | 'satisfied' | 'cancelled';

export interface TaskHandoffRecord {
  id: string;
  org_id: string;
  source_task_id: number;
  source_task_name: string;
  source_team_id: string;
  target_task_id: number;
  target_task_name: string;
  target_team_id: string;
  target_agent_id: string;
  status: TaskHandoffStatus;
  dependency_status: TaskDependencyStatus;
  reason: string | null;
  created_by_principal_id: string;
  accepted_by_principal_id: string | null;
  last_transition_by_principal_id: string;
  version: number;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface TaskHandoffChain {
  root_task_id: number;
  truncated: boolean;
  nodes: Array<{
    id: number;
    org_id: string;
    team_id: string;
    name: string;
    owner_principal_id: string | null;
    assignee: string | null;
    column: string;
  }>;
  edges: TaskHandoffRecord[];
}

type TaskRow = {
  id: number;
  org_id: string;
  team_id: string;
  name: string;
  owner_principal_id: string | null;
  assignee: string | null;
  column: string;
};

type HandoffRow = Record<string, unknown>;

const DEPENDENCY_STATUS: Record<TaskHandoffStatus, TaskDependencyStatus> = {
  pending: 'waiting',
  accepted: 'ready',
  blocked: 'blocked',
  completed: 'satisfied',
  cancelled: 'cancelled',
};

const TRANSITIONS: Record<TaskHandoffStatus, readonly TaskHandoffStatus[]> = {
  pending: ['accepted', 'blocked', 'cancelled'],
  accepted: ['blocked', 'completed', 'cancelled'],
  blocked: ['accepted', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function ensureTaskHandoffsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_handoffs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      source_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_agent_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked', 'completed', 'cancelled')),
      reason TEXT,
      created_by_principal_id TEXT NOT NULL,
      accepted_by_principal_id TEXT,
      last_transition_by_principal_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      accepted_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      CHECK (source_task_id <> target_task_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_handoffs_active_unique
      ON task_handoffs(org_id, source_task_id, target_task_id, target_agent_id)
      WHERE status <> 'cancelled';
    CREATE INDEX IF NOT EXISTS idx_task_handoffs_source
      ON task_handoffs(org_id, source_task_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_handoffs_target
      ON task_handoffs(org_id, target_task_id, status, created_at);
    CREATE TABLE IF NOT EXISTS task_handoff_events (
      id TEXT PRIMARY KEY,
      handoff_id TEXT NOT NULL REFERENCES task_handoffs(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_principal_id TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_handoff_events_handoff
      ON task_handoff_events(org_id, handoff_id, created_at);
  `);
}

function required(value: unknown, field: string, max = 240): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${field} is too long`);
  return normalized;
}

function optional(value: unknown, field: string, max = 500): string | null {
  if (value == null || value === '') return null;
  return required(value, field, max);
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

function normalizeStatus(value: unknown): TaskHandoffStatus {
  if (typeof value !== 'string' || !TASK_HANDOFF_STATUSES.includes(value as TaskHandoffStatus)) {
    throw new Error(`handoff status must be one of ${TASK_HANDOFF_STATUSES.join(', ')}`);
  }
  return value as TaskHandoffStatus;
}

function mapHandoff(row: HandoffRow): TaskHandoffRecord {
  const handoffStatus = normalizeStatus(row.status);
  const textOrNull = (value: unknown) => (value == null ? null : String(value));
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    source_task_id: Number(row.source_task_id),
    source_task_name: String(row.source_task_name),
    source_team_id: String(row.source_team_id),
    target_task_id: Number(row.target_task_id),
    target_task_name: String(row.target_task_name),
    target_team_id: String(row.target_team_id),
    target_agent_id: String(row.target_agent_id),
    status: handoffStatus,
    dependency_status: DEPENDENCY_STATUS[handoffStatus],
    reason: textOrNull(row.reason),
    created_by_principal_id: String(row.created_by_principal_id),
    accepted_by_principal_id: textOrNull(row.accepted_by_principal_id),
    last_transition_by_principal_id: String(row.last_transition_by_principal_id),
    version: Number(row.version),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    accepted_at: textOrNull(row.accepted_at),
    completed_at: textOrNull(row.completed_at),
    cancelled_at: textOrNull(row.cancelled_at),
  };
}

export function createTaskHandoffRepository(
  providedDb?: Database.Database,
  options: { now?: () => Date } = {},
) {
  const db = providedDb ?? getEntityDatabase(ensureTaskHandoffsSchema);
  ensureTaskHandoffsSchema(db);
  const now = options.now ?? (() => new Date());
  const taskQuery = db.prepare(`
    SELECT id, org_id, team_id, name, owner_principal_id, assignee, column
    FROM tasks WHERE id = ?
  `);
  const selectHandoff = `
    SELECT h.*,
      source.name AS source_task_name, source.team_id AS source_team_id,
      target.name AS target_task_name, target.team_id AS target_team_id
    FROM task_handoffs h
    JOIN tasks source ON source.id = h.source_task_id
    JOIN tasks target ON target.id = h.target_task_id
  `;
  const getQuery = db.prepare(`${selectHandoff} WHERE h.org_id = ? AND h.id = ?`);
  const listIncoming = db.prepare(`
    ${selectHandoff}
    WHERE h.org_id = ? AND h.target_task_id = ?
    ORDER BY h.created_at ASC, h.id ASC
  `);
  const listOutgoing = db.prepare(`
    ${selectHandoff}
    WHERE h.org_id = ? AND h.source_task_id = ?
    ORDER BY h.created_at ASC, h.id ASC
  `);

  const getTask = (taskId: number, label: string): TaskRow => {
    const task = taskQuery.get(taskId) as TaskRow | undefined;
    if (!task) throw new Error(`${label} task not found`);
    return task;
  };

  const appendEvent = (input: {
    handoffId: string;
    orgId: string;
    fromStatus: TaskHandoffStatus | null;
    toStatus: TaskHandoffStatus;
    actorPrincipalId: string;
    reason: string | null;
    createdAt: string;
  }) =>
    db
      .prepare(
        `INSERT INTO task_handoff_events (
          id, handoff_id, org_id, from_status, to_status, actor_principal_id, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.handoffId,
        input.orgId,
        input.fromStatus,
        input.toStatus,
        input.actorPrincipalId,
        input.reason,
        input.createdAt,
      );

  const repository = {
    get(orgId: string, handoffId: string): TaskHandoffRecord | undefined {
      const row = getQuery.get(
        required(orgId, 'organization id'),
        required(handoffId, 'handoff id'),
      ) as HandoffRow | undefined;
      return row ? mapHandoff(row) : undefined;
    },

    listForTask(
      orgId: string,
      taskId: number,
    ): { incoming: TaskHandoffRecord[]; outgoing: TaskHandoffRecord[] } {
      const normalizedOrgId = required(orgId, 'organization id');
      const normalizedTaskId = positiveInteger(taskId, 'task id');
      return {
        incoming: (listIncoming.all(normalizedOrgId, normalizedTaskId) as HandoffRow[]).map(mapHandoff),
        outgoing: (listOutgoing.all(normalizedOrgId, normalizedTaskId) as HandoffRow[]).map(mapHandoff),
      };
    },

    create(input: {
      sourceTaskId: number;
      targetTaskId: number;
      targetAgentId: string;
      reason?: string | null;
      actorPrincipalId: string;
    }): TaskHandoffRecord {
      return db.transaction(() => {
        const sourceTaskId = positiveInteger(input.sourceTaskId, 'source task id');
        const targetTaskId = positiveInteger(input.targetTaskId, 'target task id');
        if (sourceTaskId === targetTaskId) throw new Error('handoff tasks must be different');
        const source = getTask(sourceTaskId, 'source');
        const target = getTask(targetTaskId, 'target');
        if (source.org_id !== target.org_id) {
          throw new Error('handoff tasks must belong to the same organization');
        }
        const targetAgentId = required(input.targetAgentId, 'target agent id');
        const actorPrincipalId = required(input.actorPrincipalId, 'actor principal id');
        const reason = optional(input.reason, 'handoff reason');
        const duplicate = db
          .prepare(
            `SELECT 1 FROM task_handoffs
            WHERE org_id = ? AND source_task_id = ? AND target_task_id = ?
              AND target_agent_id = ? AND status <> 'cancelled'`,
          )
          .get(source.org_id, sourceTaskId, targetTaskId, targetAgentId);
        if (duplicate) throw new Error('active handoff already exists');
        const cycle = db
          .prepare(
            `WITH RECURSIVE reachable(task_id) AS (
              SELECT target_task_id FROM task_handoffs
              WHERE org_id = ? AND source_task_id = ? AND status <> 'cancelled'
              UNION
              SELECT h.target_task_id
              FROM task_handoffs h
              JOIN reachable r ON h.source_task_id = r.task_id
              WHERE h.org_id = ? AND h.status <> 'cancelled'
            )
            SELECT 1 FROM reachable WHERE task_id = ? LIMIT 1`,
          )
          .get(source.org_id, targetTaskId, source.org_id, sourceTaskId);
        if (cycle) throw new Error('handoff would create a cycle');
        const id = randomUUID();
        const createdAt = now().toISOString();
        db.prepare(
          `INSERT INTO task_handoffs (
            id, org_id, source_task_id, target_task_id, target_agent_id, status,
            reason, created_by_principal_id, last_transition_by_principal_id,
            version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, 1, ?, ?)`,
        ).run(
          id,
          source.org_id,
          sourceTaskId,
          targetTaskId,
          targetAgentId,
          reason,
          actorPrincipalId,
          actorPrincipalId,
          createdAt,
          createdAt,
        );
        appendEvent({
          handoffId: id,
          orgId: source.org_id,
          fromStatus: null,
          toStatus: 'pending',
          actorPrincipalId,
          reason,
          createdAt,
        });
        return repository.get(source.org_id, id)!;
      })();
    },

    transition(input: {
      orgId: string;
      handoffId: string;
      status: TaskHandoffStatus;
      actorPrincipalId: string;
      expectedVersion: number;
      reason?: string | null;
    }): TaskHandoffRecord {
      return db.transaction(() => {
        const orgId = required(input.orgId, 'organization id');
        const handoffId = required(input.handoffId, 'handoff id');
        const actorPrincipalId = required(input.actorPrincipalId, 'actor principal id');
        const expectedVersion = positiveInteger(input.expectedVersion, 'expected version');
        const nextStatus = normalizeStatus(input.status);
        const current = repository.get(orgId, handoffId);
        if (!current) throw new Error('handoff not found');
        if (current.version !== expectedVersion) {
          throw new Error('handoff changed; reload before retrying');
        }
        if (TRANSITIONS[current.status].length === 0) {
          throw new Error('terminal handoff cannot transition');
        }
        if (!TRANSITIONS[current.status].includes(nextStatus)) {
          throw new Error(`invalid handoff transition from ${current.status} to ${nextStatus}`);
        }
        const reason = optional(input.reason, 'transition reason') ?? current.reason;
        if (nextStatus === 'blocked' && !reason) throw new Error('blocked handoff requires a reason');
        const changedAt = now().toISOString();
        if (nextStatus === 'accepted') {
          db.prepare(
            `UPDATE tasks SET
              owner_principal_id = ?, owner_principal_type = 'agent',
              executor_principal_id = ?, assignee = ?, assignment_state = 'assigned',
              updated_at = ?
            WHERE id = ? AND org_id = ?`,
          ).run(
            current.target_agent_id,
            current.target_agent_id,
            current.target_agent_id,
            changedAt,
            current.target_task_id,
            orgId,
          );
        }
        const result = db
          .prepare(
            `UPDATE task_handoffs SET
            status = ?, reason = ?, last_transition_by_principal_id = ?,
            accepted_by_principal_id = CASE WHEN ? = 'accepted' THEN ? ELSE accepted_by_principal_id END,
            accepted_at = CASE WHEN ? = 'accepted' THEN COALESCE(accepted_at, ?) ELSE accepted_at END,
            completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
            cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END,
            version = version + 1, updated_at = ?
          WHERE id = ? AND org_id = ? AND version = ? AND status = ?`,
          )
          .run(
            nextStatus,
            reason,
            actorPrincipalId,
            nextStatus,
            actorPrincipalId,
            nextStatus,
            changedAt,
            nextStatus,
            changedAt,
            nextStatus,
            changedAt,
            changedAt,
            handoffId,
            orgId,
            expectedVersion,
            current.status,
          );
        if (result.changes !== 1) throw new Error('handoff changed; reload before retrying');
        appendEvent({
          handoffId,
          orgId,
          fromStatus: current.status,
          toStatus: nextStatus,
          actorPrincipalId,
          reason,
          createdAt: changedAt,
        });
        return repository.get(orgId, handoffId)!;
      })();
    },

    getChain(input: {
      orgId: string;
      taskId: number;
      maxDepth?: number;
      maxEdges?: number;
    }): TaskHandoffChain {
      const orgId = required(input.orgId, 'organization id');
      const rootTaskId = positiveInteger(input.taskId, 'task id');
      const root = getTask(rootTaskId, 'root');
      if (root.org_id !== orgId) throw new Error('root task not found');
      const maxDepth = Math.min(12, Math.max(1, input.maxDepth ?? 8));
      const maxEdges = Math.min(200, Math.max(1, input.maxEdges ?? 100));
      const seenNodes = new Set<number>([rootTaskId]);
      const seenEdges = new Map<string, TaskHandoffRecord>();
      let frontier = [rootTaskId];
      let truncated = false;
      for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
        const next: number[] = [];
        for (const taskId of frontier) {
          const adjacent = repository.listForTask(orgId, taskId);
          for (const edge of [...adjacent.incoming, ...adjacent.outgoing]) {
            if (!seenEdges.has(edge.id)) {
              if (seenEdges.size >= maxEdges) {
                truncated = true;
                break;
              }
              seenEdges.set(edge.id, edge);
            }
            for (const adjacentTaskId of [edge.source_task_id, edge.target_task_id]) {
              if (!seenNodes.has(adjacentTaskId)) {
                seenNodes.add(adjacentTaskId);
                next.push(adjacentTaskId);
              }
            }
          }
          if (truncated) break;
        }
        frontier = next;
      }
      if (frontier.length > 0) truncated = true;
      const nodes = [...seenNodes].map((taskId) => getTask(taskId, 'chain')).map((task) => ({
        id: Number(task.id),
        org_id: String(task.org_id),
        team_id: String(task.team_id),
        name: String(task.name),
        owner_principal_id: task.owner_principal_id == null ? null : String(task.owner_principal_id),
        assignee: task.assignee == null ? null : String(task.assignee),
        column: String(task.column),
      }));
      return { root_task_id: rootTaskId, truncated, nodes, edges: [...seenEdges.values()] };
    },
  };

  return repository;
}

export type TaskHandoffRepository = ReturnType<typeof createTaskHandoffRepository>;
