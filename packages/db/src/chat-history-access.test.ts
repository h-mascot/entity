import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dbPaths: string[] = [];

async function loadRepository() {
  const dbPath = path.join(os.tmpdir(), `entity-chat-history-access-${process.pid}-${randomUUID()}.sqlite`);
  dbPaths.push(dbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', `${dbPath}.missing`);
  const module = await import('./chat-history-access');
  return module.createChatHistoryAccessRepository();
}

afterEach(async () => {
  try {
    const { getEntityDatabase } = await import('./entity-db');
    getEntityDatabase().close();
  } catch {
    // Missing implementation is expected during the red phase.
  }
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of dbPaths.splice(0)) {
    for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      fs.rmSync(candidate, { force: true });
    }
  }
});

describe('chat history access repository', () => {
  it('stores one authoritative organization and optional team scope for a stable channel identity', async () => {
    const repo = await loadRepository();
    const original = repo.upsertChannelScope({
      channel_id: 'channel-scope',
      org_id: 'org-a',
      team_id: 'team-a',
      scoped_by_user_id: 'operator-a',
    });
    const updated = repo.upsertChannelScope({
      channel_id: 'channel-scope',
      org_id: 'org-b',
      team_id: null,
      scoped_by_user_id: 'operator-b',
    });

    expect(updated.id).toBe(original.id);
    expect(updated).toMatchObject({
      channel_id: 'channel-scope',
      org_id: 'org-b',
      team_id: null,
      scoped_by_user_id: 'operator-b',
    });
    expect(repo.getChannelScope('channel-scope')).toEqual(updated);
  });

  it('grants one agent active access to an authoritative organization and channel scope', async () => {
    const repo = await loadRepository();
    repo.upsertChannelScope({
      channel_id: 'channel-a',
      org_id: 'org-a',
      team_id: 'team-a',
      scoped_by_user_id: 'operator-a',
    });
    const grant = repo.upsertGrant({
      org_id: 'org-a',
      team_id: 'team-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      granted_by_user_id: 'operator-a',
    });

    expect(grant).toMatchObject({
      org_id: 'org-a',
      team_id: 'team-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      granted_by_user_id: 'operator-a',
      revoked_at: null,
      revoked_by_user_id: null,
      revocation_reason: null,
    });
    expect(repo.getActiveGrant('org-a', 'channel-a', 'agent-a')).toEqual(grant);
    expect(repo.listActiveGrants({ org_id: 'org-a', channel_id: 'channel-a' })).toEqual([grant]);

    repo.upsertChannelScope({
      channel_id: 'channel-b',
      org_id: 'org-a',
      team_id: null,
      scoped_by_user_id: 'operator-a',
    });
    const organizationWideGrant = repo.upsertGrant({
      org_id: 'org-a',
      channel_id: 'channel-b',
      agent_id: 'agent-b',
      granted_by_user_id: 'operator-a',
    });
    expect(organizationWideGrant.team_id).toBeNull();
  });

  it('records explicit revocation metadata and immediately removes revoked access from active reads', async () => {
    const repo = await loadRepository();
    repo.upsertChannelScope({
      channel_id: 'channel-a',
      org_id: 'org-a',
      team_id: 'team-a',
      scoped_by_user_id: 'operator-a',
    });
    repo.upsertGrant({
      org_id: 'org-a',
      team_id: 'team-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      granted_by_user_id: 'operator-a',
    });

    const revoked = repo.revokeGrant({
      org_id: 'org-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      revoked_by_user_id: 'operator-b',
      revocation_reason: 'Channel assignment ended',
    });

    expect(revoked).toMatchObject({
      org_id: 'org-a',
      team_id: 'team-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      granted_by_user_id: 'operator-a',
      revoked_by_user_id: 'operator-b',
      revocation_reason: 'Channel assignment ended',
      revoked_at: expect.any(String),
    });
    expect(repo.getActiveGrant('org-a', 'channel-a', 'agent-a')).toBeUndefined();
    expect(repo.listActiveGrants({ org_id: 'org-a', channel_id: 'channel-a' })).toEqual([]);
  });

  it('upserts a stable grant without duplicates and isolates active reads by organization', async () => {
    const repo = await loadRepository();
    repo.upsertChannelScope({
      channel_id: 'channel-a',
      org_id: 'org-a',
      team_id: 'team-a',
      scoped_by_user_id: 'operator-a',
    });
    repo.upsertChannelScope({
      channel_id: 'channel-b',
      org_id: 'org-b',
      team_id: 'team-b',
      scoped_by_user_id: 'operator-b',
    });
    const original = repo.upsertGrant({
      org_id: 'org-a',
      team_id: 'team-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      granted_by_user_id: 'operator-a',
    });
    repo.upsertChannelScope({
      channel_id: 'channel-a',
      org_id: 'org-a',
      team_id: 'team-b',
      scoped_by_user_id: 'operator-b',
    });
    const updated = repo.upsertGrant({
      org_id: 'org-a',
      team_id: 'team-b',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      granted_by_user_id: 'operator-b',
    });
    const otherOrganization = repo.upsertGrant({
      org_id: 'org-b',
      team_id: 'team-b',
      channel_id: 'channel-b',
      agent_id: 'agent-a',
      granted_by_user_id: 'operator-b',
    });

    expect(updated.id).toBe(original.id);
    expect(updated).toMatchObject({
      org_id: 'org-a',
      team_id: 'team-b',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      granted_by_user_id: 'operator-b',
    });
    expect(repo.listActiveGrants({ org_id: 'org-a', agent_id: 'agent-a' })).toEqual([updated]);
    expect(repo.listActiveGrants({ org_id: 'org-b', agent_id: 'agent-a' })).toEqual([otherOrganization]);
    expect(repo.listActiveGrants({ org_id: 'org-a', channel_id: 'channel-b' })).toEqual([]);
    expect(repo.getActiveGrant('org-a', 'channel-b', 'agent-a')).toBeUndefined();
    expect(repo.getActiveGrant('org-b', 'channel-a', 'agent-a')).toBeUndefined();
  });
});
