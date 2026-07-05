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

  const isRestrictedResult = (result: UnifiedSearchResult) => {
    const permissionState = result.permissionState ?? result.permission_state ?? result.entity_permission_state ?? 'visible';
    return result.restricted === true || result.placeholder === true || permissionState !== 'visible';
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

      <div className="entity-ops-panel-strong shrink-0 p-3 max-md:border-transparent max-md:bg-transparent max-md:p-0">
        <div className="grid gap-2 xl:grid-cols-[minmax(280px,1fr)_220px_170px_170px_170px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files..."
            className="mc-shell-input min-h-9 px-3 py-2 text-sm max-md:w-full max-md:rounded-xl max-md:border-transparent max-md:bg-[var(--bg-secondary)] max-md:px-4 max-md:py-3 max-md:text-[15px] max-md:focus:border-[var(--accent)]"
          />
          <div className="md:contents max-md:flex max-md:gap-2 max-md:overflow-x-auto max-md:pb-1">
            <select value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="mc-shell-input min-h-9 px-3 py-2 text-sm max-md:w-auto max-md:shrink-0 max-md:rounded-full max-md:border-transparent max-md:bg-[var(--bg-secondary)] max-md:px-3 max-md:py-2 max-md:text-[13px]">
              {sourceOptions.map((option) => (
                <option key={option} value={option}>
                  {option === 'all' ? 'All sources' : sourceLabelById.get(option)?.displayName ?? option}
                </option>
              ))}
            </select>
            <select value={type} onChange={(event) => setType(event.target.value)} className="mc-shell-input min-h-9 px-3 py-2 text-sm max-md:w-auto max-md:shrink-0 max-md:rounded-full max-md:border-transparent max-md:bg-[var(--bg-secondary)] max-md:px-3 max-md:py-2 max-md:text-[13px]">
              <option value="all">All types</option>
              <option value="daily-review">Daily Review</option>
              <option value="business-review">Business Review</option>
              <option value="blog">Blog</option>
              <option value="prd">PRD</option>
              <option value="project-doc">Project Doc</option>
              <option value="script">Script</option>
              <option value="one-off">One-off</option>
            </select>
            <select value={origin} onChange={(event) => setOrigin(event.target.value)} className="mc-shell-input min-h-9 px-3 py-2 text-sm max-md:w-auto max-md:shrink-0 max-md:rounded-full max-md:border-transparent max-md:bg-[var(--bg-secondary)] max-md:px-3 max-md:py-2 max-md:text-[13px]">
              <option value="all">All origins</option>
              <option value="cron">Crons</option>
              <option value="task">Tasks</option>
              <option value="manual">Manual</option>
              <option value="unknown">Unknown</option>
            </select>
            <select value={agent} onChange={(event) => setAgent(event.target.value)} className="mc-shell-input min-h-9 px-3 py-2 text-sm max-md:w-auto max-md:shrink-0 max-md:rounded-full max-md:border-transparent max-md:bg-[var(--bg-secondary)] max-md:px-3 max-md:py-2 max-md:text-[13px]">
              <option value="all">All agents</option>
              {getFileAgentFilterOptions().map((agentOption) => (
                <option key={agentOption.id} value={agentOption.id}>{agentOption.name}</option>
              ))}
              <option value={userProfile.handle}>{userProfile.displayName}</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5 max-md:flex-nowrap max-md:overflow-x-auto max-md:pb-1">
            {activeSourceTabs.map((option) => {
              const active = sourceId === option || (option === 'all' && sourceId === 'all');
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSourceId(option)}
                  className={`rounded-md border px-3 py-1.5 text-xs transition max-md:shrink-0 max-md:whitespace-nowrap max-md:rounded-full ${
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
          {results.map((result) => {
            const restricted = isRestrictedResult(result);
            const safePreview = restricted ? null : result.preview ?? result.snippet ?? null;
            const resultTitle = restricted ? 'Restricted file' : result.title;
            const metadata = restricted
              ? `${result.sourceName} • Access restricted • snippets and previews hidden`
              : `${result.sourceName} • ${result.path} • ${result.type} • ${result.agent}`;

            return (
              <button
                key={result.id}
                type="button"
                onClick={() => {
                  if (!restricted) {
                    onOpen(result.sourceId, result.path);
                  }
                }}
                disabled={restricted}
                data-testid={restricted ? 'file-search-restricted-result' : undefined}
                className={`entity-ops-row entity-ops-focus grid w-full gap-3 p-3 text-left max-md:grid-cols-[40px_minmax(0,1fr)_auto] max-md:min-h-[56px] max-md:items-center max-md:rounded-2xl max-md:border-transparent max-md:bg-[var(--bg-secondary)] max-md:px-4 max-md:py-3.5 max-md:active:opacity-80 md:grid-cols-[42px_minmax(0,1fr)_150px_32px] ${
                  restricted ? 'cursor-not-allowed opacity-80' : ''
                }`}
                aria-label={restricted ? 'Restricted file result' : `Open ${resultTitle}`}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-secondary)] bg-[var(--surface-accent)] font-mono text-xs text-[var(--accent)] max-md:border-transparent max-md:bg-[var(--bg-tertiary)]">
                  {restricted ? '••' : resultIcon(result)}
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)] max-md:text-[15px] max-md:font-medium">{resultTitle}</div>
                    <span className="entity-ops-chip max-md:hidden">{restricted ? 'restricted' : result.origin || 'unknown'}</span>
                  </div>
                  <div className="mt-0.5 hidden truncate text-xs text-[var(--text-muted)] max-md:block">
                    {restricted
                      ? 'Access restricted'
                      : [formatResultDate(result), result.sourceName, result.type].filter(Boolean).join(' · ')}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-[var(--text-muted)] max-md:hidden">
                    {metadata}
                  </div>
                  {restricted ? (
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)] max-md:hidden">
                      Restricted by Entity permissions. Snippets and previews are hidden.
                    </div>
                  ) : safePreview ? (
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)] max-md:hidden">{safePreview}</div>
                  ) : null}
                </div>
                <div className="hidden min-w-0 self-center text-right text-xs text-[var(--text-muted)] md:block">
                  <div>{formatResultDate(result)}</div>
                  <div className="mt-1 truncate">{restricted ? 'Restricted' : `${result.type} • ${result.agent}`}</div>
                </div>
                <div className="self-center text-lg text-[var(--text-muted)]" aria-hidden="true">
                  {restricted ? '!' : '›'}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
