import { useCallback, useEffect, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback } from '../../lib/http';

interface DocIntelligenceSettingsView {
  enabled: boolean;
  provider: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeySource: 'database' | 'env' | 'none';
  ready: boolean;
}

interface DocsSettingsProps {
  apiBase: string;
  onOpenTaskMasterSettings?: () => void;
}

export default function DocsSettings({ apiBase, onOpenTaskMasterSettings }: DocsSettingsProps) {
  const [settings, setSettings] = useState<DocIntelligenceSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(() => {
    setLoading(true);
    setError(null);
    requestJsonWithFallback<{ settings?: DocIntelligenceSettingsView }>({
      urls: buildApiCandidates('/doc-intelligence/settings', apiBase),
      fallbackError: 'Failed to load Doc Intelligence settings.',
    })
      .then((data) => {
        setSettings(data?.settings ?? null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load Doc Intelligence settings.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiBase]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleToggleEnabled = useCallback(
    (enabled: boolean) => {
      setSaving(true);
      setError(null);
      requestJsonWithFallback<{ settings?: DocIntelligenceSettingsView }>({
        urls: buildApiCandidates('/doc-intelligence/settings', apiBase),
        init: {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
        fallbackError: 'Failed to update Doc Intelligence settings.',
      })
        .then((data) => {
          setSettings(data?.settings ?? null);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to update Doc Intelligence settings.');
        })
        .finally(() => {
          setSaving(false);
        });
    },
    [apiBase],
  );

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Docs</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Settings for the Doc Hub document workspace.
        </p>
      </div>

      <section className="mc-shell-card space-y-4 border border-[var(--border-secondary)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-[var(--text-primary)]">✦ Doc Intelligence</div>
            <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--text-muted)]">
              Enables AI features in the document sidebar (Ask about this document). Doc Intelligence
              reuses the model provider and API key already configured for Task Master — no separate
              credentials are needed.
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={Boolean(settings?.enabled)}
              disabled={loading || saving}
              onChange={(event) => handleToggleEnabled(event.target.checked)}
              aria-label="Enable Doc Intelligence"
            />
            {settings?.enabled ? 'Enabled' : 'Disabled'}
          </label>
        </div>

        {loading ? (
          <div className="text-xs text-[var(--text-muted)]">Loading settings…</div>
        ) : settings ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Provider</div>
              <div className="mt-1 text-xs text-[var(--text-primary)]">{settings.provider}</div>
            </div>
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Model</div>
              <div className="mt-1 text-xs text-[var(--text-primary)]">{settings.model}</div>
            </div>
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">API key</div>
              <div className={`mt-1 text-xs ${settings.apiKeyConfigured ? 'text-[var(--accent)]' : 'text-amber-400'}`}>
                {settings.apiKeyConfigured
                  ? `Configured (${settings.apiKeySource})`
                  : 'Not configured'}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Status</div>
              <div className={`mt-1 text-xs ${settings.ready ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                {settings.ready ? 'Ready' : settings.enabled ? 'Enabled, missing API key' : 'Disabled'}
              </div>
            </div>
          </div>
        ) : null}

        {settings && !settings.apiKeyConfigured ? (
          <div className="rounded-lg border border-amber-500/30 bg-[var(--bg-secondary)] px-3 py-2 text-xs text-amber-200">
            No model API key is configured yet.{' '}
            {onOpenTaskMasterSettings ? (
              <button
                type="button"
                onClick={onOpenTaskMasterSettings}
                className="underline underline-offset-2 hover:text-amber-100"
              >
                Configure a provider in Task Master settings
              </button>
            ) : (
              'Configure a provider in Admin → Task Master.'
            )}
            .
          </div>
        ) : null}

        {error ? <div className="text-xs text-[var(--error)]">{error}</div> : null}
      </section>
    </div>
  );
}
