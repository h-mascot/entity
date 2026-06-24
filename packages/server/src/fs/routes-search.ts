import type { Request, Response, Router } from 'express';
import {
  createFileIndexRepository,
  type FileIndexRecord,
  type FileIndexRepository,
  type FileSyncRunRecord,
} from '../../../db/src/file-index';
import {
  createFileSourceRepository,
  type FileSourceHealth,
  type FileSourceRecord,
  type FileSourceRepository,
} from '../../../db/src/file-sources';
import { createFileSourceAdapter } from './adapters/registry';
import type { FileSourceAdapter } from './adapters/types';
import { assertSourceEnabled, emitFsAudit } from './security';
import { recordFsOperation } from './metrics';
import { permissionSafeRecord, readRequestOrg, readRequestPrincipal, type RequestOrgBinding } from '../request-permissions';

const MAX_FALLBACK_DEPTH = 5;
const MAX_FALLBACK_DIRECTORIES_PER_SOURCE = 50;
const MAX_FALLBACK_FILES_PER_SOURCE = 250;
const CONNECTOR_HEALTH_VALUES = new Set<FileSourceHealth>(['ok', 'degraded', 'error']);
const INDEXED_FILTER_VALUES = new Set(['indexed', 'fallback', 'all']);

export interface SearchRouteDeps {
  indexRepo?: Pick<FileIndexRepository, 'search' | 'getLatestSyncRun'>;
  sourceRepo?: Pick<FileSourceRepository, 'listSources' | 'getSource'>;
  createAdapter?: (source: FileSourceRecord) => FileSourceAdapter;
}

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

function normalizeConnectorHealth(value: unknown): FileSourceHealth | undefined | null {
  if (typeof value === 'undefined') return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return CONNECTOR_HEALTH_VALUES.has(normalized as FileSourceHealth) ? normalized as FileSourceHealth : null;
}

function normalizeIndexedFilter(value: unknown): 'indexed' | 'fallback' | 'all' | undefined | null {
  if (typeof value === 'undefined') return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return INDEXED_FILTER_VALUES.has(normalized) ? normalized as 'indexed' | 'fallback' | 'all' : null;
}

function secondsSince(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000));
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function sourcePreviewRestricted(source: FileSourceRecord): { restricted: boolean; reasons: string[] } {
  const capabilities = parseRecord(source.capabilities);
  const policy = capabilities.entity_visibility_policy && typeof capabilities.entity_visibility_policy === 'object' && !Array.isArray(capabilities.entity_visibility_policy)
    ? capabilities.entity_visibility_policy as Record<string, unknown>
    : capabilities;
  const restricted =
    policy.restricted === true ||
    policy.allow_preview === false ||
    policy.permission_state === 'restricted' ||
    capabilities.permission_state === 'restricted';

  if (!restricted) {
    return { restricted: false, reasons: [] };
  }

  return {
    restricted: true,
    reasons: ['source permission policy restricts search preview'],
  };
}

function syncRunEnvelope(run: FileSyncRunRecord | undefined) {
  return run
    ? {
        id: run.id,
        status: run.status,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        error: run.error,
        filesScanned: run.files_scanned,
        filesIndexed: run.files_indexed,
      }
    : null;
}

function connectorState(source: FileSourceRecord, latestRun: FileSyncRunRecord | undefined) {
  return {
    health: source.health,
    lastSyncedAt: source.last_synced_at,
    indexLagSeconds: secondsSince(source.last_synced_at),
    latestSyncRun: syncRunEnvelope(latestRun),
  };
}

function requestSearchBinding(req: Request): RequestOrgBinding {
  const orgId = readRequestOrg(req) ?? 'default-org';
  return { orgId, principal: readRequestPrincipal(req, orgId) };
}

function baseEnvelope(input: {
  source: FileSourceRecord;
  latestRun: FileSyncRunRecord | undefined;
  path: string;
  title: string;
  type: string;
  agent: string;
  origin: string;
  preview: string | null;
  updatedAt: string | null;
  indexedAt: string | null;
  indexed: boolean;
  contentHash: string | null;
  tags?: string[];
}) {
  const connector = connectorState(input.source, input.latestRun);
  const degraded = input.source.health !== 'ok' || input.latestRun?.status === 'error';
  const previewPolicy = sourcePreviewRestricted(input.source);
  const permissionState = previewPolicy.restricted ? 'restricted' : 'visible';
  const safeTitle = previewPolicy.restricted ? 'Restricted file' : input.title;
  const safePreview = previewPolicy.restricted ? null : input.preview;

  return {
    objectType: 'file',
    object_type: 'file',
    title: safeTitle,
    snippet: safePreview,
    source: {
      id: input.source.id,
      name: input.source.display_name,
      type: input.source.type,
      health: input.source.health,
    },
    deepLink: {
      kind: 'file_source',
      sourceId: input.source.id,
      path: input.path,
    },
    scope: {
      sourceId: input.source.id,
      sourceType: input.source.type,
      orgId: null,
      teamId: null,
      projectId: null,
    },
    recency: {
      updatedAt: input.updatedAt,
      indexedAt: input.indexedAt,
      updatedAgeSeconds: secondsSince(input.updatedAt),
      indexedAgeSeconds: secondsSince(input.indexedAt),
    },
    provenance: {
      indexed: input.indexed,
      origin: input.origin,
      agent: input.agent,
      contentHash: input.contentHash,
      tags: input.tags ?? [],
    },
    permissionState,
    permission_state: permissionState,
    entity_permission_state: permissionState,
    restricted: previewPolicy.restricted,
    placeholder: previewPolicy.restricted,
    permission_reasons: previewPolicy.reasons,
    connectorState: connector,
    indexState: {
      indexed: input.indexed,
      degraded,
      lagSeconds: connector.indexLagSeconds,
      latestSyncStatus: input.latestRun?.status ?? null,
    },
  };
}

function indexedResultEnvelope(entry: FileIndexRecord, source: FileSourceRecord, latestRun: FileSyncRunRecord | undefined) {
  return {
    id: entry.id,
    sourceId: entry.source_id,
    sourceName: source.display_name,
    path: entry.path,
    type: entry.type,
    agent: entry.agent,
    origin: entry.origin ?? 'unknown',
    isRecurring: entry.is_recurring,
    recurringPattern: entry.recurring_pattern,
    preview: sourcePreviewRestricted(source).restricted ? null : entry.preview,
    updatedAt: entry.updated_at,
    indexedAt: entry.indexed_at,
    ...baseEnvelope({
      source,
      latestRun,
      path: entry.path,
      title: entry.title,
      type: entry.type,
      agent: entry.agent,
      origin: entry.origin ?? 'unknown',
      preview: entry.preview,
      updatedAt: entry.updated_at,
      indexedAt: entry.indexed_at,
      indexed: true,
      contentHash: entry.content_hash,
      tags: parseTags(entry.tags),
    }),
  };
}

function permissionSafeSearchResult<T extends Record<string, unknown>>(binding: RequestOrgBinding, object: {
  object_id: string;
  org_id?: string | null;
  title?: string | null;
  snippet?: string | null;
  sensitivity?: string | null;
  acl_json?: string | null;
  entity_visibility_policy_json?: string | null;
}, record: T): T & { permission?: unknown; restricted?: boolean; placeholder?: boolean } {
  if (
    record.restricted === true ||
    record.placeholder === true ||
    record.permissionState === 'restricted' ||
    record.permission_state === 'restricted' ||
    record.entity_permission_state === 'restricted'
  ) {
    return {
      ...record,
      title: 'Restricted file',
      preview: null,
      snippet: null,
      permissionState: 'restricted',
      permission_state: 'restricted',
      entity_permission_state: 'restricted',
      restricted: true,
      placeholder: true,
      permission_reasons: Array.isArray(record.permission_reasons)
        ? record.permission_reasons
        : ['source permission policy restricts search preview'],
      permission: {
        allowed: false,
        action: 'search',
        object_type: 'search_result',
        object_id: object.object_id,
        principal_id: binding.principal.principal_id,
        reasons: Array.isArray(record.permission_reasons)
          ? record.permission_reasons
          : ['source permission policy restricts search preview'],
      },
    };
  }

  const envelope = permissionSafeRecord(binding, {
    object_type: 'search_result',
    object_id: object.object_id,
    org_id: object.org_id ?? binding.orgId,
    title: object.title ?? null,
    snippet: object.snippet ?? null,
    content: object.snippet ?? null,
    sensitivity: object.sensitivity ?? null,
    acl_json: object.acl_json ?? null,
    entity_visibility_policy_json: object.entity_visibility_policy_json ?? null,
  }, record, 'search');

  if (envelope.permission.allowed) {
    return { ...envelope.object, permission: envelope.permission };
  }

  return {
    ...record,
    title: 'Restricted file',
    preview: null,
    snippet: null,
    permission_state: envelope.object.permission_state,
    entity_permission_state: envelope.object.entity_permission_state,
    restricted: true,
    placeholder: true,
    permission_reasons: envelope.object.permission_reasons,
    permission: envelope.permission,
  };
}

function fallbackResultEnvelope(input: {
  source: FileSourceRecord;
  latestRun: FileSyncRunRecord | undefined;
  path: string;
  title: string;
  updatedAt: string | null;
}) {
  return {
    id: `${input.source.id}:${input.path}`,
    sourceId: input.source.id,
    sourceName: input.source.display_name,
    path: input.path,
    type: 'one-off',
    agent: 'other',
    origin: 'unknown',
    isRecurring: false,
    recurringPattern: null,
    preview: null,
    updatedAt: input.updatedAt,
    indexedAt: null,
    ...baseEnvelope({
      source: input.source,
      latestRun: input.latestRun,
      path: input.path,
      title: input.title,
      type: 'one-off',
      agent: 'other',
      origin: 'unknown',
      preview: null,
      updatedAt: input.updatedAt,
      indexedAt: null,
      indexed: false,
      contentHash: null,
    }),
  };
}

export function registerSearchRoutes(router: Router, deps: SearchRouteDeps = {}): void {
  const indexRepo = deps.indexRepo ?? createFileIndexRepository();
  const sourceRepo = deps.sourceRepo ?? createFileSourceRepository();
  const createAdapter = deps.createAdapter ?? createFileSourceAdapter;

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
    const connectorHealth = normalizeConnectorHealth(req.query.connectorHealth ?? req.query.health);
    const indexedFilter = normalizeIndexedFilter(req.query.indexState ?? req.query.indexed);
    const binding = requestSearchBinding(req);

    if (connectorHealth === null) {
      return res.status(400).json({ error: 'connectorHealth must be ok, degraded, or error' });
    }
    if (indexedFilter === null) {
      return res.status(400).json({ error: 'indexState must be indexed, fallback, or all' });
    }

    try {
      const sourcesById = new Map(sourceRepo.listSources(true).map((source) => [source.id, source]));
      const latestRunsBySourceId = new Map<string, FileSyncRunRecord | undefined>();
      const latestRunFor = (id: string) => {
        if (!latestRunsBySourceId.has(id)) {
          latestRunsBySourceId.set(id, indexRepo.getLatestSyncRun(id));
        }
        return latestRunsBySourceId.get(id);
      };
      let indexedResults = indexRepo.search(query, {
        sourceId,
        type,
        agent,
        origin: normalizeOrigin(origin),
        from,
        to,
        limit,
      });
      if (connectorHealth) {
        indexedResults = indexedResults.filter((entry) => sourcesById.get(entry.source_id)?.health === connectorHealth);
      }
      if (indexedFilter !== 'fallback' && indexedResults.length > 0) {
        const durationMs = Date.now() - startedAt;
        emitFsAudit('fs.search.indexed', { query, count: indexedResults.length, durationMs });
        recordFsOperation({ operation: 'fs.search', sourceId, durationMs, success: true });

        return res.json({
          indexed: true,
          indexState: {
            mode: 'indexed',
            fallbackUsed: false,
            degraded: indexedResults.some((entry) => {
              const source = sourcesById.get(entry.source_id);
              const latestRun = latestRunFor(entry.source_id);
              return source?.health !== 'ok' || latestRun?.status === 'error';
            }),
          },
          results: indexedResults.map((entry) => {
            const source = sourcesById.get(entry.source_id);
            if (!source) {
              return null;
            }
            const record = indexedResultEnvelope(entry, source, latestRunFor(entry.source_id));
            return permissionSafeSearchResult(binding, {
              object_id: entry.id,
              org_id: entry.org_id ?? binding.orgId,
              title: entry.title,
              snippet: entry.preview,
              sensitivity: entry.sensitivity,
              acl_json: entry.acl_json,
              entity_visibility_policy_json: entry.entity_visibility_policy_json,
            }, record);
          }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
        });
      }
      if (indexedFilter === 'indexed') {
        const durationMs = Date.now() - startedAt;
        emitFsAudit('fs.search.indexed.empty', { query, count: 0, durationMs });
        recordFsOperation({ operation: 'fs.search', sourceId, durationMs, success: true });
        return res.json({ indexed: true, indexState: { mode: 'indexed', fallbackUsed: false, degraded: false }, results: [] });
      }

      // Fallback: source listing when index has no matches yet.
      const candidateSources = (sourceId ? [sourceRepo.getSource(sourceId)] : sourceRepo.listSources(false))
        .filter((source): source is FileSourceRecord => Boolean(source))
        .filter((source) => !connectorHealth || source.health === connectorHealth);
      const results: ReturnType<typeof fallbackResultEnvelope>[] = [];

      for (const source of candidateSources) {
        try {
          assertSourceEnabled(source);
          const adapter = createAdapter(source);
          const latestRun = latestRunFor(source.id);
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
              kind?: string;
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
              if (node.kind === 'other') {
                continue;
              }

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

              const nodeWithPolicy = node as typeof node & {
                orgId?: string | null;
                sensitivity?: string | null;
                aclJson?: string | null;
                entityVisibilityPolicyJson?: string | null;
              };
              const record = fallbackResultEnvelope({
                source,
                latestRun,
                path: node.path,
                title: node.name,
                updatedAt: node.updatedAt ?? null,
              });
              results.push(permissionSafeSearchResult(binding, {
                object_id: `${source.id}:${node.path}`,
                org_id: nodeWithPolicy.orgId ?? binding.orgId,
                title: node.name,
                snippet: null,
                sensitivity: nodeWithPolicy.sensitivity ?? null,
                acl_json: nodeWithPolicy.aclJson ?? null,
                entity_visibility_policy_json: nodeWithPolicy.entityVisibilityPolicyJson ?? null,
              }, record));
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
      return res.json({
        indexed: false,
        indexState: {
          mode: 'fallback',
          fallbackUsed: true,
          degraded: candidateSources.some((source) => source.health !== 'ok' || latestRunFor(source.id)?.status === 'error'),
        },
        results: results.slice(0, limit),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      emitFsAudit('fs.search.error', { query, error: message });
      recordFsOperation({ operation: 'fs.search', sourceId, success: false, error: message });
      return res.status(500).json({ error: message });
    }
  });
}
