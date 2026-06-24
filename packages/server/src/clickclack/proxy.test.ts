import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type http from 'http';
import { registerClickClackProxyRoutes } from './proxy';
import { createApiAuthMiddleware } from '../middleware/api-auth';

function listen(app: express.Express): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('failed to bind test server');
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('ClickClack proxy routes', () => {
  let upstream: http.Server;
  let entity: http.Server;
  let baseUrl = '';
  const upstreamHits: string[] = [];

  beforeAll(async () => {
    const upstreamApp = express();
    upstreamApp.use(express.json());
    upstreamApp.get('/api/me', (_req, res) => {
      upstreamHits.push('/api/me');
      res.json({ user: { id: 'usr_human', display_name: 'Entity Human' } });
    });
    upstreamApp.get('/api/echo-json', (_req, res) => {
      upstreamHits.push('/api/echo-json');
      res.json({ body: '/api/foo', next: '/app/wsp_1/chn_1' });
    });
    upstreamApp.get('/api/redirect-app', (_req, res) => {
      res.redirect(302, '/app/wsp_1');
    });
    upstreamApp.get('/api/auth-check', (req, res) => {
      res.json({
        authorization: req.header('authorization') ?? null,
        devUser: req.header('x-clickclack-user') ?? null,
        cookie: req.header('cookie') ?? null,
        query: req.query,
      });
    });
    upstreamApp.post('/api/upload', express.raw({ type: '*/*' }), (req, res) => {
      upstreamHits.push(`/api/upload:${Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''}`);
      res.json({ bytes: Buffer.isBuffer(req.body) ? req.body.length : 0 });
    });
    upstreamApp.get('/app', (_req, res) => {
      upstreamHits.push('/app');
      res.type('html').send([
        '<!doctype html>',
        '<link rel="icon" href="/favicon.svg">',
        '<script type="module" src="/_app/client.js"></script>',
        '<script>window.__kit = { base: "" }</script>',
        '<script>fetch("/api/workspaces")</script>',
        '<a href="/app">Open</a>',
      ].join(''));
    });
    upstreamApp.get('/_app/client.js', (_req, res) => {
      upstreamHits.push('/_app/client.js');
      res.type('application/javascript').send('fetch("/api/channels/chn_1/messages"); import("/_app/chunk.js"); goto("/app/wsp_1");');
    });

    const upstreamBinding = await listen(upstreamApp);
    upstream = upstreamBinding.server;

    const entityApp = express();
    entityApp.use('/api/clickclack', express.raw({ type: '*/*', limit: '50mb' }));
    entityApp.use(express.json());
    registerClickClackProxyRoutes(entityApp, {
      baseUrl: upstreamBinding.baseUrl,
      devIdentityHeader: 'usr_human',
    });
    const entityBinding = await listen(entityApp);
    entity = entityBinding.server;
    baseUrl = entityBinding.baseUrl;
  });

  afterAll(async () => {
    await close(entity);
    await close(upstream);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('proxies ClickClack API under /api/clickclack without taking /api/chat', async () => {
    const response = await fetch(`${baseUrl}/api/clickclack/me`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: 'usr_human', display_name: 'Entity Human' } });
    expect(upstreamHits).toContain('/api/me');

    const missed = await fetch(`${baseUrl}/api/chat/me`);
    expect(missed.status).toBe(404);
  });

  it('proxies and rewrites the ClickClack SPA namespace', async () => {
    const response = await fetch(`${baseUrl}/clickclack/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(upstreamHits).toContain('/app');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self' 'unsafe-inline'");
    expect(response.url).toBe(`${baseUrl}/clickclack/app`);
    expect(html).toContain('/clickclack/_app/client.js');
    expect(html).toContain('/api/clickclack/workspaces');
    expect(html).toContain('/clickclack/favicon.svg');
    expect(html).toContain('/clickclack/app');
    expect(html).toContain('base: "/clickclack"');
  });

  it('rewrites ClickClack asset API calls to the Entity ClickClack API namespace', async () => {
    const response = await fetch(`${baseUrl}/clickclack/_app/client.js`);
    expect(response.status).toBe(200);
    const js = await response.text();

    expect(upstreamHits).toContain('/_app/client.js');
    expect(js).toContain('/api/clickclack/channels/chn_1/messages');
    expect(js).toContain('/clickclack/_app/chunk.js');
    expect(js).toContain('/clickclack/app/wsp_1');
  });

  it('rewrites proxied ClickClack API JSON route payloads for the embedded namespace', async () => {
    const response = await fetch(`${baseUrl}/api/clickclack/echo-json`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      body: '/api/foo',
      next: '/clickclack/app/wsp_1/chn_1',
    });
  });

  it('rewrites upstream redirect locations back into the embedded namespace', async () => {
    const response = await fetch(`${baseUrl}/api/clickclack/redirect-app`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/clickclack/app/wsp_1');
  });

  it('supports token-authenticated ClickClack browser navigation via a scoped cookie', async () => {
    vi.stubEnv('ENTITY_API_TOKEN', 'entity-token');

    const login = await fetch(`${baseUrl}/clickclack/app?entity_token=entity-token`, { redirect: 'manual' });
    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toBe('/clickclack/app');
    const cookie = login.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('entity-clickclack-token=entity-token');
    expect(cookie).toContain('Path=/clickclack');
    expect(cookie).toContain('Path=/api/clickclack');
    expect(cookie).not.toContain('Path=/;');

    const page = await fetch(`${baseUrl}/clickclack/app`, { headers: { cookie } });
    expect(page.status).toBe(200);

    const api = await fetch(`${baseUrl}/api/clickclack/auth-check`, {
      headers: { cookie },
    });
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({
      authorization: null,
      cookie: null,
      devUser: 'usr_human',
      query: {},
    });
  });

  it('lets cookie-authenticated ClickClack API calls pass through global API auth', async () => {
    vi.stubEnv('ENTITY_API_TOKEN', 'entity-token');
    const upstreamApp = express();
    upstreamApp.get('/api/auth-check', (req, res) => {
      res.json({
        authorization: req.header('authorization') ?? null,
        devUser: req.header('x-clickclack-user') ?? null,
        cookie: req.header('cookie') ?? null,
      });
    });

    const upstreamBinding = await listen(upstreamApp);
    const entityApp = express();
    entityApp.use('/api/clickclack', express.raw({ type: '*/*', limit: '50mb' }));
    entityApp.use(express.json());
    entityApp.use(createApiAuthMiddleware());
    registerClickClackProxyRoutes(entityApp, {
      baseUrl: upstreamBinding.baseUrl,
      devIdentityHeader: 'usr_human',
    });
    const entityBinding = await listen(entityApp);

    try {
      const login = await fetch(`${entityBinding.baseUrl}/clickclack/app?entity_token=entity-token`, { redirect: 'manual' });
      const cookie = login.headers.get('set-cookie') ?? '';
      expect(login.status).toBe(302);
      expect(cookie).toContain('entity-clickclack-token=entity-token');
      expect(cookie).toContain('Path=/clickclack');
      expect(cookie).toContain('Path=/api/clickclack');
      expect(cookie).not.toContain('Path=/;');

      const api = await fetch(`${entityBinding.baseUrl}/api/clickclack/auth-check`, {
        headers: { cookie },
      });
      expect(api.status).toBe(200);
      expect(await api.json()).toEqual({
        authorization: null,
        cookie: null,
        devUser: 'usr_human',
      });
    } finally {
      await close(entityBinding.server);
      await close(upstreamBinding.server);
    }
  });

  it('requires the Entity bearer token before proxying ClickClack API calls', async () => {
    vi.stubEnv('ENTITY_API_TOKEN', 'entity-token');

    const missing = await fetch(`${baseUrl}/api/clickclack/me`);
    expect(missing.status).toBe(401);

    const response = await fetch(`${baseUrl}/api/clickclack/me`, {
      headers: { authorization: 'Bearer entity-token' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: 'usr_human', display_name: 'Entity Human' } });
  });

  it('rejects malformed auth cookies without failing the proxy route', async () => {
    vi.stubEnv('ENTITY_API_TOKEN', 'entity-token');

    const response = await fetch(`${baseUrl}/api/clickclack/me`, {
      headers: { cookie: 'entity-clickclack-token=%' },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 'AUTH_TOKEN_REQUIRED',
    });
  });

  it('strips Entity bearer tokens before proxying to ClickClack', async () => {
    const response = await fetch(`${baseUrl}/api/clickclack/auth-check`, {
      headers: { authorization: 'Bearer entity-token' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authorization: null,
      cookie: null,
      devUser: 'usr_human',
      query: {},
    });
  });

  it('forwards unparsed upload request bodies', async () => {
    const response = await fetch(`${baseUrl}/api/clickclack/upload`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body: '--x\r\nhello\r\n--x--\r\n',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bytes: 19 });
    expect(upstreamHits).toContain('/api/upload:--x\r\nhello\r\n--x--\r\n');
  });

  it('surfaces unavailable ClickClack proxy API routes as explicit degraded failures', async () => {
    const entityApp = express();
    registerClickClackProxyRoutes(entityApp, {
      baseUrl: 'http://127.0.0.1:9',
      devIdentityHeader: 'usr_human',
    });
    const entityBinding = await listen(entityApp);

    try {
      const response = await fetch(`${entityBinding.baseUrl}/api/clickclack/me`);
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        error: 'clickclack_proxy_failed',
      });
    } finally {
      await close(entityBinding.server);
    }
  });

  it('preserves SvelteKit route manifest keys when rewriting app links', async () => {
    const upstreamApp = express();
    upstreamApp.get('/_app/immutable/entry/app.js', (_req, res) => {
      res.type('application/javascript').send([
        'const routes={"/":[2],"/app":[3],"/app/[workspaceID]":[4],"/app/[workspaceID]/[targetID]":[5]};',
        'goto("/app/wsp_1");',
      ].join(''));
    });

    const upstreamBinding = await listen(upstreamApp);
    const entityApp = express();
    registerClickClackProxyRoutes(entityApp, {
      baseUrl: upstreamBinding.baseUrl,
      devIdentityHeader: 'usr_human',
    });
    const entityBinding = await listen(entityApp);

    try {
      const response = await fetch(`${entityBinding.baseUrl}/clickclack/_app/immutable/entry/app.js`);
      expect(response.status).toBe(200);
      const js = await response.text();

      expect(js).toContain('"/app":[3]');
      expect(js).toContain('"/app/[workspaceID]":[4]');
      expect(js).toContain('"/app/[workspaceID]/[targetID]":[5]');
      expect(js).toContain('goto("/clickclack/app/wsp_1")');
    } finally {
      await close(entityBinding.server);
      await close(upstreamBinding.server);
    }
  });

  it('requires Entity auth for the non-api ClickClack UI when ENTITY_API_TOKEN is set', async () => {
    vi.stubEnv('ENTITY_API_TOKEN', 'entity-secret');
    const upstreamApp = express();
    upstreamApp.get('/app', (_req, res) => {
      res.type('html').send('<!doctype html><p>ClickClack</p>');
    });

    const upstreamBinding = await listen(upstreamApp);
    const entityApp = express();
    registerClickClackProxyRoutes(entityApp, {
      baseUrl: upstreamBinding.baseUrl,
      devIdentityHeader: 'usr_human',
    });
    const entityBinding = await listen(entityApp);

    try {
      const denied = await fetch(`${entityBinding.baseUrl}/clickclack/app`);
      expect(denied.status).toBe(401);

      const allowed = await fetch(`${entityBinding.baseUrl}/clickclack/app`, {
        headers: { authorization: 'Bearer entity-secret' },
      });
      expect(allowed.status).toBe(200);
      expect(await allowed.text()).toContain('ClickClack');
    } finally {
      await close(entityBinding.server);
      await close(upstreamBinding.server);
    }
  });
});
