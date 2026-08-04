/**
 * THE-932 (blocker 2) — Safe env/config loader for the email channel adapter.
 *
 * An email/SMTP adapter is registered ONLY when explicitly configured via env
 * (`ENTITY_EMAIL_SMTP_HOST`). The config is validated at construction through
 * `createEmailChannelAdapter`, which FAILS CLOSED on plaintext SMTP AUTH. A
 * refused (unsafe) config is never registered and never usable.
 *
 * AUTHORITATIVE BOUNDARY: this codebase has no SMTP send client. Registration is
 * the only supported boundary — the adapter honestly reports it cannot deliver
 * (degraded/skipped) and never invents a live send. Do not interpret a registered
 * adapter as SMTP delivery capability.
 */
import type { ChannelAdapter } from './adapter';
import { createEmailChannelAdapter, EmailAdapterConfigError } from './email-adapter';
import type { SmtpBackendConfig } from '../swarm/providers/backend-health';

export type EmailEnv = Record<string, string | undefined>;

function isTruthyFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'TRUE';
}

/**
 * Read an SMTP backend config from env. Returns `null` when an email adapter is
 * not explicitly configured (no host). Never validates here — validation happens
 * at adapter construction so a single fail-closed gate governs registration.
 */
export function readEmailSmtpConfigFromEnv(env: EmailEnv): SmtpBackendConfig | null {
  const host = typeof env.ENTITY_EMAIL_SMTP_HOST === 'string' ? env.ENTITY_EMAIL_SMTP_HOST.trim() : '';
  if (!host) return null;

  const portRaw = Number(env.ENTITY_EMAIL_SMTP_PORT);
  const port = Number.isFinite(portRaw) && portRaw > 0 && portRaw <= 65535 ? portRaw : 465;

  const user = typeof env.ENTITY_EMAIL_SMTP_USER === 'string' ? env.ENTITY_EMAIL_SMTP_USER : '';
  const pass = typeof env.ENTITY_EMAIL_SMTP_PASS === 'string' ? env.ENTITY_EMAIL_SMTP_PASS : '';
  const auth = user || pass ? { user, pass } : null;

  const config: SmtpBackendConfig = {
    host,
    port,
    auth,
  };
  if (isTruthyFlag(env.ENTITY_EMAIL_SMTP_SECURE)) config.secure = true;
  if (isTruthyFlag(env.ENTITY_EMAIL_SMTP_REQUIRE_TLS)) config.requireTls = true;
  return config;
}

/**
 * Load an email adapter from env. Returns the adapter when securely configured,
 * or `null` when (a) not configured or (b) the config is rejected at
 * construction (plaintext AUTH / invalid). A rejected config never registers so
 * it can never be used — this is the fail-closed registration gate.
 */
export function loadEmailAdapterFromEnv(env: EmailEnv): ChannelAdapter | null {
  const smtp = readEmailSmtpConfigFromEnv(env);
  if (!smtp) return null;
  try {
    return createEmailChannelAdapter({ smtp });
  } catch (error) {
    if (error instanceof EmailAdapterConfigError) {
      // Fail closed: the unsafe/invalid config is refused entry to the registry.
      console.warn(`[channels] email adapter not registered (${error.code}): ${error.message}`);
      return null;
    }
    throw error;
  }
}
