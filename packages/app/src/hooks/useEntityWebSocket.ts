import { useEffect, useRef } from 'react';

export interface EntityWsMessage {
  type?: string;
  [key: string]: unknown;
}

const DEFAULT_RECONNECT_DELAY_MS = 3000;

function buildWsUrl(): string {
  try {
    const url = new URL('ws://' + window.location.host);
    const token = window.localStorage.getItem('entity-api-token');
    if (token && token.trim()) {
      url.searchParams.set('token', token.trim());
    }
    return url.toString();
  } catch {
    return 'ws://' + window.location.host;
  }
}

/**
 * Canonical Entity websocket subscription: token auth, JSON parsing,
 * auto-reconnect, and cleanup in one place. Invokes the latest `onMessage` for
 * every parsed message without forcing a reconnect when the callback changes.
 */
export function useEntityWebSocket(
  onMessage: (message: EntityWsMessage) => void,
  options: { enabled?: boolean; reconnectDelayMs?: number } = {},
): void {
  const { enabled = true, reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS } = options;
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const connect = () => {
      if (!active) {
        return;
      }
      socket = new WebSocket(buildWsUrl());

      socket.onmessage = (event) => {
        let message: EntityWsMessage;
        try {
          message = JSON.parse(String(event.data)) as EntityWsMessage;
        } catch {
          return;
        }
        handlerRef.current(message);
      };

      socket.onclose = () => {
        socket = null;
        if (!active) {
          return;
        }
        clearReconnectTimer();
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, reconnectDelayMs);
      };
    };

    connect();

    return () => {
      active = false;
      clearReconnectTimer();
      const current = socket;
      socket = null;
      if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
        current.close();
      }
    };
  }, [enabled, reconnectDelayMs]);
}
