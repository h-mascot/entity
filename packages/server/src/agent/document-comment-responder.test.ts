import { describe, expect, it, vi } from 'vitest';
import type { AgentRegistryRecord } from '../../../db/src';
import type { DocumentCommentRecord, DocumentCommentReplyRecord } from '../../../db/src/document-collab';
import {
  buildDocumentMentionPrompt,
  createDocumentCommentMentionResponder,
  type DocumentMentionContext,
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

function makeComment(overrides: Partial<DocumentCommentRecord> = {}): DocumentCommentRecord {
  const now = new Date().toISOString();
  return {
    id: 'comment-1',
    doc_id: 'workspace:/docs/plan.md',
    author: 'Henry',
    start_offset: 6,
    end_offset: 18,
    selected_text: 'agent review',
    text: '@assistant please check this claim',
    resolved: false,
    created_at: now,
    updated_at: now,
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
    const comment = makeComment();
    const context: DocumentMentionContext = {
      docId: comment.doc_id,
      sourceId: 'workspace',
      path: '/docs/plan.md',
      content: 'Intro agent review should cite this nearby paragraph and conclusion.',
    };

    const prompt = buildDocumentMentionPrompt(
      { id: 'assistant', slug: 'assistant', name: 'Assistant' },
      { kind: 'comment', docId: comment.doc_id, comment },
      context,
      [makeReply({ id: 'reply-old', text: 'Earlier human context.' })],
    );

    expect(prompt).toContain('You are Assistant');
    expect(prompt).toContain('Selected text: agent review');
    expect(prompt).toContain('Path: /docs/plan.md');
    expect(prompt).toContain('Henry: @assistant please check this claim');
    expect(prompt).toContain('Earlier human context.');
    expect(prompt).toContain('nearby paragraph');
  });
});

describe('createDocumentCommentMentionResponder', () => {
  it('creates a same-thread fallback reply when a document comment mentions an active agent', async () => {
    const comment = makeComment();
    const replies: DocumentCommentReplyRecord[] = [];
    const broadcasts: Array<{ docId: string; commentId: string; reply: DocumentCommentReplyRecord }> = [];
    const responder = createDocumentCommentMentionResponder({
      listAgents: () => [makeAgent()],
      readDocumentContext: async () => ({
        docId: comment.doc_id,
        sourceId: 'workspace',
        path: '/docs/plan.md',
        content: 'Intro agent review should cite this paragraph.',
      }),
      listThreadReplies: () => replies,
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
      broadcastReply: (docId, commentId, reply) => broadcasts.push({ docId, commentId, reply }),
    });

    await responder({ kind: 'comment', docId: comment.doc_id, comment });

    expect(replies).toHaveLength(1);
    expect(replies[0].author).toBe('Assistant');
    expect(replies[0].comment_id).toBe(comment.id);
    expect(replies[0].text).toContain('selected text: "agent review"');
    expect(broadcasts).toEqual([{ docId: comment.doc_id, commentId: comment.id, reply: replies[0] }]);
  });

  it('responds to @mentions in later thread replies without reusing the triggering reply as history', async () => {
    const comment = makeComment({ text: 'Initial comment without a mention.' });
    const triggerReply = makeReply();
    const replies = [triggerReply];
    const responder = createDocumentCommentMentionResponder({
      listAgents: () => [makeAgent()],
      readDocumentContext: async () => ({
        docId: comment.doc_id,
        sourceId: 'workspace',
        path: '/docs/plan.md',
        content: 'Context for a thread reply mention.',
      }),
      listThreadReplies: () => replies,
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

    await responder({ kind: 'reply', docId: comment.doc_id, comment, reply: triggerReply });

    expect(replies).toHaveLength(2);
    expect(replies[1].author).toBe('Assistant');
  });

  it('does nothing for unknown or inactive mentions', async () => {
    const comment = makeComment({ text: '@ghost please help' });
    const createReply = vi.fn();
    const responder = createDocumentCommentMentionResponder({
      listAgents: () => [makeAgent({ status: 'disabled' })],
      readDocumentContext: async () => ({
        docId: comment.doc_id,
        sourceId: null,
        path: null,
        content: '',
      }),
      listThreadReplies: () => [],
      createReply,
    });

    await responder({ kind: 'comment', docId: comment.doc_id, comment });

    expect(createReply).not.toHaveBeenCalled();
  });
});
