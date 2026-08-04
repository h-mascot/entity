import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import {
  parseImportCandidates,
  runEngineeringImportDryRun,
  sha256,
  validateMappingHashes,
} from './dry-run';
import { readCurrentEntitySnapshot } from './read-only-snapshot';
import { assessRepositoryPrerequisites } from './repo-prerequisites';
import {
  type FileIdentity,
  assertDatabaseIdentityUnchanged,
  writeReceiptAppendOnly,
} from './receipt-safety';
import { validateBackupGateReceipt } from './backup-gate';
import {
  executeApprovedImport,
  planImportExecution,
  summarizeUnsafeDecisions,
} from './execute';

interface Args {
  database: string;
  backupGate: string;
  expectedBackupSha: string | null;
  output: string | null;
  generatedAt: string;
  allowExecute: boolean;
  serverBuildVerified: boolean;
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; ) {
    const key = argv[index];
    if (!key?.startsWith('--')) {
      throw new Error(
        'Usage: execute-cli --database <path> --backup-gate <path> [--expected-backup-sha <sha>] [--output <new-path>] [--generated-at <ISO>] [--allow-execute] [--server-build-verified]',
      );
    }
    const name = key.slice(2);
    if (name === 'allow-execute' || name === 'server-build-verified') {
      flags.add(name);
      index += 1;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for --${name}`);
    }
    values.set(name, value);
    index += 2;
  }
  const database = values.get('database');
  const backupGate = values.get('backup-gate');
  if (!database) throw new Error('--database is required');
  if (!backupGate) throw new Error('--backup-gate is required');
  const generatedAt = values.get('generated-at') ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error('--generated-at must be an ISO timestamp');
  return {
    database: path.resolve(database),
    backupGate: path.resolve(backupGate),
    expectedBackupSha: values.get('expected-backup-sha') ?? null,
    output: values.has('output') ? path.resolve(values.get('output') as string) : null,
    generatedAt,
    allowExecute: flags.has('allow-execute'),
    serverBuildVerified: flags.has('server-build-verified'),
  };
}

async function identity(filePath: string): Promise<FileIdentity | null> {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath, { bigint: true });
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return {
    path: filePath,
    size: Number(stat.size),
    mtimeNs: stat.mtimeNs.toString(),
    sha256: hash.digest('hex'),
  };
}

async function databaseIdentity(databasePath: string) {
  return {
    database: await identity(databasePath),
    wal: await identity(`${databasePath}-wal`),
    shm: await identity(`${databasePath}-shm`),
  };
}

function currentHead(repoRoot: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function findRepositoryRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (
      fs.existsSync(path.join(current, '.git')) &&
      fs.existsSync(path.join(current, 'docs/plans/entity-engineering-import-mapping.csv'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Unable to resolve repository root from ${start}`);
    current = parent;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = findRepositoryRoot(__dirname);
  const sourcePath = path.join(
    repoRoot,
    'docs/plans/entity-engineering-import-mapping-source.csv',
  );
  const mappingPath = path.join(
    repoRoot,
    'docs/plans/entity-engineering-import-mapping.csv',
  );
  const sourceCsv = fs.readFileSync(sourcePath);
  const mappingCsv = fs.readFileSync(mappingPath);
  validateMappingHashes(sourceCsv, mappingCsv);
  const candidates = parseImportCandidates(mappingCsv.toString('utf8'));

  const backupGate = validateBackupGateReceipt({
    receiptPath: args.backupGate,
    expectedSha256: args.expectedBackupSha ?? undefined,
    expectedRepository: repoRoot,
  });

  if (!args.serverBuildVerified) {
    throw new Error(
      'Refusing import boundary without --server-build-verified; run packages/server build first',
    );
  }

  const prerequisites = assessRepositoryPrerequisites(repoRoot, {
    serverBuildPassed: true,
    sourceRef: 'HEAD',
  });

  const before = await databaseIdentity(args.database);
  if (!before.database) throw new Error(`Database does not exist: ${args.database}`);
  const snapshot = readCurrentEntitySnapshot(args.database);
  const dryRun = runEngineeringImportDryRun(candidates, snapshot, prerequisites);
  const afterRead = await databaseIdentity(args.database);
  assertDatabaseIdentityUnchanged(before, afterRead);

  let plan = planImportExecution(dryRun, backupGate, {
    liveDatabaseSha256: before.database.sha256,
  });
  let created = plan.sampleTaskRows;
  let mutationAttempted = false;

  if (plan.status === 'ready') {
    if (!args.allowExecute) {
      plan = {
        ...plan,
        status: 'unsafe',
        reasons: [
          ...plan.reasons,
          'Execution-ready candidates exist but --allow-execute was not provided',
        ],
      };
    } else {
      mutationAttempted = true;
      const result = executeApprovedImport({
        databasePath: args.database,
        dryRun,
        candidates,
        backupGate,
        actor: 'ee-b-06-importer',
        liveDatabaseSha256: before.database.sha256,
      });
      plan = result.plan;
      created = result.created;
    }
  }

  const after = await databaseIdentity(args.database);
  if (plan.status === 'unsafe' || !plan.importExecuted) {
    assertDatabaseIdentityUnchanged(before, after);
  }

  const receipt = {
    issue: 'THE-854 / EE-B-06',
    generatedAt: args.generatedAt,
    repository: repoRoot,
    repositoryHead: currentHead(repoRoot),
    backupGate: {
      path: backupGate.receiptPath,
      sha256: backupGate.receiptSha256,
      status: backupGate.receipt.status,
      backupDir: backupGate.receipt.backupDir,
    },
    database: {
      path: args.database,
      identity: { before, after },
      identityUnchanged: JSON.stringify(before) === JSON.stringify(after),
    },
    hashes: {
      sourceCsvSha256: sha256(sourceCsv),
      mappingCsvSha256: sha256(mappingCsv),
      todoSnapshotSha256: dryRun.hashes.todoSnapshotSha256,
      approvedSetSha256: plan.approvedSetSha256,
    },
    dryRunSummary: {
      candidateCount: dryRun.candidateCount,
      totals: dryRun.totals,
      projectResolution: dryRun.projectResolution,
      ledgerReadiness: dryRun.ledgerReadiness,
      taskMembershipReadiness: dryRun.taskMembershipReadiness,
      decisionCounts: summarizeUnsafeDecisions(dryRun.decisions),
      executionReadyCount: plan.executionReadyCount,
      decisions: dryRun.decisions,
    },
    execution: plan,
    sampleTaskRows: created,
    receiptIdentity: plan.receiptIdentity,
    failClosed: plan.status === 'unsafe',
    noWriteProof:
      plan.status === 'unsafe' || !plan.importExecuted
        ? {
            databaseOpenedReadOnlyDuringPlanning: snapshot.connection.readonly,
            queryOnlyEnabledDuringPlanning: snapshot.connection.queryOnly,
            sqliteTotalChangesDuringPlanning: snapshot.connection.totalChanges,
            databaseFilesUnchanged: JSON.stringify(before) === JSON.stringify(after),
            taskCreationAttempted: mutationAttempted,
            databaseMutationAttempted: mutationAttempted,
            createAnywayUsed: false,
            productionPromotion: false,
          }
        : null,
    nextBoundary: {
      issue: 'THE-855 / EE-B-07',
      status:
        plan.importExecuted
          ? 'ready_for_board_e2e_proof'
          : 'blocked_until_schema_ledger_and_execution_ready_candidates',
      importExecuted: plan.importExecuted,
    },
  };

  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  if (args.output) {
    writeReceiptAppendOnly(args.output, rendered);
  }
  process.stdout.write(rendered);
  if (plan.status === 'unsafe') {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
