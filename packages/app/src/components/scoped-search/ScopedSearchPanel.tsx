/**
 * THE-904 / SRCH-A-05 — scoped search entry panel for Doc Hub and Workplane.
 * THE-905 / SRCH-A-06 — empty/degraded kind attributes for proof pack.
 */

import { useEffect, useId, useState } from 'react';
import {
  buildScopedSearchViewModel,
  DEFAULT_SCOPED_SEARCH_ORG_ID,
  fetchScopedSearch,
  objectTypesForSurface,
  ScopedSearchRequestError,
  scopedSearchEmptyKind,
  type ScopedSearchSurface,
  type ScopedSearchViewModel,
} from '../../lib/scopedSearch.ts';

export interface ScopedSearchPanelProps {
  surface: ScopedSearchSurface;
  apiBase?: string;
  orgId?: string;
  /** Optional controlled open state; defaults to open. */
  open?: boolean;
  title?: string;
  placeholder?: string;
  initialQuery?: string;
  onNavigate?: (route: string) => void;
  /** Optional fetch override for tests. */
  searchFn?: typeof fetchScopedSearch;
}

function statusTone(status: ScopedSearchViewModel['status']): string {
  switch (status) {
    case 'degraded':
      return 'text-[var(--warning,#b45309)]';
    case 'failed':
    case 'error':
      return 'text-[var(--error)]';
    case 'empty':
      return 'text-[var(--text-muted)]';
    default:
      return 'text-[var(--text-secondary)]';
  }
}

export default function ScopedSearchPanel({
  surface,
  apiBase = '',
  orgId = DEFAULT_SCOPED_SEARCH_ORG_ID,
  open = true,
  title,
  placeholder,
  initialQuery = '',
  onNavigate,
  searchFn = fetchScopedSearch,
}: ScopedSearchPanelProps) {
  const inputId = useId();
  const objectTypes = objectTypesForSurface(surface);
  const [query, setQuery] = useState(initialQuery);
  const [view, setView] = useState<ScopedSearchViewModel>(() =>
    buildScopedSearchViewModel({ query: initialQuery }),
  );

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setView(buildScopedSearchViewModel({ query: '' }));
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setView(buildScopedSearchViewModel({ query: trimmed, loading: true }));
      void searchFn({
        q: trimmed,
        orgId,
        objectTypes,
        apiBase,
        limit: 20,
        signal: controller.signal,
      })
        .then(({ envelope, httpStatus }) => {
          if (controller.signal.aborted) return;
          setView(
            buildScopedSearchViewModel({
              query: trimmed,
              envelope,
              httpStatus,
            }),
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message =
            error instanceof ScopedSearchRequestError
              ? error.message
              : error instanceof Error
                ? error.message
                : 'Scoped search failed.';
          setView(
            buildScopedSearchViewModel({
              query: trimmed,
              errorMessage: message,
              httpStatus: error instanceof ScopedSearchRequestError ? error.status ?? null : null,
            }),
          );
        });
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [apiBase, objectTypes, open, orgId, query, searchFn]);

  if (!open) return null;

  const heading =
    title
    ?? (surface === 'workplane' ? 'Workplane scoped search' : 'Doc Hub scoped search');
  const inputPlaceholder =
    placeholder
    ?? (surface === 'workplane'
      ? 'Search tasks and proof artifacts…'
      : 'Search docs, files, and external refs…');

  return (
    <section
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3"
      data-testid="scoped-search-panel"
      data-scoped-search-surface={surface}
      data-scoped-search-status={view.status}
      data-scoped-search-health={view.healthState ?? 'none'}
      data-scoped-search-partial={view.partial ? 'true' : 'false'}
      aria-label={heading}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{heading}</h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Permission-safe scoped search · {objectTypes.join(', ')}
          </p>
        </div>
        <span
          className={`text-xs font-medium ${statusTone(view.status)}`}
          data-testid="scoped-search-status-label"
        >
          {view.headline}
        </span>
      </div>

      <label className="block" htmlFor={inputId}>
        <span className="sr-only">Scoped search query</span>
        <input
          id={inputId}
          data-testid="scoped-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={inputPlaceholder}
          className="mc-shell-input min-h-9 w-full px-3 py-2 text-sm"
          autoComplete="off"
        />
      </label>

      {view.detail ? (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            view.status === 'degraded' || view.status === 'failed' || view.status === 'error'
              ? 'border-[var(--warning,#b45309)]/40 bg-[var(--warning,#b45309)]/10 text-[var(--text-primary)]'
              : 'border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
          }`}
          data-testid="scoped-search-state-detail"
          data-scoped-search-empty-kind={scopedSearchEmptyKind(view)}
        >
          {view.detail}
          {view.reasons.length > 0 && view.status !== 'degraded' && view.status !== 'failed' ? (
            <div className="mt-1 text-[var(--text-muted)]">{view.reasons.join(' · ')}</div>
          ) : null}
        </div>
      ) : null}

      {view.backends.length > 0 ? (
        <ul
          className="flex flex-wrap gap-1.5"
          data-testid="scoped-search-backends"
          aria-label="Search backend health"
        >
          {view.backends.map((backend) => (
            <li
              key={backend.name}
              className="rounded-full border border-[var(--border-secondary)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
              data-backend-name={backend.name}
              data-backend-state={backend.state}
            >
              {backend.name}: {backend.state}
              {typeof backend.lagSeconds === 'number' ? ` · lag ${backend.lagSeconds}s` : ''}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto" data-testid="scoped-search-results">
        {view.status === 'loading' ? (
          <div className="text-xs text-[var(--text-muted)]">Searching…</div>
        ) : null}
        {view.results.length === 0 && view.status !== 'loading' && view.status !== 'idle' ? (
          <div className="entity-ops-empty text-sm" data-testid="scoped-search-empty">
            {view.status === 'failed'
              ? 'No results because every requested backend failed.'
              : view.status === 'degraded'
                ? 'No visible matches while search is degraded or unknown.'
                : view.status === 'empty'
                  ? 'No visible matches for this healthy query.'
                  : 'No results.'}
          </div>
        ) : null}
        <ul className="space-y-2">
          {view.results.map((result) => (
            <li key={result.key}>
              <button
                type="button"
                data-testid={
                  result.restricted
                    ? 'scoped-search-restricted-result'
                    : 'scoped-search-result'
                }
                data-object-type={result.objectType}
                data-restricted={result.restricted ? 'true' : 'false'}
                disabled={result.restricted || !result.deepLinkRoute}
                onClick={() => {
                  if (!result.restricted && result.deepLinkRoute) {
                    onNavigate?.(result.deepLinkRoute);
                  }
                }}
                className={`entity-ops-row entity-ops-focus grid w-full gap-2 p-3 text-left ${
                  result.restricted ? 'cursor-not-allowed opacity-80' : ''
                }`}
                aria-label={result.restricted ? 'Restricted search result' : `Open ${result.title}`}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {result.title}
                  </div>
                  {result.metaLine ? (
                    <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                      {result.metaLine}
                    </div>
                  ) : null}
                  {result.snippet ? (
                    <div className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">
                      {result.snippet}
                    </div>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
