/**
 * CH-A-03 / THE-919 — Slack transport surface for the reference adapter.
 *
 * Default transport is deterministic offline/fake. It never opens sockets or
 * calls Slack APIs. Live transports are intentionally out of scope here.
 */

import { sanitizeChannelPublicText } from './sanitize';

export type SlackTransportMode = 'offline' | 'live';

export interface SlackTransportMessage {
  channel: string;
  text: string;
  threadTs?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SlackTransportResult {
  ok: boolean;
  /** Slack-like message timestamp used as external ref when present. */
  ts?: string;
  channel?: string;
  error?: string;
  /** True when the transport is offline / unreachable. */
  offline?: boolean;
  /** True when delivery happened in a degraded (non-live) mode. */
  degraded?: boolean;
  mode: SlackTransportMode;
}

export interface SlackTransport {
  readonly mode: SlackTransportMode;
  /** Whether the transport can accept messages right now. */
  getHealth: () => 'available' | 'degraded' | 'unavailable' | 'offline';
  postMessage: (message: SlackTransportMessage) => Promise<SlackTransportResult>;
}

export interface OfflineSlackTransportOptions {
  /**
   * none — deterministic successful fake send
   * offline — unreachable; degraded/offline path
   * error — explicit provider-style failure
   */
  failMode?: 'none' | 'offline' | 'error';
  /** Starting counter for deterministic fake message timestamps. */
  sequenceStart?: number;
  defaultChannel?: string;
}

/**
 * Deterministic offline Slack transport for tests and the default reference path.
 * Never performs network I/O.
 */
export function createOfflineSlackTransport(
  options: OfflineSlackTransportOptions = {},
): SlackTransport {
  const failMode = options.failMode ?? 'none';
  let sequence = options.sequenceStart ?? 1;
  const defaultChannel = options.defaultChannel ?? 'C-offline';

  return {
    mode: 'offline',
    getHealth() {
      if (failMode === 'offline') return 'offline';
      if (failMode === 'error') return 'unavailable';
      return 'available';
    },
    async postMessage(message: SlackTransportMessage): Promise<SlackTransportResult> {
      const channel = sanitizeChannelPublicText(message.channel || defaultChannel);
      const text = sanitizeChannelPublicText(message.text);

      if (failMode === 'offline') {
        return {
          ok: false,
          offline: true,
          degraded: true,
          error: 'slack_transport_offline',
          channel,
          mode: 'offline',
        };
      }

      if (failMode === 'error') {
        return {
          ok: false,
          error: 'slack_transport_error',
          channel,
          mode: 'offline',
        };
      }

      const ts = `offline.${sequence++}.${Date.UTC(2026, 6, 31)}`;
      return {
        ok: true,
        ts,
        channel,
        degraded: true,
        mode: 'offline',
        // Keep text length only — never echo secrets-prone payloads upward.
        ...(text ? {} : { error: 'empty_text' }),
      };
    },
  };
}
