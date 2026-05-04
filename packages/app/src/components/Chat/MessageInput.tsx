import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CHAT_AGENT_OPTIONS,
  CHAT_ALL_AGENTS_ID,
  useChat,
  type ChatChannel,
  type ChatModelOption,
} from '../../hooks/useChat';

interface MessageInputProps {
  channel: ChatChannel;
  selectedAgentId: string;
  selectedModelId: string;
  onSelectAgent: (agentId: string) => void;
  onSelectModel: (modelId: string) => void;
  onSend: (content: string, targetAgentId: string, modelId?: string) => Promise<void>;
  statusText: string;
  placeholder?: string;
  compact?: boolean;
  sendLabel?: string;
}

function getAgentLabel(agentId: string): string {
  if (agentId === CHAT_ALL_AGENTS_ID) {
    return 'All Agents';
  }

  const normalized = agentId.trim().toLowerCase();
  const found = CHAT_AGENT_OPTIONS.find((agent) => agent.id === normalized);
  if (!found) {
    return normalized || 'Agent';
  }
  return `${found.name} ${found.emoji}`;
}

function isOfflineStatus(statusText: string): boolean {
  return statusText.trim().toLowerCase().startsWith('offline');
}

export default function MessageInput({
  channel,
  selectedAgentId,
  selectedModelId,
  onSelectAgent,
  onSelectModel,
  onSend,
  statusText,
  placeholder = 'Message channel...',
  compact = false,
  sendLabel = 'Send',
}: MessageInputProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<'auto' | 'direct' | 'review'>('auto');
  const [autoRoute, setAutoRoute] = useState(true);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [threadMemory, setThreadMemory] = useState(false);
  const settingsModalRef = useRef<HTMLDivElement | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);

  const availableAgents = useMemo(() => {
    const deduped: Array<{ id: string; name: string; emoji: string }> = [];
    const seen = new Set<string>();

    for (const agent of CHAT_AGENT_OPTIONS) {
      if (seen.has(agent.id)) {
        continue;
      }
      seen.add(agent.id);
      deduped.push(agent);
    }

    return deduped;
  }, []);

  const storeModels = useChat((s) => s.modelOptions);
  const modelsLoading = useChat((s) => s.modelOptionsLoading);
  const models = storeModels;

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    const closeOnOutsidePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (settingsModalRef.current?.contains(target) || settingsTriggerRef.current?.contains(target)) {
        return;
      }

      setSettingsOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsidePointer);
    document.addEventListener('touchstart', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      document.removeEventListener('touchstart', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [settingsOpen]);

  const { cloudModels, localModels } = useMemo(() => {
    const cloud: ChatModelOption[] = [];
    const local: ChatModelOption[] = [];

    for (const model of models) {
      if (model.isLocal) {
        local.push(model);
      } else {
        cloud.push(model);
      }
    }

    return { cloudModels: cloud, localModels: local };
  }, [models]);

  const sendDraft = async () => {
    const content = draft.trim();
    if (!content || sending) {
      return;
    }

    setSending(true);
    setDraft('');
    const releaseSendLock = window.setTimeout(() => setSending(false), 900);
    const modelId = selectedModelId.trim();
    void onSend(content, selectedAgentId || CHAT_ALL_AGENTS_ID, modelId || undefined).finally(() => {
      window.clearTimeout(releaseSendLock);
      setSending(false);
    });
  };
  const offline = isOfflineStatus(statusText);
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const modelLabel = selectedModel?.name ?? (selectedModelId.trim() || (modelsLoading ? 'Loading models' : 'Auto'));
  const routeLabel = `${getAgentLabel(selectedAgentId)} · ${modelLabel}`;

  return (
    <div className="relative border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3">
      {settingsOpen && (
        <>
          <button
            type="button"
            aria-label="Close chat routing settings"
            className="fixed inset-0 z-30 cursor-default bg-transparent"
            onClick={() => setSettingsOpen(false)}
          />
          <div
            ref={settingsModalRef}
            className="absolute bottom-[3.25rem] left-6 z-40 w-[min(36rem,calc(100%-3rem))]"
            role="dialog"
            aria-modal="false"
            aria-label="Chat routing settings"
          >
            <div className="grid w-full max-w-xl overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-2xl shadow-black/50 md:grid-cols-[1fr_1fr]">
            <div className="space-y-3 border-b border-[var(--border-primary)] p-4 md:border-b-0 md:border-r">
              <label className="block text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Agent
                <select
                  value={selectedAgentId}
                  onChange={(event) => onSelectAgent(event.target.value)}
                  className="mc-shell-input mt-1 w-full px-3 py-2 text-sm"
                  aria-label="Select chat agent"
                >
                  <option value={CHAT_ALL_AGENTS_ID}>All Agents</option>
                  {availableAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} {agent.emoji}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Model
                <select
                  value={selectedModelId}
                  onChange={(event) => onSelectModel(event.target.value)}
                  className="mc-shell-input mt-1 w-full px-3 py-2 text-sm"
                  aria-label="Select chat model"
                >
                  <option value="">{modelsLoading ? 'Auto (loading agent models...)' : 'Auto'}</option>
                  {cloudModels.length > 0 && (
                    <optgroup label="Cloud Models">
                      {cloudModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name} · {model.source ?? model.provider}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {localModels.length > 0 && (
                    <optgroup label="Local Models">
                      {localModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name} · local
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              <label className="block text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Mode
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as typeof mode)}
                  className="mc-shell-input mt-1 w-full px-3 py-2 text-sm"
                  aria-label="Select chat mode"
                >
                  <option value="auto">Auto</option>
                  <option value="direct">Direct</option>
                  <option value="review">Review</option>
                </select>
              </label>
            </div>
            <div className="space-y-4 p-4 text-sm text-[var(--text-secondary)]">
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Routing</div>
                <button
                  type="button"
                  onClick={() => setAutoRoute((value) => !value)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left"
                >
                  <span>Auto route</span>
                  <span className={`relative h-5 w-9 rounded-full transition-colors ${autoRoute ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${autoRoute ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </span>
                </button>
              </div>
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Tools</div>
                <button
                  type="button"
                  onClick={() => setToolsEnabled((value) => !value)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left"
                >
                  <span>Enable tools</span>
                  <span className={`relative h-5 w-9 rounded-full transition-colors ${toolsEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${toolsEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </span>
                </button>
              </div>
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Memory</div>
                <button
                  type="button"
                  onClick={() => setThreadMemory((value) => !value)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left"
                >
                  <span>Thread memory</span>
                  <span className={`relative h-5 w-9 rounded-full transition-colors ${threadMemory ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${threadMemory ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </span>
                </button>
              </div>
            </div>
            </div>
          </div>
        </>
      )}

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 shadow-inner shadow-black/10">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendDraft();
              }
            }}
            rows={compact ? 2 : 3}
            placeholder={placeholder}
            className="min-h-[58px] flex-1 resize-y rounded-md border-0 bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <button
            type="button"
            className="mc-shell-btn mb-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full px-0 py-0 text-lg"
            aria-label="Add attachment"
            title="Add"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => {
              void sendDraft();
            }}
            disabled={sending || !draft.trim()}
            className={`mc-shell-btn mc-shell-btn-active min-h-[38px] px-3 py-2 text-xs font-medium text-[var(--text-primary)] ${
              sending || !draft.trim() ? 'cursor-not-allowed opacity-60' : ''
            }`}
            title={`Send to ${getAgentLabel(selectedAgentId)}`}
          >
            {sending ? 'Sending...' : sendLabel}
          </button>
        </div>
        <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 ${compact ? 'text-[10px]' : 'text-xs'}`}>
          <button
            ref={settingsTriggerRef}
            type="button"
            onClick={() => setSettingsOpen((value) => !value)}
            className={`mc-shell-btn inline-flex max-w-full items-center gap-1 rounded-full px-3 py-1.5 text-[11px] text-[var(--text-primary)] ${
              settingsOpen ? 'relative z-50' : ''
            }`}
            aria-expanded={settingsOpen}
            aria-label="Open chat routing settings"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${offline ? 'bg-[var(--text-muted)]' : 'bg-[var(--accent)]'}`} />
            <span className="truncate">{routeLabel}</span>
            <span aria-hidden="true">⌄</span>
          </button>
          <span className="truncate text-[11px] text-[var(--text-muted)]" title={statusText}>
            {statusText}
          </span>
        </div>
      </div>
    </div>
  );
}
