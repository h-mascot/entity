import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

async function createService(nowIso = '2026-07-31T06:00:00.000Z') {
  activeDbPath = tempDbPath('entity-presence-service');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);

  const { resetInviteControlsForTests, createInviteControls } = await import('../invite-kit/controls');
  resetInviteControlsForTests();
  const { resetPresenceServiceForTests, createPresenceService } = await import('./service');
  resetPresenceServiceForTests();

  const invites = createInviteControls();
  const nowMs = Date.parse(nowIso);
  const presence = createPresenceService({
    invites,
    now: () => new Date(nowMs),
    staleAfterMs: 60_000,
  });

  return { presence, invites, nowMs };
}

afterEach(async () => {
  try {
    const { resetPresenceServiceForTests } = await import('./service');
    resetPresenceServiceForTests();
  } catch {
    // ignore
  }
  try {
    const { resetInviteControlsForTests } = await import('../invite-kit/controls');
    resetInviteControlsForTests();
  } catch {
    // ignore
  }
  if (activeDbPath) {
    const closePath = tempDbPath('entity-presence-service-close');
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

describe('presence service (WP2-B-02)', () => {
  beforeEach(() => {
    activeDbPath = null;
  });

  it('records heartbeat and keeps live when fresh', async () => {
    const { presence } = await createService('2026-07-31T06:00:00.000Z');
    const result = presence.recordHeartbeat({
      agentId: 'agent-live',
      status: 'live',
      currentWorkplaneId: 'wp-1',
      currentTaskId: 11,
      lastSeenAt: '2026-07-31T05:59:30.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluated.presenceStatus).toBe('live');
    expect(result.value.evaluated.currentWorkplaneId).toBe('wp-1');
    expect(result.value.evaluated.degradedReasons).not.toContain('presence_missing');
  });

  it('marks stale when last_seen exceeds threshold', async () => {
    const { presence } = await createService('2026-07-31T06:00:00.000Z');
    const write = presence.recordHeartbeat({
      agentId: 'agent-stale',
      status: 'live',
      currentWorkplaneId: 'wp-stale',
      lastSeenAt: '2026-07-31T05:50:00.000Z',
    });
    expect(write.ok).toBe(true);

    const read = presence.getAgentPresence('agent-stale');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.presenceStatus).toBe('stale');
    expect(read.value.degradedReasons).toContain('presence_stale');
    expect(read.value.heartbeatFreshnessLabel).toMatch(/Stale/i);
  });

  it('rejects derived status writes and missing agentId', async () => {
    const { presence } = await createService();
    const missing = presence.recordHeartbeat({ agentId: '' });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.code).toBe('invalid_input');

    const derived = presence.recordHeartbeat({ agentId: 'a1', status: 'stale' });
    expect(derived.ok).toBe(false);
    if (derived.ok) return;
    expect(derived.code).toBe('invalid_status');
  });

  it('workplane panel shows missing invite and never invents live agents', async () => {
    const { presence, invites } = await createService('2026-07-31T06:00:00.000Z');
    const created = invites.createInvite({
      agentName: 'Bound Scout',
      role: 'worker',
      workplaneId: 'wp-panel',
      taskId: 42,
    });
    expect(created.ok).toBe(true);

    const emptyOther = presence.getWorkplanePresence('wp-empty');
    expect(emptyOther.ok).toBe(true);
    if (!emptyOther.ok) return;
    expect(emptyOther.value.agents).toEqual([]);
    expect(emptyOther.value.counts.total).toBe(0);

    const panel = presence.getWorkplanePresence('wp-panel');
    expect(panel.ok).toBe(true);
    if (!panel.ok || !created.ok) return;
    expect(panel.value.agents).toHaveLength(1);
    expect(panel.value.agents[0]?.presenceStatus).toBe('missing');
    expect(panel.value.agents[0]?.source).toBe('invite_missing');
    expect(panel.value.agents[0]?.inviteId).toBe(created.value.id);
    expect(panel.value.counts.missing).toBe(1);
    expect(panel.value.counts.live).toBe(0);

    // Real heartbeat joins the panel as live; invite missing row is replaced via inviteId.
    const hb = presence.recordHeartbeat({
      agentId: 'agent-bound',
      inviteId: created.value.id,
      status: 'live',
      currentWorkplaneId: 'wp-panel',
      lastSeenAt: '2026-07-31T05:59:45.000Z',
    });
    expect(hb.ok).toBe(true);

    const after = presence.getWorkplanePresence('wp-panel');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.agents).toHaveLength(1);
    expect(after.value.agents[0]?.presenceStatus).toBe('live');
    expect(after.value.agents[0]?.source).toBe('heartbeat');
    expect(after.value.agents[0]?.agentName).toBe('Bound Scout');
    expect(after.value.counts.live).toBe(1);
    expect(after.value.counts.missing).toBe(0);
  });

  it('getAgentPresence 404 when no heartbeat', async () => {
    const { presence } = await createService();
    const missing = presence.getAgentPresence('never-seen');
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.statusCode).toBe(404);
    expect(missing.code).toBe('not_found');
  });
});
