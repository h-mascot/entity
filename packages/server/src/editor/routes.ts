import type { Request, Response, Router } from 'express';
import type { DocumentCommentMentionTrigger } from '../agent/document-comment-responder';
import type { EditorRouteAuth } from './auth';
import {
  EditorServiceError,
  type DocumentAuthorshipInput,
  type DocumentCommentCreateInput,
  type DocumentCommentReplyCreateInput,
  type DocumentCommentResolveInput,
  type CursorPresenceUpdateInput,
  type DocumentEditInput,
  type DocumentReviewCreateInput,
  type DocumentSuggestionCreateInput,
  type DocumentSuggestionUpdateInput,
  type EditorService,
} from './service';

export interface RegisterEditorRoutesOptions {
  auth: EditorRouteAuth;
  service: EditorService;
  commentMentionResponder?: (trigger: DocumentCommentMentionTrigger) => Promise<void> | void;
}

interface EditorRouteErrorBody {
  code: string;
  error: string;
}

function normalizeDocId(req: Request): string | null {
  const docId = typeof req.params.docId === 'string' ? req.params.docId.trim() : '';
  return docId || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapRouteError(error: unknown): { status: number; body: EditorRouteErrorBody } {
  if (error instanceof EditorServiceError) {
    return {
      status: error.status,
      body: {
        code: error.code,
        error: error.message,
      },
    };
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  if (message.includes('is required')) {
    return {
      status: 400,
      body: {
        code: 'INVALID_REQUEST',
        error: message,
      },
    };
  }

  return {
    status: 500,
    body: {
      code: 'INTERNAL_ERROR',
      error: 'Internal server error.',
    },
  };
}

function requireActorIdentity(req: Request, res: Response, auth: EditorRouteAuth): string | null {
  const identity = auth.getActorIdentity(req);
  if (!identity) {
    res.status(401).json({
      code: 'AUTH_CONTEXT_MISSING',
      error: 'Authenticated actor identity is required.',
    } satisfies EditorRouteErrorBody);
    return null;
  }

  return identity.actorId;
}

export function registerEditorRoutes(router: Router, options: RegisterEditorRoutesOptions): void {
  router.get('/', options.auth.requireScopes([]), (_req: Request, res: Response) => {
    const health = options.service.getHealth();
    res.json({
      ...health,
      routes: {
        health: '/api/documents/health',
        state: '/api/documents/:docId/state',
        edit: '/api/documents/:docId/edit',
        authorship: '/api/documents/:docId/authorship',
        cursor: '/api/documents/:docId/cursor',
        comments: '/api/documents/:docId/comments',
        suggestions: '/api/documents/:docId/suggestions',
        reviews: '/api/documents/:docId/reviews',
      },
    });
  });

  router.get('/health', options.auth.requireScopes([]), (_req: Request, res: Response) => {
    res.json(options.service.getHealth());
  });

  router.get('/:docId/state', options.auth.requireScopes(['documents:read']), (req: Request, res: Response) => {
    const docId = normalizeDocId(req);
    if (!docId) {
      res.status(400).json({
        code: 'DOC_ID_REQUIRED',
        error: 'docId path parameter is required.',
      } satisfies EditorRouteErrorBody);
      return;
    }

    if (!requireActorIdentity(req, res, options.auth)) {
      return;
    }

    try {
      const state = options.service.getDocumentState(docId);
      res.json(state);
    } catch (error) {
      const mapped = mapRouteError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.post('/:docId/edit', options.auth.requireScopes(['documents:edit']), async (req: Request, res: Response) => {
    const actorId = requireActorIdentity(req, res, options.auth);
    if (!actorId) {
      return;
    }

    const docId = normalizeDocId(req);
    if (!docId) {
      res.status(400).json({
        code: 'DOC_ID_REQUIRED',
        error: 'docId path parameter is required.',
      } satisfies EditorRouteErrorBody);
      return;
    }

    if (!isRecord(req.body)) {
      res.status(400).json({
        code: 'INVALID_EDIT_PAYLOAD',
        error: 'Edit payload must be a JSON object.',
      } satisfies EditorRouteErrorBody);
      return;
    }

    try {
      const editInput = req.body as unknown as DocumentEditInput;
      const update = await options.service.applyEdit(docId, actorId, editInput);
      options.service.broadcaster.broadcastEdit(docId, {
        actor: update.actorId,
        attribution: update.attribution,
        sourceId: update.sourceId,
        path: update.path,
        from: update.from,
        to: update.to,
        insert: update.insert,
        previousVersion: update.previousVersion,
        version: update.version,
        contentHash: update.contentHash,
        updatedAt: update.updatedAt,
      });

      res.json(update);
    } catch (error) {
      const mapped = mapRouteError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.post('/:docId/authorship', options.auth.requireScopes(['documents:edit']), (req: Request, res: Response) => {
    const actorId = requireActorIdentity(req, res, options.auth);
    if (!actorId) {
      return;
    }

    const docId = normalizeDocId(req);
    if (!docId) {
      res.status(400).json({
        code: 'DOC_ID_REQUIRED',
        error: 'docId path parameter is required.',
      } satisfies EditorRouteErrorBody);
      return;
    }

    if (!isRecord(req.body)) {
      res.status(400).json({
        code: 'INVALID_AUTHORSHIP_PAYLOAD',
        error: 'Authorship payload must be a JSON object.',
      } satisfies EditorRouteErrorBody);
      return;
    }

    try {
      const authorshipInput = req.body as unknown as DocumentAuthorshipInput;
      const update = options.service.upsertAuthorship(docId, actorId, authorshipInput);
      options.service.broadcaster.broadcastState(docId, {
        actor: update.actorId,
        from: update.from,
        to: update.to,
        author: update.author,
        toggledOff: update.toggledOff,
        range: update.range,
        authorshipStats: update.authorshipStats,
      });

      res.json(update);
    } catch (error) {
      const mapped = mapRouteError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.post('/:docId/cursor', options.auth.requireScopes(['documents:cursor:write']), (req: Request, res: Response) => {
    const actorId = requireActorIdentity(req, res, options.auth);
    if (!actorId) {
      return;
    }

    const docId = normalizeDocId(req);
    if (!docId) {
      res.status(400).json({
        code: 'DOC_ID_REQUIRED',
        error: 'docId path parameter is required.',
      } satisfies EditorRouteErrorBody);
      return;
    }

    if (!isRecord(req.body)) {
      res.status(400).json({
        code: 'INVALID_CURSOR_PAYLOAD',
        error: 'Cursor payload must be a JSON object.',
      } satisfies EditorRouteErrorBody);
      return;
    }

    try {
      const cursorInput = req.body as CursorPresenceUpdateInput;
      const update = options.service.upsertCursorPresence(docId, actorId, cursorInput);
      options.service.broadcaster.broadcastPresence(docId, {
        actor: actorId,
        action: update.action,
        status: update.presence.status,
        heartbeatAt: update.presence.last_activity_at,
        presence: update.presence,
      });

      res.json({
        docId: update.docId,
        actor: update.actorId,
        status: update.presence.status,
        heartbeatAt: update.presence.last_activity_at,
        presence: update.presence,
      });
    } catch (error) {
      const mapped = mapRouteError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.get('/:docId/comments', options.auth.requireScopes(['documents:read']), (req: Request, res: Response) => {
    const docId = normalizeDocId(req);
    if (!docId) {
      res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
      return;
    }

    if (!requireActorIdentity(req, res, options.auth)) {
      return;
    }

    try {
      res.json(options.service.getComments(docId));
    } catch (error) {
      const mapped = mapRouteError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.post('/:docId/comments', options.auth.requireScopes(['documents:comment:write']), (req: Request, res: Response) => {
    const actorId = requireActorIdentity(req, res, options.auth);
    if (!actorId) {
      return;
    }

    const docId = normalizeDocId(req);
    if (!docId) {
      res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
      return;
    }

    if (!isRecord(req.body)) {
      res.status(400).json({ code: 'INVALID_COMMENT_PAYLOAD', error: 'Comment payload must be a JSON object.' } satisfies EditorRouteErrorBody);
      return;
    }

    try {
      const input = req.body as unknown as DocumentCommentCreateInput;
      const result = options.service.createComment(docId, actorId, input);
      res.json(result);
      if (result.createdThreadId) {
        void options.commentMentionResponder?.({
          docId,
          commentId: result.createdThreadId,
          actorId,
          body: input.text,
        });
      }
    } catch (error) {
      const mapped = mapRouteError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.post(
    '/:docId/comments/:commentId/replies',
    options.auth.requireScopes(['documents:comment:write']),
    (req: Request, res: Response) => {
      const actorId = requireActorIdentity(req, res, options.auth);
      if (!actorId) {
        return;
      }

      const docId = normalizeDocId(req);
      if (!docId) {
        res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
        return;
      }

      const commentId = typeof req.params.commentId === 'string' ? req.params.commentId.trim() : '';
      if (!commentId) {
        res.status(400).json({ code: 'COMMENT_ID_REQUIRED', error: 'commentId path parameter is required.' } satisfies EditorRouteErrorBody);
        return;
      }

      if (!isRecord(req.body)) {
        res.status(400).json({ code: 'INVALID_REPLY_PAYLOAD', error: 'Reply payload must be a JSON object.' } satisfies EditorRouteErrorBody);
        return;
      }

      try {
        const input = req.body as unknown as DocumentCommentReplyCreateInput;
        const result = options.service.replyToComment(docId, actorId, commentId, input);
        res.json(result);
        if (result.repliedThreadId) {
          void options.commentMentionResponder?.({
            docId,
            commentId: result.repliedThreadId,
            actorId,
            body: input.text,
            replyId: result.createdReplyId ?? null,
          });
        }
      } catch (error) {
        const mapped = mapRouteError(error);
        res.status(mapped.status).json(mapped.body);
      }
    }
  );

  router.post(
    '/:docId/comments/:commentId/resolve',
    options.auth.requireScopes(['documents:comment:write']),
    (req: Request, res: Response) => {
      const actorId = requireActorIdentity(req, res, options.auth);
      if (!actorId) {
        return;
      }

      const docId = normalizeDocId(req);
      if (!docId) {
        res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
        return;
      }

      const commentId = typeof req.params.commentId === 'string' ? req.params.commentId.trim() : '';
      if (!commentId) {
        res.status(400).json({ code: 'COMMENT_ID_REQUIRED', error: 'commentId path parameter is required.' } satisfies EditorRouteErrorBody);
        return;
      }

      if (!isRecord(req.body)) {
        res.status(400).json({ code: 'INVALID_RESOLVE_PAYLOAD', error: 'Resolve payload must be a JSON object.' } satisfies EditorRouteErrorBody);
        return;
      }

      try {
        const input = req.body as unknown as DocumentCommentResolveInput;
        res.json(options.service.resolveComment(docId, actorId, commentId, input));
      } catch (error) {
        const mapped = mapRouteError(error);
        res.status(mapped.status).json(mapped.body);
      }
    }
  );

  router.get('/:docId/suggestions', options.auth.requireScopes(['documents:read']), (req: Request, res: Response) => {
    const docId = normalizeDocId(req);
    if (!docId) {
      res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
      return;
    }

    if (!requireActorIdentity(req, res, options.auth)) {
      return;
    }

    try {
      res.json(options.service.getSuggestions(docId));
    } catch (error) {
      const mapped = mapRouteError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.post('/:docId/suggestions', options.auth.requireScopes(['documents:suggest:write']), (req: Request, res: Response) => {
    const actorId = requireActorIdentity(req, res, options.auth);
    if (!actorId) {
      return;
    }

    const docId = normalizeDocId(req);
    if (!docId) {
      res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
      return;
    }

    if (!isRecord(req.body)) {
      res.status(400).json({ code: 'INVALID_SUGGESTION_PAYLOAD', error: 'Suggestion payload must be a JSON object.' } satisfies EditorRouteErrorBody);
      return;
    }

    try {
      const input = req.body as unknown as DocumentSuggestionCreateInput;
      res.json(options.service.createSuggestion(docId, actorId, input));
    } catch (error) {
      const mapped = mapRouteError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.patch(
    '/:docId/suggestions/:suggestionId',
    options.auth.requireScopes(['documents:suggest:write']),
    async (req: Request, res: Response) => {
      const actorId = requireActorIdentity(req, res, options.auth);
      if (!actorId) {
        return;
      }

      const docId = normalizeDocId(req);
      if (!docId) {
        res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
        return;
      }

      const suggestionId = typeof req.params.suggestionId === 'string' ? req.params.suggestionId.trim() : '';
      if (!suggestionId) {
        res.status(400).json({ code: 'SUGGESTION_ID_REQUIRED', error: 'suggestionId path parameter is required.' } satisfies EditorRouteErrorBody);
        return;
      }

      if (!isRecord(req.body)) {
        res.status(400).json({
          code: 'INVALID_SUGGESTION_UPDATE_PAYLOAD',
          error: 'Suggestion update payload must be a JSON object.',
        } satisfies EditorRouteErrorBody);
        return;
      }

      try {
        const input = req.body as unknown as DocumentSuggestionUpdateInput;
        const status = typeof input.status === 'string' ? input.status.trim().toLowerCase() : '';
        if (status === 'accepted') {
          res.json(await options.service.acceptSuggestion(docId, actorId, suggestionId));
          return;
        }
        if (status === 'rejected') {
          res.json(options.service.rejectSuggestion(docId, actorId, suggestionId));
          return;
        }

        res.status(400).json({
          code: 'INVALID_SUGGESTION_STATUS',
          error: "status must be either 'accepted' or 'rejected'.",
        } satisfies EditorRouteErrorBody);
      } catch (error) {
        const mapped = mapRouteError(error);
        res.status(mapped.status).json(mapped.body);
      }
    }
  );

  router.post(
    '/:docId/suggestions/:suggestionId/accept',
    options.auth.requireScopes(['documents:suggest:write']),
    async (req: Request, res: Response) => {
      const actorId = requireActorIdentity(req, res, options.auth);
      if (!actorId) {
        return;
      }

      const docId = normalizeDocId(req);
      if (!docId) {
        res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
        return;
      }

      const suggestionId = typeof req.params.suggestionId === 'string' ? req.params.suggestionId.trim() : '';
      if (!suggestionId) {
        res.status(400).json({ code: 'SUGGESTION_ID_REQUIRED', error: 'suggestionId path parameter is required.' } satisfies EditorRouteErrorBody);
        return;
      }

      try {
        res.json(await options.service.acceptSuggestion(docId, actorId, suggestionId));
      } catch (error) {
        const mapped = mapRouteError(error);
        res.status(mapped.status).json(mapped.body);
      }
    }
  );

  router.post(
    '/:docId/suggestions/:suggestionId/reject',
    options.auth.requireScopes(['documents:suggest:write']),
    (req: Request, res: Response) => {
      const actorId = requireActorIdentity(req, res, options.auth);
      if (!actorId) {
        return;
      }

      const docId = normalizeDocId(req);
      if (!docId) {
        res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
        return;
      }

      const suggestionId = typeof req.params.suggestionId === 'string' ? req.params.suggestionId.trim() : '';
      if (!suggestionId) {
        res.status(400).json({ code: 'SUGGESTION_ID_REQUIRED', error: 'suggestionId path parameter is required.' } satisfies EditorRouteErrorBody);
        return;
      }

      try {
        res.json(options.service.rejectSuggestion(docId, actorId, suggestionId));
      } catch (error) {
        const mapped = mapRouteError(error);
        res.status(mapped.status).json(mapped.body);
      }
    }
  );

  router.post('/:docId/reviews', options.auth.requireScopes(['documents:review:write']), async (req: Request, res: Response) => {
    const actorId = requireActorIdentity(req, res, options.auth);
    if (!actorId) {
      return;
    }

    const docId = normalizeDocId(req);
    if (!docId) {
      res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
      return;
    }

    if (!isRecord(req.body)) {
      res.status(400).json({ code: 'INVALID_REVIEW_PAYLOAD', error: 'Review payload must be a JSON object.' } satisfies EditorRouteErrorBody);
      return;
    }

    try {
      const input = req.body as unknown as DocumentReviewCreateInput;
      res.json(await options.service.createReviewRun(docId, actorId, input));
    } catch (error) {
      const mapped = mapRouteError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.get('/:docId/reviews/:runId', options.auth.requireScopes(['documents:read']), (req: Request, res: Response) => {
    const docId = normalizeDocId(req);
    if (!docId) {
      res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
      return;
    }

    if (!requireActorIdentity(req, res, options.auth)) {
      return;
    }

    const runId = typeof req.params.runId === 'string' ? req.params.runId.trim() : '';
    if (!runId) {
      res.status(400).json({ code: 'REVIEW_ID_REQUIRED', error: 'runId path parameter is required.' } satisfies EditorRouteErrorBody);
      return;
    }

    try {
      res.json(options.service.getReviewRun(docId, runId));
    } catch (error) {
      const mapped = mapRouteError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.post(
    '/:docId/reviews/:runId/findings/:findingId/apply',
    options.auth.requireScopes(['documents:review:write']),
    async (req: Request, res: Response) => {
      const actorId = requireActorIdentity(req, res, options.auth);
      if (!actorId) {
        return;
      }

      const docId = normalizeDocId(req);
      if (!docId) {
        res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
        return;
      }

      const runId = typeof req.params.runId === 'string' ? req.params.runId.trim() : '';
      const findingId = typeof req.params.findingId === 'string' ? req.params.findingId.trim() : '';
      if (!runId || !findingId) {
        res.status(400).json({ code: 'REVIEW_ID_REQUIRED', error: 'runId and findingId path parameters are required.' } satisfies EditorRouteErrorBody);
        return;
      }

      try {
        res.json(await options.service.applyReviewFinding(docId, actorId, runId, findingId));
      } catch (error) {
        const mapped = mapRouteError(error);
        res.status(mapped.status).json(mapped.body);
      }
    }
  );

  router.post(
    '/:docId/reviews/:runId/findings/:findingId/ignore',
    options.auth.requireScopes(['documents:review:write']),
    (req: Request, res: Response) => {
      const actorId = requireActorIdentity(req, res, options.auth);
      if (!actorId) {
        return;
      }

      const docId = normalizeDocId(req);
      if (!docId) {
        res.status(400).json({ code: 'DOC_ID_REQUIRED', error: 'docId path parameter is required.' } satisfies EditorRouteErrorBody);
        return;
      }

      const runId = typeof req.params.runId === 'string' ? req.params.runId.trim() : '';
      const findingId = typeof req.params.findingId === 'string' ? req.params.findingId.trim() : '';
      if (!runId || !findingId) {
        res.status(400).json({ code: 'REVIEW_ID_REQUIRED', error: 'runId and findingId path parameters are required.' } satisfies EditorRouteErrorBody);
        return;
      }

      try {
        res.json(options.service.ignoreReviewFinding(docId, actorId, runId, findingId));
      } catch (error) {
        const mapped = mapRouteError(error);
        res.status(mapped.status).json(mapped.body);
      }
    }
  );
}
