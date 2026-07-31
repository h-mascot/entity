import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInviteControls,
  resetInviteControlsForTests,
  type InviteControls,
} from './controls';
import { hashInviteToken } from './token';

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

async function loadControls(options: {
  now?: () => Date;
  mintToken?: () => string;
} = {}): Promise<InviteControls> {
  activeDbPath = tempDbPath('entity-invite-controls');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  resetInviteControlsForTests();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  const { createAgentInviteRepository } = await import('../../../../db/src/agent-invites');
  const repo = createAgentInviteRepository();
  return createInviteControls({
    repo,
    now: options.now,
    mintToken: options.mintToken,
  });
}

afterEach(async () => {
  resetInviteControlsForTests();
  const dbPathToClose = activeDbPath;
  if (dbPathToClose) {
    const closePath = tempDbPath('entity-invite-controls-close');
    cleanupDbPaths.push(closePath);
    vi.stubEnv('ENTITY_TASK_DB_PATH', closePath);
    try {
      const { getEntityDatabase } = await import('../../../../db/src/entity-db');
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

describe('invite-kit durable controls (WP2-A-05)', () => {
  beforeEach(() => {
    resetInviteControlsForTests();
  });

  it('creates durable invite with show-once token and URL bundle', async () => {
    const controls = await loadControls({
      mintToken: () => 'createdtoken01',
    });
    const result = controls.createInvite({
      agentName: 'Scout',
      role: 'worker',
      selectedModules: ['entity-mc'],
      permissionsScope: ['tasks:read'],
      creationSource: 'agents_invite',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.persistence).toBe('durable');
    expect(result.value.token).toBe('createdtoken01');
    expect(result.value.setupPath).toBe('/onboard/agent/createdtoken01');
    expect(result.value.manifestPath).toContain('/api/onboarding/agent-session/createdtoken01/manifest');
    expect(result.value.status).toBe('created');
    expect(result.value.creationSource).toBe('agents_invite');

    const got = controls.getInvite(result.value.id);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    // Audit-safe: GET must not re-emit raw token.
    expect(got.value.token).toBeUndefined();
    expect(got.value.setupPath).toBeUndefined();
    expect(got.value.progress.length).toBeGreaterThan(0);
    expect(got.value.rotated).toBe(false);

    const listed = controls.listInvites();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.count).toBe(1);
    expect(listed.value.invites[0]?.id).toBe(result.value.id);
    expect(listed.value.invites[0]?.token).toBeUndefined();
  });

  it('revokes invite and blocks tokenized access', async () => {
    const controls = await loadControls({
      mintToken: () => 'revoketoken0001',
    });
    const created = controls.createInvite({ agentName: 'Scout' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const allowed = controls.resolveTokenizedInviteAccess('revoketoken0001');
    expect(allowed.kind).toBe('allowed');

    const revoked = controls.revokeInvite(created.value.id, { revokedBy: 'henry' });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value.status).toBe('revoked');
    expect(revoked.value.revokedBy).toBe('henry');
    expect(revoked.value.revokedAt).toBeTruthy();

    const denied = controls.resolveTokenizedInviteAccess('revoketoken0001');
    expect(denied.kind).toBe('denied');
    if (denied.kind !== 'denied') return;
    expect(denied.code).toBe('invite_revoked');
    expect(denied.statusCode).toBe(401);
  });

  it('regenerate rotates token hash and blocks previous token', async () => {
    let n = 0;
    const controls = await loadControls({
      mintToken: () => {
        n += 1;
        return n === 1 ? 'oldtokenxxxxxxx' : 'newtokenyyyyyyy';
      },
    });
    const created = controls.createInvite({ agentName: 'Scout' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.token).toBe('oldtokenxxxxxxx');

    const regenerated = controls.regenerateInvite(created.value.id);
    expect(regenerated.ok).toBe(true);
    if (!regenerated.ok) return;
    expect(regenerated.value.token).toBe('newtokenyyyyyyy');
    expect(regenerated.value.generation).toBe(2);
    expect(regenerated.value.status).toBe('created');
    expect(regenerated.value.rotated).toBe(true);

    const oldDenied = controls.resolveTokenizedInviteAccess('oldtokenxxxxxxx');
    expect(oldDenied.kind).toBe('denied');
    if (oldDenied.kind === 'denied') {
      expect(oldDenied.code).toBe('invite_token_rotated');
    }

    const newAllowed = controls.resolveTokenizedInviteAccess('newtokenyyyyyyy');
    expect(newAllowed.kind).toBe('allowed');

    // previous hash retained for audit/lineage; raw token never persisted
    const record = controls._repo.getInviteById(created.value.id);
    expect(record?.previous_token_hash).toBe(hashInviteToken('oldtokenxxxxxxx'));
    expect(record?.token_hash).toBe(hashInviteToken('newtokenyyyyyyy'));
    expect(record?.token_hash).not.toBe(record?.previous_token_hash);
  });

  it('promotes past-expiry invites and blocks tokenized access', async () => {
    const createdAt = new Date('2026-07-31T12:00:00.000Z');
    const controls = await loadControls({
      now: () => createdAt,
      mintToken: () => 'expiredtoken001',
    });
    const created = controls.createInvite({
      agentName: 'Scout',
      expiresAt: '2026-07-31T12:05:00.000Z',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const later = createInviteControls({
      repo: controls._repo,
      now: () => new Date('2026-07-31T12:10:00.000Z'),
    });
    const denied = later.resolveTokenizedInviteAccess('expiredtoken001');
    expect(denied.kind).toBe('denied');
    if (denied.kind !== 'denied') return;
    expect(['invite_expired', 'invite_past_expires_at']).toContain(denied.code);

    const got = later.getInvite(created.value.id);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.status).toBe('expired');
  });

  it('negative: revoke missing invite → 404', async () => {
    const controls = await loadControls();
    const result = controls.revokeInvite('does-not-exist');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.statusCode).toBe(404);
    expect(result.code).toBe('not_found');
  });

  it('negative: create without agentName → 400', async () => {
    const controls = await loadControls();
    const result = controls.createInvite({ agentName: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('invalid_input');
  });

  it('negative: double-revoke from revoked is forbidden/terminal', async () => {
    const controls = await loadControls({
      mintToken: () => 'doublerevoke0001',
    });
    const created = controls.createInvite({ agentName: 'Scout' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const first = controls.revokeInvite(created.value.id);
    expect(first.ok).toBe(true);
    const second = controls.revokeInvite(created.value.id);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(['forbidden_transition', 'terminal_status']).toContain(second.code);
  });

  it('legacy tokens without durable invite remain legacy', async () => {
    const controls = await loadControls();
    const access = controls.resolveTokenizedInviteAccess('legacyonlytoken1');
    expect(access.kind).toBe('legacy');
  });

  it('reportProgressFromToken moves opened → in_progress → completed (WP2-B-07)', async () => {
    const controls = await loadControls({
      mintToken: () => 'progresstoken001',
    });
    const created = controls.createInvite({
      agentName: 'Progress Bot',
      selectedModules: ['entity-mc'],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    controls.markOpenedFromToken('progresstoken001');
    const opened = controls.getInvite(created.value.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.status).toBe('opened');

    controls.reportProgressFromToken('progresstoken001', [
      { id: 'install-entity-mc', status: 'running', message: 'installing' },
    ]);
    const running = controls.getInvite(created.value.id);
    expect(running.ok).toBe(true);
    if (!running.ok) return;
    expect(running.value.status).toBe('in_progress');
    expect(running.value.progress[0]?.status).toBe('running');

    controls.reportProgressFromToken('progresstoken001', [
      { id: 'install-entity-mc', status: 'done', message: 'ok' },
    ]);
    const completed = controls.getInvite(created.value.id);
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.value.status).toBe('completed');
    expect(completed.value.progress[0]?.status).toBe('done');
    expect(completed.value.token).toBeUndefined();
  });
});
