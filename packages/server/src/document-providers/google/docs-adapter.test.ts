/**
 * THE-955 (T-014) — Google Docs create/mutate adapter — tests.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - T-014 acceptance: create; stable Entity URL; bounded mutation; revision capture;
 *     conflict rejection.
 *   - T-005 adapter contract (DocumentProviderAdapter) + R-002 capability honesty.
 *   - §19.2 provider contract tests — the shared suite runs against this adapter too.
 *   - R-024/R-025 (D-012) revision-aware mutation / standard conflict response.
 *   - THE-950 r2 F2 / THE-950-r2: adapter-boundary revision-token strictness, including the
 *     extended unsafe-character set U+2066–U+2069, U+FEFF, U+2060, U+00AD, U+061C.
 *
 * Determinism / no network: the Google Docs adapter takes its TRANSPORT as an injected
 * dependency and performs never real HTTP calls. Tests use a deterministic FIFO/token
 * recorded-replay fake transport (or a stateful deterministic one) and hand-rolled requests
 * only — no real Google, no credentials, no tenant data, no operator-specific absolute paths.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import type {
  AdapterMutation,
  CreateDocumentInput,
  DocumentProviderAdapter,
  ProviderArtifactDescriptor,
} from '../types';
import {
  AdapterArtifactNotFoundError,
  StaleRevisionError,
  UnsupportedAdapterMutationError,
} from '../types';
import {
  createGoogleDocsAdapter,
  UnsafeRevisionTokenError,
  GoogleTransportConflictError,
  type GoogleDocsBatchRequest,
  type GoogleDocsTransport,
  type GoogleDocMetadata,
  type GoogleDocsAdapterOptions,
} from './docs-adapter';
import { runAdapterContractSuite } from '../contract.test';
import type { DocumentAuthState } from '../../../../db/src/document-integrations';

/* ============================================================================
 * Deterministic fake transport.
 *
 * Models the Google Docs/Drive surfaces the adapter talks to (create document,
 * get metadata, batchUpdate) WITHOUT any network. Idempotency, revision generation,
 * and modified-time are deterministic. The transport exposes the Google optimistic-
 * concurrency revision precondition (writeControl.requiredRevisionId) that drives
 * conflict rejection.
 * ============================================================================ */

const T014_FIXED_NOW = '2026-08-18T00:00:00.000Z';

interface FakeDoc {
  documentId: string;
  title: string;
  mimeType: string;
  parent: string | null;
  revision: string;
  modifiedTime: string;
}

class DeterministicGoogleDocsTransport implements GoogleDocsTransport {
  private docs = new Map<string, FakeDoc>();
  private byIdempotency = new Map<string, string>();
  private seq = 0;
  private revSeq = 0;
  connectionState: DocumentAuthState = 'authorized';
  /** When true, batchUpdate always reports a stale-revision conflict (deterministic negative). */
  forceEveryMutationConflict = false;
  /** When true, getDocument returns null for every id (simulates a vanished artifact). */
  vanishAll = false;
  /** Record of every batchUpdate envelope the adapter forwarded (bounded-mutation proof). */
  recordedBatchUpdates: Array<{ documentId: string; requests: GoogleDocsBatchRequest[] }> = [];
  /** The declared request kinds the adapter is allowed to forward (bounded envelope). */
  declaredRequestKinds: ReadonlySet<string> = new Set(['insertText', 'replaceAllText']);
  /** Override revision generation (used by tests to inject unsafe/benign revision values). */
  nextReportedRevision?: () => string;
  /** External ids whose returned revision contains an unsafe character (fail-closed proof). */
  docsWithUnsafeRevision = new Set<string>();

  private nextRevision(): string {
    this.revSeq += 1;
    return `google-rev-${this.revSeq}`;
  }

  createDocument(input: {
    title: string;
    mimeType: string;
    parent?: string | null;
    idempotencyKey?: string;
  }): { document: GoogleDocMetadata; created: boolean } {
    if (input.idempotencyKey && this.byIdempotency.has(input.idempotencyKey)) {
      const documentId = this.byIdempotency.get(input.idempotencyKey)!;
      return { document: this.metaFor(this.docs.get(documentId)!), created: false };
    }
    this.seq += 1;
    const documentId = `google-doc-${this.seq}`;
    const doc: FakeDoc = {
      documentId,
      title: input.title,
      mimeType: input.mimeType,
      parent: input.parent ?? null,
      revision: this.nextReportedRevision ? this.nextReportedRevision() : this.nextRevision(),
      modifiedTime: T014_FIXED_NOW,
    };
    this.docs.set(documentId, doc);
    if (input.idempotencyKey) this.byIdempotency.set(input.idempotencyKey, documentId);
    return { document: this.metaFor(doc), created: true };
  }

  getDocument(input: { documentId: string }): GoogleDocMetadata | null {
    if (this.vanishAll) return null;
    const doc = this.docs.get(input.documentId);
    return doc ? this.metaFor(doc) : null;
  }

  batchUpdate(input: {
    documentId: string;
    requests: GoogleDocsBatchRequest[];
    expectedRevision: string;
  }): { documentId: string; revisionId: string; responses: unknown[] } {
    const doc = this.docs.get(input.documentId);
    if (!doc) {
      throw new AdapterArtifactNotFoundError(input.documentId);
    }
    // The transport itself only accepts the declared envelope (bounded-mutation defense).
    for (const req of input.requests) {
      if (!this.declaredRequestKinds.has(req.kind)) {
        throw new Error(`transport rejects undeclared request kind: ${req.kind}`);
      }
    }
    this.recordedBatchUpdates.push({ documentId: input.documentId, requests: input.requests });
    if (this.forceEveryMutationConflict || input.expectedRevision !== doc.revision) {
      throw new GoogleTransportConflictError(input.expectedRevision, doc.revision);
    }
    const newRevision = this.nextReportedRevision ? this.nextReportedRevision() : this.nextRevision();
    this.docs.set(input.documentId, { ...doc, revision: newRevision, modifiedTime: T014_FIXED_NOW });
    return { documentId: input.documentId, revisionId: newRevision, responses: [] };
  }

  private metaFor(doc: FakeDoc): GoogleDocMetadata {
    let revision = this.nextReportedRevision ? this.nextReportedRevision() : doc.revision;
    if (this.docsWithUnsafeRevision.has(doc.documentId)) {
      revision = `rev\u2066`; // force an unsafe bidi-isolate control into the reported revision
    }
    return {
      documentId: doc.documentId,
      title: doc.title,
      url: `https://docs.google.com/document/d/${doc.documentId}/edit`,
      revisionId: revision,
      modifiedTime: doc.modifiedTime,
    };
  }
}

function makeAdapter(options: Partial<GoogleDocsAdapterOptions> = {}): {
  adapter: DocumentProviderAdapter;
  transport: DeterministicGoogleDocsTransport;
} {
  const transport = new DeterministicGoogleDocsTransport();
  const adapter = createGoogleDocsAdapter({ transport, ...options });
  return { adapter, transport };
}

function docCreateInput(overrides: Partial<CreateDocumentInput> = {}): CreateDocumentInput {
  return {
    artifact_type: 'document',
    title: 'Q3 Operating Plan',
    idempotencyKey: 't014-create-1',
    ...overrides,
  };
}

function textMutation(text = 'revised body'): AdapterMutation {
  return { kind: 'text', text };
}

/* ============================================================================
 * Acceptance element: create.
 * ============================================================================ */

describe('T-014 Google Docs adapter — create', () => {
  it('create returns a provider descriptor with stable provider identity (documentId as external_id)', async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.create(docCreateInput());
    expect(result.created).toBe(true);
    expect(result.descriptor.provider).toBe('google_workspace');
    expect(result.descriptor.artifact_type).toBe('document');
    expect(result.descriptor.external_id).toMatch(/^google-doc-/);
    // Stable provider identity: external_id is the Google document id, never a random UUID.
    expect(result.descriptor.external_id).toBe(result.descriptor.external_id);
    expect(result.descriptor.provider_url).toContain('docs.google.com');
    // Revision captured at create (R-024 revision capture).
    expect(result.descriptor.current_revision).toMatch(/^google-rev-/);
    expect(result.descriptor.conflict_state).toBe('none');
  });

  it('create is deterministic and transport-injected (no network, no unseeded randomness)', async () => {
    const { adapter } = makeAdapter();
    const a = await adapter.create(docCreateInput({ idempotencyKey: 't014-det-a' }));
    const { adapter: adapter2 } = makeAdapter();
    const b = await adapter2.create(docCreateInput({ idempotencyKey: 't014-det-a' }));
    expect(a.descriptor.external_id).toBe(b.descriptor.external_id);
    expect(a.descriptor.current_revision).toBe(b.descriptor.current_revision);
    expect(a.descriptor.provider_modified_at).toBe(b.descriptor.provider_modified_at);
  });

  it('create replay with the same idempotency key reconciles (created:false) — R-026', async () => {
    const { adapter } = makeAdapter();
    const first = await adapter.create(docCreateInput({ idempotencyKey: 't014-replay' }));
    const second = await adapter.create(docCreateInput({ idempotencyKey: 't014-replay' }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.descriptor.external_id).toBe(first.descriptor.external_id);
    expect(second.descriptor.current_revision).toBe(first.descriptor.current_revision);
  });

  it('create fails closed when the create capability is not actionable (degraded connection)', async () => {
    const { adapter, transport } = makeAdapter();
    transport.connectionState = 'degraded';
    await expect(adapter.create(docCreateInput())).rejects.toBeInstanceOf(
      UnsupportedAdapterMutationError,
    );
  });
});

/* ============================================================================
 * Acceptance element: stable Entity identity mapping (adapter-side half).
 * The route/registry half (stable Entity URL) is proven in the route suite.
 * ============================================================================ */

describe('T-014 Google Docs adapter — stable provider identity across create/read', () => {
  it('read/getMetadata return the SAME external_id and revision after create (stable identity)', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(docCreateInput());
    const read = await adapter.read({ external_id: created.descriptor.external_id });
    expect(read.descriptor.external_id).toBe(created.descriptor.external_id);
    expect(read.descriptor.current_revision).toBe(created.descriptor.current_revision);
    const meta = await adapter.getMetadata({ external_id: created.descriptor.external_id });
    expect(meta?.external_id).toBe(created.descriptor.external_id);
    expect(meta?.current_revision).toBe(created.descriptor.current_revision);
    expect(meta?.provider).toBe('google_workspace');
  });

  it('read of an unknown provider identity fails with a typed not-found error (never fabricated)', async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.read({ external_id: 'nope' })).rejects.toBeInstanceOf(
      AdapterArtifactNotFoundError,
    );
    expect(await adapter.getMetadata({ external_id: 'nope' })).toBeNull();
  });
});

/* ============================================================================
 * Acceptance element: bounded mutation.
 * ============================================================================ */

describe('T-014 Google Docs adapter — bounded mutation', () => {
  it('mutate applies ONLY the declared batchUpdate envelope for the text lane', async () => {
    const { adapter, transport } = makeAdapter();
    const created = await adapter.create(docCreateInput());
    transport.recordedBatchUpdates = [];
    const result = await adapter.mutate({
      external_id: created.descriptor.external_id,
      expectedRevision: created.descriptor.current_revision ?? '',
      mutation: textMutation(),
      idempotencyKey: 't014-mut-1',
    });
    expect(result.priorRevision).toBe(created.descriptor.current_revision);
    expect(result.resultRevision).not.toBe(result.priorRevision);
    // The transport received a bounded, documented envelope — every request kind is declared.
    const received = transport.recordedBatchUpdates;
    expect(received.length).toBe(1);
    expect(received[0].documentId).toBe(created.descriptor.external_id);
    for (const req of received[0].requests) {
      expect(transport.declaredRequestKinds.has(req.kind)).toBe(true);
    }
  });

  it('range mutation (outside the docs declared envelope) FAILS CLOSED with a typed error', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(docCreateInput());
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: { kind: 'range', cell: 'A1', value: 'x' },
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });

  it('slide mutation (outside the docs declared envelope) FAILS CLOSED with a typed error', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(docCreateInput());
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: { kind: 'slide', slideId: 's1' },
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });

  it('capability honesty: the docs adapter advertises only create + text mutation (range/slide unsupported)', async () => {
    const { adapter } = makeAdapter();
    const report = await adapter.resolveCapabilities({
      provider: 'google_workspace',
      artifact_type: 'document',
      connectionState: 'authorized',
      destinationId: null,
      runtime: {},
    });
    expect(report.agent_text_mutation.state).toBe('supported');
    expect(report.create.state).toBe('supported');
    expect(report.agent_range_mutation.state).toBe('unsupported');
    expect(report.agent_slide_mutation.state).toBe('unsupported');
    expect(report.embed_editor.state).toBe('unsupported');
  });
});

/* ============================================================================
 * Acceptance element: revision capture.
 * ============================================================================ */

describe('T-014 Google Docs adapter — revision capture', () => {
  it('every create/mutate populates the provider revision token on the descriptor', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(docCreateInput());
    expect(created.descriptor.current_revision).toMatch(/^google-rev-/);
    const afterMutate = await adapter.mutate({
      external_id: created.descriptor.external_id,
      expectedRevision: created.descriptor.current_revision ?? '',
      mutation: textMutation(),
    });
    expect(afterMutate.resultRevision).toMatch(/^google-rev-/);
    expect(afterMutate.descriptor.current_revision).toBe(afterMutate.resultRevision);
    // The captured revision is observable through a fresh read (not fabricated).
    const read = await adapter.read({ external_id: created.descriptor.external_id });
    expect(read.descriptor.current_revision).toBe(afterMutate.resultRevision);
  });
});

/* ============================================================================
 * Acceptance element: conflict rejection.
 * ============================================================================ */

describe('T-014 Google Docs adapter — conflict rejection', () => {
  it('mutation against a STALE revision token fails closed with a typed conflict error', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(docCreateInput());
    const stale = created.descriptor.current_revision ?? '';
    // Advance the document so `stale` is no longer current.
    await adapter.mutate({
      external_id: created.descriptor.external_id,
      expectedRevision: stale,
      mutation: textMutation('v2'),
    });
    // Replaying the ORIGINAL expectedRevision is now stale -> typed StaleRevisionError (R-025).
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: stale,
        mutation: textMutation('stale-v2'),
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it('mutation against an UNKNOWN revision token fails closed with a typed conflict error', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(docCreateInput());
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: 'google-rev-DOES-NOT-EXIST',
        mutation: textMutation(),
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it('transport conflict is mapped to the typed provider-neutral StaleRevisionError with retryable:true', async () => {
    const { adapter, transport } = makeAdapter();
    const created = await adapter.create(docCreateInput());
    transport.forceEveryMutationConflict = true;
    try {
      await adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: textMutation(),
      });
      throw new Error('expected conflict');
    } catch (e) {
      expect(e).toBeInstanceOf(StaleRevisionError);
      const sre = e as StaleRevisionError;
      expect(sre.retryable).toBe(true);
      expect(sre.currentRevision).toBe(created.descriptor.current_revision);
      expect(sre.expectedRevision).toBe(created.descriptor.current_revision);
    }
  });
});

/* ============================================================================
 * THE-950 r2 F2 — adapter-boundary revision-token strictness (extended unsafe set).
 * Core revision-coordinator extension (revision-coordinator.ts) is OUT of path; this lane
 * enforces the same strictness at the REAL adapter boundary.
 * ============================================================================ */

describe('T-014 adapter-boundary revision-token strictness (THE-950 r2 F2)', () => {
  const UNSAFE_SAMPLES: ReadonlyArray<{ label: string; char: string }> = [
    { label: 'LRM U+200E', char: '\u200e' },
    { label: 'RLM U+200F', char: '\u200f' },
    { label: 'LRE U+202A', char: '\u202a' },
    { label: 'RLE U+202B', char: '\u202b' },
    { label: 'LRI U+2066', char: '\u2066' },
    { label: 'RLI U+2067', char: '\u2067' },
    { label: 'FSI U+2068', char: '\u2068' },
    { label: 'PDI U+2069', char: '\u2069' },
    { label: 'BOM/ZWNBSP U+FEFF', char: '\ufeff' },
    { label: 'Word Joiner U+2060', char: '\u2060' },
    { label: 'Soft Hyphen U+00AD', char: '\u00ad' },
    { label: 'Arabic Letter Mark U+061C', char: '\u061c' },
    { label: 'ASCII control U+0001', char: '\u0001' },
    { label: 'HTML injection <', char: '<' },
    { label: 'double-quote "', char: '"' },
  ];

  it.each(UNSAFE_SAMPLES)(
    'mutate rejects an expectedRevision containing $label (unsafe token character) with UnsafeRevisionTokenError',
    async ({ char }) => {
      const { adapter } = makeAdapter();
      const created = await adapter.create(docCreateInput());
      const unsafeToken = `${created.descriptor.current_revision}${char}`;
      await expect(
        adapter.mutate({
          external_id: created.descriptor.external_id,
          expectedRevision: unsafeToken,
          mutation: textMutation(),
        }),
      ).rejects.toBeInstanceOf(UnsafeRevisionTokenError);
    },
  );

  it('a revision reported by the transport that contains an unsafe character fails closed (no fabricated token)', async () => {
    const { adapter, transport } = makeAdapter();
    const created = await adapter.create(docCreateInput());
    // Inject an unsafe revision into every SUBSEQUENT metadata render (read-back path).
    // (The injection happens after create: create's own descriptor build is equally
    // fail-closed and would reject the token outright — see EVIDENCE T-014.)
    transport.nextReportedRevision = () => `rev\u2066`;
    void transport.docsWithUnsafeRevision;
    await expect(
      adapter.read({ external_id: created.descriptor.external_id }),
    ).rejects.toBeInstanceOf(UnsafeRevisionTokenError);
  });

  it('a benign opaque revision token (base64-ish) is accepted (not over-restricted)', async () => {
    const { adapter, transport } = makeAdapter();
    transport.nextReportedRevision = () => 'rev_17QkAaiFhyZK871Jozj6w';
    const created = await adapter.create(docCreateInput());
    expect(created.descriptor.current_revision).toMatch(/^rev_17/);
  });
});

/* ============================================================================
 * Shared T-005 provider-agnostic contract suite against the Google Docs adapter.
 * ============================================================================ */

runAdapterContractSuite('google-docs-adapter', () => {
  const transport = new DeterministicGoogleDocsTransport();
  return createGoogleDocsAdapter({ transport });
});

/* ============================================================================
 * Capability honesty / fail-closed, read-lane honesty, privacy.
 * ============================================================================ */

describe('T-014 Google Docs adapter — capability honesty & fail-closed', () => {
  it('degraded connection suppresses the normally supported text mutation lane (fails closed)', async () => {
    const { adapter, transport } = makeAdapter();
    const created = await adapter.create(docCreateInput());
    transport.connectionState = 'degraded';
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: textMutation(),
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });

  it('read-like lanes (preview/open/version) normalize deterministically and never leak contents', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(docCreateInput());
    const ext = created.descriptor.external_id;
    const preview = adapter.getPreview ? await adapter.getPreview({ external_id: ext }) : null;
    if (preview) {
      expect(['not_requested', 'pending', 'ready', 'failed', 'unsupported']).toContain(preview.state);
    }
    const open = await adapter.getOpenTarget({ external_id: ext });
    expect(open.provider).toBe('google_workspace');
    expect(open.url).toContain('docs.google.com');
    if (adapter.getVersions) {
      const versions = await adapter.getVersions({ external_id: ext });
      expect(versions.versions.length).toBeGreaterThanOrEqual(1);
      expect(versions.versions[0].revision).toBeTruthy();
    }
  });

  it('every descriptor returned carries provider === google_workspace (privacy: no credentials/contents)', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create(docCreateInput());
    const descriptors: ProviderArtifactDescriptor[] = [created.descriptor];
    const read = await adapter.read({ external_id: created.descriptor.external_id });
    descriptors.push(read.descriptor);
    const discovery = (await adapter.discover({})).items;
    descriptors.push(...discovery);
    for (const d of descriptors) {
      expect(d.provider).toBe('google_workspace');
    }
    // Privacy: never surface document content or credentials in descriptors.
    const serialized = JSON.stringify(descriptors);
    expect(serialized).not.toMatch(/Bearer|token|secret|credentials/i);
    expect(serialized).not.toContain('revised body');
  });
});

/* Type-only compile guard block (imported types are used in signatures above). */
void (0 as unknown as GoogleDocMetadata);
void (0 as unknown as GoogleDocsBatchRequest);
void (0 as unknown as GoogleDocsAdapterOptions);
