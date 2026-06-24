import { requestJsonWithFallback, toErrorMessage } from '../../../lib/http';

export type WorktypeFieldType = 'string' | 'enum' | 'boolean' | 'number' | 'string_array' | 'object';

export interface WorktypeFieldDefinition {
  name: string;
  type: WorktypeFieldType;
  allowed_values: string[] | null;
  risk_default: string | null;
  indexable: boolean;
  sensitivity: string;
  plan_label: string;
}

export interface WorktypeRegistryEntry {
  worktype: string;
  schema_name: string;
  schema_version: number;
  risk_default: string;
  indexable: boolean;
  sensitivity: string;
  plan_labels: string[];
  fields: WorktypeFieldDefinition[];
}

export type WorktypeOverlayValues = Record<string, string | boolean>;

export const WORKTYPE_DISPLAY_ORDER = ['general', 'sales', 'customer_success', 'people', 'business_ops'];

const SYSTEM_FIELD_NAMES = new Set([
  'reviewer_principal_id',
  'approver_principal_id',
  'taskmaster_drivable',
  'auto_reassign_after_hours',
]);

export const FALLBACK_WORKTYPE_REGISTRY: WorktypeRegistryEntry[] = [
  {
    worktype: 'sales',
    schema_name: 'entity.worktype.sales',
    schema_version: 1,
    risk_default: 'medium',
    indexable: true,
    sensitivity: 'customer',
    plan_labels: ['Sales overlay', 'Account plan'],
    fields: [
      { name: 'account', type: 'string', allowed_values: null, risk_default: null, indexable: true, sensitivity: 'customer', plan_label: 'Account' },
      { name: 'deal_stage', type: 'enum', allowed_values: ['lead', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'], risk_default: 'medium', indexable: true, sensitivity: 'customer', plan_label: 'Deal stage' },
      { name: 'next_action', type: 'string', allowed_values: null, risk_default: null, indexable: true, sensitivity: 'customer', plan_label: 'Next action' },
      { name: 'external_send_risk', type: 'enum', allowed_values: ['none', 'low', 'medium', 'high', 'critical'], risk_default: 'high', indexable: false, sensitivity: 'customer', plan_label: 'External send risk' },
      { name: 'crm_side_effect_type', type: 'enum', allowed_values: ['none', 'crm_update', 'customer_commitment'], risk_default: 'medium', indexable: false, sensitivity: 'customer', plan_label: 'CRM side effect' },
    ],
  },
  {
    worktype: 'customer_success',
    schema_name: 'entity.worktype.customer_success',
    schema_version: 1,
    risk_default: 'medium',
    indexable: true,
    sensitivity: 'customer',
    plan_labels: ['Customer success', 'Customer commitment'],
    fields: [
      { name: 'customer', type: 'string', allowed_values: null, risk_default: null, indexable: true, sensitivity: 'customer', plan_label: 'Customer' },
      { name: 'health_state', type: 'enum', allowed_values: ['healthy', 'watch', 'at_risk', 'critical'], risk_default: 'medium', indexable: true, sensitivity: 'customer', plan_label: 'Health state' },
      { name: 'renewal_marker', type: 'enum', allowed_values: ['none', 'upcoming', 'at_risk', 'blocked'], risk_default: 'medium', indexable: true, sensitivity: 'customer', plan_label: 'Renewal marker' },
      { name: 'escalation_marker', type: 'enum', allowed_values: ['none', 'support', 'account', 'executive'], risk_default: 'high', indexable: true, sensitivity: 'customer', plan_label: 'Escalation marker' },
      { name: 'support_context', type: 'string', allowed_values: null, risk_default: null, indexable: true, sensitivity: 'customer', plan_label: 'Support context' },
      { name: 'sla_risk', type: 'enum', allowed_values: ['none', 'low', 'medium', 'high', 'critical'], risk_default: 'high', indexable: false, sensitivity: 'customer', plan_label: 'SLA risk' },
      { name: 'customer_impact_risk', type: 'enum', allowed_values: ['none', 'low', 'medium', 'high', 'critical'], risk_default: 'high', indexable: false, sensitivity: 'customer', plan_label: 'Customer impact risk' },
      { name: 'external_response_risk', type: 'enum', allowed_values: ['none', 'low', 'medium', 'high', 'critical'], risk_default: 'medium', indexable: false, sensitivity: 'customer', plan_label: 'External response risk' },
    ],
  },
  {
    worktype: 'people',
    schema_name: 'entity.worktype.people',
    schema_version: 1,
    risk_default: 'high',
    indexable: true,
    sensitivity: 'workspace_restricted',
    plan_labels: ['People overlay', 'HR workflow'],
    fields: [
      { name: 'candidate_ref', type: 'string', allowed_values: null, risk_default: null, indexable: true, sensitivity: 'workspace_restricted', plan_label: 'Candidate reference' },
      { name: 'employee_ref', type: 'string', allowed_values: null, risk_default: null, indexable: true, sensitivity: 'workspace_restricted', plan_label: 'Employee reference' },
      { name: 'workflow_stage', type: 'enum', allowed_values: ['sourcing', 'interviewing', 'offer', 'onboarding', 'employee_update', 'offboarding'], risk_default: 'medium', indexable: true, sensitivity: 'workspace_restricted', plan_label: 'Workflow stage' },
      { name: 'sensitivity_class', type: 'enum', allowed_values: ['standard', 'people', 'confidential', 'restricted'], risk_default: 'high', indexable: false, sensitivity: 'workspace_restricted', plan_label: 'Sensitivity class' },
      { name: 'hr_side_effect_type', type: 'enum', allowed_values: ['none', 'candidate_message', 'employee_record_update', 'compensation_change', 'access_change', 'termination'], risk_default: 'high', indexable: false, sensitivity: 'workspace_restricted', plan_label: 'HR side effect' },
      { name: 'checklist_state', type: 'enum', allowed_values: ['not_started', 'in_progress', 'blocked', 'complete'], risk_default: 'medium', indexable: true, sensitivity: 'workspace_restricted', plan_label: 'Checklist state' },
      { name: 'approval_required', type: 'boolean', allowed_values: null, risk_default: 'high', indexable: false, sensitivity: 'none', plan_label: 'Approval required' },
    ],
  },
  {
    worktype: 'business_ops',
    schema_name: 'entity.worktype.business_ops',
    schema_version: 1,
    risk_default: 'medium',
    indexable: true,
    sensitivity: 'workspace_restricted',
    plan_labels: ['Business operations', 'Operational checklist'],
    fields: [
      { name: 'process_area', type: 'enum', allowed_values: ['finance', 'legal', 'people', 'ops', 'sales'], risk_default: 'medium', indexable: true, sensitivity: 'workspace_restricted', plan_label: 'Process area' },
      { name: 'approval_path', type: 'string_array', allowed_values: null, risk_default: null, indexable: false, sensitivity: 'workspace_restricted', plan_label: 'Approval path' },
    ],
  },
];

export function orderedWorktypes(entries: WorktypeRegistryEntry[]): WorktypeRegistryEntry[] {
  return [...entries].sort((left, right) => {
    const leftIndex = WORKTYPE_DISPLAY_ORDER.indexOf(left.worktype);
    const rightIndex = WORKTYPE_DISPLAY_ORDER.indexOf(right.worktype);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });
}

export function getWorktypeLabel(entry: WorktypeRegistryEntry): string {
  return entry.plan_labels[0] ?? entry.worktype.replace(/_/g, ' ');
}

export function isDomainOverlayField(field: WorktypeFieldDefinition): boolean {
  return !SYSTEM_FIELD_NAMES.has(field.name) && field.type !== 'object';
}

export function getEditableWorktypeFields(entry: WorktypeRegistryEntry): WorktypeFieldDefinition[] {
  return entry.fields.filter(isDomainOverlayField);
}

export function getIndexableWorktypeFields(entries: WorktypeRegistryEntry[]): Array<{ worktype: string; field: WorktypeFieldDefinition }> {
  return entries.flatMap((entry) =>
    entry.fields
      .filter((field) => field.indexable && isDomainOverlayField(field))
      .map((field) => ({ worktype: entry.worktype, field }))
  );
}

export function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function readWorktypeLayer(record: Record<string, unknown> | null): Record<string, unknown> {
  const policyInputs = parseJsonRecord(record?.policy_inputs_json ?? record?.policy_inputs);
  const layers = parseJsonRecord(policyInputs?.layers);
  const policyLayer = parseJsonRecord(layers?.worktype);
  const directLayer = parseJsonRecord(record?.worktype_overlay);
  return {
    ...(policyLayer ?? {}),
    ...(directLayer ?? {}),
  };
}

export function readWorktype(record: Record<string, unknown> | null, fallback?: unknown): string {
  const layer = readWorktypeLayer(record);
  const candidate = typeof fallback === 'string' ? fallback : typeof layer.worktype === 'string' ? layer.worktype : record?.worktype;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : 'general';
}

export function buildPolicyInputsJson(worktype: string, values: WorktypeOverlayValues): string | undefined {
  if (worktype === 'general') return undefined;
  const cleanValues: Record<string, unknown> = { worktype };
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'boolean') {
      cleanValues[key] = value;
    } else if (typeof value === 'string' && value.trim()) {
      cleanValues[key] = value.trim();
    }
  }
  return JSON.stringify({ layers: { worktype: cleanValues } });
}

export function formatOverlayValue(value: unknown): string | null {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim().replace(/_/g, ' ');
  if (Array.isArray(value)) {
    const entries = value.map(formatOverlayValue).filter((entry): entry is string => Boolean(entry));
    return entries.length > 0 ? entries.join(', ') : null;
  }
  return null;
}

export async function fetchWorktypeRegistry(apiBase = ''): Promise<WorktypeRegistryEntry[]> {
  try {
    const payload = await requestJsonWithFallback({
      urls: [`${apiBase}/api/worktype-registry`, `${apiBase}/worktype-registry`],
      fallbackError: 'Unable to load worktype registry.',
    });
    const record = parseJsonRecord(payload);
    if (Array.isArray(record?.worktypes)) {
      return orderedWorktypes(record.worktypes as WorktypeRegistryEntry[]);
    }
  } catch (error) {
    console.warn(toErrorMessage(error, 'Using bundled worktype registry fallback.'));
  }
  return orderedWorktypes(FALLBACK_WORKTYPE_REGISTRY);
}
