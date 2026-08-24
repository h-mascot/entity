export type ExternalDocumentPreviewTone = 'ok' | 'warning' | 'muted';

export interface ExternalDocumentPreviewView {
  title: string;
  connectorLabel: string;
  ownershipLabel: string;
  openUrl: string | null;
  canOpen: boolean;
  previewText: string | null;
  previewAvailable: boolean;
  authLabel: string;
  readinessLabel: string;
  scopeLabel: string;
  mimeLabel: string | null;
  /** §9.3-constrained permission summary — only vocabulary-derivable values, else null (Unknown). */
  externalPermissionSummary: string | null;
  /** Whether the summary was actually derivable from provider sharing evidence (§9.3 honesty). */
  externalPermissionSummaryKnown: boolean;
  /** Provider-evidenced artifact URL for the "Edit in Google" action (never minted). */
  editUrl: string | null;
  editLabel: 'Edit in Google';
  /** R-009: preview is never an Entity-native editor. */
  previewLabel: string;
  previewIsNativeEditor: false;
  /** §9.4: which authority gates writes — Entity integration policy vs the provider itself. */
  writeDisabledSource: 'entity-integration-policy' | 'provider' | null;
  writeDisabledMessage: string;
  degraded: boolean;
  degradedMessages: string[];
  tone: ExternalDocumentPreviewTone;
  readOnlyMessage: string;
  mutationControlsVisible: false;
}

const MUTATION_KEYS = new Set(['create', 'update', 'write', 'export', 'sync']);
const GOOGLE_CONNECTORS = new Set(['google_docs', 'google_drive']);

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) {
    return readRecord(value);
  }

  try {
    return readRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
}

function readFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return null;
}

function formatLabel(value: string | null, fallback = 'Unknown'): string {
  if (!value) return fallback;
  return value.replace(/[_-]+/g, ' ');
}

function isExpired(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt).getTime();
  return Number.isFinite(expires) && expires <= now.getTime();
}

function readCapabilities(record: Record<string, unknown>, metadata: Record<string, unknown>): Record<string, boolean> {
  const raw = readRecord(metadata.capabilities) ?? readRecord(record.capabilities);
  return Object.fromEntries(
    Object.entries(raw ?? {})
      .filter(([, value]) => typeof value === 'boolean')
      .filter(([key]) => !MUTATION_KEYS.has(key))
      .map(([key, value]) => [key, Boolean(value)])
  );
}

function readPreviewText(record: Record<string, unknown>, metadata: Record<string, unknown>): string | null {
  return readFirstString(
    metadata.snippet,
    metadata.preview,
    metadata.preview_text,
    metadata.previewText,
    record.snippet,
    record.preview,
    record.preview_text,
    record.previewText
  );
}

/**
 * Provider-evidenced URLs must be well-formed https:// links (S3/F1 hardening). Metadata is
 * body-populatable, so `javascript:`/`data:`/http/relative/garbage strings fail closed to
 * null rather than riding through to a clickable link target. Mirrors the server's
 * google/read-state.ts `wellFormedHttpsUrl`. No throw — derivation stays pure.
 */
function wellFormedHttpsUrl(value: string): string | null {
  if (!/^https:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname ? value : null;
  } catch {
    return null;
  }
}

function readOpenUrl(record: Record<string, unknown>, metadata: Record<string, unknown>): string | null {
  const candidate = readFirstString(
    metadata.open_url,
    metadata.openUrl,
    record.open_url,
    record.openUrl,
    record.external_canonical_url,
    record.externalCanonicalUrl,
    record.external_url,
    record.externalUrl,
    record.href,
    record.url
  );
  // F1: validate BEFORE any consumer (openUrl AND editUrl derive from this value) — only a
  // well-formed absolute https:// URL survives.
  return candidate ? wellFormedHttpsUrl(candidate) : null;
}

function readPreviewPolicy(record: Record<string, unknown>, metadata: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(readJsonRecord(record.entity_visibility_policy_json) ?? {}),
    ...(readJsonRecord(record.entityVisibilityPolicyJson) ?? {}),
    ...(readJsonRecord(record.entity_visibility_policy) ?? {}),
    ...(readJsonRecord(record.entityVisibilityPolicy) ?? {}),
    ...(readJsonRecord(metadata.entity_visibility_policy_json) ?? {}),
    ...(readJsonRecord(metadata.entityVisibilityPolicyJson) ?? {}),
    ...(readJsonRecord(metadata.entity_visibility_policy) ?? {}),
    ...(readJsonRecord(metadata.entityVisibilityPolicy) ?? {}),
  };
}

/**
 * §9.3 permission-summary honesty: map provider sharing evidence into the exact displayable
 * vocabulary; anything not derivable from provider evidence collapses to null (Unknown).
 * External-sharing evidence is never downgraded to a less-exposed label.
 *
 * The token sets are exported and pinned identically on the server side
 * (google/read-state.ts `GOOGLE_SHARING_EVIDENCE_TOKENS_BY_SUMMARY`) so the two independent
 * derivations cannot drift (S2 parity).
 */
/** Local mirror of the server's §9.3 vocabulary union (no cross-package import). */
type GooglePermissionSummary =
  | 'Private'
  | 'Workspace-shared'
  | 'Organization-shared'
  | 'Link-shared'
  | 'External sharing detected'
  | 'Unknown';

export const PERMISSION_SUMMARY_EVIDENCE_TOKENS_BY_SUMMARY: Readonly<Record<GooglePermissionSummary, readonly string[]>> = {
  'External sharing detected': ['external', 'external_sharing_detected', 'external_detected', 'anyone'],
  'Link-shared': ['link', 'link_shared', 'linkshared', 'anyone_with_link', 'anyonewithlink'],
  'Workspace-shared': ['workspace', 'workspace_shared', 'team', 'shared_drive', 'shareddrive'],
  'Organization-shared': ['organization', 'organization_shared', 'org', 'domain', 'domain_link', 'domainlink'],
  Private: ['private', 'limited', 'restricted', 'specific_people'],
  Unknown: [],
};
/** Ordered most-exposed first so external-sharing evidence is never mapped down (§9.3). */
const PERMISSION_SUMMARY_EVIDENCE_MAP: ReadonlyArray<{ tokens: ReadonlySet<string>; summary: string }> = (
  ['External sharing detected', 'Link-shared', 'Workspace-shared', 'Organization-shared', 'Private'] as const
).map((summary) => ({
  tokens: new Set(PERMISSION_SUMMARY_EVIDENCE_TOKENS_BY_SUMMARY[summary] ?? []),
  summary,
}));
const PERMISSION_SUMMARY_EVIDENCE_KEYS = ['sharing_state', 'sharingState', 'visibility', 'permission_summary_state', 'permissionSummaryState'] as const;

function deriveExternalPermissionSummary(record: Record<string, unknown>, metadata: Record<string, unknown>): { summary: string | null; known: boolean } {
  const tokens = new Set<string>();
  for (const source of [record, metadata]) {
    for (const key of PERMISSION_SUMMARY_EVIDENCE_KEYS) {
      const value = readString(source[key]);
      if (value) tokens.add(value.trim().toLowerCase().replace(/[\s-]+/g, '_'));
    }
  }
  for (const entry of PERMISSION_SUMMARY_EVIDENCE_MAP) {
    if ([...tokens].some((token) => entry.tokens.has(token))) {
      return { summary: entry.summary, known: true };
    }
  }
  // Raw free-text summaries are NOT derivable provider evidence in the §9.3 vocabulary —
  // collapse them instead of displaying arbitrary strings.
  return { summary: null, known: false };
}

function previewRestricted(record: Record<string, unknown>, metadata: Record<string, unknown>): boolean {
  const permissionState = readFirstString(
    record.permission_state,
    record.permissionState,
    record.entity_permission_state,
    record.entityPermissionState,
    metadata.permission_state,
    metadata.permissionState,
    metadata.entity_permission_state,
    metadata.entityPermissionState
  )?.toLowerCase();
  const policy = readPreviewPolicy(record, metadata);
  return record.restricted === true ||
    record.placeholder === true ||
    metadata.restricted === true ||
    metadata.placeholder === true ||
    Boolean(permissionState && permissionState !== 'visible' && permissionState !== 'allowed') ||
    policy.restricted === true ||
    policy.allow_preview === false;
}

export function buildExternalDocumentPreviewView(
  record: Record<string, unknown>,
  now: Date = new Date()
): ExternalDocumentPreviewView | null {
  const metadata = readRecord(record.metadata) ?? readRecord(record.google_metadata) ?? {};
  const connectorType = readFirstString(record.connector_type, record.connectorType, metadata.connector_type, metadata.connectorType);
  if (!connectorType || !GOOGLE_CONNECTORS.has(connectorType)) {
    return null;
  }

  const restricted = previewRestricted(record, metadata);
  if (restricted) {
    return {
      title: 'Restricted external document',
      connectorLabel: formatLabel(connectorType),
      ownershipLabel: 'Externally owned Google Docs/Drive document',
      openUrl: null,
      canOpen: false,
      previewText: null,
      previewAvailable: false,
      authLabel: 'restricted',
      readinessLabel: 'restricted',
      scopeLabel: 'Entity preview restricted',
      mimeLabel: null,
      externalPermissionSummary: null,
      externalPermissionSummaryKnown: false,
      editUrl: null,
      editLabel: 'Edit in Google',
      previewLabel: 'Provider preview unavailable — not an Entity-native editor',
      previewIsNativeEditor: false,
      writeDisabledSource: 'entity-integration-policy',
      // B1a honesty: this object suppresses preview AND open — the message must not claim either.
      writeDisabledMessage: 'Editing from Entity is disabled for this Google connection, and Entity permissions restrict this document, so no preview or open action is available here.',
      degraded: true,
      degradedMessages: ['Restricted by Entity permissions. Snippets and previews are hidden.'],
      tone: 'warning',
      readOnlyMessage: 'Read-only preview only. Entity does not edit, export, sync, or write Google Docs/Drive in V1.',
      mutationControlsVisible: false,
    };
  }

  const effectiveAuthState = readFirstString(
    metadata.effective_auth_state,
    metadata.effectiveAuthState,
    record.effective_auth_state,
    record.effectiveAuthState,
    record.auth_state,
    record.authState,
    'unknown'
  );
  const expired = effectiveAuthState === 'expired' || isExpired(readFirstString(record.auth_expires_at, record.authExpiresAt), now);
  const missingScopes = [
    ...readStringList(metadata.missing_scopes),
    ...readStringList(record.missing_scopes),
    ...readStringList(record.missingScopes),
  ];
  const grantedScopes = [
    ...readStringList(metadata.granted_scopes),
    ...readStringList(record.granted_scopes),
    ...readStringList(record.grantedScopes),
  ];
  const capabilities = readCapabilities(record, metadata);
  const previewScopeMissing = missingScopes.includes('preview') || (grantedScopes.length > 0 && !grantedScopes.includes('preview'));
  const insufficient = effectiveAuthState === 'insufficient_scope' || missingScopes.length > 0 || previewScopeMissing;
  const readinessState = readFirstString(
    metadata.effective_readiness_state,
    metadata.effectiveReadinessState,
    record.effective_readiness_state,
    record.effectiveReadinessState,
    record.readiness_state,
    record.readinessState,
    'unknown'
  );
  const degradedReasons = [
    ...readStringList(metadata.degraded_reasons),
    ...readStringList(record.degraded_reasons),
    ...readStringList(record.degradedReasons),
  ];
  const connectorDegraded = metadata.degraded === true || record.degraded === true;
  const readinessDegraded = Boolean(readinessState && !['ready', 'live', 'unknown'].includes(readinessState));
  const externalRefState = readFirstString(
    metadata.external_ref_state,
    metadata.externalRefState,
    record.external_ref_state,
    record.externalRefState,
    'unknown'
  );
  const externalRefUnavailable = Boolean(externalRefState && !['available', 'unknown'].includes(externalRefState));
  const degraded = connectorDegraded || expired || insufficient || readinessDegraded || externalRefUnavailable || degradedReasons.length > 0;
  const previewText = readPreviewText(record, metadata);
  const previewAvailable = Boolean(previewText && !expired && !insufficient && !externalRefUnavailable);
  // §9.3 honesty: only provider-evidence-derived vocabulary values may be displayed; raw
  // free-text `external_permission_summary` strings are collapsed rather than shown verbatim.
  const { summary: externalPermissionSummary, known: externalPermissionSummaryKnown } = deriveExternalPermissionSummary(record, metadata);
  const openUrl = readOpenUrl(record, metadata);
  // R-009.2 masking symmetry: a deleted/permission-revoked external ref suppresses open AND edit.
  const maskedOpenUrl = externalRefUnavailable ? null : openUrl;
  const canOpen = Boolean(maskedOpenUrl);
  // §9.4: distinguish Entity integration policy gating from genuine provider write protection.
  const providerWriteProtected = metadata.provider_write_protected === true || metadata.providerWriteProtected === true || record.provider_write_protected === true || metadata.write_protected === true;
  const writeDisabledSource: 'entity-integration-policy' | 'provider' = providerWriteProtected ? 'provider' : 'entity-integration-policy';
  // B1b honesty: each message may only claim affordances this same view object carries —
  // never "you can still preview" when previewAvailable is false in this same object.
  // F2 honesty (deny direction): each message may only claim affordances this same view
// object carries — claim preview only if actually available, else open, else say nothing
// further is available. Never deny an affordance canOpen carries.
const writeDisabledMessage = providerWriteProtected
    ? previewAvailable
      ? 'This Google artifact is read-only on the provider side. You can still preview it.'
      : canOpen
        ? 'This Google artifact is read-only on the provider side. You can still open the document in Google.'
        : 'This Google artifact is read-only on the provider side, and no further actions are available for it here.'
    : canOpen
      ? 'Editing from Entity is disabled for this Google connection. You can still open the document in Google.'
      : 'Editing from Entity is disabled for this Google connection.';

  const degradedMessages = [
    expired ? 'Google connector auth is expired; preview may require reconnecting Google.' : null,
    insufficient ? `Google connector scopes are insufficient${missingScopes.length > 0 ? `; missing ${missingScopes.join(', ')}` : ''}.` : null,
    readinessDegraded ? `Connector readiness is ${formatLabel(readinessState)}.` : null,
    externalRefUnavailable ? `External document state is ${formatLabel(externalRefState)}.` : null,
    ...degradedReasons.map((reason) => `Connector reported ${formatLabel(reason)}.`),
    !previewText ? 'No permitted preview snippet is available for this external document.' : null,
  ].filter((entry): entry is string => Boolean(entry));

  return {
    title: readFirstString(metadata.title, record.title, record.name) ?? 'Untitled external document',
    connectorLabel: formatLabel(connectorType),
    ownershipLabel: 'Externally owned Google Docs/Drive document',
    openUrl: maskedOpenUrl,
    canOpen,
    previewText: previewAvailable ? previewText : null,
    previewAvailable,
    authLabel: formatLabel(expired ? 'expired' : effectiveAuthState),
    readinessLabel: formatLabel(degraded ? 'degraded' : readinessState),
    scopeLabel: missingScopes.length > 0
      ? `Missing ${missingScopes.join(', ')}`
      : grantedScopes.length > 0
        ? `Granted ${grantedScopes.join(', ')}`
        : capabilities.preview === false
          ? 'Preview scope unavailable'
          : 'Read/index/link/preview only',
    mimeLabel: readFirstString(metadata.external_mime_type, metadata.externalMimeType, record.external_mime_type, record.externalMimeType),
    externalPermissionSummary,
    externalPermissionSummaryKnown,
    editUrl: maskedOpenUrl,
    editLabel: 'Edit in Google',
    previewLabel: previewAvailable
      ? 'Provider preview — not an Entity-native editor'
      : 'Provider preview unavailable — not an Entity-native editor',
    previewIsNativeEditor: false,
    writeDisabledSource,
    writeDisabledMessage,
    degraded,
    degradedMessages,
    tone: degraded ? 'warning' : 'ok',
    readOnlyMessage: 'Read-only preview only. Entity does not edit, export, sync, or write Google Docs/Drive in V1.',
    mutationControlsVisible: false,
  };
}
