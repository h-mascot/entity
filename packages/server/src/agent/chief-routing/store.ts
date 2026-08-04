/**
 * Durable chief assignment + routing claim/window persistence (THE-885 / WP2-B-04).
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from '../../../../db/src/entity-db';
import type {
  WorkplaneChiefAssignment,
  WorkplaneRoutingClaim,
  WorkplaneRoutingWindow,
  RoutingClaimMode,
  RoutingClaimStatus,
  RoutingReason,
} from './types';
import { DEFAULT_CHIEF_PRIORITY_WINDOW_MS } from './types';

interface ChiefRow {
  workplane_id: string;
  chief_agent_id: string;
  chief_invite_id: string | null;
  chief_agent_name: string;
  assigned_at: string;
  assigned_by: string | null;
  priority_window_ms: number;
  updated_at: string;
}

interface WindowRow {
  id: string;
  workplane_id: string;
  task_id: number | null;
  opened_at: string;
  priority_window_ms: number;
  expires_at: string;
}

interface ClaimRow {
  id: string;
  workplane_id: string;
  task_id: number | null;
  agent_id: string;
  agent_name: string;
  claim_mode: string;
  status: string;
  request_id: string | null;
  policy_code: string;
  policy_reason: string;
  reason_chain_json: string;
  claimed_at: string;
  claimed_by: string | null;
  released_at: string | null;
}

export interface ChiefRoutingStore {
  ensureSchema: () => void;
  getChief: (workplaneId: string) => WorkplaneChiefAssignment | undefined;
  upsertChief: (record: WorkplaneChiefAssignment) => WorkplaneChiefAssignment;
  clearChief: (workplaneId: string) => boolean;
  getWindow: (workplaneId: string, taskId: number | null) => WorkplaneRoutingWindow | undefined;
  upsertWindow: (record: Omit<WorkplaneRoutingWindow, 'id'> & { id?: string }) => WorkplaneRoutingWindow;
  getActiveClaim: (workplaneId: string, taskId: number | null) => WorkplaneRoutingClaim | undefined;
  insertClaim: (record: Omit<WorkplaneRoutingClaim, 'id'> & { id?: string }) => WorkplaneRoutingClaim;
  releaseClaim: (id: string, releasedAt: string) => WorkplaneRoutingClaim | undefined;
  listClaims: (workplaneId: string, limit?: number) => WorkplaneRoutingClaim[];
  clearForTests: () => void;
}

function parseReasons(raw: string): RoutingReason[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is RoutingReason =>
      Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)
        && typeof (entry as RoutingReason).source === 'string'
        && typeof (entry as RoutingReason).decision === 'string'
        && typeof (entry as RoutingReason).detail === 'string'),
    );
  } catch {
    return [];
  }
}

function chiefFromRow(row: ChiefRow): WorkplaneChiefAssignment {
  return {
    workplaneId: row.workplane_id,
    chiefAgentId: row.chief_agent_id,
    chiefInviteId: row.chief_invite_id,
    chiefAgentName: row.chief_agent_name,
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by,
    priorityWindowMs: Number(row.priority_window_ms) || DEFAULT_CHIEF_PRIORITY_WINDOW_MS,
    updatedAt: row.updated_at,
  };
}

function windowFromRow(row: WindowRow): WorkplaneRoutingWindow {
  return {
    id: row.id,
    workplaneId: row.workplane_id,
    taskId: row.task_id,
    openedAt: row.opened_at,
    priorityWindowMs: Number(row.priority_window_ms) || DEFAULT_CHIEF_PRIORITY_WINDOW_MS,
    expiresAt: row.expires_at,
  };
}

function claimFromRow(row: ClaimRow): WorkplaneRoutingClaim {
  return {
    id: row.id,
    workplaneId: row.workplane_id,
    taskId: row.task_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    claimMode: (row.claim_mode === 'assign' ? 'assign' : 'claim') as RoutingClaimMode,
    status: (row.status === 'released' ? 'released' : 'active') as RoutingClaimStatus,
    requestId: row.request_id,
    policyCode: row.policy_code,
    policyReason: row.policy_reason,
    reasonChain: parseReasons(row.reason_chain_json),
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    releasedAt: row.released_at,
  };
}

function taskKey(taskId: number | null): string {
  return taskId == null ? 'null' : String(taskId);
}

export function ensureChiefRoutingSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workplane_chief_assignments (
      workplane_id TEXT PRIMARY KEY,
      chief_agent_id TEXT NOT NULL,
      chief_invite_id TEXT,
      chief_agent_name TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      assigned_by TEXT,
      priority_window_ms INTEGER NOT NULL DEFAULT ${DEFAULT_CHIEF_PRIORITY_WINDOW_MS},
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workplane_routing_windows (
      id TEXT PRIMARY KEY,
      workplane_id TEXT NOT NULL,
      task_id INTEGER,
      opened_at TEXT NOT NULL,
      priority_window_ms INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      UNIQUE(workplane_id, task_id)
    );
    CREATE INDEX IF NOT EXISTS idx_routing_windows_wp
      ON workplane_routing_windows(workplane_id);

    CREATE TABLE IF NOT EXISTS workplane_routing_claims (
      id TEXT PRIMARY KEY,
      workplane_id TEXT NOT NULL,
      task_id INTEGER,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      claim_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      request_id TEXT,
      policy_code TEXT NOT NULL,
      policy_reason TEXT NOT NULL,
      reason_chain_json TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      claimed_by TEXT,
      released_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_routing_claims_wp
      ON workplane_routing_claims(workplane_id, status);
    CREATE INDEX IF NOT EXISTS idx_routing_claims_active
      ON workplane_routing_claims(workplane_id, task_id, status);
  `);
}

export function createChiefRoutingStore(db?: Database.Database): ChiefRoutingStore {
  const resolveDb = () => db ?? getEntityDatabase(ensureChiefRoutingSchema);

  return {
    ensureSchema() {
      ensureChiefRoutingSchema(resolveDb());
    },

    getChief(workplaneId) {
      const key = workplaneId.trim();
      if (!key) return undefined;
      const database = resolveDb();
      ensureChiefRoutingSchema(database);
      const row = database
        .prepare('SELECT * FROM workplane_chief_assignments WHERE workplane_id = ?')
        .get(key) as ChiefRow | undefined;
      return row ? chiefFromRow(row) : undefined;
    },

    upsertChief(record) {
      const database = resolveDb();
      ensureChiefRoutingSchema(database);
      database
        .prepare(`
          INSERT INTO workplane_chief_assignments (
            workplane_id, chief_agent_id, chief_invite_id, chief_agent_name,
            assigned_at, assigned_by, priority_window_ms, updated_at
          ) VALUES (
            @workplane_id, @chief_agent_id, @chief_invite_id, @chief_agent_name,
            @assigned_at, @assigned_by, @priority_window_ms, @updated_at
          )
          ON CONFLICT(workplane_id) DO UPDATE SET
            chief_agent_id = excluded.chief_agent_id,
            chief_invite_id = excluded.chief_invite_id,
            chief_agent_name = excluded.chief_agent_name,
            assigned_at = excluded.assigned_at,
            assigned_by = excluded.assigned_by,
            priority_window_ms = excluded.priority_window_ms,
            updated_at = excluded.updated_at
        `)
        .run({
          workplane_id: record.workplaneId,
          chief_agent_id: record.chiefAgentId,
          chief_invite_id: record.chiefInviteId,
          chief_agent_name: record.chiefAgentName,
          assigned_at: record.assignedAt,
          assigned_by: record.assignedBy,
          priority_window_ms: record.priorityWindowMs,
          updated_at: record.updatedAt,
        });
      return this.getChief(record.workplaneId)!;
    },

    clearChief(workplaneId) {
      const key = workplaneId.trim();
      if (!key) return false;
      const database = resolveDb();
      ensureChiefRoutingSchema(database);
      const result = database
        .prepare('DELETE FROM workplane_chief_assignments WHERE workplane_id = ?')
        .run(key);
      return result.changes > 0;
    },

    getWindow(workplaneId, taskId) {
      const key = workplaneId.trim();
      if (!key) return undefined;
      const database = resolveDb();
      ensureChiefRoutingSchema(database);
      // SQLite NULL unique quirks: match via COALESCE for lookup.
      const row = database
        .prepare(`
          SELECT * FROM workplane_routing_windows
          WHERE workplane_id = ?
            AND COALESCE(task_id, -1) = COALESCE(?, -1)
        `)
        .get(key, taskId) as WindowRow | undefined;
      return row ? windowFromRow(row) : undefined;
    },

    upsertWindow(record) {
      const database = resolveDb();
      ensureChiefRoutingSchema(database);
      const existing = this.getWindow(record.workplaneId, record.taskId);
      const id = record.id?.trim() || existing?.id || randomUUID();
      if (existing) {
        database
          .prepare(`
            UPDATE workplane_routing_windows
            SET opened_at = @opened_at,
                priority_window_ms = @priority_window_ms,
                expires_at = @expires_at
            WHERE id = @id
          `)
          .run({
            id,
            opened_at: record.openedAt,
            priority_window_ms: record.priorityWindowMs,
            expires_at: record.expiresAt,
          });
      } else {
        database
          .prepare(`
            INSERT INTO workplane_routing_windows (
              id, workplane_id, task_id, opened_at, priority_window_ms, expires_at
            ) VALUES (
              @id, @workplane_id, @task_id, @opened_at, @priority_window_ms, @expires_at
            )
          `)
          .run({
            id,
            workplane_id: record.workplaneId,
            task_id: record.taskId,
            opened_at: record.openedAt,
            priority_window_ms: record.priorityWindowMs,
            expires_at: record.expiresAt,
          });
      }
      return this.getWindow(record.workplaneId, record.taskId)!;
    },

    getActiveClaim(workplaneId, taskId) {
      const key = workplaneId.trim();
      if (!key) return undefined;
      const database = resolveDb();
      ensureChiefRoutingSchema(database);
      const row = database
        .prepare(`
          SELECT * FROM workplane_routing_claims
          WHERE workplane_id = ?
            AND status = 'active'
            AND COALESCE(task_id, -1) = COALESCE(?, -1)
          ORDER BY claimed_at DESC
          LIMIT 1
        `)
        .get(key, taskId) as ClaimRow | undefined;
      return row ? claimFromRow(row) : undefined;
    },

    insertClaim(record) {
      const database = resolveDb();
      ensureChiefRoutingSchema(database);
      const id = record.id?.trim() || randomUUID();
      database
        .prepare(`
          INSERT INTO workplane_routing_claims (
            id, workplane_id, task_id, agent_id, agent_name, claim_mode, status,
            request_id, policy_code, policy_reason, reason_chain_json,
            claimed_at, claimed_by, released_at
          ) VALUES (
            @id, @workplane_id, @task_id, @agent_id, @agent_name, @claim_mode, @status,
            @request_id, @policy_code, @policy_reason, @reason_chain_json,
            @claimed_at, @claimed_by, @released_at
          )
        `)
        .run({
          id,
          workplane_id: record.workplaneId,
          task_id: record.taskId,
          agent_id: record.agentId,
          agent_name: record.agentName,
          claim_mode: record.claimMode,
          status: record.status,
          request_id: record.requestId,
          policy_code: record.policyCode,
          policy_reason: record.policyReason,
          reason_chain_json: JSON.stringify(record.reasonChain),
          claimed_at: record.claimedAt,
          claimed_by: record.claimedBy,
          released_at: record.releasedAt,
        });
      const row = database
        .prepare('SELECT * FROM workplane_routing_claims WHERE id = ?')
        .get(id) as ClaimRow;
      return claimFromRow(row);
    },

    releaseClaim(id, releasedAt) {
      const key = id.trim();
      if (!key) return undefined;
      const database = resolveDb();
      ensureChiefRoutingSchema(database);
      database
        .prepare(`
          UPDATE workplane_routing_claims
          SET status = 'released', released_at = ?
          WHERE id = ? AND status = 'active'
        `)
        .run(releasedAt, key);
      const row = database
        .prepare('SELECT * FROM workplane_routing_claims WHERE id = ?')
        .get(key) as ClaimRow | undefined;
      return row ? claimFromRow(row) : undefined;
    },

    listClaims(workplaneId, limit = 20) {
      const key = workplaneId.trim();
      if (!key) return [];
      const database = resolveDb();
      ensureChiefRoutingSchema(database);
      const rows = database
        .prepare(`
          SELECT * FROM workplane_routing_claims
          WHERE workplane_id = ?
          ORDER BY claimed_at DESC
          LIMIT ?
        `)
        .all(key, Math.max(1, Math.min(limit, 100))) as ClaimRow[];
      return rows.map(claimFromRow);
    },

    clearForTests() {
      const database = resolveDb();
      ensureChiefRoutingSchema(database);
      database.exec(`
        DELETE FROM workplane_routing_claims;
        DELETE FROM workplane_routing_windows;
        DELETE FROM workplane_chief_assignments;
      `);
      void taskKey;
    },
  };
}
