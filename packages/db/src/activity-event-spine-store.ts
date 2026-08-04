/**
 * THE-870 / WP1-C-02 — Additive task-scoped ActivityEvent spine storage.
 *
 * Builds on THE-869 spine types. Append + query only — Workplane activity/
 * progress panel UI is THE-871; adapters/review gates are THE-872+.
 *
 * Fail-closed: unknown event types and invalid task/sequence inputs are
 * rejected with explicit degraded reasons (never silently coerced healthy).
 */

import type Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';
import {
  compareActivityEventSpineOrder,
  normalizeActivityEventSpine,
  normalizeActivityEventSpineType,
  type ActivityEventSpine,
  type ActivityEventSpineActor,
} from './activity-event-spine';

export interface StoredActivityEventSpine extends ActivityEventSpine {
  id: number;
  createdAt: string;
}

export interface AppendActivityEventSpineInput {
  eventType: unknown;
  actor?: {
    type?: unknown;
    principalId?: unknown;
  };
  actorType?: unknown;
  actorPrincipalId?: unknown;
  timestamp?: unknown;
  payloadRef?: unknown;
  payload?: unknown;
  /** Optional; when omitted, next sequence for the task is assigned. */
  sequence?: unknown;
}

export type AppendActivityEventSpineResult =
  | { ok: true; event: StoredActivityEventSpine }
  | { ok: false; reason: string; degraded: true };

export interface ListActivityEventSpineResult {
  taskId: number;
  events: StoredActivityEventSpine[];
  /** Explicit empty state for Workplane panel (no rows for task). */
  empty: boolean;
  /** True when one or more stored rows could not be projected cleanly. */
  degraded: boolean;
  warnings: Array<{ code: string; message: string }>;
}

export interface ActivityEventSpineRepository {
  appendForTask: (
    taskId: number,
    input: AppendActivityEventSpineInput,
  ) => AppendActivityEventSpineResult;
  listForTask: (taskId: number, options?: { limit?: number }) => ListActivityEventSpineResult;
  deleteForTask: (taskId: number) => number;
}

const ACTOR_TYPES = new Set(['human', 'agent', 'system', 'workflow', 'unknown']);

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readOptionalSequence(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

function normalizeActor(
  input: AppendActivityEventSpineInput,
): ActivityEventSpineActor {
  const actorRaw = input.actor;
  if (actorRaw && typeof actorRaw === 'object' && !Array.isArray(actorRaw)) {
    const typeRaw = actorRaw.type;
    const type =
      typeof typeRaw === 'string' && ACTOR_TYPES.has(typeRaw.trim().toLowerCase())
        ? (typeRaw.trim().toLowerCase() as ActivityEventSpineActor['type'])
        : 'unknown';
    const principalId = readNonEmptyString(actorRaw.principalId) ?? undefined;
    return principalId ? { type, principalId } : { type };
  }

  const type =
    typeof input.actorType === 'string' &&
    ACTOR_TYPES.has(input.actorType.trim().toLowerCase())
      ? (input.actorType.trim().toLowerCase() as ActivityEventSpineActor['type'])
      : 'unknown';
  const principalId = readNonEmptyString(input.actorPrincipalId) ?? undefined;
  return principalId ? { type, principalId } : { type };
}

function toPayloadRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function clampLimit(limit: unknown, fallback = 200): number {
  if (typeof limit === 'number' && Number.isInteger(limit) && limit > 0) {
    return Math.min(limit, 1000);
  }
  return fallback;
}

export function ensureActivityEventSpineStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_activity_spine_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'unknown',
      actor_principal_id TEXT,
      event_timestamp TEXT NOT NULL DEFAULT '',
      payload_ref TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(task_id, sequence)
    );

    CREATE INDEX IF NOT EXISTS idx_task_activity_spine_events_task_seq
      ON task_activity_spine_events(task_id, sequence ASC, id ASC);

    CREATE INDEX IF NOT EXISTS idx_task_activity_spine_events_task_type
      ON task_activity_spine_events(task_id, event_type);
  `);
}

function mapStoredRow(row: Record<string, unknown>): StoredActivityEventSpine | null {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(row.payload_json ?? '{}')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    } else {
      return null;
    }
  } catch {
    return null;
  }

  const normalized = normalizeActivityEventSpine({
    taskId: row.task_id,
    eventType: row.event_type,
    actor: {
      type: row.actor_type,
      principalId: row.actor_principal_id ?? undefined,
    },
    timestamp: row.event_timestamp,
    payloadRef: row.payload_ref,
    payload,
    sequence: row.sequence,
  });

  if (!normalized.ok) {
    return null;
  }

  const id = typeof row.id === 'number' && Number.isInteger(row.id) ? row.id : null;
  if (id === null || id < 1) {
    return null;
  }

  return {
    id,
    ...normalized.event,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

export function createActivityEventSpineRepository(): ActivityEventSpineRepository {
  const db = getEntityDatabase(ensureActivityEventSpineStoreSchema);

  const nextSequenceStmt = db.prepare(`
    SELECT COALESCE(MAX(sequence), -1) + 1 AS next_sequence
    FROM task_activity_spine_events
    WHERE task_id = ?
  `);

  const insertStmt = db.prepare(`
    INSERT INTO task_activity_spine_events (
      task_id,
      event_type,
      actor_type,
      actor_principal_id,
      event_timestamp,
      payload_ref,
      payload_json,
      sequence,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getByIdStmt = db.prepare(`
    SELECT * FROM task_activity_spine_events WHERE id = ?
  `);

  const listStmt = db.prepare(`
    SELECT * FROM task_activity_spine_events
    WHERE task_id = ?
    ORDER BY sequence ASC, id ASC
    LIMIT ?
  `);

  const deleteStmt = db.prepare(`
    DELETE FROM task_activity_spine_events WHERE task_id = ?
  `);

  return {
    appendForTask(taskId, input) {
      if (!Number.isInteger(taskId) || taskId < 1) {
        return { ok: false, reason: 'missing_or_invalid_task_id', degraded: true };
      }

      const eventType = normalizeActivityEventSpineType(input.eventType);
      if (!eventType) {
        return { ok: false, reason: 'unknown_or_missing_event_type', degraded: true };
      }

      const sequenceOrInvalid = readOptionalSequence(input.sequence);
      if (sequenceOrInvalid === null) {
        return { ok: false, reason: 'missing_or_invalid_sequence', degraded: true };
      }

      const sequence =
        sequenceOrInvalid === undefined
          ? ((nextSequenceStmt.get(taskId) as { next_sequence: number }).next_sequence ?? 0)
          : sequenceOrInvalid;

      const actor = normalizeActor(input);
      const timestamp = readNonEmptyString(input.timestamp) ?? '';
      const payloadRef =
        readNonEmptyString(input.payloadRef) ??
        null;
      const payload = toPayloadRecord(input.payload);

      const normalized = normalizeActivityEventSpine({
        taskId,
        eventType,
        actor,
        timestamp,
        payloadRef,
        payload,
        sequence,
      });
      if (!normalized.ok) {
        return { ok: false, reason: normalized.reason, degraded: true };
      }

      const createdAt = new Date().toISOString();
      try {
        const result = insertStmt.run(
          normalized.event.taskId,
          normalized.event.eventType,
          normalized.event.actor.type,
          normalized.event.actor.principalId ?? null,
          normalized.event.timestamp,
          normalized.event.payloadRef,
          JSON.stringify(normalized.event.payload),
          normalized.event.sequence,
          createdAt,
        );

        const row = getByIdStmt.get(Number(result.lastInsertRowid)) as
          | Record<string, unknown>
          | undefined;
        const stored = row ? mapStoredRow(row) : null;
        if (!stored) {
          return { ok: false, reason: 'storage_projection_failed', degraded: true };
        }
        return { ok: true, event: stored };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/UNIQUE constraint failed/i.test(message)) {
          return { ok: false, reason: 'duplicate_sequence_for_task', degraded: true };
        }
        return { ok: false, reason: 'storage_write_failed', degraded: true };
      }
    },

    listForTask(taskId, options = {}) {
      if (!Number.isInteger(taskId) || taskId < 1) {
        return {
          taskId: Number.isInteger(taskId) ? taskId : 0,
          events: [],
          empty: true,
          degraded: true,
          warnings: [
            {
              code: 'missing_or_invalid_task_id',
              message: 'task id must be a positive integer',
            },
          ],
        };
      }

      const rows = listStmt.all(taskId, clampLimit(options.limit)) as Array<
        Record<string, unknown>
      >;
      const events: StoredActivityEventSpine[] = [];
      const warnings: Array<{ code: string; message: string }> = [];

      for (const row of rows) {
        const mapped = mapStoredRow(row);
        if (!mapped) {
          warnings.push({
            code: 'stored_row_projection_failed',
            message: `skipped stored spine event id=${String(row.id ?? 'unknown')}`,
          });
          continue;
        }
        events.push(mapped);
      }

      events.sort(compareActivityEventSpineOrder);

      return {
        taskId,
        events,
        empty: events.length === 0 && warnings.length === 0,
        degraded: warnings.length > 0,
        warnings,
      };
    },

    deleteForTask(taskId) {
      if (!Number.isInteger(taskId) || taskId < 1) {
        return 0;
      }
      return deleteStmt.run(taskId).changes;
    },
  };
}
