/**
 * MC #1370 — due-date notifications and reminders.
 *
 * The notification stack (repository, routing service, inbox routes, bell UI)
 * existed but nothing produced notifications from task due dates, so the bell
 * stayed empty. This module scans open tasks with due dates and creates
 * `task_nudge` notifications per recipient (assignee first, initiator and
 * owner as escalation recipients) through the canonical routing service.
 *
 * Dedupe is by canonical_event_id: `due-reminder:{taskId}:{kind}:{dueDate}` —
 * one notification per task per reminder kind per due date, so scheduler
 * retries and restarts are idempotent while a moved due date re-notifies.
 */

import type {
  NotificationRecord,
  NotificationRepository,
  TaskRecord,
} from '../../db/src';
import type { NotificationRoutingInput, NotificationRoutingResult } from './notification-routing';

export type DueReminderRoutingService = {
  routeNotification: (input: NotificationRoutingInput) => Promise<NotificationRoutingResult>;
};

export type DueReminderKind = 'due-soon' | 'overdue';

export interface DueReminderStage {
  kind: DueReminderKind;
  /** inclusive lower bound in hours, relative to now */
  fromHours: number;
  /** exclusive upper bound in hours; tasks beyond this are not reminded */
  toHours: number | null;
  urgency: 'normal' | 'high';
}

export const DEFAULT_DUE_REMINDER_STAGES: DueReminderStage[] = [
  // hoursUntilDue > 0 means still in the future.
  { kind: 'due-soon', fromHours: 0, toHours: 24, urgency: 'normal' },
  { kind: 'overdue', fromHours: -168, toHours: 0, urgency: 'high' },
];

export function reminderEventId(
  taskId: number | string,
  kind: DueReminderKind,
  dueDate: string
): string {
  const dueMs = Date.parse(dueDate);
  const dueKey = Number.isFinite(dueMs) ? new Date(dueMs).toISOString() : dueDate;
  return `due-reminder:${taskId}:${kind}:${dueKey}`;
}

const TASK_OPEN_COLUMNS = new Set(['backlog', 'todo', 'doing', 'review']);

export function isTaskOpenForReminders(task: Pick<TaskRecord, 'column' | 'archived'>): boolean {
  return !task.archived && TASK_OPEN_COLUMNS.has(task.column);
}

function recipientCandidates(task: TaskRecord): { principalId: string; role: string }[] {
  const recipients: { principalId: string; role: string }[] = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined, role: string) => {
    const principalId = typeof value === 'string' ? value.trim() : '';
    if (!principalId || seen.has(principalId)) return;
    seen.add(principalId);
    recipients.push({ principalId, role });
  };
  push(task.assignee, 'assignee');
  push(task.executor_principal_id, 'executor');
  push(task.owner_principal_id, 'owner');
  push(task.initiator_principal_id, 'initiator');
  return recipients;
}

export function stageForDueDate(
  dueDate: string,
  now: Date = new Date(),
  stages: DueReminderStage[] = DEFAULT_DUE_REMINDER_STAGES
): DueReminderStage | null {
  const dueMs = Date.parse(dueDate);
  if (!Number.isFinite(dueMs)) return null;
  const hoursUntilDue = (dueMs - now.getTime()) / 3_600_000;
  for (const stage of stages) {
    if (hoursUntilDue >= stage.fromHours && (stage.toHours === null || hoursUntilDue < stage.toHours)) {
      return stage;
    }
  }
  return null;
}

function formatDueDate(dueDate: string): string {
  const ms = Date.parse(dueDate);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : dueDate;
}

export interface DueReminderScanDeps {
  notificationRepository: NotificationRepository;
  routingService: DueReminderRoutingService;
  listTasks: () => TaskRecord[] | Promise<TaskRecord[]>;
  stages?: DueReminderStage[];
  now?: () => Date;
}

export interface DueReminderScanResult {
  scannedTasks: number;
  consideredTasks: number;
  createdNotifications: number;
  skippedDuplicate: number;
  skippedNoRecipient: number;
  errors: string[];
  created: Array<{ taskId: number; recipientPrincipalId: string; kind: DueReminderKind; notificationId: string }>;
}

interface NotificationRoutingInputLike {
  orgId?: string;
  recipientPrincipalId: string;
  canonicalEventId: string;
  notificationType: 'task_nudge';
  title: string;
  body: string;
  urgency: 'normal' | 'high';
  objectRef: { object_type: string; object_id: string; link_role: string };
  metadata: Record<string, unknown>;
}

function hasAlreadyNotified(
  notificationRepository: NotificationRepository,
  orgId: string,
  recipientPrincipalId: string,
  canonicalEventId: string
): boolean {
  return notificationRepository
    .listNotificationsForRecipient({
      org_id: orgId,
      recipient_principal_id: recipientPrincipalId,
      inbox_state: 'all',
      limit: 1000,
    })
    .some((notification: NotificationRecord) => notification.canonical_event_id === canonicalEventId);
}

export async function scanDueDateReminders(deps: DueReminderScanDeps): Promise<DueReminderScanResult> {
  const stages = deps.stages ?? DEFAULT_DUE_REMINDER_STAGES;
  const now = deps.now ?? (() => new Date());
  const result: DueReminderScanResult = {
    scannedTasks: 0,
    consideredTasks: 0,
    createdNotifications: 0,
    skippedDuplicate: 0,
    skippedNoRecipient: 0,
    errors: [],
    created: [],
  };

  const tasks = await deps.listTasks();

  for (const task of tasks) {
    result.scannedTasks += 1;
    if (!isTaskOpenForReminders(task)) continue;
    if (!task.due_date) continue;

    const stage = stageForDueDate(task.due_date, now(), stages);
    if (!stage) continue;

    result.consideredTasks += 1;
    const eventId = reminderEventId(task.id, stage.kind, task.due_date);
    const recipients = recipientCandidates(task);
    if (recipients.length === 0) {
      result.skippedNoRecipient += 1;
      continue;
    }

    const overdue = stage.kind === 'overdue';
    const title = overdue
      ? `Overdue: ${task.name}`
      : `Due soon: ${task.name}`;
    const body = overdue
      ? `"${task.name}" was due ${formatDueDate(task.due_date)} and is still in ${task.column}.`
      : `"${task.name}" is due ${formatDueDate(task.due_date)} (column: ${task.column}).`;

    for (const recipient of recipients) {
      try {
        const orgId = task.org_id ?? 'default-org';
        if (hasAlreadyNotified(deps.notificationRepository, orgId, recipient.principalId, eventId)) {
          result.skippedDuplicate += 1;
          continue;
        }
        const routed = await deps.routingService.routeNotification({
          orgId,
          recipientPrincipalId: recipient.principalId,
          canonicalEventId: eventId,
          notificationType: 'task_nudge',
          title,
          body,
          urgency: stage.urgency,
          objectRef: { object_type: 'task', object_id: String(task.id), link_role: 'target' },
          metadata: {
            reminder_kind: stage.kind,
            due_date: task.due_date,
            task_column: task.column,
            task_priority: task.priority ?? null,
            recipient_role: recipient.role,
            hours_until_due: Math.round(((Date.parse(task.due_date) || 0) - now().getTime()) / 3_600_000),
          },
        } satisfies NotificationRoutingInputLike);
        result.createdNotifications += 1;
        result.created.push({
          taskId: task.id,
          recipientPrincipalId: recipient.principalId,
          kind: stage.kind,
          notificationId: routed.notification.id,
        });
      } catch (err) {
        result.errors.push(
          `task ${task.id} recipient ${recipient.principalId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return result;
}

export interface DueReminderScheduler {
  start(): void;
  stop(): void;
  tick(): Promise<DueReminderScanResult>;
}

export function createDueReminderScheduler(
  deps: DueReminderScanDeps & { intervalMs?: number }
): DueReminderScheduler {
  const intervalMs = deps.intervalMs ?? 15 * 60 * 1000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function tick(): Promise<DueReminderScanResult> {
    if (running) {
      return {
        scannedTasks: 0,
        consideredTasks: 0,
        createdNotifications: 0,
        skippedDuplicate: 0,
        skippedNoRecipient: 0,
        errors: ['scan already in progress; skipped'],
        created: [],
      };
    }
    running = true;
    try {
      return await scanDueDateReminders(deps);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        tick().catch((err) => {
          console.error('[due-reminders] scan failed:', err instanceof Error ? err.message : String(err));
        });
      }, intervalMs);
      timer.unref?.();
      void tick().catch((err) => {
        console.error('[due-reminders] initial scan failed:', err instanceof Error ? err.message : String(err));
      });
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tick,
  };
}

