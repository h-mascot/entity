export type PermissionAction = 'read' | 'preview' | 'search' | 'notify' | 'write';
export type PermissionRole = 'none' | 'viewer' | 'contributor' | 'manager' | 'admin';
export type ProtectedObjectType =
  | 'task'
  | 'native_document'
  | 'external_document_ref'
  | 'evidence_artifact'
  | 'activity'
  | 'search_result'
  | 'notification';

export type SensitivityCategory =
  | 'none'
  | 'hr'
  | 'customer'
  | 'legal'
  | 'financial'
  | 'security'
  | 'production'
  | 'confidential_strategy'
  | 'workspace_defined';

export interface PrincipalGrant {
  role: PermissionRole;
  org_id?: string | null;
  team_id?: string | null;
  project_id?: number | string | null;
  sensitivity_categories?: string[];
}

export interface PrincipalPermissionContext {
  principal_id: string;
  grants: PrincipalGrant[];
}

export interface ProtectedObjectScope {
  org_id?: string | null;
  team_id?: string | null;
  project_id?: number | string | null;
}

export interface ProtectedObject extends ProtectedObjectScope {
  object_type: ProtectedObjectType;
  object_id: string | number;
  title?: string | null;
  snippet?: string | null;
  content?: string | null;
  sensitivity?: string | null;
  acl_json?: string | null;
  entity_visibility_policy_json?: string | null;
}

export interface ObjectAclRule {
  principal_id?: string;
  role?: PermissionRole;
  min_role?: PermissionRole;
  action?: PermissionAction;
  actions?: PermissionAction[];
}

export interface ObjectAclPolicy {
  required_role?: PermissionRole;
  min_role?: PermissionRole;
  allowed_principal_ids?: string[];
  denied_principal_ids?: string[];
  allow?: ObjectAclRule[];
  deny?: ObjectAclRule[];
  sensitivity?: string | string[];
  restricted?: boolean;
  allow_preview?: boolean;
}

export interface PermissionDecision {
  allowed: boolean;
  action: PermissionAction;
  object_type: ProtectedObjectType;
  object_id: string;
  principal_id: string;
  effective_role: PermissionRole;
  required_role: PermissionRole;
  sensitivity_categories: SensitivityCategory[];
  reasons: string[];
  redacted: {
    title: string | null;
    snippet: string | null;
    content: string | null;
  };
}

const ROLE_RANK: Record<PermissionRole, number> = {
  none: 0,
  viewer: 1,
  contributor: 2,
  manager: 3,
  admin: 4,
};

const SENSITIVITY_ALIASES: Record<string, SensitivityCategory> = {
  none: 'none',
  standard: 'none',
  people: 'hr',
  hr: 'hr',
  human_resources: 'hr',
  workspace_restricted: 'workspace_defined',
  restricted: 'workspace_defined',
  workspace: 'workspace_defined',
  customer: 'customer',
  legal: 'legal',
  financial: 'financial',
  finance: 'financial',
  security: 'security',
  production: 'production',
  prod: 'production',
  confidential: 'confidential_strategy',
  confidential_strategy: 'confidential_strategy',
  strategy: 'confidential_strategy',
};

function normalizeRole(value: unknown): PermissionRole {
  return value === 'viewer' || value === 'contributor' || value === 'manager' || value === 'admin' ? value : 'none';
}

function higherRole(left: PermissionRole, right: PermissionRole): PermissionRole {
  return ROLE_RANK[left] >= ROLE_RANK[right] ? left : right;
}

function roleMeets(role: PermissionRole, required: PermissionRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

function normalizeScopeId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim());
}

function readAclRules(value: unknown): ObjectAclRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
    .map((entry) => ({
      principal_id: typeof entry.principal_id === 'string' ? entry.principal_id : undefined,
      role: normalizeRole(entry.role),
      min_role: normalizeRole(entry.min_role),
      action: typeof entry.action === 'string' ? entry.action as PermissionAction : undefined,
      actions: Array.isArray(entry.actions) ? entry.actions.filter((action): action is PermissionAction => isPermissionAction(action)) : undefined,
    }));
}

function readAclPolicy(...values: Array<string | null | undefined>): ObjectAclPolicy {
  const merged = values.reduce<Record<string, unknown>>((acc, value) => ({ ...acc, ...parseJsonRecord(value) }), {});
  return {
    required_role: normalizeRole(merged.required_role),
    min_role: normalizeRole(merged.min_role),
    allowed_principal_ids: readStringArray(merged.allowed_principal_ids),
    denied_principal_ids: readStringArray(merged.denied_principal_ids),
    allow: readAclRules(merged.allow),
    deny: readAclRules(merged.deny),
    sensitivity: typeof merged.sensitivity === 'string' || Array.isArray(merged.sensitivity) ? merged.sensitivity as string | string[] : undefined,
    restricted: merged.restricted === true,
    allow_preview: typeof merged.allow_preview === 'boolean' ? merged.allow_preview : undefined,
  };
}

function isPermissionAction(value: unknown): value is PermissionAction {
  return value === 'read' || value === 'preview' || value === 'search' || value === 'notify' || value === 'write';
}

function actionMatches(rule: ObjectAclRule, action: PermissionAction): boolean {
  if (rule.action && rule.action !== action) return false;
  if (rule.actions && rule.actions.length > 0 && !rule.actions.includes(action)) return false;
  return true;
}

function ruleMatches(rule: ObjectAclRule, principal: PrincipalPermissionContext, effectiveRole: PermissionRole, action: PermissionAction): boolean {
  if (!actionMatches(rule, action)) return false;
  if (rule.principal_id && rule.principal_id !== principal.principal_id) return false;
  if (rule.role && rule.role !== 'none' && rule.role !== effectiveRole) return false;
  if (rule.min_role && rule.min_role !== 'none' && !roleMeets(effectiveRole, rule.min_role)) return false;
  return Boolean(rule.principal_id || rule.role !== 'none' || rule.min_role !== 'none');
}

export function normalizeSensitivityCategories(...values: unknown[]): SensitivityCategory[] {
  const categories = new Set<SensitivityCategory>();
  for (const value of values) {
    const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : [];
    for (const entry of entries) {
      const normalized = SENSITIVITY_ALIASES[String(entry).trim().toLowerCase()];
      if (normalized && normalized !== 'none') categories.add(normalized);
    }
  }
  return categories.size > 0 ? [...categories] : ['none'];
}

function grantCoversObject(grant: PrincipalGrant, object: ProtectedObjectScope): boolean {
  const grantOrg = normalizeScopeId(grant.org_id);
  const grantTeam = normalizeScopeId(grant.team_id);
  const grantProject = normalizeScopeId(grant.project_id);
  const objectOrg = normalizeScopeId(object.org_id);
  const objectTeam = normalizeScopeId(object.team_id);
  const objectProject = normalizeScopeId(object.project_id);

  if (!grantOrg && !grantTeam && !grantProject) return normalizeRole(grant.role) === 'admin';
  if (grantOrg && objectOrg && grantOrg !== objectOrg) return false;
  if (grantTeam && objectTeam && grantTeam !== objectTeam) return false;
  if (grantProject && objectProject && grantProject !== objectProject) return false;
  if (grantProject && !objectProject) return false;
  if (grantTeam && !objectTeam && !objectProject) return false;
  return true;
}

export function resolveInheritedRole(principal: PrincipalPermissionContext, object: ProtectedObjectScope): PermissionRole {
  return principal.grants.reduce<PermissionRole>((role, grant) => {
    return grantCoversObject(grant, object) ? higherRole(role, normalizeRole(grant.role)) : role;
  }, 'none');
}

function principalSensitivityCategories(principal: PrincipalPermissionContext, object: ProtectedObjectScope): Set<string> {
  const categories = new Set<string>();
  for (const grant of principal.grants) {
    if (grantCoversObject(grant, object)) {
      for (const category of grant.sensitivity_categories ?? []) {
        categories.add(category.trim().toLowerCase());
      }
    }
  }
  return categories;
}

function canReadSensitivity(principal: PrincipalPermissionContext, object: ProtectedObject, categories: SensitivityCategory[]): boolean {
  const allowed = principalSensitivityCategories(principal, object);
  return categories.every((category) => category === 'none' || allowed.has('*') || allowed.has('all_sensitive') || allowed.has(category));
}

function requiredRoleForAction(action: PermissionAction): PermissionRole {
  return action === 'write' ? 'contributor' : 'viewer';
}

function deniedEnvelope(input: {
  principal: PrincipalPermissionContext;
  object: ProtectedObject;
  action: PermissionAction;
  effectiveRole: PermissionRole;
  requiredRole: PermissionRole;
  sensitivityCategories: SensitivityCategory[];
  reasons: string[];
}): PermissionDecision {
  return {
    allowed: false,
    action: input.action,
    object_type: input.object.object_type,
    object_id: String(input.object.object_id),
    principal_id: input.principal.principal_id,
    effective_role: input.effectiveRole,
    required_role: input.requiredRole,
    sensitivity_categories: input.sensitivityCategories,
    reasons: input.reasons,
    redacted: { title: null, snippet: null, content: null },
  };
}

export function evaluatePermission(input: {
  principal: PrincipalPermissionContext;
  object: ProtectedObject;
  action?: PermissionAction;
}): PermissionDecision {
  const action = input.action ?? 'read';
  const acl = readAclPolicy(input.object.entity_visibility_policy_json, input.object.acl_json);
  const effectiveRole = resolveInheritedRole(input.principal, input.object);
  const aclRequiredRole = higherRole(normalizeRole(acl.required_role), normalizeRole(acl.min_role));
  const requiredRole = higherRole(requiredRoleForAction(action), aclRequiredRole);
  const sensitivityCategories = normalizeSensitivityCategories(input.object.sensitivity, acl.sensitivity);
  const reasons: string[] = [];

  if (acl.restricted) reasons.push('object policy is restricted');
  if (acl.allow_preview === false && (action === 'preview' || action === 'search')) reasons.push('object policy disables preview/search');
  if (acl.denied_principal_ids?.includes(input.principal.principal_id)) reasons.push('principal denied by object policy');
  if (acl.deny?.some((rule) => ruleMatches(rule, input.principal, effectiveRole, action))) reasons.push('principal denied by object rule');
  if (!roleMeets(effectiveRole, requiredRole)) reasons.push(`requires ${requiredRole} role`);
  if (!canReadSensitivity(input.principal, input.object, sensitivityCategories)) {
    reasons.push(`requires sensitivity clearance: ${sensitivityCategories.filter((entry) => entry !== 'none').join(', ')}`);
  }

  const explicitlyAllowed =
    acl.allowed_principal_ids?.includes(input.principal.principal_id) ||
    acl.allow?.some((rule) => ruleMatches(rule, input.principal, effectiveRole, action));

  if (acl.allowed_principal_ids && acl.allowed_principal_ids.length > 0 && !explicitlyAllowed) {
    reasons.push('object policy allows only listed principals');
  }

  if (reasons.length > 0) {
    return deniedEnvelope({
      principal: input.principal,
      object: input.object,
      action,
      effectiveRole,
      requiredRole,
      sensitivityCategories,
      reasons,
    });
  }

  return {
    allowed: true,
    action,
    object_type: input.object.object_type,
    object_id: String(input.object.object_id),
    principal_id: input.principal.principal_id,
    effective_role: effectiveRole,
    required_role: requiredRole,
    sensitivity_categories: sensitivityCategories,
    reasons: explicitlyAllowed ? ['allowed by inherited role and object policy'] : ['allowed by inherited role'],
    redacted: {
      title: input.object.title ?? null,
      snippet: input.object.snippet ?? null,
      content: input.object.content ?? null,
    },
  };
}

export function buildPermissionSafeEnvelope<T extends ProtectedObject>(principal: PrincipalPermissionContext, object: T, action: PermissionAction = 'read') {
  const decision = evaluatePermission({ principal, object, action });
  if (!decision.allowed) {
    return {
      permission: decision,
      object: {
        object_type: object.object_type,
        object_id: String(object.object_id),
        title: null,
        snippet: null,
        content: null,
      },
    };
  }
  return { permission: decision, object };
}

export function filterAccessibleObjects<T extends ProtectedObject>(
  principal: PrincipalPermissionContext,
  objects: T[],
  action: PermissionAction = 'search',
): T[] {
  return objects.filter((object) => evaluatePermission({ principal, object, action }).allowed);
}
