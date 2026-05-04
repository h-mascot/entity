import type { Express, Request, Response } from 'express';
import { Router } from 'express';
import {
  FILE_SOURCE_HEALTH,
  FILE_SOURCE_TYPES,
  createFileSourceRepository,
  type FileSourceAuthType,
  type FileSourceHealth,
  type FileSourceRecord,
  type FileSourceType,
} from '../../../db/src/file-sources';
import { createFileIndexRepository } from '../../../db/src/file-index';
import { createFileSourceAdapter } from './adapters/registry';
import { FileIndexRunner } from './index-runner';
import { recordFsOperation } from './metrics';

interface SourcePayload {
  id?: string;
  displayName?: string;
  type?: string;
  baseUrl?: string;
  basePath?: string;
  authType?: string;
  authRef?: string;
  enabled?: unknown;
  icon?: string;
  capabilities?: unknown;
  health?: string;
  lastSyncedAt?: string;
}

const VALID_AUTH_TYPES: FileSourceAuthType[] = ['none', 'bearer', 'api-key', 'basic', 'ssh'];

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }

    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  return fallback;
}

function parseSourceType(value: string | undefined): FileSourceType | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if ((FILE_SOURCE_TYPES as readonly string[]).includes(normalized)) {
    return normalized as FileSourceType;
  }

  return null;
}

function parseAuthType(value: string | undefined): FileSourceAuthType | null {
  if (typeof value !== 'string') {
    return 'none';
  }

  const normalized = value.trim().toLowerCase();
  if ((VALID_AUTH_TYPES as string[]).includes(normalized)) {
    return normalized as FileSourceAuthType;
  }

  return null;
}

function parseHealth(value: string | undefined): FileSourceHealth | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if ((FILE_SOURCE_HEALTH as readonly string[]).includes(normalized)) {
    return normalized as FileSourceHealth;
  }

  return null;
}

function toSourceResponse(source: FileSourceRecord) {
  return {
    id: source.id,
    displayName: source.display_name,
    type: source.type,
    baseUrl: source.base_url,
    basePath: source.base_path,
    authType: source.auth_type,
    authRef: source.auth_ref,
    enabled: source.enabled,
    icon: source.icon,
    capabilities: source.capabilities,
    health: source.health,
    lastSyncedAt: source.last_synced_at,
    createdAt: source.created_at,
    updatedAt: source.updated_at,
  };
}

function parsePayload(body: SourcePayload): { ok: true; value: SourcePayload } | { ok: false; error: string } {
  const id = body.id?.trim();
  if (typeof body.id !== 'undefined') {
    if (!id) {
      return { ok: false, error: 'id cannot be empty.' };
    }

    if (id.length > 128) {
      return { ok: false, error: 'id must be 128 characters or fewer.' };
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
      return { ok: false, error: 'id may only include letters, numbers, dot, underscore, and hyphen.' };
    }
  }

  const displayName = body.displayName?.trim();
  if (typeof body.displayName !== 'undefined' && !displayName) {
    return { ok: false, error: 'displayName cannot be empty.' };
  }

  if (typeof body.type !== 'undefined' && !parseSourceType(body.type)) {
    return { ok: false, error: `type must be one of: ${FILE_SOURCE_TYPES.join(', ')}` };
  }

  if (typeof body.authType !== 'undefined' && !parseAuthType(body.authType)) {
    return { ok: false, error: `authType must be one of: ${VALID_AUTH_TYPES.join(', ')}` };
  }

  if (typeof body.health !== 'undefined' && !parseHealth(body.health)) {
    return { ok: false, error: `health must be one of: ${FILE_SOURCE_HEALTH.join(', ')}` };
  }

  if (typeof body.capabilities !== 'undefined' && typeof body.capabilities !== 'string') {
    return { ok: false, error: 'capabilities must be a JSON string.' };
  }

  return { ok: true, value: body };
}

export function registerSourceRoutes(app: Express): void {
  const router = Router();
  const repo = createFileSourceRepository();
  const indexRepo = createFileIndexRepository();
  const runner = new FileIndexRunner();

  router.get('/', (req: Request, res: Response) => {
    try {
      const includeDisabled = toBoolean(req.query.includeDisabled, false);
      const sources = repo.listSources(includeDisabled).map(toSourceResponse);
      res.json({ sources });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    const parsed = parsePayload(req.body as SourcePayload);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }

    const payload = parsed.value;
    const displayName = payload.displayName?.trim();
    const type = parseSourceType(payload.type);
    if (!displayName || !type) {
      return res.status(400).json({ error: 'displayName and valid type are required.' });
    }

    try {
      const created = repo.createSource({
        id: payload.id?.trim() || undefined,
        display_name: displayName,
        type,
        base_url: payload.baseUrl?.trim() || undefined,
        base_path: payload.basePath?.trim() || undefined,
        auth_type: parseAuthType(payload.authType) ?? undefined,
        auth_ref: payload.authRef?.trim() || undefined,
        enabled: typeof payload.enabled === 'undefined' ? true : toBoolean(payload.enabled),
        icon: payload.icon?.trim() || undefined,
        capabilities: typeof payload.capabilities === 'string' ? payload.capabilities : undefined,
      });

      // Kick off an index run for the created source (async; status is reflected via /api/fs/metrics).
      void runner.runOnceForSource(created.id).catch(() => {
        // best-effort background sync
      });

      return res.status(201).json(toSourceResponse(created));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  router.put('/:id', (req: Request, res: Response) => {
    const id = req.params.id?.trim();
    if (!id) {
      return res.status(400).json({ error: 'id is required.' });
    }

    const parsed = parsePayload(req.body as SourcePayload);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }

    const payload = parsed.value;

    try {
      const updated = repo.updateSource(id, {
        display_name: payload.displayName,
        type: payload.type ? parseSourceType(payload.type) ?? undefined : undefined,
        base_url: payload.baseUrl,
        base_path: payload.basePath,
        auth_type: payload.authType ? parseAuthType(payload.authType) ?? undefined : undefined,
        auth_ref: payload.authRef,
        enabled: typeof payload.enabled === 'undefined' ? undefined : toBoolean(payload.enabled),
        icon: payload.icon,
        capabilities: typeof payload.capabilities === 'string' ? payload.capabilities : undefined,
        health: payload.health ? parseHealth(payload.health) ?? undefined : undefined,
        last_synced_at: payload.lastSyncedAt,
      });

      if (!updated) {
        return res.status(404).json({ error: 'source not found.' });
      }

      return res.json(toSourceResponse(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  router.patch('/:id/enabled', (req: Request, res: Response) => {
    const id = req.params.id?.trim();
    if (!id) {
      return res.status(400).json({ error: 'id is required.' });
    }

    if (typeof (req.body as { enabled?: unknown })?.enabled === 'undefined') {
      return res.status(400).json({ error: 'enabled is required.' });
    }

    try {
      const updated = repo.setEnabled(id, toBoolean((req.body as { enabled: unknown }).enabled));
      if (!updated) {
        return res.status(404).json({ error: 'source not found.' });
      }

      return res.json(toSourceResponse(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const id = req.params.id?.trim();
    if (!id) {
      return res.status(400).json({ error: 'id is required.' });
    }

    try {
      const deleted = repo.deleteSource(id);
      if (!deleted) {
        return res.status(404).json({ error: 'source not found.' });
      }

      return res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });

  router.post('/:id/sync', async (req: Request, res: Response) => {
    const id = req.params.id?.trim();
    if (!id) {
      return res.status(400).json({ error: 'id is required.' });
    }

    try {
      const source = repo.getSource(id);
      if (!source) {
        return res.status(404).json({ error: 'source not found.' });
      }

      if (!source.enabled) {
        return res.status(403).json({ error: 'source is disabled.' });
      }

      const startedAt = Date.now();
      await runner.runOnceForSource(source.id);
      const durationMs = Date.now() - startedAt;
      recordFsOperation({ operation: 'sources.sync', sourceId: source.id, durationMs, success: true });

      const latestRun = indexRepo.getLatestSyncRun(source.id);
      return res.json({
        sourceId: source.id,
        status: latestRun?.status ?? 'unknown',
        durationMs,
        latestSyncRun: latestRun
          ? {
              id: latestRun.id,
              status: latestRun.status,
              startedAt: latestRun.started_at,
              finishedAt: latestRun.finished_at,
              filesScanned: latestRun.files_scanned,
              filesIndexed: latestRun.files_indexed,
              error: latestRun.error,
            }
          : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recordFsOperation({ operation: 'sources.sync', sourceId: id, success: false, error: message });
      return res.status(500).json({ error: message });
    }
  });

  router.post('/:id/test', async (req: Request, res: Response) => {
    const id = req.params.id?.trim();
    if (!id) {
      return res.status(400).json({ error: 'id is required.' });
    }

    try {
      const source = repo.getSource(id);
      if (!source) {
        return res.status(404).json({ error: 'source not found.' });
      }

      const adapter = createFileSourceAdapter(source);
      const startedAt = Date.now();
      await adapter.validate(source);
      const durationMs = Date.now() - startedAt;
      recordFsOperation({ operation: 'sources.test', sourceId: source.id, durationMs, success: true });
      repo.updateSource(source.id, {
        health: 'ok',
        last_synced_at: new Date().toISOString(),
      });

      return res.json({
        sourceId: source.id,
        status: 'ok',
        message: 'Connection test passed.',
        durationMs,
        capabilities: adapter.capabilities(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recordFsOperation({ operation: 'sources.test', sourceId: id, success: false, error: message });
      const existing = repo.getSource(id);
      if (existing) {
        repo.updateSource(id, {
          health: 'error',
          last_synced_at: new Date().toISOString(),
        });
      }
      return res.status(200).json({
        sourceId: id,
        status: 'error',
        message,
      });
    }
  });

  app.use('/api/sources', router);
  app.use('/api/fs/sources', router);
}
