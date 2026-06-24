import type { TaskRecord } from '../../../db/src';
import {
  formatReviewAssessment,
  getPrimaryReviewReason,
  hasAssignedOwner,
  hasSubstantiveReviewOutput,
  isActiveTaskColumn,
} from './review-policy';
import { getTaskAgentSettings } from './settings';
import type { TaskAgentTools } from './tools';

const RECENT_ACTIVITY_WINDOW_HOURS = 12;

function isTransientBlocker(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return reason.includes('fetch failed') || reason.includes('Agent trigger failed');
}

const OWNERLESS_ACTIVE_TASK_NOTE = '👤 Active task has no owner. Assign an agent before treating this as live work.';
const MISSING_OUTPUT_NOTE =
  '⚠️ Review task is missing output. Add a URL, file path, PR link, or summary before final review.';
const AMBIGUOUS_OUTPUT_NOTE =
  '⚠️ Multiple possible review artifacts were found. Attach the exact deliverable before final review.';
const MOVE_BACK_TO_DOING_NOTE = '↩️ Task Master moved this back to Doing until the review evidence is fixed.';

export interface TaskAgentAction {
  timestamp: string;
  event: string;
  taskId?: number;
  action: string;
  result: string;
  tokensUsed: number;
  details?: Record<string, unknown>;
}

export interface ModelInvocationResult {
  text: string;
  tokensUsed: number;
}

export type ModelInvoker = (prompt: string) => Promise<ModelInvocationResult | null>;

export interface TaskAgentEventContext {
  tools: TaskAgentTools;
  invokeModel: ModelInvoker;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildAction(
  event: string,
  taskId: number | undefined,
  action: string,
  result: string,
  tokensUsed = 0,
  details?: Record<string, unknown>
): TaskAgentAction {
  return {
    timestamp: nowIso(),
    event,
    taskId,
    action,
    result,
    tokensUsed: Number.isFinite(tokensUsed) && tokensUsed > 0 ? Math.floor(tokensUsed) : 0,
    details,
  };
}

function toHoursSince(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.max(0, (Date.now() - parsed) / (60 * 60 * 1000));
}

function parseTaskMetadata(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata?.trim()) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readRoutingProjection(task: TaskRecord): Record<string, unknown> {
  const metadata = parseTaskMetadata(task.metadata);
  const projection = metadata.routing_policy_projection;
  return projection && typeof projection === 'object' && !Array.isArray(projection)
    ? projection as Record<string, unknown>
    : {};
}

function isAutoReassignEligible(task: TaskRecord, hoursInColumn: number): boolean {
  const projection = readRoutingProjection(task);
  const threshold = projection.auto_reassign_after_hours;
  return projection.auto_reassign_eligible === true &&
    typeof threshold === 'number' &&
    Number.isFinite(threshold) &&
    threshold > 0 &&
    hoursInColumn >= threshold;
}

function isIndividualOwner(task: TaskRecord): boolean {
  const owner = task.owner_principal_id?.trim();
  return Boolean(owner && (task.owner_principal_type === 'human' || task.owner_principal_type === 'agent'));
}

function buildReassignmentMetadata(task: TaskRecord, audit: Record<string, unknown>): string {
  const metadata = parseTaskMetadata(task.metadata);
  const previousChain = Array.isArray(metadata.taskmaster_reassignment_chain)
    ? metadata.taskmaster_reassignment_chain.filter((entry) => entry && typeof entry === 'object')
    : [];
  const summary = [
    `prior assignee=${audit.prior_assignee ?? 'not recorded'}`,
    `new assignee=${audit.new_assignee_principal_id ?? 'not recorded'}`,
    `prior executor=${audit.prior_executor_principal_id ?? 'not recorded'}`,
    `final executor=${audit.final_executor_principal_id ?? 'not recorded'}`,
    `reason=${audit.policy_reason ?? 'not recorded'}`,
    `actor=${audit.actor_principal_id ?? 'not recorded'}`,
  ].join('; ');

  return JSON.stringify({
    ...metadata,
    reassignments: summary,
    taskmaster_reassignment_chain: [...previousChain, audit],
  });
}

async function generateNudgeMessage(
  context: TaskAgentEventContext,
  task: TaskRecord,
  hoursInColumn: number
): Promise<ModelInvocationResult | null> {
  const prompt = [
    'You are TaskAgent for a kanban board.',
    'Write one concise follow-up message for the assignee.',
    'Keep it under 180 characters and include a concrete request for the next step.',
    `Task: ${task.name}`,
    `Column: ${task.column}`,
    `Hours stale: ${hoursInColumn.toFixed(1)}`,
    `Blocked: ${task.blocked ? `yes (${task.blocker_reason ?? 'no reason provided'})` : 'no'}`,
  ].join('\n');

  return context.invokeModel(prompt);
}
async function tryAutoAttachOutput(
  task: TaskRecord,
  candidates: readonly string[],
  context: TaskAgentEventContext
): Promise<{ task: TaskRecord; action: TaskAgentAction } | null> {
  const uniqueCandidates = [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
  if (uniqueCandidates.length !== 1) {
    return null;
  }

  const selected = uniqueCandidates[0];
  const validation = await context.tools.validateArtifactReference(selected);
  if (!validation.accessible || !validation.reviewable) {
    return {
      task,
      action: buildAction('output_missing', task.id, 'reject_output_candidate', validation.detail),
    };
  }

  const updated = await context.tools.updateTask(task.id, { output: selected });
  if (!updated) {
    return {
      task,
      action: buildAction('output_missing', task.id, 'attach_output_failed', `failed to set output to "${selected}"`),
    };
  }

  await context.tools.addNoteOnce(updated.id, `📎 Auto-attached output: ${selected}`);
  return {
    task: updated,
    action: buildAction('output_missing', task.id, 'attach_output', `set output to "${selected}"`),
  };
}

async function notifyTaskAssignee(
  task: TaskRecord,
  message: string,
  context: TaskAgentEventContext
): Promise<{ ok: true; skipped?: boolean } | { ok: false; error: string }> {
  if (!hasAssignedOwner(task.assignee)) {
    return { ok: true, skipped: true };
  }

  try {
    await context.tools.notifyAgent(task.assignee!.trim(), message, task.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown notification failure' };
  }
}

async function notifyTaskOwner(
  task: TaskRecord,
  message: string,
  context: TaskAgentEventContext
): Promise<{ ok: true; skipped?: boolean } | { ok: false; error: string }> {
  const ownerPrincipalId = task.owner_principal_id?.trim();
  if (!ownerPrincipalId) {
    return { ok: true, skipped: true };
  }

  try {
    await context.tools.notifyAgent(ownerPrincipalId, message, task.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown notification failure' };
  }
}

async function noteOwnerlessTask(task: TaskRecord, context: TaskAgentEventContext): Promise<void> {
  if (!isActiveTaskColumn(task.column) || hasAssignedOwner(task.assignee)) {
    return;
  }

  await context.tools.addNoteOnce(task.id, OWNERLESS_ACTIVE_TASK_NOTE);
}

async function reviewTask(
  task: TaskRecord,
  event: 'review_check' | 'review_hygiene',
  context: TaskAgentEventContext
): Promise<TaskAgentAction[]> {
  const actions: TaskAgentAction[] = [];
  let currentTask = task;

  if (!hasAssignedOwner(currentTask.assignee) && isActiveTaskColumn(currentTask.column)) {
    await noteOwnerlessTask(currentTask, context);
    actions.push(buildAction(event, currentTask.id, 'request_owner_assignment', 'active task has no owner'));
  }

  if (!hasSubstantiveReviewOutput(currentTask.output)) {
    actions.push(buildAction(event, currentTask.id, 'check_output', 'task is missing substantive review output'));
    const recoveryActions = await onOutputMissing(currentTask, context);
    actions.push(...recoveryActions);

    const refreshed = await context.tools.getTask(currentTask.id);
    if (!refreshed || !hasSubstantiveReviewOutput(refreshed.output)) {
      if (hasAssignedOwner(currentTask.assignee) && currentTask.column === 'review') {
        await context.tools.addNoteOnce(currentTask.id, '⚠️ Moved back to Doing - output required for review.');
        await context.tools.moveTask(currentTask.id, 'doing');
        await notifyTaskAssignee(
          currentTask,
          `Task "${currentTask.name}" was moved back to Doing because review output is still missing.`,
          context
        );
        actions.push(buildAction(event, currentTask.id, 'reject_invalid_output', 'moved back to doing - output still missing'));
      }
      return actions;
    }

    currentTask = refreshed;
  }

  const assessment = await context.tools.assessReview(currentTask);
  actions.push(buildAction(event, currentTask.id, 'classify_review_output', formatReviewAssessment(assessment)));

  if (assessment.verdict === 'INVALID') {
    const reason = getPrimaryReviewReason(assessment);
    if (!assessment.ownershipPresent) {
      await noteOwnerlessTask(currentTask, context);
      actions.push(buildAction(event, currentTask.id, 'request_owner_assignment', reason));
      return actions;
    }

    await context.tools.addNoteOnce(currentTask.id, `⚠️ Review output is invalid: ${reason}`);
    if (currentTask.column === 'review') {
      const moved = await context.tools.moveTask(currentTask.id, 'doing');
      if (moved) {
        await context.tools.addNoteOnce(currentTask.id, MOVE_BACK_TO_DOING_NOTE);
      }
    }
    await notifyTaskAssignee(
      currentTask,
      `Review output for "${currentTask.name}" is invalid: ${reason}`,
      context
    );
    actions.push(buildAction(event, currentTask.id, 'reject_invalid_output', reason));
    return actions;
  }

  if (assessment.verdict === 'WEAK') {
    const reason = getPrimaryReviewReason(assessment);
    await context.tools.addNoteOnce(currentTask.id, `🟡 Review output is weak: ${reason}`);
    await notifyTaskAssignee(
      currentTask,
      `Review output for "${currentTask.name}" is weak: ${reason}`,
      context
    );
    actions.push(buildAction(event, currentTask.id, 'flag_weak_output', reason));
  }

  return actions;
}

export async function onOutputMissing(task: TaskRecord, context: TaskAgentEventContext): Promise<TaskAgentAction[]> {
  const actions: TaskAgentAction[] = [];
  const event = 'output_missing';
  const candidates = await context.tools.discoverOutputCandidates(task);
  actions.push(
    buildAction(event, task.id, 'search_for_output', `discovered ${candidates.length} candidate output reference(s)`)
  );

  if (candidates.length === 1) {
    const attachment = await tryAutoAttachOutput(task, candidates, context);
    if (attachment) {
      actions.push(attachment.action);
      if (attachment.task.output?.trim()) {
        return actions;
      }
    }
  } else if (candidates.length > 1) {
    actions.push(buildAction(event, task.id, 'skip_auto_attach', 'multiple candidate outputs found'));
  }

  await context.tools.addNoteOnce(task.id, candidates.length > 1 ? AMBIGUOUS_OUTPUT_NOTE : MISSING_OUTPUT_NOTE);
  await noteOwnerlessTask(task, context);
  await notifyTaskAssignee(
    task,
    `Task "${task.name}" is in review without output. Please attach a concrete deliverable.`,
    context
  );
  actions.push(buildAction(event, task.id, 'request_output', 'requested output from assignee'));
  return actions;
}

export async function onTaskMovedToReview(
  task: TaskRecord,
  context: TaskAgentEventContext
): Promise<TaskAgentAction[]> {
  return reviewTask(task, 'review_check', context);
}

export async function onReviewHygiene(
  task: TaskRecord,
  context: TaskAgentEventContext
): Promise<TaskAgentAction[]> {
  return reviewTask(task, 'review_hygiene', context);
}

export async function onOwnershipGap(
  task: TaskRecord,
  context: TaskAgentEventContext
): Promise<TaskAgentAction[]> {
  if (!isActiveTaskColumn(task.column) || hasAssignedOwner(task.assignee)) {
    return [];
  }

  await context.tools.addNoteOnce(task.id, OWNERLESS_ACTIVE_TASK_NOTE);
  return [buildAction('ownership_check', task.id, 'request_owner_assignment', 'active task has no owner')];
}

export async function onTaskStale(
  task: TaskRecord,
  hoursInColumn: number,
  context: TaskAgentEventContext
): Promise<TaskAgentAction[]> {
  const event = 'stale_scan';
  const actions: TaskAgentAction[] = [];
  const activities = context.tools.listTaskActivities(task.id, 40);
  const wasAlreadyNudged = activities.some((activity) => activity.activity_event_type === 'nudge_sent');
  const wasAlreadyEscalated = activities.some((activity) => activity.activity_event_type === 'owner_escalated');
  const wasAlreadyReassigned = activities.some((activity) => activity.activity_event_type === 'auto_reassigned');
  const hasRecentActivity = activities.some(
    (activity) => toHoursSince(activity.created_at) <= RECENT_ACTIVITY_WINDOW_HOURS
  );

  if (!hasRecentActivity) {
    await context.tools.addNoteOnce(task.id, `🕐 Stale for ${hoursInColumn.toFixed(1)}h - no recent activity.`);
    actions.push(buildAction(event, task.id, 'add_stale_note', `no activity in last ${RECENT_ACTIVITY_WINDOW_HOURS}h`));
  }

  if (task.blocked) {
    const blocker = task.blocker_reason?.trim()
      ? `blocked: ${task.blocker_reason.trim()}`
      : 'blocked with no blocker reason';
    // Transient network errors (fetch failed, Agent trigger failed) are not real blockers.
    // They indicate a temporary connectivity issue, not a genuine task-level obstruction.
    // Recycle to todo so the agent can retry without escalating.
    const transient = isTransientBlocker(task.blocker_reason);
    if (transient) {
      await context.tools.addNoteOnce(task.id, `🔄 Transient blocker detected (${blocker}). Moving to todo for retry.`);
      actions.push(buildAction(event, task.id, 'recycle_transient_blocker', blocker));
    } else {
      await context.tools.addNoteOnce(task.id, `🚧 Task remains blocked (${blocker}). Escalating for help.`);
      actions.push(buildAction(event, task.id, 'escalate_blocker', blocker));
    }
  }

  if (
    hasAssignedOwner(task.assignee) &&
    wasAlreadyNudged &&
    wasAlreadyEscalated &&
    !wasAlreadyReassigned &&
    isAutoReassignEligible(task, hoursInColumn) &&
    isIndividualOwner(task)
  ) {
    const nextAssignee = task.owner_principal_id!.trim();
    const projection = readRoutingProjection(task);
    const policyReason = 'auto-reassignment threshold exhausted after assignee nudge and owner escalation';
    const audit = {
      actor_principal_id: 'task-master',
      prior_assignee: task.assignee ?? null,
      new_assignee_principal_id: nextAssignee,
      prior_executor_principal_id: task.executor_principal_id ?? null,
      final_executor_principal_id: nextAssignee,
      prior_assignment_state: task.assignment_state ?? null,
      new_assignment_state: 'assigned',
      owner_escalation_event_count: activities.filter((activity) => activity.activity_event_type === 'owner_escalated').length,
      policy_reason: policyReason,
      policy_reason_chain: Array.isArray(projection.reason_chain) ? projection.reason_chain : undefined,
      reassigned_at: nowIso(),
    };
    const updated = await context.tools.updateTask(task.id, {
      assignee: nextAssignee,
      executor_principal_id: nextAssignee,
      assignment_state: 'assigned',
      metadata: buildReassignmentMetadata(task, audit),
    });

    if (updated) {
      await context.tools.addNoteOnce(
        task.id,
        `Auto-reassigned to ${nextAssignee} after nudge and owner escalation thresholds were exhausted.`,
      );
      actions.push(buildAction(
        event,
        task.id,
        'auto_reassign_task',
        `auto-reassigned stalled task to ${nextAssignee}`,
        0,
        audit,
      ));
      return actions;
    }
  }

  if (hasAssignedOwner(task.assignee) && wasAlreadyNudged && !wasAlreadyEscalated) {
    const ownerPrincipalId = task.owner_principal_id?.trim();
    const ownerLabel = ownerPrincipalId || 'unknown owner';
    const escalationReason = `assigned task is still stale after assignee nudge (${hoursInColumn.toFixed(1)}h in ${task.column})`;
    await context.tools.addNoteOnce(task.id, `Owner escalation: ${ownerLabel} notified because ${escalationReason}.`);
    actions.push(buildAction(event, task.id, 'escalate_owner', escalationReason));

    const ownerMessage = `Task "${task.name}" is still stale after an assignee nudge. Please help unblock or redirect it.`;
    const ownerNotification = await notifyTaskOwner(task, ownerMessage, context);
    if (ownerNotification.ok && !ownerNotification.skipped) {
      actions.push(buildAction(event, task.id, 'notify_owner', `routed owner escalation to ${ownerLabel}`));
    } else if (!ownerNotification.ok) {
      actions.push(buildAction(event, task.id, 'notify_owner_failed', ownerNotification.error));
    }

    return actions;
  }

  const defaultMessage = `Task "${task.name}" is stale for ${Math.round(hoursInColumn)}h in ${task.column}. Please post an update.`;
  let message = defaultMessage;
  let tokensUsed = 0;
  const modelSuggestion = await generateNudgeMessage(context, task, hoursInColumn);
  if (modelSuggestion?.text) {
    const cleaned = modelSuggestion.text.trim().replace(/\s+/g, ' ');
    if (cleaned) {
      message = cleaned.slice(0, 180);
      tokensUsed = modelSuggestion.tokensUsed;
    }
  }

  actions.push(buildAction(event, task.id, 'nudge_assignee', 'assigned stale work is nudged before escalation', tokensUsed));
  const assigneeNotification = await notifyTaskAssignee(task, message, context);
  if (assigneeNotification.ok && !assigneeNotification.skipped) {
    actions.push(buildAction(event, task.id, 'notify_assignee', 'sent stale nudge', tokensUsed));
  } else if (!assigneeNotification.ok) {
    actions.push(buildAction(event, task.id, 'notify_assignee_failed', assigneeNotification.error, tokensUsed));
  }
  return actions;
}

export function collectStaleCandidates(tasks: readonly TaskRecord[]): Array<{ task: TaskRecord; hoursInColumn: number }> {
  const candidates: Array<{ task: TaskRecord; hoursInColumn: number }> = [];
  const settings = getTaskAgentSettings();
  for (const task of tasks) {
    if (task.column !== 'doing' && task.column !== 'review') {
      continue;
    }

    const staleThreshold = task.column === 'doing'
      ? settings.staleThresholdHours.doing
      : settings.staleThresholdHours.review;
    const hoursInColumn = toHoursSince(task.updated_at);
    if (hoursInColumn < staleThreshold) {
      continue;
    }

    candidates.push({ task, hoursInColumn });
  }

  return candidates.sort((left, right) => right.hoursInColumn - left.hoursInColumn);
}

export function collectReviewHygieneCandidates(tasks: readonly TaskRecord[]): TaskRecord[] {
  return [...tasks]
    .filter((task) => task.column === 'review')
    .sort((left, right) => Date.parse(left.updated_at) - Date.parse(right.updated_at));
}

export function collectOwnerlessActiveTasks(tasks: readonly TaskRecord[]): TaskRecord[] {
  return [...tasks]
    .filter((task) => isActiveTaskColumn(task.column) && !hasAssignedOwner(task.assignee))
    .sort((left, right) => Date.parse(left.updated_at) - Date.parse(right.updated_at));
}
