import type { Express } from 'express';
import { Router } from 'express';
import type { WebSocket } from 'ws';
import type { LanguageModel } from 'ai';
import type { AgentRegistryRecord } from '../../../db/src';
import { createEditorRouteAuth } from './auth';
import {
  createDocumentCommentMentionResponder,
  type DocumentCommentMentionResponder,
} from './comment-mention';
import { registerEditorReviewWebhookRoutes } from './reviews';
import { registerEditorRoutes } from './routes';
import { createEditorService } from './service';
import { createEditorWsBroadcaster } from './ws';

/** External dependencies that let document-comment @mentions invoke an agent. */
export interface EditorCommentMentionOptions {
  listAgents: () => AgentRegistryRecord[];
  getModel: () => LanguageModel | null;
  getProviderModelLabel: () => string;
  logActivity?: (entry: { agentName: string; docId: string; commentId: string; summary: string }) => void;
}

export interface RegisterEditorModuleOptions {
  enabled: boolean;
  wsClients: ReadonlySet<WebSocket>;
  openClawBaseUrl: string;
  /** When provided, document comments that @mention an agent get an agent reply. */
  commentMention?: EditorCommentMentionOptions;
}

export function registerEditorModule(app: Express, options: RegisterEditorModuleOptions): void {
  if (!options.enabled) {
    return;
  }

  const router = Router();
  const broadcaster = createEditorWsBroadcaster(options.wsClients);

  // Late-bound so the responder can call back into the service (read content,
  // post replies) while the service forwards comment activity to the responder.
  let mentionResponder: DocumentCommentMentionResponder | null = null;

  const service = createEditorService({
    openClawBaseUrl: options.openClawBaseUrl,
    broadcaster,
    onCommentActivity: options.commentMention
      ? (activity) => {
          void mentionResponder?.(activity);
        }
      : undefined,
  });

  if (options.commentMention) {
    const mention = options.commentMention;
    mentionResponder = createDocumentCommentMentionResponder({
      listAgents: mention.listAgents,
      getModel: mention.getModel,
      getProviderModelLabel: mention.getProviderModelLabel,
      logActivity: mention.logActivity,
      readDocumentContent: (docId) => service.readDocumentContent(docId),
      getThread: (docId, commentId) =>
        service.getComments(docId).threads.find((thread) => thread.id === commentId) ?? null,
      postReply: (docId, author, commentId, text) => {
        service.replyToComment(docId, author, commentId, { text });
      },
    });
  }

  const auth = createEditorRouteAuth({
    tokenRepository: service.repositories.tokens,
  });

  registerEditorRoutes(router, { auth, service });
  app.use('/api/documents', router);
  registerEditorReviewWebhookRoutes(app, { service });
}
