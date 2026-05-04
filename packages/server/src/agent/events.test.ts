import { describe, expect, it, vi } from 'vitest';
import { onOutputMissing, onOwnershipGap, onTaskMovedToReview, type TaskAgentEventContext } from './events';
import type { TaskAgentTools } from './tools';
import type { TaskRecord } from '../../../db/src';
import type { ReviewAssessment } from './review-policy';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 42,
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
    output:
      'Changed packages/server/src/agent/events.ts and output/review-hygiene.md. Tests passed and the patch is ready.',
    progress_status: null,
    recurring: false,
    recurring_config: null,
    created_at: '2026-03-19T00:00:00.000Z',
    updated_at: '2026-03-19T00:00:00.000Z',
    metadata: null,
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<ReviewAssessment> = {}): ReviewAssessment {
  return {
    taskType: 'implementation',
    verdict: 'VALID',
    score: 92,
    reasons: ['Output meets the minimum review evidence requirements.'],
    evidenceStatus: 'accessible',
    driftStatus: 'unknown',
    ownershipPresent: true,
    artifactRequired: true,
    artifactReferences: ['packages/server/src/agent/events.ts'],
    artifactAssessments: [
      {
        reference: 'packages/server/src/agent/events.ts',
        status: 'accessible',
        detail: 'ok',
        accessible: true,
        reviewable: true,
      },
    ],
    recommendedAction: 'accept_review',
    ...overrides,
  };
}

function makeContext(assessment: ReviewAssessment): {
  context: TaskAgentEventContext;
  tools: TaskAgentTools;
  invokeModel: ReturnType<typeof vi.fn>;
} {
  const validateArtifactReference = vi.fn().mockResolvedValue({
    reference: 'output/review.md',
    status: 'accessible',
    detail: 'ok',
    accessible: true,
    reviewable: true,
  });
  const invokeModel = vi.fn().mockResolvedValue(null);
  const tools: TaskAgentTools = {
    getTask: vi.fn().mockResolvedValue(undefined),
    searchTasks: vi.fn().mockResolvedValue([]),
    updateTask: vi.fn().mockResolvedValue(null),
    addNote: vi.fn().mockResolvedValue(undefined),
    addNoteOnce: vi.fn().mockResolvedValue(undefined),
    moveTask: vi.fn().mockResolvedValue(makeTask({ column: 'doing' })),
    notifyAgent: vi.fn().mockResolvedValue(undefined),
    listTaskActivities: vi.fn().mockReturnValue([]),
    listTaskComments: vi.fn().mockReturnValue([]),
    discoverOutputCandidates: vi.fn().mockResolvedValue([]),
    validateArtifactReference,
    validateOutput: vi.fn().mockResolvedValue({ valid: true, detail: 'ok' }),
    assessReview: vi.fn().mockResolvedValue(assessment),
  };

  return {
    tools,
    invokeModel,
    context: {
      tools,
      invokeModel,
    },
  };
}

describe('onTaskMovedToReview', () => {
  it('moves invalid review output back to doing with an audit note', async () => {
    const assessment = makeAssessment({
      verdict: 'INVALID',
      score: 30,
      reasons: ['File not found at /home/henrymascot/clawd/output/review-hygiene.md.'],
      evidenceStatus: 'missing',
      recommendedAction: 'move_back_to_doing',
    });
    const { context, tools } = makeContext(assessment);
    const task = makeTask();

    const actions = await onTaskMovedToReview(task, context);

    expect(tools.moveTask).toHaveBeenCalledWith(task.id, 'doing');
    expect(tools.addNoteOnce).toHaveBeenCalledWith(
      task.id,
      expect.stringContaining('Review output is invalid')
    );
    expect(tools.notifyAgent).toHaveBeenCalledWith(
      'Geordi',
      expect.stringContaining('invalid'),
      task.id
    );
    expect(actions.some((action) => action.action === 'reject_invalid_output')).toBe(true);
  });

  it('flags weak review output without moving the task', async () => {
    const assessment = makeAssessment({
      verdict: 'WEAK',
      score: 72,
      reasons: ['Output still uses vague handoff phrasing alongside the artifact reference.'],
      recommendedAction: 'request_evidence_refresh',
    });
    const { context, tools } = makeContext(assessment);
    const task = makeTask();

    const actions = await onTaskMovedToReview(task, context);

    expect(tools.moveTask).not.toHaveBeenCalled();
    expect(tools.addNoteOnce).toHaveBeenCalledWith(task.id, expect.stringContaining('Review output is weak'));
    expect(actions.some((action) => action.action === 'flag_weak_output')).toBe(true);
  });
});

describe('onOwnershipGap', () => {
  it('notes ownerless active tasks', async () => {
    const { context, tools } = makeContext(makeAssessment());
    const task = makeTask({ assignee: 'Unassigned', output: null, column: 'doing' });

    const actions = await onOwnershipGap(task, context);

    expect(tools.addNoteOnce).toHaveBeenCalledWith(
      task.id,
      '👤 Active task has no owner. Assign an agent before treating this as live work.'
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].event).toBe('ownership_check');
  });
});

describe('onOutputMissing', () => {
  it('auto-attaches a single reviewable candidate without invoking the model', async () => {
    const { context, tools, invokeModel } = makeContext(makeAssessment());
    const task = makeTask({ output: null });

    vi.mocked(tools.discoverOutputCandidates).mockResolvedValue(['output/review-hygiene.md']);
    vi.mocked(tools.validateArtifactReference).mockResolvedValue({
      reference: 'output/review-hygiene.md',
      status: 'accessible',
      detail: 'ok',
      accessible: true,
      reviewable: true,
    });
    vi.mocked(tools.updateTask).mockResolvedValue(makeTask({ output: 'output/review-hygiene.md' }));

    const actions = await onOutputMissing(task, context);

    expect(invokeModel).not.toHaveBeenCalled();
    expect(tools.updateTask).toHaveBeenCalledWith(task.id, { output: 'output/review-hygiene.md' });
    expect(tools.addNoteOnce).toHaveBeenCalledWith(task.id, '📎 Auto-attached output: output/review-hygiene.md');
    expect(actions.some((action) => action.action === 'attach_output')).toBe(true);
  });

  it('does not auto-attach when multiple candidates are found', async () => {
    const { context, tools, invokeModel } = makeContext(makeAssessment());
    const task = makeTask({ output: null });

    vi.mocked(tools.discoverOutputCandidates).mockResolvedValue(['output/a.md', 'output/b.md']);

    const actions = await onOutputMissing(task, context);

    expect(invokeModel).not.toHaveBeenCalled();
    expect(tools.updateTask).not.toHaveBeenCalled();
    expect(tools.addNoteOnce).toHaveBeenCalledWith(
      task.id,
      '⚠️ Multiple possible review artifacts were found. Attach the exact deliverable before final review.'
    );
    expect(actions.some((action) => action.action === 'skip_auto_attach')).toBe(true);
    expect(actions.some((action) => action.action === 'request_output')).toBe(true);
  });
});
