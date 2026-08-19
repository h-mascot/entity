/**
 * T-004 — Implement Document Registry.
 *
 * Centralizes canonical document identity (R-001 registry surface) at the server boundary,
 * composing the T-003 persistence primitives from packages/db/src/document-integrations.ts.
 *
 * Scope (approved Linear child): create / register / get / update / rediscover.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-001 "Canonical document object": every managed artifact gets exactly one canonical
 *     Entity document id; rediscovery updates the existing record rather than duplicating;
 *     a changing provider URL never changes the Entity document id.
 *   - T-004 "Implement Document Registry": Acceptance "Rediscovery does not duplicate.",
 *     Security "workspace isolation", "Not done until: concurrent registration test passes."
 *
 * Security (workspace isolation): the T-003 db identity lookup is workspace-blind by PRD 11.1
 * design — (provider_connection_id, external_id) uniqueness is enforced globally, not
 * per-workspace. THIS registry layer is where isolation is enforced: a read/register/update
 * for workspace A must never return or mutate a document owned by workspace B. Every method
 * that resolves a record re-checks its workspace before returning or writing, and a
 * cross-workspace registration/rediscovery FAILS CLOSED (throws DocumentRegistryIsolationError)
 * instead of reading or mutating the other workspace's record.
 *
 * Concurrency: better-sqlite3 is synchronous and single-connection, so the duplicate/
 * concurrent-style registration coverage in the test suite is SERIALIZED back-to-back
 * convergence, not OS-thread interleaving — named honestly in registry.test.ts.
 *
 * Reversibility: this registry is a pure composition layer over the additive T-003 schema with
 * no competing table/namespace. The unified tables are reversible via
 * reverseDocumentIntegrationsMigration and the rollout is gated by T-006's audited Phase 2
 * flag; rolling the application back drops only the additive unified tables and preserves old
 * application semantics (R-036).
 *
 * Privacy: leaf R-001 fields only; no credentials, raw tokens, tenant secrets, or document
 * contents are read, written, or surfaced here.
 */

import Database from 'better-sqlite3';
import {
  type CreateDocumentObjectInput,
  type DocumentObjectRecord,
  type UpdateDocumentObjectFields,
  createDocumentIntegrationsRepository,
} from '../../../db/src/document-integrations';

/**
 * Canonical write input for the registry: the T-003 db input verbatim, minus workspace_id.
 * workspace is supplied as an explicit isolation scope on every method rather than embedded
 * in the payload, so a caller can never slip a foreign workspace in as data. Reusing the db
 * vocabulary avoids a competing type namespace.
 */
export type RegistryWriteInput = Omit<CreateDocumentObjectInput, 'workspace_id'>;

/** Namespace-scoped metadata update for an existing canonical record. */
export type DocumentRegistryUpdatePatch = UpdateDocumentObjectFields;

/** Fail-closed error for an invalid registry write (e.g. missing provider external identity). */
export class DocumentRegistryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentRegistryValidationError';
  }
}

export interface RegistryRegistration {
  record: DocumentObjectRecord;
  created: boolean;
}

/**
 * Fail-closed error raised when a registration/rediscovery references a provider identity that
 * is owned by a different workspace. Never read, never mutated, never returned across the
 * workspace boundary.
 */
export class DocumentRegistryIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentRegistryIsolationError';
  }
}

export interface DocumentRegistry {
  /**
   * Strict create. Adds a NEW canonical record scoped to `workspaceId`. Throws loudly if the
   * provider identity already maps to any existing record (including one owned by another
   * workspace — the identity is globally owned). Delegates to the T-003 strict-create primitive.
   */
  create(input: RegistryWriteInput, workspaceId: string): DocumentObjectRecord;
  /**
   * Idempotent registration. Comparable to rediscovery: dedupes on the provider identity within
   * `workspaceId`. If the identity already maps to a record in the SAME workspace, updates it
   * (created=false); if it maps to a DIFFERENT workspace, FAILS CLOSED; otherwise creates
   * (created=true). Delegates to the T-003 registration primitive after the isolation check.
   * Idempotency REQUIRES a durable provider identity: register with a null/empty `external_id`
   * FAILS CLOSED (DocumentRegistryValidationError) rather than silently minting a duplicate
   * canonical record — local artifacts must supply the durable managed file identity as
   * `external_id` (PRD §11.1).
   */
  register(input: RegistryWriteInput, workspaceId: string): RegistryRegistration;
  /**
   * Get a canonical record by Entity id, scoped to `workspaceId`. Returns undefined if the id is
   * unknown OR belongs to a different workspace — a workspace-A read never returns a
   * workspace-B document.
   */
  get(documentId: string, workspaceId: string): DocumentObjectRecord | undefined;
  /** Provider-identity lookup, scoped to `workspaceId`. Returns undefined across workspaces. */
  findByProviderIdentity(
    providerConnectionId: string | null,
    externalId: string,
    workspaceId: string,
  ): DocumentObjectRecord | undefined;
  /**
   * Update an existing canonical record by Entity id, scoped to `workspaceId`. No-op (undefined)
   * if the id is unknown or belongs to another workspace. Field-omitting patches preserve state
   * (and, for nullable fields, explicit `null` clears). The provider identity tuple
   * (provider_connection_id / external_id) is immutable through update — it is excluded from the
   * patch type, so identity can never be rewired (T-004 review F1).
   */
  update(
    documentId: string,
    workspaceId: string,
    patch: DocumentRegistryUpdatePatch,
  ): DocumentObjectRecord | undefined;
  /**
   * Rediscovery sync. Semantically idempotent like register: if the external provider identity
   * already maps to a record in `workspaceId`, UPDATE it (created=false) rather than duplicating
   * (R-001 acceptance "Rediscovery does not duplicate."); cross-workspace FAILS CLOSED; otherwise
   * create (created=true). Named distinctly so provider-sync callers express intent.
   */
  rediscover(input: RegistryWriteInput, workspaceId: string): RegistryRegistration;
}

function toDbInput(input: RegistryWriteInput, workspaceId: string): CreateDocumentObjectInput {
  return { ...input, workspace_id: workspaceId };
}

export function createDocumentRegistry(db: Database.Database): DocumentRegistry {
  const repo = createDocumentIntegrationsRepository(db);

  function registerOrUpdate(input: RegistryWriteInput, workspaceId: string): RegistryRegistration {
    const externalId = input.external_id ?? null;
    // R-001 idempotency requires a durable provider identity (PRD §11.1: local artifacts supply
    // the durable managed file identity as `external_id`). FAIL CLOSED on null/empty so the exact
    // caller mistake that would silently mint duplicate canonical records is rejected loudly
    // (T-004 review F4) — never a silent random-UUID duplicate.
    if (!externalId) {
      throw new DocumentRegistryValidationError(
        `register/rediscover requires a non-empty external_id: local artifacts must supply the ` +
          `durable managed file identity as external_id (PRD §11.1); identity-less registration ` +
          `would mint duplicate canonical records`,
      );
    }
    if (externalId) {
      // T-003's identity lookup is workspace-blind; resolve it here and enforce isolation
      // BEFORE delegating, so a cross-workspace match can never be read or mutated.
      const existing = repo.findDocumentByProviderIdentity(
        input.provider_connection_id ?? null,
        externalId,
      );
      if (existing && existing.workspace_id !== workspaceId) {
        throw new DocumentRegistryIsolationError(
          `provider identity (provider_connection_id, external_id) is owned by a different ` +
            `workspace; refusing cross-workspace registration`,
        );
      }
    }
    // Same-workspace match → rediscovery update (created=false); no match → create (created=true).
    // Both behaviors are owned by the T-003 registration primitive, so identity logic is not
    // duplicated here.
    const result = repo.registerDocumentObject(toDbInput(input, workspaceId));
    return { record: result.record, created: result.created };
  }

  return {
    create(input, workspaceId) {
      // Strict create rejects any existing identity, including a cross-workspace owner, via the
      // T-003 primitive's loud "provider identity already exists" error — correct isolation.
      return repo.createDocumentObject(toDbInput(input, workspaceId));
    },
    register(input, workspaceId) {
      return registerOrUpdate(input, workspaceId);
    },
    rediscover(input, workspaceId) {
      return registerOrUpdate(input, workspaceId);
    },
    get(documentId, workspaceId) {
      const record = repo.getDocumentObject(documentId);
      if (!record || record.workspace_id !== workspaceId) {
        return undefined;
      }
      return record;
    },
    findByProviderIdentity(providerConnectionId, externalId, workspaceId) {
      const record = repo.findDocumentByProviderIdentity(providerConnectionId, externalId);
      if (!record || record.workspace_id !== workspaceId) {
        return undefined;
      }
      return record;
    },
    update(documentId, workspaceId, patch) {
      const existing = repo.getDocumentObject(documentId);
      if (!existing || existing.workspace_id !== workspaceId) {
        return undefined;
      }
      return repo.updateDocumentObject(documentId, patch);
    },
  };
}
