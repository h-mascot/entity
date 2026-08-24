/**
 * THE-957 (T-016) — Google Slides create/bounded-slide-text-mutate provider adapter.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - T-016 acceptance: "Same required task contract as T-014, applied to presentation/element
 *     semantics." (create; stable Entity URL; bounded mutation; revision capture; conflict
 *     rejection; rows R-004/R-005/R-007 + R-006 Slides lane).
 *   - §12.5 Presentation mutation: the canonical `update_slide_text` shape
 *     (`slideRef` / `elementRef` / `text`); "Exact slide/element addressing is adapter/engine
 *     dependent and must use stable identifiers whenever supported."
 *   - T-005 DocumentProviderAdapter contract (../types); rows R-004/R-005/R-007.
 *   - D-012 / R-024 / R-025: every mutation carries an expected provider revision; stale or
 *     unknown revisions are rejected with the typed, retryable StaleRevisionError.
 *
 * Determinism / security posture (mirrors the T-014/T-015 Google adapters):
 *   - TRANSPORT IS INJECTED. No network I/O, no credentials, no tenant data in this module.
 *     Tests supply a deterministic stateful fake transport only.
 *   - FAIL-CLOSED: unknown/degraded/unauthorized connection state folds every capability
 *     from LIVE connection state (no hardcoded `supported`); any side-effecting action
 *     re-checks the advertised report via `assertAdapterActionSupported`.
 *   - BOUNDED MUTATION: only the declared structured `updateSlideText` envelope is ever
 *     forwarded; text and range lanes fail closed with typed UnsupportedAdapterMutationError.
 *   - SLIDE/ELEMENT TARGETING validated BEFORE any transport write: the slide exists, the
 *     element reference is well-formed AND present on the slide, and the text payload is
 *     type-bounded. Unsupported or out-of-surface operations are typed-rejected — the adapter
 *     rejects, never reinterprets (no silent semantic substitution).
 *   - Revision-token strictness at the boundary (canonical shared UNSAFE_REVISION_TOKEN_CHARACTERS,
 *     THE-956 r2 C3) on both client-supplied expectedRevision and transport-reported tokens;
 *     raw tokens never appear in error messages (hex code point only).
 *   - Stable identity: `external_id` IS the durable Google presentation id — never a locally
 *     minted UUID. Entity-side stable URL mapping stays the T-004/T-008 registry machinery.
 *
 * Lane-payload note (recorded observation): the T-005 slide lane carries ONLY `slideId`
 * (../types AdapterMutation), while §12.5 requires slideRef + elementRef + text. Mirroring the
 * Sheets compound-selector precedent (`Sheet1!A1` parsed from the single `cell` field), the
 * slideId ACCEPTS a JSON-encoded §12.5 envelope `{"slideRef","elementRef","text"}` (all three
 * required, exact key set, string-typed). A bare slide id with no encoded payload is NOT
 * silently reinterpreted (e.g. as a title clear) — it is typed-rejected, because no faithful
 * §12.5 operation can be constructed from a slide id alone.
 */

import type {
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
  StaleRevisionError,
  UnsupportedAdapterMutationError,
} from '../types';
// Shared adapter-boundary token strictness types live with the Docs adapter (same Google
// boundary semantics; one typed error class so route mapping stays single-sourced).
import { UnsafeRevisionTokenError } from './docs-adapter';
import { UNSAFE_REVISION_TOKEN_CHARACTERS } from '../revision-coordinator';
import type { DocumentAuthState, DocumentProvider } from '../../../../db/src/document-integrations';

/* =============================================================================
 * Typed errors specific to the Google Slides adapter boundary.
 * ============================================================================= */

/** Transport-level optimistic-concurrency conflict, mapped to the neutral StaleRevisionError. */
export class GoogleSlidesTransportConflictError extends Error {
  readonly expectedRevision: string;
  readonly currentRevision: string;
  readonly retryable = true;
  constructor(expectedRevision: string, currentRevision: string) {
    super(
      `google slides transport reported a revision conflict ` +
        `(expectedRevision=${JSON.stringify(expectedRevision)}, ` +
        `currentRevision=${JSON.stringify(currentRevision)})`,
    );
    this.name = 'GoogleSlidesTransportConflictError';
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

/* =============================================================================
 * Transport surface (injected; the ONLY I/O boundary of this adapter).
 * ============================================================================= */

/** Metadata for one element on a slide (stable provider element id). */
export interface GoogleSlideElementMetadata {
  objectId: string;
}

/** Metadata for one slide inside a presentation (stable provider slide id). */
export interface GoogleSlideMetadata {
  objectId: string;
  elements: readonly GoogleSlideElementMetadata[];
}

/** Metadata for one Google Presentation as reported by the transport. */
export interface GooglePresentationMetadata {
  presentationId: string;
  title: string;
  url: string | null;
  /** Provider revision token (opaque). Validated for unsafe characters at the boundary. */
  revisionId: string;
  /** RFC 3339 provider modification timestamp. */
  modifiedTime: string;
  /** Slides present in the presentation (slide/element-targeting evidence). */
  slides: readonly GoogleSlideMetadata[];
}

/**
 * The DECLARED, bounded slide-text-mutation envelope — the §12.5 `update_slide_text` shape:
 * `slideRef` (stable slide id) / `elementRef` (stable element id) / `text` (type-bounded).
 * Only this request kind is ever forwarded by the mutate lane.
 */
export interface GoogleSlidesUpdateSlideTextRequest {
  kind: 'updateSlideText';
  slideRef: string;
  elementRef: string;
  text: string;
}

/** THE-950-r2-style fail-closed guard set: the exact kinds this adapter may forward. */
export const DECLARED_SLIDES_REQUEST_KINDS: ReadonlySet<string> = new Set(['updateSlideText']);

/**
 * Type bound on the §12.5 text payload. The PRD documents no numeric bound (observation
 * recorded in EVIDENCE); this module-enforced bound keeps the forwarded envelope bounded and
 * deterministic. Exceeding it is a typed rejection, never a truncation.
 */
export const MAX_SLIDE_TEXT_LENGTH = 10_000;

/**
 * Minimal Google Slides transport the adapter needs. Real implementations wrap the Google
 * APIs; tests inject a deterministic stateful fake. NO default transport exists —
 * constructing the adapter without a transport is a compile-time impossibility.
 */
export interface GoogleSlidesTransport {
  createPresentation(input: {
    title: string;
    parent?: string | null;
    idempotencyKey?: string;
  }): { presentation: GooglePresentationMetadata; created: boolean };
  getPresentation(input: { presentationId: string }): GooglePresentationMetadata | null;
  /**
   * STRUCTURED slide-text mutation (§12.5). A transport that cannot perform structured slide
   * mutation simply does not provide this method; the adapter then rejects every
   * `update_slide_text` attempt with a typed UnsupportedAdapterMutationError instead of
   * reinterpreting.
   */
  batchUpdate?(input: {
    presentationId: string;
    requests: GoogleSlidesUpdateSlideTextRequest[];
    expectedRevision: string;
  }): { presentationId: string; revisionId: string; responses: unknown[] };
}

export interface GoogleSlidesAdapterOptions {
  transport: GoogleSlidesTransport;
  /** Optional destination folder id forwarded on creates (never a local filesystem path). */
  parentFolderId?: string | null;
}

/* =============================================================================
 * Revision-token strictness (THE-950 r2 F2 / THE-956 r2 C3 — canonical SHARED set).
 * ============================================================================= */

/**
 * THE-956 r2 (C3): the forbidden-character class is the canonical shared class exported from
 * `../revision-coordinator` (same constant consumed by docs-adapter, sheets-adapter and the
 * coordinator's sanitizer; equivalence pinned by test). Raw tokens NEVER appear in error
 * messages — only the hex code point of the first offending character.
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

function requireSafeExpectedRevision(token: string): void {
  const bad = firstUnsafeCodePoint(token);
  if (bad !== null || token.length === 0) {
    throw new UnsafeRevisionTokenError('expectedRevision', bad ?? 0);
  }
}

function requireSafeReportedRevision(token: string): string {
  const bad = firstUnsafeCodePoint(token);
  if (bad !== null || token.length === 0) {
    throw new UnsafeRevisionTokenError('reportedRevision', bad ?? 0);
  }
  return token;
}

/* =============================================================================
 * Slide/element targeting validation (§12.5) — pure functions, fully unit-testable.
 * ============================================================================= */

/** Stable provider identifiers: non-empty, printable, no control/injection characters. */
const STABLE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export function isWellFormedStableId(id: string): boolean {
  return STABLE_ID_PATTERN.test(id);
}

export function isTypeBoundedSlideText(text: string): boolean {
  return typeof text === 'string' && text.length <= MAX_SLIDE_TEXT_LENGTH;
}

/**
 * Parse the T-005 slide-lane `slideId` into the §12.5 `update_slide_text` envelope.
 *
 * Accepted form ONLY: a JSON object with EXACTLY the keys `slideRef`, `elementRef`, `text`
 * (all string-valued, non-empty slideRef/elementRef passing {@link isWellFormedStableId}).
 * Anything else — including a bare slide id with no encoded payload — returns null: the
 * caller (mutate lane) then typed-rejects instead of silently substituting semantics.
 */
export function parseSlideTextSelector(
  slideId: string,
): { slideRef: string; elementRef: string; text: string } | null {
  if (!slideId.startsWith('{')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(slideId);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.length !== 3 || keys[0] !== 'elementRef' || keys[1] !== 'slideRef' || keys[2] !== 'text') {
    return null;
  }
  const { slideRef, elementRef, text } = obj;
  if (
    typeof slideRef !== 'string' ||
    typeof elementRef !== 'string' ||
    typeof text !== 'string' ||
    !isWellFormedStableId(slideRef) ||
    !isWellFormedStableId(elementRef) ||
    !isTypeBoundedSlideText(text)
  ) {
    return null;
  }
  return { slideRef, elementRef, text };
}

/* =============================================================================
 * Capability honesty (R-002/D-003): static support matrix folded with live connection state.
 * ============================================================================= */

/** Capabilities this adapter genuinely implements against the Slides surface. */
const SUPPORTED_CAPABILITIES: ReadonlySet<string> = new Set([
  'create',
  'read',
  'open_external',
  'human_edit',
  'agent_slide_mutation',
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
 * Artifact-type mapping (bounded: the Slides surface covers presentations only).
 * ============================================================================= */

const SUPPORTED_ARTIFACT_TYPES: ReadonlySet<string> = new Set(['presentation']);

/* =============================================================================
 * Adapter.
 * ============================================================================= */

class GoogleSlidesAdapter implements DocumentProviderAdapter {
  readonly provider: DocumentProvider = 'google_workspace';
  private readonly transport: GoogleSlidesTransport;
  private readonly parentFolderId: string | null;
  /** Adapter-local index of artifacts this instance has created or observed (stable identity). */
  private readonly known = new Map<string, ProviderArtifactDescriptor['artifact_type']>();

  constructor(options: GoogleSlidesAdapterOptions) {
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
    const worst: DocumentAuthState = states.some((s) => s === 'unauthorized')
      ? 'unauthorized'
      : states.some((s) => s === 'degraded')
        ? 'degraded'
        : states.every((s) => s === 'authorized')
          ? 'authorized'
          : 'unknown';
    const live = foldConnectionState(worst);
    const report = {} as CapabilityReport;
    const vocabulary: Array<[keyof CapabilityReport & string, string]> = [
      ['create', SUPPORTED_CAPABILITIES.has('create') ? live : 'unsupported'],
      ['read', SUPPORTED_CAPABILITIES.has('read') ? live : 'unsupported'],
      ['preview', 'unsupported'],
      ['thumbnail', 'unsupported'],
      ['open_external', SUPPORTED_CAPABILITIES.has('open_external') ? live : 'unsupported'],
      ['human_edit', SUPPORTED_CAPABILITIES.has('human_edit') ? live : 'unsupported'],
      ['agent_text_mutation', 'unsupported'],
      ['agent_range_mutation', 'unsupported'],
      [
        'agent_slide_mutation',
        // §12.5: the slide lane additionally requires a transport capable of STRUCTURED slide
        // mutation; without it the lane fails closed even on an authorized connection
        // (reject, never reinterpret).
        SUPPORTED_CAPABILITIES.has('agent_slide_mutation') && this.hasStructuredSlideMutation()
          ? live
          : 'unsupported',
      ],
      ['version_history', 'unsupported'],
      ['change_tracking', 'unsupported'],
      ['permission_read', 'unsupported'],
      ['permission_write', 'unsupported'],
      ['embed_editor', 'unsupported'],
      ['export', 'unsupported'],
    ];
    for (const [name, state] of vocabulary) {
      (report as Record<string, unknown>)[name] = {
        name,
        state,
        source: 'adapter',
        reasonCode: state === 'unsupported' ? 'adapter_not_implemented' : undefined,
        reason:
          state === 'unsupported'
            ? `${name} is outside the Google Slides adapter's declared surface`
            : undefined,
      };
    }
    return report;
  }

  /** Whether the injected transport can perform structured slide mutation (§12.5). */
  private hasStructuredSlideMutation(): boolean {
    return typeof this.transport.batchUpdate === 'function';
  }

  private descriptorFor(metadata: GooglePresentationMetadata): ProviderArtifactDescriptor {
    const revision = requireSafeReportedRevision(metadata.revisionId);
    const auth = this.connectionState();
    const artifactType =
      this.known.get(metadata.presentationId) ??
      ('presentation' as ProviderArtifactDescriptor['artifact_type']);
    return {
      provider: 'google_workspace',
      artifact_type: artifactType,
      external_id: metadata.presentationId,
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

  private remember(externalId: string, artifactType: ProviderArtifactDescriptor['artifact_type']): void {
    if (!this.known.has(externalId)) {
      this.known.set(externalId, artifactType);
    }
  }

  private requireMetadata(externalId: string): ProviderArtifactDescriptor {
    const metadata = this.transport.getPresentation({ presentationId: externalId });
    if (!metadata) {
      throw new AdapterArtifactNotFoundError(externalId);
    }
    this.remember(metadata.presentationId, 'presentation');
    return this.descriptorFor(metadata);
  }

  async discover(input: DiscoverDocumentsInput): Promise<DiscoverDocumentsResult> {
    // Discovery enumerates the artifacts THIS adapter instance knows about via the injected
    // transport. No wildcard tenant listing.
    const limit = input.limit ?? Number.POSITIVE_INFINITY;
    const items: ProviderArtifactDescriptor[] = [];
    for (const [externalId, artifactType] of this.known.entries()) {
      if (items.length >= limit) break;
      const metadata = this.transport.getPresentation({ presentationId: externalId });
      if (metadata) {
        items.push(this.descriptorFor(metadata));
      } else {
        this.remember(externalId, artifactType);
      }
    }
    return { items, truncated: this.known.size > items.length };
  }

  async getMetadata(input: GetDocumentMetadataInput): Promise<ProviderArtifactDescriptor | null> {
    try {
      return this.requireMetadata(input.external_id);
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

    if (!SUPPORTED_ARTIFACT_TYPES.has(input.artifact_type)) {
      throw new UnsupportedAdapterMutationError(
        'create',
        `artifact_type ${input.artifact_type} is outside the Google Slides adapter's declared surface`,
      );
    }
    const { presentation, created } = this.transport.createPresentation({
      title: input.title,
      parent: this.parentFolderId,
      idempotencyKey: input.idempotencyKey,
    });
    this.remember(presentation.presentationId, input.artifact_type);
    // Create-time revision capture IS strict: an unsafe create-response token rejects the
    // create outright (descriptorFor runs requireSafeReportedRevision).
    const descriptor = this.descriptorFor(presentation);
    return { descriptor, created };
  }

  async read(input: ReadDocumentInput): Promise<ReadDocumentResult> {
    const report = await this.resolveCapabilities({
      provider: this.provider,
      artifact_type: 'presentation',
      connectionState: this.connectionState(),
      destinationId: null,
      runtime: {},
    });
    assertAdapterActionSupported(report, 'read', 'read');
    const descriptor = this.requireMetadata(input.external_id);
    // Privacy (D-013): a synthetic placeholder — never real document contents.
    return {
      descriptor,
      contentPlaceholder: `[placeholder: google_workspace presentation ${descriptor.external_id}]`,
    };
  }

  async mutate(input: MutateDocumentInput): Promise<MutateDocumentResult> {
    // 1. Lane/capability gate FIRST: text and range lanes are outside the Slides declared
    //    envelope and fail closed before any transport interaction (bounded mutation).
    const capability =
      input.mutation.kind === 'slide'
        ? 'agent_slide_mutation'
        : input.mutation.kind === 'text'
          ? 'agent_text_mutation'
          : 'agent_range_mutation';
    if (input.mutation.kind !== 'slide') {
      throw new UnsupportedAdapterMutationError(
        capability,
        `mutation lane ${capability} is outside the Google Slides adapter's declared ` +
          `update_slide_text envelope (slide-only); failing closed`,
      );
    }
    const report = await this.resolveCapabilities({
      provider: this.provider,
      artifact_type: 'presentation',
      connectionState: this.connectionState(),
      destinationId: null,
      runtime: {},
    });
    assertAdapterActionSupported(report, capability, `mutate(${capability})`);

    // 2. Structured-slide-mutation capability probe: a transport that cannot do §12.5
    //    structured slide mutation gets a TYPED rejection — never a reinterpretation.
    const batchUpdate = this.transport.batchUpdate;
    if (typeof batchUpdate !== 'function') {
      throw new UnsupportedAdapterMutationError(
        capability,
        'the injected transport cannot perform structured slide mutation (update_slide_text); ' +
          'the Google Slides adapter rejects rather than reinterprets',
      );
    }

    // 3. Token strictness on the client-supplied precondition (THE-950 r2 F2).
    requireSafeExpectedRevision(input.expectedRevision);

    // 4. Resolve the artifact ONCE; unknown identities never proceed to a transport write.
    const presentationMetadata = this.transport.getPresentation({ presentationId: input.external_id });
    if (!presentationMetadata) {
      throw new AdapterArtifactNotFoundError(input.external_id);
    }
    this.remember(presentationMetadata.presentationId, 'presentation');
    const current = this.descriptorFor(presentationMetadata);

    // 5. Local optimistic-concurrency precondition (D-012 / R-024).
    if (current.current_revision !== input.expectedRevision) {
      throw new StaleRevisionError(input.expectedRevision, current.current_revision ?? '');
    }

    // 6. SLIDE/ELEMENT TARGETING VALIDATION (§12.5) BEFORE any transport write:
    //    the selector must decode to the exact §12.5 envelope; the slide must exist; the
    //    element reference must be well-formed AND present on that slide; the text payload
    //    must be type-bounded. A bare slide id (no encoded payload) is typed-rejected — no
    //    silent semantic substitution (e.g. no implicit title clear).
    const parsed = parseSlideTextSelector(input.mutation.slideId);
    if (!parsed) {
      throw new UnsupportedAdapterMutationError(
        capability,
        'slide targeting rejected: the slide lane carries only slideId, so a faithful §12.5 ' +
          'update_slide_text requires the JSON-encoded {slideRef, elementRef, text} envelope; ' +
          'a bare slide id or malformed envelope cannot be forwarded without substituting ' +
          'semantics — failing closed',
      );
    }
    const targetSlide = presentationMetadata.slides.find((s) => s.objectId === parsed.slideRef);
    if (!targetSlide) {
      throw new UnsupportedAdapterMutationError(
        capability,
        `slide targeting rejected: slide ${JSON.stringify(parsed.slideRef)} does not exist in ` +
          `presentation ${input.external_id}; failing closed`,
      );
    }
    if (!targetSlide.elements.some((el) => el.objectId === parsed.elementRef)) {
      throw new UnsupportedAdapterMutationError(
        capability,
        `slide targeting rejected: element ${JSON.stringify(parsed.elementRef)} does not exist on ` +
          `slide ${JSON.stringify(parsed.slideRef)}; failing closed`,
      );
    }
    if (!isTypeBoundedSlideText(parsed.text)) {
      throw new UnsupportedAdapterMutationError(
        capability,
        `text payload violates the §12.5 type bound (length ${parsed.text.length} exceeds ` +
          `${MAX_SLIDE_TEXT_LENGTH}); failing closed instead of truncating`,
      );
    }
    const request: GoogleSlidesUpdateSlideTextRequest = {
      kind: 'updateSlideText',
      slideRef: parsed.slideRef,
      elementRef: parsed.elementRef,
      text: parsed.text,
    };
    if (!DECLARED_SLIDES_REQUEST_KINDS.has(request.kind)) {
      throw new UnsupportedAdapterMutationError(
        capability,
        `request kind ${request.kind} is outside the Google Slides adapter's declared envelope`,
      );
    }
    try {
      const response = batchUpdate.call(this.transport, {
        presentationId: input.external_id,
        requests: [request],
        expectedRevision: input.expectedRevision,
      });
      const resultRevision = requireSafeReportedRevision(response.revisionId);
      const descriptor = this.requireMetadata(input.external_id);
      return { descriptor, priorRevision: input.expectedRevision, resultRevision };
    } catch (e) {
      // 7. Standard conflict response (R-025): transport conflicts map to the typed,
      //    retryable, provider-neutral StaleRevisionError — never a blind retry.
      if (e instanceof GoogleSlidesTransportConflictError) {
        throw new StaleRevisionError(e.expectedRevision, e.currentRevision);
      }
      throw e;
    }
  }

  async getVersions(input: GetVersionsInput): Promise<GetVersionsResult> {
    const descriptor = this.requireMetadata(input.external_id);
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
    // Honest: permission introspection is outside the declared T-016 surface.
    return { summary_json: JSON.stringify({ summary: 'unavailable', reason: 'not_implemented' }) };
  }

  async getOpenTarget(input: OpenTargetInput): Promise<OpenTargetResult> {
    const metadata = this.transport.getPresentation({ presentationId: input.external_id });
    if (!metadata) {
      throw new AdapterArtifactNotFoundError(input.external_id);
    }
    this.remember(metadata.presentationId, 'presentation');
    return {
      provider: 'google_workspace',
      artifact_type: this.known.get(metadata.presentationId) ?? 'presentation',
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

/** Construct the Google Slides adapter. The transport MUST be injected — there is no default. */
export function createGoogleSlidesAdapter(options: GoogleSlidesAdapterOptions): DocumentProviderAdapter {
  return new GoogleSlidesAdapter(options);
}
