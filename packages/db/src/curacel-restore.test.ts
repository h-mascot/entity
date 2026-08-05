/**
 * Colocated unit tests for the clean-target restore helper (R7).
 *
 * Pure filesystem logic: validation refusals, atomic/exclusive semantics, temp
 * partial cleanup, SHA-256 checksum metadata, and source immutability. No
 * database handles and no production access.
 */

import { createHash, randomUUID } from 'crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CleanTargetRestoreError,
  restoreCleanTarget,
  type RestoreHooks,
  type RestoreSourceStat,
} from './curacel-restore';

const workDirs: string[] = [];

function makeWorkDir(): string {
  const dir = path.join(os.tmpdir(), `curacel-restore-unit-${process.pid}-${randomUUID()}`);
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

function sha256OfBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function snapshotStat(filePath: string): RestoreSourceStat {
  const s = statSync(filePath);
  return { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino, dev: s.dev };
}

function leftoverPartials(dir: string): string[] {
  return readdirSync(dir).filter((name) => /\.curacel-restore\..*\.partial$/.test(name));
}

afterEach(() => {
  for (const dir of workDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  workDirs.length = 0;
});

describe('restoreCleanTarget — validation refusals', () => {
  it('refuses when target path equals source path (SAME_PATH)', () => {
    const dir = makeWorkDir();
    const file = path.join(dir, 'backup.sqlite');
    writeFile(file, Buffer.from('hello'));
    expect(() => restoreCleanTarget(file, file)).toThrow(CleanTargetRestoreError);
    expect(() => restoreCleanTarget(file, file)).toThrow(/SAME_PATH/);
    expect(leftoverPartials(dir)).toHaveLength(0);
  });

  it('refuses when the target already exists (TARGET_EXISTS) and leaves it untouched', () => {
    const dir = makeWorkDir();
    const source = path.join(dir, 'backup.sqlite');
    const target = path.join(dir, 'target.sqlite');
    writeFile(source, Buffer.from('source-bytes'));
    writeFile(target, Buffer.from('pre-existing-real-db'));

    const before = snapshotStat(target);
    expect(() => restoreCleanTarget(source, target)).toThrow(/TARGET_EXISTS/);
    // Existing target content/stat must be untouched.
    expect(readFileSync(target, 'utf8')).toBe('pre-existing-real-db');
    const after = snapshotStat(target);
    expect(after.size).toBe(before.size);
    expect(after.ino).toBe(before.ino);
    // No temp partial may be left behind.
    expect(leftoverPartials(dir)).toHaveLength(0);
  });

  it('refuses when the source backup does not exist (SOURCE_NOT_FOUND)', () => {
    const dir = makeWorkDir();
    const target = path.join(dir, 'target.sqlite');
    expect(() => restoreCleanTarget(path.join(dir, 'missing.sqlite'), target)).toThrow(
      /SOURCE_NOT_FOUND/,
    );
    expect(statSync(target, { throwIfNoEntry: false })).toBeUndefined();
  });

  it('refuses when the source is a directory, not a regular file (SOURCE_NOT_FILE)', () => {
    const dir = makeWorkDir();
    const sourceDir = path.join(dir, 'not-a-file');
    mkdirSync(sourceDir);
    const target = path.join(dir, 'target.sqlite');
    expect(() => restoreCleanTarget(sourceDir, target)).toThrow(/SOURCE_NOT_FILE/);
    expect(statSync(target, { throwIfNoEntry: false })).toBeUndefined();
  });
});

describe('restoreCleanTarget — exclusive publish (never overwrites a concurrent target)', () => {
  it('refuses TARGET_EXISTS and leaves a concurrent target byte-for-byte untouched when it appears after validation', () => {
    const dir = makeWorkDir();
    const source = path.join(dir, 'backup.sqlite');
    const target = path.join(dir, 'target.sqlite');
    writeFile(source, Buffer.from('backup-bytes'));

    // Deterministically reproduce the validation -> publish race by creating
    // the target INSIDE the beforePublish test seam, immediately before the
    // exclusive link. This is the exact window rename() would silently
    // overwrite; linkSync must reject it instead.
    const concurrentPayload = Buffer.from('concurrent-writer-bytes-must-survive');
    const concurrentHash = sha256OfBytes(concurrentPayload);
    const hooks: RestoreHooks = {
      beforePublish: ({ targetPath }) => {
        writeFile(targetPath, concurrentPayload);
      },
    };

    let err: unknown;
    try {
      restoreCleanTarget(source, target, hooks);
    } catch (e) {
      err = e;
    }

    // 1) Refused as TARGET_EXISTS.
    expect(err).toBeInstanceOf(CleanTargetRestoreError);
    expect((err as CleanTargetRestoreError).code).toBe('TARGET_EXISTS');
    expect(String((err as Error).message)).toMatch(/TARGET_EXISTS/);

    // 2) The concurrent target is byte-for-byte unchanged (NOT overwritten by
    //    our temp partial).
    expect(readFileSync(target)).toEqual(concurrentPayload);
    expect(sha256(target)).toBe(concurrentHash);

    // 3) No partial target was ever published at `target`, and no temp litter
    //    remains on disk.
    expect(leftoverPartials(dir)).toHaveLength(0);

    // 4) The backup is left untouched.
    expect(readFileSync(source, 'utf8')).toBe('backup-bytes');
  });

  it('still succeeds when the beforePublish seam does not create a target (happy path remains exclusive)', () => {
    const dir = makeWorkDir();
    const source = path.join(dir, 'backup.sqlite');
    const target = path.join(dir, 'target.sqlite');
    const payload = Buffer.from('backup-bytes');
    writeFile(source, payload);

    // A no-op seam proves the hook itself does not change the outcome when no
    // concurrent writer intervenes.
    const result = restoreCleanTarget(source, target, {
      beforePublish: () => {
        /* no concurrent writer */
      },
    });

    expect(readFileSync(target)).toEqual(payload);
    expect(result.targetSha256).toBe(sha256(source));
    expect(leftoverPartials(dir)).toHaveLength(0);
  });
});

describe('restoreCleanTarget — atomic copy + checksum metadata', () => {
  it('materializes a byte-identical copy of the source at a distinct, absent target', () => {
    const dir = makeWorkDir();
    const source = path.join(dir, 'backup.sqlite');
    const target = path.join(dir, 'target.sqlite');
    // A binary payload larger than one read chunk to exercise the streaming loop.
    const payload = Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 251));
    writeFile(source, payload);

    const result = restoreCleanTarget(source, target);

    // Three distinct resolved paths.
    expect(result.sourcePath).toBe(path.resolve(source));
    expect(result.targetPath).toBe(path.resolve(target));
    expect(result.sourcePath).not.toBe(result.targetPath);

    // Byte-identical content + checksums.
    expect(readFileSync(target)).toEqual(payload);
    expect(result.sourceBytes).toBe(payload.length);
    expect(result.targetBytes).toBe(payload.length);
    expect(result.sourceSha256).toBe(sha256(source));
    expect(result.targetSha256).toBe(sha256(target));
    expect(result.sourceSha256).toBe(result.targetSha256);
  });

  it('leaves the source backup byte-for-byte immutable (stat + content unchanged)', () => {
    const dir = makeWorkDir();
    const source = path.join(dir, 'backup.sqlite');
    const target = path.join(dir, 'target.sqlite');
    const payload = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    writeFile(source, payload);

    const before = snapshotStat(source);
    const beforeHash = sha256(source);
    const beforeContent = readFileSync(source);

    const result = restoreCleanTarget(source, target);

    // Content unchanged.
    expect(readFileSync(source)).toEqual(beforeContent);
    expect(sha256(source)).toBe(beforeHash);
    // Stat unchanged: same size, same inode, same mtime. (mtime is only updated
    // by writes to the file; a read-only open never bumps it.)
    expect(result.sourceStat.size).toBe(before.size);
    expect(result.sourceStat.ino).toBe(before.ino);
    expect(result.sourceStat.dev).toBe(before.dev);
    expect(result.sourceStat.mtimeMs).toBe(before.mtimeMs);
  });

  it('never exposes a partial target and cleans the temp partial on failure', () => {
    const dir = makeWorkDir();
    const source = path.join(dir, 'backup.sqlite');
    const target = path.join(dir, 'target.sqlite');
    writeFile(source, Buffer.from('payload'));
    // Force a TARGET_EXISTS refusal (the validation path runs before any copy).
    writeFile(target, Buffer.from('blocker'));

    expect(() => restoreCleanTarget(source, target)).toThrow(/TARGET_EXISTS/);

    // No partial target ever materialized at the real target path; no temp litter.
    expect(leftoverPartials(dir)).toHaveLength(0);
    // The blocker content is untouched (no overwrite attempt).
    expect(readFileSync(target, 'utf8')).toBe('blocker');
  });

  it('creates the target parent directory if it does not yet exist', () => {
    const dir = makeWorkDir();
    const source = path.join(dir, 'backup.sqlite');
    const nestedTarget = path.join(dir, 'nested', 'deeper', 'target.sqlite');
    writeFile(source, Buffer.from('payload'));

    const result = restoreCleanTarget(source, nestedTarget);

    expect(result.targetSha256).toBe(sha256(source));
    expect(readFileSync(nestedTarget, 'utf8')).toBe('payload');
  });
});
