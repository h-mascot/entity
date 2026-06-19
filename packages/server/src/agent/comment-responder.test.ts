import { describe, expect, it } from 'vitest';
import type { AgentRegistryRecord, TaskCommentRecord, TaskRecord } from '../../../db/src';
import {
  buildMentionPrompt,
  parseMentionTokens,
  resolveMentionedAgents,
  wantsPickup,
} from './comment-responder';

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

describe('buildMentionPrompt', () => {
  it('includes the card content, thread, and the triggering comment', () => {
    const agent = { id: 'assistant', slug: 'assistant', name: 'Assistant' };
    const trigger = makeComment({ id: 5, author: 'Henry', body: '@assistant please pick this up' });
    const prompt = buildMentionPrompt(
      agent,
      makeTask({ description: 'Build CSV export for reports.' }),
      [makeComment({ id: 2, author: 'Ada', body: 'Started a draft.' }), trigger],
      trigger,
      true,
    );

    expect(prompt).toContain('You are Assistant');
    expect(prompt).toContain('Ship the export pipeline');
    expect(prompt).toContain('Build CSV export for reports.');
    expect(prompt).toContain('Ada: Started a draft.');
    expect(prompt).toContain('Henry: @assistant please pick this up');
    expect(prompt).toContain('pick up');
  });
});
