import express from 'express';
import http from 'http';
import { describe, expect, it } from 'vitest';
import type {
  ActivityEventSpineRepository,
  AppendActivityEventSpineInput,
  AppendActivityEventSpineResult,
  ListActivityEventSpineResult,
  StoredActivityEventSpine,
  TaskRecord,
} from '../../db/src';
import {
  createActivitySpineEventRouter,
  createActivitySpineEventService,
} from './activity-spine-events';

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
    name: 'Workplane activity task',
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
    created_at: '2026-07-31T00:00:00.000Z',
    updated_at: '2026-07-31T00:00:00.000Z',
    metadata: null,
    ...overrides,
  };
}

function createMemorySpineRepository(): ActivityEventSpineRepository {
  const byTask = new Map<number, StoredActivityEventSpine[]>();
  let nextId = 1;

  return {
    appendForTask(taskId, input): AppendActivityEventSpineResult {
      if (!Number.isInteger(taskId) || taskId < 1) {
        return { ok: false, reason: 'missing_or_invalid_task_id', degraded: true };
      }
      const eventType =
        typeof input.eventType === 'string' ? input.eventType.trim().toLowerCase() : '';
      const allowed = new Set(['plan', 'progress', 'log', 'proof', 'status', 'blocker']);
      if (!allowed.has(eventType)) {
        return { ok: false, reason: 'unknown_or_missing_event_type', degraded: true };
      }

      const existing = byTask.get(taskId) ?? [];
      const sequence =
        typeof input.sequence === 'number' && Number.isInteger(input.sequence)
          ? input.sequence
          : existing.length;
      if (existing.some((event) => event.sequence === sequence)) {
        return { ok: false, reason: 'duplicate_sequence_for_task', degraded: true };
      }

      const actorType =
        typeof input.actorType === 'string' ? input.actorType : input.actor?.type;
      const principalId =
        typeof input.actorPrincipalId === 'string'
          ? input.actorPrincipalId
          : typeof input.actor?.principalId === 'string'
            ? input.actor.principalId
            : undefined;

      const event: StoredActivityEventSpine = {
        id: nextId++,
        taskId,
        eventType: eventType as StoredActivityEventSpine['eventType'],
        actor: {
          type:
            actorType === 'human' ||
            actorType === 'agent' ||
            actorType === 'system' ||
            actorType === 'workflow'
              ? actorType
              : 'unknown',
          ...(principalId ? { principalId } : {}),
        },
        timestamp: typeof input.timestamp === 'string' ? input.timestamp : '',
        payloadRef: typeof input.payloadRef === 'string' ? input.payloadRef : null,
        payload:
          input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
            ? (input.payload as Record<string, unknown>)
            : {},
        sequence,
        createdAt: `2026-07-31T00:00:0${existing.length}.000Z`,
      };
      existing.push(event);
      byTask.set(taskId, existing);
      return { ok: true, event };
    },

    listForTask(taskId): ListActivityEventSpineResult {
      if (!Number.isInteger(taskId) || taskId < 1) {
        return {
          taskId: 0,
          events: [],
          empty: true,
          degraded: true,
          warnings: [{ code: 'missing_or_invalid_task_id', message: 'bad task id' }],
        };
      }
      const events = [...(byTask.get(taskId) ?? [])].sort((a, b) => a.sequence - b.sequence);
      return {
        taskId,
        events,
        empty: events.length === 0,
        degraded: false,
        warnings: [],
      };
    },

    deleteForTask(taskId) {
      const existing = byTask.get(taskId) ?? [];
      byTask.delete(taskId);
      return existing.length;
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

describe('THE-870 / WP1-C-02 ActivityEvent spine API', () => {
  it('appends and queries task-scoped spine events', async () => {
    const task = makeTask();
    const spineRepository = createMemorySpineRepository();
    const service = createActivitySpineEventService({
      spineRepository,
      getTask: (taskId) => (taskId === task.id ? task : undefined),
    });

    const appended = await service.appendTaskSpineEvent(
      task.id,
      {
        eventType: 'progress',
        actorType: 'agent',
        actorPrincipalId: 'codex-1',
        payload: { pct: 40 },
      } satisfies AppendActivityEventSpineInput,
      { orgId: 'org-a' },
    );
    expect(appended.ok).toBe(true);
    if (!appended.ok) throw new Error(appended.message);

    const queried = await service.queryTaskSpineEvents(task.id, {
      context: { orgId: 'org-a' },
    });
    expect(queried.ok).toBe(true);
    if (!queried.ok) throw new Error(queried.message);
    expect(queried.value.empty).toBe(false);
    expect(queried.value.events).toHaveLength(1);
    expect(queried.value.events[0]).toMatchObject({
      eventType: 'progress',
      actor: { type: 'agent', principalId: 'codex-1' },
      payload: { pct: 40 },
    });
  });

  it('returns explicit empty state for a valid task with no spine events', async () => {
    const task = makeTask();
    const service = createActivitySpineEventService({
      spineRepository: createMemorySpineRepository(),
      getTask: (taskId) => (taskId === task.id ? task : undefined),
    });

    const queried = await service.queryTaskSpineEvents(task.id);
    expect(queried.ok).toBe(true);
    if (!queried.ok) throw new Error(queried.message);
    expect(queried.value).toMatchObject({
      taskId: task.id,
      events: [],
      empty: true,
      degraded: false,
      warnings: [],
    });
  });

  it('fails closed on unknown spine types and cross-org access', async () => {
    const task = makeTask({ org_id: 'org-a' });
    const service = createActivitySpineEventService({
      spineRepository: createMemorySpineRepository(),
      getTask: (taskId) => (taskId === task.id ? task : undefined),
    });

    const unknown = await service.appendTaskSpineEvent(task.id, {
      eventType: 'status_changed',
    });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error('expected failure');
    expect(unknown.code).toBe('unknown_or_missing_event_type');
    expect(unknown.degraded).toBe(true);

    const denied = await service.queryTaskSpineEvents(task.id, {
      context: { orgId: 'org-b' },
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) throw new Error('expected denial');
    expect(denied.status).toBe(403);
    expect(denied.code).toBe('permission_denied');
  });

  it('HTTP GET empty state and POST append path', async () => {
    const task = makeTask();
    const service = createActivitySpineEventService({
      spineRepository: createMemorySpineRepository(),
      getTask: (taskId) => (taskId === task.id ? task : undefined),
    });
    const app = express();
    app.use(express.json());
    app.use(createActivitySpineEventRouter(service));
    const { baseUrl, close } = await listen(app);

    try {
      const emptyResponse = await fetch(`${baseUrl}/tasks/${task.id}/activity-spine-events`);
      expect(emptyResponse.status).toBe(200);
      const emptyBody = (await emptyResponse.json()) as {
        empty: boolean;
        events: unknown[];
      };
      expect(emptyBody.empty).toBe(true);
      expect(emptyBody.events).toEqual([]);

      const postResponse = await fetch(`${baseUrl}/tasks/${task.id}/activity-spine-events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event_type: 'blocker',
          actor_type: 'human',
          actor_principal_id: 'reviewer-1',
          payload: { reason: 'missing proof' },
        }),
      });
      expect(postResponse.status).toBe(201);
      const postBody = (await postResponse.json()) as { event: StoredActivityEventSpine };
      expect(postBody.event.eventType).toBe('blocker');

      const listedResponse = await fetch(`${baseUrl}/tasks/${task.id}/activity-spine-events`);
      const listedBody = (await listedResponse.json()) as {
        empty: boolean;
        events: StoredActivityEventSpine[];
      };
      expect(listedBody.empty).toBe(false);
      expect(listedBody.events).toHaveLength(1);
    } finally {
      await close();
    }
  });
});
