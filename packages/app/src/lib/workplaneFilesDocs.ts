/**
 * THE-865 / WP1-B-04 — Workplane files/docs panel load + Doc Hub opener helpers.
 *
 * Normalizes task-linked documents/files from existing task output/metadata
 * seams and links open actions to Doc Hub source routes (or external/docs
 * fallbacks). Fail-closed: never invents Engineering import data.
 */

import {
  extractTaskOutputLinks,
  normalizeTaskOutputHref,
} from '../components/mission-control/taskDetailWorkplaneSeams.ts';
import { buildDocHubRoutePath, resolveDocHubRouteTarget } from './docHubRoute.ts';
import { HttpRequestError, buildApiCandidates, requestJsonWithFallback, toErrorMessage } from './http.ts';

export type WorkplaneFilesDocsLoadStatus = 'empty' | 'loading' | 'error' | 'ready';

export type WorkplaneFilesDocsItemKind =
  | 'native'
  | 'external'
  | 'raw_proof'
  | 'curated'
  | 'file'
  | 'unknown';

export type WorkplaneFilesDocsItemSource =
  | 'native_document'
  | 'external_document_ref'
  | 'document_artifact'
  | 'curated_artifact'
  | 'output_link'
  | 'unknown';

export type WorkplaneFilesDocsOpenerKind = 'doc_hub' | 'docs_route' | 'external' | 'unavailable';

/** How the row should open — Doc Hub preferred when resolvable. */
export interface WorkplaneFilesDocsOpener {
  kind: WorkplaneFilesDocsOpenerKind;
  /** Action href when openable; null when unavailable. */
  href: string | null;
  sourceId: string | null;
  path: string | null;
  reason: string | null;
}

export interface WorkplaneFilesDocsItem {
  id: string;
  title: string;
  kind: WorkplaneFilesDocsItemKind;
  source: WorkplaneFilesDocsItemSource;
  /** Normalized raw href/path when known (may differ from opener.href). */
  href: string | null;
  opener: WorkplaneFilesDocsOpener;
  restricted: boolean;
  degradedMessages: string[];
}

export interface WorkplaneFilesDocsBundle {
  taskId: number | null;
  items: WorkplaneFilesDocsItem[];
  empty: boolean;
}

export interface WorkplaneFilesDocsLoadState {
  status: WorkplaneFilesDocsLoadStatus;
  taskId: number | null;
  bundle: WorkplaneFilesDocsBundle | null;
  errorMessage: string | null;
}

export const FILES_DOCS_KIND_ORDER: WorkplaneFilesDocsItemKind[] = [
  'native',
  'curated',
  'file',
  'raw_proof',
  'external',
  'unknown',
];

export const FILES_DOCS_KIND_LABELS: Record<WorkplaneFilesDocsItemKind, string> = {
  native: 'Native',
  curated: 'Curated',
  file: 'File',
  raw_proof: 'Raw proof',
  external: 'External',
  unknown: 'Unknown',
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') {
    return toRecord(value);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return toRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const next = readNonEmptyString(value);
    if (next) return next;
  }
  return null;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isInteger(n) && n >= 1 ? n : null;
  }
  return null;
}

function firstRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    const record = parseJsonRecord(value);
    if (record) return record;
  }
  return null;
}

function recordArrayFrom(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => parseJsonRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }
  const record = parseJsonRecord(value);
  if (!record) return [];
  if (Array.isArray(record.nodes)) {
    return record.nodes
      .map((entry) => parseJsonRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }
  return [record];
}

function isRestrictedDocumentObject(
  record: Record<string, unknown>,
  metadata: Record<string, unknown>,
): boolean {
  const permissionState = readFirstString(
    record.permission_state,
    record.permissionState,
    record.entity_permission_state,
    record.entityPermissionState,
    metadata.permission_state,
    metadata.permissionState,
    metadata.entity_permission_state,
    metadata.entityPermissionState,
    metadata.visibility_state,
  )?.toLowerCase();
  const policy = {
    ...(parseJsonRecord(record.entity_visibility_policy_json) ?? {}),
    ...(parseJsonRecord(record.entityVisibilityPolicyJson) ?? {}),
    ...(parseJsonRecord(record.entity_visibility_policy) ?? {}),
    ...(parseJsonRecord(record.entityVisibilityPolicy) ?? {}),
    ...(parseJsonRecord(metadata.entity_visibility_policy_json) ?? {}),
    ...(parseJsonRecord(metadata.entityVisibilityPolicyJson) ?? {}),
    ...(parseJsonRecord(metadata.entity_visibility_policy) ?? {}),
    ...(parseJsonRecord(metadata.entityVisibilityPolicy) ?? {}),
  };
  return (
    record.restricted === true ||
    record.placeholder === true ||
    metadata.restricted === true ||
    metadata.placeholder === true ||
    Boolean(permissionState && permissionState !== 'visible' && permissionState !== 'allowed') ||
    policy.restricted === true ||
    policy.allow_preview === false
  );
}

function inferKindFromRecord(
  record: Record<string, unknown>,
  hint: WorkplaneFilesDocsItemKind | 'evidence',
): WorkplaneFilesDocsItemKind {
  if (hint !== 'evidence') {
    return hint;
  }
  const objectType = readFirstString(
    record.object_type,
    record.objectType,
    record.kind,
    record.type,
  )?.toLowerCase();
  const artifactKind = readFirstString(record.artifact_kind, record.artifactKind)?.toLowerCase();
  if (objectType === 'native_document') return 'native';
  if (objectType === 'external_document_ref') return 'external';
  if (
    artifactKind === 'curated_report' ||
    artifactKind === 'rollup' ||
    artifactKind === 'generated_summary'
  ) {
    return 'curated';
  }
  if (
    artifactKind === 'raw_task_receipt' ||
    artifactKind === 'review_packet' ||
    artifactKind === 'output_receipt' ||
    artifactKind === 'audit_trail' ||
    artifactKind === 'raw_proof'
  ) {
    return 'raw_proof';
  }
  return 'unknown';
}

function titleFromHref(href: string): string {
  const cleaned = href.replace(/\\/g, '/').split(/[?#]/)[0] ?? href;
  const leaf = cleaned.split('/').filter(Boolean).pop();
  return leaf || href;
}

/**
 * Build a Doc Hub / document opener from a normalized href.
 * Prefer canonical `/docs/source/:sourceId/...` when resolvable.
 */
export function buildFilesDocsOpener(
  href: string | null | undefined,
  options: { restricted?: boolean; externalHint?: boolean } = {},
): WorkplaneFilesDocsOpener {
  if (options.restricted) {
    return {
      kind: 'unavailable',
      href: null,
      sourceId: null,
      path: null,
      reason: 'Restricted by Entity permissions. Snippets and previews are hidden.',
    };
  }

  const raw = readNonEmptyString(href);
  if (!raw) {
    return {
      kind: 'unavailable',
      href: null,
      sourceId: null,
      path: null,
      reason: 'No openable document link.',
    };
  }

  if (/^https?:\/\//i.test(raw) || options.externalHint) {
    if (/^https?:\/\//i.test(raw)) {
      return {
        kind: 'external',
        href: raw,
        sourceId: null,
        path: null,
        reason: null,
      };
    }
    return {
      kind: 'unavailable',
      href: null,
      sourceId: null,
      path: null,
      reason: 'External document ref has no openable URL.',
    };
  }

  const candidate = raw.startsWith('/') ? raw : `/${raw}`;
  const target = resolveDocHubRouteTarget(candidate);
  if (target) {
    return {
      kind: 'doc_hub',
      href: buildDocHubRoutePath(target),
      sourceId: target.sourceId,
      path: target.path,
      reason: null,
    };
  }

  if (candidate.startsWith('/docs/')) {
    return {
      kind: 'docs_route',
      href: candidate,
      sourceId: null,
      path: null,
      reason: null,
    };
  }

  return {
    kind: 'unavailable',
    href: null,
    sourceId: null,
    path: null,
    reason: 'No Doc Hub or document opener for this link.',
  };
}

function pushItem(
  items: WorkplaneFilesDocsItem[],
  seen: Set<string>,
  item: WorkplaneFilesDocsItem,
): void {
  const key = `${item.source}:${item.id}:${item.opener.href ?? item.href ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

function itemFromRecord(
  taskId: number,
  hint: WorkplaneFilesDocsItemKind | 'evidence',
  source: WorkplaneFilesDocsItemSource,
  record: Record<string, unknown>,
): WorkplaneFilesDocsItem | null {
  const metadata = parseJsonRecord(record.metadata_json ?? record.metadata) ?? {};
  const id = readFirstString(
    record.id,
    record.object_id,
    record.objectId,
    record.artifact_id,
    record.artifactId,
  );
  if (!id) return null;

  const restricted = isRestrictedDocumentObject(record, metadata);
  const kind = inferKindFromRecord(record, hint);
  const rawHref = readFirstString(
    record.external_url,
    record.externalUrl,
    record.external_canonical_url,
    record.externalCanonicalUrl,
    record.human_path_alias,
    record.humanPathAlias,
    record.stable_path,
    record.stablePath,
    record.storage_path,
    record.storagePath,
    record.path,
    record.href,
    record.url,
  );
  const normalizedHref =
    restricted || !rawHref ? null : normalizeTaskOutputHref(rawHref) ?? rawHref;
  const opener = buildFilesDocsOpener(normalizedHref, {
    restricted,
    externalHint: kind === 'external',
  });
  const rawTitle = readFirstString(record.title, record.name, record.label, metadata.title, id);
  const title = restricted ? 'Restricted object' : rawTitle ?? id;
  const degradedMessages = [
    restricted ? 'Restricted by Entity permissions. Snippets and previews are hidden.' : null,
    opener.kind === 'unavailable' && !restricted ? opener.reason : null,
  ].filter((entry): entry is string => Boolean(entry));

  return {
    id: `${taskId}:${source}:${id}`,
    title,
    kind,
    source,
    href: normalizedHref,
    opener,
    restricted,
    degradedMessages,
  };
}

/**
 * Normalize task-linked files/docs for the Workplane panel.
 * Uses DocumentObject metadata seams + docs-routable output links only.
 */
export function normalizeWorkplaneFilesDocs(input: unknown): WorkplaneFilesDocsBundle {
  const root = toRecord(input) ?? {};
  const taskId = normalizePositiveInteger(root.id ?? root.task_id ?? root.taskId);
  const metadata =
    parseJsonRecord(root.metadata) ??
    parseJsonRecord(root.metadata_json) ??
    parseJsonRecord(root.metadataJson) ??
    {};
  const grouped =
    firstRecord(
      metadata.phase2_document_objects,
      metadata.document_objects,
      metadata.docs_files_artifacts,
      metadata.docsArtifacts,
    ) ?? {};

  const items: WorkplaneFilesDocsItem[] = [];
  const seen = new Set<string>();

  const ingest = (
    hint: WorkplaneFilesDocsItemKind | 'evidence',
    source: WorkplaneFilesDocsItemSource,
    ...values: unknown[]
  ) => {
    if (taskId === null) return;
    for (const value of values) {
      for (const record of recordArrayFrom(value)) {
        const item = itemFromRecord(taskId, hint, source, record);
        if (item) pushItem(items, seen, item);
      }
    }
  };

  ingest(
    'native',
    'native_document',
    metadata.native_documents,
    metadata.nativeDocuments,
    grouped.native_documents,
    grouped.nativeDocuments,
  );
  ingest(
    'external',
    'external_document_ref',
    metadata.external_document_refs,
    metadata.externalDocumentRefs,
    grouped.external_document_refs,
    grouped.externalDocumentRefs,
  );
  ingest(
    'evidence',
    'document_artifact',
    metadata.document_artifacts,
    metadata.documentArtifacts,
    grouped.artifacts,
    grouped.objects,
    grouped.nodes,
  );
  ingest(
    'evidence',
    'curated_artifact',
    metadata.curated_artifacts,
    metadata.curatedArtifacts,
    grouped.curated_artifacts,
    grouped.curatedArtifacts,
  );

  // Docs-routable output links (Entity Files / Doc Hub paths), not generic HTTPS.
  const output = readNonEmptyString(root.output) ?? '';
  if (taskId !== null && output) {
    for (const link of extractTaskOutputLinks(output)) {
      if (link.external) continue;
      const href = link.href;
      if (!href.startsWith('/docs/') && !href.startsWith('/workspace/')) continue;
      const opener = buildFilesDocsOpener(href);
      if (opener.kind === 'unavailable') continue;
      const leaf = titleFromHref(href);
      pushItem(items, seen, {
        id: `${taskId}:output_link:${href}`,
        title: leaf,
        kind: opener.kind === 'doc_hub' ? 'file' : 'file',
        source: 'output_link',
        href,
        opener,
        restricted: false,
        degradedMessages: [],
      });
    }
  }

  return {
    taskId,
    items,
    empty: items.length === 0,
  };
}

export function countFilesDocsKinds(
  bundle: WorkplaneFilesDocsBundle | null | undefined,
): Record<WorkplaneFilesDocsItemKind, number> {
  const counts: Record<WorkplaneFilesDocsItemKind, number> = {
    native: 0,
    curated: 0,
    file: 0,
    raw_proof: 0,
    external: 0,
    unknown: 0,
  };
  if (!bundle) return counts;
  for (const item of bundle.items) {
    counts[item.kind] += 1;
  }
  return counts;
}

/** Explicit empty/loading/error/ready load envelope for the files/docs panel. */
export function createWorkplaneFilesDocsLoadState(
  input: {
    taskId?: number | null;
    status?: WorkplaneFilesDocsLoadStatus;
    bundle?: WorkplaneFilesDocsBundle | null;
    errorMessage?: string | null;
  } = {},
): WorkplaneFilesDocsLoadState {
  const taskId =
    typeof input.taskId === 'number' && Number.isInteger(input.taskId) && input.taskId >= 1
      ? input.taskId
      : null;

  if (input.status === 'loading') {
    return { status: 'loading', taskId, bundle: null, errorMessage: null };
  }

  if (input.status === 'error') {
    return {
      status: 'error',
      taskId,
      bundle: null,
      errorMessage: readNonEmptyString(input.errorMessage) ?? 'Unable to load files and docs.',
    };
  }

  if (input.status === 'ready' && input.bundle) {
    return {
      status: 'ready',
      taskId: input.bundle.taskId ?? taskId,
      bundle: input.bundle,
      errorMessage: null,
    };
  }

  return { status: 'empty', taskId, bundle: null, errorMessage: null };
}

/**
 * Fetch task detail and normalize into a files/docs bundle.
 * Returns null for missing task (404 / invalid payload) — caller maps to empty.
 * Throws for transport / server failures — caller maps to error.
 * Empty linked-docs on a valid task is still ready (bundle.empty === true).
 */
export async function fetchWorkplaneFilesDocs(
  taskId: number,
  apiBase = '',
): Promise<WorkplaneFilesDocsBundle | null> {
  if (!Number.isInteger(taskId) || taskId < 1) {
    return null;
  }

  try {
    const payload = await requestJsonWithFallback({
      urls: buildApiCandidates(`/tasks/${taskId}`, apiBase),
      init: { method: 'GET' },
      continueOnStatuses: [],
      fallbackError: 'Unable to load files and docs.',
    });
    const bundle = normalizeWorkplaneFilesDocs(payload);
    if (bundle.taskId === null) {
      return null;
    }
    return bundle;
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export function workplaneFilesDocsErrorMessage(error: unknown): string {
  return toErrorMessage(error, 'Unable to load files and docs.');
}
