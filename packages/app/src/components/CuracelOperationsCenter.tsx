import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http';
import {
  filterCuracelAudit,
  normalizeCuracelOperationsData,
  type CuracelAuditKind,
  type CuracelOperationsData,
} from '../lib/curacelOperationsModel';

type OperationsTab = 'policies' | 'audit' | 'connectors' | 'teams' | 'reliability';

export interface CuracelOperationsCenterProps {
  apiBase?: string;
  orgId?: string;
  teamId?: string;
  initialData?: unknown;
}

const TABS: Array<{ id: OperationsTab; label: string; description: string }> = [
  { id: 'policies', label: 'Policies', description: 'Human review defaults and bypass enforcement' },
  { id: 'audit', label: 'Audit', description: 'Actor, action, approval, output, error, and recovery history' },
  { id: 'connectors', label: 'Connectors', description: 'Safe outbound draft and dry-run integrations' },
  { id: 'teams', label: 'Teams', description: 'Queues, SLAs, approvals, and agent permissions' },
  { id: 'reliability', label: 'Reliability', description: 'Per-agent usage and reliability outcomes' },
];

const AUDIT_KINDS: Array<CuracelAuditKind | 'all'> = ['all', 'action', 'approval', 'output', 'error', 'recovery'];

function readable(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null): string {
  if (!value) return 'No sample yet';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function Chip({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'green' | 'yellow' | 'red' }) {
  return <span className={`entity-ops-chip entity-ops-chip-${tone}`}>{children}</span>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-secondary)] px-4 py-8 text-center" role="status">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="mx-auto mt-1 max-w-lg text-xs text-[var(--text-muted)]">{detail}</p>
    </div>
  );
}

function PoliciesPanel({
  data,
  configure,
  busy,
}: {
  data: CuracelOperationsData;
  configure: () => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {data.policies.map((policy) => (
        <article key={policy.id} className="entity-ops-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="entity-ops-section-title">{readable(policy.area)}</div>
              <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{policy.label}</h3>
            </div>
            <Chip tone="green">Enforced</Chip>
          </div>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Human review</dt>
              <dd className="font-semibold text-[var(--text-primary)]">Required by default</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Direct bypass</dt>
              <dd><Chip tone="red">Blocked</Chip></dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Eligible reviewers</dt>
              <dd className="mt-1 text-[var(--text-secondary)]">{policy.reviewerRoles.join(' · ')}</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-[var(--border-primary)] pt-3 text-[11px] text-[var(--text-muted)]">
            External actions remain pending until an eligible human records a decision.
            {policy.updatedAt ? ` Updated ${formatDate(policy.updatedAt)}.` : ''}
          </p>
        </article>
      ))}
      <div className="entity-ops-panel-strong p-4 lg:col-span-3" role="status">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="red">Bypass blocked</Chip>
              <span className="text-sm font-medium text-[var(--text-primary)]">No agent can approve its own external action.</span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Claims, finance, and customer-facing output fail closed when an approval is missing, expired, or outside scope.
            </p>
          </div>
          <button type="button" className="mc-shell-btn mc-shell-btn-active min-h-10 px-3 text-xs" disabled={busy} onClick={() => void configure()}>
            {busy ? 'Saving…' : 'Save protected policy configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AuditPanel({ data }: { data: CuracelOperationsData }) {
  const [kind, setKind] = useState<CuracelAuditKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [orgFilter, setOrgFilter] = useState(data.orgId);
  const [teamFilter, setTeamFilter] = useState(data.teamId);
  const [agentId, setAgentId] = useState('');
  const [taskId, setTaskId] = useState('');
  const events = useMemo(() => filterCuracelAudit(data.audit, {
    kind,
    query,
    agentId,
    taskId,
    orgId: orgFilter || undefined,
    teamId: teamFilter || undefined,
  }), [agentId, data.audit, kind, orgFilter, query, taskId, teamFilter]);

  return (
    <div>
      <div className="entity-ops-panel grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Audit filters">
        <label className="text-xs text-[var(--text-muted)]">
          Search actor or action
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mc-shell-input mt-1 min-h-10 w-full px-3"
            placeholder="e.g. Atlas or recovered"
          />
        </label>
        <label className="text-xs text-[var(--text-muted)]">
          Event type
          <select value={kind} onChange={(event) => setKind(event.target.value as CuracelAuditKind | 'all')} className="mc-shell-input mt-1 min-h-10 w-full px-3">
            {AUDIT_KINDS.map((option) => <option key={option} value={option}>{readable(option)}</option>)}
          </select>
        </label>
        <label className="text-xs text-[var(--text-muted)]">
          Organization
          <input value={orgFilter} onChange={(event) => setOrgFilter(event.target.value)} className="mc-shell-input mt-1 min-h-10 w-full px-3" placeholder="Organization ID" />
        </label>
        <label className="text-xs text-[var(--text-muted)]">
          Team
          <input value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} className="mc-shell-input mt-1 min-h-10 w-full px-3" placeholder="Team ID" />
        </label>
        <label className="text-xs text-[var(--text-muted)]">
          Agent
          <input value={agentId} onChange={(event) => setAgentId(event.target.value)} className="mc-shell-input mt-1 min-h-10 w-full px-3" placeholder="Agent ID" />
        </label>
        <label className="text-xs text-[var(--text-muted)]">
          Task
          <input value={taskId} onChange={(event) => setTaskId(event.target.value)} className="mc-shell-input mt-1 min-h-10 w-full px-3" placeholder="Task ID" />
        </label>
      </div>

      {events.length ? (
        <ol className="mt-3 space-y-2" aria-label={`${events.length} matching audit events`}>
          {events.map((event) => (
            <li key={event.id} className="entity-ops-row p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={event.kind === 'error' ? 'red' : event.kind === 'recovery' ? 'green' : 'blue'}>{readable(event.kind)}</Chip>
                <span className="text-xs font-semibold text-[var(--text-primary)]">{event.actorName}</span>
                <span className="text-xs text-[var(--text-muted)]">{event.action}</span>
                <time className="ml-auto text-[11px] text-[var(--text-muted)]" dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
              </div>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{event.summary}</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--text-muted)]">
                <span>actor:{event.actorId}</span>
                {event.orgId ? <span>org:{event.orgId}</span> : null}
                {event.teamId ? <span>team:{event.teamId}</span> : null}
                {event.agentId ? <span>agent:{event.agentId}</span> : null}
                {event.taskId ? <span>task:{event.taskId}</span> : null}
                <span>outcome:{event.status}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-3">
          <EmptyState
            title={data.audit.length ? 'No audit events match these filters' : 'No operational history yet'}
            detail={data.audit.length ? 'Clear one or more filters to inspect the complete operator trail.' : 'Actions, approvals, outputs, errors, and recovery receipts will appear here.'}
          />
        </div>
      )}
    </div>
  );
}

function ConnectorsPanel({
  data,
  configure,
  prepareDraft,
  busy,
}: {
  data: CuracelOperationsData;
  configure: () => Promise<void>;
  prepareDraft: (connectorId: string, kind: string) => Promise<void>;
  busy: boolean;
}) {
  return (
    <div>
      <div className="mb-3 entity-ops-panel-strong p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="yellow">Sandbox only</Chip>
              <span className="text-sm font-medium text-[var(--text-primary)]">Outbound delivery is disabled.</span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              These plugins can prepare drafts or dry-run payloads only. They cannot send, and every draft requires human review.
            </p>
          </div>
          <button type="button" className="mc-shell-btn mc-shell-btn-active min-h-10 px-3 text-xs" disabled={busy} onClick={() => void configure()}>
            {busy ? 'Configuring…' : 'Configure all safe connector stubs'}
          </button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {data.connectors.map((connector) => (
          <article key={connector.id} className="entity-ops-panel p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="entity-ops-section-title">{readable(connector.kind)}</div>
                <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{connector.label}</h3>
              </div>
              <Chip tone="red">Disabled</Chip>
            </div>
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-[var(--text-muted)]">Allowed mode</dt>
                <dd className="mt-1 font-medium text-[var(--text-primary)]">{readable(connector.mode)} only</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Review gate</dt>
                <dd className="mt-1 font-medium text-[var(--text-primary)]">Mandatory</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[var(--text-muted)]">Scoped credential reference</dt>
                <dd className="mt-1 break-all rounded bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-secondary)]">
                  {connector.credentialReference}
                </dd>
              </div>
            </dl>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                className="mc-shell-btn mc-shell-btn-active min-h-10 w-full px-3 text-xs"
                disabled={busy || connector.id.endsWith('-draft')}
                onClick={() => void prepareDraft(connector.id, connector.kind)}
              >
                Prepare review-gated sandbox draft
              </button>
              <button type="button" className="mc-shell-btn min-h-10 w-full px-3 text-xs" disabled aria-disabled="true" title="Real sends are disabled in sandbox">
                Send disabled
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function TeamsPanel({
  data,
  configure,
  busy,
}: {
  data: CuracelOperationsData;
  configure: () => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="entity-ops-panel-strong flex flex-wrap items-center justify-between gap-3 p-4 lg:col-span-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Team operating policy</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Persist the minimum Claims, Customer Success, Finance, and AI Ops queues with scoped permissions.</p>
        </div>
        <button type="button" className="mc-shell-btn mc-shell-btn-active min-h-10 px-3 text-xs" disabled={busy} onClick={() => void configure()}>
          {busy ? 'Saving…' : 'Save four team dashboards'}
        </button>
      </div>
      {data.teams.map((team) => (
        <article key={team.id} className="entity-ops-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="entity-ops-section-title">Team workspace</div>
              <h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{team.name}</h3>
            </div>
            <Chip tone={team.queueAtRisk ? 'yellow' : 'green'}>{team.queueAtRisk ? `${team.queueAtRisk} at risk` : 'Within policy'}</Chip>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded bg-[var(--bg-primary)] p-2">
              <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Queue</dt>
              <dd className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{team.queueOpen}</dd>
            </div>
            <div className="rounded bg-[var(--bg-primary)] p-2">
              <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">At risk</dt>
              <dd className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{team.queueAtRisk}</dd>
            </div>
            <div className="rounded bg-[var(--bg-primary)] p-2">
              <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Approvals</dt>
              <dd className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{team.approvalsPending}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-[var(--text-secondary)]"><span className="text-[var(--text-muted)]">SLA:</span> {team.slaLabel}</p>
          <details className="mt-3 border-t border-[var(--border-primary)] pt-3">
            <summary className="entity-ops-focus cursor-pointer text-xs font-medium text-[var(--text-primary)]">Policies and agent permissions</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <h4 className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Policies</h4>
                {team.policies.length ? (
                  <ul className="mt-1 space-y-1 text-xs text-[var(--text-secondary)]">
                    {team.policies.map((policy) => <li key={policy}>• {policy}</li>)}
                  </ul>
                ) : <p className="mt-1 text-xs text-[var(--text-muted)]">No team policy sample yet.</p>}
              </div>
              <div>
                <h4 className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Agent permissions</h4>
                {team.permissions.length ? (
                  <ul className="mt-1 space-y-1 text-xs text-[var(--text-secondary)]">
                    {team.permissions.map((permission) => <li key={permission}>• {permission}</li>)}
                  </ul>
                ) : <p className="mt-1 text-xs text-[var(--text-muted)]">No permission sample yet.</p>}
              </div>
            </div>
          </details>
        </article>
      ))}
    </div>
  );
}

function ReliabilityPanel({
  data,
  recordProof,
  busy,
}: {
  data: CuracelOperationsData;
  recordProof: () => Promise<void>;
  busy: boolean;
}) {
  if (!data.reliability.length) {
    return (
      <div>
        <button type="button" className="mc-shell-btn mc-shell-btn-active mb-3 min-h-10 px-3 text-xs" disabled={busy} onClick={() => void recordProof()}>
          {busy ? 'Recording…' : 'Record sandbox error and recovery samples'}
        </button>
        <EmptyState title="No reliability samples yet" detail="Per-agent volume, outcomes, latency, retries, noise-control events, and reviews will appear after agents run." />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <button type="button" className="mc-shell-btn mc-shell-btn-active min-h-10 px-3 text-xs" disabled={busy} onClick={() => void recordProof()}>
        {busy ? 'Recording…' : 'Record sandbox error and recovery samples'}
      </button>
      {data.reliability.map((agent) => (
        <article key={agent.agentId} className="entity-ops-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="entity-ops-section-title">{agent.agentId}</div>
              <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{agent.agentName}</h3>
            </div>
            <Chip tone={agent.successRate >= 0.95 ? 'green' : agent.successRate >= 0.8 ? 'yellow' : 'red'}>
              {percentage(agent.successRate)} success
            </Chip>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {[
              ['Volume', String(agent.volume)],
              ['Errors', String(agent.errorCount)],
              ['Latency', agent.averageLatencyMs === null ? '—' : `${agent.averageLatencyMs} ms`],
              ['Retries', String(agent.retryCount)],
              ['Mute events', String(agent.muteEvents)],
              ['Rate limits', String(agent.rateLimitEvents)],
              ['Reviews', `${agent.reviewApproved} / ${agent.reviewRejected} / ${agent.reviewPending}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded bg-[var(--bg-primary)] p-2">
                <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[10px] text-[var(--text-muted)]">Reviews shown as approved / rejected / pending.</p>
        </article>
      ))}
    </div>
  );
}

export default function CuracelOperationsCenter({
  apiBase = '',
  orgId = '',
  teamId = '',
  initialData,
}: CuracelOperationsCenterProps) {
  const [activeTab, setActiveTab] = useState<OperationsTab>('policies');
  const [data, setData] = useState<CuracelOperationsData | null>(
    initialData === undefined ? null : normalizeCuracelOperationsData(initialData, { orgId, teamId }),
  );
  const [loading, setLoading] = useState(initialData === undefined);
  const [error, setError] = useState<string | null>(null);
  const [mutation, setMutation] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (orgId) params.set('orgId', orgId);
    if (teamId) params.set('teamId', teamId);
    const suffix = params.size ? `?${params.toString()}` : '';
    try {
      const payload = await requestJsonWithFallback({
        urls: buildApiCandidates(`/curacel/operations${suffix}`, apiBase),
        fallbackError: 'Unable to load Curacel operations data.',
      });
      setData(normalizeCuracelOperationsData(payload, { orgId, teamId }));
      setError(null);
    } catch (requestError) {
      setError(toErrorMessage(requestError, 'Unable to load Curacel operations data.'));
    } finally {
      setLoading(false);
    }
  }, [apiBase, orgId, teamId]);

  useEffect(() => {
    if (initialData !== undefined) {
      setData(normalizeCuracelOperationsData(initialData, { orgId, teamId }));
      setLoading(false);
      setError(null);
      return;
    }
    void refresh();
  }, [initialData, orgId, refresh, teamId]);

  const activeOrgId = data?.orgId || orgId;
  const mutate = useCallback(async (path: string, init: RequestInit) => {
    return requestJsonWithFallback({
      urls: buildApiCandidates(path, apiBase),
      init: {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(init.headers as Record<string, string> | undefined),
        },
      },
      fallbackError: 'Unable to update Curacel operations.',
    });
  }, [apiBase]);

  const runMutation = useCallback(async (label: string, work: () => Promise<void>) => {
    if (!activeOrgId) {
      setError('Choose an organization before changing Curacel operations.');
      return;
    }
    setMutation(label);
    setNotice(null);
    try {
      await work();
      await refresh();
      setError(null);
      setNotice(label);
    } catch (requestError) {
      setError(toErrorMessage(requestError, `Unable to ${label.toLowerCase()}.`));
    } finally {
      setMutation(null);
    }
  }, [activeOrgId, refresh]);

  const configurePolicies = () => runMutation('Protected review policies saved', async () => {
    const definitions = [
      ['claims', ['owner', 'admin', 'claims_lead']],
      ['finance', ['owner', 'admin', 'finance_approver']],
      ['customer_external_communication', ['owner', 'admin', 'customer_success_lead']],
    ] as const;
    await Promise.all(definitions.map(([action, approverRoles]) => mutate(
      `/orgs/${encodeURIComponent(activeOrgId)}/curacel/review-policies/${action}`,
      {
        method: 'PUT',
        body: JSON.stringify({ teamId: teamId || undefined, reviewRequired: true, approverRoles }),
      },
    )));
  });

  const configureConnectors = () => runMutation('Safe connector stubs configured', async () => {
    await Promise.all(['email', 'gmail', 'sms', 'erp', 'ticket'].map((kind) => mutate(
      `/orgs/${encodeURIComponent(activeOrgId)}/curacel/connectors/${kind}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          teamId: teamId || undefined,
          name: `${readable(kind)} sandbox draft`,
          credentialRef: `vault://curacel/${kind}/sandbox`,
          enabled: false,
          mode: 'dry_run',
          reviewRequired: true,
        }),
      },
    )));
  });

  const prepareDraft = (connectorId: string, kind: string) =>
    runMutation(`${readable(kind)} draft prepared for review`, async () => {
      const idempotencyKey = `ui-${kind}-${Date.now()}`;
      await mutate(
        `/orgs/${encodeURIComponent(activeOrgId)}/curacel/connectors/${encodeURIComponent(connectorId)}/drafts`,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
          body: JSON.stringify({
            teamId: teamId || undefined,
            agentId: 'atlas',
            targetRef: `sandbox://${kind}/recipient`,
            payload: {
              subject: `${readable(kind)} sandbox draft`,
              body: 'Dry-run only. Human approval required before any external action.',
            },
            latencyMs: 24,
            retries: 0,
          }),
        },
      );
    });

  const configureTeams = () => runMutation('Four team dashboards saved', async () => {
    const definitions = [
      ['claims', 'claims', 'Claims review queue', 30, ['claims:read', 'claims:draft']],
      ['customer-success', 'customer_success', 'Customer Success queue', 20, ['customers:read', 'communications:draft']],
      ['finance', 'finance', 'Finance approval queue', 60, ['finance:read', 'finance:draft']],
      ['ai-ops', 'ai_ops', 'AI Operations queue', 15, ['agents:observe', 'policies:recommend']],
    ] as const;
    await Promise.all(definitions.map(([id, teamType, queueLabel, approvalSlaMinutes, agentPermissions]) =>
      mutate(`/orgs/${encodeURIComponent(activeOrgId)}/curacel/team-dashboards/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          teamType,
          queueLabel,
          approvalSlaMinutes,
          policies: { external_actions_require_review: true },
          agentPermissions,
        }),
      })));
  });

  const recordReliabilityProof = () => runMutation('Sandbox error and recovery samples recorded', async () => {
    const basePath = `/orgs/${encodeURIComponent(activeOrgId)}/curacel/execution-samples`;
    await mutate(basePath, {
      method: 'POST',
      body: JSON.stringify({
        teamId: teamId || undefined,
        agentId: 'atlas',
        outcome: 'error',
        latencyMs: 850,
        retries: 0,
        muted: true,
        rateLimited: true,
        reviewOutcome: 'rejected',
      }),
    });
    await mutate(basePath, {
      method: 'POST',
      body: JSON.stringify({
        teamId: teamId || undefined,
        agentId: 'atlas',
        outcome: 'success',
        latencyMs: 320,
        retries: 1,
        muted: false,
        rateLimited: false,
        reviewOutcome: 'approved',
        auditCategory: 'recovery',
      }),
    });
  });

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? TABS.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    const nextTab = TABS[nextIndex];
    if (!nextTab) return;
    setActiveTab(nextTab.id);
    document.getElementById(`curacel-operations-tab-${nextTab.id}`)?.focus();
  };

  return (
    <section className="entity-ops-surface min-h-0 w-full overflow-auto p-3 sm:p-5" aria-labelledby="curacel-operations-title">
      <header className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="entity-ops-section-title">Customer readiness</div>
            <h2 id="curacel-operations-title" className="mt-1 text-xl font-semibold text-[var(--text-primary)]">Curacel Operations Center</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
              Review policy, operator history, safe integrations, team controls, and agent reliability in one place.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data?.orgId ? <Chip>Org · {data.orgId}</Chip> : <Chip tone="yellow">Organization discovery</Chip>}
            <button type="button" onClick={() => void refresh()} disabled={loading} className="mc-shell-btn min-h-10 px-3 text-xs">
              {loading ? 'Refreshing…' : 'Refresh data'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--error)]/50 bg-[var(--surface-error)] p-3" role="alert">
            <div>
              <div className="text-sm font-semibold text-[var(--error)]">Operations data unavailable</div>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{error}</p>
            </div>
            <button type="button" onClick={() => void refresh()} className="mc-shell-btn min-h-10 px-3 text-xs">Try again</button>
          </div>
        ) : null}
        {notice ? (
          <div className="mt-4 rounded-lg border border-[var(--success)]/40 bg-[var(--bg-primary)] p-3 text-xs text-[var(--success)]" role="status">
            {notice}. No external delivery was attempted.
          </div>
        ) : null}

        <div className="mt-5 overflow-x-auto pb-1">
          <div className="flex min-w-max gap-1" role="tablist" aria-label="Curacel operations views">
            {TABS.map((tab, index) => (
              <button
                key={tab.id}
                id={`curacel-operations-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`curacel-operations-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`mc-shell-btn min-h-10 px-3 text-xs ${activeTab === tab.id ? 'mc-shell-btn-active' : ''}`}
                title={tab.description}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div
        id={`curacel-operations-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`curacel-operations-tab-${activeTab}`}
        className="mx-auto mt-4 max-w-7xl"
      >
        {loading && !data ? (
          <div className="entity-ops-panel p-6 text-center text-sm text-[var(--text-muted)]" role="status">Loading Operations Center…</div>
        ) : data ? (
          <>
            {activeTab === 'policies' ? <PoliciesPanel data={data} configure={configurePolicies} busy={mutation !== null} /> : null}
            {activeTab === 'audit' ? <AuditPanel data={data} /> : null}
            {activeTab === 'connectors' ? <ConnectorsPanel data={data} configure={configureConnectors} prepareDraft={prepareDraft} busy={mutation !== null} /> : null}
            {activeTab === 'teams' ? <TeamsPanel data={data} configure={configureTeams} busy={mutation !== null} /> : null}
            {activeTab === 'reliability' ? <ReliabilityPanel data={data} recordProof={recordReliabilityProof} busy={mutation !== null} /> : null}
          </>
        ) : !error ? (
          <EmptyState title="No Operations Center data" detail="Choose an organization or refresh to discover its operational controls." />
        ) : null}
      </div>
    </section>
  );
}
