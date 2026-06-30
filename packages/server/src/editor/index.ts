import type { Express } from 'express';
import { Router } from 'express';
import type { WebSocket } from 'ws';
import type { AgentRegistryRecord } from '../../../db/src';
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
    listAgents: options.listAgents,
  });
  const auth = createEditorRouteAuth({
    tokenRepository: service.repositories.tokens,
  });

  registerEditorRoutes(router, { auth, service });
  app.use('/api/documents', router);
  registerEditorReviewWebhookRoutes(app, { service });
}
