import { useCallback, useEffect, useMemo, useState } from 'react';
import { toErrorMessage, withApiToken } from '../../lib/http';
import { adminMutationHeaders } from '../../lib/adminRequest';
import { clearAdminRuntimeSettingsCache } from '../../lib/adminRuntimeSettings';

type FieldSpec =
  | { kind: 'boolean'; key: string; label: string; hint?: string }
  | { kind: 'text'; key: string; label: string; hint?: string }
  | { kind: 'select'; key: string; label: string; options: Array<{ value: string; label: string }>; hint?: string }
  | { kind: 'string-list'; key: string; label: string; hint?: string };

interface AdminSettingsFormProps {
  title: string;
  description: string;
  section: string;
  apiBase?: string;
  fields: FieldSpec[];
  onSettingsChange?: (settings: Record<string, unknown>) => void;
}

function apiPath(apiBase: string | undefined, path: string): string {
  return `${apiBase ?? ''}${path}`;
}

export default function AdminSettingsForm({
  title,
  description,
  section,
  apiBase = '',
  fields,
  onSettingsChange,
}: AdminSettingsFormProps) {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiPath(apiBase, `/api/admin/settings/${section}`), withApiToken());
      if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
      const body = await res.json() as { settings: Record<string, unknown> };
      setSettings(body.settings);
      setDraft(body.settings);
      onSettingsChange?.(body.settings);
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to load settings.'));
    } finally {
      setLoading(false);
    }
  }, [apiBase, onSettingsChange, section]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = useMemo(() => JSON.stringify(settings) !== JSON.stringify(draft), [draft, settings]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(apiPath(apiBase, `/api/admin/settings/${section}`), withApiToken({
        method: 'PATCH',
        headers: adminMutationHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(draft),
      }));
      const body = await res.json().catch(() => ({})) as { settings?: Record<string, unknown>; detail?: string; error?: string };
      if (!res.ok) throw new Error(body.detail ?? body.error ?? `Save failed (${res.status})`);
      const nextSettings = body.settings ?? draft;
      setSettings(nextSettings);
      setDraft(nextSettings);
      onSettingsChange?.(nextSettings);
      clearAdminRuntimeSettingsCache();
      setSuccess('Settings saved.');
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to save settings.'));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(apiPath(apiBase, `/api/admin/settings/${section}/reset`), withApiToken({
        method: 'POST',
        headers: adminMutationHeaders(),
      }));
      const body = await res.json() as { settings: Record<string, unknown> };
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
      setSettings(body.settings);
      setDraft(body.settings);
      onSettingsChange?.(body.settings);
      clearAdminRuntimeSettingsCache();
      setSuccess('Settings reset to defaults.');
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to reset settings.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
        <div className="mt-1 text-xs text-[var(--text-muted)]">{description}</div>
      </div>

      {loading ? (
        <div className="text-xs text-[var(--text-muted)]">Loading settings…</div>
      ) : (
        <div className="space-y-3">
          {fields.map((field) => {
            if (field.kind === 'boolean') {
              return (
                <label key={field.key} className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium text-[var(--text-primary)]">{field.label}</span>
                    {field.hint ? <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{field.hint}</span> : null}
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(draft[field.key])}
                    onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.checked }))}
                    aria-label={field.label}
                  />
                </label>
              );
            }
            if (field.kind === 'select') {
              return (
                <label key={field.key} className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  <span>{field.label}</span>
                  <select
                    value={String(draft[field.key] ?? '')}
                    onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                    className="mc-shell-input px-2 py-2 text-sm"
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              );
            }
            if (field.kind === 'string-list') {
              const value = Array.isArray(draft[field.key]) ? (draft[field.key] as string[]).join(', ') : '';
              return (
                <label key={field.key} className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  <span>{field.label}</span>
                  <input
                    value={value}
                    onChange={(event) => setDraft((prev) => ({
                      ...prev,
                      [field.key]: event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean),
                    }))}
                    className="mc-shell-input px-2 py-2 text-sm"
                    placeholder="comma,separated,values"
                  />
                </label>
              );
            }
            return (
              <label key={field.key} className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                <span>{field.label}</span>
                <input
                  value={String(draft[field.key] ?? '')}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  className="mc-shell-input px-2 py-2 text-sm"
                />
              </label>
            );
          })}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" className="mc-shell-btn px-3 py-1.5 text-xs" disabled={saving} onClick={() => void reset()}>Reset</button>
            <button type="button" className="mc-shell-btn mc-shell-btn-active px-3 py-1.5 text-xs" disabled={saving || !changed} onClick={() => void save()}>Save</button>
          </div>
        </div>
      )}

      {error ? <div className="mt-3 text-xs text-[var(--error)]" role="alert">{error}</div> : null}
      {success ? <div className="mt-3 text-xs text-[var(--accent)]" role="status">{success}</div> : null}
    </div>
  );
}
