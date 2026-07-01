import { useSharedWebSocket, type EntityWsMessage } from './useSharedWebSocket';

export type { EntityWsMessage };

/**
 * Canonical Entity websocket subscription: token auth, JSON parsing,
 * auto-reconnect, and cleanup in one place. Invokes the latest `onMessage` for
 * every parsed message without forcing a reconnect when the callback changes.
 */
export function useEntityWebSocket(
  onMessage: (message: EntityWsMessage) => void,
  options: { enabled?: boolean; reconnectDelayMs?: number } = {},
): void {
  useSharedWebSocket(onMessage, { enabled: options.enabled ?? true });
}
