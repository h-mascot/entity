import { generateText, type LanguageModel } from 'ai';
import type { AgentRegistryRecord } from '../../../db/src';
import { resolveMentionedAgents, type CommentResponderAgent } from '../agent/comment-responder';

const INACTIVE_AGENT_STATUSES = new Set(['offline', 'inactive', 'disabled', 'archived', 'retired', 'deleted']);

/** Reply/comment context for a single thread, used to ground the agent reply. */
export interface DocCommentThreadContext {
  author: string;
  text: string;
  selectedText: string | null;
  replies: Array<{ author: string; text: string }>;
}

/** Fired by the editor service whenever a comment or reply is created. */
export interface DocumentCommentMentionEvent {
  docId: string;
  /** Thread (parent comment) id to reply under. */
  commentId: string;
  /** Actor identity that authored the triggering comment/reply. */
  author: string;
  /** Text of the triggering comment/reply (scanned for @mentions). */
  text: string;
  selectedText: string | null;
  range: { from: number; to: number } | null;
}

export interface DocumentCommentResponderDeps {
  listAgents: () => AgentRegistryRecord[];
  getModel: () => LanguageModel | null;
  getSettings: () => { provider: string; model: string };
  getDocumentContent: (docId: string) => Promise<string | null>;
  getThread: (docId: string, commentId: string) => DocCommentThreadContext | null;
  postReply: (docId: string, author: string, commentId: string, text: string) => void;
  logActivity?: (input: { agentName: string; docId: string; summary: string }) => void;
}

export type DocumentCommentResponder = (event: DocumentCommentMentionEvent) => Promise<void>;

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function isActiveAgent(agent: AgentRegistryRecord): boolean {
  const status = (agent.status ?? '').trim().toLowerCase();
  return status ? !INACTIVE_AGENT_STATUSES.has(status) : true;
}

/**
 * True when the comment author resolves to a registered agent. Used as a loop
 * guard so an agent's own reply never re-triggers another agent reply.
 */
export function isRegistryAgentAuthor(author: string, agents: AgentRegistryRecord[]): boolean {
  const normalizedAuthor = normalizeIdentity(author);
  if (!normalizedAuthor) return false;
  return agents.some((agent) => {
    if (!isActiveAgent(agent)) return false;
    return [agent.slug, agent.name, agent.id].map(normalizeIdentity).includes(normalizedAuthor);
  });
}

function clampText(value: string | null | undefined, max: number): string {
  if (!value) return '';
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Returns an excerpt of the document content, windowed around the commented
 * range when the document is large so the model sees the relevant passage.
 */
export function buildContentExcerpt(
  content: string | null,
  range: { from: number; to: number } | null,
  maxChars = 4000,
): string {
  if (!content) return '';
  if (content.length <= maxChars) {
    return content;
  }

  if (!range) {
    return `${content.slice(0, maxChars)}\n…(truncated)`;
  }

  const center = Math.floor((range.from + range.to) / 2);
  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, center - half);
  const end = Math.min(content.length, start + maxChars);
  const prefix = start > 0 ? '…(truncated)\n' : '';
  const suffix = end < content.length ? '\n…(truncated)' : '';
  return `${prefix}${content.slice(start, end)}${suffix}`;
}

/** Compose the grounding prompt: document excerpt + selection + thread + mention. */
export function buildDocCommentPrompt(args: {
  agent: CommentResponderAgent;
  docId: string;
  documentContent: string | null;
  selectedText: string | null;
  range: { from: number; to: number } | null;
  thread: DocCommentThreadContext | null;
  triggerAuthor: string;
  triggerText: string;
}): string {
  const { agent, docId, documentContent, selectedText, range, thread, triggerAuthor, triggerText } = args;
  const excerpt = buildContentExcerpt(documentContent, range, 4000);

  const priorReplies = (thread?.replies ?? [])
    .filter((reply) => reply.text.trim() !== triggerText.trim())
    .slice(-8)
    .map((reply) => `- ${reply.author}: ${clampText(reply.text, 500)}`)
    .join('\n');

  const lines = [
    `You are ${agent.name}, an agent collaborating inside the Entity document editor (Doc Hub).`,
    'A user @mentioned you in a comment anchored to a passage of a document.',
    'Use the document context and the highlighted passage to answer directly and concisely.',
    '',
    `## Document\n- Reference: ${docId}`,
    excerpt ? `\n### Document content\n${excerpt}` : '\n### Document content\n(unavailable)',
    '',
    '## Highlighted passage (what the comment is anchored to)',
    selectedText && selectedText.trim() ? clampText(selectedText, 1500) : '(no specific text selected)',
    range ? `(character range ${range.from}–${range.to})` : '',
    '',
    thread ? `## Comment thread\n- ${thread.author}: ${clampText(thread.text, 1000)}` : '',
    priorReplies ? `### Earlier replies\n${priorReplies}` : '',
    '',
    '## The comment mentioning you',
    `${triggerAuthor}: ${clampText(triggerText, 1000)}`,
    '',
    'Reply as plain text (no markdown headers, do not @mention anyone). Ground your answer in the highlighted passage and document content. Keep it under ~120 words.',
  ];

  return lines.filter((line) => line !== '').join('\n');
}

export function noModelDocReply(agent: CommentResponderAgent): string {
  return (
    `Hi — I'm ${agent.name}. I can see this document and the highlighted passage, ` +
    `but I don't have a language model configured yet, so I can't draft a full response. ` +
    `Configure a provider/model in Admin → Task Master (e.g. Google Gemini, or an Azure OpenAI base URL + API key) and mention me again for a full reply.`
  );
}

function errorReply(agent: CommentResponderAgent, settings: { provider: string; model: string }, error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return (
    `Hi — I'm ${agent.name}. I tried to respond using ${settings.provider}/${settings.model} ` +
    `but the request failed (${message}). Please check the provider configuration in Admin → Task Master.`
  );
}

/**
 * Responds to @agent mentions inside document comments. Reads the document and
 * the anchored passage, generates a grounded reply with the configured model,
 * and posts it back into the comment thread. Agent-authored comments are
 * ignored to prevent reply loops.
 */
export function createDocumentCommentResponder(deps: DocumentCommentResponderDeps): DocumentCommentResponder {
  return async function handleDocumentCommentMention(event: DocumentCommentMentionEvent): Promise<void> {
    try {
      const text = event.text ?? '';
      const agents = deps.listAgents();

      // Loop guard: never let an agent's own reply trigger more agent replies.
      if (isRegistryAgentAuthor(event.author, agents)) {
        return;
      }

      const mentioned = resolveMentionedAgents(text, agents);
      if (mentioned.length === 0) {
        return;
      }

      const documentContent = await deps.getDocumentContent(event.docId).catch(() => null);
      const thread = deps.getThread(event.docId, event.commentId);
      const model = deps.getModel();
      const settings = deps.getSettings();
      const authorIdentity = normalizeIdentity(event.author);

      for (const agent of mentioned) {
        // Defensive: don't let an agent reply to its own message.
        if ([agent.slug, agent.name, agent.id].map(normalizeIdentity).includes(authorIdentity)) {
          continue;
        }

        let replyText: string;
        if (model) {
          try {
            const result = await generateText({
              model,
              prompt: buildDocCommentPrompt({
                agent,
                docId: event.docId,
                documentContent,
                selectedText: event.selectedText,
                range: event.range,
                thread,
                triggerAuthor: event.author,
                triggerText: text,
              }),
              temperature: 0.3,
            });
            replyText = result.text.trim() || noModelDocReply(agent);
          } catch (error) {
            replyText = errorReply(agent, settings, error);
          }
        } else {
          replyText = noModelDocReply(agent);
        }

        deps.postReply(event.docId, agent.name, event.commentId, replyText);
        deps.logActivity?.({
          agentName: agent.name,
          docId: event.docId,
          summary: clampText(replyText, 200),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.warn('[DocCommentResponder] Failed to handle comment mention:', message);
    }
  };
}
