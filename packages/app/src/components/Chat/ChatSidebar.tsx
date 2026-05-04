import { useEffect, useMemo, useState } from 'react';
import { CHAT_AGENT_OPTIONS, type ChatCategory, type ChatChannel } from '../../hooks/useChat';

interface ChatSidebarProps {
  categories: ChatCategory[];
  channels: ChatChannel[];
  collapsedCategoryIds: string[];
  activeChannelId: string | null;
  onToggleCategory: (categoryId: string) => void;
  onSelectChannel: (channelId: string) => void;
  onCreateCategory: (input: { name: string; emoji?: string }) => void;
  onCreateChannel: (input: { categoryId: string; name: string; description?: string }) => void;
  onEditChannel: (
    channelId: string,
    patch: Partial<Pick<ChatChannel, 'name' | 'description' | 'agents'>>
  ) => void;
  onDeleteChannel: (channelId: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

function resolveAgentEmoji(agentId: string): string {
  const normalized = agentId.trim().toLowerCase();
  return CHAT_AGENT_OPTIONS.find((agent) => agent.id === normalized)?.emoji ?? '🤖';
}

function channelInitial(channelName: string): string {
  return channelName.trim()[0]?.toUpperCase() ?? '#';
}

type SidebarDialog =
  | { mode: 'create-category' }
  | { mode: 'create-channel'; category: ChatCategory }
  | { mode: 'edit-channel'; channel: ChatChannel }
  | { mode: 'agents-channel'; channel: ChatChannel }
  | { mode: 'delete-channel'; channel: ChatChannel };

export default function ChatSidebar({
  categories,
  channels,
  collapsedCategoryIds,
  activeChannelId,
  onToggleCategory,
  onSelectChannel,
  onCreateCategory,
  onCreateChannel,
  onEditChannel,
  onDeleteChannel,
  isCollapsed = false,
  onToggleCollapse,
}: ChatSidebarProps) {
  const [dialog, setDialog] = useState<SidebarDialog | null>(null);
  const [actionsChannelId, setActionsChannelId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [categoryEmoji, setCategoryEmoji] = useState('');
  const [channelName, setChannelName] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [channelAgents, setChannelAgents] = useState('');

  const collapsed = new Set(collapsedCategoryIds);
  const channelsByCategory: Record<string, ChatChannel[]> = {};

  for (const channel of channels) {
    if (!channelsByCategory[channel.categoryId]) {
      channelsByCategory[channel.categoryId] = [];
    }
    channelsByCategory[channel.categoryId].push(channel);
  }

  for (const categoryChannels of Object.values(channelsByCategory)) {
    categoryChannels.sort((left, right) => left.order - right.order);
  }

  useEffect(() => {
    setActionsChannelId(null);

    if (!dialog) {
      setCategoryName('');
      setCategoryEmoji('');
      setChannelName('');
      setChannelDescription('');
      setChannelAgents('');
      return;
    }

    if (dialog.mode === 'create-category') {
      setCategoryName('');
      setCategoryEmoji('');
      return;
    }

    if (dialog.mode === 'create-channel') {
      setChannelName('');
      setChannelDescription('');
      return;
    }

    if (dialog.mode === 'edit-channel') {
      setChannelName(dialog.channel.name);
      setChannelDescription(dialog.channel.description ?? '');
      return;
    }

    if (dialog.mode === 'agents-channel') {
      setChannelAgents(dialog.channel.agents.join(', '));
    }
  }, [dialog]);

  const dialogTitle = useMemo(() => {
    if (!dialog) {
      return '';
    }

    if (dialog.mode === 'create-category') {
      return 'Create category';
    }

    if (dialog.mode === 'create-channel') {
      return `Create channel in ${dialog.category.name}`;
    }

    if (dialog.mode === 'edit-channel') {
      return `Edit #${dialog.channel.name}`;
    }

    if (dialog.mode === 'agents-channel') {
      return `Agents for #${dialog.channel.name}`;
    }

    return `Delete #${dialog.channel.name}`;
  }, [dialog]);

  const closeDialog = () => {
    setDialog(null);
  };

  const submitDialog = () => {
    if (!dialog) {
      return;
    }

    if (dialog.mode === 'create-category') {
      const name = categoryName.trim();
      if (!name) {
        return;
      }
      onCreateCategory({ name, emoji: categoryEmoji.trim() || undefined });
      closeDialog();
      return;
    }

    if (dialog.mode === 'create-channel') {
      const name = channelName.trim();
      if (!name) {
        return;
      }
      onCreateChannel({
        categoryId: dialog.category.id,
        name,
        description: channelDescription.trim() || undefined,
      });
      closeDialog();
      return;
    }

    if (dialog.mode === 'edit-channel') {
      const name = channelName.trim();
      if (!name) {
        return;
      }
      onEditChannel(dialog.channel.id, {
        name,
        description: channelDescription.trim() || undefined,
      });
      closeDialog();
      return;
    }

    if (dialog.mode === 'agents-channel') {
      const agents = channelAgents
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
      onEditChannel(dialog.channel.id, { agents });
      closeDialog();
      return;
    }

    onDeleteChannel(dialog.channel.id);
    closeDialog();
  };

  const renderDialog = () => {
    if (!dialog) {
      return null;
    }

    const submitLabel = dialog.mode === 'delete-channel' ? 'Delete channel' : 'Save';
    const submitDisabled =
      dialog.mode === 'create-category'
        ? !categoryName.trim()
        : dialog.mode === 'create-channel' || dialog.mode === 'edit-channel'
          ? !channelName.trim()
          : false;

    return (
      <div
        className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--overlay-strong)] px-3"
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
      >
        <div className="w-full max-w-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">{dialogTitle}</div>
            <button
              type="button"
              onClick={closeDialog}
              className="mc-shell-btn px-2 py-1 text-xs"
              aria-label="Close chat dialog"
            >
              X
            </button>
          </div>

          {dialog.mode === 'delete-channel' ? (
            <div className="rounded-md border border-[var(--error)]/50 bg-[var(--surface-error)] px-3 py-2 text-sm text-[var(--text-secondary)]">
              Delete #{dialog.channel.name}? Messages and threads in this channel will be removed from the chat list.
            </div>
          ) : null}

          {dialog.mode === 'create-category' ? (
            <div className="space-y-3">
              <label className="block text-xs text-[var(--text-muted)]">
                Name
                <input
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  className="mc-shell-input mt-1 w-full px-3 py-2 text-sm"
                  autoFocus
                />
              </label>
              <label className="block text-xs text-[var(--text-muted)]">
                Emoji
                <input
                  value={categoryEmoji}
                  onChange={(event) => setCategoryEmoji(event.target.value)}
                  className="mc-shell-input mt-1 w-full px-3 py-2 text-sm"
                />
              </label>
            </div>
          ) : null}

          {dialog.mode === 'create-channel' || dialog.mode === 'edit-channel' ? (
            <div className="space-y-3">
              <label className="block text-xs text-[var(--text-muted)]">
                Name
                <input
                  value={channelName}
                  onChange={(event) => setChannelName(event.target.value)}
                  className="mc-shell-input mt-1 w-full px-3 py-2 text-sm"
                  autoFocus
                />
              </label>
              <label className="block text-xs text-[var(--text-muted)]">
                Description
                <textarea
                  value={channelDescription}
                  onChange={(event) => setChannelDescription(event.target.value)}
                  className="mc-shell-input mt-1 min-h-[72px] w-full resize-y px-3 py-2 text-sm"
                />
              </label>
            </div>
          ) : null}

          {dialog.mode === 'agents-channel' ? (
            <label className="block text-xs text-[var(--text-muted)]">
              Agent IDs
              <input
                value={channelAgents}
                onChange={(event) => setChannelAgents(event.target.value)}
                className="mc-shell-input mt-1 w-full px-3 py-2 text-sm"
                placeholder="ada, spock, book"
                autoFocus
              />
            </label>
          ) : null}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={closeDialog} className="mc-shell-btn px-3 py-2 text-xs">
              Cancel
            </button>
            <button
              type="button"
              onClick={submitDialog}
              disabled={submitDisabled}
              className={`mc-shell-btn px-3 py-2 text-xs ${
                dialog.mode === 'delete-channel'
                  ? 'border-[var(--error)]/60 bg-[var(--surface-error)] text-[var(--error)]'
                  : 'mc-shell-btn-active text-[var(--text-primary)]'
              } ${submitDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (isCollapsed) {
    return (
      <div className="flex h-full flex-col items-center overflow-hidden border-r border-[var(--border-primary)] bg-[var(--bg-secondary)] py-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="mc-shell-btn mb-2 inline-flex h-7 w-7 items-center justify-center px-0 py-0 text-sm"
          title="Expand sidebar"
        >
          »
        </button>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto">
          {channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => onSelectChannel(channel.id)}
              className={`flex h-8 w-8 items-center justify-center rounded-md border text-xs font-semibold ${
                activeChannelId === channel.id
                  ? 'border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
              }`}
              title={`#${channel.name}`}
            >
              {channelInitial(channel.name)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-[var(--border-primary)] bg-[var(--bg-secondary)]">
      <div className="flex items-center justify-between border-b border-[var(--border-primary)] px-3 py-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">Chat</div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">Mission Channels</div>
        </div>
        <button
          type="button"
          onClick={() => setDialog({ mode: 'create-category' })}
          className="mc-shell-btn inline-flex h-7 w-7 items-center justify-center px-0 py-0 text-sm"
          aria-label="Create category"
          title="Create category"
        >
          +
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-3">
        {categories.map((category) => {
          const isCollapsed = collapsed.has(category.id);
          const categoryChannels = channelsByCategory[category.id] ?? [];

          return (
            <div key={category.id} className="mb-4">
              <div className="mb-1.5 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onToggleCategory(category.id)}
                  className="flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1 text-left text-xs uppercase tracking-[0.08em] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <span>{isCollapsed ? '▸' : '▾'}</span>
                  <span className="truncate">
                    {category.emoji ? `${category.emoji} ` : ''}
                    {category.name}
                  </span>
                  <span className="ml-auto text-[10px] text-[var(--text-muted)]">{categoryChannels.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDialog({ mode: 'create-channel', category })}
                  className="mc-shell-btn inline-flex h-6 w-6 items-center justify-center px-0 py-0 text-xs"
                  aria-label={`Create channel in ${category.name}`}
                  title="Create channel"
                >
                  +
                </button>
              </div>

              {!isCollapsed && (
                <div className="space-y-1">
                  {categoryChannels.length === 0 ? (
                    <div className="rounded border border-dashed border-[var(--border-primary)] px-2 py-2 text-[11px] text-[var(--text-muted)]">
                      No channels yet.
                    </div>
                  ) : (
                    categoryChannels.map((channel) => {
                      const active = activeChannelId === channel.id;
                      const unreadLabel = (channel.unreadCount ?? 0) > 99 ? '99+' : String(channel.unreadCount ?? 0);

                      return (
                        <div
                          key={channel.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectChannel(channel.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onSelectChannel(channel.id);
                            }
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setActionsChannelId((current) => (current === channel.id ? null : channel.id));
                          }}
                          className={`group flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors ${
                            active
                              ? 'border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--text-primary)]'
                              : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
                          }`}
                          title={channel.description}
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--surface-muted)] text-xs font-semibold text-[var(--text-muted)]">
                            #
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{channel.name}</span>
                            {channel.description && (
                              <span className="block truncate text-[11px] text-[var(--text-muted)]">
                                {channel.description}
                              </span>
                            )}
                          </span>
                          <span className="hidden items-center gap-0.5 group-hover:flex sm:flex">
                            {channel.agents.slice(0, 3).map((agentId) => (
                              <span key={agentId} className="text-[11px]">
                                {resolveAgentEmoji(agentId)}
                              </span>
                            ))}
                          </span>
                          {(channel.unreadCount ?? 0) > 0 && (
                            <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                              {unreadLabel}
                            </span>
                          )}
                          <span className="relative">
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(event) => {
                                event.stopPropagation();
                                setActionsChannelId((current) => (current === channel.id ? null : channel.id));
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setActionsChannelId((current) => (current === channel.id ? null : channel.id));
                                }
                              }}
                              className="mc-shell-btn inline-flex h-6 w-6 items-center justify-center px-0 py-0 text-xs opacity-80 hover:opacity-100"
                              aria-label={`Channel actions for ${channel.name}`}
                            >
                              ...
                            </span>
                            {actionsChannelId === channel.id && (
                              <span className="absolute right-0 top-7 z-40 flex w-32 flex-col rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] p-1 shadow-xl">
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDialog({ mode: 'edit-channel', channel });
                                  }}
                                  className="rounded px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                                >
                                  Edit
                                </span>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDialog({ mode: 'agents-channel', channel });
                                  }}
                                  className="rounded px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                                >
                                  Agents
                                </span>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDialog({ mode: 'delete-channel', channel });
                                  }}
                                  className="rounded px-2 py-1 text-xs text-[var(--error)] hover:bg-[var(--surface-error)]"
                                >
                                  Delete
                                </span>
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {onToggleCollapse && (
        <div className="border-t border-[var(--border-primary)] px-2 py-1.5">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="mc-shell-btn flex w-full items-center justify-center gap-1 px-2 py-1 text-xs text-[var(--text-muted)]"
            title="Collapse sidebar"
          >
            « Collapse
          </button>
        </div>
      )}
      {renderDialog()}
    </div>
  );
}
