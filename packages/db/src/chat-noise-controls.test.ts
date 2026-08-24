import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dbPaths: string[] = [];

async function loadRepository() {
  const dbPath = path.join(os.tmpdir(), `entity-chat-noise-controls-${process.pid}-${randomUUID()}.sqlite`);
  dbPaths.push(dbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', `${dbPath}.missing`);
  const module = await import('./chat-noise-controls');
  return module.createChatNoiseControlRepository();
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

describe('chat noise control repository', () => {
  it('configures one stable organization, channel, and agent cooldown with bounded seconds', async () => {
    const repo = await loadRepository();
    const original = repo.configureCooldown({
      org_id: 'org-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      cooldown_seconds: 1,
      configured_by_user_id: 'operator-a',
    });
    const updated = repo.configureCooldown({
      org_id: 'org-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      cooldown_seconds: 86_400,
      configured_by_user_id: 'operator-b',
    });

    expect(updated.id).toBe(original.id);
    expect(updated).toMatchObject({
      org_id: 'org-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      cooldown_seconds: 86_400,
      configured_by_user_id: 'operator-b',
    });
    expect(repo.getCooldown('org-a', 'channel-a', 'agent-a')).toEqual(updated);
    expect(repo.getCooldown('org-b', 'channel-a', 'agent-a')).toBeUndefined();
    expect(repo.clearCooldown({
      org_id: 'org-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      cleared_by_user_id: 'operator-b',
    })).toBe(true);
    expect(repo.getCooldown('org-a', 'channel-a', 'agent-a')).toBeUndefined();

    for (const cooldown_seconds of [0, 86_401, 1.5]) {
      expect(() => repo.configureCooldown({
        org_id: 'org-a',
        channel_id: 'channel-a',
        agent_id: 'agent-a',
        cooldown_seconds,
        configured_by_user_id: 'operator-a',
      })).toThrow(/cooldown/i);
    }
  });

  it('sets, reads, and clears active organization-scoped channel and category mutes', async () => {
    const repo = await loadRepository();
    const channelMute = repo.setChannelMute({
      org_id: 'org-a',
      channel_id: 'channel-a',
      muted_by_user_id: 'operator-a',
      reason: 'Maintenance window',
    });
    const categoryMute = repo.setCategoryMute({
      org_id: 'org-a',
      category_id: 'category-a',
      muted_by_user_id: 'operator-a',
      reason: 'Low-priority traffic paused',
    });
    const updatedChannelMute = repo.setChannelMute({
      org_id: 'org-a',
      channel_id: 'channel-a',
      muted_by_user_id: 'operator-b',
      reason: 'Maintenance extended',
    });

    expect(updatedChannelMute.id).toBe(channelMute.id);
    expect(repo.getActiveChannelMute('org-a', 'channel-a')).toEqual(updatedChannelMute);
    expect(repo.getActiveCategoryMute('org-a', 'category-a')).toEqual(categoryMute);
    expect(repo.getActiveChannelMute('org-b', 'channel-a')).toBeUndefined();
    expect(repo.getActiveCategoryMute('org-b', 'category-a')).toBeUndefined();

    const cleared = repo.clearMute({
      org_id: 'org-a',
      mute_id: channelMute.id,
      cleared_by_user_id: 'operator-b',
      reason: 'Maintenance complete',
    });
    expect(cleared).toMatchObject({
      id: updatedChannelMute.id,
      cleared_by_user_id: 'operator-b',
      clear_reason: 'Maintenance complete',
      cleared_at: expect.any(String),
    });
    expect(repo.getActiveChannelMute('org-a', 'channel-a')).toBeUndefined();
    expect(repo.getActiveCategoryMute('org-a', 'category-a')).toEqual(categoryMute);
  });

  it('atomically suppresses category mutes, channel mutes, and duplicate pending reservations with audit events', async () => {
    const repo = await loadRepository();
    repo.setCategoryMute({
      org_id: 'org-a',
      category_id: 'category-a',
      muted_by_user_id: 'operator-a',
      reason: 'Category paused',
    });

    const categorySuppressed = repo.reservePost({
      org_id: 'org-a',
      category_id: 'category-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      attempted_at: '2026-07-28T12:00:00.000Z',
    });
    expect(categorySuppressed).toMatchObject({
      allowed: false,
      reason: 'category_muted',
      reservation: null,
    });

    repo.setChannelMute({
      org_id: 'org-a',
      channel_id: 'channel-b',
      muted_by_user_id: 'operator-a',
      reason: 'Channel paused',
    });
    const channelSuppressed = repo.reservePost({
      org_id: 'org-a',
      category_id: 'category-b',
      channel_id: 'channel-b',
      agent_id: 'agent-a',
      attempted_at: '2026-07-28T12:00:01.000Z',
    });
    expect(channelSuppressed).toMatchObject({
      allowed: false,
      reason: 'channel_muted',
      reservation: null,
    });

    const allowed = repo.reservePost({
      org_id: 'org-a',
      category_id: 'category-b',
      channel_id: 'channel-c',
      agent_id: 'agent-a',
      attempted_at: '2026-07-28T12:00:02.000Z',
    });
    expect(allowed).toMatchObject({
      allowed: true,
      reason: null,
      reservation: {
        org_id: 'org-a',
        channel_id: 'channel-c',
        agent_id: 'agent-a',
        state: 'reserved',
      },
    });

    const duplicate = repo.reservePost({
      org_id: 'org-a',
      category_id: 'category-b',
      channel_id: 'channel-c',
      agent_id: 'agent-a',
      attempted_at: '2026-07-28T12:00:03.000Z',
    });
    expect(duplicate).toMatchObject({
      allowed: false,
      reason: 'reservation_pending',
      reservation: null,
    });

    expect(repo.listAuditEvents({ org_id: 'org-a' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'post_suppressed', reason: 'category_muted' }),
      expect.objectContaining({ action: 'post_suppressed', reason: 'channel_muted' }),
      expect.objectContaining({ action: 'post_reserved', reservation_id: allowed.reservation!.id }),
      expect.objectContaining({ action: 'post_suppressed', reason: 'reservation_pending' }),
    ]));
  });

  it('starts cooldown only after an allowed reservation completes', async () => {
    const repo = await loadRepository();
    repo.configureCooldown({
      org_id: 'org-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      cooldown_seconds: 60,
      configured_by_user_id: 'operator-a',
    });
    const allowed = repo.reservePost({
      org_id: 'org-a',
      category_id: 'category-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      attempted_at: '2026-07-28T12:00:00.000Z',
    });
    expect(allowed.allowed).toBe(true);

    const completed = repo.completePost({
      org_id: 'org-a',
      reservation_id: allowed.reservation!.id,
      completed_at: '2026-07-28T12:00:10.000Z',
    });
    expect(completed).toMatchObject({
      state: 'completed',
      completed_at: '2026-07-28T12:00:10.000Z',
    });

    const suppressed = repo.reservePost({
      org_id: 'org-a',
      category_id: 'category-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      attempted_at: '2026-07-28T12:01:09.000Z',
    });
    expect(suppressed).toMatchObject({
      allowed: false,
      reason: 'cooldown',
      retry_after_seconds: 1,
      reservation: null,
    });

    const afterCooldown = repo.reservePost({
      org_id: 'org-a',
      category_id: 'category-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      attempted_at: '2026-07-28T12:01:10.000Z',
    });
    expect(afterCooldown.allowed).toBe(true);
    expect(repo.listAuditEvents({ org_id: 'org-a' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'post_completed', reservation_id: allowed.reservation!.id }),
      expect.objectContaining({ action: 'post_suppressed', reason: 'cooldown' }),
    ]));
  });

  it('requires an identified operator and reason for overrides and records the bypass', async () => {
    const repo = await loadRepository();
    repo.configureCooldown({
      org_id: 'org-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      cooldown_seconds: 300,
      configured_by_user_id: 'operator-a',
    });
    repo.setChannelMute({
      org_id: 'org-a',
      channel_id: 'channel-a',
      muted_by_user_id: 'operator-a',
      reason: 'Channel paused',
    });

    for (const operator_override of [
      { actor_user_id: '', reason: 'Urgent response' },
      { actor_user_id: 'operator-b', reason: '   ' },
    ]) {
      expect(() => repo.reservePost({
        org_id: 'org-a',
        category_id: 'category-a',
        channel_id: 'channel-a',
        agent_id: 'agent-a',
        attempted_at: '2026-07-28T12:00:00.000Z',
        operator_override,
      })).toThrow(/override/i);
    }

    const overridden = repo.reservePost({
      org_id: 'org-a',
      category_id: 'category-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      attempted_at: '2026-07-28T12:00:00.000Z',
      operator_override: {
        actor_user_id: 'operator-b',
        reason: 'Urgent customer response',
      },
    });
    expect(overridden).toMatchObject({
      allowed: true,
      reason: null,
      reservation: {
        state: 'reserved',
        override_actor_user_id: 'operator-b',
        override_reason: 'Urgent customer response',
      },
    });
    expect(repo.listAuditEvents({ org_id: 'org-a' })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'operator_override',
        reservation_id: overridden.reservation!.id,
        actor_user_id: 'operator-b',
        reason: 'Urgent customer response',
      }),
    ]));

    repo.completePost({
      org_id: 'org-a',
      reservation_id: overridden.reservation!.id,
      completed_at: '2026-07-28T12:00:01.000Z',
    });
    const cooldownOverridden = repo.reservePost({
      org_id: 'org-a',
      category_id: 'category-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      attempted_at: '2026-07-28T12:00:02.000Z',
      operator_override: {
        actor_user_id: 'operator-c',
        reason: 'Follow-up required before cooldown expires',
      },
    });
    expect(cooldownOverridden.allowed).toBe(true);
    expect(repo.listAuditEvents({ org_id: 'org-a' })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'operator_override',
        reservation_id: cooldownOverridden.reservation!.id,
        actor_user_id: 'operator-c',
        reason: 'Follow-up required before cooldown expires',
      }),
    ]));
  });

  it('does not consume cooldown for released or failed reservations', async () => {
    const repo = await loadRepository();
    repo.configureCooldown({
      org_id: 'org-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      cooldown_seconds: 300,
      configured_by_user_id: 'operator-a',
    });

    const releasedReservation = repo.reservePost({
      org_id: 'org-a',
      category_id: 'category-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      attempted_at: '2026-07-28T12:00:00.000Z',
    });
    const released = repo.releasePost({
      org_id: 'org-a',
      reservation_id: releasedReservation.reservation!.id,
      state: 'released',
      released_at: '2026-07-28T12:00:01.000Z',
      reason: 'Agent cancelled before posting',
    });
    expect(released.state).toBe('released');

    const afterRelease = repo.reservePost({
      org_id: 'org-a',
      category_id: 'category-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      attempted_at: '2026-07-28T12:00:02.000Z',
    });
    expect(afterRelease.allowed).toBe(true);
    repo.releasePost({
      org_id: 'org-a',
      reservation_id: afterRelease.reservation!.id,
      state: 'failed',
      released_at: '2026-07-28T12:00:03.000Z',
      reason: 'Provider rejected post',
    });

    const afterFailure = repo.reservePost({
      org_id: 'org-a',
      category_id: 'category-a',
      channel_id: 'channel-a',
      agent_id: 'agent-a',
      attempted_at: '2026-07-28T12:00:04.000Z',
    });
    expect(afterFailure.allowed).toBe(true);
    expect(repo.listAuditEvents({ org_id: 'org-a' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'post_released', reservation_id: releasedReservation.reservation!.id }),
      expect.objectContaining({ action: 'post_failed', reservation_id: afterRelease.reservation!.id }),
    ]));
  });

  it('isolates reservations, cooldown state, mutes, and audit reads by organization', async () => {
    const repo = await loadRepository();
    repo.setChannelMute({
      org_id: 'org-a',
      channel_id: 'shared-channel',
      muted_by_user_id: 'operator-a',
      reason: 'Only org A is muted',
    });
    const orgA = repo.reservePost({
      org_id: 'org-a',
      category_id: 'shared-category',
      channel_id: 'shared-channel',
      agent_id: 'shared-agent',
      attempted_at: '2026-07-28T12:00:00.000Z',
    });
    const orgB = repo.reservePost({
      org_id: 'org-b',
      category_id: 'shared-category',
      channel_id: 'shared-channel',
      agent_id: 'shared-agent',
      attempted_at: '2026-07-28T12:00:00.000Z',
    });

    expect(orgA).toMatchObject({ allowed: false, reason: 'channel_muted' });
    expect(orgB.allowed).toBe(true);
    expect(() => repo.completePost({
      org_id: 'org-a',
      reservation_id: orgB.reservation!.id,
      completed_at: '2026-07-28T12:00:01.000Z',
    })).toThrow(/reservation/i);
    expect(repo.listAuditEvents({ org_id: 'org-a' })).toHaveLength(2);
    expect(repo.listAuditEvents({ org_id: 'org-b' })).toHaveLength(1);
  });
});
