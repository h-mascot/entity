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

async function createServices(nowIso = '2026-07-31T07:00:00.000Z') {
  activeDbPath = tempDbPath('entity-workplane-attach');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);

  const { resetInviteControlsForTests, createInviteControls } = await import('../invite-kit/controls');
  resetInviteControlsForTests();
  const { resetPresenceServiceForTests, createPresenceService } = await import('../presence/service');
  resetPresenceServiceForTests();
  const {
    resetWorkplaneAttachServiceForTests,
    createWorkplaneAttachService,
  } = await import('./service');
  resetWorkplaneAttachServiceForTests();

  const invites = createInviteControls();
  const nowMs = Date.parse(nowIso);
  const presence = createPresenceService({
    invites,
    now: () => new Date(nowMs),
    staleAfterMs: 60_000,
  });
  const attach = createWorkplaneAttachService({
    invites,
    presence,
    now: () => new Date(nowMs),
  });

  return { attach, invites, presence, nowMs };
}

afterEach(async () => {
  try {
    const { resetWorkplaneAttachServiceForTests } = await import('./service');
    resetWorkplaneAttachServiceForTests();
  } catch {
    // ignore
  }
  try {
    const { resetPresenceServiceForTests } = await import('../presence/service');
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
    const closePath = tempDbPath('entity-workplane-attach-close');
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

describe('workplane attach service (WP2-B-03)', () => {
  beforeEach(() => {
    activeDbPath = null;
  });

  it('attaches, lists as missing, and detaches with idempotency', async () => {
    const { attach } = await createServices();

    const first = attach.attach({
      workplaneId: 'wp-task-91',
      agentId: 'agent-scout',
      agentName: 'Attach Scout',
      role: 'worker',
      taskId: 91,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created).toBe(true);
    expect(first.value.agent.presenceStatus).toBe('missing');
    expect(first.value.agent.source).toBe('attachment');

    const again = attach.attach({
      workplaneId: 'wp-task-91',
      agentId: 'agent-scout',
      agentName: 'Attach Scout',
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.created).toBe(false);
    expect(again.value.attachment.id).toBe(first.value.attachment.id);

    const listed = attach.list('wp-task-91');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.counts.total).toBe(1);
    expect(listed.value.counts.missing).toBe(1);
    expect(listed.value.agents[0]?.agentId).toBe('agent-scout');
    expect(listed.value.agents[0]?.presenceStatus).toBe('missing');

    const detached = attach.detach('wp-task-91', 'agent-scout');
    expect(detached.ok).toBe(true);
    if (!detached.ok) return;
    expect(detached.value.alreadyDetached).toBe(false);

    const empty = attach.list('wp-task-91');
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.value.counts.total).toBe(0);

    const againDetach = attach.detach('wp-task-91', 'agent-scout');
    expect(againDetach.ok).toBe(true);
    if (!againDetach.ok) return;
    expect(againDetach.value.alreadyDetached).toBe(true);
  });

  it('attaches by inviteId and never invents live presence', async () => {
    const { attach, invites, presence } = await createServices();
    const created = invites.createInvite({
      agentName: 'Invite Bound',
      role: 'worker',
      taskId: 42,
      workplaneId: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const attached = attach.attach({
      workplaneId: 'wp-invite',
      inviteId: created.value.id,
      taskId: 42,
    });
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(attached.value.attachment.agentId).toBe(`invite:${created.value.id}`);
    expect(attached.value.agent.presenceStatus).toBe('missing');

    const panel = presence.getWorkplanePresence('wp-invite');
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.value.counts.missing).toBeGreaterThanOrEqual(1);
    expect(panel.value.agents.some((a) => a.source === 'attachment_missing')).toBe(true);
    expect(panel.value.agents.every((a) => a.presenceStatus !== 'live')).toBe(true);

    const hb = presence.recordHeartbeat({
      agentId: 'invite-bound-runtime',
      inviteId: created.value.id,
      status: 'live',
      currentWorkplaneId: 'wp-invite',
      currentTaskId: 42,
    });
    expect(hb.ok).toBe(true);

    const after = attach.list('wp-invite');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.agents[0]?.presenceStatus).toBe('live');
    expect(after.value.agents[0]?.source).toBe('heartbeat');
    expect(after.value.counts.live).toBe(1);
    expect(after.value.counts.missing).toBe(0);
  });

  it('rejects invalid attach/list inputs and unknown invites', async () => {
    const { attach } = await createServices();

    expect(attach.attach({ workplaneId: '', agentId: 'a' }).ok).toBe(false);
    expect(attach.attach({ workplaneId: 'wp', agentId: null }).ok).toBe(false);
    const badInvite = attach.attach({ workplaneId: 'wp', inviteId: 'missing-invite' });
    expect(badInvite.ok).toBe(false);
    if (!badInvite.ok) {
      expect(badInvite.code).toBe('invite_not_found');
      expect(badInvite.statusCode).toBe(404);
    }

    const badList = attach.list('  ');
    expect(badList.ok).toBe(false);
    if (!badList.ok) {
      expect(badList.code).toBe('invalid_input');
    }

    const badDetach = attach.detach('wp', '');
    expect(badDetach.ok).toBe(false);
  });
});
