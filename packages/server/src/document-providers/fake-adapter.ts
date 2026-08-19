/**
 * T-005 — deterministic fake provider adapter.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - T-005: "Scope: interface plus deterministic fake.",
 *     "Acceptance: shared contract tests can execute against fake.",
 *     "Security: unsupported mutation fails closed."
 *   - §10.2 "Proposed provider adapter contract" method surface.
 *   - §19.2 contract fixture: register/discover, metadata, create/read/mutate when
 *     supported, unsupported-mutation rejection, revision capture, stale-write rejection,
 *     preview/permission normalization, open target, connection degradation, idempotent
 *     reconciliation. "Unsupported capability is a valid contract outcome. Lying about
 *     support is not." => the fake advertises a BOUNDED honest capability set and fails
 *     closed (typed `UnsupportedAdapterMutationError`) on any lane it does not advertise.
 *
 * Determinism guarantees (no network / no clock dependence / no uncontrolled randomness):
 *   - `now()` is INJECTED (defaults to a fixed constant), so timestamps never depend on the
 *     wall clock; identical seed + inputs => identical outputs.
 *   - Duplicate-free external IDs and revisions are produced by a monotonic deterministic
 *     counter (`rev-N`, `${provider}-${artifact_type}-N`), never a random UUID.
 *   - The in-memory store is keyed by external_id and idempotency-keyed for R-026 replay.
 *
 * Capability honesty: the fake reports its capabilities through the SINGLE T-002 capability
 * model (CapabilityReport / CapabilityState / capabilityAllowsAction) — it does not invent a
 * second capability namespace. Its baseline is text-mutation-first: `agent_text_mutation` and
 * `create` are supported, while `agent_range_mutation`, `agent_slide_mutation`,
 * `permission_write`, and `embed_editor` are honestly `unsupported` — so asking for those
 * lanes fails closed and no supported read is ever pretended to be a write.
 *
 * Privacy: stores only leaf R-001 metadata and a synthetic placeholder string; no credentials,
 * raw tokens, tenant secrets, document contents, or operator-specific absolute paths.
 *
 * Reversibility: the fake performs NO external/provider writes and registers no immutable flag
 * of its own; its rollout is tied to the audited Phase 2 flag framework (T-006 registers the
 * unified-registry flag on packages/server/src/phase2-flags.ts). See T-005 EVIDENCE §reversal.
 */

import type {
  CapabilityContext,
  CapabilityReport,
  CapabilityState,
  CapabilityType,
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
  ResolvedCapability,
} from './types';
import {
  AdapterArtifactNotFoundError,
  StaleRevisionError,
  UnsupportedAdapterMutationError,
  assertAdapterActionSupported,
  mutationCapability,
} from './types';
import { FAIL_CLOSED_CAPABILITIES } from './types';
import {
  type DocumentArtifactType,
  type DocumentAuthState,
  type DocumentConflictState,
  type DocumentPreviewState,
  type DocumentProvider,
  type DocumentReadinessState,
} from '../../../db/src/document-integrations';

/** Fixed deterministic clock used when no `now` is injected — no wall-clock dependence. */
export const FAKE_ADAPTER_FIXED_NOW = '2026-08-18T00:00:00.000Z';

/** Extension surface beyond the contract, used by the shared suite to drive deterministic state. */
export interface DeterministicFakeAdapter extends DocumentProviderAdapter {
  /** Flip the adapter's connection state (drives R-002 degraded-suppression fail-closed). */
  setConnectionState(state: DocumentAuthState): void;
}

export interface FakeDocumentProviderAdapterOptions {
  provider?: DocumentProvider;
  /** Seed the adapter's connection state (default 'authorized'). */
  connectionState?: DocumentAuthState;
  /** Override specific capability states for deterministic negative/mismatch tests. */
  capabilities?: Partial<Record<CapabilityType, CapabilityState>>;
  /** Injected clock; default is the fixed constant above (determinism). */
  now?: () => string;
}

interface StoredArtifact {
  descriptor: ProviderArtifactDescriptor;
  /** Synthetic placeholder content, never real document contents (privacy). */
  placeholder: string;
  revisionSeq: number;
}

/**
 * R-002 write/embedding/human-edit lanes the fake baseline treats as writes (fail-closed set).
 * THE-946 r1 F5: reuse the exported FAIL_CLOSED_CAPABILITIES rather than a hand-duplicated list,
 * so the fake and the resolution model can never drift apart on what counts as a side effect.
 */
const WRITE_LANES: readonly CapabilityType[] = [...FAIL_CLOSED_CAPABILITIES];

export function createFakeDocumentProviderAdapter(
  options: FakeDocumentProviderAdapterOptions = {},
): DeterministicFakeAdapter {
  const provider: DocumentProvider = options.provider ?? 'google_workspace';
  const now: () => string = options.now ?? (() => FAKE_ADAPTER_FIXED_NOW);
  const capabilities = options.capabilities ?? {};

  const artifacts = new Map<string, StoredArtifact>();
  const idempotencyByKey = new Map<string, string>();
  let revisionCounter = 0;
  let externalCounter = 0;
  let connectionState: DocumentAuthState = options.connectionState ?? 'authorized';

  function nextExternalId(artifactType: DocumentArtifactType): string {
    const id = `${provider}-${artifactType}-${externalCounter}`;
    externalCounter += 1;
    return id;
  }

  function nextRevision(): string {
    const r = `rev-${revisionCounter + 1}`;
    revisionCounter += 1;
    return r;
  }

  /**
   * R-002 fail-closed: a degraded, unauthorized, OR unknown authenticated connection suppresses
   * a normally supported side-effecting lane. `unknown` is conservative (treated as impaired for
   * write/embedding/human_edit) rather than optimistic. THE-946 r1 F2.
   */
  function buildReport(ctx: CapabilityContext): CapabilityReport {
    const degradationActive =
      connectionState === 'degraded' ||
      connectionState === 'unauthorized' ||
      connectionState === 'unknown' ||
      ctx.connectionState === 'degraded' ||
      ctx.connectionState === 'unauthorized' ||
      ctx.connectionState === 'unknown';

    const base: Record<CapabilityType, CapabilityState> = {
      create: capabilities.create ?? 'supported',
      read: capabilities.read ?? 'supported',
      preview: capabilities.preview ?? 'supported',
      thumbnail: capabilities.thumbnail ?? 'supported',
      open_external: capabilities.open_external ?? 'supported',
      human_edit: capabilities.human_edit ?? 'unsupported',
      agent_text_mutation: capabilities.agent_text_mutation ?? 'supported',
      agent_range_mutation: capabilities.agent_range_mutation ?? 'unsupported',
      agent_slide_mutation: capabilities.agent_slide_mutation ?? 'unsupported',
      version_history: capabilities.version_history ?? 'supported',
      change_tracking: capabilities.change_tracking ?? 'supported',
      permission_read: capabilities.permission_read ?? 'supported',
      permission_write: capabilities.permission_write ?? 'unsupported',
      embed_editor: capabilities.embed_editor ?? 'unsupported',
      export: capabilities.export ?? 'supported',
    };

    const entries = (Object.keys(base) as CapabilityType[]).map((name) => {
      let state = base[name];
      let source: ResolvedCapability['source'] = 'adapter';
      if (degradationActive && (WRITE_LANES.includes(name) || name === 'human_edit')) {
        // (F5, THE-947 r1) A degraded/unauthorized/unknown connection can only SUPPRESS a write
        // lane, never paper over it — and the labeling now matches the Capability Resolver's
        // `connectionEvidence`: an `unknown` connection folds the lane to `unknown`
        // (fail-closed), while degraded/unauthorized fold a supported lane to `degraded`.
        // `source:'connection'` is tagged only when the fold actually changed the lane.
        const connectionIsUnknown =
          connectionState === 'unknown' || ctx.connectionState === 'unknown';
        if (state === 'supported') {
          state = connectionIsUnknown ? 'unknown' : 'degraded';
          source = 'connection';
        }
      }
      return [name, { name, state, source }] as const;
    });
    // The runtime test in the shared contract suite asserts every entry's `name` equals its key
    // (T-002 capabilityAllowsActionForKey rejects mislabeled reports), so the cast is safe and
    // checked at runtime.
    return Object.fromEntries(entries) as CapabilityReport;
  }

  function toDescriptor(record: StoredArtifact, overrides: Partial<ProviderArtifactDescriptor> = {}): ProviderArtifactDescriptor {
    return { ...record.descriptor, ...overrides };
  }

  function requireArtifact(externalId: string): StoredArtifact {
    const record = artifacts.get(externalId);
    if (!record) {
      throw new AdapterArtifactNotFoundError(externalId);
    }
    return record;
  }

  function reportForArtifact(artifactType: DocumentArtifactType): CapabilityReport {
    return buildReport({
      provider,
      artifact_type: artifactType,
      connectionState,
      destinationId: null,
      runtime: {},
    });
  }

  const adapter: DeterministicFakeAdapter = {
    provider,
    setConnectionState(state: DocumentAuthState): void {
      connectionState = state;
    },

    async resolveCapabilities(ctx: CapabilityContext): Promise<CapabilityReport> {
      return buildReport(ctx);
    },

    async discover(input: DiscoverDocumentsInput): Promise<DiscoverDocumentsResult> {
      let items = [...artifacts.values()].map((r) => toDescriptor(r));
      if (input.limit !== undefined && Number.isFinite(input.limit)) {
        items = items.slice(0, input.limit);
      }
      const truncated = items.length < artifacts.size;
      // Deterministic ordering by external_id so identical discovery input => identical result.
      items = [...items].sort((a, b) => a.external_id.localeCompare(b.external_id));
      return { items, truncated };
    },

    async getMetadata(input: GetDocumentMetadataInput): Promise<ProviderArtifactDescriptor | null> {
      const record = artifacts.get(input.external_id);
      return record ? toDescriptor(record) : null;
    },

    async create(input: CreateDocumentInput): Promise<CreateDocumentResult> {
      // R-026 idempotency replay: a replayed key reconciles to the existing artifact.
      const existingId = idempotencyByKey.get(input.idempotencyKey);
      if (existingId !== undefined) {
        return { descriptor: toDescriptor(requireArtifact(existingId)), created: false };
      }
      const report = reportForArtifact(input.artifact_type);
      assertAdapterActionSupported(report, 'create', `create ${provider}/${input.artifact_type}`);
      const externalId = nextExternalId(input.artifact_type);
      const revision = nextRevision();
      const ts = input.now ?? now();
      const descriptor: ProviderArtifactDescriptor = {
        provider,
        artifact_type: input.artifact_type,
        external_id: externalId,
        provider_connection_id: null,
        title: input.title,
        provider_url: input.provider_url ?? `https://example.test/${provider}/${externalId}`,
        auth_state: connectionState,
        readiness_state: connectionState === 'authorized' ? 'ready' : 'degraded',
        current_revision: revision,
        provider_modified_at: ts,
        preview_state: 'ready',
        conflict_state: 'none',
      };
      const record: StoredArtifact = {
        descriptor,
        placeholder: `fake:content:${externalId}:${revision}`,
        revisionSeq: revisionCounter,
      };
      artifacts.set(externalId, record);
      idempotencyByKey.set(input.idempotencyKey, externalId);
      return { descriptor: toDescriptor(record), created: true };
    },

    async read(input: ReadDocumentInput): Promise<ReadDocumentResult> {
      const record = requireArtifact(input.external_id);
      // Read-lane honesty (THE-946 r1 F1): a read over an unsupported/unknown/absent capability
      // fails closed instead of pretending content is available.
      assertAdapterActionSupported(reportForArtifact(record.descriptor.artifact_type), 'read', `read ${input.external_id}`);
      if (input.expectedRevision != null && input.expectedRevision !== record.descriptor.current_revision) {
        throw new StaleRevisionError(input.expectedRevision, record.descriptor.current_revision ?? '');
      }
      return { descriptor: toDescriptor(record), contentPlaceholder: record.placeholder };
    },

    async mutate(input: MutateDocumentInput): Promise<MutateDocumentResult> {
      const record = requireArtifact(input.external_id);
      const capability = mutationCapability(input.mutation);
      // Defense-in-depth: the adapter itself re-confirms the advertised capability before
      // mutating, so it can never be talked into a write it did not report (fail-closed).
      assertAdapterActionSupported(reportForArtifact(record.descriptor.artifact_type), capability, `mutate ${input.external_id}`);
      if (input.expectedRevision !== record.descriptor.current_revision) {
        throw new StaleRevisionError(input.expectedRevision, record.descriptor.current_revision ?? '');
      }
      const priorRevision = record.descriptor.current_revision ?? '';
      const resultRevision = nextRevision();
      const ts = input.now ?? now();
      const recordUpdated: StoredArtifact = {
        ...record,
        descriptor: toDescriptor(record, {
          current_revision: resultRevision,
          provider_modified_at: ts,
          conflict_state: 'none',
        }),
        placeholder: `fake:content:${input.external_id}:${resultRevision}`,
      };
      artifacts.set(input.external_id, recordUpdated);
      return {
        descriptor: toDescriptor(recordUpdated),
        priorRevision,
        resultRevision,
      };
    },

    async getVersions(input: GetVersionsInput): Promise<GetVersionsResult> {
      const record = requireArtifact(input.external_id);
      // Read-lane honesty (THE-946 r1 F1): version history is a read-like lane.
      assertAdapterActionSupported(reportForArtifact(record.descriptor.artifact_type), 'version_history', `versions ${input.external_id}`);
      const versions = [{ revision: record.descriptor.current_revision ?? '', observed_at: record.descriptor.provider_modified_at }];
      const limit = input.limit ?? Number.POSITIVE_INFINITY;
      return { versions: versions.slice(0, limit) };
    },

    async getPreview(input: GetPreviewInput): Promise<GetPreviewResult> {
      const record = requireArtifact(input.external_id);
      // Read-lane honesty (THE-946 r1 F1): preview is a read-like lane, never authoritative content.
      assertAdapterActionSupported(reportForArtifact(record.descriptor.artifact_type), 'preview', `preview ${input.external_id}`);
      return {
        state: record.descriptor.preview_state,
        previewUrl: record.descriptor.preview_state === 'ready'
          ? `https://example.test/preview/${record.descriptor.external_id}`
          : null,
      };
    },

    async getPermissions(input: GetPermissionsInput): Promise<GetPermissionsResult> {
      const record = requireArtifact(input.external_id);
      // Read-lane honesty (THE-946 r1 F1): permission summary is a read-like lane.
      assertAdapterActionSupported(reportForArtifact(record.descriptor.artifact_type), 'permission_read', `permissions ${input.external_id}`);
      // Permissions summary is leaf metadata only — never raw tokens/credentials (D-013).
      return { summary_json: JSON.stringify({ viewer: true, editor: false }) };
    },

    async getOpenTarget(input: OpenTargetInput): Promise<OpenTargetResult> {
      const record = requireArtifact(input.external_id);
      // open_external is a read-like capability; unsupported => typed fail-closed, no fabricated URL.
      assertAdapterActionSupported(reportForArtifact(record.descriptor.artifact_type), 'open_external', `open ${input.external_id}`);
      return {
        provider: record.descriptor.provider,
        artifact_type: record.descriptor.artifact_type,
        url: record.descriptor.provider_url,
      };
    },

    async reconcileChanges(input: ReconcileChangesInput): Promise<ReconcileChangesResult> {
      const known = new Set(artifacts.keys());
      const present = new Set<string>();
      const reconciled: ProviderArtifactDescriptor[] = [];
      for (const discovered of input.discovered) {
        present.add(discovered.external_id);
        if (known.has(discovered.external_id)) {
          // Idempotent convergence: a rediscovered identity updates the existing record in place
          // (R-001 "Rediscovery does not duplicate") rather than minting a new canonical record.
          const current = requireArtifact(discovered.external_id);
          const merged: StoredArtifact = {
            ...current,
            descriptor: toDescriptor(current, {
              title: discovered.title,
              provider_url: discovered.provider_url,
              current_revision: discovered.current_revision ?? current.descriptor.current_revision,
            }),
          };
          artifacts.set(discovered.external_id, merged);
          reconciled.push(toDescriptor(merged));
        } else {
          // A brand-new discovery is adopted as a new artifact (register path).
          const ts = now();
          const descriptor: ProviderArtifactDescriptor = { ...discovered, provider_modified_at: ts };
          const record: StoredArtifact = {
            descriptor,
            placeholder: `fake:content:${discovered.external_id}:${discovered.current_revision ?? 'rev-0'}`,
            revisionSeq: revisionCounter,
          };
          artifacts.set(discovered.external_id, record);
          reconciled.push(toDescriptor(record));
        }
      }
      const dropped = [...known].filter((id) => !present.has(id));
      reconciled.sort((a, b) => a.external_id.localeCompare(b.external_id));
      return { reconciled, dropped: dropped.sort() };
    },
  };

  return adapter;
}
