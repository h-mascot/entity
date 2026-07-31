/**
 * CH-A-03 / THE-919 — Channel reference-adapter feature flags.
 *
 * Production Slack/Telegram/Discord/email sends stay off by default.
 * Opt-in via env only; never auto-enable from secrets presence.
 */

import { isTruthyEnv } from '../middleware/bind-guard';

/** Env key that enables the Slack reference adapter registration path. */
export const SLACK_REFERENCE_FEATURE_FLAG = 'ENTITY_CHANNEL_SLACK_ADAPTER';

export function isSlackReferenceAdapterEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return isTruthyEnv(env[SLACK_REFERENCE_FEATURE_FLAG]);
}
