import { createHash } from 'crypto';
import { Router, type Request, type Response } from 'express';
import {
  createChatHistoryAccessRepository,
  createAgentImportRepository,
  type AgentImportRepository,
  type AgentRegistryRepository,
  type ChatHistoryAccessRepository,
  type WorkspaceScopeRepository,
} from '../../../db/src';
import type { ChatRepository } from '../../../db/src/chat';
import {
  createAgentTokenRepository,
  tokenMissingScopes,
  type AgentTokenRepository,
} from '../../../db/src/agent-tokens';
import { createRequireAdminPrincipal } from '../middleware/admin-auth';
import { resolveRequestActorId } from '../principals/request-context';

const HISTORY_SCOPE = 'channels:history';
const MAX_MESSAGES = 500;
const MAX_THREADS = 100;
const NOT_FOUND = {
  code: 'CHAT_HISTORY_NOT_FOUND',
  error: 'Chat history resource not found.',
};

interface ChatHistoryRouterDependencies {
  /** Test seam: skip the admin-principal gate (focused logic tests). */
  skipAdminAuth?: boolean;
  accessRepo?: ChatHistoryAccessRepository;
  importRepo?: Pick<AgentImportRepository, 'getMappingByAgent'>;
  tokenRepo?: Pick<AgentTokenRepository, 'getAgentTokenByHash'>;
  agentRegistryRepo?: Pick<AgentRegistryRepository, 'getAgent' | 'getAgentBySlug'>;
  workspaceRepo: Pick<WorkspaceScopeRepository, 'getOrg' | 'getTeam'>;
  chatRepo: Pick<
    ChatRepository,
    | 'getChannel'
    | 'getThread'
    | 'listMessagesByChannel'
    | 'listMessagesByThread'
    | 'listThreadsByChannel'
  >;
}

class HistoryAccessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function required(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HistoryAccessError(400, 'CHAT_HISTORY_INVALID', `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new HistoryAccessError(400, 'CHAT_HISTORY_INVALID', `${field} is too long.`);
  }
  return normalized;
}

function optionalTeamId(value: unknown): string | null {
  return value == null || value === '' ? null : required(value, 'teamId', 240);
}

function bounded(value: unknown, fallback: number, maximum: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, maximum)) : fallback;
}

function actor(req: Request): string {
  return resolveRequestActorId(req, 'system');
}

// REC-006 adaptation: the historical line enforced org/team administrator
// memberships from its session principal; current main uses the persisted
// admin-principal model, so roster management requires an admin principal.
// skipAdminAuth is a test seam for focused logic tests.
function createHistoryManagerGuard(skipAdminAuth: boolean) {
  const requireAdminPrincipal = createRequireAdminPrincipal();
  return (req: Request, res: Response, next: () => void): void => {
    if (skipAdminAuth) {
      next();
      return;
    }
    requireAdminPrincipal(req, res, next);
  };
}

function bearer(req: Request): string | null {
  const authorization = req.header('authorization');
  const match = typeof authorization === 'string' ? /^Bearer\s+(.+)$/i.exec(authorization.trim()) : null;
  return match?.[1]?.trim() || null;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof HistoryAccessError) {
    res.status(error.status).json({ code: error.code, error: error.message });
    return;
  }
  res.status(400).json({
    code: 'CHAT_HISTORY_INVALID',
    error: error instanceof Error ? error.message : 'Chat history request failed.',
  });
}

export function createChatHistoryAccessRouter(deps: ChatHistoryRouterDependencies): Router {
  const router = Router();
  const access = deps.accessRepo ?? createChatHistoryAccessRepository();
  const imports = deps.importRepo ?? createAgentImportRepository();
  const tokens = deps.tokenRepo ?? createAgentTokenRepository();
  const requireManager = createHistoryManagerGuard(Boolean(deps.skipAdminAuth));

  router.get('/orgs/:orgId/chat-history/access', requireManager, (req, res) => {
    try {
      const orgId = required(req.params.orgId, 'organization id');
      const teamId = typeof req.query.teamId === 'string'
        ? optionalTeamId(req.query.teamId)
        : null;
      const scopes = access.listChannelScopes({
        org_id: orgId,
        ...(teamId ? { team_id: teamId } : {}),
      });
      const grants = access.listActiveGrants({ org_id: orgId });
      const visibleChannelIds = new Set(scopes.map((scope) => scope.channel_id));
      res.json({
        scopes,
        grants: grants.filter((grant) => visibleChannelIds.has(grant.channel_id)),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/orgs/:orgId/chat-history/channels/:channelId/scope', requireManager, (req, res) => {
    try {
      const orgId = required(req.params.orgId, 'organization id');
      const channelId = required(req.params.channelId, 'channel id');
      const teamId = optionalTeamId(req.body?.teamId);
      if (!deps.workspaceRepo.getOrg(orgId)) {
        throw new HistoryAccessError(404, 'ORG_NOT_FOUND', 'Organization not found.');
      }
      if (teamId && !deps.workspaceRepo.getTeam({ orgId }, teamId)) {
        throw new HistoryAccessError(404, 'TEAM_NOT_FOUND', 'Team not found.');
      }
      const channel = deps.chatRepo.getChannel(channelId);
      if (!channel) {
        throw new HistoryAccessError(404, 'CHANNEL_NOT_FOUND', 'Channel not found.');
      }
      // Luna-high F5: the channel's own org/team ownership is authoritative.
      // A channel owned by another organization can never be scoped here, and
      // a team-scoped channel can only carry its exact team (never a sibling
      // team, never org-wide). Unowned legacy channels (null org) remain
      // adoptable — first scope row wins and later foreign claims are blocked
      // by the existing-scope check below.
      if (channel.org_id && channel.org_id !== orgId) {
        throw new HistoryAccessError(
          403,
          'CHAT_HISTORY_SCOPE_FORBIDDEN',
          'Channel belongs to another organization.',
        );
      }
      if (channel.team_id && channel.team_id !== teamId) {
        throw new HistoryAccessError(
          403,
          'CHAT_HISTORY_SCOPE_FORBIDDEN',
          'Channel is scoped to a different team.',
        );
      }
      const existing = access.getChannelScope(channelId);
      if (existing && existing.org_id !== orgId) {
        throw new HistoryAccessError(403, 'CHAT_HISTORY_SCOPE_FORBIDDEN', 'Channel scope belongs to another organization.');
      }
      const scope = access.upsertChannelScope({
        channel_id: channelId,
        org_id: orgId,
        team_id: teamId,
        scoped_by_user_id: actor(req),
      });
      res.json({ scope });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/orgs/:orgId/chat-history/channels/:channelId/agents/:agentId', requireManager, (req, res) => {
    try {
      const orgId = required(req.params.orgId, 'organization id');
      const channelId = required(req.params.channelId, 'channel id');
      const agentId = required(req.params.agentId, 'agent id');
      const scope = access.getChannelScope(channelId);
      if (!scope || scope.org_id !== orgId) {
        throw new HistoryAccessError(404, 'CHANNEL_NOT_FOUND', 'Channel not found.');
      }
      const requestedTeamId = optionalTeamId(req.body?.teamId);
      if (requestedTeamId !== scope.team_id) {
        throw new HistoryAccessError(400, 'CHAT_HISTORY_SCOPE_MISMATCH', 'Grant team must match channel scope.');
      }
      const mapping = imports.getMappingByAgent(agentId);
      if (!mapping || mapping.org_id !== orgId) {
        throw new HistoryAccessError(404, 'AGENT_NOT_FOUND', 'Mapped agent not found.');
      }
      if (scope.team_id && !mapping.team_ids.includes(scope.team_id)) {
        throw new HistoryAccessError(403, 'CHAT_HISTORY_TEAM_FORBIDDEN', 'Agent is not mapped to this team.');
      }
      const grant = access.upsertGrant({
        org_id: orgId,
        team_id: scope.team_id,
        channel_id: channelId,
        agent_id: agentId,
        granted_by_user_id: actor(req),
      });
      res.json({ grant });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/orgs/:orgId/chat-history/channels/:channelId/agents/:agentId', requireManager, (req, res) => {
    try {
      const orgId = required(req.params.orgId, 'organization id');
      const channelId = required(req.params.channelId, 'channel id');
      const scope = access.getChannelScope(channelId);
      if (!scope || scope.org_id !== orgId) {
        throw new HistoryAccessError(404, 'CHANNEL_NOT_FOUND', 'Channel not found.');
      }
      const grant = access.revokeGrant({
        org_id: orgId,
        channel_id: channelId,
        agent_id: required(req.params.agentId, 'agent id'),
        revoked_by_user_id: actor(req),
        revocation_reason: required(req.body?.reason, 'reason'),
      });
      if (!grant) throw new HistoryAccessError(404, 'GRANT_NOT_FOUND', 'Grant not found.');
      res.json({ grant });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/chat/agent/history', (req, res) => {
    const rawToken = bearer(req);
    if (!rawToken) {
      res.status(401).json({ code: 'AUTH_TOKEN_REQUIRED', error: 'Authorization bearer token is required.' });
      return;
    }
    const token = tokens.getAgentTokenByHash(createHash('sha256').update(rawToken, 'utf8').digest('hex'));
    if (!token || token.token_type !== 'agent' || !token.enabled) {
      res.status(401).json({ code: 'AUTH_TOKEN_INVALID', error: 'Authorization token is invalid or disabled.' });
      return;
    }
    const missingScopes = tokenMissingScopes(token, [HISTORY_SCOPE]);
    if (missingScopes.length > 0) {
      res.status(403).json({
        code: 'AUTH_SCOPE_DENIED',
        error: 'Token is missing required scopes.',
        missingScopes,
      });
      return;
    }

    const registered = deps.agentRegistryRepo?.getAgent(token.actor)
      ?? deps.agentRegistryRepo?.getAgentBySlug(token.actor);
    const agentId = registered?.id ?? token.actor;
    const mapping = imports.getMappingByAgent(agentId);
    if (!mapping) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    const channelId = typeof req.query.channelId === 'string' ? req.query.channelId : null;
    const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : null;
    if (channelId && threadId) {
      res.status(400).json({ code: 'CHAT_HISTORY_INVALID', error: 'Choose channelId or threadId, not both.' });
      return;
    }
    const limit = bounded(req.query.limit, 100, MAX_MESSAGES);
    const threadLimit = bounded(req.query.threadLimit, 25, MAX_THREADS);
    const includeThreadMessages = req.query.includeThreadMessages === 'true';

    const canReadChannel = (candidateChannelId: string) => {
      const scope = access.getChannelScope(candidateChannelId);
      const grant = access.getActiveGrant(mapping.org_id, candidateChannelId, agentId);
      return scope
        && grant
        && scope.org_id === mapping.org_id
        && grant.team_id === scope.team_id
        && (!scope.team_id || mapping.team_ids.includes(scope.team_id));
    };
    const channelHistory = (candidateChannelId: string) => {
      if (!canReadChannel(candidateChannelId)) return null;
      const channel = deps.chatRepo.getChannel(candidateChannelId);
      if (!channel) return null;
      const threads = deps.chatRepo.listThreadsByChannel(candidateChannelId).slice(0, threadLimit);
      return {
        channel,
        messages: deps.chatRepo.listMessagesByChannel(candidateChannelId).slice(0, limit),
        threads: threads.map((thread) => ({
          ...thread,
          ...(includeThreadMessages
            ? { messages: deps.chatRepo.listMessagesByThread(thread.id).slice(0, limit) }
            : {}),
        })),
      };
    };

    if (threadId) {
      const thread = deps.chatRepo.getThread(threadId);
      if (!thread || !canReadChannel(thread.channel_id)) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      res.json({
        actor: agentId,
        scope: HISTORY_SCOPE,
        thread,
        messages: deps.chatRepo.listMessagesByThread(thread.id).slice(0, limit),
      });
      return;
    }

    if (channelId) {
      const history = channelHistory(channelId);
      if (!history) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      res.json({ actor: agentId, scope: HISTORY_SCOPE, history: [history] });
      return;
    }

    const history = access.listActiveGrants({
      org_id: mapping.org_id,
      agent_id: agentId,
    }).map((grant) => channelHistory(grant.channel_id)).filter((entry) => entry !== null);
    res.json({ actor: agentId, scope: HISTORY_SCOPE, history });
  });

  return router;
}
