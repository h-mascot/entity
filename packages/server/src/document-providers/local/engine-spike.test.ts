import { describe, expect, it } from 'vitest';
import {
  LOCAL_ENGINE_CANDIDATE_MATRIX,
  candidateEvidence,
  selectLocalEngine,
  type LocalOfficeEngine,
  type EngineReadiness,
} from './engine-spike';

describe('local engine spike decision seam', () => {
  const productionReadyCandidate = {
    ...candidateEvidence('desktop-bridge'),
    fidelity: 'high' as const, structuredMutation: 'available' as const,
    headless: 'available' as const, licensing: 'permissive' as const,
    formatVerification: { docx: 'verified' as const, xlsx: 'verified' as const, pptx: 'verified' as const },
  };
  it('keeps the candidate matrix explicit and recommends only the reversible bridge boundary', () => {
    expect(LOCAL_ENGINE_CANDIDATE_MATRIX).toHaveLength(4);
    expect(candidateEvidence('desktop-bridge').disposition).toBe('candidate');
    expect(candidateEvidence('genoffice').disposition).toBe('deferred');
    expect(candidateEvidence('onlyoffice').licensing).toBe('review-required');
    expect(candidateEvidence('univer').fidelity).toBe('unmeasured');
  });

  it('proves success only after bridge, fidelity, and licensing evidence are present', () => {
    expect(selectLocalEngine({
      candidate: productionReadyCandidate,
      requiredFormats: ['docx'],
      bridgeReady: true,
    })).toEqual({ selected: true, state: 'ready', reason: 'candidate_evidence_sufficient' });
  });

  it('degrades safely when the bridge is absent or a required format is unverified', () => {
    const candidate = productionReadyCandidate;
    const partiallyVerified = { ...candidate, formatVerification: { ...candidate.formatVerification, xlsx: 'unmeasured' as const } };
    expect(selectLocalEngine({ candidate, requiredFormats: ['docx'], bridgeReady: false }))
      .toEqual({ selected: false, state: 'degraded', reason: 'bridge_unavailable' });
    expect(selectLocalEngine({ candidate: partiallyVerified, requiredFormats: ['docx', 'xlsx'], bridgeReady: true }))
      .toEqual({ selected: false, state: 'degraded', reason: 'fidelity_unverified:xlsx' });
  });

  it('does not promote an unmeasured or rejected candidate', () => {
    expect(selectLocalEngine({
      candidate: candidateEvidence('genoffice'),
      requiredFormats: [],
      bridgeReady: true,
    })).toEqual({ selected: false, state: 'unavailable', reason: 'candidate_deferred' });
    expect(selectLocalEngine({
      candidate: { ...candidateEvidence('genoffice'), disposition: 'rejected' },
      requiredFormats: [],
      bridgeReady: true,
    })).toEqual({ selected: false, state: 'unavailable', reason: 'candidate_rejected' });
  });

  it('rejects deferred evidence even when every field is otherwise favorable', () => {
    const favorableDeferred = {
      ...candidateEvidence('genoffice'), disposition: 'deferred' as const,
      fidelity: 'high' as const, structuredMutation: 'available' as const,
      headless: 'available' as const, licensing: 'permissive' as const,
      securityBoundary: 'entity-document-allowlist' as const, maintenance: 'active-upstream' as const,
      formatVerification: { docx: 'verified' as const, xlsx: 'verified' as const, pptx: 'verified' as const },
    };
    expect(selectLocalEngine({ candidate: favorableDeferred, requiredFormats: ['docx'], bridgeReady: true }))
      .toEqual({ selected: false, state: 'unavailable', reason: 'candidate_deferred' });
  });

  it('exercises the provider-neutral fake engine seam with readiness and revision propagation', async () => {
    const readiness: EngineReadiness = { state: 'ready', reason: 'fake-ready' };
    const calls: string[] = [];
    const fake: LocalOfficeEngine = {
      async probe() { calls.push('probe'); return readiness; },
      async open(input) { calls.push(`open:${input.documentRef}`); return { opened: true, readiness: readiness.state }; },
      async inspect(input) { calls.push(`inspect:${input.documentRef}`); return { format: input.format, valid: true }; },
      async mutate(input) { calls.push(`mutate:${input.operation}`); return { changed: true, revision: 'r2' }; },
      async save(input) { calls.push(`save:${input.expectedRevision}`); return { saved: true, revision: 'r2' }; },
    };
    expect(await fake.probe()).toEqual(readiness);
    expect(await fake.open({ documentRef: 'doc-1', format: 'docx' })).toEqual({ opened: true, readiness: 'ready' });
    expect(await fake.inspect({ documentRef: 'doc-1', format: 'docx' })).toEqual({ format: 'docx', valid: true });
    expect(await fake.mutate({ documentRef: 'doc-1', format: 'docx', operation: 'replace-title' })).toEqual({ changed: true, revision: 'r2' });
    expect(await fake.save({ documentRef: 'doc-1', format: 'docx', expectedRevision: 'r2' })).toEqual({ saved: true, revision: 'r2' });
    expect(calls).toEqual(['probe', 'open:doc-1', 'inspect:doc-1', 'mutate:replace-title', 'save:r2']);
  });
});
