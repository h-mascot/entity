import { useEffect, useRef, useState } from 'react';
import { useSharedWebSocket, type EntityWsMessage } from './useSharedWebSocket';

interface WebSocketMessage extends EntityWsMessage {
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
  const optionsRef = useRef<UseWebSocketOptions>(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const { connected, lastMessage, send } = useSharedWebSocket((msg) => {
    const message = msg as WebSocketMessage;
    switch (message.type) {
      case 'file:changed':
        optionsRef.current.onFileChange?.(message.path!, message.content!);
        break;
      case 'file:created':
        optionsRef.current.onFileCreate?.(message.path!);
        break;
      case 'file:deleted':
        optionsRef.current.onFileDelete?.(message.path!);
        break;
      case 'mention:triggered':
        optionsRef.current.onMention?.(message.agent!, message.document!, message.instruction!);
        break;
      case 'editor:event': {
        if (typeof message.event === 'string' && typeof message.docId === 'string') {
          optionsRef.current.onEditorEvent?.({
            event: message.event,
            docId: message.docId,
            payload: message.payload,
            emittedAt: typeof message.emittedAt === 'string' ? message.emittedAt : undefined,
          });
        }
        break;
      }
    }
  });

  return { connected, lastMessage: lastMessage as WebSocketMessage | null, send };
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

    return () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
  }, [agentId]);

  useSharedWebSocket((msg) => {
    if (msg.type === 'agent:typing' && msg.agent === agentId) {
      setTyping(true);
      setTypingAgent(typeof msg.agent === 'string' ? msg.agent : null);
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
      clearTimerRef.current = window.setTimeout(() => {
        setTyping(false);
        setTypingAgent(null);
      }, 5000);
    }
  }, { enabled: Boolean(agentId) });

  return { typing, typingAgent };
}
