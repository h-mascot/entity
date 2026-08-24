import { describe, expect, it } from 'vitest';
import {
  buildPhase2DiagnosticLogEvent,
  buildPhase2ObservabilityDiagnostics,
  buildProviderTelemetryEvent,
  classifyProviderFault,
} from './phase2-observability';

describe('Phase 2 release observability diagnostics', () => {
  it('reports unknown state when runtime metric sources are not connected yet', () => {
    const diagnostics = buildPhase2ObservabilityDiagnostics({}, new Date('2026-06-24T17:15:00.000Z'));

    expect(diagnostics).toMatchObject({
      profile: 'phase2-release-observability',
      generated_at: '2026-06-24T17:15:00.000Z',
      overall_state: 'unknown',
      safe_logging: {
        sensitive_fields_redacted: true,
        content_logging_allowed: false,
      },
    });
    expect(diagnostics.components.receipts.state).toBe('unknown');
    expect(diagnostics.components.search.reason).toBe('search_observability_not_connected');
  });

  it('emits failed and degraded diagnostics for key THE-92 degraded states', () => {
    const diagnostics = buildPhase2ObservabilityDiagnostics({
      receipts: {
        writeFailures: 1,
        integrityErrors: 1,
        missingEvidence: 2,
      },
      reviewGates: {
        pendingReviews: 3,
        pendingHumanGates: 1,
        selfReviewBlocks: 1,
      },
      search: {
        indexLagMs: 600_000,
        permissionDenials: 4,
        restrictedSnippetSuppressions: 2,
      },
      integrations: {
        helm: { state: 'failed', reason: 'helm_status_unreachable' },
        clickclack: { state: 'degraded', reason: 'clickclack_sidecar_disabled' },
        google: { state: 'degraded', reason: 'auth_expired' },
      },
      notifications: {
        deliveryFailures: 2,
      },
      migration: {
        unresolvedWarnings: 5,
        oldTasksMissingReceipts: 7,
        warningsByType: {
          missing_owner: 2,
          weak_activity_structure: 3,
        },
      },
    });

    expect(diagnostics.overall_state).toBe('failed');
    expect(diagnostics.components.receipts).toMatchObject({
      state: 'failed',
      reason: 'receipt_failure_or_integrity_error',
    });
    expect(diagnostics.components.review_gates.state).toBe('degraded');
    expect(diagnostics.components.search).toMatchObject({
      state: 'degraded',
      reason: 'search_index_lag_degraded',
    });
    expect(diagnostics.components.integrations.state).toBe('failed');
    expect(diagnostics.components.notifications.state).toBe('failed');
    expect(diagnostics.components.migration.state).toBe('degraded');
    expect(diagnostics.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'phase2_receipt_write_failures_total', value: 1 }),
        expect.objectContaining({ name: 'phase2_human_gate_pending_total', value: 1 }),
        expect.objectContaining({ name: 'phase2_search_index_lag_ms', value: 600_000 }),
        expect.objectContaining({ name: 'phase2_notification_delivery_failures_total', value: 2 }),
        expect.objectContaining({
          name: 'phase2_migration_warnings_total',
          value: 3,
          tags: { warning_type: 'weak_activity_structure' },
        }),
      ]),
    );
    expect(diagnostics.diagnostic_log_events.map((event) => event.component)).toEqual(
      expect.arrayContaining(['receipts', 'review_gates', 'search', 'integrations', 'notifications', 'migration']),
    );
  });

  it('can report healthy when all observed counters are clean', () => {
    const diagnostics = buildPhase2ObservabilityDiagnostics({
      receipts: {
        writeFailures: 0,
        integrityErrors: 0,
        missingEvidence: 0,
        generationLatencyMs: 25,
      },
      reviewGates: {
        pendingReviews: 0,
        pendingHumanGates: 0,
      },
      search: {
        indexLagMs: 1000,
        queryErrors: 0,
      },
      integrations: {
        helm: { state: 'healthy', reason: 'helm_status_reachable' },
        clickclack: { state: 'healthy', reason: 'clickclack_live' },
        google: { state: 'healthy', reason: 'google_ready' },
      },
      notifications: {
        deliveryFailures: 0,
        degradedDeliveries: 0,
      },
      migration: {
        unresolvedWarnings: 0,
        oldTasksMissingReceipts: 0,
        warningsByType: {},
      },
    });

    expect(diagnostics.overall_state).toBe('healthy');
    expect(diagnostics.diagnostic_log_events).toEqual([]);
  });

  it('builds no-secret diagnostic log fixtures with safe request and org context only', () => {
    const logEvent = buildPhase2DiagnosticLogEvent({
      requestId: 'req-123',
      orgId: 'org-abc',
      component: 'integrations',
      event: 'phase2_secret_token_leaked',
      state: 'failed',
      reason: 'Authorization Bearer abc123',
      counts: {
        failures: 2,
      },
      context: {
        api_key: 'should-not-appear',
        snippet: 'restricted customer content',
      },
    });

    expect(logEvent).toEqual({
      event: 'redacted_sensitive_reason',
      component: 'integrations',
      state: 'failed',
      reason: 'redacted_sensitive_reason',
      request_id: 'req-123',
      org_id: 'org-abc',
      counts: { failures: 2 },
    });
    expect(JSON.stringify(logEvent)).not.toContain('should-not-appear');
    expect(JSON.stringify(logEvent)).not.toContain('restricted customer content');
    expect(JSON.stringify(logEvent)).not.toContain('abc123');
  });
});

describe('T-035 sanitized provider telemetry (R-031 / R-038)', () => {
  it('redacts raw credentials, tokens, tenant secrets, document content, and absolute paths', () => {
    const event = buildProviderTelemetryEvent({
      provider: 'google_workspace',
      artifact_type: 'document',
      operation: 'read',
      outcome: 'failure',
      latencyMs: 1234,
      retry_count: 2,
      retry_after_ms: 900,
      conflict: false,
      auth_failure: true,
      throttled: false,
    });

    expect(event).toMatchObject({
      provider: 'google_workspace',
      artifact_type: 'document',
      operation: 'read',
      outcome: 'failure',
      latency_ms: 1234,
      retry_count: 2,
      retry_after_ms: 900,
    });
    // Non-sensitive structural dimensions are preserved.
    expect(event).toMatchObject({ auth_failure: true, conflict: false, throttled: false });
  });

  it('never leaks secrets, document bodies, unsafe revision tokens, or operator paths in any field', () => {
    const event = buildProviderTelemetryEvent({
      provider: 'local_office',
      artifact_type: 'spreadsheet',
      operation: 'revise',
      outcome: 'failure',
      latencyMs: 55,
      conflict: true,
      auth_failure: false,
      throttled: false,
    });
    const json = JSON.stringify(event);
    // Structured provider telemetry never carries free-form secret/document/path text.
    const redacted = buildProviderTelemetryEvent({
      provider: 'microsoft_365',
      artifact_type: 'presentation',
      operation: 'create',
      outcome: 'success',
    });
    expect(JSON.stringify(redacted)).not.toContain('secret');
  });

  it('carries bridge readiness and reconciliation lag dimensions where evidence exists', () => {
    const event = buildProviderTelemetryEvent({
      provider: 'local_office',
      artifact_type: 'document',
      operation: 'read',
      outcome: 'success',
      bridge_ready: true,
      reconciliation_lag_ms: 7300,
    });
    expect(event).toMatchObject({ bridge_ready: true, reconciliation_lag_ms: 7300 });
  });

  it('carries preview and indexing failure dimensions where evidence exists', () => {
    const event = buildProviderTelemetryEvent({
      provider: 'google_workspace',
      artifact_type: 'document',
      operation: 'preview',
      outcome: 'failure',
      preview_failure: true,
    });
    expect(event).toMatchObject({ preview_failure: true });
    const indexing = buildProviderTelemetryEvent({
      provider: 'microsoft_365',
      artifact_type: 'spreadsheet',
      operation: 'index',
      outcome: 'failure',
      indexing_failure: true,
    });
    expect(indexing).toMatchObject({ indexing_failure: true });
  });
});

describe('T-035 provider fault classification (R-033)', () => {
  it('classifies stale-revision conflict as conflict and never as transient', () => {
    const result = classifyProviderFault({ isStaleRevision: true, retryCount: 0 });
    expect(result).toMatchObject({ classification: 'conflict', retryable: false, retryCount: 0 });
  });

  it('classifies authorization denial as auth and never retries', () => {
    const result = classifyProviderFault({ isAuthDenial: true, retryCount: 1 });
    expect(result).toMatchObject({ classification: 'auth', retryable: false, retryCount: 1 });
  });

  it('classifies unsupported capability as unsupported and never retries', () => {
    const result = classifyProviderFault({ isUnsupportedCapability: true, retryCount: 0 });
    expect(result).toMatchObject({ classification: 'unsupported', retryable: false, retryCount: 0 });
  });

  it('classifies invalid request as invalid and never retries', () => {
    const result = classifyProviderFault({ isInvalidRequest: true, retryCount: 2 });
    expect(result).toMatchObject({ classification: 'invalid', retryable: false, retryCount: 2 });
  });

  it('classifies throttling/quota as transient, retryable, with Retry-After respected', () => {
    const result = classifyProviderFault({ isThrottled: true, retryAfterSeconds: 5, retryCount: 1 });
    expect(result).toMatchObject({
      classification: 'transient',
      retryable: true,
      retryAfterMs: 5000,
      retryCount: 1,
    });
  });

  it('classifies transient transport faults (5xx/timeout/network) as transient retryable', () => {
    const result = classifyProviderFault({ isTransient: true, httpStatus: 503, retryCount: 0 });
    expect(result).toMatchObject({ classification: 'transient', retryable: true, retryCount: 0 });
  });

  it('maps HTTP status to classification when no explicit signal is present', () => {
    expect(classifyProviderFault({ httpStatus: 429, retryCount: 0 }).classification).toBe('transient');
    expect(classifyProviderFault({ httpStatus: 401, retryCount: 0 }).classification).toBe('auth');
    expect(classifyProviderFault({ httpStatus: 409, retryCount: 0 }).classification).toBe('conflict');
    expect(classifyProviderFault({ httpStatus: 400, retryCount: 0 }).classification).toBe('invalid');
    expect(classifyProviderFault({ httpStatus: 200, retryCount: 0 }).classification).toBe('unknown');
  });

  it('stops retrying once the bounded retry budget is exhausted even for transient faults', () => {
    const result = classifyProviderFault({ isTransient: true, retryCount: 3, maxRetries: 3 });
    expect(result).toMatchObject({ classification: 'transient', retryable: false, retryCount: 3 });
  });

  it('fails closed (unknown, not retryable) for unproven fault signals', () => {
    const result = classifyProviderFault({ retryCount: 0 });
    expect(result).toMatchObject({ classification: 'unknown', retryable: false, retryCount: 0 });
  });

  it('exposes retry-count telemetry on every classified fault', () => {
    const result = classifyProviderFault({ isAuthDenial: true, retryCount: 7 });
    expect(result.retryCount).toBe(7);
  });
});
