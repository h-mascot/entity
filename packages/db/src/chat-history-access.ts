import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export interface ChatChannelScopeRecord {
  id: string;
  channel_id: string;
  org_id: string;
  team_id: string | null;
  scoped_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface ChatHistoryGrantRecord {
  id: string;
  org_id: string;
  team_id: string | null;
  channel_id: string;
  agent_id: string;
  granted_by_user_id: string;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revocation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatHistoryAccessRepository {
  upsertChannelScope: (input: {
    channel_id: string;
    org_id: string;
    team_id: string | null;
    scoped_by_user_id: string;
  }) => ChatChannelScopeRecord;
  getChannelScope: (channelId: string) => ChatChannelScopeRecord | undefined;
  listChannelScopes: (filters: {
    org_id: string;
    team_id?: string | null;
  }) => ChatChannelScopeRecord[];
  upsertGrant: (input: {
    org_id: string;
    team_id?: string | null;
    channel_id: string;
    agent_id: string;
    granted_by_user_id: string;
  }) => ChatHistoryGrantRecord;
  getActiveGrant: (
    orgId: string,
    channelId: string,
    agentId: string,
  ) => ChatHistoryGrantRecord | undefined;
  listActiveGrants: (filters: {
    org_id?: string;
    agent_id?: string;
    channel_id?: string;
  }) => ChatHistoryGrantRecord[];
  revokeGrant: (input: {
    org_id: string;
    channel_id: string;
    agent_id: string;
    revoked_by_user_id: string;
    revocation_reason: string;
  }) => ChatHistoryGrantRecord | undefined;
}

function required(value: unknown, field: string, max = 240): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${field} is too long`);
  return normalized;
}

function optionalIdentifier(value: unknown, field: string): string | null {
  return value == null ? null : required(value, field);
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_channel_scopes (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL UNIQUE,
      org_id TEXT NOT NULL,
      team_id TEXT,
      scoped_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_chat_channel_scopes_org
      ON chat_channel_scopes(org_id, team_id, channel_id);

    CREATE TABLE IF NOT EXISTS chat_history_access_grants (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      team_id TEXT,
      channel_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      granted_by_user_id TEXT NOT NULL,
      revoked_at TEXT,
      revoked_by_user_id TEXT,
      revocation_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, channel_id, agent_id)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_history_access_active
      ON chat_history_access_grants(org_id, agent_id, channel_id, revoked_at);
  `);
}

function mapScope(row: Record<string, unknown>): ChatChannelScopeRecord {
  return {
    id: String(row.id),
    channel_id: String(row.channel_id),
    org_id: String(row.org_id),
    team_id: row.team_id == null ? null : String(row.team_id),
    scoped_by_user_id: String(row.scoped_by_user_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapGrant(row: Record<string, unknown>): ChatHistoryGrantRecord {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    team_id: row.team_id == null ? null : String(row.team_id),
    channel_id: String(row.channel_id),
    agent_id: String(row.agent_id),
    granted_by_user_id: String(row.granted_by_user_id),
    revoked_at: row.revoked_at == null ? null : String(row.revoked_at),
    revoked_by_user_id: row.revoked_by_user_id == null ? null : String(row.revoked_by_user_id),
    revocation_reason: row.revocation_reason == null ? null : String(row.revocation_reason),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function createChatHistoryAccessRepository(): ChatHistoryAccessRepository {
  const db = getEntityDatabase(ensureSchema);
  const scopeQuery = db.prepare('SELECT * FROM chat_channel_scopes WHERE channel_id = ?');
  const grantQuery = db.prepare(`
    SELECT * FROM chat_history_access_grants
    WHERE org_id = ? AND channel_id = ? AND agent_id = ?
  `);

  return {
    upsertChannelScope: (input) => {
      const channelId = required(input.channel_id, 'channel id');
      db.prepare(`
        INSERT INTO chat_channel_scopes (
          id, channel_id, org_id, team_id, scoped_by_user_id
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET
          org_id = excluded.org_id,
          team_id = excluded.team_id,
          scoped_by_user_id = excluded.scoped_by_user_id,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        randomUUID(),
        channelId,
        required(input.org_id, 'organization id'),
        optionalIdentifier(input.team_id, 'team id'),
        required(input.scoped_by_user_id, 'scoping user id'),
      );
      return mapScope(scopeQuery.get(channelId) as Record<string, unknown>);
    },
    getChannelScope: (channelId) => {
      const row = scopeQuery.get(required(channelId, 'channel id')) as Record<string, unknown> | undefined;
      return row ? mapScope(row) : undefined;
    },
    listChannelScopes: (filters) => {
      const orgId = required(filters.org_id, 'organization id');
      const rows = filters.team_id === undefined
        ? db.prepare('SELECT * FROM chat_channel_scopes WHERE org_id = ? ORDER BY channel_id').all(orgId)
        : filters.team_id === null
          ? db.prepare('SELECT * FROM chat_channel_scopes WHERE org_id = ? AND team_id IS NULL ORDER BY channel_id').all(orgId)
          : db.prepare('SELECT * FROM chat_channel_scopes WHERE org_id = ? AND team_id = ? ORDER BY channel_id')
              .all(orgId, required(filters.team_id, 'team id'));
      return (rows as Record<string, unknown>[]).map(mapScope);
    },
    upsertGrant: (input) => {
      const orgId = required(input.org_id, 'organization id');
      const channelId = required(input.channel_id, 'channel id');
      const agentId = required(input.agent_id, 'agent id');
      const scope = scopeQuery.get(channelId) as Record<string, unknown> | undefined;
      if (!scope || String(scope.org_id) !== orgId) {
        throw new Error('channel is not scoped to this organization');
      }
      const teamId = optionalIdentifier(input.team_id, 'team id');
      const scopedTeamId = scope.team_id == null ? null : String(scope.team_id);
      if (teamId !== scopedTeamId) {
        throw new Error('grant team must match channel scope');
      }
      db.prepare(`
        INSERT INTO chat_history_access_grants (
          id, org_id, team_id, channel_id, agent_id, granted_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(org_id, channel_id, agent_id) DO UPDATE SET
          team_id = excluded.team_id,
          granted_by_user_id = excluded.granted_by_user_id,
          revoked_at = NULL,
          revoked_by_user_id = NULL,
          revocation_reason = NULL,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        randomUUID(),
        orgId,
        teamId,
        channelId,
        agentId,
        required(input.granted_by_user_id, 'granting user id'),
      );
      return mapGrant(grantQuery.get(orgId, channelId, agentId) as Record<string, unknown>);
    },
    getActiveGrant: (orgId, channelId, agentId) => {
      const row = db.prepare(`
        SELECT * FROM chat_history_access_grants
        WHERE org_id = ? AND channel_id = ? AND agent_id = ? AND revoked_at IS NULL
      `).get(
        required(orgId, 'organization id'),
        required(channelId, 'channel id'),
        required(agentId, 'agent id'),
      ) as Record<string, unknown> | undefined;
      return row ? mapGrant(row) : undefined;
    },
    listActiveGrants: (filters) => {
      const clauses = ['revoked_at IS NULL'];
      const values: string[] = [];
      for (const [column, value, field] of [
        ['org_id', filters.org_id, 'organization id'],
        ['agent_id', filters.agent_id, 'agent id'],
        ['channel_id', filters.channel_id, 'channel id'],
      ] as const) {
        if (value !== undefined) {
          clauses.push(`${column} = ?`);
          values.push(required(value, field));
        }
      }
      return (db.prepare(`
        SELECT * FROM chat_history_access_grants
        WHERE ${clauses.join(' AND ')}
        ORDER BY org_id, channel_id, agent_id
      `).all(...values) as Record<string, unknown>[]).map(mapGrant);
    },
    revokeGrant: (input) => {
      const orgId = required(input.org_id, 'organization id');
      const channelId = required(input.channel_id, 'channel id');
      const agentId = required(input.agent_id, 'agent id');
      db.prepare(`
        UPDATE chat_history_access_grants
        SET revoked_at = CURRENT_TIMESTAMP,
            revoked_by_user_id = ?,
            revocation_reason = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE org_id = ? AND channel_id = ? AND agent_id = ? AND revoked_at IS NULL
      `).run(
        required(input.revoked_by_user_id, 'revoking user id'),
        required(input.revocation_reason, 'revocation reason', 500),
        orgId,
        channelId,
        agentId,
      );
      const row = grantQuery.get(orgId, channelId, agentId) as Record<string, unknown> | undefined;
      return row ? mapGrant(row) : undefined;
    },
  };
}
