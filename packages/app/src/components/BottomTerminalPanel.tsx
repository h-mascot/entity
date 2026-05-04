import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { runtime } from '../config/runtime';

type TerminalTargetId = 'ada-gw' | 'spock' | 'scotty' | 'mac' | 'enterprise';

interface TerminalTarget {
  id: TerminalTargetId;
  label: string;
  description: string;
  transport: 'local' | 'ssh';
  host: string | null;
  defaultDirectory: string;
}

interface TerminalSessionSummary {
  id: string;
  target: TerminalTargetId;
  targetLabel: string;
  transport: 'local' | 'ssh';
  status: 'starting' | 'running' | 'closed' | 'error';
  createdAt: string;
}

interface TerminalPanelProps {
  isOpen: boolean;
  onToggleOpen: () => void;
}

interface TerminalTargetsResponse {
  targets?: TerminalTarget[];
}

interface CreateSessionResponse {
  session?: TerminalSessionSummary;
  error?: string;
}

interface TerminalEnvelope {
  type: 'terminal:event';
  event: 'session' | 'output' | 'exit' | 'error';
  sessionId: string;
  target: TerminalTargetId;
  payload: unknown;
  emittedAt?: string;
}

const FALLBACK_TARGETS: TerminalTarget[] = [
  {
    id: 'ada-gw',
    label: 'ada-gw',
    description: 'Local shell on the Entity host',
    transport: 'local',
    host: null,
    defaultDirectory: '.',
  },
  {
    id: 'spock',
    label: 'spock',
    description: 'SSH session to the Spock host alias',
    transport: 'ssh',
    host: 'spock',
    defaultDirectory: '~',
  },
  {
    id: 'scotty',
    label: 'scotty',
    description: 'SSH session to the Scotty host alias',
    transport: 'ssh',
    host: 'scotty',
    defaultDirectory: '~',
  },
  {
    id: 'mac',
    label: 'mac',
    description: 'SSH session to the Mac source-of-truth host alias',
    transport: 'ssh',
    host: 'mac',
    defaultDirectory: '~/Code/entity',
  },
  {
    id: 'enterprise',
    label: 'enterprise',
    description: 'SSH session to the enterprise host alias',
    transport: 'ssh',
    host: 'enterprise',
    defaultDirectory: '~',
  },
];

function buildApiUrl(pathname: string): string {
  return `${runtime.apiBase}${pathname}`;
}

function createTerminalTheme() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const styles = window.getComputedStyle(document.documentElement);
  return {
    background: styles.getPropertyValue('--bg-primary').trim() || '#000000',
    foreground: styles.getPropertyValue('--text-secondary').trim() || '#d4d4d4',
    cursor: styles.getPropertyValue('--text-primary').trim() || '#ffffff',
    cursorAccent: styles.getPropertyValue('--bg-primary').trim() || '#000000',
    selectionBackground: styles.getPropertyValue('--surface-accent').trim() || 'rgba(0, 170, 255, 0.16)',
    black: '#050505',
    brightBlack: styles.getPropertyValue('--text-muted').trim() || '#7c7c7c',
    red: styles.getPropertyValue('--error').trim() || '#ff6666',
    green: '#4ade80',
    yellow: '#fbbf24',
    blue: styles.getPropertyValue('--accent').trim() || '#00aaff',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: styles.getPropertyValue('--text-primary').trim() || '#ffffff',
    brightWhite: styles.getPropertyValue('--text-primary').trim() || '#ffffff',
  };
}

function getPayloadRecord(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

export default function BottomTerminalPanel({ isOpen, onToggleOpen }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const sessionRef = useRef<TerminalSessionSummary | null>(null);
  const sessionStartAttemptedRef = useRef(false);

  const [targets, setTargets] = useState<TerminalTarget[]>(FALLBACK_TARGETS);
  const [selectedTarget, setSelectedTarget] = useState<TerminalTargetId>('ada-gw');
  const [socketConnected, setSocketConnected] = useState(false);
  const [session, setSession] = useState<TerminalSessionSummary | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'running' | 'closed' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isLoadingTargets, setIsLoadingTargets] = useState(true);

  sessionRef.current = session;

  const targetOptions = useMemo(() => (targets.length > 0 ? targets : FALLBACK_TARGETS), [targets]);

  const writeBanner = useCallback((message: string) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.writeln('');
    terminal.writeln(`\x1b[38;5;45m${message}\x1b[0m`);
  }, []);

  const sendResize = useCallback(() => {
    const socket = socketRef.current;
    const terminal = terminalRef.current;
    const currentSession = sessionRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !terminal || !currentSession) {
      return;
    }

    socket.send(JSON.stringify({
      type: 'terminal:resize',
      sessionId: currentSession.id,
      cols: terminal.cols,
      rows: terminal.rows,
    }));
  }, []);

  const fitTerminal = useCallback(() => {
    if (!isOpen) {
      return;
    }
    fitAddonRef.current?.fit();
    sendResize();
  }, [isOpen, sendResize]);

  useEffect(() => {
    let cancelled = false;

    async function loadTargets() {
      setIsLoadingTargets(true);
      try {
        const response = await fetch(buildApiUrl('/api/terminal/targets'));
        if (!response.ok) {
          throw new Error(`Unable to load terminal targets (${response.status}).`);
        }
        const data = (await response.json()) as TerminalTargetsResponse;
        if (!cancelled && Array.isArray(data.targets) && data.targets.length > 0) {
          setTargets(data.targets);
          setSelectedTarget((current) =>
            data.targets!.some((target) => target.id === current) ? current : data.targets![0].id,
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load terminal targets.');
          setTargets(FALLBACK_TARGETS);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingTargets(false);
        }
      }
    }

    void loadTargets();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !containerRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.05,
      scrollback: 5000,
      theme: createTerminalTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    fitAddon.fit();
    terminal.focus();

    terminal.onData((data) => {
      const socket = socketRef.current;
      const currentSession = sessionRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || !currentSession) {
        return;
      }

      socket.send(JSON.stringify({
        type: 'terminal:input',
        sessionId: currentSession.id,
        data,
      }));
    });

    const observer = new ResizeObserver(() => {
      fitTerminal();
    });
    observer.observe(containerRef.current);
    resizeObserverRef.current = observer;
    writeBanner('[Entity terminal ready]');

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [fitTerminal, isOpen, writeBanner]);

  useEffect(() => {
    let disposed = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      const socket = new WebSocket(runtime.wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setSocketConnected(true);
        setError(null);
        const currentSession = sessionRef.current;
        if (currentSession) {
          socket.send(JSON.stringify({ type: 'terminal:subscribe', sessionId: currentSession.id }));
        }
      };

      socket.onmessage = (event) => {
        let message: TerminalEnvelope | null = null;
        try {
          message = JSON.parse(event.data as string) as TerminalEnvelope;
        } catch {
          return;
        }
        if (!message || message.type !== 'terminal:event') {
          return;
        }

        const currentSession = sessionRef.current;
        if (!currentSession || message.sessionId !== currentSession.id) {
          return;
        }

        const payload = getPayloadRecord(message.payload);
        if (message.event === 'session') {
          setStatus(currentSession.status === 'error' ? 'error' : 'running');
          fitTerminal();
          return;
        }

        if (message.event === 'output') {
          const data = typeof payload?.data === 'string' ? payload.data : '';
          if (data) {
            terminalRef.current?.write(data);
          }
          return;
        }

        if (message.event === 'exit') {
          setStatus('closed');
          sessionStartAttemptedRef.current = false;
          const exitCode = typeof payload?.code === 'number' ? String(payload.code) : 'closed';
          writeBanner(`[session ended: ${exitCode}]`);
          return;
        }

        if (message.event === 'error') {
          const nextError = typeof payload?.message === 'string' ? payload.message : 'Terminal bridge error.';
          setStatus('error');
          setError(nextError);
          writeBanner(`[error] ${nextError}`);
        }
      };

      socket.onclose = () => {
        setSocketConnected(false);
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connect, 1500);
        }
      };

      socket.onerror = () => {
        setError('Terminal websocket connection failed.');
      };
    };

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
    };
  }, [fitTerminal, writeBanner]);

  const subscribeToSession = useCallback((nextSession: TerminalSessionSummary) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({
      type: 'terminal:subscribe',
      sessionId: nextSession.id,
    }));
  }, []);

  const closeSession = useCallback(async () => {
    const currentSession = sessionRef.current;
    if (!currentSession) {
      return;
    }

    try {
      await fetch(buildApiUrl(`/api/terminal/sessions/${currentSession.id}`), {
        method: 'DELETE',
      });
    } catch {
      // Best effort. Socket ownership cleanup will still close it on disconnect.
    }
  }, []);

  const startSession = useCallback(async (target: TerminalTargetId) => {
    if (isStarting) {
      return;
    }

    setIsStarting(true);
    setStatus('connecting');
    setError(null);
    sessionStartAttemptedRef.current = true;

    const terminal = terminalRef.current;
    if (terminal) {
      terminal.clear();
      terminal.reset();
      writeBanner(`[connecting to ${target}]`);
    }

    if (sessionRef.current) {
      await closeSession();
      setSession(null);
    }

    try {
      const response = await fetch(buildApiUrl('/api/terminal/sessions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ target }),
      });

      const data = (await response.json()) as CreateSessionResponse;
      if (!response.ok || !data.session) {
        throw new Error(data.error ?? `Unable to start ${target} session.`);
      }

      setSession(data.session);
      subscribeToSession(data.session);
      setStatus('running');
      fitTerminal();
    } catch (startError) {
      const nextError = startError instanceof Error ? startError.message : 'Unable to start terminal session.';
      setError(nextError);
      setStatus('error');
      writeBanner(`[error] ${nextError}`);
    } finally {
      setIsStarting(false);
    }
  }, [closeSession, fitTerminal, isStarting, subscribeToSession, writeBanner]);

  useEffect(() => {
    if (!isOpen || sessionStartAttemptedRef.current || isLoadingTargets) {
      return;
    }

    void startSession(selectedTarget);
  }, [isLoadingTargets, isOpen, selectedTarget, startSession]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    fitTerminal();
  }, [fitTerminal, isOpen]);

  const currentTargetMeta = useMemo(
    () => targetOptions.find((target) => target.id === selectedTarget) ?? targetOptions[0] ?? FALLBACK_TARGETS[0],
    [selectedTarget, targetOptions],
  );

  const statusToneClass =
    status === 'running'
      ? 'entity-terminal-chip-success'
      : status === 'error'
        ? 'entity-terminal-chip-error'
        : 'entity-terminal-chip-muted';
  return (
    <div className="border-t border-[var(--border-primary)] bg-[var(--bg-primary)]">
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between px-4 py-2 text-xs text-[var(--text-muted)] transition hover:bg-[var(--bg-tertiary)]"
      >
        <span>Terminal</span>
        <span>{isOpen ? 'Hide' : 'Show'}</span>
      </button>

      <div className={isOpen ? 'border-t border-[var(--border-primary)]' : 'hidden'}>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-xs">
          <span className={`entity-terminal-chip ${socketConnected ? 'entity-terminal-chip-live' : 'entity-terminal-chip-muted'}`}>
            <span
              className={`entity-terminal-dot ${socketConnected ? 'bg-emerald-400' : 'bg-[var(--text-muted)]'}`}
              aria-hidden="true"
            />
            {socketConnected ? 'WS connected' : 'WS reconnecting'}
          </span>
          <span className={`entity-terminal-chip ${statusToneClass}`}>{status}</span>
          <label className="entity-terminal-select-wrap">
            <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Target</span>
            <select
              value={selectedTarget}
              onChange={(event) => setSelectedTarget(event.target.value as TerminalTargetId)}
              className="mc-shell-input rounded-md px-2 py-1 text-xs text-[var(--text-primary)]"
            >
              {targetOptions.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              void startSession(selectedTarget);
            }}
            className="mc-shell-btn entity-terminal-action px-2.5 py-1 text-xs text-[var(--text-primary)]"
            disabled={isStarting}
          >
            {session ? 'Reconnect' : 'Start'}
          </button>
          <div className="entity-terminal-description min-w-0 flex-1 truncate text-[11px] text-[var(--text-muted)]">
            {currentTargetMeta?.description ?? 'Embedded shell'}
          </div>
        </div>

        <div className="entity-terminal-panel px-3 py-2">
          <div className="entity-terminal-meta flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <span className="truncate">
              {session ? `${session.targetLabel} · ${session.transport}` : 'Session not started'}
            </span>
            <span className="truncate">{currentTargetMeta?.defaultDirectory ?? ''}</span>
          </div>
          {error ? (
            <div className="entity-terminal-inline-error mt-2 text-[11px] text-[var(--error)]">
              {error}
            </div>
          ) : null}
          <div
            ref={containerRef}
            className="entity-terminal-surface mt-2 min-h-[15rem] rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)]"
          />
        </div>
      </div>
    </div>
  );
}
