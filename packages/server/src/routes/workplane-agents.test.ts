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

async function createServer(nowIso = '2026-07-31T07:10:00.000Z') {
  activeDbPath = tempDbPath('entity-workplane-agents-routes');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);

  const { resetInviteControlsForTests, createInviteControls } = await import('../agent/invite-kit/controls');
  resetInviteControlsForTests();
  const { resetPresenceServiceForTests, createPresenceService } = await import('../agent/presence/service');
  resetPresenceServiceForTests();
  const {
    resetWorkplaneAttachServiceForTests,
    createWorkplaneAttachService,
  } = await import('../agent/workplane-attach/service');
  resetWorkplaneAttachServiceForTests();
  const { registerAgentInviteRoutes } = await import('./agent-invites');
  const { registerAgentPresenceRoutes } = await import('./agent-presence');
  const { registerWorkplaneAgentRoutes } = await import('./workplane-agents');

  const invites = createInviteControls();
  const nowMs = Date.parse(nowIso);
  const presence = createPresenceService({
    invites,
    now: () => new Date(nowMs),
    staleAfterMs: 60_000,
  });
  const attach = createWorkplaneAttachService({
    invites,
    presence,
    now: () => new Date(nowMs),
  });

  const app = express();
  app.use(express.json());
  registerAgentInviteRoutes(app, { controls: invites });
  registerAgentPresenceRoutes(app, { presence });
  registerWorkplaneAgentRoutes(app, { attach });
  return {
    request: (requestPath: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
      requestApp(app, { path: requestPath, ...init }),
  };
}

afterEach(async () => {
  try {
    const { resetWorkplaneAttachServiceForTests } = await import('../agent/workplane-attach/service');
    resetWorkplaneAttachServiceForTests();
  } catch {
    // ignore
  }
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
    const closePath = tempDbPath('entity-workplane-agents-routes-close');
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

describe('workplane agent routes (WP2-B-03)', () => {
  it('POST attach, GET list, DELETE detach with idempotency', async () => {
    const server = await createServer();

    const attach = await server.request('/api/workplanes/wp-route/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-route',
        agentName: 'Route Attach',
        role: 'worker',
        taskId: 7,
      }),
    });
    expect(attach.status).toBe(201);
    const created = await attach.json() as {
      created: boolean;
      agent: { agentId: string; presenceStatus: string };
    };
    expect(created.created).toBe(true);
    expect(created.agent.presenceStatus).toBe('missing');

    const again = await server.request('/api/workplanes/wp-route/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-route',
        agentName: 'Route Attach',
      }),
    });
    expect(again.status).toBe(200);
    const againBody = await again.json() as { created: boolean };
    expect(againBody.created).toBe(false);

    const list = await server.request('/api/workplanes/wp-route/agents');
    expect(list.status).toBe(200);
    const listed = await list.json() as {
      counts: { total: number; missing: number };
      agents: Array<{ agentId: string }>;
    };
    expect(listed.counts.total).toBe(1);
    expect(listed.counts.missing).toBe(1);
    expect(listed.agents[0]?.agentId).toBe('agent-route');

    const detach = await server.request('/api/workplanes/wp-route/agents/agent-route', {
      method: 'DELETE',
    });
    expect(detach.status).toBe(200);
    const detached = await detach.json() as { alreadyDetached: boolean };
    expect(detached.alreadyDetached).toBe(false);

    const empty = await server.request('/api/workplanes/wp-route/agents');
    const emptyBody = await empty.json() as { counts: { total: number } };
    expect(emptyBody.counts.total).toBe(0);

    const detachAgain = await server.request('/api/workplanes/wp-route/agents/agent-route', {
      method: 'DELETE',
    });
    expect(detachAgain.status).toBe(200);
    const detachAgainBody = await detachAgain.json() as { alreadyDetached: boolean };
    expect(detachAgainBody.alreadyDetached).toBe(true);
  });

  it('returns 404 for unknown invite and 400 for missing agent identity', async () => {
    const server = await createServer();

    const badInvite = await server.request('/api/workplanes/wp-x/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviteId: 'does-not-exist' }),
    });
    expect(badInvite.status).toBe(404);

    const badBody = await server.request('/api/workplanes/wp-x/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(badBody.status).toBe(400);
  });

  it('invite attach + heartbeat shows live on list and presence panel', async () => {
    const server = await createServer();

    const inviteRes = await server.request('/api/agents/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentName: 'Live Attach',
        role: 'worker',
        taskId: 11,
      }),
    });
    expect(inviteRes.status).toBe(201);
    const invite = await inviteRes.json() as { id: string };

    const attach = await server.request('/api/workplanes/wp-live/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviteId: invite.id, taskId: 11 }),
    });
    expect(attach.status).toBe(201);

    const hb = await server.request('/api/agents/presence/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'live-runtime',
        inviteId: invite.id,
        status: 'live',
        currentWorkplaneId: 'wp-live',
        currentTaskId: 11,
      }),
    });
    expect(hb.status).toBe(200);

    const list = await server.request('/api/workplanes/wp-live/agents');
    const listed = await list.json() as {
      counts: { live: number; missing: number };
      agents: Array<{ presenceStatus: string; source: string }>;
    };
    expect(listed.counts.live).toBe(1);
    expect(listed.counts.missing).toBe(0);
    expect(listed.agents[0]?.presenceStatus).toBe('live');
    expect(listed.agents[0]?.source).toBe('heartbeat');
  });
});
