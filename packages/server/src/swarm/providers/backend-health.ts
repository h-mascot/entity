/**
 * THE-932 — Provider backend health & connection-config validation.
 *
 * Coherent with the swarm secret-safe posture: backend connection configs are
 * validated before use and projected to a public-safe health view that never
 * leaks credentials. The headline rule: SMTP authentication over a plaintext
 * channel is rejected (no credentials in the clear).
 */

export interface SmtpAuth {
  user?: string;
  pass?: string;
}

export interface SmtpBackendConfig {
  host?: string;
  port?: number;
  /** Implicit TLS (typically port 465). */
  secure?: boolean;
  /** Require STARTTLS upgrade (typically port 587). */
  requireTls?: boolean;
  auth?: SmtpAuth | null;
}

export interface BackendConfigValidation {
  ok: boolean;
  code?: string;
  message?: string;
}

export interface BackendHealthProjection {
  available: boolean;
  code?: string;
  message: string;
  checkedAt: string;
}

const SMTP_PLAINTEXT_PORTS = new Set([25, 2525]);
const MAX_PORT = 65535;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasAuth(auth: unknown): boolean {
  if (!isObject(auth)) return false;
  const user = String(auth.user ?? '').trim();
  const pass = String(auth.pass ?? '').trim();
  return Boolean(user || pass);
}

/**
 * Validate an SMTP backend config. Authentication over a plaintext channel
 * (port 25/2525, or `secure:false` without enforced STARTTLS) is forbidden.
 */
export function validateSmtpBackendConfig(config: unknown): BackendConfigValidation {
  if (!isObject(config)) {
    return { ok: false, code: 'malformed_config', message: 'SMTP config must be an object.' };
  }

  const rawPort = config.port;
  if (rawPort !== undefined && typeof rawPort !== 'number') {
    return { ok: false, code: 'invalid_port', message: 'port must be an integer in [0, 65535].' };
  }
  const port = typeof rawPort === 'number' ? rawPort : undefined;
  if (port !== undefined && (!Number.isFinite(port) || port < 0 || port > MAX_PORT)) {
    return { ok: false, code: 'invalid_port', message: 'port must be an integer in [0, 65535].' };
  }

  const secure = config.secure === true;
  const requireTls = config.requireTls === true;
  const usesPlaintextChannel =
    (typeof port === 'number' && SMTP_PLAINTEXT_PORTS.has(port)) || (!secure && !requireTls);

  if (usesPlaintextChannel && hasAuth(config.auth)) {
    return {
      ok: false,
      code: 'plaintext_auth_forbidden',
      message: 'SMTP authentication over a plaintext channel is forbidden; use implicit TLS (465) or require STARTTLS (587).',
    };
  }

  return { ok: true };
}

/**
 * Project a backend config to a public-safe health view. Never throws and never
 * leaks credentials (auth is validated for shape only).
 */
export function assessBackendHealth(config: unknown): BackendHealthProjection {
  const checkedAt = new Date().toISOString();
  const decision = validateSmtpBackendConfig(config);
  if (!decision.ok) {
    return {
      available: false,
      code: decision.code,
      message: decision.message ?? 'Backend config is invalid.',
      checkedAt,
    };
  }
  return {
    available: true,
    message: 'Backend config validated (TLS-protected authentication).',
    checkedAt,
  };
}
