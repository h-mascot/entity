import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { Readable, Writable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAgentAdminSettingsRoutes } from './agent-admin-settings';
import { registerAgentInviteRoutes } from './agent-invites';
import { resetInviteControlsForTests } from '../agent/invite-kit/controls';
import { resetInviteAuditStoreForTests } from '../agent/invite-kit/audit-store';
import { clearAgentInviteAdminSettingsForTests } from '../agent/invite-kit/admin-settings';

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
      return end(chunk, encoding, callback);
    };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
      return res;
    };
    res.send = (body: unknown) => {
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
      return res;
    };

    app(req, res, (err?: unknown) => {
      if (err) reject(err);
      else if (!res.writableEnded) {
        resolve(new Response(Buffer.concat(chunks), {
          status: Number(res.statusCode ?? 404),
          headers: Object.fromEntries(headersMap.entries()),
        }));
      }
    });
  });
}

async function createServer() {
  activeDbPath = tempDbPath('entity-admin-settings-routes');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  resetInviteControlsForTests();
  resetInviteAuditStoreForTests();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  clearAgentInviteAdminSettingsForTests();
  const app = express();
  app.use(express.json());
  registerAgentInviteRoutes(app);
  registerAgentAdminSettingsRoutes(app);
  return {
    request: (path: string, init?: { method?: string; body?: unknown }) =>
      requestApp(app, {
        path,
        method: init?.method,
        headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      }),
  };
}

afterEach(async () => {
  resetInviteControlsForTests();
  resetInviteAuditStoreForTests();
  const dbPathToClose = activeDbPath;
  if (dbPathToClose) {
    const closePath = tempDbPath('entity-admin-settings-routes-close');
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

describe('GET/PATCH /api/agents/admin-settings + audit (WP2-B-06)', () => {
  beforeEach(() => {
    resetInviteControlsForTests();
    resetInviteAuditStoreForTests();
  });

  it('updates TTL/modules and records revoke audit without secret leak', async () => {
    const server = await createServer();

    const getRes = await server.request('/api/agents/admin-settings');
    expect(getRes.status).toBe(200);
    const initial = await getRes.json() as { defaultTtlMs: number; allowedModules: string[] };
    expect(initial.defaultTtlMs).toBeGreaterThan(0);
    expect(JSON.stringify(initial)).not.toMatch(/"token"\s*:/);

    const patchRes = await server.request('/api/agents/admin-settings', {
      method: 'PATCH',
      body: {
        defaultTtlMs: 45 * 60 * 1000,
        minTtlMs: 5 * 60 * 1000,
        maxTtlMs: 2 * 60 * 60 * 1000,
        allowedModules: ['entity-mc', 'entity-fs'],
        defaultModules: ['entity-mc'],
        updatedBy: 'henry',
      },
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json() as {
      defaultTtlMs: number;
      allowedModules: string[];
      defaultModules: string[];
    };
    expect(patched.defaultTtlMs).toBe(45 * 60 * 1000);
    expect(patched.allowedModules).toEqual(['entity-mc', 'entity-fs']);

    const createRes = await server.request('/api/agents/invites', {
      method: 'POST',
      body: {
        agentName: 'Audit Scout',
        selectedModules: ['entity-mc'],
        ttlMs: 45 * 60 * 1000,
      },
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { id: string; token?: string };
    expect(created.token).toBeTruthy();

    const blocked = await server.request('/api/agents/invites', {
      method: 'POST',
      body: {
        agentName: 'Blocked',
        selectedModules: ['entity-services'],
      },
    });
    expect(blocked.status).toBe(400);
    const blockedBody = await blocked.json() as { code: string };
    expect(blockedBody.code).toBe('module_not_allowed');

    const revokeRes = await server.request(`/api/agents/invites/${created.id}/revoke`, {
      method: 'POST',
      body: { revokedBy: 'henry' },
    });
    expect(revokeRes.status).toBe(200);
    const revoked = await revokeRes.json() as { token?: string; status: string };
    expect(revoked.status).toBe('revoked');
    expect(revoked.token).toBeUndefined();

    const auditRes = await server.request('/api/agents/admin-settings/audit?limit=20');
    expect(auditRes.status).toBe(200);
    const audit = await auditRes.json() as {
      events: Array<{ eventType: string; inviteId: string | null; detail: string }>;
    };
    const types = audit.events.map((event) => event.eventType);
    expect(types).toContain('settings_updated');
    expect(types).toContain('invite_created');
    expect(types).toContain('invite_revoked');
    expect(JSON.stringify(audit)).not.toMatch(/"token"\s*:/);
    expect(JSON.stringify(audit)).not.toContain(created.token!);
  });

  it('rejects TTL outside admin policy', async () => {
    const server = await createServer();
    await server.request('/api/agents/admin-settings', {
      method: 'PATCH',
      body: {
        minTtlMs: 10 * 60 * 1000,
        maxTtlMs: 60 * 60 * 1000,
        defaultTtlMs: 30 * 60 * 1000,
        allowedModules: ['entity-mc'],
        defaultModules: ['entity-mc'],
      },
    });
    const res = await server.request('/api/agents/invites', {
      method: 'POST',
      body: { agentName: 'Short lived', ttlMs: 60_000, selectedModules: ['entity-mc'] },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ttl_out_of_range');
  });
});
