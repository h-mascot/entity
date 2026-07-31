/**
 * THE-884 / WP2-B-03 — Attach agents to task Workplanes.
 *
 * Durable membership separate from heartbeat presence and invite creation binding.
 * Presence overlay stays truthful (missing/offline/live); never invents activity.
 */

import type { AgentPresenceStatus } from '../identity-capability-card';

export interface WorkplaneAgentAttachment {
  id: string;
  workplaneId: string;
  agentId: string;
  inviteId: string | null;
  taskId: number | null;
  agentName: string;
  role: string;
  attachedAt: string;
  attachedBy: string | null;
  updatedAt: string;
}

export interface AttachAgentInput {
  workplaneId: string;
  agentId?: string | null;
  inviteId?: string | null;
  taskId?: number | null;
  agentName?: string | null;
  role?: string | null;
  attachedBy?: string | null;
}

export type AttachmentPresenceSource =
  | 'attachment'
  | 'heartbeat'
  | 'invite_missing';

export interface WorkplaneAttachedAgentView {
  attachmentId: string;
  workplaneId: string;
  agentId: string;
  inviteId: string | null;
  taskId: number | null;
  agentName: string;
  role: string;
  attachedAt: string;
  attachedBy: string | null;
  /** Evaluated presence — missing when no heartbeat. */
  presenceStatus: AgentPresenceStatus;
  lastSeenAt: string | null;
  heartbeatFreshnessLabel: string;
  currentWorkLabel: string;
  degradedReasons: string[];
  source: AttachmentPresenceSource;
}

export interface WorkplaneAttachedAgentsPanel {
  workplaneId: string;
  evaluatedAt: string;
  agents: WorkplaneAttachedAgentView[];
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
