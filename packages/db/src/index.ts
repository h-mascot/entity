import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { ACTIVITY_EVENT_SPINE_TYPES } from './activity-event-spine';
import { ensureActivityEventSpineStoreSchema } from './activity-event-spine-store';
import { getEntityDatabase } from './entity-db';

export const TASK_COLUMNS = ['backlog', 'todo', 'doing', 'review', 'done'] as const;
export const DEFAULT_WORKSPACE_ORG_ID = 'default-org';
export const DEFAULT_WORKSPACE_TEAM_ID = 'default-team';

export type TaskColumn = (typeof TASK_COLUMNS)[number];

export const POLICY_INPUT_LAYERS = [
  'workspace',
  'org',
  'team',
  'project',
  'worktype',
  'task',
  'risk',
  'agent_trust',
] as const;

export type PolicyInputLayer = (typeof POLICY_INPUT_LAYERS)[number];
export type PolicyRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AgentTrustLevel = 'unknown' | 'low' | 'standard' | 'high';
export type ReviewPolicyState = 'not_required' | 'pending' | 'accepted' | 'request_fix' | 'skipped_by_policy';
export type HumanGatePolicyState = 'not_required' | 'pending' | 'approved' | 'rejected';

export const EXTERNAL_SIDE_EFFECT_TYPES = [
  'email_send',
  'crm_update',
  'hr_action',
  'financial_commitment',
  'legal_contract',
  'production_security_change',
  'customer_commitment',
  'other',
] as const;

export type ExternalSideEffectType = (typeof EXTERNAL_SIDE_EFFECT_TYPES)[number];
export type ExternalSideEffectResolutionState =
  | 'requested'
  | 'gate_pending'
  | 'gate_approved'
  | 'gate_rejected'
  | 'resolved'
  | 'cancelled';
export type ExternalSideEffectSensitivity =
  | 'none'
  | 'people'
  | 'customer'
  | 'legal'
  | 'financial'
  | 'security'
  | 'production'
  | 'confidential'
  | 'workspace_restricted';

export type WorktypeFieldType = 'string' | 'enum' | 'boolean' | 'number' | 'string_array' | 'object';

export interface WorktypeRegistryField {
  name: string;
  type: WorktypeFieldType;
  allowed_values?: readonly string[];
  risk_default?: PolicyRiskLevel;
  indexable: boolean;
  sensitivity: ExternalSideEffectSensitivity;
  plan_label: string;
}

export interface WorktypeRegistryEntry {
  worktype: string;
  schema_name: string;
  schema_version: number;
  risk_default: PolicyRiskLevel;
  indexable: boolean;
  sensitivity: ExternalSideEffectSensitivity;
  plan_labels: readonly string[];
  fields: readonly WorktypeRegistryField[];
}

export interface WorktypeOverlayValidationResult {
  ok: boolean;
  degraded: boolean;
  worktype: string;
  schema_name: string | null;
  schema_version: number | null;
  registry?: WorktypeRegistryEntry;
  overlay: Record<string, unknown>;
  warnings: string[];
  errors: string[];
}

export const WORKTYPE_REGISTRY: Record<string, WorktypeRegistryEntry> = {
  general: {
    worktype: 'general',
    schema_name: 'entity.worktype.general',
    schema_version: 1,
    risk_default: 'low',
    indexable: true,
    sensitivity: 'none',
    plan_labels: ['General work'],
    fields: [
      { name: 'summary', type: 'string', indexable: true, sensitivity: 'none', plan_label: 'Summary' },
      { name: 'acceptance_criteria', type: 'string_array', indexable: true, sensitivity: 'none', plan_label: 'Acceptance criteria' },
      { name: 'reviewer_principal_id', type: 'string', indexable: false, sensitivity: 'none', plan_label: 'Reviewer' },
      { name: 'taskmaster_drivable', type: 'boolean', indexable: false, sensitivity: 'none', plan_label: 'Task Master drivable' },
      { name: 'auto_reassign_after_hours', type: 'number', indexable: false, sensitivity: 'none', plan_label: 'Auto-reassign threshold' },
    ],
  },
  customer_success: {
    worktype: 'customer_success',
    schema_name: 'entity.worktype.customer_success',
    schema_version: 1,
    risk_default: 'medium',
    indexable: true,
    sensitivity: 'customer',
    plan_labels: ['Customer success', 'Customer commitment'],
    fields: [
      { name: 'customer_tier', type: 'enum', allowed_values: ['enterprise', 'mid_market', 'smb'], risk_default: 'medium', indexable: true, sensitivity: 'customer', plan_label: 'Customer tier' },
      { name: 'customer_impact', type: 'enum', allowed_values: ['low', 'medium', 'high'], risk_default: 'medium', indexable: true, sensitivity: 'customer', plan_label: 'Customer impact' },
      { name: 'renewal_risk', type: 'boolean', risk_default: 'high', indexable: true, sensitivity: 'customer', plan_label: 'Renewal risk' },
      { name: 'customer', type: 'string', indexable: true, sensitivity: 'customer', plan_label: 'Customer' },
      { name: 'health_state', type: 'enum', allowed_values: ['healthy', 'watch', 'at_risk', 'critical'], risk_default: 'medium', indexable: true, sensitivity: 'customer', plan_label: 'Health state' },
      { name: 'renewal_marker', type: 'enum', allowed_values: ['none', 'upcoming', 'at_risk', 'blocked'], risk_default: 'medium', indexable: true, sensitivity: 'customer', plan_label: 'Renewal marker' },
      { name: 'escalation_marker', type: 'enum', allowed_values: ['none', 'support', 'account', 'executive'], risk_default: 'high', indexable: true, sensitivity: 'customer', plan_label: 'Escalation marker' },
      { name: 'support_context', type: 'string', indexable: true, sensitivity: 'customer', plan_label: 'Support context' },
      { name: 'sla_risk', type: 'enum', allowed_values: ['none', 'low', 'medium', 'high', 'critical'], risk_default: 'high', indexable: false, sensitivity: 'customer', plan_label: 'SLA risk' },
      { name: 'customer_impact_risk', type: 'enum', allowed_values: ['none', 'low', 'medium', 'high', 'critical'], risk_default: 'high', indexable: false, sensitivity: 'customer', plan_label: 'Customer impact risk' },
      { name: 'external_response_risk', type: 'enum', allowed_values: ['none', 'low', 'medium', 'high', 'critical'], risk_default: 'medium', indexable: false, sensitivity: 'customer', plan_label: 'External response risk' },
      { name: 'reviewer_principal_id', type: 'string', indexable: false, sensitivity: 'none', plan_label: 'Reviewer' },
      { name: 'taskmaster_drivable', type: 'boolean', indexable: false, sensitivity: 'none', plan_label: 'Task Master drivable' },
      { name: 'auto_reassign_after_hours', type: 'number', indexable: false, sensitivity: 'none', plan_label: 'Auto-reassign threshold' },
    ],
  },
  business_ops: {
    worktype: 'business_ops',
    schema_name: 'entity.worktype.business_ops',
    schema_version: 1,
    risk_default: 'medium',
    indexable: true,
    sensitivity: 'workspace_restricted',
    plan_labels: ['Business operations', 'Operational checklist'],
    fields: [
      { name: 'process_area', type: 'enum', allowed_values: ['finance', 'legal', 'people', 'ops', 'sales'], risk_default: 'medium', indexable: true, sensitivity: 'workspace_restricted', plan_label: 'Process area' },
      { name: 'approval_path', type: 'string_array', indexable: false, sensitivity: 'workspace_restricted', plan_label: 'Approval path' },
      { name: 'reviewer_principal_id', type: 'string', indexable: false, sensitivity: 'none', plan_label: 'Reviewer' },
      { name: 'approver_principal_id', type: 'string', indexable: false, sensitivity: 'none', plan_label: 'Approver' },
      { name: 'taskmaster_drivable', type: 'boolean', indexable: false, sensitivity: 'none', plan_label: 'Task Master drivable' },
      { name: 'auto_reassign_after_hours', type: 'number', indexable: false, sensitivity: 'none', plan_label: 'Auto-reassign threshold' },
    ],
  },
  sales: {
    worktype: 'sales',
    schema_name: 'entity.worktype.sales',
    schema_version: 1,
    risk_default: 'medium',
    indexable: true,
    sensitivity: 'customer',
    plan_labels: ['Sales overlay', 'Account plan'],
    fields: [
      { name: 'account', type: 'string', indexable: true, sensitivity: 'customer', plan_label: 'Account' },
      { name: 'deal_stage', type: 'enum', allowed_values: ['lead', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'], risk_default: 'medium', indexable: true, sensitivity: 'customer', plan_label: 'Deal stage' },
      { name: 'next_action', type: 'string', indexable: true, sensitivity: 'customer', plan_label: 'Next action' },
      { name: 'stakeholder_map', type: 'object', indexable: false, sensitivity: 'customer', plan_label: 'Stakeholder map' },
      { name: 'external_send_risk', type: 'enum', allowed_values: ['none', 'low', 'medium', 'high', 'critical'], risk_default: 'high', indexable: false, sensitivity: 'customer', plan_label: 'External send risk' },
      { name: 'crm_side_effect_type', type: 'enum', allowed_values: ['none', 'crm_update', 'customer_commitment'], risk_default: 'medium', indexable: false, sensitivity: 'customer', plan_label: 'CRM side effect' },
      { name: 'reviewer_principal_id', type: 'string', indexable: false, sensitivity: 'none', plan_label: 'Reviewer' },
      { name: 'taskmaster_drivable', type: 'boolean', indexable: false, sensitivity: 'none', plan_label: 'Task Master drivable' },
      { name: 'auto_reassign_after_hours', type: 'number', indexable: false, sensitivity: 'none', plan_label: 'Auto-reassign threshold' },
    ],
  },
  people: {
    worktype: 'people',
    schema_name: 'entity.worktype.people',
    schema_version: 1,
    risk_default: 'high',
    indexable: true,
    sensitivity: 'workspace_restricted',
    plan_labels: ['People overlay', 'HR workflow'],
    fields: [
      { name: 'candidate_ref', type: 'string', indexable: true, sensitivity: 'workspace_restricted', plan_label: 'Candidate reference' },
      { name: 'employee_ref', type: 'string', indexable: true, sensitivity: 'workspace_restricted', plan_label: 'Employee reference' },
      { name: 'workflow_stage', type: 'enum', allowed_values: ['sourcing', 'interviewing', 'offer', 'onboarding', 'employee_update', 'offboarding'], risk_default: 'medium', indexable: true, sensitivity: 'workspace_restricted', plan_label: 'Workflow stage' },
      { name: 'sensitivity_class', type: 'enum', allowed_values: ['standard', 'people', 'confidential', 'restricted'], risk_default: 'high', indexable: false, sensitivity: 'workspace_restricted', plan_label: 'Sensitivity class' },
      { name: 'hr_side_effect_type', type: 'enum', allowed_values: ['none', 'candidate_message', 'employee_record_update', 'compensation_change', 'access_change', 'termination'], risk_default: 'high', indexable: false, sensitivity: 'workspace_restricted', plan_label: 'HR side effect' },
      { name: 'checklist_state', type: 'enum', allowed_values: ['not_started', 'in_progress', 'blocked', 'complete'], risk_default: 'medium', indexable: true, sensitivity: 'workspace_restricted', plan_label: 'Checklist state' },
      { name: 'approval_required', type: 'boolean', risk_default: 'high', indexable: false, sensitivity: 'none', plan_label: 'Approval required' },
      { name: 'reviewer_principal_id', type: 'string', indexable: false, sensitivity: 'none', plan_label: 'Reviewer' },
      { name: 'approver_principal_id', type: 'string', indexable: false, sensitivity: 'none', plan_label: 'Approver' },
      { name: 'taskmaster_drivable', type: 'boolean', indexable: false, sensitivity: 'none', plan_label: 'Task Master drivable' },
      { name: 'auto_reassign_after_hours', type: 'number', indexable: false, sensitivity: 'none', plan_label: 'Auto-reassign threshold' },
    ],
  },
};

export interface ExternalSideEffect {
  type: ExternalSideEffectType;
  target_system: string;
  risk_level: PolicyRiskLevel;
  sensitivity: ExternalSideEffectSensitivity;
  required_gate: boolean;
  requested_actor_principal_id: string;
  resolution_state: ExternalSideEffectResolutionState;
  metadata?: Record<string, unknown>;
}

export interface TaskPolicyInputEnvelope {
  layers: Record<PolicyInputLayer, Record<string, unknown>>;
  principals: {
    created_by_principal_id: string | null;
    initiator_principal_id: string | null;
    owner_principal_id: string | null;
    assignee_principal_id: string | null;
    executor_principal_id: string | null;
    submitted_by_principal_id: string | null;
  };
  review: {
    required: boolean;
    state: ReviewPolicyState;
  };
  human_gate: {
    required: boolean;
    state: HumanGatePolicyState;
  };
  external_side_effects: ExternalSideEffect[];
}

export type PolicyReasonSource = PolicyInputLayer | 'task_projection' | 'external_side_effect';
export type PolicyReasonDecision =
  | 'review_required'
  | 'review_requirement_retained'
  | 'human_gate_required'
  | 'human_gate_requirement_retained'
  | 'reviewer_target'
  | 'reviewer_candidate_skipped'
  | 'reviewer_assignment'
  | 'reviewer_routing_problem'
  | 'approver_target'
  | 'taskmaster_drivable'
  | 'taskmaster_high_risk_exclusion'
  | 'stall_threshold'
  | 'auto_reassignment_threshold'
  | 'notification_route'
  | 'escalation_eligibility'
  | 'reassignment_eligibility';

export interface PolicyReasonChainEntry {
  source: PolicyReasonSource;
  decision: PolicyReasonDecision;
  value: boolean | number | string | string[] | null;
  reason: string;
}

export type ReviewerAssignmentMode = 'not_required' | 'initiator' | 'reviewer_pool' | 'owner' | 'routing_problem';
export type ReviewerCandidateRole = 'initiator' | 'reviewer_pool' | 'owner';

export interface ReviewerSkippedCandidate {
  principal_id: string;
  role: ReviewerCandidateRole;
  reason: string;
}

export interface ReviewerAssignmentResult {
  reviewer_principal_id: string | null;
  assignment_mode: ReviewerAssignmentMode;
  routing_problem: boolean;
  routing_problem_reason: string | null;
  skipped_candidates: ReviewerSkippedCandidate[];
}

export interface TaskMasterRoutingPolicyProjection {
  taskmaster_drivable: boolean;
  stall_threshold_hours: number | null;
  notification_routes: string[];
  escalation_eligible: boolean;
  auto_reassign_eligible: boolean;
  auto_reassign_after_hours: number | null;
  high_risk_excluded: boolean;
  high_risk_exclusion_reasons: string[];
  reason_chain: PolicyReasonChainEntry[];
}

export interface TaskPolicyResolution {
  review_required: boolean;
  human_gate_required: boolean;
  reviewer_principal_id: string | null;
  approver_principal_id: string | null;
  reviewer_assignment: ReviewerAssignmentResult;
  taskmaster_drivable: boolean;
  stall_threshold_hours: number | null;
  auto_reassign_after_hours: number | null;
  notification_routes: string[];
  routing_policy_projection: TaskMasterRoutingPolicyProjection;
  reason_chain: PolicyReasonChainEntry[];
}

export type ReviewGateActorType = 'human' | 'agent' | 'system' | 'workflow' | 'unknown';
export type TaskReviewDecision = 'accepted' | 'request_fix';
export type TaskHumanGateDecision = 'approved' | 'rejected';

export type ReviewGateMutationResult =
  | {
      ok: true;
      updates: UpdateTaskInput;
      metadata: Record<string, unknown>;
      reviewer_principal_id?: string | null;
      approver_principal_id?: string | null;
      decision: TaskReviewDecision | TaskHumanGateDecision | 'pending';
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      reviewer_principal_id?: string | null;
      approver_principal_id?: string | null;
    };

export interface TaskRecord {
  id: number;
  org_id?: string;
  team_id?: string;
  project_id?: number | null;
  created_by_principal_id?: string | null;
  initiator_principal_id?: string | null;
  initiator_type?: string | null;
  owner_principal_id?: string | null;
  owner_principal_type?: string | null;
  executor_principal_id?: string | null;
  assignment_state?: string | null;
  taskmaster_drivable?: boolean;
  worktype?: string;
  risk_level?: PolicyRiskLevel;
  agent_trust_level?: AgentTrustLevel;
  policy_inputs_json?: string;
  external_side_effects_json?: string;
  external_side_effects?: ExternalSideEffect[];
  review_required?: boolean;
  review_state?: ReviewPolicyState;
  human_gate_required?: boolean;
  human_gate_state?: HumanGatePolicyState;
  name: string;
  description: string | null;
  brief: string | null;
  origin_channel: string | null;
  column: TaskColumn;
  model: string | null;
  archived: boolean;
  assignee: string | null;
  blocked: boolean;
  blocker_reason: string | null;
  due_date: string | null;
  priority: string | null;
  estimate_hours: number | null;
  time_spent: number | null;
  output: string | null;
  progress_status: string | null;
  recurring: boolean;
  recurring_config: string | null;
  created_at: string;
  updated_at: string;
  metadata: string | null;
  project?: string | null;
  projects?: ProjectRecord[];
}

export interface ClaimTaskForTaskMasterInput {
  taskmaster_principal_id?: string;
  claimed_at?: string;
  claim_request_id?: string;
  policy_reason?: string;
}

export type TaskMasterClaimStatus = 'claimed' | 'already_claimed' | 'not_found' | 'not_claimable';

export interface TaskMasterClaimRecord {
  taskmaster_principal_id: string;
  claimed_at: string;
  claim_request_id: string;
  policy_reason: string;
  previous_assignee: string | null;
  previous_executor_principal_id: string | null;
  previous_assignment_state: string | null;
  previous_taskmaster_drivable: boolean;
}

export interface TaskMasterClaimResult {
  status: TaskMasterClaimStatus;
  claimed: boolean;
  task?: TaskRecord;
  previousTask?: TaskRecord;
  claim?: TaskMasterClaimRecord;
  reason?: string;
}

export interface CreateTaskInput {
  org_id?: string;
  team_id?: string;
  project_id?: number | null;
  projectIds?: number[];
  created_by_principal_id?: string;
  initiator_principal_id?: string;
  initiator_type?: string;
  owner_principal_id?: string;
  owner_principal_type?: string;
  executor_principal_id?: string;
  assignment_state?: string;
  taskmaster_drivable?: boolean;
  worktype?: string;
  risk_level?: PolicyRiskLevel | string;
  agent_trust_level?: AgentTrustLevel | string;
  policy_inputs_json?: string;
  external_side_effects_json?: string;
  review_required?: boolean;
  review_state?: ReviewPolicyState | string;
  human_gate_required?: boolean;
  human_gate_state?: HumanGatePolicyState | string;
  name: string;
  description?: string;
  brief?: string;
  origin_channel?: string;
  column?: string;
  model?: string;
  archived?: boolean;
  assignee?: string;
  blocked?: boolean;
  blocker_reason?: string;
  due_date?: string;
  priority?: string;
  estimate_hours?: number;
  time_spent?: number;
  output?: string;
  progress_status?: string;
  recurring?: boolean;
  recurring_config?: string;
  metadata?: string;
  project?: string;
}


export const AGENT_RUNTIME_PROVIDER_TYPES = [
  'local_process',
  'remote_http',
  'openai_compatible',
  'anthropic_compatible',
  'helm_runtime',
  'custom',
  'unknown',
] as const;

export type AgentRuntimeProviderType = (typeof AGENT_RUNTIME_PROVIDER_TYPES)[number];

export const AGENT_RUNTIME_BINDING_STATES = ['bound', 'unbound', 'stale', 'unknown'] as const;

export type AgentRuntimeBindingState = (typeof AGENT_RUNTIME_BINDING_STATES)[number];

export interface AgentRegistryRecord {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  avatar_url: string | null;
  description: string | null;
  adapter_type: string | null;
  runtime_type: string | null;
  runtime_binding_id: string | null;
  provider_type: AgentRuntimeProviderType;
  helm_managed: boolean;
  binding_state: AgentRuntimeBindingState;
  status: string;
  instructions_path: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentRegistryInput {
  id?: string;
  slug: string;
  name: string;
  emoji: string;
  avatar_url?: string | null;
  description?: string | null;
  adapter_type?: string | null;
  runtime_type?: string | null;
  runtime_binding_id?: string | null;
  provider_type?: AgentRuntimeProviderType | string | null;
  helm_managed?: boolean;
  binding_state?: AgentRuntimeBindingState | string | null;
  status?: string;
  instructions_path?: string | null;
  metadata_json?: string;
}

export interface UpdateAgentRegistryInput {
  slug?: string;
  name?: string;
  emoji?: string;
  avatar_url?: string | null;
  description?: string | null;
  adapter_type?: string | null;
  runtime_type?: string | null;
  runtime_binding_id?: string | null;
  provider_type?: AgentRuntimeProviderType | string | null;
  helm_managed?: boolean;
  binding_state?: AgentRuntimeBindingState | string | null;
  status?: string;
  instructions_path?: string | null;
  metadata_json?: string;
}

export interface AgentRegistryRepository {
  listAgents: () => AgentRegistryRecord[];
  getAgent: (id: string) => AgentRegistryRecord | undefined;
  getAgentBySlug: (slug: string) => AgentRegistryRecord | undefined;
  createAgent: (input: CreateAgentRegistryInput) => AgentRegistryRecord;
  updateAgent: (id: string, updates: UpdateAgentRegistryInput) => AgentRegistryRecord | undefined;
  deleteAgent: (id: string) => boolean;
}

export interface UpsertAgentModuleGrantInput {
  agent_id: string;
  module_id: string;
  enabled?: boolean;
  permissions_json?: string;
  scope_json?: string;
}

export interface ModuleRegistryRepository {
  listModules: () => ModuleRegistryRecord[];
  listModuleSkillRefs: (moduleId: string) => ModuleSkillRefRecord[];
  listAgentModuleGrants: (agentId: string) => AgentModuleGrantRecord[];
  upsertAgentModuleGrant: (input: UpsertAgentModuleGrantInput) => AgentModuleGrantRecord;
  deleteAgentModuleGrant: (agentId: string, moduleId: string) => boolean;
}

export interface ModuleRegistryRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  enabled: boolean;
  icon: string | null;
  kind: string;
  permissions_schema_json: string;
  ui_config_json: string;
  created_at: string;
  updated_at: string;
}

export interface AgentModuleGrantRecord {
  id: string;
  agent_id: string;
  module_id: string;
  enabled: boolean;
  permissions_json: string;
  scope_json: string;
  created_at: string;
  updated_at: string;
}

export interface ModuleSkillRefRecord {
  id: string;
  module_id: string;
  label: string;
  kind: string;
  ref: string;
  required: boolean;
  notes: string | null;
}

export interface UpdateTaskInput {
  org_id?: string;
  team_id?: string;
  project_id?: number | null;
  projectIds?: number[];
  created_by_principal_id?: string;
  initiator_principal_id?: string;
  initiator_type?: string;
  owner_principal_id?: string;
  owner_principal_type?: string;
  executor_principal_id?: string;
  assignment_state?: string;
  taskmaster_drivable?: boolean;
  worktype?: string;
  risk_level?: PolicyRiskLevel | string;
  agent_trust_level?: AgentTrustLevel | string;
  policy_inputs_json?: string;
  external_side_effects_json?: string;
  review_required?: boolean;
  review_state?: ReviewPolicyState | string;
  human_gate_required?: boolean;
  human_gate_state?: HumanGatePolicyState | string;
  name?: string;
  description?: string;
  brief?: string;
  origin_channel?: string;
  column?: string;
  model?: string;
  archived?: boolean;
  assignee?: string;
  blocked?: boolean;
  blocker_reason?: string;
  due_date?: string;
  priority?: string;
  estimate_hours?: number;
  time_spent?: number;
  output?: string;
  progress_status?: string;
  recurring?: boolean;
  recurring_config?: string;
  metadata?: string;
  project?: string;
}

export interface TaskRepository {
  listTasks: () => TaskRecord[];
  listSubtasks: (parentTaskId: number) => TaskRecord[];
  getTask: (id: number) => TaskRecord | undefined;
  createTask: (input: CreateTaskInput) => TaskRecord;
  createTaskWithProjects?: (input: CreateTaskInput) => TaskRecord;
  updateTask: (id: number, updates: UpdateTaskInput) => TaskRecord | undefined;
  updateTaskWithProjects?: (
    id: number,
    updates: UpdateTaskInput,
  ) => TaskRecord | undefined;
  claimTaskForTaskMaster: (id: number, input?: ClaimTaskForTaskMasterInput) => TaskMasterClaimResult;
  moveTask: (id: number, nextColumn: string) => TaskRecord | undefined;
  deleteTask: (id: number) => boolean;
}

export const EVIDENCE_ARTIFACT_KINDS = [
  'raw_task_receipt',
  'review_packet',
  'output_receipt',
  'generated_summary',
  'agent_handoff',
  'audit_trail',
  'curated_report',
  'rollup',
] as const;

export type EvidenceArtifactKind = (typeof EVIDENCE_ARTIFACT_KINDS)[number];
export type EvidenceArtifactMutabilityPolicy = 'immutable_append_only' | 'editable_versioned';
export type EvidenceArtifactIntegrityState = 'valid' | 'missing_body' | 'hash_mismatch' | 'metadata_mismatch' | 'unknown';
export type EvidenceArtifactAvailabilityState = 'available' | 'missing_body' | 'unavailable' | 'pending' | 'unknown';

export const DOCUMENT_OBJECT_TYPES = [
  'native_document',
  'external_document_ref',
  'evidence_artifact',
] as const;

export type DocumentObjectType = (typeof DOCUMENT_OBJECT_TYPES)[number];

export const OBJECT_REF_KNOWN_TYPES = [
  'org',
  'team',
  'project',
  'task',
  'goal',
  'plan',
  'spec',
  'review',
  'receipt',
  'activity_event',
  ...DOCUMENT_OBJECT_TYPES,
] as const;

export type ObjectRefKnownType = (typeof OBJECT_REF_KNOWN_TYPES)[number];

export interface ObjectRef {
  object_type: string;
  object_id: string;
  link_role: string;
}

export const NOTIFICATION_TYPES = [
  'task_nudge',
  'owner_escalation',
  'review_request',
  'human_gate_request',
  'auto_reassignment_notice',
  'receipt_failure',
  'connector_degraded',
  'policy_warning',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationInboxState = 'unread' | 'read' | 'archived';
export type NotificationDeliveryChannel =
  | 'entity_inbox'
  | 'clickclack'
  | 'email'
  | 'discord'
  | 'slack'
  | 'agentpush'
  | 'webhook'
  | 'other';
export type NotificationDeliveryStatus = 'pending' | 'sent' | 'failed' | 'degraded' | 'skipped';

export interface NotificationDeliveryRecord {
  id: number;
  notification_id: string;
  channel: NotificationDeliveryChannel;
  status: NotificationDeliveryStatus;
  external_ref: string | null;
  failure_reason: string | null;
  degraded_reason: string | null;
  policy_reason_json: string;
  attempted_at: string;
  completed_at: string | null;
  metadata_json: string;
}

export interface NotificationRecord {
  id: string;
  org_id: string;
  recipient_principal_id: string;
  canonical_event_id: string;
  object_ref: ObjectRef;
  notification_type: NotificationType;
  inbox_state: NotificationInboxState;
  title: string;
  body: string;
  policy_reason_chain_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deliveries: NotificationDeliveryRecord[];
}

export interface CreateNotificationInput {
  id?: string;
  org_id?: string;
  recipient_principal_id: string;
  canonical_event_id: string | number;
  object_ref: ObjectRef;
  notification_type: NotificationType | string;
  inbox_state?: NotificationInboxState | string;
  title: string;
  body?: string | null;
  policy_reason_chain_json?: string;
  metadata_json?: string;
  deliveries?: CreateNotificationDeliveryInput[];
}

export interface CreateNotificationDeliveryInput {
  channel: NotificationDeliveryChannel | string;
  status?: NotificationDeliveryStatus | string;
  external_ref?: string | null;
  failure_reason?: string | null;
  degraded_reason?: string | null;
  policy_reason_json?: string;
  completed_at?: string | null;
  metadata_json?: string;
}

export interface NotificationRepository {
  createNotification: (input: CreateNotificationInput) => NotificationRecord;
  getNotification: (id: string) => NotificationRecord | undefined;
  listNotificationsForRecipient: (input: {
    org_id?: string;
    recipient_principal_id: string;
    inbox_state?: NotificationInboxState | 'all';
    limit?: number;
  }) => NotificationRecord[];
  updateInboxState: (id: string, inboxState: NotificationInboxState | string) => NotificationRecord | undefined;
  addDeliveryAttempt: (notificationId: string, input: CreateNotificationDeliveryInput) => NotificationDeliveryRecord;
  listDeliveryAttempts: (notificationId: string) => NotificationDeliveryRecord[];
}

export type NativeDocumentKind = 'note' | 'spec' | 'report' | 'internal_doc' | 'generated_markdown' | 'fallback_doc';
export type NativeDocumentMutabilityPolicy = 'editable_versioned' | 'immutable';
export type NativeDocumentLifecycleState = 'draft' | 'active' | 'archived' | 'superseded';

export interface NativeDocumentRecord {
  id: string;
  org_id: string;
  team_id: string | null;
  project_id: number | null;
  title: string;
  document_kind: NativeDocumentKind;
  body_format: 'markdown';
  stable_path: string;
  content_hash: string;
  mutability_policy: NativeDocumentMutabilityPolicy;
  version: number;
  lifecycle_state: NativeDocumentLifecycleState;
  sensitivity: string | null;
  acl_json: string;
  linked_object_refs: ObjectRef[];
  created_by_principal_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface NativeDocumentVersionRecord {
  id: number;
  document_id: string;
  version: number;
  stable_path: string;
  content_hash: string;
  metadata_json: string;
  created_by_principal_id: string | null;
  created_at: string;
}

export interface CreateNativeDocumentInput {
  id?: string;
  org_id?: string;
  team_id?: string | null;
  project_id?: number | null;
  title: string;
  document_kind?: NativeDocumentKind;
  stable_path?: string;
  content_hash: string;
  mutability_policy?: NativeDocumentMutabilityPolicy;
  version?: number;
  lifecycle_state?: NativeDocumentLifecycleState;
  sensitivity?: string | null;
  acl_json?: string;
  linked_object_refs?: ObjectRef[];
  created_by_principal_id?: string | null;
  metadata_json?: string;
}

export interface ListNativeDocumentsInput {
  org_id: string;
  query?: string | null;
  team_id?: string | null;
  project_id?: number | null;
  lifecycle_state?: NativeDocumentLifecycleState;
  sensitivity?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number | null;
}

export interface UpdateNativeDocumentVersionInput {
  title?: string;
  stable_path?: string;
  content_hash: string;
  metadata_json?: string;
  updated_by_principal_id?: string | null;
}

export type ExternalDocumentConnectorType = 'google_drive' | 'google_docs' | 'other';
export const GOOGLE_CONNECTOR_V1_SCOPES = ['read', 'index', 'link', 'preview'] as const;
export type GoogleConnectorV1Scope = typeof GOOGLE_CONNECTOR_V1_SCOPES[number];
export type ExternalDocumentAuthState = 'authorized' | 'unauthorized' | 'expired' | 'insufficient_scope' | 'revoked' | 'unknown';
export type ExternalDocumentReadinessState = 'ready' | 'degraded' | 'unavailable' | 'not_configured' | 'unknown';
export type ExternalDocumentRefState = 'available' | 'permission_revoked' | 'deleted' | 'unknown';
export type ExternalDocumentCanonicality = 'external_canonical' | 'entity_reference_only' | 'unknown';

export interface ExternalDocumentRefRecord {
  id: string;
  org_id: string;
  connector_type: ExternalDocumentConnectorType;
  external_id: string | null;
  external_url: string | null;
  title: string;
  external_mime_type: string | null;
  external_canonical_url: string | null;
  auth_state: ExternalDocumentAuthState;
  readiness_state: ExternalDocumentReadinessState;
  granted_scopes: GoogleConnectorV1Scope[];
  missing_scopes: GoogleConnectorV1Scope[];
  auth_expires_at: string | null;
  external_ref_state: ExternalDocumentRefState;
  capabilities_json: string;
  canonicality: ExternalDocumentCanonicality;
  last_indexed_at: string | null;
  last_checked_at: string | null;
  entity_visibility_policy_json: string;
  external_permission_summary: string | null;
  linked_object_refs: ObjectRef[];
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface CreateExternalDocumentRefInput {
  id?: string;
  org_id?: string;
  connector_type: ExternalDocumentConnectorType;
  external_id?: string | null;
  external_url?: string | null;
  title: string;
  external_mime_type?: string | null;
  external_canonical_url?: string | null;
  auth_state?: ExternalDocumentAuthState;
  readiness_state?: ExternalDocumentReadinessState;
  granted_scopes?: string[];
  missing_scopes?: string[];
  auth_expires_at?: string | null;
  external_ref_state?: ExternalDocumentRefState;
  capabilities_json?: string;
  canonicality?: ExternalDocumentCanonicality;
  last_indexed_at?: string | null;
  last_checked_at?: string | null;
  entity_visibility_policy_json?: string;
  external_permission_summary?: string | null;
  linked_object_refs?: ObjectRef[];
  metadata_json?: string;
}

export interface ListExternalDocumentRefsInput {
  org_id: string;
  connector_type?: ExternalDocumentConnectorType;
  query?: string | null;
  linked_object_ref?: ObjectRef | null;
  auth_state?: ExternalDocumentAuthState;
  readiness_state?: ExternalDocumentReadinessState;
  external_ref_state?: ExternalDocumentRefState;
  from?: string | null;
  to?: string | null;
  limit?: number | null;
}

export interface DocumentObjectRepository {
  createNativeDocument: (input: CreateNativeDocumentInput) => NativeDocumentRecord;
  getNativeDocument: (id: string) => NativeDocumentRecord | undefined;
  listNativeDocuments: (input: ListNativeDocumentsInput) => NativeDocumentRecord[];
  updateNativeDocumentVersion: (id: string, input: UpdateNativeDocumentVersionInput) => NativeDocumentRecord | undefined;
  listNativeDocumentVersions: (id: string) => NativeDocumentVersionRecord[];
  linkNativeDocumentObject: (id: string, objectRef: ObjectRef) => NativeDocumentRecord | undefined;
  createExternalDocumentRef: (input: CreateExternalDocumentRefInput) => ExternalDocumentRefRecord;
  getExternalDocumentRef: (id: string) => ExternalDocumentRefRecord | undefined;
  listExternalDocumentRefs: (input: ListExternalDocumentRefsInput) => ExternalDocumentRefRecord[];
  linkExternalDocumentObject: (id: string, objectRef: ObjectRef) => ExternalDocumentRefRecord | undefined;
}

export type LegacyDocumentReferenceConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface LegacyFileArtifactReferenceInput {
  source_table: string;
  source_field: string;
  legacy_value: string | null | undefined;
  task_id?: number | null;
  link_role?: string;
}

export interface LegacyFileArtifactReferenceMigration {
  source_table: string;
  source_field: string;
  legacy_value: string | null;
  object_ref: ObjectRef | null;
  confidence: LegacyDocumentReferenceConfidence;
  warnings: string[];
}

export interface DocumentArtifactMigrationCandidate extends LegacyFileArtifactReferenceMigration {
  source_id: string;
  task_id: number | null;
  target_object_type: DocumentObjectType | 'cleanup_warning';
  would_create: boolean;
  applied: false;
}

export interface DocumentArtifactMigrationReport {
  dryRun: true;
  totalCandidates: number;
  classifiedCandidates: number;
  cleanupWarnings: number;
  existingObjectCounts: Record<DocumentObjectType, number>;
  candidates: DocumentArtifactMigrationCandidate[];
  rollbackNotes: string[];
  markdown: string;
}

export interface DocumentArtifactMigrationOptions {
  db?: Database.Database;
  limit?: number;
}

export interface DocumentObjectPreviewInput {
  object_type: DocumentObjectType;
  title: string;
  snippet?: string | null;
  content?: string | null;
  sensitivity?: string | null;
  acl_json?: string | null;
  entity_visibility_policy_json?: string | null;
  auth_state?: ExternalDocumentAuthState | string | null;
  readiness_state?: ExternalDocumentReadinessState | string | null;
  can_preview?: boolean;
}

export interface DocumentObjectPreviewEnvelope {
  object_type: DocumentObjectType;
  title: string;
  permission_state: 'allowed' | 'restricted' | 'degraded';
  snippet: string | null;
  content: string | null;
  reasons: string[];
}

export function planLegacyFileArtifactReferenceMigration(
  input: LegacyFileArtifactReferenceInput
): LegacyFileArtifactReferenceMigration {
  const legacyValue = normalizeBlockerReason(input.legacy_value);
  const linkRole = normalizeBlockerReason(input.link_role) ?? 'legacy_reference';
  const warnings: string[] = [];
  let objectRef: ObjectRef | null = null;
  let confidence: LegacyDocumentReferenceConfidence = 'unknown';

  if (!legacyValue) {
    warnings.push('missing_legacy_reference');
  } else if (legacyValue.startsWith('/artifacts/evidence/') || legacyValue.startsWith('evidence_artifact:')) {
    const objectId = legacyValue.replace(/^evidence_artifact:/, '').replace(/^\/artifacts\/evidence\//, '').replace(/\.md$/, '');
    objectRef = { object_type: 'evidence_artifact', object_id: objectId, link_role: linkRole };
    confidence = objectId ? 'medium' : 'low';
  } else if (legacyValue.startsWith('external:') || /^https?:\/\//.test(legacyValue)) {
    objectRef = { object_type: 'external_document_ref', object_id: legacyValue.replace(/^external:/, ''), link_role: linkRole };
    confidence = 'medium';
  } else if (legacyValue.startsWith('/documents/native/') || legacyValue.startsWith('native_document:')) {
    const objectId = legacyValue.replace(/^native_document:/, '').replace(/^\/documents\/native\//, '').replace(/\.md$/, '');
    objectRef = { object_type: 'native_document', object_id: objectId, link_role: linkRole };
    confidence = objectId ? 'medium' : 'low';
  } else {
    warnings.push('ambiguous_document_reference');
    confidence = 'low';
  }

  if (!normalizePositiveInteger(input.task_id)) {
    warnings.push('missing_task_context');
  }

  return {
    source_table: input.source_table,
    source_field: input.source_field,
    legacy_value: legacyValue,
    object_ref: objectRef,
    confidence,
    warnings,
  };
}

function countRowsIfTableExists(db: Database.Database, table: string): number {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) {
    return 0;
  }
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return Number(row.count) || 0;
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function firstStringValue(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = normalizeBlockerReason(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

type DocumentArtifactMigrationDraftInput = LegacyFileArtifactReferenceInput & { source_id: string };

function pushLegacyMigrationInput(
  target: DocumentArtifactMigrationDraftInput[],
  input: DocumentArtifactMigrationDraftInput
): void {
  if (normalizeBlockerReason(input.legacy_value)) {
    target.push(input);
  }
}

function collectReviewPacketMigrationInputs(
  target: DocumentArtifactMigrationDraftInput[],
  taskId: number,
  sourceId: string,
  metadata: Record<string, unknown>
): void {
  const reviewPacket = metadata.review_packet;
  if (!isPlainObject(reviewPacket)) {
    return;
  }

  pushLegacyMigrationInput(target, {
    source_table: 'tasks',
    source_field: 'metadata.review_packet.output_artifact',
    legacy_value: firstStringValue(reviewPacket, ['output_artifact', 'outputArtifact', 'artifact_path', 'artifactPath']),
    task_id: taskId,
    link_role: 'output_artifact',
    source_id: sourceId,
  });

  const evidence = reviewPacket.evidence;
  if (!Array.isArray(evidence)) {
    return;
  }

  evidence.forEach((entry, index) => {
    const legacyValue = typeof entry === 'string'
      ? entry
      : isPlainObject(entry)
        ? firstStringValue(entry, ['artifact', 'path', 'url', 'href', 'file_path'])
        : null;
    pushLegacyMigrationInput(target, {
      source_table: 'tasks',
      source_field: `metadata.review_packet.evidence[${index}]`,
      legacy_value: legacyValue,
      task_id: taskId,
      link_role: 'evidence',
      source_id: sourceId,
    });
  });
}

function buildDocumentArtifactMigrationMarkdown(report: Omit<DocumentArtifactMigrationReport, 'markdown'>): string {
  const lines = [
    '# THE-45 Document/Artifact Migration Dry-Run Report',
    '',
    '- Mode: dry-run',
    `- Total candidates: ${report.totalCandidates}`,
    `- Classified candidates: ${report.classifiedCandidates}`,
    `- Cleanup warnings: ${report.cleanupWarnings}`,
    `- Existing NativeDocuments: ${report.existingObjectCounts.native_document}`,
    `- Existing ExternalDocumentRefs: ${report.existingObjectCounts.external_document_ref}`,
    `- Existing EvidenceArtifacts: ${report.existingObjectCounts.evidence_artifact}`,
    '',
    '## Sample Results',
  ];

  const sample = report.candidates.filter((candidate) => candidate.object_ref || candidate.warnings.length > 0).slice(0, 5);
  if (sample.length === 0) {
    lines.push('- No legacy document or artifact references detected.');
  } else {
    for (const candidate of sample) {
      lines.push(
        `- ${candidate.source_table}.${candidate.source_field}#${candidate.source_id}: target=${candidate.target_object_type}, confidence=${candidate.confidence}, warnings=${candidate.warnings.length}, applied=${candidate.applied}`
      );
    }
  }

  lines.push('', '## Rollback / Non-Destructive Notes', ...report.rollbackNotes.map((note) => `- ${note}`));
  return `${lines.join('\n')}\n`;
}

export function dryRunDocumentArtifactObjectMigration(
  options: DocumentArtifactMigrationOptions = {}
): DocumentArtifactMigrationReport {
  const db = options.db ?? getEntityDatabase();
  const limit = typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  const migrationInputs: DocumentArtifactMigrationDraftInput[] = [];

  const taskSelects = [
    'id',
    hasColumn(db, 'tasks', 'name') ? 'name' : "'' AS name",
    hasColumn(db, 'tasks', 'output') ? 'output' : 'NULL AS output',
    hasColumn(db, 'tasks', 'metadata') ? 'metadata' : 'NULL AS metadata',
  ];
  const taskRows = db.prepare(`
    SELECT ${taskSelects.join(', ')}
    FROM tasks
    ORDER BY id ASC
    ${limit ? 'LIMIT ?' : ''}
  `).all(...(limit ? [limit] : [])) as Array<Record<string, unknown>>;

  for (const row of taskRows) {
    const taskId = normalizePositiveInteger(row.id);
    if (!taskId) {
      continue;
    }
    const baseInput = {
      source_table: 'tasks',
      task_id: taskId,
      source_id: String(taskId),
    };
    pushLegacyMigrationInput(migrationInputs, {
      ...baseInput,
      source_field: 'output',
      legacy_value: normalizeBlockerReason(row.output),
      link_role: 'output',
    });

    collectReviewPacketMigrationInputs(migrationInputs, taskId, String(taskId), parseJsonObject(row.metadata));
  }

  const activityLimitSql = limit ? 'LIMIT ?' : '';
  const activityRows = db.prepare(`
    SELECT id, task_id, file_path
    FROM activities
    WHERE file_path IS NOT NULL AND trim(file_path) <> ''
    ORDER BY id ASC
    ${activityLimitSql}
  `).all(...(limit ? [limit] : [])) as Array<Record<string, unknown>>;

  for (const row of activityRows) {
    const activityId = normalizePositiveInteger(row.id);
    if (!activityId) {
      continue;
    }
    pushLegacyMigrationInput(migrationInputs, {
      source_table: 'activities',
      source_field: 'file_path',
      legacy_value: normalizeBlockerReason(row.file_path),
      task_id: normalizePositiveInteger(row.task_id),
      link_role: 'activity_file',
      source_id: String(activityId),
    });
  }

  const candidates = migrationInputs.map((input): DocumentArtifactMigrationCandidate => {
    const planned = planLegacyFileArtifactReferenceMigration(input);
    const targetObjectType = planned.object_ref && (DOCUMENT_OBJECT_TYPES as readonly string[]).includes(planned.object_ref.object_type)
      ? planned.object_ref.object_type as DocumentObjectType
      : 'cleanup_warning';
    return {
      ...planned,
      source_id: input.source_id,
      task_id: normalizePositiveInteger(input.task_id),
      target_object_type: targetObjectType,
      would_create: Boolean(planned.object_ref),
      applied: false,
    };
  });

  const reportBase: Omit<DocumentArtifactMigrationReport, 'markdown'> = {
    dryRun: true,
    totalCandidates: candidates.length,
    classifiedCandidates: candidates.filter((candidate) => candidate.object_ref).length,
    cleanupWarnings: candidates.reduce((sum, candidate) => sum + candidate.warnings.length, 0),
    existingObjectCounts: {
      native_document: countRowsIfTableExists(db, 'native_documents'),
      external_document_ref: countRowsIfTableExists(db, 'external_document_refs'),
      evidence_artifact: countRowsIfTableExists(db, 'evidence_artifacts'),
    },
    candidates,
    rollbackNotes: [
      'Dry-run mode performs no writes.',
      'Legacy references are classified into ObjectRef targets only when the existing value carries enough signal.',
      'Ambiguous values remain cleanup warnings instead of fabricated NativeDocument, ExternalDocumentRef, or EvidenceArtifact records.',
      'Re-running the dry run is idempotent because it reads existing rows and does not update tasks, activities, or document object tables.',
    ],
  };

  return {
    ...reportBase,
    markdown: buildDocumentArtifactMigrationMarkdown(reportBase),
  };
}

const PHASE2_MIGRATION_INVENTORY_TABLES = [
  'tasks',
  'projects',
  'task_projects',
  'activities',
  'native_documents',
  'external_document_refs',
  'file_index',
  'evidence_artifacts',
] as const;

const PHASE2_MIGRATION_INVENTORY_GAP_DEFINITIONS: Record<Phase2MigrationInventoryGapCode, Omit<Phase2MigrationInventoryGapCategory, 'count' | 'sampleIds'>> = {
  missing_owner: {
    code: 'missing_owner',
    severity: 'blocking_for_execution',
    description: 'Task owner is missing, unknown, or still marked as a legacy placeholder.',
  },
  unknown_initiator: {
    code: 'unknown_initiator',
    severity: 'warning',
    description: 'Task initiator is missing, unknown, or still marked as a legacy placeholder.',
  },
  missing_project: {
    code: 'missing_project',
    severity: 'warning',
    description: 'Task has no direct project and no linked project that can be used for migration.',
  },
  missing_assignee: {
    code: 'missing_assignee',
    severity: 'blocking_for_execution',
    description: 'Executable task has no individual assignee/executor and is not Task-Master-drivable.',
  },
  missing_receipt: {
    code: 'missing_receipt',
    severity: 'blocking_for_done',
    description: 'Completed task has no raw task receipt artifact linked by origin task id.',
  },
  unknown_worktype: {
    code: 'unknown_worktype',
    severity: 'warning',
    description: 'Task worktype is missing from the Phase 2 worktype registry.',
  },
  weak_activity_structure: {
    code: 'weak_activity_structure',
    severity: 'warning',
    description: 'Activity row lacks a confident structured ActivityEvent mapping or task link.',
  },
  permission_mapping_uncertain: {
    code: 'permission_mapping_uncertain',
    severity: 'warning',
    description: 'Document, external ref, or artifact lacks explicit Entity-side sensitivity/visibility mapping.',
  },
};

function migrationInventoryTableCounts(db: Database.Database): Record<string, number> {
  return Object.fromEntries(
    PHASE2_MIGRATION_INVENTORY_TABLES.map((table) => [table, countRowsIfTableExists(db, table)])
  );
}

function createMigrationInventoryGapBuckets(): Record<Phase2MigrationInventoryGapCode, Phase2MigrationInventoryGapCategory> {
  const buckets = {} as Record<Phase2MigrationInventoryGapCode, Phase2MigrationInventoryGapCategory>;
  for (const code of PHASE2_MIGRATION_INVENTORY_GAP_CODES) {
    buckets[code] = {
      ...PHASE2_MIGRATION_INVENTORY_GAP_DEFINITIONS[code],
      count: 0,
      sampleIds: [],
    };
  }
  return buckets;
}

function addMigrationInventoryGap(
  gaps: Record<Phase2MigrationInventoryGapCode, Phase2MigrationInventoryGapCategory>,
  code: Phase2MigrationInventoryGapCode,
  sampleId: string
): void {
  const gap = gaps[code];
  gap.count += 1;
  if (gap.sampleIds.length < 5) {
    gap.sampleIds.push(sampleId);
  }
}

function isCompletedTaskColumn(value: unknown): boolean {
  const column = normalizeBlockerReason(value)?.toLowerCase();
  return column === 'done' || column === 'complete' || column === 'completed';
}

function hasRawReceiptForTask(db: Database.Database, taskId: number): boolean {
  if (!tableExists(db, 'evidence_artifacts')) {
    return false;
  }
  const row = db.prepare(`
    SELECT id
    FROM evidence_artifacts
    WHERE origin_task_id = ? AND artifact_kind = 'raw_task_receipt'
    LIMIT 1
  `).get(taskId);
  return Boolean(row);
}

function countPermissionUncertainRows(
  db: Database.Database,
  gaps: Record<Phase2MigrationInventoryGapCode, Phase2MigrationInventoryGapCategory>,
  limit: number | null
): void {
  if (tableExists(db, 'native_documents')) {
    const rows = db.prepare(`
      SELECT id
      FROM native_documents
      WHERE (sensitivity IS NULL OR trim(sensitivity) = '')
        AND (acl_json IS NULL OR trim(acl_json) = '' OR trim(acl_json) = '{}')
      ORDER BY id ASC
      ${limit ? 'LIMIT ?' : ''}
    `).all(...(limit ? [limit] : [])) as Array<{ id: string }>;
    for (const row of rows) {
      addMigrationInventoryGap(gaps, 'permission_mapping_uncertain', `native_document:${row.id}`);
    }
  }

  if (tableExists(db, 'external_document_refs')) {
    const rows = db.prepare(`
      SELECT id
      FROM external_document_refs
      WHERE (entity_visibility_policy_json IS NULL OR trim(entity_visibility_policy_json) = '' OR trim(entity_visibility_policy_json) = '{}')
        AND (external_permission_summary IS NULL OR trim(external_permission_summary) = '')
      ORDER BY id ASC
      ${limit ? 'LIMIT ?' : ''}
    `).all(...(limit ? [limit] : [])) as Array<{ id: string }>;
    for (const row of rows) {
      addMigrationInventoryGap(gaps, 'permission_mapping_uncertain', `external_document_ref:${row.id}`);
    }
  }

  if (tableExists(db, 'evidence_artifacts')) {
    const rows = db.prepare(`
      SELECT id
      FROM evidence_artifacts
      WHERE metadata_json IS NULL
        OR trim(metadata_json) = ''
        OR trim(metadata_json) = '{}'
      ORDER BY id ASC
      ${limit ? 'LIMIT ?' : ''}
    `).all(...(limit ? [limit] : [])) as Array<{ id: string }>;
    for (const row of rows) {
      addMigrationInventoryGap(gaps, 'permission_mapping_uncertain', `evidence_artifact:${row.id}`);
    }
  }
}

function buildPhase2MigrationInventoryMarkdown(
  report: Omit<Phase2MigrationInventoryReport, 'markdown'>
): string {
  const lines = [
    '# THE-86 Migration Dry-Run Inventory Report',
    '',
    '- Mode: dry-run',
    `- Generated at: ${report.generatedAt}`,
    `- No mutation proof: ${report.noMutationProof.unchanged ? 'PASS' : 'FAIL'}`,
    '',
    '## Counts',
    `- Tasks: ${report.counts.tasks}`,
    `- Projects: ${report.counts.projects}`,
    `- Docs: ${report.counts.docs}`,
    `- NativeDocuments: ${report.counts.native_documents}`,
    `- ExternalDocumentRefs: ${report.counts.external_document_refs}`,
    `- Indexed files: ${report.counts.indexed_files}`,
    `- Review packets: ${report.counts.review_packets}`,
    `- Activity logs: ${report.counts.activity_logs}`,
    `- EvidenceArtifacts: ${report.counts.evidence_artifacts}`,
    `- Task/project links: ${report.counts.task_project_links}`,
    '',
    '## Gap Categories',
  ];

  for (const gap of report.gapCategories) {
    lines.push(
      `- ${gap.code}: ${gap.count} (${gap.severity})${gap.sampleIds.length ? ` samples=${gap.sampleIds.join(', ')}` : ''}`
    );
  }

  lines.push(
    '',
    '## No-Mutation Proof',
    `- Checked tables: ${report.noMutationProof.checkedTables.join(', ')}`,
    `- Write statements executed: ${report.noMutationProof.writeStatementsExecuted}`,
    `- Counts unchanged: ${report.noMutationProof.unchanged}`,
    '',
    '## Rollback / Non-Destructive Notes',
    ...report.rollbackNotes.map((note) => `- ${note}`)
  );
  return `${lines.join('\n')}\n`;
}

export function dryRunPhase2MigrationInventory(
  options: Phase2MigrationInventoryOptions = {}
): Phase2MigrationInventoryReport {
  const db = options.db ?? getEntityDatabase();
  const limit = typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  const beforeCounts = migrationInventoryTableCounts(db);
  const gaps = createMigrationInventoryGapBuckets();
  let reviewPacketCount = 0;

  const rows = db.prepare(`
    SELECT
      t.*,
      (
        SELECT p.id
        FROM task_projects tp
        INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tp.org_id
        WHERE tp.task_id = t.id
        ORDER BY p.id ASC
        LIMIT 1
      ) AS linked_project_id
    FROM tasks t
    ORDER BY t.id ASC
    ${limit ? 'LIMIT ?' : ''}
  `).all(...(limit ? [limit] : [])) as TaskBackfillRow[];

  for (const row of rows) {
    const taskId = Number(row.id);
    const taskSampleId = `task:${taskId}`;
    const metadata = parseJsonObject(row.metadata);
    if (isPlainObject(metadata.review_packet)) {
      reviewPacketCount += 1;
    }

    if (isLegacyPrincipalMarker(row.owner_principal_id, ['legacy-owner', 'unknown'])) {
      addMigrationInventoryGap(gaps, 'missing_owner', taskSampleId);
    }
    if (isLegacyPrincipalMarker(row.initiator_principal_id, ['legacy-unknown', 'unknown'])) {
      addMigrationInventoryGap(gaps, 'unknown_initiator', taskSampleId);
    }
    if (!normalizePositiveInteger(row.project_id) && !normalizePositiveInteger(row.linked_project_id)) {
      addMigrationInventoryGap(gaps, 'missing_project', taskSampleId);
    }
    if (
      isBackfillExecutableColumn(row.column) &&
      !isAssignablePrincipal(row.assignee) &&
      !isAssignablePrincipal(row.executor_principal_id) &&
      !normalizeBlocked(row.taskmaster_drivable)
    ) {
      addMigrationInventoryGap(gaps, 'missing_assignee', taskSampleId);
    }
    if (isCompletedTaskColumn(row.column) && !hasRawReceiptForTask(db, taskId)) {
      addMigrationInventoryGap(gaps, 'missing_receipt', taskSampleId);
    }
    if (!getWorktypeRegistryEntry(row.worktype)) {
      addMigrationInventoryGap(gaps, 'unknown_worktype', taskSampleId);
    }
  }

  if (tableExists(db, 'activities')) {
    const activityRows = db.prepare(`
      SELECT id, task_id, activity_event_type, activity_event_schema_status, activity_event_payload_json
      FROM activities
      ORDER BY id ASC
      ${limit ? 'LIMIT ?' : ''}
    `).all(...(limit ? [limit] : [])) as Array<Record<string, unknown>>;
    for (const row of activityRows) {
      const activityId = Number(row.id);
      const schemaStatus = normalizeActivityEventSchemaStatus(row.activity_event_schema_status);
      const eventType = normalizeActivityEventType(row.activity_event_type);
      const parsedPayload = parseActivityPayloadForBackfill(row.activity_event_payload_json);
      if (!eventType || schemaStatus === 'legacy_unknown' || !normalizePositiveInteger(row.task_id) || parsedPayload.malformed) {
        addMigrationInventoryGap(gaps, 'weak_activity_structure', `activity:${activityId}`);
      }
    }
  }

  countPermissionUncertainRows(db, gaps, limit);

  const afterCounts = migrationInventoryTableCounts(db);
  const noMutationProof: Phase2MigrationInventoryNoMutationProof = {
    checkedTables: [...PHASE2_MIGRATION_INVENTORY_TABLES],
    before: beforeCounts,
    after: afterCounts,
    unchanged: PHASE2_MIGRATION_INVENTORY_TABLES.every((table) => beforeCounts[table] === afterCounts[table]),
    writeStatementsExecuted: 0,
  };
  const counts: Phase2MigrationInventoryCounts = {
    tasks: beforeCounts.tasks,
    projects: beforeCounts.projects,
    docs: beforeCounts.native_documents + beforeCounts.external_document_refs + beforeCounts.file_index,
    native_documents: beforeCounts.native_documents,
    external_document_refs: beforeCounts.external_document_refs,
    indexed_files: beforeCounts.file_index,
    review_packets: reviewPacketCount,
    activity_logs: beforeCounts.activities,
    evidence_artifacts: beforeCounts.evidence_artifacts,
    task_project_links: beforeCounts.task_projects,
  };
  const reportBase: Omit<Phase2MigrationInventoryReport, 'markdown'> = {
    dryRun: true,
    generatedAt: (options.now ?? new Date()).toISOString(),
    counts,
    gapCategories: PHASE2_MIGRATION_INVENTORY_GAP_CODES.map((code) => gaps[code]),
    noMutationProof,
    rollbackNotes: [
      'THE-86 inventory mode only reads existing task, project, document, activity, and artifact tables.',
      'No task metadata, activity payloads, document refs, evidence artifacts, or project links are updated by this report.',
      'Unknown owners, initiators, worktypes, weak activity, missing receipts, and permission uncertainty remain explicit cleanup categories.',
      'Backfill mutation belongs to later THE-87 through THE-89 slices and must preserve confidence/provenance.',
    ],
  };

  return {
    ...reportBase,
    markdown: buildPhase2MigrationInventoryMarkdown(reportBase),
  };
}

const REVIEW_EVIDENCE_MAPPING_VERSION = 'THE-88';

function pushReviewEvidenceWarning(
  target: ReviewEvidenceMappingWarning[],
  code: ReviewEvidenceMappingWarningCode,
  message: string,
  severity: ReviewEvidenceMappingWarning['severity'],
  source: string
): void {
  target.push({ code, message, severity, source });
}

function getReviewPacketFromMetadata(metadata: Record<string, unknown>): {
  source: ReviewEvidenceTaskMappingResult['review_packet_source'];
  packet: Record<string, unknown> | null;
} {
  if (isPlainObject(metadata.review_packet)) {
    return { source: 'metadata.review_packet', packet: metadata.review_packet };
  }
  if (isPlainObject(metadata.review_brief)) {
    return { source: 'metadata.review_brief', packet: metadata.review_brief };
  }
  return { source: null, packet: null };
}

function mapReviewEvidenceReference(input: {
  source_field: string;
  legacy_value: string | null | undefined;
  task_id: number;
  link_role: string;
}): ReviewEvidenceStructuredReference {
  const planned = planLegacyFileArtifactReferenceMigration({
    source_table: 'tasks',
    source_field: input.source_field,
    legacy_value: input.legacy_value,
    task_id: input.task_id,
    link_role: input.link_role,
  });
  return {
    source_field: input.source_field,
    legacy_value: planned.legacy_value,
    object_ref: planned.object_ref,
    confidence: planned.confidence,
    warnings: planned.warnings,
  };
}

function collectReviewEvidenceReferences(
  taskId: number,
  packetSource: NonNullable<ReviewEvidenceTaskMappingResult['review_packet_source']>,
  packet: Record<string, unknown>,
  warnings: ReviewEvidenceMappingWarning[]
): {
  evidence: ReviewEvidenceStructuredReference[];
  outputs: ReviewEvidenceStructuredReference[];
  doneCriteria: ReviewEvidenceDoneCriterion[];
} {
  const outputs: ReviewEvidenceStructuredReference[] = [];
  const outputValue = firstStringValue(packet, ['output_artifact', 'outputArtifact', 'artifact_path', 'artifactPath']);
  if (outputValue) {
    outputs.push(mapReviewEvidenceReference({
      source_field: `${packetSource}.output_artifact`,
      legacy_value: outputValue,
      task_id: taskId,
      link_role: 'output_artifact',
    }));
  }

  const evidence: ReviewEvidenceStructuredReference[] = [];
  const rawEvidence = packet.evidence;
  if (Array.isArray(rawEvidence) && rawEvidence.length > 0) {
    rawEvidence.forEach((entry, index) => {
      const legacyValue = typeof entry === 'string'
        ? entry
        : isPlainObject(entry)
          ? firstStringValue(entry, ['artifact', 'path', 'url', 'href', 'file_path'])
          : null;
      const mapped = mapReviewEvidenceReference({
        source_field: `${packetSource}.evidence[${index}]`,
        legacy_value: legacyValue,
        task_id: taskId,
        link_role: 'evidence',
      });
      evidence.push(mapped);
      if (mapped.warnings.includes('ambiguous_document_reference')) {
        pushReviewEvidenceWarning(
          warnings,
          'ambiguous_evidence_reference',
          'Legacy evidence value could not be confidently mapped to an EvidenceArtifact, NativeDocument, or ExternalDocumentRef.',
          'warning',
          mapped.source_field
        );
      }
    });
  } else {
    pushReviewEvidenceWarning(
      warnings,
      'missing_evidence',
      'Review packet has no evidence array to map.',
      'warning',
      `${packetSource}.evidence`
    );
  }

  const doneCriteria: ReviewEvidenceDoneCriterion[] = [];
  const rawCriteria = packet.done_criteria ?? packet.doneCriteria ?? packet.criteria;
  const criteriaEntries = Array.isArray(rawCriteria) ? rawCriteria : rawCriteria ? [rawCriteria] : [];
  criteriaEntries.forEach((entry, index) => {
    const sourceField = `${packetSource}.done_criteria[${index}]`;
    if (typeof entry === 'string') {
      const text = normalizeBlockerReason(entry);
      if (text) {
        doneCriteria.push({ source_field: sourceField, text, completed: null });
      }
      return;
    }
    if (!isPlainObject(entry)) {
      return;
    }
    const text = firstStringValue(entry, ['text', 'criterion', 'description', 'label']);
    if (!text) {
      return;
    }
    const completedValue = entry.completed ?? entry.done ?? entry.checked;
    const completed = typeof completedValue === 'boolean' ? completedValue : null;
    doneCriteria.push({ source_field: sourceField, text, completed });
  });

  return { evidence, outputs, doneCriteria };
}

function isWeakActivityMapping(row: Record<string, unknown>): boolean {
  const eventType = normalizeActivityEventType(row.activity_event_type);
  const schemaStatus = normalizeActivityEventSchemaStatus(row.activity_event_schema_status);
  const parsedPayload = parseActivityPayloadForBackfill(row.activity_event_payload_json);
  return !eventType || schemaStatus === 'legacy_unknown' || !normalizePositiveInteger(row.task_id) || parsedPayload.malformed;
}

function mapActivityForReviewEvidence(row: Record<string, unknown>): ReviewEvidenceActivityMapping {
  const activityId = Number(row.id);
  const projection = buildActivityBackfillProjection(row);
  const warnings: ReviewEvidenceMappingWarning[] = [];
  if (isWeakActivityMapping(row)) {
    pushReviewEvidenceWarning(
      warnings,
      'weak_activity_structure',
      'Activity row lacks a confident structured ActivityEvent mapping or task link.',
      'warning',
      `activities:${activityId}`
    );
  }

  return {
    activity_id: activityId,
    task_id: projection.taskId,
    event_type: normalizeActivityEventType(row.activity_event_type) ?? projection.eventType ?? 'unmapped',
    schema_status: projection.schemaStatus,
    confidence: warnings.length > 0 ? 'unknown' : projection.confidence,
    warnings,
  };
}

function calculateReviewEvidenceConfidence(input: {
  hasReviewPacket: boolean;
  evidence: ReviewEvidenceStructuredReference[];
  outputs: ReviewEvidenceStructuredReference[];
  warnings: ReviewEvidenceMappingWarning[];
}): ReviewEvidenceMappingConfidence {
  if (!input.hasReviewPacket) {
    return 'unknown';
  }
  if (input.warnings.some((warning) => warning.code === 'missing_receipt' || warning.code === 'missing_evidence')) {
    return 'low';
  }
  const references = [...input.evidence, ...input.outputs];
  if (references.length === 0) {
    return 'low';
  }
  return references.every((reference) => reference.object_ref) ? 'medium' : 'low';
}

function buildReviewEvidenceAudit(result: ReviewEvidenceTaskMappingResult): Record<string, unknown> {
  return {
    version: REVIEW_EVIDENCE_MAPPING_VERSION,
    confidence: result.confidence,
    review_packet_source: result.review_packet_source,
    receipt_status: result.receipt_status,
    evidence_fields: result.evidence_fields,
    output_artifacts: result.output_artifacts,
    done_criteria: result.done_criteria,
    activity_events: result.activity_events,
    warnings: result.warnings,
    provenance: {
      source: 'legacy_task_metadata_and_activity_rows',
      note: 'THE-88 mapping records structured references only; it does not create raw historical receipts.',
    },
  };
}

function renderReviewEvidenceMappingMarkdown(report: Omit<ReviewEvidenceMappingReport, 'markdown'>): string {
  const lines = [
    '# THE-88 Review Packet / Evidence Mapping Report',
    '',
    `- Mode: ${report.dryRun ? 'dry-run' : 'apply'}`,
    `- Total tasks scanned: ${report.totalTasks}`,
    `- Tasks needing update: ${report.tasksNeedingUpdate}`,
    `- Review packets mapped: ${report.reviewPacketsMapped}`,
    `- Evidence fields mapped: ${report.evidenceFieldsMapped}`,
    `- Output artifacts mapped: ${report.outputArtifactsMapped}`,
    `- Done criteria mapped: ${report.doneCriteriaMapped}`,
    `- Missing receipts: ${report.missingReceipts}`,
    `- Weak activity flags: ${report.weakActivityFlags}`,
    '',
    '## Sample Results',
  ];

  const sample = report.taskResults.filter((result) => result.would_update || result.warnings.length > 0).slice(0, 5);
  if (sample.length === 0) {
    lines.push('- No review/evidence mappings or cleanup warnings detected.');
  } else {
    for (const result of sample) {
      lines.push(
        `- Task ${result.task_id} (${result.title}): receipt=${result.receipt_status}, evidence=${result.evidence_fields.length}, outputs=${result.output_artifacts.length}, weak_activity=${result.activity_events.filter((event) => event.warnings.length > 0).length}, warnings=${result.warnings.length}, applied=${result.applied}`
      );
      for (const warning of result.warnings.slice(0, 5)) {
        lines.push(`  - ${warning.code}: ${warning.message}`);
      }
    }
  }

  lines.push('', '## Rollback / Non-Destructive Notes', ...report.rollbackNotes.map((note) => `- ${note}`));
  return `${lines.join('\n')}\n`;
}

export function mapReviewPacketsAndEvidenceForPhase2(
  options: ReviewEvidenceMappingOptions = {}
): ReviewEvidenceMappingReport {
  const dryRun = options.dryRun !== false;
  const db = options.db ?? getEntityDatabase();
  const limit = typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  const rows = db.prepare(`
    SELECT id, name, "column", output, metadata
    FROM tasks
    ORDER BY id ASC
    ${limit ? 'LIMIT ?' : ''}
  `).all(...(limit ? [limit] : [])) as Array<Record<string, unknown>>;

  const activityRows = tableExists(db, 'activities')
    ? db.prepare(`
        SELECT *
        FROM activities
        ORDER BY id ASC
      `).all() as Array<Record<string, unknown>>
    : [];
  const activitiesByTask = new Map<number, Record<string, unknown>[]>();
  for (const activity of activityRows) {
    const taskId = normalizePositiveInteger(activity.task_id);
    if (!taskId) {
      continue;
    }
    const existing = activitiesByTask.get(taskId) ?? [];
    existing.push(activity);
    activitiesByTask.set(taskId, existing);
  }

  const updateStmt = db.prepare('UPDATE tasks SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  const taskResults: ReviewEvidenceTaskMappingResult[] = [];

  const applyOne = (row: Record<string, unknown>): void => {
    const taskId = Number(row.id);
    const metadata = parseJsonObject(row.metadata);
    const { source: packetSource, packet } = getReviewPacketFromMetadata(metadata);
    const warnings: ReviewEvidenceMappingWarning[] = [];
    const hasReviewPacket = Boolean(packet && packetSource);
    let evidence: ReviewEvidenceStructuredReference[] = [];
    let outputs: ReviewEvidenceStructuredReference[] = [];
    let doneCriteria: ReviewEvidenceDoneCriterion[] = [];

    if (packet && packetSource) {
      const collected = collectReviewEvidenceReferences(taskId, packetSource, packet, warnings);
      evidence = collected.evidence;
      outputs = collected.outputs;
      doneCriteria = collected.doneCriteria;
    }

    const outputReference = normalizeBlockerReason(row.output);
    if (outputReference) {
      outputs.push(mapReviewEvidenceReference({
        source_field: 'tasks.output',
        legacy_value: outputReference,
        task_id: taskId,
        link_role: 'output',
      }));
    }

    const receiptStatus: ReviewEvidenceReceiptStatus = isCompletedTaskColumn(row.column)
      ? hasRawReceiptForTask(db, taskId)
        ? 'raw_receipt_present'
        : 'missing_receipt'
      : 'not_applicable';
    if (receiptStatus === 'missing_receipt') {
      pushReviewEvidenceWarning(
        warnings,
        'missing_receipt',
        'Historical completed task has no canonical raw receipt artifact; no fake receipt was created.',
        'blocking_for_done',
        'evidence_artifacts.raw_task_receipt'
      );
    }

    const activityEvents = (activitiesByTask.get(taskId) ?? []).map(mapActivityForReviewEvidence);
    for (const activityEvent of activityEvents) {
      warnings.push(...activityEvent.warnings);
    }

    if (!hasReviewPacket && (receiptStatus === 'missing_receipt' || activityEvents.some((event) => event.warnings.length > 0))) {
      pushReviewEvidenceWarning(
        warnings,
        'missing_review_packet',
        'Task has receipt/activity migration warnings but no legacy review packet to structure.',
        'info',
        'tasks.metadata.review_packet'
      );
    }

    const confidence = calculateReviewEvidenceConfidence({ hasReviewPacket, evidence, outputs, warnings });
    const resultBase: Omit<ReviewEvidenceTaskMappingResult, 'would_update' | 'applied'> = {
      task_id: taskId,
      title: String(row.name ?? ''),
      has_review_packet: hasReviewPacket,
      review_packet_source: packetSource,
      evidence_fields: evidence,
      output_artifacts: outputs,
      done_criteria: doneCriteria,
      activity_events: activityEvents,
      receipt_status: receiptStatus,
      confidence,
      warnings,
    };
    const hasMappingSignal =
      hasReviewPacket ||
      evidence.length > 0 ||
      outputs.length > 0 ||
      doneCriteria.length > 0 ||
      receiptStatus === 'missing_receipt' ||
      activityEvents.some((event) => event.warnings.length > 0);
    const existingAudit = metadata.phase2_review_evidence_mapping;
    const resultForAudit: ReviewEvidenceTaskMappingResult = {
      ...resultBase,
      would_update: false,
      applied: false,
    };
    const nextAudit = hasMappingSignal ? buildReviewEvidenceAudit(resultForAudit) : null;
    const wouldUpdate =
      nextAudit !== null &&
      JSON.stringify(existingAudit ?? null) !== JSON.stringify(nextAudit);
    const result: ReviewEvidenceTaskMappingResult = {
      ...resultBase,
      would_update: wouldUpdate,
      applied: !dryRun && wouldUpdate,
    };

    if (!dryRun && wouldUpdate && nextAudit) {
      updateStmt.run(JSON.stringify({
        ...metadata,
        phase2_review_evidence_mapping: nextAudit,
      }), taskId);
    }

    taskResults.push(result);
  };

  const transaction = db.transaction(() => {
    for (const row of rows) {
      applyOne(row);
    }
  });

  if (dryRun) {
    for (const row of rows) {
      applyOne(row);
    }
  } else {
    transaction();
  }

  const reportBase: Omit<ReviewEvidenceMappingReport, 'markdown'> = {
    dryRun,
    totalTasks: rows.length,
    tasksNeedingUpdate: taskResults.filter((result) => result.would_update).length,
    reviewPacketsMapped: taskResults.filter((result) => result.has_review_packet).length,
    evidenceFieldsMapped: taskResults.reduce((sum, result) => sum + result.evidence_fields.filter((field) => field.object_ref).length, 0),
    outputArtifactsMapped: taskResults.reduce((sum, result) => sum + result.output_artifacts.filter((field) => field.object_ref).length, 0),
    doneCriteriaMapped: taskResults.reduce((sum, result) => sum + result.done_criteria.length, 0),
    missingReceipts: taskResults.filter((result) => result.receipt_status === 'missing_receipt').length,
    weakActivityFlags: taskResults.reduce((sum, result) => sum + result.activity_events.filter((event) => event.warnings.length > 0).length, 0),
    taskResults,
    rollbackNotes: [
      'Dry-run mode performs no writes.',
      'Apply mode only writes tasks.metadata.phase2_review_evidence_mapping with structured references, warnings, provenance, and confidence.',
      'Historical completed tasks without raw_task_receipt artifacts are marked missing_receipt; this mapper never creates raw historical receipts.',
      'Weak activity rows are flagged as weak_activity_structure instead of being rewritten as certain structured events.',
      'Rollback is narrow: remove or supersede tasks.metadata.phase2_review_evidence_mapping for affected task IDs.',
    ],
  };

  return {
    ...reportBase,
    markdown: renderReviewEvidenceMappingMarkdown(reportBase),
  };
}

const MIGRATION_CLEANUP_VERSION = 'THE-89' as const;

const MIGRATION_CLEANUP_QUEUE_CODES = [
  'missing_owner',
  'unknown_initiator',
  'missing_project',
  'missing_assignee',
  'missing_receipt',
  'unknown_worktype',
  'weak_activity_structure',
  'permission_mapping_uncertain',
  'missing_review_packet',
  'missing_evidence',
  'ambiguous_evidence_reference',
  'ambiguous_team',
] as const satisfies readonly MigrationCleanupQueueCode[];

function isMigrationCleanupQueueCode(value: unknown): value is MigrationCleanupQueueCode {
  return typeof value === 'string' && (MIGRATION_CLEANUP_QUEUE_CODES as readonly string[]).includes(value);
}

function migrationCleanupSeverity(code: MigrationCleanupQueueCode): MigrationCleanupQueueItem['severity'] {
  if (code === 'missing_owner' || code === 'missing_assignee') {
    return 'blocking_for_execution';
  }
  if (code === 'missing_receipt') {
    return 'blocking_for_done';
  }
  if (code === 'missing_review_packet') {
    return 'info';
  }
  return 'warning';
}

function migrationCleanupMessage(code: MigrationCleanupQueueCode): string {
  const inventoryDefinition = PHASE2_MIGRATION_INVENTORY_GAP_DEFINITIONS[code as Phase2MigrationInventoryGapCode];
  if (inventoryDefinition) {
    return inventoryDefinition.description;
  }
  const extraMessages: Partial<Record<MigrationCleanupQueueCode, string>> = {
    missing_review_packet: 'Task has receipt/activity migration warnings but no legacy review packet to structure.',
    missing_evidence: 'Review packet has no evidence array to map.',
    ambiguous_evidence_reference: 'Legacy evidence value could not be confidently mapped to an artifact or document object.',
    ambiguous_team: 'Task team could not be inferred from a direct task field or linked project.',
  };
  return extraMessages[code] ?? 'Migration cleanup warning requires human review.';
}

function readMigrationCleanupCorrections(metadata: Record<string, unknown>): MigrationCleanupCorrectionRecord[] {
  const rawCorrections = metadata.phase2_cleanup_corrections;
  if (!Array.isArray(rawCorrections)) {
    return [];
  }
  return rawCorrections.filter((entry): entry is MigrationCleanupCorrectionRecord => {
    if (!isPlainObject(entry)) {
      return false;
    }
    return (
      entry.version === MIGRATION_CLEANUP_VERSION &&
      isMigrationCleanupQueueCode(entry.code) &&
      typeof entry.field_name === 'string' &&
      typeof entry.corrected_by_principal_id === 'string' &&
      entry.authoritative === true
    );
  });
}

function findMigrationCleanupCorrection(
  corrections: MigrationCleanupCorrectionRecord[],
  code: MigrationCleanupQueueCode,
  fieldName: MigrationCleanupCorrectionField | null
): MigrationCleanupCorrectionRecord | null {
  return corrections.find((correction) => (
    correction.code === code &&
    (fieldName === null || correction.field_name === fieldName || correction.field_name === 'acknowledgement')
  )) ?? null;
}

function migrationCleanupCorrectedFields(metadata: Record<string, unknown>): Set<MigrationCleanupCorrectionField> {
  return new Set(readMigrationCleanupCorrections(metadata).map((correction) => correction.field_name));
}

function readTaskCleanupValue(row: Record<string, unknown>, fieldName: MigrationCleanupCorrectionField | null): string | number | boolean | null {
  if (!fieldName || fieldName === 'acknowledgement') {
    return null;
  }
  if (fieldName === 'project_id') {
    return normalizePositiveInteger(row.project_id);
  }
  const value = row[fieldName];
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return normalizeBlockerReason(value);
}

function pushMigrationCleanupItem(
  target: MigrationCleanupQueueItem[],
  seen: Set<string>,
  input: {
    code: MigrationCleanupQueueCode;
    object_type: MigrationCleanupQueueObjectType;
    object_id: string;
    task_id?: number | null;
    activity_id?: number | null;
    title: string;
    message?: string | null;
    source: string;
    field_name?: MigrationCleanupCorrectionField | null;
    current_value?: string | number | boolean | null;
    corrections?: MigrationCleanupCorrectionRecord[];
    includeCorrected: boolean;
  }
): void {
  const fieldName = input.field_name ?? null;
  const correction = findMigrationCleanupCorrection(input.corrections ?? [], input.code, fieldName);
  const status: MigrationCleanupQueueItem['status'] = correction ? 'corrected' : 'open';
  if (status === 'corrected' && !input.includeCorrected) {
    return;
  }
  const id = `${input.object_type}:${input.object_id}:${input.code}:${fieldName ?? 'object'}`;
  if (seen.has(id)) {
    return;
  }
  seen.add(id);
  target.push({
    id,
    code: input.code,
    severity: migrationCleanupSeverity(input.code),
    object_type: input.object_type,
    object_id: input.object_id,
    task_id: input.task_id ?? null,
    activity_id: input.activity_id ?? null,
    title: input.title,
    message: input.message ?? migrationCleanupMessage(input.code),
    source: input.source,
    field_name: fieldName,
    current_value: input.current_value ?? null,
    status,
    correction,
    old_task_visible: true,
  });
}

function renderMigrationCleanupQueueMarkdown(report: Omit<MigrationCleanupQueueReport, 'markdown'>): string {
  const lines = [
    '# THE-89 Migration Warning / Cleanup Queue Report',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Total queue items: ${report.totalItems}`,
    `- Open queue items: ${report.openItems}`,
    `- Corrected queue items: ${report.correctedItems}`,
    '',
    '## Queues',
  ];

  for (const queue of report.queues) {
    lines.push(`- ${queue.code}: ${queue.open} open, ${queue.corrected} corrected (${queue.severity})`);
  }

  lines.push('', '## Sample Items');
  const sample = report.items.slice(0, 8);
  if (sample.length === 0) {
    lines.push('- No migration cleanup warnings detected.');
  } else {
    for (const item of sample) {
      lines.push(
        `- ${item.id}: status=${item.status}, source=${item.source}, field=${item.field_name ?? 'object'}, visible=${item.old_task_visible}`
      );
      lines.push(`  - ${item.message}`);
    }
  }

  lines.push('', '## Rollback / Non-Destructive Notes', ...report.rollbackNotes.map((note) => `- ${note}`));
  return `${lines.join('\n')}\n`;
}

function summarizeMigrationCleanupQueues(items: MigrationCleanupQueueItem[]): MigrationCleanupQueueSummary[] {
  return MIGRATION_CLEANUP_QUEUE_CODES.map((code) => {
    const matching = items.filter((item) => item.code === code);
    return {
      code,
      count: matching.length,
      severity: migrationCleanupSeverity(code),
      open: matching.filter((item) => item.status === 'open').length,
      corrected: matching.filter((item) => item.status === 'corrected').length,
    };
  }).filter((summary) => summary.count > 0);
}

export function buildMigrationCleanupQueuesForPhase2(
  options: MigrationCleanupQueueOptions = {}
): MigrationCleanupQueueReport {
  const db = options.db ?? getEntityDatabase();
  const limit = typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  const includeCorrected = options.includeCorrected === true;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const items: MigrationCleanupQueueItem[] = [];
  const seen = new Set<string>();
  const taskCorrections = new Map<number, MigrationCleanupCorrectionRecord[]>();

  const taskRows = db.prepare(`
    SELECT
      t.*,
      (
        SELECT p.id
        FROM task_projects tp
        INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tp.org_id
        WHERE tp.task_id = t.id
        ORDER BY p.id ASC
        LIMIT 1
      ) AS linked_project_id,
      (
        SELECT p.team_id
        FROM task_projects tp
        INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tp.org_id
        WHERE tp.task_id = t.id
        ORDER BY p.id ASC
        LIMIT 1
      ) AS linked_project_team_id
    FROM tasks t
    ORDER BY t.id ASC
    ${limit ? 'LIMIT ?' : ''}
  `).all(...(limit ? [limit] : [])) as TaskBackfillRow[];

  for (const row of taskRows) {
    const taskId = Number(row.id);
    const metadata = parseJsonObject(row.metadata);
    const corrections = readMigrationCleanupCorrections(metadata);
    taskCorrections.set(taskId, corrections);
    const title = String(row.name ?? `Task ${taskId}`);
    const taskObjectId = String(taskId);
    const pushTaskWarning = (
      code: MigrationCleanupQueueCode,
      fieldName: MigrationCleanupCorrectionField | null,
      source: string,
      message?: string | null
    ) => pushMigrationCleanupItem(items, seen, {
      code,
      object_type: 'task',
      object_id: taskObjectId,
      task_id: taskId,
      title,
      message,
      source,
      field_name: fieldName,
      current_value: readTaskCleanupValue(row, fieldName),
      corrections,
      includeCorrected,
    });

    if (isLegacyPrincipalMarker(row.owner_principal_id, ['legacy-owner', 'unknown'])) {
      pushTaskWarning('missing_owner', 'owner_principal_id', 'tasks.owner_principal_id');
    }
    if (isLegacyPrincipalMarker(row.initiator_principal_id, ['legacy-unknown', 'unknown'])) {
      pushTaskWarning('unknown_initiator', 'initiator_principal_id', 'tasks.initiator_principal_id');
    }
    if (!normalizePositiveInteger(row.project_id) && !normalizePositiveInteger(row.linked_project_id)) {
      pushTaskWarning('missing_project', 'project_id', 'tasks.project_id');
    }
    if (!normalizeBlockerReason(row.team_id) && !normalizeBlockerReason(row.linked_project_team_id)) {
      pushTaskWarning('ambiguous_team', 'team_id', 'tasks.team_id');
    }
    if (
      isBackfillExecutableColumn(row.column) &&
      !isAssignablePrincipal(row.assignee) &&
      !isAssignablePrincipal(row.executor_principal_id) &&
      !normalizeBlocked(row.taskmaster_drivable)
    ) {
      pushTaskWarning('missing_assignee', 'assignee', 'tasks.assignee');
    }
    if (isCompletedTaskColumn(row.column) && !hasRawReceiptForTask(db, taskId)) {
      pushTaskWarning('missing_receipt', 'acknowledgement', 'evidence_artifacts.raw_task_receipt');
    }
    if (!getWorktypeRegistryEntry(row.worktype)) {
      pushTaskWarning('unknown_worktype', 'worktype', 'tasks.worktype');
    }

    const backfill = isPlainObject(metadata.phase2_backfill) ? metadata.phase2_backfill : null;
    const backfillWarnings = Array.isArray(backfill?.warnings) ? backfill.warnings : [];
    for (const warning of backfillWarnings) {
      if (!isPlainObject(warning) || !isMigrationCleanupQueueCode(warning.code)) {
        continue;
      }
      pushTaskWarning(
        warning.code,
        warning.code === 'missing_owner' ? 'owner_principal_id'
          : warning.code === 'unknown_initiator' ? 'initiator_principal_id'
            : warning.code === 'missing_project' ? 'project_id'
              : warning.code === 'missing_assignee' ? 'assignee'
                : null,
        'tasks.metadata.phase2_backfill',
        normalizeBlockerReason(warning.message)
      );
    }

    const reviewMapping = isPlainObject(metadata.phase2_review_evidence_mapping)
      ? metadata.phase2_review_evidence_mapping
      : null;
    const reviewWarnings = Array.isArray(reviewMapping?.warnings) ? reviewMapping.warnings : [];
    for (const warning of reviewWarnings) {
      if (!isPlainObject(warning) || !isMigrationCleanupQueueCode(warning.code)) {
        continue;
      }
      pushTaskWarning(
        warning.code,
        warning.code === 'missing_receipt' ? 'acknowledgement' : null,
        normalizeBlockerReason(warning.source) ?? 'tasks.metadata.phase2_review_evidence_mapping',
        normalizeBlockerReason(warning.message)
      );
    }

    if (includeCorrected) {
      for (const correction of corrections) {
        pushTaskWarning(
          correction.code,
          correction.field_name,
          'tasks.metadata.phase2_cleanup_corrections',
          `Human correction recorded by ${correction.corrected_by_principal_id}.`
        );
      }
    }
  }

  if (tableExists(db, 'activities')) {
    const activityRows = db.prepare(`
      SELECT id, task_id, activity_event_type, activity_event_schema_status, activity_event_payload_json, action, description
      FROM activities
      ORDER BY id ASC
      ${limit ? 'LIMIT ?' : ''}
    `).all(...(limit ? [limit] : [])) as Array<Record<string, unknown>>;
    for (const row of activityRows) {
      if (!isWeakActivityMapping(row)) {
        continue;
      }
      const activityId = Number(row.id);
      const taskId = normalizePositiveInteger(row.task_id);
      pushMigrationCleanupItem(items, seen, {
        code: 'weak_activity_structure',
        object_type: 'activity',
        object_id: String(activityId),
        task_id: taskId,
        activity_id: activityId,
        title: normalizeBlockerReason(row.action) ?? normalizeBlockerReason(row.description) ?? `Activity ${activityId}`,
        source: `activities:${activityId}`,
        field_name: null,
        corrections: taskId ? taskCorrections.get(taskId) : undefined,
        includeCorrected,
      });
    }
  }

  if (tableExists(db, 'native_documents')) {
    const rows = db.prepare(`
      SELECT id, title, sensitivity, acl_json
      FROM native_documents
      WHERE (sensitivity IS NULL OR trim(sensitivity) = '')
        AND (acl_json IS NULL OR trim(acl_json) = '' OR trim(acl_json) = '{}')
      ORDER BY id ASC
      ${limit ? 'LIMIT ?' : ''}
    `).all(...(limit ? [limit] : [])) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const id = String(row.id);
      pushMigrationCleanupItem(items, seen, {
        code: 'permission_mapping_uncertain',
        object_type: 'native_document',
        object_id: id,
        title: normalizeBlockerReason(row.title) ?? id,
        source: 'native_documents.sensitivity_acl',
        includeCorrected,
      });
    }
  }

  if (tableExists(db, 'external_document_refs')) {
    const rows = db.prepare(`
      SELECT id, title, entity_visibility_policy_json, external_permission_summary
      FROM external_document_refs
      WHERE (entity_visibility_policy_json IS NULL OR trim(entity_visibility_policy_json) = '' OR trim(entity_visibility_policy_json) = '{}')
        AND (external_permission_summary IS NULL OR trim(external_permission_summary) = '')
      ORDER BY id ASC
      ${limit ? 'LIMIT ?' : ''}
    `).all(...(limit ? [limit] : [])) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const id = String(row.id);
      pushMigrationCleanupItem(items, seen, {
        code: 'permission_mapping_uncertain',
        object_type: 'external_document_ref',
        object_id: id,
        title: normalizeBlockerReason(row.title) ?? id,
        source: 'external_document_refs.entity_visibility_policy',
        includeCorrected,
      });
    }
  }

  if (tableExists(db, 'evidence_artifacts')) {
    const rows = db.prepare(`
      SELECT id, title, metadata_json
      FROM evidence_artifacts
      WHERE metadata_json IS NULL
        OR trim(metadata_json) = ''
        OR trim(metadata_json) = '{}'
      ORDER BY id ASC
      ${limit ? 'LIMIT ?' : ''}
    `).all(...(limit ? [limit] : [])) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const id = String(row.id);
      pushMigrationCleanupItem(items, seen, {
        code: 'permission_mapping_uncertain',
        object_type: 'evidence_artifact',
        object_id: id,
        title: normalizeBlockerReason(row.title) ?? id,
        source: 'evidence_artifacts.metadata_json',
        includeCorrected,
      });
    }
  }

  const reportBase: Omit<MigrationCleanupQueueReport, 'markdown'> = {
    generatedAt,
    totalItems: items.length,
    openItems: items.filter((item) => item.status === 'open').length,
    correctedItems: items.filter((item) => item.status === 'corrected').length,
    queues: summarizeMigrationCleanupQueues(items),
    items,
    rollbackNotes: [
      'THE-89 cleanup queues are derived from current rows plus migration metadata; no queue table is required for visibility.',
      'Human corrections are stored in tasks.metadata.phase2_cleanup_corrections and, for supported task fields, applied to the task field itself.',
      'Backfill reruns treat human-corrected fields as authoritative and do not overwrite them.',
      'Missing historical receipts can be acknowledged for cleanup tracking, but this flow never creates fake raw task receipts.',
    ],
  };

  return {
    ...reportBase,
    markdown: renderMigrationCleanupQueueMarkdown(reportBase),
  };
}

function normalizeCleanupCorrectionValue(
  fieldName: MigrationCleanupCorrectionField,
  value: string | number | boolean | null
): string | number | boolean | null {
  if (fieldName === 'acknowledgement') {
    return normalizeBlockerReason(value) ?? 'acknowledged';
  }
  if (fieldName === 'project_id') {
    const normalized = normalizePositiveInteger(value);
    if (!normalized) {
      throw new Error('project_id correction must be a positive integer');
    }
    return normalized;
  }
  if (fieldName === 'team_id' || fieldName === 'owner_principal_id' || fieldName === 'initiator_principal_id' || fieldName === 'assignee' || fieldName === 'executor_principal_id') {
    const normalized = normalizeBlockerReason(value);
    if (!normalized) {
      throw new Error(`${fieldName} correction must be a non-empty string`);
    }
    return normalized;
  }
  if (fieldName === 'worktype') {
    return normalizeWorktype(value);
  }
  return value;
}

export function applyMigrationCleanupCorrectionForPhase2(
  input: ApplyMigrationCleanupCorrectionInput
): ApplyMigrationCleanupCorrectionResult {
  const db = input.db ?? getEntityDatabase();
  const taskId = normalizePositiveInteger(input.task_id);
  if (!taskId) {
    throw new Error('task_id must be a positive integer');
  }
  if (!isMigrationCleanupQueueCode(input.code)) {
    throw new Error('cleanup code is not supported');
  }
  const correctedBy = normalizeBlockerReason(input.corrected_by_principal_id);
  if (!correctedBy) {
    throw new Error('corrected_by_principal_id is required');
  }
  const fieldName = input.field_name;
  const correctedValue = normalizeCleanupCorrectionValue(fieldName, input.corrected_value);
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error('task not found');
  }
  const metadata = parseJsonObject(row.metadata);
  const previousValue = readTaskCleanupValue(row, fieldName);
  const correction: MigrationCleanupCorrectionRecord = {
    version: MIGRATION_CLEANUP_VERSION,
    code: input.code,
    field_name: fieldName,
    previous_value: previousValue,
    corrected_value: correctedValue,
    corrected_by_principal_id: correctedBy,
    corrected_at: normalizeBlockerReason(input.corrected_at) ?? new Date().toISOString(),
    note: normalizeBlockerReason(input.note),
    authoritative: true,
  };
  const priorCorrections = readMigrationCleanupCorrections(metadata)
    .filter((entry) => !(entry.code === correction.code && entry.field_name === correction.field_name));
  const nextMetadata = JSON.stringify({
    ...metadata,
    phase2_cleanup_corrections: [...priorCorrections, correction],
    migration_warning: true,
  });
  const fields = ['metadata = ?'];
  const values: unknown[] = [nextMetadata];

  if (fieldName === 'owner_principal_id') {
    fields.push('owner_principal_id = ?', 'owner_principal_type = ?');
    values.push(correctedValue, 'human');
  } else if (fieldName === 'initiator_principal_id') {
    fields.push('initiator_principal_id = ?', 'initiator_type = ?');
    values.push(correctedValue, 'human');
  } else if (fieldName === 'project_id') {
    fields.push('project_id = ?');
    values.push(correctedValue);
  } else if (fieldName === 'team_id') {
    fields.push('team_id = ?');
    values.push(correctedValue);
  } else if (fieldName === 'assignee') {
    fields.push('assignee = ?', 'assignment_state = ?');
    values.push(correctedValue, 'assigned');
  } else if (fieldName === 'executor_principal_id') {
    fields.push('executor_principal_id = ?', 'assignment_state = ?');
    values.push(correctedValue, 'assigned');
  } else if (fieldName === 'worktype') {
    fields.push('worktype = ?');
    values.push(correctedValue);
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(taskId);
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const refreshed = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
  return {
    task_id: taskId,
    correction,
    task: mapTaskRow(refreshed),
  };
}

function previewPolicyObject(value: string | null | undefined): Record<string, unknown> {
  return parseJsonObject(value);
}

export function buildDocumentObjectPreviewEnvelope(input: DocumentObjectPreviewInput): DocumentObjectPreviewEnvelope {
  const reasons: string[] = [];
  const acl = previewPolicyObject(input.acl_json);
  const visibility = previewPolicyObject(input.entity_visibility_policy_json);
  const sensitivity = normalizeBlockerReason(input.sensitivity)?.toLowerCase() ?? '';
  const readinessState = normalizeBlockerReason(input.readiness_state)?.toLowerCase() ?? '';
  const authState = normalizeBlockerReason(input.auth_state)?.toLowerCase() ?? '';
  const restricted =
    input.can_preview === false ||
    acl.restricted === true ||
    visibility.restricted === true ||
    visibility.allow_preview === false ||
    ['people', 'hr', 'legal', 'financial', 'security', 'production', 'confidential'].some((marker) => sensitivity.includes(marker));

  if (restricted) {
    reasons.push('preview_restricted_by_entity_policy');
    return {
      object_type: input.object_type,
      title: input.title,
      permission_state: 'restricted',
      snippet: null,
      content: null,
      reasons,
    };
  }

  const degradedExternalRef =
    input.object_type === 'external_document_ref' &&
    ((authState && authState !== 'authorized') || (readinessState && readinessState !== 'ready'));

  if (degradedExternalRef) {
    reasons.push('external_document_preview_degraded');
    return {
      object_type: input.object_type,
      title: input.title,
      permission_state: 'degraded',
      snippet: null,
      content: null,
      reasons,
    };
  }

  return {
    object_type: input.object_type,
    title: input.title,
    permission_state: 'allowed',
    snippet: normalizeBlockerReason(input.snippet),
    content: normalizeBlockerReason(input.content),
    reasons,
  };
}

export interface EvidenceArtifactRecord {
  id: string;
  org_id: string;
  team_id: string | null;
  project_id: number | null;
  artifact_kind: EvidenceArtifactKind;
  title: string;
  body_format: 'markdown';
  stable_path: string;
  human_path_alias: string | null;
  content_hash: string;
  mutability_policy: EvidenceArtifactMutabilityPolicy;
  version: number;
  origin_task_id: number | null;
  source_activity_event_ids: number[];
  source_artifact_ids: string[];
  linked_object_refs: ObjectRef[];
  provenance_json: string;
  integrity_state: EvidenceArtifactIntegrityState;
  availability_state: EvidenceArtifactAvailabilityState;
  created_by_principal_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface EvidenceArtifactVersionRecord {
  id: number;
  artifact_id: string;
  version: number;
  stable_path: string;
  content_hash: string;
  metadata_json: string;
  created_by_principal_id: string | null;
  created_at: string;
}

export interface CreateEvidenceArtifactInput {
  id?: string;
  org_id?: string;
  team_id?: string | null;
  project_id?: number | null;
  artifact_kind?: EvidenceArtifactKind;
  title: string;
  body_format?: 'markdown';
  stable_path?: string;
  human_path_alias?: string | null;
  content_hash: string;
  mutability_policy?: EvidenceArtifactMutabilityPolicy;
  version?: number;
  origin_task_id?: number | null;
  source_activity_event_ids?: number[];
  source_artifact_ids?: string[];
  linked_object_refs?: ObjectRef[];
  provenance_json?: string;
  integrity_state?: EvidenceArtifactIntegrityState;
  availability_state?: EvidenceArtifactAvailabilityState;
  created_by_principal_id?: string | null;
  metadata_json?: string;
}

export interface ListEvidenceArtifactsInput {
  org_id: string;
  query?: string | null;
  artifact_kinds?: EvidenceArtifactKind[];
  team_id?: string | null;
  project_id?: number | null;
  sensitivity?: string | null;
  availability_state?: EvidenceArtifactAvailabilityState | null;
  query_origin_task_ids?: number[];
  origin_task_ids?: number[];
  team_origin_task_ids?: number[];
  project_origin_task_ids?: number[];
  sensitivity_origin_task_ids?: number[];
  require_origin_task_match?: boolean;
  from?: string | null;
  to?: string | null;
  limit?: number | null;
}

export interface UpdateEvidenceArtifactVersionInput {
  title?: string;
  stable_path?: string;
  content_hash: string;
  metadata_json?: string;
  updated_by_principal_id?: string | null;
}

export interface EvidenceArtifactRepository {
  createArtifact: (input: CreateEvidenceArtifactInput) => EvidenceArtifactRecord;
  getArtifact: (id: string) => EvidenceArtifactRecord | undefined;
  listArtifacts: (input: ListEvidenceArtifactsInput) => EvidenceArtifactRecord[];
  listArtifactsByOriginTask: (taskId: number) => EvidenceArtifactRecord[];
  updateArtifactVersion: (id: string, input: UpdateEvidenceArtifactVersionInput) => EvidenceArtifactRecord | undefined;
  listArtifactVersions: (id: string) => EvidenceArtifactVersionRecord[];
  linkArtifactObject: (id: string, objectRef: ObjectRef) => EvidenceArtifactRecord | undefined;
  updateHumanPathAlias: (id: string, humanPathAlias: string | null) => EvidenceArtifactRecord | undefined;
}

export type ActivitySource = 'agent' | 'task';

export type ActivityType =
  | 'file_edit'
  | 'tool_call'
  | 'message_sent'
  | 'command_run'
  | 'research'
  | 'thinking'
  | 'task_created'
  | 'task_updated'
  | 'task_moved'
  | 'task_completed'
  | 'task_deleted'
  | 'task_comment';

export const ACTIVITY_EVENT_PAYLOAD_VERSION = 1;

export const ACTIVITY_EVENT_TYPES = [
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
  // Workplane minimal ActivityEvent spine (THE-869 / WP1-C-01)
  ...ACTIVITY_EVENT_SPINE_TYPES,
  'legacy_event_observed',
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];
export type ActivityEventActorType = 'human' | 'agent' | 'system' | 'workflow' | 'unknown';
export type ActivityEventSchemaStatus = 'structured' | 'legacy_mapped' | 'legacy_unknown';

export type ActivityEventObjectRef = ObjectRef;

export interface ActivityEventPayload {
  version: typeof ACTIVITY_EVENT_PAYLOAD_VERSION;
  actor_principal_id?: string;
  actor_type: ActivityEventActorType;
  task_id?: number;
  object_refs?: ActivityEventObjectRef[];
  previous_state?: string;
  new_state?: string;
  reason?: string;
  policy_reason_chain?: Array<Record<string, unknown>>;
  warnings?: Array<Record<string, unknown>>;
  legacy?: {
    source_type: string;
    action?: string;
    description?: string;
  };
  data?: Record<string, unknown>;
}

export interface ActivityRecord {
  id: number;
  source: ActivitySource;
  type: ActivityType;
  activity_event_type: ActivityEventType;
  activity_event_payload_version: number;
  activity_event_payload_json: string;
  activity_event_schema_status: ActivityEventSchemaStatus;
  activity_event_legacy_type: string | null;
  action: string;
  description: string;
  agent_name: string | null;
  agent_emoji: string | null;
  file_path: string | null;
  task_id: number | null;
  task_column: string | null;
  metadata: string | null;
  created_at: string;
}

export interface CreateActivityInput {
  source?: ActivitySource;
  type: ActivityType;
  activity_event_type?: ActivityEventType | string;
  activity_event_payload?: Partial<ActivityEventPayload> | Record<string, unknown>;
  activity_event_payload_version?: number;
  activity_event_schema_status?: ActivityEventSchemaStatus;
  action: string;
  description: string;
  agent_name?: string;
  agent_emoji?: string;
  file_path?: string;
  task_id?: number;
  task_column?: string;
  model?: string;
  archived?: boolean;
  metadata?: string;
}

export interface ActivityRepository {
  listActivities: (limit?: number) => ActivityRecord[];
  listActivitiesByTaskId: (taskId: number, limit?: number) => ActivityRecord[];
  createActivity: (input: CreateActivityInput) => ActivityRecord;
}

export interface AgentLogRecord {
  id: number;
  timestamp: string;
  event: string;
  task_id: number | null;
  action: string;
  result: string | null;
  model: string;
  tokens_used: number;
}

export interface CreateAgentLogInput {
  event: string;
  task_id?: number | null;
  action: string;
  result?: string | null;
  model?: string;
  tokens_used?: number;
}

export interface AgentLogStatus {
  lastRun: string | null;
  totalActions: number;
}

export interface AgentLogRepository {
  listLogs: (limit?: number) => AgentLogRecord[];
  createLog: (input: CreateAgentLogInput) => AgentLogRecord;
  getStatus: () => AgentLogStatus;
}

export interface TaskCommentRecord {
  id: number;
  task_id: number;
  body: string;
  author: string;
  parent_id: number | null;
  created_at: string;
}

export interface CreateTaskCommentInput {
  task_id: number;
  body: string;
  author?: string;
  parent_id?: number | null;
}

export interface ListTaskCommentsOptions {
  limit?: number;
  before_id?: number | null;
}

export interface TaskCommentRepository {
  listComments: (taskId: number, options?: ListTaskCommentsOptions) => TaskCommentRecord[];
  createComment: (input: CreateTaskCommentInput) => TaskCommentRecord;
}

export interface RoadmapRecord {
  id: number;
  name: string;
  theme: string | null;
  color: string | null;
  created_at: string;
}

export interface RoadmapItemRecord {
  id: number;
  roadmap_id: number;
  title: string;
  description: string | null;
  priority: string;
  target_period: string | null;
  status: string;
  linked_task_id: number | null;
  created_at: string;
}

export interface RoadmapWithItemsRecord extends RoadmapRecord {
  items: RoadmapItemRecord[];
}

export interface CreateRoadmapInput {
  name: string;
  theme?: string;
  color?: string;
}

export interface CreateRoadmapItemInput {
  title: string;
  description?: string;
  priority?: string;
  target_period?: string;
  status?: string;
  linked_task_id?: number | null;
}

export interface UpdateRoadmapItemInput {
  title?: string;
  description?: string | null;
  priority?: string;
  target_period?: string | null;
  status?: string;
  linked_task_id?: number | null;
}

export interface ProjectRecord {
  id: number;
  org_id?: string;
  team_id?: string;
  name: string;
  color: string | null;
  lifecycle_state?: string;
  project_key: string | null;
  work_domain: string | null;
  created_at: string;
}

export interface CreateProjectInput {
  org_id?: string;
  team_id?: string;
  name: string;
  color?: string;
  lifecycle_state?: string;
  project_key?: string | null;
  work_domain?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  color?: string | null;
  lifecycle_state?: string;
  project_key?: string | null;
  work_domain?: string | null;
}

export interface OrgRecord {
  id: string;
  name: string;
  slug: string;
  status: string;
  deployment_mode: string;
  mission: string | null;
  domains_json: string;
  blueprint_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOrgInput {
  id?: string;
  name: string;
  slug?: string;
  status?: string;
  deployment_mode?: string;
  mission?: string | null;
  domains_json?: string;
  blueprint_json?: string | null;
}

export interface UpdateOrgInput {
  name?: string;
  slug?: string;
  status?: string;
  deployment_mode?: string;
  mission?: string | null;
  domains_json?: string;
  blueprint_json?: string | null;
}

export interface TeamRecord {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTeamInput {
  id?: string;
  name: string;
  slug?: string;
  status?: string;
}

export interface UpdateTeamInput {
  name?: string;
  slug?: string;
  status?: string;
}

export interface OrgQueryContext {
  orgId: string;
  teamId?: string;
}

export interface OrgScopedTaskRepository extends TaskRepository {
  readonly orgId: string;
  readonly teamId?: string;
}

export interface WorkspaceScopeRepository {
  listOrgs: () => OrgRecord[];
  getOrg: (orgId: string) => OrgRecord | undefined;
  createOrg: (input: CreateOrgInput) => OrgRecord;
  updateOrg: (orgId: string, updates: UpdateOrgInput) => OrgRecord | undefined;
  listTeams: (context: OrgQueryContext) => TeamRecord[];
  getTeam: (context: OrgQueryContext, teamId: string) => TeamRecord | undefined;
  createTeam: (context: OrgQueryContext, input: CreateTeamInput) => TeamRecord;
  updateTeam: (context: OrgQueryContext, teamId: string, updates: UpdateTeamInput) => TeamRecord | undefined;
  listProjects: (context: OrgQueryContext) => ProjectRecord[];
  getProject: (context: OrgQueryContext, projectId: number) => ProjectRecord | undefined;
  createProject: (context: OrgQueryContext, input: CreateProjectInput) => ProjectRecord;
  updateProject: (context: OrgQueryContext, projectId: number, updates: UpdateProjectInput) => ProjectRecord | undefined;
  getTaskProjects: (context: OrgQueryContext, taskId: number) => ProjectRecord[];
  addTaskProject: (context: OrgQueryContext, taskId: number, projectId: number) => boolean;
  removeTaskProject: (context: OrgQueryContext, taskId: number, projectId: number) => boolean;
}

export type TaskBackfillConfidence = 'high' | 'medium' | 'low' | 'unknown';

export type TaskBackfillWarningCode =
  | 'missing_owner'
  | 'unknown_initiator'
  | 'missing_project'
  | 'missing_assignee';

export interface TaskBackfillInferredField {
  task_id: number;
  field_name:
    | 'org_id'
    | 'team_id'
    | 'project_id'
    | 'initiator_principal_id'
    | 'initiator_type'
    | 'owner_principal_id'
    | 'owner_principal_type'
    | 'assignment_state';
  inferred_value: string | number | boolean | null;
  previous_value: string | number | boolean | null;
  source: 'project_link' | 'created_by' | 'assignee' | 'task_state';
  confidence: TaskBackfillConfidence;
}

export interface TaskBackfillWarning {
  task_id: number;
  code: TaskBackfillWarningCode;
  message: string;
  severity: 'info' | 'warning' | 'blocking_for_execution' | 'blocking_for_done';
}

export interface TaskBackfillTaskResult {
  task_id: number;
  title: string;
  inferred_fields: TaskBackfillInferredField[];
  warnings: TaskBackfillWarning[];
  would_update: boolean;
  applied: boolean;
}

export interface TaskHierarchyBackfillReport {
  dryRun: boolean;
  totalTasks: number;
  tasksNeedingUpdate: number;
  fieldsInferred: number;
  cleanupWarnings: number;
  taskResults: TaskBackfillTaskResult[];
  rollbackNotes: string[];
  markdown: string;
}

export interface TaskHierarchyBackfillOptions {
  dryRun?: boolean;
  limit?: number;
  db?: Database.Database;
}

export type ActivityBackfillConfidence = 'high' | 'medium' | 'low' | 'unknown';

export type ActivityBackfillWarningCode =
  | 'legacy_event_unknown'
  | 'missing_task_link'
  | 'malformed_payload';

export interface ActivityBackfillInferredField {
  activity_id: number;
  field_name:
    | 'activity_event_type'
    | 'activity_event_payload_json'
    | 'activity_event_schema_status'
    | 'activity_event_legacy_type';
  inferred_value: string | number | null;
  source: 'explicit_activity_event' | 'legacy_activity_type' | 'payload_json' | 'legacy_row';
  confidence: ActivityBackfillConfidence;
}

export interface ActivityBackfillWarning {
  activity_id: number;
  code: ActivityBackfillWarningCode;
  message: string;
  severity: 'info' | 'warning' | 'blocking_for_done';
}

export interface ActivityBackfillActivityResult {
  activity_id: number;
  task_id: number | null;
  legacy_type: string;
  event_type: ActivityEventType;
  schema_status: ActivityEventSchemaStatus;
  confidence: ActivityBackfillConfidence;
  inferred_fields: ActivityBackfillInferredField[];
  warnings: ActivityBackfillWarning[];
  would_update: boolean;
  applied: boolean;
}

export interface ActivityEventBackfillReport {
  dryRun: boolean;
  totalActivities: number;
  activitiesNeedingUpdate: number;
  eventsMapped: number;
  legacyUnknown: number;
  cleanupWarnings: number;
  activityResults: ActivityBackfillActivityResult[];
  rollbackNotes: string[];
  markdown: string;
}

export interface ActivityEventBackfillOptions {
  dryRun?: boolean;
  limit?: number;
  db?: Database.Database;
}

export const PHASE2_MIGRATION_INVENTORY_GAP_CODES = [
  'missing_owner',
  'unknown_initiator',
  'missing_project',
  'missing_assignee',
  'missing_receipt',
  'unknown_worktype',
  'weak_activity_structure',
  'permission_mapping_uncertain',
] as const;

export type Phase2MigrationInventoryGapCode = (typeof PHASE2_MIGRATION_INVENTORY_GAP_CODES)[number];

export interface Phase2MigrationInventoryGapCategory {
  code: Phase2MigrationInventoryGapCode;
  count: number;
  severity: 'info' | 'warning' | 'blocking_for_execution' | 'blocking_for_done';
  description: string;
  sampleIds: string[];
}

export interface Phase2MigrationInventoryCounts {
  tasks: number;
  projects: number;
  docs: number;
  native_documents: number;
  external_document_refs: number;
  indexed_files: number;
  review_packets: number;
  activity_logs: number;
  evidence_artifacts: number;
  task_project_links: number;
}

export interface Phase2MigrationInventoryNoMutationProof {
  checkedTables: string[];
  before: Record<string, number>;
  after: Record<string, number>;
  unchanged: boolean;
  writeStatementsExecuted: 0;
}

export interface Phase2MigrationInventoryReport {
  dryRun: true;
  generatedAt: string;
  counts: Phase2MigrationInventoryCounts;
  gapCategories: Phase2MigrationInventoryGapCategory[];
  noMutationProof: Phase2MigrationInventoryNoMutationProof;
  rollbackNotes: string[];
  markdown: string;
}

export interface Phase2MigrationInventoryOptions {
  db?: Database.Database;
  limit?: number;
  now?: Date;
}

export type ReviewEvidenceMappingConfidence = LegacyDocumentReferenceConfidence;

export type ReviewEvidenceMappingWarningCode =
  | 'missing_review_packet'
  | 'missing_evidence'
  | 'ambiguous_evidence_reference'
  | 'missing_receipt'
  | 'weak_activity_structure';

export interface ReviewEvidenceMappingWarning {
  code: ReviewEvidenceMappingWarningCode;
  message: string;
  severity: 'info' | 'warning' | 'blocking_for_done';
  source: string;
}

export interface ReviewEvidenceStructuredReference {
  source_field: string;
  legacy_value: string | null;
  object_ref: ObjectRef | null;
  confidence: ReviewEvidenceMappingConfidence;
  warnings: string[];
}

export interface ReviewEvidenceDoneCriterion {
  source_field: string;
  text: string;
  completed: boolean | null;
}

export interface ReviewEvidenceActivityMapping {
  activity_id: number;
  task_id: number | null;
  event_type: ActivityEventType | 'unmapped';
  schema_status: ActivityEventSchemaStatus;
  confidence: ActivityBackfillConfidence;
  warnings: ReviewEvidenceMappingWarning[];
}

export type ReviewEvidenceReceiptStatus = 'not_applicable' | 'raw_receipt_present' | 'missing_receipt';

export interface ReviewEvidenceTaskMappingResult {
  task_id: number;
  title: string;
  has_review_packet: boolean;
  review_packet_source: 'metadata.review_packet' | 'metadata.review_brief' | null;
  evidence_fields: ReviewEvidenceStructuredReference[];
  output_artifacts: ReviewEvidenceStructuredReference[];
  done_criteria: ReviewEvidenceDoneCriterion[];
  activity_events: ReviewEvidenceActivityMapping[];
  receipt_status: ReviewEvidenceReceiptStatus;
  confidence: ReviewEvidenceMappingConfidence;
  warnings: ReviewEvidenceMappingWarning[];
  would_update: boolean;
  applied: boolean;
}

export interface ReviewEvidenceMappingReport {
  dryRun: boolean;
  totalTasks: number;
  tasksNeedingUpdate: number;
  reviewPacketsMapped: number;
  evidenceFieldsMapped: number;
  outputArtifactsMapped: number;
  doneCriteriaMapped: number;
  missingReceipts: number;
  weakActivityFlags: number;
  taskResults: ReviewEvidenceTaskMappingResult[];
  rollbackNotes: string[];
  markdown: string;
}

export interface ReviewEvidenceMappingOptions {
  dryRun?: boolean;
  limit?: number;
  db?: Database.Database;
}

export type MigrationCleanupQueueCode =
  | Phase2MigrationInventoryGapCode
  | TaskBackfillWarningCode
  | ReviewEvidenceMappingWarningCode
  | 'ambiguous_team';

export type MigrationCleanupQueueObjectType =
  | 'task'
  | 'activity'
  | 'native_document'
  | 'external_document_ref'
  | 'evidence_artifact';

export type MigrationCleanupCorrectionField =
  | 'owner_principal_id'
  | 'initiator_principal_id'
  | 'project_id'
  | 'team_id'
  | 'assignee'
  | 'executor_principal_id'
  | 'worktype'
  | 'acknowledgement';

export interface MigrationCleanupCorrectionRecord {
  version: 'THE-89';
  code: MigrationCleanupQueueCode;
  field_name: MigrationCleanupCorrectionField;
  previous_value: string | number | boolean | null;
  corrected_value: string | number | boolean | null;
  corrected_by_principal_id: string;
  corrected_at: string;
  note: string | null;
  authoritative: true;
}

export interface MigrationCleanupQueueItem {
  id: string;
  code: MigrationCleanupQueueCode;
  severity: Phase2MigrationInventoryGapCategory['severity'];
  object_type: MigrationCleanupQueueObjectType;
  object_id: string;
  task_id: number | null;
  activity_id: number | null;
  title: string;
  message: string;
  source: string;
  field_name: MigrationCleanupCorrectionField | null;
  current_value: string | number | boolean | null;
  status: 'open' | 'corrected';
  correction: MigrationCleanupCorrectionRecord | null;
  old_task_visible: boolean;
}

export interface MigrationCleanupQueueSummary {
  code: MigrationCleanupQueueCode;
  count: number;
  severity: Phase2MigrationInventoryGapCategory['severity'];
  open: number;
  corrected: number;
}

export interface MigrationCleanupQueueReport {
  generatedAt: string;
  totalItems: number;
  openItems: number;
  correctedItems: number;
  queues: MigrationCleanupQueueSummary[];
  items: MigrationCleanupQueueItem[];
  rollbackNotes: string[];
  markdown: string;
}

export interface MigrationCleanupQueueOptions {
  db?: Database.Database;
  limit?: number;
  includeCorrected?: boolean;
  now?: Date;
}

export interface ApplyMigrationCleanupCorrectionInput {
  db?: Database.Database;
  task_id: number;
  code: MigrationCleanupQueueCode;
  field_name: MigrationCleanupCorrectionField;
  corrected_value: string | number | boolean | null;
  corrected_by_principal_id: string;
  note?: string | null;
  corrected_at?: string;
}

export interface ApplyMigrationCleanupCorrectionResult {
  task_id: number;
  correction: MigrationCleanupCorrectionRecord;
  task: TaskRecord;
}

export interface SubscriptionRecord {
  id: string;
  agent_id: string;
  crew_id: string;
  created_at: string;
}

export interface CrewRecord {
  id: string;
  name: string;
  description: string | null;
  settings: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCrewInput {
  id?: string;
  name: string;
  description?: string;
  settings?: string;
}

export interface CrewSubscriptionRecord {
  id: number;
  crew_id: string;
  agent_id: string;
  created_at: string;
}

export interface CreateCrewSubscriptionInput {
  crew_id: string;
  agent_id: string;
}

const DEFAULT_MISSION_CONTROL_PROJECTS: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Soteria', color: '#2563eb' },
  { name: 'Curacel', color: '#10b981' },
  { name: 'Personal', color: '#f59e0b' },
  { name: 'Moltbot', color: '#f43f5e' },
];

export interface TaskHistoryRecord {
  id: number;
  task_id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
}

interface SourceTaskRow {
  id: number;
  name: string;
  description: string | null;
  task_column: string | null;
  assignee: string | null;
  blocked: number | null;
  blocker_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function isTaskColumn(value: string): value is TaskColumn {
  return (TASK_COLUMNS as readonly string[]).includes(value);
}

function normalizeTaskColumn(value: string | null | undefined): TaskColumn {
  if (!value) {
    return 'backlog';
  }

  const lowered = value.toLowerCase();
  if (isTaskColumn(lowered)) {
    return lowered;
  }

  return 'backlog';
}

function normalizeTimestamp(value: string | null | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function normalizeBlocked(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  return false;
}

function normalizeBlockerReason(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value === 'undefined' || value === null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function resolveMissionControlDbPath(): string {
  const custom = process.env.MISSION_CONTROL_DB_PATH;
  if (custom) {
    return path.resolve(custom);
  }

  return path.join(os.homedir(), 'Code', 'mission-control', 'tasks.db');
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function normalizeWorkspaceId(value: unknown, fallback?: string): string {
  const normalized = normalizeBlockerReason(value);
  if (normalized) {
    return normalized;
  }
  if (fallback) {
    return fallback;
  }
  throw new Error('org context is required');
}

function normalizeProjectClassificationSlug(
  value: unknown,
  field: 'project_key' | 'work_domain',
): string | null {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    throw new Error(`${field} must be a normalized lowercase slug (1-64 characters)`);
  }
  return value;
}

function normalizeOrgQueryContext(context: OrgQueryContext): Required<OrgQueryContext> {
  const orgId = normalizeWorkspaceId(context?.orgId);
  const teamId = normalizeWorkspaceId(context?.teamId, DEFAULT_WORKSPACE_TEAM_ID);
  return { orgId, teamId };
}

function normalizeJsonObjectString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return '{}';
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? JSON.stringify(parsed) : '{}';
  } catch {
    return '{}';
  }
}

function normalizeJsonArrayString(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value !== 'string' || !value.trim()) {
    return '[]';
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? JSON.stringify(parsed) : '[]';
  } catch {
    return '[]';
  }
}

function normalizePolicyRiskLevel(value: unknown): PolicyRiskLevel {
  return value === 'medium' || value === 'high' || value === 'critical' ? value : 'low';
}

function normalizeAgentTrustLevel(value: unknown): AgentTrustLevel {
  return value === 'low' || value === 'standard' || value === 'high' ? value : 'unknown';
}

function normalizeWorktype(value: unknown): string {
  const normalized = normalizeBlockerReason(value)?.toLowerCase().replace(/[^a-z0-9_:-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'general';
}

export function getWorktypeRegistryEntry(worktype: unknown): WorktypeRegistryEntry | undefined {
  return WORKTYPE_REGISTRY[normalizeWorktype(worktype)];
}

function validateWorktypeFieldValue(field: WorktypeRegistryField, value: unknown): string | null {
  if (typeof value === 'undefined' || value === null) {
    return null;
  }
  switch (field.type) {
    case 'string':
      return typeof value === 'string'
        ? null
        : `${field.name} must be a string`;
    case 'enum':
      return typeof value === 'string' && field.allowed_values?.includes(value)
        ? null
        : `${field.name} must be one of ${(field.allowed_values ?? []).join(', ')}`;
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : `${field.name} must be a boolean`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : `${field.name} must be a finite number`;
    case 'string_array':
      return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
        ? null
        : `${field.name} must be an array of strings`;
    case 'object':
      return value && typeof value === 'object' && !Array.isArray(value)
        ? null
        : `${field.name} must be an object`;
    default:
      return null;
  }
}

export function validateWorktypeOverlay(worktype: unknown, overlay: unknown): WorktypeOverlayValidationResult {
  const normalizedWorktype = normalizeWorktype(worktype);
  const overlayRecord = overlay && typeof overlay === 'object' && !Array.isArray(overlay)
    ? overlay as Record<string, unknown>
    : {};
  const registry = getWorktypeRegistryEntry(normalizedWorktype);
  if (!registry) {
    return {
      ok: true,
      degraded: true,
      worktype: normalizedWorktype,
      schema_name: null,
      schema_version: null,
      overlay: overlayRecord,
      warnings: [`unknown worktype ${normalizedWorktype}; preserving overlay as legacy data`],
      errors: [],
    };
  }

  const fieldMap = new Map(registry.fields.map((field) => [field.name, field]));
  const warnings: string[] = [];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(overlayRecord)) {
    if (key === 'schema_name' || key === 'schema_version' || key === 'worktype') {
      continue;
    }
    const field = fieldMap.get(key);
    if (!field) {
      warnings.push(`field ${key} is not registered for worktype ${normalizedWorktype}; preserving as legacy data`);
      continue;
    }
    const error = validateWorktypeFieldValue(field, value);
    if (error) {
      errors.push(error);
    }
  }

  return {
    ok: errors.length === 0,
    degraded: warnings.length > 0,
    worktype: normalizedWorktype,
    schema_name: registry.schema_name,
    schema_version: registry.schema_version,
    registry,
    overlay: overlayRecord,
    warnings,
    errors,
  };
}

export function validateWorktypePolicyInputs(
  worktype: unknown,
  policyInputsJson: unknown,
): WorktypeOverlayValidationResult {
  const layers = readTaskPolicyLayers(policyInputsJson);
  return validateWorktypeOverlay(worktype, layers.worktype ?? {});
}

function assertValidWorktypePolicyInputs(worktype: unknown, policyInputsJson: unknown): void {
  const result = validateWorktypePolicyInputs(worktype, policyInputsJson);
  if (!result.ok) {
    throw new Error(`worktype overlay invalid: ${result.errors.join('; ')}`);
  }
}

function buildWorktypeRegistryPolicyLayer(worktype: unknown): Record<string, unknown> {
  const normalizedWorktype = normalizeWorktype(worktype);
  const registry = getWorktypeRegistryEntry(normalizedWorktype);
  if (!registry) {
    return {
      worktype: normalizedWorktype,
      registry_status: 'legacy_unknown',
    };
  }
  return {
    worktype: normalizedWorktype,
    schema_name: registry.schema_name,
    schema_version: registry.schema_version,
    risk_default: registry.risk_default,
    indexable: registry.indexable,
    sensitivity: registry.sensitivity,
    plan_labels: [...registry.plan_labels],
    field_definitions: registry.fields.map((field) => ({
      name: field.name,
      type: field.type,
      allowed_values: field.allowed_values ? [...field.allowed_values] : undefined,
      risk_default: field.risk_default,
      indexable: field.indexable,
      sensitivity: field.sensitivity,
      plan_label: field.plan_label,
    })),
  };
}

function normalizeReviewPolicyState(value: unknown, required: boolean): ReviewPolicyState {
  if (value === 'pending' || value === 'accepted' || value === 'request_fix' || value === 'skipped_by_policy') {
    return value;
  }
  return required ? 'pending' : 'not_required';
}

function normalizeHumanGatePolicyState(value: unknown, required: boolean): HumanGatePolicyState {
  if (value === 'pending' || value === 'approved' || value === 'rejected') {
    return value;
  }
  return required ? 'pending' : 'not_required';
}

function normalizeExternalSideEffectType(value: unknown): ExternalSideEffectType {
  return EXTERNAL_SIDE_EFFECT_TYPES.includes(value as ExternalSideEffectType)
    ? value as ExternalSideEffectType
    : 'other';
}

function normalizeExternalSideEffectSensitivity(value: unknown): ExternalSideEffectSensitivity {
  return value === 'people' ||
    value === 'customer' ||
    value === 'legal' ||
    value === 'financial' ||
    value === 'security' ||
    value === 'production' ||
    value === 'confidential' ||
    value === 'workspace_restricted'
    ? value
    : 'none';
}

function normalizeExternalSideEffectResolutionState(value: unknown): ExternalSideEffectResolutionState {
  return value === 'gate_pending' ||
    value === 'gate_approved' ||
    value === 'gate_rejected' ||
    value === 'resolved' ||
    value === 'cancelled'
    ? value
    : 'requested';
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  if (!value.trim()) {
    return undefined;
  }
  return JSON.parse(value);
}

function normalizeExternalSideEffect(value: unknown, index: number): ExternalSideEffect {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`external side effect ${index + 1} must be an object`);
  }

  const record = value as Record<string, unknown>;
  const targetSystem = normalizeBlockerReason(record.target_system);
  if (!targetSystem) {
    throw new Error(`external side effect ${index + 1} must include target_system`);
  }

  const requestedActor = normalizeBlockerReason(record.requested_actor_principal_id ?? record.requested_actor);
  if (!requestedActor) {
    throw new Error(`external side effect ${index + 1} must include requested_actor_principal_id`);
  }

  const metadata = record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
    ? record.metadata as Record<string, unknown>
    : undefined;

  return {
    type: normalizeExternalSideEffectType(record.type),
    target_system: targetSystem,
    risk_level: normalizePolicyRiskLevel(record.risk_level ?? record.risk),
    sensitivity: normalizeExternalSideEffectSensitivity(record.sensitivity),
    required_gate: normalizeBlocked(record.required_gate),
    requested_actor_principal_id: requestedActor,
    resolution_state: normalizeExternalSideEffectResolutionState(record.resolution_state),
    ...(metadata ? { metadata } : {}),
  };
}

export function parseExternalSideEffects(value: unknown): ExternalSideEffect[] {
  const parsed = parseJsonValue(value);
  if (typeof parsed === 'undefined' || parsed === null || parsed === '') {
    return [];
  }
  if (!Array.isArray(parsed)) {
    throw new Error('external_side_effects_json must be a JSON array');
  }
  return parsed.map((entry, index) => normalizeExternalSideEffect(entry, index));
}

function normalizeExternalSideEffectsJson(value: unknown): string {
  return JSON.stringify(parseExternalSideEffects(value));
}

function readTaskPolicyLayers(value: unknown): Partial<Record<PolicyInputLayer, Record<string, unknown>>> {
  const normalized = normalizeJsonObjectString(value);
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown> & { layers?: unknown };
    const rawLayers: Record<string, unknown> = parsed.layers && typeof parsed.layers === 'object' && !Array.isArray(parsed.layers)
      ? parsed.layers as Record<string, unknown>
      : parsed;
    const layers: Partial<Record<PolicyInputLayer, Record<string, unknown>>> = {};
    for (const layer of POLICY_INPUT_LAYERS) {
      const candidate = rawLayers[layer];
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        layers[layer] = candidate as Record<string, unknown>;
      }
    }
    return layers;
  } catch {
    return {};
  }
}

export function buildTaskPolicyInputEnvelope(
  task: Pick<
    TaskRecord,
    | 'id'
    | 'org_id'
    | 'team_id'
    | 'project_id'
    | 'created_by_principal_id'
    | 'initiator_principal_id'
    | 'owner_principal_id'
    | 'executor_principal_id'
    | 'assignee'
    | 'worktype'
    | 'column'
    | 'taskmaster_drivable'
    | 'risk_level'
    | 'agent_trust_level'
    | 'policy_inputs_json'
    | 'external_side_effects_json'
    | 'review_required'
    | 'review_state'
    | 'human_gate_required'
    | 'human_gate_state'
  >
): TaskPolicyInputEnvelope {
  const storedLayers = readTaskPolicyLayers(task.policy_inputs_json);
  const taskLayer = {
    task_id: task.id,
    lifecycle_state: task.column,
    created_by_principal_id: task.created_by_principal_id ?? null,
    initiator_principal_id: task.initiator_principal_id ?? null,
    owner_principal_id: task.owner_principal_id ?? null,
    assignee_principal_id: task.assignee ?? null,
    executor_principal_id: task.executor_principal_id ?? null,
    ...(task.taskmaster_drivable ? { taskmaster_drivable: true } : {}),
    ...(storedLayers.task ?? {}),
  };
  const worktypeLayer = {
    ...buildWorktypeRegistryPolicyLayer(task.worktype ?? 'general'),
    ...(storedLayers.worktype ?? {}),
  };
  const explicitExternalSideEffects = parseExternalSideEffects(task.external_side_effects_json);
  const derivedExternalSideEffects = [
    ...deriveSalesOverlayExternalSideEffects(worktypeLayer, task),
    ...deriveCustomerSuccessOverlayExternalSideEffects(worktypeLayer, task),
    ...derivePeopleOverlayExternalSideEffects(worktypeLayer, task),
  ];
  const externalSideEffects = [...explicitExternalSideEffects, ...derivedExternalSideEffects];
  return {
    layers: {
      workspace: storedLayers.workspace ?? { org_id: task.org_id ?? DEFAULT_WORKSPACE_ORG_ID },
      org: storedLayers.org ?? { org_id: task.org_id ?? DEFAULT_WORKSPACE_ORG_ID },
      team: storedLayers.team ?? { team_id: task.team_id ?? DEFAULT_WORKSPACE_TEAM_ID },
      project: storedLayers.project ?? { project_id: task.project_id ?? null },
      worktype: worktypeLayer,
      task: taskLayer,
      risk: storedLayers.risk ?? {
        risk_level: task.risk_level ?? 'low',
        external_side_effect_count: externalSideEffects.length,
      },
      agent_trust: storedLayers.agent_trust ?? { trust_level: task.agent_trust_level ?? 'unknown' },
    },
    principals: {
      created_by_principal_id: readPolicyString(taskLayer, ['created_by_principal_id', 'created_by']) ?? null,
      initiator_principal_id: readPolicyString(taskLayer, ['initiator_principal_id', 'initiator']) ?? null,
      owner_principal_id: readPolicyString(taskLayer, ['owner_principal_id', 'owner']) ?? null,
      assignee_principal_id: readPolicyString(taskLayer, ['assignee_principal_id', 'assignee']) ?? null,
      executor_principal_id: readPolicyString(taskLayer, ['executor_principal_id', 'executor']) ?? null,
      submitted_by_principal_id: readPolicyString(taskLayer, ['submitted_by_principal_id', 'submitted_by']) ?? null,
    },
    review: {
      required: Boolean(task.review_required),
      state: task.review_state ?? 'not_required',
    },
    human_gate: {
      required: Boolean(task.human_gate_required),
      state: task.human_gate_state ?? 'not_required',
    },
    external_side_effects: externalSideEffects,
  };
}

function readPolicyBoolean(layer: Record<string, unknown>, key: string): boolean | undefined {
  return Object.prototype.hasOwnProperty.call(layer, key) ? normalizeBlocked(layer[key]) : undefined;
}

function readPolicyString(layer: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = normalizeBlockerReason(layer[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function readPolicyStringArray(layer: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = layer[key];
    if (Array.isArray(value)) {
      return normalizeJsonStringArray(value);
    }
    const singleValue = normalizeBlockerReason(value);
    if (singleValue) {
      return [singleValue];
    }
  }
  return [];
}

function readPolicyPositiveNumber(layer: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = normalizePositiveInteger(layer[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function readPolicyRoutes(layer: Record<string, unknown>): string[] {
  if (Array.isArray(layer.notification_routes)) {
    return normalizeJsonStringArray(layer.notification_routes);
  }

  const singleRoute = normalizeBlockerReason(layer.notification_route);
  return singleRoute ? [singleRoute] : [];
}

function readPolicyActor(task: Pick<
  TaskRecord,
  | 'created_by_principal_id'
  | 'initiator_principal_id'
  | 'owner_principal_id'
  | 'executor_principal_id'
  | 'assignee'
>): string {
  const candidates = [
    task.executor_principal_id,
    task.assignee,
    task.owner_principal_id,
    task.initiator_principal_id,
    task.created_by_principal_id,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeBlockerReason(candidate);
    if (!normalized) {
      continue;
    }
    const lowered = normalized.toLowerCase();
    if (lowered === 'unassigned' || lowered.startsWith('legacy-') || lowered === 'unknown') {
      continue;
    }
    return normalized;
  }
  return 'unknown';
}

function deriveSalesOverlayExternalSideEffects(
  worktypeLayer: Record<string, unknown>,
  task: Pick<
    TaskRecord,
    | 'created_by_principal_id'
    | 'initiator_principal_id'
    | 'owner_principal_id'
    | 'executor_principal_id'
    | 'assignee'
  >,
): ExternalSideEffect[] {
  if (normalizeWorktype(worktypeLayer.worktype) !== 'sales') {
    return [];
  }

  const requestedActor = readPolicyActor(task);
  const account = normalizeBlockerReason(worktypeLayer.account);
  const externalSendRiskRaw = normalizeBlockerReason(worktypeLayer.external_send_risk);
  const externalSendRisk = externalSendRiskRaw && externalSendRiskRaw !== 'none'
    ? normalizePolicyRiskLevel(externalSendRiskRaw)
    : null;
  const crmSideEffectType = normalizeBlockerReason(worktypeLayer.crm_side_effect_type);
  const sideEffects: ExternalSideEffect[] = [];

  if (externalSendRisk) {
    sideEffects.push({
      type: 'email_send',
      target_system: 'customer_email',
      risk_level: externalSendRisk,
      sensitivity: 'customer',
      required_gate: externalSendRisk === 'critical',
      requested_actor_principal_id: requestedActor,
      resolution_state: 'requested',
      metadata: {
        source: 'sales_overlay',
        account,
      },
    });
  }

  if (crmSideEffectType && crmSideEffectType !== 'none') {
    const riskLevel = externalSendRisk ?? 'medium';
    sideEffects.push({
      type: crmSideEffectType === 'customer_commitment' ? 'customer_commitment' : 'crm_update',
      target_system: 'crm',
      risk_level: riskLevel,
      sensitivity: 'customer',
      required_gate: riskLevel === 'critical',
      requested_actor_principal_id: requestedActor,
      resolution_state: 'requested',
      metadata: {
        source: 'sales_overlay',
        account,
        deal_stage: normalizeBlockerReason(worktypeLayer.deal_stage),
      },
    });
  }

  return sideEffects;
}

function readOverlayRisk(value: unknown): PolicyRiskLevel | null {
  const normalized = normalizeBlockerReason(value);
  if (!normalized || normalized === 'none') {
    return null;
  }
  return normalizePolicyRiskLevel(normalized);
}

function higherPolicyRisk(left: PolicyRiskLevel | null, right: PolicyRiskLevel | null): PolicyRiskLevel | null {
  const rank: Record<PolicyRiskLevel, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  if (!left) return right;
  if (!right) return left;
  return rank[right] > rank[left] ? right : left;
}

function deriveCustomerSuccessOverlayExternalSideEffects(
  worktypeLayer: Record<string, unknown>,
  task: Pick<
    TaskRecord,
    | 'created_by_principal_id'
    | 'initiator_principal_id'
    | 'owner_principal_id'
    | 'executor_principal_id'
    | 'assignee'
  >,
): ExternalSideEffect[] {
  if (normalizeWorktype(worktypeLayer.worktype) !== 'customer_success') {
    return [];
  }

  const requestedActor = readPolicyActor(task);
  const customer = normalizeBlockerReason(worktypeLayer.customer) ?? normalizeBlockerReason(worktypeLayer.account);
  const slaRisk = readOverlayRisk(worktypeLayer.sla_risk);
  const customerImpactRisk = readOverlayRisk(worktypeLayer.customer_impact_risk);
  const externalResponseRisk = readOverlayRisk(worktypeLayer.external_response_risk);
  const customerCommitmentRisk = higherPolicyRisk(slaRisk, customerImpactRisk);
  const sideEffects: ExternalSideEffect[] = [];

  if (customerCommitmentRisk) {
    sideEffects.push({
      type: 'customer_commitment',
      target_system: 'customer_success',
      risk_level: customerCommitmentRisk,
      sensitivity: 'customer',
      required_gate: customerCommitmentRisk === 'critical',
      requested_actor_principal_id: requestedActor,
      resolution_state: 'requested',
      metadata: {
        source: 'customer_success_overlay',
        customer,
        health_state: normalizeBlockerReason(worktypeLayer.health_state),
        renewal_marker: normalizeBlockerReason(worktypeLayer.renewal_marker),
        escalation_marker: normalizeBlockerReason(worktypeLayer.escalation_marker),
      },
    });
  }

  if (externalResponseRisk) {
    sideEffects.push({
      type: 'email_send',
      target_system: 'customer_response',
      risk_level: externalResponseRisk,
      sensitivity: 'customer',
      required_gate: externalResponseRisk === 'critical',
      requested_actor_principal_id: requestedActor,
      resolution_state: 'requested',
      metadata: {
        source: 'customer_success_overlay',
        customer,
        support_context: normalizeBlockerReason(worktypeLayer.support_context),
      },
    });
  }

  return sideEffects;
}

function normalizePeopleSensitivityClass(value: unknown): ExternalSideEffectSensitivity | null {
  const normalized = normalizeBlockerReason(value);
  if (!normalized || normalized === 'standard') {
    return null;
  }
  if (normalized === 'restricted') {
    return 'workspace_restricted';
  }
  if (normalized === 'people' || normalized === 'confidential') {
    return normalized;
  }
  return null;
}

function derivePeopleOverlayExternalSideEffects(
  worktypeLayer: Record<string, unknown>,
  task: Pick<
    TaskRecord,
    | 'created_by_principal_id'
    | 'initiator_principal_id'
    | 'owner_principal_id'
    | 'executor_principal_id'
    | 'assignee'
  >,
): ExternalSideEffect[] {
  if (normalizeWorktype(worktypeLayer.worktype) !== 'people') {
    return [];
  }

  const sideEffectType = normalizeBlockerReason(worktypeLayer.hr_side_effect_type) ?? 'none';
  const sensitivity = normalizePeopleSensitivityClass(worktypeLayer.sensitivity_class);
  const approvalRequired = normalizeBlocked(worktypeLayer.approval_required);
  const highImpactHrAction =
    sideEffectType === 'compensation_change' ||
    sideEffectType === 'access_change' ||
    sideEffectType === 'termination';
  const requiredGate = approvalRequired || sensitivity === 'confidential' || sensitivity === 'workspace_restricted' || highImpactHrAction;
  const hasHrPolicySignal = sideEffectType !== 'none' || Boolean(sensitivity) || approvalRequired;

  if (!hasHrPolicySignal) {
    return [];
  }

  return [{
    type: 'hr_action',
    target_system: 'people_ops',
    risk_level: requiredGate ? 'critical' : 'high',
    sensitivity: sensitivity ?? 'people',
    required_gate: requiredGate,
    requested_actor_principal_id: readPolicyActor(task),
    resolution_state: 'requested',
    metadata: {
      source: 'people_overlay',
      candidate_ref: normalizeBlockerReason(worktypeLayer.candidate_ref),
      employee_ref: normalizeBlockerReason(worktypeLayer.employee_ref),
      workflow_stage: normalizeBlockerReason(worktypeLayer.workflow_stage),
      hr_side_effect_type: sideEffectType,
      checklist_state: normalizeBlockerReason(worktypeLayer.checklist_state),
      approval_required: approvalRequired,
    },
  }];
}

function appendUnique(values: string[], nextValues: string[]): string[] {
  const seen = new Set(values);
  const result = [...values];
  for (const value of nextValues) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function preferLowerPositive(current: number | null, next: number): number {
  return current === null ? next : Math.min(current, next);
}

function isHighRisk(value: unknown): boolean {
  return value === 'high' || value === 'critical';
}

function isCriticalRisk(value: unknown): boolean {
  return value === 'critical';
}

function sideEffectNeedsHumanGate(sideEffect: ExternalSideEffect): boolean {
  if (sideEffect.required_gate || sideEffect.risk_level === 'critical') {
    return true;
  }

  return sideEffect.sensitivity === 'people' ||
    sideEffect.sensitivity === 'legal' ||
    sideEffect.sensitivity === 'financial' ||
    sideEffect.sensitivity === 'security' ||
    sideEffect.sensitivity === 'production' ||
    sideEffect.sensitivity === 'workspace_restricted';
}

function normalizeReviewerCandidate(value: unknown): string | null {
  const normalized = isAssignablePrincipal(value);
  if (!normalized || isLegacyPrincipalMarker(normalized, ['legacy-unknown', 'legacy-owner', 'legacy-system', 'system', 'unknown'])) {
    return null;
  }
  return normalized;
}

function buildReviewerPoolCandidates(envelope: TaskPolicyInputEnvelope, fallbackReviewer: string | null): string[] {
  const teamLayer = envelope.layers.team ?? {};
  const teamPool = readPolicyStringArray(teamLayer, [
    'capable_reviewer_principal_ids',
    'reviewer_pool_principal_ids',
    'reviewer_pool',
    'eligible_reviewer_principal_ids',
  ]);
  if (teamPool.length > 0) {
    return teamPool;
  }
  return fallbackReviewer ? [fallbackReviewer] : [];
}

function candidateSkipReason(
  candidate: string,
  role: ReviewerCandidateRole,
  principals: TaskPolicyInputEnvelope['principals'],
): string | null {
  const assignee = normalizeReviewerCandidate(principals.assignee_principal_id);
  const executor = normalizeReviewerCandidate(principals.executor_principal_id);
  const submittedBy = normalizeReviewerCandidate(principals.submitted_by_principal_id);
  const createdBy = normalizeReviewerCandidate(principals.created_by_principal_id);

  if (role === 'initiator') {
    if (candidate === assignee) {
      return 'initiator is also the assignee';
    }
    if (candidate === executor) {
      return 'initiator is also the executor';
    }
    if (candidate === submittedBy) {
      return 'initiator is also submitted_by';
    }
    return null;
  }

  if (candidate === assignee) {
    return `${role} candidate is also the assignee`;
  }
  if (candidate === executor) {
    return `${role} candidate is also the executor`;
  }
  if (candidate === submittedBy) {
    return `${role} candidate is also submitted_by`;
  }
  if (candidate === createdBy) {
    return `${role} candidate is also created_by`;
  }
  return null;
}

function resolveReviewerAssignment(
  envelope: TaskPolicyInputEnvelope,
  reviewRequired: boolean,
  fallbackReviewer: string | null,
  pushReason: (
    source: PolicyReasonSource,
    decision: PolicyReasonDecision,
    value: PolicyReasonChainEntry['value'],
    reason: string,
  ) => void,
): ReviewerAssignmentResult {
  if (!reviewRequired) {
    return {
      reviewer_principal_id: fallbackReviewer,
      assignment_mode: 'not_required',
      routing_problem: false,
      routing_problem_reason: null,
      skipped_candidates: [],
    };
  }

  const skippedCandidates: ReviewerSkippedCandidate[] = [];
  const candidates: Array<{ principal_id: string | null; role: ReviewerCandidateRole }> = [
    { principal_id: normalizeReviewerCandidate(envelope.principals.initiator_principal_id), role: 'initiator' },
    ...buildReviewerPoolCandidates(envelope, fallbackReviewer).map((principalId) => ({
      principal_id: normalizeReviewerCandidate(principalId),
      role: 'reviewer_pool' as const,
    })),
    { principal_id: normalizeReviewerCandidate(envelope.principals.owner_principal_id), role: 'owner' },
  ];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.principal_id) {
      continue;
    }
    const duplicateKey = `${candidate.role}:${candidate.principal_id}`;
    if (seen.has(duplicateKey)) {
      continue;
    }
    seen.add(duplicateKey);

    const skipReason = candidateSkipReason(candidate.principal_id, candidate.role, envelope.principals);
    if (skipReason) {
      skippedCandidates.push({
        principal_id: candidate.principal_id,
        role: candidate.role,
        reason: skipReason,
      });
      pushReason('task_projection', 'reviewer_candidate_skipped', candidate.principal_id, skipReason);
      continue;
    }

    pushReason('task_projection', 'reviewer_assignment', candidate.principal_id, `${candidate.role} selected as reviewer`);
    return {
      reviewer_principal_id: candidate.principal_id,
      assignment_mode: candidate.role,
      routing_problem: false,
      routing_problem_reason: null,
      skipped_candidates: skippedCandidates,
    };
  }

  const routingProblemReason = 'no eligible reviewer found for separation-of-duties policy';
  pushReason('task_projection', 'reviewer_routing_problem', null, routingProblemReason);
  return {
    reviewer_principal_id: null,
    assignment_mode: 'routing_problem',
    routing_problem: true,
    routing_problem_reason: routingProblemReason,
    skipped_candidates: skippedCandidates,
  };
}

function buildTaskMasterRoutingProjection(input: {
  taskmasterDrivable: boolean;
  stallThresholdHours: number | null;
  autoReassignAfterHours: number | null;
  notificationRoutes: string[];
  humanGateRequired: boolean;
  riskLevel: PolicyRiskLevel;
  externalSideEffects: ExternalSideEffect[];
  reasonChain: PolicyReasonChainEntry[];
}): TaskMasterRoutingPolicyProjection {
  const projectionReasonChain = [...input.reasonChain];
  const pushProjectionReason = (
    decision: PolicyReasonDecision,
    value: PolicyReasonChainEntry['value'],
    reason: string,
  ) => {
    projectionReasonChain.push({
      source: 'task_projection',
      decision,
      value,
      reason,
    });
  };
  const highRiskExclusionReasons: string[] = [];
  if (isHighRisk(input.riskLevel)) {
    highRiskExclusionReasons.push(`${input.riskLevel} risk`);
  }

  input.externalSideEffects.forEach((sideEffect, index) => {
    if (isHighRisk(sideEffect.risk_level) || sideEffectNeedsHumanGate(sideEffect)) {
      highRiskExclusionReasons.push(`external side effect ${index + 1}`);
    }
  });

  const highRiskExcluded = highRiskExclusionReasons.length > 0;
  let projectedTaskmasterDrivable = input.taskmasterDrivable;
  if (projectedTaskmasterDrivable && highRiskExcluded) {
    projectedTaskmasterDrivable = false;
    pushProjectionReason(
      'taskmaster_high_risk_exclusion',
      false,
      `high-risk policy excludes Task Master drivability: ${highRiskExclusionReasons.join(', ')}`,
    );
  }

  const escalationEligible = input.stallThresholdHours !== null && input.notificationRoutes.length > 0;
  pushProjectionReason(
    'escalation_eligibility',
    escalationEligible,
    escalationEligible
      ? 'stall threshold and notification route make owner escalation eligible'
      : 'owner escalation requires both a stall threshold and notification route',
  );

  const autoReassignEligible =
    projectedTaskmasterDrivable &&
    input.autoReassignAfterHours !== null &&
    !input.humanGateRequired &&
    !highRiskExcluded;
  pushProjectionReason(
    'reassignment_eligibility',
    autoReassignEligible,
    autoReassignEligible
      ? 'Task Master drivability and auto-reassignment threshold permit reassignment'
      : 'auto-reassignment requires Task Master drivability, a threshold, and no high-risk or human-gate exclusion',
  );

  return {
    taskmaster_drivable: projectedTaskmasterDrivable,
    stall_threshold_hours: input.stallThresholdHours,
    notification_routes: input.notificationRoutes,
    escalation_eligible: escalationEligible,
    auto_reassign_eligible: autoReassignEligible,
    auto_reassign_after_hours: autoReassignEligible ? input.autoReassignAfterHours : null,
    high_risk_excluded: highRiskExcluded,
    high_risk_exclusion_reasons: highRiskExclusionReasons,
    reason_chain: projectionReasonChain,
  };
}

export function resolveTaskPolicy(envelope: TaskPolicyInputEnvelope): TaskPolicyResolution {
  const reasonChain: PolicyReasonChainEntry[] = [];
  let reviewRequired = envelope.review.required;
  let humanGateRequired = envelope.human_gate.required;
  let reviewerPrincipalId: string | null = null;
  let approverPrincipalId: string | null = null;
  let taskmasterDrivable = false;
  let stallThresholdHours: number | null = null;
  let autoReassignAfterHours: number | null = null;
  let notificationRoutes: string[] = [];

  const pushReason = (
    source: PolicyReasonSource,
    decision: PolicyReasonDecision,
    value: PolicyReasonChainEntry['value'],
    reason: string,
  ) => {
    reasonChain.push({ source, decision, value, reason });
  };

  const requireReview = (source: PolicyReasonSource, reason: string) => {
    if (!reviewRequired) {
      reviewRequired = true;
    }
    pushReason(source, 'review_required', true, reason);
  };

  const requireHumanGate = (source: PolicyReasonSource, reason: string) => {
    if (!humanGateRequired) {
      humanGateRequired = true;
    }
    pushReason(source, 'human_gate_required', true, reason);
  };

  if (reviewRequired) {
    pushReason('task_projection', 'review_required', true, 'stored task review state already requires review');
  }
  if (humanGateRequired) {
    pushReason('task_projection', 'human_gate_required', true, 'stored task human gate state already requires approval');
  }

  for (const layerName of POLICY_INPUT_LAYERS) {
    const layer = envelope.layers[layerName] ?? {};
    const reviewFlag = readPolicyBoolean(layer, 'review_required');
    const humanGateFlag = readPolicyBoolean(layer, 'human_gate_required');

    if (reviewFlag === true) {
      requireReview(layerName, `${layerName} layer requires review`);
    } else if (reviewFlag === false && reviewRequired) {
      pushReason(layerName, 'review_requirement_retained', true, `${layerName} layer cannot bypass an existing review requirement`);
    }

    if (humanGateFlag === true) {
      requireHumanGate(layerName, `${layerName} layer requires human gate`);
    } else if (humanGateFlag === false && humanGateRequired) {
      pushReason(layerName, 'human_gate_requirement_retained', true, `${layerName} layer cannot bypass an existing human gate requirement`);
    }

    const reviewer = readPolicyString(layer, ['reviewer_principal_id', 'reviewer_target_principal_id', 'reviewer_target']);
    if (reviewer) {
      reviewerPrincipalId = reviewer;
      pushReason(layerName, 'reviewer_target', reviewer, `${layerName} layer sets reviewer target`);
    }

    const approver = readPolicyString(layer, ['approver_principal_id', 'approver_target_principal_id', 'approver_target']);
    if (approver) {
      approverPrincipalId = approver;
      pushReason(layerName, 'approver_target', approver, `${layerName} layer sets approver target`);
    }

    const taskmasterFlag = readPolicyBoolean(layer, 'taskmaster_drivable');
    if (typeof taskmasterFlag !== 'undefined') {
      taskmasterDrivable = taskmasterFlag;
      pushReason(layerName, 'taskmaster_drivable', taskmasterFlag, `${layerName} layer sets Task Master drivability`);
    }

    const stallThreshold = readPolicyPositiveNumber(layer, ['stall_threshold_hours', 'nudge_after_hours']);
    if (stallThreshold !== null) {
      stallThresholdHours = preferLowerPositive(stallThresholdHours, stallThreshold);
      pushReason(layerName, 'stall_threshold', stallThresholdHours, `${layerName} layer contributes stall threshold`);
    }

    const autoReassignThreshold = readPolicyPositiveNumber(layer, ['auto_reassign_after_hours', 'auto_reassignment_after_hours']);
    if (autoReassignThreshold !== null) {
      autoReassignAfterHours = preferLowerPositive(autoReassignAfterHours, autoReassignThreshold);
      pushReason(layerName, 'auto_reassignment_threshold', autoReassignAfterHours, `${layerName} layer contributes auto-reassignment threshold`);
    }

    const routes = readPolicyRoutes(layer);
    if (routes.length > 0) {
      notificationRoutes = appendUnique(notificationRoutes, routes);
      pushReason(layerName, 'notification_route', notificationRoutes, `${layerName} layer contributes notification route`);
    }
  }

  const riskLayer = envelope.layers.risk ?? {};
  const riskLevel = normalizePolicyRiskLevel(riskLayer.risk_level ?? riskLayer.level);
  if (isHighRisk(riskLevel)) {
    requireReview('risk', `${riskLevel} risk escalates review requirement`);
  }
  if (isCriticalRisk(riskLevel)) {
    requireHumanGate('risk', 'critical risk escalates human gate requirement');
  }

  const trustLayer = envelope.layers.agent_trust ?? {};
  const trustLevel = normalizeAgentTrustLevel(trustLayer.trust_level ?? trustLayer.level);
  if (trustLevel === 'unknown' || trustLevel === 'low') {
    requireReview('agent_trust', `${trustLevel} agent trust requires review`);
  }

  envelope.external_side_effects.forEach((sideEffect, index) => {
    if (isHighRisk(sideEffect.risk_level) || sideEffect.required_gate || sideEffect.resolution_state === 'gate_pending') {
      requireReview('external_side_effect', `external side effect ${index + 1} requires review`);
    }
    if (sideEffectNeedsHumanGate(sideEffect) || sideEffect.resolution_state === 'gate_pending') {
      requireHumanGate('external_side_effect', `external side effect ${index + 1} requires human gate`);
    }
  });

  const reviewerAssignment = resolveReviewerAssignment(envelope, reviewRequired, reviewerPrincipalId, pushReason);
  reviewerPrincipalId = reviewerAssignment.reviewer_principal_id;
  const routingPolicyProjection = buildTaskMasterRoutingProjection({
    taskmasterDrivable,
    stallThresholdHours,
    autoReassignAfterHours,
    notificationRoutes,
    humanGateRequired,
    riskLevel,
    externalSideEffects: envelope.external_side_effects,
    reasonChain,
  });

  return {
    review_required: reviewRequired,
    human_gate_required: humanGateRequired,
    reviewer_principal_id: reviewerPrincipalId,
    approver_principal_id: approverPrincipalId,
    reviewer_assignment: reviewerAssignment,
    taskmaster_drivable: routingPolicyProjection.taskmaster_drivable,
    stall_threshold_hours: stallThresholdHours,
    auto_reassign_after_hours: autoReassignAfterHours,
    notification_routes: notificationRoutes,
    routing_policy_projection: routingPolicyProjection,
    reason_chain: reasonChain,
  };
}

function readTaskMetadataRecord(metadata: unknown): Record<string, unknown> {
  return parseJsonObject(metadata);
}

function writeTaskMetadataRecord(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata);
}

function buildRoutingPolicyProjectionMetadata(
  projection: TaskMasterRoutingPolicyProjection,
): Record<string, unknown> {
  return {
    taskmaster_drivable: projection.taskmaster_drivable,
    stall_threshold_hours: projection.stall_threshold_hours,
    notification_routes: projection.notification_routes,
    escalation_eligible: projection.escalation_eligible,
    auto_reassign_eligible: projection.auto_reassign_eligible,
    auto_reassign_after_hours: projection.auto_reassign_after_hours,
    high_risk_excluded: projection.high_risk_excluded,
    high_risk_exclusion_reasons: projection.high_risk_exclusion_reasons,
    reason_chain: projection.reason_chain,
  };
}

function writeTaskMetadataWithRoutingPolicyProjection(
  metadata: unknown,
  resolution: TaskPolicyResolution,
): string {
  const metadataRecord = readTaskMetadataRecord(metadata);
  return writeTaskMetadataRecord({
    ...metadataRecord,
    taskmaster_drivable: resolution.routing_policy_projection.taskmaster_drivable,
    stall_threshold_hours: resolution.routing_policy_projection.stall_threshold_hours,
    auto_reassign_after_hours: resolution.routing_policy_projection.auto_reassign_after_hours,
    notification_routes: resolution.routing_policy_projection.notification_routes,
    policy_reason_chain: resolution.reason_chain,
    routing_policy_projection: buildRoutingPolicyProjectionMetadata(resolution.routing_policy_projection),
  });
}

function normalizeTaskMasterPrincipalId(value: unknown): string {
  return normalizeBlockerReason(value) ?? 'task-master';
}

function buildTaskMasterClaimRecord(
  previousTask: TaskRecord,
  input: ClaimTaskForTaskMasterInput = {},
): TaskMasterClaimRecord {
  const taskmasterPrincipalId = normalizeTaskMasterPrincipalId(input.taskmaster_principal_id);
  return {
    taskmaster_principal_id: taskmasterPrincipalId,
    claimed_at: normalizeTimestamp(input.claimed_at ?? new Date().toISOString()),
    claim_request_id: normalizeBlockerReason(input.claim_request_id) ?? randomUUID(),
    policy_reason:
      normalizeBlockerReason(input.policy_reason) ??
      'Task Master claimed unassigned policy-drivable work.',
    previous_assignee: normalizeBlockerReason(previousTask.assignee),
    previous_executor_principal_id: normalizeBlockerReason(previousTask.executor_principal_id),
    previous_assignment_state: normalizeBlockerReason(previousTask.assignment_state),
    previous_taskmaster_drivable: Boolean(previousTask.taskmaster_drivable),
  };
}

function writeTaskMetadataWithTaskMasterClaim(
  metadata: unknown,
  claim: TaskMasterClaimRecord,
  previousTask: TaskRecord,
): string {
  const metadataRecord = readTaskMetadataRecord(metadata);
  return writeTaskMetadataRecord({
    ...metadataRecord,
    taskmaster_claim: claim,
    taskmaster_claim_original_unassigned: {
      assignee: previousTask.assignee ?? null,
      executor_principal_id: previousTask.executor_principal_id ?? null,
      assignment_state: previousTask.assignment_state ?? null,
      taskmaster_drivable: Boolean(previousTask.taskmaster_drivable),
    },
  });
}

function normalizeActorPrincipal(value: unknown): string | null {
  return normalizeReviewerCandidate(value);
}

function normalizeReviewGateActorType(value: unknown): ReviewGateActorType {
  return value === 'human' ||
    value === 'agent' ||
    value === 'system' ||
    value === 'workflow'
    ? value
    : 'unknown';
}

function isSamePrincipal(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeActorPrincipal(left);
  const normalizedRight = normalizeActorPrincipal(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function buildReviewGateMetadata(
  task: TaskRecord,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...readTaskMetadataRecord(task.metadata),
    ...updates,
  };
}

function resolvedApproverPrincipalId(
  task: TaskRecord,
  resolution: TaskPolicyResolution,
): string | null {
  const explicitApprover = normalizeActorPrincipal(resolution.approver_principal_id);
  if (explicitApprover) {
    return explicitApprover;
  }
  if (task.owner_principal_type === 'human') {
    return normalizeActorPrincipal(task.owner_principal_id);
  }
  return null;
}

export function buildTaskReviewDecisionUpdates(input: {
  task: TaskRecord;
  actor_principal_id: string;
  decision: TaskReviewDecision;
  reason?: string | null;
  decided_at?: string;
}): ReviewGateMutationResult {
  const actor = normalizeActorPrincipal(input.actor_principal_id);
  if (!actor) {
    return {
      ok: false,
      status: 400,
      code: 'review_actor_required',
      message: 'review decision requires an eligible actor principal',
    };
  }

  const resolution = resolveTaskPolicy(buildTaskPolicyInputEnvelope(input.task));
  if (!input.task.review_required && !resolution.review_required) {
    return {
      ok: false,
      status: 409,
      code: 'review_not_required',
      message: 'task does not require review',
    };
  }

  const reviewerPrincipalId = normalizeActorPrincipal(resolution.reviewer_principal_id);
  if (!reviewerPrincipalId) {
    return {
      ok: false,
      status: 409,
      code: 'reviewer_routing_problem',
      message: resolution.reviewer_assignment.routing_problem_reason ??
        'task has no eligible reviewer',
      reviewer_principal_id: null,
    };
  }

  if (actor !== reviewerPrincipalId) {
    return {
      ok: false,
      status: 403,
      code: 'reviewer_not_eligible',
      message: 'review decision requires the assigned eligible reviewer',
      reviewer_principal_id: reviewerPrincipalId,
    };
  }

  const now = input.decided_at ?? new Date().toISOString();
  const metadata = buildReviewGateMetadata(input.task, {
    review_required: true,
    reviewer: reviewerPrincipalId,
    reviewer_principal_id: reviewerPrincipalId,
    review_decision: input.decision,
    review_decision_reason: input.reason?.trim() || null,
    review_decided_by: actor,
    review_decided_at: now,
  });

  return {
    ok: true,
    reviewer_principal_id: reviewerPrincipalId,
    decision: input.decision,
    metadata,
    updates: {
      review_required: true,
      review_state: input.decision,
      metadata: writeTaskMetadataRecord(metadata),
    },
  };
}

export function buildTaskHumanGateRequestUpdates(input: {
  task: TaskRecord;
  actor_principal_id: string;
  reason?: string | null;
  requested_at?: string;
}): ReviewGateMutationResult {
  const actor = normalizeActorPrincipal(input.actor_principal_id);
  if (!actor) {
    return {
      ok: false,
      status: 400,
      code: 'human_gate_actor_required',
      message: 'human gate request requires an actor principal',
    };
  }

  const resolution = resolveTaskPolicy(buildTaskPolicyInputEnvelope(input.task));
  const approverPrincipalId = resolvedApproverPrincipalId(input.task, resolution);
  const now = input.requested_at ?? new Date().toISOString();
  const metadata = buildReviewGateMetadata(input.task, {
    human_gate_required: true,
    approver: approverPrincipalId,
    approver_principal_id: approverPrincipalId,
    human_gate_decision: null,
    human_gate_reason: input.reason?.trim() || null,
    human_gate_requested_by: actor,
    human_gate_requested_at: now,
  });

  return {
    ok: true,
    approver_principal_id: approverPrincipalId,
    decision: 'pending',
    metadata,
    updates: {
      human_gate_required: true,
      human_gate_state: 'pending',
      metadata: writeTaskMetadataRecord(metadata),
    },
  };
}

export function buildTaskHumanGateDecisionUpdates(input: {
  task: TaskRecord;
  actor_principal_id: string;
  actor_type: ReviewGateActorType;
  decision: TaskHumanGateDecision;
  reason?: string | null;
  decided_at?: string;
}): ReviewGateMutationResult {
  const actor = normalizeActorPrincipal(input.actor_principal_id);
  if (!actor) {
    return {
      ok: false,
      status: 400,
      code: 'human_gate_actor_required',
      message: 'human gate decision requires an actor principal',
    };
  }

  const actorType = normalizeReviewGateActorType(input.actor_type);
  if (actorType !== 'human') {
    return {
      ok: false,
      status: 403,
      code: 'human_gate_human_approver_required',
      message: 'human gate decision requires a human approver',
    };
  }

  const resolution = resolveTaskPolicy(buildTaskPolicyInputEnvelope(input.task));
  if (!input.task.human_gate_required && !resolution.human_gate_required) {
    return {
      ok: false,
      status: 409,
      code: 'human_gate_not_required',
      message: 'task does not require a human gate',
    };
  }

  if (input.task.human_gate_state !== 'pending') {
    return {
      ok: false,
      status: 409,
      code: 'human_gate_not_pending',
      message: 'human gate can only be decided while pending',
    };
  }

  const approverPrincipalId = resolvedApproverPrincipalId(input.task, resolution);
  if (approverPrincipalId && !isSamePrincipal(actor, approverPrincipalId)) {
    return {
      ok: false,
      status: 403,
      code: 'human_gate_approver_not_eligible',
      message: 'human gate decision requires the assigned human approver',
      approver_principal_id: approverPrincipalId,
    };
  }

  const now = input.decided_at ?? new Date().toISOString();
  const metadata = buildReviewGateMetadata(input.task, {
    human_gate_required: true,
    approver: approverPrincipalId ?? actor,
    approver_principal_id: approverPrincipalId ?? actor,
    human_gate_decision: input.decision,
    human_gate_reason: input.reason?.trim() || null,
    human_gate_decided_by: actor,
    human_gate_decided_at: now,
  });

  return {
    ok: true,
    approver_principal_id: approverPrincipalId ?? actor,
    decision: input.decision,
    metadata,
    updates: {
      human_gate_required: true,
      human_gate_state: input.decision,
      metadata: writeTaskMetadataRecord(metadata),
    },
  };
}

export function validateTaskDoneReviewGateState(task: TaskRecord): ReviewGateMutationResult {
  if (task.review_required && task.review_state !== 'accepted') {
    return {
      ok: false,
      status: 409,
      code: 'review_unresolved_before_done',
      message: 'required review must be accepted before task completion',
    };
  }
  if (task.human_gate_required && task.human_gate_state !== 'approved') {
    return {
      ok: false,
      status: 409,
      code: 'human_gate_unresolved_before_done',
      message: 'required human gate must be approved before task completion',
    };
  }
  return {
    ok: true,
    decision: 'accepted',
    metadata: readTaskMetadataRecord(task.metadata),
    updates: {},
  };
}

function normalizeJsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function normalizeJsonNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizePositiveInteger(entry))
    .filter((entry): entry is number => entry !== null);
}

function isObjectRefRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function normalizeObjectRefs(value: unknown): ObjectRef[] {
  if (typeof value === 'undefined' || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('linked object refs must be an array');
  }

  return value.map((entry, index) => {
    if (!isObjectRefRecord(entry)) {
      throw new Error(`object ref at index ${index} must be an object`);
    }

    const objectType = normalizeBlockerReason(entry.object_type);
    const objectId = normalizeBlockerReason(entry.object_id);
    const linkRole = normalizeBlockerReason(entry.link_role);

    if (!objectType || !objectId || !linkRole) {
      throw new Error('ObjectRef requires object_type, object_id, and link_role');
    }

    return {
      object_type: objectType,
      object_id: objectId,
      link_role: linkRole,
    };
  });
}

function normalizeObjectRefsJson(value: unknown): ObjectRef[] {
  try {
    return normalizeObjectRefs(parseJsonArray(value));
  } catch {
    return [];
  }
}

function stringifyObjectRefs(value: unknown): string {
  return JSON.stringify(normalizeObjectRefs(value));
}

function appendObjectRef(current: ObjectRef[], objectRef: ObjectRef): ObjectRef[] {
  const normalized = normalizeObjectRefs([objectRef])[0];
  const existing = normalizeObjectRefs(current);
  const hasRef = existing.some((entry) =>
    entry.object_type === normalized.object_type &&
    entry.object_id === normalized.object_id &&
    entry.link_role === normalized.link_role
  );
  return hasRef ? existing : [...existing, normalized];
}

function normalizeSlug(value: unknown, fallback: string): string {
  const raw = normalizeBlockerReason(value) ?? fallback;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'workspace';
}

function seedDefaultMissionControlProjects(db: Database.Database): void {
  const insertIfMissing = db.prepare(`
    INSERT INTO projects (name, color, created_at)
    SELECT ?, ?, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1
      FROM projects
      WHERE lower(name) = lower(?)
    )
  `);

  for (const project of DEFAULT_MISSION_CONTROL_PROJECTS) {
    insertIfMissing.run(project.name, project.color, project.name);
  }
}

function bootstrap(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      deployment_mode TEXT NOT NULL DEFAULT 'saas',
      mission TEXT,
      domains_json TEXT NOT NULL DEFAULT '[]',
      blueprint_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, slug)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}',
      team_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_TEAM_ID}',
      project_id INTEGER,
      created_by_principal_id TEXT DEFAULT 'legacy-system',
      initiator_principal_id TEXT DEFAULT 'legacy-unknown',
      initiator_type TEXT DEFAULT 'unknown',
      owner_principal_id TEXT DEFAULT 'legacy-owner',
      owner_principal_type TEXT DEFAULT 'unknown',
      executor_principal_id TEXT,
      assignment_state TEXT DEFAULT 'unassigned',
      taskmaster_drivable INTEGER NOT NULL DEFAULT 0,
      worktype TEXT NOT NULL DEFAULT 'general',
      risk_level TEXT NOT NULL DEFAULT 'low',
      agent_trust_level TEXT NOT NULL DEFAULT 'unknown',
      policy_inputs_json TEXT NOT NULL DEFAULT '{}',
      external_side_effects_json TEXT NOT NULL DEFAULT '[]',
      review_required INTEGER NOT NULL DEFAULT 0,
      review_state TEXT NOT NULL DEFAULT 'not_required',
      human_gate_required INTEGER NOT NULL DEFAULT 0,
      human_gate_state TEXT NOT NULL DEFAULT 'not_required',
      name TEXT NOT NULL,
      description TEXT,
      column TEXT NOT NULL DEFAULT 'backlog',
      assignee TEXT DEFAULT 'Unassigned',
      blocked INTEGER NOT NULL DEFAULT 0,
      blocker_reason TEXT,
      project TEXT DEFAULT 'General',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column);
    CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id_metadata ON tasks(
      CASE WHEN json_valid(metadata) THEN CAST(json_extract(metadata, '$.parent_task_id') AS INTEGER) END
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id_camel_metadata ON tasks(
      CASE WHEN json_valid(metadata) THEN CAST(json_extract(metadata, '$.parentTaskId') AS INTEGER) END
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_id_metadata ON tasks(
      CASE WHEN json_valid(metadata) THEN CAST(json_extract(metadata, '$.parent_id') AS INTEGER) END
    );

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'agent',
      type TEXT NOT NULL,
      activity_event_type TEXT,
      activity_event_payload_version INTEGER NOT NULL DEFAULT 1,
      activity_event_payload_json TEXT,
      activity_event_schema_status TEXT NOT NULL DEFAULT 'legacy_mapped',
      activity_event_legacy_type TEXT,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      agent_name TEXT,
      agent_emoji TEXT,
      file_path TEXT,
      task_id INTEGER,
      task_column TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_activities_source ON activities(source);
    CREATE INDEX IF NOT EXISTS idx_activities_task_id ON activities(task_id);
    CREATE INDEX IF NOT EXISTS idx_activities_file_path ON activities(file_path);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}',
      recipient_principal_id TEXT NOT NULL,
      canonical_event_id TEXT NOT NULL,
      object_ref_json TEXT NOT NULL,
      notification_type TEXT NOT NULL,
      inbox_state TEXT NOT NULL DEFAULT 'unread',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      policy_reason_chain_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_recipient_state ON notifications(org_id, recipient_principal_id, inbox_state);
    CREATE INDEX IF NOT EXISTS idx_notifications_event ON notifications(canonical_event_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);
    CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      external_ref TEXT,
      failure_reason TEXT,
      degraded_reason TEXT,
      policy_reason_json TEXT NOT NULL DEFAULT '{}',
      attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification ON notification_deliveries(notification_id, attempted_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_notification_deliveries_channel_status ON notification_deliveries(channel, status);

    CREATE TABLE IF NOT EXISTS evidence_artifacts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}',
      team_id TEXT,
      project_id INTEGER,
      artifact_kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body_format TEXT NOT NULL DEFAULT 'markdown',
      stable_path TEXT NOT NULL UNIQUE,
      human_path_alias TEXT,
      content_hash TEXT NOT NULL,
      mutability_policy TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      origin_task_id INTEGER,
      source_activity_event_ids_json TEXT NOT NULL DEFAULT '[]',
      source_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
      provenance_json TEXT NOT NULL DEFAULT '{}',
      integrity_state TEXT NOT NULL DEFAULT 'valid',
      availability_state TEXT NOT NULL DEFAULT 'available',
      created_by_principal_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_artifacts_origin_task ON evidence_artifacts(origin_task_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_artifacts_org_kind ON evidence_artifacts(org_id, artifact_kind);
    CREATE INDEX IF NOT EXISTS idx_evidence_artifacts_integrity ON evidence_artifacts(integrity_state);

    CREATE TABLE IF NOT EXISTS evidence_artifact_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id TEXT NOT NULL REFERENCES evidence_artifacts(id),
      version INTEGER NOT NULL,
      stable_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by_principal_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(artifact_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_artifact_versions_artifact ON evidence_artifact_versions(artifact_id, version);

    CREATE TABLE IF NOT EXISTS native_documents (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}',
      team_id TEXT,
      project_id INTEGER,
      title TEXT NOT NULL,
      document_kind TEXT NOT NULL DEFAULT 'internal_doc',
      body_format TEXT NOT NULL DEFAULT 'markdown',
      stable_path TEXT NOT NULL UNIQUE,
      content_hash TEXT NOT NULL,
      mutability_policy TEXT NOT NULL DEFAULT 'editable_versioned',
      version INTEGER NOT NULL DEFAULT 1,
      lifecycle_state TEXT NOT NULL DEFAULT 'active',
      sensitivity TEXT,
      acl_json TEXT NOT NULL DEFAULT '{}',
      linked_object_refs_json TEXT NOT NULL DEFAULT '[]',
      created_by_principal_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_native_documents_org_project ON native_documents(org_id, project_id);
    CREATE INDEX IF NOT EXISTS idx_native_documents_kind ON native_documents(document_kind);

    CREATE TABLE IF NOT EXISTS native_document_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL REFERENCES native_documents(id),
      version INTEGER NOT NULL,
      stable_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by_principal_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(document_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_native_document_versions_document ON native_document_versions(document_id, version);

    CREATE TABLE IF NOT EXISTS external_document_refs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}',
      connector_type TEXT NOT NULL,
      external_id TEXT,
      external_url TEXT,
      title TEXT NOT NULL,
      external_mime_type TEXT,
      external_canonical_url TEXT,
      auth_state TEXT NOT NULL DEFAULT 'unknown',
      readiness_state TEXT NOT NULL DEFAULT 'unknown',
      granted_scopes_json TEXT NOT NULL DEFAULT '[]',
      missing_scopes_json TEXT NOT NULL DEFAULT '[]',
      auth_expires_at TEXT,
      external_ref_state TEXT NOT NULL DEFAULT 'unknown',
      capabilities_json TEXT NOT NULL DEFAULT '{"read":true,"index":true,"link":true,"preview":true,"write":false,"export":false,"sync":false,"create":false,"update":false}',
      canonicality TEXT NOT NULL DEFAULT 'unknown',
      last_indexed_at TEXT,
      last_checked_at TEXT,
      entity_visibility_policy_json TEXT NOT NULL DEFAULT '{}',
      external_permission_summary TEXT,
      linked_object_refs_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_external_document_refs_org_connector ON external_document_refs(org_id, connector_type);
    CREATE INDEX IF NOT EXISTS idx_external_document_refs_external_id ON external_document_refs(connector_type, external_id);

    CREATE TABLE IF NOT EXISTS agent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      event TEXT NOT NULL,
      task_id INTEGER,
      action TEXT NOT NULL,
      result TEXT,
      model TEXT DEFAULT 'gemini-flash',
      tokens_used INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_agent_log_timestamp ON agent_log(timestamp DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_log_event ON agent_log(event);
    CREATE INDEX IF NOT EXISTS idx_agent_log_task_id ON agent_log(task_id);

    CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      author TEXT DEFAULT 'Human',
      parent_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_task_comments_task_id_id ON task_comments(task_id, id);

    CREATE TABLE IF NOT EXISTS roadmaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      theme TEXT,
      color TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS roadmap_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roadmap_id INTEGER NOT NULL REFERENCES roadmaps(id),
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'P2',
      target_period TEXT,
      status TEXT DEFAULT 'planned',
      linked_task_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_roadmap_items_roadmap_id ON roadmap_items(roadmap_id);

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}',
      team_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_TEAM_ID}',
      name TEXT NOT NULL,
      color TEXT,
      lifecycle_state TEXT NOT NULL DEFAULT 'active',
      project_key TEXT,
      work_domain TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES entity_agents(id) ON DELETE CASCADE,
      crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, crew_id)
    );
    CREATE TABLE IF NOT EXISTS crews (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      settings TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_crews_updated_at ON crews(updated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS crew_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(crew_id, agent_id)
    );

    CREATE INDEX IF NOT EXISTS idx_crew_subscriptions_crew ON crew_subscriptions(crew_id);
    CREATE INDEX IF NOT EXISTS idx_crew_subscriptions_agent ON crew_subscriptions(agent_id);

    CREATE TABLE IF NOT EXISTS task_projects (
      task_id INTEGER NOT NULL,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}',
      project_id INTEGER NOT NULL,
      PRIMARY KEY (task_id, project_id)
    );

    CREATE INDEX IF NOT EXISTS idx_task_projects_task_id ON task_projects(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_projects_project_id ON task_projects(project_id);

    CREATE TABLE IF NOT EXISTS task_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_by TEXT,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_task_history_task_id ON task_history(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_history_changed_at ON task_history(changed_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS file_sources (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT,
      base_path TEXT,
      auth_type TEXT NOT NULL DEFAULT 'none',
      auth_ref TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      icon TEXT,
      capabilities TEXT NOT NULL DEFAULT '{}',
      health TEXT NOT NULL DEFAULT 'ok',
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_file_sources_enabled ON file_sources(enabled);
    CREATE INDEX IF NOT EXISTS idx_file_sources_type ON file_sources(type);
    CREATE INDEX IF NOT EXISTS idx_file_sources_updated_at ON file_sources(updated_at DESC);

    CREATE TABLE IF NOT EXISTS file_index (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'one-off',
      agent TEXT NOT NULL DEFAULT 'other',
      is_recurring INTEGER NOT NULL DEFAULT 0,
      recurring_pattern TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT,
      indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      preview TEXT,
      content_hash TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_file_index_source_path ON file_index(source_id, path);
    CREATE INDEX IF NOT EXISTS idx_file_index_source ON file_index(source_id);
    CREATE INDEX IF NOT EXISTS idx_file_index_type ON file_index(type);
    CREATE INDEX IF NOT EXISTS idx_file_index_agent ON file_index(agent);
    CREATE INDEX IF NOT EXISTS idx_file_index_indexed_at ON file_index(indexed_at DESC);

    CREATE TABLE IF NOT EXISTS file_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      error TEXT,
      files_scanned INTEGER NOT NULL DEFAULT 0,
      files_indexed INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_file_sync_runs_source ON file_sync_runs(source_id);
    CREATE INDEX IF NOT EXISTS idx_file_sync_runs_status ON file_sync_runs(status);
    CREATE INDEX IF NOT EXISTS idx_file_sync_runs_started_at ON file_sync_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS document_sessions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content_hash TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_sessions_doc_id ON document_sessions(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_sessions_updated_at ON document_sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_authorship_ranges (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      author TEXT NOT NULL,
      reviewed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_authorship_ranges_doc_id ON document_authorship_ranges(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_authorship_ranges_updated_at ON document_authorship_ranges(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_authorship_history (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      range_id TEXT,
      author TEXT NOT NULL,
      diff_json TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_authorship_history_doc_id ON document_authorship_history(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_authorship_history_updated_at ON document_authorship_history(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_presence (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      cursor_json TEXT NOT NULL DEFAULT '{}',
      last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_presence_doc_agent ON document_presence(doc_id, agent_id);
    CREATE INDEX IF NOT EXISTS idx_document_presence_doc_id ON document_presence(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_presence_updated_at ON document_presence(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_comments (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      author TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      selected_text TEXT,
      text TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_comments_doc_id ON document_comments(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_comments_updated_at ON document_comments(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_comment_replies (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      comment_id TEXT NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_doc_id ON document_comment_replies(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_comment_id ON document_comment_replies(comment_id);
    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_updated_at ON document_comment_replies(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_suggestions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      author TEXT NOT NULL,
      type TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      original_text TEXT NOT NULL,
      suggested_text TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_suggestions_doc_id ON document_suggestions(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_suggestions_updated_at ON document_suggestions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_review_runs (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_review_runs_doc_id ON document_review_runs(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_review_runs_updated_at ON document_review_runs(updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      token_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tokens_hash ON agent_tokens(token_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tokens_type_actor ON agent_tokens(token_type, actor);
    CREATE INDEX IF NOT EXISTS idx_agent_tokens_updated_at ON agent_tokens(updated_at DESC);


    CREATE TABLE IF NOT EXISTS entity_agents (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      avatar_url TEXT,
      description TEXT,
      adapter_type TEXT,
      runtime_type TEXT,
      runtime_binding_id TEXT,
      provider_type TEXT NOT NULL DEFAULT 'unknown',
      helm_managed INTEGER NOT NULL DEFAULT 0,
      binding_state TEXT NOT NULL DEFAULT 'unknown',
      status TEXT NOT NULL DEFAULT 'active',
      instructions_path TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entity_modules (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      icon TEXT,
      kind TEXT NOT NULL DEFAULT 'core',
      permissions_schema_json TEXT NOT NULL DEFAULT '[]',
      ui_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entity_agent_module_grants (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      module_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      permissions_json TEXT NOT NULL DEFAULT '[]',
      scope_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, module_id)
    );

    CREATE TABLE IF NOT EXISTS entity_module_skill_refs (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_entity_agents_slug ON entity_agents(slug);
    CREATE INDEX IF NOT EXISTS idx_entity_agents_status ON entity_agents(status);
    CREATE INDEX IF NOT EXISTS idx_entity_modules_slug ON entity_modules(slug);
    CREATE INDEX IF NOT EXISTS idx_entity_grants_agent ON entity_agent_module_grants(agent_id);
    CREATE INDEX IF NOT EXISTS idx_entity_grants_module ON entity_agent_module_grants(module_id);
    CREATE INDEX IF NOT EXISTS idx_entity_skill_refs_module ON entity_module_skill_refs(module_id);

    CREATE TABLE IF NOT EXISTS agent_invites (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'created',
      agent_id TEXT,
      agent_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'worker',
      created_at TEXT NOT NULL,
      opened_at TEXT,
      completed_at TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      revoked_by TEXT,
      created_by TEXT,
      creation_source TEXT NOT NULL DEFAULT 'agents_invite',
      workspace_id TEXT,
      project_id TEXT,
      workplane_id TEXT,
      task_id INTEGER,
      selected_bundle TEXT NOT NULL DEFAULT 'default',
      selected_modules_json TEXT NOT NULL DEFAULT '[]',
      selected_module_config_json TEXT NOT NULL DEFAULT '{}',
      permissions_scope_json TEXT NOT NULL DEFAULT '[]',
      safe_stop_conditions_json TEXT NOT NULL DEFAULT '[]',
      provider_profile_id TEXT,
      chief_routing_mode TEXT NOT NULL DEFAULT 'none',
      previous_token_hash TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_invites_token_hash ON agent_invites(token_hash);
    CREATE INDEX IF NOT EXISTS idx_agent_invites_status ON agent_invites(status);
    CREATE INDEX IF NOT EXISTS idx_agent_invites_created_at ON agent_invites(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_invites_agent_id ON agent_invites(agent_id);

    CREATE TABLE IF NOT EXISTS agent_invite_progress (
      id TEXT PRIMARY KEY,
      invite_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      label TEXT NOT NULL,
      module_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      message TEXT,
      evidence_url TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(invite_id, step_id),
      FOREIGN KEY(invite_id) REFERENCES agent_invites(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_invite_progress_invite ON agent_invite_progress(invite_id);
  `);

  if (!hasColumn(db, 'tasks', 'brief')) {
    db.exec('ALTER TABLE tasks ADD COLUMN brief TEXT');
  }

  if (!hasColumn(db, 'external_document_refs', 'granted_scopes_json')) {
    db.exec("ALTER TABLE external_document_refs ADD COLUMN granted_scopes_json TEXT NOT NULL DEFAULT '[]'");
  }

  if (!hasColumn(db, 'external_document_refs', 'missing_scopes_json')) {
    db.exec("ALTER TABLE external_document_refs ADD COLUMN missing_scopes_json TEXT NOT NULL DEFAULT '[]'");
  }

  if (!hasColumn(db, 'external_document_refs', 'auth_expires_at')) {
    db.exec('ALTER TABLE external_document_refs ADD COLUMN auth_expires_at TEXT');
  }

  if (!hasColumn(db, 'external_document_refs', 'external_ref_state')) {
    db.exec("ALTER TABLE external_document_refs ADD COLUMN external_ref_state TEXT NOT NULL DEFAULT 'unknown'");
  }

  if (!hasColumn(db, 'entity_agents', 'runtime_binding_id')) {
    db.exec('ALTER TABLE entity_agents ADD COLUMN runtime_binding_id TEXT');
  }

  if (!hasColumn(db, 'entity_agents', 'provider_type')) {
    db.exec("ALTER TABLE entity_agents ADD COLUMN provider_type TEXT NOT NULL DEFAULT 'unknown'");
  }

  if (!hasColumn(db, 'entity_agents', 'helm_managed')) {
    db.exec('ALTER TABLE entity_agents ADD COLUMN helm_managed INTEGER NOT NULL DEFAULT 0');
  }

  if (!hasColumn(db, 'entity_agents', 'binding_state')) {
    db.exec("ALTER TABLE entity_agents ADD COLUMN binding_state TEXT NOT NULL DEFAULT 'unknown'");
  }

  if (!hasColumn(db, 'tasks', 'origin_channel')) {
    db.exec('ALTER TABLE tasks ADD COLUMN origin_channel TEXT');
  }

  if (!hasColumn(db, 'tasks', 'due_date')) {
    db.exec('ALTER TABLE tasks ADD COLUMN due_date TEXT');
  }

  if (!hasColumn(db, 'tasks', 'priority')) {
    db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'P2'");
  }

  if (!hasColumn(db, 'tasks', 'estimate_hours')) {
    db.exec('ALTER TABLE tasks ADD COLUMN estimate_hours REAL');
  }

  if (!hasColumn(db, 'tasks', 'time_spent')) {
    db.exec('ALTER TABLE tasks ADD COLUMN time_spent REAL DEFAULT 0');
  }

  if (!hasColumn(db, 'tasks', 'output')) {
    db.exec('ALTER TABLE tasks ADD COLUMN output TEXT');
  }

  if (!hasColumn(db, 'tasks', 'progress_status')) {
    db.exec("ALTER TABLE tasks ADD COLUMN progress_status TEXT DEFAULT 'backlog'");
  }

  if (!hasColumn(db, 'tasks', 'recurring')) {
    db.exec('ALTER TABLE tasks ADD COLUMN recurring INTEGER DEFAULT 0');
  }

  if (!hasColumn(db, 'tasks', 'recurring_config')) {
    db.exec('ALTER TABLE tasks ADD COLUMN recurring_config TEXT');
  }

  if (!hasColumn(db, 'tasks', 'model')) {
    db.exec('ALTER TABLE tasks ADD COLUMN model TEXT');
  }

  if (!hasColumn(db, 'tasks', 'archived')) {
    db.exec('ALTER TABLE tasks ADD COLUMN archived INTEGER DEFAULT 0');
  }

  if (!hasColumn(db, 'activities', 'activity_event_type')) {
    db.exec('ALTER TABLE activities ADD COLUMN activity_event_type TEXT');
  }

  if (!hasColumn(db, 'activities', 'activity_event_payload_version')) {
    db.exec('ALTER TABLE activities ADD COLUMN activity_event_payload_version INTEGER NOT NULL DEFAULT 1');
  }

  if (!hasColumn(db, 'activities', 'activity_event_payload_json')) {
    db.exec('ALTER TABLE activities ADD COLUMN activity_event_payload_json TEXT');
  }

  if (!hasColumn(db, 'activities', 'activity_event_schema_status')) {
    db.exec("ALTER TABLE activities ADD COLUMN activity_event_schema_status TEXT NOT NULL DEFAULT 'legacy_mapped'");
  }

  if (!hasColumn(db, 'activities', 'activity_event_legacy_type')) {
    db.exec('ALTER TABLE activities ADD COLUMN activity_event_legacy_type TEXT');
  }

  if (!hasColumn(db, 'evidence_artifacts', 'linked_object_refs_json')) {
    db.exec("ALTER TABLE evidence_artifacts ADD COLUMN linked_object_refs_json TEXT NOT NULL DEFAULT '[]'");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_artifact_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id TEXT NOT NULL REFERENCES evidence_artifacts(id),
      version INTEGER NOT NULL,
      stable_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by_principal_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(artifact_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_artifact_versions_artifact ON evidence_artifact_versions(artifact_id, version);

    CREATE TABLE IF NOT EXISTS native_document_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL REFERENCES native_documents(id),
      version INTEGER NOT NULL,
      stable_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by_principal_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(document_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_native_document_versions_document ON native_document_versions(document_id, version);
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_activities_event_type ON activities(activity_event_type)');

  // THE-870 / WP1-C-02 — additive task-scoped ActivityEvent spine storage
  ensureActivityEventSpineStoreSchema(db);

  seedDefaultMissionControlProjects(db);
  seedEntityRegistryDefaults(db);
}


function seedEntityRegistryDefaults(db: Database.Database): void {
  const agents = [
    ['assistant', 'assistant', 'Assistant', '🤖', null, 'General-purpose local agent placeholder', 'local', 'cli', 'active', null, '{"owner":"Workspace","verification":"Registry + grants","modules":["chat","tasks","files","docs"]}']
  ];
  const insertAgent = db.prepare(`
    INSERT OR IGNORE INTO entity_agents (
      id, slug, name, emoji, avatar_url, description, adapter_type, runtime_type, status, instructions_path, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const agent of agents) {
    insertAgent.run(...agent);
  }

  const modules = [
    ['chat', 'chat', 'Chat', 'Workspace chat module', 1, '💬', 'core', '["read","post","mention","admin"]', '{"label":"Chat"}'],
    ['tasks', 'tasks', 'Mission Control', 'Task and kanban module', 1, '📋', 'core', '["read","create","update","assign","review","admin"]', '{"label":"Mission Control"}'],
    ['files', 'files', 'Files', 'Workspace file access', 1, '📁', 'core', '["read","write","delete","search"]', '{"label":"Files"}'],
    ['docs', 'docs', 'Docs', 'Editor and docs collaboration', 1, '📝', 'core', '["read","write","comment","review"]', '{"label":"Docs"}'],
    ['swarm', 'swarm', 'Swarm', 'Swarm orchestration module', 1, '🐝', 'core', '["read","dispatch","supervise","kill","admin"]', '{"label":"Swarm"}'],
    ['plugins', 'plugins', 'Plugins', 'Plugin management module', 1, '🧩', 'core', '["read","toggle","configure","admin"]', '{"label":"Plugins"}'],
    ['entity-agent-contracts', 'entity-agent-contracts', 'Entity Agent Contracts', 'Required operating contract for Entity-aware onboarding agents.', 1, '📜', 'contract', '["read","validate"]', '{"label":"Required contract"}'],
    ['entity-fs', 'entity-fs', 'Entity FS', 'Entity-backed file source and docs-link delivery behavior for setup agents.', 1, '📁', 'module', '["read","search","export"]', '{"label":"Required docs/file layer"}'],
    ['entity-mc', 'entity-mc', 'Entity MC', 'Mission Control helper bundle for setup-safe progress reporting and verification.', 1, '📋', 'module', '["read","configure","verify"]', '{"label":"Recommended task helper"}'],
    ['entity-linker', 'entity-linker', 'Entity Linker', 'Docs-link delivery integration for shared artifacts during onboarding.', 1, '🔗', 'plugin', '["read","rewrite","verify"]', '{"label":"Recommended docs linker"}'],
    ['entity-discord-title-hook', 'entity-discord-title-hook', 'Discord Title Hook', 'Admin-managed Discord channel title sync integration.', 1, '#️⃣', 'plugin', '["read","configure"]', '{"label":"Admin only"}'],
    ['entity-services', 'entity-services', 'Entity Services', 'Admin-managed service/runtime integrations.', 1, '🛠️', 'plugin', '["read","configure","admin"]', '{"label":"Admin only"}'],
    ['geordi-swarm', 'geordi-swarm', 'Geordi Swarm', 'Future multi-agent swarm orchestration on top of Entity helper modules.', 1, '🐝', 'plugin', '["read","dispatch","admin"]', '{"label":"Future swarm module"}']
  ];
  const insertModule = db.prepare(`
    INSERT OR IGNORE INTO entity_modules (
      id, slug, name, description, enabled, icon, kind, permissions_schema_json, ui_config_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const moduleRow of modules) {
    insertModule.run(...moduleRow);
  }

  const skillRefs = [
    ['tasks-mc-sh', 'tasks', 'mc.sh', 'script', 'skills/entity-mc/source-scripts/mc.sh', 1, 'Mission Control CLI helper bundled with Entity'],
    ['tasks-context', 'tasks', 'Entity context', 'doc', 'memory/entity-project-context.md', 1, 'Entity runtime context'],
    ['swarm-skill', 'swarm', 'Swarm skill', 'skill', 'skills/entity-mc/', 0, 'Swarm-adjacent execution runtime'],
    ['plugins-admin', 'plugins', 'Plugin admin', 'doc', 'packages/app/src/stores/pluginStore.ts', 0, 'Plugin UI/state wiring'],
    ['entity-agent-contracts-doc', 'entity-agent-contracts', 'Entity contract spec', 'doc', 'docs/pluggable-agents-modules-spec.md', 1, 'Required onboarding contract reference'],
    ['entity-fs-doc', 'entity-fs', 'Entity FS onboarding spec', 'doc', 'docs/pluggable-agents-modules-spec.md', 1, 'Docs/file delivery reference'],
    ['entity-mc-skill', 'entity-mc', 'Entity MC skill bundle', 'skill', 'skills/entity-mc/', 1, 'Setup-safe Mission Control helper bundle'],
    ['entity-linker-doc', 'entity-linker', 'Plugin architecture spec', 'doc', 'docs/PLUGIN-ARCHITECTURE-SPEC.md', 0, 'Docs-link integration contract'],
    ['entity-discord-title-hook-doc', 'entity-discord-title-hook', 'Plugin architecture spec', 'doc', 'docs/PLUGIN-ARCHITECTURE-SPEC.md', 0, 'Admin-only Discord integration reference'],
    ['entity-services-doc', 'entity-services', 'Plugin architecture spec', 'doc', 'docs/PLUGIN-ARCHITECTURE-SPEC.md', 0, 'Admin-only service integration reference'],
    ['geordi-swarm-doc', 'geordi-swarm', 'Geordi Swarm manifest example', 'doc', 'docs/ENTITY-PLUGIN-MANIFEST.example.json', 0, 'Future swarm packaging reference']
  ];
  const insertSkillRef = db.prepare(`
    INSERT OR IGNORE INTO entity_module_skill_refs (
      id, module_id, label, kind, ref, required, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const ref of skillRefs) {
    insertSkillRef.run(...ref);
  }

  const moduleIdBySlug = new Map(
    (db.prepare('SELECT id, slug FROM entity_modules').all() as Array<{ id: string; slug: string }>).map((row) => [row.slug, row.id])
  );
  const agentRows = db.prepare('SELECT id, metadata_json FROM entity_agents').all() as Array<{ id: string; metadata_json: string }>;
  const insertGrant = db.prepare(`
    INSERT OR IGNORE INTO entity_agent_module_grants (
      id, agent_id, module_id, enabled, permissions_json, scope_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const agent of agentRows) {
    let modulesForAgent: string[] = [];
    try {
      const metadata = JSON.parse(agent.metadata_json || '{}') as { modules?: string[] };
      modulesForAgent = Array.isArray(metadata.modules) ? metadata.modules : [];
    } catch {
      modulesForAgent = [];
    }
    for (const moduleSlug of modulesForAgent) {
      const moduleId = moduleIdBySlug.get(moduleSlug);
      if (!moduleId) continue;
      insertGrant.run(randomUUID(), agent.id, moduleId, 1, '[]', '{}');
    }
  }
}

function ensureTaskSchema(db: Database.Database): void {
  if (!hasColumn(db, 'tasks', 'blocked')) {
    db.exec('ALTER TABLE tasks ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
  }

  if (!hasColumn(db, 'tasks', 'blocker_reason')) {
    db.exec('ALTER TABLE tasks ADD COLUMN blocker_reason TEXT');
  }

  if (!hasColumn(db, 'tasks', 'project')) {
    db.exec("ALTER TABLE tasks ADD COLUMN project TEXT DEFAULT 'General'");
  }
}

function ensureWorkspaceScopeSchema(db: Database.Database): void {
  if (!hasColumn(db, 'orgs', 'mission')) {
    db.exec('ALTER TABLE orgs ADD COLUMN mission TEXT');
  }

  if (!hasColumn(db, 'orgs', 'domains_json')) {
    db.exec("ALTER TABLE orgs ADD COLUMN domains_json TEXT NOT NULL DEFAULT '[]'");
  }

  if (!hasColumn(db, 'orgs', 'blueprint_json')) {
    db.exec('ALTER TABLE orgs ADD COLUMN blueprint_json TEXT');
  }

  db.prepare(`
    INSERT OR IGNORE INTO orgs (id, name, slug, status, deployment_mode, domains_json)
    VALUES (?, ?, ?, 'active', 'saas', '[]')
  `).run(DEFAULT_WORKSPACE_ORG_ID, 'Default Workspace', 'default');

  db.prepare(`
    INSERT OR IGNORE INTO teams (id, org_id, name, slug, status)
    VALUES (?, ?, ?, ?, 'active')
  `).run(DEFAULT_WORKSPACE_TEAM_ID, DEFAULT_WORKSPACE_ORG_ID, 'Default Team', 'default');

  if (!hasColumn(db, 'tasks', 'org_id')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN org_id TEXT DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}'`);
  }

  if (!hasColumn(db, 'tasks', 'team_id')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN team_id TEXT DEFAULT '${DEFAULT_WORKSPACE_TEAM_ID}'`);
  }

  if (!hasColumn(db, 'tasks', 'project_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN project_id INTEGER');
  }

  if (!hasColumn(db, 'tasks', 'created_by_principal_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN created_by_principal_id TEXT DEFAULT 'legacy-system'");
  }

  if (!hasColumn(db, 'tasks', 'initiator_principal_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN initiator_principal_id TEXT DEFAULT 'legacy-unknown'");
  }

  if (!hasColumn(db, 'tasks', 'initiator_type')) {
    db.exec("ALTER TABLE tasks ADD COLUMN initiator_type TEXT DEFAULT 'unknown'");
  }

  if (!hasColumn(db, 'tasks', 'owner_principal_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN owner_principal_id TEXT DEFAULT 'legacy-owner'");
  }

  if (!hasColumn(db, 'tasks', 'owner_principal_type')) {
    db.exec("ALTER TABLE tasks ADD COLUMN owner_principal_type TEXT DEFAULT 'unknown'");
  }

  if (!hasColumn(db, 'tasks', 'executor_principal_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN executor_principal_id TEXT');
  }

  if (!hasColumn(db, 'tasks', 'assignment_state')) {
    db.exec("ALTER TABLE tasks ADD COLUMN assignment_state TEXT DEFAULT 'unassigned'");
  }

  if (!hasColumn(db, 'tasks', 'taskmaster_drivable')) {
    db.exec('ALTER TABLE tasks ADD COLUMN taskmaster_drivable INTEGER NOT NULL DEFAULT 0');
  }

  if (!hasColumn(db, 'tasks', 'worktype')) {
    db.exec("ALTER TABLE tasks ADD COLUMN worktype TEXT NOT NULL DEFAULT 'general'");
  }

  if (!hasColumn(db, 'tasks', 'risk_level')) {
    db.exec("ALTER TABLE tasks ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'low'");
  }

  if (!hasColumn(db, 'tasks', 'agent_trust_level')) {
    db.exec("ALTER TABLE tasks ADD COLUMN agent_trust_level TEXT NOT NULL DEFAULT 'unknown'");
  }

  if (!hasColumn(db, 'tasks', 'policy_inputs_json')) {
    db.exec("ALTER TABLE tasks ADD COLUMN policy_inputs_json TEXT NOT NULL DEFAULT '{}'");
  }

  if (!hasColumn(db, 'tasks', 'external_side_effects_json')) {
    db.exec("ALTER TABLE tasks ADD COLUMN external_side_effects_json TEXT NOT NULL DEFAULT '[]'");
  }

  if (!hasColumn(db, 'tasks', 'review_required')) {
    db.exec('ALTER TABLE tasks ADD COLUMN review_required INTEGER NOT NULL DEFAULT 0');
  }

  if (!hasColumn(db, 'tasks', 'review_state')) {
    db.exec("ALTER TABLE tasks ADD COLUMN review_state TEXT NOT NULL DEFAULT 'not_required'");
  }

  if (!hasColumn(db, 'tasks', 'human_gate_required')) {
    db.exec('ALTER TABLE tasks ADD COLUMN human_gate_required INTEGER NOT NULL DEFAULT 0');
  }

  if (!hasColumn(db, 'tasks', 'human_gate_state')) {
    db.exec("ALTER TABLE tasks ADD COLUMN human_gate_state TEXT NOT NULL DEFAULT 'not_required'");
  }

  if (!hasColumn(db, 'projects', 'org_id')) {
    db.exec(`ALTER TABLE projects ADD COLUMN org_id TEXT DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}'`);
  }

  if (!hasColumn(db, 'projects', 'team_id')) {
    db.exec(`ALTER TABLE projects ADD COLUMN team_id TEXT DEFAULT '${DEFAULT_WORKSPACE_TEAM_ID}'`);
  }

  if (!hasColumn(db, 'projects', 'lifecycle_state')) {
    db.exec("ALTER TABLE projects ADD COLUMN lifecycle_state TEXT DEFAULT 'active'");
  }

  if (!hasColumn(db, 'projects', 'project_key')) {
    db.exec('ALTER TABLE projects ADD COLUMN project_key TEXT');
  }

  if (!hasColumn(db, 'projects', 'work_domain')) {
    db.exec('ALTER TABLE projects ADD COLUMN work_domain TEXT');
  }

  if (!hasColumn(db, 'task_projects', 'org_id')) {
    db.exec(`ALTER TABLE task_projects ADD COLUMN org_id TEXT DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}'`);
  }

  db.exec(`
    UPDATE tasks
    SET org_id = '${DEFAULT_WORKSPACE_ORG_ID}'
    WHERE org_id IS NULL OR trim(org_id) = '';

    UPDATE tasks
    SET team_id = '${DEFAULT_WORKSPACE_TEAM_ID}'
    WHERE team_id IS NULL OR trim(team_id) = '';

    UPDATE tasks
    SET created_by_principal_id = 'legacy-system'
    WHERE created_by_principal_id IS NULL OR trim(created_by_principal_id) = '';

    UPDATE tasks
    SET initiator_principal_id = 'legacy-unknown'
    WHERE initiator_principal_id IS NULL OR trim(initiator_principal_id) = '';

    UPDATE tasks
    SET initiator_type = 'unknown'
    WHERE initiator_type IS NULL OR trim(initiator_type) = '';

    UPDATE tasks
    SET owner_principal_id = 'legacy-owner'
    WHERE owner_principal_id IS NULL OR trim(owner_principal_id) = '';

    UPDATE tasks
    SET owner_principal_type = 'unknown'
    WHERE owner_principal_type IS NULL OR trim(owner_principal_type) = '';

    UPDATE tasks
    SET assignment_state = CASE
      WHEN assignee IS NOT NULL AND trim(assignee) <> '' AND lower(trim(assignee)) <> 'unassigned' THEN 'assigned'
      WHEN taskmaster_drivable = 1 THEN 'unassigned'
      ELSE 'routing_problem'
    END
    WHERE assignment_state IS NULL OR trim(assignment_state) = '';

    UPDATE tasks
    SET worktype = 'general'
    WHERE worktype IS NULL OR trim(worktype) = '';

    UPDATE tasks
    SET risk_level = 'low'
    WHERE risk_level IS NULL OR trim(risk_level) = '';

    UPDATE tasks
    SET agent_trust_level = 'unknown'
    WHERE agent_trust_level IS NULL OR trim(agent_trust_level) = '';

    UPDATE tasks
    SET policy_inputs_json = '{}'
    WHERE policy_inputs_json IS NULL OR trim(policy_inputs_json) = '';

    UPDATE tasks
    SET external_side_effects_json = '[]'
    WHERE external_side_effects_json IS NULL OR trim(external_side_effects_json) = '';

    UPDATE tasks
    SET review_state = CASE
      WHEN review_required = 1 AND (review_state IS NULL OR trim(review_state) = '' OR review_state = 'not_required') THEN 'pending'
      WHEN review_required = 0 AND (review_state IS NULL OR trim(review_state) = '') THEN 'not_required'
      ELSE review_state
    END;

    UPDATE tasks
    SET human_gate_state = CASE
      WHEN human_gate_required = 1 AND (human_gate_state IS NULL OR trim(human_gate_state) = '' OR human_gate_state = 'not_required') THEN 'pending'
      WHEN human_gate_required = 0 AND (human_gate_state IS NULL OR trim(human_gate_state) = '') THEN 'not_required'
      ELSE human_gate_state
    END;

    UPDATE projects
    SET org_id = '${DEFAULT_WORKSPACE_ORG_ID}'
    WHERE org_id IS NULL OR trim(org_id) = '';

    UPDATE projects
    SET team_id = '${DEFAULT_WORKSPACE_TEAM_ID}'
    WHERE team_id IS NULL OR trim(team_id) = '';

    UPDATE projects
    SET lifecycle_state = 'active'
    WHERE lifecycle_state IS NULL OR trim(lifecycle_state) = '';

    UPDATE task_projects
    SET org_id = COALESCE(
      (SELECT tasks.org_id FROM tasks WHERE tasks.id = task_projects.task_id),
      '${DEFAULT_WORKSPACE_ORG_ID}'
    )
    WHERE org_id IS NULL OR trim(org_id) = '';

    UPDATE tasks
    SET project_id = (
      SELECT tp.project_id
      FROM task_projects tp
      INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tasks.org_id
      WHERE tp.task_id = tasks.id
      ORDER BY tp.project_id ASC
      LIMIT 1
    )
    WHERE project_id IS NULL;

    CREATE INDEX IF NOT EXISTS idx_tasks_org_updated_at ON tasks(org_id, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_team_updated_at ON tasks(team_id, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_projects_org_team ON projects(org_id, team_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_org_team_project_key
      ON projects(org_id, team_id, project_key)
      WHERE project_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_projects_org_team_work_domain
      ON projects(org_id, team_id, work_domain, lifecycle_state, id);
    CREATE INDEX IF NOT EXISTS idx_task_projects_org_task_id ON task_projects(org_id, task_id);
  `);
}

function seedEntityEngineeringProject(db: Database.Database): void {
  db.prepare(`
    INSERT INTO projects (
      org_id,
      team_id,
      name,
      color,
      lifecycle_state,
      project_key,
      work_domain,
      created_at
    )
    SELECT ?, ?, ?, NULL, 'active', ?, ?, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1
      FROM projects
      WHERE org_id = ?
        AND team_id = ?
        AND project_key = ?
    )
  `).run(
    DEFAULT_WORKSPACE_ORG_ID,
    DEFAULT_WORKSPACE_TEAM_ID,
    'Entity Engineering',
    'entity-engineering',
    'engineering',
    DEFAULT_WORKSPACE_ORG_ID,
    DEFAULT_WORKSPACE_TEAM_ID,
    'entity-engineering',
  );
}

function openEntityDatabase(): Database.Database {
  return getEntityDatabase((db) => {
    bootstrap(db);
    ensureTaskSchema(db);
    ensureWorkspaceScopeSchema(db);
    seedEntityEngineeringProject(db);
  });
}

const TASK_BACKFILL_VERSION = 'THE-87';

type TaskBackfillRow = Record<string, unknown> & {
  id: number;
  name?: string;
  org_id?: string | null;
  team_id?: string | null;
  project_id?: number | null;
  linked_project_id?: number | null;
  linked_project_org_id?: string | null;
  linked_project_team_id?: string | null;
  created_by_principal_id?: string | null;
  initiator_principal_id?: string | null;
  initiator_type?: string | null;
  owner_principal_id?: string | null;
  owner_principal_type?: string | null;
  executor_principal_id?: string | null;
  assignment_state?: string | null;
  taskmaster_drivable?: number | boolean | string | null;
  column?: string | null;
  assignee?: string | null;
  metadata?: string | null;
};

function isLegacyPrincipalMarker(value: unknown, markers: readonly string[]): boolean {
  const normalized = normalizeBlockerReason(value)?.toLowerCase();
  return !normalized || markers.includes(normalized);
}

function isAssignablePrincipal(value: unknown): string | null {
  const normalized = normalizeBlockerReason(value);
  if (!normalized) {
    return null;
  }

  const lowered = normalized.toLowerCase();
  if (lowered === 'unassigned' || lowered === 'none' || lowered === 'unknown') {
    return null;
  }

  return normalized;
}

function isBackfillExecutableColumn(value: unknown): boolean {
  const column = normalizeBlockerReason(value)?.toLowerCase();
  return column === 'todo' || column === 'doing' || column === 'review';
}

function parseTaskMetadataForBackfill(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function pushBackfillField(
  target: TaskBackfillInferredField[],
  taskId: number,
  field_name: TaskBackfillInferredField['field_name'],
  inferred_value: TaskBackfillInferredField['inferred_value'],
  previous_value: TaskBackfillInferredField['previous_value'],
  source: TaskBackfillInferredField['source'],
  confidence: TaskBackfillConfidence
): void {
  target.push({
    task_id: taskId,
    field_name,
    inferred_value,
    previous_value,
    source,
    confidence,
  });
}

function pushBackfillWarning(
  target: TaskBackfillWarning[],
  taskId: number,
  code: TaskBackfillWarningCode,
  message: string,
  severity: TaskBackfillWarning['severity']
): void {
  target.push({
    task_id: taskId,
    code,
    message,
    severity,
  });
}

function renderTaskBackfillMarkdown(report: Omit<TaskHierarchyBackfillReport, 'markdown'>): string {
  const lines = [
    '# THE-87 Task Hierarchy/Accountability Backfill Report',
    '',
    `- Mode: ${report.dryRun ? 'dry-run' : 'apply'}`,
    `- Total tasks scanned: ${report.totalTasks}`,
    `- Tasks needing update: ${report.tasksNeedingUpdate}`,
    `- Inferred fields: ${report.fieldsInferred}`,
    `- Cleanup warnings: ${report.cleanupWarnings}`,
    '',
    '## Sample Results',
  ];

  const sample = report.taskResults.filter((result) => result.would_update || result.warnings.length > 0).slice(0, 5);
  if (sample.length === 0) {
    lines.push('- No backfill updates or cleanup warnings detected.');
  } else {
    for (const result of sample) {
      lines.push(`- Task ${result.task_id} (${result.title}): ${result.inferred_fields.length} inferred field(s), ${result.warnings.length} warning(s), applied=${result.applied}`);
      for (const field of result.inferred_fields.slice(0, 5)) {
        lines.push(
          `  - ${field.field_name}: ${String(field.previous_value)} -> ${String(field.inferred_value)} (source=${field.source}, confidence=${field.confidence})`
        );
      }
    }
  }

  lines.push('', '## Rollback / Non-Destructive Notes', ...report.rollbackNotes.map((note) => `- ${note}`));
  return `${lines.join('\n')}\n`;
}

export function backfillTaskHierarchyAndAccountability(
  options: TaskHierarchyBackfillOptions = {}
): TaskHierarchyBackfillReport {
  const dryRun = options.dryRun !== false;
  const db = options.db ?? getEntityDatabase();
  const limit = typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  const rows = db.prepare(`
    SELECT
      t.*,
      (
        SELECT p.id
        FROM task_projects tp
        INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tp.org_id
        WHERE tp.task_id = t.id
        ORDER BY p.id ASC
        LIMIT 1
      ) AS linked_project_id,
      (
        SELECT p.org_id
        FROM task_projects tp
        INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tp.org_id
        WHERE tp.task_id = t.id
        ORDER BY p.id ASC
        LIMIT 1
      ) AS linked_project_org_id,
      (
        SELECT p.team_id
        FROM task_projects tp
        INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tp.org_id
        WHERE tp.task_id = t.id
        ORDER BY p.id ASC
        LIMIT 1
      ) AS linked_project_team_id
    FROM tasks t
    ORDER BY t.id ASC
    ${limit ? 'LIMIT ?' : ''}
  `).all(...(limit ? [limit] : [])) as TaskBackfillRow[];

  const updateStmt = db.prepare(`
    UPDATE tasks
    SET
      org_id = COALESCE(?, org_id),
      team_id = COALESCE(?, team_id),
      project_id = COALESCE(?, project_id),
      initiator_principal_id = COALESCE(?, initiator_principal_id),
      initiator_type = COALESCE(?, initiator_type),
      owner_principal_id = COALESCE(?, owner_principal_id),
      owner_principal_type = COALESCE(?, owner_principal_type),
      assignment_state = COALESCE(?, assignment_state),
      metadata = COALESCE(?, metadata),
      updated_at = CASE
        WHEN ? = 1 THEN CURRENT_TIMESTAMP
        ELSE updated_at
      END
    WHERE id = ?
  `);

  const taskResults: TaskBackfillTaskResult[] = [];

  const applyOne = (row: TaskBackfillRow): void => {
    const taskId = Number(row.id);
    const inferredFields: TaskBackfillInferredField[] = [];
    const warnings: TaskBackfillWarning[] = [];
    const updates: Partial<Record<TaskBackfillInferredField['field_name'], string | number | null>> = {};
    const metadata = parseTaskMetadataForBackfill(row.metadata);
    const correctedFields = migrationCleanupCorrectedFields(metadata);
    const linkedProjectId = normalizePositiveInteger(row.linked_project_id);
    const linkedProjectOrgId = normalizeBlockerReason(row.linked_project_org_id);
    const linkedProjectTeamId = normalizeBlockerReason(row.linked_project_team_id);
    const currentProjectId = normalizePositiveInteger(row.project_id);

    if (!normalizeBlockerReason(row.org_id) && linkedProjectOrgId) {
      updates.org_id = linkedProjectOrgId;
      pushBackfillField(inferredFields, taskId, 'org_id', linkedProjectOrgId, row.org_id ?? null, 'project_link', 'high');
    }

    if (!correctedFields.has('team_id') && !normalizeBlockerReason(row.team_id) && linkedProjectTeamId) {
      updates.team_id = linkedProjectTeamId;
      pushBackfillField(inferredFields, taskId, 'team_id', linkedProjectTeamId, row.team_id ?? null, 'project_link', 'high');
    }

    if (!correctedFields.has('project_id') && !currentProjectId && linkedProjectId) {
      updates.project_id = linkedProjectId;
      pushBackfillField(inferredFields, taskId, 'project_id', linkedProjectId, row.project_id ?? null, 'project_link', 'high');
    } else if (!currentProjectId && !correctedFields.has('project_id')) {
      pushBackfillWarning(
        warnings,
        taskId,
        'missing_project',
        'No linked project could be inferred; leave project cleanup explicit.',
        'warning'
      );
    }

    if (!correctedFields.has('initiator_principal_id') && isLegacyPrincipalMarker(row.initiator_principal_id, ['legacy-unknown', 'unknown'])) {
      const createdBy = isAssignablePrincipal(row.created_by_principal_id);
      if (createdBy && !isLegacyPrincipalMarker(createdBy, ['legacy-system', 'system', 'unknown'])) {
        updates.initiator_principal_id = createdBy;
        updates.initiator_type = 'human';
        pushBackfillField(
          inferredFields,
          taskId,
          'initiator_principal_id',
          createdBy,
          row.initiator_principal_id ?? null,
          'created_by',
          'medium'
        );
        pushBackfillField(inferredFields, taskId, 'initiator_type', 'human', row.initiator_type ?? null, 'created_by', 'medium');
      } else {
        pushBackfillWarning(
          warnings,
          taskId,
          'unknown_initiator',
          'No non-legacy initiator source is available; keep initiator as cleanup work.',
          'warning'
        );
      }
    }

    if (!correctedFields.has('owner_principal_id') && isLegacyPrincipalMarker(row.owner_principal_id, ['legacy-owner', 'unknown'])) {
      const assignee = isAssignablePrincipal(row.assignee);
      if (assignee) {
        updates.owner_principal_id = assignee;
        updates.owner_principal_type = 'human';
        pushBackfillField(inferredFields, taskId, 'owner_principal_id', assignee, row.owner_principal_id ?? null, 'assignee', 'medium');
        pushBackfillField(
          inferredFields,
          taskId,
          'owner_principal_type',
          'human',
          row.owner_principal_type ?? null,
          'assignee',
          'medium'
        );
      } else {
        pushBackfillWarning(
          warnings,
          taskId,
          'missing_owner',
          'No individual owner can be inferred without fabricating certainty.',
          'blocking_for_execution'
        );
      }
    }

    if (
      !normalizeBlockerReason(row.assignment_state) ||
      normalizeBlockerReason(row.assignment_state)?.toLowerCase() === 'unassigned'
    ) {
      const assignee = isAssignablePrincipal(row.assignee);
      const executor = isAssignablePrincipal(row.executor_principal_id);
      if (assignee || executor) {
        updates.assignment_state = 'assigned';
        pushBackfillField(
          inferredFields,
          taskId,
          'assignment_state',
          'assigned',
          row.assignment_state ?? null,
          'task_state',
          'medium'
        );
      }
    }

    if (
      !correctedFields.has('assignee') &&
      !correctedFields.has('executor_principal_id') &&
      isBackfillExecutableColumn(row.column) &&
      !isAssignablePrincipal(row.assignee) &&
      !isAssignablePrincipal(row.executor_principal_id) &&
      !normalizeBlocked(row.taskmaster_drivable)
    ) {
      pushBackfillWarning(
        warnings,
        taskId,
        'missing_assignee',
        'Executable task has no individual assignee/executor and is not marked Task-Master-drivable.',
        'blocking_for_execution'
      );
    }

    const existingBackfill = metadata.phase2_backfill as { version?: unknown } | undefined;
    const nextBackfill = {
      version: TASK_BACKFILL_VERSION,
      inferred_fields: inferredFields.map(({ task_id: _taskId, ...field }) => field),
      warnings: warnings.map(({ task_id: _taskId, ...warning }) => warning),
    };
    const nextMetadata =
      existingBackfill?.version === TASK_BACKFILL_VERSION && inferredFields.length === 0
        ? undefined
        : JSON.stringify({
            ...metadata,
            phase2_backfill: nextBackfill,
          });
    const hasFieldUpdates = Object.keys(updates).length > 0;
    const wouldUpdate = hasFieldUpdates || Boolean(nextMetadata);

    if (!dryRun && wouldUpdate) {
      updateStmt.run(
        updates.org_id ?? null,
        updates.team_id ?? null,
        updates.project_id ?? null,
        updates.initiator_principal_id ?? null,
        updates.initiator_type ?? null,
        updates.owner_principal_id ?? null,
        updates.owner_principal_type ?? null,
        updates.assignment_state ?? null,
        nextMetadata ?? null,
        hasFieldUpdates ? 1 : 0,
        taskId
      );
    }

    taskResults.push({
      task_id: taskId,
      title: String(row.name ?? ''),
      inferred_fields: inferredFields,
      warnings,
      would_update: wouldUpdate,
      applied: !dryRun && wouldUpdate,
    });
  };

  const transaction = db.transaction(() => {
    for (const row of rows) {
      applyOne(row);
    }
  });

  if (dryRun) {
    for (const row of rows) {
      applyOne(row);
    }
  } else {
    transaction();
  }

  const reportBase: Omit<TaskHierarchyBackfillReport, 'markdown'> = {
    dryRun,
    totalTasks: rows.length,
    tasksNeedingUpdate: taskResults.filter((result) => result.would_update).length,
    fieldsInferred: taskResults.reduce((sum, result) => sum + result.inferred_fields.length, 0),
    cleanupWarnings: taskResults.reduce((sum, result) => sum + result.warnings.length, 0),
    taskResults,
    rollbackNotes: [
      'Dry-run mode performs no writes.',
      'Apply mode only updates task hierarchy/accountability columns when a conservative source exists.',
      'Unresolved owner, initiator, project, or assignee data is recorded as cleanup warnings instead of fabricated values.',
      'Applied inferences are recorded in tasks.metadata.phase2_backfill with previous_value, inferred_value, source, and confidence.',
      'Rollback is manual and narrow: use the saved report to restore only the listed previous_value fields for affected task IDs, then remove or supersede the phase2_backfill audit entry.',
    ],
  };

  return {
    ...reportBase,
    markdown: renderTaskBackfillMarkdown(reportBase),
  };
}

function parseActivityMetadataForBackfill(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseActivityPayloadForBackfill(value: unknown): {
  payload: Record<string, unknown>;
  malformed: boolean;
} {
  if (typeof value !== 'string' || !value.trim()) {
    return { payload: {}, malformed: false };
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { payload: parsed as Record<string, unknown>, malformed: false }
      : { payload: {}, malformed: true };
  } catch {
    return { payload: {}, malformed: true };
  }
}

function pushActivityBackfillField(
  target: ActivityBackfillInferredField[],
  activityId: number,
  field_name: ActivityBackfillInferredField['field_name'],
  inferred_value: ActivityBackfillInferredField['inferred_value'],
  source: ActivityBackfillInferredField['source'],
  confidence: ActivityBackfillConfidence
): void {
  target.push({
    activity_id: activityId,
    field_name,
    inferred_value,
    source,
    confidence,
  });
}

function pushActivityBackfillWarning(
  target: ActivityBackfillWarning[],
  activityId: number,
  code: ActivityBackfillWarningCode,
  message: string,
  severity: ActivityBackfillWarning['severity']
): void {
  target.push({
    activity_id: activityId,
    code,
    message,
    severity,
  });
}

function buildActivityBackfillProjection(row: Record<string, unknown>): {
  legacyTypeLabel: string;
  eventType: ActivityEventType;
  schemaStatus: ActivityEventSchemaStatus;
  legacyType: string | null;
  payloadJson: string;
  confidence: ActivityBackfillConfidence;
  source: ActivityBackfillInferredField['source'];
  taskId: number | null;
  malformedPayload: boolean;
} {
  const activityId = Number(row.id);
  const rawLegacyType = normalizeBlockerReason(row.type) ?? 'unknown';
  const knownLegacyType = isKnownLegacyActivityType(rawLegacyType)
    ? rawLegacyType.trim().toLowerCase() as ActivityType
    : null;
  const taskId = normalizePositiveInteger(row.task_id);
  const agentName = normalizeBlockerReason(row.agent_name);
  const action = String(row.action ?? '');
  const description = String(row.description ?? '');
  const parsedPayload = parseActivityPayloadForBackfill(row.activity_event_payload_json);
  const normalizedExplicitEventType = normalizeActivityEventType(row.activity_event_type);

  if (normalizedExplicitEventType) {
    const payload = normalizeActivityEventPayload({
      value: parsedPayload.payload,
      type: knownLegacyType ?? 'message_sent',
      action,
      description,
      taskId,
      agentName,
    });
    return {
      legacyTypeLabel: rawLegacyType,
      eventType: normalizedExplicitEventType,
      schemaStatus: normalizeActivityEventSchemaStatus(row.activity_event_schema_status),
      legacyType: null,
      payloadJson: JSON.stringify(payload),
      confidence: 'high',
      source: 'explicit_activity_event',
      taskId,
      malformedPayload: parsedPayload.malformed,
    };
  }

  if (!knownLegacyType) {
    const payload = normalizeActivityEventPayload({
      value: parsedPayload.payload,
      type: 'message_sent',
      action,
      description,
      taskId,
      agentName,
    });
    payload.legacy = {
      source_type: rawLegacyType,
      action,
      description,
    };
    return {
      legacyTypeLabel: rawLegacyType,
      eventType: 'legacy_event_observed',
      schemaStatus: 'legacy_unknown',
      legacyType: rawLegacyType,
      payloadJson: JSON.stringify(payload),
      confidence: 'unknown',
      source: 'legacy_row',
      taskId,
      malformedPayload: parsedPayload.malformed,
    };
  }

  const projected = buildActivityEventProjection({
    legacyType: knownLegacyType,
    explicitEventType: undefined,
    explicitSchemaStatus: undefined,
    payload: parsedPayload.payload,
    action,
    description,
    taskId,
    agentName,
  });
  const eventType = projected.activity_event_type;
  const confidence: ActivityBackfillConfidence = eventType === 'legacy_event_observed' ? 'low' : 'high';
  return {
    legacyTypeLabel: knownLegacyType,
    eventType,
    schemaStatus: eventType === 'legacy_event_observed' ? 'legacy_unknown' : 'legacy_mapped',
    legacyType: eventType === 'legacy_event_observed' ? knownLegacyType : null,
    payloadJson: projected.activity_event_payload_json,
    confidence,
    source: 'legacy_activity_type',
    taskId,
    malformedPayload: parsedPayload.malformed,
  };
}

function renderActivityBackfillMarkdown(report: Omit<ActivityEventBackfillReport, 'markdown'>): string {
  const lines = [
    '# THE-33 ActivityEvent Progressive Backfill Report',
    '',
    `- Mode: ${report.dryRun ? 'dry-run' : 'apply'}`,
    `- Total activities scanned: ${report.totalActivities}`,
    `- Activities needing update: ${report.activitiesNeedingUpdate}`,
    `- Events mapped: ${report.eventsMapped}`,
    `- Legacy/weak events flagged: ${report.legacyUnknown}`,
    `- Cleanup warnings: ${report.cleanupWarnings}`,
    '',
    '## Sample Results',
  ];

  const sample = report.activityResults
    .filter((result) => result.would_update || result.warnings.length > 0)
    .slice(0, 5);
  if (sample.length === 0) {
    lines.push('- No ActivityEvent backfill updates or cleanup warnings detected.');
  } else {
    for (const result of sample) {
      lines.push(
        `- Activity ${result.activity_id} (${result.legacy_type} -> ${result.event_type}): confidence=${result.confidence}, warnings=${result.warnings.length}, applied=${result.applied}`
      );
    }
  }

  lines.push('', '## Rollback / Non-Destructive Notes', ...report.rollbackNotes.map((note) => `- ${note}`));
  return `${lines.join('\n')}\n`;
}

export function backfillActivityEventsProgressively(
  options: ActivityEventBackfillOptions = {}
): ActivityEventBackfillReport {
  const dryRun = options.dryRun !== false;
  const db = options.db ?? getEntityDatabase();
  const limit = typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  const rows = db.prepare(`
    SELECT *
    FROM activities
    ORDER BY id ASC
    ${limit ? 'LIMIT ?' : ''}
  `).all(...(limit ? [limit] : [])) as Array<Record<string, unknown>>;

  const updateStmt = db.prepare(`
    UPDATE activities
    SET
      activity_event_type = ?,
      activity_event_payload_version = ?,
      activity_event_payload_json = ?,
      activity_event_schema_status = ?,
      activity_event_legacy_type = ?,
      metadata = ?
    WHERE id = ?
  `);

  const activityResults: ActivityBackfillActivityResult[] = [];

  const applyOne = (row: Record<string, unknown>): void => {
    const activityId = Number(row.id);
    const inferredFields: ActivityBackfillInferredField[] = [];
    const warnings: ActivityBackfillWarning[] = [];
    const projection = buildActivityBackfillProjection(row);
    const currentEventType = normalizeActivityEventType(row.activity_event_type);
    const currentSchemaStatus = normalizeActivityEventSchemaStatus(row.activity_event_schema_status);
    const currentPayload = typeof row.activity_event_payload_json === 'string' ? row.activity_event_payload_json : '';
    const currentLegacyType = row.activity_event_legacy_type === null || typeof row.activity_event_legacy_type === 'undefined'
      ? null
      : String(row.activity_event_legacy_type);
    const alreadyStructured =
      currentEventType !== null &&
      currentSchemaStatus === 'structured' &&
      !projection.malformedPayload;

    if (projection.malformedPayload) {
      pushActivityBackfillWarning(
        warnings,
        activityId,
        'malformed_payload',
        'Existing activity payload could not be parsed; backfill stores a normalized payload with legacy provenance.',
        'warning'
      );
    }
    if (projection.eventType === 'legacy_event_observed') {
      pushActivityBackfillWarning(
        warnings,
        activityId,
        'legacy_event_unknown',
        'Legacy activity type has no confident ActivityEvent mapping and remains explicitly weak.',
        'warning'
      );
    }
    if (projection.taskId === null) {
      pushActivityBackfillWarning(
        warnings,
        activityId,
        'missing_task_link',
        'Activity has no task link; keep it visible but do not attach fabricated task provenance.',
        'info'
      );
    }

    if (!alreadyStructured && currentEventType !== projection.eventType) {
      pushActivityBackfillField(
        inferredFields,
        activityId,
        'activity_event_type',
        projection.eventType,
        projection.source,
        projection.confidence
      );
    }
    if (!alreadyStructured && currentPayload !== projection.payloadJson) {
      pushActivityBackfillField(
        inferredFields,
        activityId,
        'activity_event_payload_json',
        projection.payloadJson,
        projection.malformedPayload ? 'payload_json' : projection.source,
        projection.confidence
      );
    }
    if (!alreadyStructured && currentSchemaStatus !== projection.schemaStatus) {
      pushActivityBackfillField(
        inferredFields,
        activityId,
        'activity_event_schema_status',
        projection.schemaStatus,
        projection.source,
        projection.confidence
      );
    }
    if (!alreadyStructured && currentLegacyType !== projection.legacyType) {
      pushActivityBackfillField(
        inferredFields,
        activityId,
        'activity_event_legacy_type',
        projection.legacyType,
        projection.source,
        projection.confidence
      );
    }

    const metadata = parseActivityMetadataForBackfill(row.metadata);
    const existingBackfill = metadata.phase2_activity_event_backfill as { version?: unknown } | undefined;
    const shouldRecordAudit =
      !alreadyStructured &&
      (inferredFields.length > 0 || warnings.length > 0 || existingBackfill?.version !== 'THE-33');
    const nextMetadata = shouldRecordAudit
      ? JSON.stringify({
          ...metadata,
          phase2_activity_event_backfill: {
            version: 'THE-33',
            confidence: projection.confidence,
            inferred_fields: inferredFields.map(({ activity_id: _activityId, ...field }) => field),
            warnings: warnings.map(({ activity_id: _activityId, ...warning }) => warning),
          },
        })
      : undefined;
    const wouldUpdate = inferredFields.length > 0 || Boolean(nextMetadata);

    if (!dryRun && wouldUpdate) {
      updateStmt.run(
        projection.eventType,
        ACTIVITY_EVENT_PAYLOAD_VERSION,
        projection.payloadJson,
        projection.schemaStatus,
        projection.legacyType,
        nextMetadata ?? (typeof row.metadata === 'string' ? row.metadata : null),
        activityId
      );
    }

    activityResults.push({
      activity_id: activityId,
      task_id: projection.taskId,
      legacy_type: projection.legacyTypeLabel,
      event_type: projection.eventType,
      schema_status: projection.schemaStatus,
      confidence: projection.confidence,
      inferred_fields: inferredFields,
      warnings,
      would_update: wouldUpdate,
      applied: !dryRun && wouldUpdate,
    });
  };

  const transaction = db.transaction(() => {
    for (const row of rows) {
      applyOne(row);
    }
  });

  if (dryRun) {
    for (const row of rows) {
      applyOne(row);
    }
  } else {
    transaction();
  }

  const reportBase: Omit<ActivityEventBackfillReport, 'markdown'> = {
    dryRun,
    totalActivities: rows.length,
    activitiesNeedingUpdate: activityResults.filter((result) => result.would_update).length,
    eventsMapped: activityResults.filter((result) => result.schema_status === 'legacy_mapped').length,
    legacyUnknown: activityResults.filter((result) => result.schema_status === 'legacy_unknown').length,
    cleanupWarnings: activityResults.reduce((sum, result) => sum + result.warnings.length, 0),
    activityResults,
    rollbackNotes: [
      'Dry-run mode performs no writes.',
      'Apply mode updates only ActivityEvent projection columns and metadata audit fields on existing activity rows.',
      'Weak or unknown legacy events remain visible with legacy_unknown status and warnings instead of being rewritten as certain structured history.',
      'Re-running apply is idempotent once the THE-33 projection and metadata audit are present.',
    ],
  };

  return {
    ...reportBase,
    markdown: renderActivityBackfillMarkdown(reportBase),
  };
}

function iterateSourceRows(source: Database.Database): IterableIterator<SourceTaskRow> {
  const supportsArchived = hasColumn(source, 'tasks', 'archived');
  const supportsBlocked = hasColumn(source, 'tasks', 'blocked');
  const supportsBlockerReason = hasColumn(source, 'tasks', 'blocker_reason');
  const whereClause = supportsArchived ? 'WHERE archived = 0' : '';

  const query = `
    SELECT
      id,
      name,
      description,
      "column" AS task_column,
      assignee,
      ${supportsBlocked ? 'blocked' : '0 AS blocked'},
      ${supportsBlockerReason ? 'blocker_reason' : 'NULL AS blocker_reason'},
      created_at,
      updated_at
    FROM tasks
    ${whereClause}
    ORDER BY id ASC
  `;

  return source.prepare(query).iterate() as IterableIterator<SourceTaskRow>;
}

let missionControlSeeded = false;

function seedFromMissionControl(target: Database.Database): void {
  if (missionControlSeeded) {
    return;
  }

  const existing = target.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number };
  const sourcePath = resolveMissionControlDbPath();
  if (!fs.existsSync(sourcePath)) {
    missionControlSeeded = true;
    return;
  }

  const source = new Database(sourcePath, { readonly: true });

  try {
    const insert = target.prepare(`
      INSERT OR IGNORE INTO tasks (
        id,
        name,
        description,
        column,
        assignee,
        blocked,
        blocker_reason,
        created_at,
        updated_at,
        metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const backfillBlocked = target.prepare(`
      UPDATE tasks
      SET blocked = 1, blocker_reason = COALESCE(?, blocker_reason)
      WHERE id = ? AND (blocked IS NULL OR blocked = 0)
    `);
    const backfillReason = target.prepare(`
      UPDATE tasks
      SET blocker_reason = ?
      WHERE id = ? AND (blocker_reason IS NULL OR blocker_reason = '')
    `);

    const syncRows = target.transaction((sourceRows: readonly SourceTaskRow[]) => {
      for (const row of sourceRows) {
        const createdAt = normalizeTimestamp(row.created_at);
        const updatedAt = normalizeTimestamp(row.updated_at ?? row.created_at);
        const blocked = normalizeBlocked(row.blocked);
        const blockerReason = normalizeBlockerReason(row.blocker_reason);

        if (existing.count === 0) {
          insert.run(
            row.id,
            row.name,
            row.description,
            normalizeTaskColumn(row.task_column),
            row.assignee ?? 'Unassigned',
            blocked ? 1 : 0,
            blockerReason,
            createdAt,
            updatedAt,
            '{}'
          );
          continue;
        }

        if (blocked) {
          backfillBlocked.run(blockerReason, row.id);
        } else if (blockerReason) {
          backfillReason.run(blockerReason, row.id);
        }
      }
    });

    const batch: SourceTaskRow[] = [];
    const batchSize = 500;
    for (const row of iterateSourceRows(source)) {
      batch.push(row);
      if (batch.length >= batchSize) {
        syncRows(batch);
        batch.length = 0;
      }
    }

    if (batch.length > 0) {
      syncRows(batch);
    }
  } finally {
    source.close();
    missionControlSeeded = true;
  }
}

function mapTaskRow(row: Record<string, unknown>): TaskRecord {
  return {
    id: Number(row.id),
    org_id: normalizeWorkspaceId(row.org_id, DEFAULT_WORKSPACE_ORG_ID),
    team_id: normalizeWorkspaceId(row.team_id, DEFAULT_WORKSPACE_TEAM_ID),
    project_id: normalizePositiveInteger(row.project_id),
    created_by_principal_id: normalizeBlockerReason(row.created_by_principal_id) ?? 'legacy-system',
    initiator_principal_id: normalizeBlockerReason(row.initiator_principal_id) ?? 'legacy-unknown',
    initiator_type: normalizeBlockerReason(row.initiator_type) ?? 'unknown',
    owner_principal_id: normalizeBlockerReason(row.owner_principal_id) ?? 'legacy-owner',
    owner_principal_type: normalizeBlockerReason(row.owner_principal_type) ?? 'unknown',
    executor_principal_id: normalizeBlockerReason(row.executor_principal_id),
    assignment_state: normalizeBlockerReason(row.assignment_state) ?? 'unassigned',
    taskmaster_drivable: normalizeBlocked(row.taskmaster_drivable),
    worktype: normalizeBlockerReason(row.worktype) ?? 'general',
    risk_level: normalizePolicyRiskLevel(row.risk_level),
    agent_trust_level: normalizeAgentTrustLevel(row.agent_trust_level),
    policy_inputs_json: normalizeJsonObjectString(row.policy_inputs_json),
    external_side_effects_json: normalizeExternalSideEffectsJson(row.external_side_effects_json),
    external_side_effects: parseExternalSideEffects(row.external_side_effects_json),
    review_required: normalizeBlocked(row.review_required),
    review_state: normalizeReviewPolicyState(row.review_state, normalizeBlocked(row.review_required)),
    human_gate_required: normalizeBlocked(row.human_gate_required),
    human_gate_state: normalizeHumanGatePolicyState(row.human_gate_state, normalizeBlocked(row.human_gate_required)),
    name: String(row.name ?? ''),
    description: row.description === null ? null : String(row.description ?? ''),
    brief: row.brief === null ? null : String(row.brief ?? ''),
    origin_channel: row.origin_channel === null ? null : String(row.origin_channel ?? ''),
    column: normalizeTaskColumn(String(row.column ?? 'backlog')),
    model: normalizeBlockerReason(row.model),
    archived: normalizeBlocked(row.archived),
    assignee: row.assignee === null ? null : String(row.assignee ?? 'Unassigned'),
    blocked: normalizeBlocked(row.blocked),
    blocker_reason: normalizeBlockerReason(row.blocker_reason),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? row.created_at ?? '')),
    metadata: row.metadata === null ? null : String(row.metadata ?? '{}'),
    project: normalizeBlockerReason(row.project) ?? 'General',
    due_date: normalizeBlockerReason(row.due_date),
    priority:
      row.priority === null ? null : typeof row.priority === 'undefined' ? 'P2' : String(row.priority ?? 'P2'),
    estimate_hours: normalizeNullableNumber(row.estimate_hours),
    time_spent: normalizeNullableNumber(row.time_spent),
    output: normalizeBlockerReason(row.output),
    progress_status:
      row.progress_status === null
        ? null
        : typeof row.progress_status === 'undefined'
          ? 'backlog'
          : String(row.progress_status ?? 'backlog'),
    recurring: normalizeBlocked(row.recurring),
    recurring_config: normalizeBlockerReason(row.recurring_config),
  };
}

function normalizeActivitySource(value: unknown): ActivitySource {
  return value === 'task' ? 'task' : 'agent';
}

function normalizeActivityType(value: unknown): ActivityType {
  if (typeof value !== 'string') {
    return 'message_sent';
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'file_edit':
    case 'tool_call':
    case 'message_sent':
    case 'command_run':
    case 'research':
    case 'thinking':
    case 'task_created':
    case 'task_updated':
    case 'task_moved':
    case 'task_completed':
    case 'task_deleted':
    case 'task_comment':
      return normalized;
    default:
      return 'message_sent';
  }
}

function isKnownLegacyActivityType(value: unknown): value is ActivityType {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'file_edit':
    case 'tool_call':
    case 'message_sent':
    case 'command_run':
    case 'research':
    case 'thinking':
    case 'task_created':
    case 'task_updated':
    case 'task_moved':
    case 'task_completed':
    case 'task_deleted':
    case 'task_comment':
      return true;
    default:
      return false;
  }
}

function isActivityEventType(value: string): value is ActivityEventType {
  return (ACTIVITY_EVENT_TYPES as readonly string[]).includes(value);
}

function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

function normalizeActivityEventType(value: unknown): ActivityEventType | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return isActivityEventType(normalized) ? normalized : null;
}

function normalizeNotificationType(value: unknown): NotificationType {
  if (typeof value !== 'string') {
    throw new Error('notification_type is required');
  }

  const normalized = value.trim().toLowerCase();
  if (!isNotificationType(normalized)) {
    throw new Error(`notification_type must be one of ${NOTIFICATION_TYPES.join(', ')}`);
  }

  return normalized;
}

function normalizeNotificationInboxState(value: unknown): NotificationInboxState {
  if (value === 'read' || value === 'archived') {
    return value;
  }
  return 'unread';
}

function normalizeNotificationDeliveryChannel(value: unknown): NotificationDeliveryChannel {
  if (typeof value !== 'string') {
    return 'other';
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'entity_inbox':
    case 'clickclack':
    case 'email':
    case 'discord':
    case 'slack':
    case 'agentpush':
    case 'webhook':
    case 'other':
      return normalized;
    default:
      return 'other';
  }
}

function normalizeNotificationDeliveryStatus(value: unknown): NotificationDeliveryStatus {
  if (value === 'sent' || value === 'failed' || value === 'degraded' || value === 'skipped') {
    return value;
  }
  return 'pending';
}

function parseObjectRef(value: unknown): ObjectRef {
  const refs = normalizeObjectRefsJson(value);
  if (refs.length === 1) {
    return refs[0];
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return normalizeObjectRefs([parsed])[0];
      }
    } catch {
      // Fall through to explicit error below.
    }
  }
  return normalizeObjectRefs([value])[0];
}

function normalizeActivityEventSchemaStatus(value: unknown): ActivityEventSchemaStatus {
  if (value === 'structured' || value === 'legacy_unknown') {
    return value;
  }
  return 'legacy_mapped';
}

function legacyActivityTypeToEventType(type: ActivityType): ActivityEventType {
  switch (type) {
    case 'task_created':
      return 'task_created';
    case 'task_updated':
    case 'task_comment':
      return 'task_updated';
    case 'task_moved':
      return 'status_changed';
    case 'task_completed':
      return 'completion_accepted';
    case 'task_deleted':
      return 'task_cancelled';
    default:
      return 'legacy_event_observed';
  }
}

function parseActivityEventPayload(value: unknown): Partial<ActivityEventPayload> | Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  return typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeActivityEventPayload(input: {
  value?: Partial<ActivityEventPayload> | Record<string, unknown> | string | null;
  type: ActivityType;
  action: string;
  description: string;
  taskId: number | null;
  agentName: string | null;
}): ActivityEventPayload {
  const parsed = parseActivityEventPayload(input.value);
  const actorType = parsed.actor_type === 'human' || parsed.actor_type === 'system' || parsed.actor_type === 'workflow'
    ? parsed.actor_type
    : input.agentName
      ? 'agent'
      : 'unknown';

  return {
    ...parsed,
    version: ACTIVITY_EVENT_PAYLOAD_VERSION,
    actor_type: actorType,
    task_id: typeof parsed.task_id === 'number' && Number.isInteger(parsed.task_id)
      ? parsed.task_id
      : input.taskId ?? undefined,
    legacy: parsed.legacy && typeof parsed.legacy === 'object'
      ? parsed.legacy as ActivityEventPayload['legacy']
      : {
          source_type: input.type,
          action: input.action,
          description: input.description,
        },
  };
}

function buildActivityEventProjection(input: {
  legacyType: ActivityType;
  explicitEventType?: unknown;
  explicitSchemaStatus?: unknown;
  payload?: Partial<ActivityEventPayload> | Record<string, unknown> | string | null;
  action: string;
  description: string;
  taskId: number | null;
  agentName: string | null;
}): {
  activity_event_type: ActivityEventType;
  activity_event_payload_version: number;
  activity_event_payload_json: string;
  activity_event_schema_status: ActivityEventSchemaStatus;
  activity_event_legacy_type: string | null;
} {
  const normalizedExplicitEventType = normalizeActivityEventType(input.explicitEventType);
  const explicitWasInvalid = typeof input.explicitEventType === 'string' && !normalizedExplicitEventType;
  const eventType = normalizedExplicitEventType ?? legacyActivityTypeToEventType(input.legacyType);
  const fallbackStatus: ActivityEventSchemaStatus =
    normalizedExplicitEventType && !explicitWasInvalid
      ? 'structured'
      : eventType === 'legacy_event_observed'
        ? 'legacy_unknown'
        : 'legacy_mapped';
  const status = input.explicitSchemaStatus
    ? normalizeActivityEventSchemaStatus(input.explicitSchemaStatus)
    : fallbackStatus;
  const payload = normalizeActivityEventPayload({
    value: input.payload,
    type: input.legacyType,
    action: input.action,
    description: input.description,
    taskId: input.taskId,
    agentName: input.agentName,
  });

  return {
    activity_event_type: explicitWasInvalid ? 'legacy_event_observed' : eventType,
    activity_event_payload_version: ACTIVITY_EVENT_PAYLOAD_VERSION,
    activity_event_payload_json: JSON.stringify(payload),
    activity_event_schema_status: explicitWasInvalid ? 'legacy_unknown' : status,
    activity_event_legacy_type: explicitWasInvalid
      ? input.explicitEventType as string
      : eventType === 'legacy_event_observed'
        ? input.legacyType
        : null,
  };
}

function mapActivityRow(row: Record<string, unknown>): ActivityRecord {
  const rawTaskId = Number(row.task_id);
  const taskId = Number.isInteger(rawTaskId) ? rawTaskId : null;
  const legacyType = normalizeActivityType(row.type);
  const agentName = row.agent_name === null ? null : String(row.agent_name ?? '');
  const action = String(row.action ?? '');
  const description = String(row.description ?? '');
  const projectedEvent = buildActivityEventProjection({
    legacyType,
    explicitEventType: row.activity_event_type,
    explicitSchemaStatus: row.activity_event_schema_status,
    payload: typeof row.activity_event_payload_json === 'string' ? row.activity_event_payload_json : null,
    action,
    description,
    taskId,
    agentName,
  });

  return {
    id: Number(row.id),
    source: normalizeActivitySource(row.source),
    type: legacyType,
    activity_event_type: projectedEvent.activity_event_type,
    activity_event_payload_version: projectedEvent.activity_event_payload_version,
    activity_event_payload_json: projectedEvent.activity_event_payload_json,
    activity_event_schema_status: projectedEvent.activity_event_schema_status,
    activity_event_legacy_type:
      row.activity_event_legacy_type === null || typeof row.activity_event_legacy_type === 'undefined'
        ? projectedEvent.activity_event_legacy_type
        : String(row.activity_event_legacy_type),
    action,
    description,
    agent_name: agentName,
    agent_emoji: row.agent_emoji === null ? null : String(row.agent_emoji ?? ''),
    file_path: row.file_path === null ? null : String(row.file_path ?? ''),
    task_id: taskId,
    task_column: row.task_column === null ? null : String(row.task_column ?? ''),
    metadata: row.metadata === null ? null : String(row.metadata ?? ''),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
  };
}

function clampActivityLimit(limit: number): number {
  if (!Number.isInteger(limit)) {
    return 100;
  }

  if (limit < 1) {
    return 1;
  }

  if (limit > 500) {
    return 500;
  }

  return limit;
}

function normalizePolicyReasonChainString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return '[]';
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? JSON.stringify(parsed) : '[]';
  } catch {
    return '[]';
  }
}

function mapNotificationDeliveryRow(row: Record<string, unknown>): NotificationDeliveryRecord {
  return {
    id: Number(row.id),
    notification_id: String(row.notification_id),
    channel: normalizeNotificationDeliveryChannel(row.channel),
    status: normalizeNotificationDeliveryStatus(row.status),
    external_ref: normalizeBlockerReason(row.external_ref),
    failure_reason: normalizeBlockerReason(row.failure_reason),
    degraded_reason: normalizeBlockerReason(row.degraded_reason),
    policy_reason_json: normalizeJsonObjectString(row.policy_reason_json),
    attempted_at: normalizeTimestamp(String(row.attempted_at ?? '')),
    completed_at: normalizeNullableTimestamp(row.completed_at),
    metadata_json: normalizeJsonObjectString(row.metadata_json),
  };
}

function mapNotificationRow(
  row: Record<string, unknown>,
  deliveries: NotificationDeliveryRecord[] = []
): NotificationRecord {
  return {
    id: String(row.id),
    org_id: normalizeWorkspaceId(row.org_id, DEFAULT_WORKSPACE_ORG_ID),
    recipient_principal_id: String(row.recipient_principal_id),
    canonical_event_id: String(row.canonical_event_id),
    object_ref: parseObjectRef(row.object_ref_json),
    notification_type: normalizeNotificationType(row.notification_type),
    inbox_state: normalizeNotificationInboxState(row.inbox_state),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    policy_reason_chain_json: normalizePolicyReasonChainString(row.policy_reason_chain_json),
    metadata_json: normalizeJsonObjectString(row.metadata_json),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? '')),
    deliveries,
  };
}

function mapAgentLogRow(row: Record<string, unknown>): AgentLogRecord {
  const rawTaskId = Number(row.task_id);
  const rawTokensUsed = Number(row.tokens_used);
  return {
    id: Number(row.id),
    timestamp: normalizeTimestamp(String(row.timestamp ?? '')),
    event: String(row.event ?? ''),
    task_id: Number.isInteger(rawTaskId) ? rawTaskId : null,
    action: String(row.action ?? ''),
    result: normalizeBlockerReason(row.result),
    model: typeof row.model === 'string' && row.model.trim() ? row.model.trim() : 'gemini-flash',
    tokens_used: Number.isInteger(rawTokensUsed) && rawTokensUsed > 0 ? rawTokensUsed : 0,
  };
}

function clampAgentLogLimit(limit: number): number {
  if (!Number.isInteger(limit)) {
    return 100;
  }

  if (limit < 1) {
    return 1;
  }

  if (limit > 1000) {
    return 1000;
  }

  return limit;
}

function mapTaskCommentRow(row: Record<string, unknown>): TaskCommentRecord {
  const rawTaskId = Number(row.task_id);
  const rawParentId = Number(row.parent_id);
  return {
    id: Number(row.id),
    task_id: Number.isInteger(rawTaskId) ? rawTaskId : 0,
    body: String(row.body ?? ''),
    author: typeof row.author === 'string' && row.author.trim() ? row.author.trim() : 'Human',
    parent_id: Number.isInteger(rawParentId) && rawParentId > 0 ? rawParentId : null,
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
  };
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeEvidenceArtifactKind(value: unknown): EvidenceArtifactKind {
  return EVIDENCE_ARTIFACT_KINDS.includes(value as EvidenceArtifactKind)
    ? value as EvidenceArtifactKind
    : 'raw_task_receipt';
}

function normalizeEvidenceMutabilityPolicy(
  kind: EvidenceArtifactKind,
  value: unknown
): EvidenceArtifactMutabilityPolicy {
  const normalized = value === 'editable_versioned' ? 'editable_versioned' : 'immutable_append_only';
  if (kind === 'raw_task_receipt' && normalized !== 'immutable_append_only') {
    throw new Error('raw task receipt artifacts must be immutable_append_only');
  }
  return normalized;
}

function normalizeEvidenceIntegrityState(value: unknown): EvidenceArtifactIntegrityState {
  return value === 'missing_body' || value === 'hash_mismatch' || value === 'metadata_mismatch' || value === 'unknown'
    ? value
    : 'valid';
}

function normalizeEvidenceAvailabilityState(value: unknown): EvidenceArtifactAvailabilityState {
  return value === 'missing_body' || value === 'unavailable' || value === 'pending' || value === 'unknown'
    ? value
    : 'available';
}

function normalizeNativeDocumentKind(value: unknown): NativeDocumentKind {
  return value === 'note' ||
    value === 'spec' ||
    value === 'report' ||
    value === 'generated_markdown' ||
    value === 'fallback_doc'
    ? value
    : 'internal_doc';
}

function normalizeNativeDocumentMutability(value: unknown): NativeDocumentMutabilityPolicy {
  return value === 'immutable' ? 'immutable' : 'editable_versioned';
}

function normalizeNativeDocumentLifecycleState(value: unknown): NativeDocumentLifecycleState {
  return value === 'draft' || value === 'archived' || value === 'superseded' ? value : 'active';
}

function normalizeExternalConnectorType(value: unknown): ExternalDocumentConnectorType {
  return value === 'google_drive' || value === 'google_docs' ? value : 'other';
}

function normalizeExternalAuthState(value: unknown): ExternalDocumentAuthState {
  return value === 'authorized' ||
    value === 'unauthorized' ||
    value === 'expired' ||
    value === 'insufficient_scope' ||
    value === 'revoked'
    ? value
    : 'unknown';
}

function normalizeExternalReadinessState(value: unknown): ExternalDocumentReadinessState {
  return value === 'ready' || value === 'degraded' || value === 'unavailable' || value === 'not_configured' ? value : 'unknown';
}

function normalizeExternalRefState(value: unknown): ExternalDocumentRefState {
  return value === 'available' || value === 'permission_revoked' || value === 'deleted' ? value : 'unknown';
}

function normalizeExternalCanonicality(value: unknown): ExternalDocumentCanonicality {
  return value === 'external_canonical' || value === 'entity_reference_only' ? value : 'unknown';
}

function normalizeNullableTimestamp(value: unknown): string | null {
  const normalized = normalizeBlockerReason(value);
  return normalized ? normalizeTimestamp(normalized) : null;
}

function normalizeGoogleConnectorScopes(value: unknown): GoogleConnectorV1Scope[] {
  let raw: unknown = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  const allowed = new Set<string>(GOOGLE_CONNECTOR_V1_SCOPES);
  const scopes: GoogleConnectorV1Scope[] = [];
  for (const scope of raw) {
    if (typeof scope !== 'string' || !allowed.has(scope) || scopes.includes(scope as GoogleConnectorV1Scope)) {
      continue;
    }
    scopes.push(scope as GoogleConnectorV1Scope);
  }
  return scopes;
}

function stringifyGoogleConnectorScopes(value: unknown): string {
  return JSON.stringify(normalizeGoogleConnectorScopes(value));
}

function defaultExternalCapabilitiesJson(connectorType: ExternalDocumentConnectorType, value: unknown): string {
  const normalized = normalizeJsonObjectString(value);
  const base = normalized === '{}' ? {} : JSON.parse(normalized) as Record<string, unknown>;
  const readOnlyCapabilities = {
    read: base.read === false ? false : true,
    index: base.index === false ? false : true,
    link: base.link === false ? false : true,
    preview: base.preview === false ? false : true,
    write: false,
    export: false,
    sync: false,
    create: false,
    update: false,
  };
  if (connectorType === 'google_drive' || connectorType === 'google_docs') {
    return JSON.stringify(readOnlyCapabilities);
  }
  return JSON.stringify({ ...base, ...readOnlyCapabilities });
}

function mapNativeDocumentRow(row: Record<string, unknown>): NativeDocumentRecord {
  return {
    id: String(row.id ?? ''),
    org_id: normalizeWorkspaceId(row.org_id, DEFAULT_WORKSPACE_ORG_ID),
    team_id: normalizeBlockerReason(row.team_id),
    project_id: normalizePositiveInteger(row.project_id),
    title: String(row.title ?? ''),
    document_kind: normalizeNativeDocumentKind(row.document_kind),
    body_format: 'markdown',
    stable_path: String(row.stable_path ?? ''),
    content_hash: String(row.content_hash ?? ''),
    mutability_policy: normalizeNativeDocumentMutability(row.mutability_policy),
    version: normalizePositiveInteger(row.version) ?? 1,
    lifecycle_state: normalizeNativeDocumentLifecycleState(row.lifecycle_state),
    sensitivity: normalizeBlockerReason(row.sensitivity),
    acl_json: normalizeJsonObjectString(row.acl_json),
    linked_object_refs: normalizeObjectRefsJson(row.linked_object_refs_json),
    created_by_principal_id: normalizeBlockerReason(row.created_by_principal_id),
    metadata_json: normalizeJsonObjectString(row.metadata_json),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? row.created_at ?? '')),
  };
}

function mapNativeDocumentVersionRow(row: Record<string, unknown>): NativeDocumentVersionRecord {
  return {
    id: Number(row.id),
    document_id: String(row.document_id ?? ''),
    version: normalizePositiveInteger(row.version) ?? 1,
    stable_path: String(row.stable_path ?? ''),
    content_hash: String(row.content_hash ?? ''),
    metadata_json: normalizeJsonObjectString(row.metadata_json),
    created_by_principal_id: normalizeBlockerReason(row.created_by_principal_id),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
  };
}

function mapExternalDocumentRefRow(row: Record<string, unknown>): ExternalDocumentRefRecord {
  return {
    id: String(row.id ?? ''),
    org_id: normalizeWorkspaceId(row.org_id, DEFAULT_WORKSPACE_ORG_ID),
    connector_type: normalizeExternalConnectorType(row.connector_type),
    external_id: normalizeBlockerReason(row.external_id),
    external_url: normalizeBlockerReason(row.external_url),
    title: String(row.title ?? ''),
    external_mime_type: normalizeBlockerReason(row.external_mime_type),
    external_canonical_url: normalizeBlockerReason(row.external_canonical_url),
    auth_state: normalizeExternalAuthState(row.auth_state),
    readiness_state: normalizeExternalReadinessState(row.readiness_state),
    granted_scopes: normalizeGoogleConnectorScopes(row.granted_scopes_json),
    missing_scopes: normalizeGoogleConnectorScopes(row.missing_scopes_json),
    auth_expires_at: normalizeNullableTimestamp(row.auth_expires_at),
    external_ref_state: normalizeExternalRefState(row.external_ref_state),
    capabilities_json: defaultExternalCapabilitiesJson(normalizeExternalConnectorType(row.connector_type), row.capabilities_json),
    canonicality: normalizeExternalCanonicality(row.canonicality),
    last_indexed_at: normalizeNullableTimestamp(row.last_indexed_at),
    last_checked_at: normalizeNullableTimestamp(row.last_checked_at),
    entity_visibility_policy_json: normalizeJsonObjectString(row.entity_visibility_policy_json),
    external_permission_summary: normalizeBlockerReason(row.external_permission_summary),
    linked_object_refs: normalizeObjectRefsJson(row.linked_object_refs_json),
    metadata_json: normalizeJsonObjectString(row.metadata_json),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? row.created_at ?? '')),
  };
}

function mapEvidenceArtifactRow(row: Record<string, unknown>): EvidenceArtifactRecord {
  return {
    id: String(row.id ?? ''),
    org_id: normalizeWorkspaceId(row.org_id, DEFAULT_WORKSPACE_ORG_ID),
    team_id: normalizeBlockerReason(row.team_id),
    project_id: normalizePositiveInteger(row.project_id),
    artifact_kind: normalizeEvidenceArtifactKind(row.artifact_kind),
    title: String(row.title ?? ''),
    body_format: 'markdown',
    stable_path: String(row.stable_path ?? ''),
    human_path_alias: normalizeBlockerReason(row.human_path_alias),
    content_hash: String(row.content_hash ?? ''),
    mutability_policy: row.mutability_policy === 'editable_versioned' ? 'editable_versioned' : 'immutable_append_only',
    version: normalizePositiveInteger(row.version) ?? 1,
    origin_task_id: normalizePositiveInteger(row.origin_task_id),
    source_activity_event_ids: normalizeJsonNumberArray(parseJsonArray(row.source_activity_event_ids_json)),
    source_artifact_ids: normalizeJsonStringArray(parseJsonArray(row.source_artifact_ids_json)),
    linked_object_refs: normalizeObjectRefsJson(row.linked_object_refs_json),
    provenance_json: normalizeJsonObjectString(row.provenance_json),
    integrity_state: normalizeEvidenceIntegrityState(row.integrity_state),
    availability_state: normalizeEvidenceAvailabilityState(row.availability_state),
    created_by_principal_id: normalizeBlockerReason(row.created_by_principal_id),
    metadata_json: normalizeJsonObjectString(row.metadata_json),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? row.created_at ?? '')),
  };
}

function mapEvidenceArtifactVersionRow(row: Record<string, unknown>): EvidenceArtifactVersionRecord {
  return {
    id: Number(row.id),
    artifact_id: String(row.artifact_id ?? ''),
    version: normalizePositiveInteger(row.version) ?? 1,
    stable_path: String(row.stable_path ?? ''),
    content_hash: String(row.content_hash ?? ''),
    metadata_json: normalizeJsonObjectString(row.metadata_json),
    created_by_principal_id: normalizeBlockerReason(row.created_by_principal_id),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
  };
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function mapRoadmapRow(row: Record<string, unknown>): RoadmapRecord {
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    theme: normalizeBlockerReason(row.theme),
    color: normalizeBlockerReason(row.color),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
  };
}

function mapRoadmapItemRow(row: Record<string, unknown>): RoadmapItemRecord {
  const rawRoadmapId = Number(row.roadmap_id);
  return {
    id: Number(row.id),
    roadmap_id: Number.isInteger(rawRoadmapId) ? rawRoadmapId : 0,
    title: String(row.title ?? ''),
    description: normalizeBlockerReason(row.description),
    priority: typeof row.priority === 'string' && row.priority.trim() ? row.priority.trim() : 'P2',
    target_period: normalizeBlockerReason(row.target_period),
    status: typeof row.status === 'string' && row.status.trim() ? row.status.trim() : 'planned',
    linked_task_id: normalizePositiveInteger(row.linked_task_id),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
  };
}

function mapProjectRow(row: Record<string, unknown>): ProjectRecord {
  return {
    id: Number(row.id),
    org_id: normalizeWorkspaceId(row.org_id, DEFAULT_WORKSPACE_ORG_ID),
    team_id: normalizeWorkspaceId(row.team_id, DEFAULT_WORKSPACE_TEAM_ID),
    name: String(row.name ?? ''),
    color: normalizeBlockerReason(row.color),
    lifecycle_state: normalizeBlockerReason(row.lifecycle_state) ?? 'active',
    project_key: normalizeBlockerReason(row.project_key),
    work_domain: normalizeBlockerReason(row.work_domain),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
  };
}

function mapOrgRow(row: Record<string, unknown>): OrgRecord {
  return {
    id: normalizeWorkspaceId(row.id),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    status: String(row.status ?? 'active'),
    deployment_mode: String(row.deployment_mode ?? 'saas'),
    mission: normalizeBlockerReason(row.mission),
    domains_json: normalizeJsonArrayString(row.domains_json),
    blueprint_json: normalizeBlockerReason(row.blueprint_json),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? row.created_at ?? '')),
  };
}

function mapTeamRow(row: Record<string, unknown>): TeamRecord {
  return {
    id: normalizeWorkspaceId(row.id),
    org_id: normalizeWorkspaceId(row.org_id, DEFAULT_WORKSPACE_ORG_ID),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    status: String(row.status ?? 'active'),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? row.created_at ?? '')),
  };
}

function mapCrewRow(row: Record<string, unknown>): CrewRecord {
  return {
    id: typeof row.id === 'string' ? row.id : String(row.id ?? ''),
    name: String(row.name ?? ''),
    description: normalizeBlockerReason(row.description),
    settings: normalizeBlockerReason(row.settings),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? row.created_at ?? '')),
  };
}


function mapCrewSubscriptionRow(row: Record<string, unknown>): CrewSubscriptionRecord {
  return {
    id: Number(row.id),
    crew_id: String(row.crew_id ?? ""),
    agent_id: String(row.agent_id ?? ""),
    created_at: normalizeTimestamp(String(row.created_at ?? "")),
  };
}

function loadProjectsByTaskIds(db: Database.Database, taskIds: readonly number[]): Map<number, ProjectRecord[]> {
  const normalizedTaskIds = Array.from(
    new Set(taskIds.map((taskId) => normalizePositiveInteger(taskId)).filter((taskId): taskId is number => Boolean(taskId)))
  );

  if (normalizedTaskIds.length === 0) {
    return new Map();
  }

  const placeholders = normalizedTaskIds.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT
      tp.task_id,
      p.id,
      p.org_id,
      p.team_id,
      p.name,
      p.color,
      p.lifecycle_state,
      p.project_key,
      p.work_domain,
      p.created_at
    FROM task_projects tp
    INNER JOIN projects p ON p.id = tp.project_id
    WHERE tp.task_id IN (${placeholders})
    ORDER BY tp.task_id ASC, p.name COLLATE NOCASE ASC, p.id ASC
  `);
  const rows = stmt.all(...normalizedTaskIds) as Array<Record<string, unknown>>;
  const projectsByTaskId = new Map<number, ProjectRecord[]>();

  for (const row of rows) {
    const taskId = normalizePositiveInteger(row.task_id);
    if (!taskId) {
      continue;
    }

    const current = projectsByTaskId.get(taskId);
    const nextProject = mapProjectRow(row);
    if (current) {
      current.push(nextProject);
      continue;
    }

    projectsByTaskId.set(taskId, [nextProject]);
  }

  return projectsByTaskId;
}

function attachProjectsToTasks(db: Database.Database, tasks: TaskRecord[]): TaskRecord[] {
  if (tasks.length === 0) {
    return tasks;
  }

  const projectsByTaskId = loadProjectsByTaskIds(
    db,
    tasks.map((task) => task.id)
  );

  return tasks.map((task) => ({
    ...task,
    projects: projectsByTaskId.get(task.id) ?? [],
  }));
}

function loadProjectsByTaskIdsForOrg(
  db: Database.Database,
  orgId: string,
  taskIds: readonly number[]
): Map<number, ProjectRecord[]> {
  const normalizedTaskIds = Array.from(
    new Set(taskIds.map((taskId) => normalizePositiveInteger(taskId)).filter((taskId): taskId is number => Boolean(taskId)))
  );

  if (normalizedTaskIds.length === 0) {
    return new Map();
  }

  const placeholders = normalizedTaskIds.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT
      tp.task_id,
      p.id,
      p.org_id,
      p.team_id,
      p.name,
      p.color,
      p.lifecycle_state,
      p.project_key,
      p.work_domain,
      p.created_at
    FROM task_projects tp
    INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tp.org_id
    WHERE tp.task_id IN (${placeholders})
      AND tp.org_id = ?
      AND p.org_id = ?
    ORDER BY tp.task_id ASC, p.name COLLATE NOCASE ASC, p.id ASC
  `);
  const rows = stmt.all(...normalizedTaskIds, orgId, orgId) as Array<Record<string, unknown>>;
  const projectsByTaskId = new Map<number, ProjectRecord[]>();

  for (const row of rows) {
    const taskId = normalizePositiveInteger(row.task_id);
    if (!taskId) {
      continue;
    }

    const current = projectsByTaskId.get(taskId);
    const nextProject = mapProjectRow(row);
    if (current) {
      current.push(nextProject);
      continue;
    }

    projectsByTaskId.set(taskId, [nextProject]);
  }

  return projectsByTaskId;
}

function attachProjectsToTasksForOrg(db: Database.Database, orgId: string, tasks: TaskRecord[]): TaskRecord[] {
  if (tasks.length === 0) {
    return tasks;
  }

  const projectsByTaskId = loadProjectsByTaskIdsForOrg(
    db,
    orgId,
    tasks.map((task) => task.id)
  );

  return tasks.map((task) => ({
    ...task,
    projects: projectsByTaskId.get(task.id) ?? [],
  }));
}

function mapTaskHistoryRow(row: Record<string, unknown>): TaskHistoryRecord {
  const rawTaskId = Number(row.task_id);
  return {
    id: Number(row.id),
    task_id: Number.isInteger(rawTaskId) ? rawTaskId : 0,
    field: String(row.field ?? ''),
    old_value: normalizeBlockerReason(row.old_value),
    new_value: normalizeBlockerReason(row.new_value),
    changed_by: normalizeBlockerReason(row.changed_by),
    changed_at: normalizeTimestamp(String(row.changed_at ?? '')),
  };
}


function normalizeAgentRuntimeProviderType(value: unknown): AgentRuntimeProviderType {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (AGENT_RUNTIME_PROVIDER_TYPES as readonly string[]).includes(normalized)
    ? normalized as AgentRuntimeProviderType
    : 'unknown';
}

function normalizeAgentRuntimeBindingState(value: unknown): AgentRuntimeBindingState {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  return (AGENT_RUNTIME_BINDING_STATES as readonly string[]).includes(normalized)
    ? normalized as AgentRuntimeBindingState
    : 'unknown';
}

function mapAgentRegistryRow(row: Record<string, unknown>): AgentRegistryRecord {
  return {
    id: String(row.id ?? ''),
    slug: String(row.slug ?? ''),
    name: String(row.name ?? ''),
    emoji: String(row.emoji ?? ''),
    avatar_url: typeof row.avatar_url === 'string' ? row.avatar_url : null,
    description: typeof row.description === 'string' ? row.description : null,
    adapter_type: typeof row.adapter_type === 'string' ? row.adapter_type : null,
    runtime_type: typeof row.runtime_type === 'string' ? row.runtime_type : null,
    runtime_binding_id: typeof row.runtime_binding_id === 'string' && row.runtime_binding_id.trim()
      ? row.runtime_binding_id.trim()
      : null,
    provider_type: normalizeAgentRuntimeProviderType(row.provider_type),
    helm_managed: Number(row.helm_managed ?? 0) === 1,
    binding_state: normalizeAgentRuntimeBindingState(row.binding_state),
    status: String(row.status ?? 'active'),
    instructions_path: typeof row.instructions_path === 'string' ? row.instructions_path : null,
    metadata_json: typeof row.metadata_json === 'string' ? row.metadata_json : '{}',
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? '')),
  };
}

function mapModuleRegistryRow(row: Record<string, unknown>): ModuleRegistryRecord {
  return {
    id: String(row.id ?? ''),
    slug: String(row.slug ?? ''),
    name: String(row.name ?? ''),
    description: typeof row.description === 'string' ? row.description : null,
    enabled: Number(row.enabled ?? 0) === 1,
    icon: typeof row.icon === 'string' ? row.icon : null,
    kind: String(row.kind ?? 'core'),
    permissions_schema_json: typeof row.permissions_schema_json === 'string' ? row.permissions_schema_json : '[]',
    ui_config_json: typeof row.ui_config_json === 'string' ? row.ui_config_json : '{}',
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? '')),
  };
}

function mapAgentModuleGrantRow(row: Record<string, unknown>): AgentModuleGrantRecord {
  return {
    id: String(row.id ?? ''),
    agent_id: String(row.agent_id ?? ''),
    module_id: String(row.module_id ?? ''),
    enabled: Number(row.enabled ?? 0) === 1,
    permissions_json: typeof row.permissions_json === 'string' ? row.permissions_json : '[]',
    scope_json: typeof row.scope_json === 'string' ? row.scope_json : '{}',
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? '')),
  };
}

function mapModuleSkillRefRow(row: Record<string, unknown>): ModuleSkillRefRecord {
  return {
    id: String(row.id ?? ''),
    module_id: String(row.module_id ?? ''),
    label: String(row.label ?? ''),
    kind: String(row.kind ?? ''),
    ref: String(row.ref ?? ''),
    required: Number(row.required ?? 0) === 1,
    notes: typeof row.notes === 'string' ? row.notes : null,
  };
}

export function createAgentRegistryRepository(): AgentRegistryRepository {
  const db = openEntityDatabase();
  const listStmt = db.prepare('SELECT * FROM entity_agents ORDER BY name COLLATE NOCASE ASC');
  const getStmt = db.prepare('SELECT * FROM entity_agents WHERE id = ?');
  const getBySlugStmt = db.prepare('SELECT * FROM entity_agents WHERE slug = ?');
  const deleteAgentStmt = db.prepare('DELETE FROM entity_agents WHERE id = ?');
  const deleteAgentGrantsStmt = db.prepare('DELETE FROM entity_agent_module_grants WHERE agent_id = ?');
  const createStmt = db.prepare(`
    INSERT INTO entity_agents (
      id, slug, name, emoji, avatar_url, description, adapter_type, runtime_type, runtime_binding_id, provider_type, helm_managed, binding_state, status, instructions_path, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  return {
    listAgents: () => (listStmt.all() as Array<Record<string, unknown>>).map(mapAgentRegistryRow),
    getAgent: (id: string) => {
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapAgentRegistryRow(row) : undefined;
    },
    getAgentBySlug: (slug: string) => {
      const row = getBySlugStmt.get(slug) as Record<string, unknown> | undefined;
      return row ? mapAgentRegistryRow(row) : undefined;
    },
    createAgent: (input: CreateAgentRegistryInput) => {
      const id = input.id?.trim() || randomUUID();
      createStmt.run(
        id,
        input.slug.trim().toLowerCase(),
        input.name.trim(),
        input.emoji.trim(),
        input.avatar_url?.trim() || null,
        input.description?.trim() || null,
        input.adapter_type?.trim() || null,
        input.runtime_type?.trim() || null,
        input.runtime_binding_id?.trim() || null,
        normalizeAgentRuntimeProviderType(input.provider_type),
        input.helm_managed ? 1 : 0,
        normalizeAgentRuntimeBindingState(input.binding_state),
        input.status?.trim() || 'active',
        input.instructions_path?.trim() || null,
        input.metadata_json?.trim() || '{}'
      );
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to create entity agent');
      return mapAgentRegistryRow(row);
    },
    updateAgent: (id: string, updates: UpdateAgentRegistryInput) => {
      const fields: string[] = [];
      const values: unknown[] = [];
      if (typeof updates.slug === 'string') { fields.push('slug = ?'); values.push(updates.slug.trim().toLowerCase()); }
      if (typeof updates.name === 'string') { fields.push('name = ?'); values.push(updates.name.trim()); }
      if (typeof updates.emoji === 'string') { fields.push('emoji = ?'); values.push(updates.emoji.trim()); }
      if (updates.avatar_url !== undefined) { fields.push('avatar_url = ?'); values.push(typeof updates.avatar_url === 'string' ? updates.avatar_url.trim() || null : null); }
      if (updates.description !== undefined) { fields.push('description = ?'); values.push(typeof updates.description === 'string' ? updates.description.trim() || null : null); }
      if (updates.adapter_type !== undefined) { fields.push('adapter_type = ?'); values.push(typeof updates.adapter_type === 'string' ? updates.adapter_type.trim() || null : null); }
      if (updates.runtime_type !== undefined) { fields.push('runtime_type = ?'); values.push(typeof updates.runtime_type === 'string' ? updates.runtime_type.trim() || null : null); }
      if (updates.runtime_binding_id !== undefined) { fields.push('runtime_binding_id = ?'); values.push(typeof updates.runtime_binding_id === 'string' ? updates.runtime_binding_id.trim() || null : null); }
      if (updates.provider_type !== undefined) { fields.push('provider_type = ?'); values.push(normalizeAgentRuntimeProviderType(updates.provider_type)); }
      if (updates.helm_managed !== undefined) { fields.push('helm_managed = ?'); values.push(updates.helm_managed ? 1 : 0); }
      if (updates.binding_state !== undefined) { fields.push('binding_state = ?'); values.push(normalizeAgentRuntimeBindingState(updates.binding_state)); }
      if (typeof updates.status === 'string') { fields.push('status = ?'); values.push(updates.status.trim() || 'active'); }
      if (typeof updates.instructions_path === 'string') { fields.push('instructions_path = ?'); values.push(updates.instructions_path.trim() || null); }
      if (typeof updates.metadata_json === 'string') { fields.push('metadata_json = ?'); values.push(updates.metadata_json.trim() || '{}'); }
      if (fields.length === 0) {
        const row = getStmt.get(id) as Record<string, unknown> | undefined;
        return row ? mapAgentRegistryRow(row) : undefined;
      }
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      db.prepare(`UPDATE entity_agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapAgentRegistryRow(row) : undefined;
    },
    deleteAgent: (id: string): boolean => {
      const transaction = db.transaction((agentId: string) => {
        deleteAgentGrantsStmt.run(agentId);
        return deleteAgentStmt.run(agentId).changes > 0;
      });
      return transaction(id);
    },
  };
}

export function createModuleRegistryRepository(): ModuleRegistryRepository {
  const db = openEntityDatabase();
  const listModulesStmt = db.prepare('SELECT * FROM entity_modules ORDER BY name COLLATE NOCASE ASC');
  const listSkillsStmt = db.prepare('SELECT * FROM entity_module_skill_refs WHERE module_id = ? ORDER BY required DESC, label COLLATE NOCASE ASC');
  const listGrantsStmt = db.prepare('SELECT * FROM entity_agent_module_grants WHERE agent_id = ? ORDER BY module_id ASC');
  const getGrantStmt = db.prepare('SELECT * FROM entity_agent_module_grants WHERE agent_id = ? AND module_id = ?');
  const upsertGrantStmt = db.prepare(`
    INSERT INTO entity_agent_module_grants (id, agent_id, module_id, enabled, permissions_json, scope_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(agent_id, module_id) DO UPDATE SET
      enabled = excluded.enabled,
      permissions_json = excluded.permissions_json,
      scope_json = excluded.scope_json,
      updated_at = CURRENT_TIMESTAMP
  `);
  const deleteGrantStmt = db.prepare('DELETE FROM entity_agent_module_grants WHERE agent_id = ? AND module_id = ?');
  return {
    listModules: (): ModuleRegistryRecord[] => (listModulesStmt.all() as Array<Record<string, unknown>>).map(mapModuleRegistryRow),
    listModuleSkillRefs: (moduleId: string): ModuleSkillRefRecord[] => (listSkillsStmt.all(moduleId) as Array<Record<string, unknown>>).map(mapModuleSkillRefRow),
    listAgentModuleGrants: (agentId: string): AgentModuleGrantRecord[] => (listGrantsStmt.all(agentId) as Array<Record<string, unknown>>).map(mapAgentModuleGrantRow),
    upsertAgentModuleGrant: (input: UpsertAgentModuleGrantInput): AgentModuleGrantRecord => {
      upsertGrantStmt.run(
        randomUUID(),
        input.agent_id,
        input.module_id,
        input.enabled === false ? 0 : 1,
        input.permissions_json?.trim() || '[]',
        input.scope_json?.trim() || '{}'
      );
      const row = getGrantStmt.get(input.agent_id, input.module_id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to upsert entity agent module grant');
      return mapAgentModuleGrantRow(row);
    },
    deleteAgentModuleGrant: (agentId: string, moduleId: string): boolean => {
      const result = deleteGrantStmt.run(agentId, moduleId);
      return result.changes > 0;
    },
  };
}

export function createTaskRepository(): TaskRepository {
  const db = openEntityDatabase();
  seedFromMissionControl(db);

  const listStmt = db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC, id DESC');
  const listSubtasksStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE CASE WHEN json_valid(metadata) THEN CAST(json_extract(metadata, '$.parent_task_id') AS INTEGER) END = ?
       OR CASE WHEN json_valid(metadata) THEN CAST(json_extract(metadata, '$.parentTaskId') AS INTEGER) END = ?
       OR CASE WHEN json_valid(metadata) THEN CAST(json_extract(metadata, '$.parent_id') AS INTEGER) END = ?
    ORDER BY updated_at DESC, id DESC
  `);
  const getStmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const createStmt = db.prepare(`
    INSERT INTO tasks (
      org_id,
      team_id,
      project_id,
      created_by_principal_id,
      initiator_principal_id,
      initiator_type,
      owner_principal_id,
      owner_principal_type,
      executor_principal_id,
      assignment_state,
      taskmaster_drivable,
      worktype,
      risk_level,
      agent_trust_level,
      policy_inputs_json,
      external_side_effects_json,
      review_required,
      review_state,
      human_gate_required,
      human_gate_state,
      name,
      description,
      brief,
      origin_channel,
      column,
      model,
      archived,
      assignee,
      blocked,
      blocker_reason,
      project,
      due_date,
      priority,
      estimate_hours,
      time_spent,
      output,
      progress_status,
      recurring,
      recurring_config,
      metadata,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ?');
  // Child rows keyed by task_id must die with the task; otherwise they outlive
  // it and re-attach to a future task that reuses the id (tasks.id is a plain
  // INTEGER PRIMARY KEY, so SQLite recycles deleted ids).
  const deleteTaskCommentsStmt = db.prepare('DELETE FROM task_comments WHERE task_id = ?');
  const deleteTaskProjectsByTaskStmt = db.prepare('DELETE FROM task_projects WHERE task_id = ?');
  const deleteTaskActivitiesStmt = db.prepare('DELETE FROM activities WHERE task_id = ?');
  const deleteTaskSpineEventsStmt = db.prepare(
    'DELETE FROM task_activity_spine_events WHERE task_id = ?',
  );
  const deleteTaskWithChildren = db.transaction((id: number) => {
    deleteTaskCommentsStmt.run(id);
    deleteTaskProjectsByTaskStmt.run(id);
    deleteTaskActivitiesStmt.run(id);
    deleteTaskSpineEventsStmt.run(id);
    return deleteStmt.run(id);
  });

  return {
    listTasks: () => {
      const rows = listStmt.all() as Array<Record<string, unknown>>;
      return attachProjectsToTasks(db, rows.map(mapTaskRow));
    },

    listSubtasks: (parentTaskId: number) => {
      if (!Number.isInteger(parentTaskId) || parentTaskId <= 0) {
        return [];
      }
      const rows = listSubtasksStmt.all(parentTaskId, parentTaskId, parentTaskId) as Array<Record<string, unknown>>;
      return attachProjectsToTasks(db, rows.map(mapTaskRow));
    },

    getTask: (id: number) => {
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        return undefined;
      }

      const [task] = attachProjectsToTasks(db, [mapTaskRow(row)]);
      return task;
    },

    createTask: (input: CreateTaskInput) => {
      const taskName = input.name.trim();
      const priority = typeof input.priority === 'string' && input.priority.trim() ? input.priority.trim() : 'P2';
      const progressStatus =
        typeof input.progress_status === 'string' && input.progress_status.trim()
          ? input.progress_status.trim()
          : 'backlog';
      const estimateHours = normalizeNullableNumber(input.estimate_hours);
      const timeSpent = normalizeNullableNumber(input.time_spent);
      const hasIndividualAssignee =
        typeof input.assignee === 'string' &&
        input.assignee.trim() &&
        input.assignee.trim().toLowerCase() !== 'unassigned';
      const hasExecutor = Boolean(input.executor_principal_id?.trim());
      const reviewRequired = normalizeBlocked(input.review_required);
      const humanGateRequired = normalizeBlocked(input.human_gate_required);
      const normalizedWorktype = normalizeWorktype(input.worktype);
      const worktypeRiskDefault = getWorktypeRegistryEntry(normalizedWorktype)?.risk_default;
      const policyTaskDraft: Pick<
        TaskRecord,
        | 'id'
        | 'org_id'
        | 'team_id'
        | 'project_id'
        | 'created_by_principal_id'
        | 'initiator_principal_id'
        | 'owner_principal_id'
        | 'executor_principal_id'
        | 'assignee'
        | 'worktype'
        | 'column'
        | 'taskmaster_drivable'
        | 'risk_level'
        | 'agent_trust_level'
        | 'policy_inputs_json'
        | 'external_side_effects_json'
        | 'review_required'
        | 'review_state'
        | 'human_gate_required'
        | 'human_gate_state'
      > = {
        id: 0,
        org_id: normalizeWorkspaceId(input.org_id, DEFAULT_WORKSPACE_ORG_ID),
        team_id: normalizeWorkspaceId(input.team_id, DEFAULT_WORKSPACE_TEAM_ID),
        project_id: normalizePositiveInteger(input.project_id),
        created_by_principal_id: input.created_by_principal_id?.trim() || 'legacy-system',
        initiator_principal_id: input.initiator_principal_id?.trim() || 'legacy-unknown',
        owner_principal_id: input.owner_principal_id?.trim() || 'legacy-owner',
        executor_principal_id: input.executor_principal_id?.trim() || null,
        assignee: input.assignee?.trim() || 'Unassigned',
        worktype: normalizedWorktype,
        column: normalizeTaskColumn(input.column),
        taskmaster_drivable: normalizeBlocked(input.taskmaster_drivable),
        risk_level: normalizePolicyRiskLevel(input.risk_level ?? worktypeRiskDefault),
        agent_trust_level: normalizeAgentTrustLevel(input.agent_trust_level),
        policy_inputs_json: normalizeJsonObjectString(input.policy_inputs_json),
        external_side_effects_json: normalizeExternalSideEffectsJson(input.external_side_effects_json),
        review_required: reviewRequired,
        review_state: normalizeReviewPolicyState(input.review_state, reviewRequired),
        human_gate_required: humanGateRequired,
        human_gate_state: normalizeHumanGatePolicyState(input.human_gate_state, humanGateRequired),
      };
      assertValidWorktypePolicyInputs(policyTaskDraft.worktype, policyTaskDraft.policy_inputs_json);
      const policyResolution = resolveTaskPolicy(buildTaskPolicyInputEnvelope(policyTaskDraft));
      const taskmasterDrivable = policyResolution.routing_policy_projection.taskmaster_drivable;
      const assignmentState =
        input.assignment_state?.trim() ||
        (hasIndividualAssignee || hasExecutor
          ? 'assigned'
          : taskmasterDrivable
            ? 'unassigned'
            : 'routing_problem');
      const result = createStmt.run(
        policyTaskDraft.org_id,
        policyTaskDraft.team_id,
        policyTaskDraft.project_id,
        policyTaskDraft.created_by_principal_id,
        policyTaskDraft.initiator_principal_id,
        input.initiator_type?.trim() || 'unknown',
        policyTaskDraft.owner_principal_id,
        input.owner_principal_type?.trim() || 'unknown',
        policyTaskDraft.executor_principal_id,
        assignmentState,
        taskmasterDrivable ? 1 : 0,
        policyTaskDraft.worktype,
        policyTaskDraft.risk_level,
        policyTaskDraft.agent_trust_level,
        policyTaskDraft.policy_inputs_json,
        policyTaskDraft.external_side_effects_json,
        reviewRequired ? 1 : 0,
        policyTaskDraft.review_state,
        humanGateRequired ? 1 : 0,
        policyTaskDraft.human_gate_state,
        taskName,
        input.description?.trim() || null,
        input.brief?.trim() || null,
        input.origin_channel?.trim() || null,
        policyTaskDraft.column,
        typeof input.model === 'string' ? input.model.trim() || null : null,
        normalizeBlocked(input.archived) ? 1 : 0,
        policyTaskDraft.assignee,
        normalizeBlocked(input.blocked) ? 1 : 0,
        normalizeBlockerReason(input.blocker_reason),
        normalizeBlockerReason(input.project) ?? 'General',
        normalizeBlockerReason(input.due_date),
        priority,
        estimateHours,
        timeSpent === null ? 0 : timeSpent,
        typeof input.output === 'string' ? input.output.trim() || null : null,
        progressStatus,
        normalizeBlocked(input.recurring) ? 1 : 0,
        typeof input.recurring_config === 'string' ? input.recurring_config.trim() || null : null,
        writeTaskMetadataWithRoutingPolicyProjection(input.metadata, policyResolution)
      );

      const task = getStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!task) {
        throw new Error('Failed to create task');
      }

      const [createdTask] = attachProjectsToTasks(db, [mapTaskRow(task)]);
      return createdTask;
    },

    updateTask: (id: number, updates: UpdateTaskInput) => {
      const existingTask = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!existingTask) {
        return undefined;
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      const nextWorktype = typeof updates.worktype === 'string'
        ? normalizeWorktype(updates.worktype)
        : normalizeWorktype(existingTask.worktype);
      const nextPolicyInputsJson = typeof updates.policy_inputs_json !== 'undefined'
        ? normalizeJsonObjectString(updates.policy_inputs_json)
        : normalizeJsonObjectString(existingTask.policy_inputs_json);
      if (typeof updates.worktype === 'string' || typeof updates.policy_inputs_json !== 'undefined') {
        assertValidWorktypePolicyInputs(nextWorktype, nextPolicyInputsJson);
      }

      if (typeof updates.name === 'string') {
        fields.push('name = ?');
        values.push(updates.name.trim());
      }

      if (typeof updates.description === 'string') {
        fields.push('description = ?');
        values.push(updates.description.trim() || null);
      }

      if (typeof updates.brief === 'string') {
        fields.push('brief = ?');
        values.push(updates.brief.trim() || null);
      }

      if (typeof updates.origin_channel === 'string') {
        fields.push('origin_channel = ?');
        values.push(updates.origin_channel.trim() || null);
      }

      if (typeof updates.column === 'string') {
        fields.push('column = ?');
        values.push(normalizeTaskColumn(updates.column));
      }

      if (typeof updates.model === 'string') {
        fields.push('model = ?');
        values.push(updates.model.trim() || null);
      }

      if (typeof updates.archived !== 'undefined') {
        fields.push('archived = ?');
        values.push(normalizeBlocked(updates.archived) ? 1 : 0);
      }

      if (typeof updates.assignee === 'string') {
        fields.push('assignee = ?');
        values.push(updates.assignee.trim() || 'Unassigned');
      }

      if (typeof updates.blocked !== 'undefined') {
        fields.push('blocked = ?');
        values.push(normalizeBlocked(updates.blocked) ? 1 : 0);
      }

      if (typeof updates.blocker_reason === 'string') {
        fields.push('blocker_reason = ?');
        values.push(normalizeBlockerReason(updates.blocker_reason));
      }

      if (typeof updates.project === 'string') {
        fields.push('project = ?');
        values.push(normalizeBlockerReason(updates.project) ?? 'General');
      }

      if (typeof updates.due_date === 'string') {
        fields.push('due_date = ?');
        values.push(normalizeBlockerReason(updates.due_date));
      }

      if (typeof updates.priority === 'string') {
        fields.push('priority = ?');
        values.push(updates.priority.trim() || 'P2');
      }

      if (typeof updates.estimate_hours !== 'undefined') {
        fields.push('estimate_hours = ?');
        values.push(normalizeNullableNumber(updates.estimate_hours));
      }

      if (typeof updates.time_spent !== 'undefined') {
        fields.push('time_spent = ?');
        const normalized = normalizeNullableNumber(updates.time_spent);
        values.push(normalized === null ? 0 : normalized);
      }

      if (typeof updates.output === 'string') {
        fields.push('output = ?');
        values.push(updates.output.trim() || null);
      }

      if (typeof updates.progress_status === 'string') {
        fields.push('progress_status = ?');
        values.push(updates.progress_status.trim() || 'backlog');
      }

      if (typeof updates.recurring !== 'undefined') {
        fields.push('recurring = ?');
        values.push(normalizeBlocked(updates.recurring) ? 1 : 0);
      }

      if (typeof updates.recurring_config === 'string') {
        fields.push('recurring_config = ?');
        values.push(updates.recurring_config.trim() || null);
      }

      if (typeof updates.metadata === 'string') {
        fields.push('metadata = ?');
        values.push(updates.metadata.trim() || '{}');
      }

      if (typeof updates.org_id === 'string') {
        fields.push('org_id = ?');
        values.push(normalizeWorkspaceId(updates.org_id, DEFAULT_WORKSPACE_ORG_ID));
      }

      if (typeof updates.team_id === 'string') {
        fields.push('team_id = ?');
        values.push(normalizeWorkspaceId(updates.team_id, DEFAULT_WORKSPACE_TEAM_ID));
      }

      if (typeof updates.project_id !== 'undefined') {
        fields.push('project_id = ?');
        values.push(normalizePositiveInteger(updates.project_id));
      }

      if (typeof updates.created_by_principal_id === 'string') {
        fields.push('created_by_principal_id = ?');
        values.push(updates.created_by_principal_id.trim() || 'legacy-system');
      }

      if (typeof updates.initiator_principal_id === 'string') {
        fields.push('initiator_principal_id = ?');
        values.push(updates.initiator_principal_id.trim() || 'legacy-unknown');
      }

      if (typeof updates.initiator_type === 'string') {
        fields.push('initiator_type = ?');
        values.push(updates.initiator_type.trim() || 'unknown');
      }

      if (typeof updates.owner_principal_id === 'string') {
        fields.push('owner_principal_id = ?');
        values.push(updates.owner_principal_id.trim() || 'legacy-owner');
      }

      if (typeof updates.owner_principal_type === 'string') {
        fields.push('owner_principal_type = ?');
        values.push(updates.owner_principal_type.trim() || 'unknown');
      }

      if (typeof updates.executor_principal_id === 'string') {
        fields.push('executor_principal_id = ?');
        values.push(updates.executor_principal_id.trim() || null);
      }

      if (typeof updates.assignment_state === 'string') {
        fields.push('assignment_state = ?');
        values.push(updates.assignment_state.trim() || 'routing_problem');
      }

      if (typeof updates.taskmaster_drivable !== 'undefined') {
        fields.push('taskmaster_drivable = ?');
        values.push(normalizeBlocked(updates.taskmaster_drivable) ? 1 : 0);
      }

      if (typeof updates.worktype === 'string') {
        fields.push('worktype = ?');
        values.push(nextWorktype);
      }

      if (typeof updates.risk_level !== 'undefined') {
        fields.push('risk_level = ?');
        values.push(normalizePolicyRiskLevel(updates.risk_level));
      }

      if (typeof updates.agent_trust_level !== 'undefined') {
        fields.push('agent_trust_level = ?');
        values.push(normalizeAgentTrustLevel(updates.agent_trust_level));
      }

      if (typeof updates.policy_inputs_json !== 'undefined') {
        fields.push('policy_inputs_json = ?');
        values.push(nextPolicyInputsJson);
      }

      if (typeof updates.external_side_effects_json !== 'undefined') {
        fields.push('external_side_effects_json = ?');
        values.push(normalizeExternalSideEffectsJson(updates.external_side_effects_json));
      }

      if (typeof updates.review_required !== 'undefined') {
        const reviewRequired = normalizeBlocked(updates.review_required);
        fields.push('review_required = ?');
        values.push(reviewRequired ? 1 : 0);
        if (typeof updates.review_state === 'undefined') {
          fields.push('review_state = ?');
          values.push(normalizeReviewPolicyState(undefined, reviewRequired));
        }
      }

      if (typeof updates.review_state !== 'undefined') {
        const reviewRequired =
          typeof updates.review_required !== 'undefined'
            ? normalizeBlocked(updates.review_required)
            : normalizeBlocked(existingTask.review_required);
        fields.push('review_state = ?');
        values.push(normalizeReviewPolicyState(updates.review_state, reviewRequired));
      }

      if (typeof updates.human_gate_required !== 'undefined') {
        const humanGateRequired = normalizeBlocked(updates.human_gate_required);
        fields.push('human_gate_required = ?');
        values.push(humanGateRequired ? 1 : 0);
        if (typeof updates.human_gate_state === 'undefined') {
          fields.push('human_gate_state = ?');
          values.push(normalizeHumanGatePolicyState(undefined, humanGateRequired));
        }
      }

      if (typeof updates.human_gate_state !== 'undefined') {
        const humanGateRequired =
          typeof updates.human_gate_required !== 'undefined'
            ? normalizeBlocked(updates.human_gate_required)
            : normalizeBlocked(existingTask.human_gate_required);
        fields.push('human_gate_state = ?');
        values.push(normalizeHumanGatePolicyState(updates.human_gate_state, humanGateRequired));
      }

      if (fields.length === 0) {
        return mapTaskRow(existingTask);
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      const refreshed = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!refreshed) {
        return undefined;
      }

      const [updatedTask] = attachProjectsToTasks(db, [mapTaskRow(refreshed)]);
      return updatedTask;
    },

    claimTaskForTaskMaster: (id: number, input: ClaimTaskForTaskMasterInput = {}) => {
      if (!Number.isInteger(id) || id < 1) {
        return {
          status: 'not_found',
          claimed: false,
          reason: 'task not found',
        };
      }

      const taskmasterPrincipalId = normalizeTaskMasterPrincipalId(input.taskmaster_principal_id);
      const transaction = db.transaction((): TaskMasterClaimResult => {
        const existingRow = getStmt.get(id) as Record<string, unknown> | undefined;
        if (!existingRow) {
          return {
            status: 'not_found',
            claimed: false,
            reason: 'task not found',
          };
        }

        const [existingTask] = attachProjectsToTasks(db, [mapTaskRow(existingRow)]);
        if (
          existingTask.executor_principal_id === taskmasterPrincipalId &&
          existingTask.assignment_state === 'claimed'
        ) {
          return {
            status: 'already_claimed',
            claimed: false,
            task: existingTask,
            reason: 'task is already claimed by Task Master',
          };
        }

        const claim = buildTaskMasterClaimRecord(existingTask, {
          ...input,
          taskmaster_principal_id: taskmasterPrincipalId,
        });
        const nextMetadata = writeTaskMetadataWithTaskMasterClaim(existingTask.metadata, claim, existingTask);
        const result = db.prepare(`
          UPDATE tasks
          SET executor_principal_id = ?,
              assignment_state = 'claimed',
              metadata = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND taskmaster_drivable = 1
            AND (assignee IS NULL OR TRIM(assignee) = '' OR LOWER(TRIM(assignee)) = 'unassigned')
            AND (executor_principal_id IS NULL OR TRIM(executor_principal_id) = '')
            AND (assignment_state IS NULL OR TRIM(assignment_state) = '' OR LOWER(TRIM(assignment_state)) = 'unassigned')
        `).run(taskmasterPrincipalId, nextMetadata, id);

        const refreshedRow = getStmt.get(id) as Record<string, unknown> | undefined;
        if (!refreshedRow) {
          return {
            status: 'not_found',
            claimed: false,
            reason: 'task not found',
          };
        }
        const [refreshedTask] = attachProjectsToTasks(db, [mapTaskRow(refreshedRow)]);

        if (result.changes > 0) {
          return {
            status: 'claimed',
            claimed: true,
            task: refreshedTask,
            previousTask: existingTask,
            claim,
          };
        }

        if (
          refreshedTask.executor_principal_id === taskmasterPrincipalId &&
          refreshedTask.assignment_state === 'claimed'
        ) {
          return {
            status: 'already_claimed',
            claimed: false,
            task: refreshedTask,
            reason: 'task is already claimed by Task Master',
          };
        }

        return {
          status: 'not_claimable',
          claimed: false,
          task: refreshedTask,
          previousTask: existingTask,
          reason: 'task is not unassigned Task-Master-drivable work',
        };
      });

      return transaction();
    },

    moveTask: (id: number, nextColumn: string) => {
      const normalizedColumn = normalizeTaskColumn(nextColumn);
      db.prepare('UPDATE tasks SET column = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(normalizedColumn, id);
      const refreshed = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!refreshed) {
        return undefined;
      }

      const [movedTask] = attachProjectsToTasks(db, [mapTaskRow(refreshed)]);
      return movedTask;
    },

    deleteTask: (id: number) => {
      const result = deleteTaskWithChildren(id);
      return result.changes > 0;
    },
  };
}

export function createDocumentObjectRepository(): DocumentObjectRepository {
  const db = openEntityDatabase();
  const getNativeStmt = db.prepare('SELECT * FROM native_documents WHERE id = ?');
  const listNativeByOrgStmt = db.prepare(`
    SELECT *
    FROM native_documents
    WHERE org_id = ?
    ORDER BY updated_at DESC, title ASC, id ASC
  `);
  const getExternalStmt = db.prepare('SELECT * FROM external_document_refs WHERE id = ?');
  const listExternalByOrgStmt = db.prepare(`
    SELECT *
    FROM external_document_refs
    WHERE org_id = ?
    ORDER BY updated_at DESC, title ASC, id ASC
  `);
  const listNativeVersionsStmt = db.prepare(`
    SELECT *
    FROM native_document_versions
    WHERE document_id = ?
    ORDER BY version ASC, id ASC
  `);
  const insertNativeVersionStmt = db.prepare(`
    INSERT INTO native_document_versions (
      document_id,
      version,
      stable_path,
      content_hash,
      metadata_json,
      created_by_principal_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const updateNativeRefsStmt = db.prepare(`
    UPDATE native_documents
    SET linked_object_refs_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const updateNativeVersionStmt = db.prepare(`
    UPDATE native_documents
    SET title = ?,
        stable_path = ?,
        content_hash = ?,
        version = ?,
        metadata_json = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const updateExternalRefsStmt = db.prepare(`
    UPDATE external_document_refs
    SET linked_object_refs_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const createNativeStmt = db.prepare(`
    INSERT INTO native_documents (
      id,
      org_id,
      team_id,
      project_id,
      title,
      document_kind,
      body_format,
      stable_path,
      content_hash,
      mutability_policy,
      version,
      lifecycle_state,
      sensitivity,
      acl_json,
      linked_object_refs_json,
      created_by_principal_id,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'markdown', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const createExternalStmt = db.prepare(`
    INSERT INTO external_document_refs (
      id,
      org_id,
      connector_type,
      external_id,
      external_url,
      title,
      external_mime_type,
      external_canonical_url,
      auth_state,
      readiness_state,
      granted_scopes_json,
      missing_scopes_json,
      auth_expires_at,
      external_ref_state,
      capabilities_json,
      canonicality,
      last_indexed_at,
      last_checked_at,
      entity_visibility_policy_json,
      external_permission_summary,
      linked_object_refs_json,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  return {
    createNativeDocument: (input: CreateNativeDocumentInput) => {
      const created = db.transaction(() => {
        const id = normalizeWorkspaceId(input.id, randomUUID());
        const title = input.title.trim();
        const contentHash = input.content_hash.trim();
        if (!title) {
          throw new Error('native document title is required');
        }
        if (!contentHash) {
          throw new Error('native document content_hash is required');
        }
        const version = normalizePositiveInteger(input.version) ?? 1;
        const stablePath = input.stable_path?.trim() || `/documents/native/${id}.md`;
        const metadataJson = normalizeJsonObjectString(input.metadata_json);
        const createdBy = normalizeBlockerReason(input.created_by_principal_id);

        createNativeStmt.run(
          id,
          normalizeWorkspaceId(input.org_id, DEFAULT_WORKSPACE_ORG_ID),
          normalizeBlockerReason(input.team_id),
          normalizePositiveInteger(input.project_id),
          title,
          normalizeNativeDocumentKind(input.document_kind),
          stablePath,
          contentHash,
          normalizeNativeDocumentMutability(input.mutability_policy),
          version,
          normalizeNativeDocumentLifecycleState(input.lifecycle_state),
          normalizeBlockerReason(input.sensitivity),
          normalizeJsonObjectString(input.acl_json),
          stringifyObjectRefs(input.linked_object_refs ?? []),
          createdBy,
          metadataJson
        );
        insertNativeVersionStmt.run(id, version, stablePath, contentHash, metadataJson, createdBy);
        return id;
      })();
      const id = created;
      const row = getNativeStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create native document');
      }
      return mapNativeDocumentRow(row);
    },

    getNativeDocument: (id: string) => {
      const row = getNativeStmt.get(id.trim()) as Record<string, unknown> | undefined;
      return row ? mapNativeDocumentRow(row) : undefined;
    },

    listNativeDocuments: (input: ListNativeDocumentsInput) => {
      // Org-scoped at the SQL layer; org_id is sourced exclusively from requireRequestOrg().
      const orgId = normalizeWorkspaceId(input.org_id, DEFAULT_WORKSPACE_ORG_ID);
      const query = normalizeBlockerReason(input.query)?.toLowerCase() ?? null;
      const teamId = normalizeBlockerReason(input.team_id);
      const projectId = normalizePositiveInteger(input.project_id);
      const sensitivity = normalizeBlockerReason(input.sensitivity)?.toLowerCase() ?? null;
      const fromMs = input.from ? Date.parse(input.from) : Number.NaN;
      const toMs = input.to ? Date.parse(input.to) : Number.NaN;
      const limit = Math.min(normalizePositiveInteger(input.limit) ?? 50, 10_101);
      const rows = listNativeByOrgStmt.all(orgId) as Array<Record<string, unknown>>;
      return rows
        .map(mapNativeDocumentRow)
        .filter((record) => !teamId || record.team_id === teamId)
        .filter((record) => !projectId || record.project_id === projectId)
        .filter((record) => !input.lifecycle_state || record.lifecycle_state === input.lifecycle_state)
        .filter((record) => !sensitivity || record.sensitivity?.toLowerCase() === sensitivity)
        .filter((record) => {
          if (!query) return true;
          return [
            record.title,
            record.stable_path,
            record.metadata_json,
          ].join(' ').toLowerCase().includes(query);
        })
        .filter((record) => {
          const updatedAtMs = Date.parse(record.updated_at);
          if (Number.isFinite(fromMs) && updatedAtMs < fromMs) return false;
          if (Number.isFinite(toMs) && updatedAtMs > toMs) return false;
          return true;
        })
        .sort((left, right) =>
          Number(Boolean(query && right.title.toLowerCase().includes(query)))
          - Number(Boolean(query && left.title.toLowerCase().includes(query)))
          || Date.parse(right.updated_at) - Date.parse(left.updated_at)
          || left.id.localeCompare(right.id)
        )
        .slice(0, limit);
    },

    updateNativeDocumentVersion: (id: string, input: UpdateNativeDocumentVersionInput) => {
      const normalizedId = id.trim();
      const updatedId = db.transaction(() => {
        const currentRow = getNativeStmt.get(normalizedId) as Record<string, unknown> | undefined;
        if (!currentRow) {
          return undefined;
        }
        const current = mapNativeDocumentRow(currentRow);
        if (current.mutability_policy !== 'editable_versioned') {
          throw new Error('immutable native documents cannot be overwritten; create a superseding document');
        }
        const contentHash = input.content_hash.trim();
        if (!contentHash) {
          throw new Error('native document content_hash is required');
        }
        const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : current.title;
        const stablePath = input.stable_path?.trim() || current.stable_path;
        const metadataJson = typeof input.metadata_json === 'undefined'
          ? current.metadata_json
          : normalizeJsonObjectString(input.metadata_json);
        const updatedBy = normalizeBlockerReason(input.updated_by_principal_id);
        const nextVersion = current.version + 1;
        updateNativeVersionStmt.run(title, stablePath, contentHash, nextVersion, metadataJson, normalizedId);
        insertNativeVersionStmt.run(normalizedId, nextVersion, stablePath, contentHash, metadataJson, updatedBy);
        return normalizedId;
      })();
      if (!updatedId) {
        return undefined;
      }
      const row = getNativeStmt.get(updatedId) as Record<string, unknown> | undefined;
      return row ? mapNativeDocumentRow(row) : undefined;
    },

    listNativeDocumentVersions: (id: string) => {
      return (listNativeVersionsStmt.all(id.trim()) as Array<Record<string, unknown>>).map(mapNativeDocumentVersionRow);
    },

    linkNativeDocumentObject: (id: string, objectRef: ObjectRef) => {
      const normalizedId = id.trim();
      const current = getNativeStmt.get(normalizedId) as Record<string, unknown> | undefined;
      if (!current) {
        return undefined;
      }
      const refs = appendObjectRef(mapNativeDocumentRow(current).linked_object_refs, objectRef);
      updateNativeRefsStmt.run(JSON.stringify(refs), normalizedId);
      const row = getNativeStmt.get(normalizedId) as Record<string, unknown> | undefined;
      return row ? mapNativeDocumentRow(row) : undefined;
    },

    createExternalDocumentRef: (input: CreateExternalDocumentRefInput) => {
      const id = normalizeWorkspaceId(input.id, randomUUID());
      const title = input.title.trim();
      const externalId = normalizeBlockerReason(input.external_id);
      const externalUrl = normalizeBlockerReason(input.external_url);
      const connectorType = normalizeExternalConnectorType(input.connector_type);
      if (!title) {
        throw new Error('external document title is required');
      }
      if (!externalId && !externalUrl) {
        throw new Error('external document ref requires external_id or external_url');
      }

      createExternalStmt.run(
        id,
        normalizeWorkspaceId(input.org_id, DEFAULT_WORKSPACE_ORG_ID),
        connectorType,
        externalId,
        externalUrl,
        title,
        normalizeBlockerReason(input.external_mime_type),
        normalizeBlockerReason(input.external_canonical_url),
        normalizeExternalAuthState(input.auth_state),
        normalizeExternalReadinessState(input.readiness_state),
        stringifyGoogleConnectorScopes(input.granted_scopes ?? []),
        stringifyGoogleConnectorScopes(input.missing_scopes ?? []),
        normalizeNullableTimestamp(input.auth_expires_at),
        normalizeExternalRefState(input.external_ref_state),
        defaultExternalCapabilitiesJson(connectorType, input.capabilities_json),
        normalizeExternalCanonicality(input.canonicality),
        normalizeNullableTimestamp(input.last_indexed_at),
        normalizeNullableTimestamp(input.last_checked_at),
        normalizeJsonObjectString(input.entity_visibility_policy_json),
        normalizeBlockerReason(input.external_permission_summary),
        stringifyObjectRefs(input.linked_object_refs ?? []),
        normalizeJsonObjectString(input.metadata_json)
      );
      const row = getExternalStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create external document ref');
      }
      return mapExternalDocumentRefRow(row);
    },

    getExternalDocumentRef: (id: string) => {
      const row = getExternalStmt.get(id.trim()) as Record<string, unknown> | undefined;
      return row ? mapExternalDocumentRefRow(row) : undefined;
    },

    listExternalDocumentRefs: (input: ListExternalDocumentRefsInput) => {
      // Org-scoped at the SQL layer; org_id is sourced exclusively from requireRequestOrg().
      const orgId = normalizeWorkspaceId(input.org_id, DEFAULT_WORKSPACE_ORG_ID);
      const connectorType = input.connector_type ? normalizeExternalConnectorType(input.connector_type) : undefined;
      const query = normalizeBlockerReason(input.query)?.toLowerCase() ?? null;
      const fromMs = input.from ? Date.parse(input.from) : Number.NaN;
      const toMs = input.to ? Date.parse(input.to) : Number.NaN;
      const limit = Math.min(normalizePositiveInteger(input.limit) ?? 50, 10_101);
      const objectRef = input.linked_object_ref ?? null;
      const rows = listExternalByOrgStmt.all(orgId) as Array<Record<string, unknown>>;
      const matches = rows
        .map(mapExternalDocumentRefRow)
        .filter((record) => !connectorType || record.connector_type === connectorType)
        .filter((record) => !input.auth_state || record.auth_state === input.auth_state)
        .filter((record) => !input.readiness_state || record.readiness_state === input.readiness_state)
        .filter((record) => !input.external_ref_state || record.external_ref_state === input.external_ref_state)
        .filter((record) => {
          if (!query) return true;
          const searchable = [
            record.title,
            record.external_id,
            record.external_url,
            record.external_canonical_url,
            record.external_mime_type,
            record.external_permission_summary,
            record.metadata_json,
          ].filter(Boolean).join(' ').toLowerCase();
          return searchable.includes(query);
        })
        .filter((record) => {
          if (!objectRef) return true;
          return record.linked_object_refs.some((entry) =>
            entry.object_type === objectRef.object_type &&
            entry.object_id === objectRef.object_id &&
            (!objectRef.link_role || entry.link_role === objectRef.link_role)
          );
        })
        .filter((record) => {
          const updatedAtMs = Date.parse(record.updated_at);
          if (Number.isFinite(fromMs) && updatedAtMs < fromMs) return false;
          if (Number.isFinite(toMs) && updatedAtMs > toMs) return false;
          return true;
        })
        .sort((left, right) =>
          Number(Boolean(query && right.title.toLowerCase().includes(query)))
          - Number(Boolean(query && left.title.toLowerCase().includes(query)))
          || Date.parse(right.updated_at) - Date.parse(left.updated_at)
          || left.id.localeCompare(right.id)
        );
      return matches.slice(0, limit);
    },

    linkExternalDocumentObject: (id: string, objectRef: ObjectRef) => {
      const normalizedId = id.trim();
      const current = getExternalStmt.get(normalizedId) as Record<string, unknown> | undefined;
      if (!current) {
        return undefined;
      }
      const refs = appendObjectRef(mapExternalDocumentRefRow(current).linked_object_refs, objectRef);
      updateExternalRefsStmt.run(JSON.stringify(refs), normalizedId);
      const row = getExternalStmt.get(normalizedId) as Record<string, unknown> | undefined;
      return row ? mapExternalDocumentRefRow(row) : undefined;
    },
  };
}

export function createEvidenceArtifactRepository(): EvidenceArtifactRepository {
  const db = openEntityDatabase();
  const getStmt = db.prepare('SELECT * FROM evidence_artifacts WHERE id = ?');
  const listByOrgStmt = db.prepare(`
    SELECT *
    FROM evidence_artifacts
    WHERE org_id = ?
    ORDER BY updated_at DESC, title ASC, id ASC
  `);
  const listVersionsStmt = db.prepare(`
    SELECT *
    FROM evidence_artifact_versions
    WHERE artifact_id = ?
    ORDER BY version ASC, id ASC
  `);
  const listByOriginTaskStmt = db.prepare(`
    SELECT *
    FROM evidence_artifacts
    WHERE origin_task_id = ?
    ORDER BY created_at ASC, id ASC
  `);
  const createStmt = db.prepare(`
    INSERT INTO evidence_artifacts (
      id,
      org_id,
      team_id,
      project_id,
      artifact_kind,
      title,
      body_format,
      stable_path,
      human_path_alias,
      content_hash,
      mutability_policy,
      version,
      origin_task_id,
      source_activity_event_ids_json,
      source_artifact_ids_json,
      linked_object_refs_json,
      provenance_json,
      integrity_state,
      availability_state,
      created_by_principal_id,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'markdown', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const insertVersionStmt = db.prepare(`
    INSERT INTO evidence_artifact_versions (
      artifact_id,
      version,
      stable_path,
      content_hash,
      metadata_json,
      created_by_principal_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const updateArtifactVersionStmt = db.prepare(`
    UPDATE evidence_artifacts
    SET title = ?,
        stable_path = ?,
        content_hash = ?,
        version = ?,
        metadata_json = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const updateAliasStmt = db.prepare(`
    UPDATE evidence_artifacts
    SET human_path_alias = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const updateLinkedRefsStmt = db.prepare(`
    UPDATE evidence_artifacts
    SET linked_object_refs_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  return {
    createArtifact: (input: CreateEvidenceArtifactInput) => {
      const created = db.transaction(() => {
        const id = normalizeWorkspaceId(input.id, randomUUID());
        const kind = normalizeEvidenceArtifactKind(input.artifact_kind);
        const title = input.title.trim();
        const contentHash = input.content_hash.trim();
        if (!title) {
          throw new Error('evidence artifact title is required');
        }
        if (!contentHash) {
          throw new Error('evidence artifact content_hash is required');
        }
        const mutabilityPolicy = normalizeEvidenceMutabilityPolicy(kind, input.mutability_policy);
        const stablePath = input.stable_path?.trim() || `/artifacts/evidence/${id}.md`;
        const version = normalizePositiveInteger(input.version) ?? 1;
        const metadataJson = normalizeJsonObjectString(input.metadata_json);
        const createdBy = normalizeBlockerReason(input.created_by_principal_id);
        createStmt.run(
          id,
          normalizeWorkspaceId(input.org_id, DEFAULT_WORKSPACE_ORG_ID),
          normalizeBlockerReason(input.team_id),
          normalizePositiveInteger(input.project_id),
          kind,
          title,
          stablePath,
          normalizeBlockerReason(input.human_path_alias),
          contentHash,
          mutabilityPolicy,
          version,
          normalizePositiveInteger(input.origin_task_id),
          JSON.stringify(normalizeJsonNumberArray(input.source_activity_event_ids)),
          JSON.stringify(normalizeJsonStringArray(input.source_artifact_ids)),
          stringifyObjectRefs(input.linked_object_refs ?? []),
          normalizeJsonObjectString(input.provenance_json),
          normalizeEvidenceIntegrityState(input.integrity_state),
          normalizeEvidenceAvailabilityState(input.availability_state),
          createdBy,
          metadataJson
        );
        insertVersionStmt.run(id, version, stablePath, contentHash, metadataJson, createdBy);
        return id;
      })();
      const id = created;
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create evidence artifact');
      }
      return mapEvidenceArtifactRow(row);
    },

    getArtifact: (id: string) => {
      const row = getStmt.get(id.trim()) as Record<string, unknown> | undefined;
      return row ? mapEvidenceArtifactRow(row) : undefined;
    },

    listArtifactsByOriginTask: (taskId: number) => {
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        return [];
      }
      return (listByOriginTaskStmt.all(safeTaskId) as Array<Record<string, unknown>>).map(mapEvidenceArtifactRow);
    },

    listArtifacts: (input: ListEvidenceArtifactsInput) => {
      // Org-scoped at the SQL layer; org_id is sourced exclusively from requireRequestOrg().
      const orgId = normalizeWorkspaceId(input.org_id, DEFAULT_WORKSPACE_ORG_ID);
      const query = normalizeBlockerReason(input.query)?.toLowerCase() ?? null;
      const kinds = input.artifact_kinds?.length ? new Set(input.artifact_kinds) : null;
      const teamId = normalizeBlockerReason(input.team_id);
      const projectId = normalizePositiveInteger(input.project_id);
      const sensitivity = normalizeBlockerReason(input.sensitivity)?.toLowerCase() ?? null;
      const queryOriginTaskIds = new Set(
        (input.query_origin_task_ids ?? []).map(normalizePositiveInteger).filter((id): id is number => Boolean(id)),
      );
      const originTaskIds = input.origin_task_ids
        ? new Set(input.origin_task_ids.map(normalizePositiveInteger).filter((id): id is number => Boolean(id)))
        : null;
      const teamOriginTaskIds = new Set(
        (input.team_origin_task_ids ?? []).map(normalizePositiveInteger).filter((id): id is number => Boolean(id)),
      );
      const projectOriginTaskIds = new Set(
        (input.project_origin_task_ids ?? []).map(normalizePositiveInteger).filter((id): id is number => Boolean(id)),
      );
      const sensitivityOriginTaskIds = new Set(
        (input.sensitivity_origin_task_ids ?? []).map(normalizePositiveInteger).filter((id): id is number => Boolean(id)),
      );
      const fromMs = input.from ? Date.parse(input.from) : Number.NaN;
      const toMs = input.to ? Date.parse(input.to) : Number.NaN;
      const limit = Math.min(normalizePositiveInteger(input.limit) ?? 50, 10_101);
      return (listByOrgStmt.all(orgId) as Array<Record<string, unknown>>)
        .map(mapEvidenceArtifactRow)
        .filter((record) => !kinds || kinds.has(record.artifact_kind))
        .filter((record) => !input.availability_state || record.availability_state === input.availability_state)
        .filter((record) => {
          const originMatches = Boolean(
            record.origin_task_id && originTaskIds?.has(record.origin_task_id),
          );
          if (input.require_origin_task_match && !originMatches) return false;
          if (teamId && (
            record.team_id
              ? record.team_id !== teamId
              : !record.origin_task_id || !teamOriginTaskIds.has(record.origin_task_id)
          )) return false;
          if (projectId && (
            record.project_id
              ? record.project_id !== projectId
              : !record.origin_task_id || !projectOriginTaskIds.has(record.origin_task_id)
          )) return false;
          if (sensitivity) {
            const metadata = parseJsonObject(record.metadata_json);
            const artifactSensitivity = normalizeBlockerReason(
              metadata.sensitivity ?? metadata.sensitivity_class,
            )?.toLowerCase();
            const artifactSensitivityMatches = artifactSensitivity
              ?.split(',')
              .some((entry) => entry.trim() === sensitivity) ?? false;
            if (
              !artifactSensitivityMatches
              && (!record.origin_task_id || !sensitivityOriginTaskIds.has(record.origin_task_id))
            ) return false;
          }
          return true;
        })
        .filter((record) => {
          if (!query) return true;
          const directMatch = [
            record.title,
            record.artifact_kind,
            record.human_path_alias,
          ].filter(Boolean).join(' ').toLowerCase().includes(query);
          return directMatch || Boolean(
            record.origin_task_id && queryOriginTaskIds.has(record.origin_task_id),
          );
        })
        .filter((record) => {
          const updatedAtMs = Date.parse(record.updated_at);
          if (Number.isFinite(fromMs) && updatedAtMs < fromMs) return false;
          if (Number.isFinite(toMs) && updatedAtMs > toMs) return false;
          return true;
        })
        .sort((left, right) =>
          Number(Boolean(query && right.title.toLowerCase().includes(query)))
          - Number(Boolean(query && left.title.toLowerCase().includes(query)))
          || Date.parse(right.updated_at) - Date.parse(left.updated_at)
          || left.id.localeCompare(right.id)
        )
        .slice(0, limit);
    },

    updateArtifactVersion: (id: string, input: UpdateEvidenceArtifactVersionInput) => {
      const normalizedId = id.trim();
      const updatedId = db.transaction(() => {
        const currentRow = getStmt.get(normalizedId) as Record<string, unknown> | undefined;
        if (!currentRow) {
          return undefined;
        }
        const current = mapEvidenceArtifactRow(currentRow);
        if (current.mutability_policy !== 'editable_versioned') {
          throw new Error('immutable evidence artifacts cannot be overwritten; create a superseding artifact');
        }
        const contentHash = input.content_hash.trim();
        if (!contentHash) {
          throw new Error('evidence artifact content_hash is required');
        }
        const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : current.title;
        const stablePath = input.stable_path?.trim() || current.stable_path;
        const metadataJson = typeof input.metadata_json === 'undefined'
          ? current.metadata_json
          : normalizeJsonObjectString(input.metadata_json);
        const updatedBy = normalizeBlockerReason(input.updated_by_principal_id);
        const nextVersion = current.version + 1;
        updateArtifactVersionStmt.run(title, stablePath, contentHash, nextVersion, metadataJson, normalizedId);
        insertVersionStmt.run(normalizedId, nextVersion, stablePath, contentHash, metadataJson, updatedBy);
        return normalizedId;
      })();
      if (!updatedId) {
        return undefined;
      }
      const row = getStmt.get(updatedId) as Record<string, unknown> | undefined;
      return row ? mapEvidenceArtifactRow(row) : undefined;
    },

    listArtifactVersions: (id: string) => {
      return (listVersionsStmt.all(id.trim()) as Array<Record<string, unknown>>).map(mapEvidenceArtifactVersionRow);
    },

    linkArtifactObject: (id: string, objectRef: ObjectRef) => {
      const normalizedId = id.trim();
      const currentRow = getStmt.get(normalizedId) as Record<string, unknown> | undefined;
      if (!currentRow) {
        return undefined;
      }
      const current = mapEvidenceArtifactRow(currentRow);
      if (current.mutability_policy !== 'editable_versioned') {
        throw new Error('immutable evidence artifacts cannot be relinked; create a superseding artifact');
      }
      const refs = appendObjectRef(current.linked_object_refs, objectRef);
      updateLinkedRefsStmt.run(JSON.stringify(refs), normalizedId);
      const row = getStmt.get(normalizedId) as Record<string, unknown> | undefined;
      return row ? mapEvidenceArtifactRow(row) : undefined;
    },

    updateHumanPathAlias: (id: string, humanPathAlias: string | null) => {
      updateAliasStmt.run(normalizeBlockerReason(humanPathAlias), id.trim());
      const row = getStmt.get(id.trim()) as Record<string, unknown> | undefined;
      return row ? mapEvidenceArtifactRow(row) : undefined;
    },
  };
}

export function createOrgScopedTaskRepository(context: OrgQueryContext): OrgScopedTaskRepository {
  const { orgId, teamId } = normalizeOrgQueryContext(context);
  const db = openEntityDatabase();
  seedFromMissionControl(db);
  const legacyRepository = createTaskRepository();

  const listStmt = db.prepare('SELECT * FROM tasks WHERE org_id = ? ORDER BY updated_at DESC, id DESC');
  const listSubtasksStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE org_id = ?
      AND (
        CASE WHEN json_valid(metadata) THEN CAST(json_extract(metadata, '$.parent_task_id') AS INTEGER) END = ?
        OR CASE WHEN json_valid(metadata) THEN CAST(json_extract(metadata, '$.parentTaskId') AS INTEGER) END = ?
        OR CASE WHEN json_valid(metadata) THEN CAST(json_extract(metadata, '$.parent_id') AS INTEGER) END = ?
      )
    ORDER BY updated_at DESC, id DESC
  `);
  const getStmt = db.prepare('SELECT * FROM tasks WHERE id = ? AND org_id = ?');
  const projectInOrgStmt = db.prepare('SELECT id FROM projects WHERE id = ? AND org_id = ?');
  const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ? AND org_id = ?');

  function assertProjectInOrg(projectId: number | null): void {
    if (!projectId) {
      return;
    }
    const project = projectInOrgStmt.get(projectId, orgId) as { id: number } | undefined;
    if (!project) {
      throw new Error('project not found in org context');
    }
  }

  return {
    orgId,
    teamId,

    listTasks: () => {
      const rows = listStmt.all(orgId) as Array<Record<string, unknown>>;
      return attachProjectsToTasksForOrg(db, orgId, rows.map(mapTaskRow));
    },

    listSubtasks: (parentTaskId: number) => {
      if (!Number.isInteger(parentTaskId) || parentTaskId <= 0) {
        return [];
      }
      const rows = listSubtasksStmt.all(orgId, parentTaskId, parentTaskId, parentTaskId) as Array<Record<string, unknown>>;
      return attachProjectsToTasksForOrg(db, orgId, rows.map(mapTaskRow));
    },

    getTask: (id: number) => {
      const row = getStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!row) {
        return undefined;
      }

      const [task] = attachProjectsToTasksForOrg(db, orgId, [mapTaskRow(row)]);
      return task;
    },

    createTask: (input: CreateTaskInput) => {
      const projectId = normalizePositiveInteger(input.project_id);
      assertProjectInOrg(projectId);
      const created = legacyRepository.createTask({
        ...input,
        org_id: orgId,
        team_id: normalizeWorkspaceId(input.team_id, teamId),
        project_id: projectId,
      });
      const scopedTask = getStmt.get(created.id, orgId) as Record<string, unknown> | undefined;
      if (!scopedTask) {
        throw new Error('Failed to create org-scoped task');
      }

      const [task] = attachProjectsToTasksForOrg(db, orgId, [mapTaskRow(scopedTask)]);
      return task;
    },

    updateTask: (id: number, updates: UpdateTaskInput) => {
      const existing = getStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!existing) {
        return undefined;
      }

      const projectId = typeof updates.project_id === 'undefined'
        ? undefined
        : normalizePositiveInteger(updates.project_id);
      if (typeof projectId !== 'undefined') {
        assertProjectInOrg(projectId);
      }

      const updated = legacyRepository.updateTask(id, {
        ...updates,
        org_id: orgId,
        team_id: typeof updates.team_id === 'string' ? updates.team_id : teamId,
        project_id: typeof projectId === 'undefined' ? updates.project_id : projectId,
      });
      if (!updated) {
        return undefined;
      }

      const row = getStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!row) {
        return undefined;
      }

      const [task] = attachProjectsToTasksForOrg(db, orgId, [mapTaskRow(row)]);
      return task;
    },

    claimTaskForTaskMaster: (id: number, input?: ClaimTaskForTaskMasterInput) => {
      const existing = getStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!existing) {
        return {
          status: 'not_found',
          claimed: false,
          reason: 'task not found',
        };
      }

      const result = legacyRepository.claimTaskForTaskMaster(id, input);
      if (result.task) {
        const scopedRow = getStmt.get(id, orgId) as Record<string, unknown> | undefined;
        if (!scopedRow) {
          return {
            status: 'not_found',
            claimed: false,
            reason: 'task not found',
          };
        }
        const [task] = attachProjectsToTasksForOrg(db, orgId, [mapTaskRow(scopedRow)]);
        result.task = task;
      }
      return result;
    },

    moveTask: (id: number, nextColumn: string) => {
      const existing = getStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!existing) {
        return undefined;
      }

      legacyRepository.moveTask(id, nextColumn);
      const row = getStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!row) {
        return undefined;
      }

      const [task] = attachProjectsToTasksForOrg(db, orgId, [mapTaskRow(row)]);
      return task;
    },

    deleteTask: (id: number) => {
      const result = deleteStmt.run(id, orgId);
      return result.changes > 0;
    },
  };
}

export function createWorkspaceScopeRepository(): WorkspaceScopeRepository {
  const db = openEntityDatabase();
  const listOrgsStmt = db.prepare('SELECT * FROM orgs ORDER BY name COLLATE NOCASE ASC, id ASC');
  const createOrgStmt = db.prepare(`
    INSERT INTO orgs (
      id,
      name,
      slug,
      status,
      deployment_mode,
      mission,
      domains_json,
      blueprint_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const getOrgStmt = db.prepare('SELECT * FROM orgs WHERE id = ?');
  const updateOrgStmt = db.prepare(`
    UPDATE orgs
    SET name = ?, slug = ?, status = ?, deployment_mode = ?, mission = ?, domains_json = ?, blueprint_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const listTeamsStmt = db.prepare(`
    SELECT * FROM teams
    WHERE org_id = ?
    ORDER BY name COLLATE NOCASE ASC, id ASC
  `);
  const createTeamStmt = db.prepare(`
    INSERT INTO teams (
      id,
      org_id,
      name,
      slug,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const getTeamStmt = db.prepare('SELECT * FROM teams WHERE id = ? AND org_id = ?');
  const updateTeamStmt = db.prepare(`
    UPDATE teams
    SET name = ?, slug = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND org_id = ?
  `);
  const listProjectsStmt = db.prepare(`
    SELECT * FROM projects
    WHERE org_id = ? AND (? IS NULL OR team_id = ?)
    ORDER BY datetime(created_at) DESC, id DESC
  `);
  const createProjectStmt = db.prepare(`
    INSERT INTO projects (
      org_id,
      team_id,
      name,
      color,
      lifecycle_state,
      project_key,
      work_domain,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const getProjectStmt = db.prepare('SELECT * FROM projects WHERE id = ? AND org_id = ?');
  const getProjectInTeamStmt = db.prepare('SELECT * FROM projects WHERE id = ? AND org_id = ? AND team_id = ?');
  const updateProjectStmt = db.prepare(`
    UPDATE projects
    SET name = ?, color = ?, lifecycle_state = ?, project_key = ?, work_domain = ?
    WHERE id = ? AND org_id = ? AND (? IS NULL OR team_id = ?)
  `);
  const getTaskInScopeStmt = db.prepare(
    'SELECT id FROM tasks WHERE id = ? AND org_id = ? AND team_id = ?',
  );
  const listTaskProjectsStmt = db.prepare(`
    SELECT
      p.id,
      p.org_id,
      p.team_id,
      p.name,
      p.color,
      p.lifecycle_state,
      p.project_key,
      p.work_domain,
      p.created_at
    FROM task_projects tp
    INNER JOIN tasks t
      ON t.id = tp.task_id
      AND t.org_id = tp.org_id
    INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tp.org_id
    WHERE tp.task_id = ?
      AND tp.org_id = ?
      AND t.team_id = ?
      AND p.team_id = ?
    ORDER BY p.name COLLATE NOCASE ASC, p.id ASC
  `);
  const addTaskProjectStmt = db.prepare(`
    INSERT OR IGNORE INTO task_projects (task_id, org_id, project_id)
    SELECT t.id, ?, p.id
    FROM tasks t
    INNER JOIN projects p ON p.id = ? AND p.org_id = ? AND p.team_id = ?
    WHERE t.id = ? AND t.org_id = ? AND t.team_id = ?
  `);
  const removeTaskProjectStmt = db.prepare(`
    DELETE FROM task_projects
    WHERE task_id = ? AND project_id = ? AND org_id = ?
      AND EXISTS (
        SELECT 1
        FROM tasks t
        INNER JOIN projects p ON p.id = task_projects.project_id
        WHERE t.id = task_projects.task_id
          AND t.org_id = task_projects.org_id
          AND p.org_id = task_projects.org_id
          AND t.team_id = ?
          AND p.team_id = ?
      )
  `);

  return {
    listOrgs: () => {
      const rows = listOrgsStmt.all() as Array<Record<string, unknown>>;
      return rows.map(mapOrgRow);
    },

    getOrg: (orgId: string) => {
      const id = normalizeWorkspaceId(orgId);
      const row = getOrgStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapOrgRow(row) : undefined;
    },

    createOrg: (input: CreateOrgInput) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error('org name is required');
      }

      const id = normalizeWorkspaceId(input.id, randomUUID());
      createOrgStmt.run(
        id,
        name,
        normalizeSlug(input.slug, name),
        normalizeBlockerReason(input.status) ?? 'active',
        normalizeBlockerReason(input.deployment_mode) ?? 'saas',
        normalizeBlockerReason(input.mission),
        normalizeJsonArrayString(input.domains_json),
        normalizeBlockerReason(input.blueprint_json)
      );
      const row = getOrgStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create org');
      }

      return mapOrgRow(row);
    },

    updateOrg: (orgId: string, updates: UpdateOrgInput) => {
      const id = normalizeWorkspaceId(orgId);
      const existing = getOrgStmt.get(id) as Record<string, unknown> | undefined;
      if (!existing) {
        return undefined;
      }

      const current = mapOrgRow(existing);
      const name = typeof updates.name === 'string' ? updates.name.trim() : current.name;
      if (!name) {
        throw new Error('org name is required');
      }
      updateOrgStmt.run(
        name,
        typeof updates.slug === 'string' ? normalizeSlug(updates.slug, name) : current.slug,
        normalizeBlockerReason(updates.status) ?? current.status,
        normalizeBlockerReason(updates.deployment_mode) ?? current.deployment_mode,
        typeof updates.mission === 'undefined' ? current.mission : normalizeBlockerReason(updates.mission),
        typeof updates.domains_json === 'undefined' ? current.domains_json : normalizeJsonArrayString(updates.domains_json),
        typeof updates.blueprint_json === 'undefined' ? current.blueprint_json : normalizeBlockerReason(updates.blueprint_json),
        id
      );
      const row = getOrgStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapOrgRow(row) : undefined;
    },

    listTeams: (context: OrgQueryContext) => {
      const { orgId } = normalizeOrgQueryContext(context);
      const rows = listTeamsStmt.all(orgId) as Array<Record<string, unknown>>;
      return rows.map(mapTeamRow);
    },

    getTeam: (context: OrgQueryContext, teamId: string) => {
      const { orgId } = normalizeOrgQueryContext(context);
      const id = normalizeWorkspaceId(teamId);
      const row = getTeamStmt.get(id, orgId) as Record<string, unknown> | undefined;
      return row ? mapTeamRow(row) : undefined;
    },

    createTeam: (context: OrgQueryContext, input: CreateTeamInput) => {
      const { orgId } = normalizeOrgQueryContext(context);
      const name = input.name.trim();
      if (!name) {
        throw new Error('team name is required');
      }

      const id = normalizeWorkspaceId(input.id, randomUUID());
      createTeamStmt.run(
        id,
        orgId,
        name,
        normalizeSlug(input.slug, name),
        normalizeBlockerReason(input.status) ?? 'active'
      );
      const row = getTeamStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create team');
      }

      return mapTeamRow(row);
    },

    updateTeam: (context: OrgQueryContext, teamId: string, updates: UpdateTeamInput) => {
      const { orgId } = normalizeOrgQueryContext(context);
      const id = normalizeWorkspaceId(teamId);
      const existing = getTeamStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!existing) {
        return undefined;
      }

      const current = mapTeamRow(existing);
      const name = typeof updates.name === 'string' ? updates.name.trim() : current.name;
      if (!name) {
        throw new Error('team name is required');
      }
      updateTeamStmt.run(
        name,
        typeof updates.slug === 'string' ? normalizeSlug(updates.slug, name) : current.slug,
        normalizeBlockerReason(updates.status) ?? current.status,
        id,
        orgId
      );
      const row = getTeamStmt.get(id, orgId) as Record<string, unknown> | undefined;
      return row ? mapTeamRow(row) : undefined;
    },

    listProjects: (context: OrgQueryContext) => {
      const { orgId, teamId } = normalizeOrgQueryContext(context);
      const rows = listProjectsStmt.all(orgId, teamId ?? null, teamId ?? null) as Array<Record<string, unknown>>;
      return rows.map(mapProjectRow);
    },

    getProject: (context: OrgQueryContext, projectId: number) => {
      const { orgId, teamId } = normalizeOrgQueryContext(context);
      const safeProjectId = normalizePositiveInteger(projectId);
      if (!safeProjectId) {
        throw new Error('project id must be a positive integer');
      }

      const row = teamId
        ? getProjectInTeamStmt.get(safeProjectId, orgId, teamId)
        : getProjectStmt.get(safeProjectId, orgId);
      return row ? mapProjectRow(row as Record<string, unknown>) : undefined;
    },

    createProject: (context: OrgQueryContext, input: CreateProjectInput) => {
      const { orgId, teamId } = normalizeOrgQueryContext(context);
      const name = input.name.trim();
      if (!name) {
        throw new Error('project name is required');
      }

      const lifecycleState = normalizeBlockerReason(input.lifecycle_state) ?? 'active';
      const result = createProjectStmt.run(
        orgId,
        teamId,
        name,
        normalizeBlockerReason(input.color),
        lifecycleState,
        normalizeProjectClassificationSlug(input.project_key, 'project_key'),
        normalizeProjectClassificationSlug(input.work_domain, 'work_domain'),
      );
      const row = getProjectStmt.get(result.lastInsertRowid as number, orgId) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create project');
      }

      return mapProjectRow(row);
    },

    updateProject: (context: OrgQueryContext, projectId: number, updates: UpdateProjectInput) => {
      const { orgId, teamId } = normalizeOrgQueryContext(context);
      const safeProjectId = normalizePositiveInteger(projectId);
      if (!safeProjectId) {
        throw new Error('project id must be a positive integer');
      }

      const existing = teamId
        ? getProjectInTeamStmt.get(safeProjectId, orgId, teamId)
        : getProjectStmt.get(safeProjectId, orgId);
      if (!existing) {
        return undefined;
      }

      const current = mapProjectRow(existing as Record<string, unknown>);
      const name = typeof updates.name === 'string' ? updates.name.trim() : current.name;
      if (!name) {
        throw new Error('project name is required');
      }
      updateProjectStmt.run(
        name,
        typeof updates.color === 'undefined' ? current.color : normalizeBlockerReason(updates.color),
        normalizeBlockerReason(updates.lifecycle_state) ?? current.lifecycle_state ?? 'active',
        typeof updates.project_key === 'undefined'
          ? current.project_key
          : normalizeProjectClassificationSlug(updates.project_key, 'project_key'),
        typeof updates.work_domain === 'undefined'
          ? current.work_domain
          : normalizeProjectClassificationSlug(updates.work_domain, 'work_domain'),
        safeProjectId,
        orgId,
        teamId ?? null,
        teamId ?? null
      );
      const row = teamId
        ? getProjectInTeamStmt.get(safeProjectId, orgId, teamId)
        : getProjectStmt.get(safeProjectId, orgId);
      return row ? mapProjectRow(row as Record<string, unknown>) : undefined;
    },

    getTaskProjects: (context: OrgQueryContext, taskId: number) => {
      const { orgId, teamId } = normalizeOrgQueryContext(context);
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const task = getTaskInScopeStmt.get(safeTaskId, orgId, teamId) as { id: number } | undefined;
      if (!task) {
        return [];
      }

      const rows = listTaskProjectsStmt.all(safeTaskId, orgId, teamId, teamId) as Array<Record<string, unknown>>;
      return rows.map(mapProjectRow);
    },

    addTaskProject: (context: OrgQueryContext, taskId: number, projectId: number) => {
      const { orgId, teamId } = normalizeOrgQueryContext(context);
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const safeProjectId = normalizePositiveInteger(projectId);
      if (!safeProjectId) {
        throw new Error('project id must be a positive integer');
      }

      const result = addTaskProjectStmt.run(
        orgId,
        safeProjectId,
        orgId,
        teamId,
        safeTaskId,
        orgId,
        teamId,
      );
      return result.changes > 0;
    },

    removeTaskProject: (context: OrgQueryContext, taskId: number, projectId: number) => {
      const { orgId, teamId } = normalizeOrgQueryContext(context);
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const safeProjectId = normalizePositiveInteger(projectId);
      if (!safeProjectId) {
        throw new Error('project id must be a positive integer');
      }

      const result = removeTaskProjectStmt.run(safeTaskId, safeProjectId, orgId, teamId, teamId);
      return result.changes > 0;
    },
  };
}

export function createActivityRepository(): ActivityRepository {
  const db = openEntityDatabase();

  const listStmt = db.prepare(`
    SELECT
      id,
      source,
      type,
      activity_event_type,
      activity_event_payload_version,
      activity_event_payload_json,
      activity_event_schema_status,
      activity_event_legacy_type,
      action,
      description,
      agent_name,
      agent_emoji,
      file_path,
      task_id,
      task_column,
      metadata,
      created_at
    FROM activities
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `);

  const listByTaskStmt = db.prepare(`
    SELECT * FROM activities
    WHERE task_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `);

  const createStmt = db.prepare(`
    INSERT INTO activities (
      source,
      type,
      activity_event_type,
      activity_event_payload_version,
      activity_event_payload_json,
      activity_event_schema_status,
      activity_event_legacy_type,
      action,
      description,
      agent_name,
      agent_emoji,
      file_path,
      task_id,
      task_column,
      metadata,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const getStmt = db.prepare('SELECT * FROM activities WHERE id = ?');

  return {
    listActivities: (limit = 100) => {
      const safeLimit = clampActivityLimit(limit);
      const rows = listStmt.all(safeLimit) as Array<Record<string, unknown>>;
      return rows.map(mapActivityRow);
    },

    listActivitiesByTaskId: (taskId: number, limit = 100) => {
      if (!Number.isInteger(taskId) || taskId < 1) {
        return [];
      }

      const safeLimit = clampActivityLimit(limit);
      const rows = listByTaskStmt.all(taskId, safeLimit) as Array<Record<string, unknown>>;
      return rows.map(mapActivityRow);
    },

    createActivity: (input: CreateActivityInput) => {
      const action = input.action.trim();
      const description = input.description.trim();
      if (!action || !description) {
        throw new Error('activity action and description are required');
      }

      const taskId = typeof input.task_id === 'number' && Number.isInteger(input.task_id) ? input.task_id : null;
      const agentName = input.agent_name?.trim() || null;
      const eventProjection = buildActivityEventProjection({
        legacyType: input.type,
        explicitEventType: input.activity_event_type,
        explicitSchemaStatus: input.activity_event_schema_status,
        payload: input.activity_event_payload,
        action,
        description,
        taskId,
        agentName,
      });

      const result = createStmt.run(
        input.source ?? 'agent',
        input.type,
        eventProjection.activity_event_type,
        eventProjection.activity_event_payload_version,
        eventProjection.activity_event_payload_json,
        eventProjection.activity_event_schema_status,
        eventProjection.activity_event_legacy_type,
        action,
        description,
        agentName,
        input.agent_emoji?.trim() || null,
        input.file_path?.trim() || null,
        taskId,
        input.task_column?.trim() || null,
        input.metadata?.trim() || null
      );

      const row = getStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create activity');
      }

      return mapActivityRow(row);
    },
  };
}

export function createNotificationRepository(): NotificationRepository {
  const db = openEntityDatabase();

  const getStmt = db.prepare('SELECT * FROM notifications WHERE id = ?');
  const listDeliveriesStmt = db.prepare(`
    SELECT *
    FROM notification_deliveries
    WHERE notification_id = ?
    ORDER BY datetime(attempted_at) ASC, id ASC
  `);
  const listByRecipientStmt = db.prepare(`
    SELECT *
    FROM notifications
    WHERE org_id = ?
      AND recipient_principal_id = ?
      AND (? = 'all' OR inbox_state = ?)
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `);
  const createStmt = db.prepare(`
    INSERT INTO notifications (
      id,
      org_id,
      recipient_principal_id,
      canonical_event_id,
      object_ref_json,
      notification_type,
      inbox_state,
      title,
      body,
      policy_reason_chain_json,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const createDeliveryStmt = db.prepare(`
    INSERT INTO notification_deliveries (
      notification_id,
      channel,
      status,
      external_ref,
      failure_reason,
      degraded_reason,
      policy_reason_json,
      attempted_at,
      completed_at,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
  `);
  const getDeliveryStmt = db.prepare('SELECT * FROM notification_deliveries WHERE id = ?');
  const updateInboxStateStmt = db.prepare(`
    UPDATE notifications
    SET inbox_state = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const withDeliveries = (row: Record<string, unknown> | undefined): NotificationRecord | undefined => {
    if (!row) {
      return undefined;
    }
    const deliveries = (listDeliveriesStmt.all(String(row.id)) as Array<Record<string, unknown>>)
      .map(mapNotificationDeliveryRow);
    return mapNotificationRow(row, deliveries);
  };

  const addDelivery = (notificationId: string, input: CreateNotificationDeliveryInput): NotificationDeliveryRecord => {
    const normalizedNotificationId = normalizeWorkspaceId(notificationId);
    const existing = getStmt.get(normalizedNotificationId) as Record<string, unknown> | undefined;
    if (!existing) {
      throw new Error('notification does not exist');
    }

    const status = normalizeNotificationDeliveryStatus(input.status);
    const result = createDeliveryStmt.run(
      normalizedNotificationId,
      normalizeNotificationDeliveryChannel(input.channel),
      status,
      normalizeBlockerReason(input.external_ref),
      normalizeBlockerReason(input.failure_reason),
      normalizeBlockerReason(input.degraded_reason),
      normalizeJsonObjectString(input.policy_reason_json),
      normalizeNullableTimestamp(input.completed_at),
      normalizeJsonObjectString(input.metadata_json)
    );
    const row = getDeliveryStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error('failed to create notification delivery');
    }
    return mapNotificationDeliveryRow(row);
  };

  return {
    createNotification: (input: CreateNotificationInput) => {
      const id = normalizeWorkspaceId(input.id, randomUUID());
      const recipientPrincipalId = normalizeBlockerReason(input.recipient_principal_id);
      const title = normalizeBlockerReason(input.title);
      if (!recipientPrincipalId) {
        throw new Error('recipient_principal_id is required');
      }
      if (!title) {
        throw new Error('notification title is required');
      }

      const canonicalEventId = normalizeBlockerReason(String(input.canonical_event_id));
      if (!canonicalEventId) {
        throw new Error('canonical_event_id is required');
      }

      createStmt.run(
        id,
        normalizeWorkspaceId(input.org_id, DEFAULT_WORKSPACE_ORG_ID),
        recipientPrincipalId,
        canonicalEventId,
        JSON.stringify(parseObjectRef(input.object_ref)),
        normalizeNotificationType(input.notification_type),
        normalizeNotificationInboxState(input.inbox_state),
        title,
        normalizeBlockerReason(input.body) ?? '',
        normalizePolicyReasonChainString(input.policy_reason_chain_json),
        normalizeJsonObjectString(input.metadata_json)
      );

      for (const delivery of input.deliveries ?? []) {
        addDelivery(id, delivery);
      }

      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      const record = withDeliveries(row);
      if (!record) {
        throw new Error('failed to create notification');
      }
      return record;
    },

    getNotification: (id: string) => withDeliveries(getStmt.get(id.trim()) as Record<string, unknown> | undefined),

    listNotificationsForRecipient: (input) => {
      const recipientPrincipalId = normalizeBlockerReason(input.recipient_principal_id);
      if (!recipientPrincipalId) {
        return [];
      }
      const inboxState = input.inbox_state === 'all' ? 'all' : normalizeNotificationInboxState(input.inbox_state);
      const limit = clampActivityLimit(input.limit ?? 100);
      return (listByRecipientStmt.all(
        normalizeWorkspaceId(input.org_id, DEFAULT_WORKSPACE_ORG_ID),
        recipientPrincipalId,
        inboxState,
        inboxState,
        limit
      ) as Array<Record<string, unknown>>)
        .map((row) => withDeliveries(row))
        .filter((record): record is NotificationRecord => Boolean(record));
    },

    updateInboxState: (id: string, inboxState: NotificationInboxState | string) => {
      const normalizedId = id.trim();
      updateInboxStateStmt.run(normalizeNotificationInboxState(inboxState), normalizedId);
      return withDeliveries(getStmt.get(normalizedId) as Record<string, unknown> | undefined);
    },

    addDeliveryAttempt: addDelivery,

    listDeliveryAttempts: (notificationId: string) =>
      (listDeliveriesStmt.all(notificationId.trim()) as Array<Record<string, unknown>>).map(mapNotificationDeliveryRow),
  };
}

export function buildNotificationFixtureSamples(overrides: {
  org_id?: string;
  recipient_principal_id?: string;
  canonical_event_id?: string;
  task_id?: string | number;
} = {}): CreateNotificationInput[] {
  const orgId = normalizeWorkspaceId(overrides.org_id, DEFAULT_WORKSPACE_ORG_ID);
  const recipientPrincipalId = normalizeWorkspaceId(overrides.recipient_principal_id, 'owner-1');
  const taskId = String(overrides.task_id ?? '42');
  const baseEventId = normalizeWorkspaceId(overrides.canonical_event_id, 'activity-event');
  const baseRef: ObjectRef = { object_type: 'task', object_id: taskId, link_role: 'target' };
  const sample = (
    notificationType: NotificationType,
    index: number,
    title: string,
    eventRole: string,
  ): CreateNotificationInput => ({
    id: `fixture-${notificationType}`,
    org_id: orgId,
    recipient_principal_id: recipientPrincipalId,
    canonical_event_id: `${baseEventId}-${index}`,
    object_ref: { ...baseRef, link_role: eventRole },
    notification_type: notificationType,
    title,
    body: `${title} requires attention in Entity.`,
    policy_reason_chain_json: JSON.stringify([
      {
        source: 'task',
        decision: 'notification_route',
        reason: `Fixture covers ${notificationType}`,
      },
    ]),
    metadata_json: JSON.stringify({ fixture: 'THE-66', notification_type: notificationType }),
    deliveries: [
      {
        channel: 'entity_inbox',
        status: 'sent',
        policy_reason_json: JSON.stringify({ reason: 'canonical inbox record is source of truth' }),
      },
    ],
  });

  return [
    sample('review_request', 1, 'Review requested', 'review'),
    sample('human_gate_request', 2, 'Human gate requested', 'approval'),
    sample('task_nudge', 3, 'Task nudge sent', 'routing'),
    sample('owner_escalation', 4, 'Owner escalation sent', 'escalation'),
    sample('auto_reassignment_notice', 5, 'Task reassigned', 'routing'),
    sample('receipt_failure', 6, 'Receipt failure detected', 'proof'),
    sample('connector_degraded', 7, 'Connector degraded', 'integration'),
    sample('policy_warning', 8, 'Policy warning', 'policy'),
  ];
}

export function createAgentLogRepository(): AgentLogRepository {
  const db = openEntityDatabase();

  const listStmt = db.prepare(`
    SELECT
      id,
      timestamp,
      event,
      task_id,
      action,
      result,
      model,
      tokens_used
    FROM agent_log
    ORDER BY datetime(timestamp) DESC, id DESC
    LIMIT ?
  `);

  const createStmt = db.prepare(`
    INSERT INTO agent_log (
      event,
      task_id,
      action,
      result,
      model,
      tokens_used,
      timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const getStmt = db.prepare('SELECT * FROM agent_log WHERE id = ?');
  const statusStmt = db.prepare(`
    SELECT
      COUNT(*) AS total_actions,
      MAX(timestamp) AS last_run
    FROM agent_log
  `);

  return {
    listLogs: (limit = 100) => {
      const safeLimit = clampAgentLogLimit(limit);
      const rows = listStmt.all(safeLimit) as Array<Record<string, unknown>>;
      return rows.map(mapAgentLogRow);
    },

    createLog: (input: CreateAgentLogInput) => {
      const event = input.event.trim();
      const action = input.action.trim();
      if (!event) {
        throw new Error('agent log event is required');
      }

      if (!action) {
        throw new Error('agent log action is required');
      }

      const rawTokensUsed = Number(input.tokens_used);
      const normalizedTokensUsed = Number.isFinite(rawTokensUsed) && rawTokensUsed > 0 ? Math.floor(rawTokensUsed) : 0;
      const taskId = typeof input.task_id === 'number' && Number.isInteger(input.task_id) ? input.task_id : null;
      const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : 'gemini-flash';
      const resultText =
        typeof input.result === 'string'
          ? input.result.trim() || null
          : input.result === null
            ? null
            : null;

      const createResult = createStmt.run(event, taskId, action, resultText, model, normalizedTokensUsed);
      const row = getStmt.get(createResult.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create agent log');
      }

      return mapAgentLogRow(row);
    },

    getStatus: () => {
      const row = statusStmt.get() as { total_actions?: number; last_run?: string | null } | undefined;
      const totalActions =
        row && typeof row.total_actions === 'number' && Number.isFinite(row.total_actions) ? row.total_actions : 0;
      const lastRun = row?.last_run ? normalizeTimestamp(String(row.last_run)) : null;
      return { lastRun, totalActions };
    },
  };
}

export function createTaskCommentRepository(): TaskCommentRepository {
  const db = openEntityDatabase();
  const maxCommentLimit = 500;

  const listStmt = db.prepare(
    `
      SELECT *
      FROM (
        SELECT * FROM task_comments
        WHERE task_id = ?
          AND (? IS NULL OR id < ?)
        ORDER BY id DESC
        LIMIT ?
      )
      ORDER BY id ASC
    `
  );
  const createStmt = db.prepare(`
    INSERT INTO task_comments (
      task_id,
      body,
      author,
      parent_id
    ) VALUES (?, ?, ?, ?)
  `);
  const getStmt = db.prepare('SELECT * FROM task_comments WHERE id = ?');

  return {
    listComments: (taskId: number, options: ListTaskCommentsOptions = {}) => {
      if (!Number.isInteger(taskId) || taskId <= 0) {
        return [];
      }
      const parsedLimit = Number(options.limit);
      const safeLimit =
        Number.isInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, maxCommentLimit)
          : maxCommentLimit;
      const parsedBeforeId = Number(options.before_id);
      const beforeId =
        Number.isInteger(parsedBeforeId) && parsedBeforeId > 0
          ? parsedBeforeId
          : null;
      const rows = listStmt.all(taskId, beforeId, beforeId, safeLimit) as Array<Record<string, unknown>>;
      return rows.map(mapTaskCommentRow);
    },

    createComment: (input: CreateTaskCommentInput) => {
      const taskId = input.task_id;
      if (!Number.isInteger(taskId) || taskId <= 0) {
        throw new Error('task_id must be a positive integer');
      }

      const body = input.body.trim();
      if (!body) {
        throw new Error('comment body is required');
      }

      const author = typeof input.author === 'string' && input.author.trim() ? input.author.trim() : 'Human';
      const parentId =
        typeof input.parent_id === 'number' && Number.isInteger(input.parent_id) && input.parent_id > 0
          ? input.parent_id
          : null;

      const result = createStmt.run(taskId, body, author, parentId);
      const row = getStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create task comment');
      }

      return mapTaskCommentRow(row);
    },
  };
}

interface StrategicRepository {
  getRoadmaps: () => RoadmapWithItemsRecord[];
  createRoadmap: (input: CreateRoadmapInput) => RoadmapRecord;
  deleteRoadmap: (id: number) => boolean;
  createRoadmapItem: (roadmapId: number, input: CreateRoadmapItemInput) => RoadmapItemRecord;
  updateRoadmapItem: (id: number, input: UpdateRoadmapItemInput) => RoadmapItemRecord | undefined;
  deleteRoadmapItem: (id: number) => boolean;
  getProjects: () => ProjectRecord[];
  createProject: (input: CreateProjectInput) => ProjectRecord;
  deleteProject: (id: number) => boolean;
  getCrews: () => CrewRecord[];
  getSubscribedCrews: (agentSlug: string) => CrewRecord[];
  createCrew: (input: CreateCrewInput) => CrewRecord;
  subscribeToCrew: (crewId: string, agentId: string) => CrewSubscriptionRecord;
  unsubscribeFromCrew: (crewId: string, agentId: string) => boolean;
  getSubscribersForCrew: (crewId: string) => CrewSubscriptionRecord[];
  getSubscriptionsForAgent: (agentId: string) => CrewSubscriptionRecord[];
  getTaskProjects: (taskId: number) => ProjectRecord[];
  addTaskProject: (taskId: number, projectId: number) => boolean;
  removeTaskProject: (taskId: number, projectId: number) => boolean;
  replaceTaskProjects: (taskId: number, projectIds: readonly number[]) => ProjectRecord[];
  getTaskHistory: (taskId: number) => TaskHistoryRecord[];
  addTaskHistory: (
    taskId: number,
    field: string,
    oldValue?: string | null,
    newValue?: string | null,
    changedBy?: string | null
  ) => TaskHistoryRecord;
}

function createStrategicRepository(): StrategicRepository {
  const db = openEntityDatabase();

  const listRoadmapsStmt = db.prepare(`
    SELECT
      r.id AS roadmap_id,
      r.name AS roadmap_name,
      r.theme AS roadmap_theme,
      r.color AS roadmap_color,
      r.created_at AS roadmap_created_at,
      ri.id AS item_id,
      ri.roadmap_id AS item_roadmap_id,
      ri.title AS item_title,
      ri.description AS item_description,
      ri.priority AS item_priority,
      ri.target_period AS item_target_period,
      ri.status AS item_status,
      ri.linked_task_id AS item_linked_task_id,
      ri.created_at AS item_created_at
    FROM roadmaps r
    LEFT JOIN roadmap_items ri ON ri.roadmap_id = r.id
    ORDER BY datetime(r.created_at) DESC, r.id DESC, datetime(ri.created_at) ASC, ri.id ASC
  `);
  const getRoadmapStmt = db.prepare('SELECT * FROM roadmaps WHERE id = ?');
  const createRoadmapStmt = db.prepare(`
    INSERT INTO roadmaps (
      name,
      theme,
      color,
      created_at
    ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const deleteRoadmapItemsByRoadmapStmt = db.prepare('DELETE FROM roadmap_items WHERE roadmap_id = ?');
  const deleteRoadmapStmt = db.prepare('DELETE FROM roadmaps WHERE id = ?');
  const deleteRoadmapTx = db.transaction((roadmapId: number) => {
    deleteRoadmapItemsByRoadmapStmt.run(roadmapId);
    return deleteRoadmapStmt.run(roadmapId);
  });

  const createRoadmapItemStmt = db.prepare(`
    INSERT INTO roadmap_items (
      roadmap_id,
      title,
      description,
      priority,
      target_period,
      status,
      linked_task_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const getRoadmapItemStmt = db.prepare('SELECT * FROM roadmap_items WHERE id = ?');
  const deleteRoadmapItemStmt = db.prepare('DELETE FROM roadmap_items WHERE id = ?');

  const listProjectsStmt = db.prepare('SELECT * FROM projects ORDER BY datetime(created_at) DESC, id DESC');
  const getProjectStmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  const createProjectStmt = db.prepare(`
    INSERT INTO projects (
      org_id,
      team_id,
      name,
      color,
      lifecycle_state,
      project_key,
      work_domain,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const deleteTaskProjectsByProjectStmt = db.prepare('DELETE FROM task_projects WHERE project_id = ?');
  const listTasksAffectedByProjectDeleteStmt = db.prepare(`
    SELECT task_id AS id FROM task_projects WHERE project_id = ?
    UNION
    SELECT id FROM tasks WHERE project_id = ?
  `);
  const clearDeletedPrimaryProjectStmt = db.prepare(
    'UPDATE tasks SET project_id = NULL WHERE project_id = ?',
  );
  const listRemainingTaskProjectNamesStmt = db.prepare(`
    SELECT p.name
    FROM task_projects tp
    INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tp.org_id
    WHERE tp.task_id = ?
    ORDER BY p.name COLLATE NOCASE ASC, p.id ASC
  `);
  const updateTaskProjectLabelStmt = db.prepare('UPDATE tasks SET project = ? WHERE id = ?');
  const deleteProjectStmt = db.prepare('DELETE FROM projects WHERE id = ?');
  const deleteProjectTx = db.transaction((projectId: number) => {
    const affectedTasks = listTasksAffectedByProjectDeleteStmt.all(
      projectId,
      projectId,
    ) as Array<{ id: number }>;
    deleteTaskProjectsByProjectStmt.run(projectId);
    clearDeletedPrimaryProjectStmt.run(projectId);
    for (const task of affectedTasks) {
      const remainingProjects = listRemainingTaskProjectNamesStmt.all(task.id) as Array<{ name: string }>;
      const label = remainingProjects.map((project) => project.name.trim()).filter(Boolean).join(', ') || 'General';
      updateTaskProjectLabelStmt.run(label, task.id);
    }
    return deleteProjectStmt.run(projectId);
  });

  const listCrewsStmt = db.prepare('SELECT * FROM crews ORDER BY datetime(updated_at) DESC, id DESC');
  const getCrewStmt = db.prepare('SELECT * FROM crews WHERE id = ?');
  const createCrewStmt = db.prepare(`
    INSERT INTO crews (
      id,
      name,
      description,
      settings,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);


  const subscribeToCrewStmt = db.prepare("INSERT INTO crew_subscriptions (crew_id, agent_id) VALUES (?, ?)");
  const unsubscribeFromCrewStmt = db.prepare("DELETE FROM crew_subscriptions WHERE crew_id = ? AND agent_id = ?");
  const getSubscribersForCrewStmt = db.prepare("SELECT * FROM crew_subscriptions WHERE crew_id = ? ORDER BY created_at ASC");
  const getSubscriptionsForAgentStmt = db.prepare("SELECT * FROM crew_subscriptions WHERE agent_id = ? ORDER BY created_at ASC");
  const getSubscriptionStmt = db.prepare("SELECT * FROM crew_subscriptions WHERE crew_id = ? AND agent_id = ?");

  const listTaskProjectsStmt = db.prepare(`
    SELECT
      p.id,
      p.org_id,
      p.team_id,
      p.name,
      p.color,
      p.lifecycle_state,
      p.project_key,
      p.work_domain,
      p.created_at
    FROM task_projects tp
    INNER JOIN tasks t ON t.id = tp.task_id AND t.org_id = tp.org_id
    INNER JOIN projects p
      ON p.id = tp.project_id
      AND p.org_id = tp.org_id
      AND p.team_id = t.team_id
    WHERE tp.task_id = ?
    ORDER BY p.name COLLATE NOCASE ASC, p.id ASC
  `);
  const addTaskProjectStmt = db.prepare(`
    INSERT OR IGNORE INTO task_projects (task_id, org_id, project_id)
    SELECT t.id, t.org_id, p.id
    FROM tasks t
    INNER JOIN projects p
      ON p.id = ?
      AND p.org_id = t.org_id
      AND p.team_id = t.team_id
    WHERE t.id = ?
  `);
  const removeTaskProjectStmt = db.prepare('DELETE FROM task_projects WHERE task_id = ? AND project_id = ?');
  const getTaskProjectScopeStmt = db.prepare(
    'SELECT org_id, team_id FROM tasks WHERE id = ?',
  );
  const deleteTaskProjectsByTaskStmt = db.prepare('DELETE FROM task_projects WHERE task_id = ?');
  const insertTaskProjectLinkStmt = db.prepare(
    'INSERT INTO task_projects (task_id, org_id, project_id) VALUES (?, ?, ?)',
  );
  const updateTaskPrimaryProjectStmt = db.prepare(
    'UPDATE tasks SET project_id = ? WHERE id = ?',
  );
  const replaceTaskProjectsTx = db.transaction((taskId: number, projectIds: readonly number[]) => {
    const task = getTaskProjectScopeStmt.get(taskId) as
      | { org_id: string; team_id: string }
      | undefined;
    if (!task) {
      throw new Error('task not found');
    }

    let projects: ProjectRecord[] = [];
    if (projectIds.length > 0) {
      const placeholders = projectIds.map(() => '?').join(', ');
      const rows = db.prepare(`
        SELECT *
        FROM projects
        WHERE id IN (${placeholders})
          AND org_id = ?
          AND team_id = ?
      `).all(...projectIds, task.org_id, task.team_id) as Array<Record<string, unknown>>;
      projects = rows.map(mapProjectRow);
      if (projects.length !== projectIds.length) {
        throw new Error('projects must belong to the task org and team');
      }
    }

    deleteTaskProjectsByTaskStmt.run(taskId);
    for (const projectId of projectIds) {
      insertTaskProjectLinkStmt.run(taskId, task.org_id, projectId);
    }

    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const orderedProjects = projectIds
      .map((projectId) => projectsById.get(projectId))
      .filter((project): project is ProjectRecord => Boolean(project));
    const label = orderedProjects.map((project) => project.name).join(', ') || 'General';
    updateTaskPrimaryProjectStmt.run(projectIds[0] ?? null, taskId);
    updateTaskProjectLabelStmt.run(label, taskId);
    return orderedProjects;
  });

  const listTaskHistoryStmt = db.prepare(
    'SELECT * FROM task_history WHERE task_id = ? ORDER BY datetime(changed_at) DESC, id DESC'
  );
  const createTaskHistoryStmt = db.prepare(`
    INSERT INTO task_history (
      task_id,
      field,
      old_value,
      new_value,
      changed_by,
      changed_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const getTaskHistoryByIdStmt = db.prepare('SELECT * FROM task_history WHERE id = ?');

  return {
    getRoadmaps: () => {
      const rows = listRoadmapsStmt.all() as Array<Record<string, unknown>>;
      const roadmapsById = new Map<number, RoadmapWithItemsRecord>();

      for (const row of rows) {
        const roadmapId = normalizePositiveInteger(row.roadmap_id);
        if (!roadmapId) {
          continue;
        }

        let roadmap = roadmapsById.get(roadmapId);
        if (!roadmap) {
          roadmap = {
            ...mapRoadmapRow({
              id: row.roadmap_id,
              name: row.roadmap_name,
              theme: row.roadmap_theme,
              color: row.roadmap_color,
              created_at: row.roadmap_created_at,
            }),
            items: [],
          };
          roadmapsById.set(roadmapId, roadmap);
        }

        const itemId = normalizePositiveInteger(row.item_id);
        if (!itemId) {
          continue;
        }

        roadmap.items.push(
          mapRoadmapItemRow({
            id: row.item_id,
            roadmap_id: row.item_roadmap_id,
            title: row.item_title,
            description: row.item_description,
            priority: row.item_priority,
            target_period: row.item_target_period,
            status: row.item_status,
            linked_task_id: row.item_linked_task_id,
            created_at: row.item_created_at,
          })
        );
      }

      return Array.from(roadmapsById.values());
    },

    createRoadmap: (input: CreateRoadmapInput) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error('roadmap name is required');
      }

      const result = createRoadmapStmt.run(
        name,
        normalizeBlockerReason(input.theme),
        normalizeBlockerReason(input.color)
      );
      const row = getRoadmapStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create roadmap');
      }

      return mapRoadmapRow(row);
    },

    deleteRoadmap: (id: number) => {
      const roadmapId = normalizePositiveInteger(id);
      if (!roadmapId) {
        throw new Error('roadmap id must be a positive integer');
      }

      const result = deleteRoadmapTx(roadmapId);
      return result.changes > 0;
    },

    createRoadmapItem: (roadmapId: number, input: CreateRoadmapItemInput) => {
      const safeRoadmapId = normalizePositiveInteger(roadmapId);
      if (!safeRoadmapId) {
        throw new Error('roadmap id must be a positive integer');
      }

      const roadmap = getRoadmapStmt.get(safeRoadmapId) as Record<string, unknown> | undefined;
      if (!roadmap) {
        throw new Error('roadmap not found');
      }

      const title = input.title.trim();
      if (!title) {
        throw new Error('roadmap item title is required');
      }

      const priority = typeof input.priority === 'string' && input.priority.trim() ? input.priority.trim() : 'P2';
      const status = typeof input.status === 'string' && input.status.trim() ? input.status.trim() : 'planned';
      const linkedTaskId = normalizePositiveInteger(input.linked_task_id);

      const result = createRoadmapItemStmt.run(
        safeRoadmapId,
        title,
        normalizeBlockerReason(input.description),
        priority,
        normalizeBlockerReason(input.target_period),
        status,
        linkedTaskId
      );

      const row = getRoadmapItemStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create roadmap item');
      }

      return mapRoadmapItemRow(row);
    },

    updateRoadmapItem: (id: number, input: UpdateRoadmapItemInput) => {
      const roadmapItemId = normalizePositiveInteger(id);
      if (!roadmapItemId) {
        throw new Error('roadmap item id must be a positive integer');
      }

      const existing = getRoadmapItemStmt.get(roadmapItemId) as Record<string, unknown> | undefined;
      if (!existing) {
        return undefined;
      }

      const fields: string[] = [];
      const values: unknown[] = [];

      if (typeof input.title === 'string') {
        const title = input.title.trim();
        if (!title) {
          throw new Error('roadmap item title cannot be empty');
        }

        fields.push('title = ?');
        values.push(title);
      }

      if (typeof input.description !== 'undefined') {
        fields.push('description = ?');
        values.push(input.description === null ? null : normalizeBlockerReason(input.description));
      }

      if (typeof input.priority === 'string') {
        fields.push('priority = ?');
        values.push(input.priority.trim() || 'P2');
      }

      if (typeof input.target_period !== 'undefined') {
        fields.push('target_period = ?');
        values.push(input.target_period === null ? null : normalizeBlockerReason(input.target_period));
      }

      if (typeof input.status === 'string') {
        fields.push('status = ?');
        values.push(input.status.trim() || 'planned');
      }

      if (typeof input.linked_task_id !== 'undefined') {
        fields.push('linked_task_id = ?');
        values.push(normalizePositiveInteger(input.linked_task_id));
      }

      if (fields.length === 0) {
        return mapRoadmapItemRow(existing);
      }

      values.push(roadmapItemId);
      db.prepare(`UPDATE roadmap_items SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      const refreshed = getRoadmapItemStmt.get(roadmapItemId) as Record<string, unknown> | undefined;
      return refreshed ? mapRoadmapItemRow(refreshed) : undefined;
    },

    deleteRoadmapItem: (id: number) => {
      const roadmapItemId = normalizePositiveInteger(id);
      if (!roadmapItemId) {
        throw new Error('roadmap item id must be a positive integer');
      }

      const result = deleteRoadmapItemStmt.run(roadmapItemId);
      return result.changes > 0;
    },

    getProjects: () => {
      const rows = listProjectsStmt.all() as Array<Record<string, unknown>>;
      return rows.map(mapProjectRow);
    },

    createProject: (input: CreateProjectInput) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error('project name is required');
      }

      const result = createProjectStmt.run(
        normalizeWorkspaceId(input.org_id, DEFAULT_WORKSPACE_ORG_ID),
        normalizeWorkspaceId(input.team_id, DEFAULT_WORKSPACE_TEAM_ID),
        name,
        normalizeBlockerReason(input.color),
        normalizeBlockerReason(input.lifecycle_state) ?? 'active',
        normalizeProjectClassificationSlug(input.project_key, 'project_key'),
        normalizeProjectClassificationSlug(input.work_domain, 'work_domain'),
      );
      const row = getProjectStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create project');
      }

      return mapProjectRow(row);
    },

    
    getSubscribedCrews: (agentSlug: string) => {
      const agent = db.prepare('SELECT id FROM entity_agents WHERE slug = ? OR name = ?').get(agentSlug, agentSlug) as { id: string } | undefined;
      if (!agent) return [];
      
      const rows = db.prepare('SELECT c.* FROM crews c JOIN subscriptions s ON c.id = s.crew_id WHERE s.agent_id = ? ORDER BY c.updated_at DESC').all(agent.id) as Array<Record<string, unknown>>;
      return rows.map(mapCrewRow);
    },
    getCrews: () => {
      const rows = listCrewsStmt.all() as Array<Record<string, unknown>>;
      return rows.map(mapCrewRow);
    },

    createCrew: (input: CreateCrewInput) => {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) {
        throw new Error('crew name is required');
      }

      const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : randomUUID();
      createCrewStmt.run(
        id,
        name,
        normalizeBlockerReason(input.description),
        normalizeBlockerReason(input.settings)
      );
      const row = getCrewStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create crew');
      }

      return mapCrewRow(row);
    },


    subscribeToCrew: (crewId: string, agentId: string) => {
      if (!crewId.trim() || !agentId.trim()) {
        throw new Error("crew_id and agent_id are required");
      }
      try {
        subscribeToCrewStmt.run(crewId, agentId);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
          throw new Error("already subscribed");
        }
        throw err;
      }
      const row = getSubscriptionStmt.get(crewId, agentId) as Record<string, unknown> | undefined;
      if (!row) throw new Error("Failed to subscribe");
      return mapCrewSubscriptionRow(row);
    },

    unsubscribeFromCrew: (crewId: string, agentId: string) => {
      const result = unsubscribeFromCrewStmt.run(crewId, agentId);
      return result.changes > 0;
    },

    getSubscribersForCrew: (crewId: string) => {
      const rows = getSubscribersForCrewStmt.all(crewId) as Array<Record<string, unknown>>;
      return rows.map(mapCrewSubscriptionRow);
    },

    getSubscriptionsForAgent: (agentId: string) => {
      const rows = getSubscriptionsForAgentStmt.all(agentId) as Array<Record<string, unknown>>;
      return rows.map(mapCrewSubscriptionRow);
    },

    deleteProject: (id: number) => {
      const projectId = normalizePositiveInteger(id);
      if (!projectId) {
        throw new Error('project id must be a positive integer');
      }

      const result = deleteProjectTx(projectId);
      return result.changes > 0;
    },

    getTaskProjects: (taskId: number) => {
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const rows = listTaskProjectsStmt.all(safeTaskId) as Array<Record<string, unknown>>;
      return rows.map(mapProjectRow);
    },

    addTaskProject: (taskId: number, projectId: number) => {
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const safeProjectId = normalizePositiveInteger(projectId);
      if (!safeProjectId) {
        throw new Error('project id must be a positive integer');
      }

      const result = addTaskProjectStmt.run(safeProjectId, safeTaskId);
      return result.changes > 0;
    },

    removeTaskProject: (taskId: number, projectId: number) => {
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const safeProjectId = normalizePositiveInteger(projectId);
      if (!safeProjectId) {
        throw new Error('project id must be a positive integer');
      }

      const result = removeTaskProjectStmt.run(safeTaskId, safeProjectId);
      return result.changes > 0;
    },

    replaceTaskProjects: (taskId: number, projectIds: readonly number[]) => {
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }
      const normalizedProjectIds = Array.from(new Set(projectIds.map((projectId) => {
        const safeProjectId = normalizePositiveInteger(projectId);
        if (!safeProjectId) {
          throw new Error('project ids must be positive integers');
        }
        return safeProjectId;
      })));
      return replaceTaskProjectsTx(safeTaskId, normalizedProjectIds);
    },

    getTaskHistory: (taskId: number) => {
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const rows = listTaskHistoryStmt.all(safeTaskId) as Array<Record<string, unknown>>;
      return rows.map(mapTaskHistoryRow);
    },

    addTaskHistory: (
      taskId: number,
      field: string,
      oldValue?: string | null,
      newValue?: string | null,
      changedBy?: string | null
    ) => {
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const normalizedField = field.trim();
      if (!normalizedField) {
        throw new Error('history field is required');
      }

      const result = createTaskHistoryStmt.run(
        safeTaskId,
        normalizedField,
        normalizeBlockerReason(oldValue),
        normalizeBlockerReason(newValue),
        normalizeBlockerReason(changedBy)
      );

      const row = getTaskHistoryByIdStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create task history entry');
      }

      return mapTaskHistoryRow(row);
    },
  };
}

let strategicRepository: StrategicRepository | null = null;

function getStrategicRepository(): StrategicRepository {
  if (!strategicRepository) {
    strategicRepository = createStrategicRepository();
  }

  return strategicRepository;
}

export function getRoadmaps(): RoadmapWithItemsRecord[] {
  return getStrategicRepository().getRoadmaps();
}

export function createRoadmap(input: CreateRoadmapInput): RoadmapRecord {
  return getStrategicRepository().createRoadmap(input);
}

export function deleteRoadmap(id: number): boolean {
  return getStrategicRepository().deleteRoadmap(id);
}

export function createRoadmapItem(roadmapId: number, input: CreateRoadmapItemInput): RoadmapItemRecord {
  return getStrategicRepository().createRoadmapItem(roadmapId, input);
}

export function updateRoadmapItem(id: number, input: UpdateRoadmapItemInput): RoadmapItemRecord | undefined {
  return getStrategicRepository().updateRoadmapItem(id, input);
}

export function deleteRoadmapItem(id: number): boolean {
  return getStrategicRepository().deleteRoadmapItem(id);
}

export function getProjects(): ProjectRecord[] {
  return getStrategicRepository().getProjects();
}

export function createProject(input: CreateProjectInput): ProjectRecord {
  return getStrategicRepository().createProject(input);
}

export function deleteProject(id: number): boolean {
  return getStrategicRepository().deleteProject(id);
}

export function getCrews(): CrewRecord[] {
  return getStrategicRepository().getCrews();
}

export function createCrew(input: CreateCrewInput): CrewRecord {
  return getStrategicRepository().createCrew(input);
}


export function subscribeToCrew(crewId: string, agentId: string): CrewSubscriptionRecord {
  return getStrategicRepository().subscribeToCrew(crewId, agentId);
}

export function unsubscribeFromCrew(crewId: string, agentId: string): boolean {
  return getStrategicRepository().unsubscribeFromCrew(crewId, agentId);
}

export function getSubscribersForCrew(crewId: string): CrewSubscriptionRecord[] {
  return getStrategicRepository().getSubscribersForCrew(crewId);
}

export function getSubscriptionsForAgent(agentId: string): CrewSubscriptionRecord[] {
  return getStrategicRepository().getSubscriptionsForAgent(agentId);
}

export function getTaskProjects(taskId: number): ProjectRecord[] {
  return getStrategicRepository().getTaskProjects(taskId);
}

export function addTaskProject(taskId: number, projectId: number): boolean {
  return getStrategicRepository().addTaskProject(taskId, projectId);
}

export function removeTaskProject(taskId: number, projectId: number): boolean {
  return getStrategicRepository().removeTaskProject(taskId, projectId);
}

export function createTaskWithProjects(
  input: CreateTaskInput,
  taskRepository: TaskRepository = createTaskRepository(),
): TaskRecord {
  const db = getEntityDatabase();
  return db.transaction(() => {
    const task = taskRepository.createTask(input);
    if (input.projectIds !== undefined) {
      replaceTaskProjects(task.id, input.projectIds);
    }
    return taskRepository.getTask(task.id) ?? task;
  })();
}

export function updateTaskWithProjects(
  taskId: number,
  updates: UpdateTaskInput,
  taskRepository: TaskRepository = createTaskRepository(),
): TaskRecord | undefined {
  const db = getEntityDatabase();
  return db.transaction(() => {
    const task = taskRepository.updateTask(taskId, updates);
    if (!task) {
      return undefined;
    }
    if (updates.projectIds !== undefined) {
      replaceTaskProjects(task.id, updates.projectIds);
    }
    return taskRepository.getTask(task.id) ?? task;
  })();
}

export function replaceTaskProjects(taskId: number, projectIds: readonly number[]): ProjectRecord[] {
  return getStrategicRepository().replaceTaskProjects(taskId, projectIds);
}

export function getTaskHistory(taskId: number): TaskHistoryRecord[] {
  return getStrategicRepository().getTaskHistory(taskId);
}

export function addTaskHistory(
  taskId: number,
  field: string,
  oldValue?: string | null,
  newValue?: string | null,
  changedBy?: string | null
): TaskHistoryRecord {
  return getStrategicRepository().addTaskHistory(taskId, field, oldValue, newValue, changedBy);
}

// Chat module re-exports
export {
  createChatRepository,
  type ChatCategoryRecord,
  type ChatChannelRecord,
  type ChatMessageRecord,
  type ChatThreadRecord,
} from "./chat";

// Agent invite kit durable foundation (THE-877 / WP2-A-02)
export {
  AGENT_INVITE_STATUSES,
  CHIEF_ROUTING_MODES,
  INVITE_CREATION_SOURCES,
  INVITE_PROGRESS_STEP_STATUSES,
  createAgentInviteRepository,
  ensureAgentInviteSchema,
  type AgentInviteProgressRecord,
  type AgentInviteRecord,
  type AgentInviteRepository,
  type AgentInviteStatus,
  type ChiefRoutingMode,
  type CreateAgentInviteInput,
  type CreateAgentInviteProgressInput,
  type InviteCreationSource,
  type InviteProgressStepStatus,
  type UpdateAgentInviteStatusInput,
} from "./agent-invites";

// Workplane ActivityEvent spine (THE-869 / WP1-C-01) — type/schema
export {
  ACTIVITY_EVENT_SPINE_TYPES,
  classifyActivityEventToSpineType,
  compareActivityEventSpineOrder,
  isActivityEventSpineType,
  normalizeActivityEventSpine,
  normalizeActivityEventSpineType,
  type ActivityEventSpine,
  type ActivityEventSpineActor,
  type ActivityEventSpineActorType,
  type ActivityEventSpineNormalizeResult,
  type ActivityEventSpineType,
} from './activity-event-spine';

// Workplane ActivityEvent spine storage (THE-870 / WP1-C-02) — task-scoped append/query
export {
  createActivityEventSpineRepository,
  ensureActivityEventSpineStoreSchema,
  type ActivityEventSpineRepository,
  type AppendActivityEventSpineInput,
  type AppendActivityEventSpineResult,
  type ListActivityEventSpineResult,
  type StoredActivityEventSpine,
} from './activity-event-spine-store';


export function getSubscribedCrews(agentSlug: string): CrewRecord[] {
  return getStrategicRepository().getSubscribedCrews(agentSlug);
}
