import { useCallback, useEffect, useMemo, useState } from 'react';
import { withApiToken } from '../../lib/http';

interface ActivityAuditSettingsProps {
  apiBase?: string;
}

interface OrgOption {
  id: string;
  name: string;
}

interface TeamOption {
  id: string;
  name: string;
}

interface ActivityRow {
  id: number;
  action: string;
  description: string;
  source: string;
  agent_name: string | null;
  task_id: number | null;
  created_at: string;
}

interface ActivityReportRow {
  count: number;
}

interface ActivityReport {
  totals: { count: number };
  byAction: Array<ActivityReportRow & { action: string }>;
  byActor: Array<ActivityReportRow & { actor: string }>;
  byDay: Array<ActivityReportRow & { day: string }>;
  bySource: Array<ActivityReportRow & { source: string }>;
  byType: Array<ActivityReportRow & { type: string }>;
}

interface UsageReport {
  totals: { runs: number; tokens: number };
  byActor: Array<{ actor: string; runs: number; tokens: number }>;
  byModel: Array<{ model: string; runs: number; tokens: number }>;
  byDay: Array<{ day: string; runs: number; tokens: number }>;
  byEvent: Array<{ event: string; runs: number; tokens: number }>;
}

interface AuditReportEvent {
  id: number;
  orgId: string | null;
  teamId: string | null;
  actor: string;
  actorType: string;
  taskId: number | null;
  eventType: string;
  action: string;
  outcome: 'success' | 'failure' | 'observed';
  description: string;
  createdAt: string;
}

interface AuditReport {
  totals: { events: number; successes: number; failures: number; observed: number };
  events: AuditReportEvent[];
  total: number;
  byOutcome: Array<{ label: string; count: number }>;
  byActor: Array<{ label: string; count: number }>;
}

interface AccessReport {
  totals: { principals: number; activePrincipals: number; grants: number; activeTokens: number };
  principals: Array<{
    id: string;
    displayName: string;
    principalType: string;
    email: string | null;
    status: 'active' | 'disabled';
    grants: Array<{ id: string; role: string; orgId: string | null; teamId: string | null; projectId: number | null; sensitivityCategories: string[] }>;
    tokens: Array<{ id: string; label: string | null; tokenPrefix: string; status: 'active' | 'revoked'; lastUsedAt: string | null; createdAt: string }>;
  }>;
  total: number;
  byOrg: Array<{ label: string; count: number }>;
  byTeam: Array<{ label: string; count: number }>;
  byRole: Array<{ label: string; count: number }>;
}

const PAGE_SIZE = 50;

function apiPath(apiBase: string | undefined, path: string): string {
  return `${apiBase ?? ''}${path}`;
}

function buildActivityQuery(
  filters: { orgId: string; teamId: string; actor: string; source: string; from: string; to: string },
  extra: Record<string, string> = {}
): string {
  const params = new URLSearchParams();
  if (filters.orgId) params.set('orgId', filters.orgId);
  if (filters.teamId) params.set('teamId', filters.teamId);
  if (filters.actor.trim()) params.set('actor', filters.actor.trim());
  if (filters.source && filters.source !== 'any') params.set('source', filters.source);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  for (const [key, value] of Object.entries(extra)) {
    params.set(key, value);
  }
  return params.toString();
}

export default function ActivityAuditSettings({ apiBase = '' }: ActivityAuditSettingsProps) {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [filters, setFilters] = useState({
    orgId: '',
    teamId: '',
    actor: '',
    source: 'any',
    from: '',
    to: '',
  });
  const [appliedQuery, setAppliedQuery] = useState<string>('');
  const [report, setReport] = useState<ActivityReport | null>(null);
  const [usageReport, setUsageReport] = useState<UsageReport | null>(null);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [accessReport, setAccessReport] = useState<AccessReport | null>(null);
  const [reportTab, setReportTab] = useState<'activity' | 'usage' | 'audit' | 'access'>('activity');
  const [accessError, setAccessError] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const orgsRes = await fetch(apiPath(apiBase, '/api/orgs'), withApiToken());
        if (!orgsRes.ok) throw new Error(`orgs ${orgsRes.status}`);
        const orgsJson = await orgsRes.json() as { orgs?: OrgOption[] };
        if (!cancelled) setOrgs(orgsJson.orgs ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load organizations');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (!filters.orgId) {
      setTeams([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const teamsRes = await fetch(
          apiPath(apiBase, `/api/orgs/${encodeURIComponent(filters.orgId)}/teams`),
          withApiToken()
        );
        if (!teamsRes.ok) throw new Error(`teams ${teamsRes.status}`);
        const teamsJson = await teamsRes.json() as { teams?: TeamOption[] };
        if (!cancelled) setTeams(teamsJson.teams ?? []);
      } catch {
        if (!cancelled) setTeams([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, filters.orgId]);

  const loadReport = useCallback(
    async (query: string) => {
      const reportRes = await fetch(
        apiPath(apiBase, `/api/activity-report?${query}`),
        withApiToken()
      );
      if (!reportRes.ok) throw new Error(`activity report ${reportRes.status}`);
      const reportJson = await reportRes.json() as ActivityReport;
      setReport(reportJson);
    },
    [apiBase]
  );

  const loadUsageReport = useCallback(
    async (query: string) => {
      const response = await fetch(apiPath(apiBase, `/api/usage-report?${query}`), withApiToken());
      if (!response.ok) throw new Error(`usage report ${response.status}`);
      setUsageReport(await response.json() as UsageReport);
    },
    [apiBase]
  );

  const loadAuditReport = useCallback(
    async (query: string) => {
      const response = await fetch(apiPath(apiBase, `/api/audit-report?${query}`), withApiToken());
      if (!response.ok) throw new Error(`audit report ${response.status}`);
      setAuditReport(await response.json() as AuditReport);
    },
    [apiBase]
  );

  const loadAccessReport = useCallback(
    async (query: string) => {
      setAccessError(null);
      try {
        const response = await fetch(apiPath(apiBase, `/api/access-report?${query}`), withApiToken());
        if (!response.ok) throw new Error(`access report ${response.status}`);
        setAccessReport(await response.json() as AccessReport);
      } catch (err) {
        setAccessError(err instanceof Error ? err.message : 'Unable to load access report');
      }
    },
    [apiBase]
  );

  const loadActivities = useCallback(
    async (query: string, pageOffset: number) => {
      const activitiesRes = await fetch(
        apiPath(apiBase, `/api/activities?${query}&limit=${PAGE_SIZE}&offset=${pageOffset}`),
        withApiToken()
      );
      if (!activitiesRes.ok) throw new Error(`activities ${activitiesRes.status}`);
      const activitiesJson = await activitiesRes.json() as {
        activities?: ActivityRow[];
        total?: number;
      };
      setActivities(activitiesJson.activities ?? []);
      setTotal(activitiesJson.total ?? activitiesJson.activities?.length ?? 0);
      setOffset(pageOffset);
    },
    [apiBase]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const query = buildActivityQuery(filters);
        await Promise.all([
          loadReport(query),
          loadActivities(query, 0),
          loadUsageReport(query),
          loadAuditReport(query),
        ]);
        if (!cancelled) setAppliedQuery(query);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load activity audit');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Load on mount only; Apply triggers manual reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reportTab === 'access') {
      void loadAccessReport(appliedQuery);
    }
  }, [appliedQuery, loadAccessReport, reportTab]);

  const applyFilters = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = buildActivityQuery(filters);
      await Promise.all([
        loadReport(query),
        loadActivities(query, 0),
        loadUsageReport(query),
        loadAuditReport(query),
      ]);
      setAppliedQuery(query);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load activity audit');
    } finally {
      setLoading(false);
    }
  }, [filters, loadActivities, loadAuditReport, loadReport, loadUsageReport]);

  const clearFilters = useCallback(() => {
    setFilters({ orgId: '', teamId: '', actor: '', source: 'any', from: '', to: '' });
  }, []);

  const changePage = useCallback(
    async (nextOffset: number) => {
      if (nextOffset < 0) return;
      setLoading(true);
      setError(null);
      try {
        await loadActivities(appliedQuery, nextOffset);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load activities');
      } finally {
        setLoading(false);
      }
    },
    [appliedQuery, loadActivities]
  );

  const summary = useMemo(() => {
    const count = report?.totals.count ?? 0;
    const actorCount = report?.byActor.length ?? 0;
    const topAction = report?.byAction[0]?.action ?? '—';
    return { count, actorCount, topAction };
  }, [report]);

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-4">
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">Audit &amp; Activity</div>
        <div className="mb-3 text-xs text-[var(--text-muted)]">
          Filter the workspace activity feed by organization, team, actor, source, and date range.
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-xs text-[var(--text-secondary)]">
            Organization
            <select
              value={filters.orgId}
              onChange={(event) => setFilters((current) => ({ ...current, orgId: event.target.value, teamId: '' }))}
              className="mc-shell-input mt-1 w-full px-2 py-1 text-xs"
            >
              <option value="">All organizations</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[var(--text-secondary)]">
            Team
            <select
              value={filters.teamId}
              disabled={!filters.orgId}
              onChange={(event) => setFilters((current) => ({ ...current, teamId: event.target.value }))}
              className="mc-shell-input mt-1 w-full px-2 py-1 text-xs disabled:opacity-50"
            >
              <option value="">{filters.orgId ? 'All teams' : 'Select an organization first'}</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[var(--text-secondary)]">
            Actor
            <input
              type="text"
              value={filters.actor}
              placeholder="e.g. Ada"
              onChange={(event) => setFilters((current) => ({ ...current, actor: event.target.value }))}
              className="mc-shell-input mt-1 w-full px-2 py-1 text-xs"
            />
          </label>
          <label className="block text-xs text-[var(--text-secondary)]">
            Source
            <select
              value={filters.source}
              onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}
              className="mc-shell-input mt-1 w-full px-2 py-1 text-xs"
            >
              <option value="any">Any source</option>
              <option value="agent">Agent</option>
              <option value="task">Task</option>
            </select>
          </label>
          <label className="block text-xs text-[var(--text-secondary)]">
            From
            <input
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
              className="mc-shell-input mt-1 w-full px-2 py-1 text-xs"
            />
          </label>
          <label className="block text-xs text-[var(--text-secondary)]">
            To
            <input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
              className="mc-shell-input mt-1 w-full px-2 py-1 text-xs"
            />
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void applyFilters()}
            disabled={loading}
            className="mc-shell-btn px-3 py-1 text-xs disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Apply'}
          </button>
          <button
            type="button"
            onClick={clearFilters}
            disabled={loading}
            className="mc-shell-btn px-3 py-1 text-xs disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mc-shell-card flex flex-wrap gap-2 border border-[var(--border-secondary)] p-2" role="tablist" aria-label="Admin reports">
        {([
          ['activity', 'Activity'],
          ['usage', 'Usage'],
          ['audit', 'Audit'],
          ['access', 'Access'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={reportTab === key}
            onClick={() => setReportTab(key)}
            className={`mc-shell-btn px-3 py-1 text-xs ${reportTab === key ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div
          role="alert"
          className="mc-shell-card border border-[var(--border-secondary)] p-4 text-xs text-[var(--text-primary)]"
        >
          Unable to load the activity audit: {error}
        </div>
      ) : null}

      {reportTab === 'activity' && !error ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
            <div className="text-xs text-[var(--text-muted)]">Total activities</div>
            <div className="mt-1 text-lg font-medium text-[var(--text-primary)]">{summary.count}</div>
          </div>
          <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
            <div className="text-xs text-[var(--text-muted)]">Distinct actors</div>
            <div className="mt-1 text-lg font-medium text-[var(--text-primary)]">{summary.actorCount}</div>
          </div>
          <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
            <div className="text-xs text-[var(--text-muted)]">Top action</div>
            <div className="mt-1 truncate text-lg font-medium text-[var(--text-primary)]" title={summary.topAction}>
              {summary.topAction}
            </div>
          </div>
        </div>
      ) : null}

      {reportTab === 'activity' && !error ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
            <div className="mb-2 text-xs font-medium text-[var(--text-primary)]">By actor</div>
            <table className="w-full text-xs text-[var(--text-secondary)]">
              <tbody>
                {(report?.byActor ?? []).map((row) => (
                  <tr key={row.actor} className="border-b border-[var(--border-secondary)] last:border-b-0">
                    <td className="py-1 pr-2">{row.actor}</td>
                    <td className="py-1 text-right text-[var(--text-primary)]">{row.count}</td>
                  </tr>
                ))}
                {!report?.byActor.length ? (
                  <tr>
                    <td className="py-1 text-[var(--text-muted)]">No activity</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
            <div className="mb-2 text-xs font-medium text-[var(--text-primary)]">By day</div>
            <table className="w-full text-xs text-[var(--text-secondary)]">
              <tbody>
                {(report?.byDay ?? []).map((row) => (
                  <tr key={row.day} className="border-b border-[var(--border-secondary)] last:border-b-0">
                    <td className="py-1 pr-2 font-mono">{row.day}</td>
                    <td className="py-1 text-right text-[var(--text-primary)]">{row.count}</td>
                  </tr>
                ))}
                {!report?.byDay.length ? (
                  <tr>
                    <td className="py-1 text-[var(--text-muted)]">No activity</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
            <div className="mb-2 text-xs font-medium text-[var(--text-primary)]">By action</div>
            <table className="w-full text-xs text-[var(--text-secondary)]">
              <tbody>
                {(report?.byAction ?? []).map((row) => (
                  <tr key={row.action} className="border-b border-[var(--border-secondary)] last:border-b-0">
                    <td className="py-1 pr-2 font-mono">{row.action}</td>
                    <td className="py-1 text-right text-[var(--text-primary)]">{row.count}</td>
                  </tr>
                ))}
                {!report?.byAction.length ? (
                  <tr>
                    <td className="py-1 text-[var(--text-muted)]">No activity</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {reportTab === 'usage' && !error ? (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="text-xs text-[var(--text-muted)]">Agent runs</div>
              <div className="mt-1 text-lg font-medium text-[var(--text-primary)]">{usageReport?.totals.runs ?? 0}</div>
            </div>
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="text-xs text-[var(--text-muted)]">Tokens recorded</div>
              <div className="mt-1 text-lg font-medium text-[var(--text-primary)]">{usageReport?.totals.tokens ?? 0}</div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="mb-2 text-xs font-medium text-[var(--text-primary)]">By actor</div>
              <table className="w-full text-xs text-[var(--text-secondary)]"><tbody>
                {(usageReport?.byActor ?? []).map((row) => <tr key={row.actor} className="border-b border-[var(--border-secondary)] last:border-b-0"><td className="py-1 pr-2">{row.actor}</td><td className="py-1 text-right text-[var(--text-primary)]">{row.runs} / {row.tokens}</td></tr>)}
                {!usageReport?.byActor.length ? <tr><td className="py-1 text-[var(--text-muted)]">No usage recorded</td></tr> : null}
              </tbody></table>
            </div>
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="mb-2 text-xs font-medium text-[var(--text-primary)]">By model</div>
              <table className="w-full text-xs text-[var(--text-secondary)]"><tbody>
                {(usageReport?.byModel ?? []).map((row) => <tr key={row.model} className="border-b border-[var(--border-secondary)] last:border-b-0"><td className="py-1 pr-2 font-mono">{row.model}</td><td className="py-1 text-right text-[var(--text-primary)]">{row.runs} / {row.tokens}</td></tr>)}
                {!usageReport?.byModel.length ? <tr><td className="py-1 text-[var(--text-muted)]">No usage recorded</td></tr> : null}
              </tbody></table>
            </div>
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="mb-2 text-xs font-medium text-[var(--text-primary)]">By day</div>
              <table className="w-full text-xs text-[var(--text-secondary)]"><tbody>
                {(usageReport?.byDay ?? []).map((row) => <tr key={row.day} className="border-b border-[var(--border-secondary)] last:border-b-0"><td className="py-1 pr-2 font-mono">{row.day}</td><td className="py-1 text-right text-[var(--text-primary)]">{row.runs} / {row.tokens}</td></tr>)}
                {!usageReport?.byDay.length ? <tr><td className="py-1 text-[var(--text-muted)]">No usage recorded</td></tr> : null}
              </tbody></table>
            </div>
          </div>
        </div>
      ) : null}

      {reportTab === 'audit' && !error ? (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            {[
              ['Events', auditReport?.totals.events ?? 0],
              ['Successes', auditReport?.totals.successes ?? 0],
              ['Failures', auditReport?.totals.failures ?? 0],
              ['Observed', auditReport?.totals.observed ?? 0],
            ].map(([label, value]) => <div key={String(label)} className="mc-shell-card border border-[var(--border-secondary)] p-4"><div className="text-xs text-[var(--text-muted)]">{label}</div><div className="mt-1 text-lg font-medium text-[var(--text-primary)]">{value}</div></div>)}
          </div>
          <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
            <div className="mb-2 text-xs font-medium text-[var(--text-primary)]">Audit trail</div>
            <div className="overflow-x-auto"><table className="w-full text-xs text-[var(--text-secondary)]">
              <thead><tr className="border-b border-[var(--border-secondary)] text-left text-[var(--text-muted)]"><th className="py-1 pr-3 font-medium">Time</th><th className="py-1 pr-3 font-medium">Actor</th><th className="py-1 pr-3 font-medium">Event</th><th className="py-1 pr-3 font-medium">Outcome</th><th className="py-1 font-medium">Description</th></tr></thead>
              <tbody>
                {(auditReport?.events ?? []).map((event) => <tr key={event.id} className="border-b border-[var(--border-secondary)] last:border-b-0 align-top"><td className="py-1 pr-3 font-mono whitespace-nowrap">{event.createdAt.replace('T', ' ').slice(0, 19)}</td><td className="py-1 pr-3 text-[var(--text-primary)]">{event.actor}</td><td className="py-1 pr-3 font-mono">{event.eventType || event.action}</td><td className="py-1 pr-3">{event.outcome}</td><td className="py-1">{event.description}</td></tr>)}
                {!auditReport?.events.length ? <tr><td colSpan={5} className="py-2 text-[var(--text-muted)]">No audit events match the current filters.</td></tr> : null}
              </tbody>
            </table></div>
          </div>
        </div>
      ) : null}

      {reportTab === 'access' ? (
        accessError ? (
          <div role="alert" className="mc-shell-card border border-[var(--border-secondary)] p-4 text-xs text-[var(--text-primary)]">Unable to load the access report: {accessError}. Access reports require an admin principal.</div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-4">
              {[
                ['Principals', accessReport?.totals.principals ?? 0],
                ['Active principals', accessReport?.totals.activePrincipals ?? 0],
                ['Grants', accessReport?.totals.grants ?? 0],
                ['Active tokens', accessReport?.totals.activeTokens ?? 0],
              ].map(([label, value]) => <div key={String(label)} className="mc-shell-card border border-[var(--border-secondary)] p-4"><div className="text-xs text-[var(--text-muted)]">{label}</div><div className="mt-1 text-lg font-medium text-[var(--text-primary)]">{value}</div></div>)}
            </div>
            <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
              <div className="mb-2 text-xs font-medium text-[var(--text-primary)]">Users, grants, and credentials</div>
              <div className="overflow-x-auto"><table className="w-full text-xs text-[var(--text-secondary)]">
                <thead><tr className="border-b border-[var(--border-secondary)] text-left text-[var(--text-muted)]"><th className="py-1 pr-3 font-medium">User</th><th className="py-1 pr-3 font-medium">Status</th><th className="py-1 pr-3 font-medium">Scopes</th><th className="py-1 font-medium">Credentials</th></tr></thead>
                <tbody>
                  {(accessReport?.principals ?? []).map((principal) => <tr key={principal.id} className="border-b border-[var(--border-secondary)] last:border-b-0 align-top"><td className="py-1 pr-3 text-[var(--text-primary)]">{principal.displayName}<div className="font-mono text-[10px] text-[var(--text-muted)]">{principal.id}</div></td><td className="py-1 pr-3">{principal.status}</td><td className="py-1 pr-3">{principal.grants.map((grant) => `${grant.role}:${grant.orgId ?? 'global'}${grant.teamId ? `/${grant.teamId}` : ''}`).join(' · ') || 'No grants'}</td><td className="py-1">{principal.tokens.map((token) => `${token.label ?? 'token'} (${token.status})`).join(' · ') || 'None'}</td></tr>)}
                  {!accessReport?.principals.length ? <tr><td colSpan={4} className="py-2 text-[var(--text-muted)]">No access records match the current filters.</td></tr> : null}
                </tbody>
              </table></div>
            </div>
          </div>
        )
      ) : null}

      {reportTab === 'activity' && !error ? (
        <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium text-[var(--text-primary)]">
              Activity {total > 0 ? `${offset + 1}–${Math.min(offset + activities.length, total)} of ${total}` : ''}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void changePage(offset - PAGE_SIZE)}
                disabled={!hasPrev || loading}
                className="mc-shell-btn px-3 py-1 text-xs disabled:opacity-50"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => void changePage(offset + PAGE_SIZE)}
                disabled={!hasNext || loading}
                className="mc-shell-btn px-3 py-1 text-xs disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-[var(--text-secondary)]">
              <thead>
                <tr className="border-b border-[var(--border-secondary)] text-left text-[var(--text-muted)]">
                  <th className="py-1 pr-3 font-medium">Time</th>
                  <th className="py-1 pr-3 font-medium">Actor</th>
                  <th className="py-1 pr-3 font-medium">Action</th>
                  <th className="py-1 pr-3 font-medium">Description</th>
                  <th className="py-1 pr-3 font-medium">Source</th>
                  <th className="py-1 font-medium">Task</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((activity) => (
                  <tr
                    key={activity.id}
                    className="border-b border-[var(--border-secondary)] last:border-b-0 align-top"
                  >
                    <td className="py-1 pr-3 font-mono whitespace-nowrap">
                      {activity.created_at ? activity.created_at.replace('T', ' ').slice(0, 19) : ''}
                    </td>
                    <td className="py-1 pr-3 text-[var(--text-primary)]">{activity.agent_name ?? '—'}</td>
                    <td className="py-1 pr-3 font-mono">{activity.action}</td>
                    <td className="py-1 pr-3">{activity.description}</td>
                    <td className="py-1 pr-3">{activity.source}</td>
                    <td className="py-1">{activity.task_id ?? '—'}</td>
                  </tr>
                ))}
                {!activities.length ? (
                  <tr>
                    <td colSpan={6} className="py-2 text-[var(--text-muted)]">
                      {loading ? 'Loading activity…' : 'No activities match the current filters.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
