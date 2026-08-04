import { useCallback, useEffect, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback } from '../../lib/http';

interface ChatNoiseSettings {
  cooldownMs: number;
  mutedAgents: string[];
  backend: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; settings: ChatNoiseSettings }
  | { kind: 'degraded'; reason: string };

/**
 * THE-930 — Agent noise controls status.
 *
 * Surfaces the selected model backend and muted/cooldown/degraded state so the
 * sidebar explains why an agent may be silent without leaking internal detail.
 */
export default function ChatNoiseStatus({ apiBase }: { apiBase?: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const refresh = useCallback(() => {
    requestJsonWithFallback<{ settings?: ChatNoiseSettings }>({
      urls: buildApiCandidates('/chat/noise-settings', apiBase),
      fallbackError: 'Unable to load agent noise settings.',
    })
      .then((data) => {
        const settings = data?.settings;
        if (!settings) {
          setState({ kind: 'degraded', reason: 'Noise settings unavailable.' });
          return;
        }
        setState({ kind: 'ready', settings });
      })
      .catch((error) => {
        setState({
          kind: 'degraded',
          reason: error instanceof Error ? error.message : 'Noise settings unavailable.',
        });
      });
  }, [apiBase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (state.kind === 'loading') {
    return (
      <div className="px-3 pb-1 text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
        Loading agent state…
      </div>
    );
  }

  if (state.kind === 'degraded') {
    return (
      <div
        className="mx-3 mb-1 rounded border border-[var(--error)]/40 bg-[var(--surface-error)]/40 px-2 py-1 text-[10px] text-[var(--text-secondary)]"
        title={state.reason}
      >
        Agent controls unavailable (degraded)
      </div>
    );
  }

  const { backend, mutedAgents, cooldownMs } = state.settings;
  const muted = mutedAgents.length > 0;
  const cooling = cooldownMs > 0;

  // Nothing notable to surface — keep the header clean.
  if (!muted && !cooling) {
    return (
      <div className="px-3 pb-1 text-[10px] text-[var(--text-muted)]">
        Backend: <span className="text-[var(--text-secondary)]">{backend}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1 px-3 pb-1 text-[10px]">
      <span className="text-[var(--text-muted)]">
        Backend: <span className="text-[var(--text-secondary)]">{backend}</span>
      </span>
      {muted ? (
        <span
          className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-secondary)]"
          title={`Muted: ${mutedAgents.join(', ')}`}
        >
          {mutedAgents.length} muted
        </span>
      ) : null}
      {cooling ? (
        <span
          className="rounded bg-[var(--surface-accent)] px-1.5 py-0.5 text-[var(--text-secondary)]"
          title={`Cooldown ${Math.round(cooldownMs / 1000)}s between duplicate replies`}
        >
          cooldown
        </span>
      ) : null}
    </div>
  );
}
