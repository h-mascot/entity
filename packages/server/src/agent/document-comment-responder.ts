import { generateText } from 'ai';
import type { AgentRegistryRecord } from '../../../db/src';
import type { DocumentCommentReplyRecord } from '../../../db/src/document-collab';
import {
  resolveMentionedAgents,
  type CommentResponderAgent,
} from './comment-responder';
import { getTaskAgentLanguageModel, getTaskAgentSettings } from './settings';

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

type GenerateTextFn = typeof generateText;

export interface DocumentCommentMentionResponderDeps {
  listAgents: () => AgentRegistryRecord[];
  getContext: (
    docId: string,
    commentId: string
  ) => Promise<DocumentCommentMentionContext> | DocumentCommentMentionContext;
  createReply: (input: DocumentCommentReplyInput) => Promise<unknown> | unknown;
  getLanguageModel?: () => unknown | null;
  generateText?: GenerateTextFn;
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

export function buildDocumentMentionPrompt(
  agent: CommentResponderAgent,
  context: DocumentCommentMentionContext,
  trigger: DocumentCommentMentionTrigger
): string {
  const sourceLabel = context.sourceId ? `${context.sourceId}:${context.path ?? ''}` : context.path ?? context.docId;
  const excerptLabel = context.documentExcerptRange
    ? `characters ${context.documentExcerptRange.from}-${context.documentExcerptRange.to}`
    : 'unavailable';

  const lines = [
    `You are ${agent.name}, an agent in Entity Doc Hub. You were @mentioned in a document comment.`,
    'Use the document, selected text, anchor, and thread context to answer the user directly.',
    "Do not claim that you edited or saved the document unless an explicit edit operation was performed.",
    '',
    '## Document',
    `- Doc ID: ${context.docId}`,
    `- Source/path: ${sourceLabel}`,
    `- Anchor range: ${context.range.from}-${context.range.to}`,
    '',
    '## Selected text',
    context.selectedText ? clampText(context.selectedText, 1500) : '(none provided)',
    '',
    '## Document excerpt',
    context.documentExcerpt
      ? `Excerpt (${excerptLabel}):\n${clampText(context.documentExcerpt, 2500)}`
      : `Excerpt unavailable${context.documentReadError ? `: ${context.documentReadError}` : ''}.`,
    '',
    '## Comment thread',
    formatThread(context),
    '',
    '## The message mentioning you',
    `${trigger.actorId}: ${clampText(trigger.body, 1000)}`,
    '',
    'Reply as plain text, under ~120 words. Be specific to the selected text and thread.',
  ];

  return lines.join('\n');
}

function noModelReply(agent: CommentResponderAgent, context: DocumentCommentMentionContext): string {
  const selected = context.selectedText
    ? ` I can see the selected text: "${clampText(context.selectedText, 180)}".`
    : ' I can see the document comment thread.';
  return `Hi - I'm ${agent.name}.${selected} I don't have a language model configured yet, so I can't draft a full contextual response. Configure a provider/model in Admin -> Task Master and mention me again for a full reply.`;
}

export function createDocumentCommentMentionResponder(deps: DocumentCommentMentionResponderDeps) {
  return async function handleDocumentCommentMention(trigger: DocumentCommentMentionTrigger): Promise<void> {
    try {
      const agents = resolveMentionedAgents(trigger.body, deps.listAgents());
      if (agents.length === 0) {
        return;
      }

      const context = await deps.getContext(trigger.docId, trigger.commentId);
      const model = deps.getLanguageModel ? deps.getLanguageModel() : getTaskAgentLanguageModel();
      const settings = deps.getSettings ? deps.getSettings() : getTaskAgentSettings();
      const runGenerateText = deps.generateText ?? generateText;

      for (const agent of agents) {
        let replyBody: string;
        if (model) {
          try {
            const result = await runGenerateText({
              model: model as Parameters<GenerateTextFn>[0]['model'],
              prompt: buildDocumentMentionPrompt(agent, context, trigger),
              temperature: 0.3,
            });
            replyBody = result.text.trim() || noModelReply(agent, context);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            replyBody = `Hi - I'm ${agent.name}. I tried to respond using ${settings.provider}/${settings.model} but the request failed (${message}). Please check the provider configuration in Admin -> Task Master.`;
          }
        } else {
          replyBody = noModelReply(agent, context);
        }

        await deps.createReply({
          docId: trigger.docId,
          commentId: trigger.commentId,
          author: agent.name,
          text: replyBody,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      if (deps.onError) {
        deps.onError(message);
      } else {
        console.warn('[DocumentCommentResponder] Failed to handle document comment mention:', message);
      }
    }
  };
}
