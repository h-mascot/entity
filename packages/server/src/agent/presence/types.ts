/**
 * THE-883 / WP2-B-02 — Agent / Workplane presence types.
 *
 * Compatible with THE-882 identity/capability card presence fields.
 */

import type { AgentPresenceStatus } from '../identity-capability-card';

export const HEARTBEAT_INPUT_STATUSES = ['live', 'idle', 'offline'] as const;
export type HeartbeatInputStatus = (typeof HEARTBEAT_INPUT_STATUSES)[number];

/** Default: live/idle older than 90s become stale on read (matches identity card). */
export const PRESENCE_STALE_AFTER_MS = 90_000;

export interface AgentPresenceRecord {
  agentId: string;
  inviteId: string | null;
  status: HeartbeatInputStatus;
  lastSeenAt: string;
  currentTaskId: number | null;
  currentWorkplaneId: string | null;
  runtime: string | null;
  sessionId: string | null;
  capabilities: string[];
  updatedAt: string;
}

export interface HeartbeatInput {
  agentId: string;
  inviteId?: string | null;
  status?: HeartbeatInputStatus | string | null;
  currentTaskId?: number | null;
  currentWorkplaneId?: string | null;
  runtime?: string | null;
  sessionId?: string | null;
  capabilities?: readonly string[] | null;
  /** Optional override for tests; production always uses server clock. */
  lastSeenAt?: string | null;
}

export interface EvaluatedPresence {
  agentId: string;
  inviteId: string | null;
  agentName: string;
  role: string;
  /** Evaluated presence (may be stale/missing/unknown). */
  presenceStatus: AgentPresenceStatus;
  lastSeenAt: string | null;
  heartbeatFreshnessLabel: string;
  currentTaskId: number | null;
  currentWorkplaneId: string | null;
  currentWorkLabel: string;
  runtime: string | null;
  sessionId: string | null;
  capabilities: string[];
  cardCompleteness: 'complete' | 'partial' | 'degraded';
  degradedReasons: string[];
  /** True when row came only from invite binding with no heartbeat. */
  source: 'heartbeat' | 'invite_missing';
}

export interface WorkplanePresencePanel {
  workplaneId: string;
  staleAfterMs: number;
  evaluatedAt: string;
  agents: EvaluatedPresence[];
  counts: {
    total: number;
    live: number;
    idle: number;
    stale: number;
    offline: number;
    missing: number;
    unknown: number;
    degraded: number;
  };
}
