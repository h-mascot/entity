import { DEFAULT_CLICKCLACK_BASE_URL } from './bridge';

export type ClickClackReadinessState = 'live' | 'staged' | 'degraded' | 'unavailable' | 'not_configured';

export interface ClickClackReadinessSnapshot {
  state: ClickClackReadinessState;
  configured: boolean;
  bridgeEnabled: boolean;
  baseUrl: string | null;
  reason: string;
  checkedAt: string;
}

export interface ClickClackReadinessInput {
  bridgeEnabled: boolean;
  bridgeConfigured: boolean;
  baseUrl?: string | null;
  reachable?: boolean | null;
  degraded?: boolean;
  reason?: string;
  now?: Date;
}

export type ClickClackReadinessProbe = () => Promise<ClickClackReadinessSnapshot> | ClickClackReadinessSnapshot;

function cleanText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const cleaned = cleanText(value);
  return cleaned ? cleaned.replace(/\/+$/, '') : null;
}

export function classifyClickClackReadiness(input: ClickClackReadinessInput): ClickClackReadinessSnapshot {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const checkedAt = (input.now ?? new Date()).toISOString();
  const configured = input.bridgeConfigured || Boolean(baseUrl);

  if (!configured) {
    return {
      state: 'not_configured',
      configured: false,
      bridgeEnabled: false,
      baseUrl: null,
      reason: 'clickclack_not_configured',
      checkedAt,
    };
  }

  if (!input.bridgeEnabled) {
    return {
      state: 'staged',
      configured: true,
      bridgeEnabled: false,
      baseUrl,
      reason: input.reason || 'clickclack_configured_bridge_disabled',
      checkedAt,
    };
  }

  if (input.reachable === false) {
    return {
      state: 'unavailable',
      configured: true,
      bridgeEnabled: true,
      baseUrl,
      reason: input.reason || 'clickclack_unreachable',
      checkedAt,
    };
  }

  if (input.degraded) {
    return {
      state: 'degraded',
      configured: true,
      bridgeEnabled: true,
      baseUrl,
      reason: input.reason || 'clickclack_degraded',
      checkedAt,
    };
  }

  return {
    state: 'live',
    configured: true,
    bridgeEnabled: true,
    baseUrl,
    reason: input.reason || 'clickclack_live',
    checkedAt,
  };
}

export function createEnvClickClackReadinessProbe(input: {
  bridgeEnabled: boolean;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}): ClickClackReadinessProbe {
  const env = input.env ?? process.env;
  return () => {
    const bridgeConfigured = cleanText(env.ENTITY_CHAT_CLICKCLACK_BRIDGE) === '1';
    const explicitBaseUrl = normalizeBaseUrl(env.ENTITY_CLICKCLACK_BASE_URL);
    const sidecarDisabled = cleanText(env.ENTITY_CLICKCLACK_SIDECAR) === '0';
    return classifyClickClackReadiness({
      bridgeEnabled: input.bridgeEnabled,
      bridgeConfigured,
      baseUrl: explicitBaseUrl ?? (bridgeConfigured ? DEFAULT_CLICKCLACK_BASE_URL : null),
      reachable: input.bridgeEnabled ? null : undefined,
      degraded: sidecarDisabled && bridgeConfigured,
      reason: sidecarDisabled && bridgeConfigured ? 'clickclack_sidecar_disabled' : undefined,
      now: input.now?.(),
    });
  };
}
