import { describe, expect, it } from 'vitest';
import {
  parseTaskAccountabilityForCreate,
  parseTaskAccountabilityUpdates,
  validateTaskAccountability,
} from './task-accountability';

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
});
