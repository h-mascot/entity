import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ActivityRepository, AgentLogRecord, TaskCommentRepository, TaskRecord } from '../../../db/src';
import type { TaskSyncLayer } from '../../../db/src/task-sync';
import { AGENT_CONFIG } from './config';
import {
  collectOwnerlessActiveTasks,
  collectReviewHygieneCandidates,
  collectStaleCandidates,
  onOutputMissing,
  onOwnershipGap,
  onReviewHygiene,
  onTaskMovedToReview,
  onTaskStale,
  type ModelInvocationResult,
  type TaskAgentAction,
} from './events';
import { getAgentStatus, listAgentLogs, writeAgentLog } from './log';
import { createTaskAgentTools, type TaskAgentToolDependencies } from './tools';
import { hasAssignedOwner, isActiveTaskColumn, type ReviewAssessment } from './review-policy';

export type AgentTriggerEvent = 'review_check' | 'review_hygiene' | 'ownership_check' | 'stale_scan' | 'manual';

export interface TriggerAgentInput {
  event: AgentTriggerEvent;
  taskId?: number;
}

export interface TriggerAgentResult {
  actions: TaskAgentAction[];
  summary: string;
}

export interface TaskAgentStatus {
  lastRun: string | null;
  totalActions: number;
  model: string;
  enabled: boolean;
}

export interface TaskAgentLogEntry {
  timestamp: string;
  event: string;
  taskId: number | null;
  action: string;
  result: string | null;
  model: string;
  tokensUsed: number;
}

export interface TaskAgentDependencies
  extends Omit<TaskAgentToolDependencies, 'taskSyncLayer' | 'activityRepository' | 'taskCommentRepository'> {
  taskSyncLayer: TaskSyncLayer;
  activityRepository: ActivityRepository;
  taskCommentRepository: TaskCommentRepository;
}

function normalizeTokensUsed(usage: unknown): number {
  if (!usage || typeof usage !== 'object') {
    return 0;
  }

  const record = usage as Record<string, unknown>;
  const total = record.totalTokens;
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
    return Math.floor(total);
  }

  const promptTokens = record.promptTokens;
  const completionTokens = record.completionTokens;
  if (
    typeof promptTokens === 'number' &&
    Number.isFinite(promptTokens) &&
    promptTokens >= 0 &&
    typeof completionTokens === 'number' &&
    Number.isFinite(completionTokens) &&
    completionTokens >= 0
  ) {
    return Math.floor(promptTokens + completionTokens);
  }

  const inputTokens = record.inputTokens;
  const outputTokens = record.outputTokens;
  if (
    typeof inputTokens === 'number' &&
    Number.isFinite(inputTokens) &&
    inputTokens >= 0 &&
    typeof outputTokens === 'number' &&
    Number.isFinite(outputTokens) &&
    outputTokens >= 0
  ) {
    return Math.floor(inputTokens + outputTokens);
  }

  return 0;
}

function toLogEntry(entry: AgentLogRecord): TaskAgentLogEntry {
  return {
    timestamp: entry.timestamp,
    event: entry.event,
    taskId: entry.task_id,
    action: entry.action,
    result: entry.result,
    model: entry.model,
    tokensUsed: entry.tokens_used,
  };
}

function summarizeTrigger(event: AgentTriggerEvent, actions: readonly TaskAgentAction[]): string {
  if (actions.length === 0) {
    if (event === 'stale_scan') {
      return 'No stale tasks required action.';
    }
    if (event === 'review_hygiene') {
      return 'No review hygiene tasks required action.';
    }
    if (event === 'ownership_check') {
      return 'No unassigned active tasks required action.';
    }
    return 'No agent actions were required.';
  }

  const byAction = new Map<string, number>();
  for (const action of actions) {
    byAction.set(action.action, (byAction.get(action.action) ?? 0) + 1);
  }

  const topBreakdown = [...byAction.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([action, count]) => `${action} (${count})`)
    .join(', ');

  return `Executed ${actions.length} agent action(s): ${topBreakdown}.`;
}

export class TaskAgent {
  private readonly tools;
  private readonly googleProvider;
  private staleScanRunning = false;
  private reviewHygieneRunning = false;
  private ownershipCheckRunning = false;

  constructor(private readonly dependencies: TaskAgentDependencies) {
    this.tools = createTaskAgentTools(dependencies);
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
    this.googleProvider = apiKey ? createGoogleGenerativeAI({ apiKey }) : null;
  }

  private async invokeModel(prompt: string): Promise<ModelInvocationResult | null> {
    if (!this.googleProvider) {
      return null;
    }

    try {
      const result = await generateText({
        model: this.googleProvider(AGENT_CONFIG.model),
        prompt,
        temperature: 0.2,
      });

      const text = result.text.trim();
      if (!text) {
        return null;
      }

      return {
        text,
        tokensUsed: normalizeTokensUsed(result.usage),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown model invocation error';
      console.warn('[TaskAgent] Model invocation failed:', message);
      return null;
    }
  }

  private recordActions(actions: readonly TaskAgentAction[]): void {
    for (const action of actions) {
      writeAgentLog({
        event: action.event,
        task_id: typeof action.taskId === 'number' ? action.taskId : null,
        action: action.action,
        result: action.result,
        model: AGENT_CONFIG.model,
        tokens_used: action.tokensUsed,
      });
    }
  }

  async assessReview(task: TaskRecord): Promise<ReviewAssessment> {
    return this.tools.assessReview(task);
  }

  async handleTaskMovedToReview(task: TaskRecord): Promise<TaskAgentAction[]> {
    const actions = await onTaskMovedToReview(task, {
      tools: this.tools,
      invokeModel: this.invokeModel.bind(this),
    });
    this.recordActions(actions);
    return actions;
  }

  async handleReviewHygiene(task: TaskRecord): Promise<TaskAgentAction[]> {
    const actions = await onReviewHygiene(task, {
      tools: this.tools,
      invokeModel: this.invokeModel.bind(this),
    });
    this.recordActions(actions);
    return actions;
  }

  async handleOwnershipGap(task: TaskRecord): Promise<TaskAgentAction[]> {
    const actions = await onOwnershipGap(task, {
      tools: this.tools,
      invokeModel: this.invokeModel.bind(this),
    });
    this.recordActions(actions);
    return actions;
  }

  async handleOutputMissing(task: TaskRecord): Promise<TaskAgentAction[]> {
    const actions = await onOutputMissing(task, {
      tools: this.tools,
      invokeModel: this.invokeModel.bind(this),
    });
    this.recordActions(actions);
    return actions;
  }

  async runStaleScan(source: 'scheduled' | 'manual' = 'manual'): Promise<TaskAgentAction[]> {
    if (this.staleScanRunning) {
      const skipped: TaskAgentAction[] = [
        {
          timestamp: new Date().toISOString(),
          event: 'stale_scan',
          action: 'skip_scan',
          result: `stale scan already in progress (${source})`,
          tokensUsed: 0,
        },
      ];
      this.recordActions(skipped);
      return skipped;
    }

    this.staleScanRunning = true;
    try {
      const tasks = await this.dependencies.taskSyncLayer.listTasks();
      const staleCandidates = collectStaleCandidates(tasks);
      const actions: TaskAgentAction[] = [];
      let handled = 0;

      for (const candidate of staleCandidates) {
        if (handled >= AGENT_CONFIG.maxActionsPerScan) {
          break;
        }
        handled += 1;
        const staleActions = await onTaskStale(candidate.task, candidate.hoursInColumn, {
          tools: this.tools,
          invokeModel: this.invokeModel.bind(this),
        });

        // Execute recycle_transient_blocker actions immediately — move to todo and clear block.
        for (const action of staleActions) {
          if (action.action === 'recycle_transient_blocker' && action.taskId != null) {
            await this.tools.moveTask(action.taskId, 'todo');
            await this.tools.updateTask(action.taskId, {
              blocked: false,
              blocker_reason: undefined,
            });
          }
        }

        actions.push(...staleActions);
      }

      if (actions.length === 0) {
        actions.push({
          timestamp: new Date().toISOString(),
          event: 'stale_scan',
          action: 'scan_complete',
          result: `no stale tasks required action (${source})`,
          tokensUsed: 0,
        });
      }

      this.recordActions(actions);
      return actions;
    } finally {
      this.staleScanRunning = false;
    }
  }

  async runReviewHygieneScan(source: 'scheduled' | 'manual' = 'manual'): Promise<TaskAgentAction[]> {
    if (this.reviewHygieneRunning) {
      const skipped: TaskAgentAction[] = [
        {
          timestamp: new Date().toISOString(),
          event: 'review_hygiene',
          action: 'skip_scan',
          result: `review hygiene scan already in progress (${source})`,
          tokensUsed: 0,
        },
      ];
      this.recordActions(skipped);
      return skipped;
    }

    this.reviewHygieneRunning = true;
    try {
      const tasks = await this.dependencies.taskSyncLayer.listTasks();
      const reviewTasks = collectReviewHygieneCandidates(tasks).slice(0, AGENT_CONFIG.maxActionsPerScan);
      const actions: TaskAgentAction[] = [];

      for (const task of reviewTasks) {
        const taskActions = await this.handleReviewHygiene(task);
        actions.push(...taskActions);
      }

      if (actions.length === 0) {
        actions.push({
          timestamp: new Date().toISOString(),
          event: 'review_hygiene',
          action: 'scan_complete',
          result: `no review tasks required hygiene action (${source})`,
          tokensUsed: 0,
        });
        this.recordActions(actions);
      }

      return actions;
    } finally {
      this.reviewHygieneRunning = false;
    }
  }

  async runOwnershipCheck(source: 'scheduled' | 'manual' = 'manual'): Promise<TaskAgentAction[]> {
    if (this.ownershipCheckRunning) {
      const skipped: TaskAgentAction[] = [
        {
          timestamp: new Date().toISOString(),
          event: 'ownership_check',
          action: 'skip_scan',
          result: `ownership check already in progress (${source})`,
          tokensUsed: 0,
        },
      ];
      this.recordActions(skipped);
      return skipped;
    }

    this.ownershipCheckRunning = true;
    try {
      const tasks = await this.dependencies.taskSyncLayer.listTasks();
      const ownerlessTasks = collectOwnerlessActiveTasks(tasks).slice(0, AGENT_CONFIG.maxActionsPerScan);
      const actions: TaskAgentAction[] = [];

      for (const task of ownerlessTasks) {
        const taskActions = await this.handleOwnershipGap(task);
        actions.push(...taskActions);
      }

      if (actions.length === 0) {
        actions.push({
          timestamp: new Date().toISOString(),
          event: 'ownership_check',
          action: 'scan_complete',
          result: `no ownerless active tasks required action (${source})`,
          tokensUsed: 0,
        });
        this.recordActions(actions);
      }

      return actions;
    } finally {
      this.ownershipCheckRunning = false;
    }
  }

  async trigger(input: TriggerAgentInput): Promise<TriggerAgentResult> {
    if (!AGENT_CONFIG.enabled) {
      return {
        actions: [],
        summary: 'TaskAgent is disabled. Set ENTITY_AGENT_ENABLED=true to enable triggers.',
      };
    }

    const event = input.event;
    let actions: TaskAgentAction[] = [];
    switch (event) {
      case 'stale_scan': {
        actions = await this.runStaleScan('manual');
        break;
      }
      case 'review_hygiene': {
        actions = await this.runReviewHygieneScan('manual');
        break;
      }
      case 'ownership_check': {
        actions = await this.runOwnershipCheck('manual');
        break;
      }
      case 'review_check': {
        if (typeof input.taskId === 'number') {
          const task = await this.dependencies.taskSyncLayer.getTask(input.taskId);
          if (!task) {
            throw new Error('task not found');
          }
          actions = await this.handleTaskMovedToReview(task);
          break;
        }

        const tasks = await this.dependencies.taskSyncLayer.listTasks();
        const reviewTasks = tasks.filter((task) => task.column === 'review');
        const limitedReviewTasks = reviewTasks.slice(0, AGENT_CONFIG.maxActionsPerScan);
        for (const task of limitedReviewTasks) {
          const nextActions = await this.handleTaskMovedToReview(task);
          actions.push(...nextActions);
        }
        if (actions.length === 0) {
          actions.push({
            timestamp: new Date().toISOString(),
            event: 'review_check',
            action: 'scan_complete',
            result: 'no review tasks required action',
            tokensUsed: 0,
          });
          this.recordActions(actions);
        }
        break;
      }
      case 'manual': {
        if (typeof input.taskId === 'number') {
          const task = await this.dependencies.taskSyncLayer.getTask(input.taskId);
          if (!task) {
            throw new Error('task not found');
          }

          if (task.column === 'review') {
            if (task.output?.trim()) {
              actions = await this.handleTaskMovedToReview(task);
            } else {
              actions = await this.handleOutputMissing(task);
            }
          } else if (isActiveTaskColumn(task.column) && !hasAssignedOwner(task.assignee)) {
            actions = await this.handleOwnershipGap(task);
          } else {
            actions = await this.runStaleScan('manual');
          }
        } else {
          actions = await this.runStaleScan('manual');
        }
        break;
      }
      default: {
        throw new Error('invalid event');
      }
    }

    return {
      actions,
      summary: summarizeTrigger(event, actions),
    };
  }

  getStatus(): TaskAgentStatus {
    return getAgentStatus();
  }

  getLog(limit = 100): TaskAgentLogEntry[] {
    return listAgentLogs(limit).map(toLogEntry);
  }
}

export * from './config';
export * from './events';
export * from './review-policy';
export * from './scheduler';
