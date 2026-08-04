/**
 * Durable Workplane ASK + event persistence (THE-886 / WP2-B-05).
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from '../../../../db/src/entity-db';
import type {
  AskEventType,
  AskReason,
  AskStatus,
  WorkplaneAsk,
  WorkplaneAskEvent,
} from './types';
import { ASK_STATUSES } from './types';

interface AskRow {
  id: string;
  workplane_id: string;
  task_id: number | null;
  title: string;
  body: string | null;
  status: string;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  claimant_agent_id: string | null;
  claimant_agent_name: string | null;
  claimed_at: string | null;
  claim_policy_code: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  blocked_reason: string | null;
  reason_chain_json: string;
}

interface EventRow {
  id: string;
  ask_id: string;
  workplane_id: string;
  event_type: string;
  actor_id: string | null;
  from_status: string | null;
  to_status: string | null;
  from_version: number | null;
  to_version: number | null;
  code: string;
  detail: string;
  created_at: string;
}

export interface AskFlowStore {
  ensureSchema: () => void;
  getAsk: (askId: string) => WorkplaneAsk | undefined;
  listAsks: (workplaneId: string, limit?: number) => WorkplaneAsk[];
  insertAsk: (record: Omit<WorkplaneAsk, 'id'> & { id?: string }) => WorkplaneAsk;
  /**
   * Compare-and-swap update. Returns undefined when version mismatch or missing.
   */
  casUpdateAsk: (
    askId: string,
    expectedVersion: number,
    patch: Partial<Omit<WorkplaneAsk, 'id' | 'workplaneId' | 'createdAt' | 'createdBy' | 'version'>>
      & { updatedAt: string },
  ) => WorkplaneAsk | undefined;
  insertEvent: (record: Omit<WorkplaneAskEvent, 'id'> & { id?: string }) => WorkplaneAskEvent;
  listEvents: (askId: string, limit?: number) => WorkplaneAskEvent[];
  clearForTests: () => void;
}

function parseReasons(raw: string): AskReason[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is AskReason =>
      Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)
        && typeof (entry as AskReason).source === 'string'
        && typeof (entry as AskReason).decision === 'string'
        && typeof (entry as AskReason).detail === 'string'),
    );
  } catch {
    return [];
  }
}

function asStatus(value: string | null | undefined): AskStatus | null {
  if (!value) return null;
  return (ASK_STATUSES as readonly string[]).includes(value) ? value as AskStatus : null;
}

function askFromRow(row: AskRow): WorkplaneAsk {
  const status = asStatus(row.status) ?? 'open';
  return {
    id: row.id,
    workplaneId: row.workplane_id,
    taskId: row.task_id,
    title: row.title,
    body: row.body,
    status,
    version: Number(row.version) || 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimantAgentId: row.claimant_agent_id,
    claimantAgentName: row.claimant_agent_name,
    claimedAt: row.claimed_at,
    claimPolicyCode: row.claim_policy_code,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    blockedReason: row.blocked_reason,
    reasonChain: parseReasons(row.reason_chain_json),
  };
}

function eventFromRow(row: EventRow): WorkplaneAskEvent {
  return {
    id: row.id,
    askId: row.ask_id,
    workplaneId: row.workplane_id,
    eventType: row.event_type as AskEventType,
    actorId: row.actor_id,
    fromStatus: asStatus(row.from_status),
    toStatus: asStatus(row.to_status),
    fromVersion: row.from_version == null ? null : Number(row.from_version),
    toVersion: row.to_version == null ? null : Number(row.to_version),
    code: row.code,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

export function ensureAskFlowSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workplane_asks (
      id TEXT PRIMARY KEY,
      workplane_id TEXT NOT NULL,
      task_id INTEGER,
      title TEXT NOT NULL,
      body TEXT,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      claimant_agent_id TEXT,
      claimant_agent_name TEXT,
      claimed_at TEXT,
      claim_policy_code TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      resolution_note TEXT,
      blocked_reason TEXT,
      reason_chain_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_workplane_asks_wp
      ON workplane_asks(workplane_id, status);
    CREATE INDEX IF NOT EXISTS idx_workplane_asks_wp_updated
      ON workplane_asks(workplane_id, updated_at);

    CREATE TABLE IF NOT EXISTS workplane_ask_events (
      id TEXT PRIMARY KEY,
      ask_id TEXT NOT NULL,
      workplane_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_id TEXT,
      from_status TEXT,
      to_status TEXT,
      from_version INTEGER,
      to_version INTEGER,
      code TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workplane_ask_events_ask
      ON workplane_ask_events(ask_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_workplane_ask_events_wp
      ON workplane_ask_events(workplane_id, created_at);
  `);
}

export function createAskFlowStore(db?: Database.Database): AskFlowStore {
  const resolveDb = () => db ?? getEntityDatabase(ensureAskFlowSchema);

  return {
    ensureSchema() {
      ensureAskFlowSchema(resolveDb());
    },

    getAsk(askId) {
      const key = askId.trim();
      if (!key) return undefined;
      const database = resolveDb();
      ensureAskFlowSchema(database);
      const row = database
        .prepare('SELECT * FROM workplane_asks WHERE id = ?')
        .get(key) as AskRow | undefined;
      return row ? askFromRow(row) : undefined;
    },

    listAsks(workplaneId, limit = 50) {
      const key = workplaneId.trim();
      if (!key) return [];
      const database = resolveDb();
      ensureAskFlowSchema(database);
      const rows = database
        .prepare(`
          SELECT * FROM workplane_asks
          WHERE workplane_id = ?
          ORDER BY updated_at DESC
          LIMIT ?
        `)
        .all(key, Math.max(1, Math.min(limit, 200))) as AskRow[];
      return rows.map(askFromRow);
    },

    insertAsk(record) {
      const database = resolveDb();
      ensureAskFlowSchema(database);
      const id = record.id?.trim() || randomUUID();
      database
        .prepare(`
          INSERT INTO workplane_asks (
            id, workplane_id, task_id, title, body, status, version,
            created_by, created_at, updated_at,
            claimant_agent_id, claimant_agent_name, claimed_at, claim_policy_code,
            resolved_by, resolved_at, resolution_note, blocked_reason, reason_chain_json
          ) VALUES (
            @id, @workplane_id, @task_id, @title, @body, @status, @version,
            @created_by, @created_at, @updated_at,
            @claimant_agent_id, @claimant_agent_name, @claimed_at, @claim_policy_code,
            @resolved_by, @resolved_at, @resolution_note, @blocked_reason, @reason_chain_json
          )
        `)
        .run({
          id,
          workplane_id: record.workplaneId,
          task_id: record.taskId,
          title: record.title,
          body: record.body,
          status: record.status,
          version: record.version,
          created_by: record.createdBy,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
          claimant_agent_id: record.claimantAgentId,
          claimant_agent_name: record.claimantAgentName,
          claimed_at: record.claimedAt,
          claim_policy_code: record.claimPolicyCode,
          resolved_by: record.resolvedBy,
          resolved_at: record.resolvedAt,
          resolution_note: record.resolutionNote,
          blocked_reason: record.blockedReason,
          reason_chain_json: JSON.stringify(record.reasonChain),
        });
      return this.getAsk(id)!;
    },

    casUpdateAsk(askId, expectedVersion, patch) {
      const key = askId.trim();
      if (!key) return undefined;
      const database = resolveDb();
      ensureAskFlowSchema(database);
      const current = this.getAsk(key);
      if (!current || current.version !== expectedVersion) {
        return undefined;
      }

      const next: WorkplaneAsk = {
        ...current,
        title: patch.title ?? current.title,
        body: patch.body !== undefined ? patch.body : current.body,
        status: patch.status ?? current.status,
        taskId: patch.taskId !== undefined ? patch.taskId : current.taskId,
        updatedAt: patch.updatedAt,
        version: current.version + 1,
        claimantAgentId: patch.claimantAgentId !== undefined
          ? patch.claimantAgentId
          : current.claimantAgentId,
        claimantAgentName: patch.claimantAgentName !== undefined
          ? patch.claimantAgentName
          : current.claimantAgentName,
        claimedAt: patch.claimedAt !== undefined ? patch.claimedAt : current.claimedAt,
        claimPolicyCode: patch.claimPolicyCode !== undefined
          ? patch.claimPolicyCode
          : current.claimPolicyCode,
        resolvedBy: patch.resolvedBy !== undefined ? patch.resolvedBy : current.resolvedBy,
        resolvedAt: patch.resolvedAt !== undefined ? patch.resolvedAt : current.resolvedAt,
        resolutionNote: patch.resolutionNote !== undefined
          ? patch.resolutionNote
          : current.resolutionNote,
        blockedReason: patch.blockedReason !== undefined
          ? patch.blockedReason
          : current.blockedReason,
        reasonChain: patch.reasonChain ?? current.reasonChain,
      };

      const result = database
        .prepare(`
          UPDATE workplane_asks SET
            title = @title,
            body = @body,
            status = @status,
            task_id = @task_id,
            version = @version,
            updated_at = @updated_at,
            claimant_agent_id = @claimant_agent_id,
            claimant_agent_name = @claimant_agent_name,
            claimed_at = @claimed_at,
            claim_policy_code = @claim_policy_code,
            resolved_by = @resolved_by,
            resolved_at = @resolved_at,
            resolution_note = @resolution_note,
            blocked_reason = @blocked_reason,
            reason_chain_json = @reason_chain_json
          WHERE id = @id AND version = @expected_version
        `)
        .run({
          id: key,
          expected_version: expectedVersion,
          title: next.title,
          body: next.body,
          status: next.status,
          task_id: next.taskId,
          version: next.version,
          updated_at: next.updatedAt,
          claimant_agent_id: next.claimantAgentId,
          claimant_agent_name: next.claimantAgentName,
          claimed_at: next.claimedAt,
          claim_policy_code: next.claimPolicyCode,
          resolved_by: next.resolvedBy,
          resolved_at: next.resolvedAt,
          resolution_note: next.resolutionNote,
          blocked_reason: next.blockedReason,
          reason_chain_json: JSON.stringify(next.reasonChain),
        });

      if (result.changes === 0) {
        return undefined;
      }
      return this.getAsk(key);
    },

    insertEvent(record) {
      const database = resolveDb();
      ensureAskFlowSchema(database);
      const id = record.id?.trim() || randomUUID();
      database
        .prepare(`
          INSERT INTO workplane_ask_events (
            id, ask_id, workplane_id, event_type, actor_id,
            from_status, to_status, from_version, to_version,
            code, detail, created_at
          ) VALUES (
            @id, @ask_id, @workplane_id, @event_type, @actor_id,
            @from_status, @to_status, @from_version, @to_version,
            @code, @detail, @created_at
          )
        `)
        .run({
          id,
          ask_id: record.askId,
          workplane_id: record.workplaneId,
          event_type: record.eventType,
          actor_id: record.actorId,
          from_status: record.fromStatus,
          to_status: record.toStatus,
          from_version: record.fromVersion,
          to_version: record.toVersion,
          code: record.code,
          detail: record.detail,
          created_at: record.createdAt,
        });
      const row = database
        .prepare('SELECT * FROM workplane_ask_events WHERE id = ?')
        .get(id) as EventRow;
      return eventFromRow(row);
    },

    listEvents(askId, limit = 50) {
      const key = askId.trim();
      if (!key) return [];
      const database = resolveDb();
      ensureAskFlowSchema(database);
      const rows = database
        .prepare(`
          SELECT * FROM workplane_ask_events
          WHERE ask_id = ?
          ORDER BY created_at ASC
          LIMIT ?
        `)
        .all(key, Math.max(1, Math.min(limit, 200))) as EventRow[];
      return rows.map(eventFromRow);
    },

    clearForTests() {
      const database = resolveDb();
      ensureAskFlowSchema(database);
      database.exec(`
        DELETE FROM workplane_ask_events;
        DELETE FROM workplane_asks;
      `);
    },
  };
}
