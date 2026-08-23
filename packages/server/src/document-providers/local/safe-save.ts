import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LocalRevision } from './file-watcher';

export type SaveStage = 'inspected' | 'candidate_written' | 'candidate_validated' | 'recovery_retained' | 'replaced' | 'reopened';
export type SaveAuthority = 'ready' | 'unknown' | 'degraded';

export interface SafeSaveRequest {
  targetPath: string;
  candidate: string | Buffer;
  expectedRevision: LocalRevision;
  currentRevision: () => Promise<LocalRevision>;
  validate: (content: Buffer) => Promise<void> | void;
  authority?: SaveAuthority;
  workspaceId: string;
  tenantId: string;
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

function siblingPath(target: string, suffix: string, workspaceId: string, tenantId: string): string {
  return `${target}.${suffix}.${tenantId}.${workspaceId}`;
}

function crash(request: SafeSaveRequest, stage: SaveStage): void {
  if (request.crashAt === stage) throw new SafeSaveError('crash', `injected save interruption at ${stage}`);
}

/**
 * Save coordinator for a server-resolved managed file. It never trusts a caller's
 * path as authority; callers must supply the already-authorized target and scope.
 */
export async function safeSave(request: SafeSaveRequest): Promise<SafeSaveResult> {
  assertScope(request.workspaceId, 'workspace');
  assertScope(request.tenantId, 'tenant');
  if ((request.authority ?? 'unknown') !== 'ready') throw new SafeSaveError('authority', 'local save authority is unavailable');
  const before = await request.currentRevision();
  if (before.token !== request.expectedRevision.token) throw new SafeSaveError('stale', 'local file revision is stale');
  crash(request, 'inspected');

  const content = Buffer.isBuffer(request.candidate) ? request.candidate : Buffer.from(request.candidate);
  const candidatePath = siblingPath(request.targetPath, 'candidate', request.workspaceId, request.tenantId);
  const recoveryPath = siblingPath(request.targetPath, 'recovery', request.workspaceId, request.tenantId);
  await mkdir(path.dirname(request.targetPath), { recursive: true });
  await writeFile(candidatePath, content, { flag: 'w' });
  crash(request, 'candidate_written');
  try { await request.validate(await readFile(candidatePath)); }
  catch { throw new SafeSaveError('validation', 'candidate validation failed'); }
  crash(request, 'candidate_validated');

  // Keep a complete previous artifact until the replacement is proven reopenable.
  await copyFile(request.targetPath, recoveryPath);
  crash(request, 'recovery_retained');
  await rename(candidatePath, request.targetPath);
  crash(request, 'replaced');
  let after: LocalRevision;
  try { after = await request.currentRevision(); }
  catch { throw new SafeSaveError('reopen', 'replacement could not be reopened'); }
  crash(request, 'reopened');
  return { revision: after, recoveryPath, candidatePath, atomicReplacement: true };
}
