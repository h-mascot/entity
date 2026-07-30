import fs from 'fs';
import os from 'os';
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

interface Args {
  database: string;
  output: string | null;
  generatedAt: string;
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Usage: cli --database <path> [--output <new-path>] [--generated-at <ISO>]');
    }
    values.set(key.slice(2), value);
  }
  const database = values.get('database');
  if (!database) throw new Error('--database is required');
  const generatedAt = values.get('generated-at') ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error('--generated-at must be an ISO timestamp');
  return {
    database: path.resolve(database),
    output: values.has('output') ? path.resolve(values.get('output') as string) : null,
    generatedAt,
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

function resolveRef(repoRoot: string, sourceRef: string): string {
  return execFileSync('git', ['rev-parse', sourceRef], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function verifyServerBuildAtRef(repoRoot: string, sourceRef: string): void {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-b-05-origin-build-'));
  try {
    const archive = execFileSync('git', ['archive', '--format=tar', sourceRef], {
      cwd: repoRoot,
      encoding: 'buffer',
      maxBuffer: 256 * 1024 * 1024,
    });
    execFileSync('tar', ['-xf', '-', '-C', temporaryRoot], {
      input: archive,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(temporaryRoot, 'node_modules'));
    execFileSync(
      'npm',
      ['--prefix', path.join(temporaryRoot, 'packages/server'), 'run', 'build'],
      {
        cwd: temporaryRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
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
  const sourceRef = 'origin/main';
  const sourceRefHead = resolveRef(repoRoot, sourceRef);
  verifyServerBuildAtRef(repoRoot, sourceRef);
  const prerequisites = assessRepositoryPrerequisites(repoRoot, {
    serverBuildPassed: true,
    sourceRef,
  });

  const before = await databaseIdentity(args.database);
  if (!before.database) throw new Error(`Database does not exist: ${args.database}`);
  const snapshot = readCurrentEntitySnapshot(args.database);
  const dryRun = runEngineeringImportDryRun(candidates, snapshot, prerequisites);
  const after = await databaseIdentity(args.database);
  assertDatabaseIdentityUnchanged(before, after);
  const fileStateUnchanged = true;

  const decisionPayload = {
    repositoryHead: currentHead(repoRoot),
    sourceCsvSha256: sha256(sourceCsv),
    mappingCsvSha256: sha256(mappingCsv),
    databaseSha256: before.database.sha256,
    dryRun,
  };
  const receipt = {
    issue: 'THE-853 / EE-B-05',
    generatedAt: args.generatedAt,
    repository: repoRoot,
    repositoryHead: decisionPayload.repositoryHead,
    prerequisiteSource: { ref: sourceRef, commit: sourceRefHead },
    serverBuildVerifiedDuringRun: { ref: sourceRef, commit: sourceRefHead },
    databaseIdentity: { before, after, fileStateUnchanged },
    dryRun,
    decisionDigestSha256: sha256(JSON.stringify(decisionPayload)),
    noWriteProof: {
      databaseOpenedReadOnly: snapshot.connection.readonly,
      queryOnlyEnabled: snapshot.connection.queryOnly,
      sqliteTotalChanges: snapshot.connection.totalChanges,
      databaseFilesUnchangedDuringRun: fileStateUnchanged,
      taskCreationAttempted: false,
      databaseMutationAttempted: false,
      createAnywayUsed: false,
    },
    nextBoundary: {
      issue: 'THE-854 / EE-B-06',
      status: 'blocked_pending_explicit_approval_and_backup_gate',
      importExecuted: false,
    },
  };
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  if (args.output) {
    writeReceiptAppendOnly(args.output, rendered);
  }
  process.stdout.write(rendered);
}

main().catch((error) => {
  process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
