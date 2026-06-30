import { generateText, type LanguageModel } from 'ai';
import type { AgentRegistryRecord } from '../../../db/src';
import { resolveMentionedAgents, type CommentResponderAgent } from '../agent/comment-responder';
import type { DocumentCommentActivity, DocumentCommentThread } from './service';

const INACTIVE_AGENT_STATUSES = new Set(['offline', 'inactive', 'disabled', 'archived', 'retired', 'deleted']);
const MAX_DOCUMENT_CONTEXT_CHARS = 6000;
const MAX_SELECTION_CHARS = 1200;
const MAX_THREAD_TEXT_CHARS = 800;

export interface DocumentContentSnapshot {
  content: string;
  sourceId: string | null;
  path: string | null;
}

export interface DocumentCommentMentionDeps {
  /** Active + inactive registry agents used to resolve @mentions. */
  listAgents: () => AgentRegistryRecord[];
  /** Configured Task Master language model, or null when unconfigured. */
  getModel: () => LanguageModel | null;
  /** Human-readable provider/model label used in error messages, e.g. "google/gemini-2.5-flash". */
  getProviderModelLabel: () => string;
  /** Reads the backing document content so the agent can answer with real context. */
  readDocumentContent: (docId: string) => Promise<DocumentContentSnapshot | null>;
  /** Resolves the current thread (comment + replies) for the triggering comment id. */
  getThread: (docId: string, commentId: string) => DocumentCommentThread | null;
  /** Posts the agent reply back onto the thread (in-process, bypassing route auth). */
  postReply: (docId: string, author: string, commentId: string, text: string) => void;
  /** Optional activity logger for observability. */
  logActivity?: (entry: { agentName: string; docId: string; commentId: string; summary: string }) => void;
}

export type DocumentCommentMentionResponder = (activity: DocumentCommentActivity) => Promise<void>;

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function isActiveAgent(agent: AgentRegistryRecord): boolean {
  const status = (agent.status ?? '').trim().toLowerCase();
  return status ? !INACTIVE_AGENT_STATUSES.has(status) : true;
}

/**
 * True when `actorId` matches an active registry agent. Used to suppress the
 * responder for agent-authored activity, which prevents an agent reply (posted
 * as the agent identity) from re-triggering the responder in a loop.
 */
export function isRegisteredAgentActor(actorId: string, agents: AgentRegistryRecord[]): boolean {
  const normalizedActor = normalizeIdentity(actorId);
  if (!normalizedActor) return false;
  return agents.some((agent) => {
    if (!isActiveAgent(agent)) return false;
    return [agent.slug, agent.name, agent.id].map(normalizeIdentity).includes(normalizedActor);
  });
}

function clampText(value: string | null | undefined, max: number): string {
  if (!value) return '';
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function deriveSelectedText(thread: DocumentCommentThread, content: string | null): string {
  if (thread.selectedText && thread.selectedText.trim()) {
    return clampText(thread.selectedText, MAX_SELECTION_CHARS);
  }
  if (content && thread.range && thread.range.to > thread.range.from) {
    const slice = content.slice(thread.range.from, thread.range.to);
    if (slice.trim()) {
      return clampText(slice, MAX_SELECTION_CHARS);
    }
  }
  return '';
}

/** Compose the full document + thread context for the agent prompt. */
export function buildDocCommentMentionPrompt(input: {
  agent: CommentResponderAgent;
  thread: DocumentCommentThread;
  document: DocumentContentSnapshot | null;
  triggerAuthor: string;
  triggerText: string;
}): string {
  const { agent, thread, document, triggerAuthor, triggerText } = input;
  const selectedText = deriveSelectedText(thread, document?.content ?? null);
  const threadLines = [
    `- ${thread.author}: ${clampText(thread.text, MAX_THREAD_TEXT_CHARS)}`,
    ...thread.replies.map((reply) => `  - reply from ${reply.author}: ${clampText(reply.text, MAX_THREAD_TEXT_CHARS)}`),
  ].join('\n');

  const lines = [
    `You are ${agent.name}, an agent collaborating in the Entity Doc Hub editor.`,
    'A collaborator left a comment on a document and @mentioned you. Read the document context and the comment thread, then reply directly and concisely to what they asked.',
    '',
    '## Document',
    `- Path: ${document?.path ?? 'unknown'}`,
    document?.content
      ? `- Content:\n"""\n${clampText(document.content, MAX_DOCUMENT_CONTEXT_CHARS)}\n"""`
      : '- Content: (unavailable)',
    '',
    '## Commented selection',
    selectedText ? `"""\n${selectedText}\n"""` : '(no specific text was selected)',
    '',
    '## Comment thread',
    threadLines,
    '',
    '## The message mentioning you',
    `${triggerAuthor}: ${clampText(triggerText, MAX_THREAD_TEXT_CHARS)}`,
    '',
    'Reply as plain text (no markdown headers). Ground your answer in the selected text and document where relevant. Keep it under ~150 words.',
  ];
  return lines.filter((line) => line !== null).join('\n');
}

function noModelReply(agent: CommentResponderAgent, document: DocumentContentSnapshot | null): string {
  const where = document?.path ? ` (${document.path})` : '';
  return `Hi — I'm ${agent.name}. I can see this document${where} and the selected text you commented on, but no language model is configured yet, so I can't draft a full response. Configure a provider/model in Admin → Task Master (e.g. an Azure OpenAI base URL + API key) and mention me again for a full reply.`;
}

/**
 * Builds a responder that, when a document comment/reply @mentions a registry
 * agent, reads the document for context and posts the agent's reply onto the
 * thread. Agent-authored activity is ignored to avoid reply loops.
 */
export function createDocumentCommentMentionResponder(
  deps: DocumentCommentMentionDeps,
): DocumentCommentMentionResponder {
  return async function handleDocumentCommentMention(activity: DocumentCommentActivity): Promise<void> {
    try {
      const text = activity.text ?? '';
      const agents = deps.listAgents();

      // Loop prevention: never respond to activity authored by an agent.
      if (isRegisteredAgentActor(activity.actorId, agents)) {
        return;
      }

      const mentioned = resolveMentionedAgents(text, agents);
      if (mentioned.length === 0) {
        return;
      }

      const thread = deps.getThread(activity.docId, activity.commentId);
      if (!thread) {
        return;
      }

      const document = await deps.readDocumentContent(activity.docId);
      const model = deps.getModel();

      for (const agent of mentioned) {
        let replyText: string;
        if (model) {
          try {
            const result = await generateText({
              model,
              prompt: buildDocCommentMentionPrompt({
                agent,
                thread,
                document,
                triggerAuthor: activity.actorId,
                triggerText: text,
              }),
              temperature: 0.3,
            });
            replyText = result.text.trim() || noModelReply(agent, document);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            replyText = `Hi — I'm ${agent.name}. I tried to respond using ${deps.getProviderModelLabel()} but the request failed (${message}). Please check the provider configuration in Admin → Task Master.`;
          }
        } else {
          replyText = noModelReply(agent, document);
        }

        deps.postReply(activity.docId, agent.name, thread.id, replyText);
        deps.logActivity?.({
          agentName: agent.name,
          docId: activity.docId,
          commentId: thread.id,
          summary: clampText(replyText, 200),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.warn('[DocCommentMention] Failed to handle document comment mention:', message);
    }
  };
}
