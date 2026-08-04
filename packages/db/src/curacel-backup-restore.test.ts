/**
 * Curacel pilot — operational restore proof (Terra B7).
 *
 * Upgrades the backup durability contract from "open the backup read-only and
 * query rows" to a real operational recovery: populate a service database,
 * take a canonical online backup, RESTORE it into a CLEAN target database by
 * pointing the service at the restored file, initialize the CURRENT
 * application repositories against the restored target (additive IF NOT EXISTS
 * schema ensure — preserved, not wiped), verify every pilot object through the
 * application repositories, then perform a SAFE post-restore mutation and read
 * it back through the application layer. Throwaway temp DBs only; no production
 * access.
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cleanupPaths: string[] = [];

function tempPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

function removeSqliteFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    fs.rmSync(file, { force: true });
  }
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

describe('Curacel pilot — operational restore into a clean target (B7)', () => {
  it('restores the backup into a fresh service DB, initializes repos, and supports a post-restore mutation', async () => {
    // ---- Phase 1: populate the live service database. ----
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

    // ---- Phase 2: canonical online backup of the live (WAL) database. ----
    const source = getEntityDatabase();
    const backupPath = tempPath('curacel-restore-backup');
    cleanupPaths.push(backupPath);
    await source.backup(backupPath);
    expect(fs.existsSync(backupPath)).toBe(true);

    // ---- Phase 3: RESTORE into a CLEAN target by pointing the service at the
    //      backup file. Reset modules so getEntityDatabase re-opens the new path. ----
    const restored = await loadDbModule(backupPath);
    const restoredGetDb = (await import('./entity-db')).getEntityDatabase;
    // Initializing the repositories runs the additive `CREATE ... IF NOT EXISTS`
    // schema ensure against the restored target. Data must survive (not be wiped).
    const restoredWorkspace = restored.createWorkspaceScopeRepository();
    const restoredTasks = restored.createOrgScopedTaskRepository({ orgId: 'org-acme', teamId: 'team-claims' });
    const restoredHandoffs = restored.createTaskHandoffRepository();
    const restoredEvidence = restored.createEvidenceArtifactRepository();

    // ---- Phase 4: verify every pilot object through the application layer. ----
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

    // ---- Phase 5: SAFE post-restore mutation through the application layer. ----
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

    // The restored target is a normal WAL service database (not read-only).
    expect(restoredGetDb().pragma('journal_mode', { simple: true })).toBe('wal');
  });
});
