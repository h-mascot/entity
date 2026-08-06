/**
 * Colocated tests for the clean-target restore CLI (R7).
 *
 * Two layers of proof:
 *  1. The pure core (`runRestoreCli`) is unit-tested directly for success,
 *     refusal, and usage paths — fast and deterministic.
 *  2. The CLI is invoked as a REAL subprocess through the repo's ts-node
 *     toolchain (the exact command documented in the runbook) to prove it is
 *     actually executable end-to-end for both a successful restore and a
 *     TARGET_EXISTS refusal.
 */

import { createHash, randomUUID } from 'crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'fs';
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { CLI_EXIT, runRestoreCli } from './curacel-restore-cli';

/**
 * Locate the @entity/db package directory by walking up from the current
 * working directory (this test is invoked as `cd packages/db && npx vitest`).
 * This deliberately avoids `import.meta`/`__dirname`: those are disallowed by
 * the `module: commonjs` tsconfig under which the server build also compiles
 * `packages/db/src`, and `__dirname` is not defined in vitest's ESM runtime.
 */
function findPackageDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (
      existsSync(path.join(dir, 'package.json')) &&
      existsSync(path.join(dir, 'src', 'curacel-restore-cli.ts'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const PKG_DIR = findPackageDir();
const cliPath = path.join(PKG_DIR, 'src', 'curacel-restore-cli.ts');
const dbTsconfig = path.join(PKG_DIR, 'tsconfig.json');
// ts-node is hoisted to the workspace root (two levels above packages/db).
const REPO_ROOT = path.resolve(PKG_DIR, '..', '..');
const tsNodeBin = path.join(REPO_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');

const workDirs: string[] = [];

function makeWorkDir(): string {
  const dir = path.join(os.tmpdir(), `curacel-restore-cli-${process.pid}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  workDirs.push(dir);
  return dir;
}

function writeFile(filePath: string, contents: Buffer): void {
  const fd = openSync(filePath, 'wx', 0o600);
  try {
    writeSync(fd, contents, 0, contents.length);
  } finally {
    closeSync(fd);
  }
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

afterEach(() => {
  for (const dir of workDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  workDirs.length = 0;
});

/** Invoke the CLI as a real subprocess via the repo's ts-node toolchain. */
function runCliSubprocess(backup: string, target: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(
    process.execPath,
    [tsNodeBin, '--transpile-only', '--project', dbTsconfig, cliPath, backup, target],
    { encoding: 'utf8' },
  );
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('runRestoreCli — pure core', () => {
  it('emits success JSON (ok:true) on stdout and exits 0 for a clean restore', () => {
    const dir = makeWorkDir();
    const backup = path.join(dir, 'backup.sqlite');
    const target = path.join(dir, 'target.sqlite');
    const payload = Buffer.from('backup-snapshot-bytes');
    writeFile(backup, payload);

    const outcome = runRestoreCli([backup, target]);

    expect(outcome.exitCode).toBe(CLI_EXIT.OK);
    expect(outcome.stdout).toBeDefined();
    expect(outcome.stderr).toBeUndefined();

    const parsed = JSON.parse(outcome.stdout!) as {
      ok: true;
      result: { sourceSha256: string; targetSha256: string; sourceBytes: number; targetBytes: number };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.result.sourceBytes).toBe(payload.length);
    expect(parsed.result.targetBytes).toBe(payload.length);
    expect(parsed.result.sourceSha256).toBe(parsed.result.targetSha256);
    expect(parsed.result.sourceSha256).toBe(sha256(backup));

    // The target really was materialized byte-identical to the backup.
    expect(readFileSync(target)).toEqual(payload);
  });

  it('emits failure JSON (ok:false, code:TARGET_EXISTS) on stderr and exits nonzero when the target exists', () => {
    const dir = makeWorkDir();
    const backup = path.join(dir, 'backup.sqlite');
    const target = path.join(dir, 'target.sqlite');
    writeFile(backup, Buffer.from('backup-bytes'));
    writeFile(target, Buffer.from('pre-existing-real-db'));

    const outcome = runRestoreCli([backup, target]);

    expect(outcome.exitCode).toBe(CLI_EXIT.REFUSED);
    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.stderr).toBeDefined();
    expect(outcome.stdout).toBeUndefined();

    const parsed = JSON.parse(outcome.stderr!) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('TARGET_EXISTS');

    // Existing target untouched.
    expect(readFileSync(target, 'utf8')).toBe('pre-existing-real-db');
  });

  it('exits with the usage code and writes help when the argument count is wrong', () => {
    const outcome0 = runRestoreCli([]);
    expect(outcome0.exitCode).toBe(CLI_EXIT.USAGE);
    expect(outcome0.stderr).toMatch(/Usage:/);
    expect(outcome0.stdout).toBeUndefined();

    const outcome3 = runRestoreCli(['a', 'b', 'c']);
    expect(outcome3.exitCode).toBe(CLI_EXIT.USAGE);
    expect(outcome3.stderr).toMatch(/got 3/);
  });

  it('exits 0 and prints help for --help / -h', () => {
    const outcome = runRestoreCli(['--help']);
    expect(outcome.exitCode).toBe(CLI_EXIT.OK);
    expect(outcome.stderr).toMatch(/Usage:/);

    const h = runRestoreCli(['-h']);
    expect(h.exitCode).toBe(CLI_EXIT.OK);
  });
});

describe('curacel-restore-cli — actually executable via ts-node (subprocess)', () => {
  it('succeeds end-to-end: exit 0, success JSON on stdout, byte-identical target, immutable backup', () => {
    const dir = makeWorkDir();
    const backup = path.join(dir, 'backup.sqlite');
    const target = path.join(dir, 'target.sqlite');
    const payload = Buffer.from('executable-ts-cli-backup-bytes');
    writeFile(backup, payload);
    const backupHashBefore = sha256(backup);

    const result = runCliSubprocess(backup, target);

    expect(result.status).toBe(0);
    // The npm/ts-node banner never pollutes stdout: the ONLY stdout payload is
    // the success JSON object.
    const parsed = JSON.parse(result.stdout) as {
      ok: true;
      result: { sourceSha256: string; targetSha256: string };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.result.sourceSha256).toBe(parsed.result.targetSha256);

    // Target materialized; backup immutable.
    expect(readFileSync(target)).toEqual(payload);
    expect(sha256(backup)).toBe(backupHashBefore);
  });

  it('refuses end-to-end: nonzero exit, TARGET_EXISTS JSON on stderr, existing target untouched', () => {
    const dir = makeWorkDir();
    const backup = path.join(dir, 'backup.sqlite');
    const target = path.join(dir, 'target.sqlite');
    writeFile(backup, Buffer.from('backup-bytes'));
    writeFile(target, Buffer.from('pre-existing-real-db'));

    const result = runCliSubprocess(backup, target);

    expect(result.status).not.toBe(0);
    expect(result.status).toBe(CLI_EXIT.REFUSED);

    // The refusal JSON object is present on stderr.
    const jsonMatch = result.stderr.match(/\{[\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![0]) as {
      ok: false;
      error: { code: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('TARGET_EXISTS');

    // The real target is byte-for-byte untouched.
    expect(readFileSync(target, 'utf8')).toBe('pre-existing-real-db');
  });
});
