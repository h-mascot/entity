import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';
import type {
  ChatNoiseAuditRecord,
  ChatNoiseControlRepository,
  ChatNoiseCooldownRecord,
  ChatNoiseMuteRecord,
  ChatNoiseReservationDecision,
  ChatNoiseReservationRecord,
  ChatNoiseReservationState,
} from './chat-noise-control-types';
export type {
  ChatNoiseAuditRecord,
  ChatNoiseControlRepository,
  ChatNoiseCooldownRecord,
  ChatNoiseMuteRecord,
  ChatNoiseReservationDecision,
  ChatNoiseReservationRecord,
  ChatNoiseReservationState,
} from './chat-noise-control-types';

function required(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${field} is too long`);
  return normalized;
}

function optionalId(value: unknown, field: string): string | null {
  return value == null || value === '' ? null : required(value, field, 240);
}

function timestamp(value: unknown, field: string): string {
  const normalized = required(value, field);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid timestamp`);
  return parsed.toISOString();
}

function cooldownSeconds(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 86_400) {
    throw new Error('cooldown seconds must be an integer from 1 to 86400');
  }
  return Number(value);
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_noise_cooldowns (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT,
      channel_id TEXT NOT NULL, agent_id TEXT NOT NULL, cooldown_seconds INTEGER NOT NULL,
      configured_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(org_id, channel_id, agent_id)
    );
    CREATE TABLE IF NOT EXISTS chat_noise_mutes (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT,
      team_scope TEXT NOT NULL DEFAULT '', scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, muted_by_user_id TEXT NOT NULL,
      reason TEXT NOT NULL, cleared_at TEXT, cleared_by_user_id TEXT, clear_reason TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(org_id, scope_type, scope_id, team_scope)
    );
    CREATE TABLE IF NOT EXISTS chat_noise_reservations (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT, category_id TEXT NOT NULL,
      channel_id TEXT NOT NULL, agent_id TEXT NOT NULL, state TEXT NOT NULL,
      attempted_at TEXT NOT NULL, completed_at TEXT, released_at TEXT, release_reason TEXT,
      override_actor_user_id TEXT, override_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chat_noise_reservation_target
      ON chat_noise_reservations(org_id, channel_id, agent_id, state, attempted_at);
    CREATE TABLE IF NOT EXISTS chat_noise_audit (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT, action TEXT NOT NULL,
      channel_id TEXT, category_id TEXT, agent_id TEXT, reservation_id TEXT,
      actor_user_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_noise_audit_org
      ON chat_noise_audit(org_id, created_at DESC);
  `);
}

const textOrNull = (value: unknown) => value == null ? null : String(value);

function mapCooldown(row: Record<string, unknown>): ChatNoiseCooldownRecord {
  return {
    id: String(row.id), org_id: String(row.org_id), team_id: textOrNull(row.team_id),
    channel_id: String(row.channel_id), agent_id: String(row.agent_id),
    cooldown_seconds: Number(row.cooldown_seconds),
    configured_by_user_id: String(row.configured_by_user_id),
    created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}

function mapMute(row: Record<string, unknown>): ChatNoiseMuteRecord {
  return {
    id: String(row.id), org_id: String(row.org_id), team_id: textOrNull(row.team_id),
    scope_type: String(row.scope_type) as 'channel' | 'category', scope_id: String(row.scope_id),
    muted_by_user_id: String(row.muted_by_user_id), reason: String(row.reason),
    cleared_at: textOrNull(row.cleared_at), cleared_by_user_id: textOrNull(row.cleared_by_user_id),
    clear_reason: textOrNull(row.clear_reason), created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapReservation(row: Record<string, unknown>): ChatNoiseReservationRecord {
  return {
    id: String(row.id), org_id: String(row.org_id), team_id: textOrNull(row.team_id),
    category_id: String(row.category_id), channel_id: String(row.channel_id),
    agent_id: String(row.agent_id), state: String(row.state) as ChatNoiseReservationState,
    attempted_at: String(row.attempted_at), completed_at: textOrNull(row.completed_at),
    released_at: textOrNull(row.released_at), release_reason: textOrNull(row.release_reason),
    override_actor_user_id: textOrNull(row.override_actor_user_id),
    override_reason: textOrNull(row.override_reason),
  };
}

function mapAudit(row: Record<string, unknown>): ChatNoiseAuditRecord {
  return {
    id: String(row.id), org_id: String(row.org_id), team_id: textOrNull(row.team_id),
    action: String(row.action), channel_id: textOrNull(row.channel_id),
    category_id: textOrNull(row.category_id), agent_id: textOrNull(row.agent_id),
    reservation_id: textOrNull(row.reservation_id), actor_user_id: String(row.actor_user_id),
    reason: textOrNull(row.reason), created_at: String(row.created_at),
  };
}

export function createChatNoiseControlRepository(): ChatNoiseControlRepository {
  const db = getEntityDatabase(ensureSchema);
  const cooldownQuery = db.prepare(`
    SELECT * FROM chat_noise_cooldowns WHERE org_id = ? AND channel_id = ? AND agent_id = ?
  `);
  const reservationQuery = db.prepare('SELECT * FROM chat_noise_reservations WHERE id = ? AND org_id = ?');
  const appendAudit = (input: Omit<ChatNoiseAuditRecord, 'id' | 'created_at'>, at: string) => {
    db.prepare(`
      INSERT INTO chat_noise_audit (
        id, org_id, team_id, action, channel_id, category_id, agent_id,
        reservation_id, actor_user_id, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), input.org_id, input.team_id, input.action, input.channel_id,
      input.category_id, input.agent_id, input.reservation_id,
      input.actor_user_id, input.reason, at,
    );
  };
  const activeMute = (orgId: string, type: string, scopeId: string, teamId?: string | null) => {
    const row = db.prepare(`
      SELECT * FROM chat_noise_mutes
      WHERE org_id = ? AND scope_type = ? AND scope_id = ? AND cleared_at IS NULL
        AND (team_id IS NULL OR team_id = ?)
      ORDER BY CASE WHEN team_id IS NULL THEN 1 ELSE 0 END, updated_at DESC
      LIMIT 1
    `).get(orgId, type, scopeId, teamId ?? null) as Record<string, unknown> | undefined;
    return row ? mapMute(row) : undefined;
  };
  const setMute = (type: 'channel' | 'category', input: {
    org_id: string; team_id?: string | null; muted?: boolean;
    muted_by_user_id?: string; actor_user_id?: string; reason?: string;
    channel_id?: string; category_id?: string;
  }) => db.transaction(() => {
    const orgId = required(input.org_id, 'organization id');
    const scopeId = required(type === 'channel' ? input.channel_id : input.category_id, `${type} id`);
    const teamId = optionalId(input.team_id, 'team id');
    const actor = required(input.muted_by_user_id ?? input.actor_user_id, 'mute actor');
    const now = new Date().toISOString();
    const existing = activeMute(orgId, type, scopeId, teamId);
    if (input.muted === false) {
      if (!existing) throw new Error('active mute was not found');
      return clearMute({
        org_id: orgId, mute_id: existing.id, cleared_by_user_id: actor,
        reason: required(input.reason ?? 'Mute disabled by operator', 'clear reason'),
      })!;
    }
    const reason = required(input.reason ?? 'Muted by operator', 'mute reason');
    db.prepare(`
      INSERT INTO chat_noise_mutes (
        id, org_id, team_id, team_scope, scope_type, scope_id, muted_by_user_id, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(org_id, scope_type, scope_id, team_scope) DO UPDATE SET
        muted_by_user_id = excluded.muted_by_user_id, reason = excluded.reason,
        cleared_at = NULL, cleared_by_user_id = NULL, clear_reason = NULL, updated_at = excluded.updated_at
    `).run(randomUUID(), orgId, teamId, teamId ?? '', type, scopeId, actor, reason, now, now);
    const mute = activeMute(orgId, type, scopeId, teamId)!;
    appendAudit({
      org_id: orgId, team_id: teamId, action: 'mute_set',
      channel_id: type === 'channel' ? scopeId : null,
      category_id: type === 'category' ? scopeId : null, agent_id: null,
      reservation_id: null, actor_user_id: actor, reason,
    }, now);
    return mute;
  })();
  const clearMute = (input: {
    org_id: string; mute_id: string; cleared_by_user_id: string; reason: string;
  }) => {
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE chat_noise_mutes SET cleared_at = ?, cleared_by_user_id = ?, clear_reason = ?, updated_at = ?
      WHERE id = ? AND org_id = ? AND cleared_at IS NULL
    `).run(
      now, required(input.cleared_by_user_id, 'clearing user id'),
      required(input.reason, 'clear reason'), now,
      required(input.mute_id, 'mute id'), required(input.org_id, 'organization id'),
    );
    if (!result.changes) return undefined;
    const mute = mapMute(db.prepare('SELECT * FROM chat_noise_mutes WHERE id = ?').get(input.mute_id) as Record<string, unknown>);
    appendAudit({
      org_id: mute.org_id, team_id: mute.team_id, action: 'mute_cleared',
      channel_id: mute.scope_type === 'channel' ? mute.scope_id : null,
      category_id: mute.scope_type === 'category' ? mute.scope_id : null,
      agent_id: null, reservation_id: null,
      actor_user_id: mute.cleared_by_user_id!, reason: mute.clear_reason,
    }, now);
    return mute;
  };

  const repository: ChatNoiseControlRepository = {
    configureCooldown: (input) => {
      const seconds = cooldownSeconds(input.cooldown_seconds);
      const now = new Date().toISOString();
      const orgId = required(input.org_id, 'organization id');
      const channelId = required(input.channel_id, 'channel id');
      const agentId = required(input.agent_id, 'agent id');
      const teamId = optionalId(input.team_id, 'team id');
      const configuredBy = required(input.configured_by_user_id, 'configuring user id');
      db.prepare(`
        INSERT INTO chat_noise_cooldowns (
          id, org_id, team_id, channel_id, agent_id, cooldown_seconds,
          configured_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(org_id, channel_id, agent_id) DO UPDATE SET
          team_id = excluded.team_id, cooldown_seconds = excluded.cooldown_seconds,
          configured_by_user_id = excluded.configured_by_user_id, updated_at = excluded.updated_at
      `).run(
        randomUUID(), orgId, teamId, channelId, agentId,
        seconds, configuredBy, now, now,
      );
      const policy = mapCooldown(cooldownQuery.get(orgId, channelId, agentId) as Record<string, unknown>);
      appendAudit({
        org_id: orgId, team_id: teamId, action: 'cooldown_configured',
        channel_id: channelId, category_id: null, agent_id: agentId,
        reservation_id: null, actor_user_id: configuredBy, reason: String(seconds),
      }, now);
      return policy;
    },
    clearCooldown: (input) => {
      const orgId = required(input.org_id, 'organization id');
      const channelId = required(input.channel_id, 'channel id');
      const agentId = required(input.agent_id, 'agent id');
      const actor = required(input.cleared_by_user_id, 'clearing user id');
      const existing = repository.getCooldown(orgId, channelId, agentId);
      if (!existing) return false;
      db.prepare(`
        DELETE FROM chat_noise_cooldowns WHERE org_id = ? AND channel_id = ? AND agent_id = ?
      `).run(orgId, channelId, agentId);
      appendAudit({
        org_id: orgId, team_id: existing.team_id, action: 'cooldown_cleared',
        channel_id: channelId, category_id: null, agent_id: agentId,
        reservation_id: null, actor_user_id: actor, reason: null,
      }, new Date().toISOString());
      return true;
    },
    getCooldown: (orgId, channelId, agentId) => {
      const row = cooldownQuery.get(
        required(orgId, 'organization id'), required(channelId, 'channel id'), required(agentId, 'agent id'),
      ) as Record<string, unknown> | undefined;
      return row ? mapCooldown(row) : undefined;
    },
    listCooldowns: (filters) => {
      const orgId = required(filters.org_id, 'organization id');
      const rows = filters.team_id === undefined
        ? db.prepare('SELECT * FROM chat_noise_cooldowns WHERE org_id = ? ORDER BY channel_id, agent_id').all(orgId)
        : filters.team_id === null
          ? db.prepare('SELECT * FROM chat_noise_cooldowns WHERE org_id = ? AND team_id IS NULL ORDER BY channel_id, agent_id').all(orgId)
          : db.prepare('SELECT * FROM chat_noise_cooldowns WHERE org_id = ? AND team_id = ? ORDER BY channel_id, agent_id')
              .all(orgId, required(filters.team_id, 'team id'));
      return (rows as Record<string, unknown>[]).map(mapCooldown);
    },
    setChannelMute: (input) => setMute('channel', input),
    setCategoryMute: (input) => setMute('category', input),
    getActiveChannelMute: (orgId, channelId, teamId) =>
      activeMute(required(orgId, 'organization id'), 'channel', required(channelId, 'channel id'), teamId),
    getActiveCategoryMute: (orgId, categoryId, teamId) =>
      activeMute(required(orgId, 'organization id'), 'category', required(categoryId, 'category id'), teamId),
    listActiveMutes: (filters) => {
      const orgId = required(filters.org_id, 'organization id');
      const rows = filters.team_id === undefined
        ? db.prepare(`
            SELECT * FROM chat_noise_mutes
            WHERE org_id = ? AND cleared_at IS NULL
            ORDER BY scope_type, scope_id
          `).all(orgId)
        : filters.team_id === null
          ? db.prepare(`
              SELECT * FROM chat_noise_mutes
              WHERE org_id = ? AND team_id IS NULL AND cleared_at IS NULL
              ORDER BY scope_type, scope_id
            `).all(orgId)
          : db.prepare(`
              SELECT * FROM chat_noise_mutes
              WHERE org_id = ? AND team_id = ? AND cleared_at IS NULL
              ORDER BY scope_type, scope_id
            `).all(orgId, required(filters.team_id, 'team id'));
      return (rows as Record<string, unknown>[]).map(mapMute);
    },
    clearMute,
    reservePost: (input) => db.transaction((): ChatNoiseReservationDecision => {
      const orgId = required(input.org_id, 'organization id');
      const categoryId = required(input.category_id, 'category id');
      const channelId = required(input.channel_id, 'channel id');
      const agentId = required(input.agent_id, 'agent id');
      const teamId = optionalId(input.team_id, 'team id');
      const attemptedAt = timestamp(input.attempted_at, 'attempted at');
      const override = input.operator_override;
      if (override) {
        required(override.actor_user_id, 'override actor');
        required(override.reason, 'override reason');
      }
      const suppress = (reason: ChatNoiseReservationDecision['reason'], retry?: number) => {
        appendAudit({
          org_id: orgId, team_id: teamId, action: 'post_suppressed',
          channel_id: channelId, category_id: categoryId, agent_id: agentId,
          reservation_id: null, actor_user_id: 'system', reason,
        }, attemptedAt);
        return { allowed: false, reason, ...(retry ? { retry_after_seconds: retry } : {}), reservation: null };
      };
      if (!override) {
        if (activeMute(orgId, 'category', categoryId, teamId)) return suppress('category_muted');
        if (activeMute(orgId, 'channel', channelId, teamId)) return suppress('channel_muted');
        const attemptedMs = new Date(attemptedAt).getTime();
        const pending = db.prepare(`
          SELECT attempted_at FROM chat_noise_reservations
          WHERE org_id = ? AND channel_id = ? AND agent_id = ? AND state = 'reserved'
          ORDER BY attempted_at DESC LIMIT 1
        `).get(orgId, channelId, agentId) as { attempted_at?: string } | undefined;
        if (pending && attemptedMs - new Date(String(pending.attempted_at)).getTime() < 300_000) {
          return suppress('reservation_pending');
        }
        const policy = repository.getCooldown(orgId, channelId, agentId);
        if (policy) {
          const latest = db.prepare(`
            SELECT completed_at FROM chat_noise_reservations
            WHERE org_id = ? AND channel_id = ? AND agent_id = ? AND state = 'completed'
            ORDER BY completed_at DESC LIMIT 1
          `).get(orgId, channelId, agentId) as { completed_at?: string } | undefined;
          if (latest?.completed_at) {
            const remaining = Math.ceil(
              (new Date(latest.completed_at).getTime() + policy.cooldown_seconds * 1_000 - attemptedMs) / 1_000,
            );
            if (remaining > 0) return suppress('cooldown', remaining);
          }
        }
      }
      const id = randomUUID();
      db.prepare(`
        INSERT INTO chat_noise_reservations (
          id, org_id, team_id, category_id, channel_id, agent_id, state, attempted_at,
          override_actor_user_id, override_reason
        ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)
      `).run(
        id, orgId, teamId, categoryId, channelId, agentId, attemptedAt,
        override?.actor_user_id ?? null, override?.reason ?? null,
      );
      const reservation = mapReservation(reservationQuery.get(id, orgId) as Record<string, unknown>);
      appendAudit({
        org_id: orgId, team_id: teamId, action: override ? 'operator_override' : 'post_reserved',
        channel_id: channelId, category_id: categoryId, agent_id: agentId,
        reservation_id: id, actor_user_id: override?.actor_user_id ?? 'system',
        reason: override?.reason ?? null,
      }, attemptedAt);
      return { allowed: true, reason: null, reservation };
    })(),
    completePost: (input) => {
      const completedAt = timestamp(input.completed_at, 'completed at');
      const result = db.prepare(`
        UPDATE chat_noise_reservations SET state = 'completed', completed_at = ?
        WHERE id = ? AND org_id = ? AND state = 'reserved'
      `).run(
        completedAt, required(input.reservation_id, 'reservation id'),
        required(input.org_id, 'organization id'),
      );
      if (!result.changes) throw new Error('active reservation was not found');
      const reservation = mapReservation(reservationQuery.get(input.reservation_id, input.org_id) as Record<string, unknown>);
      appendAudit({
        org_id: reservation.org_id, team_id: reservation.team_id, action: 'post_completed',
        channel_id: reservation.channel_id, category_id: reservation.category_id,
        agent_id: reservation.agent_id, reservation_id: reservation.id,
        actor_user_id: 'system', reason: null,
      }, completedAt);
      return reservation;
    },
    releasePost: (input) => {
      if (input.state !== 'released' && input.state !== 'failed') throw new Error('release state is invalid');
      const releasedAt = timestamp(input.released_at, 'released at');
      const reason = required(input.reason, 'release reason');
      const result = db.prepare(`
        UPDATE chat_noise_reservations SET state = ?, released_at = ?, release_reason = ?
        WHERE id = ? AND org_id = ? AND state = 'reserved'
      `).run(
        input.state, releasedAt, reason, required(input.reservation_id, 'reservation id'),
        required(input.org_id, 'organization id'),
      );
      if (!result.changes) throw new Error('active reservation was not found');
      const reservation = mapReservation(reservationQuery.get(input.reservation_id, input.org_id) as Record<string, unknown>);
      appendAudit({
        org_id: reservation.org_id, team_id: reservation.team_id,
        action: input.state === 'failed' ? 'post_failed' : 'post_released',
        channel_id: reservation.channel_id, category_id: reservation.category_id,
        agent_id: reservation.agent_id, reservation_id: reservation.id,
        actor_user_id: 'system', reason,
      }, releasedAt);
      return reservation;
    },
    listAuditEvents: (filters) => {
      const clauses = ['org_id = ?'];
      const values: Array<string | number | null> = [required(filters.org_id, 'organization id')];
      if (filters.team_id !== undefined) {
        clauses.push('team_id IS ?');
        values.push(optionalId(filters.team_id, 'team id'));
      }
      const limit = Math.max(1, Math.min(Number(filters.limit ?? 200), 500));
      values.push(limit);
      return (db.prepare(`
        SELECT * FROM chat_noise_audit WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, id DESC LIMIT ?
      `).all(...values) as Record<string, unknown>[]).map(mapAudit);
    },
  };
  return repository;
}
