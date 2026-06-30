import type { Express } from 'express';
import { Router } from 'express';
import type { WebSocket } from 'ws';
import type { LanguageModel } from 'ai';
import type { AgentRegistryRecord } from '../../../db/src';
import { createEditorRouteAuth } from './auth';
import { createDocumentCommentResponder, type DocumentCommentResponder } from './comment-responder';
import { registerEditorReviewWebhookRoutes } from './reviews';
import { registerEditorRoutes } from './routes';
import { createEditorService } from './service';
import { createEditorWsBroadcaster } from './ws';

export interface RegisterEditorModuleOptions {
  enabled: boolean;
  wsClients: ReadonlySet<WebSocket>;
  openClawBaseUrl: string;
  /** When provided, enables agent replies to @mentions in document comments. */
  listAgents?: () => AgentRegistryRecord[];
  getModel?: () => LanguageModel | null;
  getSettings?: () => { provider: string; model: string };
  logActivity?: (input: { agentName: string; docId: string; summary: string }) => void;
}

export function registerEditorModule(app: Express, options: RegisterEditorModuleOptions): void {
  if (!options.enabled) {
    return;
  }

  const router = Router();
  const broadcaster = createEditorWsBroadcaster(options.wsClients);

  // Late-bound so the responder (which uses the service) can be wired after creation.
  let commentResponder: DocumentCommentResponder | null = null;

  const service = createEditorService({
    openClawBaseUrl: options.openClawBaseUrl,
    broadcaster,
    onCommentMention: (event) => {
      if (commentResponder) {
        void commentResponder(event);
      }
    },
  });

  if (options.listAgents && options.getModel) {
    const getSettings = options.getSettings ?? (() => ({ provider: 'unknown', model: 'unknown' }));
    commentResponder = createDocumentCommentResponder({
      listAgents: options.listAgents,
      getModel: options.getModel,
      getSettings,
      getDocumentContent: (docId) => service.readDocumentContent(docId),
      getThread: (docId, commentId) => {
        const { threads } = service.getComments(docId);
        const thread = threads.find((entry) => entry.id === commentId);
        if (!thread) {
          return null;
        }
        return {
          author: thread.author,
          text: thread.text,
          selectedText: thread.selectedText,
          replies: thread.replies.map((reply) => ({ author: reply.author, text: reply.text })),
        };
      },
      postReply: (docId, author, commentId, text) => {
        service.replyToComment(docId, author, commentId, { text });
      },
      logActivity: options.logActivity,
    });
  }

  const auth = createEditorRouteAuth({
    tokenRepository: service.repositories.tokens,
  });

  registerEditorRoutes(router, { auth, service });
  app.use('/api/documents', router);
  registerEditorReviewWebhookRoutes(app, { service });
}
