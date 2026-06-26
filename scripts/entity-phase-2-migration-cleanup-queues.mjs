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
  console.error('Usage: node scripts/entity-phase-2-migration-cleanup-queues.mjs [--json] [--out <path>] [--limit <n>] [--include-corrected] [--fixture-sample]');
}

function parseArgs(argv) {
  const args = { json: false, out: null, limit: undefined, includeCorrected: false, fixtureSample: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      args.json = true;
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
    } else if (arg === '--include-corrected') {
      args.includeCorrected = true;
    } else if (arg === '--fixture-sample') {
      args.fixtureSample = true;
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
  if (!fs.existsSync(dbModulePath)) {
    throw new Error('Missing packages/db/dist/index.js. Run `npm --prefix packages/db run build` or `npm run build` first.');
  }

  const fixtureDbPath = args.fixtureSample
    ? path.join(os.tmpdir(), `entity-the-89-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
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
        name: 'THE-89 cleanup queue fixture',
        column: 'done',
        assignee: 'Unassigned',
        owner_principal_id: 'legacy-owner',
        initiator_principal_id: 'legacy-unknown',
        worktype: 'legacy_ops',
        metadata: JSON.stringify({
          phase2_review_evidence_mapping: {
            version: 'THE-88',
            warnings: [
              {
                code: 'missing_receipt',
                message: 'Fixture completed task has no raw receipt; no fake receipt is created.',
                severity: 'blocking_for_done',
                source: 'evidence_artifacts.raw_task_receipt',
              },
              {
                code: 'missing_evidence',
                message: 'Fixture review packet has no evidence array.',
                severity: 'warning',
                source: 'metadata.review_packet.evidence',
              },
            ],
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

    const report = db.buildMigrationCleanupQueuesForPhase2({
      limit: args.limit,
      includeCorrected: args.includeCorrected,
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
