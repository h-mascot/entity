/**
 * T-021 / THE-962 — Microsoft format capability spike.
 *
 * This is an evidence-backed catalogue, not a provider client.  It deliberately does not
 * call Graph, manufacture OOXML, or promote a capability into the product registry.  The
 * next Microsoft lanes must consume the dispositions here and retain the same fail-closed
 * boundary until a route, fixture, and tenant/licensing proof are available.
 */

import type { DocumentArtifactType } from '../../../../db/src/document-integrations';
import type { CapabilityState, CapabilityType } from '../types';

export type MicrosoftCapabilityEvidenceStatus = 'supported' | 'conditional' | 'unsupported' | 'unknown';

export interface MicrosoftCapabilityEvidence {
  capability: CapabilityType;
  artifactTypes: readonly DocumentArtifactType[];
  status: MicrosoftCapabilityEvidenceStatus;
  /** Product-facing resolver state. Conditional evidence is never enabled by this spike. */
  defaultState: CapabilityState;
  boundary: string;
  evidence: readonly string[];
  retrievalDate: '2026-08-22';
}

const GRAPH = 'https://learn.microsoft.com/en-us/graph';
const WOPI = 'https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/concepts';

/**
 * Current Microsoft Learn evidence, normalized to Entity's provider-neutral vocabulary.
 * `agent_*_mutation` is intentionally unsupported: storage/upload is not a format-aware
 * Word/Excel/PowerPoint document model, and this spike has no approved format engine.
 */
export const MICROSOFT_CAPABILITY_MATRIX: readonly MicrosoftCapabilityEvidence[] = [
  {
    capability: 'create',
    artifactTypes: ['document', 'spreadsheet', 'presentation'],
    status: 'conditional',
    defaultState: 'unknown',
    boundary: 'Graph can upload bytes; validity of a DOCX/XLSX/PPTX generator and open-in-Office proof remain T-022 responsibilities.',
    evidence: [
      `${GRAPH}/api/driveitem-put-content?view=graph-rest-1.0`,
      `${GRAPH}/api/driveitem-createuploadsession?view=graph-rest-1.0`,
    ],
    retrievalDate: '2026-08-22',
  },
  {
    capability: 'read',
    artifactTypes: ['document', 'spreadsheet', 'presentation'],
    status: 'conditional',
    defaultState: 'unknown',
    boundary: 'Requires the T-019 connection, tenant binding, destination policy, and an item-read route; this spike alone enables nothing.',
    evidence: [`${GRAPH}/api/resources/driveitem?view=graph-rest-1.0`],
    retrievalDate: '2026-08-22',
  },
  {
    capability: 'agent_text_mutation',
    artifactTypes: ['document'],
    status: 'unsupported',
    defaultState: 'unsupported',
    boundary: 'No Microsoft Graph route or approved format engine is evidenced here for structured Word mutation. Whole-file upload is not a substitute.',
    evidence: [`${GRAPH}/api/driveitem-put-content?view=graph-rest-1.0`],
    retrievalDate: '2026-08-22',
  },
  {
    capability: 'agent_range_mutation',
    artifactTypes: ['spreadsheet'],
    status: 'unsupported',
    defaultState: 'unsupported',
    boundary: 'No Excel workbook/range mutation route is evidenced here. Graph file storage does not establish workbook semantics.',
    evidence: [`${GRAPH}/api/driveitem-put-content?view=graph-rest-1.0`],
    retrievalDate: '2026-08-22',
  },
  {
    capability: 'agent_slide_mutation',
    artifactTypes: ['presentation'],
    status: 'unsupported',
    defaultState: 'unsupported',
    boundary: 'No PowerPoint slide mutation route or approved format engine is evidenced here. Uploading a PPTX is not slide editing.',
    evidence: [`${GRAPH}/api/driveitem-put-content?view=graph-rest-1.0`],
    retrievalDate: '2026-08-22',
  },
  {
    capability: 'version_history',
    artifactTypes: ['document', 'spreadsheet', 'presentation'],
    status: 'conditional',
    defaultState: 'unknown',
    boundary: 'Microsoft documentation describes a versions surface, but no adapter, connection, destination, runtime, or policy evidence exists in this spike; Entity must keep this non-actionable until those lanes are proven.',
    evidence: [`${GRAPH}/api/driveitem-list-versions?view=graph-rest-1.0`],
    retrievalDate: '2026-08-22',
  },
  {
    capability: 'change_tracking',
    artifactTypes: ['document', 'spreadsheet', 'presentation'],
    status: 'conditional',
    defaultState: 'unknown',
    boundary: 'Microsoft documentation describes a delta surface, but no adapter, connection, destination, runtime, or policy evidence exists in this spike; Entity must keep this non-actionable until those lanes are proven. It is not Word Track Changes or an author-level semantic diff.',
    evidence: [`${GRAPH}/api/driveitem-delta?view=graph-rest-1.0`],
    retrievalDate: '2026-08-22',
  },
  {
    capability: 'preview',
    artifactTypes: ['document', 'spreadsheet', 'presentation'],
    status: 'conditional',
    defaultState: 'unknown',
    boundary: 'Thumbnails are provider-generated previews where available; unavailable/unsupported must remain a typed state, never fabricated content.',
    evidence: [`${GRAPH}/api/driveitem-list-thumbnails?view=graph-rest-1.0`],
    retrievalDate: '2026-08-22',
  },
  {
    capability: 'open_external',
    artifactTypes: ['document', 'spreadsheet', 'presentation'],
    status: 'conditional',
    defaultState: 'unknown',
    boundary: 'A webUrl/open link may be exposed only after item metadata and permission checks; this is not embedded editing.',
    evidence: [`${GRAPH}/api/resources/driveitem?view=graph-rest-1.0`],
    retrievalDate: '2026-08-22',
  },
  {
    capability: 'embed_editor',
    artifactTypes: ['document', 'spreadsheet', 'presentation'],
    status: 'unknown',
    defaultState: 'unknown',
    boundary: 'WOPI technical eligibility, host requirements, commercial terms, and licensing are not established for Entity. Do not render an embedded editor.',
    evidence: [WOPI],
    retrievalDate: '2026-08-22',
  },
];

/** Capabilities not named by the matrix are unknown, never inferred from provider identity. */
export function microsoftCapabilityState(
  capability: CapabilityType,
  artifactType: DocumentArtifactType,
): CapabilityState {
  const evidence = MICROSOFT_CAPABILITY_MATRIX.find(
    (entry) => entry.capability === capability && entry.artifactTypes.includes(artifactType),
  );
  return evidence?.defaultState ?? 'unknown';
}

/**
 * The mutation gate used by future wiring. This spike has no runtime/product authorization lane,
 * so every current matrix mutation is rejected. A future adapter must provide independently
 * resolved capability evidence before a supported mutation disposition could pass.
 */
export function microsoftMutationAllowed(
  capability: Extract<CapabilityType, 'agent_text_mutation' | 'agent_range_mutation' | 'agent_slide_mutation'>,
  artifactType: DocumentArtifactType,
): boolean {
  return microsoftCapabilityState(capability, artifactType) === 'supported';
}

export const MICROSOFT_CAPABILITY_SPIKE_RULES = Object.freeze({
  unknownMutationFailsClosed: true,
  unknownEmbeddingFailsClosed: true,
  providerStorageIsNotFormatMutation: true,
  externalOpenDoesNotImplyEmbeddedEditor: true,
} as const);
