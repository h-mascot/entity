import type { Express } from 'express';
import { Router } from 'express';
import type { WebSocket } from 'ws';
import type { AgentRegistryRecord } from '../../../db/src';
import { createDocumentCommentMentionResponder } from '../agent/document-comment-responder';
import { createEditorRouteAuth } from './auth';
import { registerEditorReviewWebhookRoutes } from './reviews';
import { registerEditorRoutes } from './routes';
import { createEditorService } from './service';
import { createEditorWsBroadcaster } from './ws';

export interface RegisterEditorModuleOptions {
  enabled: boolean;
  wsClients: ReadonlySet<WebSocket>;
  openClawBaseUrl: string;
  listAgents?: () => AgentRegistryRecord[];
}

export function registerEditorModule(app: Express, options: RegisterEditorModuleOptions): void {
  if (!options.enabled) {
    return;
  }

  const router = Router();
  const broadcaster = createEditorWsBroadcaster(options.wsClients);
  const service = createEditorService({
    openClawBaseUrl: options.openClawBaseUrl,
    broadcaster,
  });
  const auth = createEditorRouteAuth({
    tokenRepository: service.repositories.tokens,
  });
  const commentMentionResponder = options.listAgents
    ? createDocumentCommentMentionResponder({
        listAgents: options.listAgents,
        getContext: (docId, commentId) => service.getCommentMentionContext(docId, commentId),
        createReply: ({ docId, commentId, author, text }) =>
          service.replyToComment(docId, author, commentId, { text }),
      })
    : undefined;

  registerEditorRoutes(router, { auth, service, commentMentionResponder });
  app.use('/api/documents', router);
  registerEditorReviewWebhookRoutes(app, { service });
}
