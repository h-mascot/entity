import type { Request, Response, Router } from 'express';
import { createFileIndexRepository } from '../../../db/src/file-index';
import { createFileSourceRepository } from '../../../db/src/file-sources';
import { createFileSourceAdapter } from './adapters/registry';
import { assertSourceEnabled, emitFsAudit } from './security';
import { recordFsOperation } from './metrics';

const indexRepo = createFileIndexRepository();
const sourceRepo = createFileSourceRepository();

const MAX_FALLBACK_DEPTH = 5;
const MAX_FALLBACK_DIRECTORIES_PER_SOURCE = 50;
const MAX_FALLBACK_FILES_PER_SOURCE = 250;

function normalizeDirectoryPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.') {
    return '';
  }

  return trimmed.replace(/\/+$/, '');
}

function toLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, 200);
}

function normalizeOrigin(value: string | undefined): 'task' | 'cron' | 'manual' | 'unknown' | undefined {
  if (!value) return undefined;
  if (value === 'task' || value === 'cron' || value === 'manual' || value === 'unknown') {
    return value;
  }
  return undefined;
}

export function registerSearchRoutes(router: Router): void {
  router.get('/search', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const sourceId = typeof req.query.sourceId === 'string' ? req.query.sourceId.trim() : undefined;
    const type = typeof req.query.type === 'string' ? req.query.type.trim().toLowerCase() : undefined;
    const agent = typeof req.query.agent === 'string' ? req.query.agent.trim().toLowerCase() : undefined;
    const origin = typeof req.query.origin === 'string' ? req.query.origin.trim().toLowerCase() : undefined;
    const from = typeof req.query.from === 'string' ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;
    const limit = toLimit(req.query.limit, 50);

    try {
      const indexedResults = indexRepo.search(query, {
        sourceId,
        type,
        agent,
        origin: normalizeOrigin(origin),
        from,
        to,
        limit,
      });
      if (indexedResults.length > 0) {
        const sourcesById = new Map(sourceRepo.listSources(true).map((source) => [source.id, source]));
        const durationMs = Date.now() - startedAt;
        emitFsAudit('fs.search.indexed', { query, count: indexedResults.length, durationMs });
        recordFsOperation({ operation: 'fs.search', sourceId, durationMs, success: true });

        return res.json({
          indexed: true,
          results: indexedResults.map((entry) => ({
            id: entry.id,
            sourceId: entry.source_id,
            sourceName: sourcesById.get(entry.source_id)?.display_name ?? entry.source_id,
            path: entry.path,
            title: entry.title,
            type: entry.type,
            agent: entry.agent,
            origin: entry.origin ?? 'unknown',
            isRecurring: entry.is_recurring,
            recurringPattern: entry.recurring_pattern,
            preview: entry.preview,
            updatedAt: entry.updated_at,
            indexedAt: entry.indexed_at,
          })),
        });
      }

      // Fallback: source listing when index has no matches yet.
      const candidateSources = sourceId ? [sourceRepo.getSource(sourceId)] : sourceRepo.listSources(false);
      const results: Array<{
        id: string;
        sourceId: string;
        sourceName: string;
        path: string;
        title: string;
        type: string;
        agent: string;
        origin: string;
        isRecurring: boolean;
        recurringPattern: string | null;
        preview: string | null;
        updatedAt: string | null;
        indexedAt: string | null;
      }> = [];

      for (const source of candidateSources) {
        if (!source) {
          continue;
        }

        try {
          assertSourceEnabled(source);
          const adapter = createFileSourceAdapter(source);
          const queue: Array<{ path: string; depth: number }> = [{ path: '', depth: 0 }];
          const queuedDirectories = new Set<string>(['']);
          const visitedDirectories = new Set<string>();
          const visitedFiles = new Set<string>();
          let filesScannedForSource = 0;

          while (queue.length > 0) {
            if (filesScannedForSource >= MAX_FALLBACK_FILES_PER_SOURCE) {
              break;
            }

            if (visitedDirectories.size >= MAX_FALLBACK_DIRECTORIES_PER_SOURCE) {
              break;
            }

            const next = queue.shift();
            if (!next) {
              break;
            }

            const directoryPath = normalizeDirectoryPath(next.path);
            queuedDirectories.delete(directoryPath);
            if (visitedDirectories.has(directoryPath)) {
              continue;
            }

            visitedDirectories.add(directoryPath);

            let nodes: Array<{
              path: string;
              name: string;
              isDirectory: boolean;
              updatedAt?: string;
            }> = [];

            try {
              nodes = await adapter.list(directoryPath);
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Unknown list error';
              emitFsAudit('fs.search.fallback.dir.error', { sourceId: source.id, path: directoryPath, error: message });
              if (!directoryPath) {
                throw err;
              }
              continue;
            }

            for (const node of nodes) {
              if (node.isDirectory) {
                const nextDepth = next.depth + 1;
                if (nextDepth > MAX_FALLBACK_DEPTH) {
                  continue;
                }

                const childPath = normalizeDirectoryPath(node.path);
                if (visitedDirectories.has(childPath) || queuedDirectories.has(childPath)) {
                  continue;
                }

                if (visitedDirectories.size + queuedDirectories.size >= MAX_FALLBACK_DIRECTORIES_PER_SOURCE) {
                  continue;
                }

                queue.push({ path: childPath, depth: nextDepth });
                queuedDirectories.add(childPath);
                continue;
              }

              if (visitedFiles.has(node.path)) {
                continue;
              }

              if (filesScannedForSource >= MAX_FALLBACK_FILES_PER_SOURCE) {
                break;
              }

              visitedFiles.add(node.path);
              filesScannedForSource += 1;

              // Fallback entries are unindexed, so only one-off/other can match explicit filters.
              if (type && type !== 'one-off') {
                continue;
              }

              if (agent && agent !== 'other') {
                continue;
              }

              if (origin && origin !== 'unknown') {
                continue;
              }

              if (from || to) {
                if (!node.updatedAt) {
                  continue;
                }

                const updatedAtMs = new Date(node.updatedAt).getTime();
                if (!Number.isFinite(updatedAtMs)) {
                  continue;
                }

                if (from) {
                  const fromMs = new Date(from).getTime();
                  if (Number.isFinite(fromMs) && updatedAtMs < fromMs) {
                    continue;
                  }
                }

                if (to) {
                  const toMs = new Date(to).getTime();
                  if (Number.isFinite(toMs) && updatedAtMs > toMs) {
                    continue;
                  }
                }
              }

              const haystack = `${node.name} ${node.path}`.toLowerCase();
              if (query && !haystack.includes(query.toLowerCase())) {
                continue;
              }

              results.push({
                id: `${source.id}:${node.path}`,
                sourceId: source.id,
                sourceName: source.display_name,
                path: node.path,
                title: node.name,
                type: 'one-off',
                agent: 'other',
                origin: 'unknown',
                isRecurring: false,
                recurringPattern: null,
                preview: null,
                updatedAt: node.updatedAt ?? null,
                indexedAt: null,
              });
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown fallback error';
          emitFsAudit('fs.search.fallback.error', { sourceId: source.id, error: message });
        }
      }

      results.sort((a, b) => {
        const aMs = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bMs = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bMs - aMs;
      });

      const durationMs = Date.now() - startedAt;
      emitFsAudit('fs.search.fallback', { query, count: results.length, durationMs });
      recordFsOperation({ operation: 'fs.search', sourceId, durationMs, success: true });
      return res.json({ indexed: false, results: results.slice(0, limit) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      emitFsAudit('fs.search.error', { query, error: message });
      recordFsOperation({ operation: 'fs.search', sourceId, success: false, error: message });
      return res.status(500).json({ error: message });
    }
  });
}
