import { generateText } from 'ai';
import type { AgentRegistryRecord } from '../../../db/src';
import type { DocumentCommentRecord, DocumentCommentReplyRecord } from '../../../db/src/document-collab';
import { getTaskAgentLanguageModel, getTaskAgentSettings } from './settings';
import { resolveMentionedAgents, type CommentResponderAgent } from './comment-responder';

export interface DocumentMentionContext {
  docId: string;
  sourceId: string | null;
  path: string | null;
  content: string;
}

export type DocumentCommentMentionTrigger =
  | {
      kind: 'comment';
      docId: string;
      comment: DocumentCommentRecord;
    }
  | {
      kind: 'reply';
      docId: string;
      comment: DocumentCommentRecord;
      reply: DocumentCommentReplyRecord;
    };

export interface DocumentCommentReplyInput {
  docId: string;
  commentId: string;
  author: string;
  text: string;
}

export interface DocumentCommentMentionResponderDeps {
  listAgents: () => AgentRegistryRecord[];
  readDocumentContext: (docId: string, comment: DocumentCommentRecord) => Promise<DocumentMentionContext>;
  listThreadReplies: (docId: string, commentId: string) => DocumentCommentReplyRecord[];
  createReply: (input: DocumentCommentReplyInput) => DocumentCommentReplyRecord;
  broadcastReply?: (docId: string, commentId: string, reply: DocumentCommentReplyRecord) => void;
}

function clampText(value: string | null | undefined, max: number): string {
  if (!value) return '';
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

function triggerText(trigger: DocumentCommentMentionTrigger): string {
  return trigger.kind === 'reply' ? trigger.reply.text : trigger.comment.text;
}

function triggerAuthor(trigger: DocumentCommentMentionTrigger): string {
  return trigger.kind === 'reply' ? trigger.reply.author : trigger.comment.author;
}

function excerptAroundAnchor(content: string, comment: DocumentCommentRecord, radius = 900): string {
  if (!content) {
    return '';
  }

  const start = Math.max(0, Math.min(comment.start_offset, content.length));
  const end = Math.max(start, Math.min(comment.end_offset, content.length));
  const excerptStart = Math.max(0, start - radius);
  const excerptEnd = Math.min(content.length, end + radius);
  const prefix = excerptStart > 0 ? '...' : '';
  const suffix = excerptEnd < content.length ? '...' : '';
  return `${prefix}${content.slice(excerptStart, excerptEnd)}${suffix}`;
}

function noModelDocumentReply(agent: CommentResponderAgent, trigger: DocumentCommentMentionTrigger): string {
  const selected = clampText(trigger.comment.selected_text, 160);
  const selectedNote = selected ? ` I can see the selected text: "${selected}".` : '';
  return `Hi - I'm ${agent.name}. I received your document comment.${selectedNote} I don't have a language model configured yet, so I can't draft a contextual response. Configure a provider/model in Admin -> Task Master and mention me again for a full reply.`;
}

export function buildDocumentMentionPrompt(
  agent: CommentResponderAgent,
  trigger: DocumentCommentMentionTrigger,
  context: DocumentMentionContext,
  threadReplies: DocumentCommentReplyRecord[],
): string {
  const selectedText = clampText(trigger.comment.selected_text, 1000);
  const anchoredContext = clampText(excerptAroundAnchor(context.content, trigger.comment), 2500);
  const fullDocumentExcerpt = clampText(context.content, 3500);
  const recentReplies = threadReplies
    .filter((reply) => trigger.kind !== 'reply' || reply.id !== trigger.reply.id)
    .slice(-8)
    .map((reply) => `- ${reply.author}: ${clampText(reply.text, 500)}`)
    .join('\n');

  const lines = [
    `You are ${agent.name}, an agent in Entity Doc Hub. You were @mentioned in an anchored document comment thread.`,
    'Answer using the selected text, the nearby document context, and the visible thread. Do not claim access to context that is marked unavailable.',
    '',
    '## Document',
    `- Doc ID: ${context.docId}`,
    context.sourceId ? `- Source: ${context.sourceId}` : '',
    context.path ? `- Path: ${context.path}` : '',
    `- Anchor offsets: ${trigger.comment.start_offset}-${trigger.comment.end_offset}`,
    selectedText ? `- Selected text: ${selectedText}` : '- Selected text: unavailable',
    '',
    '## Root comment',
    `${trigger.comment.author}: ${clampText(trigger.comment.text, 1000)}`,
    '',
    recentReplies ? `## Existing thread replies\n${recentReplies}` : '',
    '',
    '## The message mentioning you',
    `${triggerAuthor(trigger)}: ${clampText(triggerText(trigger), 1000)}`,
    '',
    anchoredContext ? `## Nearby document context\n${anchoredContext}` : '## Nearby document context\nUnavailable.',
    '',
    fullDocumentExcerpt ? `## Document excerpt\n${fullDocumentExcerpt}` : '',
    '',
    'Reply as plain text. Keep it under ~140 words and make the answer specific to the selected text.',
  ];

  return lines.filter((line) => line !== '').join('\n');
}

export function createDocumentCommentMentionResponder(deps: DocumentCommentMentionResponderDeps) {
  return async function handleDocumentCommentMention(trigger: DocumentCommentMentionTrigger): Promise<void> {
    try {
      const agents = resolveMentionedAgents(triggerText(trigger), deps.listAgents());
      if (agents.length === 0) {
        return;
      }

      const settings = getTaskAgentSettings();
      const model = getTaskAgentLanguageModel();
      let context: DocumentMentionContext;
      try {
        context = await deps.readDocumentContext(trigger.docId, trigger.comment);
      } catch {
        context = {
          docId: trigger.docId,
          sourceId: null,
          path: null,
          content: '',
        };
      }
      const threadReplies = deps.listThreadReplies(trigger.docId, trigger.comment.id);

      for (const agent of agents) {
        let replyText: string;
        if (model) {
          try {
            const result = await generateText({
              model,
              prompt: buildDocumentMentionPrompt(agent, trigger, context, threadReplies),
              temperature: 0.3,
            });
            replyText = result.text.trim() || noModelDocumentReply(agent, trigger);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            replyText = `Hi - I'm ${agent.name}. I tried to respond using ${settings.provider}/${settings.model} but the request failed (${message}). Please check the provider configuration in Admin -> Task Master.`;
          }
        } else {
          replyText = noModelDocumentReply(agent, trigger);
        }

        const reply = deps.createReply({
          docId: trigger.docId,
          commentId: trigger.comment.id,
          author: agent.name,
          text: replyText,
        });
        deps.broadcastReply?.(trigger.docId, trigger.comment.id, reply);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.warn('[DocumentCommentResponder] Failed to handle document mention:', message);
    }
  };
}
