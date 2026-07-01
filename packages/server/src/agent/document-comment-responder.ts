import { generateText } from 'ai';
import type { AgentRegistryRecord } from '../../../db/src';
import type { DocumentCommentReplyRecord } from '../../../db/src/document-collab';
import { getTaskAgentLanguageModel, getTaskAgentSettings } from './settings';
import { resolveMentionedAgents, type CommentResponderAgent } from './comment-responder';

export interface DocumentCommentMentionTrigger {
  docId: string;
  commentId: string;
  actorId: string;
  body: string;
}

export interface DocumentCommentMentionContext {
  docId: string;
  sourceId: string | null;
  path: string | null;
  range: {
    from: number;
    to: number;
  };
  selectedText: string | null;
  commentAuthor: string;
  commentText: string;
  replies: DocumentCommentReplyRecord[];
  documentExcerpt: string | null;
  documentExcerptRange: {
    from: number;
    to: number;
  } | null;
  documentReadError: string | null;
}

export interface DocumentCommentReplyInput {
  docId: string;
  commentId: string;
  author: string;
  text: string;
}

export interface DocumentCommentMentionResponderDeps {
  listAgents: () => AgentRegistryRecord[];
  getContext: (docId: string, commentId: string) => Promise<DocumentCommentMentionContext> | DocumentCommentMentionContext;
  createReply: (input: DocumentCommentReplyInput) => Promise<unknown> | unknown;
  getLanguageModel?: () => unknown | null;
  generateText?: typeof generateText;
  getSettings?: () => { provider: string; model: string };
  onError?: (message: string) => void;
}

function clampText(value: string | null | undefined, max: number): string {
  if (!value) return '';
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

function formatThread(context: DocumentCommentMentionContext): string {
  const lines = [`- ${context.commentAuthor}: ${clampText(context.commentText, 800)}`];
  for (const reply of context.replies.slice(-10)) {
    lines.push(`  - ${reply.author}: ${clampText(reply.text, 500)}`);
  }
  return lines.join('\n');
}

function noModelDocumentReply(agent: CommentResponderAgent, context: DocumentCommentMentionContext): string {
  const selected = clampText(context.selectedText, 160);
  const selectedNote = selected ? ` I can see the selected text: "${selected}".` : '';
  return `Hi - I'm ${agent.name}. I received your document comment.${selectedNote} I don't have a language model configured yet, so I can't draft a contextual response. Configure a provider/model in Admin -> Task Master and mention me again for a full reply.`;
}

export function buildDocumentMentionPrompt(
  agent: CommentResponderAgent,
  context: DocumentCommentMentionContext,
  trigger: DocumentCommentMentionTrigger,
): string {
  const selectedText = clampText(context.selectedText, 1000);
  const sourceLabel = context.sourceId ? `${context.sourceId}:${context.path ?? ''}` : context.path ?? context.docId;
  const excerptLabel = context.documentExcerptRange
    ? `characters ${context.documentExcerptRange.from}-${context.documentExcerptRange.to}`
    : 'unavailable';

  const lines = [
    `You are ${agent.name}, an agent in Entity Doc Hub. You were @mentioned in an anchored document comment thread.`,
    'Answer using the selected text, the nearby document context, and the visible thread. Do not claim that you edited or saved the document unless an explicit edit operation happened.',
    '',
    '## Document',
    `- Doc ID: ${context.docId}`,
    `- Source/path: ${sourceLabel}`,
    `- Anchor offsets: ${context.range.from}-${context.range.to}`,
    selectedText ? `- Selected text: ${selectedText}` : '- Selected text: unavailable',
    '',
    '## Comment thread',
    formatThread(context),
    '',
    '## The message mentioning you',
    `${trigger.actorId}: ${clampText(trigger.body, 1000)}`,
    '',
    '## Nearby document context',
    context.documentExcerpt
      ? `Excerpt (${excerptLabel}):\n${clampText(context.documentExcerpt, 3000)}`
      : `Unavailable${context.documentReadError ? `: ${context.documentReadError}` : ''}.`,
    '',
    'Reply as plain text. Keep it under ~140 words and make the answer specific to the selected text.',
  ];

  return lines.filter((line) => line !== '').join('\n');
}

export function createDocumentCommentMentionResponder(deps: DocumentCommentMentionResponderDeps) {
  return async function handleDocumentCommentMention(trigger: DocumentCommentMentionTrigger): Promise<void> {
    try {
      const agents = resolveMentionedAgents(trigger.body, deps.listAgents());
      if (agents.length === 0) {
        return;
      }

      const settings = deps.getSettings ? deps.getSettings() : getTaskAgentSettings();
      const model = deps.getLanguageModel ? deps.getLanguageModel() : getTaskAgentLanguageModel();
      const context = await deps.getContext(trigger.docId, trigger.commentId);
      const runGenerateText = deps.generateText ?? generateText;

      for (const agent of agents) {
        let replyText: string;
        if (model) {
          try {
            const result = await runGenerateText({
              model: model as Parameters<typeof generateText>[0]['model'],
              prompt: buildDocumentMentionPrompt(agent, context, trigger),
              temperature: 0.3,
            });
            replyText = result.text.trim() || noModelDocumentReply(agent, context);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            replyText = `Hi - I'm ${agent.name}. I tried to respond using ${settings.provider}/${settings.model} but the request failed (${message}). Please check the provider configuration in Admin -> Task Master.`;
          }
        } else {
          replyText = noModelDocumentReply(agent, context);
        }

        await deps.createReply({
          docId: trigger.docId,
          commentId: trigger.commentId,
          author: agent.name,
          text: replyText,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      if (deps.onError) {
        deps.onError(message);
      } else {
        console.warn('[DocumentCommentResponder] Failed to handle document mention:', message);
      }
    }
  };
}
