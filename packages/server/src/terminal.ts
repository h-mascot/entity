import { randomUUID } from 'crypto';
import { chmodSync, statSync } from 'fs';
import { dirname, join } from 'path';
import type { Express, Request, Response } from 'express';
import { spawn as spawnPty, type IPty } from 'node-pty';
import { WebSocket } from 'ws';

export type TerminalTargetId = string;
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
  cwd: string;
  initialInput?: string;
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
  spawnProcess?: TerminalSpawner;
  now?: () => Date;
  logger?: Pick<Console, 'warn' | 'error'>;
  targets?: readonly TerminalTarget[];
}

export type TerminalSpawner = (
  command: string,
  args: string[],
  options: {
    cols: number;
    rows: number;
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
) => TerminalProcess;

interface TerminalProcess {
  onData(listener: (data: string) => void): { dispose: () => void };
  onExit(listener: (event: { exitCode: number; signal?: number | string }) => void): { dispose: () => void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

interface TerminalSession {
  summary: TerminalSessionSummary;
  process: TerminalProcess;
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
    id: 'local',
    label: 'Local shell',
    description: 'Shell in the Entity workspace',
    transport: 'local',
    host: null,
    defaultDirectory: '.',
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTargetId(value: unknown, targets: readonly TerminalTarget[] = TERMINAL_TARGETS): TerminalTargetId | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as TerminalTargetId;
  return targets.some((target) => target.id === normalized) ? normalized : null;
}

function terminalTargetIds(targets: readonly TerminalTarget[] = TERMINAL_TARGETS): string {
  return targets.map((target) => target.id).join(', ');
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

function buildBootstrapCommand(target: TerminalTarget): string {
  const directory = target.defaultDirectory;
  return `cd ${shellQuote(directory)} 2>/dev/null || cd ~; export TERM=xterm-256color COLORTERM=truecolor; exec /bin/zsh -f`;
}

export function buildTerminalLaunchSpec(
  targetId: TerminalTargetId,
  workspaceRoot: string,
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
  targets: readonly TerminalTarget[] = TERMINAL_TARGETS,
): TerminalLaunchSpec {
  const target = targets.find((entry) => entry.id === targetId);
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

  if (target.transport === 'local') {
    return {
      target,
      command: '/bin/zsh',
      args: ['-f'],
      env,
      cwd: workspaceRoot,
    };
  }

  const bootstrap = buildBootstrapCommand(target);
  return {
    target,
    command: '/bin/zsh',
    args: ['-f'],
    env,
    cwd: workspaceRoot,
    initialInput: `exec /usr/bin/ssh -tt ${shellQuote(target.host ?? target.id)} ${shellQuote(bootstrap)}\r`,
  };
}

function defaultSpawnProcess(command: string, args: string[], options: {
  cols: number;
  rows: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): IPty {
  ensureNodePtySpawnHelperExecutable();
  return spawnPty(command, args, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
  });
}

export function getNodePtySpawnHelperPaths(
  packageJsonPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string[] {
  if (platform !== 'darwin') {
    return [];
  }

  const packageDirectory = dirname(packageJsonPath);
  const candidateArchitectures = Array.from(new Set([arch, 'arm64', 'x64']));
  return candidateArchitectures.map((candidateArch) =>
    join(packageDirectory, 'prebuilds', `darwin-${candidateArch}`, 'spawn-helper'),
  );
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (process.platform !== 'darwin') {
    return;
  }

  const packagePath = require.resolve('node-pty/package.json');
  const helperPaths = getNodePtySpawnHelperPaths(packagePath);
  for (const helperPath of helperPaths) {
    try {
      const stats = statSync(helperPath);
      if ((stats.mode & 0o111) === 0) {
        chmodSync(helperPath, stats.mode | 0o755);
      }
    } catch (error) {
      if (helperPath.includes(`darwin-${process.arch}`)) {
        throw error;
      }
    }
  }
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
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;
  const targets = options.targets && options.targets.length > 0 ? options.targets : TERMINAL_TARGETS;
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

  const rejectNonOwnerControl = (socket: WebSocket, session: TerminalSession, action: string): boolean => {
    if (session.owner === socket) {
      return false;
    }
    safeSend(socket, session.summary, 'error', {
      message: `Terminal ${action} is only allowed from the owning socket.`,
    });
    return true;
  };

  const createSession = (input: CreateTerminalSessionInput = {}): TerminalSessionSummary => {
    const targetId = normalizeTargetId(input.target, targets) ?? targets[0]?.id;
    if (!targetId) {
      throw new Error('No terminal targets are configured.');
    }
    const cols = toDimension(input.cols, DEFAULT_COLS);
    const rows = toDimension(input.rows, DEFAULT_ROWS);
    const launch = buildTerminalLaunchSpec(targetId, options.workspaceRoot, cols, rows, targets);
    const summary: TerminalSessionSummary = {
      id: randomUUID(),
      target: launch.target.id,
      targetLabel: launch.target.label,
      transport: launch.target.transport,
      status: 'starting',
      createdAt: now().toISOString(),
    };

    const child = spawnProcess(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      cols,
      rows,
    });

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

    recordOutput(`[terminal] starting ${launch.target.label} via ${launch.target.transport} pty\r\n`, 'history');
    session.summary.status = 'running';

    if (launch.initialInput) {
      child.write(launch.initialInput);
    }

    child.onData((chunk: string) => {
      recordOutput(String(chunk), 'stdout');
    });

    child.onExit(({ exitCode, signal }) => {
      if (!sessions.has(summary.id)) {
        return;
      }
      session.summary.status = 'closed';
      fanout(session, 'exit', { code: exitCode, signal: signal ?? null });
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
              target: targets[0]?.id ?? 'unknown',
              targetLabel: targets[0]?.label ?? 'unknown',
              transport: 'local',
              status: 'error',
              createdAt: now().toISOString(),
            },
            'error',
            { message: 'Terminal session not found.' },
          );
          return;
        }

        if (session.owner && rejectNonOwnerControl(socket, session, 'subscribe')) {
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
        if (rejectNonOwnerControl(socket, session, 'input')) {
          return;
        }

        try {
          session.process.write(data);
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
        if (rejectNonOwnerControl(socket, session, 'resize')) {
          return;
        }

        session.cols = toDimension(message.cols, session.cols);
        session.rows = toDimension(message.rows, session.rows);
        try {
          session.process.resize(session.cols, session.rows);
        } catch (error) {
          fanout(session, 'error', {
            message: error instanceof Error ? error.message : 'Failed to resize terminal.',
          });
        }
        return;
      }

      if (message.type === 'terminal:close') {
        const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
        const session = sessions.get(sessionId);
        if (!session) {
          return;
        }
        if (rejectNonOwnerControl(socket, session, 'close')) {
          return;
        }
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
    listTargets: () => targets.map((target) => ({ ...target })),
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
    const configuredTargets = bridge.listTargets();
    const target = typeof body.target === 'undefined' ? undefined : body.target;
    if (
      typeof target !== 'undefined'
      && target !== null
      && (
        typeof target !== 'string'
        || !configuredTargets.some((configuredTarget) => configuredTarget.id === target.trim())
      )
    ) {
      res.status(400).json({ error: `target must be one of: ${terminalTargetIds(configuredTargets) || '(none configured)'}` });
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
