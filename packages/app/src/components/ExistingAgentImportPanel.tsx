import { useEffect, useMemo, useRef, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http';
import {
  buildCuracelSyntheticRows,
  type CuracelAgentImportRow,
} from '../lib/curacelAgentImportRows';

interface ImportOption {
  id: string;
  name: string;
}

interface ImportModule extends ImportOption {
  slug: string;
  enabled: boolean;
}

interface ImportChannel extends ImportOption {}

type ImportRow = CuracelAgentImportRow;

interface ImportReceipt {
  id: string;
  createdAgentIds: string[];
  reusedAgentIds: string[];
  mappingIds: string[];
  channelAccessGranted: false;
}

function key(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `agent-import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyRow(): ImportRow {
  return {
    id: key(),
    externalId: '',
    existingAgentId: '',
    name: '',
    slug: '',
    emoji: '🤖',
    teamIds: [],
    moduleIds: [],
    channelIds: [],
    reviewRequired: false,
    humanGateRequired: false,
  };
}

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export default function ExistingAgentImportPanel({ orgId, apiBase = '' }: {
  orgId: string;
  apiBase?: string;
}) {
  const [source, setSource] = useState('runtime-fleet');
  const [rows, setRows] = useState<ImportRow[]>([emptyRow()]);
  const [teams, setTeams] = useState<ImportOption[]>([]);
  const [agents, setAgents] = useState<ImportOption[]>([]);
  const [modules, setModules] = useState<ImportModule[]>([]);
  const [channels, setChannels] = useState<ImportChannel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);
  const [mappingCount, setMappingCount] = useState(0);
  const idempotencyKey = useRef(key());

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      requestJsonWithFallback<{ teams: ImportOption[] }>({
        urls: buildApiCandidates(`/orgs/${encodeURIComponent(orgId)}/teams`, apiBase),
      }),
      requestJsonWithFallback<{ list: ImportOption[] }>({
        urls: buildApiCandidates('/agents/registry', apiBase),
      }),
      requestJsonWithFallback<{ list: ImportModule[] }>({
        urls: buildApiCandidates('/modules', apiBase),
      }),
      requestJsonWithFallback<{ channels: ImportChannel[] }>({
        urls: buildApiCandidates('/chat/channels', apiBase),
      }),
      requestJsonWithFallback<{ mappings: unknown[]; latestReceipt: ImportReceipt | null }>({
        urls: buildApiCandidates(`/orgs/${encodeURIComponent(orgId)}/agent-imports`, apiBase),
      }),
    ]).then(([teamResult, agentResult, moduleResult, channelResult, importResult]) => {
      if (cancelled) return;
      if (teamResult.status === 'fulfilled') setTeams(teamResult.value.teams);
      if (agentResult.status === 'fulfilled') setAgents(agentResult.value.list);
      if (moduleResult.status === 'fulfilled') setModules(moduleResult.value.list.filter((module) => module.enabled));
      if (channelResult.status === 'fulfilled') setChannels(channelResult.value.channels);
      if (importResult.status === 'fulfilled') {
        setMappingCount(importResult.value.mappings.length);
        setReceipt(importResult.value.latestReceipt);
      }
      const failures = [teamResult, agentResult, moduleResult, channelResult, importResult]
        .filter((result) => result.status === 'rejected');
      if (failures.length) {
        setError(`${failures.length} import choice source${failures.length === 1 ? '' : 's'} unavailable; loaded choices remain usable.`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, orgId]);

  const canSubmit = useMemo(() => rows.every((row) =>
    row.externalId.trim() &&
    row.teamIds.length > 0 &&
    (row.existingAgentId || (row.name.trim() && row.slug.trim())),
  ), [rows]);

  const edit = (rowId: string, changes: Partial<ImportRow>) => {
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, ...changes } : row));
    setError('');
    setReceipt(null);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await requestJsonWithFallback<{ receipt: ImportReceipt; mappingCount: number }>({
        urls: buildApiCandidates(`/orgs/${encodeURIComponent(orgId)}/agent-imports`, apiBase),
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Idempotency-Key': idempotencyKey.current,
          },
          body: JSON.stringify({
            source,
            agents: rows.map((row) => ({
              externalId: row.externalId,
              ...(row.existingAgentId
                ? { existingAgentId: row.existingAgentId }
                : { name: row.name, slug: row.slug, emoji: row.emoji }),
              teamIds: row.teamIds,
              moduleIds: row.moduleIds,
              channelIds: row.channelIds,
              reviewPolicy: {
                required: row.reviewRequired,
                humanGateRequired: row.humanGateRequired,
              },
            })),
          }),
        },
      });
      setReceipt(response.receipt);
      setMappingCount(response.mappingCount);
      idempotencyKey.current = key();
    } catch (reason) {
      setError(toErrorMessage(reason, 'Unable to import existing agents.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-7 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)]/45 p-5" aria-busy={busy}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">Existing-agent import</p>
      <h2 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">Map the runtime fleet</h2>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Register operator-supplied identities and assign organization scopes. Channel selections are references only and grant no chat-history access.
      </p>
      {mappingCount > 0 ? <p className="mt-2 text-xs text-[var(--text-muted)]">{mappingCount} agent mapping{mappingCount === 1 ? '' : 's'} currently recorded for this organization.</p> : null}

      {error ? <div role="alert" className="mt-4 rounded-lg border border-[var(--error)] bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]">{error}</div> : null}
      {receipt ? (
        <div className="mt-4 rounded-lg border border-[var(--accent)]/45 bg-[var(--surface-accent)] p-4" data-testid="agent-import-receipt">
          <div className="text-sm font-medium text-[var(--text-primary)]">Import receipt recorded</div>
          <div className="mt-1 break-all font-mono text-xs text-[var(--text-muted)]">{receipt.id}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div><strong className="block text-lg text-[var(--text-primary)]">{receipt.createdAgentIds.length}</strong>created</div>
            <div><strong className="block text-lg text-[var(--text-primary)]">{receipt.reusedAgentIds.length}</strong>reused</div>
            <div><strong className="block text-lg text-[var(--text-primary)]">{receipt.mappingIds.length}</strong>mapped</div>
          </div>
          <p className="mt-3 text-xs text-[var(--text-muted)]">Chat-history access: not granted.</p>
        </div>
      ) : null}

      <label className="mt-5 block text-xs text-[var(--text-muted)]">
        Source identity namespace
        <input value={source} onChange={(event) => setSource(event.target.value)} className="mc-shell-input mt-1 min-h-11 w-full px-3 text-sm" />
      </label>

      <div className="mt-4 space-y-4">
        {rows.map((row, index) => (
          <article key={row.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--card-bg)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Agent {index + 1}</h3>
              {rows.length > 1 ? (
                <button type="button" onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))} className="mc-shell-btn min-h-11 px-3 text-xs">Remove</button>
              ) : null}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-[var(--text-muted)]">External identity<input value={row.externalId} onChange={(event) => edit(row.id, { externalId: event.target.value })} className="mc-shell-input mt-1 min-h-11 w-full px-3 text-sm" placeholder="Stable runtime ID" /></label>
              <label className="text-xs text-[var(--text-muted)]">Existing Entity agent<select value={row.existingAgentId} onChange={(event) => edit(row.id, { existingAgentId: event.target.value })} className="mc-shell-input mt-1 min-h-11 w-full px-2 text-sm"><option value="">Register a new entry</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
              {!row.existingAgentId ? (
                <>
                  <label className="text-xs text-[var(--text-muted)]">Display name<input value={row.name} onChange={(event) => edit(row.id, { name: event.target.value })} className="mc-shell-input mt-1 min-h-11 w-full px-3 text-sm" /></label>
                  <label className="text-xs text-[var(--text-muted)]">Registry slug<input value={row.slug} onChange={(event) => edit(row.id, { slug: event.target.value.toLowerCase() })} className="mc-shell-input mt-1 min-h-11 w-full px-3 text-sm" placeholder="operations-agent" /></label>
                </>
              ) : null}
            </div>

            <fieldset className="mt-4">
              <legend className="text-xs font-medium text-[var(--text-primary)]">Teams</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {teams.map((team) => <label key={team.id} className="onboarding-choice-row min-h-11 px-3 py-2 text-xs"><input type="checkbox" checked={row.teamIds.includes(team.id)} onChange={() => edit(row.id, { teamIds: toggle(row.teamIds, team.id) })} className="mr-2" />{team.name}</label>)}
              </div>
            </fieldset>
            <fieldset className="mt-4">
              <legend className="text-xs font-medium text-[var(--text-primary)]">Capabilities</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {modules.map((module) => <label key={module.id} className="onboarding-choice-row min-h-11 px-3 py-2 text-xs"><input type="checkbox" checked={row.moduleIds.includes(module.id)} onChange={() => edit(row.id, { moduleIds: toggle(row.moduleIds, module.id) })} className="mr-2" />{module.name}</label>)}
              </div>
            </fieldset>
            <label className="mt-4 block text-xs text-[var(--text-muted)]">Channel reference<select value={row.channelIds[0] ?? ''} onChange={(event) => edit(row.id, { channelIds: event.target.value ? [event.target.value] : [] })} className="mc-shell-input mt-1 min-h-11 w-full px-2 text-sm"><option value="">No channel reference</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
            <div className="mt-4 flex flex-wrap gap-3">
              <label className="onboarding-choice-row min-h-11 px-3 py-2 text-xs"><input type="checkbox" checked={row.reviewRequired} onChange={(event) => edit(row.id, { reviewRequired: event.target.checked, humanGateRequired: event.target.checked ? row.humanGateRequired : false })} className="mr-2" />Review required</label>
              <label className="onboarding-choice-row min-h-11 px-3 py-2 text-xs"><input type="checkbox" checked={row.humanGateRequired} disabled={!row.reviewRequired} onChange={(event) => edit(row.id, { humanGateRequired: event.target.checked })} className="mr-2" />Human gate required</label>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            setRows(buildCuracelSyntheticRows(teams[0]?.id ?? ''));
            setSource('curacel-synthetic-qa');
            setReceipt(null);
            setError(teams.length ? '' : 'Create or select a team before importing the synthetic fleet.');
          }}
          className="onboarding-action-secondary min-h-11 px-4"
        >
          Load Atlas · Mafa · Sabi · Kashy
        </button>
        <button type="button" onClick={() => setRows((current) => [...current, emptyRow()])} className="onboarding-action-secondary min-h-11 px-4">Add agent</button>
        <button type="button" onClick={() => void submit()} disabled={busy || !source.trim() || !canSubmit} className="onboarding-action-primary min-h-11 px-4">
          {busy ? 'Importing…' : mappingCount > 0 ? 'Update mappings / re-import' : 'Import agents'}
        </button>
      </div>
    </section>
  );
}
