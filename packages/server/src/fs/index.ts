import type { Express, Request, Response } from 'express';
import { Router } from 'express';
import path from 'path';
import type { FileSystemRouteOptions } from './types';
import { registerSourceRoutes } from './routes-sources';
import { registerFileRoutes } from './routes-files';
import { registerDocumentConvertRoutes } from './routes-convert';
import { registerSearchRoutes } from './routes-search';
import { FileIndexRunner } from './index-runner';
import { emitFsAudit } from './security';
import { getFsMetricsSnapshot } from './metrics';
import { createFileSourceRepository } from '../../../db/src/file-sources';
import { createFileIndexRepository } from '../../../db/src/file-index';

export function registerFileSystemRoutes(app: Express, options: FileSystemRouteOptions): void {
  if (!options.enabled) {
    return;
  }

  registerSourceRoutes(app);

  const router = Router();
  const runner = new FileIndexRunner();
  const sourceRepo = createFileSourceRepository();
  const indexRepo = createFileIndexRepository();

  // Auto-initialize/default-correct workspace source.
  // Uses effective config workspaceRoot, NOT hardcoded paths.
  // Only creates a source if DB has none and the path exists.
  const fs = require('fs');
  const homeDir = process.env.HOME || require('os').homedir();
  const workspaceRoot = options.workspaceRoot || homeDir;

  // Check if any source exists in DB. If not, create a generic 'workspace' source.
  const existingSources = sourceRepo.listSources(false);
  if (existingSources.length === 0) {
    // Use workspaceRoot directly - no hardcoded subfolder like 'clawd'
    const defaultSourcePath = workspaceRoot;
    if (fs.existsSync(defaultSourcePath)) {
      sourceRepo.createSource({
        id: 'workspace',
        display_name: 'Workspace',
        type: 'local',
        base_path: defaultSourcePath,
        icon: '📁',
        enabled: true,
      });
      console.log(`[FS] Auto-initialized workspace source: ${defaultSourcePath}`);
    }
  }

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      feature: 'entity.fs.multisource',
      workspaceRoot: options.workspaceRoot,
      indexerEnabled: options.indexerEnabled !== false,
    });
  });

  router.get('/metrics', (_req: Request, res: Response) => {
    const metrics = getFsMetricsSnapshot();
    const sourceMetricsById = new Map(metrics.sources.map((entry) => [entry.sourceId, entry]));
    const sources = sourceRepo.listSources(true).map((source) => {
      const latestRun = indexRepo.getLatestSyncRun(source.id);
      const freshnessSeconds = source.last_synced_at
        ? Math.max(0, Math.floor((Date.now() - new Date(source.last_synced_at).getTime()) / 1000))
        : null;
      const sourceMetrics = sourceMetricsById.get(source.id);

      return {
        sourceId: source.id,
        sourceName: source.display_name,
        enabled: source.enabled,
        health: source.health,
        lastSyncedAt: source.last_synced_at,
        freshnessSeconds,
        operations: sourceMetrics?.operations ?? {},
        lastError: sourceMetrics?.lastError ?? null,
        lastErrorAt: sourceMetrics?.lastErrorAt ?? null,
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
      };
    });

    return res.json({ generatedAt: metrics.generatedAt, operations: metrics.operations, sources });
  });

  registerFileRoutes(router, { sourceRepo });
  registerDocumentConvertRoutes(router, { sourceRepo });
  registerSearchRoutes(router);

  app.use('/api/fs', router);

  if (options.indexerEnabled !== false) {
    const intervalMs = Math.max(60_000, options.indexIntervalMs ?? 5 * 60_000);
    let running = false;
    const runIndexer = async () => {
      if (running) {
        emitFsAudit('index.runner.skipped', { reason: 'already-running' });
        return;
      }

      running = true;
      try {
        await runner.runOnce();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown index runner error';
        emitFsAudit('index.runner.error', { error: message });
      } finally {
        running = false;
      }
    };

    void runIndexer().catch((err) => {
      const message = err instanceof Error ? err.message : 'Unknown index runner error';
      emitFsAudit('index.runner.error', { error: message });
    });

    const timer = setInterval(() => {
      void runIndexer().catch((err) => {
        const message = err instanceof Error ? err.message : 'Unknown index runner error';
        emitFsAudit('index.runner.error', { error: message });
      });
    }, intervalMs);
    timer.unref();
  }
}
