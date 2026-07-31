/**
 * THE-856 / WP1-A-01 — TaskDetailPanel proof/review/output seams for Workplane reuse.
 *
 * These pure helpers are the extractable contracts currently embedded in
 * TaskDetailPanel. Workplane Slice 1 should reuse them (or their successors)
 * instead of re-parsing markdown links ad hoc. Do not treat this module as the
 * Workplane route; WP1-A-02+ owns URL/route/shell.
 */

import {
  REVIEW_DECISION_LABELS,
  buildReviewDecisionMetadata,
  normalizeReviewDecision,
  type ReviewDecision,
} from './reviewActions.ts';

export type ReceiptStatusTone = 'ok' | 'warning' | 'error' | 'muted';

export type WorkplanePanelId =
  | 'task_summary'
  | 'proof_bundle'
  | 'files_docs'
  | 'activity_progress'
  | 'comments_review_checklist'
  | 'missing_proof_warnings';

/** Q33 required Workplane panels → current TaskDetailPanel seam sources. */
export const WORKPLANE_PANEL_SEAM_MAP: Record<
  WorkplanePanelId,
  {
    panel: string;
    sourceSeams: string[];
    status: 'reusable_now' | 'partial' | 'missing';
    notes: string;
  }
> = {
  task_summary: {
    panel: 'Task summary',
    sourceSeams: [
      'workplaneTaskSummary.buildWorkplaneTaskSummary',
      'TaskSummaryPanel empty/loading/error/ready',
      'deriveMissingEvidenceState',
      'hasReviewMetadata',
    ],
    status: 'reusable_now',
    notes: 'THE-862: standalone Workplane TaskSummaryPanel with empty/loading/error/ready states.',
  },
  proof_bundle: {
    panel: 'Proof bundle',
    sourceSeams: [
      'proofBundle.normalizeProofBundle',
      'proofBundle.classifyProofBundleItemKind',
      'workplaneProofBundle.createWorkplaneProofBundleLoadState',
      'ProofBundlePanel raw/curated/external/unknown',
      'extractTaskOutputLinks',
      'normalizeTaskOutputHref',
      'deriveMissingEvidenceState',
      'buildReceiptProofView',
      'collectReceiptDisplayLinks',
      'receiptStatusTone',
    ],
    status: 'reusable_now',
    notes: 'THE-864: ProofBundlePanel renders normalizeProofBundle items with raw|curated|external|unknown kinds and fail-closed empty/error states.',
  },
  files_docs: {
    panel: 'Files/docs',
    sourceSeams: [
      'workplaneFilesDocs.normalizeWorkplaneFilesDocs',
      'workplaneFilesDocs.buildFilesDocsOpener',
      'FilesDocsPanel Doc Hub openers',
      'buildTaskDocumentObjectViews',
      'inferDocumentObjectKind',
      'isRestrictedDocumentObject',
      'normalizeTaskOutputHref',
      'extractTaskOutputLinks',
      'docHubRoute.buildDocHubRoutePath',
      'docHubRoute.resolveDocHubRouteTarget',
    ],
    status: 'reusable_now',
    notes:
      'THE-865: FilesDocsPanel renders task-linked docs/files with Doc Hub source openers; restricted/empty fail closed.',
  },
  activity_progress: {
    panel: 'Activity/progress',
    sourceSeams: ['normalizeActivity', 'TECHNICAL_ACTIVITY_TYPES', 'DetailTab activity/logs'],
    status: 'partial',
    notes: 'Activity exists but is not yet the minimal ActivityEvent spine (plan/progress/log/proof/status/blocker).',
  },
  comments_review_checklist: {
    panel: 'Comments/review checklist',
    sourceSeams: [
      'hasReviewMetadata',
      'reviewPacketSummary',
      'normalizeReviewDecision',
      'buildReviewDecisionMetadata',
      'saveReviewDecision',
      'human-gate actions',
    ],
    status: 'reusable_now',
    notes: 'Review write path already centralized in reviewActions.ts; detail panel still has a local metadata patch fallback.',
  },
  missing_proof_warnings: {
    panel: 'Missing-proof warnings',
    sourceSeams: [
      'workplaneMissingProof.buildMissingProofWarningView',
      'MissingProofWarningPanel',
      'proofBundle.normalizeProofBundle',
      'workplaneProofBundle.createWorkplaneProofBundleLoadState',
      'deriveMissingEvidenceState',
      'ReceiptProofView.degradedMessages',
      'doneWithoutReceipt',
    ],
    status: 'reusable_now',
    notes:
      'THE-866: MissingProofWarningPanel derives from ProofBundle load state; warns when proof is missing/unknown/unavailable and never claims review-ready.',
  },
};

/** Metadata keys consumed by proof/review/output seams. */
export const TASK_DETAIL_PROOF_METADATA_KEYS = {
  receipt: ['phase2_receipt', 'receipt', 'receipt_artifact', 'receipt_status', 'receipt_artifact_id', 'receipt_content_hash', 'receipt_error'],
  evidence: [
    'evidence_links',
    'evidence_artifacts',
    'evidence_summary',
    'missing_evidence',
    'missing_evidence_reason',
    'output_artifact_ids',
    'output_artifacts',
  ],
  review: [
    'review_decision',
    'review_type',
    'review_class',
    'reviewer',
    'review_owner',
    'reviewed_by',
    'reviewed_at',
    'review_note',
    'review_packet',
    'review_brief',
    'henry_required',
    'requires_henry',
    'human_gate_decision',
  ],
  documents: [
    'phase2_document_objects',
    'document_objects',
    'docs_files_artifacts',
    'docsArtifacts',
    'native_documents',
    'external_document_refs',
    'curated_artifacts',
    'document_artifacts',
  ],
} as const;

export type TaskOutputLink = {
  label: string;
  href: string;
  external: boolean;
};

export type MissingEvidenceState = {
  missingEvidence: boolean;
  missingEvidenceReason: string | null;
  evidenceSummary: string;
};

const TASK_OUTPUT_DOCUMENT_EXT = String.raw`(?:md|markdown|txt|log|json|jsonl|ya?ml|csv|tsv)`;
/** Shared matcher for output/proof link tokens in task output text. */
export const TASK_OUTPUT_LINK_PATTERN = new RegExp(
  String.raw`(?:https?:\/\/[^\s<>()]+|\/(?:docs|task|tasks)\/[^\s<>()]+|(?:docs|notes|output|memory|workspace|projects|zora|spock)\/[^\s<>()]+\.${TASK_OUTPUT_DOCUMENT_EXT}(?:[?#][^\s<>()]+)?|(?:~|\/(?:Users|home)\/[^\s<>()]+)\/clawd(?:-[^\/\s<>()]+)?\/(?:output|memory|projects|docs|notes|[^\s<>()]*\.md[^\s<>()]*))`,
  'g',
);

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return toRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return toRecord(value);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const next = readNonEmptyString(value);
    if (next) {
      return next;
    }
  }
  return null;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return false;
}

export function splitTaskOutputLinkToken(rawHref: string): { href: string; suffix: string } {
  const match = rawHref.match(/^(.*?)([,.;!]+)$/);
  if (!match) {
    return { href: rawHref, suffix: '' };
  }
  return { href: match[1] ?? rawHref, suffix: match[2] ?? '' };
}

/** Normalize task output / proof hrefs into Entity docs routes or absolute URLs. */
export function normalizeTaskOutputHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href) {
    return null;
  }

  const normalized = href.replace(/\\/g, '/');

  const entityDocsUrlMatch = normalized.match(/^https?:\/\/[^/\s<>()]+\/docs\/(output|memory|workspace|projects|zora|spock)\/(.+)$/i);
  if (entityDocsUrlMatch) {
    const [, root, rest] = entityDocsUrlMatch;
    return `/docs/${root.toLowerCase()}/${rest}`;
  }

  const legacyDocsUrlMatch = normalized.match(/^https?:\/\/[^\s<>()]+(?::(?:3000|8788))?\/(output|memory|workspace|projects|zora|spock)\/(.+)$/i);
  if (legacyDocsUrlMatch) {
    const [, root, rest] = legacyDocsUrlMatch;
    return `/docs/${root.toLowerCase()}/${rest}`;
  }

  const legacyWorkspaceUrlMatch = normalized.match(/^https?:\/\/[^\s<>()]+(?::(?:3000|8788))?\/(docs|notes)\/(.+)$/i);
  if (legacyWorkspaceUrlMatch) {
    const [, root, rest] = legacyWorkspaceUrlMatch;
    return `/docs/workspace/${root.toLowerCase()}/${rest}`;
  }

  if (/^https?:\/\//i.test(href)) {
    return href;
  }

  const taskMatch = normalized.match(/^\/(?:task|tasks)\/(\d+)(?:\/)?$/i);
  if (taskMatch) {
    return `/task/${taskMatch[1]}`;
  }

  if (normalized.startsWith('/docs/')) {
    const docsPath = normalized.slice('/docs/'.length);
    if (/^(?:docs|notes)\//i.test(docsPath)) {
      return `/docs/workspace/${docsPath}`;
    }
    return normalized;
  }

  if (/^(?:output|memory|workspace|projects|zora|spock)\//i.test(normalized)) {
    return `/docs/${normalized.replace(/^\/+/, '')}`;
  }

  if (/^(?:docs|notes)\//i.test(normalized)) {
    return `/docs/workspace/${normalized.replace(/^\/+/, '')}`;
  }

  const absoluteMatchers: Array<{ root: string; pattern: RegExp }> = [
    { root: 'output', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/output\/(.+)$/i },
    { root: 'memory', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/memory\/(.+)$/i },
    { root: 'projects', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/projects\/(.+)$/i },
    { root: 'zora', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd-zora\/output\/(.+)$/i },
    { root: 'spock', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd-spock\/output\/(.+)$/i },
    { root: 'workspace', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/(.+)$/i },
  ];

  for (const matcher of absoluteMatchers) {
    const match = normalized.match(matcher.pattern);
    if (match?.[1]) {
      return `/docs/${matcher.root}/${match[1].replace(/^\/+/, '')}`;
    }
  }

  return null;
}

/** Parse output markdown/text into durable output links for proof-bundle ingestion. */
export function extractTaskOutputLinks(text: string): TaskOutputLink[] {
  if (!text) {
    return [];
  }

  const links: TaskOutputLink[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(TASK_OUTPUT_LINK_PATTERN)) {
    const rawHref = match[0];
    const { href: linkText } = splitTaskOutputLinkToken(rawHref);
    const href = normalizeTaskOutputHref(linkText);
    if (!href || seen.has(href)) {
      continue;
    }

    seen.add(href);
    links.push({
      label: linkText,
      href,
      external: /^https?:\/\//i.test(href),
    });
  }

  return links;
}

/** Map receipt/integrity/availability into UI tone; fail closed toward error/warning. */
export function receiptStatusTone(
  status: string,
  integrityState: string,
  availabilityState: string,
): ReceiptStatusTone {
  const normalizedStatus = status.toLowerCase();
  const normalizedIntegrity = integrityState.toLowerCase();
  const normalizedAvailability = availabilityState.toLowerCase();
  if (
    normalizedStatus.includes('failed') ||
    normalizedStatus.includes('missing') ||
    normalizedStatus.includes('integrity') ||
    normalizedIntegrity !== 'valid' ||
    (normalizedAvailability !== 'available' && normalizedAvailability !== 'unknown')
  ) {
    return 'error';
  }

  if (normalizedStatus.includes('pending') || normalizedStatus.includes('unknown') || normalizedAvailability === 'unknown') {
    return 'warning';
  }

  if (normalizedStatus.includes('not required')) {
    return 'muted';
  }

  return 'ok';
}

export type DeriveMissingEvidenceInput = {
  column: string;
  metadata: Record<string, unknown>;
  receipt?: Record<string, unknown> | null;
  reviewPacket?: Record<string, unknown> | null;
  evidenceLinkCount: number;
  outputLinkCount: number;
};

/**
 * Explicit missing-evidence rule used by Receipt and Proof.
 * Done tasks with no evidence links, output links, or summary are missing evidence.
 */
export function deriveMissingEvidenceState(input: DeriveMissingEvidenceInput): MissingEvidenceState {
  const { metadata, receipt, reviewPacket, evidenceLinkCount, outputLinkCount, column } = input;
  const evidenceSummary =
    readFirstString(
      metadata.evidence_summary,
      receipt?.evidence_summary,
      reviewPacket?.evidence_summary,
      reviewPacket?.evidence,
      reviewPacket?.requested_outcome,
      outputLinkCount > 0 ? 'Output links are attached.' : null,
    ) ?? 'No evidence summary recorded.';
  const missingEvidenceReason = readFirstString(
    metadata.missing_evidence_reason,
    receipt?.missing_evidence_reason,
    reviewPacket?.missing_evidence_reason,
  );
  const missingEvidence =
    normalizeBoolean(metadata.missing_evidence ?? receipt?.missing_evidence) ||
    Boolean(missingEvidenceReason) ||
    (column === 'done' &&
      evidenceLinkCount === 0 &&
      outputLinkCount === 0 &&
      evidenceSummary === 'No evidence summary recorded.');

  return {
    missingEvidence,
    missingEvidenceReason,
    evidenceSummary,
  };
}

/** Whether review/gate metadata is present enough to surface a checklist panel. */
export function hasReviewMetadata(metadata: Record<string, unknown>): boolean {
  return Boolean(
    readFirstString(metadata.review_type, metadata.review_class) ||
      readFirstString(metadata.reviewer, metadata.review_owner) ||
      readFirstString(metadata.review_decision) ||
      normalizeBoolean(metadata.henry_required ?? metadata.requires_henry) ||
      parseJsonRecord(metadata.review_packet) ||
      parseJsonRecord(metadata.review_brief),
  );
}

export {
  REVIEW_DECISION_LABELS,
  buildReviewDecisionMetadata,
  normalizeReviewDecision,
};

export type { ReviewDecision };

/** Static characterization payload for proof receipts (no invented board data). */
export function characterizeTaskDetailWorkplaneSeams(sourceSha: string) {
  return {
    issue: 'THE-856',
    code: 'WP1-A-01',
    decision: 'CHARACTERIZED',
    workplaneRouteImplemented: false,
    inventedEngineeringBoardData: false,
    sourceFile: 'packages/app/src/components/mission-control/TaskDetailPanel.tsx',
    seamModule: 'packages/app/src/components/mission-control/taskDetailWorkplaneSeams.ts',
    reviewWriteSeam: 'packages/app/src/components/mission-control/reviewActions.ts',
    sourceSha,
    panels: WORKPLANE_PANEL_SEAM_MAP,
    metadataKeys: TASK_DETAIL_PROOF_METADATA_KEYS,
    reusableExports: [
      'normalizeTaskOutputHref',
      'extractTaskOutputLinks',
      'splitTaskOutputLinkToken',
      'receiptStatusTone',
      'deriveMissingEvidenceState',
      'hasReviewMetadata',
      'normalizeReviewDecision',
      'buildReviewDecisionMetadata',
      'WORKPLANE_PANEL_SEAM_MAP',
      'proofBundle.normalizeProofBundle',
      'proofBundle.classifyProofBundleItemKind',
      'workplaneProofBundle.createWorkplaneProofBundleLoadState',
      'ProofBundlePanel',
      'workplaneFilesDocs.normalizeWorkplaneFilesDocs',
      'workplaneFilesDocs.buildFilesDocsOpener',
      'FilesDocsPanel',
      'workplaneMissingProof.buildMissingProofWarningView',
      'MissingProofWarningPanel',
    ],
    stillEmbeddedInTaskDetailPanel: [
      'buildReceiptProofView',
      'buildTaskDocumentObjectViews',
      'buildDocumentObjectView',
      'collectReceiptDisplayLinks',
      'reviewPacketSummary',
      'saveReviewDecision / human-gate UI actions',
    ],
    openWorkplaneAction: {
      issue: 'THE-859',
      code: 'WP1-A-04',
      helper: 'packages/app/src/lib/openWorkplaneFromTaskDetail.ts',
      actionTestId: 'open-workplane-action',
    },
    nextIssues: {
      'WP1-A-02': 'Define Workplane URL state from these seams',
      'WP1-A-05': 'Preserve return-to-board/detail navigation from Open Workplane return context',
      'WP1-B-02': 'Normalize ProofBundle via packages/app/src/lib/proofBundle.ts',
      'WP1-B-03': 'Implement proof bundle panel consuming normalizeProofBundle',
      'WP1-B-04': 'Implement files/docs panel linked to Doc Hub openers',
      'WP1-B-05': 'MissingProofWarningPanel via workplaneMissingProof (THE-866)',
      'WP1-B-06': 'Lock layout: humans only',
      'WP1-C-05': 'Comments/review checklist panel',
    },
  };
}
