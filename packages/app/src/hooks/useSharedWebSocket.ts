import { useCallback, useEffect, useRef, useState } from 'react';
import { runtime } from '../config/runtime';

export interface EntityWsMessage {
  type?: string;
  [key: string]: unknown;
}

type MessageHandler = (message: EntityWsMessage) => void;
type StatusHandler = (connected: boolean) => void;

const RECONNECT_DELAY_MS = 3000;

const messageHandlers = new Set<MessageHandler>();
const statusHandlers = new Set<StatusHandler>();

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let subscriberCount = 0;
let shouldReconnect = false;
let connectedSnapshot = false;

function getAuthenticatedWsUrl(baseUrl: string): string {
  try {
    if (typeof window === 'undefined') return baseUrl;
    const token = window.localStorage.getItem('entity-api-token');
    if (!token || !token.trim()) return baseUrl;
    const url = new URL(baseUrl);
    url.searchParams.set('token', token.trim());
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function notifyStatus(connected: boolean) {
  if (connectedSnapshot === connected) {
    return;
  }

  connectedSnapshot = connected;
  for (const handler of statusHandlers) {
    handler(connected);
  }
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function connectSharedSocket() {
  if (typeof window === 'undefined' || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  const nextSocket = new WebSocket(getAuthenticatedWsUrl(runtime.wsUrl));
  socket = nextSocket;

  nextSocket.onopen = () => {
    clearReconnectTimer();
    notifyStatus(true);
  };

  nextSocket.onmessage = (event) => {
    let message: EntityWsMessage;
    try {
      message = JSON.parse(String(event.data)) as EntityWsMessage;
    } catch {
      return;
    }

    for (const handler of messageHandlers) {
      handler(message);
    }
  };

  nextSocket.onclose = () => {
    if (socket === nextSocket) {
      socket = null;
    }
    notifyStatus(false);
    if (!shouldReconnect || subscriberCount === 0) {
      return;
    }

    clearReconnectTimer();
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connectSharedSocket();
    }, RECONNECT_DELAY_MS);
  };

  nextSocket.onerror = (error) => {
    console.error('[WS] Error:', error);
  };
}

function retainSharedSocket(): () => void {
  subscriberCount += 1;
  shouldReconnect = true;
  connectSharedSocket();

  return () => {
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount > 0) {
      return;
    }

    shouldReconnect = false;
    clearReconnectTimer();
    const current = socket;
    socket = null;
    notifyStatus(false);
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      current.close();
    }
  };
}

function sendSharedSocket(data: unknown) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

export function useSharedWebSocket(
  onMessage?: (message: EntityWsMessage) => void,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;
  const [connected, setConnected] = useState(connectedSnapshot);
  const [lastMessage, setLastMessage] = useState<EntityWsMessage | null>(null);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    const messageHandler: MessageHandler = (message) => {
      setLastMessage(message);
      handlerRef.current?.(message);
    };
    const statusHandler: StatusHandler = (nextConnected) => {
      setConnected(nextConnected);
    };

    messageHandlers.add(messageHandler);
    statusHandlers.add(statusHandler);
    setConnected(connectedSnapshot);
    const release = retainSharedSocket();

    return () => {
      messageHandlers.delete(messageHandler);
      statusHandlers.delete(statusHandler);
      release();
    };
  }, [enabled]);

  const send = useCallback((data: unknown) => {
    sendSharedSocket(data);
  }, []);

  return { connected, lastMessage, send };
}
