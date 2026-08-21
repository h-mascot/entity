/**
 * T-018 (THE-959) — Google preview/open/permissions read-state derivation.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-009 "Google preview and open behavior":
 *       1. "Preview failure does not remove the provider open action."
 *       2. "Edit action opens the correct provider artifact."
 *       3. "UI never labels a preview as a full Entity-native editor."
 *   - §9.3 Permission summary: "Only values actually derivable from provider evidence may
 *     be displayed." (Private / Workspace-shared / Organization-shared / Link-shared /
 *     External sharing detected / Unknown.)
 *   - §9.4 Write-disabled state: "The UI must not tell the user the provider itself is
 *     read-only when only Entity's integration policy is read-only."
 *
 * This module is a PURE, UNWIRED library in the same style as the T-017 reconciler: every
 * input is injected (resolved CapabilityReport from the T-006 resolver vocabulary plus the
 * provider metadata projection from the T-012 unified read path). No default inputs, no
 * network, no credentials, no tenant data, no production wiring — a caller lane owns mounting.
 *
 * Honesty doctrine:
 *   - Preview folds through the capability-resolver vocabulary: only `supported`/`degraded`
 *     preview capabilities yield an available preview; `unsupported`/`unknown` fail closed.
 *   - A preview failure NEVER removes the provider open/edit affordance; only missing link
 *     evidence or a non-actionable `open_external` capability can do that (R-002 fail closed).
 *   - Open/edit URLs are derived strictly from provider-evidenced link fields in the metadata
 *     projection and are never minted from IDs (durable-identity doctrine, mirroring the
 *     Google adapters' typed-reject conventions).
 *   - Permission summaries map provider sharing evidence into the §9.3 vocabulary ONLY;
 *     unrecognized evidence collapses to `Unknown`, and detected external sharing is never
 *     downgraded to a less-exposed label.
 *   - §9.4: Entity-integration-policy write gating is framed as Entity's choice; the provider
 *     is blamed only when the provider itself evidences write protection.
 */

import type { CapabilityType, ResolvedCapability } from '../types';

/** §9.3 permission-summary vocabulary — the exact values the UI may display. */
export type GooglePermissionSummary =
  | 'Private'
  | 'Workspace-shared'
  | 'Organization-shared'
  | 'Link-shared'
  | 'External sharing detected'
  | 'Unknown';

export const GOOGLE_PERMISSION_SUMMARY_VALUES: readonly GooglePermissionSummary[] = [
  'Private',
  'Workspace-shared',
  'Organization-shared',
  'Link-shared',
  'External sharing detected',
  'Unknown',
];

/** Which authority gates writes — §9.4 requires these to stay distinguishable. */
export type GoogleWriteDisabledReason = 'entity-integration-policy' | 'provider';

export interface GoogleReadStateInput {
  /** Fully resolved capability report (T-006 resolver output vocabulary). */
  capabilityReport: Readonly<Record<CapabilityType, ResolvedCapability>>;
  /**
   * Provider metadata projection (T-012 unified read path shape). Only its link/sharing
   * evidence fields are consulted; nothing here is trusted as identity to mint URLs from.
   */
  providerMetadata: Readonly<Record<string, unknown>>;
  /**
   * Whether Entity's own integration policy permits writes for this connection. This is
   * ENTITY policy state, not provider state — §9.4 forbids conflating the two.
   */
  entityIntegrationWriteAllowed: boolean;
}

export interface GoogleReadState {
  previewAvailable: boolean;
  previewFailureReason: string | null;
  previewLabel: string;
  previewIsNativeEditor: false;
  openUrl: string | null;
  canOpen: boolean;
  editUrl: string | null;
  editLabel: 'Edit in Google';
  permissionSummary: GooglePermissionSummary;
  permissionSummaryDerivable: boolean;
  writeDisabled: boolean;
  writeDisabledReason: GoogleWriteDisabledReason | null;
  writeDisabledMessage: string | null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstString(record: Readonly<Record<string, unknown>>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return null;
}

/**
 * Provider-evidenced artifact link. Mirrors the app view-model's accepted link fields; a URL
 * is only ever surfaced when the provider metadata projection carries one — never minted.
 */
const LINK_EVIDENCE_KEYS = [
  'open_url',
  'openUrl',
  'external_canonical_url',
  'externalCanonicalUrl',
  'external_url',
  'externalUrl',
  'link',
  'url',
  'href',
] as const;

/**
 * Provider sharing-evidence tokens → §9.3 summary. Ordered so the MOST-exposed match wins:
 * external-sharing evidence can never be downgraded to a less-exposed label (§9.3 honesty).
 */
const SHARING_EVIDENCE_MAP: ReadonlyArray<{ tokens: ReadonlySet<string>; summary: GooglePermissionSummary }> = [
  { tokens: new Set(['external', 'external_sharing_detected', 'external_detected', 'anyone']), summary: 'External sharing detected' },
  { tokens: new Set(['link', 'link_shared', 'linkshared', 'anyone_with_link', 'anyonewithlink']), summary: 'Link-shared' },
  { tokens: new Set(['workspace', 'workspace_shared', 'team', 'shared_drive', 'shareddrive']), summary: 'Workspace-shared' },
  { tokens: new Set(['organization', 'organization_shared', 'org', 'domain', 'domain_link', 'domainlink']), summary: 'Organization-shared' },
  { tokens: new Set(['private', 'limited', 'restricted', 'specific_people']), summary: 'Private' },
];

const SHARING_EVIDENCE_KEYS = [
  'sharing_state',
  'sharingState',
  'visibility',
  'permission_summary_state',
  'permissionSummaryState',
] as const;

function normalizeEvidenceToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Map provider sharing evidence into the §9.3 vocabulary; unrecognized evidence → Unknown. */
function derivePermissionSummary(
  metadata: Readonly<Record<string, unknown>>
): { summary: GooglePermissionSummary; derivable: boolean } {
  // Most-exposed-wins across all evidence fields: collect every recognized token, then take
  // the highest exposure rank so external sharing is never silently mapped down.
  const tokens = new Set<string>();
  for (const key of SHARING_EVIDENCE_KEYS) {
    const raw = readString(metadata[key]);
    if (raw) tokens.add(normalizeEvidenceToken(raw));
  }
  let best: GooglePermissionSummary | null = null;
  for (const entry of SHARING_EVIDENCE_MAP) {
    if ([...tokens].some((token) => entry.tokens.has(token))) {
      best = entry.summary;
      break; // SHARING_EVIDENCE_MAP is ordered most-exposed first.
    }
  }
  if (best) return { summary: best, derivable: true };
  return { summary: 'Unknown', derivable: false };
}

function capabilityState(report: GoogleReadStateInput['capabilityReport'], name: CapabilityType): ResolvedCapability['state'] {
  const resolved = report[name];
  // Fail closed on malformed/partial injected reports (R-002 defense-in-depth).
  if (!resolved || resolved.name !== name) return 'unknown';
  return resolved.state;
}

/**
 * Derive the deterministic preview/open/permissions read state. Pure; throws on nothing,
 * fails closed on everything unknown (R-002), and never fabricates identity or exposure.
 */
export function deriveGoogleReadState(input: GoogleReadStateInput): GoogleReadState {
  const { capabilityReport, providerMetadata, entityIntegrationWriteAllowed } = input;

  const previewState = capabilityState(capabilityReport, 'preview');
  const openState = capabilityState(capabilityReport, 'open_external');
  const previewActionable = previewState === 'supported' || previewState === 'degraded';
  const openActionable = openState === 'supported' || openState === 'degraded';
  const previewFailureReason = previewActionable
    ? null
    : capabilityReport.preview?.reasonCode ?? `preview_capability_${previewState}`;

  // Provider-evidenced link only — never minted from external IDs (durable-identity doctrine).
  const evidencedUrl = firstString(providerMetadata, LINK_EVIDENCE_KEYS);
  // R-009 criterion 1: preview failure must NOT remove the provider open action. Only absent
  // link evidence or a non-actionable open_external capability suppresses open/edit.
  const openUrl = evidencedUrl && openActionable ? evidencedUrl : null;

  // §9.4: distinguish Entity integration policy gating from genuine provider write protection.
  const providerWriteProtected =
    providerMetadata.provider_write_protected === true ||
    providerMetadata.providerWriteProtected === true ||
    providerMetadata.write_protected === true;
  const writeDisabledReason: GoogleWriteDisabledReason | null = providerWriteProtected
    ? 'provider'
    : !entityIntegrationWriteAllowed
      ? 'entity-integration-policy'
      : null;
  const writeDisabledMessage = writeDisabledReason === 'provider'
    ? 'This Google artifact is read-only on the provider side. You can still preview it.'
    : writeDisabledReason === 'entity-integration-policy'
      ? 'Editing from Entity is disabled for this Google connection. You can still preview or open the document in Google.'
      : null;

  const { summary, derivable } = derivePermissionSummary(providerMetadata);

  return {
    previewAvailable: previewActionable,
    previewFailureReason,
    // R-009 criterion 3: the preview label can never read as an Entity-native editor.
    previewLabel: 'Provider preview — not an Entity-native editor',
    previewIsNativeEditor: false,
    openUrl,
    canOpen: Boolean(openUrl),
    editUrl: openUrl,
    editLabel: 'Edit in Google',
    permissionSummary: summary,
    permissionSummaryDerivable: derivable,
    writeDisabled: writeDisabledReason !== null,
    writeDisabledReason,
    writeDisabledMessage,
  };
}
