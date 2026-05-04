import { useEffect, useRef, useState, useCallback } from 'react';
import { runtime } from '../config/runtime';

interface WebSocketMessage {
  type: string;
  path?: string;
  content?: string;
  agent?: string;
  document?: string;
  instruction?: string;
  event?: string;
  docId?: string;
  payload?: unknown;
  emittedAt?: string;
}

interface UseWebSocketOptions {
  onFileChange?: (path: string, content: string) => void;
  onFileCreate?: (path: string) => void;
  onFileDelete?: (path: string) => void;
  onMention?: (agent: string, document: string, instruction: string) => void;
  onEditorEvent?: (event: { event: string; docId: string; payload: unknown; emittedAt?: string }) => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const optionsRef = useRef<UseWebSocketOptions>(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    let active = true;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (!active) {
        return;
      }

      clearReconnectTimer();
      reconnectAttemptRef.current = Math.min(reconnectAttemptRef.current + 1, 6);
      const delay = Math.min(30_000, 500 * 2 ** reconnectAttemptRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (!active) {
        return;
      }

      const ws = new WebSocket(runtime.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        console.log('[WS] Connected');
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WebSocketMessage;
          setLastMessage(msg);

          switch (msg.type) {
            case 'file:changed':
              optionsRef.current.onFileChange?.(msg.path!, msg.content!);
              break;
            case 'file:created':
              optionsRef.current.onFileCreate?.(msg.path!);
              break;
            case 'file:deleted':
              optionsRef.current.onFileDelete?.(msg.path!);
              break;
            case 'mention:triggered':
              optionsRef.current.onMention?.(msg.agent!, msg.document!, msg.instruction!);
              break;
            case 'editor:event': {
              if (typeof msg.event === 'string' && typeof msg.docId === 'string') {
                optionsRef.current.onEditorEvent?.({
                  event: msg.event,
                  docId: msg.docId,
                  payload: msg.payload,
                  emittedAt: typeof msg.emittedAt === 'string' ? msg.emittedAt : undefined,
                });
              }
              break;
            }
          }
        } catch (e) {
          console.error('[WS] Parse error:', e);
        }
    };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        console.log('[WS] Disconnected');
        setConnected(false);
        scheduleReconnect();
      };

      ws.onerror = (e) => {
        console.error('[WS] Error:', e);
      };
    };

    connect();

    return () => {
      active = false;
      clearReconnectTimer();
      setConnected(false);
      const current = wsRef.current;
      wsRef.current = null;
      if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
        current.close();
      }
    };
  }, []);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { connected, lastMessage, send };
}

// Hook for agent typing indicator
export function useAgentTyping(agentId: string | null) {
  const [typing, setTyping] = useState(false);
  const [typingAgent, setTypingAgent] = useState<string | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    if (!agentId) {
      setTyping(false);
      setTypingAgent(null);
      return;
    }

    const ws = new WebSocket(runtime.wsUrl);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'agent:typing' && msg.agent === agentId) {
          setTyping(true);
          setTypingAgent(msg.agent);
          if (clearTimerRef.current !== null) {
            window.clearTimeout(clearTimerRef.current);
          }
          clearTimerRef.current = window.setTimeout(() => {
            setTyping(false);
            setTypingAgent(null);
          }, 5000);
        }
      } catch {}
    };

    return () => {
      ws.close();
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
  }, [agentId]);

  return { typing, typingAgent };
}
