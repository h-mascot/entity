/**
 * T-024 — Microsoft read-state normalization.
 *
 * Pure provider-evidence projection: callers inject a sanitized Graph-like item and the
 * resolved capability report. This module performs no network I/O and never invents a URL,
 * permission, version, preview, or change token. Permissions are deliberately incomplete.
 */
import { capabilityAllowsActionForKey } from '../types';
import type { CapabilityReport } from '../types';
import type { DocumentArtifactType, DocumentPreviewState } from '../../../../db/src/document-integrations';

export type MicrosoftPermissionSummary =
  | 'Private'
  | 'Workspace-shared'
  | 'Organization-shared'
  | 'Link-shared'
  | 'External sharing detected'
  | 'Unknown';

export interface MicrosoftProviderItemEvidence {
  provider: 'microsoft_365';
  artifactType: DocumentArtifactType;
  externalId: string;
  webUrl?: string | null;
  sharedUrl?: string | null;
  lastModifiedDateTime?: string | null;
  eTag?: string | null;
  cTag?: string | null;
  versions?: readonly { id?: string | null; lastModifiedDateTime?: string | null; size?: number | null }[];
  permissions?: readonly { type?: string | null; scope?: string | null; roles?: readonly string[] }[];
  thumbnailUrl?: string | null;
  deltaLink?: string | null;
}

export interface MicrosoftVersionSummary {
  id: string;
  modifiedAt: string | null;
  size: number | null;
}

export interface MicrosoftPermissionResult {
  summary: MicrosoftPermissionSummary;
  /** Always false: this is a bounded summary, never a complete ACL. */
  complete: false;
  derivable: boolean;
  reasonCode: string;
}

export interface MicrosoftReadState {
  document: 'available' | 'unavailable';
  preview: DocumentPreviewState;
  previewUrl: string | null;
  previewUnavailable: boolean;
  openUrl: string | null;
  canOpen: boolean;
  versions: MicrosoftVersionSummary[];
  permissions: MicrosoftPermissionResult;
  changeToken: string | null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) ? value : null;
  } catch { return null; }
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function permissionSummary(item: MicrosoftProviderItemEvidence, readable: boolean): MicrosoftPermissionResult {
  if (!readable || !item.permissions) {
    return { summary: 'Unknown', complete: false, derivable: false, reasonCode: readable ? 'permissions_not_returned' : 'permission_read_unsupported' };
  }
  const tokens = item.permissions.flatMap((permission) => [permission.type, permission.scope, ...(permission.roles ?? [])]
    .filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase()));
  if (tokens.some((token) => token.includes('anonymous') || token.includes('external'))) return { summary: 'External sharing detected', complete: false, derivable: true, reasonCode: 'provider_evidence' };
  if (tokens.some((token) => token.includes('link'))) return { summary: 'Link-shared', complete: false, derivable: true, reasonCode: 'provider_evidence' };
  if (tokens.some((token) => token.includes('organization') || token.includes('company') || token.includes('domain'))) return { summary: 'Organization-shared', complete: false, derivable: true, reasonCode: 'provider_evidence' };
  if (tokens.some((token) => token.includes('group') || token.includes('workspace'))) return { summary: 'Workspace-shared', complete: false, derivable: true, reasonCode: 'provider_evidence' };
  if (tokens.some((token) => token.includes('private') || token.includes('user'))) return { summary: 'Private', complete: false, derivable: true, reasonCode: 'provider_evidence' };
  return { summary: 'Unknown', complete: false, derivable: false, reasonCode: 'permission_evidence_unrecognized' };
}

export function normalizeMicrosoftReadState(input: {
  capabilityReport: CapabilityReport;
  item: MicrosoftProviderItemEvidence;
}): MicrosoftReadState {
  const { capabilityReport, item } = input;
  const documentAvailable = Boolean(nonEmpty(item.externalId));
  const previewCapability = capabilityAllowsActionForKey(capabilityReport, 'preview');
  const previewUrl = previewCapability ? httpsUrl(item.thumbnailUrl) : null;
  const preview: DocumentPreviewState = !documentAvailable
    ? 'failed'
    : previewUrl ? 'ready'
      : capabilityReport.preview?.state === 'unsupported' ? 'unsupported' : 'failed';
  const openCapability = capabilityAllowsActionForKey(capabilityReport, 'open_external');
  const openUrl = documentAvailable && openCapability ? httpsUrl(item.sharedUrl) ?? httpsUrl(item.webUrl) : null;
  const versions = capabilityAllowsActionForKey(capabilityReport, 'version_history')
    ? (item.versions ?? []).flatMap((version) => {
      const id = nonEmpty(version.id); if (!id) return [];
      return [{ id, modifiedAt: nonEmpty(version.lastModifiedDateTime), size: typeof version.size === 'number' ? version.size : null }];
    }) : [];
  const readablePermissions = capabilityAllowsActionForKey(capabilityReport, 'permission_read');
  return {
    document: documentAvailable ? 'available' : 'unavailable',
    preview, previewUrl, previewUnavailable: documentAvailable && preview !== 'ready',
    openUrl, canOpen: Boolean(openUrl), versions,
    permissions: permissionSummary(item, readablePermissions),
    changeToken: capabilityAllowsActionForKey(capabilityReport, 'change_tracking') ? nonEmpty(item.deltaLink) : null,
  };
}
