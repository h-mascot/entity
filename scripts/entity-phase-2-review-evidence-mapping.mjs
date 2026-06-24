#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dbModulePath = path.join(repoRoot, 'packages', 'db', 'dist', 'index.js');

function usage() {
  console.error('Usage: node scripts/entity-phase-2-review-evidence-mapping.mjs [--apply] [--json] [--out <path>] [--limit <n>] [--fixture-sample]');
}

function parseArgs(argv) {
  const args = { apply: false, json: false, out: null, limit: undefined, fixtureSample: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--fixture-sample') {
      args.fixtureSample = true;
    } else if (arg === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else if (arg === '--limit') {
      const rawLimit = Number(argv[index + 1]);
      if (!Number.isInteger(rawLimit) || rawLimit <= 0) {
        throw new Error('--limit must be a positive integer');
      }
      args.limit = rawLimit;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function removeTempDb(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(`${dbPath}${suffix}`);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && args.fixtureSample) {
    throw new Error('--apply cannot be combined with --fixture-sample');
  }
  if (!fs.existsSync(dbModulePath)) {
    throw new Error('Missing packages/db/dist/index.js. Run `npm --prefix packages/db run build` or `npm run build` first.');
  }

  const fixtureDbPath = args.fixtureSample
    ? path.join(os.tmpdir(), `entity-the-88-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    : null;
  if (fixtureDbPath) {
    process.env.ENTITY_TASK_DB_PATH = fixtureDbPath;
    process.env.MISSION_CONTROL_DB_PATH = '/tmp/nonexistent-mc.db';
  }

  const db = await import(pathToFileURL(dbModulePath).href);
  try {
    if (fixtureDbPath) {
      const taskRepo = db.createTaskRepository();
      const task = taskRepo.createTask({
        name: 'THE-88 missing_receipt fixture',
        column: 'done',
        output: '/documents/native/the-88-output.md',
        metadata: JSON.stringify({
          review_packet: {
            output_artifact: '/artifacts/evidence/the-88-output-proof.md',
            evidence: [
              'evidence_artifact:the-88-review-proof',
              'loose-proof.txt',
            ],
            done_criteria: ['Fixture demonstrates missing_receipt without fake raw receipt'],
          },
        }),
      });
      const rawDb = new Database(fixtureDbPath);
      try {
        rawDb.prepare(`
          INSERT INTO activities (
            source,
            type,
            task_id,
            activity_event_type,
            activity_event_payload_json,
            activity_event_schema_status,
            action,
            description,
            metadata
          ) VALUES ('agent', 'vendor_ping', ?, NULL, '{bad-json', 'legacy_mapped', 'Vendor ping', 'Weak fixture activity', NULL)
        `).run(task.id);
      } finally {
        rawDb.close();
      }
    }

    const report = db.mapReviewPacketsAndEvidenceForPhase2({
      dryRun: !args.apply,
      limit: args.limit,
    });
    const output = args.json ? `${JSON.stringify(report, null, 2)}\n` : report.markdown;

    if (args.out) {
      const outPath = path.isAbsolute(args.out) ? args.out : path.resolve(repoRoot, args.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, output);
    }

    process.stdout.write(output);
  } finally {
    if (fixtureDbPath) {
      removeTempDb(fixtureDbPath);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(1);
});
