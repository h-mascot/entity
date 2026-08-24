/**
 * THE-951 (T-010) — Activity + Entity execution receipts — integration adapter.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-027 "Activity and version attribution": Entity maintains a durable normalized activity
 *     trail. Actor classifications are EXACTLY `human` / `agent` / `provider_external_actor` /
 *     `local_external_actor` / `system` / `unknown`. If exact provider actor identity is
 *     unavailable, Entity must use an honest coarse classification (never fabricate identity).
 *     Every activity record identifies: document; operation type; actor class; known actor ID
 *     where valid; old/new revision where applicable; provider; timestamp; success/failure;
 *     correlation/receipt ID where applicable.
 *   - R-028 "Execution receipts": every agent mutation must produce or link to the canonical
 *     Entity low-level execution receipt system; the provider artifact itself is NOT sufficient
 *     proof. An auditor can traverse Entity task/agent action → execution receipt → document
 *     operation → document version/revision → provider/local artifact.
 *   - T-010 ticket: "Non-goal: Replace existing receipt system." Audit pointer: the canonical
 *     receipt writer is packages/server/src/receipt-writer.ts (`completeTaskWithReceipt`,
 *     `buildCanonicalReceiptMarkdown`, `hashCanonicalReceiptMarkdown`), gated by the
 *     `receipt_completion_enforcement` flag in packages/server/src/phase2-flags.ts. Document
 *     operations must attach to that surface. "Introducing a second receipt store is a release
 *     blocker." OQ-019 remains the owning open question; this module records observations without
 *     inventing product defaults.
 *
 * What this module is: the T-010 INTEGRATION ADAPTER. It (a) produces a durable NORMALIZED R-027
 * activity record for a document operation and persists it through the EXISTING
 * `ActivityRepository.createActivity` surface (the existing `activities` table — not a second
 * store), (b) links an agent document mutation to the CANONICAL Entity execution receipt through
 * the real `completeTaskWithReceipt` surface, gated by the audited `receipt_completion_enforcement`
 * flag, and (c) exposes the auditor traversal that walks
 * Entity action → execution receipt → document operation → document version/revision →
 * provider/local artifact and FAILS on any missing/dangling link (R-028 acceptance proof).
 *
 * Scope discipline: this file lives entirely on the approved T-010 path. It does NOT rewrite the
 * approved T-009 mutation path (revision-coordinator / document-integrations route semantics), and
 * it does not fork or shadow `receipt-writer.ts` — it only composes that canonical surface. Route
 * wiring of the adapter primitives is deferred to a real provider-adapter round (OQ-019 owns the
 * receipt-system product questions); this module supplies the tested integration contract.
 *
 * Privacy/security: leaf identifiers only (document id, provider, artifact type, revisions,
 * correlated activity/receipt ids). It never reads or logs credentials, raw tokens, tenant
 * secrets, or document contents. Fail closed on unknown/degraded authority: an unseen/misclassified
 * actor class folds to `unknown` with a NULL actor id (identity is never fabricated), never promoted
 * to a trusted agent/human, and a missing/dangling link in an agent mutation's receipt chain throws
 * a typed `AuditorTraversalGapError` rather than silently returning a partial chain.
 */

import type {
  ActivityEventActorType,
  ActivityRecord,
  CreateActivityInput,
} from '../../../db/src';
import type { CompletionReceiptResult } from '../receipt-writer';
import { phase2FlagEnabled, type Phase2FlagSnapshot, type Phase2FlagKey } from '../phase2-flags';
import type { DocumentArtifactType, DocumentProvider } from '../../../db/src/document-integrations';
import type { ProviderArtifactDescriptor } from './types';

/** R-027 canonical actor vocabulary (exactly these six values). */
export const DOCUMENT_ACTIVITY_ACTOR_CLASSES = [
  'human',
  'agent',
  'provider_external_actor',
  'local_external_actor',
  'system',
  'unknown',
] as const;

export type DocumentActivityActorClass = (typeof DOCUMENT_ACTIVITY_ACTOR_CLASSES)[number];

const ACTOR_CLASS_SET: ReadonlySet<string> = new Set<string>(DOCUMENT_ACTIVITY_ACTOR_CLASSES);

/** R-027 operation types relevant to the document integrations mutation path. */
export type DocumentActivityOperationType = 'create' | 'mutate' | 'read' | 'reconcile';

/**
 * R-027 normalized activity record for one document operation. Every field the PRD requires is
 * present explicitly so an auditor can render/reason about a durable trail without a second store:
 * document id, operation type, actor class, known actor id (null when unavailable), old/new
 * revision (null where not applicable), provider, timestamp, success/failure, and the correlation
 * / canonical receipt id where applicable.
 */
export interface DocumentActivityRecord {
  /** Correlation id for this document operation (durable, local). */
  id: string;
  /** Canonical Entity document id (R-001) the operation acted on. */
  documentId: string;
  provider: DocumentProvider;
  artifactType: DocumentArtifactType;
  /** Durable provider/local artifact identity (R-001 external id). */
  externalId: string | null;
  operationType: DocumentActivityOperationType;
  actorClass: DocumentActivityActorClass;
  /** Known actor id where valid; null when unknown/coarse (never fabricated). */
  actorId: string | null;
  /** Old revision (where applicable); null when the op has no prior revision. */
  priorRevision: string | null;
  /** New revision (where applicable); null when the op produced no new revision. */
  resultRevision: string | null;
  timestamp: string;
  /** success/failure of the operation. */
  succeeded: boolean;
  /** Typed failure reason code when `succeeded` is false, else null. */
  reasonCode: string | null;
  /** Canonical execution receipt artifact id (R-028) when linked, else null. */
  receiptId: string | null;
}

/** The minimum surface this adapter needs to persist an R-027 activity (the real ActivityRepository). */
export interface DocumentActivityPersistence {
  createActivity: (input: CreateActivityInput) => ActivityRecord;
}

const ACTIVITY_EVENT_PAYLOAD_VERSION = 1;

function nonEmptyString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

/* --------------------------------------------------------------------------- *
 * R-027 — honest actor classification (coarse fallback, never fabricated identity)
 * --------------------------------------------------------------------------- */

export interface ActorIdentityInput {
  /** Explicit, authoritative actor class when the caller can classify it (one of the six R-027). */
  actorClass?: string | null;
  /** Known actor id where valid (carried through only when a trusted/classifiable id exists). */
  actorId?: string | null;
  /** Provider-scoped actor identity (untrusted, coarse); justifies provider_external_actor only. */
  providerActor?: { id?: string | null } | null;
  /** Mark when the operation is attributable to a local (managed) artifact actor. */
  localActor?: boolean;
}

export interface ResolvedActor {
  actorClass: DocumentActivityActorClass;
  actorId: string | null;
}

/**
 * Honestly classify the actor of a document operation into one of the six exact R-027 classes.
 *
 * - An explicit authoritative `actorClass` (one of the six) is honored verbatim, carrying the known
 *   actor id when valid.
 * - When exact provider actor identity is unavailable, fall back to an honest COARSE class:
 *   `provider_external_actor` for a provider-reported principal id (never promoted to a trusted
 *   human/agent), `local_external_actor` for a local managed artifact actor, and `unknown` with a
 *   NULL actor id when there is no trustworthy evidence at all.
 * - Identity is NEVER fabricated: an absent/blank actor id stays null, and an invalid/unknown
 *   actor class folds to `unknown` (fail closed) rather than guessing.
 */
export function classifyDocumentActor(input: ActorIdentityInput): ResolvedActor {
  const explicitClass = nonEmptyString(input.actorClass);
  if (explicitClass && ACTOR_CLASS_SET.has(explicitClass)) {
    return {
      actorClass: explicitClass as DocumentActivityActorClass,
      actorId: nonEmptyString(input.actorId),
    };
  }
  const knownProviderId = nonEmptyString(input.providerActor?.id);
  if (knownProviderId) {
    // A provider-reported principal id is provider-bound but not trustworthy enough to promote to a
    // trusted human/agent — honest coarse classification (R-027), carrying only the provider id.
    return { actorClass: 'provider_external_actor', actorId: knownProviderId };
  }
  if (input.localActor) {
    return { actorClass: 'local_external_actor', actorId: nonEmptyString(input.actorId) };
  }
  // No trustworthy attribution evidence at all — honest coarse `unknown`, identity never fabricated.
  return { actorClass: 'unknown', actorId: null };
}

/* --------------------------------------------------------------------------- *
 * R-027 — durable normalized activity persistence (existing ActivityRepository)
 * --------------------------------------------------------------------------- */

/**
 * Map an R-027 document actor class onto the payload schema's `ActivityEventActorType`
 * vocabulary (`human|agent|system|workflow|unknown`) WITHOUT ever promoting a non-agent actor to a
 * trusted `agent` or `human`. The payload schema has no `provider_external_actor` /
 * `local_external_actor` class, so external and unknown actors map fail-closed to `unknown` — the
 * honest class is preserved on the payload's `data.actorClass` and the principal on
 * `actor_principal_id` / `data.actorId`, never asserted as a trusted Entity agent/human.
 */
function schemaActorType(actorClass: DocumentActivityActorClass): ActivityEventActorType {
  switch (actorClass) {
    case 'agent':
    case 'human':
    case 'system':
      return actorClass;
    case 'provider_external_actor':
    case 'local_external_actor':
    case 'unknown':
      // Fail closed: never claim a trusted agent/human for an external/unknown actor.
      return 'unknown';
  }
}

/**
 * Persist one normalized R-027 document-activity record through the EXISTING `activities` table
 * (the real `ActivityRepository.createActivity`), embedding the normalized fields in the
 * structured `activity_event_payload` so an auditor can correlate to the document, its version, and
 * the canonical receipt without a second store. Returns the published activity record.
 */
export function recordDocumentActivity(input: {
  activity: DocumentActivityRecord;
  createActivity: DocumentActivityPersistence['createActivity'];
  taskId?: number | null;
}): ActivityRecord {
  // `agent_name` is a row that asserts a trusted Entity AGENT actor: set it ONLY for a genuine
  // agent-class mutation, never for an external/human/system/unknown actor (R-027 never promotes).
  const agentName = input.activity.actorClass === 'agent' ? (input.activity.actorId ?? undefined) : undefined;
  const created = input.createActivity({
    source: 'task',
    type: 'task_updated',
    activity_event_type: 'document_operation',
    activity_event_payload_version: ACTIVITY_EVENT_PAYLOAD_VERSION,
    activity_event_schema_status: 'structured',
    activity_event_payload: {
      version: ACTIVITY_EVENT_PAYLOAD_VERSION,
      actor_principal_id: input.activity.actorId ?? undefined,
      actor_type: schemaActorType(input.activity.actorClass),
      task_id: input.taskId ?? undefined,
      object_refs: [
        { object_type: 'external_document_ref', object_id: input.activity.documentId, link_role: 'operation_target' },
        ...(input.activity.receiptId
          ? [{ object_type: 'receipt', object_id: input.activity.receiptId, link_role: 'execution_receipt' }]
          : []),
      ],
      data: {
        id: input.activity.id,
        documentId: input.activity.documentId,
        provider: input.activity.provider,
        artifactType: input.activity.artifactType,
        externalId: input.activity.externalId ?? null,
        operationType: input.activity.operationType,
        actorClass: input.activity.actorClass,
        actorId: input.activity.actorId ?? null,
        priorRevision: input.activity.priorRevision ?? null,
        resultRevision: input.activity.resultRevision ?? null,
        timestamp: input.activity.timestamp,
        succeeded: input.activity.succeeded,
        reasonCode: input.activity.reasonCode ?? null,
        receiptId: input.activity.receiptId ?? null,
      },
    },
    action: `${input.activity.operationType} document`,
    description: `${input.activity.actorClass} ${input.activity.operationType} on document ${input.activity.documentId}${input.activity.receiptId ? ` linked to receipt ${input.activity.receiptId}` : ''}.`,
    agent_name: agentName,
    task_id: input.taskId ?? undefined,
    metadata: JSON.stringify({
      id: input.activity.id,
      documentId: input.activity.documentId,
      operationType: input.activity.operationType,
      succeeded: input.activity.succeeded,
      receiptId: input.activity.receiptId,
    }),
  });
  return created;
}

/* --------------------------------------------------------------------------- *
 * R-028 — agent mutations link to the CANONICAL Entity execution receipt
 * --------------------------------------------------------------------------- */

export interface LinkDocumentMutationToReceiptInput {
  /** The canonical completion receipt already produced through the real receipt-writer surface. */
  receipt: CompletionReceiptResult;
  /** The R-027 document activity for the agent mutation. */
  documentActivity: DocumentActivityRecord;
  /** Audited phase-2 flag snapshot; gating on `receipt_completion_enforcement`. */
  flags: Phase2FlagSnapshot;
}

export interface LinkDocumentMutationToReceiptResult {
  documentActivity: DocumentActivityRecord;
  /** Whether the canonical receipt is REQUIRED under the audited flag. */
  required: boolean;
  /** The canonical receipt artifact id the agent mutation is linked to. */
  receiptId: string | null;
}

/**
 * Link an agent document mutation to the canonical Entity execution receipt. The receipt is
 * produced through `completeTaskWithReceipt` (the real canonical surface — the caller passes the
 * produced `CompletionReceiptResult`; this adapter correlates it onto the R-027 activity). This is
 * the R-028 guarantee that the provider artifact alone is NOT the proof: the immutable, content-
 * hashed canonical receipt is the auditable execution proof, and the document activity carries its
 * correlation id.
 *
 * Enforcement is carried by the CALLER and the audited flag, not by this function: `receipt` is a
 * REQUIRED parameter (there is no "missing receipt" branch here — a caller that must fail closed on
 * a missing canonical receipt should refuse to call this with no receipt). Whether the receipt link
 * is REQUIRED is reported live from the audited `receipt_completion_enforcement` flag via
 * `phase2FlagEnabled` (`required:true` when enabled, `required:false` when disabled) so downstream
 * consumers can enforce it honestly and reversibly through the audited feature-flag framework.
 */
export async function linkDocumentMutationToReceipt(
  input: LinkDocumentMutationToReceiptInput,
): Promise<LinkDocumentMutationToReceiptResult> {
  const receiptId = input.receipt.artifact.id;
  const required = phase2FlagEnabled(input.flags, 'receipt_completion_enforcement');
  return {
    documentActivity: {
      ...input.documentActivity,
      receiptId: input.documentActivity.receiptId ?? receiptId,
    },
    required,
    receiptId,
  };
}

/** The audited flag key this adapter gates its receipt linkage on (for observability/tests). */
export const RECEIPT_ENFORCEMENT_FLAG_KEY: Extract<Phase2FlagKey, 'receipt_completion_enforcement'> =
  'receipt_completion_enforcement';

/** Whether the canonical completion-receipt is required, read live from the audited flags. */
export function receiptRequired(flags: Phase2FlagSnapshot): boolean {
  return phase2FlagEnabled(flags, RECEIPT_ENFORCEMENT_FLAG_KEY);
}

/* --------------------------------------------------------------------------- *
 * R-028 — auditor traversal (the acceptance proof)
 * --------------------------------------------------------------------------- */

export type AuditorChainStage =
  | 'entity_action'
  | 'receipt'
  | 'document_operation'
  | 'document_revision'
  | 'provider_artifact';

export interface AuditorChainHop {
  stage: AuditorChainStage;
  label: string;
  reference: string | null;
}

/**
 * Typed fail-closed error raised when the auditor traversal finds a missing or dangling link. The
 * message names the stage and hop that broke the chain; it never contains secrets/PII.
 */
export class AuditorTraversalGapError extends Error {
  readonly stage: AuditorChainStage;
  readonly hop: string;
  constructor(stage: AuditorChainStage, hop: string, detail: string) {
    super(`auditor traversal gap at ${stage} (${hop}): ${detail}`);
    this.name = 'AuditorTraversalGapError';
    this.stage = stage;
    this.hop = hop;
  }
}

export interface ReceiptLinkRef {
  artifactId: string;
  stablePath: string;
  contentHash: string;
}

export interface DocumentLinkRef {
  id: string;
  currentRevision: string | null;
  externalId: string | null;
}

export interface AuditorTraversalDeps {
  /** Resolve the originating Entity task/agent action correlated to this document operation. */
  resolveEntityAction: (documentActivity: DocumentActivityRecord) => ActivityRecord | undefined;
  /** Resolve the canonical execution receipt by its receipt artifact id (R-028). */
  resolveReceipt: (receiptId: string) => ReceiptLinkRef | undefined;
  /** Resolve the document's canonical record / version-revision view by document id. */
  resolveDocument: (documentId: string) => DocumentLinkRef | undefined;
  /** Resolve the provider/local artifact by its durable external id (R-001). */
  resolveProviderArtifact: (externalId: string) => ProviderArtifactDescriptor | undefined;
}

/**
 * Walk the full R-028 auditor chain end-to-end:
 *
 *   Entity task/agent action → execution receipt → document operation
 *     → document version/revision → provider/local artifact
 *
 * Each hop resolves through the injected dependency surface; if ANY link is missing or dangling
 * this throws a typed `AuditorTraversalGapError` (the acceptance proof "fails if any link is
 * missing or dangling"). Returns the ordered chain of hops on success.
 */
export function traverseAuditorChain(
  documentActivity: DocumentActivityRecord,
  deps: AuditorTraversalDeps,
): AuditorChainHop[] {
  const hops: AuditorChainHop[] = [];

  // 1. Entity task/agent action (the originating action that drove the document operation).
  const entityAction = deps.resolveEntityAction(documentActivity);
  if (!entityAction) {
    throw new AuditorTraversalGapError(
      'entity_action',
      documentActivity.id,
      `no Entity task/agent action resolves for document operation ${documentActivity.id}`,
    );
  }
  hops.push({
    stage: 'entity_action',
    label: `Entity task/agent action ${entityAction.activity_event_type ?? entityAction.type}`,
    reference: entityAction.task_id != null ? `task/${entityAction.task_id}` : null,
  });

  // 2. Execution receipt (the canonical Entity low-level receipt — proof, not the provider artifact).
  //    R-028 requires the receipt for AGENT mutations. A non-agent operation may legitimately carry
  //    no receipt (e.g. an external/human/read op); when it has one we still resolve and link it,
  //    but a missing receipt only FAILS the chain for a genuine agent mutation.
  if (documentActivity.receiptId) {
    const receipt = deps.resolveReceipt(documentActivity.receiptId);
    if (!receipt) {
      throw new AuditorTraversalGapError(
        'receipt',
        documentActivity.receiptId,
        `the canonical execution receipt ${documentActivity.receiptId} cannot be resolved (dangling)`,
      );
    }
    hops.push({
      stage: 'receipt',
      label: `Execution receipt`,
      reference: receipt.stablePath,
    });
  } else if (documentActivity.actorClass === 'agent') {
    throw new AuditorTraversalGapError(
      'receipt',
      documentActivity.id,
      'an agent document mutation carries no canonical execution receipt id (R-028); the provider artifact alone is not sufficient proof',
    );
  }

  // 3. Document operation (the normalized activity record itself).
  hops.push({
    stage: 'document_operation',
    label: `${documentActivity.operationType} on document ${documentActivity.documentId}`,
    reference: documentActivity.id,
  });

  // 4. Document version/revision (old/new revision where applicable).
  const document = deps.resolveDocument(documentActivity.documentId);
  if (!document) {
    throw new AuditorTraversalGapError(
      'document_revision',
      documentActivity.documentId,
      `no canonical document revision view resolves for ${documentActivity.documentId} (dangling)`,
    );
  }
  const revisionRef = documentActivity.resultRevision ?? document.currentRevision;
  if (!revisionRef) {
    throw new AuditorTraversalGapError(
      'document_revision',
      documentActivity.documentId,
      `document ${documentActivity.documentId} exposes no version/revision to traverse`,
    );
  }
  hops.push({
    stage: 'document_revision',
    label: `Document revision ${documentActivity.priorRevision ?? 'n/a'} -> ${revisionRef}`,
    reference: revisionRef,
  });

  // 5. Provider/local artifact (the durable provider artifact identity R-001 external id).
  const externalId = documentActivity.externalId ?? document.externalId;
  if (!externalId) {
    throw new AuditorTraversalGapError(
      'provider_artifact',
      documentActivity.documentId,
      `document ${documentActivity.documentId} has no durable provider/local artifact identity to traverse`,
    );
  }
  const artifact = deps.resolveProviderArtifact(externalId);
  if (!artifact) {
    throw new AuditorTraversalGapError(
      'provider_artifact',
      externalId,
      `the provider/local artifact ${externalId} cannot be resolved (dangling)`,
    );
  }
  hops.push({
    stage: 'provider_artifact',
    label: `Provider/local artifact ${artifact.provider ?? 'unknown'}/${artifact.artifact_type ?? 'unknown'}`,
    reference: externalId,
  });

  return hops;
}
