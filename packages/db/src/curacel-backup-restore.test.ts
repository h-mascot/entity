/**
 * Curacel pilot — operational restore proof into a CLEAN target (R7).
 *
 * This closes the R7 "distinct clean-target restore with immutable backup
 * proof" residual. The prior B7 proof only re-pointed the service at the backup
 * file (a backup-only "restore"). This suite proves a REAL operational recovery:
 *
 *   SOURCE service DB (populated, WAL)
 *     -> better-sqlite3 online backup() -> BACKUP snapshot file
 *       -> restoreCleanTarget(BACKUP -> TARGET)   [distinct, absent target]
 *         -> initialize CURRENT app repositories against TARGET (additive schema)
 *           -> verify every pilot object through the app layer
 *             -> SAFE post-restore mutation on TARGET
 *               -> BACKUP file is proven byte-for-byte IMMUTABLE (stat + SHA-256)
 *
 * SOURCE != BACKUP != TARGET (three distinct files). The BACKUP is only ever
 * read; the service is never pointed at it, so it cannot be mutated. Throwaway
 * temp DBs only; no production access.
 */

import { createHash, randomUUID } from 'crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreCleanTarget, type RestoreSourceStat } from './curacel-restore';

const cleanupPaths: string[] = [];

function tempPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

function removeSqliteFiles(dbPath: string): void {
  // recursive: true so a directory scratch path (used by the refusal tests) is
  // also removed; harmless for regular files and -wal/-shm sidecars.
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    rmSync(file, { force: true, recursive: true });
  }
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function snapshotStat(filePath: string): RestoreSourceStat {
  const s = statSync(filePath);
  return { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino, dev: s.dev };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const p of cleanupPaths) removeSqliteFiles(p);
  cleanupPaths.length = 0;
});

async function loadDbModule(dbPath: string): Promise<typeof import('./index')> {
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', tempPath('missing-mc'));
  return import('./index');
}

describe('Curacel pilot — operational restore into a CLEAN target (R7)', () => {
  it('restores the backup into a DISTINCT target, initializes repos, mutates the target, and leaves the backup immutable', async () => {
    // ---- Phase 1: populate the live SOURCE service database. ----
    const sourcePath = tempPath('curacel-restore-source');
    cleanupPaths.push(sourcePath);
    const db = await loadDbModule(sourcePath);
    const { getEntityDatabase } = await import('./entity-db');

    const workspace = db.createWorkspaceScopeRepository();
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    workspace.createTeam({ orgId: 'org-acme' }, { id: 'team-claims', name: 'Claims' });
    const project = workspace.createProject(
      { orgId: 'org-acme', teamId: 'team-claims' },
      { name: 'Claims Control Room' },
    );

    const tasks = db.createOrgScopedTaskRepository({ orgId: 'org-acme', teamId: 'team-claims' });
    const settledTask = tasks.createTask({
      name: 'Settle CL-0001',
      project_id: project.id,
      assignee: 'agent-1',
    });
    const backlogTask = tasks.createTask({
      name: 'Auto CL-0002',
      project_id: project.id,
      taskmaster_drivable: true,
      assignee: 'unassigned',
    });
    tasks.claimTaskForTaskMaster(backlogTask.id, {
      taskmaster_principal_id: 'tm-1',
      claim_request_id: 'r1',
    });

    const handoffRepo = db.createTaskHandoffRepository();
    handoffRepo.create({
      sourceTaskId: settledTask.id,
      targetTaskId: backlogTask.id,
      targetAgentId: 'agent-2',
      actorPrincipalId: 'operator-1',
    });

    const evidence = db.createEvidenceArtifactRepository();
    const artifact = evidence.createArtifact({
      org_id: 'org-acme',
      origin_task_id: settledTask.id,
      artifact_kind: 'review_packet',
      mutability_policy: 'editable_versioned',
      title: 'Proof',
      stable_path: 'output/proof.md',
      content_hash: 'sha256:h',
    });
    evidence.linkArtifactObject(artifact.id, {
      object_type: 'pull_request',
      object_id: '42',
      link_role: 'proof',
    });

    // ---- Phase 2: canonical online backup of the live (WAL) SOURCE db. ----
    const backupPath = tempPath('curacel-restore-backup');
    cleanupPaths.push(backupPath);
    await getEntityDatabase().backup(backupPath);
    expect(statSync(backupPath, { throwIfNoEntry: false })?.isFile()).toBe(true);

    // Immutable-backup baseline: snapshot SHA-256 + stat immediately after backup.
    const backupHashBefore = sha256(backupPath);
    const backupStatBefore = snapshotStat(backupPath);

    // ---- Phase 3: RESTORE the backup into a DISTINCT, ABSENT TARGET file. ----
    const targetPath = tempPath('curacel-restore-target');
    cleanupPaths.push(targetPath);
    // Three distinct resolved paths: SOURCE != BACKUP != TARGET.
    expect(path.resolve(sourcePath)).not.toBe(path.resolve(backupPath));
    expect(path.resolve(backupPath)).not.toBe(path.resolve(targetPath));
    expect(path.resolve(sourcePath)).not.toBe(path.resolve(targetPath));
    expect(statSync(targetPath, { throwIfNoEntry: false })).toBeUndefined();

    const restoreResult = restoreCleanTarget(backupPath, targetPath);

    // The restore is a byte-identical materialization of the backup.
    expect(restoreResult.sourcePath).toBe(path.resolve(backupPath));
    expect(restoreResult.targetPath).toBe(path.resolve(targetPath));
    expect(restoreResult.sourceSha256).toBe(backupHashBefore);
    expect(restoreResult.targetSha256).toBe(restoreResult.sourceSha256);
    expect(restoreResult.sourceBytes).toBe(backupStatBefore.size);
    expect(restoreResult.targetBytes).toBe(backupStatBefore.size);
    // The backup's stat is unchanged by the read-only restore.
    expect(restoreResult.sourceStat.size).toBe(backupStatBefore.size);
    expect(restoreResult.sourceStat.ino).toBe(backupStatBefore.ino);
    expect(restoreResult.sourceStat.mtimeMs).toBe(backupStatBefore.mtimeMs);

    // ---- Phase 4: point the service at the TARGET and initialize the CURRENT
    //      application repositories against it (additive CREATE ... IF NOT
    //      EXISTS schema ensure — preserved, not wiped). ----
    const restored = await loadDbModule(targetPath);
    const restoredGetDb = (await import('./entity-db')).getEntityDatabase;
    const restoredWorkspace = restored.createWorkspaceScopeRepository();
    const restoredTasks = restored.createOrgScopedTaskRepository({
      orgId: 'org-acme',
      teamId: 'team-claims',
    });
    const restoredHandoffs = restored.createTaskHandoffRepository();
    const restoredEvidence = restored.createEvidenceArtifactRepository();

    // ---- Phase 5: verify every pilot object through the application layer. ----
    expect(restoredWorkspace.getOrg('org-acme')).toMatchObject({ id: 'org-acme' });
    const restoredSettled = await restoredTasks.getTask(settledTask.id);
    expect(restoredSettled).toBeTruthy();
    expect(restoredSettled!.name).toBe('Settle CL-0001');
    // Lease ownership (Task-Master) round-tripped.
    const restoredBacklog = await restoredTasks.getTask(backlogTask.id);
    expect(restoredBacklog!.executor_principal_id).toBe('tm-1');
    expect(restoredBacklog!.assignment_state).toBe('claimed');
    // Handoff DAG round-tripped through the repository.
    const handoffList = restoredHandoffs.listForTask('org-acme', settledTask.id);
    expect(handoffList.outgoing.length).toBe(1);
    // Evidence artifact + PR link round-tripped.
    const restoredArtifact = await restoredEvidence.getArtifact(artifact.id);
    expect(restoredArtifact).toBeTruthy();
    expect(restoredArtifact!.content_hash).toBe('sha256:h');

    // ---- Phase 6: SAFE post-restore mutation through the application layer. ----
    const postRestoreTask = restoredTasks.createTask({
      name: 'Post-restore followup',
      project_id: project.id,
      assignee: 'agent-3',
    });
    const reread = await restoredTasks.getTask(postRestoreTask.id);
    expect(reread).toBeTruthy();
    expect(reread!.name).toBe('Post-restore followup');
    // Original restored rows are untouched by the new mutation.
    expect((await restoredTasks.getTask(settledTask.id))!.name).toBe('Settle CL-0001');

    // The restored TARGET is a normal WAL service database (not read-only).
    expect(restoredGetDb().pragma('journal_mode', { simple: true })).toBe('wal');

    // ---- Phase 7: IMMUTABLE BACKUP PROOF. Re-snapshot the backup AFTER the
    //      restore AND after the TARGET mutation; content/stat must be unchanged. ----
    const backupHashAfter = sha256(backupPath);
    const backupStatAfter = snapshotStat(backupPath);
    expect(backupHashAfter).toBe(backupHashBefore);
    expect(backupStatAfter.size).toBe(backupStatBefore.size);
    expect(backupStatAfter.ino).toBe(backupStatBefore.ino);
    expect(backupStatAfter.mtimeMs).toBe(backupStatBefore.mtimeMs);
  });

  it('refuses to restore over an existing target (never overwrites a real database)', () => {
    const dir = path.join(os.tmpdir(), `curacel-restore-refuse-${process.pid}-${randomUUID()}`);
    cleanupPaths.push(dir);

    // A "backup" file and a pre-existing TARGET that must NOT be clobbered.
    const backupPath = path.join(dir, 'backup.sqlite');
    const targetPath = path.join(dir, 'target.sqlite');
    writeSeedFile(backupPath, Buffer.from('backup-snapshot'));
    writeSeedFile(targetPath, Buffer.from('pre-existing-real-db'));

    const targetStatBefore = snapshotStat(targetPath);

    expect(() => restoreCleanTarget(backupPath, targetPath)).toThrow(/TARGET_EXISTS/);

    // The real target is byte-identical and untouched; no partial litter.
    expect(readFileSync(targetPath, 'utf8')).toBe('pre-existing-real-db');
    expect(snapshotStat(targetPath)).toEqual(targetStatBefore);
    expect(statSync(`${targetPath}-wal`, { throwIfNoEntry: false })).toBeUndefined();
  });

  it('refuses to restore when the target equals the source (SAME_PATH)', () => {
    const dir = path.join(os.tmpdir(), `curacel-restore-same-${process.pid}-${randomUUID()}`);
    cleanupPaths.push(dir);
    const backupPath = path.join(dir, 'backup.sqlite');
    writeSeedFile(backupPath, Buffer.from('backup-snapshot'));
    expect(() => restoreCleanTarget(backupPath, backupPath)).toThrow(/SAME_PATH/);
  });
});

function writeSeedFile(filePath: string, contents: Buffer): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = openSync(filePath, 'wx', 0o600);
  try {
    writeSync(fd, contents, 0, contents.length);
  } finally {
    closeSync(fd);
  }
}
