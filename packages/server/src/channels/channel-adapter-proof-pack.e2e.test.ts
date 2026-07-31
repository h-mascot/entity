/**
 * CH-A-05 / THE-921 — Channel adapter proof pack (E2E + negative).
 *
 * Composes CH-A-03 (Slack reference adapter behind feature flag) and
 * CH-A-04 (task-truth boundary) into one end-to-end chain:
 *
 *   flag-on register → parseIntake → truth-store guard →
 *   host applyChannelIntakeProposals → notifyStatus (offline/degraded)
 *
 * Negative/degraded paths prove fail-closed behavior: flag off, missing
 * host writers, unavailable transport, forbidden truth methods, secrets
 * never leak. No live Slack/Telegram/Discord/email network I/O.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asNotificationDeliveryAdapter,
  isChannelAdapter,
} from './adapter';
import {
  isSlackReferenceAdapterEnabled,
  SLACK_REFERENCE_FEATURE_FLAG,
} from './feature-flag';
import { createChannelAdapterRegistry } from './registry';
import {
  createSlackReferenceAdapter,
  registerSlackReferenceAdapterIfEnabled,
  SLACK_REFERENCE_ADAPTER_ID,
} from './slack-reference-adapter';
import { createOfflineSlackTransport } from './slack-transport';
import {
  applyChannelIntakeProposals,
  assertChannelAdapterNotTaskTruthStore,
  CHANNEL_ADAPTER_PRODUCTION_SOURCE_FILES,
  CHANNEL_HOST_TRUTH_BOUNDARY_FILE,
  CHANNEL_TASK_TRUTH_OWNER,
  collectChannelAdapterTruthStoreMethodViolations,
  scanChannelAdapterSourceForTruthStoreViolations,
} from './task-truth-boundary';

const FLAG = SLACK_REFERENCE_FEATURE_FLAG;
const CHANNELS_DIR = path.resolve(__dirname);
const originalFlag = process.env[FLAG];

const SECRET_LEAK_PATTERNS = [
  /xoxb-[A-Za-z0-9-]+/i,
  /Bearer\s+[A-Za-z0-9._-]{16,}/i,
  /\bsk-[A-Za-z0-9]{10,}\b/,
  /super-secret-value-now/i,
  /slack-bot-token-should-never-appear/i,
];

function assertNoSecretLeak(payload: unknown, label: string): void {
  const serialized = JSON.stringify(payload);
  for (const pattern of SECRET_LEAK_PATTERNS) {
    expect(serialized, `${label} must not match ${pattern}`).not.toMatch(pattern);
  }
}

afterEach(() => {
  if (originalFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = originalFlag;
});

describe('CH-A-05 channel adapter proof pack — E2E success', () => {
  it('runs flag→register→intake→host-apply→notify without live Slack or adapter DB writes', async () => {
    const env = { [FLAG]: '1' };
    expect(isSlackReferenceAdapterEnabled(env)).toBe(true);

    const registry = createChannelAdapterRegistry();
    const transport = createOfflineSlackTransport({
      sequenceStart: 921,
      defaultChannel: 'C-proof',
    });
    const adapter = registerSlackReferenceAdapterIfEnabled(registry, {
      env,
      transport,
      defaultChannel: 'C-proof',
    });

    expect(adapter).not.toBeNull();
    if (!adapter) return;
    expect(isChannelAdapter(adapter)).toBe(true);
    expect(adapter.id).toBe(SLACK_REFERENCE_ADAPTER_ID);
    expect(adapter.enabled).toBe(true);
    expect(adapter.getAvailability()).toBe('degraded'); // offline transport — honest, not live
    expect(() => assertChannelAdapterNotTaskTruthStore(adapter)).not.toThrow();
    expect(collectChannelAdapterTruthStoreMethodViolations(adapter)).toEqual([]);

    const snap = await registry.snapshot();
    expect(snap).toMatchObject({
      version: 'entity.channel-adapter.v1',
      count: 1,
    });
    expect(snap.adapters[0]).toMatchObject({
      id: SLACK_REFERENCE_ADAPTER_ID,
      kind: 'slack',
      enabled: true,
      availability: 'degraded',
    });
    assertNoSecretLeak(snap, 'registry.snapshot');

    // Inbound Slack Events API-ish payload → host-applied proposals only.
    const parseResult = await adapter.parseIntake({
      type: 'event_callback',
      token: 'slack-bot-token-should-never-appear',
      event: {
        type: 'message',
        ts: '1722441600.000921',
        channel: 'C-proof',
        user: 'U-proof',
        text: 'Please open CH-A-05 proof follow-up; api_key=super-secret-value-now',
        thread_ts: '1722441500.000001',
      },
    });

    expect(parseResult.ok).toBe(true);
    if (!parseResult.ok) return;
    expect(parseResult.message.kind).toBe('slack');
    expect(parseResult.message.external.externalId).toBe('1722441600.000921');
    expect(parseResult.message.external.roomId).toBe('C-proof');
    expect(parseResult.taskProposal).toMatchObject({
      origin_channel: `slack:${SLACK_REFERENCE_ADAPTER_ID}`,
      status: 'backlog',
    });
    expect(parseResult.activityProposal?.event.action).toBe('channel_intake');
    expect(parseResult.message.body).toContain('api_key=[redacted]');
    expect(parseResult.message.body).not.toContain('super-secret-value-now');
    assertNoSecretLeak(parseResult, 'parseIntake');

    // Host writers are the sole truth path — adapters never create tasks.
    const created: Array<{ name: string; origin_channel: string }> = [];
    const activities: Array<{ taskId: number; action: string }> = [];
    let createCalls = 0;
    let activityCalls = 0;

    const applied = await applyChannelIntakeProposals(parseResult, {
      createTask: (proposal) => {
        createCalls += 1;
        created.push({
          name: proposal.name,
          origin_channel: proposal.origin_channel,
        });
        return { id: 921 };
      },
      appendActivity: (taskId, event) => {
        activityCalls += 1;
        activities.push({ taskId, action: event.action });
      },
    });

    expect(applied).toMatchObject({
      ok: true,
      taskId: 921,
      createdTask: true,
      activityAppended: true,
      truthOwner: CHANNEL_TASK_TRUTH_OWNER,
    });
    expect(createCalls).toBe(1);
    expect(activityCalls).toBe(1);
    expect(created[0]?.origin_channel).toBe(`slack:${SLACK_REFERENCE_ADAPTER_ID}`);
    expect(activities).toEqual([{ taskId: 921, action: 'channel_intake' }]);
    assertNoSecretLeak(applied, 'applyChannelIntakeProposals');

    // Outbound status notify via offline transport — never invents live health.
    const notify = await adapter.notifyStatus({
      kind: 'slack',
      adapterId: adapter.id,
      taskId: 921,
      status: 'review',
      previousStatus: 'doing',
      title: 'CH-A-05 proof task ready for review',
      body: 'Host-applied intake complete',
      metadata: {
        channel: 'C-proof',
        threadTs: '1722441500.000001',
        botToken: 'xoxb-fake-token-must-redact-0123456789',
      },
    });

    expect(notify.status).toBe('degraded');
    expect(notify.degradedReason).toBe('slack_reference_offline_transport');
    expect(notify.externalRef).toMatch(/^slack:C-proof:offline\.921\./);
    expect(notify.metadata).toMatchObject({
      adapterId: SLACK_REFERENCE_ADAPTER_ID,
      transportMode: 'offline',
      featureEnabled: true,
      taskId: 921,
    });
    assertNoSecretLeak(notify, 'notifyStatus');

    // Notification bridge stays offline/degraded too.
    const delivery = asNotificationDeliveryAdapter(adapter);
    expect(delivery.channel).toBe('slack');
    const bridged = await delivery.deliver({
      notification: {
        id: 'n-ch-a-05',
        org_id: 'org-proof',
        recipient_principal_id: 'user-proof',
        canonical_event_id: '921',
        object_ref: { object_type: 'task', object_id: '921', link_role: 'subject' },
        notification_type: 'task_nudge',
        inbox_state: 'unread',
        title: 'Proof nudge',
        body: 'Status update',
        policy_reason_chain_json: '[]',
        metadata_json: '{}',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deliveries: [],
      },
      channel: 'slack',
      title: 'Proof nudge',
      body: 'Status update',
      objectRef: { object_type: 'task', object_id: '921', link_role: 'subject' },
      metadata: { status: 'review' },
    });
    expect(bridged.status).toBe('degraded');
    assertNoSecretLeak(bridged, 'NotificationDeliveryAdapter.deliver');
  });
});

describe('CH-A-05 channel adapter proof pack — negative / degraded', () => {
  it('does not register or invent healthy intake when feature flag is off', async () => {
    const env = { [FLAG]: '0' };
    expect(isSlackReferenceAdapterEnabled(env)).toBe(false);

    const registry = createChannelAdapterRegistry();
    const registered = registerSlackReferenceAdapterIfEnabled(registry, { env });
    expect(registered).toBeNull();
    expect(registry.list()).toHaveLength(0);

    const adapter = createSlackReferenceAdapter({
      featureEnabled: false,
      transport: createOfflineSlackTransport(),
    });
    expect(adapter.enabled).toBe(false);
    expect(adapter.getAvailability()).toBe('not_configured');

    const parseResult = await adapter.parseIntake({
      event: { type: 'message', ts: '1.0', text: 'should not intake', channel: 'C1' },
    });
    expect(parseResult.ok).toBe(false);
    if (parseResult.ok) return;
    expect(parseResult.code).toBe('adapter_disabled');
    expect(parseResult.degraded).toBe(true);

    let createCalls = 0;
    const applied = await applyChannelIntakeProposals(parseResult, {
      createTask: () => {
        createCalls += 1;
        return { id: 1 };
      },
      appendActivity: () => undefined,
    });
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.code).toBe('adapter_disabled');
    expect(applied.truthOwner).toBe(CHANNEL_TASK_TRUTH_OWNER);
    expect(createCalls).toBe(0);

    const notify = await adapter.notifyStatus({
      kind: 'slack',
      adapterId: adapter.id,
      taskId: 1,
      status: 'done',
      title: 'Done',
    });
    expect(notify.status).toBe('skipped');
    expect(notify.degradedReason).toContain('not_configured');
  });

  it('fails closed when host writers are missing (adapter is not a truth store)', async () => {
    const adapter = createSlackReferenceAdapter({
      featureEnabled: true,
      transport: createOfflineSlackTransport(),
    });
    assertChannelAdapterNotTaskTruthStore(adapter);

    const parseResult = await adapter.parseIntake({
      event: {
        type: 'message',
        ts: '1722441600.000500',
        channel: 'C-no-host',
        text: 'Proposal without host must not persist',
      },
    });
    expect(parseResult.ok).toBe(true);
    if (!parseResult.ok) return;

    const withoutHost = await applyChannelIntakeProposals(parseResult, null);
    expect(withoutHost.ok).toBe(false);
    if (withoutHost.ok) return;
    expect(withoutHost.code).toBe('host_writers_required');
    expect(withoutHost.degraded).toBe(true);
    expect(withoutHost.truthOwner).toBe('host_task_service');
  });

  it('surfaces unavailable transport as skipped/degraded, never healthy live send', async () => {
    const adapter = createSlackReferenceAdapter({
      featureEnabled: true,
      transport: createOfflineSlackTransport({ failMode: 'offline' }),
    });
    expect(adapter.getAvailability()).toBe('unavailable');

    const notify = await adapter.notifyStatus({
      kind: 'slack',
      adapterId: adapter.id,
      taskId: 44,
      status: 'blocked',
      title: 'Blocked',
    });
    expect(notify.status).toBe('skipped');
    expect(notify.failureReason).toBe('slack_transport_unavailable');
    expect(notify.degradedReason).toContain('unavailable');
    assertNoSecretLeak(notify, 'unavailable notify');
  });

  it('rejects adapters that expose forbidden truth-store methods', () => {
    const base = createSlackReferenceAdapter({
      featureEnabled: true,
      transport: createOfflineSlackTransport(),
    });
    const poisoned = {
      ...base,
      persistTask: () => ({ id: 1 }),
      createTask: () => ({ id: 1 }),
    };
    expect(collectChannelAdapterTruthStoreMethodViolations(poisoned).length).toBeGreaterThan(0);
    expect(() => assertChannelAdapterNotTaskTruthStore(poisoned)).toThrow(
      /channel_adapter_truth_store_forbidden/,
    );
  });

  it('keeps production adapter sources free of alternate task-truth stores', () => {
    const productionTs = readdirSync(CHANNELS_DIR)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .sort();
    const expected = [
      ...CHANNEL_ADAPTER_PRODUCTION_SOURCE_FILES,
      CHANNEL_HOST_TRUTH_BOUNDARY_FILE,
    ].sort();
    expect(productionTs).toEqual(expected);

    const allViolations = [];
    for (const fileName of CHANNEL_ADAPTER_PRODUCTION_SOURCE_FILES) {
      const source = readFileSync(path.join(CHANNELS_DIR, fileName), 'utf8');
      allViolations.push(
        ...scanChannelAdapterSourceForTruthStoreViolations(source, fileName, 'adapter'),
      );
    }
    expect(allViolations).toEqual([]);

    const hostSource = readFileSync(
      path.join(CHANNELS_DIR, CHANNEL_HOST_TRUTH_BOUNDARY_FILE),
      'utf8',
    );
    expect(
      scanChannelAdapterSourceForTruthStoreViolations(
        hostSource,
        CHANNEL_HOST_TRUTH_BOUNDARY_FILE,
        'host_boundary',
      ),
    ).toEqual([]);
  });

  it('propagates malformed intake without host writes', async () => {
    const adapter = createSlackReferenceAdapter({
      featureEnabled: true,
      transport: createOfflineSlackTransport(),
    });
    const parseResult = await adapter.parseIntake({
      event: { type: 'message', text: 'missing ts / external id', channel: 'C1' },
    });
    expect(parseResult.ok).toBe(false);
    if (parseResult.ok) return;
    expect(parseResult.code).toBe('missing_external_id');

    let createCalls = 0;
    const applied = await applyChannelIntakeProposals(parseResult, {
      createTask: () => {
        createCalls += 1;
        return { id: 99 };
      },
      appendActivity: () => undefined,
    });
    expect(applied.ok).toBe(false);
    expect(createCalls).toBe(0);
  });
});
