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

function removeSqliteFiles(dbPath: string): void {
  for (const file of sqliteFiles(dbPath)) {
    fs.rmSync(file, { force: true });
  }
}

function tempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

async function createServices(nowIso = '2026-07-31T09:00:00.000Z') {
  activeDbPath = tempDbPath('entity-ask-flow');
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
  } = await import('../chief-routing/service');
  resetChiefRoutingServiceForTests();
  const {
    resetAskFlowServiceForTests,
    createAskFlowService,
  } = await import('./service');
  resetAskFlowServiceForTests();

  const invites = createInviteControls();
  let nowMs = Date.parse(nowIso);
  const clock = {
    now: () => new Date(nowMs),
    advance(ms: number) {
      nowMs += ms;
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
  const asks = createAskFlowService({
    attach,
    presence,
    now: () => clock.now(),
  });

  return { asks, routing, attach, presence, clock };
}

afterEach(async () => {
  try {
    const { resetAskFlowServiceForTests } = await import('./service');
    resetAskFlowServiceForTests();
  } catch {
    // ignore
  }
  try {
    const { resetChiefRoutingServiceForTests } = await import('../chief-routing/service');
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
    const closePath = tempDbPath('entity-ask-flow-close');
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

describe('ask-flow service (THE-886 / WP2-B-05)', () => {
  it('creates ASK in chief_review when live chief is assigned', async () => {
    const { asks, routing, attach, presence } = await createServices();
    attach.attach({ workplaneId: 'wp-a', agentId: 'chief-1', agentName: 'Chief', role: 'chief' });
    routing.assignChief({ workplaneId: 'wp-a', agentId: 'chief-1', priorityWindowMs: 60_000 });
    presence.recordHeartbeat({
      agentId: 'chief-1',
      status: 'live',
      currentWorkplaneId: 'wp-a',
    });

    const created = asks.createAsk({
      workplaneId: 'wp-a',
      title: 'Review patch',
      taskId: 42,
      createdBy: 'operator',
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.ask.status).toBe('chief_review');
      expect(created.value.ask.version).toBe(1);
    }
  });

  it('enforces chief priority on claim and allows worker fallback when chief stale', async () => {
    const { asks, routing, attach, presence, clock } = await createServices();
    attach.attach({ workplaneId: 'wp-a', agentId: 'chief-1', agentName: 'Chief', role: 'chief' });
    attach.attach({ workplaneId: 'wp-a', agentId: 'worker-1', agentName: 'Worker', role: 'worker' });
    routing.assignChief({ workplaneId: 'wp-a', agentId: 'chief-1', priorityWindowMs: 60_000 });
    presence.recordHeartbeat({
      agentId: 'chief-1',
      status: 'live',
      currentWorkplaneId: 'wp-a',
    });

    const created = asks.createAsk({
      workplaneId: 'wp-a',
      title: 'Ship checklist',
      taskId: 7,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const askId = created.value.ask.id;

    const blocked = asks.claimAsk({
      workplaneId: 'wp-a',
      askId,
      agentId: 'worker-1',
      expectedVersion: 1,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('chief_priority');

    const chiefClaim = asks.claimAsk({
      workplaneId: 'wp-a',
      askId,
      agentId: 'chief-1',
      expectedVersion: 1,
    });
    expect(chiefClaim.ok).toBe(true);
    if (chiefClaim.ok) {
      expect(chiefClaim.value.ask.status).toBe('claimed');
      expect(chiefClaim.value.ask.version).toBe(2);
      expect(chiefClaim.value.policy.code).toBe('chief_claim');
    }

    // New ASK after chief becomes stale → worker fallback.
    clock.advance(120_000);
    const openAsk = asks.createAsk({
      workplaneId: 'wp-a',
      title: 'Fallback ASK',
      taskId: 8,
    });
    expect(openAsk.ok).toBe(true);
    if (!openAsk.ok) return;
    expect(openAsk.value.ask.status).toBe('open');

    const fallback = asks.claimAsk({
      workplaneId: 'wp-a',
      askId: openAsk.value.ask.id,
      agentId: 'worker-1',
      expectedVersion: 1,
    });
    expect(fallback.ok).toBe(true);
    if (fallback.ok) {
      expect(fallback.value.policy.code).toBe('worker_claim_chief_unavailable');
    }
  });

  it('rejects stale CAS claim and double resolve', async () => {
    const { asks, attach } = await createServices();
    attach.attach({ workplaneId: 'wp-a', agentId: 'worker-1', agentName: 'Worker' });
    attach.attach({ workplaneId: 'wp-a', agentId: 'worker-2', agentName: 'Other' });

    const created = asks.createAsk({
      workplaneId: 'wp-a',
      title: 'CAS ASK',
      createdBy: 'operator',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const askId = created.value.ask.id;

    const claimed = asks.claimAsk({
      workplaneId: 'wp-a',
      askId,
      agentId: 'worker-1',
      expectedVersion: 1,
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.value.ask.version).toBe(2);

    const staleClaim = asks.claimAsk({
      workplaneId: 'wp-a',
      askId,
      agentId: 'worker-2',
      expectedVersion: 1,
    });
    expect(staleClaim.ok).toBe(false);
    if (!staleClaim.ok) expect(staleClaim.code).toBe('stale_version');

    const resolved = asks.resolveAsk({
      workplaneId: 'wp-a',
      askId,
      resolvedBy: 'worker-1',
      expectedVersion: 2,
      note: 'done',
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.ask.status).toBe('resolved');
    expect(resolved.value.ask.version).toBe(3);

    const double = asks.resolveAsk({
      workplaneId: 'wp-a',
      askId,
      resolvedBy: 'worker-1',
      expectedVersion: 3,
      note: 'again',
    });
    expect(double.ok).toBe(false);
    if (!double.ok) expect(double.code).toBe('double_resolve');

    const events = asks.listEvents('wp-a', askId);
    expect(events.ok).toBe(true);
    if (events.ok) {
      const types = events.value.events.map((e) => e.eventType);
      expect(types).toContain('created');
      expect(types).toContain('claimed');
      expect(types).toContain('resolved');
      expect(types).toContain('cas_rejected');
    }
  });

  it('panel summarizes truthful ASK counts without inventing secret fields', async () => {
    const { asks, attach } = await createServices();
    attach.attach({ workplaneId: 'wp-a', agentId: 'worker-1', agentName: 'Worker' });
    const a = asks.createAsk({ workplaneId: 'wp-a', title: 'A' });
    const b = asks.createAsk({ workplaneId: 'wp-a', title: 'B' });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    asks.claimAsk({
      workplaneId: 'wp-a',
      askId: a.value.ask.id,
      agentId: 'worker-1',
      expectedVersion: 1,
    });
    asks.resolveAsk({
      workplaneId: 'wp-a',
      askId: a.value.ask.id,
      resolvedBy: 'worker-1',
      expectedVersion: 2,
    });

    const panel = asks.getPanel('wp-a');
    expect(panel.ok).toBe(true);
    if (panel.ok) {
      expect(panel.value.openCount).toBe(1);
      expect(panel.value.resolvedCount).toBe(1);
      expect(panel.value.summary).toMatch(/open/);
      expect(JSON.stringify(panel.value)).not.toMatch(/api[_-]?key|secret|token/i);
    }
  });
});
