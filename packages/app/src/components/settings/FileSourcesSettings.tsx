import { useMemo, useState } from 'react';
import { toErrorMessage } from '../../lib/http';
import { useFileSources } from '../../hooks/useFileSources';
import type { FileSource } from '../../types/filesystem';

interface FileSourcesSettingsProps {
  apiBase?: string;
  enabled?: boolean;
}

interface SourceFormState {
  displayName: string;
  type: FileSource['type'];
  baseUrl: string;
  basePath: string;
  manifestPath: string;
  authType: FileSource['authType'];
  authRef: string;
  icon: string;
}

const INITIAL_FORM: SourceFormState = {
  displayName: '',
  type: 'local',
  baseUrl: '',
  basePath: '',
  manifestPath: '',
  authType: 'none',
  authRef: '',
  icon: '',
};

const TYPE_LABELS: Record<FileSource['type'], string> = {
  local: 'Local folder',
  docsify: 'Docsify site',
  'http-markdown': 'HTTP markdown',
  github: 'GitHub repository',
  s3: 'S3 bucket (connector not shipped yet)',
  custom: 'Custom (connector not shipped yet)',
};

const TYPES_WITH_LIVE_ADAPTER: readonly FileSource['type'][] = ['local', 'docsify', 'http-markdown', 'github'];

const TYPE_HELP: Record<FileSource['type'], string> = {
  local: 'Server-visible absolute folder path.',
  docsify: 'Base URL of a docsify site; Entity fetches _sidebar.md.',
  'http-markdown': 'Base URL serving markdown files. Optional manifest enables search.',
  github: 'Repository URL like https://github.com/owner/repo. Private repos need a token.',
  s3: 'No live connector yet: Test reports degraded and this source cannot be browsed.',
  custom: 'No live connector yet: Test reports degraded and this source cannot be browsed.',
};

function typeHasLiveAdapter(type: FileSource['type']): boolean {
  return TYPES_WITH_LIVE_ADAPTER.includes(type);
}

function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function FileSourcesSettings({ apiBase = '', enabled = true }: FileSourcesSettingsProps) {
  const { sources, loading, error, createSource, updateSource, deleteSource, setSourceEnabled, testSource, syncSource, reloadSources } = useFileSources({
    apiBase,
    enabled,
  });
  const [form, setForm] = useState<SourceFormState>(INITIAL_FORM);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [testFeedback, setTestFeedback] = useState<Record<string, string>>({});

  const needsBaseUrl = form.type !== 'local';
  const needsBasePath = form.type === 'local';
  const needsAuth = form.type === 'github';

  const canSubmit = useMemo(() => {
    if (!form.displayName.trim()) return false;
    if (needsBasePath && !form.basePath.trim()) return false;
    if (needsBaseUrl && !form.baseUrl.trim()) return false;
    if (needsAuth && form.authType === 'bearer' && !form.authRef.trim()) return false;
    return true;
  }, [form.authRef, form.authType, form.basePath, form.baseUrl, form.displayName, needsAuth, needsBaseUrl, needsBasePath]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    try {
      await createSource({
        displayName: form.displayName.trim(),
        type: form.type,
        baseUrl: form.baseUrl.trim() || undefined,
        basePath: form.basePath.trim() || undefined,
        manifestPath: form.type === 'http-markdown' ? form.manifestPath.trim() || undefined : undefined,
        authType: needsAuth && form.authType !== 'none' ? form.authType : undefined,
        authRef: needsAuth && form.authType !== 'none' ? form.authRef.trim() || undefined : undefined,
        icon: form.icon.trim() || undefined,
      });
      setForm(INITIAL_FORM);
    } catch (err) {
      setLocalError(toErrorMessage(err, 'Failed to create source.'));
    }
  };

  const handleToggle = async (source: FileSource) => {
    setBusyId(source.id);
    setLocalError(null);
    try {
      await setSourceEnabled(source.id, !source.enabled);
    } catch (err) {
      setLocalError(toErrorMessage(err, 'Failed to toggle source.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (source: FileSource) => {
    setBusyId(source.id);
    setLocalError(null);
    try {
      await deleteSource(source.id);
    } catch (err) {
      setLocalError(toErrorMessage(err, 'Failed to delete source.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleEdit = async (source: FileSource) => {
    const nextDisplayName = window.prompt('Edit source display name', source.displayName);
    if (nextDisplayName === null) {
      return;
    }

    const trimmed = nextDisplayName.trim();
    if (!trimmed) {
      setLocalError('Display name cannot be empty.');
      return;
    }

    setBusyId(source.id);
    setLocalError(null);
    try {
      await updateSource(source.id, { displayName: trimmed });
    } catch (err) {
      setLocalError(toErrorMessage(err, 'Failed to update source.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleTest = async (source: FileSource) => {
    setBusyId(source.id);
    try {
      const result = await testSource(source.id);
      setTestFeedback((prev) => ({
        ...prev,
        [source.id]: `${result.status.toUpperCase()}: ${result.message}`,
      }));
      await reloadSources();
    } catch (err) {
      setTestFeedback((prev) => ({
        ...prev,
        [source.id]: `ERROR: ${toErrorMessage(err, 'Failed to test source.')}`,
      }));
    } finally {
      setBusyId(null);
    }
  };

  const handleSync = async (source: FileSource) => {
    setBusyId(source.id);
    setTestFeedback((prev) => ({ ...prev, [source.id]: 'Syncing…' }));
    try {
      const result = await syncSource(source.id);
      const run = result.latestSyncRun;
      const summary = run
        ? `${run.status}${typeof run.filesScanned === 'number' ? `, ${run.filesScanned} scanned` : ''}${run.error ? `, ${run.error}` : ''}`
        : result.status;
      setTestFeedback((prev) => ({ ...prev, [source.id]: `SYNC: ${summary}` }));
      await reloadSources();
    } catch (err) {
      setTestFeedback((prev) => ({ ...prev, [source.id]: `SYNC ERROR: ${toErrorMessage(err, 'Failed to sync source.')}` }));
    } finally {
      setBusyId(null);
    }
  };

  if (!enabled) {
    return (
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4 text-xs text-[var(--text-muted)]">
        Multi-source file settings are disabled.
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <form onSubmit={handleCreate} className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="mb-2 text-sm font-medium text-[var(--text-primary)]">Add File Source</div>
        <div className="grid gap-2">
          <input
            value={form.displayName}
            onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))}
            className="mc-shell-input px-2 py-1 text-xs"
            placeholder="Display name"
          />
          <select
            value={form.type}
            onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as FileSource['type'], authType: 'none', authRef: '' }))}
            className="mc-shell-input px-2 py-1 text-xs"
          >
            {(Object.keys(TYPE_LABELS) as FileSource['type'][]).map((type) => (
              <option key={type} value={type}>{TYPE_LABELS[type]}</option>
            ))}
          </select>
          <div className="text-[10px] text-[var(--text-muted)]">{TYPE_HELP[form.type]}</div>
          {needsBasePath && (
            <input
              value={form.basePath}
              onChange={(event) => setForm((prev) => ({ ...prev, basePath: event.target.value }))}
              className="mc-shell-input px-2 py-1 text-xs"
              placeholder="Base path (server-local absolute path)"
            />
          )}
          {needsBaseUrl && (
            <input
              value={form.baseUrl}
              onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
              className="mc-shell-input px-2 py-1 text-xs"
              placeholder={form.type === 'github' ? 'https://github.com/owner/repo' : 'Base URL'}
            />
          )}
          {form.type === 'http-markdown' && (
            <input
              value={form.manifestPath}
              onChange={(event) => setForm((prev) => ({ ...prev, manifestPath: event.target.value }))}
              className="mc-shell-input px-2 py-1 text-xs"
              placeholder="Manifest path under base URL (optional)"
            />
          )}
          {needsAuth && (
            <>
              <select
                value={form.authType}
                onChange={(event) => setForm((prev) => ({ ...prev, authType: event.target.value as FileSource['authType'] }))}
                className="mc-shell-input px-2 py-1 text-xs"
              >
                <option value="none">No token (public repos only)</option>
                <option value="bearer">Token (bearer)</option>
              </select>
              {form.authType === 'bearer' && (
                <input
                  value={form.authRef}
                  onChange={(event) => setForm((prev) => ({ ...prev, authRef: event.target.value }))}
                  className="mc-shell-input px-2 py-1 text-xs"
                  placeholder="Env var name holding the GitHub token (e.g. ENTITY_GITHUB_TOKEN)"
                />
              )}
            </>
          )}
          <input
            value={form.icon}
            onChange={(event) => setForm((prev) => ({ ...prev, icon: event.target.value }))}
            className="mc-shell-input px-2 py-1 text-xs"
            placeholder="Icon (optional)"
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button type="submit" disabled={!canSubmit || loading} className="mc-shell-btn mc-shell-btn-active px-3 py-1 text-xs">
            Add source
          </button>
          <button type="button" onClick={() => setForm(INITIAL_FORM)} className="mc-shell-btn px-3 py-1 text-xs">
            Reset
          </button>
        </div>
        {localError && <div className="mt-2 text-xs text-[var(--error)]">{localError}</div>}
      </form>

      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium text-[var(--text-primary)]">Configured Sources</div>
          <button type="button" onClick={() => void reloadSources()} className="mc-shell-btn px-2 py-1 text-xs">
            Refresh
          </button>
        </div>

        {loading && <div className="text-xs text-[var(--text-muted)]">Loading sources...</div>}
        {error && <div className="text-xs text-[var(--error)]">{error}</div>}
        {!loading && !error && sources.length === 0 && (
          <div className="text-xs text-[var(--text-muted)]">No file sources configured.</div>
        )}

        <div className="space-y-2">
          {sources.map((source) => (
            <div key={source.id} className="rounded border border-[var(--border-primary)] p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate font-medium text-[var(--text-primary)]">
                  {source.icon ? `${source.icon} ` : ''}{source.displayName}
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      !source.enabled
                        ? 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                        : source.health === 'ok'
                          ? 'bg-[var(--accent-dim)] text-[var(--text-primary)]'
                          : source.health === 'degraded'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-[var(--error)] text-white'
                    }`}
                  >
                    {!source.enabled ? 'DISABLED' : source.health === 'ok' ? 'HEALTHY' : source.health === 'degraded' ? 'DEGRADED' : 'ERROR'}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${source.enabled ? 'bg-[var(--accent-dim)] text-[var(--text-primary)]' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'}`}>
                    {source.enabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
              </div>
              <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                {source.type} • {source.basePath || source.baseUrl || 'No location'}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                {typeHasLiveAdapter(source.type)
                  ? `Live connector: yes${source.lastSyncedAt ? ` • synced ${timeAgo(source.lastSyncedAt)}` : ''}`
                  : 'Live connector: not shipped yet (test will report degraded)'}
              </div>
              {source.type === 'http-markdown' && (
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {source.searchability === 'manifest-backed'
                    ? 'Manifest-backed search (test to validate)'
                    : 'Exact-read only; configure a manifest for search'}
                </div>
              )}
              {testFeedback[source.id] && (
                <div className={`mt-1 text-[10px] ${testFeedback[source.id].startsWith('ERROR') || testFeedback[source.id].startsWith('SYNC ERROR') ? 'text-[var(--error)]' : 'text-[var(--text-muted)]'}`}>
                  {testFeedback[source.id]}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => void handleToggle(source)}
                  disabled={busyId === source.id}
                  className="mc-shell-btn px-2 py-1 text-[10px]"
                >
                  {source.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleTest(source)}
                  disabled={busyId === source.id}
                  className="mc-shell-btn px-2 py-1 text-[10px]"
                >
                  Test
                </button>
                {typeHasLiveAdapter(source.type) && source.enabled && (
                  <button
                    type="button"
                    onClick={() => void handleSync(source)}
                    disabled={busyId === source.id}
                    className="mc-shell-btn px-2 py-1 text-[10px]"
                  >
                    Sync now
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleEdit(source)}
                  disabled={busyId === source.id}
                  className="mc-shell-btn px-2 py-1 text-[10px]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(source)}
                  disabled={busyId === source.id}
                  className="mc-shell-btn px-2 py-1 text-[10px]"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
