import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditEventLabel,
  minutesToMs,
  msToMinutes,
  normalizeAdminAgentSettings,
  normalizeInviteAuditEvents,
  responseContainsSecretKeys,
  validateAdminAgentSettingsDraft,
} from './adminAgentSettings.ts';

describe('adminAgentSettings (WP2-B-06)', () => {
  it('normalizes settings and rejects secret-bearing payloads', () => {
    const settings = normalizeAdminAgentSettings({
      defaultTtlMs: 1_800_000,
      minTtlMs: 60_000,
      maxTtlMs: 3_600_000,
      allowedModules: ['entity-mc'],
      defaultModules: ['entity-mc'],
      updatedAt: null,
      updatedBy: null,
      hardMinTtlMs: 60_000,
      hardMaxTtlMs: 604_800_000,
      catalogModules: [{ id: 'entity-mc', label: 'Entity MC', defaultAllowed: true }],
    });
    assert.ok(settings);
    assert.equal(settings!.allowedModules[0], 'entity-mc');
    assert.equal(msToMinutes(settings!.defaultTtlMs), 30);
    assert.equal(minutesToMs(45), 45 * 60_000);
    assert.equal(responseContainsSecretKeys(settings), false);
    assert.equal(responseContainsSecretKeys({ token: 'secret' }), true);
  });

  it('validates draft TTL/module constraints and labels audit events', () => {
    const base = normalizeAdminAgentSettings({
      defaultTtlMs: 1_800_000,
      minTtlMs: 60_000,
      maxTtlMs: 3_600_000,
      allowedModules: ['entity-mc'],
      defaultModules: ['entity-mc'],
      hardMinTtlMs: 60_000,
      hardMaxTtlMs: 604_800_000,
      catalogModules: [{ id: 'entity-mc', label: 'Entity MC', defaultAllowed: true }],
    })!;
    assert.equal(validateAdminAgentSettingsDraft(base), null);
    assert.match(
      validateAdminAgentSettingsDraft({ ...base, defaultTtlMs: 10_000 }) ?? '',
      /Default TTL/,
    );
    assert.match(
      validateAdminAgentSettingsDraft({
        ...base,
        allowedModules: ['entity-mc'],
        defaultModules: ['entity-fs'],
      }) ?? '',
      /Default modules/,
    );
    assert.equal(auditEventLabel('invite_revoked'), 'Revoked');
    const events = normalizeInviteAuditEvents({
      events: [{
        id: 'a1',
        inviteId: 'inv-1',
        eventType: 'invite_revoked',
        actorId: 'henry',
        agentName: 'Scout',
        status: 'revoked',
        generation: 2,
        detail: 'revokedBy=henry',
        createdAt: '2026-07-31T00:00:00.000Z',
      }],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, 'invite_revoked');
  });
});
