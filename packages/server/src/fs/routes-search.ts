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
import { createFileSourceAdapter, isFileSourceTypeImplemented } from './adapters/registry';
import type { FileSourceAdapter } from './adapters/types';
import { assertSourceEnabled, emitFsAudit } from './security';
import { recordFsOperation } from './metrics';
import { permissionSafeRecord, requireRequestOrg, type RequestOrgBinding } from '../request-permissions';
import { createFsFileOwnershipRepository, type FsFileOwnershipRepository } from '../../../db/src/file-ownership';
import {
  assertOwnedFileAccess,
  ownershipEnvelope,
  resolveOwnershipScope,
  sourceOwnershipPathVisible,
} from './ownership';

const MAX_FALLBACK_DEPTH = 5;
const MAX_FALLBACK_DIRECTORIES_PER_SOURCE = 50;
const MAX_FALLBACK_FILES_PER_SOURCE = 250;
const INDEXED_SEARCH_BATCH_SIZE = 50;
const SEARCH_SCOPE_SCAN_LIMIT = 1_000;
const SEARCH_SCOPE_SCAN_LIMIT_ERROR = 'Search scope is too broad; narrow the query or choose a source.';
const CONNECTOR_HEALTH_VALUES = new Set<FileSourceHealth>(['ok', 'degraded', 'error']);
const INDEXED_FILTER_VALUES = new Set(['indexed', 'fallback', 'all']);

export interface SearchRouteDeps {
  indexRepo?: Pick<FileIndexRepository, 'search' | 'getLatestSyncRun'>;
  sourceRepo?: Pick<FileSourceRepository, 'listSources' | 'getSource'>;
  ownershipRepo?: Pick<FsFileOwnershipRepository, 'getOwnership' | 'listOwnershipForOrg'>;
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

export function sourcePreviewRestricted(source: FileSourceRecord): { restricted: boolean; reasons: string[] } {
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

type PermissionSafeSearchResult<T extends Record<string, unknown>> = Omit<T, 'owner'> & {
  owner?: unknown;
  permission?: unknown;
  restricted?: boolean;
  placeholder?: boolean;
};

function permissionSafeSearchResult<T extends Record<string, unknown>>(binding: RequestOrgBinding, object: {
  object_id: string;
  org_id?: string | null;
  team_id?: string | null;
  title?: string | null;
  snippet?: string | null;
  sensitivity?: string | null;
  acl_json?: string | null;
  entity_visibility_policy_json?: string | null;
}, record: T): PermissionSafeSearchResult<T> {
  if (
    record.restricted === true ||
    record.placeholder === true ||
    record.permissionState === 'restricted' ||
    record.permission_state === 'restricted' ||
    record.entity_permission_state === 'restricted'
  ) {
    const { owner, ...redactedRecord } = record as T & { owner?: unknown };
    void owner;
    return {
      ...redactedRecord,
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
    team_id: object.team_id ?? null,
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

  const { owner, ...redactedRecord } = record as T & { owner?: unknown };
  void owner;
  return {
    ...redactedRecord,
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

function sendSearchScopeScanLimit(res: Response) {
  return res.status(422).json({
    code: 'search_scope_scan_limit',
    error: SEARCH_SCOPE_SCAN_LIMIT_ERROR,
  });
}

export function registerSearchRoutes(router: Router, deps: SearchRouteDeps = {}): void {
  const indexRepo = deps.indexRepo ?? createFileIndexRepository();
  const sourceRepo = deps.sourceRepo ?? createFileSourceRepository();
  const ownershipRepo = deps.ownershipRepo ?? createFsFileOwnershipRepository();
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
    const binding = requireRequestOrg(req, res);
    if (!binding) return;
    if (connectorHealth === null) {
      return res.status(400).json({ error: 'connectorHealth must be ok, degraded, or error' });
    }
    if (indexedFilter === null) {
      return res.status(400).json({ error: 'indexState must be indexed, fallback, or all' });
    }

    try {
      const configuredSources = sourceRepo.listSources(true);
      const sourcesById = new Map(configuredSources.map((source) => [source.id, source]));
      const ownershipScope = resolveOwnershipScope(binding);
      let ownershipRecordsForOrg: ReturnType<FsFileOwnershipRepository['listOwnershipForOrg']> | undefined;
      const listOwnershipForOrg = () => {
        ownershipRecordsForOrg ??= ownershipRepo.listOwnershipForOrg(binding.orgId);
        return ownershipRecordsForOrg;
      };
      const latestRunsBySourceId = new Map<string, FileSyncRunRecord | undefined>();
      const latestRunFor = (id: string) => {
        if (!latestRunsBySourceId.has(id)) {
          latestRunsBySourceId.set(id, indexRepo.getLatestSyncRun(id));
        }
        return latestRunsBySourceId.get(id);
      };
      const indexedSearchFilters = {
        orgId: binding.orgId,
        includeUnscoped: binding.orgId === 'default-org',
        sourceId,
        type,
        agent,
        origin: normalizeOrigin(origin),
        from,
        to,
      };
      type IndexedSearchResult = PermissionSafeSearchResult<Record<string, unknown>>;
      const indexedResults: IndexedSearchResult[] = [];
      let indexedCandidatesFound = false;
      let indexedOffset = 0;
      let indexedScannedCandidates = 0;
      let indexedPage: FileIndexRecord[] = [];
      const indexedSourceIds = new Set<string>();

      // Ownership filtering happens between bounded index pages and the final
      // result limit. A forbidden top-ranked page must not consume the caller's
      // requested slots or hide later authorized matches.
      if (indexedFilter !== 'fallback') {
        do {
          if (req.destroyed || res.writableEnded) return;
          const pageLimit = Math.min(INDEXED_SEARCH_BATCH_SIZE, SEARCH_SCOPE_SCAN_LIMIT - indexedScannedCandidates);
          if (pageLimit <= 0) break;
          const fetchedPage = indexRepo.search(query, {
            ...indexedSearchFilters,
            limit: pageLimit,
            offset: indexedOffset,
          });
          const pageExceedsBudget = fetchedPage.length > pageLimit;
          indexedPage = fetchedPage.slice(0, pageLimit);
          indexedOffset += indexedPage.length;
          indexedScannedCandidates += indexedPage.length;
          const eligiblePage = indexedPage.filter((entry) => {
            const source = sourcesById.get(entry.source_id);
            if (!source || (connectorHealth && source.health !== connectorHealth)) return false;
            // Disabled or unimplemented connectors are excluded from search
            // entirely: stale rows must not surface actionable results.
            return source.enabled && isFileSourceTypeImplemented(source.type);
          });
          for (const entry of eligiblePage) {
            const source = sourcesById.get(entry.source_id);
            if (!source) continue;
            indexedSourceIds.add(source.id);
            let ownership;
            try {
              ownership = assertOwnedFileAccess(binding, ownershipRepo, entry.source_id, entry.path, 'read', configuredSources);
            } catch {
              continue;
            }
            // Only an ownership-authorized indexed row suppresses all-mode
            // fallback. Source eligibility alone is not visibility.
            indexedCandidatesFound = true;
            const record = indexedResultEnvelope(entry, source, latestRunFor(entry.source_id));
            const owned = ownershipEnvelope(ownership);
            const enriched = owned ? { ...record, owner: owned } : record;
            indexedResults.push(permissionSafeSearchResult(binding, {
              object_id: entry.id,
              org_id: ownership?.org_id ?? entry.org_id ?? binding.orgId,
              team_id: ownership?.team_id ?? null,
              title: entry.title,
              snippet: entry.preview,
              sensitivity: entry.sensitivity,
              acl_json: entry.acl_json,
              entity_visibility_policy_json: entry.entity_visibility_policy_json,
            }, enriched));
            if (indexedResults.length >= limit) break;
          }
          if (indexedResults.length < limit && pageExceedsBudget) {
            return res.status(422).json({
              code: 'search_scope_scan_limit',
              error: SEARCH_SCOPE_SCAN_LIMIT_ERROR,
            });
          }
          if (indexedResults.length < limit && indexedPage.length === INDEXED_SEARCH_BATCH_SIZE) {
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          if (
            indexedResults.length < limit &&
            indexedScannedCandidates === SEARCH_SCOPE_SCAN_LIMIT &&
            indexedPage.length === INDEXED_SEARCH_BATCH_SIZE
          ) {
            // A one-row lookahead determines exact exhaustion without running
            // ownership/path checks beyond the hard candidate budget.
            const lookahead = indexRepo.search(query, {
              ...indexedSearchFilters,
              limit: 1,
              offset: indexedOffset,
            });
            if (lookahead.length > 0) {
              return sendSearchScopeScanLimit(res);
            }
          }
        } while (indexedResults.length < limit && indexedPage.length === INDEXED_SEARCH_BATCH_SIZE);
      }

      if (req.destroyed || res.writableEnded) return;

      if (indexedFilter !== 'fallback' && indexedCandidatesFound) {
        const durationMs = Date.now() - startedAt;
        emitFsAudit('fs.search.indexed', { query, count: indexedResults.length, durationMs });
        recordFsOperation({ operation: 'fs.search', sourceId, durationMs, success: true });

        return res.json({
          indexed: true,
          indexState: {
            mode: 'indexed',
            fallbackUsed: false,
            degraded: [...indexedSourceIds].some((sourceId) => {
              const source = sourcesById.get(sourceId);
              const latestRun = source ? latestRunFor(source.id) : undefined;
              return source?.health !== 'ok' || latestRun?.status === 'error';
            }),
          },
          results: indexedResults,
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
        // Never dispatch fallback listing to unimplemented connectors.
        .filter((source) => isFileSourceTypeImplemented(source.type))
        .filter((source) => !connectorHealth || source.health === connectorHealth);
      const results: ReturnType<typeof fallbackResultEnvelope>[] = [];
      let fallbackCandidatesScanned = 0;
      let fallbackTruncated = false;

      for (const source of candidateSources) {
        if (fallbackTruncated) break;
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
            if (fallbackTruncated) {
              break;
            }

            if (visitedDirectories.size >= MAX_FALLBACK_DIRECTORIES_PER_SOURCE) {
              if (queue.length > 0) fallbackTruncated = true;
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
              if (fallbackCandidatesScanned >= SEARCH_SCOPE_SCAN_LIMIT) {
                fallbackTruncated = true;
                break;
              }
              fallbackCandidatesScanned += 1;

              if (node.kind === 'other') {
                continue;
              }

              if (node.isDirectory) {
                const nextDepth = next.depth + 1;
                const childPath = normalizeDirectoryPath(node.path);
                if (!sourceOwnershipPathVisible(ownershipScope, source.id, childPath, listOwnershipForOrg(), configuredSources)) {
                  continue;
                }
                if (nextDepth > MAX_FALLBACK_DEPTH) {
                  fallbackTruncated = true;
                  continue;
                }

                if (visitedDirectories.has(childPath) || queuedDirectories.has(childPath)) {
                  continue;
                }

                if (visitedDirectories.size + queuedDirectories.size >= MAX_FALLBACK_DIRECTORIES_PER_SOURCE) {
                  fallbackTruncated = true;
                  continue;
                }

                queue.push({ path: childPath, depth: nextDepth });
                queuedDirectories.add(childPath);
                continue;
              }

              if (visitedFiles.has(node.path)) {
                continue;
              }

              visitedFiles.add(node.path);

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
              let ownership;
              try {
                ownership = assertOwnedFileAccess(binding, ownershipRepo, source.id, node.path, 'read', configuredSources);
              } catch {
                continue;
              }
              filesScannedForSource += 1;
              if (filesScannedForSource > MAX_FALLBACK_FILES_PER_SOURCE) {
                fallbackTruncated = true;
                break;
              }
              const record = fallbackResultEnvelope({
                source,
                latestRun,
                path: node.path,
                title: node.name,
                updatedAt: node.updatedAt ?? null,
              });
              const owned = ownershipEnvelope(ownership);
              const enriched = owned ? { ...record, owner: owned } : record;
              results.push(permissionSafeSearchResult(binding, {
                object_id: `${source.id}:${node.path}`,
                org_id: ownership?.org_id ?? nodeWithPolicy.orgId ?? binding.orgId,
                team_id: ownership?.team_id ?? null,
                title: node.name,
                snippet: null,
                sensitivity: nodeWithPolicy.sensitivity ?? null,
                acl_json: nodeWithPolicy.aclJson ?? null,
                entity_visibility_policy_json: nodeWithPolicy.entityVisibilityPolicyJson ?? null,
              }, enriched));
            }

            if (fallbackTruncated) break;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown fallback error';
          emitFsAudit('fs.search.fallback.error', { sourceId: source.id, error: message });
        }
      }

      if (fallbackTruncated) {
        return sendSearchScopeScanLimit(res);
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
