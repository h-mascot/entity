/**
 * THE-956 (T-015) — Google Sheets create/range-mutate adapter — tests.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - T-015 acceptance: "Same required task contract as T-014, applied to spreadsheet/range
 *     semantics." / "Not done until: range targeting and revision behavior pass."
 *   - §12.4 Spreadsheet range mutation (`set_range`: sheet / range / values).
 *   - T-005 adapter contract + R-002 capability honesty; R-024/R-025 (D-012) revisions.
 *
 * Determinism / no network: the Google Sheets adapter takes its TRANSPORT as an injected
 * dependency and performs no real HTTP calls. Tests use a deterministic stateful fake
 * transport only — no real Google, no credentials, no tenant data, no operator-specific
 * absolute paths.
 *
 * NOTE on the shared §19.2 fixture: `runAdapterContractSuite` fixes its create input to
 * `artifact_type: 'document'` and its success-path mutations to the TEXT lane — both are
 * outside the Sheets adapter's honestly-declared surface (spreadsheets + range-only). The
 * suite cannot be parameterized without editing out-of-path files, so the equivalent §19.2
 * contract elements (register/discover, metadata, create/read/mutate when supported,
 * unsupported-mutation rejection, revision capture, stale-write rejection, preview/
 * permission normalization, open target, degradation, idempotent reconciliation) are each
 * covered below against the spreadsheet/range semantics. See EVIDENCE T-015.
 */

import { describe, expect, it } from 'vitest';
import type {
  AdapterMutation,
  CreateDocumentInput,
  DocumentProviderAdapter,
} from '../types';
import {
  AdapterArtifactNotFoundError,
  StaleRevisionError,
  UnsupportedAdapterMutationError,
} from '../types';
import {
  createGoogleSheetsAdapter,
  GoogleSheetsTransportConflictError,
  DECLARED_SHEETS_REQUEST_KINDS,
  isRectangularValues,
  isTypeBoundedValues,
  isWellFormedA1Range,
  parseCellSelector,
  type GoogleSheetsSetRangeRequest,
  type GoogleSheetsTransport,
  type SheetsCellValue,
  type GoogleSpreadsheetMetadata,
} from './sheets-adapter';
import { UnsafeRevisionTokenError } from './docs-adapter';
import type { DocumentAuthState } from '../../../../db/src/document-integrations';

/* ============================================================================
 * Deterministic fake transport.
 * ============================================================================ */

const T015_FIXED_NOW = '2026-08-18T00:00:00.000Z';

interface FakeWorkbook {
  spreadsheetId: string;
  title: string;
  revision: string;
  modifiedTime: string;
  sheets: Array<{ title: string }>;
}

class DeterministicGoogleSheetsTransport implements GoogleSheetsTransport {
  private workbooks = new Map<string, FakeWorkbook>();
  private byIdempotency = new Map<string, string>();
  private seq = 0;
  private revSeq = 0;
  connectionState: DocumentAuthState = 'authorized';
  /** When true, valuesBatchUpdate always reports a stale-revision conflict (negative). */
  forceEveryMutationConflict = false;
  /** When true, getSpreadsheet returns null for every id (vanished artifact). */
  vanishAll = false;
  /** Record of every structured range-mutation envelope forwarded (bounded proof). */
  recordedRangeUpdates: Array<{ spreadsheetId: string; requests: GoogleSheetsSetRangeRequest[] }> = [];
  /** Override revision generation (inject unsafe/benign reported revision values). */
  nextReportedRevision?: () => string;

  private nextRevision(): string {
    this.revSeq += 1;
    return `sheets-rev-${this.revSeq}`;
  }

  createSpreadsheet(input: {
    title: string;
    parent?: string | null;
    idempotencyKey?: string;
  }): { spreadsheet: GoogleSpreadsheetMetadata; created: boolean } {
    if (input.idempotencyKey && this.byIdempotency.has(input.idempotencyKey)) {
      const id = this.byIdempotency.get(input.idempotencyKey)!;
      return { spreadsheet: this.metaFor(this.workbooks.get(id)!), created: false };
    }
    this.seq += 1;
    const spreadsheetId = `google-sheet-${this.seq}`;
    const wb: FakeWorkbook = {
      spreadsheetId,
      title: input.title,
      revision: this.nextReportedRevision ? this.nextReportedRevision() : this.nextRevision(),
      modifiedTime: T015_FIXED_NOW,
      sheets: [{ title: 'Sheet1' }],
    };
    this.workbooks.set(spreadsheetId, wb);
    if (input.idempotencyKey) this.byIdempotency.set(input.idempotencyKey, spreadsheetId);
    return { spreadsheet: this.metaFor(wb), created: true };
  }

  getSpreadsheet(input: { spreadsheetId: string }): GoogleSpreadsheetMetadata | null {
    if (this.vanishAll) return null;
    const wb = this.workbooks.get(input.spreadsheetId);
    return wb ? this.metaFor(wb) : null;
  }

  valuesBatchUpdate(input: {
    spreadsheetId: string;
    requests: GoogleSheetsSetRangeRequest[];
    expectedRevision: string;
  }): { spreadsheetId: string; revisionId: string; responses: unknown[] } {
    const wb = this.workbooks.get(input.spreadsheetId);
    if (!wb) {
      throw new AdapterArtifactNotFoundError(input.spreadsheetId);
    }
    // The transport itself only accepts the declared envelope (bounded-mutation defense).
    for (const req of input.requests) {
      if (!DECLARED_SHEETS_REQUEST_KINDS.has(req.kind)) {
        throw new Error(`transport rejects undeclared request kind: ${req.kind}`);
      }
    }
    this.recordedRangeUpdates.push({ spreadsheetId: input.spreadsheetId, requests: input.requests });
    if (this.forceEveryMutationConflict || input.expectedRevision !== wb.revision) {
      throw new GoogleSheetsTransportConflictError(input.expectedRevision, wb.revision);
    }
    const newRevision = this.nextReportedRevision ? this.nextReportedRevision() : this.nextRevision();
    this.workbooks.set(input.spreadsheetId, { ...wb, revision: newRevision });
    return { spreadsheetId: input.spreadsheetId, revisionId: newRevision, responses: [] };
  }

  private metaFor(wb: FakeWorkbook): GoogleSpreadsheetMetadata {
    return {
      spreadsheetId: wb.spreadsheetId,
      title: wb.title,
      url: `https://docs.google.com/spreadsheets/d/${wb.spreadsheetId}/edit`,
      revisionId: this.nextReportedRevision ? this.nextReportedRevision() : wb.revision,
      modifiedTime: wb.modifiedTime,
      sheets: wb.sheets,
    };
  }
}

function makeAdapter(options: {
  transport?: GoogleSheetsTransport;
  parentFolderId?: string | null;
} = {}): {
  adapter: DocumentProviderAdapter;
  transport: DeterministicGoogleSheetsTransport;
} {
  // The stripped-transport negative passes a transport view; tests that use the returned
  // `transport` handle always use the full deterministic fake (default).
  const transport = (options.transport ?? new DeterministicGoogleSheetsTransport()) as DeterministicGoogleSheetsTransport;
  const adapter = createGoogleSheetsAdapter({ transport, parentFolderId: options.parentFolderId });
  return { adapter, transport };
}

function sheetCreateInput(overrides: Partial<CreateDocumentInput> = {}): CreateDocumentInput {
  return {
    artifact_type: 'spreadsheet',
    title: 'Q3 Budget Model',
    idempotencyKey: 't015-create-1',
    ...overrides,
  };
}

function rangeMutation(cell = 'Sheet1!A1', value: string = 'revised'): AdapterMutation {
  return { kind: 'range', cell, value };
}

/* ============================================================================
 * Acceptance element: create.
 * ============================================================================ */

describe('T-015 Google Sheets adapter — create', () => {
  it('create returns a provider descriptor with stable provider identity (spreadsheet artifact)', async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.create(sheetCreateInput());
    expect(result.created).toBe(true);
    expect(result.descriptor.provider).toBe('google_workspace');
    expect(result.descriptor.artifact_type).toBe('spreadsheet');
    expect(result.descriptor.external_id).toMatch(/^google-sheet-/);
    expect(result.descriptor.provider_url).toContain('docs.google.com/spreadsheets/');
    expect(result.descriptor.current_revision).toMatch(/^sheets-rev-/);
    expect(result.descriptor.conflict_state).toBe('none');
  });

  it('create replay with the same idempotency key reconciles (created:false) — R-026', async () => {
    const { adapter } = makeAdapter();
    const first = await adapter.create(sheetCreateInput({ idempotencyKey: 't015-replay' }));
    const second = await adapter.create(sheetCreateInput({ idempotencyKey: 't015-replay' }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.descriptor.external_id).toBe(first.descriptor.external_id);
    expect(second.descriptor.current_revision).toBe(first.descriptor.current_revision);
  });

  it('create fails closed when the create capability is not actionable (degraded connection)', async () => {
    const { adapter, transport } = makeAdapter();
    transport.connectionState = 'degraded';
    await expect(adapter.create(sheetCreateInput())).rejects.toBeInstanceOf(
      UnsupportedAdapterMutationError,
    );
  });

  it('create fails closed for an artifact_type outside the Sheets surface (documents are the Docs adapter\'s)', async () => {
    const { adapter } = makeAdapter();
    await expect(
      adapter.create(sheetCreateInput({ artifact_type: 'document' })),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });
});

/* ============================================================================
 * Acceptance element: stable Entity identity mapping (adapter-side half).
 * ============================================================================ */

describe('T-015 Google Sheets adapter — stable provider identity across create/read', () => {
  it('read/getMetadata return the SAME external_id and revision after create (stable identity)', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(sheetCreateInput());
    const read = await adapter.read({ external_id: created.descriptor.external_id });
    expect(read.descriptor.external_id).toBe(created.descriptor.external_id);
    expect(read.descriptor.current_revision).toBe(created.descriptor.current_revision);
    const meta = await adapter.getMetadata({ external_id: created.descriptor.external_id });
    expect(meta?.external_id).toBe(created.descriptor.external_id);
    expect(meta?.provider).toBe('google_workspace');
    expect(await adapter.getMetadata({ external_id: 'nope' })).toBeNull();
    await expect(adapter.read({ external_id: 'nope' })).rejects.toBeInstanceOf(
      AdapterArtifactNotFoundError,
    );
  });

  it('discover enumerates known artifacts with limit/truncation semantics', async () => {
    const { adapter } = makeAdapter();
    await adapter.create(sheetCreateInput({ idempotencyKey: 't015-d-1', title: 'D1' }));
    await adapter.create(sheetCreateInput({ idempotencyKey: 't015-d-2', title: 'D2' }));
    const all = await adapter.discover({});
    expect(all.items.length).toBe(2);
    expect(all.truncated).toBe(false);
    const limited = await adapter.discover({ limit: 1 });
    expect(limited.items.length).toBe(1);
    expect(limited.truncated).toBe(true);
  });
});

/* ============================================================================
 * Acceptance element: bounded range mutation (§12.4 set_range).
 * ============================================================================ */

describe('T-015 Google Sheets adapter — bounded range mutation', () => {
  it('mutate forwards ONLY the declared structured set_range envelope for the range lane', async () => {
    const { adapter, transport } = makeAdapter();
    const created = await adapter.create(sheetCreateInput());
    transport.recordedRangeUpdates = [];
    const result = await adapter.mutate({
      external_id: created.descriptor.external_id,
      expectedRevision: created.descriptor.current_revision ?? '',
      mutation: rangeMutation(),
      idempotencyKey: 't015-mut-1',
    });
    expect(result.priorRevision).toBe(created.descriptor.current_revision);
    expect(result.resultRevision).not.toBe(result.priorRevision);
    const received = transport.recordedRangeUpdates;
    expect(received.length).toBe(1);
    expect(received[0].spreadsheetId).toBe(created.descriptor.external_id);
    expect(received[0].requests).toEqual([
      { kind: 'setRange', sheet: 'Sheet1', range: 'A1', values: [['revised']] },
    ]);
  });

  it('text mutation (outside the sheets declared envelope) FAILS CLOSED with a typed error', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(sheetCreateInput());
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: { kind: 'text', text: 'x' },
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });

  it('slide mutation (outside the sheets declared envelope) FAILS CLOSED with a typed error', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(sheetCreateInput());
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: { kind: 'slide', slideId: 's1' },
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });

  it('a transport WITHOUT structured range mutation gets a TYPED rejection — never reinterpretation (§12.4)', async () => {
    // RED at base by construction: the guard exists precisely for this shape.
    const bare = new DeterministicGoogleSheetsTransport();
    const { adapter } = makeAdapter({ transport: stripRangeMutation(bare) });
    const created = await adapter.create(sheetCreateInput());
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: rangeMutation(),
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });

  it('capability honesty: range mutation advertised, text/slide honestly unsupported', async () => {
    const { adapter } = makeAdapter();
    const report = await adapter.resolveCapabilities({
      provider: 'google_workspace',
      artifact_type: 'spreadsheet',
      connectionState: 'authorized',
      destinationId: null,
      runtime: {},
    });
    expect(report.create.state).toBe('supported');
    expect(report.read.state).toBe('supported');
    expect(report.agent_range_mutation.state).toBe('supported');
    expect(report.agent_text_mutation.state).toBe('unsupported');
    expect(report.agent_slide_mutation.state).toBe('unsupported');
    expect(report.embed_editor.state).toBe('unsupported');
  });
});

/* ============================================================================
 * Acceptance element: RANGE TARGETING validation (before any transport write).
 * ============================================================================ */

describe('T-015 Google Sheets adapter — range targeting', () => {
  it('rejects a target whose sheet does not exist in the workbook (fail-closed, no write)', async () => {
    const { adapter, transport } = makeAdapter();
    const created = await adapter.create(sheetCreateInput());
    transport.recordedRangeUpdates = [];
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: rangeMutation('NoSuchSheet!A1'),
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
    expect(transport.recordedRangeUpdates.length).toBe(0); // nothing reached the transport
  });

  it.each(['A0', '1A', 'AAAA1', 'A1:B', 'Sheet1!', '', 'A1:C1048577'])(
    'rejects malformed A1 selector %j before any transport write',
    async (cell) => {
      const { adapter, transport } = makeAdapter();
      const created = await adapter.create(sheetCreateInput());
      transport.recordedRangeUpdates = [];
      await expect(
        adapter.mutate({
          external_id: created.descriptor.external_id,
          expectedRevision: created.descriptor.current_revision ?? '',
          mutation: rangeMutation(cell),
        }),
      ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
      expect(transport.recordedRangeUpdates.length).toBe(0);
    },
  );

  it('accepts well-formed selectors including quoted sheet names and bare ranges', () => {
    expect(parseCellSelector('A1')).toEqual({ sheet: null, range: 'A1' });
    expect(parseCellSelector('Sheet1!B2:C3')).toEqual({ sheet: 'Sheet1', range: 'B2:C3' });
    expect(parseCellSelector("'Q3 Budget'!A1")).toEqual({ sheet: 'Q3 Budget', range: 'A1' });
    expect(isWellFormedA1Range('A1')).toBe(true);
    expect(isWellFormedA1Range('AA10')).toBe(true);
    expect(isWellFormedA1Range('A0')).toBe(false);
  });

  it('value-grid helpers enforce rectangularity and the §12.4 type bound', () => {
    expect(isRectangularValues([['a', 1], [true, null]])).toBe(true);
    expect(isRectangularValues([['a', 1], [true]])).toBe(false);
    expect(isRectangularValues([])).toBe(false);
    expect(isTypeBoundedValues([['a', 1, true, null]])).toBe(true);
    expect(isTypeBoundedValues([[{ bad: true }]] as unknown as SheetsCellValue[][])).toBe(false);
  });
});

/* ============================================================================
 * Acceptance element: revision capture.
 * ============================================================================ */

describe('T-015 Google Sheets adapter — revision capture', () => {
  it('every create/mutate populates the provider revision token, observable via fresh read', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(sheetCreateInput());
    expect(created.descriptor.current_revision).toMatch(/^sheets-rev-/);
    const afterMutate = await adapter.mutate({
      external_id: created.descriptor.external_id,
      expectedRevision: created.descriptor.current_revision ?? '',
      mutation: rangeMutation(),
    });
    expect(afterMutate.resultRevision).toMatch(/^sheets-rev-/);
    expect(afterMutate.descriptor.current_revision).toBe(afterMutate.resultRevision);
    const read = await adapter.read({ external_id: created.descriptor.external_id });
    expect(read.descriptor.current_revision).toBe(afterMutate.resultRevision);
  });
});

/* ============================================================================
 * Acceptance element: conflict rejection.
 * ============================================================================ */

describe('T-015 Google Sheets adapter — conflict rejection', () => {
  it('mutation against a STALE revision token fails closed with a typed conflict error', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(sheetCreateInput());
    const stale = created.descriptor.current_revision ?? '';
    await adapter.mutate({
      external_id: created.descriptor.external_id,
      expectedRevision: stale,
      mutation: rangeMutation('Sheet1!A1', 'v2'),
    });
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: stale,
        mutation: rangeMutation('Sheet1!A1', 'stale-v2'),
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it('mutation against an UNKNOWN revision token fails closed with a typed conflict error', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(sheetCreateInput());
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: 'sheets-rev-DOES-NOT-EXIST',
        mutation: rangeMutation(),
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it('transport conflict maps to the typed provider-neutral StaleRevisionError (retryable)', async () => {
    const { adapter, transport } = makeAdapter();
    const created = await adapter.create(sheetCreateInput());
    transport.forceEveryMutationConflict = true;
    try {
      await adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: rangeMutation(),
      });
      throw new Error('expected conflict');
    } catch (e) {
      expect(e).toBeInstanceOf(StaleRevisionError);
      const sre = e as StaleRevisionError;
      expect(sre.retryable).toBe(true);
      expect(sre.expectedRevision).toBe(created.descriptor.current_revision);
      expect(sre.currentRevision).toBe(created.descriptor.current_revision);
    }
  });
});

/* ============================================================================
 * Revision-token strictness at the adapter boundary (THE-950 r2 F2 extended set).
 * ============================================================================ */

describe('T-015 adapter-boundary revision-token strictness (THE-950 r2 F2)', () => {
  it.each([
    { label: 'LRI U+2066', char: '\u2066' },
    { label: 'PDI U+2069', char: '\u2069' },
    { label: 'BOM U+FEFF', char: '\ufeff' },
    { label: 'Word Joiner U+2060', char: '\u2060' },
    { label: 'Soft Hyphen U+00AD', char: '\u00ad' },
    { label: 'Arabic Letter Mark U+061C', char: '\u061c' },
    { label: 'HTML injection <', char: '<' },
  ])('mutate rejects an expectedRevision containing $label with UnsafeRevisionTokenError', async ({ char }) => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(sheetCreateInput());
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: `${created.descriptor.current_revision}${char}`,
        mutation: rangeMutation(),
      }),
    ).rejects.toBeInstanceOf(UnsafeRevisionTokenError);
  });

  it('an UNSAFE create-response revision token rejects the CREATE outright (fail-closed at create time)', async () => {
    const { adapter, transport } = makeAdapter();
    transport.nextReportedRevision = () => 'rev\u2066';
    await expect(adapter.create(sheetCreateInput())).rejects.toBeInstanceOf(UnsafeRevisionTokenError);
  });

  it('a benign opaque revision token is accepted (not over-restricted)', async () => {
    const { adapter, transport } = makeAdapter();
    transport.nextReportedRevision = () => 'rev_17QkAaiFhyZK871Jozj6w';
    const created = await adapter.create(sheetCreateInput());
    expect(created.descriptor.current_revision).toMatch(/^rev_17/);
  });
});

/* ============================================================================
 * Capability honesty / fail-closed folds (T-014 F1 lesson applied to EVERY lane).
 * ============================================================================ */

describe('T-015 Google Sheets adapter — live-state capability folds & fail-closed', () => {
  it.each<DocumentAuthState>(['degraded', 'unauthorized', 'unknown'])(
    'a %s connection degrades or fails closed EVERY normally-supported lane (no hardcoded supported)',
    async (state) => {
      const { adapter, transport } = makeAdapter();
      const created = await adapter.create(sheetCreateInput());
      transport.connectionState = state;
      const report = await adapter.resolveCapabilities({
        provider: 'google_workspace',
        artifact_type: 'spreadsheet',
        connectionState: state,
        destinationId: null,
        runtime: {},
      });
      for (const name of ['create', 'read', 'open_external', 'human_edit', 'agent_range_mutation'] as const) {
        if (state === 'degraded') {
          expect(report[name].state, name).toBe('degraded');
        } else {
          // unauthorized/unknown must NEVER lift a lane to supported.
          expect(report[name].state, name).not.toBe('supported');
        }
      }
      // Writes fail closed outright on any non-authorized state.
      await expect(adapter.create(sheetCreateInput({ idempotencyKey: 't015-neg' }))).rejects.toBeInstanceOf(
        UnsupportedAdapterMutationError,
      );
      await expect(
        adapter.mutate({
          external_id: created.descriptor.external_id,
          expectedRevision: created.descriptor.current_revision ?? '',
          mutation: rangeMutation(),
        }),
      ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
    },
  );

  it('read-like lanes normalize deterministically and descriptors never leak contents/credentials', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(sheetCreateInput());
    const ext = created.descriptor.external_id;
    const preview = adapter.getPreview ? await adapter.getPreview({ external_id: ext }) : null;
    if (preview) {
      expect(['not_requested', 'pending', 'ready', 'failed', 'unsupported']).toContain(preview.state);
    }
    const open = await adapter.getOpenTarget({ external_id: ext });
    expect(open.provider).toBe('google_workspace');
    expect(open.url).toContain('docs.google.com/spreadsheets/');
    if (adapter.getVersions) {
      const versions = await adapter.getVersions({ external_id: ext });
      expect(versions.versions.length).toBeGreaterThanOrEqual(1);
      expect(versions.versions[0].revision).toBeTruthy();
    }
    const serialized = JSON.stringify([created.descriptor]);
    expect(serialized).not.toMatch(/Bearer|token|secret|credentials/i);
  });

  it('reconcileChanges dedupes deterministically and reports dropped ids (§19.2 idempotence)', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(sheetCreateInput());
    const discovered = (await adapter.discover({})).items;
    const pass1 = await adapter.reconcileChanges({ discovered });
    const pass2 = await adapter.reconcileChanges({ discovered });
    expect(pass1.reconciled.map((d) => d.external_id)).toEqual(pass2.reconciled.map((d) => d.external_id));
    expect(pass1.dropped).toEqual([]);
    const vanished = await adapter.reconcileChanges({ discovered: [] });
    expect(vanished.dropped).toEqual([created.descriptor.external_id]);
  });
});

/* ============================================================================
 * Helpers.
 * ============================================================================ */

/** Produce a transport view WITHOUT structured range mutation (typed-reject negative). */
function stripRangeMutation(
  t: DeterministicGoogleSheetsTransport,
): Omit<GoogleSheetsTransport, 'valuesBatchUpdate'> {
  // Preserve prototype methods (createSpreadsheet, getSpreadsheet, …) while removing the
  // structured range-mutation method itself — a plain object spread of a class instance
  // would silently drop every prototype method, changing what this harness is meant to
  // isolate.
  // Shadow the prototype method with an own `undefined` property: `delete` cannot remove
  // an inherited method, so we mask it instead — `typeof stripped.valuesBatchUpdate` is no
  // longer 'function', which is exactly the capability probe the adapter uses.
  const stripped = Object.assign(Object.create(Object.getPrototypeOf(t)), t) as DeterministicGoogleSheetsTransport;
  (stripped as Partial<GoogleSheetsTransport>).valuesBatchUpdate = undefined;
  return stripped;
}
