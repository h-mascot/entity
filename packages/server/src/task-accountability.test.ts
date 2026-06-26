import { describe, expect, it } from 'vitest';
import {
  buildOwnerAccountabilityInbox,
  parseTaskAccountabilityForCreate,
  parseTaskAccountabilityUpdates,
  validateTaskAccountability,
} from './task-accountability';
import type { TaskRecord } from '../../db/src';

describe('task accountability validation', () => {
  it('requires initiator and owner for new tasks', () => {
    expect(parseTaskAccountabilityForCreate({ owner_principal_id: 'user-1' }, 'creator')).toEqual({
      error: 'Task initiator required',
      message: 'New tasks require initiator_principal_id.',
    });

    expect(parseTaskAccountabilityForCreate({ initiator_principal_id: 'user-1' }, 'creator')).toEqual({
      error: 'Task owner required',
      message: 'New tasks require an individual owner_principal_id.',
    });
  });

  it('rejects team ownership as final task owner', () => {
    expect(
      parseTaskAccountabilityForCreate(
        {
          initiator_principal_id: 'user-1',
          owner_principal_id: 'team-sales',
          owner_principal_type: 'team',
        },
        'creator',
      ),
    ).toEqual({
      error: 'Task owner must be an individual principal',
      message: 'Team ownership is not allowed as final task ownership.',
    });

    expect(
      validateTaskAccountability({
        column: 'todo',
        assignee: 'Ada',
        owner_principal_type: 'team_queue',
      }),
    ).toEqual({
      ok: false,
      error: 'Task owner must be an individual principal',
      message: 'Team ownership is not allowed as final task ownership.',
    });
  });

  it('requires active executable work to have assignee, executor, or Task-Master-drivable state', () => {
    expect(
      validateTaskAccountability({
        column: 'doing',
        assignee: 'Unassigned',
        owner_principal_type: 'human',
      }),
    ).toEqual({
      ok: false,
      error: 'Executable task requires assignee or executor',
      message:
        'Todo, Doing, and Review tasks require an individual assignee/executor or explicit Task-Master-drivable unassigned state.',
    });

    expect(
      validateTaskAccountability({
        column: 'doing',
        assignee: 'Unassigned',
        executor_principal_id: 'agent-1',
        owner_principal_type: 'human',
      }),
    ).toEqual({ ok: true });

    expect(
      validateTaskAccountability({
        column: 'review',
        assignee: 'Unassigned',
        taskmaster_drivable: true,
        owner_principal_type: 'human',
      }),
    ).toEqual({ ok: true });
  });

  it('normalizes accepted create and update accountability fields', () => {
    expect(
      parseTaskAccountabilityForCreate(
        {
          initiatorPrincipalId: ' requester ',
          initiatorType: 'Workflow',
          ownerPrincipalId: ' owner ',
          executorPrincipalId: ' agent-1 ',
          taskmasterDrivable: 'true',
        },
        'creator',
      ),
    ).toEqual({
      created_by_principal_id: 'creator',
      initiator_principal_id: 'requester',
      initiator_type: 'workflow',
      owner_principal_id: 'owner',
      owner_principal_type: 'human',
      executor_principal_id: 'agent-1',
      taskmaster_drivable: true,
      assignment_state: undefined,
    });

    expect(
      parseTaskAccountabilityUpdates({
        ownerPrincipalType: 'agent',
        executor_principal_id: 'agent-2',
        taskmaster_drivable: false,
      }),
    ).toEqual({
      owner_principal_type: 'agent',
      executor_principal_id: 'agent-2',
      taskmaster_drivable: false,
    });
  });

  it('groups owner-accountable stalled, review, gate, receipt, escalation, and migration tasks', () => {
    const baseTask: TaskRecord = {
      id: 1,
      owner_principal_id: 'owner-1',
      owner_principal_type: 'human',
      name: 'Base',
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
      priority: 'P1',
      estimate_hours: null,
      time_spent: null,
      output: null,
      progress_status: null,
      recurring: false,
      recurring_config: null,
      created_at: '2026-06-22T00:00:00.000Z',
      updated_at: '2026-06-22T00:00:00.000Z',
      metadata: null,
      taskmaster_drivable: false,
      review_required: false,
      review_state: 'not_required',
      human_gate_required: false,
      human_gate_state: 'not_required',
    };

    const inbox = buildOwnerAccountabilityInbox({
      ownerPrincipalId: 'owner-1',
      now: new Date('2026-06-24T04:00:00.000Z'),
      stalledHours: 24,
      tasks: [
        baseTask,
        {
          ...baseTask,
          id: 2,
          name: 'Review blocked',
          column: 'review',
          updated_at: '2026-06-24T03:00:00.000Z',
          review_required: true,
          review_state: 'pending',
        },
        {
          ...baseTask,
          id: 3,
          name: 'Gate and receipt',
          updated_at: '2026-06-24T03:00:00.000Z',
          human_gate_required: true,
          human_gate_state: 'pending',
          metadata: JSON.stringify({ receipt_status: 'failed' }),
        },
        {
          ...baseTask,
          id: 4,
          name: 'Escalated migration warning',
          updated_at: '2026-06-24T03:00:00.000Z',
          metadata: JSON.stringify({ owner_escalations: [{ reason: 'No response' }], migration_warning: true }),
        },
        {
          ...baseTask,
          id: 5,
          owner_principal_id: 'owner-2',
          name: 'Other owner',
          metadata: JSON.stringify({ receipt_status: 'failed' }),
        },
        {
          ...baseTask,
          id: 6,
          name: 'Missing receipt',
          updated_at: '2026-06-24T03:00:00.000Z',
          metadata: JSON.stringify({ receipt_status: 'missing_receipt' }),
        },
        {
          ...baseTask,
          id: 7,
          name: 'Approved gate',
          updated_at: '2026-06-24T03:00:00.000Z',
          human_gate_required: true,
          human_gate_state: 'approved',
        },
      ],
    });

    expect(inbox.total).toBe(5);
    expect(inbox.groups.stalled.map((item) => item.task.id)).toEqual([1]);
    expect(inbox.groups.review_blocked.map((item) => item.task.id)).toEqual([2]);
    expect(inbox.groups.gate_pending.map((item) => item.task.id)).toEqual([3]);
    expect(inbox.groups.receipt_failed.map((item) => item.task.id)).toEqual([3, 6]);
    expect(inbox.groups.escalated.map((item) => item.task.id)).toEqual([4]);
    expect(inbox.groups.migration_warning.map((item) => item.task.id)).toEqual([4]);
    expect(inbox.items.map((item) => item.deepLink)).toEqual(['/tasks/1', '/tasks/2', '/tasks/3', '/tasks/4', '/tasks/6']);
  });
});
