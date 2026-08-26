import { describe, expect, it, vi } from 'vitest';
import type {
  CreateNotificationInput,
  NotificationRecord,
  NotificationRepository,
  TaskRecord,
} from '../../db/src';
import type { NotificationRoutingInput, NotificationRoutingResult } from './notification-routing';
import {
  DEFAULT_DUE_REMINDER_STAGES,
  createDueReminderScheduler,
  isTaskOpenForReminders,
  reminderEventId,
  scanDueDateReminders,
  stageForDueDate,
} from './due-reminders';

const NOW = new Date('2026-08-25T12:00:00.000Z');

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 101,
    org_id: 'curacel',
    team_id: 'pilot',
    project_id: null,
    name: 'Follow up KRCL renewal',
    description: null,
    brief: null,
    origin_channel: null,
    column: 'todo',
    model: null,
    archived: false,
    assignee: 'sam',
    blocked: false,
    blocker_reason: null,
    due_date: '2026-08-25T18:00:00.000Z',
    priority: 'P1',
    estimate_hours: null,
    time_spent: 0,
    output: null,
    progress_status: 'backlog',
    recurring: false,
    recurring_config: null,
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T00:00:00.000Z',
    metadata: null,
    ...overrides,
  } as TaskRecord;
}

function createMemoryNotificationRepository(seed: NotificationRecord[] = []): NotificationRepository {
  const notifications = new Map<string, NotificationRecord>(seed.map((n) => [n.id, n]));
  let counter = seed.length;
  return {
    createNotification: (input: CreateNotificationInput) => {
      counter += 1;
      const record: NotificationRecord = {
        id: input.id ?? `notification-${counter}`,
        org_id: input.org_id ?? 'default-org',
        recipient_principal_id: input.recipient_principal_id,
        canonical_event_id: String(input.canonical_event_id),
        object_ref: input.object_ref,
        notification_type: input.notification_type as NotificationRecord['notification_type'],
        inbox_state: 'unread',
        title: input.title,
        body: input.body ?? '',
        policy_reason_chain_json: input.policy_reason_chain_json ?? '[]',
        metadata_json: input.metadata_json ?? '{}',
        created_at: NOW.toISOString(),
        updated_at: NOW.toISOString(),
        deliveries: [],
      };
      notifications.set(record.id, record);
      return record;
    },
    getNotification: (id) => notifications.get(id),
    listNotificationsForRecipient: (input) =>
      [...notifications.values()].filter(
        (n) =>
          n.recipient_principal_id === input.recipient_principal_id &&
          (!input.org_id || n.org_id === input.org_id)
      ),
    updateInboxState: (id) => notifications.get(id),
    addDeliveryAttempt: () => {
      throw new Error('not used in these tests');
    },
    listDeliveryAttempts: () => [],
  };
}

function makeRoutingCapture(repo: NotificationRepository) {
  const routed: NotificationRoutingInput[] = [];
  return {
    routed,
    service: {
      routeNotification: async (input: NotificationRoutingInput): Promise<NotificationRoutingResult> => {
        routed.push(input);
        const notification = repo.createNotification({
          org_id: input.orgId,
          recipient_principal_id: input.recipientPrincipalId,
          canonical_event_id: input.canonicalEventId,
          object_ref: input.objectRef,
          notification_type: 'task_nudge',
          title: input.title,
          body: input.body ?? '',
        });
        return { notification, deliveries: [], selectedChannels: [] };
      },
    },
  };
}

describe('stageForDueDate', () => {
  it('classifies a task due within 24h as due-soon', () => {
    expect(stageForDueDate('2026-08-25T18:00:00.000Z', NOW)?.kind).toBe('due-soon');
  });

  it('classifies a past-due task within 7 days as overdue', () => {
    expect(stageForDueDate('2026-08-24T12:00:00.000Z', NOW)?.kind).toBe('overdue');
  });

  it('ignores tasks due farther than 24h out', () => {
    expect(stageForDueDate('2026-08-28T12:00:00.000Z', NOW)).toBeNull();
  });

  it('ignores tasks overdue by more than 7 days', () => {
    expect(stageForDueDate('2026-08-01T12:00:00.000Z', NOW)).toBeNull();
  });

  it('ignores unparseable due dates', () => {
    expect(stageForDueDate('not-a-date', NOW)).toBeNull();
  });
});

describe('isTaskOpenForReminders', () => {
  it('includes open columns', () => {
    for (const column of ['backlog', 'todo', 'doing', 'review'] as const) {
      expect(isTaskOpenForReminders({ column, archived: false })).toBe(true);
    }
  });

  it('excludes done and archived tasks', () => {
    expect(isTaskOpenForReminders({ column: 'done', archived: false })).toBe(false);
    expect(isTaskOpenForReminders({ column: 'todo', archived: true })).toBe(false);
  });
});

describe('scanDueDateReminders', () => {
  it('creates a due-soon notification for the assignee', async () => {
    const repo = createMemoryNotificationRepository();
    const { service, routed } = makeRoutingCapture(repo);
    const result = await scanDueDateReminders({
      notificationRepository: repo,
      routingService: service,
      listTasks: () => [makeTask()],
      now: () => NOW,
    });

    expect(result.createdNotifications).toBe(1);
    expect(result.errors).toEqual([]);
    expect(routed[0]).toMatchObject({
      recipientPrincipalId: 'sam',
      canonicalEventId: 'due-reminder:101:due-soon:2026-08-25T18:00:00.000Z',
      notificationType: 'task_nudge',
      urgency: 'normal',
    });
    expect(repo.listNotificationsForRecipient({ recipient_principal_id: 'sam' })).toHaveLength(1);
  });

  it('notifies initiator and owner in addition to assignee, deduped by principal', async () => {
    const repo = createMemoryNotificationRepository();
    const { service, routed } = makeRoutingCapture(repo);
    const task = makeTask({
      assignee: 'sam',
      executor_principal_id: 'sam',
      owner_principal_id: 'ada',
      initiator_principal_id: 'ada',
    });
    const result = await scanDueDateReminders({
      notificationRepository: repo,
      routingService: service,
      listTasks: () => [task],
      now: () => NOW,
    });

    const recipients = routed.map((r) => r.recipientPrincipalId).sort();
    expect(recipients).toEqual(['ada', 'sam']);
    expect(result.createdNotifications).toBe(2);
  });

  it('is idempotent across repeated scans', async () => {
    const repo = createMemoryNotificationRepository();
    const { service } = makeRoutingCapture(repo);
    const deps = {
      notificationRepository: repo,
      routingService: service,
      listTasks: () => [makeTask()],
      now: () => NOW,
    };
    await scanDueDateReminders(deps);
    const second = await scanDueDateReminders(deps);

    expect(second.createdNotifications).toBe(0);
    expect(second.skippedDuplicate).toBe(1);
    expect(repo.listNotificationsForRecipient({ recipient_principal_id: 'sam' })).toHaveLength(1);
  });

  it('re-notifies when the due date changes', async () => {
    const repo = createMemoryNotificationRepository();
    const { service } = makeRoutingCapture(repo);
    const deps = {
      notificationRepository: repo,
      routingService: service,
      listTasks: () => [makeTask({ due_date: '2026-08-25T18:00:00.000Z' })],
      now: () => NOW,
    };
    await scanDueDateReminders(deps);
    const moved = {
      ...deps,
      listTasks: () => [makeTask({ due_date: '2026-08-25T14:00:00.000Z' })],
    };
    const second = await scanDueDateReminders(moved);
    expect(second.createdNotifications).toBe(1);
    expect(repo.listNotificationsForRecipient({ recipient_principal_id: 'sam' })).toHaveLength(2);
  });

  it('marks overdue tasks with high urgency and overdue wording', async () => {
    const repo = createMemoryNotificationRepository();
    const { service, routed } = makeRoutingCapture(repo);
    await scanDueDateReminders({
      notificationRepository: repo,
      routingService: service,
      listTasks: () => [makeTask({ due_date: '2026-08-24T12:00:00.000Z', column: 'doing' })],
      now: () => NOW,
    });

    expect(routed[0]).toMatchObject({
      canonicalEventId: 'due-reminder:101:overdue:2026-08-24T12:00:00.000Z',
      urgency: 'high',
    });
    expect(String(routed[0].title)).toMatch(/^Overdue:/);
  });

  it('skips done, archived, undated, and out-of-window tasks', async () => {
    const repo = createMemoryNotificationRepository();
    const { service } = makeRoutingCapture(repo);
    const result = await scanDueDateReminders({
      notificationRepository: repo,
      routingService: service,
      listTasks: () => [
        makeTask({ id: 1, column: 'done' }),
        makeTask({ id: 2, archived: true }),
        makeTask({ id: 3, due_date: null }),
        makeTask({ id: 4, due_date: '2026-09-15T12:00:00.000Z' }),
      ],
      now: () => NOW,
    });

    expect(result.consideredTasks).toBe(0);
    expect(result.createdNotifications).toBe(0);
  });

  it('counts tasks with no notifiable recipients separately', async () => {
    const repo = createMemoryNotificationRepository();
    const { service } = makeRoutingCapture(repo);
    const result = await scanDueDateReminders({
      notificationRepository: repo,
      routingService: service,
      listTasks: () => [makeTask({ assignee: null, executor_principal_id: null, owner_principal_id: null, initiator_principal_id: null })],
      now: () => NOW,
    });

    expect(result.skippedNoRecipient).toBe(1);
    expect(result.createdNotifications).toBe(0);
  });

  it('isolates dedupe per recipient', async () => {
    const repo = createMemoryNotificationRepository();
    const { service } = makeRoutingCapture(repo);
    const task = makeTask({ assignee: 'sam', owner_principal_id: 'ada' });
    await scanDueDateReminders({
      notificationRepository: repo,
      routingService: service,
      listTasks: () => [task],
      now: () => NOW,
    });
    // Second scan: both already notified -> 2 dupes.
    const second = await scanDueDateReminders({
      notificationRepository: repo,
      routingService: service,
      listTasks: () => [task],
      now: () => NOW,
    });
    expect(second.skippedDuplicate).toBe(2);
    expect(second.createdNotifications).toBe(0);
  });
});

describe('createDueReminderScheduler', () => {
  it('runs a scan on start and exposes tick for manual runs', async () => {
    const repo = createMemoryNotificationRepository();
    const { service } = makeRoutingCapture(repo);
    const scheduler = createDueReminderScheduler({
      notificationRepository: repo,
      routingService: service,
      listTasks: () => [makeTask()],
      now: () => NOW,
      intervalMs: 60_000,
    });
    scheduler.start();
    // Initial scan runs async on start(); poll until it lands (real timers).
    await vi.waitFor(() => {
      expect(repo.listNotificationsForRecipient({ recipient_principal_id: 'sam' })).toHaveLength(1);
    });
    // Manual interval ticks do not duplicate the notification.
    await scheduler.tick();
    await scheduler.tick();
    expect(repo.listNotificationsForRecipient({ recipient_principal_id: 'sam' })).toHaveLength(1);
    scheduler.stop();
  });

  it('does not run concurrent scans', async () => {
    const repo = createMemoryNotificationRepository();
    const { service } = makeRoutingCapture(repo);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    const slowList = async () => {
      entered += 1;
      await gate;
      return [makeTask()];
    };
    const scheduler = createDueReminderScheduler({
      notificationRepository: repo,
      routingService: service,
      listTasks: slowList,
      now: () => NOW,
      intervalMs: 1_000,
    });
    const first = scheduler.tick();
    const second = await scheduler.tick();
    expect(second.errors[0]).toMatch(/already in progress/);
    release();
    const firstResult = await first;
    expect(firstResult.createdNotifications).toBe(1);
    expect(entered).toBe(1);
    scheduler.stop();
  });
});

describe('reminderEventId', () => {
  it('formats canonical event ids used for dedupe', () => {
    expect(reminderEventId(101, 'overdue', '2026-08-24T12:00:00.000Z')).toBe('due-reminder:101:overdue:2026-08-24T12:00:00.000Z');
  });

  it('default stages cover due-soon and overdue', () => {
    expect(DEFAULT_DUE_REMINDER_STAGES.map((s) => s.kind).sort()).toEqual(['due-soon', 'overdue']);
  });
});
