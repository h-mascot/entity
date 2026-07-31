/**
 * CH-A-02 / THE-918 — Channel adapter interface contract tests.
 * Covers success intake/notify and explicit degraded/negative paths.
 */
import { describe, expect, it } from 'vitest';
import type { NotificationRecord } from '../../../db/src';
import {
  asNotificationDeliveryAdapter,
  buildIntakeActivityProposal,
  buildIntakeTaskProposal,
  createNullChannelAdapter,
  isChannelAdapter,
  isChannelAdapterKind,
  normalizeChannelIntakeRaw,
} from './adapter';
import { createChannelAdapterRegistry } from './registry';
import {
  looksLikeChannelSecret,
  sanitizeChannelMetadata,
  sanitizeChannelPublicText,
} from './sanitize';
import {
  CHANNEL_ADAPTER_KINDS,
  channelKindToNotificationChannel,
} from './types';

describe('CH-A-02 channel adapter kinds', () => {
  it('exposes stable adapter kinds including telegram (contract-only)', () => {
    expect(CHANNEL_ADAPTER_KINDS).toContain('slack');
    expect(CHANNEL_ADAPTER_KINDS).toContain('telegram');
    expect(CHANNEL_ADAPTER_KINDS).toContain('clickclack');
    expect(isChannelAdapterKind('slack')).toBe(true);
    expect(isChannelAdapterKind('not-a-channel')).toBe(false);
  });

  it('maps telegram onto notification channel other until enum extends', () => {
    expect(channelKindToNotificationChannel('slack')).toBe('slack');
    expect(channelKindToNotificationChannel('telegram')).toBe('other');
    expect(channelKindToNotificationChannel('clickclack')).toBe('clickclack');
  });
});

describe('CH-A-02 intake → task/ActivityEvent proposals', () => {
  it('parses create_task intake into task + activity proposals (success)', () => {
    const adapter = createNullChannelAdapter({
      id: 'test-slack',
      kind: 'slack',
      enabled: true,
      availability: 'available',
    });

    const result = normalizeChannelIntakeRaw(
      {
        externalId: 'msg-100',
        title: 'Renewal packet follow-up',
        body: 'Customer asked for status on renewal',
        orgId: 'org-1',
      },
      { adapterId: adapter.id, kind: adapter.kind },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.mode).toBe('create_task');
    expect(result.taskProposal).toMatchObject({
      name: 'Renewal packet follow-up',
      origin_channel: 'slack:test-slack',
      status: 'backlog',
      metadata: {
        channel: {
          kind: 'slack',
          adapterId: 'test-slack',
          externalId: 'msg-100',
        },
      },
    });
    expect(result.activityProposal?.taskId).toBeNull();
    expect(result.activityProposal?.event.eventType).toBe('task_created');
    expect(result.activityProposal?.event.action).toBe('channel_intake');
    expect(result.degraded).toBe(false);
  });

  it('parses append_activity intake when taskId present (success)', () => {
    const result = normalizeChannelIntakeRaw(
      {
        external_id: 'evt-9',
        taskId: 42,
        text: 'Please move this to review',
        title: 'Status ping',
      },
      { adapterId: 'test-tg', kind: 'telegram' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.mode).toBe('append_activity');
    expect(result.taskProposal).toBeNull();
    expect(result.activityProposal).toMatchObject({
      taskId: 42,
      event: {
        eventType: 'task_updated',
        action: 'channel_intake',
      },
    });
  });

  it('fails closed on missing externalId (negative)', () => {
    const result = normalizeChannelIntakeRaw(
      { title: 'No id', body: 'x' },
      { adapterId: 'test', kind: 'webhook' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('missing_external_id');
    expect(result.degraded).toBe(true);
  });

  it('marks empty body as degraded without inventing healthy content', () => {
    const result = normalizeChannelIntakeRaw(
      { externalId: 'e-1', title: 'Empty' },
      { adapterId: 'test', kind: 'email' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degraded).toBe(true);
    expect(result.warnings.some((w) => w.code === 'empty_intake_body')).toBe(true);
  });

  it('build helpers refuse task proposal for append_activity mode', () => {
    const message = {
      kind: 'slack' as const,
      adapterId: 'a',
      external: { externalId: 'x' },
      title: 't',
      body: 'b',
      taskId: 7,
      mode: 'append_activity' as const,
    };
    expect(buildIntakeTaskProposal(message)).toBeNull();
    expect(buildIntakeActivityProposal(message)?.taskId).toBe(7);
  });
});

describe('CH-A-02 notify ← status', () => {
  it('sends status notify when adapter is available (success)', async () => {
    const adapter = createNullChannelAdapter({
      id: 'notify-ok',
      kind: 'slack',
      enabled: true,
      availability: 'available',
    });
    expect(isChannelAdapter(adapter)).toBe(true);

    const result = await adapter.notifyStatus({
      kind: 'slack',
      adapterId: adapter.id,
      taskId: 11,
      status: 'review',
      previousStatus: 'doing',
      title: 'Task moved to review',
      body: 'Ready for human review',
    });

    expect(result.status).toBe('sent');
    expect(result.externalRef).toBe('null:11:review');
  });

  it('skips notify when not_configured (degraded/negative)', async () => {
    const adapter = createNullChannelAdapter({
      id: 'notify-missing',
      kind: 'telegram',
      availability: 'not_configured',
    });
    const result = await adapter.notifyStatus({
      kind: 'telegram',
      adapterId: adapter.id,
      taskId: 3,
      status: 'done',
      title: 'Done',
    });
    expect(result.status).toBe('skipped');
    expect(result.degradedReason).toContain('not_configured');
  });

  it('returns degraded notify without coercing to sent-healthy', async () => {
    const adapter = createNullChannelAdapter({
      id: 'notify-degraded',
      kind: 'discord',
      availability: 'degraded',
      enabled: true,
    });
    const result = await adapter.notifyStatus({
      kind: 'discord',
      adapterId: adapter.id,
      taskId: 5,
      status: 'blocked',
      title: 'Blocked',
    });
    expect(result.status).toBe('degraded');
    expect(result.degradedReason).toBeTruthy();
  });
});

describe('CH-A-02 NotificationDeliveryAdapter bridge', () => {
  it('wraps channel notify for inbox-first routing delivery', async () => {
    const adapter = createNullChannelAdapter({
      id: 'bridge-slack',
      kind: 'slack',
      enabled: true,
      availability: 'available',
    });
    const delivery = asNotificationDeliveryAdapter(adapter);
    expect(delivery.channel).toBe('slack');

    const notification = {
      id: 'n-1',
      org_id: 'org-1',
      recipient_principal_id: 'user-1',
      canonical_event_id: '42',
      object_ref: { object_type: 'task', object_id: '99', link_role: 'subject' },
      notification_type: 'task_nudge',
      inbox_state: 'unread',
      title: 'Nudge',
      body: 'Please update',
      policy_reason_chain_json: '[]',
      metadata_json: '{}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deliveries: [],
    } satisfies NotificationRecord;

    const result = await delivery.deliver({
      notification,
      channel: 'slack',
      title: 'Nudge',
      body: 'Please update',
      objectRef: notification.object_ref,
      metadata: { status: 'doing' },
    });

    expect(result.status).toBe('sent');
    expect(result.externalRef).toBe('null:99:doing');
    expect(result.metadata).toMatchObject({ adapterId: 'bridge-slack' });
  });
});

describe('CH-A-02 registry + secrets posture', () => {
  it('registers adapters and snapshots availability without secrets', async () => {
    const registry = createChannelAdapterRegistry();
    registry.register(
      createNullChannelAdapter({
        id: 'reg-1',
        kind: 'webhook',
        availability: 'unavailable',
      }),
    );
    const snap = await registry.snapshot();
    expect(snap.version).toBe('entity.channel-adapter.v1');
    expect(snap.count).toBe(1);
    expect(snap.adapters[0]).toMatchObject({
      id: 'reg-1',
      kind: 'webhook',
      availability: 'unavailable',
      enabled: false,
    });
    expect(JSON.stringify(snap)).not.toMatch(/api[_-]?key|xoxb-|sk-/i);
  });

  it('redacts secret-like metadata and text', () => {
    expect(sanitizeChannelPublicText('authorization=super-secret-value')).toBe(
      'authorization=[redacted]',
    );
    expect(looksLikeChannelSecret('xoxb-123456789012345678901234')).toBe(true);
    expect(
      sanitizeChannelMetadata({
        apiKey: 'should-not-leak',
        note: 'ok',
        nested: { token: 'abc' },
      }),
    ).toEqual({
      apiKey: '[redacted]',
      note: 'ok',
      nested: { token: '[redacted]' },
    });
  });

  it('rejects invalid adapter registration', () => {
    const registry = createChannelAdapterRegistry();
    expect(() => registry.register({} as never)).toThrow(/channel_adapter_invalid/);
  });
});
