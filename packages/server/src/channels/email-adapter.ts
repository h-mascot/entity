/**
 * THE-932 (blocker 3) — Email channel adapter with SMTP backend health enforced
 * at the configuration/registration boundary.
 *
 * The codebase has no SMTP execution path, so this adapter never performs a
 * live SMTP send. Instead it validates the backend connection config at
 * construction via `validateSmtpBackendConfig` and FAILS CLOSED on plaintext
 * SMTP AUTH (credentials in the clear). A configured adapter honestly reports
 * its availability through `assessBackendHealth` (public-safe, no secrets) and
 * returns a degraded/skipped notify result (no live delivery). This wires the
 * formerly-orphan `backend-health` validator into the live channel-adapter
 * registration path exposed by `/api/channel-adapters`.
 */

import type { ChannelAdapter } from './adapter';
import { isChannelAdapter, normalizeChannelIntakeRaw } from './adapter';
import {
  assessBackendHealth,
  validateSmtpBackendConfig,
  type SmtpBackendConfig,
} from '../swarm/providers/backend-health';
import {
  sanitizeChannelMetadata,
  sanitizeChannelPublicText,
} from './sanitize';
import type {
  ChannelAdapterAvailability,
  ChannelIntakeParseResult,
  ChannelNotifyResult,
  ChannelStatusNotifyRequest,
} from './types';

export const EMAIL_CHANNEL_ADAPTER_ID = 'email';
export const EMAIL_CHANNEL_ADAPTER_DISPLAY_NAME = 'Email (SMTP) adapter';

/** Typed error raised when an SMTP backend config is rejected (fail closed). */
export class EmailAdapterConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EmailAdapterConfigError';
    this.code = code;
  }
}

export interface EmailChannelAdapterOptions {
  id?: string;
  displayName?: string;
  /** SMTP backend connection config. Validated at construction; plaintext AUTH fails closed. */
  smtp?: SmtpBackendConfig | null;
  /** When false the adapter is present but disabled (not registered for production notify). */
  enabled?: boolean;
}

function resolveAvailability(smtp: SmtpBackendConfig | null | undefined): ChannelAdapterAvailability {
  if (!smtp) return 'not_configured';
  const health = assessBackendHealth(smtp);
  return health.available ? 'available' : 'unavailable';
}

export function createEmailChannelAdapter(options: EmailChannelAdapterOptions = {}): ChannelAdapter {
  const smtp = options.smtp ?? null;

  // THE-932: enforce the SMTP backend health rule at the configuration boundary.
  // Plaintext SMTP AUTH (port 25/2525, or secure:false without STARTTLS while
  // carrying credentials) can never be accepted or used.
  if (smtp) {
    const decision = validateSmtpBackendConfig(smtp);
    if (!decision.ok) {
      throw new EmailAdapterConfigError(
        decision.code ?? 'invalid_smtp_config',
        decision.message ?? 'SMTP backend config is invalid.',
      );
    }
  }

  const id = options.id ?? EMAIL_CHANNEL_ADAPTER_ID;
  const displayName = options.displayName ?? EMAIL_CHANNEL_ADAPTER_DISPLAY_NAME;
  const availability = resolveAvailability(smtp);
  // An email adapter is only enabled when a valid SMTP backend is configured.
  const isEnabled = options.enabled ?? Boolean(smtp);

  const adapter: ChannelAdapter = {
    id,
    kind: 'email',
    displayName,
    enabled: isEnabled,
    getAvailability: () => availability,
    parseIntake: (raw: unknown): ChannelIntakeParseResult =>
      normalizeChannelIntakeRaw(raw, { adapterId: id, kind: 'email' }),
    notifyStatus: async (request: ChannelStatusNotifyRequest): Promise<ChannelNotifyResult> => {
      // There is no SMTP execution path in this codebase. Fail closed: never
      // invent a live send, and never echo the SMTP config or credentials.
      const publicMeta = (sanitizeChannelMetadata({
        adapterId: id,
        taskId: request.taskId,
        status: request.status,
        availability,
      }) ?? {}) as Record<string, unknown>;

      if (availability === 'not_configured') {
        return {
          status: 'skipped',
          degradedReason: `${id} not_configured`,
          metadata: publicMeta,
        };
      }

      return {
        status: 'degraded',
        degradedReason: 'email_smtp_delivery_not_wired',
        failureReason: 'email_smtp_delivery_not_wired',
        metadata: {
          ...publicMeta,
          title: sanitizeChannelPublicText(request.title),
        },
      };
    },
  };

  if (!isChannelAdapter(adapter)) {
    throw new Error('email_channel_adapter_invalid');
  }
  return adapter;
}
