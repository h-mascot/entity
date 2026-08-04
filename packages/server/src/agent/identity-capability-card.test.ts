import { describe, expect, it } from 'vitest';
import {
  AGENT_IDENTITY_CAPABILITY_CARD_FIELDS,
  AGENT_PRESENCE_STATUSES,
  buildAgentIdentityCapabilityCard,
  normalizePresenceStatus,
} from './identity-capability-card';

describe('identity-capability-card schema', () => {
  it('exposes stable field keys and presence statuses', () => {
    expect(AGENT_IDENTITY_CAPABILITY_CARD_FIELDS).toContain('agentName');
    expect(AGENT_IDENTITY_CAPABILITY_CARD_FIELDS).toContain('presenceStatus');
    expect(AGENT_IDENTITY_CAPABILITY_CARD_FIELDS).toContain('currentTaskId');
    expect(AGENT_IDENTITY_CAPABILITY_CARD_FIELDS).toContain('heartbeatFreshnessLabel');
    expect(AGENT_PRESENCE_STATUSES).toEqual([
      'live',
      'idle',
      'stale',
      'offline',
      'unknown',
      'missing',
    ]);
  });

  it('normalizes blank/invalid presence to missing/unknown (not live)', () => {
    expect(normalizePresenceStatus(null)).toBe('missing');
    expect(normalizePresenceStatus('')).toBe('missing');
    expect(normalizePresenceStatus('LIVE')).toBe('live');
    expect(normalizePresenceStatus('bogus')).toBe('unknown');
    expect(normalizePresenceStatus(12)).toBe('unknown');
  });
});

describe('buildAgentIdentityCapabilityCard', () => {
  it('builds a partial card from durable invite fields without inventing healthy presence', () => {
    const card = buildAgentIdentityCapabilityCard({
      invite: {
        id: 'inv-1',
        agentName: 'Scout',
        role: 'worker',
        status: 'in_progress',
        selectedBundle: 'default',
        selectedModules: ['entity-mc', 'docs'],
        permissionsScope: ['workspace_read', 'task_comment'],
        workplaneId: 'wp-9',
        taskId: 42,
        providerProfileId: 'azure-default',
        chiefRoutingMode: 'worker',
        progress: [
          { status: 'done' },
          { status: 'running' },
        ],
      },
    });

    expect(card.agentName).toBe('Scout');
    expect(card.role).toBe('worker');
    expect(card.inviteId).toBe('inv-1');
    expect(card.inviteStatus).toBe('in_progress');
    expect(card.selectedModules).toEqual(['entity-mc', 'docs']);
    expect(card.permissionLabels).toEqual(['workspace_read', 'task_comment']);
    expect(card.capabilityLabels).toEqual(['entity-mc', 'docs']);
    expect(card.currentTaskId).toBe(42);
    expect(card.currentWorkplaneId).toBe('wp-9');
    expect(card.currentWorkLabel).toBe('Task 42 · Workplane wp-9');
    expect(card.presenceStatus).toBe('missing');
    expect(card.heartbeatFreshnessLabel).toBe('No heartbeat yet');
    expect(card.providerProfileId).toBe('azure-default');
    expect(card.chiefRoutingMode).toBe('worker');
    expect(card.verificationLabel).toBe('Verification 1/2 done');
    expect(card.cardCompleteness).toBe('partial');
    expect(card.degradedReasons).toEqual(
      expect.arrayContaining(['presence_missing', 'runtime_unbound']),
    );
    expect(card.degradedReasons).not.toContain('current_work_unattached');
  });

  it('marks empty input degraded and never coerces presence to live', () => {
    const card = buildAgentIdentityCapabilityCard({});
    expect(card.agentName).toBe('Unnamed agent');
    expect(card.presenceStatus).toBe('missing');
    expect(card.cardCompleteness).toBe('degraded');
    expect(card.degradedReasons).toEqual(
      expect.arrayContaining([
        'card_source_missing',
        'identity_unbound',
        'presence_missing',
        'current_work_unattached',
        'runtime_unbound',
        'model_unbound',
      ]),
    );
    expect(card.currentWorkLabel).toBe('No current work attached');
  });

  it('merges presence + registry labels and applies staleness', () => {
    const nowMs = Date.parse('2026-07-31T06:00:00.000Z');
    const card = buildAgentIdentityCapabilityCard({
      invite: {
        id: 'inv-2',
        agentId: 'agent-scout',
        agentName: 'Scout',
        role: 'reviewer',
        status: 'completed',
        selectedModules: ['entity-mc'],
        permissionsScope: ['workspace_read'],
      },
      presence: {
        agentId: 'agent-scout',
        runtime: 'mac',
        status: 'live',
        lastSeenAt: '2026-07-31T05:50:00.000Z',
        currentTaskId: 7,
        currentWorkplaneId: 'wp-live',
        capabilities: ['review'],
      },
      registryCapabilities: {
        moduleCount: 1,
        capabilityLabels: ['Mission Control'],
        permissionLabels: ['Assign'],
        scopeLabels: ['Tools: Review'],
        adapterType: 'codex',
        runtimeType: 'mac',
        runtimeLabel: 'Codex · Mac · Active',
        ownerLabel: 'Entity',
        verificationLabel: 'Registry + 1 grant',
        identityLabel: 'Engineering operator',
      },
      nowMs,
      staleAfterMs: 60_000,
    });

    expect(card.agentId).toBe('agent-scout');
    expect(card.presenceStatus).toBe('stale');
    expect(card.heartbeatFreshnessLabel).toContain('Stale');
    expect(card.degradedReasons).toContain('presence_stale');
    expect(card.capabilityLabels).toEqual(['Mission Control', 'review', 'entity-mc']);
    expect(card.permissionLabels).toEqual(['Assign', 'workspace_read']);
    expect(card.scopeLabels).toEqual(['Tools: Review']);
    expect(card.runtimeLabel).toBe('Codex · Mac · Active');
    expect(card.currentTaskId).toBe(7);
    expect(card.currentWorkplaneId).toBe('wp-live');
    expect(card.identityLabel).toBe('Engineering operator');
    expect(card.verificationLabel).toBe('Registry + 1 grant');
  });

  it('keeps live presence when last_seen is fresh', () => {
    const nowMs = Date.parse('2026-07-31T06:00:00.000Z');
    const card = buildAgentIdentityCapabilityCard({
      invite: { id: 'inv-3', agentName: 'Ada', role: 'chief', status: 'completed' },
      presence: {
        status: 'live',
        lastSeenAt: '2026-07-31T05:59:30.000Z',
        currentTaskId: 1,
      },
      runtime: {
        adapterType: 'openai-compatible',
        runtimeType: 'remote',
        modelLabel: 'gpt-test',
        providerProfileId: 'p1',
      },
      nowMs,
      staleAfterMs: 90_000,
    });

    expect(card.presenceStatus).toBe('live');
    expect(card.modelLabel).toBe('gpt-test');
    expect(card.cardCompleteness).toBe('complete');
    expect(card.degradedReasons).toEqual([]);
  });
});
