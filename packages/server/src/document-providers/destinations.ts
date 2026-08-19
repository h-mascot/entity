/**
 * T-007 — Provider destinations model (R-003 destination records).
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-003 "Provider destination and policy model": Entity must model where newly created
 *     artifacts are stored and which writes are authorized.
 *   - document_provider_destinations (11.6) logical fields: id, connection_id, workspace_id,
 *     provider, artifact_type or wildcard, destination_kind, external_id or local
 *     managed-storage identity, display_name, write_mode, confirmation_policy, enabled.
 *   - §2083 naming constraint: persistence must be prefixed `document_provider_` (not
 *     `provider_`); the module lives under packages/server/src/document-providers/.
 *   - T-007 "Security: workspace/tenant isolation."
 *
 * This module owns the DESTINATION model — the concrete, workspace/tenant-scoped storage
 * locations a provider artifact may be created into. The write-policy module
 * (`write-policy.ts`) pairs these destinations with an authorization decision (allowed sets,
 * write mode, confirmation policy, default destination) to satisfy R-003.
 *
 * Persistence boundary: ISSUE-MAP names no db/migration path for T-007. This file models the
 * destination record as a pure, serializable shape so T-013/T-034 can persist it later
 * (e.g. into a `document_provider_destinations` table). No migrations, registry edits, routes,
 * or competing API namespaces are added here.
 *
 * Privacy: no credentials, raw tokens, tenant secrets, document contents, or operator-specific
 * absolute paths in models, fixtures, or output.
 */

import type { DocumentArtifactType, DocumentProvider } from '../../../db/src/document-integrations';

/** R-003 destination kinds mirror the storage locations a provider can create into (11.6 `destination_kind`). */
export type DestinationKind =
  | 'folder'
  | 'shared_drive'
  | 'onedrive'
  | 'sharepoint_library'
  | 'local_managed_storage';

/**
 * A single approved storage destination (11.6 `document_provider_destinations` row shape).
 *
 * Every destination is scoped by `workspaceId` (REQUIRED) and `tenantId` (nullable but exact
 * matched) so a destination configured for one workspace/tenant can never satisfy a request
 * from another — T-007 workspace/tenant isolation, fail closed on mismatch.
 */
export interface DocumentDestination {
  id: string;
  workspaceId: string;
  /** Tenant scope; `null` means the record is tenant-unscoped and only matches a null-tenant scope. */
  tenantId: string | null;
  /** Connection the destination belongs to; may be null for connless adapters (local managed storage). */
  connectionId: string | null;
  provider: DocumentProvider;
  /** The artifact types this destination may host. A destination never hosts types it does not declare. */
  artifactTypes: ReadonlySet<DocumentArtifactType>;
  destinationKind: DestinationKind;
  /** Provider / local managed-storage identity for the location — never a secret. */
  externalId: string | null;
  displayName: string;
  enabled: boolean;
}

/** The scope a create/write request resolves against (workspace/tenant/provider/connection/artifact). */
export interface DestinationApprovalScope {
  workspaceId: string;
  tenantId: string | null;
  provider: DocumentProvider;
  artifactType: DocumentArtifactType;
  connectionId: string | null;
}

/**
 * Whether a destination is a valid storage location for the request scope.
 *
 * Fail closed: EVERY of workspace / tenant / provider / connection / artifact type must match,
 * and the destination must be `enabled`. A destination that mismatches on any one axis never
 * serves the scope. This is the single destination→scope applicability predicate that
 * `write-policy.ts` (and later T-008) consult — there is no "any destination will do" fallback.
 */
export function destinationServesScope(
  destination: DocumentDestination,
  scope: DestinationApprovalScope,
): boolean {
  if (!destination.enabled) {
    return false;
  }
  if (destination.workspaceId !== scope.workspaceId) {
    return false;
  }
  if (destination.tenantId !== scope.tenantId) {
    return false;
  }
  if (destination.provider !== scope.provider) {
    return false;
  }
  if (destination.connectionId !== scope.connectionId) {
    return false;
  }
  if (!destination.artifactTypes.has(scope.artifactType)) {
    return false;
  }
  return true;
}

/**
 * Narrow a destination list to those that serve the scope (workspace/tenant/prov/conn/artifact).
 *
 * Returns a deduplicated list in stable input order (determinism: no reliance on set
 * enumeration order leaking into callers that iterate).
 */
export function destinationsServingScope(
  destinations: readonly DocumentDestination[],
  scope: DestinationApprovalScope,
): DocumentDestination[] {
  return destinations.filter((d) => destinationServesScope(d, scope));
}
