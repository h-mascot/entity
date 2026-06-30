import { describe, expect, it, vi } from 'vitest';
import type { AgentRegistryRecord } from '../../../db/src';
import type { DocumentCommentReplyRecord } from '../../../db/src/document-collab';
import {
  buildDocumentMentionPrompt,
  createDocumentCommentMentionResponder,
  type DocumentCommentMentionContext,
} from './document-comment-responder';

function makeAgent(overrides: Partial<AgentRegistryRecord> = {}): AgentRegistryRecord {
  const now = new Date().toISOString();
  return {
    id: 'assistant',
    slug: 'assistant',
    name: 'Assistant',
    emoji: 'A',
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

function makeReply(overrides: Partial<DocumentCommentReplyRecord> = {}): DocumentCommentReplyRecord {
  const now = new Date().toISOString();
  return {
    id: 'reply-1',
    doc_id: 'workspace:/docs/audit.md',
    comment_id: 'comment-1',
    author: 'human',
    text: 'Prior reply',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeContext(overrides: Partial<DocumentCommentMentionContext> = {}): DocumentCommentMentionContext {
  return {
    docId: 'workspace:/docs/audit.md',
    sourceId: 'workspace',
    path: '/docs/audit.md',
    range: {
      from: 7,
      to: 32,
    },
    selectedText: 'Selected paragraph about renewal risk.',
    commentAuthor: 'human',
    commentText: '@assistant does this section have enough context?',
    replies: [makeReply({ author: 'ada', text: 'Earlier note from Ada.' })],
    documentExcerpt: 'Intro\n\nSelected paragraph about renewal risk.\n\nNext paragraph with customer context.',
    documentExcerptRange: {
      from: 0,
      to: 82,
    },
    documentReadError: null,
    ...overrides,
  };
}

describe('buildDocumentMentionPrompt', () => {
  it('includes document, selected text, excerpt, thread, and trigger context', () => {
    const prompt = buildDocumentMentionPrompt(
      { id: 'assistant', slug: 'assistant', name: 'Assistant' },
      makeContext(),
      {
        docId: 'workspace:/docs/audit.md',
        commentId: 'comment-1',
        actorId: 'human',
        body: '@assistant does this section have enough context?',
      }
    );

    expect(prompt).toContain('Entity Doc Hub');
    expect(prompt).toContain('workspace:/docs/audit.md');
    expect(prompt).toContain('Anchor range: 7-32');
    expect(prompt).toContain('Selected paragraph about renewal risk.');
    expect(prompt).toContain('Next paragraph with customer context.');
    expect(prompt).toContain('ada: Earlier note from Ada.');
    expect(prompt).toContain('human: @assistant does this section have enough context?');
    expect(prompt).toContain('Do not claim that you edited or saved');
  });

  it('surfaces degraded document read context in the prompt', () => {
    const prompt = buildDocumentMentionPrompt(
      { id: 'assistant', slug: 'assistant', name: 'Assistant' },
      makeContext({ documentExcerpt: null, documentExcerptRange: null, documentReadError: 'source unavailable' }),
      {
        docId: 'workspace:/docs/audit.md',
        commentId: 'comment-1',
        actorId: 'human',
        body: '@assistant help',
      }
    );

    expect(prompt).toContain('Excerpt unavailable: source unavailable.');
  });
});

describe('createDocumentCommentMentionResponder', () => {
  it('creates a graceful document-thread reply when no model is configured', async () => {
    const replies: Array<{ author: string; text: string; commentId: string }> = [];
    const responder = createDocumentCommentMentionResponder({
      listAgents: () => [makeAgent()],
      getContext: () => makeContext(),
      getLanguageModel: () => null,
      createReply: ({ author, text, commentId }) => {
        replies.push({ author, text, commentId });
      },
    });

    await responder({
      docId: 'workspace:/docs/audit.md',
      commentId: 'comment-1',
      actorId: 'human',
      body: '@assistant please answer this',
    });

    expect(replies).toHaveLength(1);
    expect(replies[0].author).toBe('Assistant');
    expect(replies[0].commentId).toBe('comment-1');
    expect(replies[0].text).toContain('Selected paragraph about renewal risk.');
    expect(replies[0].text).toContain('Configure a provider/model');
  });

  it('uses the language model with full document comment context when configured', async () => {
    const generate = vi.fn(async () => ({ text: 'This section needs one concrete customer detail.' }));
    const replies: Array<{ author: string; text: string }> = [];
    const responder = createDocumentCommentMentionResponder({
      listAgents: () => [makeAgent()],
      getContext: () => makeContext(),
      getLanguageModel: () => ({ modelId: 'test-model' }),
      generateText: generate as never,
      createReply: ({ author, text }) => {
        replies.push({ author, text });
      },
    });

    await responder({
      docId: 'workspace:/docs/audit.md',
      commentId: 'comment-1',
      actorId: 'human',
      body: '@assistant please answer this',
    });

    expect(generate).toHaveBeenCalledTimes(1);
    const calls = generate.mock.calls as unknown as Array<[{ prompt: string }]>;
    const firstCall = calls[0]?.[0];
    expect(firstCall?.prompt).toContain('Selected paragraph about renewal risk.');
    expect(firstCall?.prompt).toContain('Earlier note from Ada.');
    expect(replies).toEqual([{ author: 'Assistant', text: 'This section needs one concrete customer detail.' }]);
  });

  it('does not reply for unknown or inactive mentioned agents', async () => {
    const createReply = vi.fn();
    const getContext = vi.fn(() => makeContext());
    const responder = createDocumentCommentMentionResponder({
      listAgents: () => [makeAgent({ status: 'disabled' })],
      getContext,
      getLanguageModel: () => null,
      createReply,
    });

    await responder({
      docId: 'workspace:/docs/audit.md',
      commentId: 'comment-1',
      actorId: 'human',
      body: '@assistant @nobody help',
    });

    expect(getContext).not.toHaveBeenCalled();
    expect(createReply).not.toHaveBeenCalled();
  });

  it('posts a visible degraded reply when model generation fails', async () => {
    const replies: string[] = [];
    const responder = createDocumentCommentMentionResponder({
      listAgents: () => [makeAgent()],
      getContext: () => makeContext(),
      getLanguageModel: () => ({ modelId: 'broken-model' }),
      generateText: vi.fn(async () => {
        throw new Error('timeout');
      }) as never,
      getSettings: () => ({ provider: 'openai-compatible', model: 'azure-deployment' }),
      createReply: ({ text }) => {
        replies.push(text);
      },
    });

    await responder({
      docId: 'workspace:/docs/audit.md',
      commentId: 'comment-1',
      actorId: 'human',
      body: '@assistant please answer',
    });

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('openai-compatible/azure-deployment');
    expect(replies[0]).toContain('timeout');
  });
});
