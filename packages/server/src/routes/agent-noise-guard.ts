/**
 * THE-930 — Agent Noise Controls.
 *
 * An in-process, atomic scoped reservation that prevents an agent from sending
 * duplicate messages (concurrently or within a cooldown window), honors a mute
 * set, and bounds its stored state. Suppression is decided entirely from the
 * server-resolved agent target and the guard's own clock — caller-supplied
 * sender/timestamps can neither bypass nor trigger it.
 */
import { createHash } from 'crypto';

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

export function createAgentNoiseGuard(options: AgentNoiseGuardOptions = {}): AgentNoiseGuard {
  const cooldownMs = Math.max(0, Number(options.cooldownMs ?? 0) || 0);
  const maxStateEntries = Math.max(1, Number(options.maxStateEntries ?? DEFAULT_MAX_STATE_ENTRIES) || DEFAULT_MAX_STATE_ENTRIES);
  const maxContentBytes = Number(options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES) || DEFAULT_MAX_CONTENT_BYTES;
  const now = options.now ?? (() => Date.now());

  const muted = new Set((options.mutedAgents ?? []).map(normalizeAgent).filter(Boolean));
  // Two maps keyed by `${scopeKey}::${contentDigest}`:
  //  - inFlight: reservations currently held (cleared on release)
  //  - lastSend: timestamp of the most recent successful reservation (cooldown window)
  const inFlight = new Map<string, number>();
  const lastSend = new Map<string, number>();
  let currentCooldown = cooldownMs;

  function reserveKey(agent: string, scope: NoiseScope, content: string): string {
    return `${buildScopeKey(agent, scope)}::${hashContent(content, maxContentBytes)}`;
  }

  function evictIfNeeded(): void {
    if (lastSend.size <= maxStateEntries) return;
    // Evict the oldest entries by stored timestamp (bounded state).
    const entries = [...lastSend.entries()].sort((a, b) => a[1] - b[1]);
    const excess = entries.length - maxStateEntries;
    for (let i = 0; i < excess; i += 1) {
      lastSend.delete(entries[i]![0]);
    }
  }

  return {
    reserve(agent, scopeArg, content) {
      const normalized = normalizeAgent(agent);
      if (muted.has(normalized)) {
        return { suppressed: true, reason: 'muted', agent: normalized };
      }
      const key = reserveKey(normalized, scopeArg, content);
      if (inFlight.has(key)) {
        return { suppressed: true, reason: 'duplicate-concurrent', agent: normalized };
      }
      const ts = now();
      const last = lastSend.get(key);
      if (last !== undefined && ts - last < currentCooldown) {
        return { suppressed: true, reason: 'cooldown', agent: normalized };
      }
      // Acquire the in-flight reservation only. The cooldown window is recorded
      // on release({ delivered: true }) so a failed provider call cannot consume
      // the cooldown and block a legitimate retry.
      inFlight.set(key, ts);
      return { suppressed: false, agent: normalized };
    },

    release(agent, scopeArg, content, options) {
      const key = reserveKey(normalizeAgent(agent), scopeArg, content);
      inFlight.delete(key);
      if (options?.delivered) {
        lastSend.set(key, now());
        evictIfNeeded();
      }
    },

    isMuted(agent) {
      return muted.has(normalizeAgent(agent));
    },

    setMuted(agent, mutedFlag) {
      const normalized = normalizeAgent(agent);
      if (mutedFlag) muted.add(normalized);
      else muted.delete(normalized);
    },

    getCooldownMs() {
      return currentCooldown;
    },

    setCooldownMs(ms) {
      currentCooldown = Math.max(0, Number(ms) || 0);
    },

    snapshot() {
      return {
        cooldownMs: currentCooldown,
        mutedAgents: [...muted].sort(),
        trackedScopes: lastSend.size,
      };
    },
  };
}
