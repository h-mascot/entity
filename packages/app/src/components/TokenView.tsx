import { useEffect, useState, useCallback } from 'react';

interface TokenSummary {
  total_tokens: number;
  total_cost: number;
  by_source: Array<{ source: string; tokens: number; cost: number }>;
  by_model: Array<{ model: string; tokens: number; cost: number }>;
  by_day: Array<{ date: string; tokens: number; cost: number }>;
}

interface TokenDaily {
  date: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
  source: string;
}

interface TokenSourceInfo {
  source: string;
  last_sync: string | null;
  total_tokens: number;
  sessions: number;
}

interface TokenViewProps {
  apiBase: string;
}

type TimeRange = '7d' | '30d' | '90d';

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toLocaleString();
}

function formatCurrency(num: number): string {
  if (num >= 100) {
    return '$' + num.toFixed(0);
  }
  if (num >= 1) {
    return '$' + num.toFixed(2);
  }
  return '$' + num.toFixed(3);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const SOURCE_COLORS: Record<string, string> = {
  openclaw: '#3b82f6',
  codex: '#10b981',
  'claude-code': '#f59e0b',
  hermes: '#8b5cf6',
};

function getSourceColor(source: string): string {
  return SOURCE_COLORS[source] || '#6b7280';
}

export default function TokenView({ apiBase }: TokenViewProps) {
  const [range, setRange] = useState<TimeRange>('30d');
  const [summary, setSummary] = useState<TokenSummary | null>(null);
  const [daily, setDaily] = useState<TokenDaily[]>([]);
  const [sources, setSources] = useState<TokenSourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, dailyRes, sourcesRes] = await Promise.all([
        fetch(`${apiBase}/api/tokens/summary?range=${range}`),
        fetch(`${apiBase}/api/tokens/daily?from=${getFromDate(range)}&to=${getToDate()}`),
        fetch(`${apiBase}/api/tokens/sources`),
      ]);

      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        setSummary(summaryData);
      }

      if (dailyRes.ok) {
        const dailyData = await dailyRes.json();
        setDaily(dailyData);
      }

      if (sourcesRes.ok) {
        const sourcesData = await sourcesRes.json();
        setSources(sourcesData);
      }
    } catch (error) {
      console.error('Failed to fetch token data:', error);
    } finally {
      setLoading(false);
    }
  }, [apiBase, range]);

  const triggerCollection = async () => {
    setCollecting(true);
    try {
      const res = await fetch(`${apiBase}/api/tokens/collect`, { method: 'POST' });
      if (res.ok) {
        await fetchData();
      }
    } catch (error) {
      console.error('Failed to collect tokens:', error);
    } finally {
      setCollecting(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalTokens = summary?.total_tokens ?? 0;
  const totalCost = summary?.total_cost ?? 0;
  const bySource = summary?.by_source ?? [];
  const byModel = summary?.by_model ?? [];

  const maxDailyTokens = Math.max(...daily.map((d) => d.total_tokens), 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg-primary)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-secondary)] p-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Token Usage</h1>
          <p className="text-xs text-[var(--text-muted)]">Track AI token consumption across all sources</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="mc-shell-card flex rounded-lg bg-[var(--bg-secondary)] p-1">
            {(['7d', '30d', '90d'] as TimeRange[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`mc-shell-btn rounded px-3 py-1 text-xs ${
                  range === r ? 'mc-shell-btn-active bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="mc-shell-btn rounded px-3 py-1 text-xs text-[var(--text-primary)]"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>

          <button
            type="button"
            onClick={triggerCollection}
            disabled={collecting}
            className="mc-shell-btn rounded px-3 py-1 text-xs text-[var(--text-primary)]"
          >
            {collecting ? 'Collecting...' : 'Collect Now'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading && !summary ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center text-[var(--text-muted)]">Loading token data...</div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Total Tokens"
                value={formatNumber(totalTokens)}
                icon="🔢"
                color="#3b82f6"
              />
              <StatCard
                label="Estimated Cost"
                value={formatCurrency(totalCost)}
                icon="💰"
                color="#10b981"
              />
              <StatCard
                label="Sessions Tracked"
                value={sources.reduce((sum, s) => sum + s.sessions, 0).toLocaleString()}
                icon="📊"
                color="#f59e0b"
              />
              <StatCard
                label="Active Sources"
                value={sources.length.toString()}
                icon="🔌"
                color="#8b5cf6"
              />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="mc-shell-card rounded-lg bg-[var(--bg-secondary)] p-4">
                <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Daily Usage</h3>
                {daily.length === 0 ? (
                  <div className="py-8 text-center text-[var(--text-muted)]">No data available</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {daily.slice(0, 14).reverse().map((d) => (
                      <div key={`${d.date}-${d.source}`} className="flex items-center gap-2">
                        <div className="w-16 text-xs text-[var(--text-muted)]">{formatDate(d.date)}</div>
                        <div className="relative flex-1 rounded bg-[var(--bg-tertiary)] p-1">
                          <div
                            className="absolute left-0 top-0 h-full rounded"
                            style={{
                              width: `${(d.total_tokens / maxDailyTokens) * 100}%`,
                              backgroundColor: getSourceColor(d.source),
                              minWidth: '2px',
                            }}
                          />
                          <div className="relative z-10 flex items-center justify-between px-2 py-1">
                            <span className="text-xs text-[var(--text-primary)]">{d.source}</span>
                            <span className="text-xs font-medium text-[var(--text-primary)]">
                              {formatNumber(d.total_tokens)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mc-shell-card rounded-lg bg-[var(--bg-secondary)] p-4">
                <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">By Model</h3>
                {byModel.length === 0 ? (
                  <div className="py-8 text-center text-[var(--text-muted)]">No data available</div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {byModel.map((m) => {
                      const pct = totalTokens > 0 ? (m.tokens / totalTokens) * 100 : 0;
                      return (
                        <div key={m.model} className="flex items-center gap-3">
                          <div className="w-24 truncate text-xs text-[var(--text-muted)]">{m.model}</div>
                          <div className="relative flex-1 rounded bg-[var(--bg-tertiary)] p-1">
                            <div
                              className="absolute left-0 top-0 h-full rounded bg-[var(--accent-primary)]"
                              style={{ width: `${pct}%`, minWidth: '2px' }}
                            />
                          </div>
                          <div className="w-20 text-right text-xs text-[var(--text-primary)]">
                            {formatNumber(m.tokens)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="mc-shell-card rounded-lg bg-[var(--bg-secondary)] p-4">
              <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Data Sources</h3>
              {sources.length === 0 ? (
                <div className="py-8 text-center text-[var(--text-muted)]">No sources configured</div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {sources.map((s) => (
                    <div
                      key={s.source}
                      className="rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium capitalize text-[var(--text-primary)]">{s.source}</span>
                        <div
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: getSourceColor(s.source) }}
                        />
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        <div>{formatNumber(s.total_tokens)} tokens</div>
                        <div>{s.sessions} sessions</div>
                        {s.last_sync && <div>Last sync: {new Date(s.last_sync).toLocaleDateString()}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon: string;
  color: string;
}

function StatCard({ label, value, icon, color }: StatCardProps) {
  return (
    <div className="mc-shell-card rounded-lg bg-[var(--bg-secondary)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)]">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <div className="text-xl font-bold text-[var(--text-primary)]" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function getFromDate(range: TimeRange): string {
  const date = new Date();
  if (range === '7d') {
    date.setDate(date.getDate() - 7);
  } else if (range === '30d') {
    date.setDate(date.getDate() - 30);
  } else if (range === '90d') {
    date.setDate(date.getDate() - 90);
  }
  return date.toISOString().split('T')[0];
}

function getToDate(): string {
  return new Date().toISOString().split('T')[0];
}
