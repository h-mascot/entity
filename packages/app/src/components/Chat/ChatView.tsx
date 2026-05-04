import { useEffect, useMemo, useState } from 'react';
import {
  CHAT_ALL_AGENTS_ID,
  useChat,
  type ChatChannel,
  type ChatThread,
} from '../../hooks/useChat';
import ChannelView from './ChannelView';
import ChatSidebar from './ChatSidebar';
import { ChatOfflineProvider, useChatTransport } from './ChatOfflineProvider';
import ThreadPanel from './ThreadPanel';

function ChatViewContent() {
  const initialize = useChat((state) => state.initialize);
  const loading = useChat((state) => state.loading);
  const error = useChat((state) => state.error);
  const categories = useChat((state) => state.categories);
  const channels = useChat((state) => state.channels);
  const collapsedCategoryIds = useChat((state) => state.collapsedCategoryIds);
  const activeChannelId = useChat((state) => state.activeChannelId);
  const openThreadId = useChat((state) => state.openThreadId);
  const selectedAgentByChannel = useChat((state) => state.selectedAgentByChannel);
  const selectedModelByChannel = useChat((state) => state.selectedModelByChannel);
  const channelMessagesMap = useChat((state) => state.channelMessages);
  const channelThreadsMap = useChat((state) => state.channelThreads);
  const threadMessagesMap = useChat((state) => state.threadMessages);
  const typingByScope = useChat((state) => state.typingByScope);

  const refreshStructure = useChat((state) => state.refreshStructure);
  const selectChannel = useChat((state) => state.selectChannel);
  const toggleCategory = useChat((state) => state.toggleCategory);
  const createCategory = useChat((state) => state.createCategory);
  const createChannel = useChat((state) => state.createChannel);
  const saveChannel = useChat((state) => state.saveChannel);
  const removeChannel = useChat((state) => state.removeChannel);
  const openThreadFromMessage = useChat((state) => state.openThreadFromMessage);
  const closeThread = useChat((state) => state.closeThread);
  const setSelectedAgent = useChat((state) => state.setSelectedAgent);
  const setSelectedModel = useChat((state) => state.setSelectedModel);

  const { sendMessage } = useChatTransport();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const activeChannel = useMemo<ChatChannel | null>(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels]
  );

  const activeChannelMessages = activeChannel ? channelMessagesMap[activeChannel.id] ?? [] : [];
  const activeChannelThreads = activeChannel ? channelThreadsMap[activeChannel.id] ?? [] : [];

  const activeThread = useMemo<ChatThread | null>(() => {
    if (!openThreadId) {
      return null;
    }
    return activeChannelThreads.find((thread) => thread.id === openThreadId) ?? null;
  }, [activeChannelThreads, openThreadId]);

  const threadMessages = activeThread ? threadMessagesMap[activeThread.id] ?? [] : [];
  const threadParentMessage = activeThread
    ? activeChannelMessages.find((message) => message.id === activeThread.parentMessageId) ?? null
    : null;

  const selectedAgentId = activeChannel
    ? selectedAgentByChannel[activeChannel.id] ?? CHAT_ALL_AGENTS_ID
    : CHAT_ALL_AGENTS_ID;
  const selectedModelId = activeChannel ? selectedModelByChannel[activeChannel.id] ?? '' : '';

  const channelTyping = activeChannel ? typingByScope[activeChannel.id] ?? [] : [];
  const threadTyping = activeThread ? typingByScope[activeThread.id] ?? [] : [];

  if (loading && channels.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)] px-4">
        <div className="mc-shell-card w-full max-w-sm px-5 py-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">Loading chat</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            Fetching channels, threads, and queued messages.
          </div>
        </div>
      </div>
    );
  }

  if (error && channels.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)] px-4">
        <div className="w-full max-w-md rounded-lg border border-[var(--error)]/60 bg-[var(--surface-error)] px-5 py-4">
          <div className="text-sm font-semibold text-[var(--error)]">Chat unavailable</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-[var(--bg-primary)]">
      <div className={`hidden h-full shrink-0 md:block ${sidebarCollapsed ? 'w-12' : 'w-72'}`}>
        <ChatSidebar
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          categories={categories}
          channels={channels}
          collapsedCategoryIds={collapsedCategoryIds}
          activeChannelId={activeChannelId}
          onToggleCategory={toggleCategory}
          onSelectChannel={(channelId) => {
            void selectChannel(channelId);
          }}
          onCreateCategory={(input) => {
            void createCategory(input);
          }}
          onCreateChannel={(input) => {
            void createChannel(input);
          }}
          onEditChannel={(channelId, patch) => {
            void saveChannel(channelId, patch);
          }}
          onDeleteChannel={(channelId) => {
            void removeChannel(channelId);
          }}
        />
      </div>

      {mobileSidebarOpen && (
        <div
          className="absolute inset-0 z-40 bg-[var(--overlay-strong)] md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        >
          <div
            className="absolute inset-y-0 left-0 w-72 max-w-[86vw]"
            onClick={(event) => event.stopPropagation()}
          >
            <ChatSidebar
              categories={categories}
              channels={channels}
              collapsedCategoryIds={collapsedCategoryIds}
              activeChannelId={activeChannelId}
              onToggleCategory={toggleCategory}
              onSelectChannel={(channelId) => {
                setMobileSidebarOpen(false);
                void selectChannel(channelId);
              }}
              onCreateCategory={(input) => {
                void createCategory(input);
              }}
              onCreateChannel={(input) => {
                void createChannel(input).then(() => {
                  setMobileSidebarOpen(false);
                });
              }}
              onEditChannel={(channelId, patch) => {
                void saveChannel(channelId, patch);
              }}
              onDeleteChannel={(channelId) => {
                void removeChannel(channelId);
                setMobileSidebarOpen(false);
              }}
            />
          </div>
        </div>
      )}

      <div className={`relative min-w-0 flex-1 ${activeThread ? 'md:pr-[28rem]' : ''}`}>
        <ChannelView
          channel={activeChannel}
          messages={activeChannelMessages}
          threads={activeChannelThreads}
          selectedAgentId={selectedAgentId}
          selectedModelId={selectedModelId}
          typingAgentIds={channelTyping}
          onSelectAgent={(agentId) => {
            if (!activeChannel) {
              return;
            }
            setSelectedAgent(activeChannel.id, agentId);
          }}
          onSelectModel={(modelId) => {
            if (!activeChannel) {
              return;
            }
            setSelectedModel(activeChannel.id, modelId);
          }}
          onSend={async (content, targetAgentId, modelId) => {
            if (!activeChannel) {
              return;
            }

            await sendMessage({
              channel: activeChannel,
              content,
              targetAgentId,
              modelId,
            });
            await refreshStructure();
          }}
          onOpenThread={(parentMessageId) => {
            void openThreadFromMessage(parentMessageId);
          }}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
        />

        <ThreadPanel
          open={Boolean(activeThread)}
          channel={activeChannel}
          thread={activeThread}
          parentMessage={threadParentMessage}
          messages={threadMessages}
          typingAgentIds={threadTyping}
          selectedAgentId={selectedAgentId}
          selectedModelId={selectedModelId}
          onSelectAgent={(agentId) => {
            if (!activeChannel) {
              return;
            }
            setSelectedAgent(activeChannel.id, agentId);
          }}
          onSelectModel={(modelId) => {
            if (!activeChannel) {
              return;
            }
            setSelectedModel(activeChannel.id, modelId);
          }}
          onSend={async (content, targetAgentId, modelId) => {
            if (!activeChannel || !activeThread) {
              return;
            }

            await sendMessage({
              channel: activeChannel,
              content,
              threadId: activeThread.id,
              parentMessageId: activeThread.parentMessageId,
              threadTitle: activeThread.title,
              targetAgentId,
              modelId,
            });
            await refreshStructure();
          }}
          onClose={closeThread}
        />
      </div>
    </div>
  );
}

export default function ChatView() {
  return (
    <ChatOfflineProvider>
      <ChatViewContent />
    </ChatOfflineProvider>
  );
}
