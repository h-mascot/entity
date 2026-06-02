import { describe, expect, it } from 'vitest';
import {
  REVIEW_VALID_SCORE_MIN,
  REVIEW_WEAK_SCORE_MIN,
  assessReviewOutput,
  inferTaskType,
  requiresReviewArtifact,
  scoreReviewVerdict,
  shouldValidateReviewEntryOnTransition,
  validateReviewCompletion,
  validateReviewEntry,
  type ArtifactAssessment,
  type ReviewAssessment,
} from './review-policy';
import type { TaskRecord } from '../../../db/src';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: 1,
    name: 'Evaluate TinyClaw and recommend a path',
    description: 'Compare the options, write the analysis, and recommend what to do next.',
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
    created_at: now,
    updated_at: now,
    metadata: null,
    ...overrides,
  };
}

function accessibleArtifact(reference: string): Promise<ArtifactAssessment> {
  return Promise.resolve({
    reference,
    status: 'accessible',
    detail: `ok: ${reference}`,
    accessible: true,
    reviewable: true,
  });
}

describe('inferTaskType', () => {
  it('classifies research/eval work', () => {
    expect(inferTaskType(makeTask())).toBe('research_eval');
  });

  it('classifies implementation work', () => {
    expect(
      inferTaskType(
        makeTask({
          name: 'Implement task review scoring',
          description: 'Patch the server and add tests.',
        })
      )
    ).toBe('implementation');
  });

  it('classifies deploy and board-admin work', () => {
    expect(
      inferTaskType(
        makeTask({
          name: 'Deploy gateway cron and verify prod health',
          description: 'Configure the rollout on the Mac host.',
        })
      )
    ).toBe('deploy_ops');

    expect(
      inferTaskType(
        makeTask({
          name: 'Board hygiene sweep',
          description: 'Triage duplicates and clean backlog noise.',
        })
      )
    ).toBe('board_admin');
  });
});

describe('assessReviewOutput', () => {
  it('uses stable VALID/WEAK/INVALID score thresholds', () => {
    expect(scoreReviewVerdict(100)).toBe('VALID');
    expect(scoreReviewVerdict(REVIEW_VALID_SCORE_MIN)).toBe('VALID');
    expect(scoreReviewVerdict(REVIEW_VALID_SCORE_MIN - 1)).toBe('WEAK');
    expect(scoreReviewVerdict(REVIEW_WEAK_SCORE_MIN)).toBe('WEAK');
    expect(scoreReviewVerdict(REVIEW_WEAK_SCORE_MIN - 1)).toBe('INVALID');
    expect(scoreReviewVerdict(-10)).toBe('INVALID');
  });

  it('requires artifacts only for task types that produce reviewable deliverables', () => {
    expect(requiresReviewArtifact('research_eval')).toBe(true);
    expect(requiresReviewArtifact('implementation')).toBe(true);
    expect(requiresReviewArtifact('deploy_ops')).toBe(true);
    expect(requiresReviewArtifact('content_comms')).toBe(true);
    expect(requiresReviewArtifact('board_admin')).toBe(false);
    expect(requiresReviewArtifact('general')).toBe(false);
  });

  it('rejects research output without an artifact', async () => {
    const assessment = await assessReviewOutput(
      makeTask({
        output: 'Compared the agents and the best direction is to keep TinyClaw small and composable.',
      })
    );

    expect(assessment.verdict).toBe('INVALID');
    expect(assessment.taskType).toBe('research_eval');
    expect(assessment.reasons[0]).toContain('requires a concrete artifact');
  });

  it('rejects missing file references', async () => {
    const assessment = await assessReviewOutput(
      makeTask({
        name: 'Implement smart review scoring',
        description: 'Patch the task agent and add tests.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        output:
          'Changed packages/server/src/agent/events.ts and wrote output/task-master-review.md. Tests passed and the patch is ready.',
      }),
      {
        artifactInspector: async (reference) => ({
          reference,
          status: reference === 'output/task-master-review.md' ? 'missing' : 'accessible',
          detail:
            reference === 'output/task-master-review.md'
              ? 'File not found at ~/workspace/output/task-master-review.md.'
              : `ok: ${reference}`,
          accessible: reference !== 'output/task-master-review.md',
          reviewable: reference !== 'output/task-master-review.md',
        }),
      }
    );

    expect(assessment.verdict).toBe('INVALID');
    expect(assessment.evidenceStatus).toBe('missing');
    expect(assessment.reasons[0]).toContain('File not found');
  });

  it('downgrades invalid artifacts to weak for stale legacy review tasks', async () => {
    const staleDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const assessment = await assessReviewOutput(
      makeTask({
        name: 'Implement smart review scoring',
        description: 'Patch the task agent and add tests.',
        created_at: staleDate,
        updated_at: staleDate,
        output:
          'Changed packages/server/src/agent/events.ts and wrote output/task-master-review.md. Tests passed and the patch is ready.',
      }),
      {
        artifactInspector: async (reference) => ({
          reference,
          status: reference === 'output/task-master-review.md' ? 'missing' : 'accessible',
          detail: reference === 'output/task-master-review.md' ? 'Legacy file not found.' : `ok: ${reference}`,
          accessible: reference !== 'output/task-master-review.md',
          reviewable: reference !== 'output/task-master-review.md',
        }),
      }
    );

    expect(assessment.verdict).toBe('WEAK');
    expect(assessment.score).toBe(60);
    expect(assessment.recommendedAction).toBe('request_evidence_refresh');
    expect(assessment.reasons[0]).toContain('Legacy stale task requires evidence refresh');
  });

  it('downgrades invalid artifacts to weak for legacy docs-host links', async () => {
    const assessment = await assessReviewOutput(
      makeTask({
        name: 'Implement docs route recovery',
        description: 'Patch the docs API route and verify the endpoint.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        output:
          'Changed packages/server/src/routes/docs.ts and verified the docs endpoint at http://100.106.69.9:3000/docs/entity/recovery.md successfully.',
      }),
      {
        artifactInspector: async (reference) => ({
          reference,
          status: reference.includes('/docs/') ? 'dead_url' : 'accessible',
          detail: reference.includes('/docs/') ? 'Legacy docs host no longer responds.' : `ok: ${reference}`,
          accessible: !reference.includes('/docs/'),
          reviewable: !reference.includes('/docs/'),
        }),
      }
    );

    expect(assessment.verdict).toBe('WEAK');
    expect(assessment.score).toBe(60);
    expect(assessment.evidenceStatus).toBe('dead_url');
    expect(assessment.reasons[0]).toContain('Legacy stale task requires evidence refresh');
  });

  it('downgrades vague handoff phrasing to weak when a real artifact exists', async () => {
    const assessment = await assessReviewOutput(
      makeTask({
        output:
          'See notes for the backstory. Full analysis lives at output/tinyclaw-eval.md and I recommend we keep the rollout scoped to a thin wrapper.',
      }),
      { artifactInspector: accessibleArtifact }
    );

    expect(assessment.verdict).toBe('WEAK');
    expect(assessment.reasons.join(' ')).toContain('vague handoff phrasing');
  });

  it('accepts implementation output with changed files and verification', async () => {
    const assessment = await assessReviewOutput(
      makeTask({
        name: 'Implement task review scoring',
        description: 'Build the server validation and add tests.',
        output:
          'Changed packages/server/src/agent/review-policy.ts and packages/server/src/agent/events.ts. Ran npx vitest run packages/server/src/agent/review-policy.test.ts and tests passed. Commit abcdef1 is ready for review.',
      }),
      { artifactInspector: accessibleArtifact }
    );

    expect(assessment.verdict).toBe('VALID');
    expect(assessment.score).toBeGreaterThanOrEqual(85);
  });

  it('hard-fails ownerless active review tasks', async () => {
    const assessment = await assessReviewOutput(
      makeTask({
        assignee: 'Unassigned',
        output:
          'Analysis is in output/review.md and I recommend keeping the policy conservative for the first rollout.',
      }),
      { artifactInspector: accessibleArtifact }
    );

    expect(assessment.verdict).toBe('INVALID');
    expect(assessment.recommendedAction).toBe('assign_owner');
    expect(assessment.reasons[0]).toContain('no owner');
  });
});

describe('review lifecycle validation', () => {
  const validPeerMetadata = {
    review_type: 'peer',
    reviewer: 'Book',
    henry_required: false,
    risk_level: 'low',
    submitted_by: 'Ada',
    review_packet: {
      requested_outcome: 'Validate MC Review v2 hardening patch',
      evidence: 'Patch touches review-policy.ts and helper scripts; tests were run.',
      done_criteria: ['wrong reviewer blocked', 'missing packet blocked', 'accepted review can close'],
    },
    review_decision: 'accepted',
    reviewed_by: 'Book',
    review_note: 'Verified packet, evidence, tests, and independent reviewer route.',
  };

  it('rejects moving to review without a packet', () => {
    const result = validateReviewEntry(null);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Insufficient review packet');
  });

  it('requires review type, reviewer, risk level, and packet fields', () => {
    expect(validateReviewEntry({ review_type: 'peer', risk_level: 'low' }).ok).toBe(false);
    expect(validateReviewEntry({ ...validPeerMetadata, risk_level: undefined }).ok).toBe(false);
    expect(validateReviewEntry({ ...validPeerMetadata, review_packet: { evidence: 'x' } }).ok).toBe(false);
    expect(validateReviewEntry(validPeerMetadata).ok).toBe(true);
  });

  it('forces high-risk review to Henry unless delegation is explicit', () => {
    const result = validateReviewEntry({
      ...validPeerMetadata,
      risk_level: 'high',
      henry_required: false,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('High-risk');
  });

  it('blocks completion without metadata or accepted review', () => {
    expect(validateReviewCompletion(makeTask({ metadata: null, assignee: 'Ada' }), 'Book').ok).toBe(false);
    expect(
      validateReviewCompletion(
        makeTask({
          assignee: 'Ada',
          metadata: JSON.stringify({ ...validPeerMetadata, review_decision: 'pending' }),
        }),
        'Book'
      ).ok
    ).toBe(false);
  });

  it('blocks wrong reviewer and same-producer completion', () => {
    const task = makeTask({
      assignee: 'Ada',
      metadata: JSON.stringify(validPeerMetadata),
    });

    expect(validateReviewCompletion(task, 'Spock').ok).toBe(false);
    expect(validateReviewCompletion(task, 'Ada').ok).toBe(false);
    expect(validateReviewCompletion(task, 'Book').ok).toBe(true);
  });

  it('keeps Henry-required tasks Henry-only unless delegated', () => {
    const metadata = {
      ...validPeerMetadata,
      review_type: 'henry',
      reviewer: 'henry',
      henry_required: true,
      risk_level: 'high',
      submitted_by: 'Book',
    };

    expect(validateReviewCompletion(makeTask({ assignee: 'Book', metadata: JSON.stringify(metadata) }), 'Ada').ok).toBe(false);
    expect(validateReviewCompletion(makeTask({ assignee: 'Book', metadata: JSON.stringify(metadata) }), 'human').ok).toBe(false);
    expect(validateReviewCompletion(makeTask({ assignee: 'Book', metadata: JSON.stringify(metadata) }), 'Henry').ok).toBe(true);
    expect(
      validateReviewCompletion(
        makeTask({
          assignee: 'Book',
          metadata: JSON.stringify({ ...metadata, henry_delegated: true, reviewer: 'Ada' }),
        }),
        'Ada'
      ).ok
    ).toBe(true);
  });

  it('allows explicit chat-delivery auto completion only with source proof', () => {
    const base = {
      review_type: 'auto',
      risk_level: 'low',
      review_decision: 'accepted',
      chat_output_delivered: true,
      source: 'discord',
      source_id: 'channel/message',
      review_packet: {
        requested_outcome: 'Close chat-origin task after showing output to Henry',
        evidence: 'The answer was delivered in the originating chat.',
        done_criteria: ['chat output exists'],
      },
    };

    expect(validateReviewCompletion(makeTask({ assignee: 'Ada', metadata: JSON.stringify(base) }), 'Ada').ok).toBe(true);
    expect(
      validateReviewCompletion(
        makeTask({ assignee: 'Ada', metadata: JSON.stringify({ ...base, source_id: '' }) }),
        'Ada'
      ).ok
    ).toBe(false);
  });
});

describe('shouldValidateReviewEntryOnTransition', () => {
  it('validates new review entries but not done tasks reopened to review', () => {
    expect(shouldValidateReviewEntryOnTransition('todo', 'review')).toBe(true);
    expect(shouldValidateReviewEntryOnTransition('doing', 'review')).toBe(true);
    expect(shouldValidateReviewEntryOnTransition('done', 'review')).toBe(false);
    expect(shouldValidateReviewEntryOnTransition('review', 'review')).toBe(false);
    expect(shouldValidateReviewEntryOnTransition('review', 'done')).toBe(false);
  });
});
