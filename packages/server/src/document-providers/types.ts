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
export type CapabilityReport = Record<CapabilityType, ResolvedCapability>;

/** R-002 minimum vocabulary as an ordered, complete list (compile-time guarded by CapabilityReport). */
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
