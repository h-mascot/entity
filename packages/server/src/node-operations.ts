import type { Express, Request, Response } from 'express';
import { createFileSourceRepository } from '../../db/src/file-sources';
import { getFsMetricsSnapshot } from './fs/metrics';

interface WebhookRouteStatus {
  id: string;
  label: string;
  method: string;
  path: string;
  enabled: boolean;
  auth: 'bearer-token' | 'none' | 'external';
  env?: string;
  description: string;
}

const FILE_TRANSFER_OPERATIONS = [
  {
    id: 'dir_list',
    label: 'Directory list',
    method: 'GET',
    path: '/api/fs/tree?sourceId=:sourceId&path=:path',
    metric: 'fs.tree',
    capability: 'list',
    description: 'Lists a directory inside an enabled Entity file source.',
  },
  {
    id: 'file_fetch',
    label: 'File fetch',
    method: 'GET',
    path: '/api/fs/file?sourceId=:sourceId&path=:path',
    metric: 'fs.file',
    capability: 'read',
    description: 'Reads a single text file through the multisource file adapter.',
  },
  {
    id: 'file_write',
    label: 'File write',
    method: 'POST',
    path: '/api/fs/file',
    metric: 'fs.file.write',
    capability: 'write',
    description: 'Creates or overwrites a file when the selected source adapter allows writes.',
  },
  {
    id: 'dir_fetch',
    label: 'Directory fetch',
    method: 'GET',
    path: '/api/fs/tree?sourceId=:sourceId&path=:path&recursive=manual',
    metric: 'fs.tree',
    capability: 'list',
    description: 'Directory export is currently composed from repeated safe dir_list/file_fetch calls; no bulk zip endpoint is exposed yet.',
  },
] as const;

function webhookRoutes(): WebhookRouteStatus[] {
  return [
    {
      id: 'openclaw-review-result',
      label: 'OpenClaw review result',
      method: 'POST',
      path: '/api/webhooks/openclaw/review-result',
      enabled: true,
      auth: process.env.ENTITY_OPENCLAW_WEBHOOK_TOKEN?.trim() ? 'bearer-token' : 'none',
      env: 'ENTITY_OPENCLAW_WEBHOOK_TOKEN',
      description: 'Receives OpenClaw document-review callbacks and persists findings into Entity review runs.',
    },
    {
      id: 'entity-deploy-webhook',
      label: 'Entity deploy webhook',
      method: 'POST',
      path: '/webhook/entity-deploy',
      enabled: Boolean(process.env.WEBHOOK_DEPLOY_TOKEN?.trim()),
      auth: 'external',
      env: 'WEBHOOK_DEPLOY_TOKEN',
      description: 'External deploy receiver in scripts/entity-deploy-webhook-server.mjs; surfaced here so admins can see the expected ingress path.',
    },
  ];
}

function hasSourceCapability(source: { capabilities?: string; type?: string }, capability: string): boolean {
  if (source.type === 'local') {
    return true;
  }

  try {
    const parsed = source.capabilities ? JSON.parse(source.capabilities) : null;
    return Boolean(parsed?.[capability]);
  } catch {
    return false;
  }
}

export function buildNodeOperationsStatus() {
  const repo = createFileSourceRepository();
  const metrics = getFsMetricsSnapshot();
  const sources = repo.listSources(true);
  const enabledSources = sources.filter((source) => source.enabled);

  const fileTransfer = FILE_TRANSFER_OPERATIONS.map((operation) => ({
    ...operation,
    enabled: enabledSources.some((source) => hasSourceCapability(source, operation.capability)),
    metric: metrics.operations[operation.metric] ?? null,
  }));

  const sourceSummaries = sources.map((source) => {
    const sourceMetrics = metrics.sources.find((entry) => entry.sourceId === source.id);
    return {
      id: source.id,
      displayName: source.display_name,
      type: source.type,
      enabled: source.enabled,
      health: source.health,
      lastSyncedAt: source.last_synced_at,
      capabilities: source.capabilities,
      operations: sourceMetrics?.operations ?? {},
      lastError: sourceMetrics?.lastError ?? null,
      lastErrorAt: sourceMetrics?.lastErrorAt ?? null,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    fileTransfer: {
      enabled: enabledSources.length > 0,
      operations: fileTransfer,
      sources: sourceSummaries,
    },
    webhooks: {
      routes: webhookRoutes(),
    },
  };
}

export function registerNodeOperationsRoutes(app: Express, basePath = '/api/node-operations'): void {
  app.get(basePath, (_req: Request, res: Response) => {
    try {
      return res.json(buildNodeOperationsStatus());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown node-operations error';
      return res.status(500).json({ error: message });
    }
  });
}
