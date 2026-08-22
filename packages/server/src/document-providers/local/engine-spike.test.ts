import { describe, expect, it } from 'vitest';
import {
  LOCAL_ENGINE_CANDIDATE_MATRIX,
  candidateEvidence,
  selectLocalEngine,
} from './engine-spike';

describe('local engine spike decision seam', () => {
  it('keeps the candidate matrix explicit and recommends only the reversible bridge boundary', () => {
    expect(LOCAL_ENGINE_CANDIDATE_MATRIX).toHaveLength(4);
    expect(candidateEvidence('desktop-bridge').disposition).toBe('candidate');
    expect(candidateEvidence('genoffice').disposition).toBe('deferred');
    expect(candidateEvidence('onlyoffice').licensing).toBe('review-required');
    expect(candidateEvidence('univer').fidelity).toBe('unmeasured');
  });

  it('proves success only after bridge, fidelity, and licensing evidence are present', () => {
    expect(selectLocalEngine({
      candidate: candidateEvidence('desktop-bridge'),
      requiredFormats: ['docx'],
      verifiedFormats: ['docx'],
      bridgeReady: true,
    })).toEqual({ selected: true, state: 'ready', reason: 'candidate_evidence_sufficient' });
  });

  it('degrades safely when the bridge is absent or a required format is unverified', () => {
    const candidate = candidateEvidence('desktop-bridge');
    expect(selectLocalEngine({ candidate, requiredFormats: ['docx'], verifiedFormats: ['docx'], bridgeReady: false }))
      .toEqual({ selected: false, state: 'degraded', reason: 'bridge_unavailable' });
    expect(selectLocalEngine({ candidate, requiredFormats: ['docx', 'xlsx'], verifiedFormats: ['docx'], bridgeReady: true }))
      .toEqual({ selected: false, state: 'degraded', reason: 'fidelity_unverified:xlsx' });
  });

  it('does not promote an unmeasured or rejected candidate', () => {
    expect(selectLocalEngine({
      candidate: candidateEvidence('genoffice'),
      requiredFormats: [],
      verifiedFormats: [],
      bridgeReady: true,
    })).toEqual({ selected: false, state: 'unavailable', reason: 'candidate_evidence_incomplete' });
    expect(selectLocalEngine({
      candidate: { ...candidateEvidence('genoffice'), disposition: 'rejected' },
      requiredFormats: [],
      verifiedFormats: [],
      bridgeReady: true,
    })).toEqual({ selected: false, state: 'unavailable', reason: 'candidate_rejected' });
  });
});
