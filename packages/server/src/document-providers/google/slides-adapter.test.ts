/**
 * THE-957 (T-016) — Google Slides create/slide-text-mutate adapter — tests.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - T-016 acceptance: "Same required task contract as T-014, applied to presentation/element
 *     semantics." (create; stable Entity URL; bounded element/slide mutation; revision capture;
 *     conflict rejection; slide/element targeting validation).
 *   - §12.5 Presentation mutation (`update_slide_text`: slideRef / elementRef / text).
 *   - T-005 adapter contract + R-002 capability honesty; R-024/R-025 (D-012) revisions.
 *
 * Determinism / no network: the Google Slides adapter takes its TRANSPORT as an injected
 * dependency and performs no real HTTP calls. Tests use a deterministic stateful fake
 * transport only — no real Google, no credentials, no tenant data, no operator-specific
 * absolute paths.
 *
 * NOTE on the shared §19.2 fixture: `runAdapterContractSuite` fixes its create input to
 * `artifact_type: 'document'` and its success-path mutations to the TEXT lane — both are
 * outside the Slides adapter's honestly-declared surface (presentations + slide-only). The
 * suite cannot be parameterized without editing out-of-path files, so the equivalent §19.2
 * contract elements are each covered below against the presentation/slide semantics
 * (same approach as the approved T-015 Sheets suite). See EVIDENCE T-016.
 */

import { describe, expect, it } from 'vitest';
import type {
  CreateDocumentInput,
  DocumentProviderAdapter,
} from '../types';
import {
  AdapterArtifactNotFoundError,
  StaleRevisionError,
  UnsupportedAdapterMutationError,
} from '../types';
import {
  createGoogleSlidesAdapter,
  GoogleSlidesTransportConflictError,
  DECLARED_SLIDES_REQUEST_KINDS,
  MAX_SLIDE_TEXT_LENGTH,
  isWellFormedStableId,
  isTypeBoundedSlideText,
  parseSlideTextSelector,
  type GoogleSlidesUpdateSlideTextRequest,
  type GoogleSlidesTransport,
  type GooglePresentationMetadata,
} from './slides-adapter';
import { UnsafeRevisionTokenError } from './docs-adapter';
import type { DocumentAuthState } from '../../../../db/src/document-integrations';

/* ============================================================================
 * Deterministic fake transport.
 * ============================================================================ */

const T016_FIXED_NOW = '2026-08-18T00:00:00.000Z';

interface FakePresentation {
  presentationId: string;
  title: string;
  revision: string;
  modifiedTime: string;
  slides: Array<{ objectId: string; elements: Array<{ objectId: string }> }>;
}

class DeterministicGoogleSlidesTransport implements GoogleSlidesTransport {
  private presentations = new Map<string, FakePresentation>();
  private byIdempotency = new Map<string, string>();
  private seq = 0;
  private revSeq = 0;
  connectionState: DocumentAuthState = 'authorized';
  /** When true, batchUpdate always reports a stale-revision conflict (negative). */
  forceEveryMutationConflict = false;
  /** When true, getPresentation returns null for every id (vanished artifact). */
  vanishAll = false;
  /** When set, getPresentation returns null exactly on the Nth call. */
  vanishOnGetPresentationCallNo?: number;
  private getPresentationCalls = 0;
  /** Record of every structured slide-mutation envelope forwarded (bounded proof). */
  recordedBatchUpdates: Array<{
    presentationId: string;
    requests: GoogleSlidesUpdateSlideTextRequest[];
  }> = [];
  /** Override revision generation (inject unsafe/benign reported revision values). */
  nextReportedRevision?: () => string;

  seedPresentation(input: {
    title: string;
    slides: Array<{ objectId: string; elements: string[] }>;
  }): { presentationId: string; revision: string } {
    this.seq += 1;
    const presentationId = `google-presentation-${this.seq}`;
    const revision = this.nextRevision();
    this.presentations.set(presentationId, {
      presentationId,
      title: input.title,
      revision,
      modifiedTime: T016_FIXED_NOW,
      slides: input.slides.map((s) => ({
        objectId: s.objectId,
        elements: s.elements.map((objectId) => ({ objectId })),
      })),
    });
    return { presentationId, revision };
  }

  private nextRevision(): string {
    this.revSeq += 1;
    return `slides-rev-${this.revSeq}`;
  }

  createPresentation(input: {
    title: string;
    parent?: string | null;
    idempotencyKey?: string;
  }): { presentation: GooglePresentationMetadata; created: boolean } {
    if (input.idempotencyKey && this.byIdempotency.has(input.idempotencyKey)) {
      const id = this.byIdempotency.get(input.idempotencyKey)!;
      return { presentation: this.metaFor(this.presentations.get(id)!), created: false };
    }
    this.seq += 1;
    const presentationId = `google-presentation-${this.seq}`;
    const p: FakePresentation = {
      presentationId,
      title: input.title,
      revision: this.nextReportedRevision ? this.nextReportedRevision() : this.nextRevision(),
      modifiedTime: T016_FIXED_NOW,
      // A fresh Google presentation has one slide with a title placeholder (deterministic).
      slides: [{ objectId: 'slide_1', elements: [{ objectId: 'title' }] }],
    };
    this.presentations.set(presentationId, p);
    if (input.idempotencyKey) this.byIdempotency.set(input.idempotencyKey, presentationId);
    return { presentation: this.metaFor(p), created: true };
  }

  getPresentation(input: { presentationId: string }): GooglePresentationMetadata | null {
    this.getPresentationCalls += 1;
    if (this.vanishOnGetPresentationCallNo === this.getPresentationCalls) return null;
    if (this.vanishAll) return null;
    const p = this.presentations.get(input.presentationId);
    return p ? this.metaFor(p) : null;
  }

  batchUpdate(input: {
    presentationId: string;
    requests: GoogleSlidesUpdateSlideTextRequest[];
    expectedRevision: string;
  }): { presentationId: string; revisionId: string; responses: unknown[] } {
    const p = this.presentations.get(input.presentationId);
    if (!p) {
      throw new AdapterArtifactNotFoundError(input.presentationId);
    }
    // The transport itself only accepts the declared envelope (bounded-mutation defense).
    for (const req of input.requests) {
      if (!DECLARED_SLIDES_REQUEST_KINDS.has(req.kind)) {
        throw new Error(`transport rejects undeclared request kind: ${req.kind}`);
      }
    }
    this.recordedBatchUpdates.push({ presentationId: input.presentationId, requests: input.requests });
    if (this.forceEveryMutationConflict || input.expectedRevision !== p.revision) {
      throw new GoogleSlidesTransportConflictError(input.expectedRevision, p.revision);
    }
    const newRevision = this.nextReportedRevision ? this.nextReportedRevision() : this.nextRevision();
    this.presentations.set(input.presentationId, { ...p, revision: newRevision });
    return { presentationId: input.presentationId, revisionId: newRevision, responses: [] };
  }

  private metaFor(p: FakePresentation): GooglePresentationMetadata {
    return {
      presentationId: p.presentationId,
      title: p.title,
      url: `https://docs.google.com/presentation/d/${p.presentationId}/edit`,
      revisionId: this.nextReportedRevision ? this.nextReportedRevision() : p.revision,
      modifiedTime: p.modifiedTime,
      slides: p.slides.map((s) => ({
        objectId: s.objectId,
        elements: s.elements.map((el) => ({ objectId: el.objectId })),
      })),
    };
  }
}

function makeAdapter(options: {
  transport?: GoogleSlidesTransport;
  parentFolderId?: string | null;
} = {}): {
  adapter: DocumentProviderAdapter;
  transport: DeterministicGoogleSlidesTransport;
} {
  const transport = (options.transport ?? new DeterministicGoogleSlidesTransport()) as DeterministicGoogleSlidesTransport;
  return {
    adapter: createGoogleSlidesAdapter({
      transport,
      parentFolderId: options.parentFolderId,
    }),
    transport,
  };
}

function baseCreateInput(): CreateDocumentInput {
  return {
    artifact_type: 'presentation',
    title: 'Q3 Board Deck',
    provider_url: null,
    idempotencyKey: 'idem:t016-default',
  };
}

/** Canonical §12.5 envelope encoded into the single-field T-005 slide lane. */
function slideLane(slideRef: string, elementRef: string, text: string): { kind: 'slide'; slideId: string } {
  return { kind: 'slide', slideId: JSON.stringify({ slideRef, elementRef, text }) };
}

/* ============================================================================
 * Pure targeting helpers.
 * ============================================================================ */

describe('T-016 slide/element selector helpers', () => {
  it('parses the exact §12.5 JSON envelope and rejects everything else', () => {
    expect(parseSlideTextSelector(JSON.stringify({ slideRef: 'slide_4', elementRef: 'title', text: 'Revised market outlook' }))).toEqual({
      slideRef: 'slide_4',
      elementRef: 'title',
      text: 'Revised market outlook',
    });
    // Bare slide id: null (typed-reject upstream, never silent substitution).
    expect(parseSlideTextSelector('slide_4')).toBeNull();
    // Malformed JSON.
    expect(parseSlideTextSelector('{not json')).toBeNull();
    // Wrong key set.
    expect(parseSlideTextSelector(JSON.stringify({ slideRef: 's', elementRef: 'title' }))).toBeNull();
    expect(parseSlideTextSelector(JSON.stringify({ slideRef: 's', elementRef: 'title', text: 'x', extra: 1 }))).toBeNull();
    // Non-string fields.
    expect(parseSlideTextSelector(JSON.stringify({ slideRef: 's', elementRef: 'title', text: 5 }))).toBeNull();
    // Unsafe stable ids.
    expect(parseSlideTextSelector(JSON.stringify({ slideRef: 's lide', elementRef: 'title', text: 'x' }))).toBeNull();
    expect(parseSlideTextSelector(JSON.stringify({ slideRef: 's', elementRef: 'ti"tle', text: 'x' }))).toBeNull();
  });

  it('enforces stable-id well-formedness and the text type bound', () => {
    expect(isWellFormedStableId('slide_4')).toBe(true);
    expect(isWellFormedStableId('title')).toBe(true);
    expect(isWellFormedStableId('')).toBe(false);
    expect(isWellFormedStableId('a\tb')).toBe(false);
    expect(isWellFormedStableId('<script>')).toBe(false);
    expect(isTypeBoundedSlideText('hello')).toBe(true);
    expect(isTypeBoundedSlideText('x'.repeat(MAX_SLIDE_TEXT_LENGTH))).toBe(true);
    expect(isTypeBoundedSlideText('x'.repeat(MAX_SLIDE_TEXT_LENGTH + 1))).toBe(false);
  });
});

/* ============================================================================
 * Acceptance element 1+2: create with stable provider identity / Entity URL surface.
 * ============================================================================ */

describe('T-016 create (stable identity)', () => {
  it('RED→GREEN: creates a presentation descriptor with durable provider identity and URL', async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:create-1' });
    expect(result.created).toBe(true);
    expect(result.descriptor.provider).toBe('google_workspace');
    expect(result.descriptor.artifact_type).toBe('presentation');
    // Stable identity: the durable Google presentation id, never a locally minted UUID.
    expect(result.descriptor.external_id).toMatch(/^google-presentation-\d+$/);
    expect(result.descriptor.current_revision).toBe('slides-rev-1');
    expect(result.descriptor.provider_url).toBe(
      `https://docs.google.com/presentation/d/${result.descriptor.external_id}/edit`,
    );
    // Revision capture at create time.
    expect(typeof result.descriptor.current_revision).toBe('string');
    expect((result.descriptor.current_revision ?? '').length).toBeGreaterThan(0);
  });

  it('idempotent replay reconciles to the same artifact (created:false, R-026)', async () => {
    const { adapter } = makeAdapter();
    const first = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:same' });
    const second = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:same' });
    expect(second.created).toBe(false);
    expect(second.descriptor.external_id).toBe(first.descriptor.external_id);
  });

  it('fails closed on non-presentation artifact types and on degraded/unknown connections', async () => {
    const degraded = makeAdapter();
    (degraded.transport as unknown as { connectionState: DocumentAuthState }).connectionState = 'degraded';
    await expect(degraded.adapter.create(baseCreateInput())).rejects.toBeInstanceOf(
      UnsupportedAdapterMutationError,
    );
    const unknownConn = makeAdapter();
    (unknownConn.transport as unknown as { connectionState: DocumentAuthState }).connectionState = 'unknown';
    await expect(unknownConn.adapter.create(baseCreateInput())).rejects.toBeInstanceOf(
      UnsupportedAdapterMutationError,
    );
    const ok = makeAdapter();
    await expect(
      ok.adapter.create({ ...baseCreateInput(), artifact_type: 'document' }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });

  it('create-time revision capture is strict: an unsafe reported token rejects the create', async () => {
    const transport = new DeterministicGoogleSlidesTransport();
    transport.nextReportedRevision = () => 'rev\u202e-bidi';
    const { adapter } = makeAdapter({ transport });
    await expect(adapter.create(baseCreateInput())).rejects.toBeInstanceOf(UnsafeRevisionTokenError);
  });
});

/* ============================================================================
 * Capability honesty (R-002): every lane folds from live connection state.
 * ============================================================================ */

describe('T-016 capability honesty', () => {
  it('authorized connection: slide mutation supported, other write lanes unsupported', async () => {
    const { adapter } = makeAdapter();
    const report = await adapter.resolveCapabilities({
      provider: adapter.provider,
      artifact_type: 'presentation',
      connectionState: 'authorized',
      destinationId: null,
      runtime: {},
    });
    expect(report.agent_slide_mutation.state).toBe('supported');
    expect(report.agent_text_mutation.state).toBe('unsupported');
    expect(report.agent_range_mutation.state).toBe('unsupported');
    expect(report.create.state).toBe('supported');
    expect(report.embed_editor.state).toBe('unsupported');
  });

  // Mirrors the approved T-015 Sheets fold convention: degraded DEGRADES every normally-
  // supported lane; unauthorized/unknown never lift a lane to supported, AND every write
  // lane fails closed outright (create throws).
  it.each<DocumentAuthState>(['degraded', 'unauthorized', 'unknown'])(
    'a %s connection degrades or fails closed every normally-supported lane; writes throw',
    async (state) => {
      const { adapter } = makeAdapter();
      const created = await adapter.create({ ...baseCreateInput(), idempotencyKey: `idem:${state}` });
      (adapter as unknown as { transport: DeterministicGoogleSlidesTransport }).transport.connectionState = state;
      const report = await adapter.resolveCapabilities({
        provider: adapter.provider,
        artifact_type: 'presentation',
        connectionState: state,
        destinationId: null,
        runtime: {},
      });
      for (const name of ['create', 'read', 'open_external', 'human_edit', 'agent_slide_mutation'] as const) {
        if (state === 'degraded') {
          expect(report[name].state, name).toBe('degraded');
        } else {
          // unauthorized/unknown must NEVER lift a lane to supported.
          expect(report[name].state, name).not.toBe('supported');
        }
      }
      // Writes fail closed outright on any non-authorized state.
      await expect(
        adapter.create({ ...baseCreateInput(), idempotencyKey: `idem:${state}-neg` }),
      ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
      await expect(
        adapter.mutate({
          external_id: created.descriptor.external_id,
          expectedRevision: created.descriptor.current_revision ?? '',
          mutation: slideLane('slide_1', 'title', 'x'),
        }),
      ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
    },
  );

  it('a transport WITHOUT structured slide mutation folds agent_slide_mutation to unsupported', async () => {
    // Strip the optional structured-mutation method at the TYPE level (fail-closed probe):
    // a plain object without batchUpdate, so no prototype method can leak through.
    const bareTransport: GoogleSlidesTransport & { connectionState: DocumentAuthState } = {
      connectionState: 'authorized',
      createPresentation: () => {
        throw new Error('not exercised by this test');
      },
      getPresentation: () => null,
    };
    const { adapter } = makeAdapter({ transport: bareTransport });
    const report = await adapter.resolveCapabilities({
      provider: adapter.provider,
      artifact_type: 'presentation',
      connectionState: 'authorized',
      destinationId: null,
      runtime: {},
    });
    expect(report.agent_slide_mutation.state).toBe('unsupported');
  });
});

/* ============================================================================
 * Acceptance elements 3+6: bounded element/slide mutation + targeting validation.
 * ============================================================================ */

describe('T-016 bounded slide mutation and targeting', () => {
  async function setup() {
    const { adapter, transport } = makeAdapter();
    const created = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:mutate' });
    // Seed an extra slide so wrong-slide vectors are meaningful.
    transport.seedPresentation({
      title: 'unused',
      slides: [{ objectId: 'other', elements: ['x'] }],
    });
    const revision = created.descriptor.current_revision ?? '';
    return { adapter, transport, externalId: created.descriptor.external_id, revision };
  }

  it('RED→GREEN: forwards ONLY the declared updateSlideText envelope to the addressed slide/element', async () => {
    const { adapter, transport, externalId, revision } = await setup();
    const result = await adapter.mutate({
      external_id: externalId,
      expectedRevision: revision,
      mutation: slideLane('slide_1', 'title', 'Revised market outlook'),
    });
    expect(result.priorRevision).toBe(revision);
    expect(result.resultRevision).toMatch(/^slides-rev-/);
    expect(transport.recordedBatchUpdates).toHaveLength(1);
    expect(transport.recordedBatchUpdates[0].requests).toEqual([
      { kind: 'updateSlideText', slideRef: 'slide_1', elementRef: 'title', text: 'Revised market outlook' },
    ]);
  });

  it('RED→GREEN: text and range lanes fail closed (outside the declared envelope)', async () => {
    const { adapter, externalId, revision } = await setup();
    await expect(
      adapter.mutate({ external_id: externalId, expectedRevision: revision, mutation: { kind: 'text', text: 'x' } }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
    await expect(
      adapter.mutate({ external_id: externalId, expectedRevision: revision, mutation: { kind: 'range', cell: 'A1', value: 'y' } }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });

  it('RED→GREEN: a bare slide id (no §12.5 payload) is typed-rejected, never substituted', async () => {
    const { adapter, externalId, revision } = await setup();
    await expect(
      adapter.mutate({
        external_id: externalId,
        expectedRevision: revision,
        mutation: { kind: 'slide', slideId: 'slide_1' },
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });

  it('RED→GREEN: nonexistent slide is rejected BEFORE any transport write', async () => {
    const { adapter, transport, externalId, revision } = await setup();
    await expect(
      adapter.mutate({
        external_id: externalId,
        expectedRevision: revision,
        mutation: slideLane('slide_999', 'title', 'x'),
      }),
    ).rejects.toThrow(/slide .* does not exist/);
    expect(transport.recordedBatchUpdates).toHaveLength(0);
  });

  it('RED→GREEN: nonexistent or malformed element reference is rejected BEFORE any transport write', async () => {
    const { adapter, transport, externalId, revision } = await setup();
    await expect(
      adapter.mutate({
        external_id: externalId,
        expectedRevision: revision,
        mutation: slideLane('slide_1', 'body_no_such', 'x'),
      }),
    ).rejects.toThrow(/element .* does not exist/);
    // Malformed element id inside an otherwise-parseable envelope.
    await expect(
      adapter.mutate({
        external_id: externalId,
        expectedRevision: revision,
        mutation: { kind: 'slide', slideId: JSON.stringify({ slideRef: 'slide_1', elementRef: 'bad id!', text: 'x' }) },
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
    expect(transport.recordedBatchUpdates).toHaveLength(0);
  });

  it('RED→GREEN: oversized text payload is typed-rejected, never truncated', async () => {
    const { adapter, transport, externalId, revision } = await setup();
    await expect(
      adapter.mutate({
        external_id: externalId,
        expectedRevision: revision,
        mutation: slideLane('slide_1', 'title', 'x'.repeat(MAX_SLIDE_TEXT_LENGTH + 1)),
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
    expect(transport.recordedBatchUpdates).toHaveLength(0);
  });

  it('unknown external_id never reaches a transport write (AdapterArtifactNotFoundError)', async () => {
    const { adapter, transport } = await setup();
    await expect(
      adapter.mutate({
        external_id: 'google-presentation-does-not-exist',
        expectedRevision: 'slides-rev-1',
        mutation: slideLane('slide_1', 'title', 'x'),
      }),
    ).rejects.toBeInstanceOf(AdapterArtifactNotFoundError);
    expect(transport.recordedBatchUpdates).toHaveLength(0);
  });

  it('a transport without structured slide mutation typed-rejects the slide lane', async () => {
    const real = new DeterministicGoogleSlidesTransport();
    const createdViaReal = createGoogleSlidesAdapter({ transport: real });
    const seeded = await createdViaReal.create({ ...baseCreateInput(), idempotencyKey: 'idem:bare-seed' });
    // A view of the same transport WITHOUT the optional structured-mutation method.
    const bareTransport: GoogleSlidesTransport & { connectionState: DocumentAuthState } = {
      connectionState: 'authorized',
      createPresentation: (i) => real.createPresentation(i),
      getPresentation: (i) => real.getPresentation(i),
    };
    const { adapter } = makeAdapter({ transport: bareTransport });
    const created = {
      descriptor: {
        external_id: seeded.descriptor.external_id,
        current_revision: seeded.descriptor.current_revision,
      },
    };
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: slideLane('slide_1', 'title', 'x'),
      }),
    ).rejects.toBeInstanceOf(UnsupportedAdapterMutationError);
  });
});

/* ============================================================================
 * Acceptance elements 4+5: revision capture + conflict rejection (+ token strictness).
 * ============================================================================ */

describe('T-016 revision capture and conflict rejection', () => {
  it('RED→GREEN: stale expected revision is rejected with the typed retryable conflict; no write occurs', async () => {
    const { adapter, transport } = makeAdapter();
    const created = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:stale' });
    const stale = `stale-${created.descriptor.current_revision}`;
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: stale,
        mutation: slideLane('slide_1', 'title', 'should not land'),
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);
    expect(transport.recordedBatchUpdates).toHaveLength(0);
  });

  it('RED→GREEN: a transport-reported conflict maps to the neutral retryable StaleRevisionError', async () => {
    const { adapter, transport } = makeAdapter();
    const created = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:conflict' });
    transport.forceEveryMutationConflict = true;
    await expect(
      adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: slideLane('slide_1', 'title', 'x'),
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it('each successful mutation captures a FRESH provider revision token (revision capture)', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:revcap' });
    const r1 = await adapter.mutate({
      external_id: created.descriptor.external_id,
      expectedRevision: created.descriptor.current_revision ?? '',
      mutation: slideLane('slide_1', 'title', 'v1'),
    });
    const r2 = await adapter.mutate({
      external_id: created.descriptor.external_id,
      expectedRevision: r1.resultRevision,
      mutation: slideLane('slide_1', 'title', 'v2'),
    });
    expect(r2.priorRevision).toBe(r1.resultRevision);
    expect(r2.resultRevision).not.toBe(r1.resultRevision);
  });

  it('RED→GREEN: unsafe characters in the client expectedRevision are rejected (hex code point only)', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:unsafe-exp' });
    try {
      await adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: 'rev\u202etoken',
        mutation: slideLane('slide_1', 'title', 'x'),
      });
      expect.fail('expected UnsafeRevisionTokenError');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeRevisionTokenError);
      const err = e as UnsafeRevisionTokenError;
      expect(err.field).toBe('expectedRevision');
      expect(err.codePoint.toString(16)).toBe('202e');
      // Raw token never appears in the message — hex code point only.
      expect(err.message).not.toContain('rev');
      expect(err.message).toContain('U+202E');
    }
  });

  it('RED→GREEN: unsafe transport-reported result tokens are rejected (never propagated)', async () => {
    const transport = new DeterministicGoogleSlidesTransport();
    const { adapter } = makeAdapter({ transport });
    const created = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:unsafe-res' });
    // From here on, EVERY transport-reported token is unsafe — including the result token.
    transport.nextReportedRevision = () => 'bad\u0007bell';
    try {
      await adapter.mutate({
        external_id: created.descriptor.external_id,
        expectedRevision: created.descriptor.current_revision ?? '',
        mutation: slideLane('slide_1', 'title', 'x'),
      });
      expect.fail('expected UnsafeRevisionTokenError');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeRevisionTokenError);
      expect((e as UnsafeRevisionTokenError).field).toBe('reportedRevision');
    }
  });
});

/* ============================================================================
 * Remaining §19.2-equivalent contract elements (see file-header note).
 * ============================================================================ */

describe('T-016 remaining contract surfaces', () => {
  it('metadata/read/open-target/discover/reconcile behave per contract', async () => {
    const { adapter, transport } = makeAdapter();
    const created = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:surfaces' });
    const id = created.descriptor.external_id;

    const meta = await adapter.getMetadata({ external_id: id });
    expect(meta?.external_id).toBe(id);
    expect(await adapter.getMetadata({ external_id: 'nope' })).toBeNull();

    const read = await adapter.read({ external_id: id });
    expect(read.contentPlaceholder).toContain(id);
    expect(read.contentPlaceholder).not.toContain('Q3 Board Deck content');

    const open = await adapter.getOpenTarget({ external_id: id });
    expect(open.url).toBe(created.descriptor.provider_url);
    await expect(adapter.getOpenTarget({ external_id: 'nope' })).rejects.toBeInstanceOf(
      AdapterArtifactNotFoundError,
    );

    const discovered = await adapter.discover({});
    expect(discovered.items.map((i) => i.external_id)).toEqual([id]);
    const reconcile = await adapter.reconcileChanges({ discovered: discovered.items });
    expect(reconcile.reconciled).toHaveLength(1);
    expect(reconcile.dropped).toEqual([]);
    transport.vanishAll = true;
    const afterVanish = await adapter.reconcileChanges({ discovered: [] });
    expect(afterVanish.dropped).toEqual([id]);
  });

  it('read over a degraded connection fails closed like every action lane', async () => {
    const { adapter } = makeAdapter();
    (adapter as unknown as { transport: DeterministicGoogleSlidesTransport }).transport.connectionState = 'unknown';
    await expect(adapter.read({ external_id: 'whatever' })).rejects.toBeInstanceOf(
      UnsupportedAdapterMutationError,
    );
  });

  it('preview and permissions are honestly unsupported (normalization, not fabrication)', async () => {
    const { adapter } = makeAdapter();
    const preview = await adapter.getPreview!({ external_id: 'x' });
    expect(preview.state).toBe('unsupported');
    expect(preview.previewUrl).toBeNull();
    const perms = await adapter.getPermissions!({ external_id: 'x' });
    expect(JSON.parse(perms.summary_json)).toEqual({ summary: 'unavailable', reason: 'not_implemented' });
  });

  it('versions reflect the captured provider revision', async () => {
    const { adapter } = makeAdapter();
    const created = await adapter.create({ ...baseCreateInput(), idempotencyKey: 'idem:versions' });
    const versions = await adapter.getVersions!({ external_id: created.descriptor.external_id });
    expect(versions.versions[0].revision).toBe(created.descriptor.current_revision);
  });
});
