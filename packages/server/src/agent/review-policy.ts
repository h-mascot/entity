import type { TaskColumn, TaskRecord } from '../../../db/src';

export const REVIEW_OUTPUT_MIN_LENGTH = 50;
export const REVIEW_VALID_SCORE_MIN = 85;
export const REVIEW_WEAK_SCORE_MIN = 60;
export const LOW_EFFORT_OUTPUTS = new Set(['done', 'completed', 'finished', 'n/a', 'complete', 'wip']);
export const BANNED_EVIDENCE_SMELL_REGEX =
  /(subagent output|see conversation|see chat|see above|shared in thread|full analysis elsewhere|details elsewhere|details in notes|see notes|see thread|inaccessible handoff text)/i;

const URL_REGEX = /https?:\/\/[^\s)]+/gi;
const DOC_PATH_REGEX = /\b(?:output|memory|workspace)\/[^\s)]+/gi;
const FILE_PATH_REGEX =
  /\b(?:\.{1,2}\/|~\/|\/(?:home|Users)\/|[A-Za-z0-9._-]+\/)[A-Za-z0-9._/-]+\.[A-Za-z0-9]+\b/g;
const SCM_REFERENCE_REGEX = /\b(?:PR\s*#\d+|pull request\s*#?\d+|commit\s+[0-9a-f]{7,40})\b/gi;
const TASK_ID_REGEX = /#\d+\b/g;
const COUNT_REGEX = /\b\d+\b/g;
const STOP_WORDS = new Set([
  'about',
  'after',
  'agent',
  'board',
  'build',
  'check',
  'create',
  'from',
  'into',
  'more',
  'task',
  'tasks',
  'that',
  'this',
  'with',
  'without',
]);

export type TaskType =
  | 'research_eval'
  | 'implementation'
  | 'deploy_ops'
  | 'content_comms'
  | 'board_admin'
  | 'general';

export type ReviewVerdict = 'VALID' | 'WEAK' | 'INVALID';

export type EvidenceStatus =
  | 'accessible'
  | 'exists_but_inaccessible'
  | 'missing'
  | 'empty'
  | 'dead_url'
  | 'unknown'
  | 'not_required';

export type ReviewRecommendedAction =
  | 'accept_review'
  | 'request_evidence_refresh'
  | 'move_back_to_doing'
  | 'assign_owner'
  | 'note_only';

export interface ArtifactAssessment {
  reference: string;
  status: EvidenceStatus;
  detail: string;
  accessible: boolean;
  reviewable: boolean;
}

export interface ReviewAssessment {
  taskType: TaskType;
  verdict: ReviewVerdict;
  score: number;
  reasons: string[];
  evidenceStatus: EvidenceStatus;
  driftStatus: 'unknown';
  ownershipPresent: boolean;
  artifactRequired: boolean;
  artifactReferences: string[];
  artifactAssessments: ArtifactAssessment[];
  recommendedAction: ReviewRecommendedAction;
}

export interface ReviewAssessmentOptions {
  artifactInspector?: (reference: string) => Promise<ArtifactAssessment>;
}

export interface ReviewValidationResult {
  ok: boolean;
  message?: string;
  metadata?: Record<string, unknown> | null;
}

type ReviewMetadata = Record<string, unknown>;

const VALID_REVIEW_TYPES = new Set(['human', 'peer', 'auto']);
const VALID_REVIEW_DECISIONS = new Set(['accepted', 'needs_fix', 'escalated', 'pending']);
const VALID_RISK_LEVELS = new Set(['low', 'medium', 'high']);

const LEGACY_STALE_TASK_HOURS = 24 * 14;

function toEpoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLegacyStaleTask(task: Pick<TaskRecord, 'created_at' | 'updated_at' | 'column'>): boolean {
  if (!isActiveTaskColumn(task.column)) return false;
  const updated = toEpoch(task.updated_at);
  const created = toEpoch(task.created_at);
  const candidate = updated ?? created;
  if (!candidate) return false;
  return Date.now() - candidate >= LEGACY_STALE_TASK_HOURS * 60 * 60 * 1000;
}

export function shouldValidateReviewEntryOnTransition(
  previousColumn: string,
  nextColumn: string,
): boolean {
  return nextColumn === 'review' && previousColumn !== 'review' && previousColumn !== 'done';
}

function hasLegacyDocsHost(output: string): boolean {
  return /https?:\/\/(?:100\.106\.69\.9|100\.106\.69\.9:3000|[^\s)]+:3000)\/docs\//i.test(output);
}

function sanitizeArtifactReference(value: string): string {
  return value.trim().replace(/^[\("'`]+|[\)"'`,.;!?]+$/g, '');
}

function appendRegexMatches(value: string, pattern: RegExp, matches: Set<string>): void {
  const matcher = new RegExp(pattern.source, pattern.flags);
  for (const match of value.match(matcher) ?? []) {
    const normalized = sanitizeArtifactReference(match);
    if (normalized) {
      matches.add(normalized);
    }
  }
}

function containsCount(value: string): boolean {
  return new RegExp(COUNT_REGEX.source).test(value);
}

function containsTaskIds(value: string): boolean {
  return new RegExp(TASK_ID_REGEX.source).test(value);
}

function matchesScmReference(value: string): boolean {
  return new RegExp(SCM_REFERENCE_REGEX.source, 'i').test(value);
}

function matchesAny(value: string, pattern: RegExp): boolean {
  return pattern.test(value);
}

function normalizeOutput(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseReviewMetadata(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIdentity(value: unknown): string {
  return readString(value).toLowerCase();
}

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

function reviewPacketFrom(metadata: ReviewMetadata): Record<string, unknown> | null {
  const packet = metadata.review_packet ?? metadata.review_brief;
  return packet && typeof packet === 'object' && !Array.isArray(packet)
    ? (packet as Record<string, unknown>)
    : null;
}

function packetString(packet: Record<string, unknown>, key: string): string {
  return readString(packet[key]);
}

function hasDoneCriteria(packet: Record<string, unknown>): boolean {
  const criteria = packet.done_criteria ?? packet.validation_checklist;
  if (Array.isArray(criteria)) {
    return criteria.some((entry) => readString(entry).length > 0);
  }
  return readString(criteria).length > 0;
}

function normalizeReviewType(value: unknown): string {
  const normalized = readString(value).toLowerCase();
  return normalized === 'henry' ? 'human' : normalized;
}

function hasAcceptedDecision(metadata: ReviewMetadata): boolean {
  return readString(metadata.review_decision).toLowerCase() === 'accepted';
}

function hasReviewNote(metadata: ReviewMetadata): boolean {
  return readString(metadata.review_note).length >= 20;
}

function hasExplicitChatDelivery(metadata: ReviewMetadata): boolean {
  return (
    readBoolean(metadata.chat_output_delivered) &&
    Boolean(readString(metadata.source_id) || readString(metadata.origin_message_id)) &&
    ['chat', 'discord'].includes(normalizeIdentity(metadata.source ?? metadata.origin_channel))
  );
}

function normalizeReviewScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.floor(score)));
}

function buildTaskContext(task: Pick<TaskRecord, 'name' | 'description' | 'brief' | 'metadata' | 'model'>): string {
  return [task.name, task.description ?? '', task.brief ?? '', task.metadata ?? '', task.model ?? '']
    .join(' ')
    .toLowerCase();
}

function tokenizeForAlignment(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

function hasTaskAlignment(task: Pick<TaskRecord, 'name' | 'description' | 'brief'>, output: string): boolean {
  const taskTokens = tokenizeForAlignment([task.name, task.description ?? '', task.brief ?? ''].join(' '));
  if (taskTokens.length === 0) {
    return true;
  }

  const outputLower = output.toLowerCase();
  const matchedCount = taskTokens.filter((token) => outputLower.includes(token)).length;
  return matchedCount >= Math.min(2, taskTokens.length);
}

function hasRecommendation(output: string): boolean {
  return /recommend|recommended|recommendation|conclusion|suggest(?:ed|ion)?|prefer|should\b|best option/i.test(output);
}

function hasVerification(output: string): boolean {
  return /test(?:s|ed)?(?: passed| pass| green)?|verified|verification|smoke test|build passed|build succeeded|health check|checked|curl|screenshot|validated/i.test(
    output
  );
}

function hasTargetOrHost(output: string): boolean {
  return /prod|production|staging|gateway|host|server|mac|localhost|tailnet|environment|port \d+|https?:\/\//i.test(
    output
  );
}

function hasPublishStatus(output: string): boolean {
  return /published|scheduled|drafted|posted|sent|live|distribution|ready to publish|not yet published/i.test(output);
}

function hasBoardScope(output: string): boolean {
  return containsCount(output) || /scope|sweep|scanned|triaged|checked|affected|before|after|partial pass|excluded/i.test(output);
}

function hasBoardTargetSet(output: string): boolean {
  return containsTaskIds(output) || /review column|ownerless tasks|active tasks|entire board|all review tasks/i.test(output);
}

function summarizeEvidenceStatus(
  artifactAssessments: readonly ArtifactAssessment[],
  artifactRequired: boolean
): EvidenceStatus {
  if (artifactAssessments.length === 0) {
    return artifactRequired ? 'missing' : 'not_required';
  }

  const priority: EvidenceStatus[] = [
    'missing',
    'empty',
    'dead_url',
    'exists_but_inaccessible',
    'unknown',
    'accessible',
    'not_required',
  ];

  for (const status of priority) {
    if (artifactAssessments.some((assessment) => assessment.status === status)) {
      return status;
    }
  }

  return artifactRequired ? 'unknown' : 'not_required';
}

function buildAssessment(
  taskType: TaskType,
  verdict: ReviewVerdict,
  score: number,
  reasons: string[],
  evidenceStatus: EvidenceStatus,
  ownershipPresent: boolean,
  artifactRequired: boolean,
  artifactReferences: string[],
  artifactAssessments: ArtifactAssessment[]
): ReviewAssessment {
  const boundedScore = normalizeReviewScore(score);
  const recommendedAction: ReviewRecommendedAction = !ownershipPresent
    ? 'assign_owner'
    : verdict === 'INVALID'
      ? 'move_back_to_doing'
      : verdict === 'WEAK'
        ? 'request_evidence_refresh'
        : 'accept_review';

  return {
    taskType,
    verdict,
    score: boundedScore,
    reasons: reasons.length > 0 ? reasons : ['Output meets the minimum review evidence requirements.'],
    evidenceStatus,
    driftStatus: 'unknown',
    ownershipPresent,
    artifactRequired,
    artifactReferences,
    artifactAssessments,
    recommendedAction,
  };
}

async function defaultArtifactInspector(reference: string): Promise<ArtifactAssessment> {
  if (matchesScmReference(reference)) {
    return {
      reference,
      status: 'accessible',
      detail: `Source control reference provided: ${reference}.`,
      accessible: true,
      reviewable: true,
    };
  }

  return {
    reference,
    status: 'unknown',
    detail: `Artifact could not be auto-verified: ${reference}.`,
    accessible: false,
    reviewable: false,
  };
}

export function extractArtifactReferences(value: string | null | undefined): string[] {
  const normalized = normalizeOutput(value);
  if (!normalized) {
    return [];
  }

  const matches = new Set<string>();
  appendRegexMatches(normalized, URL_REGEX, matches);
  appendRegexMatches(normalized, DOC_PATH_REGEX, matches);
  appendRegexMatches(normalized, FILE_PATH_REGEX, matches);
  appendRegexMatches(normalized, SCM_REFERENCE_REGEX, matches);
  return [...matches];
}

export function hasAssignedOwner(assignee: string | null | undefined): boolean {
  const normalized = typeof assignee === 'string' ? assignee.trim().toLowerCase() : '';
  return Boolean(normalized && normalized !== 'unassigned' && normalized !== 'none' && normalized !== 'nobody' && normalized !== 'null');
}

export function isActiveTaskColumn(column: string | null | undefined): column is TaskColumn {
  return column === 'todo' || column === 'doing' || column === 'review';
}

export function hasSubstantiveReviewOutput(value: string | null | undefined): boolean {
  const output = normalizeOutput(value);
  if (!output) {
    return false;
  }

  if (output.length < REVIEW_OUTPUT_MIN_LENGTH) {
    return false;
  }

  return !LOW_EFFORT_OUTPUTS.has(output.toLowerCase());
}

export function validateReviewEntry(metadata: unknown): ReviewValidationResult {
  const parsed = parseReviewMetadata(metadata);
  if (!parsed) {
    return {
      ok: false,
      message: 'Insufficient review packet. Add evidence or clearer done criteria.',
      metadata: null,
    };
  }

  const reviewType = normalizeReviewType(parsed.review_type ?? parsed.review_class);
  if (!VALID_REVIEW_TYPES.has(reviewType)) {
    return {
      ok: false,
      message: 'Review metadata must include review_type: human, peer, or auto.',
      metadata: parsed,
    };
  }

  const reviewer = readString(parsed.reviewer ?? parsed.review_owner);
  if (reviewType !== 'auto' && !reviewer) {
    return {
      ok: false,
      message: 'Review metadata must include reviewer/review_owner.',
      metadata: parsed,
    };
  }

  const riskLevel = readString(parsed.risk_level).toLowerCase();
  if (!VALID_RISK_LEVELS.has(riskLevel)) {
    return {
      ok: false,
      message: 'Review metadata must include explicit risk_level: low, medium, or high.',
      metadata: parsed,
    };
  }

  const packet = reviewPacketFrom(parsed);
  if (!packet) {
    return {
      ok: false,
      message: 'Insufficient review packet. Add evidence or clearer done criteria.',
      metadata: parsed,
    };
  }

  if (!packetString(packet, 'requested_outcome') || !packetString(packet, 'evidence') || !hasDoneCriteria(packet)) {
    return {
      ok: false,
      message: 'Insufficient review packet. Add requested outcome, evidence, and done criteria.',
      metadata: parsed,
    };
  }

  return { ok: true, metadata: parsed };
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
}

/**
 * A task is "review-gated" only when its metadata carries an explicit review
 * workflow signal (review type, reviewer, decision, human-review requirement, or a
 * review packet/brief). Ordinary tasks that never entered a review workflow
 * must not be blocked from completion. This mirrors the frontend's
 * `hasReviewMetadata` check so the UI and server agree on which tasks require a
 * review completion packet before they can move to done.
 */
export function isReviewGatedTask(metadata: unknown): boolean {
  const parsed = parseReviewMetadata(metadata);
  if (!parsed) return false;
  return (
    hasMeaningfulValue(parsed.review_type ?? parsed.review_class) ||
    hasMeaningfulValue(parsed.reviewer ?? parsed.review_owner) ||
    hasMeaningfulValue(parsed.review_decision) ||
    readBoolean(parsed.human_required ?? parsed.requires_human ?? parsed.henry_required ?? parsed.requires_henry) ||
    hasMeaningfulValue(parsed.review_packet) ||
    hasMeaningfulValue(parsed.review_brief)
  );
}

export function validateReviewCompletion(
  task: Pick<TaskRecord, 'metadata' | 'assignee'>,
  actor: string | null | undefined
): ReviewValidationResult {
  const metadata = parseReviewMetadata(task.metadata);
  const normalizedActor = typeof actor === 'string' ? actor.trim() : '';
  if (!metadata) {
    return {
      ok: false,
      message: 'Task cannot move to done without review metadata.',
      metadata: null,
    };
  }

  if (!normalizedActor) {
    return {
      ok: false,
      message: 'Task completion requires an explicit reviewer actor.',
      metadata,
    };
  }

  const reviewType = normalizeReviewType(metadata.review_type ?? metadata.review_class);
  if (!VALID_REVIEW_TYPES.has(reviewType)) {
    return {
      ok: false,
      message: 'Task completion requires review_type: human, peer, or auto.',
      metadata,
    };
  }

  const decision = readString(metadata.review_decision).toLowerCase();
  if (decision && !VALID_REVIEW_DECISIONS.has(decision)) {
    return {
      ok: false,
      message: 'Review decision must be accepted, needs_fix, escalated, or pending.',
      metadata,
    };
  }

  if (reviewType === 'auto') {
    if (!hasAcceptedDecision(metadata) || (!hasReviewNote(metadata) && !hasExplicitChatDelivery(metadata))) {
      return {
        ok: false,
        message: 'Auto review completion requires accepted decision plus review note or explicit chat-delivery proof.',
        metadata,
      };
    }
    return { ok: true, metadata: { ...metadata, completedBy: normalizedActor } };
  }

  const assignee = normalizeIdentity(task.assignee);
  const submittedBy = normalizeIdentity(metadata.submitted_by ?? metadata.producer ?? metadata.created_by);
  const actorIdentity = normalizeIdentity(normalizedActor);
  if (actorIdentity && (actorIdentity === assignee || (submittedBy && actorIdentity === submittedBy))) {
    return {
      ok: false,
      message: 'Reviewer must be independent of assignee/submitted_by.',
      metadata,
    };
  }

  if (!hasAcceptedDecision(metadata)) {
    return {
      ok: false,
      message: 'Task completion requires review_decision=accepted.',
      metadata,
    };
  }

  if (!hasReviewNote(metadata)) {
    return {
      ok: false,
      message: 'Task completion requires a substantive review_note.',
      metadata,
    };
  }

  return { ok: true, metadata: { ...metadata, completedBy: normalizedActor } };
}

export function inferTaskType(
  task: Pick<TaskRecord, 'name' | 'description' | 'brief' | 'metadata' | 'model'>
): TaskType {
  const context = buildTaskContext(task);

  if (matchesAny(context, /(triage|assign|cleanup|archive|dedupe|board admin|review hygiene|backlog|board sweep)/i)) {
    return 'board_admin';
  }

  if (matchesAny(context, /(deploy|rollout|install|configure|cron|gateway|monitor|monitoring|verification|verify|ops|incident|health check|restart|provision)/i)) {
    return 'deploy_ops';
  }

  if (matchesAny(context, /(implement|build|fix|refactor|migrate|\bcode\b|patch|integrate|feature|bug|typescript|route|api)/i)) {
    return 'implementation';
  }

  if (matchesAny(context, /(evaluate|analysis|analyze|compare|audit|benchmark|investigate|research|persona|assess)/i)) {
    return 'research_eval';
  }

  if (matchesAny(context, /(write|publish|draft|article|post|summary|messaging|copy|blog|tweet|thread|announcement|content)/i)) {
    return 'content_comms';
  }

  return 'general';
}

export function getPrimaryReviewReason(assessment: ReviewAssessment): string {
  return assessment.reasons[0] ?? 'Review output failed validation.';
}

export function formatReviewAssessment(assessment: ReviewAssessment): string {
  return `${assessment.taskType} ${assessment.verdict} ${assessment.score}/100: ${assessment.reasons.join('; ')}`;
}

export function requiresReviewArtifact(taskType: TaskType): boolean {
  return (
    taskType === 'research_eval' ||
    taskType === 'implementation' ||
    taskType === 'deploy_ops' ||
    taskType === 'content_comms'
  );
}

export function scoreReviewVerdict(score: number): ReviewVerdict {
  const normalizedScore = normalizeReviewScore(score);
  if (normalizedScore >= REVIEW_VALID_SCORE_MIN) {
    return 'VALID';
  }
  if (normalizedScore >= REVIEW_WEAK_SCORE_MIN) {
    return 'WEAK';
  }
  return 'INVALID';
}

export async function assessReviewOutput(
  task: Pick<
    TaskRecord,
    'name' | 'description' | 'brief' | 'metadata' | 'model' | 'output' | 'column' | 'assignee' | 'created_at' | 'updated_at'
  >,
  options: ReviewAssessmentOptions = {}
): Promise<ReviewAssessment> {
  const output = normalizeOutput(task.output);
  const taskType = inferTaskType(task);
  const ownershipPresent = hasAssignedOwner(task.assignee);
  const artifactRequired = requiresReviewArtifact(taskType);

  if (isActiveTaskColumn(task.column) && !ownershipPresent) {
    return buildAssessment(
      taskType,
      'INVALID',
      0,
      ['Active task has no owner.'],
      artifactRequired ? 'missing' : 'not_required',
      false,
      artifactRequired,
      [],
      []
    );
  }

  if (!output) {
    return buildAssessment(taskType, 'INVALID', 0, ['Review output is empty.'], artifactRequired ? 'missing' : 'not_required', ownershipPresent, artifactRequired, [], []);
  }

  if (output.length < REVIEW_OUTPUT_MIN_LENGTH) {
    return buildAssessment(
      taskType,
      'INVALID',
      20,
      [`Review output is shorter than ${REVIEW_OUTPUT_MIN_LENGTH} characters.`],
      artifactRequired ? 'missing' : 'not_required',
      ownershipPresent,
      artifactRequired,
      [],
      []
    );
  }

  if (LOW_EFFORT_OUTPUTS.has(output.toLowerCase())) {
    return buildAssessment(taskType, 'INVALID', 10, ['Review output is not substantive.'], artifactRequired ? 'missing' : 'not_required', ownershipPresent, artifactRequired, [], []);
  }

  const artifactReferences = extractArtifactReferences(output);
  const hasEvidenceSmell = BANNED_EVIDENCE_SMELL_REGEX.test(output);
  if (hasEvidenceSmell && artifactReferences.length === 0) {
    return buildAssessment(
      taskType,
      'INVALID',
      15,
      ['Output relies on vague handoff text without a concrete artifact.'],
      'missing',
      ownershipPresent,
      artifactRequired,
      artifactReferences,
      []
    );
  }

  if (artifactRequired && artifactReferences.length === 0) {
    return buildAssessment(
      taskType,
      'INVALID',
      25,
      [`Task type "${taskType}" requires a concrete artifact reference.`],
      'missing',
      ownershipPresent,
      artifactRequired,
      artifactReferences,
      []
    );
  }

  const artifactInspector = options.artifactInspector ?? defaultArtifactInspector;
  const artifactAssessments = await Promise.all(artifactReferences.map((reference) => artifactInspector(reference)));
  const evidenceStatus = summarizeEvidenceStatus(artifactAssessments, artifactRequired);

  const invalidArtifact = artifactAssessments.find(
    (assessment) =>
      assessment.status === 'missing' ||
      assessment.status === 'empty' ||
      assessment.status === 'dead_url'
  );
  if (invalidArtifact) {
    const legacyStale = isLegacyStaleTask(task) || hasLegacyDocsHost(output);
    return buildAssessment(
      taskType,
      legacyStale ? 'WEAK' : 'INVALID',
      legacyStale ? 60 : 30,
      [legacyStale ? `${invalidArtifact.detail} Legacy stale task requires evidence refresh before final closure.` : invalidArtifact.detail],
      invalidArtifact.status,
      ownershipPresent,
      artifactRequired,
      artifactReferences,
      artifactAssessments
    );
  }

  if (
    artifactRequired &&
    artifactAssessments.length > 0 &&
    artifactAssessments.every((assessment) => !assessment.accessible)
  ) {
    return buildAssessment(
      taskType,
      'INVALID',
      35,
      ['Required artifact exists but is not Entity-reviewable.'],
      evidenceStatus,
      ownershipPresent,
      artifactRequired,
      artifactReferences,
      artifactAssessments
    );
  }

  const reasons: string[] = [];
  let score = 100;

  if (hasEvidenceSmell) {
    score -= 20;
    reasons.push('Output still uses vague handoff phrasing alongside the artifact reference.');
  }

  if (evidenceStatus === 'exists_but_inaccessible') {
    score -= 25;
    reasons.push('Artifact exists but is not in an Entity-reviewable location.');
  } else if (evidenceStatus === 'unknown') {
    score -= 10;
    reasons.push('Artifact could not be fully verified automatically.');
  }

  if (!hasTaskAlignment(task, output)) {
    score -= 15;
    reasons.push('Output does not clearly answer the requested task.');
  }

  if (output.length < 120) {
    score -= 10;
    reasons.push('Output is light on detail.');
  }

  switch (taskType) {
    case 'research_eval': {
      if (!hasRecommendation(output)) {
        score -= 15;
        reasons.push('Research/eval review is missing a recommendation or conclusion.');
      }
      break;
    }
    case 'implementation': {
      if (!hasVerification(output)) {
        score -= 20;
        reasons.push('Implementation review is missing a verification note.');
      }
      break;
    }
    case 'deploy_ops': {
      if (!hasTargetOrHost(output)) {
        score -= 15;
        reasons.push('Deploy/ops review is missing the target environment or host.');
      }
      if (!hasVerification(output)) {
        score -= 20;
        reasons.push('Deploy/ops review is missing verification evidence.');
      }
      break;
    }
    case 'content_comms': {
      if (!hasPublishStatus(output)) {
        score -= 15;
        reasons.push('Content/comms review is missing publish or distribution status.');
      }
      break;
    }
    case 'board_admin': {
      if (!hasBoardScope(output)) {
        score -= 15;
        reasons.push('Board-admin review is missing counts or scope summary.');
      }
      if (!hasBoardTargetSet(output)) {
        score -= 15;
        reasons.push('Board-admin review is missing affected task ids or the explicit set worked on.');
      }
      break;
    }
    default:
      break;
  }

  const verdict = scoreReviewVerdict(score);
  return buildAssessment(
    taskType,
    verdict,
    score,
    reasons,
    evidenceStatus,
    ownershipPresent,
    artifactRequired,
    artifactReferences,
    artifactAssessments
  );
}
