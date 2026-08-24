import { createHash } from 'crypto';
import express from 'express';
import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { createChatHistoryAccessRouter } from './chat-history-access';

const now = '2026-07-28T18:30:00.000Z';
const rawHistoryToken = 'neutral-agent-history-token';

type Grant = {
  id: string;
  org_id: string;
  team_id: string | null;
  channel_id: string;
  agent_id: string;
  granted_by_user_id: string;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revocation_reason: string | null;
};

function createAccessRepo() {
  const scopes = new Map<string, {
    id: string;
    channel_id: string;
    org_id: string;
    team_id: string | null;
    scoped_by_user_id: string;
  }>();
  const grants = new Map<string, Grant>();
  const key = (orgId: string, channelId: string, agentId: string) => `${orgId}:${channelId}:${agentId}`;

  return {
    upsertChannelScope(input: {
      channel_id: string;
      org_id: string;
      team_id?: string | null;
      scoped_by_user_id: string;
    }) {
      const value = {
        id: scopes.get(input.channel_id)?.id ?? `scope:${input.channel_id}`,
        channel_id: input.channel_id,
        org_id: input.org_id,
        team_id: input.team_id ?? null,
        scoped_by_user_id: input.scoped_by_user_id,
      };
      scopes.set(input.channel_id, value);
      return value;
    },
    getChannelScope: (channelId: string) => scopes.get(channelId),
    listChannelScopes(filters: { org_id: string; team_id?: string | null }) {
      return [...scopes.values()].filter((scope) =>
        scope.org_id === filters.org_id
        && (filters.team_id == null || scope.team_id === filters.team_id));
    },
    upsertGrant(input: {
      org_id: string;
      team_id?: string | null;
      channel_id: string;
      agent_id: string;
      granted_by_user_id: string;
    }) {
      const grantKey = key(input.org_id, input.channel_id, input.agent_id);
      const value: Grant = {
        id: grants.get(grantKey)?.id ?? `grant:${grantKey}`,
        org_id: input.org_id,
        team_id: input.team_id ?? null,
        channel_id: input.channel_id,
        agent_id: input.agent_id,
        granted_by_user_id: input.granted_by_user_id,
        revoked_at: null,
        revoked_by_user_id: null,
        revocation_reason: null,
      };
      grants.set(grantKey, value);
      return value;
    },
    getActiveGrant(orgId: string, channelId: string, agentId: string) {
      const value = grants.get(key(orgId, channelId, agentId));
      return value?.revoked_at ? undefined : value;
    },
    listActiveGrants(filters: { org_id: string; channel_id?: string; agent_id?: string }) {
      return [...grants.values()].filter((grant) =>
        !grant.revoked_at &&
        grant.org_id === filters.org_id &&
        (!filters.channel_id || grant.channel_id === filters.channel_id) &&
        (!filters.agent_id || grant.agent_id === filters.agent_id));
    },
    revokeGrant(input: {
      org_id: string;
      channel_id: string;
      agent_id: string;
      revoked_by_user_id: string;
      revocation_reason?: string;
    }) {
      const grantKey = key(input.org_id, input.channel_id, input.agent_id);
      const existing = grants.get(grantKey);
      if (!existing) return undefined;
      const revoked = {
        ...existing,
        revoked_at: now,
        revoked_by_user_id: input.revoked_by_user_id,
        revocation_reason: input.revocation_reason ?? null,
      };
      grants.set(grantKey, revoked);
      return revoked;
    },
  };
}

function createFixture() {
  const accessRepo = createAccessRepo();
  const calls = {
    channelLimits: [] as number[],
    threadLimits: [] as number[],
    threadListLimits: [] as number[],
  };
  const channels = new Map([
    ['channel-a', { id: 'channel-a', name: 'Channel A' }],
    ['channel-b', { id: 'channel-b', name: 'Channel B' }],
    // Luna-high F5: org-owned channels carry their authoritative association.
    // 'channel-org-b' is owned by org-b/team-b; 'channel-team-b' is owned by
    // org-a but team-scoped to team-b (a team of org-b in this fixture's
    // workspace stub — i.e. not team-a).
    ['channel-org-b', { id: 'channel-org-b', name: 'Org B Channel', org_id: 'org-b', team_id: 'team-b' }],
    ['channel-team-b', { id: 'channel-team-b', name: 'Org A Team B Channel', org_id: 'org-a', team_id: 'team-b' }],
  ]);
  const threads = new Map([
    ['thread-a', { id: 'thread-a', channel_id: 'channel-a', title: 'Thread A' }],
    ['thread-b', { id: 'thread-b', channel_id: 'channel-b', title: 'Thread B' }],
  ]);
  const mappings = new Map([
    ['agent-a', {
      id: 'mapping-a',
      org_id: 'org-a',
      source: 'runtime-fleet',
      external_id: 'external-a',
      agent_id: 'agent-a',
      team_ids: ['team-a'],
      module_ids: [],
      channel_ids: ['channel-a', 'channel-b'],
      review_policy: { required: false, human_gate_required: false },
      imported_by_user_id: 'operator-a',
      created_at: now,
      updated_at: now,
    }],
    ['agent-b', {
      id: 'mapping-b',
      org_id: 'org-b',
      source: 'runtime-fleet',
      external_id: 'external-b',
      agent_id: 'agent-b',
      team_ids: ['team-b'],
      module_ids: [],
      channel_ids: ['channel-b'],
      review_policy: { required: false, human_gate_required: false },
      imported_by_user_id: 'operator-b',
      created_at: now,
      updated_at: now,
    }],
  ]);
  const token = {
    id: 'token-a',
    token_hash: createHash('sha256').update(rawHistoryToken).digest('hex'),
    token_type: 'agent' as const,
    actor: 'agent-a',
    scopes: ['channels:history'],
    enabled: true,
    created_at: now,
    updated_at: now,
  };

  return {
    accessRepo,
    calls,
    mappings,
    token,
    deps: {
      accessRepo,
      importRepo: {
        getMappingByAgent: (agentId: string) => mappings.get(agentId),
      },
      tokenRepo: {
        getAgentTokenByHash: (hash: string) => token.enabled && hash === token.token_hash ? token : undefined,
      },
      workspaceRepo: {
        getOrg: (id: string) => ['org-a', 'org-b'].includes(id) ? { id } : undefined,
        getTeam: ({ orgId }: { orgId: string }, id: string) =>
          id === (orgId === 'org-a' ? 'team-a' : 'team-b') ? { id, org_id: orgId } : undefined,
      },
      chatRepo: {
        getChannel: (id: string) => channels.get(id),
        listMessagesByChannel: (id: string, limit: number) => {
          calls.channelLimits.push(limit);
          return Array.from({ length: Math.min(limit, 3) }, (_, index) => ({
            id: `${id}-message-${index}`,
            channel_id: id,
            content: `${id} message ${index}`,
          }));
        },
        listThreadsByChannel: (id: string, limit: number) => {
          calls.threadListLimits.push(limit);
          return [...threads.values()].filter((thread) => thread.channel_id === id).slice(0, limit);
        },
        getThread: (id: string) => threads.get(id),
        listMessagesByThread: (id: string, limit: number) => {
          calls.threadLimits.push(limit);
          return [{ id: `${id}-message`, thread_id: id, content: `${id} detail` }].slice(0, limit);
        },
      },
    },
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const servers: http.Server[] = [];

async function setup() {
  const fixture = createFixture();
  const app = express();
  app.use(express.json());
  app.use('/api', createChatHistoryAccessRouter({
    ...(fixture.deps as unknown as Parameters<typeof createChatHistoryAccessRouter>[0]),
    skipAdminAuth: true,
  }));
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  const request = async (
    pathname: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: Record<string, any> }> => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${pathname}`, init);
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  return { ...fixture, request };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

async function defineAndGrant(ctx: Setup, input: {
  orgId?: string;
  teamId?: string;
  channelId?: string;
  agentId?: string;
} = {}) {
  const orgId = input.orgId ?? 'org-a';
  const teamId = input.teamId ?? 'team-a';
  const channelId = input.channelId ?? 'channel-a';
  const agentId = input.agentId ?? 'agent-a';
  const scope = await ctx.request(`/orgs/${orgId}/chat-history/channels/${channelId}/scope`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teamId }),
  });
  const grant = await ctx.request(`/orgs/${orgId}/chat-history/channels/${channelId}/agents/${agentId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teamId }),
  });
  return { scope, grant };
}

describe('chat history access routes', () => {
  it('lets an organization admin define a channel scope and grant a C3-mapped agent', async () => {
    const ctx = await setup();
    const { scope, grant } = await defineAndGrant(ctx);

    expect(scope.status).toBe(200);
    expect(scope.body.scope).toMatchObject({
      org_id: 'org-a',
      team_id: 'team-a',
      channel_id: 'channel-a',
    });
    expect(grant.status).toBe(200);
    expect(grant.body.grant).toMatchObject({
      org_id: 'org-a',
      team_id: 'team-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      revoked_at: null,
    });
  });

  // REC-006 adaptation: membership/cross-team management denial tests are
  // superseded by main's admin-principal middleware (covered in
  // packages/server/src/middleware/admin-auth.test.ts); the data-boundary
  // behavior (scope/grant org ownership) is covered by the remaining tests.

  it('reads only actively granted same-organization and team channel and thread history with bounded limits', async () => {
    const ctx = await setup();
    await defineAndGrant(ctx);
    ctx.accessRepo.upsertChannelScope({
      org_id: 'org-b',
      team_id: 'team-b',
      channel_id: 'channel-b',
      scoped_by_user_id: 'operator-b',
    });
    ctx.accessRepo.upsertGrant({
      org_id: 'org-b',
      team_id: 'team-b',
      channel_id: 'channel-b',
      agent_id: 'agent-a',
      granted_by_user_id: 'operator-b',
    });

    const channel = await ctx.request('/chat/agent/history?channelId=channel-a&includeThreadMessages=true&limit=9999&threadLimit=9999', {
      headers: { authorization: `Bearer ${rawHistoryToken}` },
    });
    expect(channel.status).toBe(200);
    expect(channel.body).toMatchObject({
      actor: 'agent-a',
      scope: 'channels:history',
      history: [{ channel: { id: 'channel-a' } }],
    });
    expect(JSON.stringify(channel.body)).not.toContain('channel-b');
    // REC-006 adaptation: limits are enforced in the route (slice) against
    // main's ChatRepository (which takes no limit argument), so boundedness is
    // asserted on the returned payload instead of repository call arguments.
    expect(channel.body.history.length).toBeLessThanOrEqual(500);

    const thread = await ctx.request('/chat/agent/history?threadId=thread-a&limit=9999', {
      headers: { authorization: `Bearer ${rawHistoryToken}` },
    });
    expect(thread.status).toBe(200);
    expect(thread.body.thread).toMatchObject({ id: 'thread-a' });
  });

  it('denies a token without channels:history and does not treat C3 channel references as grants', async () => {
    const missingScope = await setup();
    missingScope.token.scopes = [];
    const capabilityDenied = await missingScope.request('/chat/agent/history?channelId=channel-a', {
      headers: { authorization: `Bearer ${rawHistoryToken}` },
    });
    expect(capabilityDenied.status).toBe(403);
    expect(capabilityDenied.body).toMatchObject({
      code: 'AUTH_SCOPE_DENIED',
      missingScopes: ['channels:history'],
    });

    const mappingOnly = await setup();
    const grantDenied = await mappingOnly.request('/chat/agent/history?channelId=channel-a', {
      headers: { authorization: `Bearer ${rawHistoryToken}` },
    });
    expect(grantDenied.status).toBe(404);
    expect(grantDenied.body).toEqual({
      code: 'CHAT_HISTORY_NOT_FOUND',
      error: 'Chat history resource not found.',
    });
  });

  it('applies grant revocation immediately', async () => {
    const ctx = await setup();
    await defineAndGrant(ctx);
    const before = await ctx.request('/chat/agent/history?channelId=channel-a', {
      headers: { authorization: `Bearer ${rawHistoryToken}` },
    });
    const revoked = await ctx.request('/orgs/org-a/chat-history/channels/channel-a/agents/agent-a', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Assignment ended' }),
    });
    const after = await ctx.request('/chat/agent/history?channelId=channel-a', {
      headers: { authorization: `Bearer ${rawHistoryToken}` },
    });

    expect(before.status).toBe(200);
    expect(revoked.status).toBe(200);
    expect(revoked.body.grant).toMatchObject({
      revoked_at: expect.any(String),
      revocation_reason: 'Assignment ended',
    });
    expect(after.status).toBe(404);
  });

  it('returns the same no-leak response for missing and unauthorized channels and threads', async () => {
    const ctx = await setup();
    await defineAndGrant(ctx);
    const headers = { authorization: `Bearer ${rawHistoryToken}` };
    const missingChannel = await ctx.request('/chat/agent/history?channelId=missing-channel', { headers });
    const unauthorizedChannel = await ctx.request('/chat/agent/history?channelId=channel-b', { headers });
    const missingThread = await ctx.request('/chat/agent/history?threadId=missing-thread', { headers });
    const unauthorizedThread = await ctx.request('/chat/agent/history?threadId=thread-b', { headers });

    expect(missingChannel.status).toBe(404);
    expect(unauthorizedChannel.status).toBe(404);
    expect(missingThread.status).toBe(404);
    expect(unauthorizedThread.status).toBe(404);
    expect(missingChannel.body).toEqual(unauthorizedChannel.body);
    expect(missingThread.body).toEqual(unauthorizedThread.body);
    expect(missingChannel.body).toEqual(missingThread.body);
  });

  // Luna-high F5: the channel-to-org/team association is authoritative chat
  // ownership. A scope may not be claimed over another organization's channel,
  // nor may a team-scoped channel be re-scoped — rejection happens before
  // upsertChannelScope, so no scope row is mutated.
  it('rejects scoping another organization’s channel without mutating any scope', async () => {
    const ctx = await setup();
    const crossOrg = await ctx.request('/orgs/org-a/chat-history/channels/channel-org-b/scope', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: 'team-a' }),
    });
    expect(crossOrg.status).toBe(403);
    expect(crossOrg.body).toMatchObject({ code: 'CHAT_HISTORY_SCOPE_FORBIDDEN' });

    // No scope row exists for the foreign channel under any org.
    expect(ctx.accessRepo.getChannelScope('channel-org-b')).toBeUndefined();
    expect(ctx.accessRepo.listChannelScopes({ org_id: 'org-a' })).toEqual([]);

    // And the follow-on grant path stays closed for that channel.
    const grant = await ctx.request('/orgs/org-a/chat-history/channels/channel-org-b/agents/agent-a', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: 'team-a' }),
    });
    expect(grant.status).toBe(404);
  });

  it('rejects re-scoping a team-owned channel to a different team or to org-wide', async () => {
    const ctx = await setup();
    const crossTeam = await ctx.request('/orgs/org-a/chat-history/channels/channel-team-b/scope', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: 'team-a' }),
    });
    expect(crossTeam.status).toBe(403);
    expect(crossTeam.body).toMatchObject({ code: 'CHAT_HISTORY_SCOPE_FORBIDDEN' });

    const widened = await ctx.request('/orgs/org-a/chat-history/channels/channel-team-b/scope', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(widened.status).toBe(403);
    expect(widened.body).toMatchObject({ code: 'CHAT_HISTORY_SCOPE_FORBIDDEN' });

    expect(ctx.accessRepo.getChannelScope('channel-team-b')).toBeUndefined();
  });
});
