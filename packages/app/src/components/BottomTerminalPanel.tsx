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
  const themeValue = (name: string, fallback = '') => styles.getPropertyValue(name).trim() || fallback;
  const terminalBackground =
    themeValue('--terminal-bg')
    || themeValue('--bg-primary')
    || '#050505';
  const terminalForeground =
    themeValue('--terminal-foreground')
    || themeValue('--text-secondary')
    || '#d4d4d4';
  const terminalCursor =
    themeValue('--terminal-cursor')
    || themeValue('--text-primary')
    || terminalForeground;
  return {
    background: terminalBackground,
    foreground: terminalForeground,
    cursor: terminalCursor,
    cursorAccent: terminalBackground,
    selectionBackground: themeValue('--terminal-selection') || themeValue('--surface-accent') || 'rgba(0, 170, 255, 0.16)',
    black: themeValue('--terminal-black') || '#050505',
    brightBlack: themeValue('--terminal-bright-black') || themeValue('--text-muted') || '#7c7c7c',
    red: themeValue('--terminal-red') || themeValue('--error') || '#ff6666',
    green: themeValue('--terminal-green') || themeValue('--success') || '#4ade80',
    yellow: themeValue('--terminal-yellow') || themeValue('--review-warning') || '#fbbf24',
    blue: themeValue('--terminal-blue') || themeValue('--accent') || '#00aaff',
    magenta: themeValue('--terminal-magenta') || themeValue('--comment-marker') || '#c084fc',
    cyan: themeValue('--terminal-cyan') || themeValue('--accent-dim') || '#22d3ee',
    white: themeValue('--terminal-white') || '#f8fafc',
    brightWhite: themeValue('--terminal-bright-white') || '#ffffff',
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
  const attachWatchdogRef = useRef<number | null>(null);
  const sessionRef = useRef<TerminalSessionSummary | null>(null);
  const sessionStartAttemptedRef = useRef(false);

  const [targets, setTargets] = useState<TerminalTarget[]>(FALLBACK_TARGETS);
  const [selectedTarget, setSelectedTarget] = useState<TerminalTargetId>('ada-gw');
  const [socketConnected, setSocketConnected] = useState(false);
  const [session, setSession] = useState<TerminalSessionSummary | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'running' | 'closed' | 'error'>('idle');
  const [statusDetail, setStatusDetail] = useState('Terminal is idle.');
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isLoadingTargets, setIsLoadingTargets] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  sessionRef.current = session;

  const targetOptions = useMemo(() => (targets.length > 0 ? targets : FALLBACK_TARGETS), [targets]);

  const writeBanner = useCallback((message: string) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.writeln(`\x1b[38;5;45m${message}\x1b[0m`);
  }, []);

  const clearAttachWatchdog = useCallback(() => {
    if (attachWatchdogRef.current !== null) {
      window.clearTimeout(attachWatchdogRef.current);
      attachWatchdogRef.current = null;
    }
  }, []);

  const startAttachWatchdog = useCallback((target: TerminalTargetId) => {
    clearAttachWatchdog();
    attachWatchdogRef.current = window.setTimeout(() => {
      if (status === 'running' || status === 'error') {
        return;
      }
      const message = `No terminal stream arrived for ${target}. Check server terminal logs or reconnect.`;
      setStatus('error');
      setError(message);
      setStatusDetail(message);
      writeBanner(`[error] ${message}`);
    }, 10000);
  }, [clearAttachWatchdog, status, writeBanner]);

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
      fontFamily: '"MesloLGS NF", "MesloLGM Nerd Font Mono", "MesloLGS Nerd Font Mono", "Meslo LG S DZ for Powerline", "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: 11,
      lineHeight: 1,
      letterSpacing: 0,
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
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const syncTheme = () => {
      const terminal = terminalRef.current;
      if (terminal) {
        terminal.options.theme = createTerminalTheme();
      }
    };
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

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
        setStatusDetail('WebSocket connected.');
        const currentSession = sessionRef.current;
        if (currentSession) {
          setStatusDetail(`WebSocket connected; subscribing to ${currentSession.targetLabel}.`);
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
          clearAttachWatchdog();
          const payloadStatus = typeof payload?.status === 'string' ? payload.status : currentSession.status;
          setStatus(payloadStatus === 'error' ? 'error' : 'running');
          setStatusDetail(`PTY stream attached for ${currentSession.targetLabel}.`);
          writeBanner(`[connected to ${currentSession.targetLabel}]`);
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
          setStatusDetail(`Session ended for ${currentSession.targetLabel}.`);
          sessionStartAttemptedRef.current = false;
          const exitCode = typeof payload?.code === 'number' ? String(payload.code) : 'closed';
          writeBanner(`[session ended: ${exitCode}]`);
          return;
        }

        if (message.event === 'error') {
          const nextError = typeof payload?.message === 'string' ? payload.message : 'Terminal bridge error.';
          setStatus('error');
          setError(nextError);
          setStatusDetail(nextError);
          writeBanner(`[error] ${nextError}`);
        }
      };

      socket.onclose = () => {
        setSocketConnected(false);
        setStatusDetail('WebSocket disconnected; reconnecting.');
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connect, 1500);
        }
      };

      socket.onerror = () => {
        const message = 'Terminal websocket connection failed.';
        setError(message);
        setStatusDetail(message);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      clearAttachWatchdog();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
    };
  }, [clearAttachWatchdog, fitTerminal, writeBanner]);

  const subscribeToSession = useCallback((nextSession: TerminalSessionSummary): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setStatusDetail('Session created; waiting for WebSocket before subscribing.');
      return false;
    }

    socket.send(JSON.stringify({
      type: 'terminal:subscribe',
      sessionId: nextSession.id,
    }));
    setStatusDetail(`Subscribing to ${nextSession.targetLabel} terminal stream.`);
    return true;
  }, []);

  const closeSessionById = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      return;
    }

    try {
      await fetch(buildApiUrl(`/api/terminal/sessions/${sessionId}`), {
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
    setStatusDetail(`Requesting ${target} terminal session.`);
    setError(null);
    sessionStartAttemptedRef.current = true;

    const terminal = terminalRef.current;
    if (terminal) {
      terminal.clear();
      terminal.reset();
      writeBanner(`[connecting to ${target}]`);
      writeBanner('[terminal] requesting session from server');
    }

    const previousSession = sessionRef.current;

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
      if (previousSession && previousSession.id !== data.session.id) {
        void closeSessionById(previousSession.id);
      }
      const subscribed = subscribeToSession(data.session);
      setStatus('connecting');
      setStatusDetail(
        subscribed
          ? `Session created; waiting for ${data.session.targetLabel} PTY stream.`
          : 'Session created; waiting for WebSocket reconnect.',
      );
      writeBanner(`[terminal] session ${data.session.id.slice(0, 8)} created`);
      startAttachWatchdog(data.session.target);
      fitTerminal();
    } catch (startError) {
      const nextError = startError instanceof Error ? startError.message : 'Unable to start terminal session.';
      setError(nextError);
      setStatus('error');
      setStatusDetail(nextError);
      writeBanner(`[error] ${nextError}`);
    } finally {
      setIsStarting(false);
    }
  }, [closeSessionById, fitTerminal, isStarting, startAttachWatchdog, subscribeToSession, writeBanner]);

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
  }, [fitTerminal, isFullscreen, isOpen]);

  const currentTargetMeta = useMemo(
    () => targetOptions.find((target) => target.id === selectedTarget) ?? targetOptions[0] ?? FALLBACK_TARGETS[0],
    [selectedTarget, targetOptions],
  );

  const handleClear = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.clear();
  }, []);

  const focusTerminal = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      setStatusDetail('Terminal is not mounted yet.');
      return;
    }

    terminal.focus();
  }, []);

  const handleTargetChange = useCallback((nextTarget: TerminalTargetId) => {
    setSelectedTarget(nextTarget);
    if (!isOpen) {
      sessionStartAttemptedRef.current = false;
      return;
    }

    void startSession(nextTarget);
  }, [isOpen, startSession]);

  const statusToneClass =
    status === 'running'
      ? 'entity-terminal-chip-success'
      : status === 'error'
        ? 'entity-terminal-chip-error'
        : 'entity-terminal-chip-muted';
  return (
    <div className={`entity-terminal-root border-t border-[var(--border-primary)] bg-[var(--bg-primary)] ${isFullscreen ? 'entity-terminal-fullscreen' : ''}`}>
      <button
        type="button"
        onClick={onToggleOpen}
        className="entity-terminal-toggle flex w-full items-center justify-between px-4 py-1.5 text-xs text-[var(--text-muted)] transition hover:bg-[var(--bg-tertiary)]"
      >
        <span>Terminal</span>
        <span>{isOpen ? 'Hide' : 'Show'}</span>
      </button>

      <div className={isOpen ? 'border-t border-[var(--border-primary)]' : 'hidden'}>
        <div className="entity-terminal-shell">
          <div className="entity-terminal-inline-bar">
            <div className="flex min-w-0 items-center gap-2">
              <span className="entity-terminal-title">Terminal</span>
              <span className={`entity-terminal-chip ${socketConnected ? 'entity-terminal-chip-live' : 'entity-terminal-chip-muted'}`}>
                <span
                  className={`entity-terminal-dot ${socketConnected ? 'bg-emerald-400' : 'bg-[var(--text-muted)]'}`}
                  aria-hidden="true"
                />
                {socketConnected ? 'Connected' : 'Reconnecting'}
              </span>
              <span className={`entity-terminal-chip ${statusToneClass}`}>{status}</span>
              <span className="entity-terminal-branch-chip">{currentTargetMeta?.transport ?? 'local'}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <label className="entity-terminal-select-wrap">
                <span className="sr-only">Target</span>
                <select
                  value={selectedTarget}
                  onChange={(event) => handleTargetChange(event.target.value as TerminalTargetId)}
                  className="mc-shell-input entity-terminal-select rounded-md px-2 py-1 text-xs text-[var(--text-primary)]"
                  disabled={isStarting}
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
              <button
                type="button"
                onClick={handleClear}
                className="mc-shell-btn entity-terminal-action px-2.5 py-1 text-xs text-[var(--text-primary)]"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsFullscreen((value) => !value);
                  window.setTimeout(fitTerminal, 0);
                }}
                className="mc-shell-btn entity-terminal-action px-2.5 py-1 text-xs text-[var(--text-primary)]"
                aria-pressed={isFullscreen}
              >
                {isFullscreen ? 'Dock' : 'Full'}
              </button>
            </div>
          </div>

          <div className="entity-terminal-panel">
          <div className="entity-terminal-progress mt-2 text-[11px] text-[var(--text-muted)]">
            {statusDetail}
          </div>
          {error ? (
            <div className="entity-terminal-inline-error mt-2 text-[11px] text-[var(--error)]">
              {error}
            </div>
          ) : null}
            <div
              ref={containerRef}
              role="textbox"
              aria-label="Interactive terminal"
              tabIndex={0}
              onClick={() => {
                focusTerminal();
                if (status === 'running') {
                  setStatusDetail('Terminal focused. Type directly in the terminal.');
                }
              }}
              onPointerDown={() => {
                window.setTimeout(focusTerminal, 0);
              }}
              className="entity-terminal-surface min-h-[15rem] border border-[var(--border-primary)] bg-[var(--bg-primary)]"
            />
          </div>
          <div className="entity-terminal-footer">
            <span className="truncate">{currentTargetMeta?.description ?? 'Embedded shell'}</span>
            <span className="truncate">{currentTargetMeta?.defaultDirectory ?? ''}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
