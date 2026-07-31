import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CurrentEntitySnapshot,
  type EngineeringImportDryRunReport,
  type ImportCandidate,
  ENTITY_ENGINEERING_PROJECT_KEY,
  ENTITY_ENGINEERING_WORK_DOMAIN,
  ENTITY_TODO_SOURCE_SYSTEM,
  EXPECTED_MAPPING_CSV_SHA256,
  EXPECTED_SOURCE_CSV_SHA256,
  EXPECTED_TODO_SNAPSHOT_SHA256,
  runEngineeringImportDryRun,
  stableTitleKey,
} from './dry-run';
import type { ValidatedBackupGate } from './backup-gate';
import {
  buildImportReceiptIdentity,
  executeApprovedImport,
  planImportExecution,
} from './execute';

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const temporaryPath of temporaryPaths.splice(0)) {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
  }
});

function backupGate(): ValidatedBackupGate {
  return {
    receiptPath: '/tmp/backup-gate.json',
    receiptSha256: 'a'.repeat(64),
    receipt: {
      issue: 'THE-854 / EE-B-06',
      gate: 'backup-before-import',
      status: 'PASS',
      generatedAt: '2026-07-30T19:15:11.410106Z',
      repository: '/tmp/repo',
      repositoryHead: 'abc',
      backupDir: '/tmp/backup',
      sqliteBackupSucceeded: true,
      databaseIdentityUnchanged: true,
      productionPromotion: false,
      importExecuted: false,
      henryApproval: 'approved',
      databaseBefore: {
        database: { path: '/db', size: 1, mtimeNs: '1', sha256: 'd'.repeat(64) },
      },
      databaseAfter: {
        database: { path: '/db', size: 1, mtimeNs: '1', sha256: 'd'.repeat(64) },
      },
      backupFiles: [],
    },
  };
}

function candidate(overrides: Partial<ImportCandidate> = {}): ImportCandidate {
  const sourceTitle = overrides.sourceTitle ?? 'Browser testing of Activity Stream grouping';
  return {
    sourceLine: 92,
    sourceTitle,
    sourceFingerprint: 'fingerprint-92',
    importAction: 'create',
    stableTitleKey: stableTitleKey(sourceTitle),
    targetProjectKey: ENTITY_ENGINEERING_PROJECT_KEY,
    targetState: 'backlog',
    targetLane: 'app-test',
    risk: 'low',
    prerequisite: 'Stable fixture',
    ...overrides,
  };
}

function readySnapshot(): CurrentEntitySnapshot {
  return {
    schema: {
      projectColumns: [
        'id',
        'org_id',
        'team_id',
        'name',
        'lifecycle_state',
        'project_key',
        'work_domain',
      ],
      taskColumns: ['id', 'name', 'project_id', 'metadata'],
      taskProjectColumns: ['task_id', 'project_id'],
      ledgerTablePresent: true,
      ledgerColumns: [
        'project_id',
        'source_system',
        'source_key',
        'task_id',
        'source_fingerprint',
        'source_snapshot_sha256',
      ],
      ledgerUniqueProjectSourceKey: true,
      ledgerUniqueTaskId: true,
    },
    projects: [
      {
        id: 7,
        orgId: 'default-org',
        teamId: 'default-team',
        name: 'Entity Engineering',
        lifecycleState: 'active',
        projectKey: ENTITY_ENGINEERING_PROJECT_KEY,
        workDomain: ENTITY_ENGINEERING_WORK_DOMAIN,
      },
    ],
    tasks: [],
    ledgerEntries: [],
    connection: { readonly: true, queryOnly: true, totalChanges: 0 },
  };
}

function dryRunReport(
  overrides: Partial<EngineeringImportDryRunReport> = {},
): EngineeringImportDryRunReport {
  const report = runEngineeringImportDryRun(
    [candidate()],
    readySnapshot(),
    [{ sourceLine: 92, state: 'ready', evidence: ['ready'] }],
  );
  return { ...report, ...overrides };
}

describe('EE-B-06 import execution planning', () => {
  it('fail-closes when schema/ledger are not ready and no candidate is execution-ready', () => {
    const report = dryRunReport({
      projectResolution: {
        status: 'schema_not_ready',
        project: null,
        missingColumns: ['project_key', 'work_domain'],
        reason: 'projects schema lacks project_key, work_domain',
      },
      ledgerReadiness: { status: 'missing_table', missingColumns: [] },
      decisions: [
        {
          sourceLine: 92,
          title: 'Browser testing of Activity Stream grouping',
          stableKey: stableTitleKey('Browser testing of Activity Stream grouping'),
          proposedAction: 'create',
          decision: 'conflict',
          executionReady: false,
          reasons: ['Project identity is schema_not_ready'],
          prerequisite: { sourceLine: 92, state: 'ready', evidence: ['ready'] },
          exactMatches: [],
          fuzzyMatches: [],
          advisoryGlobalExactMatchCount: 0,
          advisoryGlobalFuzzyMatchCount: 0,
        },
      ],
      totals: { create: 0, link: 0, conflict: 1, stale: 0 },
    });

    const plan = planImportExecution(report, backupGate());
    expect(plan.status).toBe('unsafe');
    expect(plan.importExecuted).toBe(false);
    expect(plan.createAnywayUsed).toBe(false);
    expect(plan.executionReadyCount).toBe(0);
    expect(plan.reasons.join(' ')).toMatch(/schema_not_ready|Zero execution-ready|missing_table/);
    expect(plan.receiptIdentity).toBe(
      buildImportReceiptIdentity(plan.approvedSetSha256),
    );
  });

  it('marks ready only when create candidates exist and readiness is green', () => {
    const plan = planImportExecution(dryRunReport(), backupGate());
    expect(plan.status).toBe('ready');
    expect(plan.executionReadyCount).toBe(1);
    expect(plan.executionReadyKeys).toHaveLength(1);
  });

  it('fail-closes when the live database drifted after the backup gate', () => {
    const gate = backupGate();
    gate.receipt.databaseBefore = {
      database: { path: '/db', size: 1, mtimeNs: 1, sha256: 'b'.repeat(64) },
    };
    const plan = planImportExecution(dryRunReport(), gate, {
      liveDatabaseSha256: 'c'.repeat(64),
    });
    expect(plan.status).toBe('unsafe');
    expect(plan.reasons.join(' ')).toMatch(/drifted since backup gate/);
  });

  it('rejects create_anyway', () => {
    expect(() =>
      executeApprovedImport({
        databasePath: '/tmp/unused.db',
        dryRun: dryRunReport(),
        candidates: [candidate()],
        backupGate: backupGate(),
        createAnyway: true,
      }),
    ).toThrow('create_anyway is forbidden');
  });
});

describe('EE-B-06 approved import writes', () => {
  it('creates task + ledger rows transactionally and is idempotent on re-plan after import', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-b-06-exec-'));
    temporaryPaths.push(directory);
    const databasePath = path.join(directory, 'entity.sqlite');
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        org_id TEXT,
        team_id TEXT,
        lifecycle_state TEXT,
        project_key TEXT,
        work_domain TEXT
      );
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        "column" TEXT NOT NULL DEFAULT 'backlog',
        metadata TEXT,
        project TEXT,
        project_id INTEGER,
        org_id TEXT,
        team_id TEXT,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE task_projects (
        task_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        org_id TEXT
      );
      CREATE TABLE task_import_keys (
        project_id INTEGER NOT NULL,
        source_system TEXT NOT NULL,
        source_key TEXT NOT NULL,
        task_id INTEGER NOT NULL UNIQUE,
        source_fingerprint TEXT NOT NULL,
        source_snapshot_sha256 TEXT NOT NULL,
        UNIQUE(project_id, source_system, source_key)
      );
      INSERT INTO projects (
        id, name, org_id, team_id, lifecycle_state, project_key, work_domain
      ) VALUES (
        7, 'Entity Engineering', 'default-org', 'default-team', 'active',
        '${ENTITY_ENGINEERING_PROJECT_KEY}', '${ENTITY_ENGINEERING_WORK_DOMAIN}'
      );
    `);
    db.close();

    const report = dryRunReport();
    const first = executeApprovedImport({
      databasePath,
      dryRun: report,
      candidates: [candidate()],
      backupGate: backupGate(),
    });
    expect(first.plan.status).toBe('ready');
    expect(first.plan.importExecuted).toBe(true);
    expect(first.created).toHaveLength(1);

    const reader = new Database(databasePath, { readonly: true });
    const task = reader
      .prepare('SELECT id, name, metadata, project_id FROM tasks WHERE id = ?')
      .get(first.created[0].taskId) as {
      id: number;
      name: string;
      metadata: string;
      project_id: number;
    };
    const ledger = reader
      .prepare(
        `SELECT project_id, source_system, source_key, task_id, source_fingerprint, source_snapshot_sha256
         FROM task_import_keys WHERE task_id = ?`,
      )
      .get(first.created[0].taskId) as {
      project_id: number;
      source_system: string;
      source_key: string;
      task_id: number;
      source_fingerprint: string;
      source_snapshot_sha256: string;
    };
    reader.close();

    expect(task.name).toBe('Browser testing of Activity Stream grouping');
    expect(task.project_id).toBe(7);
    const metadata = JSON.parse(task.metadata);
    expect(metadata.engineering_import.source_system).toBe(ENTITY_TODO_SOURCE_SYSTEM);
    expect(metadata.engineering_import.mapping_sha256).toBe(EXPECTED_MAPPING_CSV_SHA256);
    expect(metadata.engineering_import.source_snapshot_sha256).toBe(
      EXPECTED_TODO_SNAPSHOT_SHA256,
    );
    expect(ledger.source_system).toBe(ENTITY_TODO_SOURCE_SYSTEM);
    expect(ledger.source_key).toBe(first.created[0].stableKey);
    expect(ledger.source_snapshot_sha256).toBe(EXPECTED_TODO_SNAPSHOT_SHA256);

    // Re-import of the same key must fail closed at the unique ledger boundary.
    expect(() =>
      executeApprovedImport({
        databasePath,
        dryRun: report,
        candidates: [candidate()],
        backupGate: backupGate(),
      }),
    ).toThrow();
  });

  it('builds append-only receipt identity from pinned hashes', () => {
    const approved = createHash('sha256').update('[]').digest('hex');
    expect(buildImportReceiptIdentity(approved)).toBe(
      `ee-b-06:${EXPECTED_TODO_SNAPSHOT_SHA256}:${EXPECTED_MAPPING_CSV_SHA256}:${approved}`,
    );
    expect(EXPECTED_SOURCE_CSV_SHA256).toHaveLength(64);
  });
});
