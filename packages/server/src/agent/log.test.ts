import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  traceClassifiedProviderFault,
  writeBridgeReadinessTelemetry,
} from './log';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agent/log provider telemetry seam (T-035 / R-038)', () => {
  it('emits structured bridge-readiness telemetry with no secret/document content', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const event = writeBridgeReadinessTelemetry({
      provider: 'local_office',
      artifact_type: 'document',
      operation: 'read',
      outcome: 'success',
      bridge_ready: true,
      reconciliation_lag_ms: 1200,
    });

    expect(event).toMatchObject({
      provider: 'local_office',
      artifact_type: 'document',
      operation: 'read',
      outcome: 'success',
      bridge_ready: true,
      reconciliation_lag_ms: 1200,
    });
    const serialized = JSON.stringify(info.mock.calls.map((call) => call[1]));
    expect(serialized).toContain('bridge_ready');
    expect(serialized).toContain('true');
    expect(serialized).not.toMatch(/token|secret|[/\\]Users[/\\]enterprise/i);
  });

  it('classifies stale revision as conflict (not transient) through the shutdown trace seam', () => {
    const result = traceClassifiedProviderFault({ isStaleRevision: true, retryCount: 1 });
    expect(result.classification).toBe('conflict');
    expect(result.retryable).toBe(false);
  });
});
