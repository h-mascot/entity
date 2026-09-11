/**
 * R-026 — provider-neutral create-operation claim composition.
 *
 * PRD ~:1519 (R-026): "The idempotency key for creation must be persisted before the provider
 * call and must be resolvable without an Entity document ID, because no document record exists
 * yet at that point." The T-003 `document_operations` store (packages/db/src/
 * document-integrations.ts claimDocumentOperation/completeDocumentOperation) is that store, and
 * F-001/F-002 reconciliation reads from it.
 *
 * The provider-specific seams already claim through it (local: document-providers/local/
 * document-operation.ts; Microsoft: document-providers/microsoft/create-adapter.ts). This module
 * is the provider-neutral composition the shared write paths (the T-008 HTTP create route and
 * the T-032 `document.create` agent tool) use so EVERY adapter — including ones without their
 * own Entity-side claim — persists the key before the provider dispatch and can reconcile a
 * timeout-after-provider-success (F-001) or a failed post-provider DB write (F-002) instead of
 * duplicating the provider artifact.
 *
 * Privacy: the fingerprint and the stored result carry leaf request/result metadata only — no
 * credentials, tokens, tenant secrets, or document contents.
 */

import { createHash } from 'node:crypto';
import type {
  ClaimDocumentOperationInput,
  DocumentArtifactType,
  DocumentObjectRecord,
  DocumentProvider,
  DocumentIntegrationsRepository,
} from '../../../db/src/document-integrations';
import type { DocumentRegistry, RegistryWriteInput } from './registry';
import type { CreateDocumentInput, CreateDocumentResult, ProviderArtifactDescriptor } from './types';

/** The minimal T-003 operation-store surface a create path needs. */
export type DocumentOperationStore = Pick<
  DocumentIntegrationsRepository,
  'claimDocumentOperation' | 'completeDocumentOperation'
>;

/** The request identity a create idempotency key is bound to (fingerprinted, fail-closed). */
export interface DocumentCreateRequestIdentity {
  provider: DocumentProvider;
  artifactType: DocumentArtifactType;
  title: string;
  destinationId: string | null;
}

/** The persisted create result replayed from the operation store (leaf metadata only). */
export interface StoredDocumentCreateResult {
  documentId: string;
  entityUrl: string;
  provider: DocumentProvider;
  revision: string | null;
}

/** Stable fingerprint over the create request identity (same key + different request => conflict). */
export function documentCreateRequestFingerprint(identity: DocumentCreateRequestIdentity): string {
  // Explicit field order: JSON key order is part of the fingerprint contract.
  const canonical = JSON.stringify({
    artifactType: identity.artifactType,
    destinationId: identity.destinationId ?? null,
    provider: identity.provider,
    title: identity.title,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Serialize a create result for the operation store. */
export function serializeDocumentCreateResult(result: StoredDocumentCreateResult): string {
  return JSON.stringify(result);
}

/**
 * Parse a persisted create result. Fail-closed: any malformed, incomplete, or wrong-typed
 * payload returns null (the caller must then demand reconciliation, never re-dispatch).
 */
export function parseStoredDocumentCreateResult(
  raw: string | null | undefined,
): StoredDocumentCreateResult | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Partial<StoredDocumentCreateResult>;
  if (
    typeof record.documentId !== 'string' ||
    !record.documentId ||
    typeof record.entityUrl !== 'string' ||
    !record.entityUrl ||
    typeof record.provider !== 'string' ||
    !record.provider ||
    (record.revision !== null && typeof record.revision !== 'string')
  ) {
    return null;
  }
  return {
    documentId: record.documentId,
    entityUrl: record.entityUrl,
    provider: record.provider as DocumentProvider,
    revision: record.revision ?? null,
  };
}

/** Claim input for a create operation, derived from the request identity + workspace scope. */
export function claimInputForDocumentCreate(input: {
  workspaceId: string;
  idempotencyKey: string;
  identity: DocumentCreateRequestIdentity;
}): ClaimDocumentOperationInput {
  return {
    workspace_id: input.workspaceId,
    idempotency_key: input.idempotencyKey,
    provider: input.identity.provider,
    artifact_type: input.identity.artifactType,
    destination_id: input.identity.destinationId,
    request_fingerprint: documentCreateRequestFingerprint(input.identity),
  };
}

/**
 * Mark a claimed create operation `uncertain` after a post-claim failure (provider dispatch
 * threw, or the provider succeeded but the canonical registry write failed). Mirrors the local
 * seam: the originating failure is preserved — a completion error here must never mask it.
 */
export function markDocumentCreateUncertain(
  store: DocumentOperationStore,
  input: {
    workspaceId: string;
    idempotencyKey: string;
    identity: DocumentCreateRequestIdentity;
    providerExternalId?: string | null;
  },
): void {
  try {
    store.completeDocumentOperation(input.workspaceId, input.idempotencyKey, {
      request_fingerprint: documentCreateRequestFingerprint(input.identity),
      operation_status: 'uncertain',
      ...(input.providerExternalId ? { provider_external_id: input.providerExternalId } : {}),
    });
  } catch {
    // Preserve the originating failure; the in-flight claim remains reconcilable.
  }
}

/* =============================================================================
 * The provider-neutral create operation lifecycle (canonical ownership boundary).
 *
 * ONE orchestrator — claim → (replay | dispatch → registry persistence) → complete/
 * uncertain — shared by every caller that creates documents through the
 * `DocumentProviderAdapter` contract (the T-008 HTTP create route and the T-032
 * `document.create` agent tool). Callers keep their own response translation (HTTP typed
 * errors vs tool result envelopes) and MUST run their authorization/destination/confirmation/
 * capability gates BEFORE invoking the orchestrator; dispatch happens only after a `new` claim.
 *
 * Ownership boundary (Root follow-up / Bugbot 3847563957 double-claim audit): the T-003
 * `document_operations` store is keyed UNIQUE(workspace_id, idempotency_key) with a
 * request fingerprint. This orchestrator owns claims for ADAPTER-CONTRACT creates. The
 * provider-specific seams that also claim — `local/document-operation.ts` (DOCX/XLSX/PPTX
 * engines, `CreateArtifactInput` contract) and `microsoft/create-adapter.ts`
 * (`createMicrosoftArtifact` + injected transport) — are separate, unshipped lanes that are
 * NOT wired into the `DocumentProviderAdapter` surface (no shipped `adapters()` registration
 * composes them; production composition registers no adapters at all — sandbox-runtime composes
 * only the claim-free fake adapter). No double claim is reachable today. If a claiming seam is
 * ever exposed as a DocumentProviderAdapter, it MUST be consolidated onto this orchestrator
 * (or its engine-side claim removed) — two fingerprints on one (workspace, key) row fail closed
 * as a claim conflict, never as a duplicate dispatch.
 * =============================================================================
 */

/** Narrow registry surface the create lifecycle needs (structural: test doubles welcome). */
export type DocumentCreateRegistry = Pick<
  DocumentRegistry,
  'create' | 'findByProviderIdentity' | 'get'
>;

/** Narrow dispatch surface (structural: any adapter-like create). */
export type DocumentCreateDispatch = {
  create(input: CreateDocumentInput): Promise<CreateDocumentResult>;
};

/** Typed outcome of the create operation lifecycle; callers translate to their envelope. */
export type DocumentCreateOutcome =
  | { kind: 'created'; record: DocumentObjectRecord }
  /** Adapter-reported replay reconciled onto the live canonical record. */
  | { kind: 'reconciled'; record: DocumentObjectRecord }
  /** Completed operation replayed against the LIVE canonical record (validated). */
  | { kind: 'replayed'; record: DocumentObjectRecord }
  | { kind: 'idempotency_conflict' }
  | {
      kind: 'reconciliation_required';
      reason:
        | 'uncertain_prior_attempt'
        | 'unreplayable_completed_result'
        | 'replay_target_missing'
        | 'replay_provider_mismatch'
        | 'orphaned_provider_artifact';
      providerExternalId?: string | null;
    };

export interface DocumentCreateOperationDeps {
  operations: DocumentOperationStore;
  registry: DocumentCreateRegistry;
  adapter: DocumentCreateDispatch;
}

export interface DocumentCreateOperationInput {
  workspaceId: string;
  idempotencyKey: string;
  identity: DocumentCreateRequestIdentity;
  /** Injected clock (deterministic tests; wall-clock at the HTTP boundary). */
  now?: string;
}

/** Canonical RegistryWriteInput derived from the request identity + provider descriptor. */
export function registryWriteInputForCreate(
  identity: DocumentCreateRequestIdentity,
  descriptor: ProviderArtifactDescriptor,
): RegistryWriteInput {
  return {
    provider: identity.provider,
    artifact_type: identity.artifactType,
    title: identity.title,
    // Persist the destination the document was created into so downstream evidence
    // (mutation/version/capability scopes read record.destination_id) resolves against
    // the R-003 destination rather than failing closed on a null destination.
    destination_id: identity.destinationId,
    external_id: descriptor.external_id,
    provider_connection_id: descriptor.provider_connection_id,
    provider_url: descriptor.provider_url,
    owner_summary: null,
    tenant_external_id: null,
    permissions_summary_json: null,
    sensitivity_label: null,
    auth_state: descriptor.auth_state,
    readiness_state: descriptor.readiness_state,
    current_revision: descriptor.current_revision,
    provider_modified_at: descriptor.provider_modified_at,
    preview_state: descriptor.preview_state,
    conflict_state: descriptor.conflict_state,
  };
}

/** Reconciliation-demand reason vocabulary shared by every create lifecycle caller. */
export type DocumentCreateReconciliationReason = Extract<
  DocumentCreateOutcome,
  { kind: 'reconciliation_required' }
>['reason'];

/**
 * Lifecycle-owned message for a reconciliation demand (caller envelopes reuse it verbatim —
 * HTTP typed errors and agent tool conflict warnings stay textually consistent).
 */
export function documentCreateReconciliationMessage(reason: DocumentCreateReconciliationReason): string {
  switch (reason) {
    case 'uncertain_prior_attempt':
      return 'a previous create with this idempotency key has an uncertain provider outcome; ' +
        'reconciliation is required before any retry (fail closed).';
    case 'unreplayable_completed_result':
      return 'this idempotency key already completed, but its persisted operation result cannot ' +
        'be replayed; reconciliation is required (fail closed).';
    case 'replay_target_missing':
      return 'this idempotency key already completed, but its canonical document is no longer ' +
        'present; reconciliation is required (fail closed).';
    case 'replay_provider_mismatch':
      return 'this idempotency key already completed for a different provider than this ' +
        'request; reconciliation is required (fail closed).';
    case 'orphaned_provider_artifact':
      return 'the provider already created a document for this idempotency key, but no canonical ' +
        'record is present; reconciliation is required (returning the existing artifact).';
  }
}

/**
 * Run the R-026 create operation lifecycle. Fail-closed contract:
 *   - claim BEFORE dispatch (F-001/F-002 reconciliation reads the persisted row);
 *   - same key + different request identity => typed `idempotency_conflict`;
 *   - uncertain prior attempt => `reconciliation_required` — NEVER a silent re-dispatch;
 *   - completed prior attempt => replay ONLY against the LIVE canonical registry record
 *     (stored payload must name the expected provider; the live record must exist with a
 *     matching provider — a deleted record or any mismatch is `reconciliation_required`,
 *     never success);
 *   - adapter dispatch throws / registry write fails => the row is marked `uncertain` (with
 *     the provider external id once known so reconciliation can find the orphan) and the
 *     ORIGINAL error is rethrown for the caller's typed mapping (e.g.
 *     DocumentRegistryIdentityConflictError => caller's typed conflict).
 */
export async function runDocumentCreateOperation(
  deps: DocumentCreateOperationDeps,
  input: DocumentCreateOperationInput,
): Promise<DocumentCreateOutcome> {
  const { operations, registry, adapter } = deps;
  const { workspaceId, idempotencyKey, identity } = input;
  const claim = operations.claimDocumentOperation(
    claimInputForDocumentCreate({ workspaceId, idempotencyKey, identity }),
  );
  if (claim.kind === 'conflict') {
    return { kind: 'idempotency_conflict' };
  }
  if (claim.kind === 'uncertain') {
    return {
      kind: 'reconciliation_required',
      reason: 'uncertain_prior_attempt',
      providerExternalId: claim.record.provider_external_id,
    };
  }
  if (claim.kind === 'completed') {
    const stored = parseStoredDocumentCreateResult(claim.record.result_json);
    if (!stored) {
      return {
        kind: 'reconciliation_required',
        reason: 'unreplayable_completed_result',
        providerExternalId: claim.record.provider_external_id,
      };
    }
    // The stored payload must itself name the EXPECTED provider — a stored result for another
    // provider is an integrity fault on the operation row, fail closed (never replayed).
    if (stored.provider !== identity.provider) {
      return {
        kind: 'reconciliation_required',
        reason: 'replay_provider_mismatch',
        providerExternalId: claim.record.provider_external_id,
      };
    }
    // Replay validates the LIVE canonical registry object — the stored payload is only a
    // pointer. A deleted record or a provider that does not match the requested create is a
    // typed reconciliation demand, never a success (workspace scoping is enforced by
    // registry.get itself, so a cross-workspace pointer cannot leak a foreign record).
    const live = registry.get(stored.documentId, workspaceId);
    if (!live) {
      return {
        kind: 'reconciliation_required',
        reason: 'replay_target_missing',
        providerExternalId: claim.record.provider_external_id,
      };
    }
    if (live.provider !== identity.provider) {
      return {
        kind: 'reconciliation_required',
        reason: 'replay_provider_mismatch',
        providerExternalId: claim.record.provider_external_id,
      };
    }
    return { kind: 'replayed', record: live };
  }

  const completeCreateOperation = (result: {
    documentId: string;
    providerExternalId: string | null;
    revision: string | null;
  }): void => {
    try {
      operations.completeDocumentOperation(workspaceId, idempotencyKey, {
        request_fingerprint: claim.record.request_fingerprint,
        operation_status: 'completed',
        provider_external_id: result.providerExternalId,
        document_id: result.documentId,
        result_json: serializeDocumentCreateResult({
          documentId: result.documentId,
          entityUrl: `/documents/${result.documentId}`,
          provider: identity.provider,
          revision: result.revision,
        }),
      });
    } catch {
      // Preserve the primary outcome; an in-flight claim stays reconcilable (a later retry
      // demands reconciliation instead of re-dispatching — fail closed).
    }
  };

  // claim.kind === 'new': dispatch the provider create (gates already ran at the caller).
  let created: CreateDocumentResult;
  try {
    created = await adapter.create({
      artifact_type: identity.artifactType,
      title: identity.title,
      idempotencyKey,
      ...(input.now !== undefined ? { now: input.now } : {}),
    });
  } catch (err) {
    // Provider outcome unknown (the dispatch itself failed) — never re-dispatch on retry.
    markDocumentCreateUncertain(operations, { workspaceId, idempotencyKey, identity });
    throw err;
  }
  if (created.created === false) {
    const existing = created.descriptor.external_id
      ? registry.findByProviderIdentity(
          created.descriptor.provider_connection_id ?? null,
          created.descriptor.external_id,
          workspaceId,
        )
      : undefined;
    if (existing) {
      completeCreateOperation({
        documentId: existing.id,
        providerExternalId: created.descriptor.external_id,
        revision: existing.current_revision ?? null,
      });
      return { kind: 'reconciled', record: existing };
    }
    // Succeeded-on-provider but unregistered: record the orphan identity (F-002).
    markDocumentCreateUncertain(operations, {
      workspaceId,
      idempotencyKey,
      identity,
      providerExternalId: created.descriptor.external_id,
    });
    return {
      kind: 'reconciliation_required',
      reason: 'orphaned_provider_artifact',
      providerExternalId: created.descriptor.external_id,
    };
  }
  let canonical: DocumentObjectRecord;
  try {
    canonical = registry.create(
      registryWriteInputForCreate(identity, created.descriptor),
      workspaceId,
    );
  } catch (err) {
    // The provider artifact exists but the canonical write failed: reconciliation must be
    // able to find the orphan via the provider external id (F-002). The caller maps the
    // rethrown error (e.g. DocumentRegistryIdentityConflictError) to its typed envelope.
    markDocumentCreateUncertain(operations, {
      workspaceId,
      idempotencyKey,
      identity,
      providerExternalId: created.descriptor.external_id,
    });
    throw err;
  }
  completeCreateOperation({
    documentId: canonical.id,
    providerExternalId: canonical.external_id,
    revision: canonical.current_revision ?? null,
  });
  return { kind: 'created', record: canonical };
}
