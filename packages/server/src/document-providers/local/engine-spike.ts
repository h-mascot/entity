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
  create(input: CreateArtifactInput): Promise<CreateArtifactResult>;
  open(input: OpenArtifactInput): Promise<OpenArtifactResult>;
  inspect(input: InspectArtifactInput): Promise<ArtifactStructure>;
  mutate(input: MutateArtifactInput): Promise<MutationResult>;
  save(input: SaveArtifactInput): Promise<SaveResult>;
}

export type LocalDocumentActor =
  | { actorClass: 'agent'; actorId: string | null; receipt: import('../../receipt-writer').CompletionReceiptResult }
  | { actorClass: 'human' | 'local_external_actor' | 'system'; actorId: string | null };

export interface CreateArtifactInput extends OpenArtifactInput {
  document: unknown;
  idempotencyKey: string;
  actor: LocalDocumentActor;
}

export interface CreateArtifactResult {
  documentId: string;
  documentRef: string;
  entityUrl: string;
  revision: string;
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
  documentId: string;
  expectedRevision: string;
  mutation: import('../types').AdapterMutation;
  idempotencyKey: string;
  actor: LocalDocumentActor;
}
export interface SaveArtifactInput extends OpenArtifactInput {
  documentId: string;
  candidate: Buffer;
  expectedRevision: string;
  idempotencyKey: string;
  actor: LocalDocumentActor;
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

export type FormatVerification = 'unmeasured' | 'conditional' | 'verified';

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
  formatVerification: Readonly<Record<LocalOfficeFormat, FormatVerification>>;
  rationale: string;
}

export const LOCAL_ENGINE_CANDIDATE_MATRIX: readonly EngineCandidateEvidence[] = [
  {
    candidate: 'genoffice', disposition: 'deferred', fidelity: 'unmeasured',
    structuredMutation: 'unmeasured', humanEditing: 'unmeasured', headless: 'unmeasured',
    licensing: 'unverified', securityBoundary: 'unverified', maintenance: 'unverified',
    formatVerification: { docx: 'unmeasured', xlsx: 'unmeasured', pptx: 'unmeasured' },
    rationale: 'Candidate named by the PRD, but this checkout contains no verified runtime, API, license, or round-trip fixture evidence.',
  },
  {
    candidate: 'onlyoffice', disposition: 'deferred', fidelity: 'unmeasured',
    structuredMutation: 'adapter-required', humanEditing: 'embedded', headless: 'possible',
    licensing: 'review-required', securityBoundary: 'sandbox-required', maintenance: 'active-upstream',
    formatVerification: { docx: 'unmeasured', xlsx: 'unmeasured', pptx: 'unmeasured' },
    rationale: 'Potentially maintained editor route, but embedding, distribution, licensing, isolation, and Office-fidelity proof are not performed here.',
  },
  {
    candidate: 'univer', disposition: 'deferred', fidelity: 'unmeasured',
    structuredMutation: 'adapter-required', humanEditing: 'embedded', headless: 'possible',
    licensing: 'review-required', securityBoundary: 'sandbox-required', maintenance: 'active-upstream',
    formatVerification: { docx: 'unmeasured', xlsx: 'unmeasured', pptx: 'unmeasured' },
    rationale: 'Potentially useful web editor component, but OOXML round-trip fidelity and distribution/licensing proof are absent.',
  },
  {
    candidate: 'desktop-bridge', disposition: 'candidate', fidelity: 'conditional',
    structuredMutation: 'adapter-required', humanEditing: 'external-desktop', headless: 'unmeasured',
    licensing: 'review-required', securityBoundary: 'entity-document-allowlist', maintenance: 'installed-app-dependent',
    formatVerification: { docx: 'conditional', xlsx: 'conditional', pptx: 'conditional' },
    rationale: 'Recommended reversible boundary: delegate human editing to an installed editor through a document-scoped bridge; defer engine-specific mutation until fixtures prove it.'
  },
];

export interface EngineSelectionInput {
  candidate: EngineCandidateEvidence;
  requiredFormats: readonly LocalOfficeFormat[];
  bridgeReady: boolean;
}

export interface EngineSelection {
  selected: boolean;
  state: EngineReadinessState;
  reason: string;
}

/** Select only a candidate whose required evidence has actually been measured. */
export function selectLocalEngine(input: EngineSelectionInput): EngineSelection {
  if (input.candidate.disposition !== 'candidate') {
    return { selected: false, state: 'unavailable', reason: `candidate_${input.candidate.disposition}` };
  }
  if (!input.bridgeReady) {
    return { selected: false, state: 'degraded', reason: 'bridge_unavailable' };
  }
  const missing = input.requiredFormats.filter(
    (format) => input.candidate.formatVerification[format] !== 'verified',
  );
  if (missing.length > 0) {
    return { selected: false, state: 'degraded', reason: `fidelity_unverified:${missing.join(',')}` };
  }
  const productionReady = input.candidate.fidelity === 'high'
    && input.candidate.structuredMutation === 'available'
    && input.candidate.headless === 'available'
    && input.candidate.licensing === 'permissive'
    && input.candidate.securityBoundary === 'entity-document-allowlist'
    && input.candidate.maintenance !== 'unverified';
  if (!productionReady) {
    return { selected: false, state: 'unavailable', reason: 'candidate_evidence_incomplete' };
  }
  return { selected: true, state: 'ready', reason: 'candidate_evidence_sufficient' };
}

export function candidateEvidence(candidate: LocalEngineCandidate): EngineCandidateEvidence {
  return LOCAL_ENGINE_CANDIDATE_MATRIX.find((entry) => entry.candidate === candidate)!;
}
