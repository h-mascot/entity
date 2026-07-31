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
      includeAdapted: false,
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

    // Stored-only empty (THE-870). THE-872 adapters may still project task snapshot.
    const queried = await service.queryTaskSpineEvents(task.id, {
      includeAdapted: false,
    });
    expect(queried.ok).toBe(true);
    if (!queried.ok) throw new Error(queried.message);
    expect(queried.value).toMatchObject({
      taskId: task.id,
      events: [],
      empty: true,
      degraded: false,
      warnings: [],
      includeAdapted: false,
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
      const emptyResponse = await fetch(
        `${baseUrl}/tasks/${task.id}/activity-spine-events?includeAdapted=0`,
      );
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

      const listedResponse = await fetch(
        `${baseUrl}/tasks/${task.id}/activity-spine-events?includeAdapted=0`,
      );
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

describe('THE-872 / WP1-C-04 ActivityEvent spine read-path adapters', () => {
  it('merges adapted task/activity/swarm signals into GET query', async () => {
    const task = makeTask({
      progress_status: 'working',
      output: 'output/proof.md',
      blocked: true,
      blocker_reason: 'needs review',
    });
    const service = createActivitySpineEventService({
      spineRepository: createMemorySpineRepository(),
      getTask: (taskId) => (taskId === task.id ? task : undefined),
      listActivityEventsForTask: () => [
        {
          id: 101,
          task_id: task.id,
          activity_event_type: 'artifact_linked',
          action: 'link',
          description: 'Linked artifact',
          created_at: '2026-07-31T04:00:00.000Z',
          activity_event_schema_status: 'structured',
          file_path: 'output/artifact.json',
        },
      ],
      listSwarmJobsForTask: () => [
        {
          id: 'swarm-872',
          task_id: task.id,
          status: 'running',
          provider: 'symphony',
          title: 'Adapter wiring',
          updated_at: '2026-07-31T05:00:00.000Z',
        },
      ],
    });

    const queried = await service.queryTaskSpineEvents(task.id);
    expect(queried.ok).toBe(true);
    if (!queried.ok) throw new Error(queried.message);
    expect(queried.value.includeAdapted).toBe(true);
    expect(queried.value.empty).toBe(false);
    expect(queried.value.adaptedCount).toBeGreaterThan(0);
    expect(queried.value.events.some((event) => event.eventType === 'status')).toBe(true);
    expect(queried.value.events.some((event) => event.eventType === 'progress')).toBe(true);
    expect(queried.value.events.some((event) => event.eventType === 'proof')).toBe(true);
    expect(queried.value.events.some((event) => event.eventType === 'blocker')).toBe(true);
    expect(
      queried.value.events.some(
        (event) => 'sourceId' in event && event.sourceId === 'activity_event:101',
      ),
    ).toBe(true);
    expect(
      queried.value.events.some(
        (event) => 'sourceId' in event && event.sourceId === 'swarm_job:swarm-872',
      ),
    ).toBe(true);
  });

  it('supports stored-only mode and fail-closed unavailable feeds', async () => {
    const task = makeTask({ progress_status: null, output: null });
    const spineRepository = createMemorySpineRepository();
    await createActivitySpineEventService({
      spineRepository,
      getTask: (taskId) => (taskId === task.id ? task : undefined),
    }).appendTaskSpineEvent(task.id, {
      eventType: 'log',
      payload: { summary: 'stored only' },
      timestamp: '2026-07-31T00:00:00.000Z',
    });

    const service = createActivitySpineEventService({
      spineRepository,
      getTask: (taskId) => (taskId === task.id ? task : undefined),
      listActivityEventsForTask: () => {
        throw new Error('feed down');
      },
      listSwarmJobsForTask: () => {
        throw new Error('swarm down');
      },
    });

    const storedOnly = await service.queryTaskSpineEvents(task.id, {
      includeAdapted: false,
    });
    expect(storedOnly.ok).toBe(true);
    if (!storedOnly.ok) throw new Error(storedOnly.message);
    expect(storedOnly.value.includeAdapted).toBe(false);
    expect(storedOnly.value.events).toHaveLength(1);
    expect(storedOnly.value.adaptedCount).toBe(0);

    const degraded = await service.queryTaskSpineEvents(task.id, {
      includeAdapted: true,
    });
    expect(degraded.ok).toBe(true);
    if (!degraded.ok) throw new Error(degraded.message);
    expect(degraded.value.degraded).toBe(true);
    expect(
      degraded.value.warnings.some((w) => w.code === 'adapter_activity_events_unavailable'),
    ).toBe(true);
    expect(
      degraded.value.warnings.some((w) => w.code === 'adapter_swarm_jobs_unavailable'),
    ).toBe(true);
    // Stored row still present; task snapshot still adapts column status.
    expect(degraded.value.storedCount).toBe(1);
    expect(degraded.value.events.some((event) => event.eventType === 'status')).toBe(true);
  });

  it('HTTP GET includes adapted metadata by default', async () => {
    const task = makeTask({ progress_status: 'working', output: null, blocked: false });
    const service = createActivitySpineEventService({
      spineRepository: createMemorySpineRepository(),
      getTask: (taskId) => (taskId === task.id ? task : undefined),
      listActivityEventsForTask: () => [],
      listSwarmJobsForTask: () => [],
    });
    const app = express();
    app.use(express.json());
    app.use(createActivitySpineEventRouter(service));
    const { baseUrl, close } = await listen(app);

    try {
      const response = await fetch(`${baseUrl}/tasks/${task.id}/activity-spine-events`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        includeAdapted: boolean;
        adaptedCount: number;
        empty: boolean;
        events: Array<{ eventType: string; adapted?: boolean }>;
      };
      expect(body.includeAdapted).toBe(true);
      expect(body.adaptedCount).toBeGreaterThan(0);
      expect(body.empty).toBe(false);
      expect(body.events.some((event) => event.adapted === true)).toBe(true);

      const raw = await fetch(
        `${baseUrl}/tasks/${task.id}/activity-spine-events?includeAdapted=0`,
      );
      const rawBody = (await raw.json()) as {
        includeAdapted: boolean;
        adaptedCount: number;
        events: unknown[];
      };
      expect(rawBody.includeAdapted).toBe(false);
      expect(rawBody.adaptedCount).toBe(0);
      expect(rawBody.events).toEqual([]);
    } finally {
      await close();
    }
  });
});
