import type { Express } from 'express';
import { Router } from 'express';
import type { WebSocket } from 'ws';
import { createEditorRouteAuth } from './auth';
import { registerEditorReviewWebhookRoutes } from './reviews';
import { registerEditorRoutes } from './routes';
import { createEditorService } from './service';
import { createEditorWsBroadcaster } from './ws';

export interface RegisterEditorModuleOptions {
  enabled: boolean;
  wsClients: ReadonlySet<WebSocket>;
  openClawBaseUrl: string;
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

  registerEditorRoutes(router, { auth, service });
  app.use('/api/documents', router);
  registerEditorReviewWebhookRoutes(app, { service });
}
