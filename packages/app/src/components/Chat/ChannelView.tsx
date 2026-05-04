import { useEffect, useMemo, useRef } from 'react';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import { CHAT_AGENT_OPTIONS, type ChatChannel, type ChatMessage, type ChatThread } from '../../hooks/useChat';
import { useChatTransport } from './ChatOfflineProvider';

interface ChannelViewProps {
  channel: ChatChannel | null;
  messages: ChatMessage[];
  threads: ChatThread[];
  selectedAgentId: string;
  selectedModelId: string;
  typingAgentIds: string[];
  onSelectAgent: (agentId: string) => void;
  onSelectModel: (modelId: string) => void;
  onSend: (content: string, targetAgentId: string, modelId?: string) => Promise<void>;
  onOpenThread: (parentMessageId: string) => void;
  onOpenSidebar?: () => void;
}

function agentName(agentId: string): string {
  const normalized = agentId.trim().toLowerCase();
  const found = CHAT_AGENT_OPTIONS.find((agent) => agent.id === normalized);
  if (found) {
    return found.name;
  }
  return normalized || 'Agent';
}

function agentEmoji(agentId: string): string {
  const normalized = agentId.trim().toLowerCase();
  return CHAT_AGENT_OPTIONS.find((agent) => agent.id === normalized)?.emoji ?? '🤖';
}

export default function ChannelView({
  channel,
  messages,
  threads,
  selectedAgentId,
  typingAgentIds,
  onSelectAgent,
  selectedModelId,
  onSelectModel,
  onSend,
  onOpenThread,
  onOpenSidebar,
}: ChannelViewProps) {
  const { cloudAvailable, localModel, statusLabel } = useChatTransport();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const threadCountByParent = useMemo(() => {
    const map = new Map<string, number>();
    for (const thread of threads) {
      map.set(thread.parentMessageId, thread.messageCount ?? 0);
    }
    return map;
  }, [threads]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  if (!channel) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)] px-4">
        <div className="mc-shell-card w-full max-w-sm px-5 py-4 text-center">
          <div className="text-sm font-semibold text-[var(--text-primary)]">No channel selected</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            Pick a channel from the sidebar to view messages.
          </div>
        </div>
      </div>
    );
  }

  const typingLabel = typingAgentIds.length > 0
    ? `${typingAgentIds.map(agentName).join(', ')} thinking...`
    : null;
  const transportText = cloudAvailable ? 'Cloud online' : `Local fallback - ${localModel}`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3">
        {onOpenSidebar && (
          <button
            type="button"
            onClick={onOpenSidebar}
            className="mc-shell-btn px-2 py-1 text-xs md:hidden"
            aria-label="Open chat sidebar"
          >
            ☰
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[var(--text-muted)]">#</span>
            <div className="truncate text-base font-semibold text-[var(--text-primary)]">{channel.name}</div>
          </div>
          <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
            {channel.description || 'Channel conversation'}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${
              cloudAvailable
                ? 'border-[var(--accent)]/60 bg-[var(--surface-accent)] text-[var(--text-primary)]'
                : 'border-[var(--border-secondary)] bg-[var(--surface-muted)] text-[var(--text-muted)]'
            }`}
            title={transportText}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${cloudAvailable ? 'bg-[var(--accent)]' : 'bg-[var(--text-muted)]'}`} />
            {transportText}
          </span>
          {channel.agents.slice(0, 4).map((agentId) => (
            <span
              key={agentId}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs"
              title={agentName(agentId)}
            >
              {agentEmoji(agentId)}
            </span>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="mx-auto mt-8 max-w-lg rounded-lg border border-dashed border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-5 py-5 text-center">
            <div className="text-sm font-semibold text-[var(--text-primary)]">Start #{channel.name}</div>
            <div className="mt-1 text-sm text-[var(--text-muted)]">
              Messages, replies, and offline queued sends will appear here.
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((message, index) => {
              const prev = index > 0 ? messages[index - 1] : null;
              const isGrouped = prev !== null && prev.sender === message.sender &&
                new Date(message.timestamp).getTime() - new Date(prev.timestamp).getTime() < 5 * 60 * 1000;
              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  threadCount={threadCountByParent.get(message.id) ?? 0}
                  onOpenThread={onOpenThread}
                  isGrouped={isGrouped}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="min-h-5 px-4 pb-1 text-xs text-[var(--text-muted)]">
        {typingLabel ?? '\u00a0'}
      </div>

      <MessageInput
        channel={channel}
        selectedAgentId={selectedAgentId}
        onSelectAgent={onSelectAgent}
        selectedModelId={selectedModelId}
        onSelectModel={onSelectModel}
        onSend={onSend}
        statusText={statusLabel(selectedAgentId, selectedModelId)}
      />
    </div>
  );
}
