import Database from 'better-sqlite3';
import {
  type CandidateDecision,
  type EngineeringImportDryRunReport,
  type ImportCandidate,
  ENTITY_TODO_SOURCE_SYSTEM,
  EXPECTED_MAPPING_CSV_SHA256,
  EXPECTED_TODO_SNAPSHOT_SHA256,
  sha256,
} from './dry-run';
import type { ValidatedBackupGate } from './backup-gate';

export type ImportExecutionStatus = 'ready' | 'unsafe';

export interface ImportExecutionPlan {
  status: ImportExecutionStatus;
  importExecuted: boolean;
  createAnywayUsed: false;
  productionPromotion: false;
  reasons: string[];
  executionReadyCount: number;
  executionReadyKeys: string[];
  approvedSetSha256: string;
  receiptIdentity: string;
  sampleTaskRows: CreatedImportTask[];
}

export interface CreatedImportTask {
  taskId: number;
  projectId: number;
  title: string;
  stableKey: string;
  sourceLine: number;
  column: string;
}

export interface ExecuteApprovedImportResult {
  plan: ImportExecutionPlan;
  created: CreatedImportTask[];
}

function approvedSetSha(stableKeys: string[]): string {
  const normalized = [...stableKeys].sort();
  return sha256(JSON.stringify(normalized));
}

export function buildImportReceiptIdentity(approvedSetSha256: string): string {
  return `ee-b-06:${EXPECTED_TODO_SNAPSHOT_SHA256}:${EXPECTED_MAPPING_CSV_SHA256}:${approvedSetSha256}`;
}

function backupDatabaseSha(backupGate: ValidatedBackupGate): string | null {
  const before = backupGate.receipt.databaseBefore;
  if (!before || typeof before !== 'object' || Array.isArray(before)) return null;
  const database = (before as { database?: unknown }).database;
  if (!database || typeof database !== 'object' || Array.isArray(database)) return null;
  const sha = (database as { sha256?: unknown }).sha256;
  return typeof sha === 'string' && sha.length === 64 ? sha : null;
}

export function planImportExecution(
  dryRun: EngineeringImportDryRunReport,
  backupGate: ValidatedBackupGate,
  options: { liveDatabaseSha256?: string | null } = {},
): ImportExecutionPlan {
  const reasons: string[] = [];
  if (backupGate.receipt.status !== 'PASS') {
    reasons.push('Backup gate is not PASS');
  }
  const backedUpSha = backupDatabaseSha(backupGate);
  if (!backedUpSha) {
    reasons.push('Backup gate is missing databaseBefore.database.sha256');
  } else if (
    options.liveDatabaseSha256 &&
    options.liveDatabaseSha256 !== backedUpSha
  ) {
    reasons.push(
      `Live database SHA-256 drifted since backup gate (${backedUpSha} -> ${options.liveDatabaseSha256})`,
    );
  }
  if (dryRun.projectResolution.status !== 'ready') {
    reasons.push(
      `Project identity is ${dryRun.projectResolution.status}: ${dryRun.projectResolution.reason}`,
    );
  }
  if (dryRun.ledgerReadiness.status !== 'ready') {
    reasons.push(`Import ledger is ${dryRun.ledgerReadiness.status}`);
  }
  if (dryRun.taskMembershipReadiness.status !== 'ready') {
    reasons.push(dryRun.taskMembershipReadiness.reason);
  }
  if (dryRun.connection.totalChanges !== 0) {
    reasons.push('Dry-run connection reported non-zero totalChanges');
  }

  const readyDecisions = dryRun.decisions.filter((decision) => decision.executionReady);
  const executionReadyKeys = readyDecisions.map((decision) => decision.stableKey);
  const approvedSetSha256 = approvedSetSha(executionReadyKeys);
  const receiptIdentity = buildImportReceiptIdentity(approvedSetSha256);

  if (readyDecisions.length === 0) {
    reasons.push('Zero execution-ready candidates; refusing create_anyway and all writes');
  }

  const unsafe = reasons.length > 0 || readyDecisions.length === 0;
  return {
    status: unsafe ? 'unsafe' : 'ready',
    importExecuted: false,
    createAnywayUsed: false,
    productionPromotion: false,
    reasons,
    executionReadyCount: readyDecisions.length,
    executionReadyKeys,
    approvedSetSha256,
    receiptIdentity,
    sampleTaskRows: [],
  };
}

function assertNoCreateAnyway(options: { createAnyway?: boolean }): void {
  if (options.createAnyway) {
    throw new Error('create_anyway is forbidden for EE-B-06 import execution');
  }
}

function metadataForCandidate(candidate: ImportCandidate, actor: string): string {
  return JSON.stringify({
    engineering_import: {
      source_system: ENTITY_TODO_SOURCE_SYSTEM,
      source_key: candidate.stableTitleKey,
      source_fingerprint: candidate.sourceFingerprint,
      source_line: candidate.sourceLine,
      source_snapshot_sha256: EXPECTED_TODO_SNAPSHOT_SHA256,
      mapping_sha256: EXPECTED_MAPPING_CSV_SHA256,
      import_actor: actor,
    },
  });
}

export function executeApprovedImport(options: {
  databasePath: string;
  dryRun: EngineeringImportDryRunReport;
  candidates: ImportCandidate[];
  backupGate: ValidatedBackupGate;
  actor?: string;
  createAnyway?: boolean;
  liveDatabaseSha256?: string | null;
}): ExecuteApprovedImportResult {
  assertNoCreateAnyway(options);
  const plan = planImportExecution(options.dryRun, options.backupGate, {
    liveDatabaseSha256: options.liveDatabaseSha256,
  });
  if (plan.status !== 'ready') {
    return { plan, created: [] };
  }

  const project = options.dryRun.projectResolution.project;
  if (!project) {
    throw new Error('Execution plan ready without resolved project');
  }

  const byKey = new Map(options.candidates.map((candidate) => [candidate.stableTitleKey, candidate]));
  const readyDecisions = options.dryRun.decisions.filter((decision) => decision.executionReady);
  const actor = options.actor ?? 'ee-b-06-importer';

  const db = new Database(options.databasePath);
  try {
    const created = db.transaction(() => {
      const rows: CreatedImportTask[] = [];
      for (const decision of readyDecisions) {
        const candidate = byKey.get(decision.stableKey);
        if (!candidate) {
          throw new Error(`Missing candidate payload for stable key ${decision.stableKey}`);
        }
        const insert = db
          .prepare(
            `INSERT INTO tasks (name, description, "column", metadata, project, project_id, org_id, team_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            candidate.sourceTitle,
            `Imported from entity-todo source line ${candidate.sourceLine}`,
            candidate.targetState || 'backlog',
            metadataForCandidate(candidate, actor),
            'Entity Engineering',
            project.id,
            project.orgId ?? 'default-org',
            project.teamId ?? 'default-team',
          );
        const taskId = Number(insert.lastInsertRowid);
        db.prepare(
          `INSERT INTO task_projects (task_id, project_id, org_id) VALUES (?, ?, ?)`,
        ).run(taskId, project.id, project.orgId ?? 'default-org');
        db.prepare(
          `INSERT INTO task_import_keys (
            project_id, source_system, source_key, task_id, source_fingerprint, source_snapshot_sha256
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          project.id,
          ENTITY_TODO_SOURCE_SYSTEM,
          candidate.stableTitleKey,
          taskId,
          candidate.sourceFingerprint,
          EXPECTED_TODO_SNAPSHOT_SHA256,
        );
        rows.push({
          taskId,
          projectId: project.id,
          title: candidate.sourceTitle,
          stableKey: candidate.stableTitleKey,
          sourceLine: candidate.sourceLine,
          column: candidate.targetState || 'backlog',
        });
      }
      return rows;
    })();

    return {
      plan: {
        ...plan,
        importExecuted: true,
        sampleTaskRows: created,
      },
      created,
    };
  } finally {
    db.close();
  }
}

export function summarizeUnsafeDecisions(decisions: CandidateDecision[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const decision of decisions) {
    summary[decision.decision] = (summary[decision.decision] ?? 0) + 1;
  }
  return summary;
}
