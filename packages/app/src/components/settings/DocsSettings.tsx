import { useCallback, useEffect, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback } from '../../lib/http.ts';
import ProviderSettings from '../document-integrations/ProviderSettings.tsx';
import {
  providerCardsFromStatus,
  type ProviderAdminStatusView,
} from './docsProviderStatus.ts';

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

/**
 * GQR-004 — API-backed provider administration cards (Google Workspace, Microsoft 365,
 * Local Office). All provider status — connection health, write gates, approved
 * destinations, and agent mutation lanes — is read from the redacted server endpoint
 * (GET /api/document-integrations/admin/status). The cards are a server-authoritative
 * READOUT: policy controls are disabled because writes are governed server-side by the
 * audited gates and sandbox fixtures, never by this UI. When the endpoint is
 * unreachable the cards fall back to honest fail-closed defaults with a diagnostic —
 * health is never invented client-side.
 */
export function ProviderAdminCards({
  status,
  loadError,
}: {
  status: ProviderAdminStatusView | null;
  loadError?: string | null;
}) {
  const cards = providerCardsFromStatus(status, { loadError });
  return (
    <section className="space-y-4">
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="text-sm font-medium text-[var(--text-primary)]">Provider status</div>
        <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
          Document providers (Google Workspace, Microsoft 365, Local Office) are administered
          server-side. This surface reports the authoritative runtime status: connection
          health, effective write gates, approved destinations, and the mutation lanes each
          active adapter honestly supports. Credentials are never displayed.
        </p>
        <div className="mt-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          Runtime posture: {status ? `${status.runtime.mode} · bootstrap ${status.runtime.sandboxBootstrap}` : 'unavailable'}
        </div>
        {loadError ? <div className="mt-2 text-xs text-[var(--error)]">{loadError}</div> : null}
      </div>
      {cards.map((card) => (
        <ProviderSettings key={card.providerId} model={card.model} onChange={() => undefined} />
      ))}
    </section>
  );
}

export default function DocsSettings({ apiBase, onOpenTaskMasterSettings }: DocsSettingsProps) {
  const [settings, setSettings] = useState<DocIntelligenceSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // GQR-004: provider administration state is API-backed (redacted provider-admin status).
  const [providerStatus, setProviderStatus] = useState<ProviderAdminStatusView | null>(null);
  const [providerStatusError, setProviderStatusError] = useState<string | null>(null);

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

  const loadProviderStatus = useCallback(() => {
    requestJsonWithFallback<ProviderAdminStatusView>({
      urls: buildApiCandidates('/document-integrations/admin/status', apiBase),
      fallbackError: 'Failed to load provider status.',
    })
      .then((data) => {
        setProviderStatus(data ?? null);
        setProviderStatusError(null);
      })
      .catch((err) => {
        // Fail closed: keep cards with honest defaults and surface the failure.
        setProviderStatus(null);
        setProviderStatusError(err instanceof Error ? err.message : 'Failed to load provider status.');
      });
  }, [apiBase]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    loadProviderStatus();
  }, [loadProviderStatus]);

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

      {/* GQR-004 — API-backed provider administration (Google / Microsoft 365 / Local). */}
      <ProviderAdminCards status={providerStatus} loadError={providerStatusError} />
    </div>
  );
}
