/**
 * Human-facing durable agent invite controls (THE-880 / WP2-A-05 + THE-881 list).
 *
 * POST   /api/agents/invites
 * GET    /api/agents/invites
 * GET    /api/agents/invites/:inviteId
 * POST   /api/agents/invites/:inviteId/revoke
 * POST   /api/agents/invites/:inviteId/regenerate
 *
 * Tokenized agent consumption remains under /api/onboarding/agent-session/:token/*.
 * Agent Desk UI (WP2-A-06) consumes list/get/revoke/regenerate.
 */

import type { Express, Request, Response } from 'express';
import {
  getInviteControls,
  type CreateDurableInviteInput,
  type InviteControls,
} from '../agent/invite-kit/controls';
import type {
  AgentInviteStatus,
  ChiefRoutingMode,
  InviteCreationSource,
} from '../agent/invite-kit/types';
import { AGENT_INVITE_STATUSES } from '../agent/invite-kit/types';

export interface RegisterAgentInviteRoutesDeps {
  controls?: InviteControls;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readTaskId(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseCreateBody(body: unknown): CreateDurableInviteInput {
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const creationSource = readString(input.creationSource);
  const chief = readString(input.chiefRoutingMode);
  return {
    agentName: readString(input.agentName) ?? readString(input.agent_name) ?? '',
    role: readString(input.role),
    ttlMs: typeof input.ttlMs === 'number' ? input.ttlMs : undefined,
    expiresAt: readString(input.expiresAt) ?? readString(input.expires_at),
    selectedBundle: readString(input.selectedBundle) ?? readString(input.selected_bundle),
    selectedModules: readStringArray(input.selectedModules) ?? readStringArray(input.selected_modules),
    selectedModuleConfig:
      input.selectedModuleConfig && typeof input.selectedModuleConfig === 'object'
        && !Array.isArray(input.selectedModuleConfig)
        ? input.selectedModuleConfig as Record<string, unknown>
        : undefined,
    permissionsScope: readStringArray(input.permissionsScope) ?? readStringArray(input.permissions_scope),
    safeStopConditions:
      readStringArray(input.safeStopConditions) ?? readStringArray(input.safe_stop_conditions),
    projectId: readNullableString(input.projectId) ?? readNullableString(input.project_id),
    workplaneId: readNullableString(input.workplaneId) ?? readNullableString(input.workplane_id),
    taskId: readTaskId(input.taskId) ?? readTaskId(input.task_id),
    workspaceId: readNullableString(input.workspaceId) ?? readNullableString(input.workspace_id),
    providerProfileId:
      readNullableString(input.providerProfileId) ?? readNullableString(input.provider_profile_id),
    chiefRoutingMode:
      chief === 'none' || chief === 'chief' || chief === 'worker'
        ? chief as ChiefRoutingMode
        : undefined,
    createdBy: readNullableString(input.createdBy) ?? readNullableString(input.created_by),
    creationSource:
      creationSource === 'onboarding_first_run' || creationSource === 'agents_invite'
        ? creationSource as InviteCreationSource
        : 'agents_invite',
  };
}

function sendControlResult(res: Response, result: { ok: true; value: unknown } | {
  ok: false;
  statusCode: number;
  error: string;
  code: string;
}): void {
  if (!result.ok) {
    res.status(result.statusCode).json({
      error: result.error,
      code: result.code,
    });
    return;
  }
  res.json(result.value);
}

export function registerAgentInviteRoutes(
  app: Express,
  deps: RegisterAgentInviteRoutesDeps = {},
): void {
  const controls = deps.controls ?? getInviteControls();

  app.post('/api/agents/invites', (req: Request, res: Response) => {
    const result = controls.createInvite(parseCreateBody(req.body));
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error, code: result.code });
      return;
    }
    res.status(201).json(result.value);
  });

  // List must register before :inviteId.
  app.get('/api/agents/invites', (req: Request, res: Response) => {
    const statusRaw = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const status = (AGENT_INVITE_STATUSES as readonly string[]).includes(statusRaw)
      ? statusRaw as AgentInviteStatus
      : undefined;
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const limit = typeof limitRaw === 'number' && Number.isFinite(limitRaw) ? limitRaw : undefined;
    sendControlResult(res, controls.listInvites({ status, limit }));
  });

  app.get('/api/agents/invites/:inviteId', (req: Request, res: Response) => {
    sendControlResult(res, controls.getInvite(String(req.params.inviteId ?? '')));
  });

  app.post('/api/agents/invites/:inviteId/revoke', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const revokedBy = readString(body.revokedBy) ?? readString(body.revoked_by) ?? null;
    sendControlResult(
      res,
      controls.revokeInvite(String(req.params.inviteId ?? ''), { revokedBy }),
    );
  });

  app.post('/api/agents/invites/:inviteId/regenerate', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const result = controls.regenerateInvite(String(req.params.inviteId ?? ''), {
      ttlMs: typeof body.ttlMs === 'number' ? body.ttlMs : undefined,
      expiresAt: readString(body.expiresAt) ?? readString(body.expires_at),
      revokedBy: readString(body.revokedBy) ?? readString(body.revoked_by) ?? null,
    });
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error, code: result.code });
      return;
    }
    res.status(200).json(result.value);
  });
}
