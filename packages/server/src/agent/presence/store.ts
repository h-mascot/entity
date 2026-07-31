/**
 * Durable agent workplane presence persistence (THE-883 / WP2-B-02).
 *
 * Lives in the Entity SQLite DB; schema ensured on first use.
 * Does not invent live agents — empty reads stay empty/missing.
 */

import type Database from 'better-sqlite3';
import { getEntityDatabase } from '../../../../db/src/entity-db';
import type { AgentPresenceRecord, HeartbeatInputStatus } from './types';

interface PresenceRow {
  agent_id: string;
  invite_id: string | null;
  status: string;
  last_seen_at: string;
  current_task_id: number | null;
  current_workplane_id: string | null;
  runtime: string | null;
  session_id: string | null;
  capabilities_json: string;
  updated_at: string;
}

export interface AgentPresenceStore {
  ensureSchema: () => void;
  upsertHeartbeat: (record: AgentPresenceRecord) => AgentPresenceRecord;
  getByAgentId: (agentId: string) => AgentPresenceRecord | undefined;
  listByWorkplaneId: (workplaneId: string) => AgentPresenceRecord[];
  listAll: () => AgentPresenceRecord[];
  clearForTests: () => void;
}

function parseCapabilities(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return [];
  }
}

function asHeartbeatStatus(value: string): HeartbeatInputStatus {
  if (value === 'idle' || value === 'offline' || value === 'live') return value;
  return 'live';
}

function rowToRecord(row: PresenceRow): AgentPresenceRecord {
  return {
    agentId: row.agent_id,
    inviteId: row.invite_id,
    status: asHeartbeatStatus(row.status),
    lastSeenAt: row.last_seen_at,
    currentTaskId: row.current_task_id,
    currentWorkplaneId: row.current_workplane_id,
    runtime: row.runtime,
    sessionId: row.session_id,
    capabilities: parseCapabilities(row.capabilities_json),
    updatedAt: row.updated_at,
  };
}

export function ensureAgentPresenceSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_workplane_presence (
      agent_id TEXT PRIMARY KEY,
      invite_id TEXT,
      status TEXT NOT NULL DEFAULT 'live',
      last_seen_at TEXT NOT NULL,
      current_task_id INTEGER,
      current_workplane_id TEXT,
      runtime TEXT,
      session_id TEXT,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_presence_workplane
      ON agent_workplane_presence(current_workplane_id);
    CREATE INDEX IF NOT EXISTS idx_agent_presence_last_seen
      ON agent_workplane_presence(last_seen_at DESC);
  `);
}

export function createAgentPresenceStore(db?: Database.Database): AgentPresenceStore {
  const resolveDb = () => db ?? getEntityDatabase(ensureAgentPresenceSchema);

  return {
    ensureSchema() {
      ensureAgentPresenceSchema(resolveDb());
    },

    upsertHeartbeat(record) {
      const database = resolveDb();
      ensureAgentPresenceSchema(database);
      database
        .prepare(`
          INSERT INTO agent_workplane_presence (
            agent_id, invite_id, status, last_seen_at, current_task_id,
            current_workplane_id, runtime, session_id, capabilities_json, updated_at
          ) VALUES (
            @agent_id, @invite_id, @status, @last_seen_at, @current_task_id,
            @current_workplane_id, @runtime, @session_id, @capabilities_json, @updated_at
          )
          ON CONFLICT(agent_id) DO UPDATE SET
            invite_id = excluded.invite_id,
            status = excluded.status,
            last_seen_at = excluded.last_seen_at,
            current_task_id = excluded.current_task_id,
            current_workplane_id = excluded.current_workplane_id,
            runtime = excluded.runtime,
            session_id = excluded.session_id,
            capabilities_json = excluded.capabilities_json,
            updated_at = excluded.updated_at
        `)
        .run({
          agent_id: record.agentId,
          invite_id: record.inviteId,
          status: record.status,
          last_seen_at: record.lastSeenAt,
          current_task_id: record.currentTaskId,
          current_workplane_id: record.currentWorkplaneId,
          runtime: record.runtime,
          session_id: record.sessionId,
          capabilities_json: JSON.stringify(record.capabilities),
          updated_at: record.updatedAt,
        });
      return this.getByAgentId(record.agentId)!;
    },

    getByAgentId(agentId) {
      const id = agentId.trim();
      if (!id) return undefined;
      const database = resolveDb();
      ensureAgentPresenceSchema(database);
      const row = database
        .prepare('SELECT * FROM agent_workplane_presence WHERE agent_id = ? LIMIT 1')
        .get(id) as PresenceRow | undefined;
      return row ? rowToRecord(row) : undefined;
    },

    listByWorkplaneId(workplaneId) {
      const id = workplaneId.trim();
      if (!id) return [];
      const database = resolveDb();
      ensureAgentPresenceSchema(database);
      const rows = database
        .prepare(`
          SELECT * FROM agent_workplane_presence
          WHERE current_workplane_id = ?
          ORDER BY last_seen_at DESC, agent_id ASC
        `)
        .all(id) as PresenceRow[];
      return rows.map(rowToRecord);
    },

    listAll() {
      const database = resolveDb();
      ensureAgentPresenceSchema(database);
      const rows = database
        .prepare('SELECT * FROM agent_workplane_presence ORDER BY last_seen_at DESC, agent_id ASC')
        .all() as PresenceRow[];
      return rows.map(rowToRecord);
    },

    clearForTests() {
      const database = resolveDb();
      ensureAgentPresenceSchema(database);
      database.prepare('DELETE FROM agent_workplane_presence').run();
    },
  };
}
