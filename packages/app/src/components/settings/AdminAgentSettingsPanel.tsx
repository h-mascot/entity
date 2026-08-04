/**
 * THE-887 / WP2-B-06 — Admin → Agents: invite TTL, modules, revoke audit.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  auditEventLabel,
  createInitialAdminAgentSettingsState,
  minutesToMs,
  msToMinutes,
  validateAdminAgentSettingsDraft,
  type AdminAgentSettings,
  type AdminAgentSettingsState,
  type InviteAuditEventView,
} from '../../lib/adminAgentSettings';
import {
  fetchAdminAgentSettings,
  fetchInviteAuditEvents,
  patchAdminAgentSettings,
} from '../../lib/adminAgentSettingsApi';
import { toErrorMessage } from '../../lib/http';

export interface AdminAgentSettingsPanelProps {
  settingsLoader?: () => Promise<AdminAgentSettings>;
  settingsSaver?: (
    patch: Partial<Pick<AdminAgentSettings, 'defaultTtlMs' | 'minTtlMs' | 'maxTtlMs' | 'allowedModules' | 'defaultModules'>>
      & { updatedBy?: string },
  ) => Promise<AdminAgentSettings>;
  auditLoader?: () => Promise<InviteAuditEventView[]>;
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toLocaleString();
}

export default function AdminAgentSettingsPanel({
  settingsLoader = fetchAdminAgentSettings,
  settingsSaver = patchAdminAgentSettings,
  auditLoader = fetchInviteAuditEvents,
}: AdminAgentSettingsPanelProps) {
  const [state, setState] = useState<AdminAgentSettingsState>(() => createInitialAdminAgentSettingsState());

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading', error: null, notice: null }));
    try {
      const [settings, audit] = await Promise.all([settingsLoader(), auditLoader()]);
      setState({
        status: 'ready',
        settings,
        draft: settings,
        audit,
        error: null,
        notice: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: toErrorMessage(error, 'Unable to load agent admin settings.'),
      }));
    }
  }, [auditLoader, settingsLoader]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateDraft = (patch: Partial<AdminAgentSettings>) => {
    setState((prev) => {
      if (!prev.draft) return prev;
      return { ...prev, draft: { ...prev.draft, ...patch }, notice: null, error: null };
    });
  };

  const toggleAllowed = (moduleId: string, enabled: boolean) => {
    setState((prev) => {
      if (!prev.draft) return prev;
      const allowedModules = enabled
        ? Array.from(new Set([...prev.draft.allowedModules, moduleId]))
        : prev.draft.allowedModules.filter((id) => id !== moduleId);
      const defaultModules = prev.draft.defaultModules.filter((id) => allowedModules.includes(id));
      return {
        ...prev,
        draft: { ...prev.draft, allowedModules, defaultModules },
        notice: null,
        error: null,
      };
    });
  };

  const toggleDefault = (moduleId: string, enabled: boolean) => {
    setState((prev) => {
      if (!prev.draft) return prev;
      if (enabled && !prev.draft.allowedModules.includes(moduleId)) return prev;
      const defaultModules = enabled
        ? Array.from(new Set([...prev.draft.defaultModules, moduleId]))
        : prev.draft.defaultModules.filter((id) => id !== moduleId);
      return {
        ...prev,
        draft: { ...prev.draft, defaultModules },
        notice: null,
        error: null,
      };
    });
  };

  const save = async () => {
    if (!state.draft) return;
    const validationError = validateAdminAgentSettingsDraft(state.draft);
    if (validationError) {
      setState((prev) => ({ ...prev, error: validationError, notice: null }));
      return;
    }
    setState((prev) => ({ ...prev, status: 'saving', error: null, notice: null }));
    try {
      const settings = await settingsSaver({
        defaultTtlMs: state.draft.defaultTtlMs,
        minTtlMs: state.draft.minTtlMs,
        maxTtlMs: state.draft.maxTtlMs,
        allowedModules: state.draft.allowedModules,
        defaultModules: state.draft.defaultModules,
        updatedBy: 'admin-ui',
      });
      const audit = await auditLoader();
      setState({
        status: 'ready',
        settings,
        draft: settings,
        audit,
        error: null,
        notice: 'Invite policy saved. Tokens are never shown here.',
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: 'ready',
        error: toErrorMessage(error, 'Unable to save agent admin settings.'),
      }));
    }
  };

  const draft = state.draft;

  return (
    <div
      className="mb-4 space-y-3"
      data-testid="admin-agent-settings-panel"
      data-status={state.status}
    >
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">Agent invite settings</div>
            <div className="text-xs text-[var(--text-muted)]">
              TTL policy, allowed modules, and revoke/regenerate audit. Secrets and raw invite tokens are never shown.
            </div>
          </div>
          <button
            type="button"
            className="mc-shell-btn px-2 py-1 text-xs"
            data-testid="admin-agent-settings-refresh"
            onClick={() => void load()}
            disabled={state.status === 'loading' || state.status === 'saving'}
          >
            Refresh
          </button>
        </div>

        {state.status === 'loading' && (
          <div className="text-xs text-[var(--text-muted)]" data-testid="admin-agent-settings-loading">
            Loading invite policy…
          </div>
        )}

        {state.error && (
          <div
            className="mb-3 rounded border border-[var(--error)] px-3 py-2 text-xs text-[var(--error)]"
            data-testid="admin-agent-settings-error"
          >
            {state.error}
          </div>
        )}

        {state.notice && (
          <div
            className="mb-3 rounded border border-[var(--success)] px-3 py-2 text-xs text-[var(--success)]"
            data-testid="admin-agent-settings-notice"
          >
            {state.notice}
          </div>
        )}

        {draft && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-xs text-[var(--text-muted)]">
                Default TTL (minutes)
                <input
                  data-testid="admin-agent-default-ttl"
                  type="number"
                  min={msToMinutes(draft.hardMinTtlMs)}
                  max={msToMinutes(draft.hardMaxTtlMs)}
                  className="mt-1 w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                  value={msToMinutes(draft.defaultTtlMs)}
                  onChange={(event) => updateDraft({ defaultTtlMs: minutesToMs(Number(event.target.value)) })}
                />
              </label>
              <label className="text-xs text-[var(--text-muted)]">
                Min TTL (minutes)
                <input
                  data-testid="admin-agent-min-ttl"
                  type="number"
                  min={msToMinutes(draft.hardMinTtlMs)}
                  max={msToMinutes(draft.hardMaxTtlMs)}
                  className="mt-1 w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                  value={msToMinutes(draft.minTtlMs)}
                  onChange={(event) => updateDraft({ minTtlMs: minutesToMs(Number(event.target.value)) })}
                />
              </label>
              <label className="text-xs text-[var(--text-muted)]">
                Max TTL (minutes)
                <input
                  data-testid="admin-agent-max-ttl"
                  type="number"
                  min={msToMinutes(draft.hardMinTtlMs)}
                  max={msToMinutes(draft.hardMaxTtlMs)}
                  className="mt-1 w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                  value={msToMinutes(draft.maxTtlMs)}
                  onChange={(event) => updateDraft({ maxTtlMs: minutesToMs(Number(event.target.value)) })}
                />
              </label>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-[var(--text-primary)]">Allowed modules</div>
              <div className="grid gap-2 md:grid-cols-2" data-testid="admin-agent-allowed-modules">
                {draft.catalogModules.map((module) => {
                  const allowed = draft.allowedModules.includes(module.id);
                  const isDefault = draft.defaultModules.includes(module.id);
                  return (
                    <div
                      key={module.id}
                      className="rounded border border-[var(--border-secondary)] px-3 py-2"
                      data-module-id={module.id}
                    >
                      <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        <input
                          type="checkbox"
                          checked={allowed}
                          onChange={(event) => toggleAllowed(module.id, event.target.checked)}
                        />
                        <span>{module.label}</span>
                        <span className="ml-auto text-[10px] text-[var(--text-muted)]">{module.id}</span>
                      </label>
                      <label className="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                        <input
                          type="checkbox"
                          checked={isDefault}
                          disabled={!allowed}
                          onChange={(event) => toggleDefault(module.id, event.target.checked)}
                        />
                        Default for new invites
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-[var(--text-muted)]" data-testid="admin-agent-settings-meta">
                Updated {formatWhen(draft.updatedAt)} {draft.updatedBy ? `by ${draft.updatedBy}` : ''}
              </div>
              <button
                type="button"
                className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1.5 text-xs font-medium"
                data-testid="admin-agent-settings-save"
                onClick={() => void save()}
                disabled={state.status === 'saving'}
              >
                {state.status === 'saving' ? 'Saving…' : 'Save invite policy'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Revoke / regenerate audit</div>
        <div className="mb-3 text-xs text-[var(--text-muted)]">
          Operator-visible invite lifecycle events. Raw tokens and hashes are never stored in this log.
        </div>
        {state.audit.length === 0 ? (
          <div className="text-xs text-[var(--text-muted)]" data-testid="admin-agent-audit-empty">
            No audit events yet.
          </div>
        ) : (
          <div className="max-h-64 space-y-2 overflow-auto" data-testid="admin-agent-audit-list">
            {state.audit.map((event) => (
              <div
                key={event.id}
                className="rounded border border-[var(--border-secondary)] px-3 py-2 text-xs"
                data-audit-type={event.eventType}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[var(--text-primary)]">{auditEventLabel(event.eventType)}</span>
                  {event.agentName && (
                    <span className="text-[var(--text-secondary)]">{event.agentName}</span>
                  )}
                  {event.status && (
                    <span className="text-[var(--text-muted)]">{event.status}</span>
                  )}
                  <span className="ml-auto text-[var(--text-muted)]">{formatWhen(event.createdAt)}</span>
                </div>
                <div className="mt-1 text-[var(--text-muted)]">
                  {event.actorId ? `actor=${event.actorId}` : 'actor=—'}
                  {event.inviteId ? ` · invite=${event.inviteId}` : ''}
                  {event.generation != null ? ` · gen=${event.generation}` : ''}
                </div>
                {event.detail && (
                  <div className="mt-1 font-mono text-[10px] text-[var(--text-secondary)]">{event.detail}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
