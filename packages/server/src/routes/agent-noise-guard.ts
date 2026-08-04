/**
 * THE-930 — Agent Noise Controls.
 *
 * An atomic scoped reservation that prevents an agent from sending duplicate
 * messages (concurrently or within a cooldown window), honors a mute set, and
 * bounds its stored state. Suppression is decided entirely from the
 * server-resolved agent target and the guard's own clock — caller-supplied
 * sender/timestamps can neither bypass nor trigger it.
 *
 * Two interchangeable backends back the reservation/cooldown state:
 *  - in-memory (default): process-local, synchronous, held until release.
 *  - DB-backed (when `db` is supplied): a shared SQLite table so multiple Entity
 *    server processes using the same DB cannot both win a concurrent scoped
 *    reservation. The DB path uses a transactional compare-and-set with lease
 *    expiry (crash safety), success-only cooldown, and bounded cleanup.
 *
 * Policy is refreshed from the shared settings store before every reservation when
 * a policy reader is supplied; this makes already-running instances authoritative.
 */
import { createHash } from 'crypto';
import type Database from 'better-sqlite3';

export type NoiseSuppressionReason = 'duplicate-concurrent' | 'cooldown' | 'muted';

export interface NoiseReservation {
  suppressed: boolean;
  reason?: NoiseSuppressionReason;
  agent: string;
}

export interface NoiseScope {
  channelId: string;
  threadId?: string;
}

export interface AgentNoiseGuardOptions {
  /** Per-(agent,scope,content) cooldown window in ms. 0 disables cooldown. */
  cooldownMs?: number;
  mutedAgents?: string[];
  /** Hard cap on tracked last-send entries (bounded state). */
  maxStateEntries?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Max content bytes fed to the digest (bounds hashing cost). */
  maxContentBytes?: number;
  /**
   * Optional shared SQLite connection. When supplied, reservation/cooldown state
   * is backed by a DB table (atomic across processes). When omitted, the guard
   * uses an in-process in-memory backend.
   */
  db?: Database.Database;
  /**
   * In-flight lease duration (DB backend only). A holder that crashes (never
   * releases) blocks the scope only until the lease elapses. Ignored by the
   * in-memory backend, which releases synchronously.
   */
  leaseMs?: number;
  /** Read the current shared policy before every reservation/snapshot. */
  policy?: () => { cooldownMs: number; mutedAgents: string[] };
}

export interface AgentNoiseGuardSnapshot {
  cooldownMs: number;
  mutedAgents: string[];
  trackedScopes: number;
}

export interface NoiseReleaseOptions {
  /** When true, the delivery succeeded and the cooldown window is recorded. */
  delivered?: boolean;
}

export interface AgentNoiseGuard {
  reserve(agent: string, scope: NoiseScope, content: string): NoiseReservation;
  release(agent: string, scope: NoiseScope, content: string, options?: NoiseReleaseOptions): void;
  isMuted(agent: string): boolean;
  setMuted(agent: string, muted: boolean): void;
  getCooldownMs(): number;
  setCooldownMs(ms: number): void;
  snapshot(): AgentNoiseGuardSnapshot;
}

const DEFAULT_MAX_STATE_ENTRIES = 1000;
const DEFAULT_MAX_CONTENT_BYTES = 4096;
const DEFAULT_LEASE_MS = 120_000; // comfortably above the 60s agent reply timeout

function normalizeAgent(agent: string): string {
  return String(agent ?? '').trim().toLowerCase();
}

function buildScopeKey(agent: string, scope: NoiseScope): string {
  const channelId = String(scope.channelId ?? '').trim();
  const threadId = scope.threadId ? String(scope.threadId).trim() : '';
  return `${agent}::${channelId}::${threadId}`;
}

function hashContent(content: string, maxBytes: number): string {
  const trimmed = String(content ?? '').trim();
  return createHash('sha1').update(trimmed.slice(0, maxBytes)).digest('hex');
}

// ── Reservation backend ──────────────────────────────────────────────────────

interface ReserveDecision {
  acquired: boolean;
  reason?: NoiseSuppressionReason;
}

interface ReservationBackend {
  tryReserve(scopeKey: string, agent: string, now: number, cooldownMs: number): ReserveDecision;
  release(scopeKey: string, now: number, delivered: boolean): void;
  trackedCount(): number;
}

/** Process-local in-memory backend (default). Held until explicit release. */
class InMemoryReservationBackend implements ReservationBackend {
  private readonly inFlight = new Map<string, number>();
  private readonly lastSend = new Map<string, number>();
  constructor(private readonly maxStateEntries: number) {}

  tryReserve(scopeKey: string, _agent: string, now: number, cooldownMs: number): ReserveDecision {
    if (this.inFlight.has(scopeKey)) {
      return { acquired: false, reason: 'duplicate-concurrent' };
    }
    const last = this.lastSend.get(scopeKey);
    if (last !== undefined && now - last < cooldownMs) {
      return { acquired: false, reason: 'cooldown' };
    }
    // Acquire the in-flight reservation only. The cooldown window is recorded on
    // release({ delivered: true }) so a failed provider call cannot consume the
    // cooldown and block a legitimate retry.
    this.inFlight.set(scopeKey, now);
    return { acquired: true };
  }

  release(scopeKey: string, now: number, delivered: boolean): void {
    this.inFlight.delete(scopeKey);
    if (delivered) {
      this.lastSend.set(scopeKey, now);
      this.evictIfNeeded();
    }
  }

  trackedCount(): number {
    return this.lastSend.size;
  }

  private evictIfNeeded(): void {
    if (this.lastSend.size <= this.maxStateEntries) return;
    const entries = [...this.lastSend.entries()].sort((a, b) => a[1] - b[1]);
    const excess = entries.length - this.maxStateEntries;
    for (let i = 0; i < excess; i += 1) {
      this.lastSend.delete(entries[i]![0]);
    }
  }
}

const NOISE_RESERVATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_noise_reservations (
  scope_key    TEXT PRIMARY KEY,
  agent        TEXT NOT NULL,
  reserved_at  INTEGER NOT NULL,
  lease_until  INTEGER NOT NULL,
  last_sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_noise_reservations_last_sent
  ON agent_noise_reservations(last_sent_at);
`;

interface ReservationRow {
  scope_key: string;
  agent: string;
  reserved_at: number;
  lease_until: number;
  last_sent_at: number | null;
}

/**
 * Shared DB backend. A single transaction performs cleanup + compare-and-set, so
 * two connections/processes cannot both acquire the same scope (better-sqlite3
 * serializes write transactions; busy_timeout handles contention).
 */
class DbReservationBackend implements ReservationBackend {
  private readonly getStmt: Database.Statement;
  private readonly upsertStmt: Database.Statement;
  private readonly releaseDeliveredStmt: Database.Statement;
  private readonly clearLeaseStmt: Database.Statement;
  private readonly staleCleanupStmt: Database.Statement;
  private readonly countStmt: Database.Statement;
  private readonly evictStmt: Database.Statement;
  private readonly trackedCountStmt: Database.Statement;

  constructor(
    private readonly db: Database.Database,
    private readonly leaseMs: number,
    private readonly maxStateEntries: number,
  ) {
    db.pragma('busy_timeout = 5000');
    try {
      db.pragma('journal_mode = WAL');
    } catch {
      // WAL may be rejected on some in-memory/ephemeral DBs; non-fatal.
    }
    db.exec(NOISE_RESERVATION_SCHEMA);

    this.getStmt = db.prepare('SELECT scope_key, agent, reserved_at, lease_until, last_sent_at FROM agent_noise_reservations WHERE scope_key = ?');
    this.upsertStmt = db.prepare(`
      INSERT INTO agent_noise_reservations (scope_key, agent, reserved_at, lease_until, last_sent_at)
      VALUES (@scope_key, @agent, @reserved_at, @lease_until, @last_sent_at)
      ON CONFLICT(scope_key) DO UPDATE SET
        agent = excluded.agent,
        reserved_at = excluded.reserved_at,
        lease_until = excluded.lease_until,
        last_sent_at = excluded.last_sent_at
    `);
    this.releaseDeliveredStmt = db.prepare(`
      UPDATE agent_noise_reservations SET lease_until = @lease_until, last_sent_at = @now WHERE scope_key = @scope_key
    `);
    this.clearLeaseStmt = db.prepare(`
      UPDATE agent_noise_reservations SET lease_until = @lease_until WHERE scope_key = @scope_key
    `);
    // A row is stale once its lease has expired AND (it has no cooldown, or its
    // cooldown window has elapsed). Stale rows are safe to delete (bounded state).
    this.staleCleanupStmt = db.prepare(`
      DELETE FROM agent_noise_reservations
      WHERE lease_until <= @now
        AND (last_sent_at IS NULL OR @cooldownMs = 0 OR last_sent_at + @cooldownMs <= @now)
    `);
    this.countStmt = db.prepare('SELECT COUNT(*) AS c FROM agent_noise_reservations');
    this.evictStmt = db.prepare(`
      DELETE FROM agent_noise_reservations
      WHERE scope_key IN (
        SELECT scope_key FROM agent_noise_reservations
        WHERE lease_until <= @now
        ORDER BY COALESCE(last_sent_at, reserved_at) ASC
        LIMIT @excess
      )
    `);
    this.trackedCountStmt = db.prepare('SELECT COUNT(*) AS c FROM agent_noise_reservations WHERE last_sent_at IS NOT NULL');
  }

  tryReserve(scopeKey: string, agent: string, now: number, cooldownMs: number): ReserveDecision {
    const leaseUntil = now + this.leaseMs;
    const tx = this.db.transaction((): ReserveDecision => {
      // 1) bounded cleanup of fully-stale rows.
      this.staleCleanupStmt.run({ now, cooldownMs });
      // 2) hard cap: evict oldest expired-lease rows if still over the limit.
      // Never evict a currently-held lease (lease_until > now).
      const total = (this.countStmt.get() as { c: number }).c;
      if (total > this.maxStateEntries) {
        this.evictStmt.run({ now, excess: total - this.maxStateEntries });
      }
      // 3) compare-and-set against the current row.
      const row = this.getStmt.get(scopeKey) as ReservationRow | undefined;
      if (row && row.lease_until > now) {
        return { acquired: false, reason: 'duplicate-concurrent' };
      }
      if (row && row.last_sent_at != null && now - row.last_sent_at < cooldownMs) {
        return { acquired: false, reason: 'cooldown' };
      }
      this.upsertStmt.run({
        scope_key: scopeKey,
        agent,
        reserved_at: now,
        lease_until: leaseUntil,
        last_sent_at: row?.last_sent_at ?? null,
      });
      return { acquired: true };
    });
    return tx();
  }

  release(scopeKey: string, now: number, delivered: boolean): void {
    const tx = this.db.transaction(() => {
      if (delivered) {
        // Success-only cooldown: record last_send and clear the in-flight lease.
        this.releaseDeliveredStmt.run({ scope_key: scopeKey, lease_until: now, now });
      } else {
        // Clear the in-flight lease only; keep any prior cooldown window.
        this.clearLeaseStmt.run({ scope_key: scopeKey, lease_until: now });
      }
    });
    tx();
  }

  trackedCount(): number {
    return (this.trackedCountStmt.get() as { c: number }).c;
  }
}

export function createAgentNoiseGuard(options: AgentNoiseGuardOptions = {}): AgentNoiseGuard {
  const cooldownMs = Math.max(0, Number(options.cooldownMs ?? 0) || 0);
  const maxStateEntries = Math.max(1, Number(options.maxStateEntries ?? DEFAULT_MAX_STATE_ENTRIES) || DEFAULT_MAX_STATE_ENTRIES);
  const maxContentBytes = Number(options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES) || DEFAULT_MAX_CONTENT_BYTES;
  const now = options.now ?? (() => Date.now());

  const muted = new Set((options.mutedAgents ?? []).map(normalizeAgent).filter(Boolean));
  const backend: ReservationBackend = options.db
    ? new DbReservationBackend(options.db, Math.max(1, Number(options.leaseMs ?? DEFAULT_LEASE_MS) || DEFAULT_LEASE_MS), maxStateEntries)
    : new InMemoryReservationBackend(maxStateEntries);
  let currentCooldown = cooldownMs;
  const refreshPolicy = () => {
    if (!options.policy) return;
    const policy = options.policy();
    currentCooldown = Math.max(0, Number(policy.cooldownMs) || 0);
    muted.clear();
    for (const agent of policy.mutedAgents ?? []) {
      const normalized = normalizeAgent(agent);
      if (normalized) muted.add(normalized);
    }
  };

  function reserveKey(agent: string, scope: NoiseScope, content: string): string {
    return `${buildScopeKey(agent, scope)}::${hashContent(content, maxContentBytes)}`;
  }

  return {
    reserve(agent, scopeArg, content) {
      refreshPolicy();
      const normalized = normalizeAgent(agent);
      if (muted.has(normalized)) {
        return { suppressed: true, reason: 'muted', agent: normalized };
      }
      const key = reserveKey(normalized, scopeArg, content);
      const decision = backend.tryReserve(key, normalized, now(), currentCooldown);
      if (!decision.acquired) {
        return { suppressed: true, reason: decision.reason, agent: normalized };
      }
      return { suppressed: false, agent: normalized };
    },

    release(agent, scopeArg, content, options) {
      const key = reserveKey(normalizeAgent(agent), scopeArg, content);
      backend.release(key, now(), Boolean(options?.delivered));
    },

    isMuted(agent) {
      refreshPolicy();
      return muted.has(normalizeAgent(agent));
    },

    setMuted(agent, mutedFlag) {
      const normalized = normalizeAgent(agent);
      if (mutedFlag) muted.add(normalized);
      else muted.delete(normalized);
    },

    getCooldownMs() {
      refreshPolicy();
      return currentCooldown;
    },

    setCooldownMs(ms) {
      currentCooldown = Math.max(0, Number(ms) || 0);
    },

    snapshot() {
      refreshPolicy();
      return {
        cooldownMs: currentCooldown,
        mutedAgents: [...muted].sort(),
        trackedScopes: backend.trackedCount(),
      };
    },
  };
}
