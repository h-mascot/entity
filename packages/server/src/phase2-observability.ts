export type Phase2ObservedState = 'healthy' | 'degraded' | 'failed' | 'unknown';
export type Phase2MetricUnit = 'count' | 'milliseconds';
export type Phase2ObservabilityComponent =
  | 'receipts'
  | 'review_gates'
  | 'search'
  | 'integrations'
  | 'notifications'
  | 'migration';

export interface Phase2Metric {
  name: string;
  value: number;
  unit: Phase2MetricUnit;
  tags?: Record<string, string>;
}

export interface Phase2ComponentHealth {
  component: Phase2ObservabilityComponent;
  state: Phase2ObservedState;
  reason: string;
  metrics: Phase2Metric[];
}

export interface Phase2IntegrationObservation {
  state?: Phase2ObservedState;
  reason?: string;
}

export interface Phase2ObservabilityInput {
  receipts?: {
    writeFailures?: number;
    integrityErrors?: number;
    missingEvidence?: number;
    generationLatencyMs?: number;
  };
  reviewGates?: {
    pendingReviews?: number;
    pendingHumanGates?: number;
    selfReviewBlocks?: number;
    policyResolutionFailures?: number;
  };
  search?: {
    indexLagMs?: number;
    queryErrors?: number;
    permissionDenials?: number;
    restrictedSnippetSuppressions?: number;
  };
  integrations?: {
    helm?: Phase2IntegrationObservation;
    clickclack?: Phase2IntegrationObservation;
    google?: Phase2IntegrationObservation;
  };
  notifications?: {
    deliveryFailures?: number;
    degradedDeliveries?: number;
  };
  migration?: {
    unresolvedWarnings?: number;
    oldTasksMissingReceipts?: number;
    warningsByType?: Record<string, number>;
  };
}

export interface Phase2DiagnosticLogInput {
  requestId?: string | null;
  orgId?: string | null;
  component: Phase2ObservabilityComponent;
  event: string;
  state: Phase2ObservedState;
  reason?: string | null;
  counts?: Record<string, number | undefined>;
  context?: Record<string, unknown>;
}

export interface Phase2DiagnosticLogEvent {
  event: string;
  component: Phase2ObservabilityComponent;
  state: Phase2ObservedState;
  reason: string;
  request_id: string | null;
  org_id: string | null;
  counts: Record<string, number>;
}

export interface Phase2ObservabilityDiagnostics {
  profile: 'phase2-release-observability';
  generated_at: string;
  overall_state: Phase2ObservedState;
  components: Record<Phase2ObservabilityComponent, Phase2ComponentHealth>;
  metrics: Phase2Metric[];
  diagnostic_log_events: Phase2DiagnosticLogEvent[];
  safe_logging: {
    allowed_context_fields: ['request_id', 'org_id', 'component', 'event', 'state', 'reason', 'counts'];
    sensitive_fields_redacted: true;
    content_logging_allowed: false;
  };
}

const SEARCH_INDEX_LAG_DEGRADED_MS = 5 * 60 * 1000;
const SENSITIVE_KEY_PATTERN = /(secret|token|api[-_]?key|authorization|password|credential|content|snippet|body|raw|metadata)/i;

function count(value: number | undefined): number {
  return Number.isFinite(value) && typeof value === 'number' && value > 0 ? value : 0;
}

function metric(name: string, value: number, unit: Phase2MetricUnit, tags?: Record<string, string>): Phase2Metric {
  return tags ? { name, value, unit, tags } : { name, value, unit };
}

function sanitizeText(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  const trimmed = value.trim();
  if (SENSITIVE_KEY_PATTERN.test(trimmed)) {
    return 'redacted_sensitive_reason';
  }
  return trimmed.slice(0, 160);
}

function observed<T extends object>(value: T | undefined): value is T {
  return Boolean(value && Object.keys(value).length > 0);
}

function component(
  componentName: Phase2ObservabilityComponent,
  state: Phase2ObservedState,
  reason: string,
  metrics: Phase2Metric[],
): Phase2ComponentHealth {
  return { component: componentName, state, reason, metrics };
}

function aggregateState(states: Phase2ObservedState[]): Phase2ObservedState {
  if (states.includes('failed')) return 'failed';
  if (states.includes('degraded')) return 'degraded';
  if (states.every((state) => state === 'healthy')) return 'healthy';
  return 'unknown';
}

function buildReceiptHealth(input: Phase2ObservabilityInput['receipts']): Phase2ComponentHealth {
  const writeFailures = count(input?.writeFailures);
  const integrityErrors = count(input?.integrityErrors);
  const missingEvidence = count(input?.missingEvidence);
  const latency = count(input?.generationLatencyMs);
  const metrics = [
    metric('phase2_receipt_write_failures_total', writeFailures, 'count'),
    metric('phase2_receipt_integrity_errors_total', integrityErrors, 'count'),
    metric('phase2_receipt_missing_evidence_total', missingEvidence, 'count'),
    metric('phase2_receipt_generation_latency_ms', latency, 'milliseconds'),
  ];
  if (!observed(input)) return component('receipts', 'unknown', 'receipt_observability_not_connected', metrics);
  if (writeFailures > 0 || integrityErrors > 0) return component('receipts', 'failed', 'receipt_failure_or_integrity_error', metrics);
  if (missingEvidence > 0) return component('receipts', 'degraded', 'receipt_missing_evidence', metrics);
  return component('receipts', 'healthy', 'receipt_observability_clean', metrics);
}

function buildReviewGateHealth(input: Phase2ObservabilityInput['reviewGates']): Phase2ComponentHealth {
  const pendingReviews = count(input?.pendingReviews);
  const pendingHumanGates = count(input?.pendingHumanGates);
  const selfReviewBlocks = count(input?.selfReviewBlocks);
  const policyFailures = count(input?.policyResolutionFailures);
  const metrics = [
    metric('phase2_review_pending_total', pendingReviews, 'count'),
    metric('phase2_human_gate_pending_total', pendingHumanGates, 'count'),
    metric('phase2_self_review_blocks_total', selfReviewBlocks, 'count'),
    metric('phase2_policy_resolution_failures_total', policyFailures, 'count'),
  ];
  if (!observed(input)) return component('review_gates', 'unknown', 'review_gate_observability_not_connected', metrics);
  if (policyFailures > 0) return component('review_gates', 'failed', 'policy_resolution_failure', metrics);
  if (pendingReviews > 0 || pendingHumanGates > 0 || selfReviewBlocks > 0) {
    return component('review_gates', 'degraded', 'review_or_gate_queue_requires_attention', metrics);
  }
  return component('review_gates', 'healthy', 'review_gate_observability_clean', metrics);
}

function buildSearchHealth(input: Phase2ObservabilityInput['search']): Phase2ComponentHealth {
  const indexLagMs = count(input?.indexLagMs);
  const queryErrors = count(input?.queryErrors);
  const permissionDenials = count(input?.permissionDenials);
  const suppressions = count(input?.restrictedSnippetSuppressions);
  const metrics = [
    metric('phase2_search_index_lag_ms', indexLagMs, 'milliseconds'),
    metric('phase2_search_query_errors_total', queryErrors, 'count'),
    metric('phase2_search_permission_denials_total', permissionDenials, 'count'),
    metric('phase2_search_restricted_snippet_suppressions_total', suppressions, 'count'),
  ];
  if (!observed(input)) return component('search', 'unknown', 'search_observability_not_connected', metrics);
  if (queryErrors > 0) return component('search', 'failed', 'search_query_errors', metrics);
  if (indexLagMs > SEARCH_INDEX_LAG_DEGRADED_MS) return component('search', 'degraded', 'search_index_lag_degraded', metrics);
  return component('search', 'healthy', 'search_observability_clean', metrics);
}

function buildIntegrationHealth(input: Phase2ObservabilityInput['integrations']): Phase2ComponentHealth {
  const observations = {
    helm: input?.helm?.state ?? 'unknown',
    clickclack: input?.clickclack?.state ?? 'unknown',
    google: input?.google?.state ?? 'unknown',
  } satisfies Record<string, Phase2ObservedState>;
  const metrics = Object.entries(observations).map(([name, state]) =>
    metric('phase2_integration_state', state === 'healthy' ? 1 : 0, 'count', { integration: name, state }),
  );
  if (!observed(input)) return component('integrations', 'unknown', 'integration_observability_not_connected', metrics);
  const state = aggregateState(Object.values(observations));
  const reasons = [
    sanitizeText(input?.helm?.reason, observations.helm === 'healthy' ? '' : 'helm_unknown'),
    sanitizeText(input?.clickclack?.reason, observations.clickclack === 'healthy' ? '' : 'clickclack_unknown'),
    sanitizeText(input?.google?.reason, observations.google === 'healthy' ? '' : 'google_unknown'),
  ].filter((reason) => reason && reason !== 'redacted_sensitive_reason');
  return component('integrations', state, reasons[0] ?? `integrations_${state}`, metrics);
}

function buildNotificationHealth(input: Phase2ObservabilityInput['notifications']): Phase2ComponentHealth {
  const failures = count(input?.deliveryFailures);
  const degraded = count(input?.degradedDeliveries);
  const metrics = [
    metric('phase2_notification_delivery_failures_total', failures, 'count'),
    metric('phase2_notification_degraded_deliveries_total', degraded, 'count'),
  ];
  if (!observed(input)) return component('notifications', 'unknown', 'notification_observability_not_connected', metrics);
  if (failures > 0) return component('notifications', 'failed', 'notification_delivery_failure', metrics);
  if (degraded > 0) return component('notifications', 'degraded', 'notification_delivery_degraded', metrics);
  return component('notifications', 'healthy', 'notification_observability_clean', metrics);
}

function buildMigrationHealth(input: Phase2ObservabilityInput['migration']): Phase2ComponentHealth {
  const unresolved = count(input?.unresolvedWarnings);
  const missingReceipts = count(input?.oldTasksMissingReceipts);
  const warningMetrics = Object.entries(input?.warningsByType ?? {}).map(([warningType, value]) =>
    metric('phase2_migration_warnings_total', count(value), 'count', { warning_type: warningType }),
  );
  const metrics = [
    metric('phase2_migration_unresolved_warnings_total', unresolved, 'count'),
    metric('phase2_migration_old_tasks_missing_receipts_total', missingReceipts, 'count'),
    ...warningMetrics,
  ];
  if (!observed(input)) return component('migration', 'unknown', 'migration_observability_not_connected', metrics);
  if (unresolved > 0 || missingReceipts > 0 || warningMetrics.some((entry) => entry.value > 0)) {
    return component('migration', 'degraded', 'migration_warnings_present', metrics);
  }
  return component('migration', 'healthy', 'migration_observability_clean', metrics);
}

export function buildPhase2DiagnosticLogEvent(input: Phase2DiagnosticLogInput): Phase2DiagnosticLogEvent {
  const counts = Object.fromEntries(
    Object.entries(input.counts ?? {}).filter(([, value]) => Number.isFinite(value)).map(([key, value]) => [key, count(value)]),
  );
  return {
    event: sanitizeText(input.event, 'phase2_observability_event'),
    component: input.component,
    state: input.state,
    reason: sanitizeText(input.reason, `${input.component}_${input.state}`),
    request_id: typeof input.requestId === 'string' && input.requestId.trim() ? input.requestId.trim().slice(0, 80) : null,
    org_id: typeof input.orgId === 'string' && input.orgId.trim() ? input.orgId.trim().slice(0, 80) : null,
    counts,
  };
}

export function buildPhase2ObservabilityDiagnostics(
  input: Phase2ObservabilityInput = {},
  now: Date = new Date(),
): Phase2ObservabilityDiagnostics {
  const componentList = [
    buildReceiptHealth(input.receipts),
    buildReviewGateHealth(input.reviewGates),
    buildSearchHealth(input.search),
    buildIntegrationHealth(input.integrations),
    buildNotificationHealth(input.notifications),
    buildMigrationHealth(input.migration),
  ];
  const components = Object.fromEntries(
    componentList.map((entry) => [entry.component, entry]),
  ) as Record<Phase2ObservabilityComponent, Phase2ComponentHealth>;
  const metrics = componentList.flatMap((entry) => entry.metrics);
  const diagnosticLogEvents = componentList
    .filter((entry) => entry.state === 'degraded' || entry.state === 'failed')
    .map((entry) => buildPhase2DiagnosticLogEvent({
      component: entry.component,
      event: 'phase2_observability_state',
      state: entry.state,
      reason: entry.reason,
      counts: Object.fromEntries(entry.metrics.filter((item) => item.unit === 'count').map((item) => [item.name, item.value])),
    }));

  return {
    profile: 'phase2-release-observability',
    generated_at: now.toISOString(),
    overall_state: aggregateState(componentList.map((entry) => entry.state)),
    components,
    metrics,
    diagnostic_log_events: diagnosticLogEvents,
    safe_logging: {
      allowed_context_fields: ['request_id', 'org_id', 'component', 'event', 'state', 'reason', 'counts'],
      sensitive_fields_redacted: true,
      content_logging_allowed: false,
    },
  };
}
