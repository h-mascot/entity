import path from 'path';
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
import { localSourceCapabilitiesJson } from './adapters/local';
import { adapterSupportsLiveValidation, createFileSourceAdapter } from './adapters/registry';
import { FileIndexRunner } from './index-runner';
import { recordFsOperation } from './metrics';
import { resolvePathThroughNearestExistingAncestor } from './security';
import { assertAllowedLocalSourceBasePath } from './source-root-guard';

interface SourcePayload {
  id?: string;
  displayName?: string;
  type?: string;
  baseUrl?: string;
  basePath?: string;
  manifestPath?: string;
  manifestUrl?: string;
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
  const capabilities = parseCapabilities(source.capabilities);
  const manifestConfigured = source.type === 'http-markdown'
    && (typeof capabilities.manifestPath === 'string' || typeof capabilities.manifestUrl === 'string');
  return {
    id: source.id,
    displayName: source.display_name,
    type: source.type,
    baseUrl: source.base_url,
    basePath: source.base_path,
    searchability: source.type === 'http-markdown'
      ? manifestConfigured ? 'manifest-backed' : 'exact-read-only'
      : 'adapter-defined',
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

function withManifestCapability(
  rawCapabilities: unknown,
  manifestPath: string | undefined,
  manifestUrl: string | undefined,
): string | undefined {
  if (typeof rawCapabilities !== 'string' && typeof manifestPath === 'undefined' && typeof manifestUrl === 'undefined') {
    return undefined;
  }

  const capabilities = parseCapabilities(rawCapabilities);
  if (typeof manifestPath !== 'undefined') {
    if (manifestPath.trim()) capabilities.manifestPath = manifestPath.trim();
    else delete capabilities.manifestPath;
  }
  if (typeof manifestUrl !== 'undefined') {
    if (manifestUrl.trim()) capabilities.manifestUrl = manifestUrl.trim();
    else delete capabilities.manifestUrl;
  }
  return JSON.stringify(capabilities);
}

function parseCapabilities(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function sourceIsConfigManaged(capabilities: unknown): boolean {
  return parseCapabilities(capabilities).source === 'entity.config.yaml';
}

export function localSourceOverlapsReadOnlyRoot(
  candidateBasePath: string,
  sources: Array<Pick<FileSourceRecord, 'type' | 'base_path' | 'capabilities'>>,
): boolean {
  const candidateRoot = resolvePathThroughNearestExistingAncestor(candidateBasePath);
  const isContained = (relative: string) =>
    relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  return sources.some((source) => {
    if (source.type !== 'local' || !source.base_path || parseCapabilities(source.capabilities).readOnly !== true) return false;
    const protectedRoot = resolvePathThroughNearestExistingAncestor(source.base_path);
    return isContained(path.relative(protectedRoot, candidateRoot)) || isContained(path.relative(candidateRoot, protectedRoot));
  });
}

export function sourceCanBeDeleted(capabilities: unknown): boolean {
  return !sourceIsConfigManaged(capabilities);
}

export function sourceTypeCanBeChanged(
  capabilities: unknown,
  currentType: FileSourceType,
  nextType: FileSourceType,
): boolean {
  return !sourceIsConfigManaged(capabilities) || currentType === nextType;
}

export function capabilitiesForStorage(
  type: FileSourceType,
  rawCapabilities: unknown,
  basePath?: string | null,
  existingCapabilities?: unknown,
  forceReadOnly = false,
): string | undefined {
  if (type === 'local') {
    const existing = parseCapabilities(existingCapabilities);
    const candidate = parseCapabilities(rawCapabilities ?? existingCapabilities);
    const configManaged = existing.source === 'entity.config.yaml';
    const readOnly = configManaged ? existing.readOnly === true : forceReadOnly || candidate.readOnly === true;
    const derived = JSON.parse(localSourceCapabilitiesJson(basePath, { readOnly })) as Record<string, unknown>;
    if (configManaged) {
      derived.source = 'entity.config.yaml';
      if (Array.isArray(existing.agentBindings)) derived.agentBindings = existing.agentBindings;
    }
    return JSON.stringify(derived);
  }
  const existing = parseCapabilities(existingCapabilities);
  if (existing.source === 'entity.config.yaml') {
    const candidate = parseCapabilities(rawCapabilities ?? existingCapabilities);
    candidate.source = 'entity.config.yaml';
    if (Array.isArray(existing.agentBindings)) candidate.agentBindings = existing.agentBindings;
    return JSON.stringify(candidate);
  }
  return typeof rawCapabilities === 'string' ? rawCapabilities : undefined;
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

  for (const [name, value] of [
    ['manifestPath', body.manifestPath],
    ['manifestUrl', body.manifestUrl],
  ] as const) {
    if (typeof value !== 'undefined' && (typeof value !== 'string' || value.length > 2048)) {
      return { ok: false, error: `${name} must be a string of 2048 characters or fewer.` };
    }
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

  router.post('/', async (req: Request, res: Response) => {
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
      const basePath = type === 'local'
        ? await assertAllowedLocalSourceBasePath(payload.basePath)
        : payload.basePath?.trim() || undefined;
      const created = repo.createSource({
        id: payload.id?.trim() || undefined,
        display_name: displayName,
        type,
        base_url: payload.baseUrl?.trim() || undefined,
        base_path: basePath,
        auth_type: parseAuthType(payload.authType) ?? undefined,
        auth_ref: payload.authRef?.trim() || undefined,
        enabled: typeof payload.enabled === 'undefined' ? true : toBoolean(payload.enabled),
        icon: payload.icon?.trim() || undefined,
        capabilities: capabilitiesForStorage(
          type,
          withManifestCapability(payload.capabilities, payload.manifestPath, payload.manifestUrl),
          basePath,
          undefined,
          type === 'local' && Boolean(basePath) && localSourceOverlapsReadOnlyRoot(basePath!, repo.listSources(true)),
        ),
      });

      // Kick off an index run for the created source (async; status is reflected via /api/fs/metrics).
      void runner.runOnceForSource(created.id).catch(() => {
        // best-effort background sync
      });

      return res.status(201).json(toSourceResponse(created));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(message.includes('allowlisted') || message.includes('basePath') ? 400 : 500).json({ error: message });
    }
  });

  router.put('/:id', async (req: Request, res: Response) => {
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
      const existing = repo.getSource(id);
      if (!existing) {
        return res.status(404).json({ error: 'source not found.' });
      }
      const nextType = payload.type ? parseSourceType(payload.type) ?? existing.type : existing.type;
      if (!sourceTypeCanBeChanged(existing.capabilities, existing.type, nextType)) {
        return res.status(403).json({ error: 'Config-managed source types cannot be changed through the API.' });
      }
      const basePath = nextType === 'local' && (typeof payload.type !== 'undefined' || typeof payload.basePath !== 'undefined')
        ? await assertAllowedLocalSourceBasePath(payload.basePath ?? existing.base_path)
        : payload.basePath;
      const storageBasePath = nextType === 'local' ? basePath ?? existing.base_path : basePath;
      const manifestCapabilities = withManifestCapability(payload.capabilities, payload.manifestPath, payload.manifestUrl);
      const shouldUpdateCapabilities = nextType === 'local' || typeof manifestCapabilities === 'string';
      const updated = repo.updateSource(id, {
        display_name: payload.displayName,
        type: payload.type ? nextType : undefined,
        base_url: payload.baseUrl,
        base_path: basePath,
        auth_type: payload.authType ? parseAuthType(payload.authType) ?? undefined : undefined,
        auth_ref: payload.authRef,
        enabled: typeof payload.enabled === 'undefined' ? undefined : toBoolean(payload.enabled),
        icon: payload.icon,
        capabilities: shouldUpdateCapabilities
          ? capabilitiesForStorage(
              nextType,
              manifestCapabilities,
              storageBasePath,
              existing.capabilities,
              nextType === 'local' &&
                Boolean(storageBasePath) &&
                localSourceOverlapsReadOnlyRoot(storageBasePath!, repo.listSources(true)),
            )
          : undefined,
        health: payload.health ? parseHealth(payload.health) ?? undefined : undefined,
        last_synced_at: payload.lastSyncedAt,
      });

      if (!updated) {
        return res.status(404).json({ error: 'source not found.' });
      }

      return res.json(toSourceResponse(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(message.includes('allowlisted') || message.includes('basePath') ? 400 : 500).json({ error: message });
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
      const existing = repo.getSource(id);
      if (!existing) {
        return res.status(404).json({ error: 'source not found.' });
      }
      if (!sourceCanBeDeleted(existing.capabilities)) {
        return res.status(403).json({ error: 'Config-managed sources cannot be deleted through the API.' });
      }
      repo.deleteSource(id);
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
      const live = adapterSupportsLiveValidation(source.type);
      repo.updateSource(source.id, {
        health: live ? 'ok' : 'degraded',
        last_synced_at: new Date().toISOString(),
      });

      return res.json({
        sourceId: source.id,
        status: live ? 'ok' : 'degraded',
        message: live
          ? 'Connection test passed.'
          : 'Source configuration is valid, but this source type has no live connector yet; browsing and sync are unavailable until one ships.',
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
