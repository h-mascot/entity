import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { Readable, Writable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

async function createServer() {
  activeDbPath = tempDbPath('entity-agent-invite-routes');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);

  const { resetInviteControlsForTests } = await import('../agent/invite-kit/controls');
  resetInviteControlsForTests();
  const { registerAgentInviteRoutes } = await import('./agent-invites');
  const { registerConfigRoutes } = await import('../config/routes');

  const app = express();
  app.use(express.json());
  registerAgentInviteRoutes(app);
  registerConfigRoutes(app);
  return {
    request: (requestPath: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
      requestApp(app, { path: requestPath, ...init }),
  };
}

afterEach(async () => {
  try {
    const { resetInviteControlsForTests } = await import('../agent/invite-kit/controls');
    resetInviteControlsForTests();
  } catch {
    // ignore
  }
  if (activeDbPath) {
    const closePath = tempDbPath('entity-agent-invite-routes-close');
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

describe('POST/GET /api/agents/invites + revoke/regenerate (WP2-A-05)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('create → tokenized manifest allowed → revoke blocks → regenerate rotates', async () => {
    const server = await createServer();

    const createRes = await server.request('/api/agents/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentName: 'Scout',
        role: 'worker',
        selectedModules: ['entity-mc'],
        permissionsScope: ['tasks:read'],
        creationSource: 'agents_invite',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as {
      id: string;
      token: string;
      status: string;
      persistence: string;
      setupPath: string;
      generation: number;
    };
    expect(created.persistence).toBe('durable');
    expect(created.status).toBe('created');
    expect(created.token.length).toBeGreaterThanOrEqual(8);
    expect(created.setupPath).toContain(created.token);

    const manifestOk = await server.request(
      `/api/onboarding/agent-session/${created.token}/manifest`,
    );
    // Manifest may 404 if entity-mc resolution lacks seed in this isolated DB,
    // but durable gate must not 401 before session handling.
    expect(manifestOk.status).not.toBe(401);

    const revokeRes = await server.request(`/api/agents/invites/${created.id}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revokedBy: 'henry' }),
    });
    expect(revokeRes.status).toBe(200);
    const revoked = await revokeRes.json() as { status: string; revokedBy: string; token?: string };
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedBy).toBe('henry');
    expect(revoked.token).toBeUndefined();

    const blocked = await server.request(
      `/api/onboarding/agent-session/${created.token}/manifest`,
    );
    expect(blocked.status).toBe(401);
    const blockedBody = await blocked.json() as { code: string };
    expect(blockedBody.code).toBe('invite_revoked');

    // regenerate from revoked is allowed by status machine
    const regenRes = await server.request(`/api/agents/invites/${created.id}/regenerate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(regenRes.status).toBe(200);
    const regenerated = await regenRes.json() as {
      token: string;
      generation: number;
      status: string;
    };
    expect(regenerated.status).toBe('created');
    expect(regenerated.generation).toBe(2);
    expect(regenerated.token).not.toBe(created.token);

    const oldStillBlocked = await server.request(
      `/api/onboarding/agent-session/${created.token}/bundle`,
    );
    expect(oldStillBlocked.status).toBe(401);
    const oldBody = await oldStillBlocked.json() as { code: string };
    expect(oldBody.code).toBe('invite_token_rotated');

    const newAccess = await server.request(
      `/api/onboarding/agent-session/${regenerated.token}/progress`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ progress: [] }),
      },
    );
    // Durable gate allows; session handling may succeed or 404 if mirror missing — not 401.
    expect(newAccess.status).not.toBe(401);
  });

  it('negative: GET unknown invite → 404', async () => {
    const server = await createServer();
    const res = await server.request('/api/agents/invites/missing-id');
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('not_found');
  });

  it('negative: create missing agentName → 400', async () => {
    const server = await createServer();
    const res = await server.request('/api/agents/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'worker' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('invalid_input');
  });

  it('GET does not re-emit raw token (audit-safe)', async () => {
    const server = await createServer();
    const createRes = await server.request('/api/agents/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentName: 'Audit Bot' }),
    });
    const created = await createRes.json() as { id: string; token: string };
    const getRes = await server.request(`/api/agents/invites/${created.id}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as { token?: string; setupPath?: string };
    expect(body.token).toBeUndefined();
    expect(body.setupPath).toBeUndefined();
  });
});
