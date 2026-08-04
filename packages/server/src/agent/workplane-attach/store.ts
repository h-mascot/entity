/**
 * Durable workplane agent attachment persistence (THE-884 / WP2-B-03).
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from '../../../../db/src/entity-db';
import type { WorkplaneAgentAttachment } from './types';

interface AttachmentRow {
  id: string;
  workplane_id: string;
  agent_id: string;
  invite_id: string | null;
  task_id: number | null;
  agent_name: string;
  role: string;
  attached_at: string;
  attached_by: string | null;
  updated_at: string;
}

export interface WorkplaneAttachStore {
  ensureSchema: () => void;
  insert: (record: Omit<WorkplaneAgentAttachment, 'id' | 'updatedAt'> & {
    id?: string;
    updatedAt?: string;
  }) => WorkplaneAgentAttachment;
  getById: (id: string) => WorkplaneAgentAttachment | undefined;
  getByWorkplaneAndAgent: (
    workplaneId: string,
    agentId: string,
  ) => WorkplaneAgentAttachment | undefined;
  listByWorkplaneId: (workplaneId: string) => WorkplaneAgentAttachment[];
  deleteByWorkplaneAndAgent: (workplaneId: string, agentId: string) => boolean;
  deleteById: (id: string) => boolean;
  clearForTests: () => void;
}

function rowToRecord(row: AttachmentRow): WorkplaneAgentAttachment {
  return {
    id: row.id,
    workplaneId: row.workplane_id,
    agentId: row.agent_id,
    inviteId: row.invite_id,
    taskId: row.task_id,
    agentName: row.agent_name,
    role: row.role,
    attachedAt: row.attached_at,
    attachedBy: row.attached_by,
    updatedAt: row.updated_at,
  };
}

export function ensureWorkplaneAttachSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workplane_agent_attachments (
      id TEXT PRIMARY KEY,
      workplane_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      invite_id TEXT,
      task_id INTEGER,
      agent_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'worker',
      attached_at TEXT NOT NULL,
      attached_by TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(workplane_id, agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workplane_attach_workplane
      ON workplane_agent_attachments(workplane_id);
    CREATE INDEX IF NOT EXISTS idx_workplane_attach_agent
      ON workplane_agent_attachments(agent_id);
    CREATE INDEX IF NOT EXISTS idx_workplane_attach_invite
      ON workplane_agent_attachments(invite_id);
  `);
}

export function createWorkplaneAttachStore(db?: Database.Database): WorkplaneAttachStore {
  const resolveDb = () => db ?? getEntityDatabase(ensureWorkplaneAttachSchema);

  return {
    ensureSchema() {
      ensureWorkplaneAttachSchema(resolveDb());
    },

    insert(record) {
      const database = resolveDb();
      ensureWorkplaneAttachSchema(database);
      const id = record.id?.trim() || randomUUID();
      const updatedAt = record.updatedAt ?? record.attachedAt;
      database
        .prepare(`
          INSERT INTO workplane_agent_attachments (
            id, workplane_id, agent_id, invite_id, task_id,
            agent_name, role, attached_at, attached_by, updated_at
          ) VALUES (
            @id, @workplane_id, @agent_id, @invite_id, @task_id,
            @agent_name, @role, @attached_at, @attached_by, @updated_at
          )
        `)
        .run({
          id,
          workplane_id: record.workplaneId,
          agent_id: record.agentId,
          invite_id: record.inviteId,
          task_id: record.taskId,
          agent_name: record.agentName,
          role: record.role,
          attached_at: record.attachedAt,
          attached_by: record.attachedBy,
          updated_at: updatedAt,
        });
      return this.getById(id)!;
    },

    getById(id) {
      const key = id.trim();
      if (!key) return undefined;
      const database = resolveDb();
      ensureWorkplaneAttachSchema(database);
      const row = database
        .prepare('SELECT * FROM workplane_agent_attachments WHERE id = ? LIMIT 1')
        .get(key) as AttachmentRow | undefined;
      return row ? rowToRecord(row) : undefined;
    },

    getByWorkplaneAndAgent(workplaneId, agentId) {
      const wp = workplaneId.trim();
      const agent = agentId.trim();
      if (!wp || !agent) return undefined;
      const database = resolveDb();
      ensureWorkplaneAttachSchema(database);
      const row = database
        .prepare(`
          SELECT * FROM workplane_agent_attachments
          WHERE workplane_id = ? AND agent_id = ?
          LIMIT 1
        `)
        .get(wp, agent) as AttachmentRow | undefined;
      return row ? rowToRecord(row) : undefined;
    },

    listByWorkplaneId(workplaneId) {
      const id = workplaneId.trim();
      if (!id) return [];
      const database = resolveDb();
      ensureWorkplaneAttachSchema(database);
      const rows = database
        .prepare(`
          SELECT * FROM workplane_agent_attachments
          WHERE workplane_id = ?
          ORDER BY attached_at ASC, agent_name ASC
        `)
        .all(id) as AttachmentRow[];
      return rows.map(rowToRecord);
    },

    deleteByWorkplaneAndAgent(workplaneId, agentId) {
      const wp = workplaneId.trim();
      const agent = agentId.trim();
      if (!wp || !agent) return false;
      const database = resolveDb();
      ensureWorkplaneAttachSchema(database);
      const result = database
        .prepare(`
          DELETE FROM workplane_agent_attachments
          WHERE workplane_id = ? AND agent_id = ?
        `)
        .run(wp, agent);
      return Number(result.changes ?? 0) > 0;
    },

    deleteById(id) {
      const key = id.trim();
      if (!key) return false;
      const database = resolveDb();
      ensureWorkplaneAttachSchema(database);
      const result = database
        .prepare('DELETE FROM workplane_agent_attachments WHERE id = ?')
        .run(key);
      return Number(result.changes ?? 0) > 0;
    },

    clearForTests() {
      const database = resolveDb();
      ensureWorkplaneAttachSchema(database);
      database.prepare('DELETE FROM workplane_agent_attachments').run();
    },
  };
}
