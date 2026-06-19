import { generateText } from 'ai';
import type { AgentRegistryRecord, TaskCommentRecord, TaskRecord } from '../../../db/src';
import { getTaskAgentLanguageModel, getTaskAgentSettings } from './settings';

const MENTION_REGEX = /@([a-z0-9][a-z0-9._-]*)/gi;
const INACTIVE_AGENT_STATUSES = new Set(['offline', 'inactive', 'disabled', 'archived', 'retired', 'deleted']);

// Heuristic: does the comment ask the agent to take/execute the task?
const PICKUP_REGEX =
  /\b(pick(?:ing)?\s*(?:it|this|the\s+task)?\s*up|pick\s*up|take\s+(?:this|it|over|the\s+task)|own\s+(?:this|it)|start\s+(?:work|working)|work\s+on\s+(?:this|it|the\s+task)|execute(?:\s+(?:this|it))?|run\s+with\s+(?:this|it)|handle\s+(?:this|it)|get\s+(?:on|started))\b/i;

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
  updateTask: (
    taskId: number,
    fields: { assignee?: string; column?: string },
  ) => Promise<TaskRecord | null | undefined> | TaskRecord | null | undefined;
  listAgents: () => AgentRegistryRecord[];
  logActivity: (input: {
    source: 'agent';
    type: string;
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

/** Compose the full card context + thread for the agent prompt. */
export function buildMentionPrompt(
  agent: CommentResponderAgent,
  task: TaskRecord,
  comments: TaskCommentRecord[],
  triggerComment: TaskCommentRecord,
  pickup: boolean,
): string {
  const recent = comments
    .filter((comment) => comment.id !== triggerComment.id)
    .slice(-10)
    .map((comment) => `- ${comment.author}: ${clampText(comment.body, 500)}`)
    .join('\n');

  const lines = [
    `You are ${agent.name}, an agent in Entity Mission Control. You were @mentioned in a task comment.`,
    'Read the full task card and the thread, then reply directly and concisely to the user.',
    pickup
      ? 'The user is asking you to pick up / work on this task. Acknowledge that you are taking it, and briefly state your first concrete step.'
      : 'If the user asked a question, answer it. If they asked for work, outline the concrete next step.',
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

function noModelReply(agent: CommentResponderAgent, pickup: boolean): string {
  const base = `Hi — I'm ${agent.name}. I received your message and can see this task's full context.`;
  const pickupNote = pickup ? ' I\'ve picked up this task.' : '';
  return `${base}${pickupNote} I don't have a language model configured yet, so I can't draft a full response. Configure a provider/model in Admin → Task Master (e.g. an Azure OpenAI base URL + API key) and mention me again for a full reply.`;
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
      const pickup = wantsPickup(body);
      const model = getTaskAgentLanguageModel();
      const settings = getTaskAgentSettings();

      for (const agent of agents) {
        let replyBody: string;
        if (model) {
          try {
            const result = await generateText({
              model,
              prompt: buildMentionPrompt(agent, task, comments, triggerComment, pickup),
              temperature: 0.3,
            });
            replyBody = result.text.trim() || noModelReply(agent, pickup);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            replyBody = `Hi — I'm ${agent.name}. I tried to respond using ${settings.provider}/${settings.model} but the request failed (${message}). Please check the provider configuration in Admin → Task Master.`;
          }
        } else {
          replyBody = noModelReply(agent, pickup);
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

        if (pickup) {
          const nextColumn = task.column === 'backlog' || task.column === 'todo' ? 'doing' : task.column;
          const updated = await deps.updateTask(taskId, { assignee: agent.name, column: nextColumn });
          if (updated) {
            deps.logActivity({
              source: 'agent',
              type: 'task_updated',
              action: `@${agent.name} picked up task`,
              description: `${agent.name} took ownership and moved it to ${nextColumn}.`,
              agentName: agent.name,
              taskId,
              taskColumn: nextColumn,
            });
            deps.broadcast({ type: 'task:updated', task: updated });
            deps.broadcast({ type: 'task:moved', taskId, column: nextColumn });
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.warn('[CommentResponder] Failed to handle comment mention:', message);
    }
  };
}
