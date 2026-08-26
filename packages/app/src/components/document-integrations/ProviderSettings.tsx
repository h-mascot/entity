import type { ReactNode } from 'react';

export type ProviderWriteMode = 'disabled' | 'create_only' | 'create_and_update';
export type ProviderConfirmationPolicy = 'not_required' | 'auto_approve' | 'required';

export interface ProviderDestination {
  id: string;
  displayName: string;
  kind: 'folder' | 'shared_drive' | 'onedrive' | 'sharepoint_library' | 'local_managed_storage';
  enabled: boolean;
}

export interface ProviderMutationSupport {
  agent_text_mutation: 'supported' | 'unsupported' | 'unknown';
  agent_range_mutation: 'supported' | 'unsupported' | 'unknown';
  agent_slide_mutation: 'supported' | 'unsupported' | 'unknown';
}

export interface ProviderSettingsModel {
  connectionState: 'ready' | 'reauthorization_required' | 'admin_consent_required' | 'permission_denied' | 'degraded' | 'configuration_required' | 'unknown';
  provider: 'Google Workspace' | 'Microsoft 365' | 'Local Office';
  writeMode: ProviderWriteMode;
  adminWriteAuthorized: boolean;
  writeAuthorizationProven: boolean;
  confirmationPolicy: ProviderConfirmationPolicy;
  destinations: ProviderDestination[];
  localReadiness?: 'ready' | 'bridge_not_installed' | 'bridge_not_running' | 'engine_unavailable' | 'degraded';
  diagnostics?: string[];
  policyControlsEnabled?: boolean;
  /** Capability-honest agent mutation lanes (GQR-004) — rendered verbatim, never upgraded. */
  mutationSupport?: ProviderMutationSupport;
}

const DESTINATION_KIND_LABELS: Record<ProviderDestination['kind'], string> = {
  folder: 'Folder',
  shared_drive: 'Shared Drive',
  onedrive: 'OneDrive',
  sharepoint_library: 'SharePoint library',
  local_managed_storage: 'Managed local storage',
};

export function localReadinessLabel(readiness: NonNullable<ProviderSettingsModel['localReadiness']>): string {
  return {
    ready: 'Ready',
    bridge_not_installed: 'Bridge not installed',
    bridge_not_running: 'Bridge not running',
    engine_unavailable: 'Engine unavailable',
    degraded: 'Degraded',
  }[readiness];
}

const CONNECTION_LABELS: Record<ProviderSettingsModel['connectionState'], string> = {
  ready: 'Healthy',
  reauthorization_required: 'Reconnect required',
  admin_consent_required: 'Admin consent required',
  permission_denied: 'Permission denied',
  degraded: 'Degraded',
  configuration_required: 'Configuration required',
  unknown: 'Status unknown',
};

/** Capability-honest labels for agent mutation lanes (never upgraded by the UI). */
const MUTATION_LANE_LABELS: Array<{ key: keyof NonNullable<ProviderSettingsModel['mutationSupport']>; lane: string }> = [
  { key: 'agent_text_mutation', lane: 'Document text' },
  { key: 'agent_range_mutation', lane: 'Spreadsheet ranges' },
  { key: 'agent_slide_mutation', lane: 'Presentation slides' },
];

function mutationLaneLabel(state: 'supported' | 'unsupported' | 'unknown'): string {
  if (state === 'supported') return 'Supported';
  if (state === 'unsupported') return 'Not supported';
  return 'Unavailable (no provider adapter registered)';
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mc-shell-card space-y-3 border border-[var(--border-secondary)] p-4">
      <h3 className="text-sm font-medium text-[var(--text-primary)]">{title}</h3>
      {children}
    </section>
  );
}

/**
 * T-034 provider administration surface. This is deliberately a readout/configuration model:
 * persistence and connection management belong to their audited provider routes. It never renders
 * credentials and it does not turn a caller-supplied `confirmed` field into a human control.
 */
export default function ProviderSettings({ model, onChange }: { model: ProviderSettingsModel; onChange: (patch: Partial<ProviderSettingsModel>) => void }) {
  const enabledDestination = model.destinations.find((destination) => destination.enabled);
  const effectiveWriteEnabled = model.policyControlsEnabled !== false
    && model.connectionState === 'ready'
    && model.adminWriteAuthorized
    && model.writeAuthorizationProven
    && model.writeMode !== 'disabled'
    && Boolean(enabledDestination);
  const destinationPolicyMessage = enabledDestination
    ? `Creates must target “${enabledDestination.displayName}” (${DESTINATION_KIND_LABELS[enabledDestination.kind]}).`
    : 'No destination is enabled. Creation is blocked; Entity will not fall back to a wildcard, My Drive, or another location.';

  return (
    <div className="space-y-4">
      <Section title={`${model.provider} connection`}>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-[var(--text-secondary)]">Connection health</span>
          <span className={model.connectionState === 'ready' ? 'text-[var(--accent)]' : 'text-amber-300'}>
            {CONNECTION_LABELS[model.connectionState]}
          </span>
        </div>
        {model.connectionState !== 'ready' && (
          <p className="text-xs text-amber-200">Writes and other capabilities remain fail-closed until this connection is healthy.</p>
        )}
        {model.connectionState === 'unknown' && (
          <p className="text-xs text-amber-200">Connection status is unknown — no evidence backs any capability claim, so everything stays fail-closed.</p>
        )}
        <p className="text-[10px] text-[var(--text-muted)]">Credentials are never displayed in Entity settings or diagnostics.</p>
      </Section>

      <Section title="Write authorization and destination">
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-xs">
          <div className="font-medium text-[var(--text-primary)]">{effectiveWriteEnabled ? 'Write lane configured' : 'Write lane locked (fail closed)'}</div>
          <div className="mt-1 text-[var(--text-muted)]">All independent gates must pass: healthy connection, proven authorization, explicit administrator authorization, non-disabled mode, and one exact approved destination.</div>
        </div>
        <label className="flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
          <span>Administrator write authorization</span>
          <input type="checkbox" checked={model.adminWriteAuthorized} disabled={model.policyControlsEnabled === false} onChange={(event) => onChange({ adminWriteAuthorized: event.target.checked })} aria-label="Administrator write authorization" />
        </label>
        <label className="block text-xs text-[var(--text-secondary)]">
          <span>Write mode</span>
          <select className="mt-1 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]" value={model.writeMode} disabled={model.policyControlsEnabled === false} onChange={(event) => onChange({ writeMode: event.target.value as ProviderWriteMode })} aria-label="Provider write mode">
            <option value="disabled">Disabled</option>
            <option value="create_only">Create only</option>
            <option value="create_and_update">Create and update</option>
          </select>
        </label>
        <div className="text-xs text-[var(--text-muted)]">
          <div className="font-medium text-[var(--text-secondary)]">Destination policy</div>
          <p className="mt-1">{destinationPolicyMessage}</p>
          <ul className="mt-2 space-y-1">
            {model.destinations.length === 0 ? <li>No configured destinations.</li> : model.destinations.map((destination) => (
              <li key={destination.id} className="flex justify-between gap-2">
                <span>{destination.displayName} · {DESTINATION_KIND_LABELS[destination.kind]}</span>
                <span className={destination.enabled ? 'text-[var(--accent)]' : 'text-amber-400'}>{destination.enabled ? 'approved' : 'disabled'}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[10px] text-[var(--text-muted)]">Confirmation policy is not a write switch. A request’s caller-attested <code>confirmed</code> value is not evidence of human confirmation; it cannot activate this lane.</p>
      </Section>

      {model.mutationSupport ? (
        <Section title="Agent mutation support">
          <ul className="space-y-1 text-xs">
            {MUTATION_LANE_LABELS.map(({ key, lane }) => {
              const state = model.mutationSupport?.[key] ?? 'unknown';
              return (
                <li key={key} className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-secondary)]">{lane}</span>
                  <span className={state === 'supported' ? 'text-[var(--accent)]' : 'text-amber-400'}>{mutationLaneLabel(state)}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-[10px] text-[var(--text-muted)]">States come from the active provider adapter. Unsupported and unavailable lanes reject mutations with typed errors — the UI never upgrades them.</p>
        </Section>
      ) : null}

      <Section title="Diagnostics and local readiness">
        <div className="grid gap-2 sm:grid-cols-2 text-xs">
          <div className="rounded border border-[var(--border-primary)] p-2"><div className="text-[10px] uppercase text-[var(--text-muted)]">Policy evidence</div><div className="mt-1 text-[var(--text-secondary)]">{model.writeAuthorizationProven ? 'Explicit authorization proven' : 'Authorization not proven'}</div></div>
          <div className="rounded border border-[var(--border-primary)] p-2"><div className="text-[10px] uppercase text-[var(--text-muted)]">Local runtime</div><div className="mt-1 text-[var(--text-secondary)]">{model.localReadiness ? localReadinessLabel(model.localReadiness) : 'Not applicable'}</div></div>
        </div>
        {model.diagnostics?.length ? <ul className="space-y-1 text-xs text-[var(--text-muted)]">{model.diagnostics.map((diagnostic) => <li key={diagnostic}>• {diagnostic}</li>)}</ul> : <p className="text-xs text-[var(--text-muted)]">No additional diagnostics reported.</p>}
      </Section>
    </div>
  );
}
