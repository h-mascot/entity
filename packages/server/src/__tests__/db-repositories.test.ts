import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Database from 'better-sqlite3';

// Each test suite uses a unique temp DB file via ENTITY_TASK_DB_PATH
let tmpDbPath: string;
const originalEnv = process.env.ENTITY_TASK_DB_PATH;
const originalMcPath = process.env.MISSION_CONTROL_DB_PATH;

function freshDb() {
  tmpDbPath = path.join(os.tmpdir(), `entity-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
  // Point MC seed to non-existent path so it skips
  process.env.MISSION_CONTROL_DB_PATH = '/tmp/nonexistent-mc.db';
}

function cleanupDb() {
  if (originalEnv !== undefined) {
    process.env.ENTITY_TASK_DB_PATH = originalEnv;
  } else {
    delete process.env.ENTITY_TASK_DB_PATH;
  }
  if (originalMcPath !== undefined) {
    process.env.MISSION_CONTROL_DB_PATH = originalMcPath;
  } else {
    delete process.env.MISSION_CONTROL_DB_PATH;
  }
  try { if (tmpDbPath) fs.unlinkSync(tmpDbPath); } catch {}
  try { if (tmpDbPath) fs.unlinkSync(tmpDbPath + '-wal'); } catch {}
  try { if (tmpDbPath) fs.unlinkSync(tmpDbPath + '-shm'); } catch {}
}

// We need fresh imports each time because the DB module caches the singleton.
// Use dynamic imports inside each describe block.

describe('TaskRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('should create and retrieve a task', async () => {
    // Force fresh module by clearing cache
    const dbMod = await import('../../../../packages/db/src/index');
    // Note: due to singleton caching, the env change should work for first use
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({ name: 'Test Task', description: 'A test', priority: 'P1' });
    expect(task.name).toBe('Test Task');
    expect(task.description).toBe('A test');
    expect(task.priority).toBe('P1');
    expect(task.column).toBe('backlog');
    expect(task.assignee).toBe('Unassigned');
    expect(task.blocked).toBe(false);
    expect(task.archived).toBe(false);
    expect(task.id).toBeGreaterThan(0);

    const fetched = repo.getTask(task.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('Test Task');
  });

  it('keeps legacy repository-created tasks visible with accountability compatibility markers', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const legacyTask = repo.createTask({ name: 'Legacy Compatible Task' });

    expect(legacyTask.initiator_principal_id).toBe('legacy-unknown');
    expect(legacyTask.initiator_type).toBe('unknown');
    expect(legacyTask.owner_principal_id).toBe('legacy-owner');
    expect(legacyTask.owner_principal_type).toBe('unknown');
    expect(legacyTask.assignment_state).toBe('routing_problem');
    expect(legacyTask.taskmaster_drivable).toBe(false);

    const updated = repo.updateTask(legacyTask.id, {
      initiator_principal_id: 'requester-1',
      owner_principal_id: 'owner-1',
      owner_principal_type: 'human',
      executor_principal_id: 'agent-1',
      assignment_state: 'assigned',
    });

    expect(updated).toMatchObject({
      initiator_principal_id: 'requester-1',
      owner_principal_id: 'owner-1',
      owner_principal_type: 'human',
      executor_principal_id: 'agent-1',
      assignment_state: 'assigned',
    });
  });

  it('dry-runs then applies conservative hierarchy and accountability backfill', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    const workspace = dbMod.createWorkspaceScopeRepository();
    const project = workspace.createProject(
      { orgId: dbMod.DEFAULT_WORKSPACE_ORG_ID, teamId: dbMod.DEFAULT_WORKSPACE_TEAM_ID },
      { name: 'Backfill Project' },
    );
    const task = repo.createTask({
      name: 'Backfill Candidate',
      column: 'todo',
      assignee: 'Ada',
      created_by_principal_id: 'requester-1',
    });
    workspace.addTaskProject(
      { orgId: dbMod.DEFAULT_WORKSPACE_ORG_ID, teamId: dbMod.DEFAULT_WORKSPACE_TEAM_ID },
      task.id,
      project.id,
    );

    const dryRun = dbMod.backfillTaskHierarchyAndAccountability({ dryRun: true });
    const dryRunTask = dryRun.taskResults.find((result) => result.task_id === task.id);
    expect(dryRunTask?.applied).toBe(false);
    expect(dryRunTask?.inferred_fields.map((field) => field.field_name)).toEqual(
      expect.arrayContaining(['project_id', 'initiator_principal_id', 'owner_principal_id', 'owner_principal_type']),
    );
    expect(repo.getTask(task.id)).toMatchObject({
      project_id: null,
      initiator_principal_id: 'legacy-unknown',
      owner_principal_id: 'legacy-owner',
    });

    const applied = dbMod.backfillTaskHierarchyAndAccountability({ dryRun: false });
    const appliedTask = applied.taskResults.find((result) => result.task_id === task.id);
    expect(appliedTask?.applied).toBe(true);

    const updated = repo.getTask(task.id);
    expect(updated).toMatchObject({
      project_id: project.id,
      initiator_principal_id: 'requester-1',
      initiator_type: 'human',
      owner_principal_id: 'Ada',
      owner_principal_type: 'human',
      assignment_state: 'assigned',
    });
    const metadata = JSON.parse(updated?.metadata ?? '{}') as {
      phase2_backfill?: { version?: string; inferred_fields?: Array<{ field_name: string; confidence: string }> };
    };
    expect(metadata.phase2_backfill?.version).toBe('THE-30');
    expect(metadata.phase2_backfill?.inferred_fields).toContainEqual(
      expect.objectContaining({ field_name: 'owner_principal_id', confidence: 'medium' }),
    );

    const secondApply = dbMod.backfillTaskHierarchyAndAccountability({ dryRun: false });
    const secondTask = secondApply.taskResults.find((result) => result.task_id === task.id);
    expect(secondTask?.would_update).toBe(false);
  });

  it('keeps unresolved hierarchy and accountability fields as cleanup warnings', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    const task = repo.createTask({ name: 'Needs Cleanup', column: 'doing' });

    const report = dbMod.backfillTaskHierarchyAndAccountability({ dryRun: false });
    const result = report.taskResults.find((entry) => entry.task_id === task.id);

    expect(result?.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['missing_project', 'unknown_initiator', 'missing_owner', 'missing_assignee']),
    );
    expect(result?.inferred_fields).toEqual([]);

    const unchanged = repo.getTask(task.id);
    expect(unchanged).toMatchObject({
      project_id: null,
      initiator_principal_id: 'legacy-unknown',
      owner_principal_id: 'legacy-owner',
      assignment_state: 'routing_problem',
    });
    const metadata = JSON.parse(unchanged?.metadata ?? '{}') as {
      phase2_backfill?: { warnings?: Array<{ code: string; severity: string }> };
    };
    expect(metadata.phase2_backfill?.warnings).toContainEqual(
      expect.objectContaining({ code: 'missing_owner', severity: 'blocking_for_execution' }),
    );
    expect(report.markdown).toContain('Cleanup warnings');
  });

  it('should list tasks', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    repo.createTask({ name: 'Task A' });
    repo.createTask({ name: 'Task B' });

    const tasks = repo.listTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    const names = tasks.map(t => t.name);
    expect(names).toContain('Task A');
    expect(names).toContain('Task B');
  });

  it('should update a task', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({ name: 'Original' });
    const updated = repo.updateTask(task.id, { name: 'Updated', blocked: true, blocker_reason: 'waiting' });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Updated');
    expect(updated!.blocked).toBe(true);
    expect(updated!.blocker_reason).toBe('waiting');
  });

  it('should return undefined when updating non-existent task', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    const result = repo.updateTask(99999, { name: 'Nope' });
    expect(result).toBeUndefined();
  });

  it('should move a task to a different column', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({ name: 'Movable' });
    expect(task.column).toBe('backlog');

    const moved = repo.moveTask(task.id, 'doing');
    expect(moved).toBeDefined();
    expect(moved!.column).toBe('doing');
  });

  it('should normalize invalid column to backlog', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({ name: 'Bad Column', column: 'INVALID' });
    expect(task.column).toBe('backlog');
  });

  it('should delete a task', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({ name: 'Deletable' });
    const deleted = repo.deleteTask(task.id);
    expect(deleted).toBe(true);
    expect(repo.getTask(task.id)).toBeUndefined();
  });

  it('should return false when deleting non-existent task', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    expect(repo.deleteTask(99999)).toBe(false);
  });

  it('should handle task with all fields', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'Full Task',
      description: 'Full desc',
      brief: 'A brief',
      origin_channel: 'discord',
      column: 'todo',
      model: 'gpt-4',
      archived: false,
      assignee: 'Ada',
      blocked: true,
      blocker_reason: 'Needs review',
      due_date: '2026-03-01',
      priority: 'P0',
      estimate_hours: 5,
      time_spent: 2,
      output: 'Some output',
      progress_status: 'in-progress',
      recurring: true,
      recurring_config: '{"cron":"0 9 * * *"}',
      metadata: '{"key":"value"}',
    });

    expect(task.column).toBe('todo');
    expect(task.model).toBe('gpt-4');
    expect(task.assignee).toBe('Ada');
    expect(task.blocked).toBe(true);
    expect(task.blocker_reason).toBe('Needs review');
    expect(task.due_date).toBe('2026-03-01');
    expect(task.priority).toBe('P0');
    expect(task.estimate_hours).toBe(5);
    expect(task.time_spent).toBe(2);
    expect(task.recurring).toBe(true);
  });
});

describe('ActivityRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('defines the Phase 2 ActivityEvent enum needed by routing, review, receipts, connectors, and migration', async () => {
    const dbMod = await import('../../../../packages/db/src/index');

    expect(dbMod.ACTIVITY_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        'task_created',
        'task_updated',
        'assignment_changed',
        'taskmaster_claimed',
        'nudge_sent',
        'owner_escalated',
        'auto_reassigned',
        'submission_created',
        'review_requested',
        'review_decision',
        'human_gate_requested',
        'human_gate_decision',
        'status_changed',
        'artifact_linked',
        'receipt_created',
        'receipt_failed',
        'completion_accepted',
        'completion_blocked',
        'task_cancelled',
        'task_paused',
        'task_blocked',
        'connector_state_changed',
        'notification_routed',
        'permission_denied',
        'integration_degraded',
        'migration_warning',
        'legacy_event_observed',
      ]),
    );
  });

  it('should create and list activities', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createActivityRepository();

    const activity = repo.createActivity({
      type: 'task_created',
      action: 'Created task',
      description: 'New task was created',
      agent_name: 'Ada',
      agent_emoji: '🔮',
    });

    expect(activity.type).toBe('task_created');
    expect(activity.agent_name).toBe('Ada');
    expect(activity.source).toBe('agent');

    const list = repo.listActivities(10);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].action).toBe('Created task');
  });

  it('stores versioned ActivityEvent payloads for structured events', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createActivityRepository();

    const activity = repo.createActivity({
      type: 'task_completed',
      activity_event_type: 'receipt_created',
      activity_event_payload: {
        actor_principal_id: 'agent-1',
        actor_type: 'agent',
        task_id: 42,
        object_refs: [{ object_type: 'evidence_artifact', object_id: 'receipt-42', link_role: 'receipt' }],
        data: { content_hash: 'sha256:test' },
      },
      action: 'Receipt created',
      description: 'Canonical task receipt was written',
      task_id: 42,
      agent_name: 'Ada',
    });

    expect(activity.activity_event_type).toBe('receipt_created');
    expect(activity.activity_event_payload_version).toBe(dbMod.ACTIVITY_EVENT_PAYLOAD_VERSION);
    expect(activity.activity_event_schema_status).toBe('structured');

    const payload = JSON.parse(activity.activity_event_payload_json);
    expect(payload).toMatchObject({
      version: dbMod.ACTIVITY_EVENT_PAYLOAD_VERSION,
      actor_principal_id: 'agent-1',
      actor_type: 'agent',
      task_id: 42,
      data: { content_hash: 'sha256:test' },
    });
    expect(payload.object_refs).toEqual([
      { object_type: 'evidence_artifact', object_id: 'receipt-42', link_role: 'receipt' },
    ]);
  });

  it('preserves unknown legacy event names without pretending they are structured', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createActivityRepository();

    const activity = repo.createActivity({
      type: 'message_sent',
      activity_event_type: 'legacy.freeform.status',
      action: 'Legacy note',
      description: 'Imported freeform activity event',
      task_id: 7,
      agent_name: 'Legacy Import',
    });

    expect(activity.activity_event_type).toBe('legacy_event_observed');
    expect(activity.activity_event_schema_status).toBe('legacy_unknown');
    expect(activity.activity_event_legacy_type).toBe('legacy.freeform.status');

    const payload = JSON.parse(activity.activity_event_payload_json);
    expect(payload.legacy).toMatchObject({
      source_type: 'message_sent',
      action: 'Legacy note',
      description: 'Imported freeform activity event',
    });
    expect(payload.task_id).toBe(7);
  });

  it('dry-runs, applies, and idempotently records known legacy ActivityEvent backfill', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const taskRepo = dbMod.createTaskRepository();
    const activityRepo = dbMod.createActivityRepository();
    const task = taskRepo.createTask({ name: 'Legacy Activity Task' });
    const activity = activityRepo.createActivity({
      source: 'task',
      type: 'task_moved',
      action: 'Moved task',
      description: 'Legacy task moved event',
      task_id: task.id,
    });

    const rawDb = new Database(tmpDbPath);
    try {
      rawDb.prepare(`
        UPDATE activities
        SET
          activity_event_type = NULL,
          activity_event_payload_json = NULL,
          activity_event_schema_status = 'legacy_mapped',
          activity_event_legacy_type = NULL,
          metadata = NULL
        WHERE id = ?
      `).run(activity.id);

      const dryRun = dbMod.backfillActivityEventsProgressively({ dryRun: true, db: rawDb });
      const dryRunActivity = dryRun.activityResults.find((result) => result.activity_id === activity.id);
      expect(dryRunActivity).toMatchObject({
        event_type: 'status_changed',
        schema_status: 'legacy_mapped',
        confidence: 'high',
        would_update: true,
        applied: false,
      });
      expect(dryRun.markdown).toContain('THE-33 ActivityEvent Progressive Backfill Report');
      expect(taskRepo.getTask(task.id)?.name).toBe('Legacy Activity Task');
      expect(rawDb.prepare('SELECT activity_event_type FROM activities WHERE id = ?').get(activity.id))
        .toMatchObject({ activity_event_type: null });

      const applied = dbMod.backfillActivityEventsProgressively({ dryRun: false, db: rawDb });
      const appliedActivity = applied.activityResults.find((result) => result.activity_id === activity.id);
      expect(appliedActivity?.applied).toBe(true);

      const updated = rawDb.prepare('SELECT * FROM activities WHERE id = ?').get(activity.id) as {
        activity_event_type: string;
        activity_event_schema_status: string;
        activity_event_payload_json: string;
        metadata: string;
      };
      expect(updated.activity_event_type).toBe('status_changed');
      expect(updated.activity_event_schema_status).toBe('legacy_mapped');
      expect(JSON.parse(updated.activity_event_payload_json)).toMatchObject({
        version: dbMod.ACTIVITY_EVENT_PAYLOAD_VERSION,
        task_id: task.id,
        legacy: {
          source_type: 'task_moved',
          action: 'Moved task',
        },
      });
      expect(JSON.parse(updated.metadata).phase2_activity_event_backfill).toMatchObject({
        version: 'THE-33',
        confidence: 'high',
      });

      const secondApply = dbMod.backfillActivityEventsProgressively({ dryRun: false, db: rawDb });
      const secondActivity = secondApply.activityResults.find((result) => result.activity_id === activity.id);
      expect(secondActivity?.would_update).toBe(false);
    } finally {
      rawDb.close();
    }
  });

  it('flags weak legacy activity rows without rewriting them as certain structured events', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    dbMod.createActivityRepository();
    const rawDb = new Database(tmpDbPath);

    try {
      const insert = rawDb.prepare(`
        INSERT INTO activities (
          source,
          type,
          activity_event_type,
          activity_event_payload_json,
          activity_event_schema_status,
          action,
          description,
          metadata
        ) VALUES ('agent', 'vendor_ping', NULL, '{bad-json', 'legacy_mapped', 'Vendor ping', 'Weak vendor activity', NULL)
      `);
      const result = insert.run();
      const activityId = Number(result.lastInsertRowid);

      const report = dbMod.backfillActivityEventsProgressively({ dryRun: false, db: rawDb });
      const migrated = report.activityResults.find((entry) => entry.activity_id === activityId);
      expect(migrated).toMatchObject({
        event_type: 'legacy_event_observed',
        schema_status: 'legacy_unknown',
        confidence: 'unknown',
        applied: true,
      });
      expect(migrated?.warnings.map((warning) => warning.code)).toEqual(
        expect.arrayContaining(['legacy_event_unknown', 'missing_task_link', 'malformed_payload']),
      );

      const stored = rawDb.prepare('SELECT * FROM activities WHERE id = ?').get(activityId) as {
        activity_event_type: string;
        activity_event_schema_status: string;
        activity_event_legacy_type: string;
        activity_event_payload_json: string;
        metadata: string;
      };
      expect(stored.activity_event_type).toBe('legacy_event_observed');
      expect(stored.activity_event_schema_status).toBe('legacy_unknown');
      expect(stored.activity_event_legacy_type).toBe('vendor_ping');
      expect(JSON.parse(stored.activity_event_payload_json).legacy).toMatchObject({
        source_type: 'vendor_ping',
      });
      expect(JSON.parse(stored.metadata).phase2_activity_event_backfill.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'legacy_event_unknown' }),
          expect.objectContaining({ code: 'missing_task_link' }),
        ]),
      );
    } finally {
      rawDb.close();
    }
  });

  it('should list activities by task id', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createActivityRepository();

    repo.createActivity({ type: 'task_created', action: 'Created', description: 'Task 1', task_id: 42 });
    repo.createActivity({ type: 'task_updated', action: 'Updated', description: 'Task 2', task_id: 99 });

    const list = repo.listActivitiesByTaskId(42);
    expect(list.length).toBe(1);
    expect(list[0].task_id).toBe(42);
  });

  it('should return empty for invalid task id', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createActivityRepository();
    expect(repo.listActivitiesByTaskId(-1)).toEqual([]);
    expect(repo.listActivitiesByTaskId(0)).toEqual([]);
  });

  it('should throw on empty action or description', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createActivityRepository();
    expect(() => repo.createActivity({ type: 'task_created', action: '', description: 'desc' }))
      .toThrow('action and description are required');
    expect(() => repo.createActivity({ type: 'task_created', action: 'act', description: '' }))
      .toThrow('action and description are required');
  });

  it('should clamp limit to 500', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createActivityRepository();
    // Should not throw even with large limit
    const list = repo.listActivities(9999);
    expect(Array.isArray(list)).toBe(true);
  });
});

describe('EvidenceArtifactRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('persists stable raw receipt artifact metadata linked to the origin task', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const taskRepo = dbMod.createTaskRepository();
    const artifactRepo = dbMod.createEvidenceArtifactRepository();
    const task = taskRepo.createTask({ name: 'Receipt Metadata Task' });

    const artifact = artifactRepo.createArtifact({
      id: 'receipt-artifact-1',
      artifact_kind: 'raw_task_receipt',
      title: 'Receipt Metadata Task receipt',
      stable_path: '/artifacts/evidence/receipt-artifact-1.md',
      human_path_alias: `/tasks/${task.id}/receipt`,
      content_hash: 'sha256:receipt-fixture',
      mutability_policy: 'immutable_append_only',
      origin_task_id: task.id,
      source_activity_event_ids: [1, 2],
      source_artifact_ids: ['proof-output-1'],
      provenance_json: JSON.stringify({ source: 'THE-36-fixture' }),
      created_by_principal_id: 'agent-1',
    });

    expect(artifact).toMatchObject({
      id: 'receipt-artifact-1',
      org_id: dbMod.DEFAULT_WORKSPACE_ORG_ID,
      artifact_kind: 'raw_task_receipt',
      stable_path: '/artifacts/evidence/receipt-artifact-1.md',
      human_path_alias: `/tasks/${task.id}/receipt`,
      content_hash: 'sha256:receipt-fixture',
      mutability_policy: 'immutable_append_only',
      origin_task_id: task.id,
      integrity_state: 'valid',
      availability_state: 'available',
      created_by_principal_id: 'agent-1',
    });
    expect(artifact.source_activity_event_ids).toEqual([1, 2]);
    expect(artifact.source_artifact_ids).toEqual(['proof-output-1']);
    expect(JSON.parse(artifact.provenance_json)).toMatchObject({ source: 'THE-36-fixture' });
    expect(artifactRepo.listArtifactsByOriginTask(task.id).map((entry) => entry.id)).toEqual(['receipt-artifact-1']);
  });

  it('keeps canonical receipt identity stable across task, project, and team alias moves', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const task = dbMod.createTaskRepository().createTask({ name: 'Alias Move Task' });
    const artifactRepo = dbMod.createEvidenceArtifactRepository();

    const original = artifactRepo.createArtifact({
      id: 'receipt-artifact-2',
      title: 'Alias Move Task receipt',
      stable_path: '/artifacts/evidence/receipt-artifact-2.md',
      human_path_alias: `/projects/original/tasks/${task.id}/receipt`,
      content_hash: 'sha256:stable-body',
      origin_task_id: task.id,
    });

    const projectMoved = artifactRepo.updateHumanPathAlias(
      original.id,
      `/projects/renamed/tasks/${task.id}/receipt`,
    );
    const teamMoved = artifactRepo.updateHumanPathAlias(
      original.id,
      `/teams/customer-success/projects/renamed/tasks/${task.id}/receipt`,
    );
    const taskMoved = artifactRepo.updateHumanPathAlias(
      original.id,
      `/teams/customer-success/projects/renamed/tasks/${task.id}-renamed/receipt`,
    );

    expect(projectMoved).toMatchObject({
      id: original.id,
      stable_path: original.stable_path,
      content_hash: original.content_hash,
      origin_task_id: task.id,
      human_path_alias: `/projects/renamed/tasks/${task.id}/receipt`,
    });
    expect(teamMoved?.stable_path).toBe(original.stable_path);
    expect(taskMoved).toMatchObject({
      id: original.id,
      stable_path: original.stable_path,
      content_hash: original.content_hash,
      origin_task_id: task.id,
      human_path_alias: `/teams/customer-success/projects/renamed/tasks/${task.id}-renamed/receipt`,
    });
    expect(artifactRepo.getArtifact(original.id)?.stable_path).toBe('/artifacts/evidence/receipt-artifact-2.md');
  });

  it('rejects editable mutability for raw task receipt artifacts', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const artifactRepo = dbMod.createEvidenceArtifactRepository();

    expect(() => artifactRepo.createArtifact({
      id: 'receipt-artifact-3',
      artifact_kind: 'raw_task_receipt',
      title: 'Mutable raw receipt',
      content_hash: 'sha256:mutable-raw',
      mutability_policy: 'editable_versioned',
    })).toThrow('raw task receipt artifacts must be immutable_append_only');
  });
});

describe('TaskCommentRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('should create and list comments', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const commentRepo = dbMod.createTaskCommentRepository();
    const taskRepo = dbMod.createTaskRepository();

    const task = taskRepo.createTask({ name: 'Commented Task' });

    const comment = commentRepo.createComment({
      task_id: task.id,
      body: 'This is a comment',
      author: 'Spock',
    });

    expect(comment.body).toBe('This is a comment');
    expect(comment.author).toBe('Spock');
    expect(comment.task_id).toBe(task.id);
    expect(comment.parent_id).toBeNull();

    const comments = commentRepo.listComments(task.id);
    expect(comments.length).toBe(1);
  });

  it('should default author to Human', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const commentRepo = dbMod.createTaskCommentRepository();
    const taskRepo = dbMod.createTaskRepository();
    const task = taskRepo.createTask({ name: 'Task' });

    const comment = commentRepo.createComment({ task_id: task.id, body: 'No author' });
    expect(comment.author).toBe('Human');
  });

  it('should support threaded comments (parent_id)', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const commentRepo = dbMod.createTaskCommentRepository();
    const taskRepo = dbMod.createTaskRepository();
    const task = taskRepo.createTask({ name: 'Thread Task' });

    const parent = commentRepo.createComment({ task_id: task.id, body: 'Parent' });
    const reply = commentRepo.createComment({ task_id: task.id, body: 'Reply', parent_id: parent.id });

    expect(reply.parent_id).toBe(parent.id);
  });

  it('should throw on empty body', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const commentRepo = dbMod.createTaskCommentRepository();
    expect(() => commentRepo.createComment({ task_id: 1, body: '' })).toThrow('comment body is required');
  });

  it('should throw on invalid task_id', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const commentRepo = dbMod.createTaskCommentRepository();
    expect(() => commentRepo.createComment({ task_id: 0, body: 'test' })).toThrow('positive integer');
    expect(() => commentRepo.createComment({ task_id: -1, body: 'test' })).toThrow('positive integer');
  });
});

describe('AgentLogRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('should create and list logs', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createAgentLogRepository();

    const log = repo.createLog({
      event: 'stale_scan',
      action: 'Scanned tasks',
      task_id: 5,
      model: 'gemini-flash',
      tokens_used: 150,
    });

    expect(log.event).toBe('stale_scan');
    expect(log.action).toBe('Scanned tasks');
    expect(log.model).toBe('gemini-flash');
    expect(log.tokens_used).toBe(150);

    const logs = repo.listLogs(10);
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('should get status', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createAgentLogRepository();

    const status1 = repo.getStatus();
    expect(status1.totalActions).toBe(0);
    expect(status1.lastRun).toBeNull();

    repo.createLog({ event: 'scan', action: 'test' });
    const status2 = repo.getStatus();
    expect(status2.totalActions).toBe(1);
    expect(status2.lastRun).not.toBeNull();
  });

  it('should default model to gemini-flash', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createAgentLogRepository();
    const log = repo.createLog({ event: 'test', action: 'test' });
    expect(log.model).toBe('gemini-flash');
  });

  it('should throw on empty event or action', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createAgentLogRepository();
    expect(() => repo.createLog({ event: '', action: 'test' })).toThrow('event is required');
    expect(() => repo.createLog({ event: 'test', action: '' })).toThrow('action is required');
  });
});

// Strategic repo uses a module-level singleton, so all strategic tests must share one DB.
// We set up the DB once at the top of this describe and test everything together.
describe('Strategic Repository (Roadmaps, Projects, History)', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('should handle full roadmap lifecycle', async () => {
    const dbMod = await import('../../../../packages/db/src/index');

    // Create roadmap
    const roadmap = dbMod.createRoadmap({ name: 'Q1 2026', theme: 'Growth', color: '#ff0000' });
    expect(roadmap.name).toBe('Q1 2026');
    expect(roadmap.theme).toBe('Growth');

    // Roadmap items
    const item = dbMod.createRoadmapItem(roadmap.id, {
      title: 'Launch v2',
      description: 'Major release',
      priority: 'P0',
      target_period: 'Q1',
      status: 'in-progress',
    });
    expect(item.title).toBe('Launch v2');
    expect(item.priority).toBe('P0');
    expect(item.roadmap_id).toBe(roadmap.id);

    // List roadmaps with items
    let roadmaps = dbMod.getRoadmaps();
    expect(roadmaps.length).toBeGreaterThanOrEqual(1);
    expect(roadmaps[0].items.length).toBe(1);

    // Update item
    const updated = dbMod.updateRoadmapItem(item.id, { title: 'Changed', status: 'done' });
    expect(updated!.title).toBe('Changed');
    expect(updated!.status).toBe('done');

    // Delete item
    const item2 = dbMod.createRoadmapItem(roadmap.id, { title: 'Delete me' });
    expect(dbMod.deleteRoadmapItem(item2.id)).toBe(true);
    expect(dbMod.deleteRoadmapItem(item2.id)).toBe(false);

    // Delete roadmap cascade
    expect(dbMod.deleteRoadmap(roadmap.id)).toBe(true);
    roadmaps = dbMod.getRoadmaps();
    expect(roadmaps.find(r => r.id === roadmap.id)).toBeUndefined();

    // Validation
    expect(() => dbMod.createRoadmap({ name: '' })).toThrow('name is required');

    // --- Projects ---
    const defaultProjectNames = dbMod.getProjects().map((candidate) => candidate.name);
    expect(defaultProjectNames).toEqual(
      expect.arrayContaining(['Soteria', 'Curacel', 'Personal', 'Moltbot'])
    );

    const project = dbMod.createProject({ name: 'Entity', color: '#3b82f6' });
    expect(project.name).toBe('Entity');

    const projects = dbMod.getProjects();
    expect(projects.length).toBeGreaterThanOrEqual(1);

    // Task-project linking
    const taskRepo = dbMod.createTaskRepository();
    const task = taskRepo.createTask({ name: 'Linked Task' });

    expect(dbMod.addTaskProject(task.id, project.id)).toBe(true);
    expect(dbMod.addTaskProject(task.id, project.id)).toBe(false); // duplicate

    const taskProjects = dbMod.getTaskProjects(task.id);
    expect(taskProjects.length).toBe(1);
    expect(taskProjects[0].name).toBe('Entity');

    const fetchedTask = taskRepo.getTask(task.id);
    expect(fetchedTask?.projects?.map((entry) => entry.name)).toEqual(['Entity']);

    expect(dbMod.removeTaskProject(task.id, project.id)).toBe(true);
    expect(dbMod.getTaskProjects(task.id).length).toBe(0);

    const taskWithoutProjects = taskRepo.getTask(task.id);
    expect(taskWithoutProjects?.projects).toEqual([]);

    expect(dbMod.deleteProject(project.id)).toBe(true);
    expect(dbMod.deleteProject(project.id)).toBe(false);

    expect(() => dbMod.createProject({ name: '' })).toThrow('name is required');

    // --- Task History ---
    const entry = dbMod.addTaskHistory(task.id, 'column', 'backlog', 'doing', 'Ada');
    expect(entry.field).toBe('column');
    expect(entry.old_value).toBe('backlog');
    expect(entry.new_value).toBe('doing');
    expect(entry.changed_by).toBe('Ada');

    const history = dbMod.getTaskHistory(task.id);
    expect(history.length).toBe(1);

    expect(() => dbMod.addTaskHistory(1, '')).toThrow('field is required');
  });

  it('enforces org-scoped task and project query helpers', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const workspaceRepo = dbMod.createWorkspaceScopeRepository();

    const defaultOrg = workspaceRepo.listOrgs().find((org) => org.id === dbMod.DEFAULT_WORKSPACE_ORG_ID);
    expect(defaultOrg?.name).toBe('Default Workspace');
    expect(workspaceRepo.listTeams({ orgId: dbMod.DEFAULT_WORKSPACE_ORG_ID })[0]?.id)
      .toBe(dbMod.DEFAULT_WORKSPACE_TEAM_ID);

    const orgA = workspaceRepo.createOrg({ id: 'org-a', name: 'Org A' });
    const orgB = workspaceRepo.createOrg({ id: 'org-b', name: 'Org B' });
    const teamA = workspaceRepo.createTeam({ orgId: orgA.id }, { id: 'team-a', name: 'Team A' });
    const teamB = workspaceRepo.createTeam({ orgId: orgB.id }, { id: 'team-b', name: 'Team B' });
    const scopeA = { orgId: orgA.id, teamId: teamA.id };
    const scopeB = { orgId: orgB.id, teamId: teamB.id };

    const projectA = workspaceRepo.createProject(scopeA, { name: 'Org A Project' });
    const projectB = workspaceRepo.createProject(scopeB, { name: 'Org B Project' });
    expect(workspaceRepo.listProjects(scopeA).map((project) => project.name)).toContain('Org A Project');
    expect(workspaceRepo.listProjects(scopeA).map((project) => project.name)).not.toContain('Org B Project');

    const tasksA = dbMod.createOrgScopedTaskRepository(scopeA);
    const tasksB = dbMod.createOrgScopedTaskRepository(scopeB);
    const taskA = tasksA.createTask({ name: 'Scoped A', project_id: projectA.id });
    const taskB = tasksB.createTask({ name: 'Scoped B', project_id: projectB.id });

    expect(tasksA.getTask(taskA.id)?.name).toBe('Scoped A');
    expect(tasksA.getTask(taskB.id)).toBeUndefined();
    expect(tasksA.listTasks().map((task) => task.name)).toEqual(['Scoped A']);

    expect(workspaceRepo.addTaskProject(scopeA, taskA.id, projectA.id)).toBe(true);
    expect(workspaceRepo.addTaskProject(scopeA, taskA.id, projectB.id)).toBe(false);
    expect(workspaceRepo.addTaskProject(scopeB, taskA.id, projectB.id)).toBe(false);
    expect(workspaceRepo.getTaskProjects(scopeA, taskA.id).map((project) => project.id)).toEqual([projectA.id]);
    expect(workspaceRepo.getTaskProjects(scopeB, taskA.id)).toEqual([]);
  });
});
