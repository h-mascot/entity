import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ActivityRepository,
  ActivityType,
  CreateActivityInput,
  TaskCommentRepository,
  TaskRecord,
} from '../../../db/src';
import type { TaskSyncLayer } from '../../../db/src/task-sync';

vi.mock('./log', () => ({
  getAgentStatus: vi.fn(() => ({
    lastRun: null,
    totalActions: 0,
    provider: 'test',
    model: 'test-model',
    enabled: true,
    apiKeyConfigured: false,
    apiKeySource: 'none',
  })),
  listAgentLogs: vi.fn(() => []),
  writeAgentLog: vi.fn(),
}));

vi.mock('./settings', () => ({
  getTaskAgentLanguageModel: vi.fn(() => null),
  getTaskAgentSettings: vi.fn(() => ({
    provider: 'google',
    model: 'test-model',
    apiKeyConfigured: false,
    apiKeySource: 'none',
    baseUrl: null,
    baseUrlSource: 'none',
    supportsBaseUrl: false,
    staleThresholdHours: { doing: 1, review: 1 },
    maxActionsPerScan: 10,
    providers: [],
  })),
  updateTaskAgentSettings: vi.fn(),
}));

import { TaskAgent } from './index';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 42,
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
    name: 'Implement review hygiene scan',
    description: 'Patch the server and add test coverage.',
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
    output: 'Changed packages/server/src/agent/index.ts and output/review-hygiene.md. Tests passed.',
    progress_status: null,
    recurring: false,
    recurring_config: null,
    created_at: '2026-06-23T00:00:00.000Z',
    updated_at: '2026-06-23T00:00:00.000Z',
    metadata: null,
    ...overrides,
  };
}

function makeTaskSyncLayer(task: TaskRecord): TaskSyncLayer {
  return {
    getMode: () => 'LOCAL',
    setMode: vi.fn(),
    hasCloudAdapter: () => false,
    listTasks: vi.fn().mockResolvedValue([task]),
    getTask: vi.fn().mockResolvedValue(task),
    createTask: vi.fn().mockResolvedValue(task),
    updateTask: vi.fn().mockResolvedValue(task),
    moveTask: vi.fn().mockResolvedValue({ ...task, column: 'doing' }),
    deleteTask: vi.fn().mockResolvedValue(true),
  };
}

function makeActivityRepository(): ActivityRepository & { created: CreateActivityInput[] } {
  const created: CreateActivityInput[] = [];
  return {
    created,
    listActivities: vi.fn(() => []),
    listActivitiesByTaskId: vi.fn(() => []),
    createActivity: vi.fn((input: CreateActivityInput) => {
      created.push(input);
      return {
        id: created.length,
        source: input.source ?? 'agent',
        type: input.type as ActivityType,
        activity_event_type: input.activity_event_type as never,
        activity_event_payload_version: 1,
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
        created_at: '2026-06-23T00:00:00.000Z',
      };
    }),
  };
}

function makeCommentRepository(): TaskCommentRepository {
  return {
    listComments: vi.fn(() => []),
    createComment: vi.fn(() => ({
      id: 1,
      task_id: 42,
      body: 'note',
      author: 'Entity Agent',
      parent_id: null,
      created_at: '2026-06-23T00:00:00.000Z',
    })),
  };
}

describe('TaskAgent ActivityEvent consumers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records review decisions and notification routes as canonical ActivityEvents', async () => {
    const task = makeTask();
    const activityRepository = makeActivityRepository();
    const agent = new TaskAgent({
      taskSyncLayer: makeTaskSyncLayer(task),
      activityRepository,
      taskCommentRepository: makeCommentRepository(),
      workspaceRoot: '/tmp/entity',
      docsRoots: { output: '/tmp/entity/output' },
      logActivity: vi.fn(),
      broadcast: vi.fn(),
    });

    await agent.handleTaskMovedToReview(task);

    const eventTypes = activityRepository.created.map((input) => input.activity_event_type);
    expect(eventTypes).toContain('review_decision');
    expect(activityRepository.created.every((input) => input.task_id === task.id)).toBe(true);
    expect(activityRepository.created.every((input) => input.source === 'agent')).toBe(true);
    expect(activityRepository.created[0]?.metadata).toContain('task_agent_consumer');
  });
});
