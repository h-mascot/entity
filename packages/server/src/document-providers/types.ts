/**
 * Provider-neutral document capability vocabulary and state semantics.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - D-003: "All provider-specific behavior is exposed through negotiated capabilities."
 *   - R-002: "Provider-neutral capability negotiation" (minimum vocabulary, CapabilityState,
 *     ResolvedCapability, unknown-fails-closed for mutation and embedding).
 * Design decision recorded in docs/adr/2026-08-entity-document-capability-architecture.md (T-002).
 *
 * Invariant: a provider kind (google_workspace / microsoft_365 / local_office) MUST NOT by
 * itself imply a capability. UI, agents, and routes negotiate capabilities from runtime
 * evidence (adapter + connection + destination + runtime + policy) rather than inferring
 * capability from the provider name.
 */

/** Canonical provider families (D-002 / D-003). Provider type never implies capability. */
export type ProviderKind = 'google_workspace' | 'microsoft_365' | 'local_office';

/** R-002 minimum capability vocabulary. */
export type CapabilityType =
  | 'create'
  | 'read'
  | 'preview'
  | 'thumbnail'
  | 'open_external'
  | 'human_edit'
  | 'agent_text_mutation'
  | 'agent_range_mutation'
  | 'agent_slide_mutation'
  | 'version_history'
  | 'change_tracking'
  | 'permission_read'
  | 'permission_write'
  | 'embed_editor'
  | 'export';

/** R-002 capability state semantics. */
export type CapabilityState = 'supported' | 'unsupported' | 'degraded' | 'unknown';

/**
 * Origin of the resolved state. Precedence (lowest to highest) is used by the Capability
 * Resolver so a degraded connection cannot be papered over by an optimistic adapter, and a
 * policy veto cannot be overridden by runtime evidence. See the capability ADR.
 */
export type CapabilitySource =
  | 'adapter'
  | 'connection'
  | 'destination'
  | 'runtime'
  | 'policy';

/** R-002 ResolvedCapability shape. */
export interface ResolvedCapability {
  name: CapabilityType;
  state: CapabilityState;
  reasonCode?: string;
  reason?: string;
  source: CapabilitySource;
}

/** Complete negotiated capability set for one provider destination/connection context. */
export type CapabilityReport = {
  [K in CapabilityType]: ResolvedCapability & { name: K };
};

/**
 * Resolve actionability for a capability key from a report.
 *
 * Defense-in-depth on top of the dependent `CapabilityReport` type: if a report is built from
 * untrusted/untyped adapter data (bypassing the compile-time binding), this rejects any value
 * whose `name` does not equal the requested key. A caller can therefore never enable a write
 * by looking up `report.create` and having a mismatched read-like value fall through as a
 * degraded actionable capability (THE-943 / R-002 fail-closed invariant).
 */
export function capabilityAllowsActionForKey(report: CapabilityReport, key: CapabilityType): boolean {
  const resolved: ResolvedCapability | undefined = report[key];
  if (!resolved || resolved.name !== key) {
    // Fail closed: an untrusted/untyped report that is missing the requested key or holds
    // `null`/an empty value there must never crash nor enable an action (THE-943 / R-002).
    return false;
  }
  return capabilityAllowsAction(resolved);
}

/** R-002 minimum vocabulary as an ordered list. Completeness is enforced by the runtime test. */
export const CAPABILITY_NAMES: readonly CapabilityType[] = [
  'create',
  'read',
  'preview',
  'thumbnail',
  'open_external',
  'human_edit',
  'agent_text_mutation',
  'agent_range_mutation',
  'agent_slide_mutation',
  'version_history',
  'change_tracking',
  'permission_read',
  'permission_write',
  'embed_editor',
  'export',
];

/** Capabilities that must be considered writes and therefore fail closed on unknown. */
const FAIL_CLOSED_WRITE_CAPABILITIES: ReadonlySet<CapabilityType> = new Set<CapabilityType>([
  'create',
  'agent_text_mutation',
  'agent_range_mutation',
  'agent_slide_mutation',
  'permission_write',
]);

/** Capabilities that must fail closed on unknown because they embed third-party editing UI. */
const FAIL_CLOSED_EMBED_CAPABILITIES: ReadonlySet<CapabilityType> = new Set<CapabilityType>([
  'embed_editor',
]);

/** Union of every capability that gates a write or embed side effect and must fail closed. */
export const FAIL_CLOSED_CAPABILITIES: ReadonlySet<CapabilityType> = new Set<CapabilityType>([
  ...FAIL_CLOSED_WRITE_CAPABILITIES,
  ...FAIL_CLOSED_EMBED_CAPABILITIES,
]);

/**
 * Capabilities whose action must fail closed unless fully `supported`.
 *
 * This is the union of the write/embedding set plus `human_edit`. R-019 requires that no
 * local Edit action appear functional when the runtime cannot complete it (e.g. a missing or
 * unhealthy local bridge reads `human_edit: degraded|unknown`), so `human_edit` is only
 * actionable when `supported`. It remains distinct from the agent-write classification
 * (`isWriteCapability`), which covers create/permission/mutation/embed only.
 */
export const REQUIRES_SUPPORTED_CAPABILITIES: ReadonlySet<CapabilityType> = new Set<CapabilityType>([
  ...FAIL_CLOSED_CAPABILITIES,
  'human_edit',
]);

/**
 * R-002: "unknown must fail closed for mutation and embedding."
 * R-019: no human Edit action appears functional when the runtime cannot complete it.
 *
 * For write/embedding/human-edit capabilities only a `supported` state may enable the action.
 * A `degraded` connection suppresses the action even when the adapter reports support; an
 * `unsupported` or `unknown` state never enables it. Read-like capabilities are usable when
 * supported or degraded, but `unsupported` surfaces a typed unsupported-capability result and
 * `unknown` never enables them.
 */
export function capabilityAllowsAction(cap: ResolvedCapability): boolean {
  if (REQUIRES_SUPPORTED_CAPABILITIES.has(cap.name)) {
    return cap.state === 'supported';
  }
  return cap.state === 'supported' || cap.state === 'degraded';
}

/** Whether a capability may drive a mutation/write/embedding side effect at runtime. */
export function isWriteCapability(cap: ResolvedCapability): boolean {
  return FAIL_CLOSED_CAPABILITIES.has(cap.name);
}

/** Whether a provider kind may be treated as authorizing any write or embedding capability. */
export function providerKindEnablesWrite(_kind: ProviderKind): boolean {
  // D-003 / R-002: provider kind is never write-authoritative. Callers must pass resolved
  // capabilities, not a provider name.
  return false;
}

/* =============================================================================
 * T-005 — Provider adapter contract.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - §10.2 "Proposed provider adapter contract": the method surface
 *     (provider / resolveCapabilities / discover / getMetadata / create / read /
 *     mutate / getVersions? / getPreview? / getPermissions? / getOpenTarget /
 *     reconcileChanges), and "Not every adapter method implies every capability is
 *     supported. Capability resolution remains authoritative."
 *   - §19.2 "Provider contract tests": "Every adapter must run against the same
 *     provider-neutral contract fixture" — register/discover, metadata, create/read/
 *     mutate when supported, unsupported-mutation rejection, revision capture,
 *     stale-write rejection, preview/permission normalization, open target, connection
 *     degradation, idempotent reconciliation. "Unsupported capability is a valid
 *     contract outcome. Lying about support is not."
 *   - T-005: "Scope: interface plus deterministic fake.",
 *     "Acceptance: shared contract tests can execute against fake.",
 *     "Security: unsupported mutation fails closed."
 *   - D-012 (revision preconditions) / R-024 (revision-aware mutation) / R-025 (standard
 *     conflict response) — every mutation carries an expected revision and rejects stale.
 *
 * This contract COMPOSES — it does not re-define — the T-002 capability model
 * (CapabilityType / CapabilityReport / capabilityAllowsAction / FAIL_CLOSED_CAPABILITIES),
 * and it reuses the R-001 vocabulary (provider, artifact_type, auth/readiness/preview/
 * conflict state) from the T-003 db layer. It introduces no competing capability namespace,
 * no receipt store, no provider registry, and no event table.
 *
 * Every adapter-supplied record carries `provider` and `artifact_type` EXPLICITLY so the
 * T-004 registry can later reject a cross-provider identity mismatch without any
 * adapter-contract change (T-004 review r3 F-1 design constraint), and it never assumes
 * provider identity is derivable from the connection alone (connless adapters exist).
 * =============================================================================
 */

import {
  type DocumentArtifactType,
  type DocumentAuthState,
  type DocumentConflictState,
  type DocumentPreviewState,
  type DocumentProvider,
  type DocumentReadinessState,
} from '../../../db/src/document-integrations';

/**
 * A single adapter-supplied artifact descriptor (R-001 surfaces). `provider` and
 * `artifact_type` are required on every record so identity is never derived from the
 * connection/registry context (connless adapters exist) and so the registry can enforce
 * provider/artifact-type consistency at integration time.
 */
export interface ProviderArtifactDescriptor {
  provider: DocumentProvider;
  artifact_type: DocumentArtifactType;
  /** Durable provider artifact identity — never null on records returned by an adapter. */
  external_id: string;
  /** May be null for connless adapters (e.g. local managed storage). */
  provider_connection_id: string | null;
  title: string;
  provider_url: string | null;
  auth_state: DocumentAuthState;
  readiness_state: DocumentReadinessState;
  current_revision: string | null;
  provider_modified_at: string | null;
  preview_state: DocumentPreviewState;
  conflict_state: DocumentConflictState;
}

/** R-002 Capability Resolver context consumed by an adapter when negotiating capabilities. */
export interface CapabilityContext {
  provider: DocumentProvider;
  artifact_type: DocumentArtifactType;
  connectionState: DocumentAuthState;
  destinationId: string | null;
  /** Provider-neutral runtime evidence (bridge health, queue depth, etc.). */
  runtime: Readonly<Record<string, unknown>>;
  policy?: string | null;
}

export interface DiscoverDocumentsInput {
  destinationId?: string | null;
  limit?: number;
}

export interface DiscoverDocumentsResult {
  items: ProviderArtifactDescriptor[];
  truncated: boolean;
}

export interface GetDocumentMetadataInput {
  external_id: string;
  provider_connection_id?: string | null;
}

export interface CreateDocumentInput {
  artifact_type: DocumentArtifactType;
  title: string;
  provider_url?: string | null;
  /** R-026 idempotency key — persisted before the provider call; replayed creates reconcile. */
  idempotencyKey: string;
  /** Injected clock so the fake is deterministic; real adapters omit (provider time). */
  now?: string;
}

export interface CreateDocumentResult {
  descriptor: ProviderArtifactDescriptor;
  /** false on an idempotent replay that reconciled to the already-created artifact (R-026). */
  created: boolean;
}

export interface ReadDocumentInput {
  external_id: string;
  provider_connection_id?: string | null;
  expectedRevision?: string | null;
}

export interface ReadDocumentResult {
  descriptor: ProviderArtifactDescriptor;
  /** Synthetic placeholder only — never real document contents (privacy D-013). */
  contentPlaceholder: string;
}

/** Provider-neutral agent mutation lanes (R-023 agent document tools). */
export type AdapterMutation =
  | { kind: 'text'; text: string }
  | { kind: 'range'; cell: string; value: string }
  | { kind: 'slide'; slideId: string };

/** Map a mutation lane to the T-002 write capability that gates it (R-002 / R-023). */
export function mutationCapability(mutation: AdapterMutation): CapabilityType {
  switch (mutation.kind) {
    case 'text':
      return 'agent_text_mutation';
    case 'range':
      return 'agent_range_mutation';
    case 'slide':
      return 'agent_slide_mutation';
  }
}

export interface MutateDocumentInput {
  external_id: string;
  provider_connection_id?: string | null;
  /** D-012 / R-024 revision precondition; a stale expected revision never silently overwrites. */
  expectedRevision: string;
  mutation: AdapterMutation;
  idempotencyKey?: string;
  now?: string;
}

export interface MutateDocumentResult {
  descriptor: ProviderArtifactDescriptor;
  priorRevision: string;
  resultRevision: string;
}

export interface GetVersionsInput {
  external_id: string;
  provider_connection_id?: string | null;
  limit?: number;
}

export interface ProviderVersionRef {
  revision: string;
  observed_at: string | null;
}

export interface GetVersionsResult {
  versions: ProviderVersionRef[];
}

export interface GetPreviewInput {
  external_id: string;
  provider_connection_id?: string | null;
}

/** R-034 preview normalization — preview is readiness state, not authoritative content. */
export interface GetPreviewResult {
  state: DocumentPreviewState;
  previewUrl: string | null;
}

export interface GetPermissionsInput {
  external_id: string;
  provider_connection_id?: string | null;
}

export interface GetPermissionsResult {
  summary_json: string;
}

export interface OpenTargetInput {
  external_id: string;
  provider_connection_id?: string | null;
}

export interface OpenTargetResult {
  provider: DocumentProvider;
  artifact_type: DocumentArtifactType;
  url: string | null;
}

export interface ReconcileChangesInput {
  /** Freshly discovered artifacts (may include already-known external_ids — dedupe). */
  discovered: ProviderArtifactDescriptor[];
  destinationId?: string | null;
}

export interface ReconcileChangesResult {
  reconciled: ProviderArtifactDescriptor[];
  /** external_ids previously known but absent from this discovery pass. */
  dropped: string[];
}

/**
 * Typed fail-closed error raised when the adapter is asked to perform a mutation (or other
 * side-effecting action) whose capability is not actionable in its currently advertised
 * capability report. NEVER silently no-ops — an unsupported mutation is rejected loudly.
 * Raised by both the shared contract helper and (defense-in-depth) the adapter's own write
 * lane, so an adapter can never be talked into a write it did not advertise.
 */
export class UnsupportedAdapterMutationError extends Error {
  readonly capability: CapabilityType;
  constructor(capability: CapabilityType, message: string) {
    super(message);
    this.name = 'UnsupportedAdapterMutationError';
    this.capability = capability;
  }
}

/**
 * Typed stale-revision conflict (D-012 / R-024 / R-025). A mutation whose expectedRevision
 * does not match the provider's current revision is rejected; it is never retried blindly.
 */
export class StaleRevisionError extends Error {
  readonly expectedRevision: string;
  readonly currentRevision: string;
  readonly retryable = true;
  constructor(expectedRevision: string, currentRevision: string) {
    super(
      `STALE_REVISION: the document changed after this operation was prepared ` +
        `(expectedRevision=${expectedRevision}, currentRevision=${currentRevision})`,
    );
    this.name = 'StaleRevisionError';
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

/** Typed error for an unknown artifact id (adapter read/metadata/mutate/reconcile target). */
export class AdapterArtifactNotFoundError extends Error {
  constructor(externalId: string) {
    super(`adapter artifact not found: ${externalId}`);
    this.name = 'AdapterArtifactNotFoundError';
  }
}

/**
 * Shared fail-closed guard for every adapter side-effecting action. Uses the T-002
 * `capabilityAllowsActionForKey` semantics (which already fail closed on unknown/degraded/
 * unsupported and on a report whose `name` mislabels a value), so a write capability that is
 * not fully `supported` — or an untrusted/mislabeled report — throws
 * `UnsupportedAdapterMutationError` instead of silently proceeding.
 */
export function assertAdapterActionSupported(
  report: CapabilityReport,
  capability: CapabilityType,
  action: string,
): void {
  if (!capabilityAllowsActionForKey(report, capability)) {
    throw new UnsupportedAdapterMutationError(
      capability,
      `${action} is not supported by this adapter's advertised capabilities ` +
        `(capability=${capability}); failing closed instead of mutating`,
    );
  }
}

/**
 * T-005 §10.2 provider adapter contract. Every provider adapter implements this surface.
 * A method's presence does not imply the matching capability is supported — capability
 * resolution (via `resolveCapabilities`) is authoritative (D-003 / R-002 / §10.2).
 */
export interface DocumentProviderAdapter {
  readonly provider: DocumentProvider;
  resolveCapabilities(context: CapabilityContext): Promise<CapabilityReport>;
  discover(input: DiscoverDocumentsInput): Promise<DiscoverDocumentsResult>;
  getMetadata(input: GetDocumentMetadataInput): Promise<ProviderArtifactDescriptor | null>;
  create(input: CreateDocumentInput): Promise<CreateDocumentResult>;
  read(input: ReadDocumentInput): Promise<ReadDocumentResult>;
  mutate(input: MutateDocumentInput): Promise<MutateDocumentResult>;
  getVersions?(input: GetVersionsInput): Promise<GetVersionsResult>;
  getPreview?(input: GetPreviewInput): Promise<GetPreviewResult>;
  getPermissions?(input: GetPermissionsInput): Promise<GetPermissionsResult>;
  getOpenTarget(input: OpenTargetInput): Promise<OpenTargetResult>;
  reconcileChanges(input: ReconcileChangesInput): Promise<ReconcileChangesResult>;
}
