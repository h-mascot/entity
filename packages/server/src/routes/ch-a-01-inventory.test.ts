/**
 * CH-A-01 / THE-917 characterization — locks ClickClack/chat/outbound seams
 * for the channel adapter interface task (CH-A-02).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLICKCLACK_PINNED_COMMIT,
  DEFAULT_CLICKCLACK_BASE_URL,
} from '../clickclack/bridge';
import {
  classifyClickClackReadiness,
  type ClickClackReadinessState,
} from '../clickclack/readiness';
import {
  resolveNotificationChannels,
  type NotificationRoutingInput,
} from '../notification-routing';

const INVENTORY_JSON = path.resolve(
  __dirname,
  '../../../../docs/context/entity-ch-a-01-clickclack-chat-outbound-inventory.json',
);

const SECRET_LIKE_KEYS = [
  'apiKey',
  'api_key',
  'token',
  'secret',
  'password',
  'authorization',
  'OPENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ENTITY_API_TOKEN',
];

function assertNoSecretLikeKeys(value: unknown, trail = 'root'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretLikeKeys(entry, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    // Inventory may list env *names* (e.g. ENTITY_API_TOKEN) under envNames — that is OK.
    // Ban secret-bearing object keys outside the envNames allowlist trail.
    const inEnvNamesList = trail.includes('.envNames');
    if (!inEnvNamesList) {
      for (const banned of SECRET_LIKE_KEYS) {
        expect(lower === banned.toLowerCase() || lower.includes(`${banned.toLowerCase()}_value`), `${trail}.${key}`).toBe(
          false,
        );
      }
    }
    if (typeof child === 'string') {
      // Allow public git SHAs / content hashes; ban opaque bearer-like secrets.
      const isPublicHexHash = /^[a-f0-9]{40,64}$/i.test(child);
      if (!isPublicHexHash) {
        expect(child).not.toMatch(/^(Bearer\s+)[A-Za-z0-9._-]{20,}$/i);
        expect(child).not.toMatch(/^(sk-|rk-|ghp_|xox[baprs]-)/i);
      }
      expect(child.toLowerCase()).not.toContain('api_key=');
      expect(child.toLowerCase()).not.toMatch(/token=[^\s[]+/);
    }
    assertNoSecretLikeKeys(child, `${trail}.${key}`);
  }
}

describe('CH-A-01 ClickClack/chat/outbound inventory', () => {
  const inventory = JSON.parse(readFileSync(INVENTORY_JSON, 'utf8')) as {
    code: string;
    issue: string;
    decision: string;
    clickclack: {
      pinCommit: string;
      defaultBaseUrl: string;
      readinessStates: ClickClackReadinessState[];
      namespaces: { spa: string; api: string };
      proxyAlwaysRegistered: boolean;
      bridgeOptional: boolean;
      liveHttpProbeWhenBridgeEnabled: boolean;
    };
    missionChat: {
      prefix: string;
      routes: Array<{ method: string; path: string; orgRequired?: boolean; degradedStatusOnBridgeFail?: number }>;
      orgScopedRoutes: string[];
      externalImChannelsFromChat: string[];
    };
    notifications: {
      routingService: { mountedInIndex: boolean; inboxFirst: boolean; adapterInterface: string };
      externalChannels: string[];
      canonicalChannel: string;
      defaultChannelsNormal: string[];
      defaultChannelsHighCritical: string[];
      productionAdaptersRegistered: string[];
      inboundIntakeToTaskOrActivityEvent: boolean;
    };
    ui: {
      chatClickclackPackagePresent: boolean;
      taskChatContextReadOnly: boolean;
      chatUsesWebSocket: boolean;
      externalChannelBindUi: boolean;
    };
    gapsForChA02: string[];
  };

  const chatSource = readFileSync(path.resolve(__dirname, 'chat.ts'), 'utf8');
  const indexSource = readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8');
  const readinessSource = readFileSync(
    path.resolve(__dirname, '../clickclack/readiness.ts'),
    'utf8',
  );

  it('durable inventory identity and decision are CHARACTERIZED', () => {
    expect(inventory.code).toBe('CH-A-01');
    expect(inventory.issue).toBe('THE-917');
    expect(inventory.decision).toBe('CHARACTERIZED');
  });

  it('ClickClack pin and default base URL match bridge exports', () => {
    expect(inventory.clickclack.pinCommit).toBe(CLICKCLACK_PINNED_COMMIT);
    expect(inventory.clickclack.defaultBaseUrl).toBe(DEFAULT_CLICKCLACK_BASE_URL);
    expect(inventory.clickclack.namespaces).toEqual({
      spa: '/clickclack/*',
      api: '/api/clickclack/*',
    });
  });

  it('readiness states match the classifier contract', () => {
    expect(inventory.clickclack.readinessStates).toEqual([
      'live',
      'staged',
      'degraded',
      'unavailable',
      'not_configured',
    ]);

    expect(classifyClickClackReadiness({ bridgeEnabled: false, bridgeConfigured: false }).state).toBe(
      'not_configured',
    );
    expect(
      classifyClickClackReadiness({
        bridgeEnabled: false,
        bridgeConfigured: true,
        baseUrl: DEFAULT_CLICKCLACK_BASE_URL,
      }).state,
    ).toBe('staged');
    expect(
      classifyClickClackReadiness({
        bridgeEnabled: true,
        bridgeConfigured: true,
        baseUrl: DEFAULT_CLICKCLACK_BASE_URL,
        degraded: true,
      }).state,
    ).toBe('degraded');
    expect(
      classifyClickClackReadiness({
        bridgeEnabled: true,
        bridgeConfigured: true,
        baseUrl: DEFAULT_CLICKCLACK_BASE_URL,
        reachable: false,
      }).state,
    ).toBe('unavailable');
    expect(
      classifyClickClackReadiness({
        bridgeEnabled: true,
        bridgeConfigured: true,
        baseUrl: DEFAULT_CLICKCLACK_BASE_URL,
      }).state,
    ).toBe('live');

    // Env probe leaves reachable null when bridge enabled (no live HTTP probe).
    expect(inventory.clickclack.liveHttpProbeWhenBridgeEnabled).toBe(false);
    expect(readinessSource).toContain('reachable: input.bridgeEnabled ? null : undefined');
  });

  it('mission chat route surface is present in chat.ts including degraded send', () => {
    expect(inventory.missionChat.prefix).toBe('/api/chat');
    expect(inventory.missionChat.routes.length).toBeGreaterThanOrEqual(20);

    for (const route of inventory.missionChat.routes) {
      expect(chatSource, route.path).toContain(`'${route.path}'`);
    }

    const sendRoute = inventory.missionChat.routes.find((r) => r.path === '/api/chat/send');
    expect(sendRoute?.degradedStatusOnBridgeFail).toBe(202);
    expect(inventory.missionChat.externalImChannelsFromChat).toEqual([]);
    expect(inventory.missionChat.orgScopedRoutes).toEqual(['object-refs']);
  });

  it('notification routing is inbox-first, unwired, and adapter enum matches', () => {
    expect(inventory.notifications.canonicalChannel).toBe('entity_inbox');
    expect(inventory.notifications.routingService.mountedInIndex).toBe(false);
    expect(inventory.notifications.routingService.inboxFirst).toBe(true);
    expect(inventory.notifications.routingService.adapterInterface).toBe(
      'NotificationDeliveryAdapter',
    );
    expect(inventory.notifications.productionAdaptersRegistered).toEqual([]);
    expect(inventory.notifications.inboundIntakeToTaskOrActivityEvent).toBe(false);

    expect(indexSource).toContain('createNotificationRouter');
    expect(indexSource).not.toContain('createNotificationRoutingService');
    expect(indexSource).toContain('registerClickClackProxyRoutes');
    expect(indexSource).toContain('registerChatRoutes');

    expect(inventory.notifications.externalChannels).toEqual([
      'clickclack',
      'email',
      'discord',
      'slack',
      'agentpush',
      'webhook',
      'other',
    ]);

    const base: NotificationRoutingInput = {
      recipientPrincipalId: 'user-1',
      canonicalEventId: 'evt-1',
      objectRef: { object_type: 'task', object_id: '1', link_role: 'primary' },
      notificationType: 'task_nudge',
      title: 't',
    };
    expect(resolveNotificationChannels(base)).toEqual(
      inventory.notifications.defaultChannelsNormal,
    );
    expect(resolveNotificationChannels({ ...base, urgency: 'critical' })).toEqual(
      inventory.notifications.defaultChannelsHighCritical,
    );
  });

  it('UI posture flags match inventory (no clickclack package, no external bind UI)', () => {
    expect(inventory.ui.chatClickclackPackagePresent).toBe(false);
    expect(inventory.ui.taskChatContextReadOnly).toBe(true);
    expect(inventory.ui.chatUsesWebSocket).toBe(false);
    expect(inventory.ui.externalChannelBindUi).toBe(false);
    expect(inventory.clickclack.proxyAlwaysRegistered).toBe(true);
    expect(inventory.clickclack.bridgeOptional).toBe(true);
  });

  it('inventory JSON is public-safe (no secret-bearing keys/values)', () => {
    assertNoSecretLikeKeys(inventory);
  });

  it('CH-A-02 gaps are explicitly listed', () => {
    expect(inventory.gapsForChA02).toContain('no_shared_channel_adapter_interface');
    expect(inventory.gapsForChA02).toContain('notification_routing_unwired');
    expect(inventory.gapsForChA02).toContain('no_inbound_intake_adapter');
    expect(inventory.gapsForChA02.length).toBeGreaterThanOrEqual(8);
  });
});
