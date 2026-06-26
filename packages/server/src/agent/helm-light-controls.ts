import type { AgentRegistryRecord } from "../../../db/src";

export type HelmLightControlAction = "pause" | "resume" | "request_retry";
export type HelmLightControlStatus = "accepted" | "denied" | "unavailable";

export interface HelmLightControlAudit {
  event_type: "helm_light_control_requested";
  agent_id: string;
  action: HelmLightControlAction;
  actor_principal_id: string;
  runtime_binding_id: string | null;
  policy_allowed: boolean;
  policy_reason: string;
  forwarded_to_helm: boolean;
  created_at: string;
}

export interface HelmLightControlResult {
  accepted: boolean;
  status: HelmLightControlStatus;
  action: HelmLightControlAction;
  reason: string;
  audit: HelmLightControlAudit;
  helm_link: string | null;
}

export interface HelmLightControlProvider {
  sendControl(bindingId: string, action: HelmLightControlAction, audit: HelmLightControlAudit): Promise<unknown>;
}

export interface HelmLightControlAdapter {
  requestControl(
    agent: AgentRegistryRecord,
    action: HelmLightControlAction,
    actorPrincipalId: string,
  ): Promise<HelmLightControlResult>;
}

export const HELM_LIGHT_CONTROL_ACTIONS: readonly HelmLightControlAction[] = ["pause", "resume", "request_retry"];

function nowIso(now: Date): string {
  return now.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeHelmLink(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const raw = payload.helm_link ?? payload.helmLink ?? payload.url;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function policyDecision(agent: AgentRegistryRecord): { allowed: boolean; reason: string } {
  if (!agent.helm_managed) {
    return { allowed: false, reason: "not_helm_managed" };
  }
  if (!agent.runtime_binding_id) {
    return { allowed: false, reason: "missing_runtime_binding_id" };
  }
  if (agent.binding_state !== "bound") {
    return { allowed: false, reason: `runtime_binding_${agent.binding_state}` };
  }
  return { allowed: true, reason: "policy_allowed_reversible_control" };
}

function buildAudit(input: {
  agent: AgentRegistryRecord;
  action: HelmLightControlAction;
  actorPrincipalId: string;
  allowed: boolean;
  reason: string;
  forwarded: boolean;
  now: Date;
}): HelmLightControlAudit {
  return {
    event_type: "helm_light_control_requested",
    agent_id: input.agent.id,
    action: input.action,
    actor_principal_id: input.actorPrincipalId || "unknown",
    runtime_binding_id: input.agent.runtime_binding_id ?? null,
    policy_allowed: input.allowed,
    policy_reason: input.reason,
    forwarded_to_helm: input.forwarded,
    created_at: nowIso(input.now),
  };
}

export function createHelmLightControlAdapter(options: {
  provider?: HelmLightControlProvider;
  now?: () => Date;
} = {}): HelmLightControlAdapter {
  const now = options.now ?? (() => new Date());
  return {
    async requestControl(agent, action, actorPrincipalId) {
      const decision = policyDecision(agent);
      if (!decision.allowed) {
        const audit = buildAudit({
          agent,
          action,
          actorPrincipalId,
          allowed: false,
          reason: decision.reason,
          forwarded: false,
          now: now(),
        });
        return { accepted: false, status: "denied", action, reason: decision.reason, audit, helm_link: null };
      }

      if (!options.provider) {
        const audit = buildAudit({
          agent,
          action,
          actorPrincipalId,
          allowed: true,
          reason: "helm_control_provider_unavailable",
          forwarded: false,
          now: now(),
        });
        return { accepted: false, status: "unavailable", action, reason: audit.policy_reason, audit, helm_link: null };
      }

      const audit = buildAudit({
        agent,
        action,
        actorPrincipalId,
        allowed: true,
        reason: decision.reason,
        forwarded: true,
        now: now(),
      });
      try {
        const payload = await options.provider.sendControl(agent.runtime_binding_id!, action, audit);
        return {
          accepted: true,
          status: "accepted",
          action,
          reason: decision.reason,
          audit,
          helm_link: normalizeHelmLink(payload),
        };
      } catch {
        return {
          accepted: false,
          status: "unavailable",
          action,
          reason: "helm_control_provider_unavailable",
          audit: { ...audit, forwarded_to_helm: false, policy_reason: "helm_control_provider_unavailable" },
          helm_link: null,
        };
      }
    },
  };
}
