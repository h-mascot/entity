import { Router, type Request, type Response } from 'express';
import {
  CURACEL_AUDIT_CATEGORIES,
  CURACEL_CONNECTOR_TYPES,
  CURACEL_REVIEW_OUTCOMES,
  CURACEL_TEAM_TYPES,
  createCuracelOperationsRepository,
  type CuracelOperationsRepository,
  type CuracelTeamType,
} from '../../../db/src/curacel-operations';
import { createRequireAdminPrincipal } from '../middleware/admin-auth';
import { resolveRequestActorId } from '../principals/request-context';
import { readDefaultOrgId } from '../config/admin-runtime';

export interface CuracelOperationsRouterDependencies {
  /** Test seam: skip the admin-principal gate (focused logic tests). */
  skipAdminAuth?: boolean;
  operationsRepo?: CuracelOperationsRepository;
  now?: () => Date;
}

class OperationsRouteError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

const PROTECTED_ACTIONS = [
  'claims',
  'finance',
  'customer_external_communication',
] as const;

const DEFAULT_DASHBOARDS: Array<{
  id: string;
  team_id: string;
  team_type: CuracelTeamType;
  queue_label: string;
  approval_sla_minutes: number;
  policies: Record<string, unknown>;
  agent_permissions: string[];
}> = [
  {
    id: 'claims',
    team_id: 'claims',
    team_type: 'claims',
    queue_label: 'Claims review queue',
    approval_sla_minutes: 30,
    policies: { external_actions_require_review: true },
    agent_permissions: ['claims:read', 'claims:draft'],
  },
  {
    id: 'customer-success',
    team_id: 'customer-success',
    team_type: 'customer_success',
    queue_label: 'Customer Success queue',
    approval_sla_minutes: 20,
    policies: { customer_communications_require_review: true },
    agent_permissions: ['customers:read', 'communications:draft'],
  },
  {
    id: 'finance',
    team_id: 'finance',
    team_type: 'finance',
    queue_label: 'Finance approval queue',
    approval_sla_minutes: 60,
    policies: { financial_actions_require_review: true },
    agent_permissions: ['finance:read', 'finance:draft'],
  },
  {
    id: 'ai-ops',
    team_id: 'ai-ops',
    team_type: 'ai_ops',
    queue_label: 'AI Operations queue',
    approval_sla_minutes: 15,
    policies: { reliability_incidents_require_review: true },
    agent_permissions: ['agents:observe', 'policies:recommend'],
  },
];

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperationsRouteError(400, 'CURACEL_OPERATIONS_INVALID', `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string, maximum = 240): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OperationsRouteError(400, 'CURACEL_OPERATIONS_INVALID', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new OperationsRouteError(400, 'CURACEL_OPERATIONS_INVALID', `${field} is too long`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maximum = 240): string | undefined {
  if (value == null || value === '') return undefined;
  return stringValue(value, field, maximum);
}

function safeId(value: unknown, field: string): string {
  const normalized = stringValue(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(normalized)) {
    throw new OperationsRouteError(
      400,
      'CURACEL_OPERATIONS_INVALID',
      `${field} contains unsupported characters`,
    );
  }
  return normalized;
}

function optionalSafeId(value: unknown, field: string): string | undefined {
  return value == null || value === '' ? undefined : safeId(value, field);
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new OperationsRouteError(
      400,
      'CURACEL_OPERATIONS_INVALID',
      `${field} must be an integer of at least ${minimum}`,
    );
  }
  return parsed;
}

function boolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') {
    throw new OperationsRouteError(400, 'CURACEL_OPERATIONS_INVALID', `${field} must be a boolean`);
  }
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new OperationsRouteError(400, 'CURACEL_OPERATIONS_INVALID', `${field} must be an array`);
  }
  return [...new Set(value.map((item) => stringValue(item, field)))];
}

function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new OperationsRouteError(
      400,
      'CURACEL_OPERATIONS_INVALID',
      `${field} must be one of ${allowed.join(', ')}`,
    );
  }
  return value as T;
}

function actor(req: Request): string {
  return resolveRequestActorId(req, 'entity-system');
}

// REC-006 adaptation: the historical line enforced org owner/admin membership
// from its session principal; current main uses the persisted admin-principal
// model, so operations management requires an admin principal (same posture as
// the rest of main's org-management routes). skipAdminAuth is a test seam.
function createOperationsAdminGuard(skipAdminAuth: boolean) {
  const requireAdminPrincipal = createRequireAdminPrincipal();
  return (req: Request, res: Response, next: () => void): void => {
    if (skipAdminAuth) {
      next();
      return;
    }
    requireAdminPrincipal(req, res, next);
  };
}

function rejectSecretFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectSecretFields);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|authorization)/i.test(key)) {
      throw new OperationsRouteError(
        400,
        'RAW_CREDENTIAL_REJECTED',
        'Raw credentials and secrets are not accepted; use a scoped credential reference.',
      );
    }
    rejectSecretFields(child);
  }
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof OperationsRouteError) {
    res.status(error.statusCode).json({ code: error.code, error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : 'Curacel operations request failed';
  const notFound = /not found/i.test(message);
  const forbidden = /cannot bypass|cannot be enabled|cannot be disabled|must be dry_run/i.test(message);
  const rawCredential = /raw credential|secret-store reference/i.test(message);
  res.status(notFound ? 404 : forbidden ? 422 : 400).json({
    code: notFound
      ? 'CURACEL_OPERATIONS_NOT_FOUND'
      : rawCredential
        ? 'RAW_CREDENTIAL_REJECTED'
        : forbidden
          ? 'REVIEW_GATE_REQUIRED'
          : 'CURACEL_OPERATIONS_INVALID',
    error: message,
  });
}

function bodyTeamId(body: Record<string, unknown>): string | undefined {
  return optionalSafeId(body.teamId ?? body.team_id, 'team id');
}

function auditFilters(req: Request, orgId: string, teamId?: string) {
  const categoryValue = optionalString(req.query.category ?? req.query.kind, 'audit category');
  const normalizedCategory = categoryValue === 'output' ? 'agent_output' : categoryValue;
  const taskValue = optionalString(req.query.taskId, 'task id');
  return {
    org_id: orgId,
    ...(teamId ? { team_id: teamId } : {}),
    ...(optionalSafeId(req.query.agentId, 'agent id')
      ? { agent_id: optionalSafeId(req.query.agentId, 'agent id') }
      : {}),
    ...(taskValue ? { task_id: integer(taskValue, 'task id', 1) } : {}),
    ...(normalizedCategory
      ? { category: enumValue(normalizedCategory, 'audit category', CURACEL_AUDIT_CATEGORIES) }
      : {}),
    limit: Math.min(integer(req.query.limit ?? 100, 'limit', 1), 500),
  };
}

function dashboardDefaults(orgId: string) {
  return DEFAULT_DASHBOARDS.map((dashboard) => ({
    ...dashboard,
    org_id: orgId,
    actor_principal_id: 'protected-default',
    created_at: null,
    updated_at: null,
    source: 'protected_default',
  }));
}

export function createCuracelOperationsRouter(
  dependencies: CuracelOperationsRouterDependencies = {},
): Router {
  const router = Router();
  const operations = dependencies.operationsRepo ?? createCuracelOperationsRepository();
  const now = dependencies.now ?? (() => new Date());
  const requireAdmin = createOperationsAdminGuard(Boolean(dependencies.skipAdminAuth));

  router.get('/curacel/operations', requireAdmin, (req, res) => {
    try {
      // An absent orgId resolves to the workspace default org (the operations
      // center probes once before its org filter is set).
      const orgId = typeof req.query.orgId === 'string' && req.query.orgId.trim()
        ? safeId(req.query.orgId, 'organization id')
        : readDefaultOrgId();
      const teamId = optionalSafeId(req.query.teamId, 'team id');
      const policies = PROTECTED_ACTIONS.map((action) => {
        const policy = operations.resolveReviewPolicy({ org_id: orgId, team_id: teamId, action });
        return {
          ...policy,
          area: action,
          label: action === 'claims'
            ? 'Claims external actions'
            : action === 'finance'
              ? 'Finance external actions'
              : 'Customer communications',
          reviewer_roles: policy.approver_roles,
          bypass_blocked: true,
        };
      });
      const connectors = operations.listConnectors(orgId, teamId);
      const connectorIds = new Set(connectors.map((connector) => connector.id));
      const drafts = operations.listConnectorDrafts(orgId)
        .filter((draft) => !teamId || connectorIds.has(draft.connector_id));
      const latestDraftByConnector = new Map<string, string>();
      for (const draft of drafts) {
        if (!latestDraftByConnector.has(draft.connector_id)) {
          latestDraftByConnector.set(draft.connector_id, draft.created_at);
        }
      }
      const persistedDashboards = operations.listTeamDashboards(orgId);
      const dashboardByType = new Map<CuracelTeamType, (typeof persistedDashboards)[number]>(
        persistedDashboards.map((dashboard) => [dashboard.team_type, dashboard]),
      );
      const teams = dashboardDefaults(orgId).map((fallback) =>
        dashboardByType.get(fallback.team_type) ?? fallback);
      for (const dashboard of persistedDashboards) {
        if (!teams.some((candidate) => candidate.id === dashboard.id)) teams.push(dashboard);
      }
      const filteredTeams = teamId
        ? teams.filter((dashboard) => dashboard.team_id === teamId || dashboard.id === teamId)
        : teams;
      const audit = operations.listAudit(auditFilters(req, orgId, teamId));
      const reliability = operations.getUsageReport({
        org_id: orgId,
        ...(teamId ? { team_id: teamId } : {}),
        ...(optionalSafeId(req.query.agentId, 'agent id')
          ? { agent_id: optionalSafeId(req.query.agentId, 'agent id') }
          : {}),
      });
      res.json({
        orgId,
        teamId: teamId ?? '',
        generatedAt: now().toISOString(),
        policies,
        audit,
        connectors: connectors.map((connector) => ({
          ...connector,
          last_draft_at: latestDraftByConnector.get(connector.id) ?? null,
        })),
        drafts,
        teams: filteredTeams,
        reliability,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/orgs/:orgId/curacel/review-policies/:action', requireAdmin, (req, res) => {
    try {
      const body = record(req.body, 'body');
      const action = safeId(req.params.action, 'action').toLowerCase();
      const policy = operations.upsertReviewPolicy({
        org_id: safeId(req.params.orgId, 'organization id'),
        team_id: bodyTeamId(body),
        action,
        review_required: boolean(body.reviewRequired ?? body.review_required, 'review required', true),
        approver_roles: stringArray(body.approverRoles ?? body.approver_roles, 'approver roles'),
        actor_principal_id: actor(req),
      });
      operations.appendAudit({
        org_id: policy.org_id,
        team_id: policy.team_id,
        actor_principal_id: actor(req),
        category: 'approval',
        action: 'review_policy.updated',
        outcome: 'recorded',
        detail: { policy_id: policy.id, protected_action: action, review_required: policy.review_required },
      });
      res.json({ policy });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/orgs/:orgId/curacel/connectors/:type', requireAdmin, (req, res) => {
    try {
      const body = record(req.body, 'body');
      rejectSecretFields(body);
      const type = enumValue(req.params.type, 'connector type', CURACEL_CONNECTOR_TYPES);
      const connector = operations.upsertConnector({
        org_id: safeId(req.params.orgId, 'organization id'),
        team_id: bodyTeamId(body),
        type,
        name: optionalString(body.name, 'connector name') ?? `${type} draft`,
        credential_ref: stringValue(
          body.credentialRef ?? body.credential_ref,
          'credential reference',
          500,
        ),
        enabled: boolean(body.enabled, 'enabled', false),
        mode: optionalString(body.mode, 'mode') ?? 'dry_run',
        review_required: boolean(body.reviewRequired ?? body.review_required, 'review required', true),
        actor_principal_id: actor(req),
      });
      operations.appendAudit({
        org_id: connector.org_id,
        team_id: connector.team_id,
        actor_principal_id: actor(req),
        category: 'action',
        action: 'connector.configured',
        outcome: 'disabled_dry_run',
        detail: { connector_id: connector.id, connector_type: connector.type, review_required: true },
      });
      res.json({ connector });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/orgs/:orgId/curacel/connectors/:connectorId/drafts', requireAdmin, (req, res) => {
    try {
      const body = record(req.body, 'body');
      rejectSecretFields(body);
      const orgId = safeId(req.params.orgId, 'organization id');
      const connectorId = safeId(req.params.connectorId, 'connector id');
      const idempotencyKey = stringValue(
        req.header('idempotency-key') ?? body.idempotencyKey ?? body.idempotency_key,
        'Idempotency-Key',
        200,
      );
      const existing = operations.listConnectorDrafts(orgId)
        .find((draft) => draft.idempotency_key === idempotencyKey);
      if (existing && existing.connector_id !== connectorId) {
        throw new OperationsRouteError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key was already used for a different connector.',
        );
      }
      const targetRef = stringValue(body.targetRef ?? body.target_ref, 'target reference', 500);
      const payload = record(body.payload, 'draft payload');
      const agentId = optionalSafeId(body.agentId ?? body.agent_id, 'agent id') ?? 'connector-draft';
      const teamId = optionalSafeId(body.teamId ?? body.team_id, 'team id');
      const taskIdValue = body.taskId ?? body.task_id;
      const taskId = taskIdValue == null ? null : integer(taskIdValue, 'task id', 1);
      const latencyMs = integer(body.latencyMs ?? body.latency_ms ?? 0, 'latency', 0);
      const retries = integer(body.retries ?? 0, 'retries', 0);
      const muted = boolean(body.muted, 'muted', false);
      const rateLimited = boolean(body.rateLimited ?? body.rate_limited, 'rate limited', false);
      const draft = operations.createConnectorDraft({
        org_id: orgId,
        connector_id: connectorId,
        actor_principal_id: actor(req),
        idempotency_key: idempotencyKey,
        target_ref: targetRef,
        payload,
      });
      if (!existing) {
        operations.appendAudit({
          org_id: orgId,
          team_id: teamId,
          agent_id: agentId,
          task_id: taskId,
          actor_principal_id: actor(req),
          category: 'approval',
          action: 'connector_draft.review_requested',
          outcome: 'pending',
          detail: { connector_id: connectorId, draft_id: draft.id },
          idempotency_key: `${idempotencyKey}:approval`,
        });
        operations.appendAudit({
          org_id: orgId,
          team_id: teamId,
          agent_id: agentId,
          task_id: taskId,
          actor_principal_id: actor(req),
          category: 'action',
          action: 'connector_draft.created',
          outcome: 'dry_run',
          detail: { connector_id: connectorId, draft_id: draft.id, delivery_attempted: false },
          idempotency_key: `${idempotencyKey}:action`,
        });
        operations.appendAudit({
          org_id: orgId,
          team_id: teamId,
          agent_id: agentId,
          task_id: taskId,
          actor_principal_id: actor(req),
          category: 'agent_output',
          action: 'connector_draft.output_prepared',
          outcome: 'pending_review',
          detail: { connector_id: connectorId, draft_id: draft.id, delivery_attempted: false },
          idempotency_key: `${idempotencyKey}:output`,
        });
        operations.recordExecution({
          org_id: orgId,
          team_id: teamId,
          agent_id: agentId,
          task_id: taskId,
          outcome: 'success',
          latency_ms: latencyMs,
          retries,
          muted,
          rate_limited: rateLimited,
          review_outcome: 'pending',
        });
      }
      res.status(existing ? 200 : 201).json({ draft, replayed: Boolean(existing) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/orgs/:orgId/curacel/team-dashboards/:teamId', requireAdmin, (req, res) => {
    try {
      const body = record(req.body, 'body');
      const dashboard = operations.upsertTeamDashboard({
        org_id: safeId(req.params.orgId, 'organization id'),
        team_id: safeId(req.params.teamId, 'team id'),
        team_type: enumValue(body.teamType ?? body.team_type, 'team type', CURACEL_TEAM_TYPES),
        queue_label: stringValue(body.queueLabel ?? body.queue_label, 'queue label'),
        approval_sla_minutes: integer(
          body.approvalSlaMinutes ?? body.approval_sla_minutes,
          'approval SLA minutes',
          1,
        ),
        policies: record(body.policies ?? {}, 'dashboard policies'),
        agent_permissions: stringArray(
          body.agentPermissions ?? body.agent_permissions,
          'agent permissions',
        ),
        actor_principal_id: actor(req),
      });
      operations.appendAudit({
        org_id: dashboard.org_id,
        team_id: dashboard.team_id,
        actor_principal_id: actor(req),
        category: 'action',
        action: 'team_dashboard.updated',
        outcome: 'recorded',
        detail: { dashboard_id: dashboard.id, team_type: dashboard.team_type },
      });
      res.json({ dashboard });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/orgs/:orgId/curacel/execution-samples', requireAdmin, (req, res) => {
    try {
      const body = record(req.body, 'body');
      const orgId = safeId(req.params.orgId, 'organization id');
      const teamId = bodyTeamId(body);
      const agentId = safeId(body.agentId ?? body.agent_id, 'agent id');
      const taskId = body.taskId == null && body.task_id == null
        ? null
        : integer(body.taskId ?? body.task_id, 'task id', 1);
      const outcome = enumValue(body.outcome, 'execution outcome', ['success', 'error']);
      const latencyMs = integer(body.latencyMs ?? body.latency_ms, 'latency', 0);
      const reviewOutcome = enumValue(
        body.reviewOutcome ?? body.review_outcome ?? 'not_required',
        'review outcome',
        CURACEL_REVIEW_OUTCOMES,
      );
      const defaultCategory = outcome === 'error' ? 'error' : 'agent_output';
      const auditCategory = enumValue(
        body.auditCategory ?? body.audit_category ?? defaultCategory,
        'audit category',
        ['agent_output', 'error', 'recovery'],
      );
      const sample = operations.recordExecution({
        org_id: orgId,
        team_id: teamId,
        agent_id: agentId,
        task_id: taskId,
        outcome,
        latency_ms: latencyMs,
        retries: integer(body.retries ?? 0, 'retries', 0),
        muted: boolean(body.muted, 'muted', false),
        rate_limited: boolean(body.rateLimited ?? body.rate_limited, 'rate limited', false),
        review_outcome: reviewOutcome,
      });
      operations.appendAudit({
        org_id: orgId,
        team_id: teamId,
        agent_id: agentId,
        task_id: taskId,
        actor_principal_id: actor(req),
        category: auditCategory,
        action: 'agent.execution_recorded',
        outcome,
        detail: {
          execution_sample_id: sample.id,
          latency_ms: latencyMs,
          retries: sample.retries,
          review_outcome: reviewOutcome,
        },
      });
      res.status(201).json({ sample });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
