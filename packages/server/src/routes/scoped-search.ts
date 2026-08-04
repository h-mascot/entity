import { Router, type Request, type Response } from 'express';
import {
  DEFAULT_WORKSPACE_ORG_ID,
  EVIDENCE_ARTIFACT_KINDS,
  createDocumentObjectRepository,
  createEvidenceArtifactRepository,
  createOrgScopedTaskRepository,
  type DocumentObjectRepository,
  type EvidenceArtifactKind,
  type EvidenceArtifactAvailabilityState,
  type EvidenceArtifactRepository,
  type ExternalDocumentRefRecord,
  type NativeDocumentLifecycleState,
  type TaskRepository,
  type TaskRecord,
} from '../../../db/src';
import {
  createFileIndexRepository,
  type FileIndexRepository,
  type FileSyncRunRecord,
} from '../../../db/src/file-index';
import {
  createFileSourceRepository,
  type FileSourceRecord,
  type FileSourceRepository,
} from '../../../db/src/file-sources';
import { phase2FlagEnabled, resolvePhase2Flags, type Phase2FlagSnapshot } from '../phase2-flags';
import { requireRequestOrg, type RequestOrgBinding } from '../request-permissions';
import { buildGoogleExternalDocumentMetadata } from '../google-docs-metadata';
import {
  externalResult,
  fileResult,
  nativeResult,
  secondsSince,
  sourceConnectorState,
  type RankedSearchResult,
  type ScopedSearchObjectType,
} from './scoped-search-documents';
import {
  observeProofHealth,
  proofResults,
  taskMatchesProofOriginFilters,
  taskResults,
  taskTitleMatchesQuery,
  type TaskProofSearchFilters,
} from './scoped-search-task-proof';

const DOCUMENT_OBJECT_TYPES = ['native_document', 'external_document_ref', 'file'] as const;
const ALL_SCOPED_OBJECT_TYPES = [
  ...DOCUMENT_OBJECT_TYPES,
  'task',
  'evidence_artifact',
  'receipt',
] as const;
const SEARCH_INDEX_LAG_DEGRADED_SECONDS = 5 * 60;
const MAX_CURSOR_OFFSET = 10_000;
const MAX_BACKEND_CANDIDATES = 10_101;
const NATIVE_DOCUMENT_STATES = new Set(['draft', 'active', 'archived', 'superseded']);
const EXTERNAL_DOCUMENT_STATES = new Set(['available', 'permission_revoked', 'deleted', 'unknown']);
const CONNECTOR_STATES = new Set(['ready', 'degraded', 'unavailable', 'unknown']);
const TASK_STATES = new Set(['backlog', 'todo', 'doing', 'review', 'done']);
const PROOF_STATES = new Set(['available', 'missing_body', 'unavailable', 'pending', 'unknown']);
const REVIEW_STATES = new Set(['not_required', 'pending', 'accepted', 'request_fix', 'skipped_by_policy']);
const RISK_STATES = new Set(['low', 'medium', 'high', 'critical']);

type SearchHealth = 'healthy' | 'degraded' | 'failed' | 'unknown';
type SearchBackendName = 'documents' | 'tasks' | 'proofs';

interface SearchBackendState {
  name: SearchBackendName;
  state: SearchHealth;
  indexedAt: string | null;
  lagSeconds: number | null;
  reasons: string[];
}

export interface ScopedSearchRouteDeps {
  flags?: Phase2FlagSnapshot;
  documentRepo?: Pick<DocumentObjectRepository, 'listNativeDocuments' | 'listExternalDocumentRefs'>;
  indexRepo?: Pick<FileIndexRepository, 'search' | 'getLatestSyncRun'>;
  sourceRepo?: Pick<FileSourceRepository, 'listSources' | 'getSource'>;
  taskRepoForOrg?: (orgId: string) => Pick<TaskRepository, 'listTasks'>;
  artifactRepo?: Pick<EvidenceArtifactRepository, 'listArtifacts'>;
  now?: () => Date;
}

interface SearchFilters extends TaskProofSearchFilters {
  objectTypes: ScopedSearchObjectType[];
  searchNative: boolean;
  searchExternal: boolean;
  searchFiles: boolean;
  searchTasks: boolean;
  searchProofs: boolean;
  sourceId?: string;
  connectorState?: string;
  limit: number;
  offset: number;
}

class ScopedSearchRequestError extends Error {}

/**
 * R4 authority hardening: scoped search aggregates across documents, tasks,
 * and proof artifacts, so the org used to scope every backend SQL query must
 * come ONLY from the shared principal-derived resolver (`requireRequestOrg`).
 * For a customer principal the bound org is membership-derived: a caller-
 * selected header/query/body org can only narrow within grants (never widen)
 * and an omitted/ambiguous scope fails closed. For the trusted service/admin
 * path the existing readRequestOrg convention is preserved. Per-object
 * visibility is still gated by the principal's org-scoped grants via the
 * permission envelopes built from binding.principal.
 */
function requireScopedSearchOrg(req: Request, res: Response): RequestOrgBinding | null {
  return requireRequestOrg(req, res);
}

function readQuery(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseObjectTypes(value: string | undefined): ScopedSearchObjectType[] {
  if (!value) return [...DOCUMENT_OBJECT_TYPES];
  const requested = [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))];
  if (requested.length === 0 || requested.some((entry) => !(ALL_SCOPED_OBJECT_TYPES as readonly string[]).includes(entry))) {
    throw new ScopedSearchRequestError('objectTypes contains an invalid object type');
  }
  return requested as ScopedSearchObjectType[];
}

function parsePositiveInteger(value: string | undefined, field: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ScopedSearchRequestError(`${field} must be a positive integer`);
  }
  return parsed;
}

function parseDate(value: string | undefined, field: string): string | undefined {
  if (!value) return undefined;
  if (!Number.isFinite(Date.parse(value))) {
    throw new ScopedSearchRequestError(`${field} must be a valid date`);
  }
  return value;
}

function decodeCursor(value: string | undefined): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { version?: unknown; offset?: unknown };
    if (
      parsed.version !== 1
      || !Number.isInteger(parsed.offset)
      || Number(parsed.offset) < 0
      || Number(parsed.offset) > MAX_CURSOR_OFFSET
    ) {
      throw new Error('invalid cursor');
    }
    return Number(parsed.offset);
  } catch {
    throw new ScopedSearchRequestError('cursor is invalid');
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ version: 1, offset }), 'utf8').toString('base64url');
}

function parseFilters(req: Request): SearchFilters {
  const limit = parsePositiveInteger(readQuery(req, 'limit'), 'limit') ?? 20;
  if (limit > 100) throw new ScopedSearchRequestError('limit must be between 1 and 100');
  const from = parseDate(readQuery(req, 'from'), 'from');
  const to = parseDate(readQuery(req, 'to'), 'to');
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new ScopedSearchRequestError('from must not be after to');
  }
  const objectTypes = parseObjectTypes(readQuery(req, 'objectTypes'));
  const sourceId = readQuery(req, 'sourceId');
  const teamId = readQuery(req, 'teamId');
  const projectId = parsePositiveInteger(readQuery(req, 'projectId'), 'projectId');
  const state = readQuery(req, 'state');
  const sensitivity = readQuery(req, 'sensitivity');
  const connectorState = readQuery(req, 'connectorState');
  const worktype = readQuery(req, 'worktype');
  const ownerId = readQuery(req, 'ownerId');
  const assigneeId = readQuery(req, 'assigneeId');
  const initiatorId = readQuery(req, 'initiatorId');
  const reviewState = readQuery(req, 'reviewState');
  const risk = readQuery(req, 'risk');
  const searchableStates = new Set<string>();
  if (objectTypes.includes('native_document')) {
    for (const value of NATIVE_DOCUMENT_STATES) searchableStates.add(value);
  }
  if (objectTypes.includes('external_document_ref')) {
    for (const value of EXTERNAL_DOCUMENT_STATES) searchableStates.add(value);
  }
  if (objectTypes.includes('task')) {
    for (const value of TASK_STATES) searchableStates.add(value);
  }
  if (objectTypes.some((type) => type === 'evidence_artifact' || type === 'receipt')) {
    for (const value of PROOF_STATES) searchableStates.add(value);
  }
  if (sourceId && !objectTypes.includes('file')) {
    throw new ScopedSearchRequestError('sourceId requires file objectTypes');
  }
  if ((teamId || projectId) && !objectTypes.some((type) =>
    type === 'native_document' || type === 'task' || type === 'evidence_artifact' || type === 'receipt'
  )) {
    throw new ScopedSearchRequestError('teamId and projectId require scoped Entity objectTypes');
  }
  if (sensitivity && !objectTypes.some((type) =>
    type === 'native_document'
    || type === 'file'
    || type === 'task'
    || type === 'evidence_artifact'
    || type === 'receipt'
  )) {
    throw new ScopedSearchRequestError('sensitivity requires a sensitivity-aware objectType');
  }
  if (state && !searchableStates.has(state)) {
    throw new ScopedSearchRequestError('state is invalid for the requested objectTypes');
  }
  if (connectorState && (
    !CONNECTOR_STATES.has(connectorState)
    || !objectTypes.some((type) => type === 'external_document_ref' || type === 'file')
  )) {
    throw new ScopedSearchRequestError('connectorState is invalid for the requested objectTypes');
  }
  const taskFilterPresent = Boolean(worktype || ownerId || assigneeId || initiatorId || reviewState || risk);
  if (taskFilterPresent && !objectTypes.some((type) =>
    type === 'task' || type === 'evidence_artifact' || type === 'receipt'
  )) {
    throw new ScopedSearchRequestError('task filters require task or proof objectTypes');
  }
  if (reviewState && !REVIEW_STATES.has(reviewState)) {
    throw new ScopedSearchRequestError('reviewState is invalid');
  }
  if (risk && !RISK_STATES.has(risk)) {
    throw new ScopedSearchRequestError('risk is invalid');
  }
  const searchNative = objectTypes.includes('native_document')
    && !sourceId
    && !taskFilterPresent
    && (!state || NATIVE_DOCUMENT_STATES.has(state));
  const searchExternal = objectTypes.includes('external_document_ref')
    && !sourceId
    && !taskFilterPresent
    && !teamId
    && !projectId
    && !sensitivity
    && (!state || EXTERNAL_DOCUMENT_STATES.has(state));
  const searchFiles = objectTypes.includes('file')
    && !taskFilterPresent
    && !teamId
    && !projectId
    && !state;
  const searchTasks = objectTypes.includes('task')
    && !sourceId
    && !connectorState
    && (!state || TASK_STATES.has(state));
  const searchProofs = objectTypes.some((type) => type === 'evidence_artifact' || type === 'receipt')
    && !sourceId
    && !connectorState
    && (!state || PROOF_STATES.has(state));
  if (!searchNative && !searchExternal && !searchFiles && !searchTasks && !searchProofs) {
    throw new ScopedSearchRequestError('filters are incompatible with the requested objectTypes');
  }
  return {
    objectTypes,
    searchNative,
    searchExternal,
    searchFiles,
    searchTasks,
    searchProofs,
    sourceId,
    teamId,
    projectId,
    state,
    sensitivity,
    connectorState,
    worktype,
    ownerId,
    assigneeId,
    initiatorId,
    reviewState,
    risk,
    from,
    to,
    limit,
    offset: decodeCursor(readQuery(req, 'cursor')),
  };
}

function backendHealth(input: {
  name: SearchBackendName;
  unavailableReason: string;
  completed: number;
  failed: number;
  degradedReasons: Set<string>;
  unknownReasons: Set<string>;
  indexedTimes?: number[];
  now: Date;
}): SearchBackendState {
  const indexedAtMs = (input.indexedTimes ?? []).filter(Number.isFinite).sort((left, right) => left - right)[0];
  const indexedAt = Number.isFinite(indexedAtMs) ? new Date(indexedAtMs).toISOString() : null;
  const lagSeconds = indexedAt ? secondsSince(input.now, indexedAt) : null;
  if (input.completed === 0) {
    return {
      name: input.name,
      state: 'failed',
      indexedAt,
      lagSeconds,
      reasons: [input.unavailableReason],
    };
  }
  if (input.failed > 0 || input.degradedReasons.size > 0) {
    return {
      name: input.name,
      state: 'degraded',
      indexedAt,
      lagSeconds,
      reasons: [...new Set([...input.degradedReasons, ...input.unknownReasons])],
    };
  }
  if (input.unknownReasons.size > 0) {
    return {
      name: input.name,
      state: 'unknown',
      indexedAt,
      lagSeconds,
      reasons: [...input.unknownReasons],
    };
  }
  return { name: input.name, state: 'healthy', indexedAt, lagSeconds, reasons: [] };
}

function overallHealth(backends: SearchBackendState[]): {
  state: SearchHealth;
  partial: boolean;
  reasons: string[];
} {
  const reasons = [...new Set(backends.flatMap((backend) => backend.reasons))];
  if (backends.length > 0 && backends.every((backend) => backend.state === 'failed')) {
    return { state: 'failed', partial: false, reasons };
  }
  if (backends.some((backend) => backend.state === 'failed' || backend.state === 'degraded')) {
    return { state: 'degraded', partial: true, reasons };
  }
  if (backends.some((backend) => backend.state === 'unknown')) {
    return { state: 'unknown', partial: true, reasons };
  }
  return { state: 'healthy', partial: false, reasons: [] };
}

function collectPermittedCandidates<T>(
  required: number,
  fetchRecords: (limit: number) => T[],
  normalizeRecords: (records: T[]) => RankedSearchResult[],
): { ranked: RankedSearchResult[]; capReached: boolean } {
  let fetchLimit = Math.max(1, Math.min(required, MAX_BACKEND_CANDIDATES));
  while (true) {
    const records = fetchRecords(fetchLimit);
    const ranked = normalizeRecords(records);
    const exhausted = records.length < fetchLimit;
    const capReached = fetchLimit === MAX_BACKEND_CANDIDATES && records.length >= fetchLimit;
    if (ranked.length >= required || exhausted || capReached) {
      return { ranked, capReached };
    }
    fetchLimit = Math.min(MAX_BACKEND_CANDIDATES, fetchLimit * 2);
  }
}

function compareRankedResults(left: RankedSearchResult, right: RankedSearchResult): number {
  return right.result.ranking.score - left.result.ranking.score
    || right.recencyMs - left.recencyMs
    || left.result.objectType.localeCompare(right.result.objectType)
    || left.result.objectId.localeCompare(right.result.objectId);
}

export function createScopedSearchRouter(deps: ScopedSearchRouteDeps = {}): Router {
  const router = Router();
  const flags = deps.flags ?? resolvePhase2Flags();
  const now = deps.now ?? (() => new Date());
  let documentRepo = deps.documentRepo;
  let indexRepo = deps.indexRepo;
  let sourceRepo = deps.sourceRepo;
  let artifactRepo = deps.artifactRepo;
  const documents = () => documentRepo ??= createDocumentObjectRepository();
  const index = () => indexRepo ??= createFileIndexRepository();
  const sources = () => sourceRepo ??= createFileSourceRepository();
  const artifacts = () => artifactRepo ??= createEvidenceArtifactRepository();
  const tasksForOrg = deps.taskRepoForOrg
    ?? ((orgId: string) => createOrgScopedTaskRepository({ orgId }));

  router.get('/', (req, res) => {
    const query = readQuery(req, 'q');
    if (!query) return res.status(400).json({ error: 'q required', code: 'query_required' });
    if (!phase2FlagEnabled(flags, 'search_permission_strictness')) {
      return res.status(503).json({
        error: 'search permission strictness disabled',
        code: 'search_permission_strictness_disabled',
        flag: flags.search_permission_strictness,
      });
    }
    const binding = requireScopedSearchOrg(req, res);
    if (!binding) return undefined;

    let filters: SearchFilters;
    try {
      filters = parseFilters(req);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'invalid search filters',
        code: 'invalid_search_filter',
      });
    }
    const requestNow = now();
    const candidateLimit = Math.min(
      MAX_BACKEND_CANDIDATES,
      filters.offset + filters.limit + 1,
    );

    const rankedResults: RankedSearchResult[] = [];
    const backendStates: SearchBackendState[] = [];
    const degradedReasons = new Set<string>();
    const unknownReasons = new Set<string>();
    const indexedTimes: number[] = [];
    let completed = 0;
    let failed = 0;
    let candidateCapReached = false;
    const documentsRequested = filters.searchNative || filters.searchExternal || filters.searchFiles;

    const nativeState = filters.state && NATIVE_DOCUMENT_STATES.has(filters.state)
      ? filters.state as NativeDocumentLifecycleState
      : undefined;
    if (filters.searchNative) {
      try {
        const candidates = collectPermittedCandidates(
          candidateLimit,
          (limit) => documents().listNativeDocuments({
            org_id: binding.orgId,
            query,
            team_id: filters.teamId,
            project_id: filters.projectId,
            lifecycle_state: nativeState,
            sensitivity: filters.sensitivity,
            from: filters.from,
            to: filters.to,
            limit,
          }),
          (records) => records
            .map((record) => nativeResult(binding, query, record))
            .filter((entry): entry is RankedSearchResult => Boolean(entry)),
        );
        candidateCapReached ||= candidates.capReached;
        rankedResults.push(...candidates.ranked);
        completed += 1;
      } catch {
        failed += 1;
        degradedReasons.add('native_documents_unavailable');
      }
    }

    const externalState = filters.state && EXTERNAL_DOCUMENT_STATES.has(filters.state)
      ? filters.state as ExternalDocumentRefRecord['external_ref_state']
      : undefined;
    if (filters.searchExternal) {
      try {
        const externalFilters = {
          org_id: binding.orgId,
          external_ref_state: externalState,
          from: filters.from,
          to: filters.to,
        };
        const matchesConnectorState = (record: ExternalDocumentRefRecord) =>
          !filters.connectorState
          || buildGoogleExternalDocumentMetadata(record, requestNow).effective_readiness_state === filters.connectorState;
        const candidates = collectPermittedCandidates(
          candidateLimit,
          (limit) => documents().listExternalDocumentRefs({ ...externalFilters, query, limit }),
          (records) => records
            .filter(matchesConnectorState)
            .map((record) => externalResult(binding, query, record, requestNow))
            .filter((entry): entry is RankedSearchResult => Boolean(entry)),
        );
        candidateCapReached ||= candidates.capReached;
        rankedResults.push(...candidates.ranked);
        const observedHealthRecords = documents().listExternalDocumentRefs({
          ...externalFilters,
          limit: MAX_BACKEND_CANDIDATES,
        });
        if (observedHealthRecords.length >= MAX_BACKEND_CANDIDATES) {
          unknownReasons.add('external_document_index_health_partial');
        }
        const healthRecords = observedHealthRecords.filter(matchesConnectorState);
        if (healthRecords.length === 0) {
          unknownReasons.add('external_document_index_health_unknown');
        }
        for (const record of healthRecords) {
          const effectiveConnector = buildGoogleExternalDocumentMetadata(record, requestNow);
          const lag = secondsSince(requestNow, record.last_indexed_at);
          if (lag === null) unknownReasons.add('external_document_index_freshness_unknown');
          else {
            indexedTimes.push(Date.parse(record.last_indexed_at as string));
            if (lag > SEARCH_INDEX_LAG_DEGRADED_SECONDS) degradedReasons.add('external_document_index_lag_degraded');
          }
          if (effectiveConnector.degraded) {
            degradedReasons.add('external_document_connector_degraded');
          } else if (effectiveConnector.effective_readiness_state === 'unknown') {
            unknownReasons.add('external_document_connector_state_unknown');
          }
        }
        completed += 1;
      } catch {
        failed += 1;
        degradedReasons.add('external_documents_unavailable');
      }
    }

    if (filters.searchFiles) {
      try {
        const requestedSource = filters.sourceId ? sources().getSource(filters.sourceId) : undefined;
        const fileSources = filters.sourceId
          ? [requestedSource].filter((entry): entry is FileSourceRecord => Boolean(entry?.enabled))
          : sources().listSources(false);
        const requestedSourceUnavailable = Boolean(filters.sourceId && fileSources.length === 0);
        if (requestedSourceUnavailable) degradedReasons.add('file_source_unavailable');
        const sourcesById = new Map(fileSources.map((source) => [source.id, source]));
        const latestRuns = new Map<string, FileSyncRunRecord | undefined>();
        const latestRunFor = (sourceId: string) => {
          if (!latestRuns.has(sourceId)) latestRuns.set(sourceId, index().getLatestSyncRun(sourceId));
          return latestRuns.get(sourceId);
        };
        const candidates = requestedSourceUnavailable
          ? { ranked: [], capReached: false }
          : collectPermittedCandidates(
              candidateLimit,
              (limit) => index().search(query, {
                orgId: binding.orgId,
                includeUnscoped: binding.orgId === DEFAULT_WORKSPACE_ORG_ID,
                sourceId: filters.sourceId,
                from: filters.from,
                to: filters.to,
                limit,
              }),
              (records) => records
                .filter((record) => !filters.sensitivity || record.sensitivity === filters.sensitivity)
                .filter((record) => {
                  if (!filters.connectorState) return true;
                  const source = sourcesById.get(record.source_id);
                  return source ? sourceConnectorState(source) === filters.connectorState : false;
                })
                .map((record) => {
                  const source = sourcesById.get(record.source_id);
                  if (!source) {
                    degradedReasons.add('file_index_orphan_source');
                    return null;
                  }
                  return fileResult(binding, query, record, source, latestRunFor(source.id), requestNow);
                })
                .filter((entry): entry is RankedSearchResult => Boolean(entry)),
            );
        candidateCapReached ||= candidates.capReached;
        rankedResults.push(...candidates.ranked);
        if (fileSources.length === 0) unknownReasons.add('file_index_health_unknown');
        for (const source of fileSources) {
          const run = latestRunFor(source.id);
          const lag = secondsSince(requestNow, source.last_synced_at);
          if (lag === null) unknownReasons.add('file_index_freshness_unknown');
          else {
            indexedTimes.push(Date.parse(source.last_synced_at as string));
            if (lag > SEARCH_INDEX_LAG_DEGRADED_SECONDS) degradedReasons.add('file_index_lag_degraded');
          }
          if (source.health !== 'ok' || run?.status === 'error') degradedReasons.add('file_index_source_degraded');
          if (!run) unknownReasons.add('file_index_run_unknown');
        }
        completed += 1;
      } catch {
        failed += 1;
        degradedReasons.add('file_index_unavailable');
      }
    }

    if (documentsRequested) {
      backendStates.push(backendHealth({
        name: 'documents',
        unavailableReason: 'documents_backend_unavailable',
        completed,
        failed,
        degradedReasons,
        unknownReasons,
        indexedTimes,
        now: requestNow,
      }));
    }

    const taskFilters: TaskProofSearchFilters = {
      teamId: filters.teamId,
      projectId: filters.projectId,
      state: filters.state,
      sensitivity: filters.sensitivity,
      worktype: filters.worktype,
      ownerId: filters.ownerId,
      assigneeId: filters.assigneeId,
      initiatorId: filters.initiatorId,
      reviewState: filters.reviewState,
      risk: filters.risk,
      from: filters.from,
      to: filters.to,
    };
    let requestTasks: TaskRecord[] | undefined;
    let taskLoadError: unknown;
    const loadTasks = (): TaskRecord[] => {
      if (requestTasks) return requestTasks;
      if (taskLoadError) throw taskLoadError;
      try {
        requestTasks = tasksForOrg(binding.orgId).listTasks();
        return requestTasks;
      } catch (error) {
        taskLoadError = error;
        throw error;
      }
    };

    if (filters.searchTasks) {
      const taskDegraded = new Set<string>();
      const taskUnknown = new Set<string>();
      let taskCompleted = 0;
      let taskFailed = 0;
      try {
        const matches = taskResults(binding, query, loadTasks(), taskFilters)
          .sort(compareRankedResults);
        if (matches.length > MAX_BACKEND_CANDIDATES) candidateCapReached = true;
        rankedResults.push(...matches.slice(0, MAX_BACKEND_CANDIDATES));
        taskCompleted = 1;
      } catch {
        taskFailed = 1;
      }
      backendStates.push(backendHealth({
        name: 'tasks',
        unavailableReason: 'tasks_backend_unavailable',
        completed: taskCompleted,
        failed: taskFailed,
        degradedReasons: taskDegraded,
        unknownReasons: taskUnknown,
        now: requestNow,
      }));
    }

    if (filters.searchProofs) {
      const proofDegraded = new Set<string>();
      const proofUnknown = new Set<string>();
      let proofCompleted = 0;
      let proofFailed = 0;
      try {
        const proofKinds: EvidenceArtifactKind[] = [];
        if (filters.objectTypes.includes('evidence_artifact')) {
          proofKinds.push(...EVIDENCE_ARTIFACT_KINDS.filter((kind) => kind !== 'raw_task_receipt'));
        }
        if (filters.objectTypes.includes('receipt')) proofKinds.push('raw_task_receipt');
        let originTasks: TaskRecord[] = [];
        let taskContextUnavailable = false;
        try {
          originTasks = loadTasks();
        } catch {
          taskContextUnavailable = true;
        }
        const originFilterPresent = Boolean(
          filters.teamId
          || filters.projectId
          || filters.sensitivity
          || filters.worktype
          || filters.ownerId
          || filters.assigneeId
          || filters.initiatorId
          || filters.reviewState
          || filters.risk,
        );
        const taskOnlyProofFilterPresent = Boolean(
          filters.worktype
          || filters.ownerId
          || filters.assigneeId
          || filters.initiatorId
          || filters.reviewState
          || filters.risk,
        );
        const matchingTaskIds = (originFilters: TaskProofSearchFilters) =>
          originTasks
            .filter((task) => taskMatchesProofOriginFilters(task, originFilters))
            .map((task) => task.id);
        const taskFilterOriginIds = taskOnlyProofFilterPresent
          ? matchingTaskIds({
              worktype: filters.worktype,
              ownerId: filters.ownerId,
              assigneeId: filters.assigneeId,
              initiatorId: filters.initiatorId,
              reviewState: filters.reviewState,
              risk: filters.risk,
            })
          : undefined;
        const teamOriginIds = filters.teamId
          ? matchingTaskIds({ teamId: filters.teamId })
          : undefined;
        const projectOriginIds = filters.projectId
          ? matchingTaskIds({ projectId: filters.projectId })
          : undefined;
        const sensitivityOriginIds = filters.sensitivity
          ? matchingTaskIds({ sensitivity: filters.sensitivity })
          : undefined;
        const queryOriginTaskIds = originTasks
          .filter((task) => taskTitleMatchesQuery(task, query))
          .map((task) => task.id);
        if (taskContextUnavailable && originFilterPresent) {
          proofUnknown.add('proof_origin_task_context_unknown');
        }
        const proofQuery = {
          org_id: binding.orgId,
          artifact_kinds: proofKinds,
          from: filters.from,
          to: filters.to,
          limit: MAX_BACKEND_CANDIDATES,
        };
        const proofRecords = artifacts().listArtifacts({
          ...proofQuery,
          query,
          query_origin_task_ids: queryOriginTaskIds,
          team_id: filters.teamId,
          project_id: filters.projectId,
          sensitivity: filters.sensitivity,
          availability_state: filters.state as EvidenceArtifactAvailabilityState | undefined,
          origin_task_ids: taskFilterOriginIds,
          team_origin_task_ids: teamOriginIds,
          project_origin_task_ids: projectOriginIds,
          sensitivity_origin_task_ids: sensitivityOriginIds,
          require_origin_task_match: taskOnlyProofFilterPresent,
        });
        const proofHealthRecords = artifacts().listArtifacts(proofQuery);
        if (proofHealthRecords.length >= MAX_BACKEND_CANDIDATES) {
          proofUnknown.add('proof_search_health_partial');
        }
        const tasksById = new Map(originTasks.map((task) => [task.id, task]));
        if (proofRecords.some((artifact) =>
          artifact.origin_task_id !== null && !tasksById.has(artifact.origin_task_id)
        )) {
          proofUnknown.add('proof_origin_task_context_unknown');
        }
        const normalizedProofResults = proofResults(
          binding,
          query,
          proofRecords,
          tasksById,
          taskFilters,
        );
        rankedResults.push(...normalizedProofResults);
        if (proofRecords.length >= MAX_BACKEND_CANDIDATES) {
          // This is the same hard backend scan bound used by document adapters.
          // The response marks truncation rather than scanning unbounded org data.
          candidateCapReached = true;
        }
        const healthVisibleIds = new Set(
          proofResults(binding, '', proofHealthRecords, tasksById, {})
            .filter((entry) => entry.result.permission.state === 'visible')
            .map((entry) => entry.result.objectId),
        );
        const observed = observeProofHealth(
          proofHealthRecords.filter((artifact) => healthVisibleIds.has(artifact.id)),
        );
        observed.degradedReasons.forEach((reason) => proofDegraded.add(reason));
        observed.unknownReasons.forEach((reason) => proofUnknown.add(reason));
        proofCompleted = 1;
      } catch {
        proofFailed = 1;
      }
      backendStates.push(backendHealth({
        name: 'proofs',
        unavailableReason: 'proofs_backend_unavailable',
        completed: proofCompleted,
        failed: proofFailed,
        degradedReasons: proofDegraded,
        unknownReasons: proofUnknown,
        now: requestNow,
      }));
    }

    const health = overallHealth(backendStates);
    const unique = new Map<string, RankedSearchResult>();
    for (const entry of rankedResults) {
      const key = `${entry.result.objectType}:${entry.result.objectId}`;
      if (!unique.has(key)) unique.set(key, entry);
    }
    const ordered = [...unique.values()].sort(compareRankedResults);
    const page = ordered.slice(filters.offset, filters.offset + filters.limit).map((entry) => entry.result);
    const nextOffset = filters.offset + page.length;
    const hasMore = nextOffset < ordered.length;
    const cursorWithinLimit = nextOffset <= MAX_CURSOR_OFFSET;
    const truncated = (hasMore && !cursorWithinLimit) || (candidateCapReached && !hasMore);
    const response = {
      version: 'entity.scoped-search.v1',
      query,
      scope: { orgId: binding.orgId, teamId: filters.teamId ?? null, projectId: filters.projectId ? String(filters.projectId) : null },
      filters: {
        objectTypes: filters.objectTypes,
        ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
        ...(filters.state ? { state: filters.state } : {}),
        ...(filters.sensitivity ? { sensitivity: filters.sensitivity } : {}),
        ...(filters.connectorState ? { connectorState: filters.connectorState } : {}),
        ...(filters.worktype ? { worktype: filters.worktype } : {}),
        ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
        ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
        ...(filters.initiatorId ? { initiatorId: filters.initiatorId } : {}),
        ...(filters.reviewState ? { reviewState: filters.reviewState } : {}),
        ...(filters.risk ? { risk: filters.risk } : {}),
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
      },
      searchState: {
        state: health.state,
        partial: health.partial,
        reasons: health.reasons,
        backends: backendStates.map(({ name, state, indexedAt, lagSeconds }) => ({
          name,
          state,
          indexedAt,
          lagSeconds,
        })),
      },
      count: page.length,
      nextCursor: hasMore && cursorWithinLimit ? encodeCursor(nextOffset) : null,
      pagination: {
        offset: filters.offset,
        limit: filters.limit,
        truncated,
        maxOffset: MAX_CURSOR_OFFSET,
      },
      results: page,
    };
    return res.status(health.state === 'failed' ? 503 : 200).json(response);
  });

  return router;
}
