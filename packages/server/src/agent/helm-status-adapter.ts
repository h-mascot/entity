import type { AgentRegistryRecord } from "../../../db/src";

export type HelmRuntimeState = "healthy" | "degraded" | "unavailable" | "unknown";
export type HelmReadinessState = "ready" | "degraded" | "unavailable" | "unknown";

export interface HelmRuntimeStatusSummary {
  source: "helm";
  binding_id: string | null;
  state: HelmRuntimeState;
  health: HelmRuntimeState;
  readiness: HelmReadinessState;
  current_work: string | null;
  heartbeat_at: string | null;
  checked_at: string;
  stale: boolean;
  reason: string;
  helm_link: string | null;
}

export interface HelmStatusProvider {
  readStatus(bindingId: string): Promise<unknown>;
}

export interface HelmStatusAdapter {
  getStatus(agent: AgentRegistryRecord): Promise<HelmRuntimeStatusSummary>;
}

const STALE_HEARTBEAT_MS = 5 * 60 * 1000;

function nowIso(now: Date): string {
  return now.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return null;
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeHealth(value: unknown): HelmRuntimeState {
  if (value === true) return "healthy";
  if (value === false) return "degraded";
  const normalized = text(value)?.toLowerCase();
  if (normalized === "healthy" || normalized === "degraded" || normalized === "unavailable" || normalized === "unknown") {
    return normalized;
  }
  if (normalized === "ok" || normalized === "ready" || normalized === "live") return "healthy";
  if (normalized === "offline" || normalized === "down") return "unavailable";
  return "unknown";
}

function normalizeReadiness(value: unknown): HelmReadinessState {
  if (value === true) return "ready";
  if (value === false) return "degraded";
  const normalized = text(value)?.toLowerCase();
  if (normalized === "ready" || normalized === "degraded" || normalized === "unavailable" || normalized === "unknown") {
    return normalized;
  }
  if (normalized === "healthy" || normalized === "ok" || normalized === "live") return "ready";
  if (normalized === "offline" || normalized === "down") return "unavailable";
  return "unknown";
}

function stateFromReadiness(readiness: HelmReadinessState): HelmRuntimeState {
  if (readiness === "ready") return "healthy";
  return readiness;
}

function deriveState(health: HelmRuntimeState, readiness: HelmReadinessState, stale: boolean): HelmRuntimeState {
  if (stale) return "degraded";
  if (health === "unavailable" || readiness === "unavailable") return "unavailable";
  if (health === "degraded" || readiness === "degraded") return "degraded";
  if (health === "healthy" || readiness === "ready") return "healthy";
  return "unknown";
}

function normalizeCurrentWork(record: Record<string, unknown>): string | null {
  const direct = firstText(record, ["current_work", "currentWork", "work", "task", "currentTask"]);
  if (direct) return direct;
  const currentTask = record.currentWork ?? record.current_work ?? record.currentTask ?? record.current_task;
  if (isRecord(currentTask)) {
    return firstText(currentTask, ["title", "name", "id"]);
  }
  return null;
}

function normalizeHelmLink(record: Record<string, unknown>): string | null {
  const candidate = firstText(record, ["helm_link", "helmLink", "url", "runtime_url", "runtimeUrl"]);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function baseStatus(agent: AgentRegistryRecord, now: Date, state: HelmRuntimeState, reason: string): HelmRuntimeStatusSummary {
  return {
    source: "helm",
    binding_id: agent.runtime_binding_id ?? null,
    state,
    health: state === "healthy" ? "healthy" : state === "degraded" ? "degraded" : state === "unavailable" ? "unavailable" : "unknown",
    readiness: state === "healthy" ? "ready" : state === "degraded" ? "degraded" : state === "unavailable" ? "unavailable" : "unknown",
    current_work: null,
    heartbeat_at: null,
    checked_at: nowIso(now),
    stale: state === "degraded" && reason.includes("stale"),
    reason,
    helm_link: null,
  };
}

function sanitizeHelmPayload(agent: AgentRegistryRecord, payload: unknown, now: Date): HelmRuntimeStatusSummary {
  if (!isRecord(payload)) {
    return baseStatus(agent, now, "unknown", "malformed_helm_status");
  }

  const health = normalizeHealth(payload.health ?? payload.status ?? payload.state);
  const readiness = normalizeReadiness(payload.readiness ?? payload.ready ?? payload.status ?? payload.state);
  const heartbeatAt = normalizeIso(payload.heartbeat_at ?? payload.heartbeatAt ?? payload.last_heartbeat_at ?? payload.lastHeartbeatAt);
  const checkedAt = normalizeIso(payload.checked_at ?? payload.checkedAt) ?? nowIso(now);
  const heartbeatAge = heartbeatAt ? now.getTime() - new Date(heartbeatAt).getTime() : 0;
  const stale = payload.stale === true || (heartbeatAt ? heartbeatAge > STALE_HEARTBEAT_MS : false);
  const derivedState = deriveState(health, readiness, stale);
  const reason =
    firstText(payload, ["reason", "status_reason", "statusReason"]) ??
    (stale ? "stale_helm_heartbeat" : derivedState === "healthy" ? "helm_status_reachable" : `helm_status_${derivedState}`);

  return {
    source: "helm",
    binding_id: agent.runtime_binding_id ?? null,
    state: derivedState,
    health: stale && health === "healthy" ? "degraded" : health,
    readiness: stale && readiness === "ready" ? "degraded" : readiness,
    current_work: normalizeCurrentWork(payload),
    heartbeat_at: heartbeatAt,
    checked_at: checkedAt,
    stale,
    reason,
    helm_link: normalizeHelmLink(payload),
  };
}

export function createHelmStatusAdapter(options: { provider?: HelmStatusProvider; now?: () => Date } = {}): HelmStatusAdapter {
  const now = options.now ?? (() => new Date());
  return {
    async getStatus(agent: AgentRegistryRecord): Promise<HelmRuntimeStatusSummary> {
      const currentTime = now();
      if (!agent.helm_managed) {
        return baseStatus(agent, currentTime, "unknown", "not_helm_managed");
      }
      if (!agent.runtime_binding_id) {
        return baseStatus(agent, currentTime, "unknown", "missing_runtime_binding_id");
      }
      if (agent.binding_state === "stale") {
        return baseStatus(agent, currentTime, "degraded", "stale_runtime_binding");
      }
      if (agent.binding_state !== "bound") {
        return baseStatus(agent, currentTime, "unknown", `runtime_binding_${agent.binding_state}`);
      }
      if (!options.provider) {
        return baseStatus(agent, currentTime, "unavailable", "helm_status_provider_unavailable");
      }

      try {
        return sanitizeHelmPayload(agent, await options.provider.readStatus(agent.runtime_binding_id), currentTime);
      } catch {
        return baseStatus(agent, currentTime, "unavailable", "helm_status_unreachable");
      }
    },
  };
}
