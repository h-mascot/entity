/**
 * T-008 — Provider-neutral Document Integration API.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md §12.
 * Route templates (option (a), the default — mounted under `/api/document-integrations`):
 *   GET  /{documentId}              §12.1 Get document
 *   POST /                          §12.2 Create document
 *   POST /{documentId}/mutations   §12.3 Mutate document
 *   GET  /{documentId}/capabilities §12.6 Capabilities
 *   GET  /{documentId}/versions     §12.7 Versions
 *
 * Namespace (binding constraint, PRD ~:2403): `/api/documents` is already mounted by the
 * agent-native editor module at packages/server/src/editor/index.ts:43. THIS router does NOT add
 * sibling routes into that router; it mounts under `/api/document-integrations`, following the
 * `/api/document-objects` precedent at packages/server/src/index.ts:329 (option (a)).
 *
 * Scope: get/create/mutate/versions/capabilities. Non-goal: provider-specific implementation —
 * every provider is reached through a `DocumentProviderAdapter` selected per provider kind, and
 * all tests use the deterministic fake adapter (T-005). §13 events are NOT this ticket; this
 * module adds no event table, no receipt store, no competing provider registry, and no competing
 * API namespace.
 *
 * Revision requirement (T-008 acceptance "typed errors and revision requirement implemented";
 * hardened by THE-950/T-009 "Implement Revision Coordinator"): mutations REQUIRE
 * `expectedRevision` + `idempotencyKey` and carry a typed `operation`. A stale expected revision
 * is surfaced as HTTP 409 STALE_REVISION with expected/current revision (SANITIZED — no HTML
 * injection surface, bounded, no secrets/credentials) and `retryable:true`, exactly the
 * §12.3/R-025 conflict contract. Mutation preconditions and stale-write rejection are owned by the
 * Revision Coordinator (packages/server/src/document-providers/revision-coordinator.ts, §10.1):
 * before any adapter write it compares the expected revision against the authoritative provider
 * current revision and FAILS CLOSED if the adapter cannot establish a safe current revision
 * (R-024), so a provider with no concurrency evidence never writes optimistically.
 *
 * Typed errors throughout: machine-readable `code`s for stale revision, unknown/degraded
 * capability, missing/unapproved destination policy, workspace isolation — never a bare 500 for
 * an expected failure.
 *
 * Security: every route scopes every lookup by the resolved workspace (THE-945 r3 F3 predicate
 * holds at the route boundary via registry.get/update/create + policy scoping). Fail closed on
 * unknown/degraded capability or authority. Cross-workspace probes are not an existence oracle:
 * a read of an id owned by another workspace returns the same typed NOT_FOUND as an unknown id,
 * and a cross-workspace create fails with a typed conflict that does not reveal the owner
 * (THE-944 r2 F7).
 *
 * Privacy: no credentials, raw tokens, tenant secrets, document contents, or operator-specific
 * absolute paths in fixtures/logs/output. Versions surface leaf revision metadata only.
 */

import { Router, type Request, type Response } from 'express';
import type { Phase2FlagSnapshot } from '../phase2-flags';
import type { DocumentRegistry } from '../document-providers/registry';
import { DocumentRegistryIdentityConflictError } from '../document-providers/registry';
import type { DocumentProviderAdapter } from '../document-providers/types';
import {
  AdapterArtifactNotFoundError,
  StaleRevisionError,
  UnsupportedAdapterMutationError,
  type AdapterMutation,
  type CapabilityReport,
  mutationCapability,
} from '../document-providers/types';
import {
  resolveCapabilities,
  capabilityResolutionEnabled,
} from '../document-providers/capability-resolver';
import {
  MissingDestinationPolicyError,
  UnapprovedDestinationError,
  type WritePolicy,
  type WriteRequestScope,
  resolveConfirmationAllowance,
  resolveCreateAllowance,
  resolveMutationAllowance,
} from '../document-providers/write-policy';
import type { DocumentDestination } from '../document-providers/destinations';
import {
  UnsafeMutationError,
  preflightMutation,
  staleRevisionBody,
} from '../document-providers/revision-coordinator';
import type {
  DocumentArtifactType,
  DocumentAuthState,
  DocumentObjectRecord,
  DocumentProvider,
} from '../../../db/src/document-integrations';

/** Machine-readable error code the API emits. Every expected failure has a typed code. */
export type DocumentApiErrorCode =
  | 'WORKSPACE_REQUIRED'
  | 'WORKSPACE_ISOLATION'
  | 'DOCUMENT_NOT_FOUND'
  | 'DOCUMENT_ALREADY_EXISTS'
  | 'STALE_REVISION'
  | 'MISSING_REVISION'
  | 'MISSING_IDEMPOTENCY_KEY'
  | 'CAPABILITY_UNSUPPORTED'
  | 'DESTINATION_REQUIRED'
  | 'DESTINATION_NOT_ALLOWED'
  | 'WRITE_DISABLED'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_OPERATION'
  | 'CREATE_RECONCILIATION_REQUIRED'
  | 'PROVIDER_UNAVAILABLE';

/** Typed API error: statusCode + machine-readable code + optional detail for the 409 contract. */
export class DocumentApiError extends Error {
  readonly statusCode: number;
  readonly code: DocumentApiErrorCode;
  readonly detail: Record<string, unknown> | undefined;

  constructor(
    statusCode: number,
    code: DocumentApiErrorCode,
    message: string,
    detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DocumentApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.detail = detail;
  }
}

export interface DocumentIntegrationsRouterDeps {
  registry: DocumentRegistry;
  /** Provider selection. Returns the adapter for a provider kind, or undefined (fail closed). */
  adapters: (provider: string) => DocumentProviderAdapter | undefined;
  /** R-003 write policies. */
  policies: readonly WritePolicy[];
  /** R-003 destination records. */
  destinations: readonly DocumentDestination[];
  /** Phase 2 flag snapshot used to gate the capability resolver (reversible rollout). */
  flags: Phase2FlagSnapshot;
  /**
   * Resolve the workspace for a request. Returns null to fail closed (workspace cannot be
   * determined) — the route then returns a typed WORKSPACE_REQUIRED error and no lookup runs.
   */
  resolveWorkspace: (req: Request) => string | null;
  /**
   * Provider-neutral runtime evidence (bridge health, mutation gate, queue depth, …) folded into
   * the T-006 capability resolver. Absent evidence contributes nothing — the route NEVER
   * fabricates `healthy:true` / `mutationGateOpen:true` claims it cannot back (THE-949/T-008 M2).
   */
  runtimeEvidence?: (scope: WriteRequestScope) => Readonly<Record<string, unknown>>;
  /**
   * Authenticated connection state (R-001 `DocumentAuthState`) for a request scope, derived from
   * actual registered connection state. The default (undefined) FAILS CLOSED as `unknown` — the
   * route never fabricates `connection:'authorized'` for evidence it does not hold (M2).
   */
  connectionStateFor?: (scope: WriteRequestScope) => DocumentAuthState | undefined;
  /** Injected clock for deterministic timestamps (no wall-clock dependence). */
  now?: () => string;
}

export interface CreateDocumentBody {
  artifactType: string;
  title: string;
  provider: string;
  destinationId?: string | null;
  idempotencyKey: string;
  initialContent?: unknown;
  associations?: unknown;
  /** T-013 R-005 #7: explicit human confirmation, required when the governing policy demands it. */
  confirmed?: boolean;
}

export interface MutateDocumentBody {
  expectedRevision: string;
  idempotencyKey: string;
  operation: Record<string, unknown>;
  /** T-013 R-005 #7: explicit human confirmation, required when the governing policy demands it. */
  confirmed?: boolean;
}

/** The workspace/tenant scope a write request resolves against (R-007 explicit destination). */
function writeScopeFor(
  workspaceId: string,
  tenantId: string | null,
  provider: DocumentProvider,
  artifactType: DocumentArtifactType,
  connectionId: string | null,
  destinationId: string | null,
): WriteRequestScope {
  return { workspaceId, tenantId, provider, artifactType, connectionId, destinationId };
}

/**
 * Resolve the R-003 destination + policy evidence for a request scope. Missing or unapproved
 * destination policies fail closed to `denied`/`denied` (a typed config/policy error is surfaced
 * by the route as DESTINATION_REQUIRED / DESTINATION_NOT_ALLOWED); any other error propagates.
 */
function resolveWriteEvidence(
  deps: DocumentIntegrationsRouterDeps,
  scope: WriteRequestScope,
): { destination: 'allowed' | 'denied' | 'unknown'; policy: 'allowed' | 'denied' | 'unknown' } {
  try {
    const decision = resolveCreateAllowance(deps.policies, deps.destinations, scope);
    return { destination: decision.destination, policy: decision.policy };
  } catch (err) {
    if (err instanceof MissingDestinationPolicyError || err instanceof UnapprovedDestinationError) {
      return { destination: 'denied', policy: 'denied' };
    }
    throw err;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v));
}

/**
 * T-013 (R-005 "deployment-level feature availability"; 14.6 rollback) — the audited feature
 * gate is the master availability switch for Google WRITE authorization.
 *
 * OQ-018 ("Which current Entity feature-flag mechanism should host the write gates?") is open;
 * there is NO dedicated Google-write audited flag. Per the task we reuse the existing audited
 * flag surface rather than inventing a new untracked flag: `capability_resolver_enforcement`
 * (packages/server/src/phase2-flags.ts, surface `document_capabilities`) is the on-point audited
 * flag already governing the resolver-driven write machinery. When it is DISABLED we fail closed
 * Google writes (WRITE_DISABLED) — disabling the audited flag immediately restores effective
 * read-only behavior WITHOUT schema rollback (14.6). The flag can only ever DISABLE a Google
 * write; it can never lift the admin/destination/write-mode/confirmation gates.
 */
function assertGoogleWriteDeploymentAvailable(
  deps: DocumentIntegrationsRouterDeps,
  operation: string,
): void {
  if (!capabilityResolutionEnabled(deps.flags)) {
    throw new DocumentApiError(
      403,
      'WRITE_DISABLED',
      `Google ${operation} is not deployed: the audited write-gate feature flag is disabled; ` +
        `restoring read-only behavior (fail closed, no schema rollback).`,
    );
  }
}

/**
 * T-013 (R-005 "applicable confirmation policy satisfied") — enforce the confirmation gate at
 * the route boundary. Fail closed: a missing governing policy is denied; a required confirmation
 * that the request did not satisfy is a typed CONFIRMATION_REQUIRED. Only a satisfied
 * (or not-required) confirmation policies lets the write proceed past this gate.
 */
function assertGoogleWriteConfirmationSatisfied(
  deps: DocumentIntegrationsRouterDeps,
  scope: WriteRequestScope,
  operation: 'create' | 'update',
  confirmed: boolean,
): void {
  const decision = resolveConfirmationAllowance(deps.policies, scope, operation, confirmed);
  if (decision.allowance === 'denied') {
    if (!decision.policyFound) {
      throw new DocumentApiError(
        409,
        'DESTINATION_REQUIRED',
        'no write destination policy governs the request scope; confirmation cannot be resolved (fail closed).',
      );
    }
    throw new DocumentApiError(
      403,
      'CONFIRMATION_REQUIRED',
      `this ${operation} requires explicit human confirmation per the governing confirmation policy; ` +
        `the request did not provide it (blocked).`,
    );
  }
}

function bodyObject(req: Request): Record<string, unknown> {
  if (!isRecord(req.body)) {
    throw new DocumentApiError(400, 'INVALID_REQUEST', 'request body must be a JSON object');
  }
  return req.body;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = typeof body[key] === 'string' ? (body[key] as string).trim() : '';
  if (!value) {
    throw new DocumentApiError(400, 'INVALID_REQUEST', `${key} is required`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | null {
  if (body[key] === undefined || body[key] === null) return null;
  const value = typeof body[key] === 'string' ? (body[key] as string).trim() : '';
  return value || null;
}

const ARTIFACT_TYPES: readonly DocumentArtifactType[] = ['document', 'spreadsheet', 'presentation'];
const PROVIDERS = ['google_workspace', 'microsoft_365', 'local_office'];

function parseArtifactType(body: Record<string, unknown>): DocumentArtifactType {
  const raw = requiredString(body, 'artifactType');
  if (!(ARTIFACT_TYPES as readonly string[]).includes(raw)) {
    throw new DocumentApiError(400, 'INVALID_REQUEST', `unsupported artifactType: ${raw}`);
  }
  return raw as DocumentArtifactType;
}

function parseProvider(body: Record<string, unknown>): DocumentProvider {
  const raw = requiredString(body, 'provider');
  if (!(PROVIDERS as readonly string[]).includes(raw)) {
    throw new DocumentApiError(400, 'INVALID_REQUEST', `unsupported provider: ${raw}`);
  }
  return raw as DocumentProvider;
}

/**
 * Map the §12.3/§12.4/§12.5 provider-neutral operation envelope onto the R-023 adapter mutation
 * lanes. BOTH the PRD canonical shapes (§12.4 `sheet`/`range`/`values`; §12.5
 * `slideRef`/`elementRef`/`text`; §12.3 `target.anchor`) and the legacy `cell`/`slideId`/
 * `value` shorthands are accepted at the route boundary — the canonical shapes are the pinned
 * contract (THE-949/T-008 B1).
 *
 * Honesty: a shape the ACTIVE engine cannot perform is a capability outcome
 * (`CAPABILITY_UNSUPPORTED`), never a malformed request (`INVALID_REQUEST`). A non-empty
 * `target.anchor` (structured targeting) is not representable by the current adapter mutation
 * lanes, so it is rejected with a typed `CAPABILITY_UNSUPPORTED` instead of being silently
 * dropped (§12.3); a non-empty §12.5 `elementRef`/`text` payload is likewise not representable by
 * the slide lane (which carries only a slideId) and is rejected the same way (THE-949 r3 F1).
 * Malformed present values — a non-array `values` or a present-but-non-string `target.anchor` —
 * are typed `INVALID_REQUEST` rather than silently coerced/ignored (THE-949 r3 F5).
 */
export function parseMutation(raw: unknown): AdapterMutation {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    throw new DocumentApiError(400, 'INVALID_REQUEST', 'operation.kind is required');
  }
  // §12.3 structured targeting: `operation.target.anchor` must never be silently dropped. A
  // non-empty string anchor is a capability outcome; any OTHER present anchor (non-string, e.g. a
  // number, or blank) is a malformed request, never silently skipped.
  if (isRecord(raw.target) && raw.target.anchor !== undefined) {
    if (typeof raw.target.anchor === 'string' && raw.target.anchor.trim()) {
      throw new DocumentApiError(
        403,
        'CAPABILITY_UNSUPPORTED',
        `structured targeting (operation.target.anchor='${raw.target.anchor}') is not ` +
          `supported by the active mutation lane; failing closed instead of dropping it.`,
      );
    }
    throw new DocumentApiError(
      400,
      'INVALID_REQUEST',
      'operation.target.anchor must be a non-empty string when present.',
    );
  }
  switch (raw.kind) {
    case 'replace_text':
    case 'text': {
      const text = typeof raw.content === 'string' ? raw.content : typeof raw.text === 'string' ? raw.text : '';
      if (!text) {
        throw new DocumentApiError(400, 'INVALID_REQUEST', 'text mutation requires content');
      }
      return { kind: 'text', text };
    }
    case 'set_range':
    case 'range': {
      // Canonical §12.4: sheet/range/values. Legacy alias: cell/value.
      // THE-949 r3 F1-LOW (carry-forward): a PRESENT but non-string `sheet` must be a typed
      // INVALID_REQUEST (mirroring the anchor guard at the top of parseMutation), never silently
      // coerced to '' and dropped.
      if (raw.sheet !== undefined && typeof raw.sheet !== 'string') {
        throw new DocumentApiError(400, 'INVALID_REQUEST', 'operation.sheet must be a string when present.');
      }
      const sheet = typeof raw.sheet === 'string' ? raw.sheet : '';
      const range = typeof raw.range === 'string' ? raw.range : '';
      const cell = typeof raw.cell === 'string' ? raw.cell : '';
      const value = typeof raw.value === 'string' ? raw.value : '';
      // 2D values array (canonical §12.4) serialized into the string lane when present. A present
      // but non-array `values` is a malformed request — typed INVALID_REQUEST, never silently
      // coerced/ignored (no-silent-drop stance).
      if (raw.values !== undefined && !Array.isArray(raw.values)) {
        throw new DocumentApiError(400, 'INVALID_REQUEST', 'range mutation values must be an array when present.');
      }
      const values = Array.isArray(raw.values) ? JSON.stringify(raw.values) : '';
      if (!cell && !range) {
        throw new DocumentApiError(
          400,
          'INVALID_REQUEST',
          'range mutation requires range (sheet/range canonical) or cell (alias); got neither.',
        );
      }
      const resolvedCell = cell || (sheet ? `${sheet}!${range}` : range);
      return { kind: 'range', cell: resolvedCell, value: values || value };
    }
    case 'update_slide_text':
    case 'slide': {
      // Canonical §12.5: slideRef/elementRef/text. Legacy alias: slideId. The adapter slide lane
      // carries only a slideId, so a non-empty elementRef or text payload (structured slide
      // targeting / content) cannot be faithfully forwarded — reject it with a typed
      // CAPABILITY_UNSUPPORTED instead of silently dropping it (§12.5 no-silent-drop).
      // THE-949 r3 F1-LOW (carry-forward): a PRESENT but non-string elementRef/text must be a
      // typed INVALID_REQUEST (mirroring the anchor guard), never silently coerced to '' and
      // dropped.
      if (raw.elementRef !== undefined && typeof raw.elementRef !== 'string') {
        throw new DocumentApiError(400, 'INVALID_REQUEST', 'operation.elementRef must be a string when present.');
      }
      if (raw.text !== undefined && typeof raw.text !== 'string') {
        throw new DocumentApiError(400, 'INVALID_REQUEST', 'operation.text must be a string when present.');
      }
      const elementRef = typeof raw.elementRef === 'string' ? raw.elementRef.trim() : '';
      const text = typeof raw.text === 'string' ? raw.text.trim() : '';
      if (elementRef || text) {
        throw new DocumentApiError(
          403,
          'CAPABILITY_UNSUPPORTED',
          'update_slide_text elementRef/text payload is not representable by the active mutation ' +
            'lane; failing closed instead of dropping it (§12.5).',
        );
      }
      const slideRef = typeof raw.slideRef === 'string' ? raw.slideRef : '';
      const slideId = typeof raw.slideId === 'string' ? raw.slideId : '';
      const resolvedSlideId = slideRef || slideId;
      if (!resolvedSlideId) {
        throw new DocumentApiError(
          400,
          'INVALID_REQUEST',
          'slide mutation requires slideRef (canonical) or slideId (alias); got neither.',
        );
      }
      return { kind: 'slide', slideId: resolvedSlideId };
    }
    default:
      throw new DocumentApiError(400, 'UNSUPPORTED_OPERATION', `unsupported operation kind: ${String(raw.kind)}`);
  }
}

function requireWorkspace(resolveWorkspace: (req: Request) => string | null, req: Request): string {
  const workspace = resolveWorkspace(req);
  if (!workspace) {
    throw new DocumentApiError(
      403,
      'WORKSPACE_REQUIRED',
      'unable to determine the request workspace; failing closed (workspace isolation).',
    );
  }
  return workspace;
}

/**
 * Build the §12.1 capabilities map for a document by resolving the provider adapter + auth
 * state + destination/policy evidence through the T-006 Capability Resolver. Reason codes are
 * carried through; unknown/degraded capabilities stay fail-closed. If the resolver gate is
 * disabled (phase-2 rollback), every lane reports `unknown` (fail closed) rather than a
 * provider-name assumption.
 */
async function resolveDocumentCapabilities(
  deps: DocumentIntegrationsRouterDeps,
  workspaceId: string,
  record: DocumentObjectRecord,
): Promise<CapabilityReport> {
  const adapter = deps.adapters(record.provider);
  if (!adapter) {
    throw new DocumentApiError(
      503,
      'PROVIDER_UNAVAILABLE',
      `no provider adapter is registered for provider ${record.provider}; failing closed.`,
    );
  }
  // R-003 destination/policy evidence for the read/capability envelope: use the document's own
  // destination when present, otherwise no explicit destination (fail closed, never guessed).
  const scope = writeScopeFor(
    workspaceId,
    record.tenant_external_id ?? null,
    record.provider,
    record.artifact_type,
    record.provider_connection_id ?? null,
    record.destination_id ?? null,
  );
  const evidence = resolveWriteEvidence(deps, scope);
  const destination = evidence.destination;
  const policy = evidence.policy;
  // The T-006 resolver is pure and always folds correctly, and it fails closed on
  // unknown/degraded/unsupported lanes. Capability reports are truthful runtime evidence; the
  // phase-2 gate only controls whether a WRITE is routed through enforcement (create/mutate).
  // Runtime evidence comes from actual state (M2): absent evidence contributes nothing — the
  // route never fabricates healthy/gate-open claims.
  const authState = record.auth_state;
  return resolveCapabilities({
    adapter,
    artifactType: record.artifact_type,
    connection: authState,
    destination,
    policy,
    runtime: deps.runtimeEvidence ? deps.runtimeEvidence(scope) : {},
  });
}

function sendDocumentApiError(res: Response, err: unknown): Response {
  if (err instanceof DocumentApiError) {
    const body: Record<string, unknown> = { error: { code: err.code, message: err.message } };
    if (err.detail) {
      Object.assign(body.error as Record<string, unknown>, err.detail);
    }
    return res.status(err.statusCode).json(body);
  }
  if (err instanceof StaleRevisionError) {
    // R-025: provider-neutral 409 envelope with SANITIZED expected/current revisions (no
    // credentials, no HTML injection surface) and the fixed conflict message. No blind retry.
    return res.status(409).json({ error: staleRevisionBody(err) });
  }
  if (err instanceof UnsafeMutationError) {
    // R-024 / T-009 fail-closed: the adapter cannot establish a safe current revision for this
    // lane, so the lane degrades to a typed capability error instead of writing on unverifiable
    // state. `capability` names the lane (a fixed vocabulary value, never a free-form token).
    return res.status(403).json({
      error: { code: 'CAPABILITY_UNSUPPORTED', message: err.message, capability: err.lane },
    });
  }
  if (err instanceof UnapprovedDestinationError) {
    return res.status(422).json({
      error: {
        code: 'DESTINATION_NOT_ALLOWED',
        message: err.message,
        workspaceId: err.workspaceId,
        destinationId: err.destinationId,
        cause: err.cause,
      },
    });
  }
  if (err instanceof MissingDestinationPolicyError) {
    return res.status(409).json({
      error: { code: 'DESTINATION_REQUIRED', message: err.message },
    });
  }
  if (err instanceof UnsupportedAdapterMutationError) {
    return res.status(403).json({
      error: {
        code: 'CAPABILITY_UNSUPPORTED',
        message: err.message,
        capability: err.capability,
      },
    });
  }
  if (err instanceof AdapterArtifactNotFoundError) {
    return res.status(404).json({
      error: { code: 'DOCUMENT_NOT_FOUND', message: err.message },
    });
  }
  // Bare-500 guard: any unexpected error stays an Error; the Express error path may surface it.
  // Log the underlying error server-side (no secrets/PII in the client body) instead of dropping
  // it silently, and there is a single non-Error fallback (no dead duplicated branch).
  if (err instanceof Error) {
    console.error('[document-integrations] unexpected error:', err);
    return res.status(500).json({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'internal document error' } });
  }
  return res.status(500).json({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'internal document error' } });
}

/** Global adapter selector used only when a request maps a provider to an adapter. */
function getAdapter(
  deps: DocumentIntegrationsRouterDeps,
  provider: string,
): DocumentProviderAdapter {
  const adapter = deps.adapters(provider);
  if (!adapter) {
    throw new DocumentApiError(
      503,
      'PROVIDER_UNAVAILABLE',
      `no provider adapter is registered for provider ${provider}; failing closed.`,
    );
  }
  return adapter;
}

/** §12.1 envelope fields from a canonical record + capabilities map. */
function toEnvelope(record: DocumentObjectRecord, capabilities: CapabilityReport): Record<string, unknown> {
  return {
    id: record.id,
    url: `/documents/${record.id}`,
    title: record.title,
    provider: record.provider,
    artifactType: record.artifact_type,
    providerUrl: record.provider_url ?? null,
    owner: { summary: record.owner_summary ?? null },
    readiness: { state: record.readiness_state },
    revision: record.current_revision ?? null,
    modifiedAt: record.provider_modified_at ?? null,
    indexedAt: record.indexed_at ?? null,
    preview: { state: record.preview_state },
    capabilities: Object.fromEntries(
      Object.values(capabilities).map((cap) => [
        cap.name,
        {
          state: cap.state,
          source: cap.source,
          ...(cap.reasonCode ? { reasonCode: cap.reasonCode } : {}),
        },
      ]),
    ),
  };
}

export function createDocumentIntegrationsRouter(deps: DocumentIntegrationsRouterDeps): Router {
  const router = Router();
  // B4 (THE-949/T-008): the production default is WALL-CLOCK; frozen determinism belongs only to
  // test injection (`deps.now`). A frozen default would stamp every production mutation/version
  // with a constant timestamp once a real adapter is wired.
  const nowIso = deps.now ?? (() => new Date().toISOString());

  // Utility to load a document, scoped to the request workspace. Returns undefined for an
  // unknown id OR an id owned by a different workspace — both surface the SAME typed
  // DOCUMENT_NOT_FOUND, so a cross-workspace probe is not an existence oracle.
  function requireOwnedDocument(workspaceId: string, documentId: string): DocumentObjectRecord {
    const record = deps.registry.get(documentId, workspaceId);
    if (!record) {
      throw new DocumentApiError(404, 'DOCUMENT_NOT_FOUND', `document ${documentId} was not found`);
    }
    return record;
  }

  // GET /{documentId} — §12.1 Get document.
  router.get('/:documentId', async (req, res) => {
    try {
      const workspaceId = requireWorkspace(deps.resolveWorkspace, req);
      const record = requireOwnedDocument(workspaceId, req.params.documentId);
      const capabilities = await resolveDocumentCapabilities(deps, workspaceId, record);
      return res.json({ document: toEnvelope(record, capabilities) });
    } catch (err) {
      return sendDocumentApiError(res, err);
    }
  });

  // POST / — §12.2 Create document (enforced through T-007 destinations/write policy, R-003).
  router.post('/', async (req, res) => {
    try {
      const workspaceId = requireWorkspace(deps.resolveWorkspace, req);
      const body = bodyObject(req) as unknown as CreateDocumentBody;
      const provider = parseProvider(body as unknown as Record<string, unknown>);
      const artifactType = parseArtifactType(body as unknown as Record<string, unknown>);
      const title = requiredString(body as unknown as Record<string, unknown>, 'title');
      const idempotencyKey = requiredString(
        body as unknown as Record<string, unknown>,
        'idempotencyKey',
      );
      const destinationId = optionalString(body as unknown as Record<string, unknown>, 'destinationId');
      const adapter = getAdapter(deps, provider);
      // T-013 (R-005 #1) deployment-level feature availability: the audited flag is the master
      // availability switch for Google writes. Disabled => create is undispatched (read-only).
      assertGoogleWriteDeploymentAvailable(deps, 'create');
      // R-005 #7 applicable confirmation policy: an explicit, truthful confirmation flag from the
      // caller is required when the governing confirmation policy demands it (OQ-003 default open).
      const confirmed = (body as unknown as Record<string, unknown>).confirmed === true;

      // B3 (THE-949/T-008): `initialContent`/`associations` declared on the §12.2 envelope must
      // NEVER be accepted then silently dropped. The current adapter create lane cannot honor
      // either (its `create` contract takes no content/association payload), so when the client
      // supplies them we reject with a typed `CAPABILITY_UNSUPPORTED` instead of returning 201 for
      // a document that does not contain the requested content. No accepted-but-dropped path.
      const rawBody = body as unknown as Record<string, unknown>;
      if (rawBody.initialContent !== undefined && rawBody.initialContent !== null) {
        throw new DocumentApiError(
          403,
          'CAPABILITY_UNSUPPORTED',
          'initialContent cannot be honored by the active provider create lane (content seeding is '
            + 'not supported); failing closed instead of silently dropping it.',
        );
      }
      if (rawBody.associations !== undefined && rawBody.associations !== null) {
        throw new DocumentApiError(
          403,
          'CAPABILITY_UNSUPPORTED',
          'associations cannot be honored by the active provider create lane; failing closed '
            + 'instead of silently dropping them.',
        );
      }

      const scope = writeScopeFor(
        workspaceId,
        null,
        provider,
        artifactType,
        null,
        destinationId,
      );
      // R-003 create allowance. Missing policy -> typed config error; unapproved -> typed veto
      // with cause; policy denied -> typed WRITE_DISABLED. All fail closed.
      let allowance: {
        destination: 'allowed' | 'denied' | 'unknown';
        policy: 'allowed' | 'denied' | 'unknown';
      };
      try {
        const decision = resolveCreateAllowance(deps.policies, deps.destinations, scope);
        allowance = { destination: decision.destination, policy: decision.policy };
      } catch (err) {
        if (err instanceof MissingDestinationPolicyError) {
          throw new DocumentApiError(409, 'DESTINATION_REQUIRED', err.message);
        }
        if (err instanceof UnapprovedDestinationError) {
          throw new DocumentApiError(
            422,
            'DESTINATION_NOT_ALLOWED',
            err.message,
            { workspaceId: err.workspaceId, destinationId: err.destinationId, cause: err.cause },
          );
        }
        throw err;
      }
      if (allowance.policy === 'denied' || allowance.destination !== 'allowed') {
        throw new DocumentApiError(
          403,
          'WRITE_DISABLED',
          'creation is not authorized by the governing write policy / destination (fail closed).',
        );
      }
      // T-013 (R-005 #7): applicable confirmation policy must be satisfied AFTER the write
      // policy/destination gates pass — removing ANY gate prevents the write.
      assertGoogleWriteConfirmationSatisfied(deps, scope, 'create', confirmed);
      // Capability resolver: create must be fully actionable (fail closed on unknown/degraded).
      // M2: connection state is DERIVED from actual registered state (default unknown => fail
      // closed), never fabricated as 'authorized'; runtime evidence is actual (default none).
      if (capabilityResolutionEnabled(deps.flags)) {
        const connection = deps.connectionStateFor ? deps.connectionStateFor(scope) : undefined;
        const report = await resolveCapabilities({
          adapter,
          artifactType,
          connection: connection ?? 'unknown',
          destination: 'allowed',
          policy: 'allowed',
          runtime: deps.runtimeEvidence ? deps.runtimeEvidence(scope) : {},
        });
        if (!(report.create.state === 'supported')) {
          throw new DocumentApiError(
            403,
            'CAPABILITY_UNSUPPORTED',
            `provider ${provider} does not support create for ${artifactType} under the current ` +
              `connection/capability state; failing closed.`,
          );
        }
      }
      const created = await adapter.create({
        artifact_type: artifactType,
        title,
        idempotencyKey,
        now: nowIso(),
      });
      // B2 (THE-949/T-008): an idempotency-key REPLAY (created.created === false) must reconcile,
      // never 409 DOCUMENT_ALREADY_EXISTS. The fake adapter returns created:false for a replayed
      // key; the route returns the existing registry record (or a typed CREATE_RECONCILIATION_REQUIRED
      // when the record is not yet present).
      if (created.created === false) {
        const existing = created.descriptor.external_id
          ? deps.registry.findByProviderIdentity(
              created.descriptor.provider_connection_id ?? null,
              created.descriptor.external_id,
              workspaceId,
            )
          : undefined;
        if (existing) {
          return res.status(200).json({
            documentId: existing.id,
            entityUrl: `/documents/${existing.id}`,
            provider,
            revision: existing.current_revision,
            operationId: idempotencyKey,
            receiptId: null,
            reconciled: true,
          });
        }
        // A succeeded-on-provider but not-yet-registered replay needs explicit reconciliation.
        throw new DocumentApiError(
          409,
          'CREATE_RECONCILIATION_REQUIRED',
          'the provider already created a document for this idempotency key, but no canonical ' +
            'record is present; reconciliation is required (returning the existing artifact).',
        );
      }
      // Strict create (THE-944 r2 F7): a provider identity already owned anywhere surfaces a
      // typed conflict WITHOUT revealing whether it belongs to this workspace (no existence
      // oracle). The registry's own derived id is authoritative (THE-945 r3 F4).
      let canonical: DocumentObjectRecord;
      try {
        canonical = deps.registry.create(
          {
            provider,
            artifact_type: artifactType,
            title,
            // Persist the destination the document was created into so downstream evidence
            // (mutation/version/capability scopes read record.destination_id) resolves against
            // the R-003 destination rather than failing closed on a null destination.
            destination_id: destinationId,
            external_id: created.descriptor.external_id,
            provider_connection_id: created.descriptor.provider_connection_id,
            provider_url: created.descriptor.provider_url,
            owner_summary: null,
            tenant_external_id: null,
            permissions_summary_json: null,
            sensitivity_label: null,
            auth_state: created.descriptor.auth_state,
            readiness_state: created.descriptor.readiness_state,
            current_revision: created.descriptor.current_revision,
            provider_modified_at: created.descriptor.provider_modified_at,
            preview_state: created.descriptor.preview_state,
            conflict_state: created.descriptor.conflict_state,
          },
          workspaceId,
        );
      } catch (err) {
        if (err instanceof DocumentRegistryIdentityConflictError) {
          // Same typed conflict for same-workspace duplicate and cross-workspace ownership —
          // never reveals which workspace owns the identity.
          throw new DocumentApiError(
            409,
            'DOCUMENT_ALREADY_EXISTS',
            'a document with this provider identity already exists.',
          );
        }
        throw err;
      }
      return res.status(201).json({
        documentId: canonical.id,
        entityUrl: `/documents/${canonical.id}`,
        provider,
        revision: canonical.current_revision,
        operationId: idempotencyKey,
        receiptId: null,
      });
    } catch (err) {
      return sendDocumentApiError(res, err);
    }
  });

  // POST /{documentId}/mutations — §12.3 Mutate document (revision requirement).
  router.post('/:documentId/mutations', async (req, res) => {
    try {
      const workspaceId = requireWorkspace(deps.resolveWorkspace, req);
      const record = requireOwnedDocument(workspaceId, req.params.documentId);
      const body = bodyObject(req) as unknown as MutateDocumentBody;
      const expectedRevision = requiredString(body as unknown as Record<string, unknown>, 'expectedRevision');
      const idempotencyKey = requiredString(body as unknown as Record<string, unknown>, 'idempotencyKey');
      const mutation = parseMutation((body as unknown as Record<string, unknown>).operation);
      const adapter = getAdapter(deps, record.provider);
      // T-013 (R-005 #1) deployment-level feature availability (master write-gate switch).
      assertGoogleWriteDeploymentAvailable(deps, 'mutation');
      // T-013 (R-005 #7) applicable confirmation policy.
      const confirmed = (body as unknown as Record<string, unknown>).confirmed === true;

      // Mutation policy (R-003): only create_and_update authorizes mutations.
      const scope = writeScopeFor(
        workspaceId,
        record.tenant_external_id ?? null,
        record.provider,
        record.artifact_type,
        record.provider_connection_id ?? null,
        record.destination_id ?? null,
      );
      let mutationAllowed = false;
      try {
        mutationAllowed = resolveMutationAllowance(deps.policies, scope).policy === 'allowed';
      } catch (err) {
        if (err instanceof MissingDestinationPolicyError) {
          throw new DocumentApiError(409, 'DESTINATION_REQUIRED', err.message);
        }
        throw err;
      }
      if (!mutationAllowed) {
        throw new DocumentApiError(
          403,
          'WRITE_DISABLED',
          'mutation is not authorized by the governing write policy (only create_and_update allows updates).',
        );
      }
      // T-013 (R-005 #7): applicable confirmation policy must be satisfied for the update too.
      assertGoogleWriteConfirmationSatisfied(deps, scope, 'update', confirmed);
      // Capability resolver: the mutation lane must be fully supported (fail closed on
      // unknown/degraded). UnsupportedAdapterMutationError surfaces as CAPABILITY_UNSUPPORTED.
      // M2: runtime evidence is actual (default none) — never a fabricated healthy/gate-open claim.
      if (capabilityResolutionEnabled(deps.flags)) {
        const evidence = resolveWriteEvidence(deps, scope);
        const report = await resolveCapabilities({
          adapter,
          artifactType: record.artifact_type,
          connection: record.auth_state,
          destination: evidence.destination,
          policy: evidence.policy,
          runtime: deps.runtimeEvidence ? deps.runtimeEvidence(scope) : {},
        });
        if (!(report[mutationCapability(mutation)].state === 'supported')) {
          throw new DocumentApiError(
            403,
            'CAPABILITY_UNSUPPORTED',
            `${mutation.kind} mutation is not supported by provider ${record.provider}; failing closed.`,
          );
        }
      }
      let result: { priorRevision: string; resultRevision: string };
      try {
        // §10.1 Revision Coordinator (THE-950/T-009): enforce the R-024 mutation precondition
        // BEFORE the adapter write. It reads the authoritative provider current revision, fails
        // closed if no safe current revision can be established (UnsafeMutationError -> typed
        // CAPABILITY_UNSUPPORTED), and rejects a stale expected revision (StaleRevisionError ->
        // 409) so no mutation is attempted on a stale expectation. The adapter's own mutate
        // re-checks the revision atomically as defense in depth.
        await preflightMutation({
          adapter,
          externalId: record.external_id ?? '',
          providerConnectionId: record.provider_connection_id ?? null,
          mutation,
          expectedRevision,
          documentId: record.id,
        });
        const mutated = await adapter.mutate({
          external_id: record.external_id ?? '',
          provider_connection_id: record.provider_connection_id ?? null,
          expectedRevision,
          mutation,
          idempotencyKey,
          now: nowIso(),
        });
        result = { priorRevision: mutated.priorRevision, resultRevision: mutated.resultRevision };
      } catch (err) {
        if (err instanceof StaleRevisionError) {
          // R-025 §12.3 409 contract: code/message/documentId/expectedRevision/currentRevision/
          // retryable, with SANITIZED expected/current revisions and the fixed conflict message.
          return res.status(409).json({ error: staleRevisionBody(err, record.id) });
        }
        throw err;
      }
      // Reflect the new revision onto the canonical record (registry/adapter truth).
      const updated = deps.registry.update(record.id, workspaceId, {
        current_revision: result.resultRevision,
        provider_modified_at: nowIso(),
      });
      return res.status(200).json({
        documentId: record.id,
        previousRevision: result.priorRevision,
        revision: updated?.current_revision ?? result.resultRevision,
        operationId: idempotencyKey,
        receiptId: null,
      });
    } catch (err) {
      return sendDocumentApiError(res, err);
    }
  });

  // GET /{documentId}/capabilities — §12.6 Capabilities (with reason codes).
  router.get('/:documentId/capabilities', async (req, res) => {
    try {
      const workspaceId = requireWorkspace(deps.resolveWorkspace, req);
      const record = requireOwnedDocument(workspaceId, req.params.documentId);
      const capabilities = await resolveDocumentCapabilities(deps, workspaceId, record);
      const capabilitiesMap = Object.fromEntries(
        Object.values(capabilities).map((cap) => [
          cap.name,
          {
            state: cap.state,
            source: cap.source,
            ...(cap.reasonCode ? { reasonCode: cap.reasonCode } : {}),
          },
        ]),
      );
      return res.json({ documentId: record.id, capabilities: capabilitiesMap });
    } catch (err) {
      return sendDocumentApiError(res, err);
    }
  });

  // GET /{documentId}/versions — §12.7 Versions (revision, actorType/actorId, observedAt,
  // providerModifiedAt).
  router.get('/:documentId/versions', async (req, res) => {
    try {
      const workspaceId = requireWorkspace(deps.resolveWorkspace, req);
      const record = requireOwnedDocument(workspaceId, req.params.documentId);
      const adapter = getAdapter(deps, record.provider);
      if (!adapter.getVersions) {
        throw new DocumentApiError(
          403,
          'CAPABILITY_UNSUPPORTED',
          `provider ${record.provider} does not expose version history; failing closed.`,
        );
      }
      // Read-lane honesty: an unsupported version_history lane fails closed (typed).
      const versions = await adapter.getVersions({
        external_id: record.external_id ?? '',
        provider_connection_id: record.provider_connection_id ?? null,
      });
      const now = nowIso();
      const items = versions.versions.map((v) => ({
        revision: v.revision,
        // M1 (THE-949/T-008): honest coarse attribution (R-027). The adapter version ref carries
        // no actor, so classify as `unknown` rather than fabricating `agent`. §12.7 requires
        // DISTINCT observedAt/providerModifiedAt semantics: observedAt is when the version was
        // observed; providerModifiedAt is only present when the provider reported a separate
        // modification timestamp — otherwise `null` (unknown/absent), never a duplicate of
        // observedAt.
        // NOTE (THE-949 r3 F3): `providerModifiedAt` is structurally ALWAYS null because
        // `ProviderVersionRef` exposes no field by which a provider can report a separate
        // modification timestamp — it carries only `revision` + `observed_at`. Plumbing that
        // field is a deliberate omission deferred to a slide/adapter-capable round (T-009/T-016);
        // this comment states the omission explicitly rather than implying the mechanism exists.
        actorType: 'unknown',
        actorId: null,
        observedAt: v.observed_at ?? now,
        providerModifiedAt: null,
      }));
      return res.json({ documentId: record.id, versions: items });
    } catch (err) {
      return sendDocumentApiError(res, err);
    }
  });

  return router;
}
