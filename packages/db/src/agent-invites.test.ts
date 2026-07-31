import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let activeDbPath: string | null = null;
let cleanupDbPaths: string[] = [];

function sqliteFiles(dbPath: string): string[] {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

function removeSqliteFiles(dbPath: string): void {
  for (const file of sqliteFiles(dbPath)) {
    fs.rmSync(file, { force: true });
  }
}

function tempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

async function loadInviteRepo(): Promise<typeof import('./agent-invites')> {
  activeDbPath = tempDbPath('entity-agent-invites');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  return import('./agent-invites');
}

afterEach(async () => {
  const dbPathToClose = activeDbPath;
  if (dbPathToClose) {
    const closePath = tempDbPath('entity-agent-invites-close');
    cleanupDbPaths.push(closePath);
    vi.stubEnv('ENTITY_TASK_DB_PATH', closePath);
    try {
      const { getEntityDatabase } = await import('./entity-db');
      getEntityDatabase().close();
    } catch {
      // best-effort
    }
  }

  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of cleanupDbPaths) {
    removeSqliteFiles(dbPath);
  }
  activeDbPath = null;
  cleanupDbPaths = [];
});

describe('agent_invites durable foundation', () => {
  it('creates invite with token_hash (not raw token) and progress rows', async () => {
    const mod = await loadInviteRepo();
    const repo = mod.createAgentInviteRepository();
    const raw = 'raw-invite-token-abc123';
    const tokenHash = hashToken(raw);

    const created = repo.createInvite({
      token_hash: tokenHash,
      agent_name: 'Scout',
      role: 'worker',
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      creation_source: 'agents_invite',
      selected_modules: ['entity-mc'],
      permissions_scope: ['tasks:read'],
      progress: [
        {
          step_id: 'install-entity-mc',
          label: 'Install Entity MC',
          module_id: 'entity-mc',
          status: 'pending',
        },
      ],
    });

    expect(created.status).toBe('created');
    expect(created.token_hash).toBe(tokenHash);
    expect(created.token_hash).not.toContain(raw);
    expect(created.creation_source).toBe('agents_invite');
    expect(created.selected_modules).toEqual(['entity-mc']);

    const byHash = repo.getInviteByTokenHash(tokenHash);
    expect(byHash?.id).toBe(created.id);

    const progress = repo.listProgress(created.id);
    expect(progress).toHaveLength(1);
    expect(progress[0]?.step_id).toBe('install-entity-mc');
    expect(progress[0]?.status).toBe('pending');
  });

  it('updates status for revoke and regenerate token rotation', async () => {
    const mod = await loadInviteRepo();
    const repo = mod.createAgentInviteRepository();
    const firstHash = hashToken('token-one-xxxxxxxx');
    const secondHash = hashToken('token-two-yyyyyyyy');

    const created = repo.createInvite({
      token_hash: firstHash,
      agent_name: 'Scout',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      creation_source: 'agents_invite',
    });

    const revoked = repo.updateInvite(created.id, {
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by: 'henry',
    });
    expect(revoked?.status).toBe('revoked');
    expect(revoked?.revoked_by).toBe('henry');

    const regenerated = repo.updateInvite(created.id, {
      status: 'created',
      token_hash: secondHash,
      generation: (revoked?.generation ?? 1) + 1,
      previous_token_hash: firstHash,
      opened_at: null,
      completed_at: null,
      revoked_at: null,
      revoked_by: null,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    expect(regenerated?.status).toBe('created');
    expect(regenerated?.token_hash).toBe(secondHash);
    expect(regenerated?.previous_token_hash).toBe(firstHash);
    expect(regenerated?.generation).toBe(2);
    expect(repo.getInviteByTokenHash(firstHash)).toBeUndefined();
    expect(repo.getInviteByTokenHash(secondHash)?.id).toBe(created.id);
  });

  it('rejects unsupported status values on update', async () => {
    const mod = await loadInviteRepo();
    const repo = mod.createAgentInviteRepository();
    const created = repo.createInvite({
      token_hash: hashToken('token-three-zzzzzzzz'),
      agent_name: 'Scout',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(() =>
      repo.updateInvite(created.id, { status: 'verified' as never }),
    ).toThrow(/Unsupported agent invite status/);
  });

  it('lists invites filtered by status', async () => {
    const mod = await loadInviteRepo();
    const repo = mod.createAgentInviteRepository();
    const a = repo.createInvite({
      token_hash: hashToken('list-a-token-aaaaaaa'),
      agent_name: 'A',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    repo.createInvite({
      token_hash: hashToken('list-b-token-bbbbbbb'),
      agent_name: 'B',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    repo.updateInvite(a.id, { status: 'opened', opened_at: new Date().toISOString() });

    const opened = repo.listInvites({ status: 'opened' });
    expect(opened).toHaveLength(1);
    expect(opened[0]?.agent_name).toBe('A');
  });
});
