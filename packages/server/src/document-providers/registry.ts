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
 * Atomicity: the cross-workspace pre-check and the delegated write are not two independent
 * statements. Every register/rediscover/create runs its isolation pre-check and its write inside
 * ONE `BEGIN IMMEDIATE` transaction (better-sqlite3 `transaction.immediate`), and a post-write
 * workspace assertion re-verifies the returned record is owned by the caller workspace before the
 * outcome is returned. A concurrent process can therefore never commit a row between our check and
 * our write, and the delegated registration can never silently cross the workspace boundary —
 * both fail closed.
 *
 * Concurrency: better-sqlite3 is synchronous and single-connection, so the duplicate/
 * concurrent-style registration coverage in the test suite is SERIALIZED back-to-back
 * convergence, not OS-thread interleaving — named honestly in registry.test.ts. The atomicity of
 * the check-and-write pair is additionally probed with a second connection on a file-backed DB in
 * the isolation suite.
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
 * Canonical write input for the registry: the T-003 db input verbatim, minus workspace_id and
 * the caller-supplied `id`. workspace is supplied as an explicit isolation scope on every method
 * rather than embedded in the payload, so a caller can never slip a foreign workspace in as data.
 * `id` is OMITTED (THE-945 r3 F4): the canonical Entity document id is deterministically derived
 * by the T-003 layer from the provider identity (documentObjectIdForIdentity), never caller-
 * chosen. Reusing the db vocabulary avoids a competing type namespace; the exclusion removes an
 * undocumented deterministic-identity override on the minting paths.
 */
export type RegistryWriteInput = Omit<CreateDocumentObjectInput, 'workspace_id' | 'id'>;

/** Namespace-scoped metadata update for an existing canonical record. */
export type DocumentRegistryUpdatePatch = UpdateDocumentObjectFields;

/** Fail-closed error for an invalid registry write (e.g. missing provider external identity). */
export class DocumentRegistryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentRegistryValidationError';
  }
}

/**
 * Typed provider-identity conflict raised by a strict create when the (provider_connection_id,
 * external_id) identity ALREADY maps to any canonical record — same or other workspace. The
 * message never reveals which workspace owns the identity (a cross-workspace probe is not an
 * existence oracle). Replacing string-matching on the T-003 db error with this typed surface
 * (THE-949/T-008 L1a) keeps a 409 conflict stable against a db-message edit.
 */
export class DocumentRegistryIdentityConflictError extends Error {
  readonly providerConnectionId: string | null;
  readonly externalId: string;
  constructor(providerConnectionId: string | null, externalId: string) {
    super(
      'document provider identity already exists (fail closed): a canonical record is already ' +
        'bound to this provider identity.',
    );
    this.name = 'DocumentRegistryIdentityConflictError';
    this.providerConnectionId = providerConnectionId;
    this.externalId = externalId;
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
   * Identity-less create (null/empty `external_id`) FAILS CLOSED (DocumentRegistryValidationError)
   * exactly like register/rediscover: the unique identity index excludes NULL identities, so a
   * repeated identity-less create would mint unbounded canonical records that no lookup or
   * rediscovery could ever resolve (T-004 review B1 / F4) — local artifacts must supply the
   * durable managed file identity as `external_id` (PRD §11.1).
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
   * NOTE (T-004 M1): rediscovery does NOT sync `destination_id`. The T-003 rediscovery UPDATE
   * intentionally omits `destination_id` from its column list, so a moved artifact keeps its stale
   * destination through `rediscover()` — destination changes must go through `update()`.
   */
  rediscover(input: RegistryWriteInput, workspaceId: string): RegistryRegistration;
}

function toDbInput(input: RegistryWriteInput, workspaceId: string): CreateDocumentObjectInput {
  return { ...input, workspace_id: workspaceId };
}

export function createDocumentRegistry(db: Database.Database): DocumentRegistry {
  const repo = createDocumentIntegrationsRepository(db);

  /**
   * Fail-closed identity guard shared by every minting path (register/rediscover/create).
   * R-001 idempotency requires a durable provider identity: the global unique identity index
   * (`WHERE external_id IS NOT NULL`) explicitly excludes NULL identities, so a null/empty
   * `external_id` would mint duplicate canonical records that no find/register/rediscover could
   * ever resolve (T-004 review F4, and review B1 for the create lane).
   */
  function assertExternalIdentity(
    externalId: string | null | undefined,
    op: string,
  ): asserts externalId is string {
    if (!externalId) {
      throw new DocumentRegistryValidationError(
        `${op} requires a non-empty external_id: local artifacts must supply the durable managed ` +
          `file identity as external_id (PRD §11.1); identity-less registration would mint ` +
          `duplicate canonical records that the unique identity index excludes and no lookup or ` +
          `rediscovery could ever resolve`,
      );
    }
  }

  /**
   * Defense-in-depth post-delegation check (T-004 review B2). The workspace is set by the registry
   * itself via toDbInput, so this can only trip on a future bug; if the delegated write ever
   * returned a record owned by a different workspace, FAIL CLOSED (with the transaction rolled
   * back) rather than surfacing a cross-workspace record.
   */
  function assertOwnedWorkspace(record: DocumentObjectRecord, workspaceId: string): void {
    if (record.workspace_id !== workspaceId) {
      throw new DocumentRegistryIsolationError(
        `isolated registration returned a canonical record owned by a different workspace; ` +
          `refusing to cross the workspace boundary`,
      );
    }
  }

  function registerOrUpdate(input: RegistryWriteInput, workspaceId: string): RegistryRegistration {
    const externalId = input.external_id ?? null;
    // R-001 idempotency requires a durable provider identity (PRD §11.1). FAIL CLOSED on
    // null/empty so the exact caller mistake that would silently mint duplicate canonical
    // records is rejected loudly (T-004 review F4) — never a silent random-UUID duplicate.
    assertExternalIdentity(externalId, 'register/rediscover');
    // Atomicity (T-004 review B2): the isolation pre-check and the delegated write MUST run in one
    // BEGIN IMMEDIATE transaction, so a competing process can never commit a row between our check
    // and our write. Without it, a workspace-B pre-check that observes no row, followed by a
    // workspace-A insert, would leave B's delegated registerDocumentObject on the UPDATE path
    // mutating A's record. tx.immediate() = BEGIN IMMEDIATE.
    const tx = db.transaction((): RegistryRegistration => {
      // T-003's identity lookup is workspace-blind; resolve it here and enforce isolation BEFORE
      // delegating, so a cross-workspace match can never be read or mutated.
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
      // THE-945 r3 F1: fail-closed cross-provider identity merge. The (provider_connection_id,
      // external_id) tuple is the R-001 uniqueness key; `provider` and `artifact_type` are part
      // of that identity, not mutable annotations. A rediscovery/register that reuses an existing
      // external identity while claiming a DIFFERENT provider or artifact_type must be rejected
      // with a typed validation error instead of silently rewriting the record's identity columns
      // (which would fork the numerical uniqueness into a logically-divergent record).
      if (
        existing &&
        (existing.provider !== input.provider || existing.artifact_type !== input.artifact_type)
      ) {
        throw new DocumentRegistryValidationError(
          `provider identity (provider_connection_id, external_id) is already owned by ` +
            `${existing.provider}/${existing.artifact_type}; register/rediscover attempted to ` +
            `merge it into ${input.provider}/${input.artifact_type}. Cross-provider or ` +
            `cross-artifact-type identity merge is rejected (fail closed).`,
        );
      }
      // Same-workspace match → rediscovery update (created=false); no match → create (created=true).
      // Both behaviors are owned by the T-003 registration primitive, so identity logic is not
      // duplicated here.
      const result = repo.registerDocumentObject(toDbInput(input, workspaceId));
      // Re-verify the delegated write landed on a record the caller workspace owns.
      assertOwnedWorkspace(result.record, workspaceId);
      return { record: result.record, created: result.created };
    });
    return tx.immediate();
  }

  return {
    create(input, workspaceId) {
      const externalId = input.external_id ?? null;
      // Strict create mints a NEW canonical record. The unique identity index excludes NULL
      // identities, and no find/register/rediscover can ever resolve an identity-less record, so
      // fail closed on null/empty external_id exactly like register/rediscover — a repeated
      // identity-less create would otherwise mint unbounded canonical records (T-004 review B1).
      assertExternalIdentity(externalId, 'create');
      const tx = db.transaction((): DocumentObjectRecord => {
        // THE-949/T-008 L1a: duplicate-identity detection is a TYPED pre-check, not a regex on
        // the T-003 db error string. Resolving the (provider_connection_id, external_id) identity
        // here (workspace-blind, matching the global R-001 uniqueness) and throwing a typed
        // `DocumentRegistryIdentityConflictError` when it already maps to any record — same or
        // other workspace — gives the route a stable typed conflict surface (never a 500 after a
        // db-message edit). The check and the delegated write run in ONE BEGIN IMMEDIATE
        // transaction (atomic, mirroring register/rediscover).
        const existing = repo.findDocumentByProviderIdentity(
          input.provider_connection_id ?? null,
          externalId,
        );
        if (existing) {
          throw new DocumentRegistryIdentityConflictError(
            input.provider_connection_id ?? null,
            externalId,
          );
        }
        const record = repo.createDocumentObject(toDbInput(input, workspaceId));
        assertOwnedWorkspace(record, workspaceId);
        return record;
      });
      return tx.immediate();
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
      // THE-945 r3 F3: the workspace pre-check and the delegated write are not two independent
      // statements. Wrapping them in ONE `BEGIN IMMEDIATE` transaction makes the check-and-write
      // race-safe: the first statement takes the write lock, so a concurrent writer can never
      // interleave a mutation between our workspace check and our write (mirrors the atomicity
      // already applied to register/rediscover/create).
      const tx = db.transaction((): DocumentObjectRecord | undefined => {
        const existing = repo.getDocumentObject(documentId);
        if (!existing || existing.workspace_id !== workspaceId) {
          return undefined;
        }
        return repo.updateDocumentObject(documentId, patch);
      });
      return tx.immediate();
    },
  };
}
