import { useEffect, useMemo, useRef, useState } from 'react';
import { getFileAgentFilterOptions } from '../lib/agentRegistry';
import { FILE_SORT_OPTIONS, sortSearchResults, type FileResultSort } from '../lib/fileSearchSort';
import { sourceCanUpload } from '../lib/sourceAvailability';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http';
import {
  normalizeUploadTeamSelection,
  uploadScopeNeedsSelection,
  UPLOAD_ORG_WIDE_SCOPE,
  buildUploadScopeOptions,
  type UploadTeamOption,
} from '../lib/uploadScope';
import { useUserProfile } from '../lib/userProfile';
import { buildUnifiedFileSearchIdentity, isUnifiedFileSearchCurrent } from '../lib/unifiedFileSearch.ts';
import { resolveLegacyFileOrgSelection } from '../lib/legacyFileScope';
import { useFileSources } from '../hooks/useFileSources';
import type { FileSource, UnifiedSearchResult } from '../types/filesystem';

interface UnifiedFileDashboardProps {
  apiBase?: string;
  enabled?: boolean;
  onOpen: (sourceId: string, path: string, orgId?: string) => void;
  browserOrgId?: string | null;
  onBrowserOrgChange?: (orgId: string | null) => void;
}

interface UploadOrgOption {
  id: string;
  name: string;
}

export default function UnifiedFileDashboard({
  apiBase = '',
  enabled = true,
  onOpen,
  browserOrgId,
  onBrowserOrgChange,
}: UnifiedFileDashboardProps) {
  const { sources, searchFiles, uploadFile } = useFileSources({ apiBase, enabled });
  const [userProfile] = useUserProfile();
  const [query, setQuery] = useState('');
  const [sourceId, setSourceId] = useState('all');
  const [type, setType] = useState('all');
  const [origin, setOrigin] = useState('all');
  const [agent, setAgent] = useState('all');
  const [sort, setSort] = useState<FileResultSort>('relevance');
  const [results, setResults] = useState<UnifiedSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  const [uploadOrgs, setUploadOrgs] = useState<UploadOrgOption[]>([]);
  const [uploadOrgId, setUploadOrgId] = useState(() => browserOrgId?.trim() || '');
  const [uploadTeams, setUploadTeams] = useState<UploadTeamOption[]>([]);
  const [uploadTeamId, setUploadTeamId] = useState('');
  const [uploadOrgsLoading, setUploadOrgsLoading] = useState(false);
  const [uploadTeamsLoading, setUploadTeamsLoading] = useState(false);
  const [uploadScopeError, setUploadScopeError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchRequestIdRef = useRef(0);
  const browserOrgIdRef = useRef(browserOrgId);
  browserOrgIdRef.current = browserOrgId;
  const [resultsIdentity, setResultsIdentity] = useState<string | null>(null);

  const sourceOptions = useMemo(() => ['all', ...sources.map((source) => source.id)], [sources]);
  const sourceLabelById = useMemo(() => {
    const map = new Map<string, FileSource>();
    for (const source of sources) {
      map.set(source.id, source);
    }
    return map;
  }, [sources]);
  const writableSources = useMemo(() => sources.filter(sourceCanUpload), [sources]);
  const activeSourceTabs = useMemo(() => sourceOptions.slice(0, 6), [sourceOptions]);
  const searchIdentity = useMemo(() => buildUnifiedFileSearchIdentity({
    query,
    orgId: uploadOrgId || undefined,
    sourceId,
    type,
    origin,
    agent,
    refreshNonce: searchNonce,
  }), [agent, origin, query, searchNonce, sourceId, type, uploadOrgId]);
  const currentSearchIdentityRef = useRef(searchIdentity);
  currentSearchIdentityRef.current = searchIdentity;
  const sortedResults = useMemo(
    () => sortSearchResults(resultsIdentity === searchIdentity ? results : [], sort),
    [results, resultsIdentity, searchIdentity, sort],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setUploadOrgsLoading(true);
    setUploadScopeError(null);
    void requestJsonWithFallback<{ orgs?: UploadOrgOption[] }>({
      urls: buildApiCandidates('/orgs', apiBase),
      fallbackError: 'Failed to load upload organizations.',
    }).then((payload) => {
      if (cancelled) return;
      const nextOrgs = Array.isArray(payload.orgs) ? payload.orgs : [];
      setUploadOrgs(nextOrgs);
      const nextOrgId = resolveLegacyFileOrgSelection(
        browserOrgIdRef.current ?? uploadOrgId,
        nextOrgs.map((org) => org.id),
      ) ?? '';
      setUploadOrgId(nextOrgId);
      onBrowserOrgChange?.(nextOrgId || null);
      if (nextOrgs.length === 0) {
        setUploadScopeError('No organizations are available for file access.');
      }
    }).catch((err) => {
      if (!cancelled) {
        setUploadScopeError(toErrorMessage(err, 'Failed to load upload organizations.'));
        setUploadOrgs([]);
        setUploadOrgId('');
      }
    }).finally(() => {
      if (!cancelled) setUploadOrgsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, enabled, onBrowserOrgChange]);

  useEffect(() => {
    if (browserOrgId === undefined) return;
    const nextOrgId = browserOrgId?.trim() || '';
    setUploadOrgId((current) => current === nextOrgId ? current : nextOrgId);
  }, [browserOrgId]);

  useEffect(() => {
    if (!enabled || !uploadOrgId) {
      setUploadTeams([]);
      setUploadTeamId('');
      return;
    }
    let cancelled = false;
    setUploadTeamsLoading(true);
    setUploadScopeError(null);
    void requestJsonWithFallback<{ teams?: UploadTeamOption[] }>({
      urls: buildApiCandidates(`/orgs/${encodeURIComponent(uploadOrgId)}/teams`, apiBase),
      fallbackError: 'Failed to load upload teams.',
    }).then((payload) => {
      if (cancelled) return;
      const nextTeams = Array.isArray(payload.teams) ? payload.teams : [];
      setUploadTeams(nextTeams);
      setUploadTeamId((current) => normalizeUploadTeamSelection(current, nextTeams));
    }).catch((err) => {
      if (!cancelled) {
        setUploadScopeError(toErrorMessage(err, 'Failed to load upload teams.'));
        setUploadTeams([]);
        setUploadTeamId('');
      }
    }).finally(() => {
      if (!cancelled) setUploadTeamsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, enabled, uploadOrgId]);

  const uploadNeedsScopeChoice = uploadScopeNeedsSelection(uploadOrgs.length, uploadOrgId, uploadTeams, uploadTeamId);
  const uploadScopeBlocked = uploadOrgsLoading || uploadTeamsLoading || Boolean(uploadScopeError) || uploadNeedsScopeChoice;
  const fileSearchScopeBlocked = uploadOrgsLoading || !uploadOrgId;

  useEffect(() => {
    const requestId = ++searchRequestIdRef.current;
    if (!enabled || fileSearchScopeBlocked) {
      setLoading(false);
      setError(!enabled || uploadOrgsLoading ? null : uploadScopeError ?? 'Choose an organization before searching.');
      setResults([]);
      setResultsIdentity(null);
      return;
    }

    // Clear prior-scope results immediately, so a pending request cannot make
    // files from the previous organization/filter selectable in the new one.
    setLoading(true);
    setError(null);
    setResults([]);
    setResultsIdentity(null);
    const timer = window.setTimeout(async () => {
      try {
        const payload = await searchFiles(query, {
          orgId: uploadOrgId || undefined,
          sourceId: sourceId !== 'all' ? sourceId : undefined,
          type: type !== 'all' ? type : undefined,
          origin: origin !== 'all' ? origin : undefined,
          agent: agent !== 'all' ? agent : undefined,
          limit: 40,
        });
        if (!isUnifiedFileSearchCurrent(requestId, searchRequestIdRef.current, searchIdentity, currentSearchIdentityRef.current)) return;
        setResults(payload.results);
        setResultsIdentity(searchIdentity);
      } catch (err) {
        if (!isUnifiedFileSearchCurrent(requestId, searchRequestIdRef.current, searchIdentity, currentSearchIdentityRef.current)) return;
        setError(err instanceof Error ? err.message : 'Failed to search files.');
        setResults([]);
      } finally {
        if (isUnifiedFileSearchCurrent(requestId, searchRequestIdRef.current, searchIdentity, currentSearchIdentityRef.current)) {
          setLoading(false);
        }
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [agent, enabled, fileSearchScopeBlocked, origin, query, searchFiles, searchNonce, sourceId, type, uploadOrgId, uploadOrgsLoading, uploadScopeError]);

  const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (uploadScopeError) {
      setUploadNotice(uploadScopeError);
      return;
    }
    if (uploadNeedsScopeChoice) {
      setUploadNotice(uploadOrgs.length > 1 && !uploadOrgId
        ? 'Choose an organization before uploading.'
        : 'Choose a team or organization-wide scope before uploading.');
      return;
    }
    const selected = sourceId !== 'all' ? sourceLabelById.get(sourceId) : undefined;
    if (selected && !sourceCanUpload(selected)) {
      setUploadNotice('The selected file source is read-only.');
      return;
    }
    const targetSourceId = selected?.id ?? writableSources[0]?.id;
    if (!targetSourceId) {
      setUploadNotice('No writable file source available.');
      return;
    }
    setUploading(true);
    setUploadNotice(null);
    try {
      const uploadOptions = buildUploadScopeOptions(uploadOrgId, uploadTeamId);
      const uploaded = await uploadFile(targetSourceId, file, uploadOptions);
      setUploadNotice(`Uploaded ${uploaded.displayName} → ${uploaded.path}${uploaded.teamId ? ` (team: ${uploaded.teamId})` : ''}`);
      setSearchNonce((value) => value + 1);
    } catch (err) {
      setUploadNotice(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  if (!enabled) {
    return null;
  }

  const formatResultDate = (result: UnifiedSearchResult) => {
    const dateValue = (result as UnifiedSearchResult & { modifiedAt?: string; updatedAt?: string }).modifiedAt ??
      (result as UnifiedSearchResult & { updatedAt?: string }).updatedAt;
    if (!dateValue) return '';
    const parsed = Date.parse(dateValue);
    if (Number.isNaN(parsed)) return dateValue;
    const date = new Date(parsed);
    // Local date + time so recent files are distinguishable within a day.
    const datePart = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const timePart = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return `${datePart} ${timePart}`;
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
      {/* Page title lives in the workspace top bar (Doc Hub chrome / mobile header). */}
      <div className="entity-ops-panel-strong shrink-0 p-3 max-md:border-transparent max-md:bg-transparent max-md:p-0">
        {/* Source selection lives in the tab row below — no duplicate dropdown here. */}
        <div className="grid gap-2 xl:grid-cols-[minmax(280px,1fr)_190px_190px_190px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files..."
            className="mc-shell-input min-h-9 px-3 py-2 text-sm max-md:w-full max-md:rounded-xl max-md:border-transparent max-md:bg-[var(--bg-secondary)] max-md:px-4 max-md:py-3 max-md:text-[15px] max-md:focus:border-[var(--accent)]"
          />
          <div className="md:contents max-md:flex max-md:gap-2 max-md:overflow-x-auto max-md:pb-1">
            <span className="relative md:contents max-md:inline-flex max-md:shrink-0">
              <select value={type} onChange={(event) => setType(event.target.value)} className="mc-shell-input min-h-9 px-3 py-2 text-sm max-md:w-auto max-md:shrink-0 max-md:appearance-none max-md:rounded-full max-md:border-transparent max-md:bg-[var(--bg-secondary)] max-md:px-3 max-md:pr-7 max-md:py-2 max-md:text-[13px]">
                <option value="all">All types</option>
                <option value="daily-review">Daily Review</option>
                <option value="business-review">Business Review</option>
                <option value="blog">Blog</option>
                <option value="prd">PRD</option>
                <option value="project-doc">Project Doc</option>
                <option value="script">Script</option>
                <option value="one-off">One-off</option>
              </select>
              <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 text-[10px] text-[var(--text-muted)] max-md:inline">▾</span>
            </span>
            <span className="relative md:contents max-md:inline-flex max-md:shrink-0">
              <select value={origin} onChange={(event) => setOrigin(event.target.value)} className="mc-shell-input min-h-9 px-3 py-2 text-sm max-md:w-auto max-md:shrink-0 max-md:appearance-none max-md:rounded-full max-md:border-transparent max-md:bg-[var(--bg-secondary)] max-md:px-3 max-md:pr-7 max-md:py-2 max-md:text-[13px]">
                <option value="all">All origins</option>
                <option value="cron">Crons</option>
                <option value="task">Tasks</option>
                <option value="manual">Manual</option>
                <option value="unknown">Unknown</option>
              </select>
              <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 text-[10px] text-[var(--text-muted)] max-md:inline">▾</span>
            </span>
            <span className="relative md:contents max-md:inline-flex max-md:shrink-0">
              <select value={agent} onChange={(event) => setAgent(event.target.value)} className="mc-shell-input min-h-9 px-3 py-2 text-sm max-md:w-auto max-md:shrink-0 max-md:appearance-none max-md:rounded-full max-md:border-transparent max-md:bg-[var(--bg-secondary)] max-md:px-3 max-md:pr-7 max-md:py-2 max-md:text-[13px]">
                <option value="all">All agents</option>
                {getFileAgentFilterOptions().map((agentOption) => (
                  <option key={agentOption.id} value={agentOption.id}>{agentOption.name}</option>
                ))}
                <option value={userProfile.handle}>{userProfile.displayName}</option>
                <option value="other">Other</option>
              </select>
              <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 text-[10px] text-[var(--text-muted)] max-md:inline">▾</span>
            </span>
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
          {(uploadOrgs.length > 1 || uploadTeams.length > 0 || uploadScopeError) && (
            <div className="flex w-full flex-wrap items-center gap-2 text-xs" aria-label="Upload scope">
              {uploadOrgs.length > 1 && (
                <label className="flex items-center gap-2 text-[var(--text-muted)]" htmlFor="file-upload-org">
                  Organization
                  <select
                    id="file-upload-org"
                    value={uploadOrgId}
                    onChange={(event) => {
                      const nextOrgId = event.target.value;
                      setUploadOrgId(nextOrgId);
                      onBrowserOrgChange?.(nextOrgId || null);
                      setUploadTeamId('');
                    }}
                    className="mc-shell-input min-h-9 px-2 py-1.5 text-xs"
                    disabled={uploadOrgsLoading}
                  >
                    <option value="">Choose organization…</option>
                    {uploadOrgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                  </select>
                </label>
              )}
              {uploadOrgId && uploadTeams.length > 0 && (
                <label className="flex items-center gap-2 text-[var(--text-muted)]" htmlFor="file-upload-team">
                  Upload scope
                  <select
                    id="file-upload-team"
                    value={uploadTeamId}
                    onChange={(event) => setUploadTeamId(event.target.value)}
                    className="mc-shell-input min-h-9 px-2 py-1.5 text-xs"
                    disabled={uploadTeamsLoading}
                  >
                    <option value="">Choose team…</option>
                    <option value={UPLOAD_ORG_WIDE_SCOPE}>Organization-wide (if permitted)</option>
                    {uploadTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                </label>
              )}
              <span className="text-[var(--text-muted)]">Uploads are checked against your contributor access.</span>
            </div>
          )}
          <div className="flex items-center gap-2 max-md:w-full">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUploadChange} aria-label="Upload file" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || uploadScopeBlocked || Boolean(sourceLabelById.get(sourceId) && !sourceCanUpload(sourceLabelById.get(sourceId)!)) || (sourceId === 'all' && writableSources.length === 0)}
              className="mc-shell-input min-h-9 px-3 py-1.5 text-xs max-md:flex-1 disabled:opacity-50"
              title="Upload a file to the selected source"
            >
              {uploading ? 'Uploading…' : '⬆ Upload'}
            </button>
            <span className="whitespace-nowrap text-xs text-[var(--text-muted)]">
              {loading ? 'Searching…' : `${sortedResults.length} result${sortedResults.length === 1 ? '' : 's'}`}
            </span>
            <span className="relative inline-flex max-md:flex-1">
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as FileResultSort)}
                aria-label="Sort results"
                title="Sort results"
                className="mc-shell-input min-h-9 px-3 py-1.5 pr-7 text-xs max-md:w-full max-md:appearance-none max-md:rounded-full max-md:border-transparent max-md:bg-[var(--bg-secondary)] max-md:py-2 max-md:text-[13px]"
              >
                {FILE_SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    Sort: {option.label}
                  </option>
                ))}
              </select>
              <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 text-[10px] text-[var(--text-muted)] max-md:inline">▾</span>
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {uploadNotice && <div className="mb-2 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-primary)]">{uploadNotice}</div>}
        {loading && <div className="text-xs text-[var(--text-muted)]">Searching files...</div>}
        {error && <div className="text-xs text-[var(--error)]">{error}</div>}
        {!loading && !error && sortedResults.length === 0 && (
          <div className="entity-ops-empty text-sm">No files found. Adjust filters or query.</div>
        )}
        <div className="space-y-2">
          {sortedResults.map((result) => {
            const restricted = isRestrictedResult(result);
            const safePreview = restricted ? null : result.preview ?? result.snippet ?? null;
            const resultTitle = restricted ? 'Restricted file' : result.title;
            // Type + agent render in the right-hand column; keep this line to
            // source + path so nothing appears twice.
            const metadata = restricted
              ? `${result.sourceName} • Access restricted • snippets and previews hidden`
              : `${result.sourceName} • ${result.path}${result.owner ? ` • Uploaded${result.owner.teamId ? ` · team ${result.owner.teamId}` : ''}${result.owner.ownerPrincipalId ? ` · by ${result.owner.ownerPrincipalId}` : ''}` : ''}`;

            return (
              <button
                key={result.id}
                type="button"
                onClick={() => {
                  if (!restricted) {
                    onOpen(result.sourceId, result.path, uploadOrgId || undefined);
                  }
                }}
                disabled={restricted}
                data-testid={restricted ? 'file-search-restricted-result' : undefined}
                className={`entity-ops-row entity-ops-focus grid w-full gap-3 p-3 text-left max-md:grid-cols-[40px_minmax(0,1fr)_auto] max-md:min-h-[56px] max-md:items-center max-md:rounded-2xl max-md:border-transparent max-md:bg-[var(--bg-tertiary)] max-md:px-4 max-md:py-3.5 max-md:active:opacity-80 md:grid-cols-[42px_minmax(0,1fr)_150px_32px] ${
                  restricted ? 'cursor-not-allowed opacity-80' : ''
                }`}
                aria-label={restricted ? 'Restricted file result' : `Open ${resultTitle}`}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-secondary)] bg-[var(--surface-accent)] font-mono text-xs text-[var(--accent)] max-md:border-transparent max-md:bg-[var(--bg-secondary)]">
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
