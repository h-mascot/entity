import { Router, type Request, type Response } from 'express';
import {
  createAgentImportRepository,
  createChatHistoryAccessRepository,
  createChatNoiseControlRepository,
  type AgentImportRepository,
  type ChatHistoryAccessRepository,
  type ChatNoiseControlRepository,
} from '../../../db/src';
import type { ChatRepository } from '../../../db/src/chat';
import { createRequireAdminPrincipal } from '../middleware/admin-auth';
import { resolveRequestActorId } from '../principals/request-context';

interface ManagementNoiseRepository {
  setAgentChannelCooldown?: (input: {
    org_id: string;
    team_id: string | null;
    channel_id: string;
    agent_id: string;
    cooldown_seconds: number;
    actor_user_id: string;
  }) => unknown;
  listAudit?: (input: { org_id: string; team_id?: string | null }) => unknown[];
}

interface ChatNoiseControlRouterDependencies {
  /** Test seam: skip the admin-principal gate (focused logic tests). */
  skipAdminAuth?: boolean;
  noiseRepo?: ChatNoiseControlRepository & ManagementNoiseRepository;
  historyAccessRepo?: Pick<ChatHistoryAccessRepository, 'getChannelScope'>;
  importRepo?: Pick<AgentImportRepository, 'getMappingByAgent'>;
  chatRepo: Pick<ChatRepository, 'getChannel' | 'getCategory' | 'listChannelsByCategory'>;
}

class NoiseControlError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function required(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new NoiseControlError(400, 'CHAT_NOISE_INVALID', `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new NoiseControlError(400, 'CHAT_NOISE_INVALID', `${field} is too long.`);
  }
  return normalized;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new NoiseControlError(400, 'CHAT_NOISE_INVALID', `${field} must be a boolean.`);
  }
  return value;
}

function cooldown(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 86_400) {
    throw new NoiseControlError(
      400,
      'CHAT_NOISE_INVALID',
      'cooldownSeconds must be an integer from 1 to 86400.',
    );
  }
  return Number(value);
}

function actor(req: Request): string {
  return resolveRequestActorId(req, 'system');
}

// REC-006 adaptation: the historical line enforced org/team administrator
// memberships from its session principal; current main uses the persisted
// admin-principal model, so noise-control management requires an admin
// principal. skipAdminAuth is a test seam for focused logic tests.
function createNoiseManagerGuard(skipAdminAuth: boolean) {
  const requireAdminPrincipal = createRequireAdminPrincipal();
  return (req: Request, res: Response, next: () => void): void => {
    if (skipAdminAuth) {
      next();
      return;
    }
    requireAdminPrincipal(req, res, next);
  };
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof NoiseControlError) {
    res.status(error.status).json({ code: error.code, error: error.message });
    return;
  }
  res.status(400).json({
    code: 'CHAT_NOISE_INVALID',
    error: error instanceof Error ? error.message : 'Noise-control request failed.',
  });
}

export function createChatNoiseControlRouter(deps: ChatNoiseControlRouterDependencies): Router {
  const router = Router();
  const requireManager = createNoiseManagerGuard(Boolean(deps.skipAdminAuth));
  const noise = (deps.noiseRepo ?? createChatNoiseControlRepository()) as
    ChatNoiseControlRepository & ManagementNoiseRepository;
  const history = deps.historyAccessRepo ?? createChatHistoryAccessRepository();
  const imports = deps.importRepo ?? createAgentImportRepository();

  const channelScope = (orgId: string, channelId: string) => {
    if (!deps.chatRepo.getChannel(channelId)) {
      throw new NoiseControlError(404, 'CHANNEL_NOT_FOUND', 'Channel not found.');
    }
    const scope = history.getChannelScope(channelId);
    if (!scope || scope.org_id !== orgId) {
      throw new NoiseControlError(404, 'CHANNEL_NOT_FOUND', 'Channel not found.');
    }
    return scope;
  };

  router.get('/orgs/:orgId/chat-noise-controls', requireManager, (req, res) => {
    try {
      const orgId = required(req.params.orgId, 'organization id');
      const teamId = typeof req.query.teamId === 'string' && req.query.teamId.trim()
        ? req.query.teamId.trim()
        : null;
      const filters = {
        org_id: orgId,
        ...(teamId ? { team_id: teamId } : {}),
      };
      const audit = noise.listAudit
        ? noise.listAudit(filters)
        : noise.listAuditEvents(filters);
      res.json({
        cooldowns: noise.listCooldowns(filters),
        mutes: noise.listActiveMutes(filters),
        audit,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/orgs/:orgId/chat-noise-controls/evaluate', requireManager, (req, res) => {
    try {
      const orgId = required(req.params.orgId, 'organization id');
      const channelId = required(req.body?.channelId, 'channel id');
      const categoryId = required(req.body?.categoryId, 'category id');
      const agentId = required(req.body?.agentId, 'agent id');
      const scope = channelScope(orgId, channelId);
      const channel = deps.chatRepo.getChannel(channelId) as { category_id?: string } | undefined;
      if (!channel || channel.category_id !== categoryId) {
        throw new NoiseControlError(400, 'CHAT_NOISE_INVALID', 'Channel does not belong to the selected category.');
      }
      const mapping = imports.getMappingByAgent(agentId);
      if (
        !mapping
        || mapping.org_id !== orgId
        || (scope.team_id && !mapping.team_ids.includes(scope.team_id))
      ) {
        throw new NoiseControlError(404, 'AGENT_NOT_FOUND', 'Mapped agent not found.');
      }
      const overrideReason = typeof req.body?.overrideReason === 'string'
        ? req.body.overrideReason.trim()
        : '';
      const decision = noise.reservePost({
        org_id: orgId,
        team_id: scope.team_id,
        category_id: categoryId,
        channel_id: channelId,
        agent_id: agentId,
        attempted_at: new Date().toISOString(),
        ...(overrideReason
          ? { operator_override: { actor_user_id: actor(req), reason: required(overrideReason, 'override reason') } }
          : {}),
      });
      if (decision.reservation) {
        noise.releasePost({
          org_id: orgId,
          reservation_id: decision.reservation.id,
          state: 'released',
          released_at: new Date().toISOString(),
          reason: 'Policy evaluation only; no message was sent.',
        });
      }
      res.json({
        decision: {
          allowed: decision.allowed,
          reason: decision.reason,
          retryAfterSeconds: decision.retry_after_seconds ?? null,
          dryRun: true,
          deliveryAttempted: false,
        },
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put(
    '/orgs/:orgId/chat-noise-controls/channels/:channelId/agents/:agentId/cooldown',
    requireManager,
    (req, res) => {
      try {
        const orgId = required(req.params.orgId, 'organization id');
        const channelId = required(req.params.channelId, 'channel id');
        const agentId = required(req.params.agentId, 'agent id');
        const scope = channelScope(orgId, channelId);
          const mapping = imports.getMappingByAgent(agentId);
        if (
          !mapping
          || mapping.org_id !== orgId
          || (scope.team_id && !mapping.team_ids.includes(scope.team_id))
        ) {
          throw new NoiseControlError(404, 'AGENT_NOT_FOUND', 'Mapped agent not found.');
        }
        const input = {
          org_id: orgId,
          team_id: scope.team_id,
          channel_id: channelId,
          agent_id: agentId,
          cooldown_seconds: cooldown(req.body?.cooldownSeconds),
        };
        const policy = noise.setAgentChannelCooldown
          ? noise.setAgentChannelCooldown({ ...input, actor_user_id: actor(req) })
          : noise.configureCooldown({ ...input, configured_by_user_id: actor(req) });
        res.json({ policy });
      } catch (error) {
        sendError(res, error);
      }
    },
  );

  router.delete(
    '/orgs/:orgId/chat-noise-controls/channels/:channelId/agents/:agentId/cooldown',
    requireManager,
    (req, res) => {
      try {
        const orgId = required(req.params.orgId, 'organization id');
        const channelId = required(req.params.channelId, 'channel id');
        const agentId = required(req.params.agentId, 'agent id');
        const scope = channelScope(orgId, channelId);
        // Luna-high F6: deletion applies the same agent mapping/org/team
        // validation as creation — a cooldown for an agent imported by another
        // organization (or outside the channel's team) is not clearable through
        // this organization's management route.
        const mapping = imports.getMappingByAgent(agentId);
        if (
          !mapping
          || mapping.org_id !== orgId
          || (scope.team_id && !mapping.team_ids.includes(scope.team_id))
        ) {
          throw new NoiseControlError(404, 'AGENT_NOT_FOUND', 'Mapped agent not found.');
        }
        const cleared = noise.clearCooldown({
          org_id: orgId,
          channel_id: channelId,
          agent_id: agentId,
          cleared_by_user_id: actor(req),
        });
        res.json({ cleared });
      } catch (error) {
        sendError(res, error);
      }
    },
  );

  router.put('/orgs/:orgId/chat-noise-controls/channels/:channelId/mute', requireManager, (req, res) => {
    try {
      const orgId = required(req.params.orgId, 'organization id');
      const channelId = required(req.params.channelId, 'channel id');
      const scope = channelScope(orgId, channelId);
      const mute = noise.setChannelMute({
        org_id: orgId,
        team_id: scope.team_id,
        channel_id: channelId,
        muted: boolean(req.body?.muted, 'muted'),
        actor_user_id: actor(req),
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      });
      res.json({ mute });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/orgs/:orgId/chat-noise-controls/categories/:categoryId/mute', requireManager, (req, res) => {
    try {
      const orgId = required(req.params.orgId, 'organization id');
      const categoryId = required(req.params.categoryId, 'category id');
      if (!deps.chatRepo.getCategory(categoryId)) {
        throw new NoiseControlError(404, 'CATEGORY_NOT_FOUND', 'Category not found.');
      }
      const channels = deps.chatRepo.listChannelsByCategory(categoryId);
      const scopes = channels.map((channel) => history.getChannelScope(channel.id));
      if (
        channels.length === 0
        || scopes.some((scope) => !scope || scope.org_id !== orgId)
      ) {
        throw new NoiseControlError(
          403,
          'CHAT_NOISE_SCOPE_FORBIDDEN',
          'Every category channel must have an authoritative scope in this organization.',
        );
      }
      const teamIds = [...new Set(scopes.map((scope) => scope!.team_id))];
      const categoryTeamId = teamIds.length === 1 ? teamIds[0] : null;
      // REC-006 adaptation: the historical org-vs-team administrator split relied
      // on session memberships; under main's admin principal the mute is always
      // org-scoped (team_id null) and the category must be wholly scoped to one
      // team to remain auditable.
      if (teamIds.length !== 1) {
        throw new NoiseControlError(
          403,
          'CHAT_NOISE_SCOPE_FORBIDDEN',
          'A category may be muted only when it is wholly scoped to a single team.',
        );
      }
      const mute = noise.setCategoryMute({
        org_id: orgId,
        team_id: null,
        category_id: categoryId,
        muted: boolean(req.body?.muted, 'muted'),
        actor_user_id: actor(req),
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      });
      res.json({ mute });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/orgs/:orgId/chat-noise-controls/audit', requireManager, (req, res) => {
    try {
      const orgId = required(req.params.orgId, 'organization id');
      const teamId = typeof req.query.teamId === 'string' && req.query.teamId.trim()
        ? required(req.query.teamId, 'team id')
        : null;
      // REC-006 adaptation: the historical team-manager audit narrowing relied
      // on session memberships; main's admin principal sees the org audit and
      // may narrow with an explicit teamId query parameter instead.
      const audit = noise.listAudit
        ? noise.listAudit({ org_id: orgId, ...(teamId ? { team_id: teamId } : {}) })
        : noise.listAuditEvents({ org_id: orgId, ...(teamId ? { team_id: teamId } : {}) });
      res.json({ audit });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
