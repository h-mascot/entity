/**
 * THE-951 (T-010) — Activity + Entity execution receipts — integration adapter tests.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-027 "Activity and version attribution": durable normalized activity trail; actor
 *     classifications exactly `human` / `agent` / `provider_external_actor` /
 *     `local_external_actor` / `system` / `unknown`; if exact provider actor identity is
 *     unavailable Entity must use an honest coarse classification (never fabricate identity).
 *     Every activity record identifies: document; operation type; actor class; known actor ID
 *     where valid; old/new revision where applicable; provider; timestamp; success/failure;
 *     correlation/receipt ID where applicable.
 *   - R-028 "Execution receipts": every agent mutation must produce or link to the canonical
 *     Entity low-level execution receipt system; the provider artifact alone is not sufficient
 *     proof. An auditor can traverse Entity task/agent action → execution receipt → document
 *     operation → document version/revision → provider/local artifact.
 *   - T-010: "Non-goal: Replace existing receipt system." / "Introducing a second receipt store
 *     is a release blocker." OQ-019 remains the owning open question (record observations only).
 *
 * Method: deterministic ONLY through the deterministic fake adapter (T-005): no real timers, no
 * unseeded randomness, no network. The canonical receipt is produced through the REAL
 * `completeTaskWithReceipt` / `buildCanonicalReceiptMarkdown` / `hashCanonicalReceiptMarkdown`
 * surface (audit pointer, T-001-confirmed) against a temp storage root — never a competing store.
 *
 * Privacy: leaf identifiers only; no credentials, raw tokens, tenant secrets, document contents,
 * or operator-specific absolute paths in fixtures/output. Timestamps are injected fixed values.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  ActivityRecord,
  CreateActivityInput,
  EvidenceArtifactRecord,
  TaskRecord,
  UpdateTaskInput,
} from '../../../db/src';
import { completeTaskWithReceipt } from '../receipt-writer';
import { resolvePhase2Flags, type Phase2FlagSnapshot } from '../phase2-flags';
import { createFakeDocumentProviderAdapter } from './fake-adapter';
import type { ProviderArtifactDescriptor } from './types';

import {
  AuditorTraversalGapError,
  DOCUMENT_ACTIVITY_ACTOR_CLASSES,
  classifyDocumentActor,
  linkDocumentMutationToReceipt,
  recordDocumentActivity,
  traverseAuditorChain,
  type AuditorChainHop,
  type DocumentActivityActorClass,
  type DocumentActivityRecord,
} from './activity-adapter';

/** Fixed deterministic clock — no wall-clock dependence. */
const FIXED_NOW = '2026-08-18T00:00:00.000Z';

let tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

/* --------------------------------------------------------------------------- *
 * Fixtures
 * --------------------------------------------------------------------------- */

function makeDocumentActivity(overrides: Partial<DocumentActivityRecord> = {}): DocumentActivityRecord {
  return {
    id: 'op-1',
    documentId: 'doc-1',
    provider: 'google_workspace',
    artifactType: 'document',
    externalId: 'google_workspace-document-0',
    operationType: 'mutate',
    actorClass: 'agent',
    actorId: 'agent-1',
    priorRevision: 'rev-1',
    resultRevision: 'rev-2',
    timestamp: FIXED_NOW,
    succeeded: true,
    reasonCode: null,
    receiptId: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 42,
    org_id: 'org-1',
    team_id: 'team-1',
    project_id: 7,
    created_by_principal_id: 'creator-1',
    initiator_principal_id: 'initiator-1',
    initiator_type: 'human',
    owner_principal_id: 'owner-1',
    owner_principal_type: 'human',
    executor_principal_id: 'agent-1',
    assignment_state: 'assigned',
    taskmaster_drivable: false,
    name: 'Mutate a managed document',
    description: 'Agent mutation that must produce a canonical receipt.',
    brief: null,
    origin_channel: 'task',
    column: 'doing',
    model: 'entity-mc',
    archived: false,
    assignee: 'agent-1',
    blocked: false,
    blocker_reason: null,
    due_date: null,
    priority: 'P1',
    estimate_hours: null,
    time_spent: null,
    output: null,
    progress_status: null,
    recurring: false,
    recurring_config: null,
    created_at: '2026-06-23T10:00:00.000Z',
    updated_at: '2026-06-23T10:30:00.000Z',
    metadata: '{}',
    project: null,
    projects: [],
    ...overrides,
  };
}

function makeEntityAction(
  overrides: Partial<Omit<ActivityRecord, 'activity_event_type'>> & { activity_event_type?: string } = {},
): ActivityRecord {
  return {
    id: 11,
    source: 'task',
    type: 'task_updated',
    activity_event_type: 'status_changed',
    activity_event_payload_version: 1,
    activity_event_payload_json: '{}',
    activity_event_schema_status: 'structured',
    activity_event_legacy_type: null,
    action: 'Agent performed the mutation',
    description: 'Entity task/agent action that drove the document mutation.',
    agent_name: 'agent-1',
    agent_emoji: null,
    file_path: null,
    task_id: 42,
    task_column: 'doing',
    metadata: null,
    created_at: FIXED_NOW,
    ...overrides,
  } as ActivityRecord;
}

function makeArtifact(input: {
  id: string;
  stable_path: string;
  human_path_alias: string | null;
  content_hash: string;
  origin_task_id: number | null;
  source_activity_event_ids: number[];
}): EvidenceArtifactRecord {
  return {
    id: input.id,
    org_id: 'org-1',
    team_id: 'team-1',
    project_id: 7,
    artifact_kind: 'raw_task_receipt',
    title: 'receipt',
    body_format: 'markdown',
    stable_path: input.stable_path,
    human_path_alias: input.human_path_alias,
    content_hash: input.content_hash,
    mutability_policy: 'immutable_append_only',
    version: 1,
    origin_task_id: input.origin_task_id,
    source_activity_event_ids: input.source_activity_event_ids,
    source_artifact_ids: [],
    linked_object_refs: [],
    provenance_json: '{}',
    integrity_state: 'valid',
    availability_state: 'available',
    created_by_principal_id: 'reviewer-1',
    metadata_json: '{}',
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
  };
}

/** In-memory ActivityRepository stub capturing created activities (same surface as the real repo). */
function makeActivitySink() {
  const created: CreateActivityInput[] = [];
  return {
    created,
    repo: {
      listActivities: (): ActivityRecord[] => [],
      listActivitiesByTaskId: (): ActivityRecord[] => [],
      createActivity: (input: CreateActivityInput): ActivityRecord => {
        created.push(input);
        return makeEntityAction({ activity_event_type: String(input.activity_event_type ?? '') });
      },
    },
  };
}

/**
 * Drive the REAL canonical completion receipt (audit pointer: completeTaskWithReceipt) against a
 * temp storage root. This is the canonical low-level execution receipt — no competing store.
 */
async function createCanonicalReceipt(opts: { receiptId?: string; storageRoot: string; listEvents?: ActivityRecord[] }) {
  const previousTask = makeTask({ column: 'doing' });
  const nextTask = makeTask({ column: 'done' });
  const activities: CreateActivityInput[] = [];
  const updates: UpdateTaskInput[] = [];
  const result = await completeTaskWithReceipt(
    {
      previousTask,
      nextTask,
      actorPrincipalId: 'agent-1',
      updates: { column: 'done' },
    },
    {
      storageRoot: opts.storageRoot,
      idFactory: () => opts.receiptId ?? 'receipt-1',
      now: () => new Date(FIXED_NOW),
      artifactRepository: {
        createArtifact: (input) =>
          makeArtifact({
            id: input.id ?? 'missing',
            stable_path: input.stable_path ?? '',
            human_path_alias: input.human_path_alias ?? null,
            content_hash: input.content_hash,
            origin_task_id: input.origin_task_id ?? null,
            source_activity_event_ids: input.source_activity_event_ids ?? [],
          }),
      },
      activityRepository: {
        listActivitiesByTaskId: () => opts.listEvents ?? [makeEntityAction()],
        createActivity: (input) => {
          activities.push(input);
          return makeEntityAction({ activity_event_type: String(input.activity_event_type ?? '') });
        },
      },
      updateTask: async (_taskId, update) => {
        updates.push(update);
        return { ...nextTask, metadata: update.metadata ?? nextTask.metadata };
      },
    },
  );
  return { result, activities, updates };
}

/* --------------------------------------------------------------------------- *
 * R-027 — activity attribution
 * --------------------------------------------------------------------------- */

describe('T-010 — R-027 activity attribution (durable normalized trail, via existing ActivityRepository)', () => {
  it('records a document activity with every R-027 identifying field and the exact actor vocabulary', async () => {
    const { created, repo } = makeActivitySink();
    const activity = makeDocumentActivity({ id: 'op-create', operationType: 'create', receiptId: null });

    const published = recordDocumentActivity(
      {
        activity: activity,
        createActivity: repo.createActivity,
        now: () => FIXED_NOW,
      },
    );

    expect(created).toHaveLength(1);
    // The persisted activity is a normal ActivityRecord in the existing activities table.
    expect(typeof published.id).toBe('number');
    expect(published.source).toBe('task');
    // The R-027 identifying fields ride the structured payload.
    const payload = created[0]?.activity_event_payload as Record<string, unknown>;
    expect(payload).toBeDefined();
    expect((payload.data as Record<string, unknown>)).toMatchObject({
      id: 'op-create',
      documentId: 'doc-1',
      provider: 'google_workspace',
      artifactType: 'document',
      operationType: 'create',
      actorClass: 'agent',
      actorId: 'agent-1',
      timestamp: FIXED_NOW,
      succeeded: true,
    });
    // The exact R-027 actor vocabulary is exported and each value is one of the six classifications.
    expect([...DOCUMENT_ACTIVITY_ACTOR_CLASSES]).toEqual([
      'human',
      'agent',
      'provider_external_actor',
      'local_external_actor',
      'system',
      'unknown',
    ]);
    for (const cls of DOCUMENT_ACTIVITY_ACTOR_CLASSES) {
      expect(typeof (cls as DocumentActivityActorClass)).toBe('string');
    }
  });

  it('persists the normalized record through the existing activity payload, carrying identifier fields', async () => {
    const { created, repo } = makeActivitySink();
    recordDocumentActivity({ activity: makeDocumentActivity(), createActivity: repo.createActivity, now: () => FIXED_NOW });

    const payload = created[0]?.activity_event_payload as Record<string, unknown>;
    expect(payload).toBeDefined();
    expect(created[0]?.type).toBe('task_updated');
    // The correlation/receipt ID and document identifiers ride the structured payload so an auditor
    // can correlate the activity to the receipt and the document version without a second store.
    const data = payload.data as Record<string, unknown>;
    expect(data).toMatchObject({
      id: 'op-1',
      documentId: 'doc-1',
      provider: 'google_workspace',
      operationType: 'mutate',
      actorClass: 'agent',
      actorId: 'agent-1',
      priorRevision: 'rev-1',
      resultRevision: 'rev-2',
      succeeded: true,
    });
  });

  it('carries correlation/receipt ID where applicable on an agent mutation activity', async () => {
    const { created, repo } = makeActivitySink();
    recordDocumentActivity({
      activity: makeDocumentActivity({ receiptId: 'receipt-1' }),
      createActivity: repo.createActivity,
      now: () => FIXED_NOW,
    });
    const data = (created[0]?.activity_event_payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.receiptId).toBe('receipt-1');
  });
});

/* --------------------------------------------------------------------------- *
 * R-027 — honest actor classification + coarse fallback
 * --------------------------------------------------------------------------- */

describe('T-010 — R-027 honest actor classification (never fabricate identity)', () => {
  it('accepts each of the six exact actor classifications as authoritative', () => {
    for (const cls of DOCUMENT_ACTIVITY_ACTOR_CLASSES) {
      expect(classifyDocumentActor({ actorClass: cls, actorId: 'id-1' })).toEqual({
        actorClass: cls,
        actorId: 'id-1',
      });
    }
  });

  it('classifies an agent-driven document mutation with a known agent id', () => {
    expect(classifyDocumentActor({ actorClass: 'agent', actorId: 'agent-1' })).toEqual({
      actorClass: 'agent',
      actorId: 'agent-1',
    });
  });

  it('uses an honest coarse `provider_external_actor` for a provider-reported id it cannot trust deeper', () => {
    // Exact provider actor identity (e.g. a provider-incarnated editor) is unavailable beyond a
    // provider-scoped principal id; Entity classifies coarsely as provider_external_actor and does
    // NOT promote it to a trusted human/agent, nor fabricate a deeper identity.
    expect(classifyDocumentActor({ providerActor: { id: 'provider-user-99' } })).toEqual({
      actorClass: 'provider_external_actor',
      actorId: 'provider-user-99',
    });
  });

  it('coarse-falls-back to `unknown` with a NULL actor id when no actor evidence exists', () => {
    // Exact provider actor identity is unavailable AND there is no known id: honest coarse `unknown`,
    // and critically the actor id MUST NOT be fabricated.
    expect(classifyDocumentActor({})).toEqual({ actorClass: 'unknown', actorId: null });
    expect(classifyDocumentActor({ actorId: '  ' })).toEqual({ actorClass: 'unknown', actorId: null });
  });

  it('never promotes an empty/blank provider id to a fabricated identity', () => {
    expect(classifyDocumentActor({ providerActor: { id: '   ' } })).toEqual({
      actorClass: 'unknown',
      actorId: null,
    });
  });

  it('rejects an invalid/unknown actor class instead of silently guessing (fail closed)', () => {
    expect(classifyDocumentActor({ actorClass: 'assistant' })).toEqual({ actorClass: 'unknown', actorId: null });
  });
});

/* --------------------------------------------------------------------------- *
 * R-028 — agent mutations link to the canonical receipt
 * --------------------------------------------------------------------------- */

describe('T-010 — R-028 every agent mutation produces/links the canonical receipt (no second store)', () => {
  it('links an agent document mutation to a canonical completion receipt via the real receipt-writer surface', async () => {
    const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-activity-receipt-'));
    tempDirs.push(storageRoot);
    const { result } = await createCanonicalReceipt({ receiptId: 'receipt-1', storageRoot });

    const flags = resolvePhase2Flags();
    const activity = makeDocumentActivity({ receiptId: null });
    const linked = await linkDocumentMutationToReceipt(
      {
        flags,
        receipt: result,
        documentActivity: activity,
        actorPrincipalId: 'agent-1',
      },
    );

    // The document activity now carries the canonical receipt artifact id (correlation for R-028).
    expect(linked.documentActivity.receiptId).toBe('receipt-1');
    // The canonical low-level receipt is the proof — the provider artifact alone is not sufficient.
    expect(result.artifact.artifact_kind).toBe('raw_task_receipt');
    expect(result.artifact.stable_path).toBe('/artifacts/evidence/receipt-1.md');
    // The receipt body exists on disk (immutable, content-hashed).
    const body = await fs.promises.readFile(path.join(storageRoot, 'artifacts/evidence/receipt-1.md'), 'utf8');
    expect(body).toContain('# Task Receipt:');
  });

  it('honors the audited receipt_completion_enforcement flag (requires receipt when enabled)', async () => {
    const enabled = resolvePhase2Flags();
    expect(enabled.receipt_completion_enforcement.enabled).toBe(true);

    const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-activity-receipt-'));
    tempDirs.push(storageRoot);
    const { result } = await createCanonicalReceipt({ receiptId: 'receipt-enforced', storageRoot });
    const linked = await linkDocumentMutationToReceipt({
      flags: enabled,
      receipt: result,
      documentActivity: makeDocumentActivity(),
      actorPrincipalId: 'agent-1',
    });
    // With enforcement ON the receipt link is required and resolvable.
    expect(linked.required).toBe(true);
    expect(linked.documentActivity.receiptId).toBe('receipt-enforced');
  });
});

/* --------------------------------------------------------------------------- *
 * R-028 — feature-flag reversibility
 * --------------------------------------------------------------------------- */

describe('T-010 — R-028 feature-flag reversibility (audited framework)', () => {
  it('can be toggled to disabled through the audited phase-2 flag framework (enable/disable/env)', () => {
    const base = resolvePhase2Flags({});
    expect(base.receipt_completion_enforcement.enabled).toBe(true);
    expect(base.receipt_completion_enforcement.source).toBe('default');

    const disabled = resolvePhase2Flags({ ENTITY_PHASE2_DISABLE_FLAGS: 'receipt_completion_enforcement' });
    expect(disabled.receipt_completion_enforcement.enabled).toBe(false);
    expect(disabled.receipt_completion_enforcement.source).toBe('disable_list');

    const envDisabled = resolvePhase2Flags({ ENTITY_PHASE2_RECEIPT_COMPLETION_ENFORCEMENT: '0' });
    expect(envDisabled.receipt_completion_enforcement.enabled).toBe(false);
    expect(envDisabled.receipt_completion_enforcement.source).toBe('env');
  });

  it('reports the flag value honestly (capability-honest) instead of hardcoding enforcement', async () => {
    const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-activity-receipt-'));
    tempDirs.push(storageRoot);
    const { result } = await createCanonicalReceipt({ receiptId: 'receipt-honest', storageRoot });

    const flagsOff: Phase2FlagSnapshot = resolvePhase2Flags({
      ENTITY_PHASE2_RECEIPT_COMPLETION_ENFORCEMENT: '0',
    });
    const linked = await linkDocumentMutationToReceipt({
      flags: flagsOff,
      receipt: result,
      documentActivity: makeDocumentActivity(),
      actorPrincipalId: 'agent-1',
    });
    // When the audited flag is off, the adapter reports the receipt as not-required (honest,
    // reversible through the flag) while still carrying the canonical linkage.
    expect(linked.required).toBe(false);
    expect(linked.documentActivity.receiptId).toBe('receipt-honest');
  });
});

/* --------------------------------------------------------------------------- *
 * R-028 — auditor traversal (the acceptance proof)
 * --------------------------------------------------------------------------- */

describe('T-010 — R-028 auditor traversal end-to-end (Entity action → receipt → operation → revision → artifact)', () => {
  it('walks the full chain and fails if any link is missing or dangling', async () => {
    const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-activity-receipt-'));
    tempDirs.push(storageRoot);
    // Real canonical receipt + real fake adapter provider artifact.
    const { result } = await createCanonicalReceipt({ receiptId: 'receipt-chain', storageRoot });

    const adapter = createFakeDocumentProviderAdapter({ now: () => FIXED_NOW });
    const created = await adapter.create({
      artifact_type: 'document',
      title: 'chain-doc',
      idempotencyKey: 'chain-1',
      now: FIXED_NOW,
    });
    const externalId = created.descriptor.external_id;
    const mutated = await adapter.mutate({
      external_id: externalId,
      provider_connection_id: null,
      expectedRevision: created.descriptor.current_revision ?? '',
      mutation: { kind: 'text', text: 'linked agent mutation' },
      idempotencyKey: 'chain-mutate-1',
      now: FIXED_NOW,
    });

    const docActivity: DocumentActivityRecord = {
      id: 'op-chain',
      documentId: 'doc-1',
      provider: 'google_workspace',
      artifactType: 'document',
      externalId,
      operationType: 'mutate',
      actorClass: 'agent',
      actorId: 'agent-1',
      priorRevision: mutated.priorRevision,
      resultRevision: mutated.resultRevision,
      timestamp: FIXED_NOW,
      succeeded: true,
      reasonCode: null,
      receiptId: result.artifact.id,
    };

    const hops = traverseAuditorChain(docActivity, {
      resolveEntityAction: () => makeEntityAction({ activity_event_type: 'agent_mutation' }),
      resolveReceipt: (receiptId) =>
        receiptId === result.artifact.id
          ? { artifactId: result.artifact.id, stablePath: result.artifact.stable_path, contentHash: result.artifact.content_hash }
          : undefined,
      resolveDocument: (documentId) =>
        documentId === 'doc-1'
          ? { id: 'doc-1', currentRevision: mutated.resultRevision, externalId }
          : undefined,
      resolveProviderArtifact: (extId) =>
        extId === externalId ? mutated.descriptor : undefined,
    });

    // The chain has all five stages in order.
    expect(hops).toHaveLength(5);
    const stageOrder = hops.map((hop) => hop.stage);
    expect(stageOrder).toEqual([
      'entity_action',
      'receipt',
      'document_operation',
      'document_revision',
      'provider_artifact',
    ]);
    // The receipt hop resolves to the canonical receipt artifact (execution receipt — not the
    // provider artifact alone).
    const receiptHop = hops.find((hop) => hop.stage === 'receipt');
    expect(receiptHop?.reference).toBe('/artifacts/evidence/receipt-chain.md');
    // The provider/local artifact hop resolves to the real fake provider artifact identity.
    const artifactHop = hops.find((hop) => hop.stage === 'provider_artifact');
    expect(artifactHop?.reference).toBe(externalId);
  });

  it('FAILS when the Entity task/agent action link is missing (dangling chain root)', async () => {
    const docActivity = makeDocumentActivity({ receiptId: 'receipt-1' });
    expect(() =>
      traverseAuditorChain(docActivity, {
        resolveEntityAction: () => undefined,
        resolveReceipt: () => undefined,
        resolveDocument: () => ({ id: 'doc-1', currentRevision: 'rev-2', externalId: 'ext-1' }),
        resolveProviderArtifact: () => undefined,
      }),
    ).toThrow(AuditorTraversalGapError);
  });

  it('FAILS when the execution receipt link is missing or dangling for an agent mutation', async () => {
    const docActivity = makeDocumentActivity({ receiptId: 'receipt-DANGLING' });
    expect(() =>
      traverseAuditorChain(docActivity, {
        resolveEntityAction: () => makeEntityAction(),
        resolveReceipt: () => undefined, // the receipt artifact cannot be resolved -> dangling
        resolveDocument: () => ({ id: 'doc-1', currentRevision: 'rev-2', externalId: 'ext-1' }),
        resolveProviderArtifact: () => undefined,
      }),
    ).toThrow(AuditorTraversalGapError);
  });

  it('FAILS when the document version/revision link is missing or dangling', async () => {
    const docActivity = makeDocumentActivity({ receiptId: 'receipt-1' });
    expect(() =>
      traverseAuditorChain(docActivity, {
        resolveEntityAction: () => makeEntityAction(),
        resolveReceipt: () => ({ artifactId: 'receipt-1', stablePath: '/artifacts/evidence/receipt-1.md', contentHash: 'sha256:x' }),
        resolveDocument: () => undefined, // no canonical revision view -> dangling
        resolveProviderArtifact: () => undefined,
      }),
    ).toThrow(AuditorTraversalGapError);
  });

  it('FAILS when the provider/local artifact link is missing or dangling', async () => {
    const docActivity = makeDocumentActivity({ receiptId: 'receipt-1', externalId: 'ext-GONE' });
    expect(() =>
      traverseAuditorChain(docActivity, {
        resolveEntityAction: () => makeEntityAction(),
        resolveReceipt: () => ({ artifactId: 'receipt-1', stablePath: '/artifacts/evidence/receipt-1.md', contentHash: 'sha256:x' }),
        resolveDocument: () => ({ id: 'doc-1', currentRevision: 'rev-2', externalId: 'ext-GONE' }),
        resolveProviderArtifact: () => undefined, // provider/local artifact not resolvable -> dangling
      }),
    ).toThrow(AuditorTraversalGapError);
  });
});

/* --------------------------------------------------------------------------- *
 * Fail-closed / negative
 * --------------------------------------------------------------------------- */

describe('T-010 — R-028 fail-closed and degraded mutation linkage', () => {
  it('requires the canonical receipt for an agent mutation when enforcement is on and the receipt cannot be built (fail closed)', async () => {
    // Build a receipt that references a document activity, then verify the adapter treats a
    // missing canonical receipt as a fail-closed condition (no fabricated proof).
    const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-activity-receipt-'));
    tempDirs.push(storageRoot);
    const { result } = await createCanonicalReceipt({ receiptId: 'receipt-required', storageRoot });
    const flags = resolvePhase2Flags();

    // An agent mutation with a receipt link that points at a NON-canonical id must not be treated
    // as proven proof: the traversal detects the dangling receipt instead of accepting it.
    const docActivity: DocumentActivityRecord = {
      ...makeDocumentActivity(),
      receiptId: 'receipt-FORGED',
    };
    expect(() =>
      traverseAuditorChain(docActivity, {
        resolveEntityAction: () => makeEntityAction(),
        resolveReceipt: (receiptId) =>
          receiptId === result.artifact.id
            ? { artifactId: result.artifact.id, stablePath: result.artifact.stable_path, contentHash: result.artifact.content_hash }
            : undefined,
        resolveDocument: () => ({ id: 'doc-1', currentRevision: 'rev-2', externalId: 'ext-1' }),
        resolveProviderArtifact: () => ({ provider: 'google_workspace' } as unknown as ProviderArtifactDescriptor),
      }),
    ).toThrow(AuditorTraversalGapError);
    expect(flags.receipt_completion_enforcement.enabled).toBe(true);
  });

  it('labels hops with a stable, human-auditable chain (typed hops, no PII)', async () => {
    const docActivity = makeDocumentActivity({ receiptId: 'receipt-1' });
    const hops = traverseAuditorChain(docActivity, {
      resolveEntityAction: () => makeEntityAction(),
      resolveReceipt: () => ({ artifactId: 'receipt-1', stablePath: '/artifacts/evidence/receipt-1.md', contentHash: 'sha256:x' }),
      resolveDocument: () => ({ id: 'doc-1', currentRevision: 'rev-2', externalId: 'ext-1' }),
      resolveProviderArtifact: () => ({ external_id: 'ext-1' } as unknown as ProviderArtifactDescriptor),
    });
    for (const hop of hops) {
      expect(typeof (hop as AuditorChainHop).stage).toBe('string');
      expect(typeof (hop as AuditorChainHop).label).toBe('string');
    }
  });
});
