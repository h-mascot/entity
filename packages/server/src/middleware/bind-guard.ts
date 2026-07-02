export interface BindGuardInput {
  host: string | undefined | null;
  hasToken: boolean;
  allowInsecure?: unknown;
  logger?: Pick<Console, 'warn'>;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isTruthyEnv(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value !== 'string') {
    return false;
  }
  return TRUTHY_VALUES.has(value.trim().toLowerCase());
}

export function isLoopbackBindHost(host: string | undefined | null): boolean {
  const normalized = (host ?? '').trim().toLowerCase();
  return LOOPBACK_HOSTS.has(normalized);
}

export function assertSecureBindOrThrow(input: BindGuardInput): void {
  const host = (input.host ?? '').trim() || '0.0.0.0';
  if (input.hasToken || isLoopbackBindHost(host)) {
    return;
  }

  if (isTruthyEnv(input.allowInsecure)) {
    input.logger?.warn(
      `[Security] WARNING: Entity is binding ${host} without ENTITY_API_TOKEN because ENTITY_ALLOW_INSECURE is enabled. Set ENTITY_API_TOKEN before exposing this server.`,
    );
    return;
  }

  throw new Error(
    `Refusing to start Entity on non-loopback host ${host} without ENTITY_API_TOKEN. Set ENTITY_API_TOKEN, bind HOST=127.0.0.1 for local-only development, or set ENTITY_ALLOW_INSECURE=1 to explicitly accept an unauthenticated network bind.`,
  );
}
