/**
 * THE-955 (T-014) — Google Docs create/mutate provider adapter.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - T-014 acceptance: create; stable Entity URL; bounded mutation; revision capture;
 *     conflict rejection (+ rows R-004/R-005/R-007).
 *   - T-005 DocumentProviderAdapter contract (../types) — this adapter COMPOSES it and
 *     introduces no competing capability namespace, registry, receipt store, or event table.
 *   - D-012 / R-024 / R-025: every mutation carries an expected provider revision; stale or
 *     unknown revisions are rejected with the typed, retryable StaleRevisionError.
 *   - THE-950 r2 F2 (adapter half): revision-token strictness at the adapter boundary,
 *     including the extended unsafe-character set (U+2066–U+2069, U+FEFF, U+2060, U+00AD,
 *     U+061C, C0 controls, HTML/attribute metacharacters).
 *
 * Determinism / security posture:
 *   - TRANSPORT IS INJECTED. This module performs no network I/O, holds no credentials, and
 *     touches no tenant data. Tests supply a deterministic recorded/stateful transport.
 *   - FAIL-CLOSED: unknown/degraded connection state folds every write capability to a
 *     non-actionable state; any side-effecting action re-checks the advertised capability
 *     report via `assertAdapterActionSupported` (defense-in-depth beyond route gates).
 *   - BOUNDED MUTATION: only the declared Google Docs `batchUpdate` text envelope
 *     (`insertText` / `replaceAllText`) is ever forwarded. Range and slide lanes are outside
 *     the declared envelope and fail with typed `UnsupportedAdapterMutationError`.
 *   - Stable identity: `external_id` IS the durable Google document id — never a locally
 *     minted UUID. Entity-side stable URL mapping is the T-004/T-008 registry machinery.
 */

import type {
  AdapterMutation,
  CapabilityContext,
  CapabilityReport,
  CreateDocumentInput,
  CreateDocumentResult,
  DiscoverDocumentsInput,
  DiscoverDocumentsResult,
  DocumentProviderAdapter,
  GetDocumentMetadataInput,
  GetPermissionsInput,
  GetPermissionsResult,
  GetPreviewInput,
  GetPreviewResult,
  GetVersionsInput,
  GetVersionsResult,
  MutateDocumentInput,
  MutateDocumentResult,
  OpenTargetInput,
  OpenTargetResult,
  ProviderArtifactDescriptor,
  ReadDocumentInput,
  ReadDocumentResult,
  ReconcileChangesInput,
  ReconcileChangesResult,
} from '../types';
import {
  assertAdapterActionSupported,
  AdapterArtifactNotFoundError,
  mutationCapability,
  StaleRevisionError,
  UnsupportedAdapterMutationError,
} from '../types';
import { UNSAFE_REVISION_TOKEN_CHARACTERS } from '../revision-coordinator';
import type { DocumentAuthState, DocumentProvider } from '../../../../db/src/document-integrations';

/* =============================================================================
 * Typed errors specific to the Google Docs adapter boundary.
 * ============================================================================= */

/**
 * THE-950 r2 F2 (adapter half): a revision token crossing the adapter boundary contained a
 * bidirectional control, invisible character, ASCII control, or injection metacharacter.
 * Raised BOTH for inbound expectedRevision values (client-supplied precondition) and for
 * outbound revision tokens reported by the transport (never fabricate or propagate an
 * unsafe token into Entity state).
 */
export class UnsafeRevisionTokenError extends Error {
  readonly codePoint: number;
  readonly field: 'expectedRevision' | 'reportedRevision';
  constructor(field: 'expectedRevision' | 'reportedRevision', codePoint: number) {
    super(
      `UNSAFE_REVISION_TOKEN: ${field} contained a forbidden character ` +
        `(U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}); failing closed`,
    );
    this.name = 'UnsafeRevisionTokenError';
    this.codePoint = codePoint;
    this.field = field;
  }
}

/** Transport-level optimistic-concurrency conflict, mapped to the neutral StaleRevisionError. */
export class GoogleTransportConflictError extends Error {
  readonly expectedRevision: string;
  readonly currentRevision: string;
  readonly retryable = true;
  constructor(expectedRevision: string, currentRevision: string) {
    super(
      `google docs transport reported a revision conflict ` +
        `(expectedRevision=${JSON.stringify(expectedRevision)}, ` +
        `currentRevision=${JSON.stringify(currentRevision)})`,
    );
    this.name = 'GoogleTransportConflictError';
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

/* =============================================================================
 * Transport surface (injected; the ONLY I/O boundary of this adapter).
 * ============================================================================= */

/** Metadata for one Google Doc as reported by the transport. */
export interface GoogleDocMetadata {
  documentId: string;
  title: string;
  url: string | null;
  /** Provider revision token (opaque). Validated for unsafe characters at the boundary. */
  revisionId: string;
  /** RFC 3339 provider modification timestamp. */
  modifiedTime: string;
}

/**
 * The DECLARED, bounded batchUpdate envelope. Only this request kind is ever forwarded.
 * THE-955 r1 F2: `replaceAllText` was REMOVED from the declared envelope. The T-005 text lane
 * carries no anchor, so a "replace" cannot be expressed through the adapter contract; rather
 * than silently reinterpret an anchorless replace as prepend-as-replace (or forward an
 * anchorless replaceAllText, which has no defined provider semantic), the adapter implements
 * INSERT-only semantics and rejects any other request kind with a typed error at the
 * `DECLARED_DOCS_REQUEST_KINDS` guard below.
 */
export type GoogleDocsBatchRequest = { kind: 'insertText'; location: { index: number }; text: string };

/**
 * THE-955 r1 F2: the exact request kinds this adapter may forward to the transport. The
 * mutate lane checks every constructed request against this set BEFORE any transport call and
 * throws a typed UnsupportedAdapterMutationError otherwise (fail-closed bounded mutation).
 */
export const DECLARED_DOCS_REQUEST_KINDS: ReadonlySet<string> = new Set(['insertText']);

/**
 * Minimal Google Docs/Drive transport the adapter needs. Real implementations wrap the
 * Google APIs; tests inject a deterministic stateful fake. NO default transport exists —
 * constructing the adapter without a transport is a compile-time impossibility.
 */
export interface GoogleDocsTransport {
  createDocument(input: {
    title: string;
    mimeType: string;
    parent?: string | null;
    idempotencyKey?: string;
  }): { document: GoogleDocMetadata; created: boolean };
  getDocument(input: { documentId: string }): GoogleDocMetadata | null;
  batchUpdate(input: {
    documentId: string;
    requests: GoogleDocsBatchRequest[];
    expectedRevision: string;
  }): { documentId: string; revisionId: string; responses: unknown[] };
}

export interface GoogleDocsAdapterOptions {
  transport: GoogleDocsTransport;
  /** Optional destination folder id forwarded on creates (never a local filesystem path). */
  parentFolderId?: string | null;
}

/* =============================================================================
 * Revision-token strictness (THE-950 r2 F2 adapter half; THE-956 r2 C3 shared canonical set).
 * ============================================================================= */

/**
 * THE-956 r2 (C3): the forbidden-character class is no longer defined locally — it IS the
 * canonical shared class exported from `../revision-coordinator` (consumed by both Google
 * adapter boundaries and the coordinator's sanitizer, pinned equivalent by test). Relative to
 * the previous docs-adapter-local set this is a TIGHTENING only: C1 controls (U+0080–U+009F),
 * zero-width format characters U+200B–U+200D, and the injection metacharacters `'` `&` `\\`
 * are now also rejected. U+2028 remains rejected; U+2022 (bullet) remains accepted (benign
 * printable, THE-955 r1 F7). A benign opaque token (e.g. `rev_17QkAaiFhyZK871Jozj6w`) passes
 * untouched.
 */
const UNSAFE_REVISION_CHARACTERS = UNSAFE_REVISION_TOKEN_CHARACTERS;

function firstUnsafeCodePoint(token: string): number | null {
  for (const ch of token) {
    if (UNSAFE_REVISION_CHARACTERS.test(ch)) {
      return ch.codePointAt(0)!;
    }
  }
  return null;
}

/** Validate a client-supplied expectedRevision; throws UnsafeRevisionTokenError on failure. */
function requireSafeExpectedRevision(token: string): void {
  const bad = firstUnsafeCodePoint(token);
  if (bad !== null || token.length === 0) {
    throw new UnsafeRevisionTokenError('expectedRevision', bad ?? 0);
  }
}

/** Validate a transport-reported revision; throws UnsafeRevisionTokenError on failure. */
function requireSafeReportedRevision(token: string): string {
  const bad = firstUnsafeCodePoint(token);
  if (bad !== null || token.length === 0) {
    throw new UnsafeRevisionTokenError('reportedRevision', bad ?? 0);
  }
  return token;
}

/* =============================================================================
 * Capability honesty (R-002/D-003): static support matrix folded with live connection state.
 * ============================================================================= */

/** Capabilities this adapter genuinely implements against the Docs surface. */
const SUPPORTED_CAPABILITIES: ReadonlySet<string> = new Set([
  'create',
  'read',
  'open_external',
  'human_edit',
  'agent_text_mutation',
  'version_history',
]);

function foldConnectionState(state: DocumentAuthState): 'supported' | 'degraded' | 'unknown' | 'unsupported' {
  switch (state) {
    case 'authorized':
      return 'supported';
    case 'degraded':
      return 'degraded';
    case 'unknown':
      return 'unknown';
    default:
      // `unauthorized` (and any future non-actionable state): the lane exists but cannot
      // act — never lift a write on it (fail closed).
      return 'unsupported';
  }
}

/* =============================================================================
 * Artifact-type mapping (bounded: Docs surface covers documents and spreadsheets-as-docs).
 * ============================================================================= */

const ARTIFACT_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ['document', 'application/vnd.google-apps.document'],
  ['spreadsheet', 'application/vnd.google-apps.spreadsheet'],
]);

/* =============================================================================
 * Adapter.
 * ============================================================================= */

interface KnownArtifact {
  external_id: string;
  artifact_type: string;
}

class GoogleDocsAdapter implements DocumentProviderAdapter {
  readonly provider: DocumentProvider = 'google_workspace';
  private readonly transport: GoogleDocsTransport;
  private readonly parentFolderId: string | null;
  /** Adapter-local index of artifacts this instance has created or observed (stable identity). */
  private readonly known = new Map<string, KnownArtifact>();

  constructor(options: GoogleDocsAdapterOptions) {
    this.transport = options.transport;
    this.parentFolderId = options.parentFolderId ?? null;
  }

  private connectionState(): DocumentAuthState {
    // Transports MAY expose their live connection/readiness state; absence means unknown,
    // which fails closed for every write lane (R-002).
    const probe = this.transport as Partial<{ connectionState: DocumentAuthState }>;
    return probe.connectionState ?? 'unknown';
  }

  async resolveCapabilities(context: CapabilityContext): Promise<CapabilityReport> {
    // Fold the caller-supplied context with the transport's own evidence, taking the MORE
    // restrictive of the two (fail-closed precedence, R-002 source ordering).
    const states: DocumentAuthState[] = [context.connectionState, this.connectionState()];
    // Fail-closed precedence over the two evidence sources: `unauthorized` dominates; then
    // `degraded`; unanimous `authorized` is the only authorized outcome; otherwise `unknown`
    // (THE-955 r1 F1 / T-005 fake-adapter semantics: an `unknown` evidence source folds the
    // lanes to the conservative non-actionable `unknown`, never to a lifted state).
    const worst: DocumentAuthState = states.some((s) => s === 'unauthorized')
      ? 'unauthorized'
      : states.some((s) => s === 'degraded')
        ? 'degraded'
        : states.every((s) => s === 'authorized')
          ? 'authorized'
          : 'unknown';
    const live = foldConnectionState(worst);
    const report = {} as CapabilityReport;
    // Every supported lane inherits the folded connection liveness; anything this adapter
    // does not implement is honestly `unsupported` — never guessed from the provider name.
    const vocabulary: Array<[keyof CapabilityReport & string, string]> = [
      ['create', SUPPORTED_CAPABILITIES.has('create') ? live : 'unsupported'],
      ['read', SUPPORTED_CAPABILITIES.has('read') ? live : 'unsupported'],
      ['preview', 'unsupported'],
      ['thumbnail', 'unsupported'],
      // THE-955 r1 F1: these lanes fold from the LIVE connection state like every other lane —
      // no hardcoded 'supported' ternary (a degraded/unauthorized connection must degrade or
      // fail-close them too).
      ['open_external', SUPPORTED_CAPABILITIES.has('open_external') ? live : 'unsupported'],
      ['human_edit', SUPPORTED_CAPABILITIES.has('human_edit') ? live : 'unsupported'],
      [
        'agent_text_mutation',
        SUPPORTED_CAPABILITIES.has('agent_text_mutation') ? live : 'unsupported',
      ],
      ['agent_range_mutation', 'unsupported'],
      ['agent_slide_mutation', 'unsupported'],
      ['version_history', SUPPORTED_CAPABILITIES.has('version_history') ? live : 'unsupported'],
      ['change_tracking', 'unsupported'],
      ['permission_read', 'unsupported'],
      ['permission_write', 'unsupported'],
      ['embed_editor', 'unsupported'],
      ['export', 'unsupported'],
    ];
    for (const [name, state] of vocabulary) {
      // The cast is safe: every key above is a member of the R-002 vocabulary.
      (report as Record<string, unknown>)[name] = {
        name,
        state,
        source: 'adapter',
        reasonCode: state === 'unsupported' ? 'adapter_not_implemented' : undefined,
        reason: state === 'unsupported' ? `${name} is outside the Google Docs adapter's declared surface` : undefined,
      };
    }
    return report;
  }

  private async descriptorFor(metadata: GoogleDocMetadata, artifactType: string): Promise<ProviderArtifactDescriptor> {
    const revision = requireSafeReportedRevision(metadata.revisionId);
    const auth = this.connectionState();
    return {
      provider: 'google_workspace',
      artifact_type: (this.known.get(metadata.documentId)?.artifact_type ?? artifactType) as ProviderArtifactDescriptor['artifact_type'],
      external_id: metadata.documentId,
      provider_connection_id: null,
      title: metadata.title,
      provider_url: metadata.url,
      auth_state: auth,
      readiness_state: auth === 'authorized' ? 'ready' : 'degraded',
      current_revision: revision,
      provider_modified_at: metadata.modifiedTime,
      preview_state: 'unsupported',
      conflict_state: 'none',
    };
  }

  private remember(externalId: string, artifactType: string): void {
    if (!this.known.has(externalId)) {
      this.known.set(externalId, { external_id: externalId, artifact_type: artifactType });
    }
  }

  private async requireMetadata(externalId: string, artifactType: string): Promise<ProviderArtifactDescriptor> {
    const metadata = this.transport.getDocument({ documentId: externalId });
    if (!metadata) {
      throw new AdapterArtifactNotFoundError(externalId);
    }
    this.remember(metadata.documentId, artifactType);
    return this.descriptorFor(metadata, artifactType);
  }

  async discover(input: DiscoverDocumentsInput): Promise<DiscoverDocumentsResult> {
    // Discovery enumerates the artifacts THIS adapter instance knows about (created here or
    // observed through reads) via the injected transport. No wildcard tenant listing.
    const limit = input.limit ?? Number.POSITIVE_INFINITY;
    const items: ProviderArtifactDescriptor[] = [];
    for (const known of this.known.values()) {
      if (items.length >= limit) break;
      const metadata = this.transport.getDocument({ documentId: known.external_id });
      if (metadata) {
        items.push(await this.descriptorFor(metadata, known.artifact_type));
      }
    }
    return { items, truncated: this.known.size > items.length };
  }

  async getMetadata(input: GetDocumentMetadataInput): Promise<ProviderArtifactDescriptor | null> {
    try {
      return await this.requireMetadata(input.external_id, 'document');
    } catch (e) {
      if (e instanceof AdapterArtifactNotFoundError) return null;
      throw e;
    }
  }

  async create(input: CreateDocumentInput): Promise<CreateDocumentResult> {
    // Fail-closed gate: create is a write capability; unknown/degraded connections never lift it.
    const report = await this.resolveCapabilities({
      provider: this.provider,
      artifact_type: input.artifact_type,
      connectionState: this.connectionState(),
      destinationId: null,
      runtime: {},
    });
    assertAdapterActionSupported(report, 'create', 'create');

    const mimeType = ARTIFACT_MIME_TYPES.get(input.artifact_type);
    if (!mimeType) {
      throw new UnsupportedAdapterMutationError(
        'create',
        `artifact_type ${input.artifact_type} is outside the Google Docs adapter's declared surface`,
      );
    }
    const { document, created } = this.transport.createDocument({
      title: input.title,
      mimeType,
      parent: this.parentFolderId,
      idempotencyKey: input.idempotencyKey,
    });
    this.remember(document.documentId, input.artifact_type);
    // CORRECTED (T-015/THE-956, 2026-08-18; THE-955 r1 F6): the create response's revisionId
    // IS strictly validated — descriptorFor() runs requireSafeReportedRevision on it, so an
    // unsafe create-response token rejects the create outright (fail-closed at EVERY
    // descriptor boundary, including create-time; proven by the create-time negative test).
    const descriptor = await this.descriptorFor(document, input.artifact_type);
    return { descriptor, created };
  }

  async read(input: ReadDocumentInput): Promise<ReadDocumentResult> {
    const report = await this.resolveCapabilities({
      provider: this.provider,
      artifact_type: 'document',
      connectionState: this.connectionState(),
      destinationId: null,
      runtime: {},
    });
    assertAdapterActionSupported(report, 'read', 'read');
    const descriptor = await this.requireMetadata(input.external_id, 'document');
    // Privacy (D-013): a synthetic placeholder — never real document contents.
    return {
      descriptor,
      contentPlaceholder: `[placeholder: google_workspace document ${descriptor.external_id}]`,
    };
  }

  async mutate(input: MutateDocumentInput): Promise<MutateDocumentResult> {
    // 1. Lane/capability gate FIRST: range and slide lanes are outside the declared envelope
    //    and fail closed even before any transport interaction (bounded mutation).
    const capability = mutationCapability(input.mutation);
    if (input.mutation.kind !== 'text') {
      throw new UnsupportedAdapterMutationError(
        capability,
        `mutation lane ${capability} is outside the Google Docs adapter's declared ` +
          `batchUpdate envelope (text-only); failing closed`,
      );
    }
    const report = await this.resolveCapabilities({
      provider: this.provider,
      artifact_type: 'document',
      connectionState: this.connectionState(),
      destinationId: null,
      runtime: {},
    });
    assertAdapterActionSupported(report, capability, `mutate(${capability})`);

    // 2. Token strictness on the client-supplied precondition (THE-950 r2 F2 adapter half).
    requireSafeExpectedRevision(input.expectedRevision);

    // 3. Resolve the artifact; unknown identities never proceed to a transport write.
    const current = await this.requireMetadata(input.external_id, 'document');

    // 4. Local optimistic-concurrency precondition (D-012 / R-024).
    if (current.current_revision !== input.expectedRevision) {
      throw new StaleRevisionError(input.expectedRevision, current.current_revision ?? '');
    }

    // 5. Forward ONLY the declared bounded envelope. The text lane maps to a deterministic
    //    insert-at-top-of-body request (index 1) — INSERT semantics only (THE-955 r1 F2):
    //    there is no replace path, and every constructed request is re-checked against the
    //    declared kind set before the transport call (typed fail-closed guard).
    const requests: GoogleDocsBatchRequest[] = [
      { kind: 'insertText', location: { index: 1 }, text: input.mutation.text },
    ];
    for (const req of requests) {
      if (!DECLARED_DOCS_REQUEST_KINDS.has(req.kind)) {
        throw new UnsupportedAdapterMutationError(
          capability,
          `request kind ${req.kind} is outside the Google Docs adapter's declared envelope ` +
            `(insert-only semantics; no replace_text path); failing closed`,
        );
      }
    }
    try {
      const response = this.transport.batchUpdate({
        documentId: input.external_id,
        requests,
        expectedRevision: input.expectedRevision,
      });
      const resultRevision = requireSafeReportedRevision(response.revisionId);
      const descriptor = await this.requireMetadata(input.external_id, 'document');
      return { descriptor, priorRevision: input.expectedRevision, resultRevision };
    } catch (e) {
      // 6. Standard conflict response (R-025): transport conflicts map to the typed,
      //    retryable, provider-neutral StaleRevisionError — never a blind retry.
      if (e instanceof GoogleTransportConflictError) {
        throw new StaleRevisionError(e.expectedRevision, e.currentRevision);
      }
      throw e;
    }
  }

  async getVersions(input: GetVersionsInput): Promise<GetVersionsResult> {
    const descriptor = await this.requireMetadata(input.external_id, 'document');
    return {
      versions: [
        {
          revision: descriptor.current_revision ?? '',
          observed_at: descriptor.provider_modified_at,
        },
      ],
    };
  }

  async getPreview(_input: GetPreviewInput): Promise<GetPreviewResult> {
    // Honest: preview is not implemented on this adapter yet (T-038/T-039 deferred surfaces).
    return { state: 'unsupported', previewUrl: null };
  }

  async getPermissions(_input: GetPermissionsInput): Promise<GetPermissionsResult> {
    // Honest: permission introspection is outside the declared T-014 surface.
    return { summary_json: JSON.stringify({ summary: 'unavailable', reason: 'not_implemented' }) };
  }

  async getOpenTarget(input: OpenTargetInput): Promise<OpenTargetResult> {
    const metadata = this.transport.getDocument({ documentId: input.external_id });
    if (!metadata) {
      throw new AdapterArtifactNotFoundError(input.external_id);
    }
    this.remember(metadata.documentId, 'document');
    return {
      provider: 'google_workspace',
      artifact_type: this.known.get(metadata.documentId)?.artifact_type as OpenTargetResult['artifact_type'],
      url: metadata.url,
    };
  }

  async reconcileChanges(input: ReconcileChangesInput): Promise<ReconcileChangesResult> {
    // Dedupe discovered items by external_id (first wins, deterministic) and compute the
    // known-but-absent set. Idempotent over identical passes (§19.2).
    const seen = new Map<string, ProviderArtifactDescriptor>();
    for (const item of input.discovered) {
      if (!seen.has(item.external_id)) {
        seen.set(item.external_id, item);
      }
      this.remember(item.external_id, item.artifact_type);
    }
    const dropped: string[] = [];
    for (const known of this.known.keys()) {
      if (!seen.has(known)) {
        dropped.push(known);
      }
    }
    return { reconciled: [...seen.values()], dropped };
  }
}

/** Construct the Google Docs adapter. The transport MUST be injected — there is no default. */
export function createGoogleDocsAdapter(options: GoogleDocsAdapterOptions): DocumentProviderAdapter {
  return new GoogleDocsAdapter(options);
}
