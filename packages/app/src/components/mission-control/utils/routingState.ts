export type RoutingStateTone = 'ok' | 'warning' | 'error' | 'muted' | 'info';

export interface RoutingStateInput {
  assignee?: string | null;
  assignmentState?: string | null;
  taskmasterDrivable?: boolean;
  executorPrincipalId?: string | null;
  ownerPrincipalId?: string | null;
  ownerPrincipalType?: string | null;
  metadataRecord?: Record<string, unknown> | null;
  activityEventTypes?: string[];
}

export interface RoutingStateView {
  key: string;
  label: string;
  reason: string;
  tone: RoutingStateTone;
  reasonChain: string[];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
}

function summarizeAuditValue(value: unknown): string | null {
  const text = readString(value);
  if (text) return text;
  const record = readRecord(value);
  if (record) {
    const reason = readString(record.reason);
    const actor = readString(record.actor_principal_id ?? record.actor);
    const priorAssignee = readString(record.prior_assignee);
    const newAssignee = readString(record.new_assignee);
    if (priorAssignee || newAssignee) {
      return `prior assignee=${priorAssignee ?? 'unknown'}; new assignee=${newAssignee ?? 'unknown'}${reason ? `; reason=${reason}` : ''}${actor ? `; actor=${actor}` : ''}`;
    }
    if (reason) return reason;
  }
  if (Array.isArray(value)) {
    const entries = value.map(summarizeAuditValue).filter((entry): entry is string => Boolean(entry));
    return entries.length > 0 ? entries[entries.length - 1] : null;
  }
  return null;
}

function formatReasonEntry(entry: unknown): string | null {
  const record = readRecord(entry);
  if (!record) return readString(entry);
  const decision = readString(record.decision);
  const reason = readString(record.reason);
  const source = readString(record.source);
  if (decision && reason) return `${decision}: ${reason}`;
  if (reason) return reason;
  if (decision && source) return `${source}: ${decision}`;
  return decision ?? source;
}

function readReasonChain(metadata: Record<string, unknown>, projection: Record<string, unknown> | null): string[] {
  const raw = projection?.reason_chain ?? metadata.policy_reason_chain ?? metadata.reason_chain;
  return Array.isArray(raw)
    ? raw.map(formatReasonEntry).filter((entry): entry is string => Boolean(entry)).slice(-3)
    : [];
}

function hasEvent(input: RoutingStateInput, eventType: string): boolean {
  return input.activityEventTypes?.includes(eventType) === true;
}

function isUnassigned(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !normalized || normalized === 'unassigned';
}

export function routingToneClass(tone: RoutingStateTone): string {
  switch (tone) {
    case 'ok':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    case 'error':
      return 'border-[var(--error)]/35 bg-[var(--surface-error)] text-[var(--error)]';
    case 'info':
      return 'border-sky-500/25 bg-sky-500/10 text-sky-200';
    case 'muted':
    default:
      return 'border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-muted)]';
  }
}

export function buildRoutingStateView(input: RoutingStateInput): RoutingStateView {
  const metadata = input.metadataRecord ?? {};
  const projection = readRecord(metadata.routing_policy_projection);
  const reasonChain = readReasonChain(metadata, projection);
  const assignmentState = input.assignmentState?.trim().toLowerCase() ?? null;
  const highRiskReasons = readStringList(projection?.high_risk_exclusion_reasons);
  const policyReason = reasonChain.length > 0 ? reasonChain[reasonChain.length - 1] : null;
  const owner = input.ownerPrincipalId?.trim();
  const ownerType = input.ownerPrincipalType?.trim();

  const reassignmentSummary = summarizeAuditValue(metadata.reassignments ?? metadata.taskmaster_reassignment_chain);
  const ownerEscalationSummary = summarizeAuditValue(metadata.owner_escalations);
  const nudgeSummary = summarizeAuditValue(metadata.nudges);
  const claimSummary = summarizeAuditValue(metadata.taskmaster_claim ?? metadata.task_master_claim);

  if (projection?.high_risk_excluded === true) {
    return {
      key: 'excluded',
      label: 'Excluded from routing',
      reason: highRiskReasons.length
        ? `Excluded by policy: ${highRiskReasons.join(', ')}.`
        : policyReason ?? 'Policy excludes Task Master drivability for this task.',
      tone: 'warning',
      reasonChain,
    };
  }

  if (hasEvent(input, 'auto_reassigned') || reassignmentSummary) {
    return {
      key: 'auto_reassigned',
      label: 'Auto-reassigned',
      reason: reassignmentSummary ?? 'Policy-permitted reassignment after exhausted nudge and escalation thresholds.',
      tone: 'ok',
      reasonChain,
    };
  }

  if (hasEvent(input, 'owner_escalated') || ownerEscalationSummary) {
    return {
      key: 'owner_escalated',
      label: 'Owner escalated',
      reason: ownerEscalationSummary ?? 'Assigned work stayed stale after a Task Master nudge.',
      tone: 'warning',
      reasonChain,
    };
  }

  if (hasEvent(input, 'nudge_sent') || nudgeSummary) {
    return {
      key: 'nudged',
      label: 'Nudged',
      reason: nudgeSummary ?? 'Task Master nudged the assignee before any escalation.',
      tone: 'info',
      reasonChain,
    };
  }

  if (assignmentState === 'routing_problem') {
    return {
      key: 'routing_problem',
      label: 'Routing problem',
      reason: policyReason ?? 'Executable work needs an individual assignee/executor or a policy-drivable unassigned state.',
      tone: 'error',
      reasonChain,
    };
  }

  if (assignmentState === 'claimed' || hasEvent(input, 'taskmaster_claimed') || claimSummary) {
    return {
      key: 'claimed',
      label: 'Claimed by Task Master',
      reason: claimSummary ?? 'Task Master is the current executor for policy-drivable work.',
      tone: 'ok',
      reasonChain,
    };
  }

  if (input.taskmasterDrivable && isUnassigned(input.assignee) && !input.executorPrincipalId) {
    return {
      key: 'unassigned_drivable',
      label: 'Unassigned drivable',
      reason: policyReason ?? 'Policy allows Task Master to claim this unassigned work.',
      tone: 'info',
      reasonChain,
    };
  }

  if (!isUnassigned(input.assignee) || input.executorPrincipalId) {
    return {
      key: 'assigned',
      label: 'Assigned',
      reason: owner
        ? `Owner ${owner}${ownerType ? ` (${ownerType})` : ''} remains accountable; Task Master is not the universal executor.`
        : 'Assigned work stays with its assignee unless policy thresholds trigger recovery.',
      tone: 'muted',
      reasonChain,
    };
  }

  return {
    key: 'unknown',
    label: 'Routing unknown',
    reason: policyReason ?? 'Routing policy has not produced a clear state for this task.',
    tone: 'warning',
    reasonChain,
  };
}
