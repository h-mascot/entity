import { useEffect, useMemo, useState } from 'react';
import { getFileAgentFilterOptions } from '../lib/agentRegistry';
import { useUserProfile } from '../lib/userProfile';
import { useFileSources } from '../hooks/useFileSources';
import type { FileSource, UnifiedSearchResult } from '../types/filesystem';

interface UnifiedFileDashboardProps {
  apiBase?: string;
  enabled?: boolean;
  onOpen: (sourceId: string, path: string) => void;
}

export default function UnifiedFileDashboard({ apiBase = '', enabled = true, onOpen }: UnifiedFileDashboardProps) {
  const { sources, searchFiles } = useFileSources({ apiBase, enabled });
  const [userProfile] = useUserProfile();
  const [query, setQuery] = useState('');
  const [sourceId, setSourceId] = useState('all');
  const [type, setType] = useState('all');
  const [origin, setOrigin] = useState('all');
  const [agent, setAgent] = useState('all');
  const [results, setResults] = useState<UnifiedSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceOptions = useMemo(() => ['all', ...sources.map((source) => source.id)], [sources]);
  const sourceLabelById = useMemo(() => {
    const map = new Map<string, FileSource>();
    for (const source of sources) {
      map.set(source.id, source);
    }
    return map;
  }, [sources]);
  const activeSourceTabs = useMemo(() => sourceOptions.slice(0, 6), [sourceOptions]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const payload = await searchFiles(query, {
          sourceId: sourceId !== 'all' ? sourceId : undefined,
          type: type !== 'all' ? type : undefined,
          origin: origin !== 'all' ? origin : undefined,
          agent: agent !== 'all' ? agent : undefined,
          limit: 40,
        });
        setResults(payload.results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to search files.');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [agent, enabled, origin, query, searchFiles, sourceId, type]);

  if (!enabled) {
    return null;
  }

  const formatResultDate = (result: UnifiedSearchResult) => {
    const dateValue = (result as UnifiedSearchResult & { modifiedAt?: string; updatedAt?: string }).modifiedAt ??
      (result as UnifiedSearchResult & { updatedAt?: string }).updatedAt;
    if (!dateValue) return '';
    const parsed = Date.parse(dateValue);
    if (Number.isNaN(parsed)) return dateValue;
    return new Date(parsed).toISOString().slice(0, 10);
  };

  const resultIcon = (result: UnifiedSearchResult) => {
    const typeLabel = result.type.toLowerCase();
    if (typeLabel.includes('script')) return '>_';
    if (typeLabel.includes('review')) return '▦';
    if (typeLabel.includes('doc') || typeLabel.includes('prd')) return '▤';
    if (typeLabel.includes('blog')) return '✎';
    return '□';
  };

  return (
    <div className="entity-ops-surface flex h-full w-full flex-col gap-3 overflow-hidden p-4">
      <div className="shrink-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="entity-ops-section-title">Files</div>
            <h1 className="entity-ops-title mt-1 text-xl">Unified File Dashboard</h1>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {loading ? 'Searching...' : `${results.length} result${results.length === 1 ? '' : 's'}`}
          </div>
        </div>
      </div>

      <div className="entity-ops-panel-strong shrink-0 p-3">
        <div className="grid gap-2 xl:grid-cols-[minmax(280px,1fr)_220px_170px_170px_170px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files..."
            className="mc-shell-input min-h-9 px-3 py-2 text-sm"
          />
          <select value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="mc-shell-input min-h-9 px-3 py-2 text-sm">
            {sourceOptions.map((option) => (
              <option key={option} value={option}>
                {option === 'all' ? 'All sources' : sourceLabelById.get(option)?.displayName ?? option}
              </option>
            ))}
          </select>
          <select value={type} onChange={(event) => setType(event.target.value)} className="mc-shell-input min-h-9 px-3 py-2 text-sm">
            <option value="all">All types</option>
            <option value="daily-review">Daily Review</option>
            <option value="business-review">Business Review</option>
            <option value="blog">Blog</option>
            <option value="prd">PRD</option>
            <option value="project-doc">Project Doc</option>
            <option value="script">Script</option>
            <option value="one-off">One-off</option>
          </select>
          <select value={origin} onChange={(event) => setOrigin(event.target.value)} className="mc-shell-input min-h-9 px-3 py-2 text-sm">
            <option value="all">All origins</option>
            <option value="cron">Crons</option>
            <option value="task">Tasks</option>
            <option value="manual">Manual</option>
            <option value="unknown">Unknown</option>
          </select>
          <select value={agent} onChange={(event) => setAgent(event.target.value)} className="mc-shell-input min-h-9 px-3 py-2 text-sm">
            <option value="all">All agents</option>
            {getFileAgentFilterOptions().map((agentOption) => (
              <option key={agentOption.id} value={agentOption.id}>{agentOption.name}</option>
            ))}
            <option value={userProfile.handle}>{userProfile.displayName}</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {activeSourceTabs.map((option) => {
              const active = sourceId === option || (option === 'all' && sourceId === 'all');
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSourceId(option)}
                  className={`rounded-md border px-3 py-1.5 text-xs transition ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {option === 'all' ? 'All sources' : sourceLabelById.get(option)?.displayName ?? option}
                </button>
              );
            })}
          </div>
          <button type="button" className="entity-ops-icon-btn entity-ops-focus" aria-label="File filter settings" title="File filter settings">
            ⌘
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && <div className="text-xs text-[var(--text-muted)]">Searching files...</div>}
        {error && <div className="text-xs text-[var(--error)]">{error}</div>}
        {!loading && !error && results.length === 0 && (
          <div className="entity-ops-empty text-sm">No files found. Adjust filters or query.</div>
        )}
        <div className="space-y-2">
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() => onOpen(result.sourceId, result.path)}
              className="entity-ops-row entity-ops-focus grid w-full grid-cols-[42px_minmax(0,1fr)_150px_32px] gap-3 p-3 text-left"
              aria-label={`Open ${result.title}`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-secondary)] bg-[var(--surface-accent)] font-mono text-xs text-[var(--accent)]">
                {resultIcon(result)}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{result.title}</div>
                  <span className="entity-ops-chip">{result.origin || 'unknown'}</span>
                </div>
                <div className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
                  {result.sourceName} • {result.path} • {result.type} • {result.agent}
                </div>
                {result.preview && (
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">{result.preview}</div>
                )}
              </div>
              <div className="hidden min-w-0 self-center text-right text-xs text-[var(--text-muted)] md:block">
                <div>{formatResultDate(result)}</div>
                <div className="mt-1 truncate">{result.type} • {result.agent}</div>
              </div>
              <div className="self-center text-lg text-[var(--text-muted)]" aria-hidden="true">
                ›
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
