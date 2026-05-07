import type { DocumentAuthorshipActor, DocumentAuthorshipStats } from '../../types/collaboration';

interface AuthorshipStatsPanelProps {
  stats: DocumentAuthorshipStats;
  selectedAuthor: DocumentAuthorshipActor;
  onSelectAuthor: (author: DocumentAuthorshipActor) => void;
}

const AUTHOR_ROWS: ReadonlyArray<{
  id: DocumentAuthorshipActor;
  label: string;
  color: string;
}> = [
  { id: 'human', label: 'Human', color: '#f3f4f6' },
  { id: 'assistant', label: 'Assistant', color: '#a855f7' },
];

function getAuthorPercent(stats: DocumentAuthorshipStats, author: DocumentAuthorshipActor): number {
  // Use dynamic lookup for agents, static for human
  if (author === 'human') return stats.human;
  const agentKey = author as keyof DocumentAuthorshipStats;
  return typeof stats[agentKey] === 'number' ? (stats[agentKey] as number) : 0;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.max(0, value).toFixed(1).replace(/\.0$/, '')}%`;
}

export default function AuthorshipStatsPanel({ stats, selectedAuthor, onSelectAuthor }: AuthorshipStatsPanelProps) {
  return (
    <div className="mc-shell-card border border-[var(--border-primary)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Authorship</div>
        <div className="text-[11px] text-[var(--text-secondary)]">Reviewed {formatPercent(stats.reviewedPercent)}</div>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {AUTHOR_ROWS.map((author) => {
          const percent = getAuthorPercent(stats, author.id);
          return (
            <div key={author.id} className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-2 py-1.5">
              <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: author.color }} aria-hidden="true" />
                  {author.label}
                </span>
                <span>{formatPercent(percent)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 border-t border-[var(--border-primary)] pt-2">
        <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Manual Attribution</div>
        <div className="flex flex-wrap gap-1.5">
          {AUTHOR_ROWS.map((author) => {
            const selected = author.id === selectedAuthor;
            return (
              <button
                key={author.id}
                type="button"
                onClick={() => onSelectAuthor(author.id)}
                className={`mc-shell-btn px-2 py-1 text-[11px] ${
                  selected ? 'mc-shell-btn-active border-[var(--accent)] text-[var(--text-primary)]' : ''
                }`}
              >
                {author.label}
              </button>
            );
          })}
        </div>
        <div className="mt-1 text-[10px] text-[var(--text-muted)]">Shortcut: Cmd/Ctrl+Shift+M on selected text</div>
      </div>
    </div>
  );
}
