import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let activeDbPath: string | null = null;
let cleanupDbPaths: string[] = [];

function sqliteFiles(dbPath: string): string[] {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

function removeSqliteFiles(dbPath: string): string[] {
  for (const file of sqliteFiles(dbPath)) {
    fs.rmSync(file, { force: true });
  }
  return [];
}

function tempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

async function createServices(nowIso = '2026-07-31T08:00:00.000Z') {
  activeDbPath = tempDbPath('entity-chief-routing');
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
  } = await import('../workplane-attach/service');
  resetWorkplaneAttachServiceForTests();
  const {
    resetChiefRoutingServiceForTests,
    createChiefRoutingService,
  } = await import('./service');
  resetChiefRoutingServiceForTests();

  const invites = createInviteControls();
  let nowMs = Date.parse(nowIso);
  const clock = {
    now: () => new Date(nowMs),
    advance(ms: number) {
      nowMs += ms;
    },
    set(iso: string) {
      nowMs = Date.parse(iso);
    },
  };
  const presence = createPresenceService({
    invites,
    now: () => clock.now(),
    staleAfterMs: 60_000,
  });
  const attach = createWorkplaneAttachService({
    invites,
    presence,
    now: () => clock.now(),
  });
  const routing = createChiefRoutingService({
    attach,
    presence,
    now: () => clock.now(),
  });

  return { routing, attach, invites, presence, clock };
}

afterEach(async () => {
  try {
    const { resetChiefRoutingServiceForTests } = await import('./service');
    resetChiefRoutingServiceForTests();
  } catch {
    // ignore
  }
  try {
    const { resetWorkplaneAttachServiceForTests } = await import('../workplane-attach/service');
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
    const closePath = tempDbPath('entity-chief-routing-close');
    cleanupDbPaths.push(closePath);
    vi.stubEnv('ENTITY_TASK_DB_PATH', closePath);
    try {
      const { getEntityDatabase } = await import('../../../../db/src/entity-db');
      getEntityDatabase().close();
    } catch {
      // ignore
    }
    activeDbPath = null;
  }
  for (const dbPath of cleanupDbPaths) {
    removeSqliteFiles(dbPath);
  }
  cleanupDbPaths = [];
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('chief routing service (THE-885 / WP2-B-04)', () => {
  it('assigns chief only for attached agents and clears idempotently', async () => {
    const { routing, attach } = await createServices();
    const denied = routing.assignChief({ workplaneId: 'wp-r', agentId: 'missing' });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('chief_not_attached');

    const attached = attach.attach({
      workplaneId: 'wp-r',
      agentId: 'chief-1',
      agentName: 'Chief Ada',
      role: 'chief',
    });
    expect(attached.ok).toBe(true);

    const assigned = routing.assignChief({
      workplaneId: 'wp-r',
      agentId: 'chief-1',
      assignedBy: 'operator',
      priorityWindowMs: 30_000,
    });
    expect(assigned.ok).toBe(true);
    if (assigned.ok) {
      expect(assigned.value.created).toBe(true);
      expect(assigned.value.chief.chiefAgentId).toBe('chief-1');
      expect(assigned.value.chief.priorityWindowMs).toBe(30_000);
    }

    const cleared = routing.clearChief('wp-r');
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.value.alreadyCleared).toBe(false);
    const clearedAgain = routing.clearChief('wp-r');
    expect(clearedAgain.ok).toBe(true);
    if (clearedAgain.ok) expect(clearedAgain.value.alreadyCleared).toBe(true);
  });

  it('enforces chief priority then allows worker after window / stale fallback', async () => {
    const { routing, attach, presence, clock } = await createServices('2026-07-31T08:00:00.000Z');

    attach.attach({ workplaneId: 'wp-r', agentId: 'chief-1', agentName: 'Chief', role: 'chief' });
    attach.attach({ workplaneId: 'wp-r', agentId: 'worker-1', agentName: 'Worker', role: 'worker' });
    routing.assignChief({
      workplaneId: 'wp-r',
      agentId: 'chief-1',
      priorityWindowMs: 60_000,
    });

    presence.recordHeartbeat({
      agentId: 'chief-1',
      status: 'live',
      currentWorkplaneId: 'wp-r',
    });

    const blocked = routing.claim({
      workplaneId: 'wp-r',
      agentId: 'worker-1',
      taskId: 10,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('chief_priority');
      expect(blocked.policy?.priorityWindowOpen).toBe(true);
    }

    const chiefClaim = routing.claim({
      workplaneId: 'wp-r',
      agentId: 'chief-1',
      taskId: 10,
    });
    expect(chiefClaim.ok).toBe(true);
    if (chiefClaim.ok) {
      expect(chiefClaim.value.created).toBe(true);
      expect(chiefClaim.value.policy.code).toBe('chief_claim');
    }

    // Release and advance past window — worker may claim.
    routing.release('wp-r', 10);
    clock.advance(60_000);
    const afterWindow = routing.claim({
      workplaneId: 'wp-r',
      agentId: 'worker-1',
      taskId: 11,
    });
    // Window for task 11 is newly opened at advanced time with live chief → priority again.
    expect(afterWindow.ok).toBe(false);
    if (!afterWindow.ok) expect(afterWindow.code).toBe('chief_priority');

    // Make chief stale via time + no fresh heartbeat within staleAfterMs.
    clock.advance(120_000);
    const fallback = routing.claim({
      workplaneId: 'wp-r',
      agentId: 'worker-1',
      taskId: 12,
    });
    expect(fallback.ok).toBe(true);
    if (fallback.ok) {
      expect(fallback.value.policy.code).toBe('worker_claim_chief_unavailable');
    }
  });

  it('supports operator assign and rejects unattached targets', async () => {
    const { routing, attach } = await createServices();
    attach.attach({ workplaneId: 'wp-r', agentId: 'worker-1', agentName: 'Worker' });

    const missingTarget = routing.assign({
      workplaneId: 'wp-r',
      agentId: 'ghost',
      assignedBy: 'operator',
      asOperator: true,
      taskId: 1,
    });
    expect(missingTarget.ok).toBe(false);
    if (!missingTarget.ok) expect(missingTarget.code).toBe('target_not_attached');

    const assigned = routing.assign({
      workplaneId: 'wp-r',
      agentId: 'worker-1',
      assignedBy: 'operator',
      asOperator: true,
      taskId: 1,
    });
    expect(assigned.ok).toBe(true);
    if (assigned.ok) {
      expect(assigned.value.claim.claimMode).toBe('assign');
      expect(assigned.value.policy.code).toBe('operator_assign_no_chief');
    }

    const conflict = routing.claim({
      workplaneId: 'wp-r',
      agentId: 'worker-1',
      taskId: 1,
    });
    // Same holder — idempotent
    expect(conflict.ok).toBe(true);
    if (conflict.ok) expect(conflict.value.created).toBe(false);

    attach.attach({ workplaneId: 'wp-r', agentId: 'worker-2', agentName: 'Other' });
    const denied = routing.claim({
      workplaneId: 'wp-r',
      agentId: 'worker-2',
      taskId: 1,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('already_claimed');
  });

  it('panel reflects claim gate and attached agents without inventing chief live', async () => {
    const { routing, attach } = await createServices();
    attach.attach({ workplaneId: 'wp-r', agentId: 'chief-1', agentName: 'Chief' });
    routing.assignChief({ workplaneId: 'wp-r', agentId: 'chief-1', priorityWindowMs: 5_000 });

    const panel = routing.getPanel('wp-r', 3);
    expect(panel.ok).toBe(true);
    if (panel.ok) {
      expect(panel.value.chief?.chiefAgentId).toBe('chief-1');
      expect(panel.value.chiefPresence?.presenceStatus).toBe('missing');
      expect(panel.value.chiefPresence?.available).toBe(false);
      expect(panel.value.policy.workersMayClaim).toBe(true);
      expect(panel.value.attachedAgentIds).toContain('chief-1');
    }
  });
});
