import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_EVENT_SPINE_TYPES,
  classifyActivityEventToSpineType,
  compareActivityEventSpineOrder,
  isActivityEventSpineType,
  normalizeActivityEventSpine,
  normalizeActivityEventSpineType,
} from './activity-event-spine';

describe('THE-869 / WP1-C-01 ActivityEvent spine types', () => {
  it('defines exactly plan, progress, log, proof, status, blocker in stable order', () => {
    expect(ACTIVITY_EVENT_SPINE_TYPES).toEqual([
      'plan',
      'progress',
      'log',
      'proof',
      'status',
      'blocker',
    ]);
  });

  it('accepts spine types and rejects unknown/empty/non-string values', () => {
    expect(isActivityEventSpineType('plan')).toBe(true);
    expect(isActivityEventSpineType(' Progress ')).toBe(true);
    expect(isActivityEventSpineType('status_changed')).toBe(false);
    expect(isActivityEventSpineType('task_blocked')).toBe(false);
    expect(isActivityEventSpineType('')).toBe(false);
    expect(isActivityEventSpineType(null)).toBe(false);
    expect(normalizeActivityEventSpineType('BLOCKER')).toBe('blocker');
    expect(normalizeActivityEventSpineType('nope')).toBeNull();
    expect(normalizeActivityEventSpineType(1)).toBeNull();
  });

  it('classifies fine-grained ActivityEvent types onto the spine without inventing mappings', () => {
    expect(classifyActivityEventToSpineType('plan')).toBe('plan');
    expect(classifyActivityEventToSpineType('taskmaster_claimed')).toBe('progress');
    expect(classifyActivityEventToSpineType('notification_routed')).toBe('log');
    expect(classifyActivityEventToSpineType('receipt_created')).toBe('proof');
    expect(classifyActivityEventToSpineType('status_changed')).toBe('status');
    expect(classifyActivityEventToSpineType('task_blocked')).toBe('blocker');
    expect(classifyActivityEventToSpineType('completion_blocked')).toBe('blocker');
    expect(classifyActivityEventToSpineType('totally_unknown')).toBeNull();
    expect(classifyActivityEventToSpineType('')).toBeNull();
    expect(classifyActivityEventToSpineType(undefined)).toBeNull();
  });

  it('normalizes a valid spine event and preserves payload/ref/sequence', () => {
    const result = normalizeActivityEventSpine({
      task_id: 42,
      event_type: 'progress',
      actor: { type: 'agent', principal_id: 'ada' },
      created_at: '2026-07-31T01:00:00.000Z',
      payload_ref: 'artifact:proof-1',
      payload: { message: 'halfway' },
      sequence: 3,
    });

    expect(result).toEqual({
      ok: true,
      event: {
        taskId: 42,
        eventType: 'progress',
        actor: { type: 'agent', principalId: 'ada' },
        timestamp: '2026-07-31T01:00:00.000Z',
        payloadRef: 'artifact:proof-1',
        payload: { message: 'halfway' },
        sequence: 3,
      },
    });
  });

  it('returns explicit degraded results for missing task id, type, or sequence', () => {
    expect(normalizeActivityEventSpine(null)).toMatchObject({
      ok: false,
      reason: 'payload_not_object',
      degraded: true,
    });
    expect(
      normalizeActivityEventSpine({ event_type: 'plan', sequence: 0 }),
    ).toMatchObject({
      ok: false,
      reason: 'missing_or_invalid_task_id',
      degraded: true,
    });
    expect(
      normalizeActivityEventSpine({ task_id: 1, event_type: 'mystery', sequence: 0 }),
    ).toMatchObject({
      ok: false,
      reason: 'unknown_or_missing_event_type',
      degraded: true,
    });
    expect(
      normalizeActivityEventSpine({ task_id: 1, event_type: 'log' }),
    ).toMatchObject({
      ok: false,
      reason: 'missing_or_invalid_sequence',
      degraded: true,
    });
    expect(
      normalizeActivityEventSpine({ task_id: 0, event_type: 'status', sequence: 1 }),
    ).toMatchObject({
      ok: false,
      reason: 'missing_or_invalid_task_id',
      degraded: true,
    });
  });

  it('orders spine events by sequence then timestamp (proof/status order stable)', () => {
    const events = [
      { sequence: 2, timestamp: '2026-07-31T02:00:00.000Z', eventType: 'status' as const },
      { sequence: 1, timestamp: '2026-07-31T03:00:00.000Z', eventType: 'proof' as const },
      { sequence: 2, timestamp: '2026-07-31T01:00:00.000Z', eventType: 'blocker' as const },
    ];
    const sorted = [...events].sort(compareActivityEventSpineOrder);
    expect(sorted.map((event) => event.eventType)).toEqual(['proof', 'blocker', 'status']);
  });

  it('defaults unknown actor types to unknown without inventing principal ids', () => {
    const result = normalizeActivityEventSpine({
      taskId: 7,
      eventType: 'blocker',
      actorType: 'robot',
      sequence: 0,
      payload: ['not-an-object'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.event.actor).toEqual({ type: 'unknown' });
    expect(result.event.payload).toEqual({});
    expect(result.event.payloadRef).toBeNull();
    expect(result.event.timestamp).toBe('');
  });
});
