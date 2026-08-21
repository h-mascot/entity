/**
 * THE-956 (T-015) — Google Sheets create/bounded-range-mutate provider adapter.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - T-015 acceptance: "Same required task contract as T-014, applied to spreadsheet/range
 *     semantics." / "Not done until: range targeting and revision behavior pass."
 *   - §12.4 Spreadsheet range mutation: the canonical `set_range` shape
 *     (`sheet` / `range` / `values`). The adapter rejects — never reinterprets — when the
 *     transport cannot safely perform a STRUCTURED range mutation.
 *   - T-005 DocumentProviderAdapter contract (../types); rows R-004/R-005/R-007.
 *   - D-012 / R-024 / R-025: every mutation carries an expected provider revision; stale or
 *     unknown revisions are rejected with the typed, retryable StaleRevisionError.
 *
 * Determinism / security posture (mirrors the T-014 Google Docs adapter):
 *   - TRANSPORT IS INJECTED. No network I/O, no credentials, no tenant data in this module.
 *     Tests supply a deterministic stateful fake transport only.
 *   - FAIL-CLOSED: unknown/degraded/unauthorized connection state folds every capability
 *     from LIVE connection state (T-014 F1 lesson — no hardcoded `supported`); any
 *     side-effecting action re-checks the advertised report via
 *     `assertAdapterActionSupported`.
 *   - BOUNDED MUTATION: only the declared structured `setRange` envelope is ever forwarded;
 *     text and slide lanes fail closed with typed UnsupportedAdapterMutationError.
 *   - RANGE TARGETING validated BEFORE any transport write: selector well-formed AND within the
 *     documented A1 bounds/ordering (row ≤ 1048576, start ≤ end; r2 T1), multi-cell ranges
 *     typed-rejected (the single-value lane cannot express them; r2 C2), an omitted sheet
 *     resolves to the FIRST workbook tab (Google A1 semantics; r2 C1), sheet exists, values
 *     rectangular and type-bounded (enforced; r2 T2d).
 *   - Revision-token strictness at the boundary (THE-950 r2 F2 extended unsafe set) on both
 *     client-supplied expectedRevision and transport-reported tokens.
 *   - Stable identity: `external_id` IS the durable Google spreadsheet id — never a locally
 *     minted UUID. Entity-side stable URL mapping stays the T-004/T-008 registry machinery.
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
 * Typed errors specific to the Google Sheets adapter boundary.
 * ============================================================================= */

/** Transport-level optimistic-concurrency conflict, mapped to the neutral StaleRevisionError. */
export class GoogleSheetsTransportConflictError extends Error {
  readonly expectedRevision: string;
  readonly currentRevision: string;
  readonly retryable = true;
  constructor(expectedRevision: string, currentRevision: string) {
    super(
      `google sheets transport reported a revision conflict ` +
        `(expectedRevision=${JSON.stringify(expectedRevision)}, ` +
        `currentRevision=${JSON.stringify(currentRevision)})`,
    );
    this.name = 'GoogleSheetsTransportConflictError';
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

/* =============================================================================
 * Transport surface (injected; the ONLY I/O boundary of this adapter).
 * ============================================================================= */

/** Metadata for one Google Sheet tab (worksheet) inside a spreadsheet. */
export interface GoogleSheetTabMetadata {
  title: string;
}

/** Metadata for one Google Spreadsheet as reported by the transport. */
export interface GoogleSpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  url: string | null;
  /** Provider revision token (opaque). Validated for unsafe characters at the boundary. */
  revisionId: string;
  /** RFC 3339 provider modification timestamp. */
  modifiedTime: string;
  /** Sheet tabs present in the workbook (range-targeting evidence). */
  sheets: readonly GoogleSheetTabMetadata[];
}

/** A single cell value: strictly type-bounded (§12.4 values payload). */
export type SheetsCellValue = string | number | boolean | null;

/**
 * The DECLARED, bounded range-mutation envelope — the §12.4 `set_range` shape:
 * `sheet` (tab title) / `range` (A1 bounds within that tab) / `values` (rectangular grid).
 * Only this request kind is ever forwarded by the mutate lane.
 */
export interface GoogleSheetsSetRangeRequest {
  kind: 'setRange';
  sheet: string;
  /** Well-formed A1 range within `sheet`, e.g. `A1` or `A1:B2`. */
  range: string;
  /** Rectangular, type-bounded grid; row lengths MUST all equal the range width. */
  values: SheetsCellValue[][];
}

/** THE-950-r2-style fail-closed guard set: the exact kinds this adapter may forward. */
export const DECLARED_SHEETS_REQUEST_KINDS: ReadonlySet<string> = new Set(['setRange']);

/**
 * Minimal Google Sheets transport the adapter needs. Real implementations wrap the Google
 * APIs; tests inject a deterministic stateful fake. NO default transport exists —
 * constructing the adapter without a transport is a compile-time impossibility.
 */
export interface GoogleSheetsTransport {
  createSpreadsheet(input: {
    title: string;
    parent?: string | null;
    idempotencyKey?: string;
  }): { spreadsheet: GoogleSpreadsheetMetadata; created: boolean };
  getSpreadsheet(input: { spreadsheetId: string }): GoogleSpreadsheetMetadata | null;
  /**
   * STRUCTURED range mutation (§12.4). A transport that cannot perform structured range
   * mutation simply does not provide this method; the adapter then rejects every `set_range`
   * attempt with a typed UnsupportedAdapterMutationError instead of reinterpreting.
   */
  valuesBatchUpdate?(input: {
    spreadsheetId: string;
    requests: GoogleSheetsSetRangeRequest[];
    expectedRevision: string;
  }): { spreadsheetId: string; revisionId: string; responses: unknown[] };
}

export interface GoogleSheetsAdapterOptions {
  transport: GoogleSheetsTransport;
  /** Optional destination folder id forwarded on creates (never a local filesystem path). */
  parentFolderId?: string | null;
}

/* =============================================================================
 * Revision-token strictness (THE-950 r2 F2 / THE-956 r2 C3 — canonical SHARED set).
 * ============================================================================= */

/**
 * THE-956 r2 (C3): the forbidden-character class is the canonical shared class exported from
 * `../revision-coordinator` (same constant consumed by docs-adapter and the coordinator's
 * sanitizer; equivalence pinned by test). Relative to the previous sheets-local set this is a
 * TIGHTENING only: C1 controls (U+0080–U+009F), zero-width format characters U+200B–U+200D,
 * and the injection metacharacters `'` `&` `\\` are now also rejected at this boundary.
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
 * Range targeting validation (§12.4) — pure functions, fully unit-testable, no transport.
 * ============================================================================= */

const A1_RANGE_PATTERN = /^[A-Za-z]{1,3}[1-9][0-9]{0,6}(?::[A-Za-z]{1,3}[1-9][0-9]{0,6})?$/;

/** True when the string is a well-formed single-tab A1 range (`A1` … `A1:B1048576`). */
export function isWellFormedA1Range(range: string): boolean {
  return A1_RANGE_PATTERN.test(range);
}

/** True when the grid is rectangular (non-empty, every row the same length). */
export function isRectangularValues(values: SheetsCellValue[][]): boolean {
  if (!Array.isArray(values) || values.length === 0) return false;
  if (!Array.isArray(values[0]) || values[0].length === 0) return false;
  const width = values[0].length;
  return values.every((row) => Array.isArray(row) && row.length === width);
}

/** True when every cell value is within the §12.4 type bound (string|number|boolean|null). */
export function isTypeBoundedValues(values: SheetsCellValue[][]): boolean {
  return values.every((row) =>
    row.every(
      (cell) =>
        cell === null || typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean',
    ),
  );
}

/**
 * Parse the T-005 range-lane `cell` selector into a (sheet, a1Range) pair.
 * Accepted forms: `A1`, `Sheet1!A1`, `'Q3 Budget'!A1:B2`. Returns null when malformed, out of
 * the documented bounds, or reversed — use {@link classifyA1Range} for the specific reason.
 */
export function parseCellSelector(cell: string): { sheet: string | null; range: string } | null {
  const match = /^(?:'([^']+)'|([A-Za-z0-9_.]+))?!(.+)$/.exec(cell);
  if (match) {
    const sheet = match[1] ?? match[2] ?? null;
    const range = match[3];
    return sheet !== null && isWellFormedA1Range(range) && classifyA1Range(range) === 'ok'
      ? { sheet, range }
      : null;
  }
  return isWellFormedA1Range(cell) && classifyA1Range(cell) === 'ok' ? { sheet: null, range: cell } : null;
}

/** In-tree documented A1 row bound (Google Sheets grid height; module comment since r1). */
export const MAX_A1_ROW = 1048576;

export type A1RangeClassification = 'ok' | 'malformed' | 'row_out_of_bounds' | 'reversed';

function a1CellParts(cell: string): { col: string; row: number } | null {
  const m = /^([A-Za-z]{1,3})([1-9][0-9]{0,6})$/.exec(cell);
  return m ? { col: m[1].toUpperCase(), row: Number(m[2]) } : null;
}

function a1ColumnNumber(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * Classify an A1 range against the in-tree documented rules (THE-956 r2 T1):
 *   - 'malformed': not matching the A1 shape at all;
 *   - 'row_out_of_bounds': any referenced row exceeds {@link MAX_A1_ROW} (1048576);
 *   - 'reversed': the start cell is after the end cell on either axis;
 *   - 'ok': usable as a range target.
 * No column bound beyond the 1–3 letter pattern is enforced: no wider column limit is
 * documented in-tree (observation recorded in EVIDENCE).
 */
export function classifyA1Range(range: string): A1RangeClassification {
  if (!A1_RANGE_PATTERN.test(range)) return 'malformed';
  const [startCell, endCell] = range.split(':');
  const start = a1CellParts(startCell)!;
  const end = endCell ? a1CellParts(endCell)! : start;
  if (start.row > MAX_A1_ROW || end.row > MAX_A1_ROW) return 'row_out_of_bounds';
  if (a1ColumnNumber(start.col) > a1ColumnNumber(end.col) || start.row > end.row) return 'reversed';
  return 'ok';
}

/* =============================================================================
 * Capability honesty (R-002/D-003): static support matrix folded with live connection state.
 * ============================================================================= */

/** Capabilities this adapter genuinely implements against the Sheets surface. */
const SUPPORTED_CAPABILITIES: ReadonlySet<string> = new Set([
  'create',
  'read',
  'open_external',
  'human_edit',
  'agent_range_mutation',
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
 * Artifact-type mapping (bounded: the Sheets surface covers spreadsheets only).
 * ============================================================================= */

const SUPPORTED_ARTIFACT_TYPES: ReadonlySet<string> = new Set(['spreadsheet']);

/* =============================================================================
 * Adapter.
 * ============================================================================= */

class GoogleSheetsAdapter implements DocumentProviderAdapter {
  readonly provider: DocumentProvider = 'google_workspace';
  private readonly transport: GoogleSheetsTransport;
  private readonly parentFolderId: string | null;
  /** Adapter-local index of artifacts this instance has created or observed (stable identity). */
  private readonly known = new Map<string, ProviderArtifactDescriptor['artifact_type']>();

  constructor(options: GoogleSheetsAdapterOptions) {
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
    // Fail-closed precedence (mirrors docs-adapter / T-005 fake-adapter semantics):
    // `unauthorized` dominates; then `degraded`; unanimous `authorized` is the only
    // authorized outcome; otherwise the conservative non-actionable `unknown`.
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
      [
        'agent_range_mutation',
        // THE-956 §12.4: the range lane additionally requires a transport capable of
        // STRUCTURED range mutation; without it the lane fails closed even on an authorized
        // connection (reject, never reinterpret).
        SUPPORTED_CAPABILITIES.has('agent_range_mutation') && this.hasStructuredRangeMutation()
          ? live
          : 'unsupported',
      ],
      ['agent_slide_mutation', 'unsupported'],
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
            ? `${name} is outside the Google Sheets adapter's declared surface`
            : undefined,
      };
    }
    return report;
  }

  /** Whether the injected transport can perform structured range mutation (§12.4). */
  private hasStructuredRangeMutation(): boolean {
    return typeof this.transport.valuesBatchUpdate === 'function';
  }

  private descriptorFor(metadata: GoogleSpreadsheetMetadata): ProviderArtifactDescriptor {
    const revision = requireSafeReportedRevision(metadata.revisionId);
    const auth = this.connectionState();
    const artifactType =
      this.known.get(metadata.spreadsheetId) ?? ('spreadsheet' as ProviderArtifactDescriptor['artifact_type']);
    return {
      provider: 'google_workspace',
      artifact_type: artifactType,
      external_id: metadata.spreadsheetId,
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
    const metadata = this.transport.getSpreadsheet({ spreadsheetId: externalId });
    if (!metadata) {
      throw new AdapterArtifactNotFoundError(externalId);
    }
    this.remember(metadata.spreadsheetId, 'spreadsheet');
    return this.descriptorFor(metadata);
  }

  async discover(input: DiscoverDocumentsInput): Promise<DiscoverDocumentsResult> {
    // Discovery enumerates the artifacts THIS adapter instance knows about via the injected
    // transport. No wildcard tenant listing.
    const limit = input.limit ?? Number.POSITIVE_INFINITY;
    const items: ProviderArtifactDescriptor[] = [];
    for (const [externalId, artifactType] of this.known.entries()) {
      if (items.length >= limit) break;
      const metadata = this.transport.getSpreadsheet({ spreadsheetId: externalId });
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
        `artifact_type ${input.artifact_type} is outside the Google Sheets adapter's declared surface`,
      );
    }
    const { spreadsheet, created } = this.transport.createSpreadsheet({
      title: input.title,
      parent: this.parentFolderId,
      idempotencyKey: input.idempotencyKey,
    });
    this.remember(spreadsheet.spreadsheetId, input.artifact_type);
    // Create-time revision capture IS strict: an unsafe create-response token rejects the
    // create outright (descriptorFor runs requireSafeReportedRevision).
    const descriptor = this.descriptorFor(spreadsheet);
    return { descriptor, created };
  }

  async read(input: ReadDocumentInput): Promise<ReadDocumentResult> {
    const report = await this.resolveCapabilities({
      provider: this.provider,
      artifact_type: 'spreadsheet',
      connectionState: this.connectionState(),
      destinationId: null,
      runtime: {},
    });
    assertAdapterActionSupported(report, 'read', 'read');
    const descriptor = this.requireMetadata(input.external_id);
    // Privacy (D-013): a synthetic placeholder — never real document contents.
    return {
      descriptor,
      contentPlaceholder: `[placeholder: google_workspace spreadsheet ${descriptor.external_id}]`,
    };
  }

  async mutate(input: MutateDocumentInput): Promise<MutateDocumentResult> {
    // 1. Lane/capability gate FIRST: text and slide lanes are outside the Sheets declared
    //    envelope and fail closed before any transport interaction (bounded mutation).
    const capability = input.mutation.kind === 'range' ? 'agent_range_mutation' : input.mutation.kind === 'text' ? 'agent_text_mutation' : 'agent_slide_mutation';
    if (input.mutation.kind !== 'range') {
      throw new UnsupportedAdapterMutationError(
        capability,
        `mutation lane ${capability} is outside the Google Sheets adapter's declared ` +
          `set_range envelope (range-only); failing closed`,
      );
    }
    const report = await this.resolveCapabilities({
      provider: this.provider,
      artifact_type: 'spreadsheet',
      connectionState: this.connectionState(),
      destinationId: null,
      runtime: {},
    });
    assertAdapterActionSupported(report, capability, `mutate(${capability})`);

    // 2. Structured-range-mutation capability probe: a transport that cannot do §12.4
    //    structured range mutation gets a TYPED rejection — never a reinterpretation. The
    //    method reference is captured once so the strict null check also narrows the call.
    const valuesBatchUpdate = this.transport.valuesBatchUpdate;
    if (typeof valuesBatchUpdate !== 'function') {
      throw new UnsupportedAdapterMutationError(
        capability,
        'the injected transport cannot perform structured range mutation (set_range); ' +
          'the Google Sheets adapter rejects rather than reinterprets',
      );
    }

    // 3. Token strictness on the client-supplied precondition (THE-950 r2 F2).
    requireSafeExpectedRevision(input.expectedRevision);

    // 4. Resolve the artifact ONCE (minor ii: no second untyped getSpreadsheet below); unknown
    //    identities never proceed to a transport write.
    const workbookMetadata = this.transport.getSpreadsheet({ spreadsheetId: input.external_id });
    if (!workbookMetadata) {
      throw new AdapterArtifactNotFoundError(input.external_id);
    }
    this.remember(workbookMetadata.spreadsheetId, 'spreadsheet');
    const current = this.descriptorFor(workbookMetadata);

    // 5. Local optimistic-concurrency precondition (D-012 / R-024).
    if (current.current_revision !== input.expectedRevision) {
      throw new StaleRevisionError(input.expectedRevision, current.current_revision ?? '');
    }

    // 6. RANGE TARGETING VALIDATION (§12.4) BEFORE any transport write:
    //    selector well-formed AND within the documented bounds and ordering (r2 T1), target
    //    tab exists, values rectangular and type-bounded (enforced, not just constructed).
    const parsed = parseCellSelector(input.mutation.cell);
    if (!parsed) {
      // T-015 r2 T1: report the SPECIFIC reason (right-reason rejections, not lookup accidents).
      const bang = input.mutation.cell.indexOf('!');
      const rangePart = bang >= 0 ? input.mutation.cell.slice(bang + 1) : input.mutation.cell;
      const classification = classifyA1Range(rangePart);
      const detail =
        classification === 'row_out_of_bounds'
          ? `row exceeds the documented A1 bound (${MAX_A1_ROW})`
          : classification === 'reversed'
            ? 'range start is after its end (reversed)'
            : `expected [']Sheet'[!]A1[:B2]`;
      throw new UnsupportedAdapterMutationError(
        capability,
        `malformed range target ${JSON.stringify(input.mutation.cell)}: ${detail}; failing closed`,
      );
    }
    // T-015 r2 C2: the T-005 range lane carries exactly ONE value, so it can only ever express
    // a SINGLE-cell §12.4 set_range. A multi-cell range forwarded with a 1×1 grid would perform
    // a silent partial write under real values.update semantics — typed-reject instead.
    if (parsed.range.includes(':')) {
      throw new UnsupportedAdapterMutationError(
        capability,
        `multi-cell range ${JSON.stringify(parsed.range)} cannot be expressed by the single-value ` +
          `range lane (§12.4 set_range requires a full rectangular values grid); failing closed ` +
          `instead of a partial write`,
      );
    }
    // T-015 r2 C1 (reviewer-sanctioned option (a)): an OMITTED sheet resolves to the FIRST
    // sheet from workbook metadata (Google A1 semantics) — never to the workbook title, which
    // silently targeted a same-named tab or failed on typical workbooks.
    const targetSheet = parsed.sheet ?? workbookMetadata.sheets[0]?.title;
    if (targetSheet === undefined || !workbookMetadata.sheets.some((s) => s.title === targetSheet)) {
      throw new UnsupportedAdapterMutationError(
        capability,
        `range targeting rejected: sheet ${JSON.stringify(targetSheet ?? null)} does not exist in ` +
          `workbook ${input.external_id}; failing closed`,
      );
    }
    const values: SheetsCellValue[][] = [[input.mutation.value]];
    // T-015 r2 T2(d): the grid helpers are ENFORCED on the outbound envelope before any
    // transport write (defense in depth over the statically-typed construction).
    if (!isRectangularValues(values) || !isTypeBoundedValues(values)) {
      throw new UnsupportedAdapterMutationError(
        capability,
        'values grid violates the §12.4 rectangularity/type bound; failing closed',
      );
    }
    const request: GoogleSheetsSetRangeRequest = {
      kind: 'setRange',
      sheet: targetSheet,
      range: parsed.range,
      values,
    };
    if (!DECLARED_SHEETS_REQUEST_KINDS.has(request.kind)) {
      throw new UnsupportedAdapterMutationError(
        capability,
        `request kind ${request.kind} is outside the Google Sheets adapter's declared envelope`,
      );
    }
    try {
      const response = valuesBatchUpdate.call(this.transport, {
        spreadsheetId: input.external_id,
        requests: [request],
        expectedRevision: input.expectedRevision,
      });
      const resultRevision = requireSafeReportedRevision(response.revisionId);
      const descriptor = this.requireMetadata(input.external_id);
      return { descriptor, priorRevision: input.expectedRevision, resultRevision };
    } catch (e) {
      // 7. Standard conflict response (R-025): transport conflicts map to the typed,
      //    retryable, provider-neutral StaleRevisionError — never a blind retry.
      if (e instanceof GoogleSheetsTransportConflictError) {
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
    // Honest: permission introspection is outside the declared T-015 surface.
    return { summary_json: JSON.stringify({ summary: 'unavailable', reason: 'not_implemented' }) };
  }

  async getOpenTarget(input: OpenTargetInput): Promise<OpenTargetResult> {
    const metadata = this.transport.getSpreadsheet({ spreadsheetId: input.external_id });
    if (!metadata) {
      throw new AdapterArtifactNotFoundError(input.external_id);
    }
    this.remember(metadata.spreadsheetId, 'spreadsheet');
    return {
      provider: 'google_workspace',
      artifact_type: this.known.get(metadata.spreadsheetId) ?? 'spreadsheet',
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

/** Construct the Google Sheets adapter. The transport MUST be injected — there is no default. */
export function createGoogleSheetsAdapter(options: GoogleSheetsAdapterOptions): DocumentProviderAdapter {
  return new GoogleSheetsAdapter(options);
}
