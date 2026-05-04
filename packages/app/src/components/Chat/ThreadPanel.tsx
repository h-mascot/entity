import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import { useChatTransport } from './ChatOfflineProvider';
import type { ChatChannel, ChatMessage, ChatThread } from '../../hooks/useChat';

interface ThreadPanelProps {
  open: boolean;
  channel: ChatChannel | null;
  thread: ChatThread | null;
  parentMessage: ChatMessage | null;
  messages: ChatMessage[];
  typingAgentIds: string[];
  selectedAgentId: string;
  selectedModelId: string;
  onSelectAgent: (agentId: string) => void;
  onSelectModel: (modelId: string) => void;
  onSend: (content: string, targetAgentId: string, modelId?: string) => Promise<void>;
  onClose: () => void;
}

export default function ThreadPanel({
  open,
  channel,
  thread,
  parentMessage,
  messages,
  typingAgentIds,
  selectedAgentId,
  selectedModelId,
  onSelectAgent,
  onSelectModel,
  onSend,
  onClose,
}: ThreadPanelProps) {
  const { cloudAvailable, statusLabel } = useChatTransport();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const node = scrollRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [messages.length, open]);

  return (
    <aside
      className={`absolute inset-y-0 right-0 z-30 flex w-full max-w-[28rem] flex-col border-l border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-2xl shadow-black/30 transition-transform duration-300 ease-out md:w-[28rem] ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-primary)] px-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">Thread</div>
            <span
              className={`h-1.5 w-1.5 rounded-full ${cloudAvailable ? 'bg-[var(--accent)]' : 'bg-[var(--text-muted)]'}`}
              title={cloudAvailable ? 'Cloud online' : 'Using local fallback'}
            />
          </div>
          <div className="truncate text-xs text-[var(--text-muted)]">
            {thread?.title || 'Message thread'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mc-shell-btn px-2 py-1 text-xs"
          aria-label="Close thread"
        >
          X
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {parentMessage && (
          <div className="mb-4 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2">
            <div className="mb-1.5 px-1 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Parent message
            </div>
            <MessageBubble message={parentMessage} />
          </div>
        )}

        <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Replies</div>
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-secondary)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-muted)]">
            No replies yet. Use the composer below to keep this discussion attached to the parent message.
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}
      </div>

      <div className="min-h-5 px-4 pb-1 text-xs text-[var(--text-muted)]">
        {typingAgentIds.length > 0 ? 'Agents thinking...' : '\u00a0'}
      </div>

      {channel && thread ? (
        <MessageInput
          channel={channel}
          selectedAgentId={selectedAgentId}
          selectedModelId={selectedModelId}
          onSelectAgent={onSelectAgent}
          onSelectModel={onSelectModel}
          onSend={onSend}
          statusText={statusLabel(selectedAgentId, selectedModelId)}
          placeholder="Reply in thread..."
          compact
          sendLabel="Reply"
        />
      ) : null}
    </aside>
  );
}
