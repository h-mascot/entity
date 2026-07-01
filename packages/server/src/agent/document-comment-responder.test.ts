import { describe, expect, it, vi } from 'vitest';
import type { AgentRegistryRecord } from '../../../db/src';
import type { DocumentCommentReplyRecord } from '../../../db/src/document-collab';
import {
  buildDocumentMentionPrompt,
  createDocumentCommentMentionResponder,
  type DocumentCommentMentionContext,
} from './document-comment-responder';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('./settings', () => ({
  getTaskAgentLanguageModel: () => null,
  getTaskAgentSettings: () => ({ provider: 'openai-compatible', model: 'entity-test' }),
}));

function makeAgent(overrides: Partial<AgentRegistryRecord> = {}): AgentRegistryRecord {
  const now = new Date().toISOString();
  return {
    id: 'assistant',
    slug: 'assistant',
    name: 'Assistant',
    emoji: ':',
    avatar_url: null,
    description: null,
    adapter_type: null,
    runtime_type: null,
    runtime_binding_id: null,
    provider_type: 'unknown',
    helm_managed: false,
    binding_state: 'unknown',
    status: 'active',
    instructions_path: null,
    metadata_json: '{}',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeContext(overrides: Partial<DocumentCommentMentionContext> = {}): DocumentCommentMentionContext {
  return {
    docId: 'workspace:/docs/plan.md',
    sourceId: 'workspace',
    path: '/docs/plan.md',
    range: { from: 6, to: 18 },
    selectedText: 'agent review',
    commentAuthor: 'Henry',
    commentText: '@assistant please check this claim',
    replies: [],
    documentExcerpt: 'Intro agent review should cite this nearby paragraph and conclusion.',
    documentExcerptRange: { from: 0, to: 68 },
    documentReadError: null,
    ...overrides,
  };
}

function makeReply(overrides: Partial<DocumentCommentReplyRecord> = {}): DocumentCommentReplyRecord {
  const now = new Date().toISOString();
  return {
    id: 'reply-1',
    doc_id: 'workspace:/docs/plan.md',
    comment_id: 'comment-1',
    author: 'Henry',
    text: '@assistant can you respond here too?',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('buildDocumentMentionPrompt', () => {
  it('includes selected text, thread, and nearby document context', () => {
    const context = makeContext({
      replies: [makeReply({ id: 'reply-old', text: 'Earlier human context.' })],
    });

    const prompt = buildDocumentMentionPrompt(
      { id: 'assistant', slug: 'assistant', name: 'Assistant' },
      context,
      {
        docId: context.docId,
        commentId: 'comment-1',
        actorId: 'Henry',
        body: '@assistant please check this claim',
      },
    );

    expect(prompt).toContain('You are Assistant');
    expect(prompt).toContain('Selected text: agent review');
    expect(prompt).toContain('Source/path: workspace:/docs/plan.md');
    expect(prompt).toContain('Henry: @assistant please check this claim');
    expect(prompt).toContain('Earlier human context.');
    expect(prompt).toContain('nearby paragraph');
  });

  it('excludes the triggering reply from prior thread history', () => {
    const context = makeContext({
      replies: [
        makeReply({ id: 'older-reply', text: 'Older thread context.' }),
        makeReply({ id: 'trigger-reply', text: '@assistant please answer this reply' }),
      ],
    });

    const prompt = buildDocumentMentionPrompt(
      { id: 'assistant', slug: 'assistant', name: 'Assistant' },
      context,
      {
        docId: context.docId,
        commentId: 'comment-1',
        actorId: 'Henry',
        body: '@assistant please answer this reply',
        replyId: 'trigger-reply',
      },
    );

    expect(prompt).toContain('Older thread context.');
    expect(prompt.match(/@assistant please answer this reply/g)).toHaveLength(1);
  });
});

describe('createDocumentCommentMentionResponder', () => {
  it('creates a same-thread fallback reply when a document comment mentions an active agent', async () => {
    const context = makeContext();
    const replies: DocumentCommentReplyRecord[] = [];
    const responder = createDocumentCommentMentionResponder({
      listAgents: () => [makeAgent()],
      getContext: async () => context,
      createReply: (input) => {
        const reply = makeReply({
          id: `reply-${replies.length + 1}`,
          doc_id: input.docId,
          comment_id: input.commentId,
          author: input.author,
          text: input.text,
        });
        replies.push(reply);
        return reply;
      },
    });

    await responder({
      docId: context.docId,
      commentId: 'comment-1',
      actorId: 'Henry',
      body: '@assistant please check this claim',
    });

    expect(replies).toHaveLength(1);
    expect(replies[0].author).toBe('Assistant');
    expect(replies[0].comment_id).toBe('comment-1');
    expect(replies[0].text).toContain('selected text: "agent review"');
  });

  it('responds to @mentions in later thread replies without reusing the triggering reply as history', async () => {
    const context = makeContext({ commentText: 'Initial comment without a mention.' });
    const replies: DocumentCommentReplyRecord[] = [];
    const responder = createDocumentCommentMentionResponder({
      listAgents: () => [makeAgent()],
      getContext: async () => context,
      createReply: (input) => {
        const reply = makeReply({
          id: 'reply-agent',
          author: input.author,
          text: input.text,
        });
        replies.push(reply);
        return reply;
      },
    });

    await responder({
      docId: context.docId,
      commentId: 'comment-1',
      actorId: 'Henry',
      body: '@assistant can you respond here too?',
    });

    expect(replies).toHaveLength(1);
    expect(replies[0].author).toBe('Assistant');
  });

  it('does nothing for unknown or inactive mentions', async () => {
    const context = makeContext({ commentText: '@ghost please help' });
    const createReply = vi.fn();
    const responder = createDocumentCommentMentionResponder({
      listAgents: () => [makeAgent({ status: 'disabled' })],
      getContext: async () => context,
      createReply,
    });

    await responder({
      docId: context.docId,
      commentId: 'comment-1',
      actorId: 'Henry',
      body: '@ghost please help',
    });

    expect(createReply).not.toHaveBeenCalled();
  });

  it('persists a sanitized provider failure reply and reports details to the error hook', async () => {
    const context = makeContext();
    const replies: DocumentCommentReplyRecord[] = [];
    const errors: string[] = [];
    const responder = createDocumentCommentMentionResponder({
      listAgents: () => [makeAgent()],
      getContext: async () => context,
      getLanguageModel: () => ({ provider: 'test' }),
      getSettings: () => ({ provider: 'openai-compatible', model: 'azure-deployment' }),
      generateText: async () => {
        throw new Error('https://private.example.test deployment secret diagnostic');
      },
      onError: (message) => errors.push(message),
      createReply: (input) => {
        const reply = makeReply({
          id: 'reply-provider-error',
          author: input.author,
          text: input.text,
        });
        replies.push(reply);
        return reply;
      },
    });

    await responder({
      docId: context.docId,
      commentId: 'comment-1',
      actorId: 'Henry',
      body: '@assistant please check this claim',
    });

    expect(replies).toHaveLength(1);
    expect(replies[0].text).toContain('request failed');
    expect(replies[0].text).not.toContain('private.example.test');
    expect(errors[0]).toBe('Provider response failed for openai-compatible/azure-deployment.');
  });
});
