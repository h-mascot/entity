/**
 * Curacel pilot — CLEAN-TARGET-RESTORE (R7).
 *
 * This is the file-level restore half of the pilot durability contract. The
 * live (WAL) service database is snapshotted with the better-sqlite3 online
 * `backup()` API (see `entity-db.ts`); that snapshot is a single, self-contained
 * SQLite file with no WAL sidecars. `restoreCleanTarget()` materializes that
 * snapshot into a DISTINCT, ABSENT target file using exclusive/atomic-safe
 * semantics, and returns SHA-256 checksum metadata so the caller can prove the
 * source backup was left byte-for-byte unchanged.
 *
 * Safety properties (operator runbook context, single writer):
 *  - Refuses to restore onto the source path (`SAME_PATH`).
 *  - Refuses to restore onto an existing target (`TARGET_EXISTS`) — never
 *    overwrites a real database.
 *  - Source must exist and be a regular file.
 *  - Bytes are streamed into a process-unique temp file created with
 *    `O_CREAT | O_EXCL` (no reuse of a stale partial of the same name), then
 *    `fsync`-ed, then EXCLUSIVELY hard-linked onto the target (`linkSync`),
 *    which fails with `EEXIST` if a concurrent writer created the target after
 *    our validation. A partially written target is therefore NEVER visible at
 *    `targetPath`, and a target created after validation is NEVER overwritten.
 *  - On ANY failure (validation, I/O, post-publish checksum mismatch, or an
 *    `EEXIST` from a concurrent publisher) the temp partial is removed, so no
 *    `.curacel-restore.*.partial` litter is left.
 *  - The source file is only ever opened read-only; it is never written,
 *    truncated, or appended. The returned `sourceStat` is captured AFTER the
 *    copy so callers can assert mtime/size/inode immutability.
 *
 * This module performs pure filesystem operations; it has no database handles,
 * no module-level caches, and no environment dependencies. It is safe to import
 * once at the top of a test file.
 */

import { createHash, randomUUID } from 'crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  unlinkSync,
  writeSync,
  type Stats,
} from 'fs';
import path from 'path';

/** Reason codes for a refused/failed restore. */
export type RestoreRejectCode =
  | 'SAME_PATH'
  | 'TARGET_EXISTS'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_NOT_FILE'
  | 'SOURCE_EQUAL_TARGET'
  | 'IO_ERROR'
  | 'CHECKSUM_MISMATCH';

/** Stat snapshot used to prove the source backup was not mutated by the restore. */
export interface RestoreSourceStat {
  size: number;
  mtimeMs: number;
  ino: number;
  dev: number;
}

/** Result returned by a successful restore. */
export interface RestoreResult {
  sourcePath: string;
  targetPath: string;
  /** SHA-256 of the source backup, computed while streaming it into the target. */
  sourceSha256: string;
  /** SHA-256 of the committed target file, computed by re-reading it. */
  targetSha256: string;
  /** Source byte count (from the source stat captured before the copy). */
  sourceBytes: number;
  /** Target byte count (from the target stat captured after the exclusive publish). */
  targetBytes: number;
  /** Source stat captured AFTER the copy; caller asserts it equals the pre-restore snapshot. */
  sourceStat: RestoreSourceStat;
}

/** Context handed to {@link RestoreHooks.beforePublish} immediately before the exclusive publish. */
export interface RestorePublishContext {
  sourcePath: string;
  targetPath: string;
  tempPath: string;
}

/**
 * Optional hooks for {@link restoreCleanTarget}. `beforePublish` is a
 * deterministic TEST SEAM ONLY: it fires after the temp has been fsync'd and
 * closed but BEFORE the exclusive publish, so a test can simulate a concurrent
 * writer materializing the target between validation and publication. It must
 * be left `undefined` in production; production publication is unconditional.
 */
export interface RestoreHooks {
  beforePublish?: (context: RestorePublishContext) => void;
}

export class CleanTargetRestoreError extends Error {
  readonly code: RestoreRejectCode;
  readonly cause?: unknown;
  constructor(code: RestoreRejectCode, message: string, cause?: unknown) {
    super(`${code}: ${message}`);
    this.name = 'CleanTargetRestoreError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

const CHUNK_SIZE = 64 * 1024;

function sha256OfFile(filePath: string): { sha256: string; bytes: number } {
  const hash = createHash('sha256');
  let bytes = 0;
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(CHUNK_SIZE);
    let read: number;
    while ((read = readSync(fd, buf, 0, CHUNK_SIZE, null)) > 0) {
      hash.update(buf.subarray(0, read));
      bytes += read;
    }
    return { sha256: hash.digest('hex'), bytes };
  } finally {
    closeSync(fd);
  }
}

function toSourceStat(stats: Stats): RestoreSourceStat {
  return { size: stats.size, mtimeMs: stats.mtimeMs, ino: stats.ino, dev: stats.dev };
}

function sameInode(a: Stats, b: Stats): boolean {
  return a.ino !== 0 && a.ino === b.ino && a.dev === b.dev;
}

/**
 * Restore (materialize) the SQLite backup at `sourcePath` into the DISTINCT,
 * ABSENT file at `targetPath`.
 *
 * Publication is EXCLUSIVE: the temp is hard-linked onto the target with
 * `linkSync`, which atomically creates the target directory entry and fails
 * with `EEXIST` if a concurrent writer created the target after validation —
 * it can never overwrite such a target.
 *
 * @param hooks optional test seam (`beforePublish`); leave undefined in production.
 * @throws {CleanTargetRestoreError} on any validation failure or I/O error.
 */
export function restoreCleanTarget(
  sourcePath: string,
  targetPath: string,
  hooks?: RestoreHooks,
): RestoreResult {
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);

  // --- Validation -----------------------------------------------------------
  if (source === target) {
    throw new CleanTargetRestoreError(
      'SAME_PATH',
      `target must be a distinct file (got target == source == ${source})`,
    );
  }

  let sourceStatBefore: Stats;
  try {
    sourceStatBefore = statSync(source);
  } catch {
    throw new CleanTargetRestoreError('SOURCE_NOT_FOUND', `backup file not found: ${source}`);
  }
  if (!sourceStatBefore.isFile()) {
    throw new CleanTargetRestoreError(
      'SOURCE_NOT_FILE',
      `backup is not a regular file: ${source}`,
    );
  }

  // Clean target: the target must NOT already exist. We never overwrite a real
  // database. existsSync() follows symlinks, so a symlink pointing at the
  // source (or anywhere) counts as "exists" and is refused.
  if (existsSync(target)) {
    // Guard against target being a distinct path that resolves to the SAME file
    // as the source (e.g. a hardlink/bind-mount). Both are refused.
    try {
      const targetStat = statSync(target);
      if (sameInode(sourceStatBefore, targetStat)) {
        throw new CleanTargetRestoreError(
          'SOURCE_EQUAL_TARGET',
          `target resolves to the same inode as the source backup: ${target}`,
        );
      }
    } catch (err) {
      if (err instanceof CleanTargetRestoreError) {
        throw err;
      }
      // ENOENT between existsSync and statSync is a benign race; treat as clean.
    }
    throw new CleanTargetRestoreError(
      'TARGET_EXISTS',
      `target already exists (refusing overwrite): ${target}`,
    );
  }

  // --- Pre-copy source fingerprint -----------------------------------------
  // Hashing the source up front lets us detect any mid-copy mutation of the
  // backup and gives a stable reference for the immutable-backup assertion.
  const sourceFingerprint = sha256OfFile(source);
  const sourceBytes = sourceStatBefore.size;

  // --- Ensure the target parent directory exists ---------------------------
  mkdirSync(path.dirname(target), { recursive: true });

  // --- Exclusive temp + exclusive publish ----------------------------------
  // Temp lives next to the target (same directory and therefore same
  // filesystem) so the later hard-link publish is possible (hard links cannot
  // cross filesystems). The name embeds pid + uuid so it cannot collide with a
  // stale partial from a previous (crashed) run, and O_CREAT|O_EXCL ("wx")
  // makes the creation itself exclusive.
  const tmpPath = `${target}.curacel-restore.${process.pid}.${randomUUID()}.partial`;
  let tempFd: number | null = null;
  let committed = false;
  try {
    tempFd = openSync(tmpPath, 'wx', 0o600);

    // Stream source -> temp while hashing both sides of the transfer. The
    // streamed source hash must equal the pre-copy fingerprint; if it does
    // not, the backup changed mid-copy and the result would be untrustworthy.
    const transferHash = createHash('sha256');
    const sourceFd = openSync(source, 'r');
    let streamedSourceHash = '';
    let streamedBytes = 0;
    try {
      const buf = Buffer.allocUnsafe(CHUNK_SIZE);
      let read: number;
      while ((read = readSync(sourceFd, buf, 0, CHUNK_SIZE, null)) > 0) {
        transferHash.update(buf.subarray(0, read));
        streamedBytes += read;
        writeSync(tempFd, buf, 0, read);
      }
      streamedSourceHash = transferHash.digest('hex');
    } finally {
      closeSync(sourceFd);
    }

    if (streamedSourceHash !== sourceFingerprint.sha256 || streamedBytes !== sourceBytes) {
      throw new CleanTargetRestoreError(
        'IO_ERROR',
        `source backup changed during copy (size/hash drift); refusing to commit a corrupt target`,
      );
    }

    fsyncSync(tempFd);
    closeSync(tempFd);
    tempFd = null;

    // Test seam ONLY: lets a unit test deterministically simulate a concurrent
    // writer materializing the target between validation and the exclusive
    // publish. Undefined in production.
    hooks?.beforePublish?.({ sourcePath: source, targetPath: target, tempPath: tmpPath });

    // --- Exclusive atomic publish via hard link ----------------------------
    // linkSync creates a NEW directory entry at `target` pointing at the temp
    // file's inode. Unlike rename(), it FAILS with EEXIST if `target` already
    // exists — so it can never overwrite a target that a concurrent writer
    // created after our validation. (The temp is co-located with the target, so
    // both names are on the same filesystem, which is exactly what hard links
    // require.)
    try {
      linkSync(tmpPath, target);
    } catch (err) {
      const errno = (err as NodeJS.ErrnoException | undefined)?.code;
      if (errno === 'EEXIST') {
        // A concurrent target appeared after validation. Leave it completely
        // untouched; the finally block unlinks our temp partial.
        throw new CleanTargetRestoreError(
          'TARGET_EXISTS',
          `target already exists (created after validation; refusing overwrite): ${target}`,
        );
      }
      throw new CleanTargetRestoreError(
        'IO_ERROR',
        `exclusive publish (link) failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    committed = true;

    // Best-effort durable commit of the new target directory entry.
    let dirFd: number | null = null;
    try {
      dirFd = openSync(path.dirname(target), 'r');
      fsyncSync(dirFd);
    } catch {
      // Directory fsync is best-effort; some platforms/permission sets reject it.
    } finally {
      if (dirFd !== null) {
        try {
          closeSync(dirFd);
        } catch {
          /* ignore */
        }
      }
    }

    // The temp and the target now name the SAME inode via two hard links. Drop
    // the redundant temp link so only the target entry remains. This unlink
    // cannot corrupt the published bytes; on failure it would only leave
    // harmless litter under the temp name (handled as best-effort).
    try {
      unlinkSync(tmpPath);
    } catch {
      /* best-effort; target already exclusively published */
    }
  } catch (err) {
    if (err instanceof CleanTargetRestoreError) {
      throw err;
    }
    throw new CleanTargetRestoreError(
      'IO_ERROR',
      `restore failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  } finally {
    if (tempFd !== null) {
      try {
        closeSync(tempFd);
      } catch {
        /* ignore */
      }
    }
    // Clean temp partials on every non-committed exit (validation failure,
    // mid-copy error, post-publish checksum mismatch, or an EEXIST refusal
    // from a concurrent publisher). On success the temp link was already
    // unlinked above, so this is a no-op.
    if (!committed && existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }

  // --- Post-commit verification --------------------------------------------
  // Re-read the committed target and prove it is byte-identical to the source.
  const targetFingerprint = sha256OfFile(target);
  if (targetFingerprint.sha256 !== sourceFingerprint.sha256) {
    // Do not leave a corrupt database behind.
    try {
      unlinkSync(target);
    } catch {
      /* ignore */
    }
    throw new CleanTargetRestoreError(
      'CHECKSUM_MISMATCH',
      `committed target checksum ${targetFingerprint.sha256} != source ${sourceFingerprint.sha256}; corrupt target removed`,
    );
  }

  const targetStat = statSync(target);
  const sourceStatAfter = statSync(source);

  return {
    sourcePath: source,
    targetPath: target,
    sourceSha256: sourceFingerprint.sha256,
    targetSha256: targetFingerprint.sha256,
    sourceBytes,
    targetBytes: targetStat.size,
    sourceStat: toSourceStat(sourceStatAfter),
  };
}
