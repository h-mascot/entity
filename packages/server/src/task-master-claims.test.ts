import express from 'express';
import http from 'http';
import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_EVENT_PAYLOAD_VERSION,
  type ActivityRecord,
  type ActivityRepository,
  type CreateActivityInput,
  type TaskMasterClaimResult,
  type TaskRecord,
} from '../../db/src';
import {
  createTaskMasterClaimRouter,
  createTaskMasterClaimService,
} from './task-master-claims';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 52,
    org_id: 'org-a',
    team_id: 'team-a',
    project_id: 1,
    created_by_principal_id: 'creator-1',
    initiator_principal_id: 'initiator-1',
    initiator_type: 'human',
    owner_principal_id: 'owner-1',
    owner_principal_type: 'human',
    executor_principal_id: null,
    assignment_state: 'unassigned',
    taskmaster_drivable: true,
    name: 'Prepare account follow-up',
    description: null,
    brief: null,
    origin_channel: null,
    column: 'todo',
    model: null,
    archived: false,
    assignee: 'Unassigned',
    blocked: false,
    blocker_reason: null,
    due_date: null,
    priority: null,
    estimate_hours: null,
    time_spent: null,
    output: null,
    progress_status: null,
    recurring: false,
    recurring_config: null,
    created_at: '2026-06-24T00:00:00.000Z',
    updated_at: '2026-06-24T00:00:00.000Z',
    metadata: JSON.stringify({
      routing_policy_projection: {
        taskmaster_drivable: true,
        reason_chain: [
          { source: 'task', decision: 'taskmaster_drivable', value: true },
        ],
      },
    }),
    ...overrides,
  };
}

function buildClaimResult(task: TaskRecord, overrides: Partial<TaskMasterClaimResult> = {}): TaskMasterClaimResult {
  const previousTask = makeTask({ id: task.id, name: task.name });
  return {
    status: 'claimed',
    claimed: true,
    previousTask,
    task: {
      ...task,
      executor_principal_id: 'task-master',
      assignment_state: 'claimed',
    },
    claim: {
      taskmaster_principal_id: 'task-master',
      claimed_at: '2026-06-24T01:00:00.000Z',
      claim_request_id: 'claim-1',
      policy_reason: 'policy marked the unassigned task drivable',
      previous_assignee: previousTask.assignee ?? null,
      previous_executor_principal_id: previousTask.executor_principal_id ?? null,
      previous_assignment_state: previousTask.assignment_state ?? null,
      previous_taskmaster_drivable: true,
    },
    ...overrides,
  };
}

function createMemoryActivityRepository(): ActivityRepository & { created: CreateActivityInput[] } {
  const created: CreateActivityInput[] = [];
  return {
    created,
    listActivities: vi.fn(() => []),
    listActivitiesByTaskId: vi.fn(() => []),
    createActivity: vi.fn((input: CreateActivityInput): ActivityRecord => {
      created.push(input);
      return {
        id: created.length,
        source: input.source ?? 'task',
        type: input.type,
        activity_event_type: 'taskmaster_claimed',
        activity_event_payload_version: ACTIVITY_EVENT_PAYLOAD_VERSION,
        activity_event_payload_json: JSON.stringify(input.activity_event_payload ?? {}),
        activity_event_schema_status: input.activity_event_schema_status ?? 'structured',
        activity_event_legacy_type: null,
        action: input.action,
        description: input.description,
        agent_name: input.agent_name ?? null,
        agent_emoji: input.agent_emoji ?? null,
        file_path: input.file_path ?? null,
        task_id: input.task_id ?? null,
        task_column: input.task_column ?? null,
        metadata: input.metadata ?? null,
        created_at: '2026-06-24T01:00:00.000Z',
      };
    }),
  };
}

async function listen(app: express.Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed to bind');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe('Task Master claim service', () => {
  it('creates a structured taskmaster_claimed ActivityEvent for a successful claim', async () => {
    const task = makeTask();
    const activityRepository = createMemoryActivityRepository();
    const service = createTaskMasterClaimService({
      activityRepository,
      taskSyncLayer: {
        claimTaskForTaskMaster: vi.fn().mockResolvedValue(buildClaimResult(task)),
      },
    });

    const result = await service.claimTask(task.id, { claim_request_id: 'claim-1' });

    expect(result).toMatchObject({
      status: 'claimed',
      claimed: true,
      activityEvent: {
        activity_event_type: 'taskmaster_claimed',
        activity_event_schema_status: 'structured',
        task_id: task.id,
      },
    });
    expect(activityRepository.created).toHaveLength(1);
    expect(activityRepository.created[0]).toMatchObject({
      source: 'task',
      type: 'task_updated',
      activity_event_type: 'taskmaster_claimed',
      action: 'Task Master claimed task',
      agent_name: 'task-master',
      task_id: task.id,
    });
    expect(activityRepository.created[0].activity_event_payload).toMatchObject({
      actor_principal_id: 'task-master',
      actor_type: 'agent',
      task_id: task.id,
      reason: 'policy marked the unassigned task drivable',
      data: {
        previous_assignee: 'Unassigned',
        previous_executor_principal_id: null,
        previous_assignment_state: 'unassigned',
        current_executor_principal_id: 'task-master',
        current_assignment_state: 'claimed',
      },
    });
  });

  it('does not append a second ActivityEvent for an idempotent already-claimed retry', async () => {
    const task = makeTask({ executor_principal_id: 'task-master', assignment_state: 'claimed' });
    const activityRepository = createMemoryActivityRepository();
    const service = createTaskMasterClaimService({
      activityRepository,
      taskSyncLayer: {
        claimTaskForTaskMaster: vi.fn().mockResolvedValue({
          status: 'already_claimed',
          claimed: false,
          task,
          reason: 'task is already claimed by Task Master',
        }),
      },
    });

    const result = await service.claimTask(task.id, { claim_request_id: 'claim-1' });

    expect(result).toMatchObject({
      status: 'already_claimed',
      claimed: false,
      task: { executor_principal_id: 'task-master', assignment_state: 'claimed' },
    });
    expect(activityRepository.created).toHaveLength(0);
  });
});

describe('Task Master claim API routes', () => {
  it('handles concurrent claim requests with one transition winner and one idempotent loser', async () => {
    const activityRepository = createMemoryActivityRepository();
    const task = makeTask();
    let claimed = false;
    const service = createTaskMasterClaimService({
      activityRepository,
      taskSyncLayer: {
        claimTaskForTaskMaster: vi.fn(async (): Promise<TaskMasterClaimResult> => {
          if (claimed) {
            return {
              status: 'already_claimed',
              claimed: false,
              task: { ...task, executor_principal_id: 'task-master', assignment_state: 'claimed' },
              reason: 'task is already claimed by Task Master',
            };
          }
          claimed = true;
          return buildClaimResult(task);
        }),
      },
    });
    const app = express();
    app.use(express.json());
    app.use('/api', createTaskMasterClaimRouter(service));
    const server = await listen(app);

    try {
      const [first, second] = await Promise.all([
        fetch(`${server.baseUrl}/api/tasks/${task.id}/claim`, { method: 'POST' }),
        fetch(`${server.baseUrl}/api/tasks/${task.id}/claim`, { method: 'POST' }),
      ]);
      const bodies = [await first.json(), await second.json()] as Array<{ status: string; claimed: boolean }>;

      expect(bodies.filter((body) => body.status === 'claimed')).toHaveLength(1);
      expect(bodies.filter((body) => body.status === 'already_claimed')).toHaveLength(1);
      expect(bodies.filter((body) => body.claimed)).toHaveLength(1);
      expect(activityRepository.created).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it('returns a structured conflict when work is not claimable', async () => {
    const task = makeTask({ taskmaster_drivable: false, assignment_state: 'routing_problem' });
    const service = createTaskMasterClaimService({
      activityRepository: createMemoryActivityRepository(),
      taskSyncLayer: {
        claimTaskForTaskMaster: vi.fn().mockResolvedValue({
          status: 'not_claimable',
          claimed: false,
          task,
          reason: 'task is not unassigned Task-Master-drivable work',
        }),
      },
    });
    const app = express();
    app.use(express.json());
    app.use('/api', createTaskMasterClaimRouter(service));
    const server = await listen(app);

    try {
      const response = await fetch(`${server.baseUrl}/api/tasks/${task.id}/claim`, { method: 'POST' });
      const body = await response.json() as { status: string; claimed: boolean; reason: string };

      expect(response.status).toBe(409);
      expect(body).toMatchObject({
        status: 'not_claimable',
        claimed: false,
        reason: 'task is not unassigned Task-Master-drivable work',
      });
    } finally {
      await server.close();
    }
  });
});
