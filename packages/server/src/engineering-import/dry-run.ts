import { createHash } from 'crypto';
import { normalizeTaskTitle } from '../task-dedupe';

export const ENTITY_TODO_SOURCE_SYSTEM = 'entity-todo';
export const ENTITY_ENGINEERING_PROJECT_KEY = 'entity-engineering';
export const ENTITY_ENGINEERING_WORK_DOMAIN = 'engineering';
export const EXPECTED_SOURCE_CSV_SHA256 =
  '7b82a509440f9ff4c2ab4770722a248db9e10d185bc6f675d33318c829bda98d';
export const EXPECTED_MAPPING_CSV_SHA256 =
  '9c60c02d3869ef5606613f38ed37fb075a6f4904c5f26d2f1ce2e81251bfa93b';
export const EXPECTED_TODO_SNAPSHOT_SHA256 =
  'e2715adba665d61f8d467a550737364f57595bef53deb73e460505d0f2842bcc';

const REQUIRED_PROJECT_COLUMNS = [
  'id',
  'org_id',
  'team_id',
  'name',
  'lifecycle_state',
  'project_key',
  'work_domain',
];

export type DryRunDecision = 'create' | 'link' | 'conflict' | 'stale';
export type PrerequisiteState = 'ready' | 'already_implemented' | 'blocked' | 'unknown';

export interface ImportCandidate {
  sourceLine: number;
  sourceTitle: string;
  sourceFingerprint: string;
  importAction: 'create' | 'verify_then_create';
  stableTitleKey: string;
  targetProjectKey: string;
  targetState: string;
  targetLane: string;
  risk: string;
  prerequisite: string;
}

export interface ProjectSnapshot {
  id: number;
  orgId: string | null;
  teamId: string | null;
  name: string;
  lifecycleState: string | null;
  projectKey: string | null;
  workDomain: string | null;
}

export interface TaskImportMetadata {
  sourceSystem: string | null;
  sourceKey: string | null;
  sourceFingerprint: string | null;
  sourceSnapshotSha256: string | null;
  mappingSha256: string | null;
}

export interface TaskSnapshot {
  id: number;
  name: string;
  column: string;
  archived: boolean;
  projectIds: number[];
  legacyProject: string | null;
  engineeringImport: TaskImportMetadata | null;
}

export interface ImportLedgerEntry {
  projectId: number;
  sourceSystem: string;
  sourceKey: string;
  taskId: number;
  sourceFingerprint: string;
  sourceSnapshotSha256: string | null;
}

export interface CurrentEntitySnapshot {
  schema: {
    projectColumns: string[];
    taskColumns: string[];
    taskProjectColumns: string[];
    ledgerTablePresent: boolean;
    ledgerColumns: string[];
    ledgerUniqueProjectSourceKey: boolean;
    ledgerUniqueTaskId: boolean;
  };
  projects: ProjectSnapshot[];
  tasks: TaskSnapshot[];
  ledgerEntries: ImportLedgerEntry[];
  connection: {
    readonly: boolean;
    queryOnly: boolean;
    totalChanges: number;
  };
}

export interface PrerequisiteAssessment {
  sourceLine: number;
  state: PrerequisiteState;
  evidence: string[];
}

export interface ProjectResolution {
  status: 'ready' | 'schema_not_ready' | 'missing' | 'ambiguous' | 'invalid';
  project: ProjectSnapshot | null;
  missingColumns: string[];
  reason: string;
}

export interface CandidateDecision {
  sourceLine: number;
  title: string;
  stableKey: string;
  proposedAction: ImportCandidate['importAction'];
  decision: DryRunDecision;
  executionReady: boolean;
  reasons: string[];
  prerequisite: PrerequisiteAssessment;
  exactMatches: MatchSummary[];
  fuzzyMatches: MatchSummary[];
  advisoryGlobalExactMatchCount: number;
  advisoryGlobalFuzzyMatchCount: number;
}

export interface MatchSummary {
  taskId: number;
  title: string;
  column: string;
  score: number;
  exact: boolean;
  inTargetProject: boolean;
}

export interface EngineeringImportDryRunReport {
  sourceSystem: typeof ENTITY_TODO_SOURCE_SYSTEM;
  hashes: {
    sourceCsvSha256: string;
    mappingCsvSha256: string;
    todoSnapshotSha256: string;
  };
  candidateCount: number;
  projectResolution: ProjectResolution;
  ledgerReadiness: {
    status: 'ready' | 'missing_table' | 'schema_not_ready';
    missingColumns: string[];
  };
  taskMembershipReadiness: {
    status: 'ready' | 'schema_not_ready';
    reason: string;
  };
  connection: CurrentEntitySnapshot['connection'];
  decisions: CandidateDecision[];
  totals: Record<DryRunDecision, number>;
}

export function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('Mapping CSV contains an unterminated quoted field');
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.length > 0));
}

export function stableTitleKey(title: string): string {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const digest = sha256(title.toLowerCase()).slice(0, 12);
  return `todo-${normalized.slice(0, 48).replace(/-$/, '')}-${digest}`;
}

export function parseImportCandidates(mappingCsv: string): ImportCandidate[] {
  const rows = parseCsv(mappingCsv);
  const header = rows.shift();
  if (!header) throw new Error('Mapping CSV is empty');
  const required = [
    'source_line',
    'source_title',
    'source_fingerprint',
    'disposition',
    'import_action',
    'stable_title_key',
    'target_project_key',
    'target_state',
    'target_lane',
    'risk',
    'prerequisite',
  ];
  const indexes = Object.fromEntries(required.map((name) => [name, header.indexOf(name)]));
  if (Object.values(indexes).some((index) => index < 0)) {
    throw new Error('Mapping CSV is missing required candidate columns');
  }

  const candidates = rows
    .filter((row) => row[indexes.disposition] === 'import_candidate')
    .map((row): ImportCandidate => {
      const sourceLine = Number(row[indexes.source_line]);
      const importAction = row[indexes.import_action];
      if (!Number.isSafeInteger(sourceLine) || !['create', 'verify_then_create'].includes(importAction)) {
        throw new Error('Mapping CSV contains an invalid import candidate');
      }
      return {
        sourceLine,
        sourceTitle: row[indexes.source_title],
        sourceFingerprint: row[indexes.source_fingerprint],
        importAction: importAction as ImportCandidate['importAction'],
        stableTitleKey: row[indexes.stable_title_key],
        targetProjectKey: row[indexes.target_project_key],
        targetState: row[indexes.target_state],
        targetLane: row[indexes.target_lane],
        risk: row[indexes.risk],
        prerequisite: row[indexes.prerequisite],
      };
    });

  if (candidates.length !== 7) throw new Error(`Expected 7 import candidates, received ${candidates.length}`);
  if (new Set(candidates.map((candidate) => candidate.stableTitleKey)).size !== candidates.length) {
    throw new Error('Import candidate stable keys are duplicated');
  }
  for (const candidate of candidates) {
    if (candidate.stableTitleKey !== stableTitleKey(candidate.sourceTitle)) {
      throw new Error(`Stable key mismatch for source line ${candidate.sourceLine}`);
    }
    if (
      candidate.targetProjectKey !== ENTITY_ENGINEERING_PROJECT_KEY ||
      candidate.targetState !== 'backlog'
    ) {
      throw new Error(`Unsafe target for source line ${candidate.sourceLine}`);
    }
  }
  return candidates.sort((left, right) => left.sourceLine - right.sourceLine);
}

export function validateMappingHashes(sourceCsv: Buffer, mappingCsv: Buffer): void {
  const sourceHash = sha256(sourceCsv);
  const mappingHash = sha256(mappingCsv);
  if (sourceHash !== EXPECTED_SOURCE_CSV_SHA256) {
    throw new Error(`Source CSV hash mismatch: ${sourceHash}`);
  }
  if (mappingHash !== EXPECTED_MAPPING_CSV_SHA256) {
    throw new Error(`Mapping CSV hash mismatch: ${mappingHash}`);
  }
}

export function resolveEngineeringProject(snapshot: CurrentEntitySnapshot): ProjectResolution {
  const missingColumns = REQUIRED_PROJECT_COLUMNS.filter(
    (column) => !snapshot.schema.projectColumns.includes(column),
  );
  if (missingColumns.length) {
    return {
      status: 'schema_not_ready',
      project: null,
      missingColumns,
      reason: `projects schema lacks ${missingColumns.join(', ')}`,
    };
  }
  const scoped = snapshot.projects.filter(
    (project) =>
      project.orgId === 'default-org' &&
      project.teamId === 'default-team' &&
      project.projectKey === ENTITY_ENGINEERING_PROJECT_KEY,
  );
  if (scoped.length === 0) {
    return {
      status: 'missing',
      project: null,
      missingColumns: [],
      reason: 'No default-scope project has project_key=entity-engineering',
    };
  }
  if (scoped.length > 1) {
    return {
      status: 'ambiguous',
      project: null,
      missingColumns: [],
      reason: 'Multiple default-scope projects have project_key=entity-engineering',
    };
  }
  const project = scoped[0];
  if (
    project.workDomain !== ENTITY_ENGINEERING_WORK_DOMAIN ||
    project.lifecycleState !== 'active'
  ) {
    return {
      status: 'invalid',
      project,
      missingColumns: [],
      reason: 'Entity Engineering project is not active with work_domain=engineering',
    };
  }
  return { status: 'ready', project, missingColumns: [], reason: 'Exact scoped project identity resolved' };
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeTaskTitle(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalizeTaskTitle(right).split(' ').filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function findMatches(
  candidate: ImportCandidate,
  tasks: TaskSnapshot[],
  targetProjectId: number | null,
): {
  exact: MatchSummary[];
  fuzzy: MatchSummary[];
  advisoryGlobalExactMatchCount: number;
  advisoryGlobalFuzzyMatchCount: number;
} {
  const normalizedCandidate = normalizeTaskTitle(candidate.sourceTitle);
  const matches = tasks
    .map((task): MatchSummary => {
      const exact = normalizeTaskTitle(task.name) === normalizedCandidate;
      return {
        taskId: task.id,
        title: task.name,
        column: task.column,
        score: exact ? 1 : tokenSimilarity(candidate.sourceTitle, task.name),
        exact,
        inTargetProject: targetProjectId !== null && task.projectIds.includes(targetProjectId),
      };
    })
    .filter((match) => match.exact || match.score >= 0.7)
    .sort((left, right) => right.score - left.score || right.taskId - left.taskId);
  return {
    exact: matches.filter((match) => match.exact && match.inTargetProject).slice(0, 5),
    fuzzy: matches
      .filter((match) => !match.exact && match.inTargetProject)
      .slice(0, 5),
    advisoryGlobalExactMatchCount: matches.filter(
      (match) => match.exact && !match.inTargetProject,
    ).length,
    advisoryGlobalFuzzyMatchCount: matches.filter(
      (match) => !match.exact && !match.inTargetProject,
    ).length,
  };
}

function ledgerReadiness(snapshot: CurrentEntitySnapshot) {
  if (!snapshot.schema.ledgerTablePresent) {
    return { status: 'missing_table' as const, missingColumns: [] };
  }
  const required = [
    'project_id',
    'source_system',
    'source_key',
    'task_id',
    'source_fingerprint',
    'source_snapshot_sha256',
  ];
  const missingColumns = required.filter((column) => !snapshot.schema.ledgerColumns.includes(column));
  if (!snapshot.schema.ledgerUniqueProjectSourceKey) {
    missingColumns.push('UNIQUE(project_id, source_system, source_key)');
  }
  if (!snapshot.schema.ledgerUniqueTaskId) {
    missingColumns.push('UNIQUE(task_id)');
  }
  return {
    status: missingColumns.length ? ('schema_not_ready' as const) : ('ready' as const),
    missingColumns,
  };
}

function taskMembershipReadiness(snapshot: CurrentEntitySnapshot) {
  const primaryReady = snapshot.schema.taskColumns.includes('project_id');
  const joinReady =
    snapshot.schema.taskProjectColumns.includes('task_id') &&
    snapshot.schema.taskProjectColumns.includes('project_id');
  return primaryReady && joinReady
    ? { status: 'ready' as const, reason: 'Primary and join-table project membership are readable' }
    : {
        status: 'schema_not_ready' as const,
        reason: 'tasks.project_id or task_projects(task_id, project_id) is unavailable',
      };
}

export function runEngineeringImportDryRun(
  candidates: ImportCandidate[],
  snapshot: CurrentEntitySnapshot,
  prerequisites: PrerequisiteAssessment[],
): EngineeringImportDryRunReport {
  if (!snapshot.connection.readonly || !snapshot.connection.queryOnly || snapshot.connection.totalChanges !== 0) {
    throw new Error('Dry run requires a read-only, query-only database connection with zero changes');
  }
  const projectResolution = resolveEngineeringProject(snapshot);
  const ledger = ledgerReadiness(snapshot);
  const taskMembership = taskMembershipReadiness(snapshot);
  const projectId = projectResolution.project?.id ?? null;
  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const prerequisiteByLine = new Map(prerequisites.map((entry) => [entry.sourceLine, entry]));

  const decisions = candidates.map((candidate): CandidateDecision => {
    const prerequisite = prerequisiteByLine.get(candidate.sourceLine) ?? {
      sourceLine: candidate.sourceLine,
      state: 'unknown' as const,
      evidence: [],
    };
    const matches = findMatches(candidate, snapshot.tasks, projectId);
    const ledgerMatches = snapshot.ledgerEntries.filter(
      (entry) =>
        entry.sourceSystem === ENTITY_TODO_SOURCE_SYSTEM &&
        entry.sourceKey === candidate.stableTitleKey &&
        projectId !== null &&
        entry.projectId === projectId,
    );
    const metadataMatches = snapshot.tasks.filter(
      (task) =>
        projectId !== null &&
        task.projectIds.includes(projectId) &&
        task.engineeringImport?.sourceSystem === ENTITY_TODO_SOURCE_SYSTEM &&
        task.engineeringImport.sourceKey === candidate.stableTitleKey,
    );
    const reasons: string[] = [];
    let decision: DryRunDecision;

    if (prerequisite.state === 'already_implemented') {
      decision = 'stale';
      reasons.push('Current origin/main evidence shows the mapped feature is already implemented');
    } else if (projectResolution.status !== 'ready') {
      decision = 'conflict';
      reasons.push(`Project identity is ${projectResolution.status}: ${projectResolution.reason}`);
    } else if (taskMembership.status !== 'ready') {
      decision = 'conflict';
      reasons.push(taskMembership.reason);
      } else if (ledger.status !== 'ready') {
        decision = 'conflict';
        reasons.push(`Import ledger is ${ledger.status}`);
    } else if (ledgerMatches.length > 1 || metadataMatches.length > 1) {
      decision = 'conflict';
      reasons.push('Stable key resolves to multiple existing tasks');
    } else if (ledgerMatches.length === 1) {
      const entry = ledgerMatches[0];
      const linkedTask = taskById.get(entry.taskId);
      if (
        !linkedTask ||
        entry.sourceFingerprint !== candidate.sourceFingerprint ||
        entry.sourceSnapshotSha256 !== EXPECTED_TODO_SNAPSHOT_SHA256 ||
        linkedTask.engineeringImport?.sourceSystem !== ENTITY_TODO_SOURCE_SYSTEM ||
        linkedTask.engineeringImport.sourceKey !== candidate.stableTitleKey ||
        linkedTask.engineeringImport.sourceFingerprint !== candidate.sourceFingerprint ||
        linkedTask.engineeringImport.sourceSnapshotSha256 !== EXPECTED_TODO_SNAPSHOT_SHA256 ||
        linkedTask.engineeringImport.mappingSha256 !== EXPECTED_MAPPING_CSV_SHA256 ||
        !linkedTask.projectIds.includes(entry.projectId)
      ) {
        decision = 'conflict';
        reasons.push('Import ledger entry has task, fingerprint, or project drift');
      } else {
        decision = 'link';
        reasons.push(`Import ledger already links task #${linkedTask.id}`);
      }
    } else if (metadataMatches.length === 1) {
      decision = 'conflict';
      reasons.push('Task metadata contains the stable key without an authoritative ledger entry');
    } else if (matches.exact.length > 0) {
      decision = 'conflict';
      reasons.push('Exact target-project title exists without an authoritative stable-key ledger link');
    } else if (prerequisite.state !== 'ready') {
      decision = 'conflict';
      reasons.push(`Prerequisite is ${prerequisite.state}`);
    } else if (matches.fuzzy.length > 0) {
      decision = 'conflict';
      reasons.push('Fuzzy target-project title requires reconciliation before creation');
    } else {
      decision = 'create';
      reasons.push('No stable-key, exact-title, fuzzy-title, project, ledger, or prerequisite conflict found');
    }

    if (matches.advisoryGlobalExactMatchCount > 0) {
      reasons.push(
        `Advisory exact-title matches outside the target project: ${matches.advisoryGlobalExactMatchCount}`,
      );
    }
    return {
      sourceLine: candidate.sourceLine,
      title: candidate.sourceTitle,
      stableKey: candidate.stableTitleKey,
      proposedAction: candidate.importAction,
      decision,
      executionReady: decision === 'create',
      reasons,
      prerequisite,
      exactMatches: matches.exact,
      fuzzyMatches: matches.fuzzy,
      advisoryGlobalExactMatchCount: matches.advisoryGlobalExactMatchCount,
      advisoryGlobalFuzzyMatchCount: matches.advisoryGlobalFuzzyMatchCount,
    };
  });

  const totals: Record<DryRunDecision, number> = { create: 0, link: 0, conflict: 0, stale: 0 };
  for (const decision of decisions) totals[decision.decision] += 1;
  return {
    sourceSystem: ENTITY_TODO_SOURCE_SYSTEM,
    hashes: {
      sourceCsvSha256: EXPECTED_SOURCE_CSV_SHA256,
      mappingCsvSha256: EXPECTED_MAPPING_CSV_SHA256,
      todoSnapshotSha256: EXPECTED_TODO_SNAPSHOT_SHA256,
    },
    candidateCount: candidates.length,
    projectResolution,
    ledgerReadiness: ledger,
    taskMembershipReadiness: taskMembership,
    connection: snapshot.connection,
    decisions,
    totals,
  };
}
