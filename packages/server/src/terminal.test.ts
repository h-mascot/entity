import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  buildTerminalLaunchSpec,
  createTerminalBridge,
  getNodePtySpawnHelperPaths,
  registerTerminalRoutes,
  type TerminalBridge,
  type TerminalSessionSummary,
} from './terminal';

class FakeStream extends EventEmitter {
  setEncoding(_encoding: string): void {}
}

class FakeProcess extends EventEmitter {
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(event: { exitCode: number; signal?: number | string }) => void> = [];
  write = vi.fn();
  resize = vi.fn();
  kill = vi.fn();

  onData(listener: (data: string) => void) {
    this.dataListeners.push(listener);
    return { dispose: vi.fn() };
  }

  onExit(listener: (event: { exitCode: number; signal?: number | string }) => void) {
    this.exitListeners.push(listener);
    return { dispose: vi.fn() };
  }

  emitData(data: string): void {
    this.dataListeners.forEach((listener) => listener(data));
  }

  emitExit(event: { exitCode: number; signal?: number | string }): void {
    this.exitListeners.forEach((listener) => listener(event));
  }
}

class FakeSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  send = vi.fn();
}

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe('buildTerminalLaunchSpec', () => {
  it('creates a local script-backed launch for the default local target', () => {
    const spec = buildTerminalLaunchSpec('local', '/tmp/entity', 160, 48);
    expect(spec.command).toBe('/bin/zsh');
    expect(spec.args).toEqual(['-f']);
    expect(spec.cwd).toBe('/tmp/entity');
    expect(spec.env.COLUMNS).toBe('160');
    expect(spec.env.LINES).toBe('48');
  });
});

describe('getNodePtySpawnHelperPaths', () => {
  it('includes both Darwin prebuild helpers so Rosetta and native Node can spawn PTYs', () => {
    const paths = getNodePtySpawnHelperPaths('/repo/node_modules/node-pty/package.json', 'darwin', 'arm64');

    expect(paths).toEqual([
      '/repo/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      '/repo/node_modules/node-pty/prebuilds/darwin-x64/spawn-helper',
    ]);
  });

  it('does not chmod helper paths on non-Darwin platforms', () => {
    expect(getNodePtySpawnHelperPaths('/repo/node_modules/node-pty/package.json', 'linux', 'x64')).toEqual([]);
  });
});

describe('createTerminalBridge', () => {
  it('streams output to subscribed sockets and forwards input', () => {
    const fakeProcess = new FakeProcess();
    const spawnProcess = vi.fn(() => fakeProcess as any);
    const bridge = createTerminalBridge({
      workspaceRoot: '/tmp/entity',
      spawnProcess: spawnProcess as any,
    });

    const session = bridge.createSession({ target: 'local', cols: 120, rows: 40 });
    expect(spawnProcess).toHaveBeenCalledWith('/bin/zsh', ['-f'], expect.objectContaining({
      cols: 120,
      rows: 40,
      cwd: '/tmp/entity',
    }));

    const socket = new FakeSocket();
    bridge.handleSocketConnection(socket as any);
    socket.emit('message', JSON.stringify({ type: 'terminal:subscribe', sessionId: session.id }));
    fakeProcess.emitData('hello');
    socket.emit('message', JSON.stringify({ type: 'terminal:input', sessionId: session.id, data: 'ls\n' }));

    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"event":"session"'));
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"data":"hello"'));
    expect(fakeProcess.write).toHaveBeenCalledWith('ls\n');
  });

  it('rejects terminal input from sockets that do not own the session', () => {
    const fakeProcess = new FakeProcess();
    const bridge = createTerminalBridge({
      workspaceRoot: '/tmp/entity',
      spawnProcess: vi.fn(() => fakeProcess as any),
    });

    const session = bridge.createSession({ target: 'local' });
    const ownerSocket = new FakeSocket();
    const attackerSocket = new FakeSocket();
    bridge.handleSocketConnection(ownerSocket as any);
    bridge.handleSocketConnection(attackerSocket as any);
    ownerSocket.emit('message', JSON.stringify({ type: 'terminal:subscribe', sessionId: session.id }));
    attackerSocket.emit('message', JSON.stringify({ type: 'terminal:subscribe', sessionId: session.id }));

    attackerSocket.emit('message', JSON.stringify({ type: 'terminal:input', sessionId: session.id, data: 'rm -rf /\n' }));

    expect(fakeProcess.write).not.toHaveBeenCalledWith('rm -rf /\n');
    expect(attackerSocket.send).toHaveBeenCalledWith(expect.stringContaining('Terminal input is only allowed from the owning socket.'));
  });

  it('resizes the pty when a terminal resize message arrives', () => {
    const fakeProcess = new FakeProcess();
    const bridge = createTerminalBridge({
      workspaceRoot: '/tmp/entity',
      spawnProcess: vi.fn(() => fakeProcess as any),
    });

    const session = bridge.createSession({ target: 'local' });
    const socket = new FakeSocket();
    bridge.handleSocketConnection(socket as any);
    socket.emit('message', JSON.stringify({ type: 'terminal:subscribe', sessionId: session.id }));
    socket.emit('message', JSON.stringify({ type: 'terminal:resize', sessionId: session.id, cols: 132, rows: 44 }));

    expect(fakeProcess.resize).toHaveBeenCalledWith(132, 44);
  });

  it('sends an error for unknown sessions', () => {
    const bridge = createTerminalBridge({
      workspaceRoot: '/tmp/entity',
      spawnProcess: vi.fn(() => new FakeProcess() as any),
    });

    const socket = new FakeSocket();
    bridge.handleSocketConnection(socket as any);
    socket.emit('message', JSON.stringify({ type: 'terminal:subscribe', sessionId: 'missing' }));

    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('Terminal session not found.'));
  });

  it('closes owned sessions when the socket closes', () => {
    const fakeProcess = new FakeProcess();
    const bridge = createTerminalBridge({
      workspaceRoot: '/tmp/entity',
      spawnProcess: vi.fn(() => fakeProcess as any),
    });

    const session = bridge.createSession({ target: 'local' });
    const socket = new FakeSocket();
    bridge.handleSocketConnection(socket as any);
    socket.emit('message', JSON.stringify({ type: 'terminal:subscribe', sessionId: session.id }));
    socket.emit('close');

    expect(fakeProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('registerTerminalRoutes', () => {
  it('registers target and session routes with validation', () => {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const sessionSummary: TerminalSessionSummary = {
      id: 'session-1',
      target: 'local',
      targetLabel: 'Local shell',
      transport: 'local',
      status: 'starting',
      createdAt: '2026-04-02T00:00:00.000Z',
    };
    const bridge: TerminalBridge = {
      listTargets: () => [
        {
          id: 'ada-gw',
          label: 'Local shell',
          description: 'Local shell',
          transport: 'local',
          host: null,
          defaultDirectory: '.',
        },
      ],
      createSession: vi.fn(() => sessionSummary),
      closeSession: vi.fn(() => true),
      handleSocketConnection: vi.fn(),
    };

    registerTerminalRoutes(
      {
        get: (route: string, handler: (req: any, res: any) => any) => {
          handlers[`GET ${route}`] = handler;
        },
        post: (route: string, handler: (req: any, res: any) => any) => {
          handlers[`POST ${route}`] = handler;
        },
        delete: (route: string, handler: (req: any, res: any) => any) => {
          handlers[`DELETE ${route}`] = handler;
        },
      } as any,
      bridge,
    );

    const targetsResponse = createResponse();
    handlers['GET /api/terminal/targets']({}, targetsResponse);
    expect(targetsResponse.json).toHaveBeenCalledWith({
      targets: [
        {
          id: 'ada-gw',
          label: 'Local shell',
          description: 'Local shell',
          transport: 'local',
          host: null,
          defaultDirectory: '.',
        },
      ],
    });

    const invalidResponse = createResponse();
    handlers['POST /api/terminal/sessions']({ body: { target: 'evil' } }, invalidResponse);
    expect(invalidResponse.status).toHaveBeenCalledWith(400);
    expect(invalidResponse.json).toHaveBeenCalledWith({
      error: 'target must be one of: ada-gw',
    });

    const createResponseBody = createResponse();
    handlers['POST /api/terminal/sessions']({ body: { target: 'ada-gw', cols: 90, rows: 20 } }, createResponseBody);
    expect(bridge.createSession).toHaveBeenCalledWith({ target: 'ada-gw', cols: 90, rows: 20 });
    expect(createResponseBody.status).toHaveBeenCalledWith(201);
  });
});
