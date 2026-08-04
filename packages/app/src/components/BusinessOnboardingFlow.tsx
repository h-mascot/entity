import { useEffect, useMemo, useState } from 'react';
import { runtime } from '../config/runtime';
import { buildApiCandidates, requestJsonWithFallback } from '../lib/http';
import { loadAdminRuntimeSettings } from '../lib/adminRuntimeSettings';
import { resolveBusinessDomainCatalog } from './businessOnboardingCatalog';

type BusinessDomainId =
  | 'claims-ops'
  | 'engineering-devops'
  | 'product'
  | 'sales-bd'
  | 'marketing'
  | 'finance'
  | 'customer-success'
  | 'people-ops'
  | 'health-business'
  | 'ai-ops'
  | 'other';

type WizardStep = 'fork' | 'identity' | 'domains' | 'mission' | 'blueprint' | 'agents';

type BusinessDomain = {
  id: BusinessDomainId;
  label: string;
  teamName: string;
  description: string;
  seedProject: string;
  seedTasks: string[];
  mappedAgent?: string;
};

type OnboardingOrg = {
  id: string;
  name: string;
  slug: string;
  mission: string | null;
  domains_json: string;
  blueprint_json: string | null;
};

type BlueprintAgentAssignment = {
  domainId: BusinessDomainId;
  teamName: string;
  agentName: string;
  agentPrincipalId: string;
  functionLabel: string;
  registryStatus: 'matched' | 'named-existing-agent';
};

type BlueprintTeam = {
  domainId: BusinessDomainId;
  domainLabel: string;
  teamId: string;
  teamName: string;
  projectId: number;
  projectName: string;
  seedTaskIds: number[];
  assignedAgent?: BlueprintAgentAssignment;
};

type BusinessBlueprint = {
  schemaVersion: 1;
  orgId: string;
  orgName: string;
  mission: string;
  domains: BusinessDomainId[];
  teams: BlueprintTeam[];
  agentAssignments: BlueprintAgentAssignment[];
  generatedAt: string;
  confirmedAt?: string;
};

type StartResponse = { org: OnboardingOrg; domains: BusinessDomain[] };
type CatalogResponse = { domains: BusinessDomain[] };
type ProvisionResponse = { org: OnboardingOrg; blueprint: BusinessBlueprint };
type ConfirmResponse = { org: OnboardingOrg; blueprint: BusinessBlueprint; confirmed: true };

interface BusinessOnboardingFlowProps {
  apiBase?: string;
  onComplete?: (payload: ConfirmResponse) => void;
  onBackToWorkspace?: () => void;
}

const FALLBACK_DOMAINS: BusinessDomain[] = [
  {
    id: 'claims-ops',
    label: 'Claims Operations',
    teamName: 'Claims Operations',
    description: 'Claims intake, auto-vetting, ERP sync, review gates, and exceptions.',
    seedProject: 'Claims Control Room',
    seedTasks: ['Define claims intake SLA', 'Map human sign-off gates', 'Review ERP sync exceptions'],
  },
  {
    id: 'engineering-devops',
    label: 'Engineering / DevOps',
    teamName: 'Engineering / DevOps',
    description: 'PR hygiene, releases, cron heartbeats, incident loops, and platform reliability.',
    seedProject: 'Engineering Reliability',
    seedTasks: ['Define release guardrails', 'Set stale-PR watcher rules', 'Map production incident handoffs'],
  },
  {
    id: 'product',
    label: 'Product',
    teamName: 'Product',
    description: 'Roadmaps, experiments, issue summaries, sprint KPIs, and competitor signal.',
    seedProject: 'Product Operating System',
    seedTasks: ['Summarize current product bets', 'Define experiment signal cadence', 'Create first roadmap review'],
    mappedAgent: 'Atlas → Product',
  },
  {
    id: 'sales-bd',
    label: 'Sales / BD',
    teamName: 'Commercial',
    description: 'Pipeline, partner motion, deal SLAs, outreach drafts, and buyer intelligence.',
    seedProject: 'Commercial Engine',
    seedTasks: ['Define ICP and pipeline stages', 'Map deal-SLA alerts', 'Draft first partner follow-up loop'],
    mappedAgent: 'Mafa → Commercial',
  },
  {
    id: 'marketing',
    label: 'Marketing',
    teamName: 'Marketing',
    description: 'Market intel, lead-gen reports, content calendars, launch assets, and campaigns.',
    seedProject: 'Market Intelligence',
    seedTasks: ['Set weekly market digest cadence', 'Create content backlog', 'Map lead-gen report inputs'],
  },
  {
    id: 'finance',
    label: 'Finance',
    teamName: 'Finance',
    description: 'Reimbursements, payout reporting, approvals, invoices, and compliance reminders.',
    seedProject: 'Finance Approvals',
    seedTasks: ['Define reimbursement intake', 'Map approval thresholds', 'Create payout report checklist'],
    mappedAgent: 'Kashy → Finance',
  },
  {
    id: 'customer-success',
    label: 'Customer Success',
    teamName: 'Customer Success',
    description: 'Issue triage, customer health, resolution tracking, data checks, and escalations.',
    seedProject: 'Customer Issue Triage',
    seedTasks: ['Define daily CS triage queue', 'Map escalation rules', 'Create resolution reporting loop'],
    mappedAgent: 'Sabi → Customer Success',
  },
  {
    id: 'people-ops',
    label: 'People Ops',
    teamName: 'People Ops',
    description: 'Daily briefs, standups, recruiting pipeline, OKRs, and 1:1 follow-through.',
    seedProject: 'People Rhythm',
    seedTasks: ['Define daily brief cadence', 'Map recruiting stages', 'Create OKR follow-up loop'],
  },
  {
    id: 'health-business',
    label: 'Health Business',
    teamName: 'Health Business',
    description: 'Churn-risk scoring, early-warning alerts, account health, and health-market ops.',
    seedProject: 'Health Growth Signals',
    seedTasks: ['Define churn-risk indicators', 'Map early-warning alert path', 'Create account-health review'],
  },
  {
    id: 'ai-ops',
    label: 'AI Ops',
    teamName: 'AI Ops',
    description: 'Agent fleet adoption, cost monitoring, model/provider health, and config changes.',
    seedProject: 'Agent Fleet Control',
    seedTasks: ['Map agent registry ownership', 'Define provider health checks', 'Create cost-monitoring cadence'],
  },
  {
    id: 'other',
    label: 'Other',
    teamName: 'Other',
    description: 'A holding team for work outside the closed taxonomy.',
    seedProject: 'General Operations',
    seedTasks: ['Clarify operating domain', 'Define initial owner', 'Create first operating checklist'],
  },
];

const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: 'fork', label: 'Fork' },
  { id: 'identity', label: 'Org' },
  { id: 'domains', label: 'Domains' },
  { id: 'mission', label: 'Goal' },
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'agents', label: 'Agents' },
];

function stepIndex(step: WizardStep): number {
  return STEPS.findIndex((entry) => entry.id === step);
}

function nextStep(step: WizardStep): WizardStep {
  return STEPS[Math.min(stepIndex(step) + 1, STEPS.length - 1)].id;
}

function previousStep(step: WizardStep): WizardStep {
  return STEPS[Math.max(stepIndex(step) - 1, 0)].id;
}

function selectedDomainLabels(domains: BusinessDomain[], selected: BusinessDomainId[]): string {
  if (selected.length === 0) return 'No domains selected yet';
  return selected
    .map((id) => domains.find((domain) => domain.id === id)?.label ?? id)
    .join(', ');
}

function defaultMission(orgName: string): string {
  return orgName
    ? `Coordinate ${orgName}'s agents, teams, and operating cadence from one Entity workspace.`
    : 'Coordinate agents, teams, and operating cadence from one Entity workspace.';
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-[var(--error)]/50 bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--error)]">
      {message}
    </div>
  );
}

export default function BusinessOnboardingFlow({
  apiBase = runtime.apiBase,
  onComplete,
  onBackToWorkspace,
}: BusinessOnboardingFlowProps) {
  const [step, setStep] = useState<WizardStep>('fork');
  const [workspaceType, setWorkspaceType] = useState<'business' | 'personal'>('business');
  const [orgName, setOrgName] = useState('');
  const [mission, setMission] = useState('');
  const [domains, setDomains] = useState<BusinessDomain[]>(FALLBACK_DOMAINS);
  const [catalogDegradedNotice, setCatalogDegradedNotice] = useState<string | null>(null);
  const [selectedDomains, setSelectedDomains] = useState<BusinessDomainId[]>(['product', 'sales-bd', 'customer-success', 'finance']);
  const [org, setOrg] = useState<OnboardingOrg | null>(null);
  const [blueprint, setBlueprint] = useState<BusinessBlueprint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requireProvisionDryRun, setRequireProvisionDryRun] = useState(false);
  const [dryRunPreview, setDryRunPreview] = useState<BusinessBlueprint | null>(null);

  useEffect(() => {
    void loadAdminRuntimeSettings(apiBase).then((settings) => {
      if (settings) {
        setRequireProvisionDryRun(settings.businessOnboarding.requireDryRun);
      }
    });
  }, [apiBase]);
  const activeStepIndex = stepIndex(step);
  const missionDraft = mission.trim() || defaultMission(orgName.trim());
  const selectedDomainsSummary = useMemo(
    () => selectedDomainLabels(domains, selectedDomains),
    [domains, selectedDomains],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await requestJsonWithFallback<CatalogResponse>({
          urls: buildApiCandidates('/onboarding/business/catalog', apiBase),
          fallbackError: 'Unable to load business domain catalog.',
        });
        if (cancelled) return;
        const resolved = resolveBusinessDomainCatalog(response.domains, FALLBACK_DOMAINS, null);
        setDomains(resolved.domains as BusinessDomain[]);
        setCatalogDegradedNotice(resolved.notice);
      } catch (requestError) {
        if (cancelled) return;
        const message = requestError instanceof Error ? requestError.message : 'Unable to load business domain catalog.';
        const resolved = resolveBusinessDomainCatalog(null, FALLBACK_DOMAINS, message);
        setDomains(resolved.domains as BusinessDomain[]);
        setCatalogDegradedNotice(resolved.notice);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const toggleDomain = (domainId: BusinessDomainId) => {
    setSelectedDomains((current) =>
      current.includes(domainId)
        ? current.filter((id) => id !== domainId)
        : [...current, domainId],
    );
  };

  const startBusinessOnboarding = async () => {
    setError(null);
    const name = orgName.trim();
    if (!name) {
      setError('Organization name is required.');
      return;
    }
    setBusy(true);
    try {
      const response = await requestJsonWithFallback<StartResponse>({
        urls: buildApiCandidates('/onboarding/business/start', apiBase),
        fallbackError: 'Unable to create business workspace.',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orgName: name }),
        },
      });
      setOrg(response.org);
      if (response.domains.length > 0) {
        const resolved = resolveBusinessDomainCatalog(response.domains, FALLBACK_DOMAINS, null);
        setDomains(resolved.domains as BusinessDomain[]);
        if (!resolved.degraded) setCatalogDegradedNotice(null);
      }
      if (!mission.trim()) setMission(defaultMission(name));
      setStep('domains');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to create business workspace.');
    } finally {
      setBusy(false);
    }
  };

  const provisionBlueprint = async () => {
    setError(null);
    if (!org) {
      setError('Create the organization before provisioning a blueprint.');
      setStep('identity');
      return;
    }
    if (selectedDomains.length === 0) {
      setError('Select at least one business domain.');
      setStep('domains');
      return;
    }
    setBusy(true);
    try {
      const payload = { domains: selectedDomains, mission: missionDraft };
      if (requireProvisionDryRun && !dryRunPreview) {
        const preview = await requestJsonWithFallback<ProvisionResponse & { dryRun?: boolean }>({
          urls: buildApiCandidates(`/onboarding/business/${encodeURIComponent(org.id)}/provision`, apiBase),
          fallbackError: 'Unable to preview business blueprint.',
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...payload, dryRun: true }),
          },
        });
        setDryRunPreview(preview.blueprint);
        setBlueprint(preview.blueprint);
        setStep('blueprint');
        return;
      }
      const response = await requestJsonWithFallback<ProvisionResponse>({
        urls: buildApiCandidates(`/onboarding/business/${encodeURIComponent(org.id)}/provision`, apiBase),
        fallbackError: 'Unable to provision business blueprint.',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            ...(requireProvisionDryRun ? { dryRunConfirmed: true } : {}),
          }),
        },
      });
      setOrg(response.org);
      setBlueprint(response.blueprint);
      setDryRunPreview(null);
      setStep('blueprint');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to provision business blueprint.');
    } finally {
      setBusy(false);
    }
  };

  const confirmBlueprint = async () => {
    setError(null);
    if (!org) {
      setError('Create the organization before confirming.');
      return;
    }
    setBusy(true);
    try {
      const response = await requestJsonWithFallback<ConfirmResponse>({
        urls: buildApiCandidates(`/onboarding/business/${encodeURIComponent(org.id)}/confirm`, apiBase),
        fallbackError: 'Unable to confirm business blueprint.',
        init: { method: 'POST' },
      });
      onComplete?.(response);
      if (!onComplete && typeof window !== 'undefined') {
        window.history.replaceState({ mode: 'app' }, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate', { state: { mode: 'app' } }));
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to confirm business blueprint.');
    } finally {
      setBusy(false);
    }
  };

  const handlePrimary = () => {
    if (step === 'fork') {
      if (workspaceType === 'personal') {
        onBackToWorkspace?.();
        return;
      }
      setStep('identity');
      return;
    }
    if (step === 'identity') {
      void startBusinessOnboarding();
      return;
    }
    if (step === 'domains') {
      if (selectedDomains.length === 0) {
        setError('Select at least one business domain.');
        return;
      }
      setStep('mission');
      return;
    }
    if (step === 'mission') {
      void provisionBlueprint();
      return;
    }
    if (step === 'blueprint') {
      setStep('agents');
      return;
    }
    void confirmBlueprint();
  };

  const primaryLabel = step === 'fork'
    ? workspaceType === 'business' ? 'Set up business workspace' : 'Continue to personal workspace'
    : step === 'identity'
      ? 'Create organization'
      : step === 'domains'
        ? 'Confirm business domains'
        : step === 'mission'
          ? 'Generate blueprint'
          : step === 'blueprint'
            ? 'Review agent mapping'
            : 'Enter workspace';

  return (
    <div className="entity-onboarding-shell fixed inset-0 flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-secondary)]">
      <header className="onboarding-topbar relative z-10">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Entity Business Onboarding</div>
          <h1 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">Matrix-style operating blueprint</h1>
        </div>
        <div className="hidden items-center gap-2 md:flex" aria-label="Business onboarding progress">
          {STEPS.map((item, index) => (
            <div key={item.id} className="flex items-center gap-2">
              <span
                className={`onboarding-dot ${index < activeStepIndex ? 'onboarding-dot-done' : index === activeStepIndex ? 'onboarding-dot-active' : 'onboarding-dot-idle'}`}
                aria-label={`${item.label} ${index < activeStepIndex ? 'complete' : index === activeStepIndex ? 'current' : 'pending'}`}
              >
                {index < activeStepIndex ? '✓' : index + 1}
              </span>
              {index < STEPS.length - 1 ? <span className="h-px w-8 bg-[var(--border-secondary)]" /> : null}
            </div>
          ))}
        </div>
      </header>

      <main className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="onboarding-card flex min-h-[32rem] flex-col p-6 md:p-8">
          <ErrorBanner message={error} />
          {catalogDegradedNotice ? (
            <div
              role="status"
              className="mt-3 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-muted)]"
            >
              {catalogDegradedNotice}
            </div>
          ) : null}

          {step === 'fork' ? (
            <div className="mt-4 space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Workspace type</p>
                <h2 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">Set up your Entity workspace</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
                  Choose the business path to create an org, domain teams, seed projects, and an operating blueprint. Personal keeps the existing workspace path.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  className={`onboarding-option-card ${workspaceType === 'business' ? 'onboarding-option-card-selected' : ''}`}
                  aria-pressed={workspaceType === 'business'}
                  onClick={() => setWorkspaceType('business')}
                >
                  <span className="onboarding-icon-tile text-3xl">🏢</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">For business</span>
                    <span className="mt-1 block text-lg font-semibold text-[var(--text-primary)]">Agent company</span>
                    <span className="mt-2 block text-sm text-[var(--text-muted)]">Org, focused departments, existing agent mapping, and operating blueprint.</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`onboarding-option-card ${workspaceType === 'personal' ? 'onboarding-option-card-selected' : ''}`}
                  aria-pressed={workspaceType === 'personal'}
                  onClick={() => setWorkspaceType('personal')}
                >
                  <span className="onboarding-icon-tile text-3xl">👤</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">For personal growth</span>
                    <span className="mt-1 block text-lg font-semibold text-[var(--text-primary)]">Personal workspace</span>
                    <span className="mt-2 block text-sm text-[var(--text-muted)]">Skip business setup and enter the existing Entity workspace.</span>
                  </span>
                </button>
              </div>
            </div>
          ) : null}

          {step === 'identity' ? (
            <div className="mt-4 max-w-3xl space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Organization identity</p>
                <h2 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">Name your organization</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                  The org name becomes the root Entity workspace. Domains and the mission are stored on the org for future blueprint regeneration.
                </p>
              </div>
              <label className="block">
                <span className="text-sm font-semibold text-[var(--text-primary)]">Organization name</span>
                <input
                  className="mt-2 w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3 text-base text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  value={orgName}
                  onChange={(event) => setOrgName(event.target.value)}
                  placeholder="Curacel"
                  autoFocus
                />
              </label>
            </div>
          ) : null}

          {step === 'domains' ? (
            <div className="mt-4 space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Business domains</p>
                <h2 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">What does your organization do?</h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
                  Choose from the Curacel-shaped closed vocabulary. Multi-select is intentional: real agent companies span operations, product, commercial, finance, CS, and AI Ops.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {domains.map((domain) => {
                  const selected = selectedDomains.includes(domain.id);
                  return (
                    <button
                      key={domain.id}
                      type="button"
                      className={`onboarding-stage-card ${selected ? 'onboarding-stage-card-selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => toggleDomain(domain.id)}
                    >
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{domain.label}</span>
                      <span className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{domain.description}</span>
                      <span className="mt-4 text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">Seeds {domain.teamName}</span>
                      {domain.mappedAgent ? (
                        <span className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                          Maps {domain.mappedAgent}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {step === 'mission' ? (
            <div className="mt-4 max-w-4xl space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Company goal</p>
                <h2 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">What should Entity drive toward?</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                  One sentence is enough. It guides the org mission, provisioned teams, seed tasks, and the opening blueprint.
                </p>
              </div>
              <textarea
                className="min-h-[9rem] w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3 text-base leading-7 text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                value={mission}
                onChange={(event) => setMission(event.target.value)}
                placeholder={defaultMission(orgName.trim())}
              />
              <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-muted)]">
                Selected domains: <span className="font-medium text-[var(--text-primary)]">{selectedDomainsSummary}</span>
              </div>
            </div>
          ) : null}

          {step === 'blueprint' ? (
            <div className="mt-4 space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Blueprint review</p>
                <h2 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">Starting structure</h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
                  Provision wrote teams, one seed project per domain, and three starter tasks per team. Confirm if this is the structure you want to enter with.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {(blueprint?.teams ?? []).map((team) => (
                  <article key={team.teamId} className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-[var(--accent)]">{team.domainLabel}</div>
                        <h3 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{team.teamName}</h3>
                      </div>
                      <span className="rounded-full border border-[var(--border-secondary)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
                        {team.seedTaskIds.length} tasks
                      </span>
                    </div>
                    <div className="mt-4 text-sm text-[var(--text-secondary)]">Project: {team.projectName}</div>
                    <div className="mt-3 text-sm text-[var(--text-muted)]">
                      Agent: {team.assignedAgent ? `${team.assignedAgent.agentName} → ${team.assignedAgent.functionLabel}` : 'No existing named agent mapped'}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {step === 'agents' ? (
            <div className="mt-4 space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Agent assignment</p>
                <h2 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">Existing agents mapped to teams</h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
                  This MVP maps named agents to provisioned teams. It does not generate new agents or mutate the registry.
                </p>
              </div>
              <div className="space-y-3">
                {(blueprint?.agentAssignments ?? []).map((assignment) => (
                  <div key={`${assignment.domainId}-${assignment.agentPrincipalId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{assignment.agentName} → {assignment.teamName}</div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">Function: {assignment.functionLabel} · Principal: {assignment.agentPrincipalId}</div>
                    </div>
                    <span className="rounded-full border border-[var(--border-secondary)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
                      {assignment.registryStatus === 'matched' ? 'Registry match' : 'Named existing agent'}
                    </span>
                  </div>
                ))}
                {(blueprint?.agentAssignments ?? []).length === 0 ? (
                  <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-muted)]">
                    No existing named agents map to the selected teams yet. Entity will provision teams and projects without creating new agents.
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-auto pt-8">
            <div className="onboarding-actions">
              <button
                type="button"
                className="onboarding-action-secondary"
                disabled={busy || step === 'fork'}
                onClick={() => setStep(previousStep(step))}
              >
                Back
              </button>
              <button type="button" className="onboarding-action-primary" disabled={busy} onClick={handlePrimary}>
                {busy ? 'Working...' : primaryLabel}
              </button>
            </div>
          </div>
        </section>

        <aside className="onboarding-card h-fit p-6">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Blueprint inputs</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Org</dt>
              <dd className="mt-1 text-[var(--text-primary)]">{org?.name || orgName || 'Not created yet'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Domains</dt>
              <dd className="mt-1 text-[var(--text-primary)]">{selectedDomainsSummary}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Mission</dt>
              <dd className="mt-1 text-[var(--text-primary)]">{missionDraft}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Provisioned</dt>
              <dd className="mt-1 text-[var(--text-primary)]">
                {blueprint ? `${blueprint.teams.length} teams · ${blueprint.agentAssignments.length} mapped agents` : 'Blueprint not generated'}
              </dd>
            </div>
          </dl>
        </aside>
      </main>
    </div>
  );
}
