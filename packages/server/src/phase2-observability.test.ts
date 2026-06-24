import { describe, expect, it } from 'vitest';
import {
  buildPhase2DiagnosticLogEvent,
  buildPhase2ObservabilityDiagnostics,
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
