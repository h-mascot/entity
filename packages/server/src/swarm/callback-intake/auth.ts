/**
 * EEPC-A-07 — Callback authorization for authRequired intake mappings.
 *
 * Credentials arrive via headers only (never body — body secret keys are rejected).
 * Fail-closed: authRequired without a configured secret refuses intake.
 */

import { timingSafeEqual } from 'node:crypto';
import type { ExecutionEnginePluginManifest } from '../manifest/types';
import type {
  CallbackAuthContext,
  CallbackValidationIssue,
  IntakeCallbackEvent,
} from './types';

function issue(path: string, code: string, message: string): CallbackValidationIssue {
  return { path, code, message };
}

function safeEqualString(expected: string, presented: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function extractCallbackCredential(auth: CallbackAuthContext | undefined): string | undefined {
  if (!auth) return undefined;

  const headerToken = auth.callbackToken?.trim();
  if (headerToken) return headerToken;

  const authorization = auth.authorization?.trim();
  if (!authorization) return undefined;

  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  if (bearer?.[1]) {
    const token = bearer[1].trim();
    return token || undefined;
  }

  return undefined;
}

/**
 * Manifest authRequired for the event, or fail-closed true when the event is
 * ActivityEvent-allowed without an explicit intake mapping.
 */
export function isCallbackAuthRequired(
  event: IntakeCallbackEvent,
  manifest: ExecutionEnginePluginManifest,
): boolean {
  const intake = manifest.callbacks.intake.find((entry) => entry.event === event);
  if (intake) return intake.authRequired;
  // Emits-only events still produce ActivityEvents — require auth by default.
  return true;
}

export type CallbackAuthDecision =
  | { ok: true; authRequired: boolean }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      issues: CallbackValidationIssue[];
    };

export function authorizeExecutionCallback(input: {
  event: IntakeCallbackEvent;
  provider: string;
  manifest: ExecutionEnginePluginManifest;
  auth?: CallbackAuthContext;
  getCallbackAuthSecret?: (provider: string) => string | undefined;
}): CallbackAuthDecision {
  const authRequired = isCallbackAuthRequired(input.event, input.manifest);
  if (!authRequired) {
    return { ok: true, authRequired: false };
  }

  const expected = input.getCallbackAuthSecret?.(input.provider)?.trim();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      code: 'auth_misconfigured',
      message: 'Callback authentication is required but not configured for this provider',
      issues: [
        issue(
          'authorization',
          'auth_misconfigured',
          'authRequired callback cannot be accepted without a configured callback secret',
        ),
      ],
    };
  }

  const presented = extractCallbackCredential(input.auth);
  if (!presented || !safeEqualString(expected, presented)) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Unauthorized callback',
      issues: [
        issue(
          'authorization',
          'unauthorized',
          'Valid Authorization Bearer or X-Entity-Callback-Token required',
        ),
      ],
    };
  }

  return { ok: true, authRequired: true };
}

/**
 * Resolve callback shared secret for production wiring.
 * Prefers ENTITY_EEPC_CALLBACK_TOKEN, then first secret env binding on the manifest.
 * Never returns empty strings.
 */
export function resolveCallbackAuthSecretFromEnv(
  provider: string,
  manifest: ExecutionEnginePluginManifest | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const globalToken = env.ENTITY_EEPC_CALLBACK_TOKEN?.trim();
  if (globalToken) return globalToken;

  if (!manifest) return undefined;

  for (const binding of manifest.config.bindings) {
    if (!binding.secret || binding.source !== 'env') continue;
    const value = env[binding.key]?.trim();
    if (value) return value;
  }

  // Provider-scoped optional override (never logged).
  const scoped = env[`ENTITY_EEPC_CALLBACK_TOKEN_${provider.toUpperCase()}`]?.trim();
  return scoped || undefined;
}
