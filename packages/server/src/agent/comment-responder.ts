import { generateText } from 'ai';
import type {
  ActivityType,
  AgentRegistryRecord,
  TaskColumn,
  TaskCommentRecord,
  TaskRecord,
  UpdateTaskInput,
} from '../../../db/src';
import { getTaskAgentLanguageModel, getTaskAgentSettings } from './settings';
import { hasAssignedOwner, isActiveTaskColumn, isReviewGatedTask, validateReviewCompletion } from './review-policy';

const MENTION_REGEX = /@([a-z0-9][a-z0-9._-]*)/gi;
const INACTIVE_AGENT_STATUSES = new Set(['offline', 'inactive', 'disabled', 'archived', 'retired', 'deleted']);

// Heuristic: does the comment ask the agent to take/execute the task?
const PICKUP_REGEX =
  /\b(pick(?:ing)?\s*(?:it|this|the\s+task)?\s*up|pick\s*up|take\s+(?:this|it|over|the\s+task)|own\s+(?:this|it)|start\s+(?:work|working)|work\s+on\s+(?:this|it|the\s+task)|execute(?:\s+(?:this|it))?|run\s+with\s+(?:this|it)|handle\s+(?:this|it)|get\s+(?:on|started))\b/i;

// Verbs that signal an explicit "move this card to <column>" instruction.
const MOVE_VERB_REGEX = /\b(move|moved|put|send|sent|shift|transition|change|drag|set|push|mark)\b/i;

// Column keyword synonyms → canonical TaskColumn.
const COLUMN_SYNONYMS: Array<{ column: TaskColumn; pattern: RegExp }> = [
  { column: 'backlog', pattern: /\bback\s*log\b/i },
  { column: 'todo', pattern: /\b(to\s*-?\s*do|todo)\b/i },
  { column: 'doing', pattern: /\b(doing|in[\s-]?progress|wip|working)\b/i },
  { column: 'review', pattern: /\b(review|in[\s-]?review|for\s+review)\b/i },
  { column: 'done', pattern: /\b(done|complete[d]?|finish(?:ed)?|completed)\b/i },
];

/**
 * Detects an explicit "move this task to <column>" instruction in a comment.
 * Requires both a movement verb and a recognized column keyword to avoid
 * matching plain questions like "what's left for review?".
 */
export function parseColumnMoveIntent(body: string): TaskColumn | null {
  if (!MOVE_VERB_REGEX.test(body)) {
    return null;
  }
  // Prefer the column keyword that appears latest (usually the destination,
  // e.g. "move from review to done").
  let best: { column: TaskColumn; index: number } | null = null;
  for (const { column, pattern } of COLUMN_SYNONYMS) {
    const match = pattern.exec(body);
    if (match && (best === null || match.index > best.index)) {
      best = { column, index: match.index };
    }
  }
  return best?.column ?? null;
}

export interface CommentResponderAgent {
  id: string;
  slug: string;
  name: string;
}

export interface CommentResponderDeps {
  getTask: (taskId: number) => Promise<TaskRecord | null | undefined> | TaskRecord | null | undefined;
  listComments: (taskId: number) => TaskCommentRecord[];
  createComment: (input: {
    task_id: number;
    body: string;
    author?: string;
    parent_id?: number | null;
  }) => TaskCommentRecord;
  updateTask: (taskId: number, fields: UpdateTaskInput) => Promise<TaskRecord | null | undefined>;
  listAgents: () => AgentRegistryRecord[];
  logActivity: (input: {
    source: 'agent';
    type: ActivityType;
    action: string;
    description: string;
    agentName?: string;
    taskId?: number;
    taskColumn?: string;
  }) => void;
  broadcast: (message: unknown) => void;
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

export function parseMentionTokens(body: string): string[] {
  const tokens = new Set<string>();
  for (const match of body.matchAll(MENTION_REGEX)) {
    if (match[1]) {
      tokens.add(match[1].toLowerCase());
    }
  }
  return Array.from(tokens);
}

function isActiveAgent(agent: AgentRegistryRecord): boolean {
  const status = (agent.status ?? '').trim().toLowerCase();
  return status ? !INACTIVE_AGENT_STATUSES.has(status) : true;
}

/** Resolve @mention tokens in a comment body to active registry agents. */
export function resolveMentionedAgents(
  body: string,
  agents: AgentRegistryRecord[],
): CommentResponderAgent[] {
  const tokens = parseMentionTokens(body);
  if (tokens.length === 0) return [];

  const normalizedTokens = new Set(tokens.map(normalizeIdentity));
  const matched: CommentResponderAgent[] = [];
  const seen = new Set<string>();

  for (const agent of agents) {
    if (!isActiveAgent(agent)) continue;
    const identities = [agent.slug, agent.name, agent.id].map(normalizeIdentity);
    if (identities.some((identity) => normalizedTokens.has(identity))) {
      if (!seen.has(agent.id)) {
        seen.add(agent.id);
        matched.push({ id: agent.id, slug: agent.slug, name: agent.name });
      }
    }
  }
  return matched;
}

export function wantsPickup(body: string): boolean {
  return PICKUP_REGEX.test(body);
}

function clampText(value: string | null | undefined, max: number): string {
  if (!value) return '';
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export type PlannedActionKind = 'move' | 'pickup' | 'reply';

export interface PlannedAction {
  kind: PlannedActionKind;
  column?: TaskColumn;
  assignee?: string;
  /** Set when a requested action cannot be performed (e.g. done gate). */
  blockedReason?: string;
}

/**
 * Decides what the mentioned agent should do: an explicit column move takes
 * precedence over a generic "pick this up", which takes precedence over a
 * plain text reply. Validates the move (assignee for active columns, review
 * gate for done) and reports a blockedReason when it can't proceed.
 */
export function planAction(task: TaskRecord, body: string, agentName: string): PlannedAction {
  const moveTarget = parseColumnMoveIntent(body);

  if (moveTarget && moveTarget !== task.column) {
    // Active columns require an owner; assign the acting agent if none.
    const assignee = isActiveTaskColumn(moveTarget) && !hasAssignedOwner(task.assignee) ? agentName : undefined;

    if (moveTarget === 'done' && isReviewGatedTask(task.metadata)) {
      const completion = validateReviewCompletion(task, agentName);
      if (!completion.ok) {
        return {
          kind: 'reply',
          blockedReason:
            'this task needs an accepted review (review type, decision=accepted, and a substantive review note) before it can move to Done',
        };
      }
    }
    return { kind: 'move', column: moveTarget, assignee };
  }

  if (wantsPickup(body)) {
    const column: TaskColumn = task.column === 'backlog' || task.column === 'todo' ? 'doing' : task.column;
    return { kind: 'pickup', column, assignee: agentName };
  }

  return { kind: 'reply' };
}

function describeAction(action: PlannedAction): string {
  switch (action.kind) {
    case 'move':
      return `You are moving this task to the "${action.column}" column${action.assignee ? ` and assigning it to yourself` : ''}. Confirm the move in one short sentence.`;
    case 'pickup':
      return 'The user is asking you to pick up / work on this task. Acknowledge that you are taking it (assigning yourself and moving it to Doing) and state your first concrete step.';
    case 'reply':
    default:
      return action.blockedReason
        ? `The user asked you to move this task, but you cannot: ${action.blockedReason}. Explain that briefly and suggest what's needed.`
        : 'If the user asked a question, answer it. If they asked for work, outline the concrete next step.';
  }
}

/** Compose the full card context + thread for the agent prompt. */
export function buildMentionPrompt(
  agent: CommentResponderAgent,
  task: TaskRecord,
  comments: TaskCommentRecord[],
  triggerComment: TaskCommentRecord,
  action: PlannedAction,
): string {
  const recent = comments
    .filter((comment) => comment.id !== triggerComment.id)
    .slice(-10)
    .map((comment) => `- ${comment.author}: ${clampText(comment.body, 500)}`)
    .join('\n');

  const lines = [
    `You are ${agent.name}, an agent in Entity Mission Control. You were @mentioned in a task comment.`,
    'Read the full task card and the thread, then reply directly and concisely to the user.',
    describeAction(action),
    '',
    '## Task card',
    `- Title: ${task.name}`,
    `- Column: ${task.column}`,
    `- Assignee: ${task.assignee || 'Unassigned'}`,
    `- Priority: ${task.priority ?? 'P2'}`,
    task.description ? `- Description: ${clampText(task.description, 1500)}` : '',
    task.brief ? `- Brief: ${clampText(task.brief, 1000)}` : '',
    task.output ? `- Output/notes: ${clampText(task.output, 1500)}` : '',
    '',
    recent ? `## Recent comments\n${recent}` : '',
    '',
    '## The comment mentioning you',
    `${triggerComment.author}: ${clampText(triggerComment.body, 1000)}`,
    '',
    'Reply as plain text (no markdown headers). Keep it under ~120 words.',
  ];
  return lines.filter((line) => line !== '').join('\n');
}

function noModelReply(agent: CommentResponderAgent, action: PlannedAction): string {
  const base = `Hi — I'm ${agent.name}. I received your message and can see this task's full context.`;
  let actionNote = '';
  if (action.kind === 'move') {
    actionNote = ` I've moved this task to ${action.column}.`;
  } else if (action.kind === 'pickup') {
    actionNote = " I've picked up this task.";
  } else if (action.blockedReason) {
    actionNote = ` I couldn't move it: ${action.blockedReason}.`;
  }
  return `${base}${actionNote} I don't have a language model configured yet, so I can't draft a full response. Configure a provider/model in Admin → Task Master (e.g. an Azure OpenAI base URL + API key) and mention me again for a full reply.`;
}

export function createCommentMentionResponder(deps: CommentResponderDeps) {
  return async function handleCommentMention(
    taskId: number,
    triggerComment: TaskCommentRecord,
  ): Promise<void> {
    try {
      const body = triggerComment.body ?? '';
      const agents = resolveMentionedAgents(body, deps.listAgents());
      if (agents.length === 0) {
        return;
      }

      const task = await deps.getTask(taskId);
      if (!task) {
        return;
      }

      const comments = deps.listComments(taskId);
      const model = getTaskAgentLanguageModel();
      const settings = getTaskAgentSettings();

      for (const agent of agents) {
        const action = planAction(task, body, agent.name);

        let replyBody: string;
        if (model) {
          try {
            const result = await generateText({
              model,
              prompt: buildMentionPrompt(agent, task, comments, triggerComment, action),
              temperature: 0.3,
            });
            replyBody = result.text.trim() || noModelReply(agent, action);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            replyBody = `Hi — I'm ${agent.name}. I tried to respond using ${settings.provider}/${settings.model} but the request failed (${message}). Please check the provider configuration in Admin → Task Master.`;
          }
        } else {
          replyBody = noModelReply(agent, action);
        }

        const reply = deps.createComment({
          task_id: taskId,
          body: replyBody,
          author: agent.name,
          parent_id: triggerComment.id,
        });
        deps.logActivity({
          source: 'agent',
          type: 'task_comment',
          action: `@${agent.name} replied`,
          description: clampText(replyBody, 200),
          agentName: agent.name,
          taskId,
          taskColumn: task.column,
        });
        deps.broadcast({ type: 'task:comment', taskId, comment: reply });

        if (action.kind === 'move' && action.column) {
          const fields: { assignee?: string; column?: string } = { column: action.column };
          if (action.assignee) {
            fields.assignee = action.assignee;
          }
          const updated = await deps.updateTask(taskId, fields);
          if (updated) {
            deps.logActivity({
              source: 'agent',
              type: 'task_updated',
              action: `@${agent.name} moved task`,
              description: `${agent.name} moved it to ${action.column}${action.assignee ? ` and self-assigned` : ''}.`,
              agentName: agent.name,
              taskId,
              taskColumn: action.column,
            });
            deps.broadcast({ type: 'task:updated', task: updated });
            deps.broadcast({ type: 'task:moved', taskId, column: action.column });
          }
        } else if (action.kind === 'pickup' && action.column) {
          const updated = await deps.updateTask(taskId, {
            assignee: action.assignee ?? agent.name,
            column: action.column,
          });
          if (updated) {
            deps.logActivity({
              source: 'agent',
              type: 'task_updated',
              action: `@${agent.name} picked up task`,
              description: `${agent.name} took ownership and moved it to ${action.column}.`,
              agentName: agent.name,
              taskId,
              taskColumn: action.column,
            });
            deps.broadcast({ type: 'task:updated', task: updated });
            deps.broadcast({ type: 'task:moved', taskId, column: action.column });
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.warn('[CommentResponder] Failed to handle comment mention:', message);
    }
  };
}
