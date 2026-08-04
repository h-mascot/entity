import { describe, expect, it } from 'vitest';
import type { StoredActivityEventSpine, TaskRecord } from '../../db/src';
import {
  adaptActivityEventToSpine,
  adaptSwarmJobToSpine,
  adaptTaskSignalsToSpine,
  adaptTaskSnapshotToSpine,
  mergeStoredAndAdaptedSpineEvents,
} from './activity-event-spine-adapters';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 872,
    org_id: 'org-a',
    team_id: 'team-a',
    project_id: 7,
    created_by_principal_id: 'creator-1',
    initiator_principal_id: 'initiator-1',
    initiator_type: 'human',
    owner_principal_id: 'owner-1',
    owner_principal_type: 'human',
    executor_principal_id: 'agent-1',
    assignment_state: 'assigned',
    taskmaster_drivable: false,
    name: 'Adapter task',
    description: null,
    brief: null,
    origin_channel: null,
    column: 'doing',
    model: null,
    archived: false,
    assignee: 'Ada',
    blocked: false,
    blocker_reason: null,
    due_date: null,
    priority: null,
    estimate_hours: null,
    time_spent: null,
    output: null,
    progress_status: 'in_progress',
    recurring: false,
    recurring_config: null,
    created_at: '2026-07-31T01:00:00.000Z',
    updated_at: '2026-07-31T02:00:00.000Z',
    metadata: null,
    ...overrides,
  };
}

describe('THE-872 / WP1-C-04 activity event spine adapters', () => {
  it('maps fine-grained activity events onto spine types', () => {
    const adapted = adaptActivityEventToSpine(
      {
        id: 11,
        taskId: 872,
        eventType: 'status_changed',
        actorType: 'human',
        actorPrincipalId: 'owner-1',
        action: 'move',
        description: 'Moved to review',
        createdAt: '2026-07-31T03:00:00.000Z',
        payload: { previous_state: 'doing', new_state: 'review' },
      },
      872,
    );
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) throw new Error(adapted.reason);
    expect(adapted.event).toMatchObject({
      adapted: true,
      source: 'activity_event',
      sourceId: 'activity_event:11',
      eventType: 'status',
      taskId: 872,
      actor: { type: 'human', principalId: 'owner-1' },
      payload: {
        summary: 'Moved to review',
        sourceEventType: 'status_changed',
      },
    });
  });

  it('maps proof/receipt and blocker activity types', () => {
    const proof = adaptActivityEventToSpine({
      id: 12,
      task_id: 872,
      activity_event_type: 'receipt_created',
      actor_type: 'system',
      description: 'Receipt written',
      created_at: '2026-07-31T04:00:00.000Z',
      payload: {
        object_refs: [{ object_type: 'receipt', object_id: 'rcpt-1', link_role: 'receipt' }],
      },
    });
    expect(proof.ok).toBe(true);
    if (!proof.ok) throw new Error(proof.reason);
    expect(proof.event.eventType).toBe('proof');
    expect(proof.event.payloadRef).toBe('receipt:rcpt-1');

    const blocker = adaptActivityEventToSpine({
      id: 13,
      taskId: 872,
      eventType: 'completion_blocked',
      description: 'Missing evidence',
      createdAt: '2026-07-31T04:30:00.000Z',
    });
    expect(blocker.ok).toBe(true);
    if (!blocker.ok) throw new Error(blocker.reason);
    expect(blocker.event.eventType).toBe('blocker');
  });

  it('fail-closes on absent/malformed/unknown activity signals', () => {
    expect(adaptActivityEventToSpine(null).ok).toBe(false);
    expect(adaptActivityEventToSpine('nope').ok).toBe(false);
    expect(
      adaptActivityEventToSpine({
        id: 1,
        taskId: 872,
        eventType: 'totally_unknown_signal',
      }).ok,
    ).toBe(false);
    expect(
      adaptActivityEventToSpine({
        id: 2,
        eventType: 'status_changed',
      }).ok,
    ).toBe(false);
    const mismatch = adaptActivityEventToSpine(
      { id: 3, taskId: 999, eventType: 'progress' },
      872,
    );
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) throw new Error('expected mismatch');
    expect(mismatch.warning.code).toBe('adapter_activity_event_task_mismatch');
  });

  it('adapts task snapshot status/progress/proof/blocker without inventing absent fields', () => {
    const rich = adaptTaskSnapshotToSpine(
      makeTask({
        column: 'review',
        progress_status: 'awaiting_review',
        output: 'output/proofs/run.md',
        blocked: true,
        blocker_reason: 'needs human gate',
      }),
    );
    const types = rich.events.map((event) => event.eventType).sort();
    expect(types).toEqual(['blocker', 'progress', 'proof', 'status']);
    expect(rich.events.find((e) => e.eventType === 'proof')?.payloadRef).toBe(
      'output/proofs/run.md',
    );
    expect(rich.events.find((e) => e.eventType === 'blocker')?.payload).toMatchObject({
      blocker_reason: 'needs human gate',
    });

    const bare = adaptTaskSnapshotToSpine(
      makeTask({
        progress_status: null,
        output: null,
        blocked: false,
        blocker_reason: null,
        column: 'todo',
      }),
    );
    expect(bare.events.map((e) => e.eventType)).toEqual(['status']);
    expect(bare.events.some((e) => e.eventType === 'proof')).toBe(false);
    expect(bare.events.some((e) => e.eventType === 'blocker')).toBe(false);
    expect(bare.events.some((e) => e.eventType === 'progress')).toBe(false);
  });

  it('treats blocker_reason without blocked as degraded log, not invented blocker', () => {
    const result = adaptTaskSnapshotToSpine(
      makeTask({
        blocked: false,
        blocker_reason: 'stale note',
        progress_status: null,
        output: null,
      }),
    );
    expect(result.degraded).toBe(true);
    expect(result.warnings.some((w) => w.code === 'adapter_blocker_reason_without_blocked')).toBe(
      true,
    );
    expect(result.events.some((e) => e.eventType === 'blocker')).toBe(false);
    expect(result.events.some((e) => e.eventType === 'log')).toBe(true);
  });

  it('maps swarm job statuses onto progress/proof/status/blocker', () => {
    const running = adaptSwarmJobToSpine(
      {
        id: 'job-1',
        task_id: 872,
        status: 'running',
        provider: 'symphony',
        title: 'Implement adapters',
        feedback: '40%',
        updated_at: '2026-07-31T05:00:00.000Z',
      },
      872,
    );
    expect(running.ok).toBe(true);
    if (!running.ok) throw new Error(running.reason);
    expect(running.event.eventType).toBe('progress');
    expect(running.event.sourceId).toBe('swarm_job:job-1');

    expect(adaptSwarmJobToSpine({ id: 'j2', task_id: 872, status: 'proof' }).ok).toBe(true);
    const proof = adaptSwarmJobToSpine({ id: 'j2', task_id: 872, status: 'proof' });
    if (!proof.ok) throw new Error(proof.reason);
    expect(proof.event.eventType).toBe('proof');

    const failed = adaptSwarmJobToSpine({ id: 'j3', task_id: 872, status: 'failed' });
    if (!failed.ok) throw new Error(failed.reason);
    expect(failed.event.eventType).toBe('blocker');

    const unknown = adaptSwarmJobToSpine({ id: 'j4', task_id: 872, status: 'weird' });
    expect(unknown.ok).toBe(false);
  });

  it('adaptTaskSignalsToSpine is deterministic and idempotent', () => {
    const task = makeTask({
      output: 'docs/proof.md',
      blocked: true,
      blocker_reason: 'wait',
    });
    const activityEvents = [
      {
        id: 21,
        taskId: 872,
        eventType: 'taskmaster_claimed',
        description: 'Claimed',
        createdAt: '2026-07-31T02:30:00.000Z',
        actorType: 'agent',
        actorPrincipalId: 'task-master',
      },
      {
        id: 21,
        taskId: 872,
        eventType: 'taskmaster_claimed',
        description: 'Claimed duplicate',
        createdAt: '2026-07-31T02:30:00.000Z',
      },
      {
        id: 22,
        taskId: 872,
        eventType: 'unknown_future_type',
        description: 'skip me',
        createdAt: '2026-07-31T02:45:00.000Z',
      },
    ];
    const swarmJobs = [
      {
        id: 'swarm-9',
        task_id: 872,
        status: 'done',
        provider: 'acp',
        updated_at: '2026-07-31T06:00:00.000Z',
      },
    ];

    const first = adaptTaskSignalsToSpine({
      taskId: 872,
      task,
      activityEvents,
      swarmJobs,
    });
    const second = adaptTaskSignalsToSpine({
      taskId: 872,
      task,
      activityEvents,
      swarmJobs,
    });

    expect(first.events.map((e) => e.sourceId)).toEqual(second.events.map((e) => e.sourceId));
    expect(first.events.map((e) => e.sequence)).toEqual(second.events.map((e) => e.sequence));
    expect(first.events.filter((e) => e.sourceId === 'activity_event:21')).toHaveLength(1);
    expect(first.warnings.some((w) => w.code === 'adapter_activity_event_unmapped')).toBe(true);
    expect(first.events.some((e) => e.eventType === 'progress')).toBe(true);
    expect(first.events.some((e) => e.eventType === 'status')).toBe(true);
    expect(first.events.some((e) => e.eventType === 'proof')).toBe(true);
    expect(first.events.some((e) => e.eventType === 'blocker')).toBe(true);
  });

  it('surfaces unavailable feeds as degraded without inventing events', () => {
    const result = adaptTaskSignalsToSpine({
      taskId: 872,
      task: null,
      activityEvents: null,
      swarmJobs: null,
    });
    expect(result.events).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(result.warnings.map((w) => w.code).sort()).toEqual([
      'adapter_activity_events_unavailable',
      'adapter_swarm_jobs_unavailable',
      'adapter_task_snapshot_absent',
    ]);
  });

  it('merges stored + adapted with stable ordering and stored preference', () => {
    const stored: StoredActivityEventSpine[] = [
      {
        id: 1,
        taskId: 872,
        eventType: 'plan',
        actor: { type: 'human', principalId: 'owner-1' },
        timestamp: '2026-07-31T01:00:00.000Z',
        payloadRef: null,
        payload: { summary: 'Plan written' },
        sequence: 0,
        createdAt: '2026-07-31T01:00:00.000Z',
      },
    ];
    const adapted = adaptTaskSignalsToSpine({
      taskId: 872,
      task: makeTask({ progress_status: 'working', output: null, blocked: false }),
      activityEvents: [
        {
          id: 50,
          taskId: 872,
          eventType: 'nudge_sent',
          description: 'Nudged',
          createdAt: '2026-07-31T03:00:00.000Z',
          actorType: 'agent',
        },
      ],
      swarmJobs: [],
    });

    const merged = mergeStoredAndAdaptedSpineEvents({
      taskId: 872,
      stored,
      adapted,
    });

    expect(merged.empty).toBe(false);
    expect(merged.storedCount).toBe(1);
    expect(merged.adaptedCount).toBeGreaterThanOrEqual(2);
    expect(merged.events[0]?.eventType).toBe('plan');
    expect(merged.events.map((e) => e.sequence)).toEqual(
      merged.events.map((_, index) => index),
    );

    const again = mergeStoredAndAdaptedSpineEvents({
      taskId: 872,
      stored,
      adapted,
    });
    expect(again.events.map((e) => ('sourceId' in e ? e.sourceId : `spine:${e.id}`))).toEqual(
      merged.events.map((e) => ('sourceId' in e ? e.sourceId : `spine:${e.id}`)),
    );
  });
});
