import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../../lib/http';
import {
  categoryIsScoped,
  channelIsScoped,
  refreshedMutationNotice,
  validSelection,
} from './communicationControlsModel';

type Option = { id: string; name: string; category_id?: string };
type Mapping = { agent_id: string; external_id: string; team_ids: string[] };
type Grant = { id: string; channel_id: string; agent_id: string; team_id: string | null };
type Scope = { channel_id: string; team_id: string | null };
type Cooldown = { id: string; channel_id: string; agent_id: string; cooldown_seconds: number };
type Mute = { id: string; scope_type: 'channel' | 'category'; scope_id: string; reason: string };
type Audit = {
  id: string;
  action: string;
  channel_id: string | null;
  category_id: string | null;
  agent_id: string | null;
  reason: string | null;
  created_at: string;
};

function useSelected(value: string, options: Option[], setValue: (value: string) => void) {
  useEffect(() => {
    const nextValue = validSelection(value, options);
    if (nextValue !== value) setValue(nextValue);
  }, [options, setValue, value]);
}

export default function CommunicationControlsSettings({ apiBase = '' }: { apiBase?: string }) {
  const [orgs, setOrgs] = useState<Option[]>([]);
  const [teams, setTeams] = useState<Option[]>([]);
  const [channels, setChannels] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [mutes, setMutes] = useState<Mute[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [orgId, setOrgId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState('60');
  const [reason, setReason] = useState('Customer readiness policy');
  const [overrideReason, setOverrideReason] = useState('');
  const [decision, setDecision] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useSelected(orgId, orgs, setOrgId);
  useSelected(teamId, teams, setTeamId);
  useSelected(channelId, channels, setChannelId);
  useSelected(categoryId, categories, setCategoryId);
  useEffect(() => {
    if (!agentId || !mappings.some((mapping) => mapping.agent_id === agentId)) {
      setAgentId(mappings[0]?.agent_id ?? '');
    }
  }, [agentId, mappings]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const base = await Promise.all([
        requestJsonWithFallback<{ orgs: Option[] }>({ urls: buildApiCandidates('/orgs', apiBase) }),
        requestJsonWithFallback<{ channels: Option[]; categories: Option[] }>({ urls: buildApiCandidates('/chat/channels', apiBase) }),
      ]);
      setOrgs(base[0].orgs);
      setChannels(base[1].channels);
      setCategories(base[1].categories);
      const selectedOrg = orgId || base[0].orgs[0]?.id;
      if (!selectedOrg) return true;
      const [teamPayload, importPayload, historyPayload, noisePayload] = await Promise.all([
        requestJsonWithFallback<{ teams: Option[] }>({ urls: buildApiCandidates(`/orgs/${encodeURIComponent(selectedOrg)}/teams`, apiBase) }),
        requestJsonWithFallback<{ mappings: Mapping[] }>({ urls: buildApiCandidates(`/orgs/${encodeURIComponent(selectedOrg)}/agent-imports`, apiBase) }),
        requestJsonWithFallback<{ scopes: Scope[]; grants: Grant[] }>({ urls: buildApiCandidates(`/orgs/${encodeURIComponent(selectedOrg)}/chat-history/access`, apiBase) }),
        requestJsonWithFallback<{ cooldowns: Cooldown[]; mutes: Mute[]; audit: Audit[] }>({ urls: buildApiCandidates(`/orgs/${encodeURIComponent(selectedOrg)}/chat-noise-controls`, apiBase) }),
      ]);
      setTeams(teamPayload.teams);
      setMappings(importPayload.mappings);
      setScopes(historyPayload.scopes);
      setGrants(historyPayload.grants);
      setCooldowns(noisePayload.cooldowns);
      setMutes(noisePayload.mutes);
      setAudit(noisePayload.audit);
      return true;
    } catch (requestError) {
      setError(toErrorMessage(requestError, 'Unable to load communication controls.'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [apiBase, orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedChannel = useMemo(() => channels.find((channel) => channel.id === channelId), [channelId, channels]);
  useEffect(() => {
    if (selectedChannel?.category_id) setCategoryId(selectedChannel.category_id);
  }, [selectedChannel]);

  const mutate = async (path: string, init: RequestInit, success?: (payload: any) => void) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = await requestJsonWithFallback({ urls: buildApiCandidates(path, apiBase), init });
      success?.(payload);
      setNotice(await refreshedMutationNotice(refresh));
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const activeGrant = grants.find((grant) => grant.channel_id === channelId && grant.agent_id === agentId);
  const activeCooldown = cooldowns.find((item) => item.channel_id === channelId && item.agent_id === agentId);
  const channelMute = mutes.find((mute) => mute.scope_type === 'channel' && mute.scope_id === channelId);
  const categoryMute = mutes.find((mute) => mute.scope_type === 'category' && mute.scope_id === categoryId);
  const selectedScope = channelIsScoped(channelId, scopes);
  const categoryScoped = categoryIsScoped(categoryId, channels, scopes);

  return (
    <section className="mc-shell-card border border-[var(--border-secondary)] p-4" aria-busy={busy}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">Scoped history and noise controls</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">Grant/revoke channel and thread inheritance, then configure rate limits, mutes, dry-run suppression, and audited overrides.</div>
        </div>
        <button type="button" onClick={() => void refresh()} className="mc-shell-btn px-3 py-1 text-xs">Refresh</button>
      </div>
      {error ? <div role="alert" className="mt-3 rounded border border-[var(--error)] px-3 py-2 text-xs text-[var(--error)]">{error}</div> : null}
      {notice ? <div role="status" className="mt-3 rounded border border-[var(--success)] px-3 py-2 text-xs text-[var(--success)]">{notice}</div> : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Organization', orgId, setOrgId, orgs],
          ['Team', teamId, setTeamId, teams],
          ['Channel', channelId, setChannelId, channels],
          ['Category', categoryId, setCategoryId, categories],
        ].map(([label, value, setter, options]) => (
          <label key={label as string} className="text-xs text-[var(--text-muted)]">{label as string}
            <select value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} className="mc-shell-input mt-1 min-h-10 w-full px-2 text-sm">
              <option value="">Select</option>
              {(options as Option[]).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
        ))}
        <label className="text-xs text-[var(--text-muted)]">Mapped agent
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)} className="mc-shell-input mt-1 min-h-10 w-full px-2 text-sm">
            <option value="">Select</option>
            {mappings.map((mapping) => <option key={mapping.agent_id} value={mapping.agent_id}>{mapping.external_id}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
          <div className="text-sm font-medium text-[var(--text-primary)]">Chat-history scope</div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Threads inherit the selected channel grant. Ungranted and revoked reads remain denied without revealing resource existence.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy || !orgId || !teamId || !channelId} onClick={() => void mutate(`/orgs/${encodeURIComponent(orgId)}/chat-history/channels/${encodeURIComponent(channelId)}/scope`, json('PUT', { teamId }))} className="mc-shell-btn px-3 py-1.5 text-xs">Save channel scope</button>
            <button type="button" disabled={busy || !agentId || !channelId} onClick={() => void mutate(`/orgs/${encodeURIComponent(orgId)}/chat-history/channels/${encodeURIComponent(channelId)}/agents/${encodeURIComponent(agentId)}`, json('PUT', { teamId }))} className="mc-shell-btn mc-shell-btn-active px-3 py-1.5 text-xs">Grant history</button>
            <button type="button" disabled={busy || !activeGrant || !reason.trim()} onClick={() => void mutate(`/orgs/${encodeURIComponent(orgId)}/chat-history/channels/${encodeURIComponent(channelId)}/agents/${encodeURIComponent(agentId)}`, json('DELETE', { reason }))} className="mc-shell-btn px-3 py-1.5 text-xs text-[var(--error)]">Revoke</button>
          </div>
          <div className="mt-3 text-xs text-[var(--text-muted)]">
            {scopes.some((scope) => scope.channel_id === channelId) ? 'Channel scope saved.' : 'Channel not yet scoped.'} {activeGrant ? 'Agent grant active; channel threads inherit it.' : 'No active agent grant.'}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
          <div className="text-sm font-medium text-[var(--text-primary)]">Rate limit and suppression</div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--text-muted)]">Minimum interval (seconds)
              <input type="number" min="1" max="86400" value={cooldownSeconds} onChange={(event) => setCooldownSeconds(event.target.value)} className="mc-shell-input mt-1 block min-h-10 w-36 px-2 text-sm" />
            </label>
            <button type="button" disabled={busy || !agentId || !channelId || !selectedScope} onClick={() => void mutate(`/orgs/${encodeURIComponent(orgId)}/chat-noise-controls/channels/${encodeURIComponent(channelId)}/agents/${encodeURIComponent(agentId)}/cooldown`, json('PUT', { cooldownSeconds: Number(cooldownSeconds) }))} className="mc-shell-btn px-3 py-1.5 text-xs">Set rate limit</button>
            <button type="button" disabled={busy || !activeCooldown} onClick={() => void mutate(`/orgs/${encodeURIComponent(orgId)}/chat-noise-controls/channels/${encodeURIComponent(channelId)}/agents/${encodeURIComponent(agentId)}/cooldown`, { method: 'DELETE' })} className="mc-shell-btn px-3 py-1.5 text-xs">Clear</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy || !channelId || !selectedScope || !reason.trim()} onClick={() => void mutate(`/orgs/${encodeURIComponent(orgId)}/chat-noise-controls/channels/${encodeURIComponent(channelId)}/mute`, json('PUT', { muted: !channelMute, reason }))} className="mc-shell-btn px-3 py-1.5 text-xs">{channelMute ? 'Unmute channel' : 'Mute channel'}</button>
            <button type="button" disabled={busy || !categoryId || !categoryScoped || !reason.trim()} onClick={() => void mutate(`/orgs/${encodeURIComponent(orgId)}/chat-noise-controls/categories/${encodeURIComponent(categoryId)}/mute`, json('PUT', { muted: !categoryMute, reason }))} className="mc-shell-btn px-3 py-1.5 text-xs">{categoryMute ? 'Unmute category' : 'Mute category'}</button>
          </div>
          {!selectedScope ? <p className="mt-2 text-xs text-[var(--warning)]">Save the selected channel scope before configuring noise controls.</p> : null}
          {categoryId && !categoryScoped ? <p className="mt-2 text-xs text-[var(--warning)]">Scope every channel in this category before applying a category mute.</p> : null}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
        <div className="text-sm font-medium text-[var(--text-primary)]">Suppression and override dry run</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input value={reason} onChange={(event) => setReason(event.target.value)} className="mc-shell-input min-h-10 px-3 text-sm" placeholder="Policy change reason" aria-label="Policy change reason" />
          <input value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} className="mc-shell-input min-h-10 px-3 text-sm" placeholder="Optional operator override reason" aria-label="Operator override reason" />
        </div>
        <button type="button" disabled={busy || !orgId || !categoryId || !channelId || !agentId} onClick={() => void mutate(`/orgs/${encodeURIComponent(orgId)}/chat-noise-controls/evaluate`, json('POST', { categoryId, channelId, agentId, overrideReason }), (payload) => setDecision(payload.decision.allowed ? 'Allowed in dry run; no message sent.' : `Suppressed: ${payload.decision.reason}.`))} className="mc-shell-btn mc-shell-btn-active mt-3 px-3 py-1.5 text-xs">Evaluate policy — no send</button>
        {decision ? <div role="status" className="mt-2 text-xs text-[var(--accent)]">{decision}</div> : null}
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Recent noise-control audit</div>
        <div className="mt-2 max-h-56 space-y-2 overflow-auto">
          {audit.map((event) => (
            <div key={event.id} className="entity-ops-row p-2 text-xs">
              <span className="font-medium text-[var(--text-primary)]">{event.action}</span>
              <span className="ml-2 text-[var(--text-muted)]">{event.agent_id || event.channel_id || event.category_id || 'system'}</span>
              <span className="ml-2 text-[var(--text-secondary)]">{event.reason}</span>
              <time className="ml-2 text-[var(--text-muted)]">{new Date(event.created_at).toLocaleString()}</time>
            </div>
          ))}
          {!audit.length ? <p className="text-xs text-[var(--text-muted)]">No audit events yet.</p> : null}
        </div>
      </div>
    </section>
  );
}
