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
      phase2_backfill?: {
        version?: string;
        inferred_fields?: Array<{
          field_name: string;
          previous_value: unknown;
          inferred_value: unknown;
          source: string;
          confidence: string;
        }>;
      };
    };
    expect(metadata.phase2_backfill?.version).toBe('THE-87');
    expect(metadata.phase2_backfill?.inferred_fields).toContainEqual(
      expect.objectContaining({
        field_name: 'owner_principal_id',
        previous_value: 'legacy-owner',
        inferred_value: 'Ada',
        source: 'assignee',
        confidence: 'medium',
      }),
    );
    expect(applied.markdown).toContain('legacy-owner -> Ada');
    expect(applied.rollbackNotes.join('\n')).toContain('previous_value');

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

  it('persists policy input layers, risk inputs, and external side effects separately from review state', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    const sideEffects = [
      {
        type: 'email_send',
        target_system: 'gmail',
        risk_level: 'high',
        sensitivity: 'customer',
        required_gate: true,
        requested_actor_principal_id: 'agent-1',
        resolution_state: 'gate_pending',
      },
    ];

    const task = repo.createTask({
      name: 'Customer send policy fixture',
      org_id: 'org-policy',
      team_id: 'team-cs',
      project_id: 42,
      worktype: 'customer_success',
      risk_level: 'high',
      agent_trust_level: 'standard',
      review_required: true,
      review_state: 'pending',
      human_gate_required: true,
      human_gate_state: 'pending',
      policy_inputs_json: JSON.stringify({
        layers: {
          workspace: { policy_id: 'workspace-default' },
          org: { policy_id: 'org-default' },
        },
      }),
      external_side_effects_json: JSON.stringify(sideEffects),
    });

    expect(task).toMatchObject({
      worktype: 'customer_success',
      risk_level: 'high',
      agent_trust_level: 'standard',
      review_required: true,
      review_state: 'pending',
      human_gate_required: true,
      human_gate_state: 'pending',
    });
    expect(task.external_side_effects).toEqual(sideEffects);

    const envelope = dbMod.buildTaskPolicyInputEnvelope(task);
    expect(Object.keys(envelope.layers)).toEqual(
      expect.arrayContaining(['workspace', 'org', 'team', 'project', 'worktype', 'task', 'risk', 'agent_trust']),
    );
    expect(envelope.layers.workspace).toMatchObject({ policy_id: 'workspace-default' });
    expect(envelope.layers.worktype).toMatchObject({ worktype: 'customer_success' });
    expect(envelope.layers.risk).toMatchObject({ risk_level: 'high', external_side_effect_count: 1 });
    expect(envelope.review).toEqual({ required: true, state: 'pending' });
    expect(envelope.human_gate).toEqual({ required: true, state: 'pending' });
    expect(envelope.external_side_effects[0]).toMatchObject({
      target_system: 'gmail',
      required_gate: true,
      requested_actor_principal_id: 'agent-1',
      resolution_state: 'gate_pending',
    });
  });

  it('validates versioned worktype overlays and applies registry risk defaults', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    const registryEntry = dbMod.getWorktypeRegistryEntry('customer_success');

    expect(registryEntry).toMatchObject({
      schema_name: 'entity.worktype.customer_success',
      schema_version: 1,
      risk_default: 'medium',
      sensitivity: 'customer',
    });

    const task = repo.createTask({
      name: 'Customer success overlay fixture',
      worktype: 'customer_success',
      agent_trust_level: 'high',
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            customer_tier: 'enterprise',
            customer_impact: 'high',
            reviewer_principal_id: 'reviewer-cs',
          },
        },
      }),
    });

    expect(task.risk_level).toBe('medium');
    const envelope = dbMod.buildTaskPolicyInputEnvelope(task);
    expect(envelope.layers.worktype).toMatchObject({
      worktype: 'customer_success',
      schema_name: 'entity.worktype.customer_success',
      schema_version: 1,
      risk_default: 'medium',
      sensitivity: 'customer',
      customer_tier: 'enterprise',
      customer_impact: 'high',
      reviewer_principal_id: 'reviewer-cs',
    });
    expect(envelope.layers.worktype.field_definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'customer_tier',
          allowed_values: ['enterprise', 'mid_market', 'smb'],
          plan_label: 'Customer tier',
        }),
      ]),
    );
  });

  it('rejects invalid values for registered worktype overlays on create and update', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    expect(() => repo.createTask({
      name: 'Invalid customer overlay fixture',
      worktype: 'customer_success',
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            customer_tier: 'strategic',
          },
        },
      }),
    })).toThrow('customer_tier must be one of enterprise, mid_market, smb');

    const task = repo.createTask({
      name: 'Valid business ops overlay fixture',
      worktype: 'business_ops',
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            process_area: 'ops',
          },
        },
      }),
    });

    expect(() => repo.updateTask(task.id, {
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            process_area: 'security',
          },
        },
      }),
    })).toThrow('process_area must be one of finance, legal, people, ops, sales');
  });

  it('degrades unknown legacy worktype overlays without blocking persistence', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    const validation = dbMod.validateWorktypePolicyInputs('legacy_ops', JSON.stringify({
      layers: {
        worktype: {
          legacy_field: 'preserved',
        },
      },
    }));

    expect(validation).toMatchObject({
      ok: true,
      degraded: true,
      worktype: 'legacy_ops',
      schema_name: null,
      schema_version: null,
      warnings: ['unknown worktype legacy_ops; preserving overlay as legacy data'],
    });

    const task = repo.createTask({
      name: 'Legacy worktype overlay fixture',
      worktype: 'legacy_ops',
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            legacy_field: 'preserved',
          },
        },
      }),
    });
    const envelope = dbMod.buildTaskPolicyInputEnvelope(task);

    expect(task.worktype).toBe('legacy_ops');
    expect(envelope.layers.worktype).toMatchObject({
      worktype: 'legacy_ops',
      registry_status: 'legacy_unknown',
      legacy_field: 'preserved',
    });
  });

  it('declares and validates sales overlay fields and indexable search fields', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    const registryEntry = dbMod.getWorktypeRegistryEntry('sales');

    expect(registryEntry).toMatchObject({
      schema_name: 'entity.worktype.sales',
      schema_version: 1,
      risk_default: 'medium',
      sensitivity: 'customer',
      plan_labels: ['Sales overlay', 'Account plan'],
    });
    expect(registryEntry?.fields.filter((field) => field.indexable).map((field) => field.name)).toEqual(
      expect.arrayContaining(['account', 'deal_stage', 'next_action']),
    );

    const task = repo.createTask({
      name: 'Sales overlay validation fixture',
      worktype: 'sales',
      agent_trust_level: 'high',
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            account: 'Acme',
            deal_stage: 'proposal',
            next_action: 'Send proposal follow-up',
            stakeholder_map: {
              buyer: 'Jane',
              legal: 'Sam',
            },
            external_send_risk: 'medium',
            crm_side_effect_type: 'crm_update',
          },
        },
      }),
    });

    const envelope = dbMod.buildTaskPolicyInputEnvelope(task);
    expect(envelope.layers.worktype).toMatchObject({
      worktype: 'sales',
      account: 'Acme',
      deal_stage: 'proposal',
      next_action: 'Send proposal follow-up',
      external_send_risk: 'medium',
      crm_side_effect_type: 'crm_update',
    });

    expect(() => repo.updateTask(task.id, {
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            account: 'Acme',
            deal_stage: 'procurement',
          },
        },
      }),
    })).toThrow('deal_stage must be one of lead, qualified, proposal, negotiation, closed_won, closed_lost');
  });

  it('contributes sales external-send and CRM risk to policy resolution', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'Sales policy risk fixture',
      worktype: 'sales',
      risk_level: 'low',
      agent_trust_level: 'high',
      owner_principal_id: 'owner-sales',
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            account: 'Acme',
            deal_stage: 'negotiation',
            next_action: 'Send revised commercial terms',
            external_send_risk: 'high',
            crm_side_effect_type: 'crm_update',
          },
          agent_trust: { trust_level: 'high' },
          risk: { risk_level: 'low' },
        },
      }),
    });

    const envelope = dbMod.buildTaskPolicyInputEnvelope(task);
    expect(envelope.layers.risk).toMatchObject({ risk_level: 'low' });
    expect(envelope.external_side_effects).toHaveLength(2);
    expect(envelope.external_side_effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'email_send',
          target_system: 'customer_email',
          risk_level: 'high',
          sensitivity: 'customer',
          requested_actor_principal_id: 'owner-sales',
        }),
        expect.objectContaining({
          type: 'crm_update',
          target_system: 'crm',
          risk_level: 'high',
          sensitivity: 'customer',
          requested_actor_principal_id: 'owner-sales',
        }),
      ]),
    );

    const resolution = dbMod.resolveTaskPolicy(envelope);
    expect(resolution.review_required).toBe(true);
    expect(resolution.human_gate_required).toBe(false);
    expect(resolution.reason_chain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'external_side_effect',
          decision: 'review_required',
          reason: 'external side effect 1 requires review',
        }),
      ]),
    );
  });

  it('declares and validates customer-success overlay fields and search fields', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    const registryEntry = dbMod.getWorktypeRegistryEntry('customer_success');

    expect(registryEntry?.fields.filter((field) => field.indexable).map((field) => field.name)).toEqual(
      expect.arrayContaining(['customer', 'health_state', 'renewal_marker', 'escalation_marker', 'support_context']),
    );

    const task = repo.createTask({
      name: 'Customer success overlay validation fixture',
      worktype: 'customer_success',
      agent_trust_level: 'high',
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            customer: 'Globex',
            health_state: 'at_risk',
            renewal_marker: 'upcoming',
            escalation_marker: 'support',
            support_context: 'P1 ticket follow-up',
            sla_risk: 'medium',
            customer_impact_risk: 'high',
            external_response_risk: 'low',
          },
        },
      }),
    });

    const envelope = dbMod.buildTaskPolicyInputEnvelope(task);
    expect(envelope.layers.worktype).toMatchObject({
      worktype: 'customer_success',
      customer: 'Globex',
      health_state: 'at_risk',
      renewal_marker: 'upcoming',
      escalation_marker: 'support',
      support_context: 'P1 ticket follow-up',
    });

    expect(() => repo.updateTask(task.id, {
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            customer: 'Globex',
            health_state: 'blocked',
          },
        },
      }),
    })).toThrow('health_state must be one of healthy, watch, at_risk, critical');
  });

  it('contributes customer-success customer-impacting risk to review and human gate policy', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'Customer success policy risk fixture',
      worktype: 'customer_success',
      risk_level: 'low',
      agent_trust_level: 'high',
      owner_principal_id: 'owner-cs',
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            customer: 'Globex',
            health_state: 'critical',
            renewal_marker: 'blocked',
            escalation_marker: 'executive',
            support_context: 'SLA breach response',
            sla_risk: 'critical',
            customer_impact_risk: 'high',
            external_response_risk: 'high',
          },
          agent_trust: { trust_level: 'high' },
          risk: { risk_level: 'low' },
        },
      }),
    });

    const envelope = dbMod.buildTaskPolicyInputEnvelope(task);
    expect(envelope.external_side_effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'customer_commitment',
          target_system: 'customer_success',
          risk_level: 'critical',
          required_gate: true,
          requested_actor_principal_id: 'owner-cs',
        }),
        expect.objectContaining({
          type: 'email_send',
          target_system: 'customer_response',
          risk_level: 'high',
          sensitivity: 'customer',
          requested_actor_principal_id: 'owner-cs',
        }),
      ]),
    );

    const resolution = dbMod.resolveTaskPolicy(envelope);
    expect(resolution.review_required).toBe(true);
    expect(resolution.human_gate_required).toBe(true);
    expect(resolution.reason_chain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'external_side_effect',
          decision: 'human_gate_required',
          reason: 'external side effect 1 requires human gate',
        }),
      ]),
    );
  });

  it('declares and validates people overlay fields and search fields', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    const registryEntry = dbMod.getWorktypeRegistryEntry('people');

    expect(registryEntry).toMatchObject({
      worktype: 'people',
      schema_name: 'entity.worktype.people',
      risk_default: 'high',
      sensitivity: 'workspace_restricted',
      plan_labels: ['People overlay', 'HR workflow'],
    });
    expect(registryEntry?.fields.filter((field) => field.indexable).map((field) => field.name)).toEqual(
      expect.arrayContaining(['candidate_ref', 'employee_ref', 'workflow_stage', 'checklist_state']),
    );

    const task = repo.createTask({
      name: 'People overlay validation fixture',
      worktype: 'people',
      agent_trust_level: 'high',
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            candidate_ref: 'candidate-123',
            employee_ref: 'employee-456',
            workflow_stage: 'onboarding',
            sensitivity_class: 'people',
            hr_side_effect_type: 'employee_record_update',
            checklist_state: 'in_progress',
            approval_required: false,
          },
        },
      }),
    });

    const envelope = dbMod.buildTaskPolicyInputEnvelope(task);
    expect(envelope.layers.worktype).toMatchObject({
      worktype: 'people',
      candidate_ref: 'candidate-123',
      employee_ref: 'employee-456',
      workflow_stage: 'onboarding',
      checklist_state: 'in_progress',
    });

    expect(() => repo.updateTask(task.id, {
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            workflow_stage: 'payroll',
          },
        },
      }),
    })).toThrow('workflow_stage must be one of sourcing, interviewing, offer, onboarding, employee_update, offboarding');
  });

  it('contributes people overlay HR sensitivity to review and human gate policy', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'People overlay policy fixture',
      worktype: 'people',
      risk_level: 'low',
      agent_trust_level: 'high',
      owner_principal_id: 'owner-people',
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            candidate_ref: 'candidate-123',
            employee_ref: 'employee-456',
            workflow_stage: 'offer',
            sensitivity_class: 'confidential',
            hr_side_effect_type: 'compensation_change',
            checklist_state: 'blocked',
            approval_required: true,
          },
          agent_trust: { trust_level: 'high' },
          risk: { risk_level: 'low' },
        },
      }),
    });

    const envelope = dbMod.buildTaskPolicyInputEnvelope(task);
    expect(envelope.external_side_effects).toEqual([
      expect.objectContaining({
        type: 'hr_action',
        target_system: 'people_ops',
        risk_level: 'critical',
        sensitivity: 'confidential',
        required_gate: true,
        requested_actor_principal_id: 'owner-people',
      }),
    ]);

    const resolution = dbMod.resolveTaskPolicy(envelope);
    expect(resolution.review_required).toBe(true);
    expect(resolution.human_gate_required).toBe(true);
    expect(resolution.reason_chain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'external_side_effect',
          decision: 'human_gate_required',
          reason: 'external side effect 1 requires human gate',
        }),
      ]),
    );
  });

  it('suppresses people overlay restricted snippets and previews', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'People restricted preview fixture',
      worktype: 'people',
      policy_inputs_json: JSON.stringify({
        layers: {
          worktype: {
            candidate_ref: 'candidate-123',
            workflow_stage: 'interviewing',
            sensitivity_class: 'people',
            hr_side_effect_type: 'candidate_message',
            checklist_state: 'in_progress',
          },
        },
      }),
    });
    const envelope = dbMod.buildTaskPolicyInputEnvelope(task);

    expect(dbMod.buildDocumentObjectPreviewEnvelope({
      object_type: 'evidence_artifact',
      title: 'Candidate loop notes',
      snippet: 'Compensation expectation and interview feedback',
      content: 'Compensation expectation and interview feedback',
      sensitivity: String(envelope.layers.worktype.sensitivity_class),
      entity_visibility_policy_json: JSON.stringify({ allow_preview: true }),
    })).toMatchObject({
      permission_state: 'restricted',
      snippet: null,
      content: null,
      reasons: ['preview_restricted_by_entity_policy'],
    });
  });

  it('keeps human gate state independent from review state and rejects malformed side effects', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const gatedWithoutReview = repo.createTask({
      name: 'Gate-only fixture',
      review_required: false,
      human_gate_required: true,
    });

    expect(gatedWithoutReview.review_required).toBe(false);
    expect(gatedWithoutReview.review_state).toBe('not_required');
    expect(gatedWithoutReview.human_gate_required).toBe(true);
    expect(gatedWithoutReview.human_gate_state).toBe('pending');

    expect(() => repo.createTask({
      name: 'Malformed side effect',
      external_side_effects_json: JSON.stringify([
        {
          type: 'crm_update',
          risk_level: 'medium',
          required_gate: true,
          requested_actor_principal_id: 'agent-1',
        },
      ]),
    })).toThrow('target_system');

    expect(() => repo.updateTask(gatedWithoutReview.id, {
      external_side_effects_json: JSON.stringify([
        {
          type: 'hr_action',
          target_system: 'hris',
          required_gate: true,
        },
      ]),
    })).toThrow('requested_actor_principal_id');
  });

  it('resolves low-risk policy inputs without adding review or human gate requirements', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'Low-risk resolver fixture',
      risk_level: 'low',
      agent_trust_level: 'high',
      policy_inputs_json: JSON.stringify({
        layers: {
          workspace: { notification_routes: ['inbox'] },
          worktype: { reviewer_principal_id: 'reviewer-1' },
          risk: { risk_level: 'low' },
          agent_trust: { trust_level: 'high' },
        },
      }),
    });

    const resolution = dbMod.resolveTaskPolicy(dbMod.buildTaskPolicyInputEnvelope(task));

    expect(resolution).toMatchObject({
      review_required: false,
      human_gate_required: false,
      reviewer_principal_id: 'reviewer-1',
      approver_principal_id: null,
      taskmaster_drivable: false,
      notification_routes: ['inbox'],
    });
    expect(resolution.reason_chain.map(({ source, decision, value }) => ({ source, decision, value }))).toEqual([
      { source: 'workspace', decision: 'notification_route', value: ['inbox'] },
      { source: 'worktype', decision: 'reviewer_target', value: 'reviewer-1' },
    ]);
  });

  it('preserves mandatory higher-layer review and human gate requirements with stable reasons', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'Mandatory policy resolver fixture',
      risk_level: 'low',
      agent_trust_level: 'high',
      policy_inputs_json: JSON.stringify({
        layers: {
          workspace: {
            review_required: true,
            human_gate_required: true,
            reviewer_principal_id: 'workspace-reviewer',
            notification_routes: ['inbox'],
            stall_threshold_hours: 48,
          },
          org: {
            review_required: false,
            human_gate_required: false,
            notification_routes: ['email'],
            stall_threshold_hours: 24,
          },
          team: {
            reviewer_principal_id: 'team-reviewer',
          },
          project: {
            approver_principal_id: 'project-approver',
          },
          worktype: {
            taskmaster_drivable: true,
            auto_reassign_after_hours: 72,
          },
          task: {
            taskmaster_drivable: false,
            auto_reassign_after_hours: 48,
          },
          risk: { risk_level: 'low' },
          agent_trust: { trust_level: 'high' },
        },
      }),
    });

    const resolution = dbMod.resolveTaskPolicy(dbMod.buildTaskPolicyInputEnvelope(task));

    expect(resolution).toMatchObject({
      review_required: true,
      human_gate_required: true,
      reviewer_principal_id: 'team-reviewer',
      approver_principal_id: 'project-approver',
      taskmaster_drivable: false,
      stall_threshold_hours: 24,
      auto_reassign_after_hours: 48,
      notification_routes: ['inbox', 'email'],
    });
    expect(resolution.reason_chain.map(({ source, decision, value }) => ({ source, decision, value }))).toMatchInlineSnapshot(`
      [
        {
          "decision": "review_required",
          "source": "workspace",
          "value": true,
        },
        {
          "decision": "human_gate_required",
          "source": "workspace",
          "value": true,
        },
        {
          "decision": "reviewer_target",
          "source": "workspace",
          "value": "workspace-reviewer",
        },
        {
          "decision": "stall_threshold",
          "source": "workspace",
          "value": 48,
        },
        {
          "decision": "notification_route",
          "source": "workspace",
          "value": [
            "inbox",
          ],
        },
        {
          "decision": "review_requirement_retained",
          "source": "org",
          "value": true,
        },
        {
          "decision": "human_gate_requirement_retained",
          "source": "org",
          "value": true,
        },
        {
          "decision": "stall_threshold",
          "source": "org",
          "value": 24,
        },
        {
          "decision": "notification_route",
          "source": "org",
          "value": [
            "inbox",
            "email",
          ],
        },
        {
          "decision": "reviewer_target",
          "source": "team",
          "value": "team-reviewer",
        },
        {
          "decision": "approver_target",
          "source": "project",
          "value": "project-approver",
        },
        {
          "decision": "taskmaster_drivable",
          "source": "worktype",
          "value": true,
        },
        {
          "decision": "auto_reassignment_threshold",
          "source": "worktype",
          "value": 72,
        },
        {
          "decision": "taskmaster_drivable",
          "source": "task",
          "value": false,
        },
        {
          "decision": "auto_reassignment_threshold",
          "source": "task",
          "value": 48,
        },
        {
          "decision": "reviewer_assignment",
          "source": "task_projection",
          "value": "team-reviewer",
        },
      ]
    `);
  });

  it('caches Task Master routing policy projections with threshold and route provenance', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'Task Master drivable projection fixture',
      taskmaster_drivable: true,
      risk_level: 'low',
      agent_trust_level: 'high',
      policy_inputs_json: JSON.stringify({
        layers: {
          workspace: {
            notification_routes: ['inbox', 'email'],
            stall_threshold_hours: 6,
          },
          worktype: {
            auto_reassign_after_hours: 24,
          },
          risk: { risk_level: 'low' },
          agent_trust: { trust_level: 'high' },
        },
      }),
    });

    const resolution = dbMod.resolveTaskPolicy(dbMod.buildTaskPolicyInputEnvelope(task));
    expect(task).toMatchObject({
      taskmaster_drivable: true,
      assignment_state: 'unassigned',
    });
    expect(resolution.routing_policy_projection).toMatchObject({
      taskmaster_drivable: true,
      stall_threshold_hours: 6,
      notification_routes: ['inbox', 'email'],
      escalation_eligible: true,
      auto_reassign_eligible: true,
      auto_reassign_after_hours: 24,
      high_risk_excluded: false,
    });
    expect(
      resolution.routing_policy_projection.reason_chain.map(({ source, decision, value }) => ({
        source,
        decision,
        value,
      })),
    ).toEqual(
      expect.arrayContaining([
        { source: 'task', decision: 'taskmaster_drivable', value: true },
        { source: 'workspace', decision: 'stall_threshold', value: 6 },
        { source: 'workspace', decision: 'notification_route', value: ['inbox', 'email'] },
        { source: 'worktype', decision: 'auto_reassignment_threshold', value: 24 },
        { source: 'task_projection', decision: 'escalation_eligibility', value: true },
        { source: 'task_projection', decision: 'reassignment_eligibility', value: true },
      ]),
    );

    const metadata = JSON.parse(task.metadata ?? '{}') as {
      routing_policy_projection?: Record<string, unknown>;
    };
    expect(metadata.routing_policy_projection).toMatchObject({
      taskmaster_drivable: true,
      escalation_eligible: true,
      auto_reassign_eligible: true,
      auto_reassign_after_hours: 24,
    });
  });

  it('represents high-risk exclusions in Task Master routing policy projections', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'High-risk Task Master exclusion fixture',
      taskmaster_drivable: true,
      risk_level: 'high',
      agent_trust_level: 'high',
      policy_inputs_json: JSON.stringify({
        layers: {
          workspace: {
            notification_routes: ['inbox'],
            stall_threshold_hours: 4,
          },
          worktype: {
            auto_reassign_after_hours: 8,
          },
          task: {
            taskmaster_drivable: true,
          },
          risk: { risk_level: 'high' },
          agent_trust: { trust_level: 'high' },
        },
      }),
    });

    const resolution = dbMod.resolveTaskPolicy(dbMod.buildTaskPolicyInputEnvelope(task));
    expect(task).toMatchObject({
      taskmaster_drivable: false,
      assignment_state: 'routing_problem',
    });
    expect(resolution.review_required).toBe(true);
    expect(resolution.routing_policy_projection).toMatchObject({
      taskmaster_drivable: false,
      escalation_eligible: true,
      auto_reassign_eligible: false,
      high_risk_excluded: true,
      high_risk_exclusion_reasons: ['high risk'],
    });
    expect(
      resolution.routing_policy_projection.reason_chain.map(({ source, decision, value }) => ({
        source,
        decision,
        value,
      })),
    ).toEqual(
      expect.arrayContaining([
        { source: 'task_projection', decision: 'taskmaster_high_risk_exclusion', value: false },
        { source: 'task_projection', decision: 'reassignment_eligibility', value: false },
      ]),
    );

    const metadata = JSON.parse(task.metadata ?? '{}') as {
      routing_policy_projection?: {
        high_risk_excluded?: boolean;
        high_risk_exclusion_reasons?: string[];
        auto_reassign_eligible?: boolean;
      };
    };
    expect(metadata.routing_policy_projection).toMatchObject({
      high_risk_excluded: true,
      high_risk_exclusion_reasons: ['high risk'],
      auto_reassign_eligible: false,
    });
  });

  it('atomically claims unassigned Task-Master-drivable work and preserves the original unassigned state', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'Claimable Task Master work',
      column: 'todo',
      taskmaster_drivable: true,
      risk_level: 'low',
      agent_trust_level: 'high',
      policy_inputs_json: JSON.stringify({
        layers: {
          task: { taskmaster_drivable: true },
          risk: { risk_level: 'low' },
          agent_trust: { trust_level: 'high' },
        },
      }),
    });

    const result = repo.claimTaskForTaskMaster(task.id, {
      taskmaster_principal_id: 'task-master',
      claimed_at: '2026-06-24T01:00:00.000Z',
      claim_request_id: 'claim-1',
      policy_reason: 'policy marked the unassigned task drivable',
    });

    expect(result).toMatchObject({
      status: 'claimed',
      claimed: true,
      previousTask: {
        assignee: 'Unassigned',
        executor_principal_id: null,
        assignment_state: 'unassigned',
        taskmaster_drivable: true,
      },
      task: {
        assignee: 'Unassigned',
        executor_principal_id: 'task-master',
        assignment_state: 'claimed',
        taskmaster_drivable: true,
      },
      claim: {
        taskmaster_principal_id: 'task-master',
        claimed_at: '2026-06-24T01:00:00.000Z',
        claim_request_id: 'claim-1',
        previous_assignee: 'Unassigned',
        previous_executor_principal_id: null,
        previous_assignment_state: 'unassigned',
        previous_taskmaster_drivable: true,
      },
    });

    const metadata = JSON.parse(result.task?.metadata ?? '{}') as Record<string, unknown>;
    expect(metadata.taskmaster_claim).toMatchObject({
      claim_request_id: 'claim-1',
      previous_assignment_state: 'unassigned',
    });
    expect(metadata.taskmaster_claim_original_unassigned).toMatchObject({
      assignee: 'Unassigned',
      executor_principal_id: null,
      assignment_state: 'unassigned',
      taskmaster_drivable: true,
    });
  });

  it('refuses Task Master claims for assigned or non-drivable work', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const assigned = repo.createTask({
      name: 'Assigned work stays owned',
      column: 'todo',
      assignee: 'Ada',
      executor_principal_id: 'agent-1',
      taskmaster_drivable: true,
    });
    const nonDrivable = repo.createTask({
      name: 'Non-drivable unassigned work',
      column: 'todo',
      taskmaster_drivable: false,
    });

    expect(repo.claimTaskForTaskMaster(assigned.id)).toMatchObject({
      status: 'not_claimable',
      claimed: false,
      task: {
        executor_principal_id: 'agent-1',
        assignment_state: 'assigned',
      },
    });
    expect(repo.claimTaskForTaskMaster(nonDrivable.id)).toMatchObject({
      status: 'not_claimable',
      claimed: false,
      task: {
        executor_principal_id: null,
        assignment_state: 'routing_problem',
        taskmaster_drivable: false,
      },
    });
  });

  it('handles double-claim races deterministically with one transition winner', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'Race claim fixture',
      column: 'todo',
      taskmaster_drivable: true,
      risk_level: 'low',
      agent_trust_level: 'high',
      policy_inputs_json: JSON.stringify({
        layers: {
          task: { taskmaster_drivable: true },
          risk: { risk_level: 'low' },
          agent_trust: { trust_level: 'high' },
        },
      }),
    });

    const results = await Promise.all([
      Promise.resolve().then(() =>
        repo.claimTaskForTaskMaster(task.id, {
          taskmaster_principal_id: 'task-master',
          claim_request_id: 'claim-a',
        }),
      ),
      Promise.resolve().then(() =>
        repo.claimTaskForTaskMaster(task.id, {
          taskmaster_principal_id: 'task-master',
          claim_request_id: 'claim-b',
        }),
      ),
    ]);

    expect(results.filter((result) => result.status === 'claimed')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'already_claimed')).toHaveLength(1);
    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(repo.getTask(task.id)).toMatchObject({
      executor_principal_id: 'task-master',
      assignment_state: 'claimed',
    });
  });

  it('escalates review and human gate requirements from risk, trust, and external side effects', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'Escalated resolver fixture',
      risk_level: 'critical',
      agent_trust_level: 'low',
      policy_inputs_json: JSON.stringify({
        layers: {
          risk: { risk_level: 'critical' },
          agent_trust: { trust_level: 'low' },
        },
      }),
      external_side_effects_json: JSON.stringify([
        {
          type: 'crm_update',
          target_system: 'salesforce',
          risk_level: 'high',
          sensitivity: 'customer',
          required_gate: true,
          requested_actor_principal_id: 'agent-1',
          resolution_state: 'gate_pending',
        },
      ]),
    });

    const resolution = dbMod.resolveTaskPolicy(dbMod.buildTaskPolicyInputEnvelope(task));

    expect(resolution.review_required).toBe(true);
    expect(resolution.human_gate_required).toBe(true);
    expect(resolution.reason_chain.map(({ source, decision, value }) => ({ source, decision, value }))).toEqual([
      { source: 'risk', decision: 'review_required', value: true },
      { source: 'risk', decision: 'human_gate_required', value: true },
      { source: 'agent_trust', decision: 'review_required', value: true },
      { source: 'external_side_effect', decision: 'review_required', value: true },
      { source: 'external_side_effect', decision: 'human_gate_required', value: true },
      { source: 'task_projection', decision: 'reviewer_routing_problem', value: null },
    ]);
  });

  it('assigns the initiator as reviewer when separation-of-duties allows it', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'Initiator reviewer fixture',
      created_by_principal_id: 'creator-1',
      initiator_principal_id: 'requester-1',
      owner_principal_id: 'owner-1',
      owner_principal_type: 'human',
      executor_principal_id: 'agent-1',
      review_required: true,
      policy_inputs_json: JSON.stringify({
        layers: {
          task: {
            submitted_by_principal_id: 'agent-1',
            assignee_principal_id: 'agent-1',
          },
          risk: { risk_level: 'low' },
          agent_trust: { trust_level: 'high' },
        },
      }),
    });

    const resolution = dbMod.resolveTaskPolicy(dbMod.buildTaskPolicyInputEnvelope(task));

    expect(resolution.reviewer_principal_id).toBe('requester-1');
    expect(resolution.reviewer_assignment).toMatchObject({
      reviewer_principal_id: 'requester-1',
      assignment_mode: 'initiator',
      routing_problem: false,
      skipped_candidates: [],
    });
    expect(resolution.reason_chain.map(({ decision, value }) => ({ decision, value }))).toContainEqual({
      decision: 'reviewer_assignment',
      value: 'requester-1',
    });
  });

  it('skips self-review candidates and falls back to the same-team reviewer pool', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const task = repo.createTask({
      name: 'Reviewer pool fallback fixture',
      created_by_principal_id: 'creator-1',
      initiator_principal_id: 'agent-1',
      owner_principal_id: 'owner-1',
      owner_principal_type: 'human',
      executor_principal_id: 'agent-1',
      review_required: true,
      policy_inputs_json: JSON.stringify({
        layers: {
          team: {
            reviewer_pool_principal_ids: ['agent-1', 'reviewer-1'],
          },
          task: {
            submitted_by_principal_id: 'agent-1',
            assignee_principal_id: 'agent-1',
          },
          risk: { risk_level: 'low' },
          agent_trust: { trust_level: 'high' },
        },
      }),
    });

    const resolution = dbMod.resolveTaskPolicy(dbMod.buildTaskPolicyInputEnvelope(task));

    expect(resolution.reviewer_principal_id).toBe('reviewer-1');
    expect(resolution.reviewer_assignment).toMatchObject({
      reviewer_principal_id: 'reviewer-1',
      assignment_mode: 'reviewer_pool',
      routing_problem: false,
      skipped_candidates: [
        {
          principal_id: 'agent-1',
          role: 'initiator',
          reason: 'initiator is also the assignee',
        },
        {
          principal_id: 'agent-1',
          role: 'reviewer_pool',
          reason: 'reviewer_pool candidate is also the assignee',
        },
      ],
    });
    expect(resolution.reason_chain.map(({ source, decision, value }) => ({ source, decision, value }))).toEqual(
      expect.arrayContaining([
        { source: 'task_projection', decision: 'reviewer_candidate_skipped', value: 'agent-1' },
        { source: 'task_projection', decision: 'reviewer_assignment', value: 'reviewer-1' },
      ]),
    );
  });

  it('falls back to owner or reports a routing problem when no reviewer is eligible', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const ownerFallbackTask = repo.createTask({
      name: 'Owner reviewer fallback fixture',
      created_by_principal_id: 'creator-1',
      initiator_principal_id: 'agent-1',
      owner_principal_id: 'owner-1',
      owner_principal_type: 'human',
      executor_principal_id: 'agent-1',
      review_required: true,
      policy_inputs_json: JSON.stringify({
        layers: {
          team: {
            reviewer_pool_principal_ids: ['agent-1'],
          },
          task: {
            submitted_by_principal_id: 'agent-1',
            assignee_principal_id: 'agent-1',
          },
          risk: { risk_level: 'low' },
          agent_trust: { trust_level: 'high' },
        },
      }),
    });

    const ownerFallback = dbMod.resolveTaskPolicy(dbMod.buildTaskPolicyInputEnvelope(ownerFallbackTask));
    expect(ownerFallback.reviewer_assignment).toMatchObject({
      reviewer_principal_id: 'owner-1',
      assignment_mode: 'owner',
      routing_problem: false,
    });

    const noEligibleTask = repo.createTask({
      name: 'Reviewer routing problem fixture',
      created_by_principal_id: 'creator-1',
      initiator_principal_id: 'agent-1',
      owner_principal_id: 'agent-1',
      owner_principal_type: 'agent',
      executor_principal_id: 'agent-1',
      review_required: true,
      policy_inputs_json: JSON.stringify({
        layers: {
          team: {
            reviewer_pool_principal_ids: ['agent-1'],
          },
          task: {
            submitted_by_principal_id: 'agent-1',
            assignee_principal_id: 'agent-1',
          },
          risk: { risk_level: 'low' },
          agent_trust: { trust_level: 'high' },
        },
      }),
    });

    const noEligible = dbMod.resolveTaskPolicy(dbMod.buildTaskPolicyInputEnvelope(noEligibleTask));
    expect(noEligible.reviewer_principal_id).toBeNull();
    expect(noEligible.reviewer_assignment).toMatchObject({
      reviewer_principal_id: null,
      assignment_mode: 'routing_problem',
      routing_problem: true,
      routing_problem_reason: 'no eligible reviewer found for separation-of-duties policy',
    });
    expect(noEligible.reason_chain.map(({ source, decision, value }) => ({ source, decision, value }))).toContainEqual({
      source: 'task_projection',
      decision: 'reviewer_routing_problem',
      value: null,
    });
  });

  it('blocks done while required review or human gate decisions are unresolved', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    const task = repo.createTask({
      name: 'Gate before done fixture',
      created_by_principal_id: 'creator-1',
      initiator_principal_id: 'agent-1',
      owner_principal_id: 'owner-1',
      owner_principal_type: 'human',
      executor_principal_id: 'agent-1',
      assignee: 'agent-1',
      column: 'review',
      review_required: true,
      review_state: 'pending',
      human_gate_required: true,
      human_gate_state: 'pending',
      policy_inputs_json: JSON.stringify({
        layers: {
          team: { reviewer_pool_principal_ids: ['reviewer-1'] },
          project: { approver_principal_id: 'approver-1' },
          task: {
            assignee_principal_id: 'agent-1',
            submitted_by_principal_id: 'agent-1',
          },
        },
      }),
    });

    expect(dbMod.validateTaskDoneReviewGateState(task)).toMatchObject({
      ok: false,
      code: 'review_unresolved_before_done',
    });

    const reviewed = dbMod.buildTaskReviewDecisionUpdates({
      task,
      actor_principal_id: 'reviewer-1',
      decision: 'accepted',
      reason: 'evidence checked',
      decided_at: '2026-06-24T00:01:00.000Z',
    });
    expect(reviewed).toMatchObject({ ok: true });
    const afterReview = repo.updateTask(task.id, reviewed.ok ? reviewed.updates : {});
    expect(afterReview).toMatchObject({ review_state: 'accepted' });
    expect(dbMod.validateTaskDoneReviewGateState(afterReview!)).toMatchObject({
      ok: false,
      code: 'human_gate_unresolved_before_done',
    });

    const approved = dbMod.buildTaskHumanGateDecisionUpdates({
      task: afterReview!,
      actor_principal_id: 'approver-1',
      actor_type: 'human',
      decision: 'approved',
      reason: 'approved before completion',
      decided_at: '2026-06-24T00:02:00.000Z',
    });
    expect(approved).toMatchObject({ ok: true });
    const afterGate = repo.updateTask(task.id, approved.ok ? approved.updates : {});

    expect(dbMod.validateTaskDoneReviewGateState(afterGate!)).toMatchObject({ ok: true });
    expect(JSON.parse(afterGate?.metadata ?? '{}')).toMatchObject({
      review_decision: 'accepted',
      human_gate_decision: 'approved',
    });
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

  it('lists only subtasks linked to a parent without loading all tasks', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();

    const parent = repo.createTask({ name: 'Parent task' });
    const firstChild = repo.createTask({
      name: 'First child',
      metadata: JSON.stringify({ parent_task_id: parent.id }),
    });
    const secondChild = repo.createTask({
      name: 'Second child',
      metadata: JSON.stringify({ parentTaskId: parent.id }),
    });
    repo.createTask({
      name: 'Other parent child',
      metadata: JSON.stringify({ parent_id: parent.id + 1000 }),
    });
    repo.createTask({ name: 'Unrelated task' });

    const subtasks = repo.listSubtasks(parent.id);

    expect(subtasks.map((task) => task.id).sort((left, right) => left - right)).toEqual([
      firstChild.id,
      secondChild.id,
    ]);
    expect(repo.listSubtasks(0)).toEqual([]);
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

  it('purges a deleted task\'s comments and activity (no orphans on id reuse)', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createTaskRepository();
    const commentRepo = dbMod.createTaskCommentRepository();
    const activityRepo = dbMod.createActivityRepository();

    const task = repo.createTask({ name: 'Has children' });
    commentRepo.createComment({ task_id: task.id, body: 'orphan candidate', author: 'Ada' });
    activityRepo.createActivity({ type: 'task_comment', action: 'Added comment', description: 'x', task_id: task.id });

    expect(commentRepo.listComments(task.id).length).toBe(1);
    expect(activityRepo.listActivitiesByTaskId(task.id).length).toBe(1);

    expect(repo.deleteTask(task.id)).toBe(true);

    // Child rows keyed by the task id must be gone so a future task that reuses
    // the id does not inherit them.
    expect(commentRepo.listComments(task.id).length).toBe(0);
    expect(activityRepo.listActivitiesByTaskId(task.id).length).toBe(0);
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

describe('NotificationRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('stores canonical event/object links separately from external delivery status', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const activityRepo = dbMod.createActivityRepository();
    const notificationRepo = dbMod.createNotificationRepository();
    const task = dbMod.createTaskRepository().createTask({
      name: 'Review notification task',
      org_id: 'org-notify',
      owner_principal_id: 'owner-1',
    });
    const event = activityRepo.createActivity({
      type: 'task_updated',
      activity_event_type: 'review_requested',
      activity_event_payload: {
        actor_type: 'system',
        task_id: task.id,
        object_refs: [{ object_type: 'task', object_id: String(task.id), link_role: 'review' }],
      },
      action: 'Review requested',
      description: 'A reviewer must inspect the work.',
      task_id: task.id,
    });

    const notification = notificationRepo.createNotification({
      id: 'notification-review-1',
      org_id: 'org-notify',
      recipient_principal_id: 'reviewer-1',
      canonical_event_id: event.id,
      object_ref: { object_type: 'task', object_id: String(task.id), link_role: 'review' },
      notification_type: 'review_request',
      title: 'Review requested',
      body: 'Please review this task.',
      policy_reason_chain_json: JSON.stringify([
        { source: 'task', decision: 'notification_route', reason: 'review pending' },
      ]),
      deliveries: [
        {
          channel: 'entity_inbox',
          status: 'sent',
          policy_reason_json: JSON.stringify({ route: 'canonical_inbox' }),
        },
        {
          channel: 'slack',
          status: 'failed',
          external_ref: 'slack-msg-1',
          failure_reason: 'channel unavailable',
          policy_reason_json: JSON.stringify({ route: 'reviewer_preference' }),
        },
      ],
    });

    expect(notification).toMatchObject({
      id: 'notification-review-1',
      org_id: 'org-notify',
      recipient_principal_id: 'reviewer-1',
      canonical_event_id: String(event.id),
      notification_type: 'review_request',
      inbox_state: 'unread',
      object_ref: { object_type: 'task', object_id: String(task.id), link_role: 'review' },
    });
    expect(notification.deliveries).toEqual([
      expect.objectContaining({ channel: 'entity_inbox', status: 'sent' }),
      expect.objectContaining({ channel: 'slack', status: 'failed', failure_reason: 'channel unavailable' }),
    ]);

    const read = notificationRepo.updateInboxState(notification.id, 'read');
    expect(read?.inbox_state).toBe('read');
    expect(read?.deliveries.find((delivery) => delivery.channel === 'slack')?.status).toBe('failed');
    expect(notificationRepo.listNotificationsForRecipient({
      org_id: 'org-notify',
      recipient_principal_id: 'reviewer-1',
      inbox_state: 'unread',
    })).toEqual([]);
    expect(notificationRepo.listNotificationsForRecipient({
      org_id: 'org-notify',
      recipient_principal_id: 'reviewer-1',
      inbox_state: 'all',
    })).toHaveLength(1);
  });

  it('provides fixture samples for every canonical PRD notification type', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const notificationRepo = dbMod.createNotificationRepository();
    const samples = dbMod.buildNotificationFixtureSamples({
      org_id: 'org-fixture',
      recipient_principal_id: 'owner-fixture',
      canonical_event_id: 'event-fixture',
      task_id: 101,
    });

    expect(samples.map((sample) => sample.notification_type).sort()).toEqual(
      [...dbMod.NOTIFICATION_TYPES].sort(),
    );

    const records = samples.map((sample) => notificationRepo.createNotification(sample));
    expect(records).toHaveLength(8);
    expect(records.map((record) => record.notification_type)).toEqual(
      expect.arrayContaining([
        'review_request',
        'human_gate_request',
        'task_nudge',
        'owner_escalation',
        'auto_reassignment_notice',
        'receipt_failure',
        'connector_degraded',
        'policy_warning',
      ]),
    );
    expect(records.every((record) => record.object_ref.object_type === 'task')).toBe(true);
    expect(records.every((record) => record.deliveries[0]?.channel === 'entity_inbox')).toBe(true);
  });

  it('rejects malformed notification records before persistence', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const notificationRepo = dbMod.createNotificationRepository();

    expect(() => notificationRepo.createNotification({
      recipient_principal_id: 'owner-1',
      canonical_event_id: 'event-1',
      object_ref: { object_type: 'task', object_id: '1', link_role: 'target' },
      notification_type: 'unknown_notification',
      title: 'Bad type',
    })).toThrow('notification_type must be one of');

    expect(() => notificationRepo.createNotification({
      recipient_principal_id: 'owner-1',
      canonical_event_id: 'event-1',
      object_ref: { object_type: 'task', object_id: '1', link_role: '' },
      notification_type: 'task_nudge',
      title: 'Bad ref',
    })).toThrow('ObjectRef requires object_type, object_id, and link_role');
  });
});

describe('DocumentObjectRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('keeps NativeDocument, ExternalDocumentRef, and EvidenceArtifact concepts distinct with ObjectRef links', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createDocumentObjectRepository();
    const artifactRepo = dbMod.createEvidenceArtifactRepository();
    const task = dbMod.createTaskRepository().createTask({ name: 'Document Object Task' });
    const taskRef = { object_type: 'task', object_id: String(task.id), link_role: 'context' };

    const nativeDoc = repo.createNativeDocument({
      id: 'native-doc-1',
      title: 'Internal renewal note',
      document_kind: 'note',
      stable_path: '/documents/native/native-doc-1.md',
      content_hash: 'sha256:native-doc',
      mutability_policy: 'editable_versioned',
      linked_object_refs: [taskRef],
    });
    const externalRef = repo.createExternalDocumentRef({
      id: 'external-doc-1',
      connector_type: 'google_docs',
      external_id: 'gdoc-123',
      title: 'Customer-owned account plan',
      auth_state: 'authorized',
      readiness_state: 'ready',
      linked_object_refs: [{ object_type: 'task', object_id: String(task.id), link_role: 'source_context' }],
    });
    const artifact = artifactRepo.createArtifact({
      id: 'evidence-artifact-1',
      artifact_kind: 'review_packet',
      title: 'Review packet artifact',
      stable_path: '/artifacts/evidence/evidence-artifact-1.md',
      content_hash: 'sha256:evidence',
      linked_object_refs: [{ object_type: 'task', object_id: String(task.id), link_role: 'proof' }],
    });

    expect(nativeDoc).toMatchObject({
      id: 'native-doc-1',
      document_kind: 'note',
      body_format: 'markdown',
      mutability_policy: 'editable_versioned',
      stable_path: '/documents/native/native-doc-1.md',
    });
    expect(nativeDoc.linked_object_refs).toEqual([taskRef]);
    expect(externalRef).toMatchObject({
      id: 'external-doc-1',
      connector_type: 'google_docs',
      external_id: 'gdoc-123',
      auth_state: 'authorized',
      readiness_state: 'ready',
      canonicality: 'unknown',
    });
    expect(JSON.parse(externalRef.capabilities_json)).toMatchObject({ read: true, preview: true, write: false });
    expect(artifact).toMatchObject({
      id: 'evidence-artifact-1',
      artifact_kind: 'review_packet',
      stable_path: '/artifacts/evidence/evidence-artifact-1.md',
    });
    expect(artifact.linked_object_refs).toEqual([
      { object_type: 'task', object_id: String(task.id), link_role: 'proof' },
    ]);
  });

  it('persists Google connector auth scopes, expiry, ref state, and read-only V1 capabilities', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createDocumentObjectRepository();

    expect(dbMod.GOOGLE_CONNECTOR_V1_SCOPES).toEqual(['read', 'index', 'link', 'preview']);

    const externalRef = repo.createExternalDocumentRef({
      id: 'google-connector-auth-model',
      connector_type: 'google_drive',
      external_id: 'drive-file-auth-model',
      title: 'Google connector auth fixture',
      auth_state: 'expired',
      readiness_state: 'unavailable',
      granted_scopes: ['read', 'index', 'write', 'preview'],
      missing_scopes: ['link', 'export'],
      auth_expires_at: '2026-06-24T08:20:00Z',
      external_ref_state: 'permission_revoked',
      external_permission_summary: 'Drive permission revoked for connector account',
      entity_visibility_policy_json: JSON.stringify({ visibility: 'restricted', allowed_principal_ids: ['owner-1'] }),
      capabilities_json: JSON.stringify({ read: true, index: true, link: true, preview: true, write: true, export: true, sync: true }),
    });

    expect(externalRef).toMatchObject({
      id: 'google-connector-auth-model',
      connector_type: 'google_drive',
      auth_state: 'expired',
      readiness_state: 'unavailable',
      granted_scopes: ['read', 'index', 'preview'],
      missing_scopes: ['link'],
      auth_expires_at: '2026-06-24T08:20:00.000Z',
      external_ref_state: 'permission_revoked',
      external_permission_summary: 'Drive permission revoked for connector account',
      entity_visibility_policy_json: JSON.stringify({ visibility: 'restricted', allowed_principal_ids: ['owner-1'] }),
    });
    expect(JSON.parse(externalRef.capabilities_json)).toEqual({
      read: true,
      index: true,
      link: true,
      preview: true,
      write: false,
      export: false,
      sync: false,
      create: false,
      update: false,
    });
  });

  it('lists and searches Google external document metadata by org, connector, query, and object ref', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createDocumentObjectRepository();
    const linkedTaskRef = { object_type: 'task', object_id: '82', link_role: 'source_context' };

    repo.createExternalDocumentRef({
      id: 'google-docs-metadata-list',
      org_id: 'org-a',
      connector_type: 'google_docs',
      external_id: 'docs-list-82',
      title: 'Board Account Plan',
      external_permission_summary: 'authorized metadata read',
      linked_object_refs: [linkedTaskRef],
      metadata_json: JSON.stringify({ snippet: 'renewal board packet' }),
    });
    repo.createExternalDocumentRef({
      id: 'google-drive-metadata-list',
      org_id: 'org-a',
      connector_type: 'google_drive',
      external_id: 'drive-list-82',
      title: 'Drive Renewal Folder',
      linked_object_refs: [linkedTaskRef],
    });
    repo.createExternalDocumentRef({
      id: 'other-org-google-doc',
      org_id: 'org-b',
      connector_type: 'google_docs',
      external_id: 'docs-other-org',
      title: 'Other org board plan',
      linked_object_refs: [linkedTaskRef],
    });

    expect(repo.listExternalDocumentRefs({
      org_id: 'org-a',
      connector_type: 'google_docs',
      query: 'board',
      linked_object_ref: linkedTaskRef,
    }).map((entry) => entry.id)).toEqual(['google-docs-metadata-list']);
    expect(repo.listExternalDocumentRefs({
      org_id: 'org-a',
      query: 'renewal',
      limit: 1,
    })).toHaveLength(1);
  });

  it('rejects malformed ObjectRef links before persisting document objects', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createDocumentObjectRepository();

    expect(() => repo.createNativeDocument({
      title: 'Bad object ref',
      content_hash: 'sha256:bad-ref',
      linked_object_refs: [{ object_type: 'task', object_id: '1', link_role: '' }],
    })).toThrow('ObjectRef requires object_type, object_id, and link_role');
  });

  it('links native documents and external refs to objects without duplicating ObjectRefs', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createDocumentObjectRepository();
    const task = dbMod.createTaskRepository().createTask({ name: 'Document Link Task' });
    const objectRef = { object_type: 'task', object_id: String(task.id), link_role: 'source_context' };

    repo.createNativeDocument({
      id: 'native-link-doc',
      title: 'Native linked note',
      content_hash: 'sha256:native-link',
    });
    repo.createExternalDocumentRef({
      id: 'external-link-doc',
      connector_type: 'google_docs',
      external_url: 'https://docs.example.test/document/abc',
      title: 'External linked note',
    });

    expect(repo.linkNativeDocumentObject('native-link-doc', objectRef)?.linked_object_refs).toEqual([objectRef]);
    expect(repo.linkNativeDocumentObject('native-link-doc', objectRef)?.linked_object_refs).toEqual([objectRef]);
    expect(repo.linkExternalDocumentObject('external-link-doc', objectRef)?.linked_object_refs).toEqual([objectRef]);
    expect(repo.getExternalDocumentRef('external-link-doc')).toMatchObject({
      canonicality: 'unknown',
    });
  });

  it('versions editable native documents and rejects immutable native overwrites', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createDocumentObjectRepository();

    repo.createNativeDocument({
      id: 'native-version-doc',
      title: 'Versioned native doc',
      stable_path: '/documents/native/native-version-doc.md',
      content_hash: 'sha256:native-v1',
      metadata_json: JSON.stringify({ version: 1 }),
    });

    const updated = repo.updateNativeDocumentVersion('native-version-doc', {
      content_hash: 'sha256:native-v2',
      metadata_json: JSON.stringify({ version: 2 }),
      updated_by_principal_id: 'human-editor',
    });

    expect(updated).toMatchObject({
      id: 'native-version-doc',
      version: 2,
      stable_path: '/documents/native/native-version-doc.md',
      content_hash: 'sha256:native-v2',
      metadata_json: JSON.stringify({ version: 2 }),
    });
    expect(repo.listNativeDocumentVersions('native-version-doc')).toMatchObject([
      { document_id: 'native-version-doc', version: 1, content_hash: 'sha256:native-v1' },
      { document_id: 'native-version-doc', version: 2, content_hash: 'sha256:native-v2', created_by_principal_id: 'human-editor' },
    ]);

    repo.createNativeDocument({
      id: 'native-immutable-doc',
      title: 'Immutable native doc',
      content_hash: 'sha256:immutable-v1',
      mutability_policy: 'immutable',
    });

    expect(() => repo.updateNativeDocumentVersion('native-immutable-doc', {
      content_hash: 'sha256:immutable-v2',
    })).toThrow('immutable native documents cannot be overwritten; create a superseding document');
  });

  it('plans a non-destructive migration path for vague legacy file and artifact references', async () => {
    const dbMod = await import('../../../../packages/db/src/index');

    expect(dbMod.planLegacyFileArtifactReferenceMigration({
      source_table: 'tasks',
      source_field: 'metadata.review_packet.output_artifact',
      legacy_value: '/artifacts/evidence/receipt-123.md',
      task_id: 42,
      link_role: 'proof',
    })).toMatchObject({
      object_ref: { object_type: 'evidence_artifact', object_id: 'receipt-123', link_role: 'proof' },
      confidence: 'medium',
      warnings: [],
    });

    expect(dbMod.planLegacyFileArtifactReferenceMigration({
      source_table: 'tasks',
      source_field: 'metadata.file',
      legacy_value: 'loose-upload.txt',
    })).toMatchObject({
      object_ref: null,
      confidence: 'low',
      warnings: ['ambiguous_document_reference', 'missing_task_context'],
    });
  });

  it('dry-runs existing docs and artifacts into target object types without mutating rows', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const taskRepo = dbMod.createTaskRepository();
    const activityRepo = dbMod.createActivityRepository();
    const documentRepo = dbMod.createDocumentObjectRepository();
    const artifactRepo = dbMod.createEvidenceArtifactRepository();

    const task = taskRepo.createTask({
      name: 'Legacy docs migration candidate',
      output: '/documents/native/legacy-summary.md',
      metadata: JSON.stringify({
        review_packet: {
          output_artifact: '/artifacts/evidence/receipt-legacy.md',
          evidence: [
            'external:https://docs.example.test/customer-plan',
            'loose-upload.txt',
          ],
        },
      }),
    });
    activityRepo.createActivity({
      type: 'file_edit',
      action: 'Attached proof file',
      description: 'Legacy activity file path',
      task_id: task.id,
      file_path: '/artifacts/evidence/activity-proof.md',
    });
    documentRepo.createNativeDocument({
      id: 'existing-native-doc',
      title: 'Existing native doc',
      content_hash: 'sha256:existing-native',
    });
    documentRepo.createExternalDocumentRef({
      id: 'existing-external-ref',
      connector_type: 'google_docs',
      external_url: 'https://docs.example.test/existing-external-ref',
      title: 'Existing external ref',
    });
    artifactRepo.createArtifact({
      id: 'existing-evidence-artifact',
      title: 'Existing artifact',
      content_hash: 'sha256:existing-artifact',
    });

    const beforeTask = taskRepo.getTask(task.id);
    const dryRun = dbMod.dryRunDocumentArtifactObjectMigration();
    const secondDryRun = dbMod.dryRunDocumentArtifactObjectMigration();
    const afterTask = taskRepo.getTask(task.id);

    expect(afterTask?.metadata).toBe(beforeTask?.metadata);
    expect(afterTask?.output).toBe(beforeTask?.output);
    expect(dryRun).toMatchObject({
      dryRun: true,
      totalCandidates: 5,
      classifiedCandidates: 4,
      existingObjectCounts: {
        native_document: 1,
        external_document_ref: 1,
        evidence_artifact: 1,
      },
    });
    expect(dryRun.candidates.map((candidate) => candidate.target_object_type)).toEqual(
      expect.arrayContaining(['native_document', 'external_document_ref', 'evidence_artifact', 'cleanup_warning']),
    );
    expect(dryRun.candidates.every((candidate) => candidate.applied === false)).toBe(true);
    expect(dryRun.candidates.find((candidate) => candidate.legacy_value === 'loose-upload.txt')).toMatchObject({
      target_object_type: 'cleanup_warning',
      warnings: ['ambiguous_document_reference'],
    });
    expect(secondDryRun.candidates).toEqual(dryRun.candidates);
    expect(dryRun.markdown).toContain('THE-45 Document/Artifact Migration Dry-Run Report');
  });

  it('builds the THE-86 migration inventory without mutating data', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const taskRepo = dbMod.createTaskRepository();
    const documentRepo = dbMod.createDocumentObjectRepository();
    const artifactRepo = dbMod.createEvidenceArtifactRepository();

    const completedWithoutReceipt = taskRepo.createTask({
      name: 'Completed legacy task without receipt',
      column: 'done',
      worktype: 'legacy_ops',
      metadata: JSON.stringify({
        review_packet: {
          evidence: ['loose-proof.txt'],
        },
      }),
    });
    taskRepo.createTask({ name: 'Executable cleanup task', column: 'doing' });
    documentRepo.createNativeDocument({
      id: 'inventory-native-doc',
      title: 'Inventory native doc',
      content_hash: 'sha256:inventory-native',
    });
    documentRepo.createExternalDocumentRef({
      id: 'inventory-external-doc',
      connector_type: 'google_docs',
      external_url: 'https://docs.example.test/inventory',
      title: 'Inventory external doc',
    });
    artifactRepo.createArtifact({
      id: 'inventory-artifact',
      title: 'Inventory artifact',
      content_hash: 'sha256:inventory-artifact',
    });

    const rawDb = new Database(tmpDbPath);
    try {
      rawDb.prepare(`
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
      `).run();

      const beforeTask = taskRepo.getTask(completedWithoutReceipt.id);
      const report = dbMod.dryRunPhase2MigrationInventory({
        db: rawDb,
        now: new Date('2026-06-24T11:23:00.000Z'),
      });
      const secondReport = dbMod.dryRunPhase2MigrationInventory({
        db: rawDb,
        now: new Date('2026-06-24T11:23:00.000Z'),
      });
      const afterTask = taskRepo.getTask(completedWithoutReceipt.id);
      const gaps = Object.fromEntries(report.gapCategories.map((gap) => [gap.code, gap]));

      expect(report).toMatchObject({
        dryRun: true,
        counts: {
          tasks: 2,
          review_packets: 1,
          activity_logs: 1,
          native_documents: 1,
          external_document_refs: 1,
          evidence_artifacts: 1,
        },
        noMutationProof: {
          unchanged: true,
          writeStatementsExecuted: 0,
        },
      });
      expect(afterTask?.metadata).toBe(beforeTask?.metadata);
      expect(gaps.missing_receipt.count).toBeGreaterThanOrEqual(1);
      expect(gaps.unknown_worktype.sampleIds).toContain(`task:${completedWithoutReceipt.id}`);
      expect(gaps.weak_activity_structure.count).toBeGreaterThanOrEqual(1);
      expect(gaps.permission_mapping_uncertain.count).toBeGreaterThanOrEqual(3);
      expect(gaps.missing_assignee.count).toBeGreaterThanOrEqual(1);
      expect(secondReport.noMutationProof).toEqual(report.noMutationProof);
      expect(secondReport.gapCategories).toEqual(report.gapCategories);
      expect(report.markdown).toContain('THE-86 Migration Dry-Run Inventory Report');
      expect(report.markdown).toContain('No mutation proof: PASS');
    } finally {
      rawDb.close();
    }
  });

  it('maps review packets and evidence into THE-88 structured metadata without fake raw receipts', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const taskRepo = dbMod.createTaskRepository();
    const task = taskRepo.createTask({
      name: 'Legacy review packet task',
      column: 'done',
      output: '/documents/native/output-summary.md',
      metadata: JSON.stringify({
        review_packet: {
          output_artifact: '/artifacts/evidence/output-proof.md',
          evidence: [
            'evidence_artifact:review-proof',
            'external:https://docs.example.test/review-evidence',
            'loose-proof.txt',
          ],
          done_criteria: [
            'Customer plan reviewed',
            { text: 'Evidence attached', completed: true },
          ],
        },
      }),
    });

    const rawDb = new Database(tmpDbPath);
    try {
      rawDb.prepare(`
        INSERT INTO activities (
          source,
          type,
          task_id,
          activity_event_type,
          activity_event_payload_json,
          activity_event_schema_status,
          action,
          description,
          metadata
        ) VALUES ('agent', 'vendor_ping', ?, NULL, '{bad-json', 'legacy_mapped', 'Vendor ping', 'Weak vendor activity', NULL)
      `).run(task.id);

      const beforeTask = taskRepo.getTask(task.id);
      const dryRun = dbMod.mapReviewPacketsAndEvidenceForPhase2({ dryRun: true, db: rawDb });
      const dryRunTask = dryRun.taskResults.find((result) => result.task_id === task.id);
      const afterDryRunTask = taskRepo.getTask(task.id);

      expect(afterDryRunTask?.metadata).toBe(beforeTask?.metadata);
      expect(dryRunTask).toMatchObject({
        has_review_packet: true,
        receipt_status: 'missing_receipt',
        evidence_fields: [
          expect.objectContaining({
            object_ref: { object_type: 'evidence_artifact', object_id: 'review-proof', link_role: 'evidence' },
          }),
          expect.objectContaining({
            object_ref: { object_type: 'external_document_ref', object_id: 'https://docs.example.test/review-evidence', link_role: 'evidence' },
          }),
          expect.objectContaining({
            object_ref: null,
            warnings: ['ambiguous_document_reference'],
          }),
        ],
      });
      expect(dryRunTask?.output_artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            object_ref: { object_type: 'evidence_artifact', object_id: 'output-proof', link_role: 'output_artifact' },
          }),
          expect.objectContaining({
            object_ref: { object_type: 'native_document', object_id: 'output-summary', link_role: 'output' },
          }),
        ]),
      );
      expect(dryRunTask?.done_criteria).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: 'Customer plan reviewed', completed: null }),
          expect.objectContaining({ text: 'Evidence attached', completed: true }),
        ]),
      );
      expect(dryRunTask?.warnings.map((warning) => warning.code)).toEqual(
        expect.arrayContaining(['ambiguous_evidence_reference', 'missing_receipt', 'weak_activity_structure']),
      );
      expect(dryRun).toMatchObject({
        dryRun: true,
        reviewPacketsMapped: 1,
        missingReceipts: 1,
        weakActivityFlags: 1,
      });
      expect(dryRun.markdown).toContain('missing_receipt');

      const applied = dbMod.mapReviewPacketsAndEvidenceForPhase2({ dryRun: false, db: rawDb });
      const appliedTask = applied.taskResults.find((result) => result.task_id === task.id);
      expect(appliedTask?.applied).toBe(true);

      const stored = rawDb.prepare('SELECT metadata FROM tasks WHERE id = ?').get(task.id) as { metadata: string };
      const audit = JSON.parse(stored.metadata).phase2_review_evidence_mapping;
      expect(audit).toMatchObject({
        version: 'THE-88',
        receipt_status: 'missing_receipt',
        review_packet_source: 'metadata.review_packet',
        evidence_fields: expect.arrayContaining([
          expect.objectContaining({
            object_ref: { object_type: 'evidence_artifact', object_id: 'review-proof', link_role: 'evidence' },
          }),
        ]),
      });
      expect(audit.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'missing_receipt' }),
          expect.objectContaining({ code: 'weak_activity_structure' }),
        ]),
      );
      expect(rawDb.prepare(`
        SELECT COUNT(*) AS count
        FROM evidence_artifacts
        WHERE origin_task_id = ? AND artifact_kind = 'raw_task_receipt'
      `).get(task.id)).toMatchObject({ count: 0 });

      const secondApply = dbMod.mapReviewPacketsAndEvidenceForPhase2({ dryRun: false, db: rawDb });
      const secondTask = secondApply.taskResults.find((result) => result.task_id === task.id);
      expect(secondTask?.would_update).toBe(false);
    } finally {
      rawDb.close();
    }
  });

  it('builds THE-89 migration cleanup queues and protects human corrections from reruns', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const taskRepo = dbMod.createTaskRepository();
    const task = taskRepo.createTask({
      name: 'Legacy cleanup queue task',
      column: 'done',
      assignee: 'Ada',
      worktype: 'legacy_ops',
      metadata: JSON.stringify({
        phase2_review_evidence_mapping: {
          version: 'THE-88',
          warnings: [
            {
              code: 'missing_evidence',
              message: 'Review packet has no evidence array to map.',
              severity: 'warning',
              source: 'metadata.review_packet.evidence',
            },
          ],
        },
      }),
    });

    const rawDb = new Database(tmpDbPath);
    try {
      rawDb.prepare(`
        INSERT INTO activities (
          source,
          type,
          task_id,
          activity_event_type,
          activity_event_payload_json,
          activity_event_schema_status,
          action,
          description,
          metadata
        ) VALUES ('agent', 'vendor_ping', ?, NULL, '{bad-json', 'legacy_mapped', 'Vendor ping', 'Weak cleanup activity', NULL)
      `).run(task.id);

      const report = dbMod.buildMigrationCleanupQueuesForPhase2({
        db: rawDb,
        now: new Date('2026-06-24T16:13:30.000Z'),
      });
      const taskQueueCodes = report.items
        .filter((item) => item.task_id === task.id)
        .map((item) => item.code);

      expect(taskRepo.getTask(task.id)?.name).toBe('Legacy cleanup queue task');
      expect(taskQueueCodes).toEqual(expect.arrayContaining([
        'missing_owner',
        'unknown_initiator',
        'missing_project',
        'missing_receipt',
        'unknown_worktype',
        'weak_activity_structure',
        'missing_evidence',
      ]));
      expect(report.items.find((item) => item.code === 'missing_owner' && item.task_id === task.id)).toMatchObject({
        status: 'open',
        field_name: 'owner_principal_id',
        old_task_visible: true,
      });
      expect(report.markdown).toContain('THE-89 Migration Warning / Cleanup Queue Report');

      const correction = dbMod.applyMigrationCleanupCorrectionForPhase2({
        db: rawDb,
        task_id: task.id,
        code: 'missing_owner',
        field_name: 'owner_principal_id',
        corrected_value: 'human-owner',
        corrected_by_principal_id: 'reviewer-1',
        corrected_at: '2026-06-24T16:20:00.000Z',
        note: 'Owner confirmed during cleanup.',
      });

      expect(correction.task.owner_principal_id).toBe('human-owner');
      expect(correction.correction).toMatchObject({
        version: 'THE-89',
        code: 'missing_owner',
        field_name: 'owner_principal_id',
        previous_value: 'legacy-owner',
        corrected_value: 'human-owner',
        corrected_by_principal_id: 'reviewer-1',
        authoritative: true,
      });

      const openAfterCorrection = dbMod.buildMigrationCleanupQueuesForPhase2({ db: rawDb });
      expect(openAfterCorrection.items.find((item) => item.code === 'missing_owner' && item.task_id === task.id)).toBeUndefined();

      const withCorrected = dbMod.buildMigrationCleanupQueuesForPhase2({ db: rawDb, includeCorrected: true });
      expect(withCorrected.items.find((item) => item.code === 'missing_owner' && item.task_id === task.id)).toMatchObject({
        status: 'corrected',
        correction: expect.objectContaining({ corrected_value: 'human-owner' }),
      });

      const rerun = dbMod.backfillTaskHierarchyAndAccountability({ dryRun: false, db: rawDb });
      expect(rerun.taskResults.find((entry) => entry.task_id === task.id)?.inferred_fields).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ field_name: 'owner_principal_id' })]),
      );
      expect(rawDb.prepare('SELECT owner_principal_id FROM tasks WHERE id = ?').get(task.id)).toMatchObject({
        owner_principal_id: 'human-owner',
      });
      expect(rawDb.prepare(`
        SELECT COUNT(*) AS count
        FROM evidence_artifacts
        WHERE origin_task_id = ? AND artifact_kind = 'raw_task_receipt'
      `).get(task.id)).toMatchObject({ count: 0 });
    } finally {
      rawDb.close();
    }
  });

  it('proves THE-90 migration runbook invariants without fabricating historical certainty', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const taskRepo = dbMod.createTaskRepository();
    const task = taskRepo.createTask({
      name: 'Historical runbook task',
      column: 'done',
      assignee: 'Ada',
      created_by_principal_id: 'requester-1',
      worktype: 'legacy_ops',
      output: '/documents/native/historical-summary.md',
      metadata: JSON.stringify({
        review_packet: {
          evidence: [],
          done_criteria: ['Migration runbook reviewed'],
        },
      }),
    });

    const rawDb = new Database(tmpDbPath);
    try {
      const inventory = dbMod.dryRunPhase2MigrationInventory({ db: rawDb });
      expect(inventory.noMutationProof).toMatchObject({
        unchanged: true,
        writeStatementsExecuted: 0,
      });
      expect(inventory.gapCategories.find((gap) => gap.code === 'missing_receipt')).toMatchObject({
        count: 1,
        severity: 'blocking_for_done',
      });
      expect(taskRepo.getTask(task.id)).toMatchObject({
        id: task.id,
        name: 'Historical runbook task',
        column: 'done',
      });

      const mapped = dbMod.mapReviewPacketsAndEvidenceForPhase2({ dryRun: false, db: rawDb });
      const mappedTask = mapped.taskResults.find((result) => result.task_id === task.id);
      expect(mappedTask).toMatchObject({
        receipt_status: 'missing_receipt',
        applied: true,
      });
      expect(mappedTask?.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'missing_receipt' }),
          expect.objectContaining({ code: 'missing_evidence' }),
        ]),
      );

      const cleanup = dbMod.buildMigrationCleanupQueuesForPhase2({ db: rawDb });
      expect(cleanup.items.find((item) => item.code === 'missing_receipt' && item.task_id === task.id)).toMatchObject({
        status: 'open',
        field_name: 'acknowledgement',
        old_task_visible: true,
      });

      const acknowledgement = dbMod.applyMigrationCleanupCorrectionForPhase2({
        db: rawDb,
        task_id: task.id,
        code: 'missing_receipt',
        field_name: 'acknowledgement',
        corrected_value: 'acknowledged-missing-historical-receipt',
        corrected_by_principal_id: 'reviewer-1',
        corrected_at: '2026-06-24T16:45:00.000Z',
        note: 'Historical task predates canonical receipt writer.',
      });
      expect(acknowledgement.correction).toMatchObject({
        code: 'missing_receipt',
        field_name: 'acknowledgement',
        corrected_value: 'acknowledged-missing-historical-receipt',
        authoritative: true,
      });

      dbMod.applyMigrationCleanupCorrectionForPhase2({
        db: rawDb,
        task_id: task.id,
        code: 'missing_owner',
        field_name: 'owner_principal_id',
        corrected_value: 'human-owner',
        corrected_by_principal_id: 'reviewer-1',
        corrected_at: '2026-06-24T16:46:00.000Z',
        note: 'Owner confirmed during migration runbook review.',
      });

      const afterCorrections = dbMod.buildMigrationCleanupQueuesForPhase2({ db: rawDb, includeCorrected: true });
      expect(afterCorrections.items.find((item) => item.code === 'missing_receipt' && item.task_id === task.id)).toMatchObject({
        status: 'corrected',
        old_task_visible: true,
        correction: expect.objectContaining({
          corrected_value: 'acknowledged-missing-historical-receipt',
        }),
      });
      expect(afterCorrections.items.find((item) => item.code === 'missing_owner' && item.task_id === task.id)).toMatchObject({
        status: 'corrected',
        correction: expect.objectContaining({
          corrected_value: 'human-owner',
        }),
      });

      const firstBackfillRerun = dbMod.backfillTaskHierarchyAndAccountability({ dryRun: false, db: rawDb });
      const firstBackfillTask = firstBackfillRerun.taskResults.find((result) => result.task_id === task.id);
      expect(firstBackfillTask?.inferred_fields).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ field_name: 'owner_principal_id' })]),
      );
      expect(rawDb.prepare('SELECT owner_principal_id FROM tasks WHERE id = ?').get(task.id)).toMatchObject({
        owner_principal_id: 'human-owner',
      });

      const secondMapping = dbMod.mapReviewPacketsAndEvidenceForPhase2({ dryRun: false, db: rawDb });
      expect(secondMapping.taskResults.find((result) => result.task_id === task.id)?.would_update).toBe(false);

      const secondBackfillRerun = dbMod.backfillTaskHierarchyAndAccountability({ dryRun: false, db: rawDb });
      expect(secondBackfillRerun.taskResults.find((result) => result.task_id === task.id)?.would_update).toBe(false);

      expect(rawDb.prepare(`
        SELECT COUNT(*) AS count
        FROM evidence_artifacts
        WHERE origin_task_id = ? AND artifact_kind = 'raw_task_receipt'
      `).get(task.id)).toMatchObject({ count: 0 });
    } finally {
      rawDb.close();
    }
  });

  it('suppresses restricted and degraded document-object previews before snippets can leak', async () => {
    const dbMod = await import('../../../../packages/db/src/index');

    expect(dbMod.buildDocumentObjectPreviewEnvelope({
      object_type: 'native_document',
      title: 'Open account note',
      snippet: 'Renewal summary',
      content: 'Customer-safe details',
      sensitivity: 'customer',
      acl_json: JSON.stringify({ restricted: false }),
    })).toMatchObject({
      permission_state: 'allowed',
      snippet: 'Renewal summary',
      content: 'Customer-safe details',
      reasons: [],
    });

    expect(dbMod.buildDocumentObjectPreviewEnvelope({
      object_type: 'evidence_artifact',
      title: 'People workflow proof',
      snippet: 'Payroll adjustment details',
      content: 'Payroll adjustment details',
      sensitivity: 'people',
      acl_json: JSON.stringify({ restricted: true }),
    })).toMatchObject({
      permission_state: 'restricted',
      snippet: null,
      content: null,
      reasons: ['preview_restricted_by_entity_policy'],
    });

    expect(dbMod.buildDocumentObjectPreviewEnvelope({
      object_type: 'external_document_ref',
      title: 'External account plan',
      snippet: 'External doc snippet',
      content: 'External doc content',
      auth_state: 'expired',
      readiness_state: 'degraded',
      entity_visibility_policy_json: JSON.stringify({ allow_preview: true }),
    })).toMatchObject({
      permission_state: 'degraded',
      snippet: null,
      content: null,
      reasons: ['external_document_preview_degraded'],
    });
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

  it('allows curated artifact links but rejects post-creation links on immutable raw evidence', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const artifactRepo = dbMod.createEvidenceArtifactRepository();
    const task = dbMod.createTaskRepository().createTask({ name: 'Evidence Link Task' });
    const taskRef = { object_type: 'task', object_id: String(task.id), link_role: 'proof' };

    artifactRepo.createArtifact({
      id: 'raw-link-artifact',
      artifact_kind: 'raw_task_receipt',
      title: 'Raw receipt',
      content_hash: 'sha256:raw-link',
    });
    artifactRepo.createArtifact({
      id: 'curated-link-artifact',
      artifact_kind: 'curated_report',
      title: 'Curated report',
      content_hash: 'sha256:curated-link',
      mutability_policy: 'editable_versioned',
    });

    expect(() => artifactRepo.linkArtifactObject('raw-link-artifact', taskRef))
      .toThrow('immutable evidence artifacts cannot be relinked; create a superseding artifact');
    expect(artifactRepo.linkArtifactObject('curated-link-artifact', taskRef)?.linked_object_refs).toEqual([taskRef]);
  });

  it('versions editable curated artifacts and rejects immutable raw overwrites', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const artifactRepo = dbMod.createEvidenceArtifactRepository();

    artifactRepo.createArtifact({
      id: 'curated-version-artifact',
      artifact_kind: 'curated_report',
      title: 'Editable curated report',
      stable_path: '/artifacts/evidence/curated-version-artifact.md',
      content_hash: 'sha256:curated-v1',
      mutability_policy: 'editable_versioned',
      metadata_json: JSON.stringify({ version: 1 }),
    });

    const updated = artifactRepo.updateArtifactVersion('curated-version-artifact', {
      content_hash: 'sha256:curated-v2',
      metadata_json: JSON.stringify({ version: 2 }),
      updated_by_principal_id: 'human-editor',
    });

    expect(updated).toMatchObject({
      id: 'curated-version-artifact',
      version: 2,
      stable_path: '/artifacts/evidence/curated-version-artifact.md',
      content_hash: 'sha256:curated-v2',
    });
    expect(artifactRepo.listArtifactVersions('curated-version-artifact')).toMatchObject([
      { artifact_id: 'curated-version-artifact', version: 1, content_hash: 'sha256:curated-v1' },
      { artifact_id: 'curated-version-artifact', version: 2, content_hash: 'sha256:curated-v2', created_by_principal_id: 'human-editor' },
    ]);

    artifactRepo.createArtifact({
      id: 'raw-version-artifact',
      artifact_kind: 'raw_task_receipt',
      title: 'Raw receipt',
      content_hash: 'sha256:raw-v1',
    });

    expect(() => artifactRepo.updateArtifactVersion('raw-version-artifact', {
      content_hash: 'sha256:raw-v2',
    })).toThrow('immutable evidence artifacts cannot be overwritten; create a superseding artifact');
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

  it('paginates task comments by limit and before_id with a hard cap', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const commentRepo = dbMod.createTaskCommentRepository();
    const taskRepo = dbMod.createTaskRepository();
    const task = taskRepo.createTask({ name: 'Paged Thread Task' });

    Array.from({ length: 505 }, (_, index) =>
      commentRepo.createComment({ task_id: task.id, body: `Comment ${index + 1}` })
    );

    const latestTwo = commentRepo.listComments(task.id, { limit: 2 });
    expect(latestTwo.map((comment) => comment.body)).toEqual(['Comment 504', 'Comment 505']);

    const previousTwo = commentRepo.listComments(task.id, { limit: 2, before_id: latestTwo[0].id });
    expect(previousTwo.map((comment) => comment.body)).toEqual(['Comment 502', 'Comment 503']);

    expect(commentRepo.listComments(task.id, { limit: 9999 })).toHaveLength(500);
    expect(commentRepo.listComments(task.id, { limit: 0 })).toHaveLength(500);
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
    expect(defaultOrg).toMatchObject({
      mission: null,
      domains_json: '[]',
      blueprint_json: null,
    });
    expect(workspaceRepo.listTeams({ orgId: dbMod.DEFAULT_WORKSPACE_ORG_ID })[0]?.id)
      .toBe(dbMod.DEFAULT_WORKSPACE_TEAM_ID);

    const orgA = workspaceRepo.createOrg({
      id: 'org-a',
      name: 'Org A',
      mission: 'Coordinate Curacel-shaped teams.',
      domains_json: JSON.stringify(['product', 'finance']),
    });
    expect(orgA).toMatchObject({
      mission: 'Coordinate Curacel-shaped teams.',
      domains_json: JSON.stringify(['product', 'finance']),
      blueprint_json: null,
    });
    const updatedOrgA = workspaceRepo.updateOrg(orgA.id, {
      blueprint_json: JSON.stringify({ schemaVersion: 1, domains: ['product', 'finance'] }),
    });
    expect(updatedOrgA).toMatchObject({
      mission: 'Coordinate Curacel-shaped teams.',
      domains_json: JSON.stringify(['product', 'finance']),
      blueprint_json: JSON.stringify({ schemaVersion: 1, domains: ['product', 'finance'] }),
    });
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

describe('AgentRegistryRepository', () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it('separates agent principal identity from provider-agnostic runtime binding state', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createAgentRegistryRepository();

    const agent = repo.createAgent({
      id: 'research-agent',
      slug: 'research-agent',
      name: 'Research Agent',
      emoji: 'R',
      adapter_type: 'legacy-adapter-label',
      runtime_type: 'remote',
      runtime_binding_id: 'helm-binding-research',
      provider_type: 'custom',
      helm_managed: true,
      binding_state: 'bound',
      metadata_json: JSON.stringify({ fixture: 'THE-71' }),
    });

    expect(agent).toMatchObject({
      id: 'research-agent',
      slug: 'research-agent',
      runtime_binding_id: 'helm-binding-research',
      provider_type: 'custom',
      helm_managed: true,
      binding_state: 'bound',
    });
    expect(agent.id).not.toBe(agent.runtime_binding_id);

    const updated = repo.updateAgent(agent.id, {
      runtime_binding_id: null,
      provider_type: 'not-a-provider',
      helm_managed: false,
      binding_state: 'not-a-state',
    });

    expect(updated).toMatchObject({
      runtime_binding_id: null,
      provider_type: 'unknown',
      helm_managed: false,
      binding_state: 'unknown',
    });
  });

  it('defaults legacy agents to unknown binding state without hardcoding a provider runtime', async () => {
    const dbMod = await import('../../../../packages/db/src/index');
    const repo = dbMod.createAgentRegistryRepository();

    const agent = repo.createAgent({
      id: 'legacy-agent',
      slug: 'legacy-agent',
      name: 'Legacy Agent',
      emoji: 'L',
      adapter_type: 'legacy',
      runtime_type: 'cli',
    });

    expect(agent).toMatchObject({
      runtime_binding_id: null,
      provider_type: 'unknown',
      helm_managed: false,
      binding_state: 'unknown',
    });
  });
});
