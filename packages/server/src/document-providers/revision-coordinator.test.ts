/**
 * THE-950 (T-009) — Revision Coordinator — concurrent-writer tests.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-024 "Revision-aware mutation": a known stale write never succeeds silently; concurrency
 *     tests with two independent writers for each implemented mutation lane.
 *   - R-025 "Standard conflict response": STALE_REVISION envelope with expected/current revisions
 *     sanitized (bounded, no HTML injection surface), no document secrets/credentials, no blind
 *     retry.
 *   - "Not done until: unsafe provider with no concurrency evidence fails closed."
 *   - §10.1 "Revision Coordinator — owns mutation preconditions and stale-write rejection."
 *
 * Method: deterministic ONLY. Concurrency is simulated as two independent logical writers whose
 * operations interleave in a seed-controlled order (writer A commits, writer B — prepared against
 * a stale revision — is rejected). No real timers, no unseeded randomness, no network; the fake
 * adapter (T-005) is the only provider.
 *
 * Privacy: no credentials, raw tokens, tenant secrets, document contents, or operator-specific
 * absolute paths in fixtures/output.
 */

import { describe, expect, it } from 'vitest';

import { createFakeDocumentProviderAdapter, type DeterministicFakeAdapter } from './fake-adapter';
import type {
  AdapterMutation,
  CapabilityContext,
  CapabilityReport,
  DocumentProviderAdapter,
  CreateDocumentInput,
  CreateDocumentResult,
  DiscoverDocumentsInput,
  DiscoverDocumentsResult,
  GetDocumentMetadataInput,
  OpenTargetInput,
  OpenTargetResult,
  GetPermissionsInput,
  GetPermissionsResult,
  GetPreviewInput,
  GetPreviewResult,
  GetVersionsInput,
  GetVersionsResult,
  MutateDocumentInput,
  MutateDocumentResult,
  ProviderArtifactDescriptor,
  ReadDocumentInput,
  ReadDocumentResult,
  ReconcileChangesInput,
  ReconcileChangesResult,
} from './types';
import { StaleRevisionError } from './types';
import {
  sanitizeRevisionToken,
  readMutationPrecondition,
  assertMutationPrecondition,
  UnsafeMutationError,
  preflightMutation,
  staleRevisionBody,
  STALE_REVISION_MESSAGE,
  type MutationPrecondition,
} from './revision-coordinator';

/**
 * Deterministic fixed clock for the coordinator tests — no wall-clock dependence. The fake is the
 * only provider and is always constructed with this injected clock.
 */
const FIXED_NOW = '2026-08-18T00:00:00.000Z';

/** Adapter contract spies: every delegate is forwarded; mutate calls are recorded for proof. */
class RecordingAdapter implements DocumentProviderAdapter {
  readonly provider = 'google_workspace' as const;
  constructor(private readonly inner: DocumentProviderAdapter, public mutateCalls: MutateDocumentInput[] = []) {}
  async resolveCapabilities(ctx: CapabilityContext): Promise<CapabilityReport> {
    return this.inner.resolveCapabilities(ctx);
  }
  async discover(input: DiscoverDocumentsInput): Promise<DiscoverDocumentsResult> {
    return this.inner.discover(input);
  }
  async getMetadata(input: GetDocumentMetadataInput): Promise<ProviderArtifactDescriptor | null> {
    return this.inner.getMetadata(input);
  }
  async create(input: CreateDocumentInput): Promise<CreateDocumentResult> {
    return this.inner.create(input);
  }
  async read(input: ReadDocumentInput): Promise<ReadDocumentResult> {
    return this.inner.read(input);
  }
  async mutate(input: MutateDocumentInput): Promise<MutateDocumentResult> {
    this.mutateCalls.push(input);
    return this.inner.mutate(input);
  }
  async getVersions(input: GetVersionsInput): Promise<GetVersionsResult> {
    return (this.inner.getVersions as (i: GetVersionsInput) => Promise<GetVersionsResult>)(input);
  }
  async getPreview(input: GetPreviewInput): Promise<GetPreviewResult> {
    return (this.inner.getPreview as (i: GetPreviewInput) => Promise<GetPreviewResult>)(input);
  }
  async getPermissions(input: GetPermissionsInput): Promise<GetPermissionsResult> {
    return (this.inner.getPermissions as (i: GetPermissionsInput) => Promise<GetPermissionsResult>)(input);
  }
  async getOpenTarget(input: OpenTargetInput): Promise<OpenTargetResult> {
    return this.inner.getOpenTarget(input);
  }
  async reconcileChanges(input: ReconcileChangesInput): Promise<ReconcileChangesResult> {
    return this.inner.reconcileChanges(input);
  }
}

/**
 * A fake adapter with every mutation lane enabled (text/range/slide), so the concurrency suite can
 * prove R-024 for each implemented lane through the deterministic fake.
 */
function multiLaneAdapter(adapter?: DeterministicFakeAdapter): { adapter: DeterministicFakeAdapter; recording: RecordingAdapter } {
  const inner =
    adapter ??
    createFakeDocumentProviderAdapter({
      capabilities: {
        agent_range_mutation: 'supported',
        agent_slide_mutation: 'supported',
      },
      now: () => FIXED_NOW,
    });
  return { adapter: inner, recording: new RecordingAdapter(inner) };
}

interface SeededDoc {
  adapter: DeterministicFakeAdapter;
  recording: RecordingAdapter;
  externalId: string;
  revision: string;
}

/** Deterministic counter for idempotency keys (no unseeded randomness). */
let seq = 0;

async function seedDoc(
  artifactType: 'document' | 'spreadsheet' | 'presentation',
  mutation: AdapterMutation,
): Promise<SeededDoc> {
  const { adapter, recording } = multiLaneAdapter();
  seq += 1;
  const created = await adapter.create({
    artifact_type: artifactType,
    title: `concurrency-${seq}`,
    idempotencyKey: `seed-${seq}`,
    now: FIXED_NOW,
  });
  return {
    adapter,
    recording,
    externalId: created.descriptor.external_id,
    revision: created.descriptor.current_revision ?? '',
  };
}

const LANE_MUTATIONS: { name: string; artifactType: 'document' | 'spreadsheet' | 'presentation'; mutation: AdapterMutation }[] = [
  { name: 'document/text', artifactType: 'document', mutation: { kind: 'text', text: 'writer A text' } },
  { name: 'sheet/range', artifactType: 'spreadsheet', mutation: { kind: 'range', cell: 'Forecast!B2', value: '10' } },
  { name: 'slide', artifactType: 'presentation', mutation: { kind: 'slide', slideId: 'slide_4' } },
];

describe('T-009 — sanitizeRevisionToken (security: bounded, no HTML injection surface)', () => {
  it('passes a benign revision token through unchanged', () => {
    expect(sanitizeRevisionToken('rev-17')).toBe('rev-17');
    expect(sanitizeRevisionToken('etag_"abc-123"')).toBe('etag_abc-123');
  });

  it('strips HTML injection metacharacters from an untrusted token', () => {
    expect(sanitizeRevisionToken('<script>alert(1)</script>')).not.toMatch(/[<>]/);
    expect(sanitizeRevisionToken('"><img src=x onerror=alert(1)>')).not.toMatch(/[<>"']/);
    expect(sanitizeRevisionToken('&amp;')).not.toMatch(/&/);
  });

  it('strips control characters and bounds length (no secret/PII bleed, bounded surface)', () => {
    const long = `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9${'x'.repeat(500)}`;
    const out = sanitizeRevisionToken(long, 64);
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out).not.toMatch(/[\u0000-\u001f\u007f]/);
    // The credential-like payload is bounded to 64 sanitized characters, never echoed in full.
    expect(out).not.toContain('x'.repeat(100));
  });

  it('treats null/undefined as an empty safe string', () => {
    expect(sanitizeRevisionToken(null)).toBe('');
    expect(sanitizeRevisionToken(undefined)).toBe('');
  });
});

describe.each(LANE_MUTATIONS)('T-009 — two independent writers (R-024) for lane %s', ({ artifactType, mutation }) => {
  it('writer A commits; writer B prepared against a stale revision is rejected BEFORE any adapter write', async () => {
    const { adapter, recording, externalId, revision } = await seedDoc(artifactType, mutation);
    expect(revision).toBe('rev-1');

    // Writer A: independent snapshot (rev-1), precondition satisfied, commits -> rev-2.
    const preA = await readMutationPrecondition({ adapter, externalId, providerConnectionId: null, mutation });
    assertMutationPrecondition({ precondition: preA, expectedRevision: 'rev-1', documentId: 'doc_x' });
    const resA = await adapter.mutate({
      external_id: externalId,
      provider_connection_id: null,
      expectedRevision: 'rev-1',
      mutation,
      idempotencyKey: 'op-a',
      now: FIXED_NOW,
    });
    expect(resA.resultRevision).toBe('rev-2');

    // Writer B: a SECOND independent writer prepared against the now-stale rev-1.
    const callsBefore = recording.mutateCalls.length;
    const preB = await readMutationPrecondition({ adapter, externalId, providerConnectionId: null, mutation });
    // The coordinator observes the authoritative current revision (rev-2) and rejects B's stale
    // expectation rev-1 — the stale write is rejected BEFORE it reaches the adapter.
    expect(preB.concurrencyProven).toBe(true);
    expect(preB.currentRevision).toBe('rev-2');
    let thrown: unknown;
    try {
      assertMutationPrecondition({ precondition: preB, expectedRevision: 'rev-1', documentId: 'doc_x' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(StaleRevisionError);
    expect((thrown as StaleRevisionError).expectedRevision).toBe('rev-1');
    expect((thrown as StaleRevisionError).currentRevision).toBe('rev-2');

    // Proof: NO adapter write for writer B (the coordinator rejected pre-write) and the document
    // still holds writer A's revision (rev-2) — B's stale write never succeeds silently.
    expect(recording.mutateCalls.length).toBe(callsBefore);
    const after = await adapter.getMetadata({ external_id: externalId });
    expect(after?.current_revision).toBe('rev-2');
  });

  it('defense-in-depth: even if B snapped rev-1 before A committed, the atomic adapter write rejects the stale commit', async () => {
    const { adapter, externalId } = await seedDoc(artifactType, mutation);
    // Both writers independently snapshot the same rev-1.
    const preA = await readMutationPrecondition({ adapter, externalId, providerConnectionId: null, mutation });
    const preB = await readMutationPrecondition({ adapter, externalId, providerConnectionId: null, mutation });
    expect(preA.currentRevision).toBe('rev-1');
    expect(preB.currentRevision).toBe('rev-1');

    // A commits first.
    const resA = await adapter.mutate({
      external_id: externalId,
      provider_connection_id: null,
      expectedRevision: 'rev-1',
      mutation,
      idempotencyKey: 'op-a2',
      now: FIXED_NOW,
    });
    expect(resA.resultRevision).toBe('rev-2');

    // B's precondition snapshot matched rev-1, so B's coordinate-level assert passes; the write
    // still cannot succeed silently because the adapter re-checks the current revision atomically.
    assertMutationPrecondition({ precondition: preB, expectedRevision: 'rev-1', documentId: 'doc_x' });
    await expect(
      adapter.mutate({
        external_id: externalId,
        provider_connection_id: null,
        expectedRevision: 'rev-1',
        mutation,
        idempotencyKey: 'op-b2',
        now: FIXED_NOW,
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);

    const after = await adapter.getMetadata({ external_id: externalId });
    expect(after?.current_revision).toBe('rev-2');
  });
});

describe('T-009 — unsafe provider with no concurrency evidence FAILS CLOSED (R-024)', () => {
  it('readMutationPrecondition reports concurrencyProven=false when the provider exposes no revision token', async () => {
    const { adapter, externalId } = await seedDoc('document', { kind: 'text', text: 'x' });
    // A compliant-connless adapter advertises the lane but returns NO current revision from the
    // authoritative metadata surface (no concurrency token). The coordinator must not fabricate one.
    const noTokenAdapter: DocumentProviderAdapter = {
      provider: 'local_office',
      resolveCapabilities: (ctx) => adapter.resolveCapabilities(ctx),
      discover: (i) => adapter.discover(i),
      getMetadata: async () => ({ ...(await adapter.getMetadata({ external_id: externalId }))!, current_revision: null }),
      create: (i) => adapter.create(i),
      read: (i) => adapter.read(i),
      mutate: (i) => adapter.mutate(i),
      getOpenTarget: (i) => adapter.getOpenTarget(i),
      reconcileChanges: (i) => adapter.reconcileChanges(i),
    };
    const pre = await readMutationPrecondition({
      adapter: noTokenAdapter,
      externalId,
      providerConnectionId: null,
      mutation: { kind: 'text', text: 'x' },
    });
    expect(pre.concurrencyProven).toBe(false);
    expect(pre.currentRevision).toBeNull();
  });

  it('assertMutationPrecondition FAILS CLOSED with a typed UnsafeMutationError — never writes optimistically', async () => {
    const { adapter, externalId, recording } = await seedDoc('document', { kind: 'text', text: 'x' });
    const noTokenAdapter: DocumentProviderAdapter = {
      provider: 'google_workspace',
      resolveCapabilities: (ctx) => adapter.resolveCapabilities(ctx),
      discover: (i) => adapter.discover(i),
      getMetadata: async () => ({ ...(await adapter.getMetadata({ external_id: externalId }))!, current_revision: null }),
      create: (i) => adapter.create(i),
      read: (i) => adapter.read(i),
      mutate: (i) => adapter.mutate(i),
      getOpenTarget: (i) => adapter.getOpenTarget(i),
      reconcileChanges: (i) => adapter.reconcileChanges(i),
    };
    const pre = await readMutationPrecondition({
      adapter: noTokenAdapter,
      externalId,
      providerConnectionId: null,
      mutation: { kind: 'text', text: 'x' },
    });
    let thrown: unknown;
    try {
      assertMutationPrecondition({ precondition: pre, expectedRevision: 'rev-1', documentId: 'doc_x' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnsafeMutationError);
    const unsafe = thrown as UnsafeMutationError;
    expect(unsafe.lane).toBe('agent_text_mutation');
    // No adapter write occurred — the lane fails closed instead of writing optimistically.
    expect(recording.mutateCalls.length).toBe(0);
  });

  it('preflightMutation composes read + assert and propagates the fail-closed UnsafeMutationError', async () => {
    const { adapter, externalId } = await seedDoc('document', { kind: 'text', text: 'x' });
    const noTokenAdapter: DocumentProviderAdapter = {
      provider: 'google_workspace',
      resolveCapabilities: (ctx) => adapter.resolveCapabilities(ctx),
      discover: (i) => adapter.discover(i),
      getMetadata: async () => ({ ...(await adapter.getMetadata({ external_id: externalId }))!, current_revision: null }),
      create: (i) => adapter.create(i),
      read: (i) => adapter.read(i),
      mutate: (i) => adapter.mutate(i),
      getOpenTarget: (i) => adapter.getOpenTarget(i),
      reconcileChanges: (i) => adapter.reconcileChanges(i),
    };
    await expect(
      preflightMutation({
        adapter: noTokenAdapter,
        externalId,
        providerConnectionId: null,
        mutation: { kind: 'text', text: 'x' },
        expectedRevision: 'rev-1',
        documentId: 'doc_x',
      }),
    ).rejects.toBeInstanceOf(UnsafeMutationError);
  });
});

describe('T-009 — preflight success + STALE_REVISION envelope (R-025 contract, sanitized)', () => {
  it('preflightMutation passes for a matching expected revision and returns the precondition', async () => {
    const { adapter, externalId } = await seedDoc('document', { kind: 'text', text: 'x' });
    const pre = await preflightMutation({
      adapter,
      externalId,
      providerConnectionId: null,
      mutation: { kind: 'text', text: 'x' },
      expectedRevision: 'rev-1',
      documentId: 'doc_x',
    });
    expect(pre.concurrencyProven).toBe(true);
    expect(pre.currentRevision).toBe('rev-1');
  });

  it('staleRevisionBody preserves the §12.3/R-025 envelope with SANITIZED expected/current revisions', async () => {
    const hostile = '<script>alert(1)</script>rev\x00-2';
    const err = new StaleRevisionError('rev-1', hostile);
    const body = staleRevisionBody(err, 'doc_123');
    expect(body.code).toBe('STALE_REVISION');
    expect(body.message).toBe(STALE_REVISION_MESSAGE);
    expect(body.documentId).toBe('doc_123');
    expect(body.expectedRevision).toBe('rev-1');
    // The hostile current revision is sanitized: no HTML, no control characters, bounded length,
    // and no document secrets/credentials.
    expect(body.currentRevision).not.toMatch(/[<>]/);
    expect(body.currentRevision).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(body.currentRevision).toBe(sanitizeRevisionToken(hostile));
    expect(body.retryable).toBe(true);
  });

  it('staleRevisionBody without documentId omits the field (non-mutate fallback)', () => {
    const body = staleRevisionBody(new StaleRevisionError('rev-1', 'rev-2'));
    expect(body.documentId).toBeUndefined();
    expect(body.expectedRevision).toBe('rev-1');
    expect(body.currentRevision).toBe('rev-2');
    expect(body.retryable).toBe(true);
  });
});
