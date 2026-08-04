import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http';
import type { PublicExecutionEngineListItem } from '../lib/executionEnginePublicHealth';
import {
  buildSwarmDispatchPayload,
  buildSwarmOperatorPresets,
  findSwarmOperatorPreset,
  listSelectableSwarmOperatorPresets,
  selectDefaultSwarmOperatorPreset,
  type SwarmOperatorPreset,
} from '../lib/swarmOperatorPresets';
import type { PluginComponentProps } from './plugins/componentRegistry';

interface SwarmJob {
  id: string;
  task_id: number;
  provider: string;
  status: string;
  summary: string | null;
  run_handle?: string | null;
  created_at: string;
  updated_at: string;
  proofs?: SwarmProof[];
}

interface SwarmProof {
  id: string;
  job_id: string;
  proof_type: string;
  proof_ref: string;
  created_at: string;
}

const COLUMNS = [
  { key: 'queued', label: 'Queued', color: 'var(--text-muted)' },
  { key: 'running', label: 'Running', color: 'var(--accent)' },
  { key: 'proof', label: 'Proof', color: '#f59e0b' },
  { key: 'review', label: 'Review', color: '#a855f7' },
  { key: 'done', label: 'Done', color: 'var(--success)' },
  { key: 'failed', label: 'Failed', color: 'var(--error)' },
] as const;

const STATUS_OPTIONS = COLUMNS.map((c) => c.key);

function getEforgeMonitorUrl(job: SwarmJob): string | null {
  if (job.provider !== 'eforge' || !job.run_handle) return null;
  const base = typeof window !== 'undefined'
    ? (window as unknown as Record<string, string>).EFORGE_API_URL || 'http://localhost:4568'
    : 'http://localhost:4568';
  return base.replace(/\/+$/, '');
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString();
  } catch {
    return dateStr;
  }
}

function statusColor(status: string): string {
  const col = COLUMNS.find((c) => c.key === status);
  return col?.color ?? 'var(--text-muted)';
}

/* ─── Detail Panel ─── */
function JobDetailPanel({
  job,
  apiBase,
  onClose,
  onRefresh,
}: {
  job: SwarmJob;
  apiBase: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [detail, setDetail] = useState<SwarmJob>(job);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState(job.summary ?? '');
  const [proofRef, setProofRef] = useState('');
  const [proofType, setProofType] = useState('artifact');
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(() => {
    setLoadingDetail(true);
    requestJsonWithFallback<SwarmJob>({
      urls: buildApiCandidates(`/swarm/jobs/${job.id}`, apiBase),
      fallbackError: 'Unable to load job detail.',
    })
      .then((raw) => {
        if (!raw) return;
        // Handle both { job: {...}, proofs: [...] } and direct {..., proofs: [...]}
        const obj = raw as unknown as Record<string, unknown>;
        const data = obj.job
          ? { ...(obj.job as SwarmJob), proofs: (obj.proofs ?? (obj.job as SwarmJob).proofs ?? []) as SwarmProof[] }
          : raw;
        setDetail(data);
        setError(null);
      })
      .catch((err) => setError(toErrorMessage(err, 'Unable to load job detail.')))
      .finally(() => setLoadingDetail(false));
  }, [apiBase, job.id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const changeStatus = useCallback(
    async (newStatus: string) => {
      try {
        await requestJsonWithFallback({
          urls: buildApiCandidates(`/swarm/jobs/${job.id}`, apiBase),
          init: {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          },
          fallbackError: 'Failed to update status.',
        });
        fetchDetail();
        onRefresh();
      } catch (err) {
        setError(toErrorMessage(err, 'Failed to update status.'));
      }
    },
    [apiBase, fetchDetail, job.id, onRefresh],
  );

  const saveSummary = useCallback(async () => {
    try {
      await requestJsonWithFallback({
        urls: buildApiCandidates(`/swarm/jobs/${job.id}`, apiBase),
        init: {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: summaryDraft }),
        },
        fallbackError: 'Failed to update summary.',
      });
      setEditingSummary(false);
      fetchDetail();
      onRefresh();
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to update summary.'));
    }
  }, [apiBase, fetchDetail, job.id, onRefresh, summaryDraft]);

  const addProof = useCallback(async () => {
    if (!proofRef.trim()) return;
    try {
      await requestJsonWithFallback({
        urls: buildApiCandidates(`/swarm/jobs/${job.id}/proofs`, apiBase),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proof_type: proofType, proof_ref: proofRef }),
        },
        fallbackError: 'Failed to add proof.',
      });
      setProofRef('');
      fetchDetail();
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to add proof.'));
    }
  }, [apiBase, fetchDetail, job.id, proofRef, proofType]);

  const deleteJob = useCallback(async () => {
    try {
      await requestJsonWithFallback({
        urls: buildApiCandidates(`/swarm/jobs/${job.id}`, apiBase),
        init: { method: 'DELETE' },
        fallbackError: 'Failed to delete job.',
      });
      onClose();
      onRefresh();
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to delete job.'));
    }
  }, [apiBase, job.id, onClose, onRefresh]);

  const proofs = detail.proofs ?? [];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="flex-1 bg-black/40" onClick={onClose} />
      {/* Panel */}
      <div className="flex w-[480px] max-w-full flex-col border-l border-[var(--border-secondary)] bg-[var(--bg-primary)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-secondary)] px-5 py-4">
          <div>
            <div className="text-xs text-[var(--text-muted)]">Task #{detail.task_id}</div>
            <h3 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
              {detail.summary || 'Untitled Job'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)]">
              {error}
            </div>
          )}

          {/* Status */}
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Status</div>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => changeStatus(s)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors"
                  style={{
                    borderColor: detail.status === s ? statusColor(s) : 'var(--border-primary)',
                    color: detail.status === s ? statusColor(s) : 'var(--text-muted)',
                    backgroundColor: detail.status === s ? 'var(--bg-tertiary)' : 'transparent',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Summary</span>
              {!editingSummary && (
                <button
                  onClick={() => {
                    setSummaryDraft(detail.summary ?? '');
                    setEditingSummary(true);
                  }}
                  className="text-[10px] text-[var(--accent)] hover:underline"
                >
                  Edit
                </button>
              )}
            </div>
            {editingSummary ? (
              <div className="space-y-2">
                <textarea
                  value={summaryDraft}
                  onChange={(e) => setSummaryDraft(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveSummary}
                    className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingSummary(false)}
                    className="rounded-lg border border-[var(--border-primary)] px-3 py-1 text-xs text-[var(--text-muted)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">
                {detail.summary || <span className="italic text-[var(--text-muted)]">No summary</span>}
              </p>
            )}
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Provider</div>
              <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">
                  {detail.provider}
                  {getEforgeMonitorUrl(detail) && (
                    <a href={getEforgeMonitorUrl(detail)!} target="_blank" rel="noopener" className="ml-2 text-xs text-[var(--accent)] hover:underline">↗ Dashboard</a>
                  )}
                </div>
            </div>
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Job ID</div>
              <div className="mt-1 text-xs font-mono text-[var(--text-secondary)] truncate" title={detail.id}>
                {detail.id.slice(0, 8)}…
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Created</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">{formatDate(detail.created_at)}</div>
            </div>
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Updated</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">{formatDate(detail.updated_at)}</div>
            </div>
          </div>

          {/* Proof Ledger */}
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Proof Ledger ({proofs.length})
            </div>
            {proofs.length > 0 ? (
              <div className="space-y-2">
                {proofs.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2"
                  >
                    <div>
                      <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                        {p.proof_type}
                      </span>
                      <span className="ml-2 text-sm text-[var(--text-secondary)]">{p.proof_ref}</span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)]">{timeAgo(p.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm italic text-[var(--text-muted)]">No proofs yet</p>
            )}
            {/* Add proof */}
            <div className="mt-3 flex items-center gap-2">
              <select
                value={proofType}
                onChange={(e) => setProofType(e.target.value)}
                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--text-secondary)]"
              >
                <option value="artifact">artifact</option>
                <option value="pr">pr</option>
                <option value="commit">commit</option>
                <option value="test">test</option>
                <option value="screenshot">screenshot</option>
              </select>
              <input
                type="text"
                placeholder="Proof ref (URL, SHA, path...)"
                value={proofRef}
                onChange={(e) => setProofRef(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addProof()}
                className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)]"
              />
              <button
                onClick={addProof}
                disabled={!proofRef.trim()}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border-secondary)] px-5 py-3">
          <button
            onClick={deleteJob}
            className="text-xs text-[var(--error)] hover:underline"
          >
            Delete job
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Board ─── */
export default function SwarmBoard({ apiBase = '', plugin }: PluginComponentProps) {
  const [jobs, setJobs] = useState<SwarmJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // THE-932: distinguish a genuinely empty board from a load failure (degraded).
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTaskId, setNewTaskId] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [newSpec, setNewSpec] = useState('');
  const [presets, setPresets] = useState<SwarmOperatorPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<SwarmJob | null>(null);

  const selectablePresets = useMemo(
    () => listSelectableSwarmOperatorPresets(presets),
    [presets],
  );
  const selectedPreset = useMemo(
    () => findSwarmOperatorPreset(presets, selectedPresetId),
    [presets, selectedPresetId],
  );

  const fetchJobs = useCallback(() => {
    requestJsonWithFallback<{ jobs: SwarmJob[] }>({
      urls: buildApiCandidates('/swarm/jobs', apiBase),
      fallbackError: 'Unable to load swarm jobs.',
    })
      .then((data) => {
        setJobs(data?.jobs ?? []);
        setError(null);
        setLoadFailed(false);
      })
      .catch((err) => {
        // THE-932: a load failure is a degraded state, distinct from empty.
        setLoadFailed(true);
        if (jobs.length === 0) setError(toErrorMessage(err, 'Unable to load swarm jobs.'));
      })
      .finally(() => setLoading(false));
  }, [apiBase]);

  const fetchPresets = useCallback(() => {
    setPresetsLoading(true);
    const applyEngines = (engines: PublicExecutionEngineListItem[]) => {
      const next = buildSwarmOperatorPresets(engines);
      setPresets(next);
      setSelectedPresetId((current) => {
        if (current && next.some((p) => p.provider === current && p.selectable)) return current;
        return selectDefaultSwarmOperatorPreset(next)?.provider ?? null;
      });
      setPresetsError(next.length === 0 ? 'No execution engines registered for dispatch.' : null);
    };

    requestJsonWithFallback<{ engines?: PublicExecutionEngineListItem[] }>({
      urls: buildApiCandidates('/swarm/execution-engines', apiBase),
      fallbackError: 'Unable to load execution engines.',
    })
      .then((data) => {
        applyEngines(data?.engines ?? []);
      })
      .catch(async () => {
        try {
          const fallback = await requestJsonWithFallback<{
            providers?: PublicExecutionEngineListItem[];
            engines?: PublicExecutionEngineListItem[];
          }>({
            urls: buildApiCandidates('/swarm/providers', apiBase),
            fallbackError: 'Unable to load swarm providers.',
          });
          applyEngines(fallback?.engines ?? fallback?.providers ?? []);
        } catch (err) {
          setPresets([]);
          setSelectedPresetId(null);
          setPresetsError(toErrorMessage(err, 'Unable to load operator dispatch presets.'));
        }
      })
      .finally(() => setPresetsLoading(false));
  }, [apiBase]);

  useEffect(() => {
    fetchJobs();
    fetchPresets();
    const interval = setInterval(fetchJobs, 10000);
    return () => clearInterval(interval);
  }, [fetchJobs, fetchPresets]);

  const jobsByColumn = useMemo(() => {
    const grouped: Record<string, SwarmJob[]> = {};
    for (const col of COLUMNS) grouped[col.key] = [];
    for (const job of jobs) {
      const col = grouped[job.status] ?? grouped['queued'];
      col.push(job);
    }
    return grouped;
  }, [jobs]);

  const handleCreate = useCallback(async () => {
    const taskId = parseInt(newTaskId, 10);
    if (!taskId && !newSpec.trim()) return;
    if (!selectedPreset) {
      setError('Select a contract-backed operator preset before dispatch.');
      return;
    }
    setCreating(true);
    try {
      const body = buildSwarmDispatchPayload(selectedPreset, {
        taskId: Number.isFinite(taskId) ? taskId : null,
        summary: newSummary,
        spec: newSpec,
      });
      await requestJsonWithFallback({
        urls: buildApiCandidates('/swarm/jobs', apiBase),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        fallbackError: 'Failed to create job.',
      });
      setNewTaskId('');
      setNewSummary('');
      setNewSpec('');
      fetchJobs();
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to create job.'));
    } finally {
      setCreating(false);
    }
  }, [apiBase, fetchJobs, newSummary, newTaskId, newSpec, selectedPreset]);

  const handleStatusChange = useCallback(
    async (e: React.MouseEvent, jobId: string, newStatus: string) => {
      e.stopPropagation(); // Don't open detail panel
      try {
        await requestJsonWithFallback({
          urls: buildApiCandidates(`/swarm/jobs/${jobId}`, apiBase),
          init: {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          },
          fallbackError: 'Failed to update job.',
        });
        fetchJobs();
      } catch (err) {
        setError(toErrorMessage(err, 'Failed to update job.'));
      }
    },
    [apiBase, fetchJobs],
  );

  const totalJobs = jobs.length;
  const activeJobs = jobs.filter((j) => j.status === 'running').length;

  return (
    <div className="h-full overflow-auto p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Swarm Job Board</h2>
          <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
            {totalJobs} jobs
          </span>
          {activeJobs > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-xs text-[var(--accent)]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
              {activeJobs} running
            </span>
          )}
        </div>
        <button
          onClick={fetchJobs}
          className="rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Create Job — contract-backed operator presets (EEPC-B-03) */}
      <div
        className="mb-4 flex flex-col gap-2 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-3"
        data-testid="swarm-operator-presets"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Operator presets
          </span>
          {presetsLoading ? (
            <span className="text-xs text-[var(--text-muted)]" data-testid="swarm-presets-loading">
              Loading engines…
            </span>
          ) : selectablePresets.length === 0 ? (
            <span className="text-xs text-[var(--error)]" data-testid="swarm-presets-empty">
              {presetsError || 'No dispatchable engines under contract.'}
            </span>
          ) : (
            selectablePresets.map((preset) => {
              const selected = selectedPresetId === preset.provider;
              const tone =
                preset.availability === 'ready'
                  ? 'border-[var(--accent)]/50 text-[var(--accent)]'
                  : preset.availability === 'degraded'
                    ? 'border-[#f59e0b]/50 text-[#f59e0b]'
                    : 'border-[var(--border-primary)] text-[var(--text-muted)]';
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`swarm-preset-${preset.provider}`}
                  data-availability={preset.availability}
                  title={preset.healthMessage ?? preset.description}
                  onClick={() => setSelectedPresetId(preset.provider)}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${tone} ${
                    selected
                      ? 'bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/40'
                      : 'bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  <span className="font-medium text-[var(--text-primary)]">{preset.label}</span>
                  <span className="ml-1.5 opacity-80">{preset.statusLabel}</span>
                  {preset.executionMode ? (
                    <span className="ml-1 opacity-60">· {preset.executionMode}</span>
                  ) : null}
                </button>
              );
            })
          )}
          <button
            type="button"
            onClick={fetchPresets}
            className="ml-auto rounded-lg border border-[var(--border-secondary)] px-2 py-1 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]"
          >
            ↻ Engines
          </button>
        </div>
        {selectedPreset && (
          <div
            className="text-xs text-[var(--text-muted)]"
            data-testid="swarm-operator-preset-detail"
            data-provider={selectedPreset.provider}
          >
            {selectedPreset.description}
            {selectedPreset.availability !== 'ready' && selectedPreset.healthMessage ? (
              <span className="ml-2 text-[#f59e0b]">— {selectedPreset.healthMessage}</span>
            ) : null}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="Task ID (optional)"
            value={newTaskId}
            onChange={(e) => setNewTaskId(e.target.value)}
            className="w-32 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]"
          />
          <input
            type="text"
            placeholder="Summary (optional)"
            value={newSummary}
            onChange={(e) => setNewSummary(e.target.value)}
            className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Spec: describe what to build..."
            value={newSpec}
            onChange={(e) => setNewSpec(e.target.value)}
            className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <button
            onClick={handleCreate}
            disabled={
              creating ||
              (!newTaskId && !newSpec.trim()) ||
              !selectedPreset?.selectable ||
              selectablePresets.length === 0
            }
            className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-dim)] disabled:opacity-40"
            data-testid="swarm-dispatch-button"
          >
            {creating ? '...' : '▶ Dispatch'}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="mb-4 flex items-center justify-between rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)] cursor-pointer"
          onClick={() => setError(null)}
          title="Click to dismiss"
        >
          <span>{error}</span>
          <span className="ml-2 text-xs opacity-60">✕</span>
        </div>
      )}

      {/* Kanban Board */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">Loading jobs...</div>
      ) : loadFailed && jobs.length === 0 ? (
        // THE-932: degraded load-failure state — distinct from a genuinely empty board.
        <div
          className="flex flex-col items-center justify-center gap-1 rounded-xl border border-[var(--error)]/40 bg-[var(--surface-error)]/30 px-4 py-16 text-center"
          data-testid="swarm-board-degraded"
        >
          <div className="text-sm font-medium text-[var(--error)]">Swarm board unavailable</div>
          <div className="text-xs text-[var(--text-secondary)]">
            Couldn’t load jobs right now (degraded). Retrying automatically…
          </div>
        </div>
      ) : jobs.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--border-secondary)] px-4 py-16 text-center"
          data-testid="swarm-board-empty"
        >
          <div className="text-sm font-medium text-[var(--text-primary)]">No jobs yet</div>
          <div className="text-xs text-[var(--text-muted)]">Dispatch a job above to populate the board.</div>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 260px)' }}>
          {COLUMNS.map((col) => {
            const colJobs = jobsByColumn[col.key] ?? [];
            return (
              <div
                key={col.key}
                className="flex w-64 min-w-[240px] flex-shrink-0 flex-col rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)]"
              >
                {/* Column header */}
                <div className="flex items-center justify-between border-b border-[var(--border-primary)] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: col.color }} />
                    <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                      {col.label}
                    </span>
                  </div>
                  <span className="rounded-full bg-[var(--bg-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                    {colJobs.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 space-y-2 overflow-y-auto p-2">
                  {colJobs.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[var(--text-muted)]">No jobs</div>
                  ) : (
                    colJobs.map((job) => (
                      <div
                        key={job.id}
                        onClick={() => setSelectedJob(job)}
                        className="cursor-pointer rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 transition-colors hover:border-[var(--accent)]/50 hover:shadow-md"
                      >
                        <div className="flex items-start justify-between">
                          <div className="text-xs text-[var(--text-muted)]">Task #{job.task_id}</div>
                          <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                            {job.provider}
                          </span>
                          {getEforgeMonitorUrl(job) && (
                            <a
                              href={getEforgeMonitorUrl(job)!}
                              target="_blank"
                              rel="noopener"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[10px] text-[var(--accent)] hover:underline"
                            >
                              ↗ eforge
                            </a>
                          )}
                        </div>
                        {job.summary && (
                          <div className="mt-1.5 text-sm text-[var(--text-secondary)] line-clamp-2">{job.summary}</div>
                        )}
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-[10px] text-[var(--text-muted)]">{timeAgo(job.updated_at)}</span>
                          {col.key === 'queued' && (
                            <button
                              onClick={(e) => handleStatusChange(e, job.id, 'running')}
                              className="text-[10px] text-[var(--accent)] hover:underline"
                            >
                              ▶ Start
                            </button>
                          )}
                          {col.key === 'running' && (
                            <button
                              onClick={(e) => handleStatusChange(e, job.id, 'proof')}
                              className="text-[10px] text-[#f59e0b] hover:underline"
                            >
                              → Proof
                            </button>
                          )}
                          {col.key === 'proof' && (
                            <button
                              onClick={(e) => handleStatusChange(e, job.id, 'review')}
                              className="text-[10px] text-[#a855f7] hover:underline"
                            >
                              → Review
                            </button>
                          )}
                          {col.key === 'review' && (
                            <button
                              onClick={(e) => handleStatusChange(e, job.id, 'done')}
                              className="text-[10px] text-[var(--success)] hover:underline"
                            >
                              ✓ Done
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Panel */}
      {selectedJob && (
        <JobDetailPanel
          job={selectedJob}
          apiBase={apiBase}
          onClose={() => setSelectedJob(null)}
          onRefresh={fetchJobs}
        />
      )}
    </div>
  );
}
