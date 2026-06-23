import express from 'express';
import http from 'http';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_EVENT_PAYLOAD_VERSION,
  ACTIVITY_EVENT_TYPES,
  type ActivityRecord,
  type ActivityRepository,
  type CreateActivityInput,
  type TaskRecord,
} from '../../db/src';
import {
  buildConsumerActivityEventInput,
  buildTaskAgentActionActivityEventInput,
  buildTaskMutationActivityEvent,
  createActivityEventRouter,
  createActivityEventService,
  summarizeActivityEventsForReceipt,
} from './activity-events';

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
    name: 'Prepare review packet',
    description: null,
    brief: null,
    origin_channel: null,
    column: 'doing',
    model: null,
    archived: false,
    assignee: 'Ada',
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
    created_at: '2026-06-23T00:00:00.000Z',
    updated_at: '2026-06-23T00:00:00.000Z',
    metadata: null,
    ...overrides,
  };
}

function createMemoryActivityRepository(): ActivityRepository {
  const records: ActivityRecord[] = [];

  return {
    listActivities: (limit = 100) => records.slice(0, limit),
    listActivitiesByTaskId: (taskId: number, limit = 100) =>
      records.filter((record) => record.task_id === taskId).slice(0, limit),
    createActivity: (input: CreateActivityInput) => {
      const requestedEventType = String(input.activity_event_type ?? '');
      const knownEventType = (ACTIVITY_EVENT_TYPES as readonly string[]).includes(requestedEventType)
        ? requestedEventType
        : 'legacy_event_observed';
      const payload = input.activity_event_payload && typeof input.activity_event_payload === 'object'
        ? input.activity_event_payload
        : { version: ACTIVITY_EVENT_PAYLOAD_VERSION, actor_type: 'unknown' };
      const record: ActivityRecord = {
        id: records.length + 1,
        source: input.source ?? 'task',
        type: input.type,
        activity_event_type: knownEventType as ActivityRecord['activity_event_type'],
        activity_event_payload_version: ACTIVITY_EVENT_PAYLOAD_VERSION,
        activity_event_payload_json: JSON.stringify(payload),
        activity_event_schema_status: input.activity_event_schema_status ?? 'structured',
        activity_event_legacy_type: knownEventType === 'legacy_event_observed' ? requestedEventType : null,
        action: input.action,
        description: input.description,
        agent_name: input.agent_name ?? null,
        agent_emoji: input.agent_emoji ?? null,
        file_path: input.file_path ?? null,
        task_id: input.task_id ?? null,
        task_column: input.task_column ?? null,
        metadata: input.metadata ?? null,
        created_at: `2026-06-23T00:00:0${records.length}.000Z`,
      };
      records.unshift(record);
      return record;
    },
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

describe('ActivityEvent service', () => {
  it('appends and queries permission-safe structured task events', async () => {
    const task = makeTask();
    const activityRepository = createMemoryActivityRepository();
    const service = createActivityEventService({
      activityRepository,
      getTask: (taskId) => (taskId === task.id ? task : undefined),
    });

    const appended = await service.appendTaskEvent(task.id, {
      eventType: 'status_changed',
      action: 'Moved task',
      description: 'Task moved to review.',
      actorPrincipalId: 'user-1',
      actorType: 'human',
      payload: { previous_state: 'doing', new_state: 'review' },
    }, { orgId: 'org-a' });

    expect(appended.ok).toBe(true);
    if (!appended.ok) throw new Error(appended.message);
    expect(appended.value).toMatchObject({
      eventType: 'status_changed',
      actorType: 'human',
      actorPrincipalId: 'user-1',
      degraded: false,
      permissionState: 'visible',
    });

    const queried = await service.queryTaskEvents(task.id, { context: { orgId: 'org-a' } });
    expect(queried.ok).toBe(true);
    if (!queried.ok) throw new Error(queried.message);
    expect(queried.value).toHaveLength(1);
    expect(queried.value[0].payload).toMatchObject({ previous_state: 'doing', new_state: 'review' });
  });

  it('denies cross-org activity queries without returning event content', async () => {
    const task = makeTask({ org_id: 'org-a' });
    const activityRepository = createMemoryActivityRepository();
    activityRepository.createActivity({
      source: 'task',
      type: 'task_updated',
      activity_event_type: 'task_updated',
      activity_event_payload: { version: 1, actor_type: 'human', task_id: task.id },
      action: 'Updated task',
      description: 'Sensitive update',
      task_id: task.id,
    });
    const service = createActivityEventService({
      activityRepository,
      getTask: (taskId) => (taskId === task.id ? task : undefined),
    });

    const result = await service.queryTaskEvents(task.id, { context: { orgId: 'org-b' } });

    expect(result).toEqual({
      ok: false,
      status: 403,
      code: 'permission_denied',
      message: 'activity is restricted for this org scope',
      permissionState: 'hidden',
    });
  });

  it('renders unknown event payloads as degraded legacy envelopes', async () => {
    const task = makeTask();
    const service = createActivityEventService({
      activityRepository: createMemoryActivityRepository(),
      getTask: (taskId) => (taskId === task.id ? task : undefined),
    });

    const result = await service.appendTaskEvent(task.id, {
      eventType: 'vendor_side_event',
      action: 'Imported legacy event',
      description: 'Observed a legacy event name.',
      payload: 'not-an-object',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.value).toMatchObject({
      eventType: 'legacy_event_observed',
      schemaStatus: 'legacy_unknown',
      legacyType: 'vendor_side_event',
      degraded: true,
    });
    expect(result.value.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['legacy_unknown']),
    );
  });

  it('preserves consumer object refs so receipts can cite canonical evidence artifacts', async () => {
    const task = makeTask();
    const service = createActivityEventService({
      activityRepository: createMemoryActivityRepository(),
      getTask: (taskId) => (taskId === task.id ? task : undefined),
    });

    const result = await service.appendTaskEvent(
      task.id,
      buildConsumerActivityEventInput({
        consumer: 'receipt',
        eventType: 'receipt_created',
        action: 'Receipt created',
        description: 'Canonical task receipt was written.',
        actorPrincipalId: 'agent-1',
        actorType: 'agent',
        objectRefs: [
          { object_type: 'evidence_artifact', object_id: 'receipt-42', link_role: 'receipt' },
        ],
        data: { content_hash: 'sha256:test' },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.value.eventType).toBe('receipt_created');
    expect(result.value.objectRefs).toEqual([
      { object_type: 'task', object_id: String(task.id), link_role: 'origin' },
      { object_type: 'evidence_artifact', object_id: 'receipt-42', link_role: 'receipt' },
    ]);
  });

  it('summarizes routing, review, human gate, notification, and receipt consumers for receipt generation', async () => {
    const task = makeTask();
    const activityRepository = createMemoryActivityRepository();
    const service = createActivityEventService({
      activityRepository,
      getTask: (taskId) => (taskId === task.id ? task : undefined),
    });

    for (const input of [
      buildConsumerActivityEventInput({
        consumer: 'routing',
        eventType: 'nudge_sent',
        action: 'Nudge sent',
        description: 'Asked assignee for an update.',
      }),
      buildConsumerActivityEventInput({
        consumer: 'review',
        eventType: 'review_decision',
        action: 'Review accepted',
        description: 'Reviewer accepted the proof packet.',
      }),
      buildConsumerActivityEventInput({
        consumer: 'review',
        eventType: 'human_gate_decision',
        action: 'Gate approved',
        description: 'Human approver accepted the external-send gate.',
      }),
      buildConsumerActivityEventInput({
        consumer: 'notification',
        eventType: 'notification_routed',
        action: 'Notification routed',
        description: 'Entity inbox notification preserved the review request.',
      }),
      buildConsumerActivityEventInput({
        consumer: 'receipt',
        eventType: 'receipt_created',
        action: 'Receipt created',
        description: 'Canonical receipt was created.',
      }),
    ]) {
      const result = await service.appendTaskEvent(task.id, input);
      expect(result.ok).toBe(true);
    }

    const queried = await service.queryTaskEvents(task.id);
    expect(queried.ok).toBe(true);
    if (!queried.ok) throw new Error(queried.message);

    const summary = summarizeActivityEventsForReceipt(queried.value);
    expect(summary.routingHistory.map((entry) => entry.eventType)).toContain('nudge_sent');
    expect(summary.reviewHistory.map((entry) => entry.eventType)).toContain('review_decision');
    expect(summary.humanGateHistory.map((entry) => entry.eventType)).toContain('human_gate_decision');
    expect(summary.notificationHistory.map((entry) => entry.eventType)).toContain('notification_routed');
    expect(summary.receiptArtifacts.map((entry) => entry.eventType)).toContain('receipt_created');
    expect(summary.missingConsumers).toEqual([]);
  });

  it('maps TaskAgent review, routing, and notification actions to canonical consumer events', () => {
    expect(
      buildTaskAgentActionActivityEventInput({
        event: 'review_check',
        taskId: 42,
        action: 'classify_review_output',
        result: 'implementation VALID 92/100',
        tokensUsed: 0,
      })?.eventType,
    ).toBe('review_decision');

    expect(
      buildTaskAgentActionActivityEventInput({
        event: 'stale_scan',
        taskId: 42,
        action: 'escalate_blocker',
        result: 'blocked with no owner response',
        tokensUsed: 0,
      })?.eventType,
    ).toBe('owner_escalated');

    expect(
      buildTaskAgentActionActivityEventInput({
        event: 'output_missing',
        taskId: 42,
        action: 'request_output',
        result: 'requested output from assignee',
        tokensUsed: 0,
      })?.eventType,
    ).toBe('notification_routed');
  });

  it('classifies task mutation paths into ActivityEvent types', () => {
    const previous = makeTask({ column: 'doing', assignee: 'Ada', assignment_state: 'assigned' });

    expect(buildTaskMutationActivityEvent({ action: 'create', task: previous }).eventType).toBe('task_created');
    expect(
      buildTaskMutationActivityEvent({
        action: 'update',
        previousTask: previous,
        task: makeTask({ column: 'doing', assignee: 'Grace', assignment_state: 'assigned' }),
      }).eventType,
    ).toBe('assignment_changed');
    expect(
      buildTaskMutationActivityEvent({
        action: 'move',
        previousTask: previous,
        task: makeTask({ column: 'review' }),
      }).eventType,
    ).toBe('status_changed');
    expect(
      buildTaskMutationActivityEvent({
        action: 'update',
        previousTask: previous,
        task: makeTask({ column: 'done' }),
      }).eventType,
    ).toBe('completion_accepted');
  });
});

describe('ActivityEvent API routes', () => {
  it('returns permission-denial envelopes for scoped activity API reads', async () => {
    const task = makeTask({ org_id: 'org-a' });
    const service = createActivityEventService({
      activityRepository: createMemoryActivityRepository(),
      getTask: (taskId) => (taskId === task.id ? task : undefined),
    });
    const app = express();
    app.use(express.json());
    app.use('/api', createActivityEventRouter(service));
    const server = await listen(app);

    try {
      const response = await fetch(`${server.baseUrl}/api/tasks/${task.id}/activity-events`, {
        headers: { 'x-entity-org-id': 'org-b' },
      });
      expect(response.status).toBe(403);
      const body = await response.json() as { error: string; permissionState: string; events?: unknown[] };
      expect(body).toMatchObject({ error: 'permission_denied', permissionState: 'hidden' });
      expect(body.events).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
