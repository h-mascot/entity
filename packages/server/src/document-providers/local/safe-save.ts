import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LocalRevision } from './file-watcher';

export type SaveStage = 'inspected' | 'candidate_written' | 'candidate_validated' | 'recovery_retained' | 'replaced' | 'reopened';
export type SaveAuthority = 'ready' | 'unknown' | 'degraded';

export interface ManagedSaveTarget {
  /** Canonical path resolved by the server from an Entity-managed file reference. */
  canonicalPath: string;
  /** The approved root and owning scope captured during reference resolution. */
  approvedRoot: string;
  workspaceId: string;
  tenantId: string;
}

export interface SafeSaveRequest {
  target: ManagedSaveTarget;
  candidate: string | Buffer;
  expectedRevision: LocalRevision;
  currentRevision: () => Promise<LocalRevision>;
  validate: (content: Buffer) => Promise<void> | void;
  authority?: SaveAuthority;
  crashAt?: SaveStage;
}

export interface SafeSaveResult {
  revision: LocalRevision;
  recoveryPath: string;
  candidatePath: string;
  atomicReplacement: boolean;
}

export class SafeSaveError extends Error {
  constructor(public readonly code: 'stale' | 'authority' | 'validation' | 'crash' | 'scope' | 'reopen', message: string) {
    super(message);
    this.name = 'SafeSaveError';
  }
}

function assertScope(value: string, field: string): void {
  if (!value || value.length > 256 || value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    throw new SafeSaveError('scope', `invalid ${field}`);
  }
}

function assertManagedTarget(target: ManagedSaveTarget): void {
  assertScope(target.workspaceId, 'workspace');
  assertScope(target.tenantId, 'tenant');
  const targetPath = path.resolve(target.canonicalPath);
  const rootPath = path.resolve(target.approvedRoot);
  const relative = path.relative(rootPath, targetPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new SafeSaveError('scope', 'managed target is outside its approved scope');
  }
  if (targetPath !== target.canonicalPath || rootPath !== target.approvedRoot) {
    throw new SafeSaveError('scope', 'managed target is not canonical');
  }
}

function siblingPath(target: ManagedSaveTarget, suffix: string): string {
  return `${target.canonicalPath}.${suffix}.${target.tenantId}.${target.workspaceId}`;
}

function crash(request: SafeSaveRequest, stage: SaveStage): void {
  if (request.crashAt === stage) throw new SafeSaveError('crash', `injected save interruption at ${stage}`);
}

/**
 * Save coordinator for a server-resolved managed file. It never trusts a caller's
 * path as authority; callers must supply the already-authorized target and scope.
 */
const saveLocks = new Map<string, Promise<void>>();

async function safeSaveUnlocked(request: SafeSaveRequest): Promise<SafeSaveResult> {
  assertManagedTarget(request.target);
  if ((request.authority ?? 'unknown') !== 'ready') throw new SafeSaveError('authority', 'local save authority is unavailable');
  const targetPath = request.target.canonicalPath;
  const before = await request.currentRevision();
  if (before.token !== request.expectedRevision.token) throw new SafeSaveError('stale', 'local file revision is stale');
  crash(request, 'inspected');

  const content = Buffer.isBuffer(request.candidate) ? request.candidate : Buffer.from(request.candidate);
  const candidatePath = siblingPath(request.target, 'candidate');
  const recoveryPath = siblingPath(request.target, 'recovery');
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(candidatePath, content, { flag: 'w' });
  crash(request, 'candidate_written');
  try { await request.validate(await readFile(candidatePath)); }
  catch { throw new SafeSaveError('validation', 'candidate validation failed'); }
  crash(request, 'candidate_validated');

  // Keep a complete previous artifact until the replacement is proven reopenable.
  await copyFile(targetPath, recoveryPath);
  crash(request, 'recovery_retained');

  // Recheck immediately before rename. This is the final compare-and-swap guard;
  // callers must serialize the short check/rename window with their managed-file lock.
  const finalRevision = await request.currentRevision();
  if (finalRevision.token !== request.expectedRevision.token) {
    throw new SafeSaveError('stale', 'local file revision changed during save');
  }
  await rename(candidatePath, targetPath);
  crash(request, 'replaced');
  let after: LocalRevision;
  try { after = await request.currentRevision(); }
  catch { throw new SafeSaveError('reopen', 'replacement could not be reopened'); }
  crash(request, 'reopened');
  return { revision: after, recoveryPath, candidatePath, atomicReplacement: true };
}

/** Serialize the final compare-and-swap and replacement for each managed target. */
export async function safeSave(request: SafeSaveRequest): Promise<SafeSaveResult> {
  const key = typeof request.target?.canonicalPath === 'string' ? request.target.canonicalPath : '<invalid-target>';
  const previous = saveLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  saveLocks.set(key, current);
  await previous;
  try {
    return await safeSaveUnlocked(request);
  } catch (error) {
    if (error instanceof SafeSaveError) throw error;
    throw new SafeSaveError('reopen', 'local save could not be completed');
  } finally {
    release();
    if (saveLocks.get(key) === current) saveLocks.delete(key);
  }
}
