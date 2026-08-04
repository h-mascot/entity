/**
 * Curacel pilot acceptance — data-layer contracts (targets #2, #3, #4).
 *
 * This is the data-layer half of the deterministic Curacel pilot acceptance
 * suite. It proves the real tenant-isolation boundary (org-scoped task /
 * project repositories), the project -> task -> assignment -> lease -> review
 * -> final-state workflow, durable history, and lease/claim ownership — all
 * against a fresh temporary SQLite database, with no production access.
 *
 * Server-layer halves (auth, presence, release) live in
 * packages/server/src/__tests__/curacel-pilot-acceptance.test.ts.
 *
 * Remaining pilot capabilities not yet ported to current main are documented
 * in docs/plans/2026-08-04-curacel-pilot-integration.md.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let activeDbPath: string | null = null;
const cleanupDbPaths: string[] = [];

function tempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

function removeSqliteFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    fs.rmSync(file, { force: true });
  }
}

async function loadDbModule(): Promise<typeof import('./index')> {
  activeDbPath = tempDbPath('curacel-pilot-db');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  // Point the legacy Mission Control seed at a missing path so it is skipped.
  vi.stubEnv('MISSION_CONTROL_DB_PATH', tempDbPath('missing-mission-control'));
  return import('./index');
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dbPath of cleanupDbPaths) {
    removeSqliteFiles(dbPath);
  }
  cleanupDbPaths.length = 0;
  activeDbPath = null;
});

describe('Curacel pilot acceptance — tenant isolation (target #2)', () => {
  it('org-scoped task repository never returns another org task (cross-org negative)', async () => {
    const db = await loadDbModule();
    const workspace = db.createWorkspaceScopeRepository();

    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    workspace.createOrg({ id: 'org-beta', name: 'Beta' });

    const acmeProjects = db.createOrgScopedTaskRepository({ orgId: 'org-acme' });
    const betaProjects = db.createOrgScopedTaskRepository({ orgId: 'org-beta' });

    const acmeTask = acmeProjects.createTask({ name: 'Acme claim', assignee: 'agent-acme' });
    const betaTask = betaProjects.createTask({ name: 'Beta claim', assignee: 'agent-beta' });

    // List is org-scoped: each org sees only its own task.
    const acmeList = acmeProjects.listTasks().map((t) => t.id);
    const betaList = betaProjects.listTasks().map((t) => t.id);
    expect(acmeList).toContain(acmeTask.id);
    expect(acmeList).not.toContain(betaTask.id);
    expect(betaList).toContain(betaTask.id);
    expect(betaList).not.toContain(acmeTask.id);

    // Cross-org reads fail closed (undefined), never leak the row.
    expect(acmeProjects.getTask(betaTask.id)).toBeUndefined();
    expect(betaProjects.getTask(acmeTask.id)).toBeUndefined();

    // Cross-org mutation is denied: update is a no-op (returns undefined),
    // delete returns false, move returns undefined.
    expect(acmeProjects.updateTask(betaTask.id, { name: 'hijacked' })).toBeUndefined();
    expect(acmeProjects.deleteTask(betaTask.id)).toBe(false);
    expect(acmeProjects.moveTask(betaTask.id, 'done')).toBeUndefined();

    // Beta task survives the attempted cross-org tampering.
    const survivor = betaProjects.getTask(betaTask.id);
    expect(survivor?.name).toBe('Beta claim');
  });

  it('project creation is bound to the org context and cannot be referenced across orgs', async () => {
    const db = await loadDbModule();
    const workspace = db.createWorkspaceScopeRepository();

    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    workspace.createOrg({ id: 'org-beta', name: 'Beta' });

    const acmeProject = workspace.createProject({ orgId: 'org-acme' }, { name: 'Acme Project' });
    const betaProject = workspace.createProject({ orgId: 'org-beta' }, { name: 'Beta Project' });

    // Each org lists only its own projects.
    const acmeProjects = workspace.listProjects({ orgId: 'org-acme' }).map((p) => p.id);
    const betaProjects = workspace.listProjects({ orgId: 'org-beta' }).map((p) => p.id);
    expect(acmeProjects).toContain(acmeProject.id);
    expect(acmeProjects).not.toContain(betaProject.id);
    expect(betaProjects).toContain(betaProject.id);

    // Creating a task in org-acme that references beta's project is rejected
    // (the org-scoped repository asserts the project belongs to the org).
    const acmeTasks = db.createOrgScopedTaskRepository({ orgId: 'org-acme' });
    expect(() => acmeTasks.createTask({ name: 'cross-org project', project_id: betaProject.id })).toThrow();
  });
});

describe('Curacel pilot acceptance — workflow + lease + history (targets #3, #4)', () => {
  it('runs project -> task -> assignment -> lease -> review -> done with durable history', async () => {
    const db = await loadDbModule();
    const workspace = db.createWorkspaceScopeRepository();
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    workspace.createTeam({ orgId: 'org-acme' }, { id: 'team-claims', name: 'Claims' });
    const project = workspace.createProject({ orgId: 'org-acme', teamId: 'team-claims' }, { name: 'Claims Control Room' });

    const tasks = db.createOrgScopedTaskRepository({ orgId: 'org-acme', teamId: 'team-claims' });

    // Step 1: create a customer task in the project with explicit assignment.
    const task = tasks.createTask({
      name: 'Vet claim CL-0001',
      project_id: project.id,
      assignee: 'agent-atlas',
      assignment_state: 'assigned',
      owner_principal_id: 'reviewer-1',
      owner_principal_type: 'human',
      review_required: true,
      review_state: 'pending',
      column: 'inbox',
    });
    expect(task.assignment_state).toBe('assigned');
    expect(task.review_state).toBe('pending');

    // Step 2: Task Master lease/claim. Claims are only valid on unassigned,
    // Task-Master-drivable work, so we model the auto-claimable backlog item
    // separately and prove ownership transfers with a durable claim record.
    const backlog = tasks.createTask({
      name: 'Auto-vet claim CL-0002',
      project_id: project.id,
      taskmaster_drivable: true,
      // Unassigned + no executor => eligible for Task Master lease.
      assignee: 'unassigned',
      column: 'inbox',
    });
    const claim = tasks.claimTaskForTaskMaster(backlog.id, {
      taskmaster_principal_id: 'tm-1',
      claim_request_id: 'req-lease-1',
      policy_reason: 'auto-claim ready work',
    });
    expect(claim.status).toBe('claimed');
    expect(claim.claimed).toBe(true);
    const claimed = tasks.getTask(backlog.id);
    expect(claimed?.executor_principal_id).toBe('tm-1');
    expect(claimed?.assignment_state).toBe('claimed');

    // Step 3: move through the board to review. The review APPROVE/REJECT
    // decision is a policy-gated, audited transition (not a free mutation),
    // so it is proven at the server layer via the real review-gate router
    // (see packages/server/src/__tests__/curacel-pilot-acceptance.test.ts).
    const moved = tasks.moveTask(task.id, 'review');
    expect(moved?.column).toBe('review');

    // Step 4: durable history store round-trips auditable field changes, and
    // the activity log is queryable by task (used by reviewer/audit surfaces).
    // History/activity rows are written by the route layer on real mutations;
    // here we prove the durable stores themselves round-trip task-scoped data.
    db.addTaskHistory(task.id, 'column', 'inbox', 'review', 'reviewer-1');
    const history = db.getTaskHistory(task.id);
    expect(history.length).toBeGreaterThan(0);
    expect(history.some((h) => h.field === 'column')).toBe(true);

    const activityRepo = db.createActivityRepository();
    activityRepo.createActivity({ task_id: task.id, type: 'task_moved', action: 'moved', description: 'Moved to review', agent_name: 'reviewer-1' });
    const activities = activityRepo.listActivitiesByTaskId(task.id);
    expect(activities.length).toBeGreaterThan(0);
    expect(activities.every((a) => a.task_id === task.id)).toBe(true);
  });

  it('lease claim is idempotent for the same owner and rejects cross-org claims', async () => {
    const db = await loadDbModule();
    const workspace = db.createWorkspaceScopeRepository();
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    workspace.createOrg({ id: 'org-beta', name: 'Beta' });

    const acme = db.createOrgScopedTaskRepository({ orgId: 'org-acme' });
    const beta = db.createOrgScopedTaskRepository({ orgId: 'org-beta' });
    const task = acme.createTask({
      name: 'Leaseable',
      taskmaster_drivable: true,
      assignee: 'unassigned',
    });

    const first = acme.claimTaskForTaskMaster(task.id, {
      taskmaster_principal_id: 'tm-1',
      claim_request_id: 'req-1',
    });
    expect(first.status).toBe('claimed');
    expect(first.claimed).toBe(true);

    // Replay by the SAME owner is idempotent: it does not double-claim; it
    // acknowledges the existing ownership (already_claimed, owned by tm-1).
    const second = acme.claimTaskForTaskMaster(task.id, {
      taskmaster_principal_id: 'tm-1',
      claim_request_id: 'req-2',
    });
    expect(second.status).toBe('already_claimed');
    expect(second.claimed).toBe(false);
    expect(second.task?.executor_principal_id).toBe('tm-1');

    // A second Task Master cannot steal the lease (ownership is exclusive).
    const contended = acme.claimTaskForTaskMaster(task.id, {
      taskmaster_principal_id: 'tm-2',
      claim_request_id: 'req-3',
    });
    expect(contended.status).toBe('not_claimable');
    expect(contended.claimed).toBe(false);
    expect(contended.task?.executor_principal_id).toBe('tm-1');

    // A different org cannot claim (or even see) the task.
    const crossOrg = beta.claimTaskForTaskMaster(task.id, { claim_request_id: 'req-evil' });
    expect(crossOrg.status).toBe('not_found');
    expect(crossOrg.claimed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Target #3: linked project -> task -> evidence (file/proof) -> PR workflow.
// Proves the canonical current-main evidence-artifact facility ties a proof
// file + content hash to a task, links a pull-request object reference, and
// stays org-scoped (cross-org evidence never leaks between tenant listings).
// ---------------------------------------------------------------------------

describe('Curacel pilot acceptance — linked task/file/evidence/PR workflow (target #3)', () => {
  it('binds an evidence artifact (file + content hash) to a task, links a PR, and stays org-scoped', async () => {
    const db = await loadDbModule();
    const workspace = db.createWorkspaceScopeRepository();
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    workspace.createOrg({ id: 'org-beta', name: 'Beta' });

    const acmeTasks = db.createOrgScopedTaskRepository({ orgId: 'org-acme' });
    const betaTasks = db.createOrgScopedTaskRepository({ orgId: 'org-beta' });
    const claimTask = acmeTasks.createTask({
      name: 'Settle claim CL-0001',
      assignee: 'agent-atlas',
      column: 'review',
      review_required: true,
    });
    const betaTask = betaTasks.createTask({ name: 'Beta work', assignee: 'agent-beta' });

    const evidence = db.createEvidenceArtifactRepository();

    // Canonical pilot artifact: a proof file at a stable docs path plus a
    // content hash (the integrity anchor the reviewer compares against), tied
    // to the originating task.
    const acmeArtifact = evidence.createArtifact({
      org_id: 'org-acme',
      origin_task_id: claimTask.id,
      artifact_kind: 'review_packet',
      mutability_policy: 'editable_versioned',
      title: 'Claim CL-0001 review packet',
      stable_path: 'output/claims/CL-0001.md',
      content_hash: 'sha256:abc123',
      integrity_state: 'valid',
      availability_state: 'available',
    });
    expect(acmeArtifact.origin_task_id).toBe(claimTask.id);
    expect(acmeArtifact.stable_path).toBe('output/claims/CL-0001.md');
    expect(acmeArtifact.content_hash).toBe('sha256:abc123');

    // Link the artifact to the pull request that ships the settlement
    // (ObjectRef accepts an arbitrary object_type, e.g. a pull request).
    const linked = evidence.linkArtifactObject(acmeArtifact.id, {
      object_type: 'pull_request',
      object_id: '42',
      link_role: 'proof',
    });
    expect(linked?.linked_object_refs).toContainEqual({
      object_type: 'pull_request',
      object_id: '42',
      link_role: 'proof',
    });

    // A separate org's artifact is tied to its own task + org.
    const betaArtifact = evidence.createArtifact({
      org_id: 'org-beta',
      origin_task_id: betaTask.id,
      artifact_kind: 'review_packet',
      mutability_policy: 'editable_versioned',
      title: 'Beta proof',
      stable_path: 'output/beta.md',
      content_hash: 'sha256:zzz',
    });

    // The reviewer / audit surface reads a task's evidence by origin task.
    expect(evidence.listArtifactsByOriginTask(claimTask.id).map((a) => a.id)).toContain(acmeArtifact.id);

    // Tenant isolation: the org-scoped listing never leaks across orgs.
    const acmeList = evidence.listArtifacts({ org_id: 'org-acme' }).map((a) => a.id);
    const betaList = evidence.listArtifacts({ org_id: 'org-beta' }).map((a) => a.id);
    expect(acmeList).toContain(acmeArtifact.id);
    expect(acmeList).not.toContain(betaArtifact.id);
    expect(betaList).toContain(betaArtifact.id);
    expect(betaList).not.toContain(acmeArtifact.id);
  });
});

// ---------------------------------------------------------------------------
// Target #4: safe retry / resume via compare-and-swap. The handoff lifecycle
// is guarded by an optimistic-concurrency version: a stale transition is
// rejected, the caller reloads, and the retry succeeds against the new
// version — proving failures are resumable rather than lost or clobbering.
// ---------------------------------------------------------------------------

describe('Curacel pilot acceptance — safe retry/resume via CAS (target #4)', () => {
  it('rejects a stale handoff transition and safely resumes after reload', async () => {
    const db = await loadDbModule();
    const workspace = db.createWorkspaceScopeRepository();
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    const tasks = db.createOrgScopedTaskRepository({ orgId: 'org-acme' });
    const a = tasks.createTask({ name: 'Source', assignee: 'agent-a' });
    const b = tasks.createTask({ name: 'Target', assignee: 'unassigned' });
    const handoffRepo = db.createTaskHandoffRepository();
    const handoff = handoffRepo.create({
      sourceTaskId: a.id,
      targetTaskId: b.id,
      targetAgentId: 'agent-b',
      actorPrincipalId: 'operator-1',
    });
    expect(handoff.version).toBe(1);

    // A concurrent transition bumps the live version to 2.
    handoffRepo.transition({
      orgId: 'org-acme',
      handoffId: handoff.id,
      status: 'accepted',
      actorPrincipalId: 'approver-1',
      expectedVersion: 1,
    });

    // A stale retry (version 1) is rejected — the caller must reload, never
    // clobber a transition it did not observe.
    expect(() =>
      handoffRepo.transition({
        orgId: 'org-acme',
        handoffId: handoff.id,
        status: 'completed',
        actorPrincipalId: 'approver-1',
        expectedVersion: 1,
      }),
    ).toThrow(/changed/);

    // Safe resume: reload observes version 2, and the retry completes cleanly.
    const reloaded = handoffRepo.get('org-acme', handoff.id);
    expect(reloaded?.version).toBe(2);
    const completed = handoffRepo.transition({
      orgId: 'org-acme',
      handoffId: handoff.id,
      status: 'completed',
      actorPrincipalId: 'approver-1',
      expectedVersion: reloaded!.version,
    });
    expect(completed.status).toBe('completed');
    expect(completed.version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Target #7: backup/restore durability contract. Proves the SQLite data
// layer's online backup + restore round-trips every pilot table (orgs, tasks,
// task-master lease, task_handoffs, evidence_artifacts) and the handoff
// schema/indexes — the recoverability primitive the pilot's backup/restore
// requirement rests on, exercised against a throwaway temp DB only.
// ---------------------------------------------------------------------------

describe('Curacel pilot acceptance — backup/restore durability contract (target #7)', () => {
  it('online-backs-up the live DB and restores every pilot table intact', async () => {
    const db = await loadDbModule();
    const { getEntityDatabase } = await import('./entity-db');

    // Populate the full pilot data model: org -> project/task -> lease ->
    // handoff -> evidence (file + PR link).
    const workspace = db.createWorkspaceScopeRepository();
    workspace.createOrg({ id: 'org-acme', name: 'Acme' });
    workspace.createTeam({ orgId: 'org-acme' }, { id: 'team-claims', name: 'Claims' });
    const project = workspace.createProject(
      { orgId: 'org-acme', teamId: 'team-claims' },
      { name: 'Claims Control Room' },
    );
    const tasks = db.createOrgScopedTaskRepository({ orgId: 'org-acme', teamId: 'team-claims' });
    const task = tasks.createTask({
      name: 'Settle CL-0001',
      project_id: project.id,
      assignee: 'agent-1',
    });
    const backlog = tasks.createTask({
      name: 'Auto CL-0002',
      project_id: project.id,
      taskmaster_drivable: true,
      assignee: 'unassigned',
    });
    tasks.claimTaskForTaskMaster(backlog.id, {
      taskmaster_principal_id: 'tm-1',
      claim_request_id: 'r1',
    });

    const handoffRepo = db.createTaskHandoffRepository();
    handoffRepo.create({
      sourceTaskId: task.id,
      targetTaskId: backlog.id,
      targetAgentId: 'agent-2',
      actorPrincipalId: 'operator-1',
    });

    const evidence = db.createEvidenceArtifactRepository();
    const artifact = evidence.createArtifact({
      org_id: 'org-acme',
      origin_task_id: task.id,
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

    // Canonical online backup of the live (WAL-mode) database.
    const source = getEntityDatabase();
    const backupPath = path.join(
      os.tmpdir(),
      `curacel-backup-${process.pid}-${randomUUID()}.sqlite`,
    );
    cleanupDbPaths.push(backupPath);
    await source.backup(backupPath);
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.statSync(backupPath).size).toBeGreaterThan(0);

    // Restore: open the backup read-only and assert every pilot table + the
    // lease ownership + the handoff index round-tripped.
    const restored = new Database(backupPath, { readonly: true });
    try {
      expect(restored.prepare('SELECT count(*) AS n FROM orgs').get()).toMatchObject({ n: expect.any(Number) });
      expect(restored.prepare('SELECT id FROM orgs WHERE id = ?').get('org-acme')).toMatchObject({ id: 'org-acme' });
      expect(restored.prepare('SELECT count(*) AS n FROM tasks').get()).toMatchObject({ n: 2 });
      const leaseRow = restored
        .prepare('SELECT executor_principal_id, assignment_state FROM tasks WHERE id = ?')
        .get(backlog.id) as { executor_principal_id: string; assignment_state: string };
      expect(leaseRow.executor_principal_id).toBe('tm-1');
      expect(leaseRow.assignment_state).toBe('claimed');
      expect(restored.prepare('SELECT count(*) AS n FROM task_handoffs').get()).toMatchObject({ n: 1 });
      const evidenceRow = restored
        .prepare('SELECT origin_task_id, content_hash, linked_object_refs_json FROM evidence_artifacts WHERE id = ?')
        .get(artifact.id) as {
          origin_task_id: number;
          content_hash: string;
          linked_object_refs_json: string;
        };
      expect(evidenceRow.origin_task_id).toBe(task.id);
      expect(evidenceRow.content_hash).toBe('sha256:h');
      expect(JSON.parse(evidenceRow.linked_object_refs_json)).toContainEqual({
        object_type: 'pull_request',
        object_id: '42',
        link_role: 'proof',
      });
      // Schema integrity carries over to the restored copy.
      expect(
        restored
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_task_handoffs_source'",
          )
          .get(),
      ).toMatchObject({ name: 'idx_task_handoffs_source' });
    } finally {
      restored.close();
    }
  });
});
