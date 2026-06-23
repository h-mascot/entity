import express from 'express';
import http from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActivityRepository, TaskRecord, UpdateTaskInput } from '../../../db/src';
import { createTaskReviewGateRouter } from './task-review-gates';

let server: http.Server | null = null;
let baseUrl = '';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 1,
    org_id: 'org-1',
    team_id: 'team-1',
    project_id: 7,
    created_by_principal_id: 'creator-1',
    initiator_principal_id: 'agent-1',
    initiator_type: 'agent',
    owner_principal_id: 'owner-1',
    owner_principal_type: 'human',
    executor_principal_id: 'agent-1',
    assignment_state: 'assigned',
    taskmaster_drivable: false,
    worktype: 'customer_success',
    risk_level: 'high',
    agent_trust_level: 'standard',
    policy_inputs_json: JSON.stringify({
      layers: {
        team: { reviewer_pool_principal_ids: ['reviewer-1'] },
        project: { approver_principal_id: 'approver-1' },
        task: {
          assignee_principal_id: 'agent-1',
          submitted_by_principal_id: 'agent-1',
        },
      },
    }),
    external_side_effects_json: '[]',
    external_side_effects: [],
    review_required: true,
    review_state: 'pending',
    human_gate_required: true,
    human_gate_state: 'pending',
    name: 'Review gated task',
    description: null,
    brief: null,
    origin_channel: 'task',
    column: 'review',
    model: null,
    archived: false,
    assignee: 'agent-1',
    blocked: false,
    blocker_reason: null,
    due_date: null,
    priority: 'P1',
    estimate_hours: null,
    time_spent: null,
    output: 'output.md',
    progress_status: null,
    recurring: false,
    recurring_config: null,
    metadata: '{}',
    project: 'Customer Success',
    projects: [],
    created_at: '2026-06-24T00:00:00.000Z',
    updated_at: '2026-06-24T00:00:00.000Z',
    ...overrides,
  };
}

async function startTestServer(initialTask = makeTask()) {
  const tasks = new Map<number, TaskRecord>([[initialTask.id, initialTask]]);
  const activities: Parameters<ActivityRepository['createActivity']>[0][] = [];
  const app = express();
  app.use(express.json());
  app.use('/api/tasks', createTaskReviewGateRouter({
    defaultActor: 'Henry',
    getTask: (taskId) => tasks.get(taskId),
    updateTask: (taskId, updates: UpdateTaskInput) => {
      const current = tasks.get(taskId);
      if (!current) return undefined;
      const next: TaskRecord = {
        ...current,
        review_required: updates.review_required ?? current.review_required,
        review_state: (updates.review_state as TaskRecord['review_state'] | undefined) ?? current.review_state,
        human_gate_required: updates.human_gate_required ?? current.human_gate_required,
        human_gate_state: (updates.human_gate_state as TaskRecord['human_gate_state'] | undefined) ?? current.human_gate_state,
        metadata: updates.metadata ?? current.metadata,
        updated_at: '2026-06-24T00:01:00.000Z',
      };
      tasks.set(taskId, next);
      return next;
    },
    activityRepository: {
      createActivity: (input) => {
        activities.push(input);
        return {
          id: activities.length,
          source: input.source ?? 'task',
          type: input.type,
          activity_event_type: input.activity_event_type as any,
          activity_event_payload_version: 1,
          activity_event_payload_json: JSON.stringify(input.activity_event_payload ?? {}),
          activity_event_schema_status: 'structured',
          activity_event_legacy_type: null,
          action: input.action,
          description: input.description,
          agent_name: input.agent_name ?? null,
          agent_emoji: input.agent_emoji ?? null,
          file_path: input.file_path ?? null,
          task_id: input.task_id ?? null,
          task_column: input.task_column ?? null,
          metadata: input.metadata ?? null,
          created_at: '2026-06-24T00:01:00.000Z',
        };
      },
    },
  }));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed to bind');
  baseUrl = `http://127.0.0.1:${address.port}/api/tasks`;
  return { tasks, activities };
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
    server = null;
  }
});

describe('task review and human gate routes', () => {
  beforeEach(() => {
    baseUrl = '';
  });

  it('accepts review only from the assigned eligible reviewer', async () => {
    const { tasks, activities } = await startTestServer();

    const rejected = await fetch(`${baseUrl}/1/review/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'agent-1' },
      body: JSON.stringify({ reason: 'self review attempt' }),
    });
    expect(rejected.status).toBe(403);
    expect(await readJson(rejected)).toMatchObject({ error: 'reviewer_not_eligible' });

    const accepted = await fetch(`${baseUrl}/1/review/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'reviewer-1' },
      body: JSON.stringify({ reason: 'evidence checked' }),
    });
    expect(accepted.status).toBe(200);
    expect(await readJson(accepted)).toMatchObject({
      review: { decision: 'accepted', reviewer_principal_id: 'reviewer-1' },
      task: { review_state: 'accepted' },
    });
    expect(JSON.parse(tasks.get(1)?.metadata ?? '{}')).toMatchObject({
      review_decision: 'accepted',
      review_decided_by: 'reviewer-1',
    });
    expect(activities[0]).toMatchObject({ activity_event_type: 'review_decision' });
  });

  it('requires a human assigned approver for human gate decisions', async () => {
    const { tasks, activities } = await startTestServer();

    const nonHuman = await fetch(`${baseUrl}/1/human-gate/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-entity-actor': 'approver-1',
        'x-entity-actor-type': 'agent',
      },
      body: JSON.stringify({ reason: 'agent cannot approve' }),
    });
    expect(nonHuman.status).toBe(403);
    expect(await readJson(nonHuman)).toMatchObject({ error: 'human_gate_human_approver_required' });

    const wrongHuman = await fetch(`${baseUrl}/1/human-gate/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-entity-actor': 'owner-1',
        'x-entity-actor-type': 'human',
      },
      body: JSON.stringify({ reason: 'wrong approver' }),
    });
    expect(wrongHuman.status).toBe(403);
    expect(await readJson(wrongHuman)).toMatchObject({ error: 'human_gate_approver_not_eligible' });

    const approved = await fetch(`${baseUrl}/1/human-gate/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-entity-actor': 'approver-1',
        'x-entity-actor-type': 'human',
      },
      body: JSON.stringify({ reason: 'approved for send' }),
    });
    expect(approved.status).toBe(200);
    expect(await readJson(approved)).toMatchObject({
      humanGate: { decision: 'approved', approver_principal_id: 'approver-1' },
      task: { human_gate_state: 'approved' },
    });
    expect(JSON.parse(tasks.get(1)?.metadata ?? '{}')).toMatchObject({
      human_gate_decision: 'approved',
      human_gate_decided_by: 'approver-1',
    });
    expect(activities[0]).toMatchObject({ activity_event_type: 'human_gate_decision' });
  });

  it('can request a pending human gate with an audit activity', async () => {
    const { tasks, activities } = await startTestServer(makeTask({
      human_gate_required: false,
      human_gate_state: 'not_required',
    }));

    const requested = await fetch(`${baseUrl}/1/human-gate/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-actor': 'reviewer-1' },
      body: JSON.stringify({ reason: 'external customer commitment' }),
    });

    expect(requested.status).toBe(200);
    expect(await readJson(requested)).toMatchObject({
      humanGate: { decision: 'pending', approver_principal_id: 'approver-1' },
      task: { human_gate_required: true, human_gate_state: 'pending' },
    });
    expect(JSON.parse(tasks.get(1)?.metadata ?? '{}')).toMatchObject({
      human_gate_requested_by: 'reviewer-1',
      human_gate_reason: 'external customer commitment',
    });
    expect(activities[0]).toMatchObject({ activity_event_type: 'human_gate_requested' });
  });
});
