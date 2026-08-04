/**
 * Invite revoke / regenerate / settings audit log (THE-887 / WP2-B-06).
 *
 * Audit-safe only: never stores raw tokens, token hashes, secrets, or provider keys.
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from '../../../../db/src/entity-db';

export const INVITE_AUDIT_EVENT_TYPES = [
  'invite_created',
  'invite_revoked',
  'invite_regenerated',
  'settings_updated',
] as const;

export type InviteAuditEventType = (typeof INVITE_AUDIT_EVENT_TYPES)[number];

export interface InviteAuditEvent {
  id: string;
  inviteId: string | null;
  eventType: InviteAuditEventType;
  actorId: string | null;
  agentName: string | null;
  status: string | null;
  generation: number | null;
  detail: string;
  createdAt: string;
}

export interface AppendInviteAuditInput {
  inviteId?: string | null;
  eventType: InviteAuditEventType;
  actorId?: string | null;
  agentName?: string | null;
  status?: string | null;
  generation?: number | null;
  detail?: string;
  createdAt?: string;
  id?: string;
}

interface AuditRow {
  id: string;
  invite_id: string | null;
  event_type: string;
  actor_id: string | null;
  agent_name: string | null;
  status: string | null;
  generation: number | null;
  detail: string;
  created_at: string;
}

const SECRETISH = /(token|secret|api[_-]?key|password|authorization|bearer)/i;

export function sanitizeAuditDetail(detail: string | undefined): string {
  const raw = typeof detail === 'string' ? detail.trim() : '';
  if (!raw) return '';
  // Drop any accidental secret-bearing fragments rather than echo them.
  if (SECRETISH.test(raw)) {
    return '[redacted: detail contained sensitive field name]';
  }
  return raw.slice(0, 500);
}

function rowToEvent(row: AuditRow): InviteAuditEvent {
  return {
    id: row.id,
    inviteId: row.invite_id,
    eventType: row.event_type as InviteAuditEventType,
    actorId: row.actor_id,
    agentName: row.agent_name,
    status: row.status,
    generation: row.generation,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

export function ensureInviteAuditSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_invite_audit_events (
      id TEXT PRIMARY KEY,
      invite_id TEXT,
      event_type TEXT NOT NULL,
      actor_id TEXT,
      agent_name TEXT,
      status TEXT,
      generation INTEGER,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_invite_audit_created
      ON agent_invite_audit_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_invite_audit_invite
      ON agent_invite_audit_events(invite_id, created_at DESC);
  `);
}

export interface InviteAuditStore {
  ensureSchema: () => void;
  append: (input: AppendInviteAuditInput) => InviteAuditEvent;
  list: (options?: { limit?: number; inviteId?: string }) => InviteAuditEvent[];
  clearForTests: () => void;
}

export function createInviteAuditStore(db?: Database.Database): InviteAuditStore {
  const resolveDb = () => db ?? getEntityDatabase(ensureInviteAuditSchema);

  return {
    ensureSchema() {
      ensureInviteAuditSchema(resolveDb());
    },
    append(input) {
      const database = resolveDb();
      ensureInviteAuditSchema(database);
      if (!(INVITE_AUDIT_EVENT_TYPES as readonly string[]).includes(input.eventType)) {
        throw new Error(`Unknown audit event type: ${input.eventType}`);
      }
      const event: InviteAuditEvent = {
        id: input.id ?? randomUUID(),
        inviteId: input.inviteId ?? null,
        eventType: input.eventType,
        actorId: input.actorId ?? null,
        agentName: input.agentName ?? null,
        status: input.status ?? null,
        generation: typeof input.generation === 'number' && Number.isFinite(input.generation)
          ? Math.floor(input.generation)
          : null,
        detail: sanitizeAuditDetail(input.detail),
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      database.prepare(`
        INSERT INTO agent_invite_audit_events (
          id, invite_id, event_type, actor_id, agent_name, status, generation, detail, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.inviteId,
        event.eventType,
        event.actorId,
        event.agentName,
        event.status,
        event.generation,
        event.detail,
        event.createdAt,
      );
      return event;
    },
    list(options = {}) {
      const database = resolveDb();
      ensureInviteAuditSchema(database);
      const limit = Math.min(
        200,
        Math.max(1, typeof options.limit === 'number' && Number.isFinite(options.limit)
          ? Math.floor(options.limit)
          : 50),
      );
      if (options.inviteId) {
        const rows = database.prepare(`
          SELECT * FROM agent_invite_audit_events
          WHERE invite_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(options.inviteId, limit) as AuditRow[];
        return rows.map(rowToEvent);
      }
      const rows = database.prepare(`
        SELECT * FROM agent_invite_audit_events
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(limit) as AuditRow[];
      return rows.map(rowToEvent);
    },
    clearForTests() {
      const database = resolveDb();
      ensureInviteAuditSchema(database);
      database.exec('DELETE FROM agent_invite_audit_events');
    },
  };
}

let defaultAuditStore: InviteAuditStore | null = null;

export function getInviteAuditStore(): InviteAuditStore {
  if (!defaultAuditStore) {
    defaultAuditStore = createInviteAuditStore();
  }
  return defaultAuditStore;
}

export function resetInviteAuditStoreForTests(): void {
  defaultAuditStore = null;
}
