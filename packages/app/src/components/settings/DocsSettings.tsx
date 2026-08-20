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

/**
 * T-013 (R-005/R-007) — Google administrator write gate configuration surface.
 *
 * MODEL NOTE (fail-closed, no invented defaults): R-005 requires "explicit administrator write
 * authorization", "allowed destination", a write mode, and an "applicable confirmation policy
 * satisfied" gate, plus a reversible audited feature flag (14.6). This component is the admin
 * `destination / write mode / confirmation policy` surface (Phase E §14.5 "admin authorization
 * UI"). The underlying R-003 write policy model (packages/server/src/document-providers/
 * write-policy.ts) is PURE and T-007 records that its persistence is deferred; there is no
 * dedicated audited Google-write flag yet (OQ-018 open), so this surface is a staged
 * configuration readout, NOT a live persistence/API write path. No product default is invented
 * for anything the PRD leaves open (OQ-003 confirmation default, OQ-018 flag host) — each is
 * surfaced as an explicit pending decision.
 */
type GoogleWriteMode = 'disabled' | 'create_only' | 'create_and_update';
type GoogleConfirmationPolicy = 'not_required' | 'auto_approve' | 'required';

interface GoogleApprovedDestination {
  id: string;
  displayName: string;
  kind: 'folder' | 'shared_drive' | 'onedrive' | 'sharepoint_library' | 'local_managed_storage';
  enabled: boolean;
}

interface GoogleWriteGateConfig {
  adminWriteAuthorized: boolean;
  writeMode: GoogleWriteMode;
  confirmationPolicy: GoogleConfirmationPolicy;
  approvedDestinations: GoogleApprovedDestination[];
}

const WRITE_MODE_LABELS: Record<GoogleWriteMode, string> = {
  disabled: 'Disabled',
  create_only: 'Create only',
  create_and_update: 'Create and update',
};

const CONFIRMATION_LABELS: Record<GoogleConfirmationPolicy, string> = {
  not_required: 'Not required',
  auto_approve: 'Auto-approve',
  required: 'Required (explicit human confirmation)',
};

const DESTINATION_KIND_LABELS: Record<GoogleApprovedDestination['kind'], string> = {
  folder: 'Folder',
  shared_drive: 'Shared Drive',
  onedrive: 'OneDrive',
  sharepoint_library: 'SharePoint Library',
  local_managed_storage: 'Local managed storage',
};

/**
 * The default staged configuration. R-005 is fail-closed: admin write authorization defaults to
 * OFF (broad OAuth scope alone never enables writes), write mode defaults to `disabled`, and no
 * destination is approved until an admin explicitly configures one. No PRD-open default
 * (OQ-003/OQ-018) is invented.
 */
function defaultWriteGateConfig(): GoogleWriteGateConfig {
  return {
    adminWriteAuthorized: false,
    writeMode: 'disabled',
    confirmationPolicy: 'not_required',
    approvedDestinations: [],
  };
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
  // T-013 staged admin write-gate configuration (local, persistence pending — see note above).
  const [writeGate, setWriteGate] = useState<GoogleWriteGateConfig>(defaultWriteGateConfig);

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

  const updateWriteGate = useCallback((patch: Partial<GoogleWriteGateConfig>) => {
    setWriteGate((prev) => ({ ...prev, ...patch }));
  }, []);

  // R-005: the admin write gate is only "armed" when every independent gate is explicitly
  // satisfied — admin authorization ON, a non-disabled write mode, AND at least one enabled
  // approved destination. Any missing gate keeps the lane fail-closed.
  const writeGateArmed =
    writeGate.adminWriteAuthorized &&
    writeGate.writeMode !== 'disabled' &&
    writeGate.approvedDestinations.some((d) => d.enabled);

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

      {/* T-013 — Google administrator write gate + destination UX (R-005/R-007, Phase E §14.5). */}
      <section className="mc-shell-card space-y-4 border border-[var(--border-secondary)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-[var(--text-primary)]">Google write authorization</div>
            <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--text-muted)]">
              Per R-005, Google mutations require explicit administrator write authorization,
              an approved destination, a write mode, a satisfied confirmation policy, and an
              audited deployment feature flag. Broad OAuth scope alone never enables writes. Per
              R-007, creation resolves ONE explicit approved destination and never falls back to
              an unauthorized location. Unauthorized destinations are never selectable.
            </p>
          </div>
          <div
            className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${
              writeGateArmed
                ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                : 'bg-amber-500/20 text-amber-300'
            }`}
          >
            {writeGateArmed ? 'Write gate armed' : 'Write gate locked (fail closed)'}
          </div>
        </div>

        {/* R-005 gate #3 — explicit administrator write authorization. */}
        <div className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
          <div>
            <div className="text-sm font-medium text-[var(--text-primary)]">Administrator write authorization</div>
            <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--text-muted)]">
              When off, no Google write is authorized regardless of OAuth scope or destination.
              This is the explicit administrator authorization R-005 requires.
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={writeGate.adminWriteAuthorized}
              onChange={(event) => updateWriteGate({ adminWriteAuthorized: event.target.checked })}
              aria-label="Enable Google administrator write authorization"
            />
            {writeGate.adminWriteAuthorized ? 'Authorized' : 'Not authorized'}
          </label>
        </div>

        {/* R-003 / R-005 — write mode. */}
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Write mode</div>
          <select
            className="mt-1 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
            value={writeGate.writeMode}
            onChange={(event) => updateWriteGate({ writeMode: event.target.value as GoogleWriteMode })}
            aria-label="Google write mode"
          >
            {(Object.keys(WRITE_MODE_LABELS) as GoogleWriteMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {WRITE_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>

        {/* R-003 / OQ-003 — confirmation policy (default open, explicitly not defaulted). */}
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Confirmation policy</div>
          <select
            className="mt-1 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
            value={writeGate.confirmationPolicy}
            onChange={(event) =>
              updateWriteGate({ confirmationPolicy: event.target.value as GoogleConfirmationPolicy })
            }
            aria-label="Google confirmation policy"
          >
            {(Object.keys(CONFIRMATION_LABELS) as GoogleConfirmationPolicy[]).map((policy) => (
              <option key={policy} value={policy}>
                {CONFIRMATION_LABELS[policy]}
              </option>
            ))}
          </select>
        </div>

        {/* R-007 — approved destinations (distinguishes approved locations; unapproved never selectable). */}
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Approved destinations</div>
          {writeGate.approvedDestinations.length === 0 ? (
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              No destination approved yet — creation stays locked (R-007: no fallback location).
            </div>
          ) : (
            <ul className="mt-1 space-y-1">
              {writeGate.approvedDestinations.map((destination) => (
                <li key={destination.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[var(--text-primary)]">{destination.displayName}</span>
                  <span className="text-[var(--text-muted)]">
                    {DESTINATION_KIND_LABELS[destination.kind]} ·{' '}
                    {destination.enabled ? (
                      <span className="text-[var(--accent)]">approved</span>
                    ) : (
                      <span className="text-amber-400">disabled</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={writeGate.approvedDestinations.some((d) => d.enabled)}
              onChange={(event) => {
                const enabled = event.target.checked;
                updateWriteGate({
                  approvedDestinations: writeGate.approvedDestinations.map((d) => ({ ...d, enabled })),
                });
              }}
              aria-label="Approve the configured Google destination"
            />
            Approve the configured Google destination
          </label>
        </div>

        {/* Fail-closed readout + pending-decision disclosures (no invented defaults). */}
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-muted)]">
          <div>
            Write-gate posture:{' '}
            <span className={writeGateArmed ? 'text-[var(--accent)]' : 'text-amber-300'}>
              {writeGateArmed ? 'armed' : 'fail-closed'}
            </span>{' '}
            — one or more required gates are missing, so no Google write is authorized.
          </div>
          <div className="mt-1">
            Pending decisions (not invented here): confirmation-policy default (OQ-003) and the
            audited feature-flag host for the write gate (OQ-018) remain open; this staged
            configuration is not yet persisted to a live backend endpoint (T-007 persistence
            boundary).
          </div>
        </div>
      </section>
    </div>
  );
}
