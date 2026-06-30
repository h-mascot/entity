import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import type { AgentRegistryRecord } from '../../../db/src';
import {
  buildDocCommentMentionPrompt,
  createDocumentCommentMentionResponder,
  isRegisteredAgentActor,
  type DocumentContentSnapshot,
} from './comment-mention';
import type { DocumentCommentActivity, DocumentCommentThread } from './service';

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

const FAKE_MODEL = { modelId: 'fake' } as unknown as LanguageModel;

function makeAgent(overrides: Partial<AgentRegistryRecord> = {}): AgentRegistryRecord {
  const now = new Date().toISOString();
  return {
    id: 'ada',
    slug: 'ada',
    name: 'Ada',
    emoji: '🤖',
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

function makeThread(overrides: Partial<DocumentCommentThread> = {}): DocumentCommentThread {
  return {
    id: 'comment-1',
    range: { from: 0, to: 11 },
    text: '@Ada can you clarify this sentence?',
    author: 'henry',
    createdAt: new Date().toISOString(),
    selectedText: 'Hello world',
    resolved: false,
    replies: [],
    ...overrides,
  };
}

function makeActivity(overrides: Partial<DocumentCommentActivity> = {}): DocumentCommentActivity {
  return {
    docId: 'workspace:/notes/readme.md',
    commentId: 'comment-1',
    actorId: 'henry',
    text: '@Ada can you clarify this sentence?',
    kind: 'comment',
    ...overrides,
  };
}

const document: DocumentContentSnapshot = {
  content: 'Hello world. This is the body of the document.',
  sourceId: 'workspace',
  path: '/notes/readme.md',
};

describe('isRegisteredAgentActor', () => {
  const agents = [makeAgent({ id: 'ada', slug: 'ada', name: 'Ada' })];

  it('matches by slug, name (case/space-insensitive) and id', () => {
    expect(isRegisteredAgentActor('ada', agents)).toBe(true);
    expect(isRegisteredAgentActor('Ada', agents)).toBe(true);
    expect(isRegisteredAgentActor('A D A', agents)).toBe(true);
  });

  it('returns false for non-agent actors and empty input', () => {
    expect(isRegisteredAgentActor('henry', agents)).toBe(false);
    expect(isRegisteredAgentActor('', agents)).toBe(false);
  });

  it('ignores inactive agents', () => {
    const inactive = [makeAgent({ status: 'offline' })];
    expect(isRegisteredAgentActor('ada', inactive)).toBe(false);
  });
});

describe('buildDocCommentMentionPrompt', () => {
  it('includes document content, selected text and the thread', () => {
    const prompt = buildDocCommentMentionPrompt({
      agent: { id: 'ada', slug: 'ada', name: 'Ada' },
      thread: makeThread(),
      document,
      triggerAuthor: 'henry',
      triggerText: '@Ada can you clarify this sentence?',
    });

    expect(prompt).toContain('You are Ada');
    expect(prompt).toContain('/notes/readme.md');
    expect(prompt).toContain('body of the document');
    expect(prompt).toContain('Hello world');
    expect(prompt).toContain('henry: @Ada can you clarify this sentence?');
  });

  it('falls back to the document slice when no selectedText is stored', () => {
    const prompt = buildDocCommentMentionPrompt({
      agent: { id: 'ada', slug: 'ada', name: 'Ada' },
      thread: makeThread({ selectedText: null, range: { from: 0, to: 5 } }),
      document,
      triggerAuthor: 'henry',
      triggerText: 'look here @Ada',
    });

    expect(prompt).toContain('Hello');
  });
});

describe('createDocumentCommentMentionResponder', () => {
  function setup(opts: {
    model?: LanguageModel | null;
    agents?: AgentRegistryRecord[];
    thread?: DocumentCommentThread | null;
    readDocument?: () => Promise<DocumentContentSnapshot | null>;
  } = {}) {
    const postReply = vi.fn();
    const responder = createDocumentCommentMentionResponder({
      listAgents: () => opts.agents ?? [makeAgent()],
      getModel: () => (opts.model === undefined ? null : opts.model),
      getProviderModelLabel: () => 'google/gemini-2.5-flash',
      readDocumentContent: opts.readDocument ?? (async () => document),
      getThread: () => (opts.thread === undefined ? makeThread() : opts.thread),
      postReply,
    });
    return { responder, postReply };
  }

  it('posts a graceful reply when no model is configured', async () => {
    const { responder, postReply } = setup({ model: null });
    await responder(makeActivity());

    expect(postReply).toHaveBeenCalledTimes(1);
    const [docId, author, commentId, text] = postReply.mock.calls[0]!;
    expect(docId).toBe('workspace:/notes/readme.md');
    expect(author).toBe('Ada');
    expect(commentId).toBe('comment-1');
    expect(text).toContain('no language model is configured');
  });

  it('generates a model reply grounded in the document context', async () => {
    generateTextMock.mockReset();
    generateTextMock.mockResolvedValue({ text: 'The sentence means X.' });
    const { responder, postReply } = setup({ model: FAKE_MODEL });
    await responder(makeActivity());

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const promptArg = (generateTextMock.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(promptArg).toContain('body of the document');
    expect(promptArg).toContain('Hello world');
    expect(postReply).toHaveBeenCalledWith(
      'workspace:/notes/readme.md',
      'Ada',
      'comment-1',
      'The sentence means X.',
    );
  });

  it('posts a fallback message when the model call throws', async () => {
    generateTextMock.mockReset();
    generateTextMock.mockRejectedValue(new Error('boom'));
    const { responder, postReply } = setup({ model: FAKE_MODEL });
    await responder(makeActivity());

    const text = postReply.mock.calls[0]![3] as string;
    expect(text).toContain('google/gemini-2.5-flash');
    expect(text).toContain('boom');
  });

  it('ignores activity that does not mention any agent', async () => {
    const { responder, postReply } = setup({ model: null });
    await responder(makeActivity({ text: 'just a normal comment, no mentions' }));
    expect(postReply).not.toHaveBeenCalled();
  });

  it('ignores activity authored by an agent (loop prevention)', async () => {
    const { responder, postReply } = setup({ model: null });
    await responder(makeActivity({ actorId: 'Ada', text: '@Ada following up' }));
    expect(postReply).not.toHaveBeenCalled();
  });

  it('does nothing when the thread cannot be resolved', async () => {
    const { responder, postReply } = setup({ model: null, thread: null });
    await responder(makeActivity());
    expect(postReply).not.toHaveBeenCalled();
  });
});
