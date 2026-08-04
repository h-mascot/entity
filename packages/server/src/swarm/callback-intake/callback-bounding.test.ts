/**
 * THE-932 — Sanitize/bound externally supplied callback event detail/timestamps.
 */
import { describe, expect, it } from 'vitest';
import { parseCallbackPayloadShape } from './validate';

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    event: 'progress',
    provider: 'symphony',
    jobId: 'job-1',
    summary: 'ok',
    ...overrides,
  };
}

describe('parseCallbackPayloadShape — bound event detail (THE-932)', () => {
  it('rejects an oversized summary with detail_too_long', () => {
    const result = parseCallbackPayloadShape(basePayload({ summary: 'summary chunk '.repeat(4000) }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'detail_too_long')).toBe(true);
    }
  });

  it('rejects an oversized blocker reason', () => {
    const result = parseCallbackPayloadShape({
      event: 'blocker',
      provider: 'symphony',
      jobId: 'job-1',
      summary: 'blocked',
      reason: 'reason chunk '.repeat(2000),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'detail_too_long')).toBe(true);
    }
  });

  it('accepts a reasonably-sized summary', () => {
    const result = parseCallbackPayloadShape(basePayload({ summary: 'ship is progressing' }));
    expect(result.ok).toBe(true);
  });
});

describe('parseCallbackPayloadShape — validate occurredAt (THE-932)', () => {
  it('rejects an unparseable occurredAt', () => {
    const result = parseCallbackPayloadShape(basePayload({ occurredAt: 'not-a-date' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'invalid_occurred_at')).toBe(true);
    }
  });

  it('rejects a far-future occurredAt', () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const result = parseCallbackPayloadShape(basePayload({ occurredAt: future }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'invalid_occurred_at')).toBe(true);
    }
  });

  it('accepts a recent valid ISO occurredAt', () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const result = parseCallbackPayloadShape(basePayload({ occurredAt: recent }));
    expect(result.ok).toBe(true);
  });

  it('still accepts a payload with no occurredAt (optional field)', () => {
    const result = parseCallbackPayloadShape(basePayload());
    expect(result.ok).toBe(true);
  });
});
