import { describe, expect, it } from 'vitest';
import type {
  FileSourceRecord,
  FileSourceRepository,
} from '../../../db/src/file-sources';
import type {
  DocumentCollaborationRepository,
  DocumentCollaborationSnapshot,
  DocumentCommentRecord,
  DocumentCommentReplyRecord,
  DocumentSessionRecord,
} from '../../../db/src/document-collab';
import { createEditorService } from './service';
import type { EditorWsBroadcaster } from './ws';

function makeSource(overrides: Partial<FileSourceRecord> = {}): FileSourceRecord {
  const now = new Date().toISOString();
  return {
    id: 'workspace',
    display_name: 'Workspace',
    type: 'local',
    base_url: null,
    base_path: '/tmp',
    auth_type: 'none',
    auth_ref: null,
    enabled: true,
    icon: null,
    capabilities: JSON.stringify({ read: true, write: true, list: true, search: true }),
    health: 'ok',
    last_synced_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeSourceRepository(source: FileSourceRecord): FileSourceRepository {
  return {
    listSources: () => [source],
    getSource: () => source,
    createSource: () => source,
    updateSource: () => source,
    setEnabled: () => source,
    deleteSource: () => false,
  };
}

function makeBroadcaster(): EditorWsBroadcaster & { comments: Array<{ docId: string; payload: Record<string, unknown> }> } {
  const comments: Array<{ docId: string; payload: Record<string, unknown> }> = [];
  return {
    comments,
    broadcast: () => undefined,
    broadcastState: () => undefined,
    broadcastPresence: () => undefined,
    broadcastEdit: () => undefined,
    broadcastComment: (docId, payload) => comments.push({ docId, payload }),
    broadcastSuggestion: () => undefined,
    broadcastReview: () => undefined,
  };
}

function makeRepository(): DocumentCollaborationRepository {
  const now = new Date().toISOString();
  const session: DocumentSessionRecord = {
    id: 'session-1',
    doc_id: 'workspace:/docs/plan.md',
    source_id: 'workspace',
    path: '/docs/plan.md',
    content_hash: null,
    version: 0,
    created_at: now,
    updated_at: now,
  };
  const comments: DocumentCommentRecord[] = [];
  const replies: DocumentCommentReplyRecord[] = [];
  const snapshot = (): DocumentCollaborationSnapshot => ({
    session,
    authorship_ranges: [],
    authorship_history: [],
    presence: [],
    comments,
    comment_replies: replies,
    suggestions: [],
    review_runs: [],
  });

  return {
    getSessionByDocId: () => session,
    getSessionById: () => session,
    upsertSession: () => session,
    listAuthorshipRanges: () => [],
    upsertAuthorshipRange: (() => undefined) as never,
    deleteAuthorshipRange: () => false,
    listAuthorshipHistory: () => [],
    createAuthorshipHistory: (() => undefined) as never,
    listPresence: () => [],
    upsertPresence: (() => undefined) as never,
    removePresence: () => false,
    listComments: () => comments,
    getComment: (_docId, commentId) => comments.find((comment) => comment.id === commentId),
    createComment: (input) => {
      const comment: DocumentCommentRecord = {
        id: input.id ?? `comment-${comments.length + 1}`,
        doc_id: input.doc_id,
        author: input.author,
        start_offset: input.start_offset,
        end_offset: input.end_offset,
        selected_text: input.selected_text ?? null,
        text: input.text,
        resolved: Boolean(input.resolved),
        created_at: now,
        updated_at: now,
      };
      comments.push(comment);
      return comment;
    },
    setCommentResolved: () => undefined,
    listCommentReplies: (_docId, commentId) =>
      commentId ? replies.filter((reply) => reply.comment_id === commentId) : replies,
    createCommentReply: (input) => {
      const reply: DocumentCommentReplyRecord = {
        id: input.id ?? `reply-${replies.length + 1}`,
        doc_id: input.doc_id,
        comment_id: input.comment_id,
        author: input.author,
        text: input.text,
        created_at: now,
        updated_at: now,
      };
      replies.push(reply);
      return reply;
    },
    listSuggestions: () => [],
    getSuggestion: () => undefined,
    createSuggestion: (() => undefined) as never,
    updateSuggestionStatus: () => undefined,
    listReviewRuns: () => [],
    getReviewRun: () => undefined,
    createReviewRun: (() => undefined) as never,
    updateReviewRun: () => undefined,
    getCollaborationSnapshot: snapshot,
  };
}

describe('createEditorService comment mention context', () => {
  it('returns trigger ids and builds thread context for route-level responders', async () => {
    const repository = makeRepository();
    const service = createEditorService({
      openClawBaseUrl: '',
      broadcaster: makeBroadcaster(),
      collaborationRepository: repository,
      sourceRepository: {} as never,
      tokenRepository: {} as never,
    });

    const created = service.createComment('workspace:/docs/plan.md', 'Henry', {
      from: 0,
      to: 5,
      text: '@assistant look here',
      selectedText: 'Intro',
    });
    const commentId = created.threads[0].id;
    expect(created.createdThreadId).toBe(commentId);

    const replied = service.replyToComment('workspace:/docs/plan.md', 'Henry', commentId, {
      text: '@assistant one more note',
    });
    expect(replied.repliedThreadId).toBe(commentId);
    expect(replied.createdReplyId).toBe('reply-1');

    const context = await service.getCommentMentionContext('workspace:/docs/plan.md', commentId);
    expect(context).toMatchObject({
      docId: 'workspace:/docs/plan.md',
      sourceId: 'workspace',
      path: '/docs/plan.md',
      range: { from: 0, to: 5 },
      selectedText: 'Intro',
      commentAuthor: 'Henry',
      commentText: '@assistant look here',
    });
    expect(context.replies).toHaveLength(1);
    expect(context.replies[0].text).toBe('@assistant one more note');
    expect(context.documentReadError).toEqual(expect.any(String));
  });

  it('blocks source mutations when the file source is disabled', async () => {
    const repository = makeRepository();
    const service = createEditorService({
      openClawBaseUrl: '',
      broadcaster: makeBroadcaster(),
      collaborationRepository: repository,
      sourceRepository: makeSourceRepository(makeSource({ enabled: false })),
      tokenRepository: {} as never,
    });

    await expect(
      service.applyEdit('workspace:/docs/plan.md', 'Henry', {
        from: 0,
        to: 0,
        insert: 'x',
      })
    ).rejects.toMatchObject({
      code: 'SOURCE_DISABLED',
      status: 403,
    });
  });
});
