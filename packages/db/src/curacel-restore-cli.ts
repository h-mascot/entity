#!/usr/bin/env node
/**
 * Curacel pilot — CLEAN-TARGET-RESTORE CLI (R7).
 *
 * Executable TypeScript entry point that wraps {@link restoreCleanTarget} so an
 * operator can materialize a verified SQLite backup into a DISTINCT, ABSENT
 * target file from the command line, with an immutable-backup proof.
 *
 * Execute (from the repository root) via the repo's ts-node toolchain:
 *
 *   npx ts-node --transpile-only --project packages/db/tsconfig.json \
 *     packages/db/src/curacel-restore-cli.ts <backup> <target>
 *
 * or, equivalently, with the package script (run from packages/db):
 *
 *   npm --prefix packages/db run restore:target -- <backup> <target>
 *
 * Output contract:
 *   - On success: a single JSON object (`{ ok: true, result: {...} }`) on stdout,
 *     exit code 0.
 *   - On a restore refusal/failure (`CleanTargetRestoreError`): a single JSON
 *     object (`{ ok: false, error: { code, message } }`) on stderr, exit code 2.
 *   - On a usage error (wrong number of arguments): a help message on stderr,
 *     exit code 64.
 *
 * The publication is EXCLUSIVE: it never overwrites a target that exists at the
 * moment of publish (including one created by a concurrent writer after
 * validation), and it never mutates the backup.
 */

import {
  CleanTargetRestoreError,
  restoreCleanTarget,
  type RestoreRejectCode,
  type RestoreResult,
} from './curacel-restore';

/** JSON emitted on stdout for a successful restore. */
export interface CliSuccessOutput {
  ok: true;
  result: {
    sourcePath: string;
    targetPath: string;
    sourceSha256: string;
    targetSha256: string;
    sourceBytes: number;
    targetBytes: number;
    sourceStat: { size: number; mtimeMs: number; ino: number; dev: number };
  };
}

/** JSON emitted on stderr for a refused/failed restore. */
export interface CliFailureOutput {
  ok: false;
  error: { code: RestoreRejectCode; message: string };
}

/** Structured outcome of a CLI invocation (used by tests and by `main`). */
export interface CliOutcome {
  exitCode: number;
  /** Exact text to write to stdout (undefined ⇒ write nothing). */
  stdout?: string;
  /** Exact text to write to stderr (undefined ⇒ write nothing). */
  stderr?: string;
}

/** CLI exit codes. */
export const CLI_EXIT = {
  OK: 0,
  /** A `CleanTargetRestoreError` refusal / I/O failure / checksum mismatch. */
  REFUSED: 2,
  /** Bad invocation (wrong argument count). */
  USAGE: 64,
} as const;

function usage(): string {
  return [
    'Usage: curacel-restore-target <backup> <target>',
    '',
    'Materializes the SQLite backup at <backup> into a DISTINCT, ABSENT <target>',
    'file using exclusive clean-target semantics: it never overwrites an existing',
    'target (including one a concurrent writer creates after validation) and never',
    'mutates the backup. Emits one JSON object and exits nonzero on any refusal.',
  ].join('\n');
}

/**
 * Pure, side-effect-free CLI core. Performs the restore against the real
 * filesystem paths and returns the exact process output + exit code, but does
 * NOT touch `process.stdout`/`process.stderr`/`process.exit` — making it
 * directly unit-testable. `main()` is the thin I/O wrapper.
 *
 * @param argv the positional CLI arguments (typically `process.argv.slice(2)`).
 */
export function runRestoreCli(argv: string[]): CliOutcome {
  const args = argv.slice();

  if (args.includes('-h') || args.includes('--help')) {
    return { exitCode: CLI_EXIT.OK, stderr: usage() };
  }

  if (args.length !== 2) {
    return {
      exitCode: CLI_EXIT.USAGE,
      stderr: `${usage()}\nError: expected exactly 2 arguments (<backup>, <target>), got ${args.length}.`,
    };
  }

  const [backup, target] = args;

  try {
    const r: RestoreResult = restoreCleanTarget(backup, target);
    const out: CliSuccessOutput = {
      ok: true,
      result: {
        sourcePath: r.sourcePath,
        targetPath: r.targetPath,
        sourceSha256: r.sourceSha256,
        targetSha256: r.targetSha256,
        sourceBytes: r.sourceBytes,
        targetBytes: r.targetBytes,
        sourceStat: r.sourceStat,
      },
    };
    return { exitCode: CLI_EXIT.OK, stdout: JSON.stringify(out, null, 2) };
  } catch (err) {
    const code: RestoreRejectCode =
      err instanceof CleanTargetRestoreError ? err.code : 'IO_ERROR';
    const message = err instanceof Error ? err.message : String(err);
    const out: CliFailureOutput = { ok: false, error: { code, message } };
    return { exitCode: CLI_EXIT.REFUSED, stderr: JSON.stringify(out, null, 2) };
  }
}

function main(): void {
  const outcome = runRestoreCli(process.argv.slice(2));
  if (outcome.stdout !== undefined) {
    process.stdout.write(`${outcome.stdout}\n`);
  }
  if (outcome.stderr !== undefined) {
    process.stderr.write(`${outcome.stderr}\n`);
  }
  process.exit(outcome.exitCode);
}

// Execute only when run directly as a script (e.g. via `ts-node`), never when
// imported by a test. The `typeof require` guard keeps this safe under ESM
// loaders (vitest) where `require` is undefined.
if (typeof require !== 'undefined' && require.main === module) {
  main();
}
