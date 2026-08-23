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
  icon: string;
}

const INITIAL_FORM: SourceFormState = {
  displayName: '',
  type: 'local',
  baseUrl: '',
  basePath: '',
  manifestPath: '',
  icon: '',
};

export default function FileSourcesSettings({ apiBase = '', enabled = true }: FileSourcesSettingsProps) {
  const { sources, loading, error, createSource, updateSource, deleteSource, setSourceEnabled, testSource, reloadSources } = useFileSources({
    apiBase,
    enabled,
  });
  const [form, setForm] = useState<SourceFormState>(INITIAL_FORM);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [testFeedback, setTestFeedback] = useState<Record<string, string>>({});

  const canSubmit = useMemo(() => {
    return form.displayName.trim().length > 0 && (form.basePath.trim().length > 0 || form.baseUrl.trim().length > 0);
  }, [form.basePath, form.baseUrl, form.displayName]);

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
            onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as FileSource['type'] }))}
            className="mc-shell-input px-2 py-1 text-xs"
          >
            <option value="local">local</option>
            <option value="docsify">docsify</option>
            <option value="http-markdown">http-markdown</option>
            <option value="github">github</option>
            <option value="s3">s3</option>
            <option value="custom">custom</option>
          </select>
          <input
            value={form.basePath}
            onChange={(event) => setForm((prev) => ({ ...prev, basePath: event.target.value }))}
            className="mc-shell-input px-2 py-1 text-xs"
            placeholder="Base path (local)"
          />
          <input
            value={form.baseUrl}
            onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
            className="mc-shell-input px-2 py-1 text-xs"
            placeholder="Base URL (remote)"
          />
          {form.type === 'http-markdown' && (
            <input
              value={form.manifestPath}
              onChange={(event) => setForm((prev) => ({ ...prev, manifestPath: event.target.value }))}
              className="mc-shell-input px-2 py-1 text-xs"
              placeholder="Manifest path under base URL (optional)"
            />
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
                <div className={`rounded px-1.5 py-0.5 text-[10px] ${source.enabled ? 'bg-[var(--accent-dim)] text-[var(--text-primary)]' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'}`}>
                  {source.enabled ? 'ENABLED' : 'DISABLED'}
                </div>
              </div>
              <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                {source.type} • {source.basePath || source.baseUrl || 'No location'}
              </div>
              {source.type === 'http-markdown' && (
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {source.searchability === 'manifest-backed'
                    ? 'Manifest-backed search (test to validate)'
                    : 'Exact-read only; configure a manifest for search'}
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
                  className="mc-shell-btn px-2 py-1 text-[10px] text-[var(--error)]"
                >
                  Delete
                </button>
              </div>
              {testFeedback[source.id] && <div className="mt-1 text-[10px] text-[var(--text-muted)]">{testFeedback[source.id]}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
