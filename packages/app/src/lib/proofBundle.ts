/**
 * THE-863 / WP1-B-02 — ProofBundle normalization from existing output/evidence links.
 *
 * Pure contract for Workplane proof-bundle UI (THE-864). Consumes the same
 * task output / metadata / receipt fields TaskDetailPanel already surfaces.
 * Does not invent missing proof data or render a panel.
 */

import {
  deriveMissingEvidenceState,
  extractTaskOutputLinks,
  normalizeTaskOutputHref,
} from '../components/mission-control/taskDetailWorkplaneSeams.ts';

/** Stable display kinds for proof-bundle items (Q37 / WP1-B-03). */
export type ProofBundleItemKind = 'raw' | 'curated' | 'external' | 'unknown';

export type ProofBundleItemSource =
  | 'output_link'
  | 'evidence_link'
  | 'evidence_artifact'
  | 'output_artifact'
  | 'curated_artifact'
  | 'native_document'
  | 'external_document_ref'
  | 'receipt'
  | 'unknown';

/** One normalized proof/evidence item. Missing fields stay null — never invented. */
export interface ProofBundleItem {
  id: string;
  kind: ProofBundleItemKind;
  title: string;
  label: string | null;
  href: string | null;
  path: string | null;
  status: string | null;
  source: ProofBundleItemSource;
  artifactKind: string | null;
  external: boolean;
  meta: string | null;
}

/** First-class proof bundle view model for a task. Always a value (never null). */
export interface ProofBundle {
  taskId: number | null;
  items: ProofBundleItem[];
  empty: boolean;
  evidenceSummary: string | null;
  missingEvidence: boolean;
  missingEvidenceReason: string | null;
}

const RAW_ARTIFACT_KINDS = new Set([
  'raw_task_receipt',
  'review_packet',
  'output_receipt',
  'audit_trail',
  'raw_proof',
  'raw',
]);

const CURATED_ARTIFACT_KINDS = new Set([
  'curated_report',
  'rollup',
  'generated_summary',
  'curated',
  'native_document',
]);

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

function flattenLinkValues(...values: unknown[]): unknown[] {
  const out: unknown[] = [];
  const walk = (value: unknown) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    out.push(value);
  };
  values.forEach(walk);
  return out;
}

function isHttpHref(href: string | null | undefined): boolean {
  return Boolean(href && /^https?:\/\//i.test(href));
}

function classifyFromArtifactKind(artifactKind: string | null): ProofBundleItemKind | null {
  if (!artifactKind) return null;
  const normalized = artifactKind.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (RAW_ARTIFACT_KINDS.has(normalized) || normalized.includes('raw_task') || normalized.startsWith('raw_')) {
    return 'raw';
  }
  if (CURATED_ARTIFACT_KINDS.has(normalized) || normalized.includes('curated')) {
    return 'curated';
  }
  return null;
}

function classifyFromObjectType(objectType: string | null): ProofBundleItemKind | null {
  if (!objectType) return null;
  const normalized = objectType.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'external_document_ref' || normalized === 'external') return 'external';
  if (normalized === 'native_document' || normalized === 'native') return 'curated';
  if (normalized === 'evidence_artifact' || normalized === 'raw_proof') return null; // need artifact_kind / path
  return null;
}

function classifyFromHref(href: string | null): ProofBundleItemKind | null {
  if (!href) return null;
  if (isHttpHref(href)) return 'external';
  const normalized = href.replace(/\\/g, '/').toLowerCase();
  if (
    normalized.startsWith('/docs/output/') ||
    normalized.startsWith('output/') ||
    /\/clawd(?:-[^/]+)?\/output\//.test(normalized)
  ) {
    return 'raw';
  }
  if (
    normalized.startsWith('/docs/workspace/') ||
    normalized.startsWith('/docs/docs/') ||
    normalized.startsWith('/docs/notes/') ||
    /^(?:docs|notes)\//.test(normalized)
  ) {
    return 'curated';
  }
  if (normalized.startsWith('/docs/')) {
    return 'curated';
  }
  return null;
}

/**
 * Classify a proof item from available fields only.
 * Prefer explicit object/artifact kind, then URL/path shape, else unknown.
 */
export function classifyProofBundleItemKind(input: {
  href?: string | null;
  artifactKind?: string | null;
  objectType?: string | null;
  kindHint?: string | null;
  external?: boolean;
}): ProofBundleItemKind {
  if (input.external === true || isHttpHref(input.href ?? null)) {
    return 'external';
  }

  const fromHint = classifyFromArtifactKind(input.kindHint ?? null)
    ?? classifyFromObjectType(input.kindHint ?? null);
  if (fromHint) return fromHint;

  const fromObject = classifyFromObjectType(input.objectType ?? null);
  if (fromObject) return fromObject;

  const fromArtifact = classifyFromArtifactKind(input.artifactKind ?? null);
  if (fromArtifact) return fromArtifact;

  const fromHref = classifyFromHref(input.href ?? null);
  if (fromHref) return fromHref;

  return 'unknown';
}

function dedupeKey(item: Pick<ProofBundleItem, 'id' | 'href' | 'title' | 'kind' | 'source'>): string {
  const href = (item.href ?? '').trim().toLowerCase();
  if (href) return `href:${href}`;
  const id = item.id.trim().toLowerCase();
  if (id && !id.startsWith('anon:')) return `id:${id}`;
  return `title:${item.title.trim().toLowerCase()}|kind:${item.kind}|source:${item.source}`;
}

function stableItemId(parts: Array<string | null | undefined>, fallbackIndex = 0): string {
  const joined = parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(':');
  return joined || `anon:${fallbackIndex}`;
}

function itemFromLinkValue(
  value: unknown,
  source: ProofBundleItemSource,
  defaults: { kindHint?: string | null; meta?: string | null } = {},
  fallbackIndex = 0,
): ProofBundleItem | null {
  const record = toRecord(value);
  if (record) {
    const rawHref = readFirstString(
      record.href,
      record.url,
      record.path,
      record.stable_path,
      record.stablePath,
      record.human_path_alias,
      record.humanPathAlias,
      record.storage_path,
      record.storagePath,
      record.external_url,
      record.externalUrl,
    );
    const label = readFirstString(record.label, record.title, record.name, rawHref);
    const id = readFirstString(
      record.id,
      record.object_id,
      record.objectId,
      record.artifact_id,
      record.artifactId,
      rawHref,
      label,
    );
    if (!id && !label && !rawHref) {
      return null;
    }

    const href = rawHref ? normalizeTaskOutputHref(rawHref) ?? rawHref : null;
    const path = readFirstString(
      record.path,
      record.stable_path,
      record.stablePath,
      record.storage_path,
      record.storagePath,
      href && !isHttpHref(href) ? href : null,
    );
    const artifactKind = readFirstString(
      record.artifact_kind,
      record.artifactKind,
      record.kind,
      record.type,
      defaults.kindHint,
    );
    const objectType = readFirstString(record.object_type, record.objectType);
    const status = readFirstString(
      record.status,
      record.receipt_status,
      record.integrity_state,
      record.integrityState,
      record.availability_state,
      record.availabilityState,
    );
    const title = label ?? id ?? href!;
    const externalFlag = record.external === true || isHttpHref(href);
    const kind = classifyProofBundleItemKind({
      href,
      artifactKind,
      objectType,
      kindHint: defaults.kindHint ?? null,
      external: externalFlag,
    });

    return {
      id: stableItemId([source, id ?? href ?? title], fallbackIndex),
      kind,
      title,
      label: label ?? null,
      href,
      path,
      status,
      source,
      artifactKind,
      external: kind === 'external' || externalFlag,
      meta: defaults.meta ?? readFirstString(record.meta, record.kind, record.type, artifactKind),
    };
  }

  const text = readNonEmptyString(value);
  if (!text) return null;

  // Reject opaque non-link tokens with no path/url shape (malformed evidence ids alone stay unknown only if usable).
  const href = normalizeTaskOutputHref(text) ?? (/^(?:https?:\/\/|\/|[a-z0-9_.-]+\/)/i.test(text) ? text : null);
  if (!href && !text.includes('/') && !/^https?:\/\//i.test(text)) {
    // Bare token with no path — keep as unknown only when non-empty string evidence id-like.
    if (!/^[a-z0-9][a-z0-9._:-]{1,120}$/i.test(text)) {
      return null;
    }
  }

  const resolvedHref = href;
  const externalFlag = isHttpHref(resolvedHref);
  const kind = classifyProofBundleItemKind({
    href: resolvedHref,
    kindHint: defaults.kindHint ?? null,
    external: externalFlag,
  });

  return {
    id: stableItemId([source, resolvedHref ?? text], fallbackIndex),
    kind: resolvedHref ? kind : 'unknown',
    title: text,
    label: text,
    href: resolvedHref,
    path: resolvedHref && !isHttpHref(resolvedHref) ? resolvedHref : null,
    status: null,
    source,
    artifactKind: defaults.kindHint ?? null,
    external: externalFlag || kind === 'external',
    meta: defaults.meta ?? null,
  };
}

function emptyBundle(taskId: number | null = null): ProofBundle {
  return {
    taskId,
    items: [],
    empty: true,
    evidenceSummary: null,
    missingEvidence: false,
    missingEvidenceReason: null,
  };
}

/**
 * Normalize task detail / board payload into a ProofBundle.
 * Empty/missing/malformed inputs yield an explicit empty bundle (never null).
 */
export function normalizeProofBundle(raw: unknown): ProofBundle {
  if (raw == null) {
    return emptyBundle(null);
  }

  // Allow direct { taskId, items } / partial bundles for UI tests — still sanitize.
  const direct = toRecord(raw);
  if (direct && Array.isArray(direct.items) && !('name' in direct) && !('output' in direct) && !('column' in direct)) {
    return normalizeProofBundleFromParts({
      taskId: normalizePositiveInteger(direct.taskId ?? direct.task_id),
      output: '',
      metadata: parseJsonRecord(direct.metadata) ?? {},
      column: readNonEmptyString(direct.column) ?? 'backlog',
      preloadedItems: direct.items,
    });
  }

  const record = toRecord(raw);
  if (!record) {
    return emptyBundle(null);
  }

  const taskId = normalizePositiveInteger(record.id ?? record.taskId ?? record.task_id);
  const metadata = parseJsonRecord(record.metadata) ?? {};
  const output = readFirstString(record.output, metadata.output) ?? '';
  const column = readNonEmptyString(record.column) ?? 'backlog';

  return normalizeProofBundleFromParts({ taskId, output, metadata, column });
}

function normalizeProofBundleFromParts(input: {
  taskId: number | null;
  output: string;
  metadata: Record<string, unknown>;
  column: string;
  preloadedItems?: unknown[];
}): ProofBundle {
  const { taskId, output, metadata, column } = input;
  const receipt = firstRecord(metadata.phase2_receipt, metadata.receipt, metadata.receipt_artifact);
  const reviewPacket = firstRecord(metadata.review_packet, metadata.review_brief);
  const grouped = firstRecord(
    metadata.phase2_document_objects,
    metadata.document_objects,
    metadata.docs_files_artifacts,
    metadata.docsArtifacts,
  ) ?? {};

  const candidates: Array<{ value: unknown; source: ProofBundleItemSource; kindHint?: string | null; meta?: string | null }> = [];

  const receiptArtifactId = readFirstString(
    receipt?.artifact_id,
    receipt?.artifactId,
    metadata.receipt_artifact_id,
  );
  if (receiptArtifactId || receipt) {
    candidates.push({
      value: {
        id: receiptArtifactId ?? 'receipt',
        title: 'Canonical receipt',
        artifact_kind: readFirstString(receipt?.artifact_kind, receipt?.artifactKind) ?? 'raw_task_receipt',
        stable_path: readFirstString(
          receipt?.human_path_alias,
          receipt?.humanPathAlias,
          receipt?.stable_path,
          receipt?.stablePath,
        ),
        status: readFirstString(metadata.receipt_status, receipt?.receipt_status, receipt?.status),
        integrity_state: readFirstString(receipt?.integrity_state, receipt?.integrityState),
        availability_state: readFirstString(receipt?.availability_state, receipt?.availabilityState),
      },
      source: 'receipt',
      kindHint: 'raw_task_receipt',
      meta: 'receipt',
    });
  }

  for (const record of recordArrayFrom(metadata.evidence_artifacts ?? metadata.evidenceArtifacts ?? grouped.evidence_artifacts)) {
    candidates.push({ value: record, source: 'evidence_artifact' });
  }
  for (const record of recordArrayFrom(metadata.curated_artifacts ?? metadata.curatedArtifacts ?? grouped.curated_artifacts)) {
    candidates.push({ value: record, source: 'curated_artifact', kindHint: 'curated_report' });
  }
  for (const record of recordArrayFrom(metadata.native_documents ?? metadata.nativeDocuments ?? grouped.native_documents)) {
    candidates.push({ value: record, source: 'native_document', kindHint: 'native_document' });
  }
  for (const record of recordArrayFrom(
    metadata.external_document_refs ?? metadata.externalDocumentRefs ?? grouped.external_document_refs,
  )) {
    candidates.push({ value: record, source: 'external_document_ref', kindHint: 'external' });
  }

  for (const value of flattenLinkValues(
    metadata.evidence_links,
    reviewPacket?.evidence_links,
    reviewPacket?.evidenceLinks,
  )) {
    candidates.push({ value, source: 'evidence_link', meta: 'evidence' });
  }

  for (const value of flattenLinkValues(
    metadata.output_artifacts,
    metadata.output_artifact_ids,
    reviewPacket?.output_artifacts,
    reviewPacket?.output_artifact_ids,
  )) {
    candidates.push({ value, source: 'output_artifact', meta: 'output artifact' });
  }

  for (const link of extractTaskOutputLinks(output)) {
    candidates.push({
      value: {
        id: link.href,
        label: link.label,
        href: link.href,
        external: link.external,
      },
      source: 'output_link',
      meta: link.external ? 'external output' : 'Entity output',
    });
  }

  if (Array.isArray(input.preloadedItems)) {
    for (const value of input.preloadedItems) {
      candidates.push({ value, source: 'unknown' });
    }
  }

  const items: ProofBundleItem[] = [];
  const seen = new Set<string>();
  let anonIndex = 0;

  for (const candidate of candidates) {
    const item = itemFromLinkValue(
      candidate.value,
      candidate.source,
      {
        kindHint: candidate.kindHint,
        meta: candidate.meta,
      },
      anonIndex,
    );
    if (!item) continue;
    anonIndex += 1;
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  const outputLinkCount = items.filter((item) => item.source === 'output_link').length;
  const evidenceLinkCount = items.filter(
    (item) => item.source === 'evidence_link' || item.source === 'evidence_artifact' || item.source === 'output_artifact',
  ).length;

  const missing = deriveMissingEvidenceState({
    column,
    metadata,
    receipt,
    reviewPacket,
    evidenceLinkCount,
    outputLinkCount,
  });

  const evidenceSummary =
    readFirstString(metadata.evidence_summary, receipt?.evidence_summary, reviewPacket?.evidence_summary) ??
    (items.length > 0 ? missing.evidenceSummary : null);

  return {
    taskId,
    items,
    empty: items.length === 0,
    evidenceSummary: items.length === 0 && !evidenceSummary ? null : evidenceSummary ?? missing.evidenceSummary,
    missingEvidence: missing.missingEvidence,
    missingEvidenceReason: missing.missingEvidenceReason,
  };
}

/** Convenience: normalize then pick items of one kind (stable order preserved). */
export function proofBundleItemsOfKind(bundle: ProofBundle, kind: ProofBundleItemKind): ProofBundleItem[] {
  return bundle.items.filter((item) => item.kind === kind);
}
