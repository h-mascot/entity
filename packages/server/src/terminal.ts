import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import type { Express, Request, Response } from 'express';
import { WebSocket } from 'ws';

export type TerminalTargetId = 'ada-gw' | 'spock' | 'scotty' | 'mac' | 'enterprise';
export type TerminalTransport = 'local' | 'ssh';

export interface TerminalTarget {
  id: TerminalTargetId;
  label: string;
  description: string;
  transport: TerminalTransport;
  host: string | null;
  defaultDirectory: string;
}

export interface TerminalSessionSummary {
  id: string;
  target: TerminalTargetId;
  targetLabel: string;
  transport: TerminalTransport;
  status: 'starting' | 'running' | 'closed' | 'error';
  createdAt: string;
}

export interface TerminalLaunchSpec {
  target: TerminalTarget;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface CreateTerminalSessionInput {
  target?: string | null;
  cols?: number | null;
  rows?: number | null;
}

export interface TerminalEventEnvelope<TPayload = unknown> {
  type: 'terminal:event';
  event: 'session' | 'output' | 'exit' | 'error';
  sessionId: string;
  target: TerminalTargetId;
  payload: TPayload;
  emittedAt: string;
}

export interface TerminalBridge {
  listTargets: () => TerminalTarget[];
  createSession: (input?: CreateTerminalSessionInput) => TerminalSessionSummary;
  closeSession: (sessionId: string) => boolean;
  handleSocketConnection: (socket: WebSocket) => void;
}

export interface CreateTerminalBridgeOptions {
  workspaceRoot: string;
  spawnProcess?: typeof spawn;
  now?: () => Date;
  logger?: Pick<Console, 'warn' | 'error'>;
}

interface TerminalSession {
  summary: TerminalSessionSummary;
  process: ChildProcessWithoutNullStreams;
  history: string[];
  subscribers: Set<WebSocket>;
  owner: WebSocket | null;
  cols: number;
  rows: number;
}

interface TerminalRequestBody {
  target?: unknown;
  cols?: unknown;
  rows?: unknown;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const MAX_DIMENSION = 400;
const MAX_HISTORY_CHUNKS = 200;

export const TERMINAL_TARGETS: readonly TerminalTarget[] = [
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
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTargetId(value: unknown): TerminalTargetId | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as TerminalTargetId;
  return TERMINAL_TARGETS.some((target) => target.id === normalized) ? normalized : null;
}

function toDimension(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.floor(Number(parsed));
  if (normalized < 1) {
    return fallback;
  }

  return Math.min(normalized, MAX_DIMENSION);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildBootstrapCommand(target: TerminalTarget, workspaceRoot: string): string {
  const directory = target.transport === 'local' ? workspaceRoot : target.defaultDirectory;
  return `cd ${shellQuote(directory)} 2>/dev/null || cd ~; export TERM=xterm-256color COLORTERM=truecolor; exec /bin/zsh -f`;
}

export function buildTerminalLaunchSpec(
  targetId: TerminalTargetId,
  workspaceRoot: string,
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
): TerminalLaunchSpec {
  const target = TERMINAL_TARGETS.find((entry) => entry.id === targetId);
  if (!target) {
    throw new Error(`Unsupported terminal target: ${targetId}`);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    COLUMNS: String(toDimension(cols, DEFAULT_COLS)),
    LINES: String(toDimension(rows, DEFAULT_ROWS)),
  };
  const bootstrap = buildBootstrapCommand(target, workspaceRoot);

  if (target.transport === 'local') {
    return {
      target,
      command: '/usr/bin/script',
      args: ['-q', '/dev/null', '/bin/zsh', '-fc', bootstrap],
      env,
    };
  }

  return {
    target,
    command: '/usr/bin/ssh',
    args: ['-tt', target.host ?? target.id, bootstrap],
    env,
  };
}

function serializeEvent<TPayload>(
  session: TerminalSessionSummary,
  event: TerminalEventEnvelope<TPayload>['event'],
  payload: TPayload,
): string {
  return JSON.stringify({
    type: 'terminal:event',
    event,
    sessionId: session.id,
    target: session.target,
    payload,
    emittedAt: new Date().toISOString(),
  } satisfies TerminalEventEnvelope<TPayload>);
}

function safeSend<TPayload>(
  socket: WebSocket,
  session: TerminalSessionSummary,
  event: TerminalEventEnvelope<TPayload>['event'],
  payload: TPayload,
): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  try {
    socket.send(serializeEvent(session, event, payload));
  } catch {
    // Ignore transient terminal fanout send failures.
  }
}

export function createTerminalBridge(options: CreateTerminalBridgeOptions): TerminalBridge {
  const spawnProcess = options.spawnProcess ?? spawn;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;
  const sessions = new Map<string, TerminalSession>();
  const socketSessions = new Map<WebSocket, Set<string>>();

  const fanout = <TPayload>(
    session: TerminalSession,
    event: TerminalEventEnvelope<TPayload>['event'],
    payload: TPayload,
  ): void => {
    session.subscribers.forEach((socket) => safeSend(socket, session.summary, event, payload));
  };

  const closeSession = (sessionId: string): boolean => {
    const session = sessions.get(sessionId);
    if (!session) {
      return false;
    }

    sessions.delete(sessionId);
    session.summary.status = 'closed';
    try {
      session.process.stdin.end();
    } catch {
      // No-op.
    }
    try {
      session.process.kill('SIGTERM');
    } catch {
      // No-op.
    }
    fanout(session, 'exit', { code: null, signal: 'SIGTERM' });
    session.subscribers.clear();
    return true;
  };

  const bindSocketToSession = (socket: WebSocket, session: TerminalSession): void => {
    session.subscribers.add(socket);
    if (!session.owner) {
      session.owner = socket;
    }
    const owned = socketSessions.get(socket) ?? new Set<string>();
    owned.add(session.summary.id);
    socketSessions.set(socket, owned);
  };

  const createSession = (input: CreateTerminalSessionInput = {}): TerminalSessionSummary => {
    const targetId = normalizeTargetId(input.target) ?? 'ada-gw';
    const cols = toDimension(input.cols, DEFAULT_COLS);
    const rows = toDimension(input.rows, DEFAULT_ROWS);
    const launch = buildTerminalLaunchSpec(targetId, options.workspaceRoot, cols, rows);
    const summary: TerminalSessionSummary = {
      id: randomUUID(),
      target: launch.target.id,
      targetLabel: launch.target.label,
      transport: launch.target.transport,
      status: 'starting',
      createdAt: now().toISOString(),
    };

    const child = spawnProcess(launch.command, launch.args, {
      cwd: options.workspaceRoot,
      env: launch.env,
      stdio: 'pipe',
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    const session: TerminalSession = {
      summary,
      process: child,
      history: [],
      subscribers: new Set<WebSocket>(),
      owner: null,
      cols,
      rows,
    };
    sessions.set(summary.id, session);

    const recordOutput = (data: string, stream: 'stdout' | 'stderr' | 'history'): void => {
      if (!data) {
        return;
      }
      session.history.push(data);
      if (session.history.length > MAX_HISTORY_CHUNKS) {
        session.history.splice(0, session.history.length - MAX_HISTORY_CHUNKS);
      }
      fanout(session, 'output', { data, stream });
    };

    child.on('spawn', () => {
      session.summary.status = 'running';
    });

    child.stdout.on('data', (chunk: string | Buffer) => {
      recordOutput(String(chunk), 'stdout');
    });

    child.stderr.on('data', (chunk: string | Buffer) => {
      recordOutput(String(chunk), 'stderr');
    });

    child.on('error', (error) => {
      session.summary.status = 'error';
      fanout(session, 'error', { message: error.message });
    });

    child.on('close', (code, signal) => {
      if (!sessions.has(summary.id)) {
        return;
      }
      session.summary.status = 'closed';
      fanout(session, 'exit', { code, signal });
    });

    return summary;
  };

  const handleSocketConnection = (socket: WebSocket): void => {
    socket.on('message', (raw) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        logger.warn('Ignoring invalid terminal websocket payload.');
        return;
      }

      if (message.type === 'terminal:subscribe') {
        const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
        const session = sessions.get(sessionId);
        if (!session) {
          safeSend(
            socket,
            {
              id: sessionId || 'unknown',
              target: 'ada-gw',
              targetLabel: 'ada-gw',
              transport: 'local',
              status: 'error',
              createdAt: now().toISOString(),
            },
            'error',
            { message: 'Terminal session not found.' },
          );
          return;
        }

        bindSocketToSession(socket, session);
        safeSend(socket, session.summary, 'session', session.summary);
        if (session.history.length > 0) {
          safeSend(socket, session.summary, 'output', {
            data: session.history.join(''),
            stream: 'history',
          });
        }
        return;
      }

      if (message.type === 'terminal:input') {
        const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
        const data = typeof message.data === 'string' ? message.data : '';
        const session = sessions.get(sessionId);
        if (!session || !data) {
          return;
        }

        try {
          session.process.stdin.write(data);
        } catch (error) {
          fanout(session, 'error', {
            message: error instanceof Error ? error.message : 'Failed to write terminal input.',
          });
        }
        return;
      }

      if (message.type === 'terminal:resize') {
        const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
        const session = sessions.get(sessionId);
        if (!session) {
          return;
        }

        session.cols = toDimension(message.cols, session.cols);
        session.rows = toDimension(message.rows, session.rows);
        return;
      }

      if (message.type === 'terminal:close') {
        const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
        closeSession(sessionId);
      }
    });

    socket.on('close', () => {
      const owned = socketSessions.get(socket);
      if (!owned) {
        return;
      }

      socketSessions.delete(socket);
      owned.forEach((sessionId) => {
        const session = sessions.get(sessionId);
        if (!session) {
          return;
        }
        session.subscribers.delete(socket);
        if (session.owner === socket) {
          closeSession(sessionId);
        }
      });
    });
  };

  return {
    listTargets: () => TERMINAL_TARGETS.map((target) => ({ ...target })),
    createSession,
    closeSession,
    handleSocketConnection,
  };
}

export function registerTerminalRoutes(app: Express, bridge: TerminalBridge): void {
  app.get('/api/terminal/targets', (_req: Request, res: Response) => {
    res.json({ targets: bridge.listTargets() });
  });

  app.post('/api/terminal/sessions', (req: Request, res: Response) => {
    const body = isRecord(req.body) ? (req.body as TerminalRequestBody) : {};
    const target = typeof body.target === 'undefined' ? 'ada-gw' : body.target;
    if (typeof target !== 'undefined' && target !== null && !normalizeTargetId(target)) {
      res.status(400).json({ error: 'target must be one of: ada-gw, spock, scotty, mac, enterprise' });
      return;
    }

    try {
      const session = bridge.createSession({
        target: typeof target === 'string' ? target : undefined,
        cols: toDimension(body.cols, DEFAULT_COLS),
        rows: toDimension(body.rows, DEFAULT_ROWS),
      });
      res.status(201).json({ session });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to create terminal session.',
      });
    }
  });

  app.delete('/api/terminal/sessions/:sessionId', (req: Request, res: Response) => {
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId.trim() : '';
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' });
      return;
    }

    if (!bridge.closeSession(sessionId)) {
      res.status(404).json({ error: 'session not found' });
      return;
    }

    res.status(204).send();
  });
}
