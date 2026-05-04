import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { cacheOfflineMetaPayload, readOfflineMetaPayload } from '../lib/offline';

type ChatRole = 'user' | 'assistant' | 'system';
type ChatEngine = 'cloud' | 'local';

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  engine: ChatEngine;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface OfflineAwareChatProps {
  isOffline: boolean;
}

const CHAT_HISTORY_KEY = 'chat-history.v1';
const MAX_MESSAGES = 80;
const DEFAULT_LOCAL_MODEL = 'qwen2.5-coder:7b';
const DEFAULT_CLOUD_MODEL = 'gpt-4o-mini';

function createMessageId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function trimMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_MESSAGES) {
    return messages;
  }

  return messages.slice(messages.length - MAX_MESSAGES);
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 6000): Promise<Response> {
  const abort = new AbortController();
  const timeoutId = window.setTimeout(() => abort.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: abort.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function normalizeAssistantText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    return '';
  }
  return content.trim();
}

async function resolveLocalModel(): Promise<string> {
  try {
    const response = await fetchWithTimeout('http://localhost:11434/api/tags', { method: 'GET' }, 3500);
    if (!response.ok) {
      return DEFAULT_LOCAL_MODEL;
    }
    const payload = (await response.json()) as OllamaTagsResponse;
    const names = Array.isArray(payload.models)
      ? payload.models
          .map((entry) => (typeof entry?.name === 'string' ? entry.name.trim() : ''))
          .filter((value) => Boolean(value))
      : [];
    if (names.length === 0) {
      return DEFAULT_LOCAL_MODEL;
    }
    if (names.includes(DEFAULT_LOCAL_MODEL)) {
      return DEFAULT_LOCAL_MODEL;
    }
    const preferred = names.find((name) => name.toLowerCase().includes('qwen2.5-coder'));
    return preferred ?? names[0];
  } catch {
    return DEFAULT_LOCAL_MODEL;
  }
}

async function requestLocalCompletion(messages: ChatMessage[]): Promise<string> {
  const model = await resolveLocalModel();
  const response = await fetchWithTimeout(
    'http://localhost:11434/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
    },
    12000
  );

  if (!response.ok) {
    throw new Error('AI unavailable offline');
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const text = normalizeAssistantText(payload);
  if (!text) {
    throw new Error('AI unavailable offline');
  }

  return text;
}

async function requestCloudCompletion(messages: ChatMessage[]): Promise<string> {
  const cloudUrl =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_ENTITY_CLOUD_CHAT_URL
      ? String(import.meta.env.VITE_ENTITY_CLOUD_CHAT_URL)
      : '/api/chat/completions';

  const response = await fetchWithTimeout(
    cloudUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_CLOUD_MODEL,
        stream: false,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
    },
    12000
  );

  if (!response.ok) {
    throw new Error('Cloud AI unavailable');
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const text = normalizeAssistantText(payload);
  if (!text) {
    throw new Error('Cloud AI unavailable');
  }

  return text;
}

export default function OfflineAwareChat({ isOffline }: OfflineAwareChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const activeEngine: ChatEngine = isOffline ? 'local' : 'cloud';
  const engineLabel = useMemo(
    () => (activeEngine === 'local' ? 'Local AI (Ollama)' : 'Cloud AI'),
    [activeEngine]
  );

  useEffect(() => {
    let cancelled = false;
    readOfflineMetaPayload<{ messages?: ChatMessage[] }>(CHAT_HISTORY_KEY)
      .then((entry) => {
        if (cancelled || !entry?.payload) {
          return;
        }
        const stored = Array.isArray(entry.payload.messages) ? entry.payload.messages : [];
        setMessages(
          stored
            .filter((item): item is ChatMessage => {
              return (
                typeof item.id === 'string' &&
                (item.role === 'user' || item.role === 'assistant' || item.role === 'system') &&
                typeof item.content === 'string' &&
                typeof item.createdAt === 'string' &&
                (item.engine === 'cloud' || item.engine === 'local')
              );
            })
            .slice(-MAX_MESSAGES)
        );
      })
      .catch(() => {
        // Ignore cached chat load failures.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void cacheOfflineMetaPayload(CHAT_HISTORY_KEY, { messages: trimMessages(messages) });
  }, [messages]);

  const submitPrompt = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (loading) {
        return;
      }

      const text = draft.trim();
      if (!text) {
        return;
      }

      setDraft('');
      setStatus(null);

      const userMessage: ChatMessage = {
        id: createMessageId(),
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
        engine: activeEngine,
      };

      const nextMessages = trimMessages([...messages, userMessage]);
      setMessages(nextMessages);
      setLoading(true);

      try {
        const assistantContent =
          activeEngine === 'local'
            ? await requestLocalCompletion(nextMessages)
            : await requestCloudCompletion(nextMessages);

        const assistantMessage: ChatMessage = {
          id: createMessageId(),
          role: 'assistant',
          content: assistantContent,
          createdAt: new Date().toISOString(),
          engine: activeEngine,
        };

        setMessages((current) => trimMessages([...current, assistantMessage]));
      } catch (error) {
        const message = toErrorMessage(
          error,
          activeEngine === 'local' ? 'AI unavailable offline' : 'Cloud AI unavailable'
        );
        setStatus(message);

        if (activeEngine === 'local') {
          const unavailableMessage: ChatMessage = {
            id: createMessageId(),
            role: 'system',
            content: 'AI unavailable offline',
            createdAt: new Date().toISOString(),
            engine: 'local',
          };
          setMessages((current) => trimMessages([...current, unavailableMessage]));
        }
      } finally {
        setLoading(false);
      }
    },
    [activeEngine, draft, loading, messages]
  );

  return (
    <div className="mc-shell-card border border-[var(--border-secondary)] p-4 md:col-span-3">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-[var(--text-primary)]">Assistant Chat</div>
        <div className="text-[11px] text-[var(--text-muted)]">{engineLabel}</div>
      </div>
      <div className="mb-3 text-xs text-[var(--text-muted)]">
        {activeEngine === 'local'
          ? 'Offline mode sends prompts to Ollama at http://localhost:11434.'
          : 'Online mode sends prompts to the configured cloud endpoint.'}
      </div>

      <div className="mb-3 max-h-56 overflow-auto rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2">
        {messages.length === 0 ? (
          <div className="text-xs text-[var(--text-muted)]">No messages yet.</div>
        ) : (
          <div className="space-y-2">
            {messages.map((message) => (
              <div key={message.id} className="rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1.5">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {message.role} · {message.engine === 'local' ? 'Local AI (Ollama)' : 'Cloud AI'}
                </div>
                <div className="whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{message.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={submitPrompt} className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask a question..."
          rows={2}
          className="mc-shell-input min-h-[56px] flex-1 resize-y px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading || !draft.trim()}
          className={`mc-shell-btn mc-shell-btn-active px-3 py-2 text-xs font-medium text-[var(--text-primary)] ${
            loading || !draft.trim() ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          {loading ? 'Sending…' : 'Send'}
        </button>
      </form>

      {status && <div className="mt-2 text-xs text-[var(--error)]">{status}</div>}
    </div>
  );
}
