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
  externalPermissionSummary: string | null;
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

function readOpenUrl(record: Record<string, unknown>, metadata: Record<string, unknown>): string | null {
  return readFirstString(
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
  const externalPermissionSummary = readFirstString(
    metadata.external_permission_summary,
    metadata.externalPermissionSummary,
    record.external_permission_summary,
    record.externalPermissionSummary
  );

  const degradedMessages = [
    expired ? 'Google connector auth is expired; preview may require reconnecting Google.' : null,
    insufficient ? `Google connector scopes are insufficient${missingScopes.length > 0 ? `; missing ${missingScopes.join(', ')}` : ''}.` : null,
    readinessDegraded ? `Connector readiness is ${formatLabel(readinessState)}.` : null,
    externalRefUnavailable ? `External document state is ${formatLabel(externalRefState)}.` : null,
    ...degradedReasons.map((reason) => `Connector reported ${formatLabel(reason)}.`),
    !previewText ? 'No permitted preview snippet is available for this external document.' : null,
  ].filter((entry): entry is string => Boolean(entry));
  const openUrl = readOpenUrl(record, metadata);

  return {
    title: readFirstString(metadata.title, record.title, record.name) ?? 'Untitled external document',
    connectorLabel: formatLabel(connectorType),
    ownershipLabel: 'Externally owned Google Docs/Drive document',
    openUrl: externalRefUnavailable ? null : openUrl,
    canOpen: Boolean(openUrl && !externalRefUnavailable),
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
    degraded,
    degradedMessages,
    tone: degraded ? 'warning' : 'ok',
    readOnlyMessage: 'Read-only preview only. Entity does not edit, export, sync, or write Google Docs/Drive in V1.',
    mutationControlsVisible: false,
  };
}
