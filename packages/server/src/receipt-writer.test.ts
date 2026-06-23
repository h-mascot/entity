import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ActivityRecord,
  CreateActivityInput,
  EvidenceArtifactRecord,
  TaskRecord,
  UpdateTaskInput,
} from '../../db/src';
import {
  buildCanonicalReceiptMarkdown,
  completeTaskWithReceipt,
  hashCanonicalReceiptMarkdown,
  regenerateReceiptMetadataFromBody,
} from './receipt-writer';

let tempDirs: string[] = [];

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 42,
    org_id: 'org-1',
    team_id: 'team-1',
    project_id: 7,
    created_by_principal_id: 'creator-1',
    initiator_principal_id: 'initiator-1',
    initiator_type: 'human',
    owner_principal_id: 'owner-1',
    owner_principal_type: 'human',
    executor_principal_id: 'agent-1',
    assignment_state: 'assigned',
    taskmaster_drivable: false,
    name: 'Prepare renewal packet',
    description: 'Gather proof for a customer renewal packet.',
    brief: null,
    origin_channel: 'task',
    column: 'review',
    model: 'entity-mc',
    archived: false,
    assignee: 'agent-1',
    blocked: false,
    blocker_reason: null,
    due_date: null,
    priority: 'P1',
    estimate_hours: null,
    time_spent: null,
    output: 'output/renewal-packet.md',
    progress_status: null,
    recurring: false,
    recurring_config: null,
    created_at: '2026-06-23T10:00:00.000Z',
    updated_at: '2026-06-23T10:30:00.000Z',
    metadata: JSON.stringify({
      worktype: 'customer_success',
      submitted_by: 'agent-1',
      done_criteria: ['Evidence attached', 'Reviewer accepted'],
      evidence_links: ['output/evidence.md'],
      evidence_summary: 'Renewal evidence and next action are attached.',
      review_required: true,
      reviewer: 'reviewer-1',
      review_decision: 'accepted',
      review_note: 'Looks complete and matches the requested outcome.',
      human_gate_required: false,
    }),
    project: 'Renewals',
    projects: [],
    ...overrides,
  };
}

function makeActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: 11,
    source: 'task',
    type: 'task_updated',
    activity_event_type: 'status_changed',
    activity_event_payload_version: 1,
    activity_event_payload_json: '{}',
    activity_event_schema_status: 'structured',
    activity_event_legacy_type: null,
    action: 'Moved to review',
    description: 'Task moved to review.',
    agent_name: 'Entity',
    agent_emoji: null,
    file_path: null,
    task_id: 42,
    task_column: 'review',
    metadata: null,
    created_at: '2026-06-23T10:31:00.000Z',
    ...overrides,
  };
}

function makeArtifact(input: {
  id: string;
  stable_path: string;
  human_path_alias: string | null;
  content_hash: string;
  origin_task_id: number | null;
  source_activity_event_ids: number[];
}): EvidenceArtifactRecord {
  return {
    id: input.id,
    org_id: 'org-1',
    team_id: 'team-1',
    project_id: 7,
    artifact_kind: 'raw_task_receipt',
    title: 'Prepare renewal packet receipt',
    body_format: 'markdown',
    stable_path: input.stable_path,
    human_path_alias: input.human_path_alias,
    content_hash: input.content_hash,
    mutability_policy: 'immutable_append_only',
    version: 1,
    origin_task_id: input.origin_task_id,
    source_activity_event_ids: input.source_activity_event_ids,
    source_artifact_ids: [],
    linked_object_refs: [],
    provenance_json: '{}',
    integrity_state: 'valid',
    availability_state: 'available',
    created_by_principal_id: 'reviewer-1',
    metadata_json: '{}',
    created_at: '2026-06-23T11:00:00.000Z',
    updated_at: '2026-06-23T11:00:00.000Z',
  };
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('receipt writer', () => {
  it('renders the canonical required receipt sections as a snapshot', () => {
    const previousTask = makeTask({ column: 'review' });
    const task = makeTask({ column: 'done' });

    expect(buildCanonicalReceiptMarkdown({
      task,
      previousTask,
      artifactId: 'receipt-fixed',
      stablePath: '/artifacts/evidence/receipt-fixed.md',
      contentHash: 'sha256:fixed',
      completedAt: '2026-06-23T11:00:00.000Z',
      actorPrincipalId: 'reviewer-1',
      sourceEventIds: [11, 12],
    })).toMatchInlineSnapshot(`
      "# Task Receipt: Prepare renewal packet

      ## Identity
      - Task ID: 42
      - Org: org-1
      - Team: team-1
      - Project: Renewals
      - Worktype: customer_success
      - Origin: task
      - Created By: creator-1
      - Initiator: initiator-1
      - Owner: owner-1
      - Assignee: agent-1
      - Executor: agent-1
      - Submitted By: agent-1

      ## Status Transition
      - Previous State: review
      - New State: done
      - Completed At: 2026-06-23T11:00:00.000Z
      - Completion Actor: reviewer-1

      ## Done Criteria
      - Evidence attached
      - Reviewer accepted

      ## Evidence Summary
      - Summary: Renewal evidence and next action are attached.
      - Missing Evidence: no
      - Missing Evidence Reason: not applicable
      - Evidence Links:
      - output/evidence.md

      ## Output Artifacts
      - output/renewal-packet.md

      ## Review
      - Review Required: yes
      - Reviewer: reviewer-1
      - Decision: accepted
      - Decision Reason: Looks complete and matches the requested outcome.

      ## Human Gate
      - Human Gate Required: no
      - Approver: not recorded
      - Decision: not recorded
      - Gate Reason: not recorded

      ## Routing / Execution History
      - Original Assignment: agent-1
      - Task Master Claim: not recorded
      - Nudges: not recorded
      - Owner Escalations: not recorded
      - Reassignments: not recorded
      - Final Executor: agent-1

      ## Provenance
      - Source Activity Event Range: 11, 12
      - Runtime/Provider: entity-mc
      - Receipt Artifact ID: receipt-fixed
      - Stable Path: /artifacts/evidence/receipt-fixed.md
      - Content Hash: sha256:fixed
      "
    `);
  });

  it('renders only resolved review and human gate decisions from task state', () => {
    const previousTask = makeTask({ column: 'review' });
    const completedTask = makeTask({
      column: 'done',
      review_required: true,
      review_state: 'accepted',
      human_gate_required: true,
      human_gate_state: 'approved',
      metadata: JSON.stringify({
        reviewer_principal_id: 'reviewer-1',
        approver_principal_id: 'approver-1',
        review_decision_reason: 'matches done criteria',
        human_gate_reason: 'approved before customer send',
      }),
    });

    const receipt = buildCanonicalReceiptMarkdown({
      task: completedTask,
      previousTask,
      artifactId: 'receipt-fixed',
      stablePath: '/artifacts/evidence/receipt-fixed.md',
      contentHash: 'sha256:fixed',
      completedAt: '2026-06-23T11:00:00.000Z',
      actorPrincipalId: 'reviewer-1',
    });

    expect(receipt).toContain('- Review Required: yes');
    expect(receipt).toContain('- Decision: accepted');
    expect(receipt).toContain('- Human Gate Required: yes');
    expect(receipt).toContain('- Approver: approver-1');
    expect(receipt).toContain('- Decision: approved');

    const pendingGateReceipt = buildCanonicalReceiptMarkdown({
      task: makeTask({
        column: 'review',
        human_gate_required: true,
        human_gate_state: 'pending',
        metadata: JSON.stringify({
          human_gate_required: true,
          human_gate_decision: 'pending',
        }),
      }),
      previousTask,
      artifactId: 'receipt-pending',
      stablePath: '/artifacts/evidence/receipt-pending.md',
      contentHash: 'sha256:pending',
      completedAt: '2026-06-23T11:00:00.000Z',
    });
    expect(pendingGateReceipt).toContain('## Human Gate');
    expect(pendingGateReceipt).not.toContain('- Decision: pending');
  });

  it('writes receipt body and metadata before completing the task', async () => {
    const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-receipt-'));
    tempDirs.push(storageRoot);
    const previousTask = makeTask({ column: 'review' });
    const nextTask = makeTask({ column: 'done' });
    const createdArtifacts: EvidenceArtifactRecord[] = [];
    const createdActivities: CreateActivityInput[] = [];
    const updates: UpdateTaskInput[] = [];

    const result = await completeTaskWithReceipt(
      {
        previousTask,
        nextTask,
        actorPrincipalId: 'reviewer-1',
        updates: { column: 'done' },
      },
      {
        storageRoot,
        idFactory: () => 'receipt-fixed',
        now: () => new Date('2026-06-23T11:00:00.000Z'),
        artifactRepository: {
          createArtifact: (input) => {
            const artifact = makeArtifact({
              id: input.id ?? 'missing',
              stable_path: input.stable_path ?? '',
              human_path_alias: input.human_path_alias ?? null,
              content_hash: input.content_hash,
              origin_task_id: input.origin_task_id ?? null,
              source_activity_event_ids: input.source_activity_event_ids ?? [],
            });
            createdArtifacts.push(artifact);
            return artifact;
          },
        },
        activityRepository: {
          listActivitiesByTaskId: () => [makeActivity({ id: 11 })],
          createActivity: (input) => {
            createdActivities.push(input);
            return makeActivity({ id: 12, activity_event_type: 'receipt_created' });
          },
        },
        updateTask: async (_taskId, update) => {
          updates.push(update);
          return {
            ...nextTask,
            metadata: update.metadata ?? nextTask.metadata,
          };
        },
      },
    );

    const receiptPath = path.join(storageRoot, 'artifacts/evidence/receipt-fixed.md');
    const receiptBody = await fs.promises.readFile(receiptPath, 'utf8');
    expect(receiptBody).toContain('## Provenance');
    expect(createdArtifacts[0]).toMatchObject({
      id: 'receipt-fixed',
      origin_task_id: 42,
      stable_path: '/artifacts/evidence/receipt-fixed.md',
      mutability_policy: 'immutable_append_only',
    });
    expect(createdArtifacts[0]?.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(createdArtifacts[0]?.content_hash).toBe(hashCanonicalReceiptMarkdown(receiptBody));
    expect(createdActivities[0]).toMatchObject({
      activity_event_type: 'receipt_created',
      task_id: 42,
    });
    expect(JSON.parse(updates[0]?.metadata ?? '{}').phase2_receipt).toMatchObject({
      artifact_id: 'receipt-fixed',
      content_hash: createdArtifacts[0]?.content_hash,
      stable_path: '/artifacts/evidence/receipt-fixed.md',
    });
    expect(result.task.column).toBe('done');
    expect(result.artifact.id).toBe('receipt-fixed');
  });

  it('rejects raw receipt body overwrite attempts and leaves the existing body unchanged', async () => {
    const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-receipt-'));
    tempDirs.push(storageRoot);
    const previousTask = makeTask({ column: 'review' });
    const nextTask = makeTask({ column: 'done' });
    const receiptPath = path.join(storageRoot, 'artifacts/evidence/receipt-fixed.md');
    const originalBody = '# Existing immutable receipt\n';
    await fs.promises.mkdir(path.dirname(receiptPath), { recursive: true });
    await fs.promises.writeFile(receiptPath, originalBody);
    const createdActivities: CreateActivityInput[] = [];
    const updates: UpdateTaskInput[] = [];

    await expect(completeTaskWithReceipt(
      {
        previousTask,
        nextTask,
        actorPrincipalId: 'reviewer-1',
      },
      {
        storageRoot,
        idFactory: () => 'receipt-fixed',
        now: () => new Date('2026-06-23T11:00:00.000Z'),
        artifactRepository: {
          createArtifact: () => {
            throw new Error('artifact should not create after overwrite rejection');
          },
        },
        activityRepository: {
          listActivitiesByTaskId: () => [makeActivity()],
          createActivity: (input) => {
            createdActivities.push(input);
            return makeActivity({ id: 12, activity_event_type: 'receipt_failed' });
          },
        },
        updateTask: async (_taskId, update) => {
          updates.push(update);
          return {
            ...previousTask,
            blocked: update.blocked ?? previousTask.blocked,
            blocker_reason: update.blocker_reason ?? previousTask.blocker_reason,
            metadata: update.metadata ?? previousTask.metadata,
          };
        },
      },
    )).rejects.toMatchObject({ code: 'EEXIST' });

    await expect(fs.promises.readFile(receiptPath, 'utf8')).resolves.toBe(originalBody);
    expect(createdActivities[0]).toMatchObject({
      activity_event_type: 'receipt_failed',
      task_column: 'review',
    });
    expect(updates[0]).toMatchObject({
      column: 'review',
      blocked: true,
    });
    expect(JSON.parse(updates[0]?.metadata ?? '{}').phase2_receipt).toMatchObject({
      receipt_status: 'failed',
      failure_stage: 'body_write',
      stable_path: '/artifacts/evidence/receipt-fixed.md',
    });
  });

  it('leaves a failed receipt state and event when receipt body writing fails', async () => {
    const previousTask = makeTask({ column: 'review' });
    const nextTask = makeTask({ column: 'done' });
    const createdActivities: CreateActivityInput[] = [];
    const updates: UpdateTaskInput[] = [];

    await expect(completeTaskWithReceipt(
      {
        previousTask,
        nextTask,
        actorPrincipalId: 'reviewer-1',
      },
      {
        storageRoot: '/tmp/entity-receipt-test',
        idFactory: () => 'receipt-fixed',
        now: () => new Date('2026-06-23T11:00:00.000Z'),
        writeFile: async () => {
          throw new Error('disk full');
        },
        mkdir: async () => undefined,
        artifactRepository: {
          createArtifact: () => {
            throw new Error('artifact should not create');
          },
        },
        activityRepository: {
          listActivitiesByTaskId: () => [makeActivity()],
          createActivity: (input) => {
            createdActivities.push(input);
            return makeActivity({ id: 12, activity_event_type: 'receipt_failed' });
          },
        },
        updateTask: async (_taskId, update) => {
          updates.push(update);
          return {
            ...previousTask,
            blocked: update.blocked ?? previousTask.blocked,
            blocker_reason: update.blocker_reason ?? previousTask.blocker_reason,
            metadata: update.metadata ?? previousTask.metadata,
          };
        },
      },
    )).rejects.toThrow('disk full');
    expect(createdActivities[0]).toMatchObject({
      activity_event_type: 'receipt_failed',
      task_id: 42,
      task_column: 'review',
    });
    expect(updates[0]).toMatchObject({
      column: 'review',
      blocked: true,
    });
    const metadata = JSON.parse(updates[0]?.metadata ?? '{}');
    expect(metadata.receipt_status).toBe('failed');
    expect(metadata.phase2_receipt).toMatchObject({
      receipt_status: 'failed',
      failure_stage: 'body_write',
      stable_path: '/artifacts/evidence/receipt-fixed.md',
    });
  });

  it('keeps the task non-done and queues orphan reconciliation when metadata creation fails after body write', async () => {
    const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-receipt-'));
    tempDirs.push(storageRoot);
    const previousTask = makeTask({ column: 'review' });
    const nextTask = makeTask({ column: 'done' });
    const createdActivities: CreateActivityInput[] = [];
    const updates: UpdateTaskInput[] = [];

    await expect(completeTaskWithReceipt(
      {
        previousTask,
        nextTask,
        actorPrincipalId: 'reviewer-1',
      },
      {
        storageRoot,
        idFactory: () => 'receipt-fixed',
        now: () => new Date('2026-06-23T11:00:00.000Z'),
        artifactRepository: {
          createArtifact: () => {
            throw new Error('db unavailable');
          },
        },
        activityRepository: {
          listActivitiesByTaskId: () => [makeActivity()],
          createActivity: (input) => {
            createdActivities.push(input);
            return makeActivity({ id: 12, activity_event_type: 'receipt_failed' });
          },
        },
        updateTask: async (_taskId, update) => {
          updates.push(update);
          return {
            ...previousTask,
            blocked: update.blocked ?? previousTask.blocked,
            blocker_reason: update.blocker_reason ?? previousTask.blocker_reason,
            metadata: update.metadata ?? previousTask.metadata,
          };
        },
      },
    )).rejects.toThrow('db unavailable');

    const receiptPath = path.join(storageRoot, 'artifacts/evidence/receipt-fixed.md');
    await expect(fs.promises.readFile(receiptPath, 'utf8')).resolves.toContain('## Provenance');
    expect(createdActivities.map((activity) => activity.activity_event_type)).toEqual(['receipt_failed']);
    expect(updates[0]).toMatchObject({
      column: 'review',
      blocked: true,
    });
    const metadata = JSON.parse(updates[0]?.metadata ?? '{}');
    expect(metadata.receipt_status).toBe('integrity_error');
    expect(metadata.phase2_receipt).toMatchObject({
      receipt_status: 'integrity_error',
      failure_stage: 'metadata_write',
      stable_path: '/artifacts/evidence/receipt-fixed.md',
    });
    expect(metadata.phase2_receipt.reconciliation_queue[0]).toMatchObject({
      type: 'orphaned_receipt_artifact',
      stable_path: '/artifacts/evidence/receipt-fixed.md',
    });
  });

  it('regenerates metadata from an existing body without rewriting it', async () => {
    const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-receipt-'));
    tempDirs.push(storageRoot);
    const task = makeTask({ column: 'done' });
    const receiptBody = buildCanonicalReceiptMarkdown({
      task,
      previousTask: makeTask({ column: 'review' }),
      artifactId: 'receipt-fixed',
      stablePath: '/artifacts/evidence/receipt-fixed.md',
      contentHash: 'sha256:fixed',
      completedAt: '2026-06-23T11:00:00.000Z',
      actorPrincipalId: 'reviewer-1',
      sourceEventIds: [11],
    });
    const receiptPath = path.join(storageRoot, 'artifacts/evidence/receipt-fixed.md');
    await fs.promises.mkdir(path.dirname(receiptPath), { recursive: true });
    await fs.promises.writeFile(receiptPath, receiptBody);
    const updates: UpdateTaskInput[] = [];

    const result = await regenerateReceiptMetadataFromBody(
      {
        task,
        artifactId: 'receipt-fixed',
        stablePath: '/artifacts/evidence/receipt-fixed.md',
        actorPrincipalId: 'reviewer-1',
        sourceActivityEventIds: [11],
      },
      {
        storageRoot,
        now: () => new Date('2026-06-23T11:30:00.000Z'),
        artifactRepository: {
          createArtifact: (input) => makeArtifact({
            id: input.id ?? 'missing',
            stable_path: input.stable_path ?? '',
            human_path_alias: input.human_path_alias ?? null,
            content_hash: input.content_hash,
            origin_task_id: input.origin_task_id ?? null,
            source_activity_event_ids: input.source_activity_event_ids ?? [],
          }),
        },
        updateTask: async (_taskId, update) => {
          updates.push(update);
          return {
            ...task,
            metadata: update.metadata ?? task.metadata,
          };
        },
      },
    );

    expect(result.receiptBody).toBe(receiptBody);
    expect(result.artifact.content_hash).toBe(hashCanonicalReceiptMarkdown(receiptBody));
    expect(JSON.parse(updates[0]?.metadata ?? '{}').phase2_receipt).toMatchObject({
      artifact_id: 'receipt-fixed',
      stable_path: '/artifacts/evidence/receipt-fixed.md',
      content_hash: result.artifact.content_hash,
    });
    await expect(fs.promises.readFile(receiptPath, 'utf8')).resolves.toBe(receiptBody);
  });

  it('refuses metadata regeneration when the immutable body is missing', async () => {
    const task = makeTask({ column: 'done' });

    await expect(regenerateReceiptMetadataFromBody(
      {
        task,
        artifactId: 'receipt-fixed',
        stablePath: '/artifacts/evidence/receipt-fixed.md',
      },
      {
        storageRoot: '/tmp/entity-receipt-missing-body-test',
        artifactRepository: {
          createArtifact: () => {
            throw new Error('artifact should not create');
          },
        },
        updateTask: async () => {
          throw new Error('task should not update');
        },
      },
    )).rejects.toThrow('receipt body missing; cannot regenerate metadata');
  });
});
