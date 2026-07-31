/**
 * CH-A-03 / THE-919 — Slack reference adapter tests.
 * Covers feature-flag gating, success intake/notify via offline transport,
 * and explicit degraded offline path. No real Slack network I/O.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { asNotificationDeliveryAdapter, isChannelAdapter } from './adapter';
import { createChannelAdapterRegistry } from './registry';
import {
  createSlackReferenceAdapter,
  isSlackReferenceAdapterEnabled,
  registerSlackReferenceAdapterIfEnabled,
  SLACK_REFERENCE_ADAPTER_ID,
  SLACK_REFERENCE_FEATURE_FLAG,
} from './slack-reference-adapter';
import { createOfflineSlackTransport } from './slack-transport';

const FLAG = SLACK_REFERENCE_FEATURE_FLAG;
const originalFlag = process.env[FLAG];

afterEach(() => {
  if (originalFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = originalFlag;
});

describe('CH-A-03 Slack reference feature flag', () => {
  it('is off by default and respects truthy env values', () => {
    delete process.env[FLAG];
    expect(isSlackReferenceAdapterEnabled({})).toBe(false);
    expect(isSlackReferenceAdapterEnabled({ [FLAG]: '0' })).toBe(false);
    expect(isSlackReferenceAdapterEnabled({ [FLAG]: '1' })).toBe(true);
    expect(isSlackReferenceAdapterEnabled({ [FLAG]: 'true' })).toBe(true);
  });

  it('does not register when feature flag is off', () => {
    const registry = createChannelAdapterRegistry();
    const registered = registerSlackReferenceAdapterIfEnabled(registry, {
      env: { [FLAG]: '0' },
    });
    expect(registered).toBeNull();
    expect(registry.list()).toHaveLength(0);
  });

  it('registers offline reference adapter only when flag is on', async () => {
    const registry = createChannelAdapterRegistry();
    const registered = registerSlackReferenceAdapterIfEnabled(registry, {
      env: { [FLAG]: '1' },
      transport: createOfflineSlackTransport(),
    });
    expect(registered?.id).toBe(SLACK_REFERENCE_ADAPTER_ID);
    expect(registry.get(SLACK_REFERENCE_ADAPTER_ID)?.kind).toBe('slack');
    const snap = await registry.snapshot();
    expect(snap.adapters[0]).toMatchObject({
      id: SLACK_REFERENCE_ADAPTER_ID,
      kind: 'slack',
      enabled: true,
      availability: 'degraded',
    });
    expect(JSON.stringify(snap)).not.toMatch(/xoxb-|api[_-]?key|sk-/i);
  });
});

describe('CH-A-03 Slack reference intake', () => {
  it('parses Slack-native message into create_task proposal (success)', async () => {
    const adapter = createSlackReferenceAdapter({
      featureEnabled: true,
      transport: createOfflineSlackTransport(),
    });
    expect(isChannelAdapter(adapter)).toBe(true);

    const result = await adapter.parseIntake({
      type: 'event_callback',
      event: {
        type: 'message',
        ts: '1722441600.000100',
        channel: 'C123ABC',
        user: 'U9',
        text: 'Please open a renewal follow-up',
        thread_ts: '1722441500.000050',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.kind).toBe('slack');
    expect(result.message.external.externalId).toBe('1722441600.000100');
    expect(result.message.external.roomId).toBe('C123ABC');
    expect(result.message.external.threadId).toBe('1722441500.000050');
    expect(result.taskProposal).toMatchObject({
      origin_channel: `slack:${SLACK_REFERENCE_ADAPTER_ID}`,
      status: 'backlog',
      metadata: {
        channel: {
          kind: 'slack',
          externalId: '1722441600.000100',
          roomId: 'C123ABC',
        },
      },
    });
    expect(result.activityProposal?.event.action).toBe('channel_intake');
  });

  it('fails closed when feature flag disables the adapter (negative)', async () => {
    const adapter = createSlackReferenceAdapter({
      featureEnabled: false,
      transport: createOfflineSlackTransport(),
    });
    expect(adapter.enabled).toBe(false);
    expect(adapter.getAvailability()).toBe('not_configured');

    const result = await adapter.parseIntake({
      event: { type: 'message', ts: '1.2', text: 'hi', channel: 'C1' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('adapter_disabled');
    expect(result.degraded).toBe(true);
  });

  it('redacts secret-like intake text', async () => {
    const adapter = createSlackReferenceAdapter({
      featureEnabled: true,
      transport: createOfflineSlackTransport(),
    });
    const result = await adapter.parseIntake({
      event: {
        type: 'message',
        ts: '9.9',
        channel: 'C1',
        text: 'rotate api_key=super-secret-value-now',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.body).toContain('api_key=[redacted]');
    expect(result.message.body).not.toContain('super-secret-value-now');
  });
});

describe('CH-A-03 Slack reference notify + degraded offline path', () => {
  it('delivers via offline transport without inventing live Slack health (success/offline)', async () => {
    const adapter = createSlackReferenceAdapter({
      featureEnabled: true,
      transport: createOfflineSlackTransport({ sequenceStart: 7 }),
      defaultChannel: 'C-notify',
    });

    const result = await adapter.notifyStatus({
      kind: 'slack',
      adapterId: adapter.id,
      taskId: 42,
      status: 'review',
      previousStatus: 'doing',
      title: 'Task moved to review',
      body: 'Ready for human review',
    });

    expect(result.status).toBe('degraded');
    expect(result.degradedReason).toBe('slack_reference_offline_transport');
    expect(result.externalRef).toMatch(/^slack:C-notify:offline\.7\./);
    expect(result.metadata).toMatchObject({
      adapterId: SLACK_REFERENCE_ADAPTER_ID,
      transportMode: 'offline',
      featureEnabled: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/xoxb-|Bearer\s/i);
  });

  it('returns degraded offline path when transport is unreachable (degraded)', async () => {
    const adapter = createSlackReferenceAdapter({
      featureEnabled: true,
      transport: createOfflineSlackTransport({ failMode: 'offline' }),
    });

    expect(adapter.getAvailability()).toBe('unavailable');

    const result = await adapter.notifyStatus({
      kind: 'slack',
      adapterId: adapter.id,
      taskId: 8,
      status: 'blocked',
      title: 'Blocked',
    });

    // Unavailable transport → skipped with explicit reason (never silent healthy).
    expect(result.status).toBe('skipped');
    expect(result.degradedReason).toContain('unavailable');
    expect(result.failureReason).toBe('slack_transport_unavailable');
  });

  it('surfaces transport offline as degraded when health is degraded mid-flight', async () => {
    let health: 'available' | 'degraded' | 'unavailable' | 'offline' = 'degraded';
    const flakyTransport = {
      mode: 'offline' as const,
      getHealth: () => health,
      postMessage: async () => ({
        ok: false,
        offline: true,
        degraded: true,
        error: 'slack_transport_offline',
        channel: 'C-flaky',
        mode: 'offline' as const,
      }),
    };

    const adapter = createSlackReferenceAdapter({
      featureEnabled: true,
      transport: flakyTransport,
    });
    expect(adapter.getAvailability()).toBe('degraded');

    const result = await adapter.notifyStatus({
      kind: 'slack',
      adapterId: adapter.id,
      taskId: 3,
      status: 'doing',
      title: 'Ping',
    });
    expect(result.status).toBe('degraded');
    expect(result.degradedReason).toBe('slack_transport_offline');
    expect(result.metadata).toMatchObject({ offline: true });

    health = 'available';
  });

  it('skips notify when feature flag is off (negative)', async () => {
    const adapter = createSlackReferenceAdapter({
      featureEnabled: false,
      transport: createOfflineSlackTransport(),
    });
    const result = await adapter.notifyStatus({
      kind: 'slack',
      adapterId: adapter.id,
      taskId: 1,
      status: 'done',
      title: 'Done',
    });
    expect(result.status).toBe('skipped');
    expect(result.degradedReason).toContain('not_configured');
  });

  it('bridges to NotificationDeliveryAdapter without live Slack', async () => {
    const adapter = createSlackReferenceAdapter({
      featureEnabled: true,
      transport: createOfflineSlackTransport({ sequenceStart: 1 }),
    });
    const delivery = asNotificationDeliveryAdapter(adapter);
    expect(delivery.channel).toBe('slack');

    const result = await delivery.deliver({
      notification: {
        id: 'n-1',
        org_id: 'org-1',
        recipient_principal_id: 'user-1',
        canonical_event_id: '77',
        object_ref: { object_type: 'task', object_id: '55', link_role: 'subject' },
        notification_type: 'task_nudge',
        inbox_state: 'unread',
        title: 'Nudge',
        body: 'Please update',
        policy_reason_chain_json: '[]',
        metadata_json: '{}',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deliveries: [],
      },
      channel: 'slack',
      title: 'Nudge',
      body: 'Please update',
      objectRef: { object_type: 'task', object_id: '55', link_role: 'subject' },
      metadata: { status: 'doing' },
    });

    // Offline availability coerces bridge result to degraded — never healthy live send.
    expect(result.status).toBe('degraded');
    expect(result.externalRef).toMatch(/^slack:/);
    expect(result.metadata).toMatchObject({ adapterId: SLACK_REFERENCE_ADAPTER_ID });
  });
});
