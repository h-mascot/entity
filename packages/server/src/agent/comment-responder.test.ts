import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import type { AgentRegistryRecord, TaskCommentRecord, TaskRecord } from '../../../db/src';
import {
  buildMentionPrompt,
  createCommentMentionResponder,
  parseColumnMoveIntent,
  parseMentionTokens,
  planAction,
  resolveMentionedAgents,
  wantsPickup,
} from './comment-responder';

const settingsMocks = vi.hoisted(() => ({
  getTaskAgentLanguageModel: vi.fn((): unknown => null),
  getTaskAgentSettings: vi.fn((): { provider: 'google' | 'anthropic' } => ({ provider: 'google' })),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('./settings', () => settingsMocks);

function makeAgent(overrides: Partial<AgentRegistryRecord> = {}): AgentRegistryRecord {
  const now = new Date().toISOString();
  return {
    id: 'assistant',
    slug: 'assistant',
    name: 'Assistant',
    emoji: '🤖',
    avatar_url: null,
    description: null,
    adapter_type: null,
    runtime_type: null,
    runtime_binding_id: null,
    provider_type: 'unknown',
    helm_managed: false,
    binding_state: 'unknown',
    status: 'active',
    instructions_path: null,
    metadata_json: '{}',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeComment(overrides: Partial<TaskCommentRecord> = {}): TaskCommentRecord {
  return {
    id: 1,
    task_id: 1,
    body: 'hello',
    author: 'Henry',
    parent_id: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: 1,
    name: 'Ship the export pipeline',
    description: 'Build CSV export for reports.',
    brief: null,
    origin_channel: null,
    column: 'todo',
    model: null,
    archived: false,
    assignee: 'Henry',
    blocked: false,
    blocker_reason: null,
    due_date: null,
    priority: 'P2',
    estimate_hours: null,
    time_spent: null,
    output: null,
    progress_status: null,
    recurring: false,
    recurring_config: null,
    created_at: now,
    updated_at: now,
    metadata: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsMocks.getTaskAgentLanguageModel.mockReturnValue(null);
  settingsMocks.getTaskAgentSettings.mockReturnValue({ provider: 'google' });
});

describe('parseMentionTokens', () => {
  it('extracts unique lowercased mention tokens', () => {
    expect(parseMentionTokens('hey @Assistant and @assistant, also @geordi-1')).toEqual([
      'assistant',
      'geordi-1',
    ]);
  });

  it('returns empty when there are no mentions', () => {
    expect(parseMentionTokens('no mentions here')).toEqual([]);
    // An email produces a harmless token that won't resolve to a known agent.
    expect(parseMentionTokens('email me at foo@example.com')).toEqual(['example.com']);
  });
});

describe('resolveMentionedAgents', () => {
  const agents = [
    makeAgent(),
    makeAgent({ id: 'geordi', slug: 'geordi', name: 'Geordi' }),
    makeAgent({ id: 'retired', slug: 'oldbot', name: 'OldBot', status: 'disabled' }),
  ];

  it('matches active agents by slug or name (case-insensitive)', () => {
    expect(resolveMentionedAgents('ping @assistant', agents).map((a) => a.id)).toEqual(['assistant']);
    expect(resolveMentionedAgents('hey @Geordi', agents).map((a) => a.id)).toEqual(['geordi']);
  });

  it('ignores inactive agents and unknown mentions', () => {
    expect(resolveMentionedAgents('@oldbot please help', agents)).toEqual([]);
    expect(resolveMentionedAgents('@nobody around', agents)).toEqual([]);
  });

  it('dedupes a single agent mentioned multiple ways', () => {
    expect(resolveMentionedAgents('@assistant @Assistant', agents).map((a) => a.id)).toEqual([
      'assistant',
    ]);
  });
});

describe('wantsPickup', () => {
  it('detects pickup/execution intent', () => {
    expect(wantsPickup('@assistant can you pick this up?')).toBe(true);
    expect(wantsPickup('@assistant take this over')).toBe(true);
    expect(wantsPickup('@assistant please work on this')).toBe(true);
    expect(wantsPickup('@assistant execute it')).toBe(true);
  });

  it('returns false for plain questions', () => {
    expect(wantsPickup('@assistant what do you think of the plan?')).toBe(false);
  });
});

describe('parseColumnMoveIntent', () => {
  it('detects an explicit move-to-column instruction', () => {
    expect(parseColumnMoveIntent('@assistant please move this task to the review column')).toBe('review');
    expect(parseColumnMoveIntent('move it to done')).toBe('done');
    expect(parseColumnMoveIntent('put this in progress')).toBe('doing');
    expect(parseColumnMoveIntent('send it back to the backlog')).toBe('backlog');
    expect(parseColumnMoveIntent('change to to-do')).toBe('todo');
    expect(parseColumnMoveIntent('mark it complete')).toBe('done');
  });

  it('picks the destination column when both source and target are named', () => {
    expect(parseColumnMoveIntent('move from review to done')).toBe('done');
  });

  it('returns null without a movement verb (plain question)', () => {
    expect(parseColumnMoveIntent('what is left for review?')).toBeNull();
    expect(parseColumnMoveIntent('is this done yet?')).toBeNull();
  });

  it('returns null when no column keyword is present', () => {
    expect(parseColumnMoveIntent('move quickly please')).toBeNull();
  });
});

describe('planAction', () => {
  it('plans a column move and self-assigns when moving to an active column unowned', () => {
    const task = makeTask({ column: 'backlog', assignee: 'Unassigned' });
    const action = planAction(task, '@assistant move this to doing', 'Assistant');
    expect(action.kind).toBe('move');
    expect(action.column).toBe('doing');
    expect(action.assignee).toBe('Assistant');
  });

  it('does not reassign when moving to a non-active column', () => {
    const task = makeTask({ column: 'doing', assignee: 'Ada' });
    const action = planAction(task, 'move it to backlog', 'Assistant');
    expect(action.kind).toBe('move');
    expect(action.column).toBe('backlog');
    expect(action.assignee).toBeUndefined();
  });

  it('blocks moving a review-gated task to done without an accepted review', () => {
    const task = makeTask({
      column: 'review',
      assignee: 'Ada',
      metadata: JSON.stringify({ review_type: 'peer', reviewer: 'Book', review_decision: 'pending' }),
    });
    const action = planAction(task, 'move this to done', 'Assistant');
    expect(action.kind).toBe('reply');
    expect(action.blockedReason).toMatch(/accepted review/i);
  });

  it('allows moving an ordinary (non-review) task straight to done', () => {
    const task = makeTask({ column: 'doing', assignee: 'Ada', metadata: '{}' });
    const action = planAction(task, 'mark this done', 'Assistant');
    expect(action.kind).toBe('move');
    expect(action.column).toBe('done');
  });

  it('falls back to pickup when asked to take the task', () => {
    const task = makeTask({ column: 'backlog', assignee: 'Unassigned' });
    const action = planAction(task, '@assistant pick this up', 'Assistant');
    expect(action.kind).toBe('pickup');
    expect(action.column).toBe('doing');
    expect(action.assignee).toBe('Assistant');
  });

  it('is a plain reply for a question', () => {
    const task = makeTask({ column: 'doing' });
    expect(planAction(task, 'what should I do first?', 'Assistant').kind).toBe('reply');
  });
});

describe('buildMentionPrompt', () => {
  it('includes the card content, thread, triggering comment, and the planned action', () => {
    const agent = { id: 'assistant', slug: 'assistant', name: 'Assistant' };
    const trigger = makeComment({ id: 5, author: 'Henry', body: '@assistant please move this to review' });
    const task = makeTask({ description: 'Build CSV export for reports.', column: 'doing' });
    const action = planAction(task, trigger.body, agent.name);
    const prompt = buildMentionPrompt(
      agent,
      task,
      [makeComment({ id: 2, author: 'Ada', body: 'Started a draft.' }), trigger],
      trigger,
      action,
    );

    expect(prompt).toContain('You are Assistant');
    expect(prompt).toContain('Ship the export pipeline');
    expect(prompt).toContain('Build CSV export for reports.');
    expect(prompt).toContain('Ada: Started a draft.');
    expect(prompt).toContain('Henry: @assistant please move this to review');
    expect(prompt).toContain('review');
  });
});

describe('createCommentMentionResponder', () => {
  it('dispatches multiple mentioned agent generations concurrently and persists replies in agent order', async () => {
    const model = { provider: 'test-model' };
    settingsMocks.getTaskAgentLanguageModel.mockReturnValue(model);
    settingsMocks.getTaskAgentSettings.mockReturnValue({ provider: 'anthropic' });

    let resolveAllStarted: () => void = () => {};
    let releaseGenerations: () => void = () => {};
    const allStarted = new Promise<void>((resolve) => {
      resolveAllStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseGenerations = resolve;
    });
    const startedCalls: unknown[] = [];
    vi.mocked(generateText).mockImplementation(async (input) => {
      startedCalls.push(input);
      const callNumber = startedCalls.length;
      if (startedCalls.length === 2) {
        resolveAllStarted();
      }
      await release;
      return { text: `reply-${callNumber}` } as Awaited<ReturnType<typeof generateText>>;
    });

    const createdComments: TaskCommentRecord[] = [];
    const createComment = vi.fn((input: {
      task_id: number;
      body: string;
      author?: string;
      parent_id?: number | null;
    }) => {
      const comment = makeComment({
        id: createdComments.length + 10,
        task_id: input.task_id,
        body: input.body,
        author: input.author ?? 'Human',
        parent_id: input.parent_id ?? null,
      });
      createdComments.push(comment);
      return comment;
    });
    const responder = createCommentMentionResponder({
      getTask: () => makeTask(),
      listComments: () => [],
      createComment,
      updateTask: vi.fn().mockResolvedValue(makeTask()),
      listAgents: () => [
        makeAgent({ id: 'assistant', slug: 'assistant', name: 'Assistant' }),
        makeAgent({ id: 'geordi', slug: 'geordi', name: 'Geordi' }),
      ],
      logActivity: vi.fn(),
      broadcast: vi.fn(),
    });

    const run = responder(1, makeComment({ id: 5, body: '@assistant @geordi please weigh in' }));
    await allStarted;

    expect(startedCalls).toHaveLength(2);
    expect(createComment).not.toHaveBeenCalled();
    expect(startedCalls[0]).toMatchObject({
      model,
      messages: [
        {
          role: 'system',
          providerOptions: {
            anthropic: {
              cacheControl: { type: 'ephemeral', ttl: '5m' },
            },
          },
        },
        { role: 'user' },
      ],
    });

    releaseGenerations();
    await run;

    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);
    expect(createComment.mock.calls.map(([input]) => [input.author, input.body])).toEqual([
      ['Assistant', 'reply-1'],
      ['Geordi', 'reply-2'],
    ]);
  });
});
