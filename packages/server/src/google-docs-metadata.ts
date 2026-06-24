import {
  GOOGLE_CONNECTOR_V1_SCOPES,
  type ExternalDocumentAuthState,
  type ExternalDocumentReadinessState,
  type ExternalDocumentRefRecord,
} from '../../db/src';

type GoogleMutationCapability = 'create' | 'update' | 'write' | 'export' | 'sync';

export interface GoogleExternalDocumentMetadata {
  id: string;
  connector_type: ExternalDocumentRefRecord['connector_type'];
  external_id: string | null;
  title: string;
  external_url: string | null;
  external_canonical_url: string | null;
  external_mime_type: string | null;
  auth_state: ExternalDocumentAuthState;
  readiness_state: ExternalDocumentReadinessState;
  effective_auth_state: ExternalDocumentAuthState;
  effective_readiness_state: ExternalDocumentReadinessState;
  degraded: boolean;
  degraded_reasons: string[];
  granted_scopes: string[];
  missing_scopes: string[];
  allowed_scopes: string[];
  capabilities: Record<string, boolean>;
  mutation_capabilities: Record<GoogleMutationCapability, false>;
  external_ref_state: ExternalDocumentRefRecord['external_ref_state'];
  external_permission_summary: string | null;
  last_indexed_at: string | null;
  last_checked_at: string | null;
  open_url: string | null;
}

export interface GoogleExternalDocumentOpen {
  target: 'external_google_doc';
  can_open: boolean;
  url: string | null;
  degraded: boolean;
  degraded_reasons: string[];
  effective_auth_state: ExternalDocumentAuthState;
  effective_readiness_state: ExternalDocumentReadinessState;
}

const MUTATION_CAPABILITIES: Record<GoogleMutationCapability, false> = {
  create: false,
  update: false,
  write: false,
  export: false,
  sync: false,
};

function parseCapabilities(value: string): Record<string, boolean> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, entry]) => typeof entry === 'boolean')
        .map(([key, entry]) => [key, Boolean(entry)])
    );
  } catch {
    return {};
  }
}

function isExpired(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt).getTime();
  return Number.isFinite(expires) && expires <= now.getTime();
}

function googleOpenUrl(record: ExternalDocumentRefRecord): string | null {
  return record.external_canonical_url || record.external_url;
}

export function buildGoogleExternalDocumentMetadata(
  record: ExternalDocumentRefRecord,
  now: Date = new Date()
): GoogleExternalDocumentMetadata {
  const expired = record.auth_state === 'expired' || isExpired(record.auth_expires_at, now);
  const insufficient = record.auth_state === 'insufficient_scope' || record.missing_scopes.length > 0;
  const unavailable = record.auth_state === 'revoked' || record.auth_state === 'unauthorized' || record.external_ref_state !== 'available';
  const degradedReasons = [
    expired ? 'auth_expired' : null,
    insufficient ? 'insufficient_scope' : null,
    unavailable ? `external_ref_${record.external_ref_state}` : null,
    record.readiness_state !== 'ready' && record.readiness_state !== 'unknown' ? `readiness_${record.readiness_state}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  const degraded = degradedReasons.length > 0;
  const capabilities = {
    read: true,
    index: true,
    link: true,
    preview: true,
    ...parseCapabilities(record.capabilities_json),
    ...MUTATION_CAPABILITIES,
  };

  return {
    id: record.id,
    connector_type: record.connector_type,
    external_id: record.external_id,
    title: record.title,
    external_url: record.external_url,
    external_canonical_url: record.external_canonical_url,
    external_mime_type: record.external_mime_type,
    auth_state: record.auth_state,
    readiness_state: record.readiness_state,
    effective_auth_state: expired ? 'expired' : record.auth_state,
    effective_readiness_state: degraded ? 'degraded' : record.readiness_state === 'ready' ? 'ready' : 'unknown',
    degraded,
    degraded_reasons: degradedReasons,
    granted_scopes: record.granted_scopes,
    missing_scopes: record.missing_scopes,
    allowed_scopes: [...GOOGLE_CONNECTOR_V1_SCOPES],
    capabilities,
    mutation_capabilities: MUTATION_CAPABILITIES,
    external_ref_state: record.external_ref_state,
    external_permission_summary: record.external_permission_summary,
    last_indexed_at: record.last_indexed_at,
    last_checked_at: record.last_checked_at,
    open_url: googleOpenUrl(record),
  };
}

export function buildGoogleExternalDocumentOpen(
  record: ExternalDocumentRefRecord,
  now: Date = new Date()
): GoogleExternalDocumentOpen {
  const metadata = buildGoogleExternalDocumentMetadata(record, now);
  return {
    target: 'external_google_doc',
    can_open: Boolean(metadata.open_url),
    url: metadata.open_url,
    degraded: metadata.degraded,
    degraded_reasons: metadata.degraded_reasons,
    effective_auth_state: metadata.effective_auth_state,
    effective_readiness_state: metadata.effective_readiness_state,
  };
}
