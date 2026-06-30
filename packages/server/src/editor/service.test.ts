import { describe, expect, it } from 'vitest';
import type {
  DocumentCollaborationRepository,
  DocumentCollaborationSnapshot,
  DocumentCommentRecord,
  DocumentCommentReplyRecord,
  DocumentSessionRecord,
} from '../../../db/src/document-collab';
import { createEditorService } from './service';
import type { EditorWsBroadcaster } from './ws';

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

describe('createEditorService comment mentions', () => {
  it('invokes the document mention responder for new comments and thread replies', () => {
    const triggers: string[] = [];
    const repository = makeRepository();
    const service = createEditorService({
      openClawBaseUrl: '',
      broadcaster: makeBroadcaster(),
      collaborationRepository: repository,
      sourceRepository: {} as never,
      tokenRepository: {} as never,
      documentCommentMentionResponder: (trigger) => {
        triggers.push(trigger.kind);
      },
    });

    const created = service.createComment('workspace:/docs/plan.md', 'Henry', {
      from: 0,
      to: 5,
      text: '@assistant look here',
      selectedText: 'Intro',
    });
    const commentId = created.threads[0].id;

    service.replyToComment('workspace:/docs/plan.md', 'Henry', commentId, {
      text: '@assistant one more note',
    });

    expect(triggers).toEqual(['comment', 'reply']);
  });
});
