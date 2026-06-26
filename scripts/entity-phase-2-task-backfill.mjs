#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dbModulePath = path.join(repoRoot, 'packages', 'db', 'dist', 'index.js');

function usage() {
  console.error('Usage: node scripts/entity-phase-2-task-backfill.mjs [--apply] [--json] [--out <path>] [--limit <n>]');
}

function parseArgs(argv) {
  const args = { apply: false, json: false, out: null, limit: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--json') {
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
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(dbModulePath)) {
    throw new Error('Missing packages/db/dist/index.js. Run `npm --prefix packages/db run build` or `npm run build` first.');
  }

  const db = await import(pathToFileURL(dbModulePath).href);
  const report = db.backfillTaskHierarchyAndAccountability({
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(1);
});
