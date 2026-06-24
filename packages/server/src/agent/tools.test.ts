import { describe, expect, it, vi } from 'vitest';
import type {
  ActivityRecord,
  ActivityRepository,
  TaskCommentRecord,
  TaskCommentRepository,
  TaskRecord,
} from '../../../db/src';
import type { TaskSyncLayer } from '../../../db/src/task-sync';
import { createTaskAgentTools, type TaskAgentToolDependencies } from './tools';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 7,
    name: 'Collect review evidence',
    description: 'Review notes are in output/current-review.md.',
    brief: null,
    origin_channel: null,
    column: 'review',
    model: 'codex',
    archived: false,
    assignee: 'Geordi',
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
    created_at: '2026-03-19T00:00:00.000Z',
    updated_at: '2026-03-19T00:00:00.000Z',
    metadata: null,
    ...overrides,
  };
}

function makeActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: 1,
    source: 'task',
    type: 'task_updated',
    activity_event_type: 'task_updated',
    activity_event_payload_version: 1,
    activity_event_payload_json: JSON.stringify({
      version: 1,
      actor_type: 'agent',
      task_id: 7,
    }),
    activity_event_schema_status: 'legacy_mapped',
    activity_event_legacy_type: null,
    action: 'Updated task',
    description: 'Saved artifact to workspace/reviews/evidence.txt.',
    agent_name: 'Geordi',
    agent_emoji: '🛠️',
    file_path: null,
    task_id: 7,
    task_column: 'review',
    metadata: null,
    created_at: '2026-03-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeComment(overrides: Partial<TaskCommentRecord> = {}): TaskCommentRecord {
  return {
    id: 1,
    task_id: 7,
    body: 'Attached output/comment-evidence.md for review.',
    author: 'Entity Agent',
    parent_id: null,
    created_at: '2026-03-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeDependencies(): {
  dependencies: TaskAgentToolDependencies;
  taskSyncLayer: TaskSyncLayer;
  activityRepository: ActivityRepository;
  taskCommentRepository: TaskCommentRepository;
} {
  const taskSyncLayer: TaskSyncLayer = {
    getMode: vi.fn().mockReturnValue('LOCAL'),
    setMode: vi.fn(),
    hasCloudAdapter: vi.fn().mockReturnValue(false),
    listTasks: vi.fn().mockResolvedValue([
      makeTask(),
      makeTask({
        id: 8,
        name: 'Other task',
        description: 'Do not borrow output/other-task.md from here.',
        output: 'output/other-task.md',
      }),
    ]),
    getTask: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn(),
    updateTask: vi.fn().mockResolvedValue(undefined),
    claimTaskForTaskMaster: vi.fn().mockResolvedValue({
      status: 'not_found',
      claimed: false,
      reason: 'task not found',
    }),
    moveTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(true),
  };

  const activityRepository: ActivityRepository = {
    listActivities: vi.fn().mockReturnValue([]),
    listActivitiesByTaskId: vi.fn().mockReturnValue([makeActivity()]),
    createActivity: vi.fn(),
  };

  const taskCommentRepository: TaskCommentRepository = {
    listComments: vi.fn().mockReturnValue([makeComment()]),
    createComment: vi.fn(),
  };

  return {
    taskSyncLayer,
    activityRepository,
    taskCommentRepository,
    dependencies: {
      taskSyncLayer,
      activityRepository,
      taskCommentRepository,
      workspaceRoot: '/Users/henrymascot/Code/entity',
      logActivity: vi.fn(),
      broadcast: vi.fn(),
    },
  };
}

describe('createTaskAgentTools', () => {
  it('discovers output candidates from the current task context only', async () => {
    const { dependencies, taskSyncLayer } = makeDependencies();
    const tools = createTaskAgentTools(dependencies);

    const candidates = await tools.discoverOutputCandidates(makeTask());

    expect(candidates).toEqual([
      'output/current-review.md',
      'workspace/reviews/evidence.txt',
      'output/comment-evidence.md',
    ]);
    expect(candidates).not.toContain('output/other-task.md');
    expect(vi.mocked(taskSyncLayer.listTasks)).not.toHaveBeenCalled();
  });
});
