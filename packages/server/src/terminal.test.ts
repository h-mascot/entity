import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  buildTerminalLaunchSpec,
  createTerminalBridge,
  registerTerminalRoutes,
  type TerminalBridge,
  type TerminalSessionSummary,
} from './terminal';

class FakeStream extends EventEmitter {
  setEncoding(_encoding: string): void {}
}

class FakeProcess extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  kill = vi.fn();
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
  it('creates a local script-backed launch for ada-gw', () => {
    const spec = buildTerminalLaunchSpec('ada-gw', '/tmp/entity', 160, 48);
    expect(spec.command).toBe('/usr/bin/script');
    expect(spec.args).toEqual([
      '-q',
      '/dev/null',
      '/bin/zsh',
      '-fc',
      "cd '/tmp/entity' 2>/dev/null || cd ~; export TERM=xterm-256color COLORTERM=truecolor; exec /bin/zsh -f",
    ]);
    expect(spec.env.COLUMNS).toBe('160');
    expect(spec.env.LINES).toBe('48');
  });

  it('creates an ssh-backed launch for remote targets', () => {
    const spec = buildTerminalLaunchSpec('mac', '/tmp/entity');
    expect(spec.command).toBe('/usr/bin/ssh');
    expect(spec.args[0]).toBe('-tt');
    expect(spec.args[1]).toBe('mac');
    expect(spec.args[2]).toContain("cd '~/Code/entity'");
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

    const session = bridge.createSession({ target: 'ada-gw', cols: 120, rows: 40 });
    expect(spawnProcess).toHaveBeenCalledOnce();

    const socket = new FakeSocket();
    bridge.handleSocketConnection(socket as any);
    socket.emit('message', JSON.stringify({ type: 'terminal:subscribe', sessionId: session.id }));
    fakeProcess.emit('spawn');
    fakeProcess.stdout.emit('data', 'hello');
    socket.emit('message', JSON.stringify({ type: 'terminal:input', sessionId: session.id, data: 'ls\n' }));

    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"event":"session"'));
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"data":"hello"'));
    expect(fakeProcess.stdin.write).toHaveBeenCalledWith('ls\n');
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

    const session = bridge.createSession({ target: 'ada-gw' });
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
      target: 'ada-gw',
      targetLabel: 'ada-gw',
      transport: 'local',
      status: 'starting',
      createdAt: '2026-04-02T00:00:00.000Z',
    };
    const bridge: TerminalBridge = {
      listTargets: () => [
        {
          id: 'ada-gw',
          label: 'ada-gw',
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
          label: 'ada-gw',
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
      error: 'target must be one of: ada-gw, spock, scotty, mac, enterprise',
    });

    const createResponseBody = createResponse();
    handlers['POST /api/terminal/sessions']({ body: { target: 'ada-gw', cols: 90, rows: 20 } }, createResponseBody);
    expect(bridge.createSession).toHaveBeenCalledWith({ target: 'ada-gw', cols: 90, rows: 20 });
    expect(createResponseBody.status).toHaveBeenCalledWith(201);
  });
});
