import Database from 'better-sqlite3';
import express from 'express';
import { Readable, Writable } from 'stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPrincipalRepository, ensurePrincipalsSchema } from '../../../db/src/principals';
import { createPrincipalsRouter } from './principals';

const db = new Database(':memory:');
const repo = createPrincipalRepository(db);

async function requestApp(
  app: express.Express,
  options: { path: string; method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
  const bodyText = options.body ?? '';
  if (bodyText && !normalizedHeaders['content-length']) {
    normalizedHeaders['content-length'] = String(Buffer.byteLength(bodyText));
  }

  return await new Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }>((resolve, reject) => {
    const req = Readable.from(bodyText ? [bodyText] : []) as any;
    req.url = options.path;
    req.method = options.method ?? 'GET';
    req.headers = normalizedHeaders;
    req.rawHeaders = Object.entries(normalizedHeaders).flatMap(([key, value]) => [key, value]);
    req.httpVersion = '1.1';
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    req.socket = { writable: true, on() {}, removeListener() {}, destroy() {} };
    req.hostname = 'localhost';

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
      const body = Buffer.concat(chunks);
      const statusCode = Number(res.statusCode ?? 200);
      resolve({
        status: statusCode,
        json: async () => (body.length ? JSON.parse(body.toString('utf8')) : {}),
        text: async () => body.toString('utf8'),
      });
      return end(() => {
        if (typeof callback === 'function') callback();
      });
    };
    res.on('error', reject);

    try {
      (app as any).handle(req, res, reject);
    } catch (error) {
      reject(error);
    }
  });
}

function createServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createPrincipalsRouter({ repo, skipAdminAuth: true }));
  return app;
}

async function seedBootstrapAdmin(app: express.Express) {
  await requestApp(app, {
    path: '/api/admin/principals',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-entity-principal-id': 'bootstrap-admin' },
    body: JSON.stringify({ id: 'bootstrap-admin', principal_type: 'human', display_name: 'Bootstrap Admin' }),
  });
  await requestApp(app, {
    path: '/api/admin/principals/bootstrap-admin/grants',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-entity-principal-id': 'bootstrap-admin' },
    body: JSON.stringify({ role: 'admin' }),
  });
}

describe('principals routes', () => {
  beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS principal_grants');
    db.exec('DROP TABLE IF EXISTS entity_principals');
    ensurePrincipalsSchema(db);
  });

  afterEach(() => {
    // no-op
  });

  it('creates principals and grants with audit metadata', async () => {
    const app = createServer();
    await seedBootstrapAdmin(app);
    const createRes = await requestApp(app, {
      path: '/api/admin/principals',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-principal-id': 'bootstrap-admin' },
      body: JSON.stringify({
        id: 'user-ada',
        principal_type: 'human',
        display_name: 'Ada',
        handle: 'ada',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as any;
    expect(created.created_by).toBe('bootstrap-admin');

    const grantRes = await requestApp(app, {
      path: '/api/admin/principals/user-ada/grants',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-principal-id': 'bootstrap-admin' },
      body: JSON.stringify({
        role: 'manager',
        org_id: 'org-a',
        sensitivity_categories: ['customer'],
      }),
    });
    expect(grantRes.status).toBe(201);

    const listRes = await requestApp(app, { path: '/api/admin/principals' });
    const listBody = await listRes.json() as any;
    expect(listBody.principals).toHaveLength(2);
    const ada = listBody.principals.find((p: { id: string }) => p.id === 'user-ada');
    expect(ada).toBeTruthy();
    expect(ada.grants).toHaveLength(1);
    expect(ada.grants[0].role).toBe('manager');
    expect(ada.grants[0].org_id).toBe('org-a');
  });

  it('disables principals and revokes grants', async () => {
    const app = createServer();
    await seedBootstrapAdmin(app);
    await requestApp(app, {
      path: '/api/admin/principals',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-principal-id': 'bootstrap-admin' },
      body: JSON.stringify({ id: 'user-spock', principal_type: 'human', display_name: 'Spock' }),
    });
    const grantRes = await requestApp(app, {
      path: '/api/admin/principals/user-spock/grants',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-principal-id': 'bootstrap-admin' },
      body: JSON.stringify({ role: 'viewer', org_id: 'org-a' }),
    });
    const grant = await grantRes.json() as any;

    const disableRes = await requestApp(app, {
      path: '/api/admin/principals/user-spock/disable',
      method: 'POST',
      headers: { 'x-entity-principal-id': 'bootstrap-admin' },
    });
    expect(disableRes.status).toBe(200);
    const disabled = await disableRes.json() as any;
    expect(disabled.status).toBe('disabled');

    const revokeRes = await requestApp(app, {
      path: `/api/admin/principals/user-spock/grants/${grant.id}`,
      method: 'DELETE',
      headers: { 'x-entity-principal-id': 'bootstrap-admin' },
    });
    expect(revokeRes.status).toBe(204);
    expect(await revokeRes.text()).toBe('');
  });

  it('rejects invalid grant payloads without partial writes', async () => {
    const app = createServer();
    await seedBootstrapAdmin(app);
    await requestApp(app, {
      path: '/api/admin/principals',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-principal-id': 'bootstrap-admin' },
      body: JSON.stringify({ id: 'user-bad', principal_type: 'human', display_name: 'Bad' }),
    });
    const badRes = await requestApp(app, {
      path: '/api/admin/principals/user-bad/grants',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-principal-id': 'bootstrap-admin' },
      body: JSON.stringify({ role: 'superuser' }),
    });
    expect(badRes.status).toBe(400);
    const listRes = await requestApp(app, { path: '/api/admin/principals/user-bad' });
    const body = await listRes.json() as any;
    expect(body.grants).toHaveLength(0);
  });
});
