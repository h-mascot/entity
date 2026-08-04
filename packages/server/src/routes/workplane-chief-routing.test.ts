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

async function createServer(nowIso = '2026-07-31T08:20:00.000Z') {
  activeDbPath = tempDbPath('entity-chief-routing-routes');
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
  const {
    resetChiefRoutingServiceForTests,
    createChiefRoutingService,
  } = await import('../agent/chief-routing/service');
  resetChiefRoutingServiceForTests();

  const { registerWorkplaneAgentRoutes } = await import('./workplane-agents');
  const { registerAgentPresenceRoutes } = await import('./agent-presence');
  const { registerWorkplaneChiefRoutingRoutes } = await import('./workplane-chief-routing');

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
  const routing = createChiefRoutingService({
    attach,
    presence,
    now: () => new Date(nowMs),
  });

  const app = express();
  app.use(express.json());
  registerAgentPresenceRoutes(app, { presence });
  registerWorkplaneAgentRoutes(app, { attach });
  registerWorkplaneChiefRoutingRoutes(app, { routing });

  return {
    presence,
    request: (requestPath: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
      requestApp(app, { path: requestPath, ...init }),
  };
}

afterEach(async () => {
  try {
    const { resetChiefRoutingServiceForTests } = await import('../agent/chief-routing/service');
    resetChiefRoutingServiceForTests();
  } catch {
    // ignore
  }
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
    const closePath = tempDbPath('entity-chief-routing-routes-close');
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

describe('workplane chief routing routes (WP2-B-04)', () => {
  it('assigns chief, blocks worker claim under priority, allows chief claim', async () => {
    const server = await createServer();

    await server.request('/api/workplanes/wp-route/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'chief-1', agentName: 'Chief', role: 'chief' }),
    });
    await server.request('/api/workplanes/wp-route/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'worker-1', agentName: 'Worker', role: 'worker' }),
    });

    const chiefPut = await server.request('/api/workplanes/wp-route/routing/chief', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'chief-1',
        assignedBy: 'operator',
        priorityWindowMs: 120_000,
      }),
    });
    expect(chiefPut.status).toBe(201);

    await server.request('/api/agents/presence/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'chief-1',
        status: 'live',
        currentWorkplaneId: 'wp-route',
      }),
    });

    const blocked = await server.request('/api/workplanes/wp-route/routing/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'worker-1', taskId: 5 }),
    });
    expect(blocked.status).toBe(409);
    const blockedBody = await blocked.json() as { code: string; policy?: { code: string } };
    expect(blockedBody.code).toBe('chief_priority');

    const claimed = await server.request('/api/workplanes/wp-route/routing/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'chief-1', taskId: 5 }),
    });
    expect(claimed.status).toBe(201);
    const claimedBody = await claimed.json() as {
      created: boolean;
      policy: { code: string };
      claim: { agentId: string };
    };
    expect(claimedBody.created).toBe(true);
    expect(claimedBody.policy.code).toBe('chief_claim');
    expect(claimedBody.claim.agentId).toBe('chief-1');

    const panel = await server.request('/api/workplanes/wp-route/routing?taskId=5');
    expect(panel.status).toBe(200);
    const panelBody = await panel.json() as {
      policy: { claimGate: string };
      chiefPresence: { available: boolean; presenceStatus: string };
      activeClaim: { agentId: string } | null;
    };
    expect(panelBody.policy.claimGate).toBe('blocked_claimed');
    expect(panelBody.chiefPresence.available).toBe(true);
    expect(panelBody.activeClaim?.agentId).toBe('chief-1');
  });

  it('operator assign + decisions log + release', async () => {
    const server = await createServer();

    await server.request('/api/workplanes/wp-route/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'worker-1', agentName: 'Worker' }),
    });

    const assigned = await server.request('/api/workplanes/wp-route/routing/assign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'worker-1',
        assignedBy: 'operator',
        asOperator: true,
        taskId: 9,
      }),
    });
    expect(assigned.status).toBe(201);

    const decisions = await server.request('/api/workplanes/wp-route/routing/decisions');
    expect(decisions.status).toBe(200);
    const decisionBody = await decisions.json() as {
      decisions: Array<{ claimMode: string; agentId: string }>;
    };
    expect(decisionBody.decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisionBody.decisions[0]?.claimMode).toBe('assign');

    const released = await server.request('/api/workplanes/wp-route/routing/release', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 9 }),
    });
    expect(released.status).toBe(200);

    const unattachedChief = await server.request('/api/workplanes/wp-route/routing/chief', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'not-attached' }),
    });
    expect(unattachedChief.status).toBe(409);
    const err = await unattachedChief.json() as { code: string };
    expect(err.code).toBe('chief_not_attached');
  });
});
