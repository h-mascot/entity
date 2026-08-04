import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { Readable, Writable } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

let activeDbPath: string | null = null;
let cleanupDbPaths: string[] = [];

function sqliteFiles(dbPath: string): string[] {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

function removeSqliteFiles(dbPath: string): void {
  for (const file of sqliteFiles(dbPath)) {
    fs.rmSync(file, { force: true });
  }
}

function tempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

async function requestApp(
  app: express.Express,
  options: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<Response> {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
  const bodyText = options.body ?? '';
  if (bodyText && !normalizedHeaders['content-length']) {
    normalizedHeaders['content-length'] = String(Buffer.byteLength(bodyText));
  }

  return await new Promise<Response>((resolve, reject) => {
    const req = Readable.from(bodyText ? [bodyText] : []) as any;
    req.url = options.path;
    req.method = options.method ?? 'GET';
    req.headers = normalizedHeaders;
    req.rawHeaders = Object.entries(normalizedHeaders).flatMap(([key, value]) => [key, value]);
    req.httpVersion = '1.1';
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    req.socket = { writable: true, on() {}, removeListener() {}, destroy() {} };
    req.connection = req.socket;

    const chunks: Buffer[] = [];
    const res: any = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });

    const headersMap = new Map<string, string>();
    res.statusCode = 200;
    Object.defineProperty(res, 'headersSent', { value: false, writable: true, configurable: true });
    Object.defineProperty(res, 'finished', { value: false, writable: true, configurable: true });
    Object.defineProperty(res, 'writableEnded', { value: false, writable: true, configurable: true });
    res.setHeader = (name: string, value: string) => {
      headersMap.set(String(name).toLowerCase(), String(value));
      return res;
    };
    res.getHeader = (name: string) => headersMap.get(String(name).toLowerCase());
    res.getHeaders = () => Object.fromEntries(headersMap.entries());
    res.removeHeader = (name: string) => {
      headersMap.delete(String(name).toLowerCase());
    };
    res.writeHead = (statusCode: number, reasonOrHeaders?: unknown, maybeHeaders?: Record<string, string>) => {
      res.statusCode = statusCode;
      const headerSource = typeof reasonOrHeaders === 'object' && reasonOrHeaders !== null
        ? reasonOrHeaders as Record<string, string>
        : maybeHeaders;
      if (headerSource) {
        for (const [name, value] of Object.entries(headerSource)) {
          res.setHeader(name, value);
        }
      }
      res.headersSent = true;
      return res;
    };
    const end = res.end.bind(res);
    res.end = (chunk?: unknown, encoding?: BufferEncoding, callback?: () => void) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding));
      }
      res.headersSent = true;
      res.finished = true;
      res.writableEnded = true;
      resolve(new Response(Buffer.concat(chunks), {
        status: Number(res.statusCode ?? 200),
        headers: Object.fromEntries(headersMap.entries()),
      }));
      return end(() => {
        if (typeof callback === 'function') callback();
      });
    };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload: unknown) => {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
      return res;
    };
    res.type = (type: string) => {
      res.setHeader('content-type', type);
      return res;
    };
    res.send = (payload: unknown) => {
      res.end(typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : String(payload));
      return res;
    };
    res.on('error', reject);

    try {
      (app as any).handle(req, res, reject);
    } catch (error) {
      reject(error);
    }
  });
}

async function createServer(nowIso = '2026-07-31T06:00:00.000Z') {
  activeDbPath = tempDbPath('entity-presence-routes');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);

  const { resetInviteControlsForTests, createInviteControls } = await import('../agent/invite-kit/controls');
  resetInviteControlsForTests();
  const { resetPresenceServiceForTests, createPresenceService } = await import('../agent/presence/service');
  resetPresenceServiceForTests();
  const { registerAgentInviteRoutes } = await import('./agent-invites');
  const { registerAgentPresenceRoutes } = await import('./agent-presence');

  const invites = createInviteControls();
  const presence = createPresenceService({
    invites,
    now: () => new Date(Date.parse(nowIso)),
    staleAfterMs: 60_000,
  });

  const app = express();
  app.use(express.json());
  registerAgentInviteRoutes(app, { controls: invites });
  registerAgentPresenceRoutes(app, { presence });
  return {
    request: (requestPath: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
      requestApp(app, { path: requestPath, ...init }),
  };
}

afterEach(async () => {
  try {
    const { resetPresenceServiceForTests } = await import('../agent/presence/service');
    resetPresenceServiceForTests();
  } catch {
    // ignore
  }
  try {
    const { resetInviteControlsForTests } = await import('../agent/invite-kit/controls');
    resetInviteControlsForTests();
  } catch {
    // ignore
  }
  if (activeDbPath) {
    const closePath = tempDbPath('entity-presence-routes-close');
    cleanupDbPaths.push(closePath);
    vi.stubEnv('ENTITY_TASK_DB_PATH', closePath);
    try {
      const { getEntityDatabase } = await import('../../../db/src/entity-db');
      getEntityDatabase().close();
    } catch {
      // best-effort
    }
  }
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of cleanupDbPaths) {
    removeSqliteFiles(dbPath);
  }
  activeDbPath = null;
  cleanupDbPaths = [];
});

describe('presence routes (WP2-B-02)', () => {
  it('POST heartbeat + GET agent + GET workplane panel', async () => {
    const server = await createServer('2026-07-31T06:00:00.000Z');

    const createInvite = await server.request('/api/agents/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentName: 'Route Scout',
        role: 'worker',
        workplaneId: 'wp-route',
        taskId: 9,
      }),
    });
    expect(createInvite.status).toBe(201);
    const invite = await createInvite.json() as { id: string };

    const missingPanel = await server.request('/api/workplanes/wp-route/presence');
    expect(missingPanel.status).toBe(200);
    const missingBody = await missingPanel.json() as {
      agents: Array<{ presenceStatus: string; source: string }>;
      counts: { missing: number; live: number };
    };
    expect(missingBody.agents).toHaveLength(1);
    expect(missingBody.agents[0]?.presenceStatus).toBe('missing');
    expect(missingBody.counts.missing).toBe(1);

    const hb = await server.request('/api/agents/presence/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-route',
        inviteId: invite.id,
        status: 'live',
        currentWorkplaneId: 'wp-route',
        currentTaskId: 9,
      }),
    });
    expect(hb.status).toBe(200);
    const hbBody = await hb.json() as { presence: { presenceStatus: string; agentName: string } };
    expect(hbBody.presence.presenceStatus).toBe('live');
    expect(hbBody.presence.agentName).toBe('Route Scout');

    const getOne = await server.request('/api/agents/presence/agent-route');
    expect(getOne.status).toBe(200);

    const panel = await server.request('/api/workplanes/wp-route/presence');
    const panelBody = await panel.json() as {
      agents: Array<{ presenceStatus: string; source: string }>;
      counts: { live: number; missing: number };
    };
    expect(panelBody.agents).toHaveLength(1);
    expect(panelBody.agents[0]?.presenceStatus).toBe('live');
    expect(panelBody.counts.live).toBe(1);
    expect(panelBody.counts.missing).toBe(0);
  });

  it('rejects invalid heartbeat and reports not_found / stale', async () => {
    const server = await createServer('2026-07-31T06:00:00.000Z');

    const bad = await server.request('/api/agents/presence/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'x', status: 'missing' }),
    });
    expect(bad.status).toBe(400);
    const badBody = await bad.json() as { code: string };
    expect(badBody.code).toBe('invalid_status');

    const missing = await server.request('/api/agents/presence/nope');
    expect(missing.status).toBe(404);

    const { createAgentPresenceStore } = await import('../agent/presence/store');
    const { createPresenceService } = await import('../agent/presence/service');
    const { registerAgentPresenceRoutes } = await import('./agent-presence');
    const store = createAgentPresenceStore();
    store.upsertHeartbeat({
      agentId: 'agent-aged',
      inviteId: null,
      status: 'live',
      lastSeenAt: '2026-07-31T05:50:00.000Z',
      currentTaskId: null,
      currentWorkplaneId: 'wp-aged',
      runtime: null,
      sessionId: null,
      capabilities: [],
      updatedAt: '2026-07-31T05:50:00.000Z',
    });
    const presence = createPresenceService({
      store,
      now: () => new Date('2026-07-31T06:05:00.000Z'),
      staleAfterMs: 60_000,
    });
    const app = express();
    app.use(express.json());
    registerAgentPresenceRoutes(app, { presence });
    const staleRes = await requestApp(app, { path: '/api/agents/presence/agent-aged' });
    expect(staleRes.status).toBe(200);
    const staleBody = await staleRes.json() as { presenceStatus: string; degradedReasons: string[] };
    expect(staleBody.presenceStatus).toBe('stale');
    expect(staleBody.degradedReasons).toContain('presence_stale');
    expect(server).toBeTruthy();
  });
});
