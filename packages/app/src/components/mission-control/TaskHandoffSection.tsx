import { useCallback, useEffect, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback } from '../../lib/http';

interface HandoffRecord {
  id: string;
  mode: string;
  source_principal_id: string;
  target_principal_id: string;
  note: string;
  created_at: string;
}

/**
 * THE-933 — Task handoff action + history with generic copy.
 *
 * Generic UI copy (no internal/transport detail), supports local + cloud modes,
 * and surfaces the mode-aware handoff history exposed by the server.
 */
export default function TaskHandoffSection({ taskId, apiBase }: { taskId: number; apiBase?: string }) {
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState<'local' | 'cloud'>('local');
  const [cloudId, setCloudId] = useState('');
  const [note, setNote] = useState('');
  const [handoffs, setHandoffs] = useState<HandoffRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ mode });
    requestJsonWithFallback<{ handoffs?: HandoffRecord[] }>({
      urls: buildApiCandidates(`/tasks/${taskId}/handoffs?${params.toString()}`, apiBase),
      fallbackError: 'Unable to load handoff history.',
    })
      .then((data) => {
        setHandoffs(data?.handoffs ?? []);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load handoff history.'))
      .finally(() => setLoading(false));
  }, [apiBase, mode, taskId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = useCallback(async () => {
    const trimmed = target.trim();
    if (!trimmed) {
      setError('Enter a target principal to hand off to.');
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      await requestJsonWithFallback({
        urls: buildApiCandidates(`/tasks/${taskId}/handoff`, apiBase),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetPrincipalId: trimmed,
            mode,
            cloudId: mode === 'cloud' ? cloudId.trim() || undefined : undefined,
            note: note.trim() || undefined,
          }),
        },
        fallbackError: 'Handoff failed.',
      });
      setTarget('');
      setNote('');
      setStatus('Task handed off.');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Handoff failed.');
    } finally {
      setLoading(false);
    }
  }, [apiBase, cloudId, mode, note, refresh, target, taskId]);

  const rollback = useCallback(
    async (handoffId: string) => {
      setLoading(true);
      setError(null);
      try {
        await requestJsonWithFallback({
          urls: buildApiCandidates(`/tasks/${taskId}/handoffs/${handoffId}/rollback?mode=${mode}`, apiBase),
          init: { method: 'POST' },
          fallbackError: 'Rollback failed.',
        });
        setStatus('Handoff rolled back.');
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Rollback failed.');
      } finally {
        setLoading(false);
      }
    },
    [apiBase, mode, refresh, taskId],
  );

  return (
    <section className="rounded-lg" data-testid="task-handoff-section" aria-labelledby="task-handoff-title">
      <div className="mb-4">
        <h4 id="task-handoff-title" className="text-sm font-semibold text-[var(--text-primary)]">Handoffs</h4>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Review handoff history or transfer this task to another principal.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'local' | 'cloud')}
          className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
          aria-label="Handoff mode"
        >
          <option value="local">Local</option>
          <option value="cloud">Cloud</option>
        </select>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Target principal"
          className="flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
          aria-label="Target principal"
        />
        {mode === 'cloud' ? (
          <input
            value={cloudId}
            onChange={(e) => setCloudId(e.target.value)}
            placeholder="Cloud context id"
            className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
            aria-label="Cloud context id"
          />
        ) : null}
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="mt-2 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
        aria-label="Handoff note"
      />

      <button
        type="button"
        onClick={submit}
        disabled={loading}
        className="mt-2 rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--accent-dim)] disabled:opacity-40"
      >
        {loading ? 'Working…' : 'Hand off'}
      </button>

      {status ? <div className="mt-2 text-xs text-[var(--text-secondary)]">{status}</div> : null}
      {error ? (
        <div className="mt-2 rounded border border-[var(--error)]/40 bg-[var(--surface-error)]/30 px-2 py-1 text-xs text-[var(--error)]">
          {error}
        </div>
      ) : null}

      {loading && handoffs.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-4 text-xs text-[var(--text-muted)]" role="status">
          Loading handoff history…
        </div>
      ) : handoffs.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {handoffs.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
              <span className="truncate">
                {h.source_principal_id || '—'} → {h.target_principal_id}
                {h.note ? <span className="text-[var(--text-muted)]"> · {h.note}</span> : null}
              </span>
              <button
                type="button"
                onClick={() => rollback(h.id)}
                className="text-[10px] text-[var(--text-muted)] hover:underline"
              >
                rollback
              </button>
            </li>
          ))}
        </ul>
      ) : !error ? (
        <div className="mt-3 rounded-lg border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-4 text-xs text-[var(--text-muted)]">
          No local handoffs yet.
        </div>
      ) : null}
    </section>
  );
}
