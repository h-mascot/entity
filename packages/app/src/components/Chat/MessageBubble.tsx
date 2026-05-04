import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { formatRelativeTime } from '../../lib/chat-store';
import type { ChatMessage } from '../../hooks/useChat';
import { resolveAgentAvatarUrl, resolveAgentDisplayName } from '../../lib/agentRegistry';
import { useUserProfile, type UserProfile } from '../../lib/userProfile';

function ReplyIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M20 11.5a7 7 0 0 1-7 7H8.5L4 21v-4.75A6.97 6.97 0 0 1 6 4.5h7a7 7 0 0 1 7 7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function shortModelName(model: string): string {
  const parts = model.split('/');
  const name = parts[parts.length - 1];
  const aliases: Record<string, string> = {
    'claude-opus-4-6': 'Opus',
    'claude-opus-4-5': 'Opus 4.5',
    'claude-sonnet-4-6': 'Sonnet',
    'claude-sonnet-4-5': 'Sonnet 4.5',
    'gpt-5.3-codex': 'Codex',
    'gemini-3-pro-preview': 'Gemini Pro',
    'gemini-3-flash-preview': 'Gemini Flash',
    'glm-5': 'GLM-5',
    'glm-4.7': 'GLM-4.7',
    'grok-3': 'Grok 3',
    'grok-3-fast': 'Grok 3 Fast',
    'kimi-for-coding': 'Kimi',
    'MiniMax-M2.5': 'MiniMax',
  };
  return aliases[name] || name;
}

interface MessageBubbleProps {
  message: ChatMessage;
  threadCount?: number;
  onOpenThread?: (messageId: string) => void;
  isGrouped?: boolean;
}

function senderLabel(sender: string, userProfile: UserProfile): string {
  if (sender === 'user') return userProfile.displayName;
  return resolveAgentDisplayName(sender);
}

function statusLabel(status: ChatMessage['status']): string {
  if (status === 'sending') return 'Sending';
  if (status === 'offline-queued') return 'Queued offline';
  if (status === 'error') return 'Failed';
  return '';
}

function AvatarImg({ sender, emoji, userProfile }: { sender: string; emoji?: string; userProfile: UserProfile }) {
  const src = sender === 'user' ? userProfile.avatarUrl : resolveAgentAvatarUrl(sender);
  const label = senderLabel(sender, userProfile);
  if (src) {
    return (
      <img
        src={src}
        alt={label}
        className="h-8 w-8 rounded-full object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
          (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
        }}
      />
    );
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-sm">
      {emoji || '🤖'}
    </div>
  );
}

export default function MessageBubble({ message, threadCount = 0, onOpenThread, isGrouped = false }: MessageBubbleProps) {
  const [userProfile] = useUserProfile();
  const isUser = message.sender === 'user';
  const timestamp = formatRelativeTime(message.timestamp);
  const status = isUser ? statusLabel(message.status) : '';

  return (
    <div
      className={`group relative flex gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--bg-secondary)]/70 ${
        isGrouped ? 'mt-0.5' : 'mt-2'
      }`}
    >
      {/* Avatar column */}
      <div className="w-8 shrink-0 pt-0.5">
        {!isGrouped && <AvatarImg sender={message.sender} emoji={message.senderEmoji} userProfile={userProfile} />}
      </div>

      {/* Content column */}
      <div className="min-w-0 flex-1">
        {!isGrouped && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {senderLabel(message.sender, userProfile)}
            </span>
            {message.model && (
              <span className="rounded-full border border-[var(--border-secondary)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--text-muted)]">
                {shortModelName(message.model)}
              </span>
            )}
            {message.isLocal && (
              <span className="rounded-full border border-[var(--border-secondary)] bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--text-muted)]">
                Local
              </span>
            )}
            <span className="text-[11px] text-[var(--text-muted)]">{timestamp}</span>
            {status && (
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${
                  message.status === 'error'
                    ? 'border-[var(--error)]/60 bg-[var(--surface-error)] text-[var(--error)]'
                    : 'border-[var(--border-secondary)] bg-[var(--surface-muted)] text-[var(--text-muted)]'
                }`}
              >
                {status}
              </span>
            )}
          </div>
        )}

        <div className="prose prose-invert prose-sm max-w-none text-[var(--text-secondary)] prose-p:my-0.5 prose-ul:my-0.5 prose-ol:my-0.5 [&_a]:text-[var(--accent)] [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded [&_pre]:border [&_pre]:border-[var(--border-primary)] [&_pre]:bg-black/45 [&_pre]:p-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Thread indicator */}
        {!message.threadId && onOpenThread && (
          <button
            type="button"
            onClick={() => onOpenThread(message.id)}
            className={`mt-0.5 inline-flex items-center gap-1 rounded-full border border-transparent py-0 text-[11px] leading-none text-[var(--accent)] transition-colors hover:border-[var(--accent)]/35 hover:bg-[var(--surface-accent)] ${
              threadCount > 0 ? 'px-1.5' : 'h-5 w-5 justify-center px-0'
            }`}
            aria-label={threadCount > 0 ? `Open thread with ${threadCount} replies` : 'Open thread'}
            title={threadCount > 0 ? `Open thread with ${threadCount} replies` : 'Open thread'}
          >
            <ReplyIcon />
            {threadCount > 0 ? <span>{threadCount}</span> : null}
          </button>
        )}
      </div>

      {/* Hover action bar */}
      {!message.threadId && onOpenThread && (
        <div className="absolute -top-2 right-2 hidden rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-md group-hover:flex">
          <button
            type="button"
            onClick={() => onOpenThread(message.id)}
            className="inline-flex h-7 w-7 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title={threadCount > 0 ? `Thread (${threadCount})` : 'Open thread'}
            aria-label={threadCount > 0 ? `Open thread with ${threadCount} replies` : 'Open thread'}
          >
            <ReplyIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
