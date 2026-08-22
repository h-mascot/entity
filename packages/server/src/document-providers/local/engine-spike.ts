/**
 * T-025 / THE-966 / R-017 — pure local Office engine comparison seam.
 *
 * This is decision evidence, not a runtime engine or bridge. It deliberately has no
 * filesystem, process, network, Electron, credential, or provider-registry dependency.
 * A future adapter can implement LocalOfficeEngine without changing this decision model.
 */

export type LocalOfficeFormat = 'docx' | 'xlsx' | 'pptx';
export type LocalEngineCandidate = 'genoffice' | 'onlyoffice' | 'univer' | 'desktop-bridge';
export type EngineDisposition = 'candidate' | 'deferred' | 'rejected';
export type EngineReadinessState = 'ready' | 'degraded' | 'unavailable';

export interface LocalOfficeEngine {
  probe(): Promise<EngineReadiness>;
  open(input: OpenArtifactInput): Promise<OpenArtifactResult>;
  inspect(input: InspectArtifactInput): Promise<ArtifactStructure>;
  mutate(input: MutateArtifactInput): Promise<MutationResult>;
  save(input: SaveArtifactInput): Promise<SaveResult>;
}

export interface OpenArtifactInput {
  documentRef: string;
  format: LocalOfficeFormat;
}

export interface OpenArtifactResult {
  opened: boolean;
  readiness: EngineReadinessState;
}

export interface InspectArtifactInput extends OpenArtifactInput {}
export interface MutateArtifactInput extends OpenArtifactInput {
  operation: string;
}
export interface SaveArtifactInput extends OpenArtifactInput {
  expectedRevision: string;
}
export interface ArtifactStructure {
  format: LocalOfficeFormat;
  valid: boolean;
}
export interface MutationResult {
  changed: boolean;
  revision: string | null;
}
export interface SaveResult {
  saved: boolean;
  revision: string | null;
}
export interface EngineReadiness {
  state: EngineReadinessState;
  reason: string;
}

export interface EngineCandidateEvidence {
  candidate: LocalEngineCandidate;
  disposition: EngineDisposition;
  fidelity: 'unmeasured' | 'conditional' | 'high';
  structuredMutation: 'unmeasured' | 'adapter-required' | 'available';
  humanEditing: 'unmeasured' | 'external-desktop' | 'embedded';
  headless: 'unmeasured' | 'possible' | 'available';
  licensing: 'unverified' | 'review-required' | 'permissive';
  securityBoundary: 'unverified' | 'entity-document-allowlist' | 'sandbox-required';
  maintenance: 'unverified' | 'active-upstream' | 'installed-app-dependent';
  rationale: string;
}

export const LOCAL_ENGINE_CANDIDATE_MATRIX: readonly EngineCandidateEvidence[] = [
  {
    candidate: 'genoffice', disposition: 'deferred', fidelity: 'unmeasured',
    structuredMutation: 'unmeasured', humanEditing: 'unmeasured', headless: 'unmeasured',
    licensing: 'unverified', securityBoundary: 'unverified', maintenance: 'unverified',
    rationale: 'Candidate named by the PRD, but this checkout contains no verified runtime, API, license, or round-trip fixture evidence.',
  },
  {
    candidate: 'onlyoffice', disposition: 'deferred', fidelity: 'unmeasured',
    structuredMutation: 'adapter-required', humanEditing: 'embedded', headless: 'possible',
    licensing: 'review-required', securityBoundary: 'sandbox-required', maintenance: 'active-upstream',
    rationale: 'Potentially maintained editor route, but embedding, distribution, licensing, isolation, and Office-fidelity proof are not performed here.',
  },
  {
    candidate: 'univer', disposition: 'deferred', fidelity: 'unmeasured',
    structuredMutation: 'adapter-required', humanEditing: 'embedded', headless: 'possible',
    licensing: 'review-required', securityBoundary: 'sandbox-required', maintenance: 'active-upstream',
    rationale: 'Potentially useful web editor component, but OOXML round-trip fidelity and distribution/licensing proof are absent.',
  },
  {
    candidate: 'desktop-bridge', disposition: 'candidate', fidelity: 'conditional',
    structuredMutation: 'adapter-required', humanEditing: 'external-desktop', headless: 'unmeasured',
    licensing: 'review-required', securityBoundary: 'entity-document-allowlist', maintenance: 'installed-app-dependent',
    rationale: 'Recommended reversible boundary: delegate human editing to an installed editor through a document-scoped bridge; defer engine-specific mutation until fixtures prove it.',
  },
];

export interface EngineSelectionInput {
  candidate: EngineCandidateEvidence;
  requiredFormats: readonly LocalOfficeFormat[];
  verifiedFormats: readonly LocalOfficeFormat[];
  bridgeReady: boolean;
}

export interface EngineSelection {
  selected: boolean;
  state: EngineReadinessState;
  reason: string;
}

/** Select only a candidate whose required evidence has actually been measured. */
export function selectLocalEngine(input: EngineSelectionInput): EngineSelection {
  if (input.candidate.disposition === 'rejected') {
    return { selected: false, state: 'unavailable', reason: 'candidate_rejected' };
  }
  if (!input.bridgeReady) {
    return { selected: false, state: 'degraded', reason: 'bridge_unavailable' };
  }
  const missing = input.requiredFormats.filter((format) => !input.verifiedFormats.includes(format));
  if (missing.length > 0) {
    return { selected: false, state: 'degraded', reason: `fidelity_unverified:${missing.join(',')}` };
  }
  if (input.candidate.fidelity === 'unmeasured' || input.candidate.licensing === 'unverified') {
    return { selected: false, state: 'unavailable', reason: 'candidate_evidence_incomplete' };
  }
  return { selected: true, state: 'ready', reason: 'candidate_evidence_sufficient' };
}

export function candidateEvidence(candidate: LocalEngineCandidate): EngineCandidateEvidence {
  return LOCAL_ENGINE_CANDIDATE_MATRIX.find((entry) => entry.candidate === candidate)!;
}
