import { useCallback, useEffect, useState } from 'react';

interface AgentStatus {
  lastRun: string | null;
  totalActions: number;
  model: string;
  enabled: boolean;
}

interface AgentLog {
  timestamp: string;
  event: string;
  taskId: number | null;
  taskName: string | null;
  taskAssignee: string | null;
  action: string;
  result: string | null;
  model: string;
  tokensUsed: number;
}

interface TaskMasterSettingsProps {
  apiBase: string;
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const EVENT_STYLES: Record<string, { bg: string; text: string }> = {
  review_check: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  stale_scan: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  manual: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
};

const ACTION_LABELS: Record<string, string> = {
  notify_assignee: '📩 Notified assignee',
  escalate_blocker: '🚨 Escalated blocker',
  validate_output: '🔍 Validated output',
  move_to_done: '✅ Moved to done',
  request_fix: '🔧 Requested fix',
  add_comment: '💬 Added comment',
};

export default function TaskMasterSettings({ apiBase }: TaskMasterSettingsProps) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/agent/status`);
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
  }, [apiBase]);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/agent/log?limit=30`);
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data) ? data : data.entries ?? []);
      }
    } catch { /* ignore */ }
  }, [apiBase]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStatus(), fetchLogs()]).finally(() => setLoading(false));
  }, [fetchStatus, fetchLogs]);

  const trigger = async (event: string) => {
    setTriggering(true);
    setTriggerResult(null);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/agent/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event }),
      });
      const data = await res.json();
      if (res.ok) {
        setTriggerResult(`${data.actions?.length ?? 0} actions — ${data.summary ?? 'done'}`);
        await fetchStatus();
        await fetchLogs();
      } else {
        setError(data.error ?? 'Trigger failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setTriggering(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-xs text-[var(--text-muted)]">Loading Task Master status...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">⚡ Task Master</h3>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            status?.enabled ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {status?.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Model</div>
            <div className="mt-1 text-sm text-[var(--text-primary)]">{status?.model ?? '—'}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Total Actions</div>
            <div className="mt-1 text-sm text-[var(--text-primary)]">{status?.totalActions ?? 0}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Last Run</div>
            <div className="mt-1 text-sm text-[var(--text-primary)]">
              {status?.lastRun ? timeAgo(status.lastRun) : 'Never'}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Scan Interval</div>
            <div className="mt-1 text-sm text-[var(--text-primary)]">30 min</div>
          </div>
        </div>
      </div>

      {/* Trigger Controls */}
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Manual Trigger</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => trigger('manual')} disabled={triggering || !status?.enabled}
            className={`mc-shell-btn px-3 py-1.5 text-xs font-medium ${triggering ? 'opacity-50' : ''}`}>
            {triggering ? 'Running...' : '▶ Run All Checks'}
          </button>
          <button type="button" onClick={() => trigger('review_check')} disabled={triggering || !status?.enabled}
            className={`mc-shell-btn px-3 py-1.5 text-xs ${triggering ? 'opacity-50' : ''}`}>
            Review Check
          </button>
          <button type="button" onClick={() => trigger('stale_scan')} disabled={triggering || !status?.enabled}
            className={`mc-shell-btn px-3 py-1.5 text-xs ${triggering ? 'opacity-50' : ''}`}>
            Stale Scan
          </button>
        </div>
        {triggerResult && (
          <div className="mt-2 rounded bg-green-500/10 px-3 py-2 text-xs text-green-400">{triggerResult}</div>
        )}
        {error && (
          <div className="mt-2 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>
        )}
      </div>

      {/* Configuration */}
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Configuration</h3>
        <div className="space-y-2 text-xs text-[var(--text-secondary)]">
          <div className="flex justify-between"><span>Stale threshold (doing)</span><span className="text-[var(--text-primary)]">24 hours</span></div>
          <div className="flex justify-between"><span>Stale threshold (review)</span><span className="text-[var(--text-primary)]">48 hours</span></div>
          <div className="flex justify-between"><span>Max actions per scan</span><span className="text-[var(--text-primary)]">10</span></div>
          <div className="flex justify-between"><span>Provider</span><span className="text-[var(--text-primary)]">Google (Gemini)</span></div>
        </div>
        <div className="mt-3 text-[11px] text-[var(--text-muted)]">
          Configure via env vars: ENTITY_AGENT_ENABLED, ENTITY_AGENT_MODEL
        </div>
      </div>

      {/* Agent Logs */}
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Recent Logs</h3>
          <button type="button" onClick={() => { fetchLogs(); }} className="mc-shell-btn px-2 py-0.5 text-[11px]">
            Refresh
          </button>
        </div>
        <div className="mt-3 max-h-[400px] space-y-1 overflow-auto">
          {logs.length === 0 && (
            <div className="text-xs text-[var(--text-muted)]">No logs yet</div>
          )}
          {logs.map((log, i) => {
            const isExpanded = expandedLog === i;
            const style = EVENT_STYLES[log.event] ?? { bg: 'bg-gray-500/20', text: 'text-gray-400' };
            const actionLabel = ACTION_LABELS[log.action] ?? log.action;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setExpandedLog(isExpanded ? null : i)}
                className="w-full cursor-pointer rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-2 text-left transition-colors hover:border-[var(--border-primary)]"
              >
                {/* Header row */}
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${style.bg} ${style.text}`}>
                      {log.event.replace('_', ' ')}
                    </span>
                    {log.taskId && (
                      <span className="text-[var(--text-muted)]">#{log.taskId}</span>
                    )}
                    {log.taskAssignee && (
                      <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                        → {log.taskAssignee}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 text-[var(--text-muted)]">
                    <span>{timeAgo(log.timestamp)}</span>
                    <span className="text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                  </span>
                </div>

                {/* Task name + action */}
                <div className="mt-1 text-xs text-[var(--text-primary)]">{actionLabel}</div>
                {log.taskName && (
                  <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                    📋 {log.taskName}
                  </div>
                )}

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="mt-2 space-y-1 border-t border-[var(--border-secondary)] pt-2">
                    {log.result && (
                      <div className="text-xs text-[var(--text-secondary)]">
                        <span className="text-[var(--text-muted)]">Result:</span> {log.result}
                      </div>
                    )}
                    <div className="flex gap-4 text-[10px] text-[var(--text-muted)]">
                      <span>Model: {log.model}</span>
                      {log.tokensUsed > 0 && <span>{log.tokensUsed.toLocaleString()} tokens</span>}
                      <span>{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
