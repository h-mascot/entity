import type express from 'express';
import { DEFAULT_CLICKCLACK_BASE_URL } from './bridge';

export interface ClickClackProxyOptions {
  baseUrl?: string;
  devIdentityHeader?: string;
  fetcher?: typeof fetch;
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const CLICKCLACK_AUTH_COOKIE = 'entity-clickclack-token';
const CLICKCLACK_AUTH_QUERY = 'entity_token';

const CLICKCLACK_SPA_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' http: https: ws: wss:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
].join('; ');

const JSON_PATH_REWRITE_KEYS = new Set(['next', 'url', 'href', 'location', 'redirect', 'redirectTo', 'path', 'pathname']);

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function entityApiToken(): string {
  return process.env.ENTITY_API_TOKEN?.trim() ?? '';
}

function cookieValue(req: express.Request, name: string): string {
  const cookieHeader = req.header('cookie') ?? '';
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}

function queryValue(req: express.Request, name: string): string {
  const value = req.query[name];
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return '';
}

function hasValidEntityAuth(req: express.Request): boolean {
  const token = entityApiToken();
  if (!token) {
    return true;
  }
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const bearer = match?.[1]?.trim() ?? '';
  return bearer === token || cookieValue(req, CLICKCLACK_AUTH_COOKIE) === token || queryValue(req, CLICKCLACK_AUTH_QUERY) === token;
}

function setClickClackAuthCookieIfNeeded(req: express.Request, res: express.Response): void {
  const token = entityApiToken();
  const queryToken = queryValue(req, CLICKCLACK_AUTH_QUERY);
  if (!token || queryToken !== token) {
    return;
  }
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
  } as const;
  res.cookie(CLICKCLACK_AUTH_COOKIE, token, { ...cookieOptions, path: '/clickclack' });
  res.cookie(CLICKCLACK_AUTH_COOKIE, token, { ...cookieOptions, path: '/api/clickclack' });
}

function hasClickClackAuthQuery(req: express.Request): boolean {
  return Boolean(queryValue(req, CLICKCLACK_AUTH_QUERY));
}

function stripClickClackAuthQuery(originalUrl: string): string {
  const [pathname, search = ''] = originalUrl.split('?', 2);
  if (!search) return originalUrl;
  const params = new URLSearchParams(search);
  params.delete(CLICKCLACK_AUTH_QUERY);
  const nextSearch = params.toString();
  return nextSearch ? `${pathname}?${nextSearch}` : pathname;
}

function requireEntityAuth(req: express.Request, res: express.Response): boolean {
  if (hasValidEntityAuth(req)) {
    setClickClackAuthCookieIfNeeded(req, res);
    return true;
  }
  res.status(401).json({
    code: 'AUTH_TOKEN_REQUIRED',
    error: 'Authorization bearer token is required.',
  });
  return false;
}

function rewriteClickClackText(text: string): string {
  return text
    .replace(/href="\/favicon\.svg"/g, 'href="/clickclack/favicon.svg"')
    .replace(/src="\/_app\//g, 'src="/clickclack/_app/')
    .replace(/href="\/_app\//g, 'href="/clickclack/_app/')
    .replace(/import\("\/_app\//g, 'import("/clickclack/_app/')
    .replace(/"\/_app\//g, '"/clickclack/_app/')
    .replace(/'\/_app\//g, "'/clickclack/_app/")
    .replace(/"\/api\//g, '"/api/clickclack/')
    .replace(/'\/api\//g, "'/api/clickclack/")
    .replace(/`\/api\//g, '`/api/clickclack/')
    .replace(/"\/app(?=\/|[?#"])/g, '"/clickclack/app')
    .replace(/'\/app(?=\/|[?#'])/g, "'/clickclack/app")
    .replace(/`\/app(?=\/|[?#`])/g, '`/clickclack/app')
    .replace(/(["'])\/clickclack(\/app(?:\/\[[^\]]+\])*)\1(?=\s*:\s*\[)/g, '$1$2$1')
    .replace(/base:\s*""/g, 'base: "/clickclack"');
}

function rewriteClickClackPath(value: string): string {
  if (value === '/app' || value.startsWith('/app/')) {
    return `/clickclack${value}`;
  }
  if (value === '/api' || value.startsWith('/api/')) {
    return `/api/clickclack${value.slice('/api'.length)}`;
  }
  return value;
}

function rewriteClickClackLocation(value: string, baseUrl: string): string {
  if (value.startsWith('/')) {
    return rewriteClickClackPath(value);
  }
  try {
    const upstream = new URL(baseUrl);
    const parsed = new URL(value);
    if (parsed.origin !== upstream.origin) {
      return value;
    }
    return `${rewriteClickClackPath(parsed.pathname)}${parsed.search}${parsed.hash}`;
  } catch {
    return value;
  }
}

function rewriteClickClackJsonValue(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    return key && JSON_PATH_REWRITE_KEYS.has(key) ? rewriteClickClackPath(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteClickClackJsonValue(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      rewriteClickClackJsonValue(entryValue, entryKey),
    ])
  );
}

function rewriteClickClackJson(text: string): string {
  try {
    return JSON.stringify(rewriteClickClackJsonValue(JSON.parse(text)));
  } catch {
    return text;
  }
}

function upstreamPathForSpa(originalUrl: string): string {
  const withoutPrefix = originalUrl.replace(/^\/clickclack\/?/, '/');
  if (withoutPrefix === '/' || withoutPrefix === '') {
    return '/app';
  }
  return withoutPrefix;
}

function upstreamPathForApi(originalUrl: string): string {
  const withoutPrefix = originalUrl.replace(/^\/api\/clickclack\/?/, '/');
  return withoutPrefix === '/' ? '/api' : `/api${withoutPrefix}`;
}

function readRequestBody(req: express.Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function bodyForProxy(req: express.Request): Promise<BodyInit | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return undefined;
  }
  if (req.body === undefined || req.body === null) {
    const raw = await readRequestBody(req);
    return raw.length > 0 ? raw as unknown as BodyInit : undefined;
  }
  if (Buffer.isBuffer(req.body)) {
    return req.body as unknown as BodyInit;
  }
  if (typeof req.body === 'string') {
    return req.body;
  }
  return JSON.stringify(req.body);
}

async function proxyRequest(
  req: express.Request,
  res: express.Response,
  targetUrl: string,
  options: Required<ClickClackProxyOptions>
): Promise<void> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    const lowerName = name.toLowerCase();
    if (!value || HOP_BY_HOP_HEADERS.has(lowerName) || lowerName === 'authorization' || lowerName === 'cookie') continue;
    if (Array.isArray(value)) {
      headers.set(name, value.join(', '));
    } else {
      headers.set(name, value);
    }
  }
  headers.set('host', new URL(options.baseUrl).host);
  if (options.devIdentityHeader) {
    headers.set('X-ClickClack-User', options.devIdentityHeader);
  }
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    headers.set('Content-Type', 'application/json');
  }

  const upstream = await options.fetcher(targetUrl, {
    method: req.method,
    headers,
    body: await bodyForProxy(req),
    duplex: 'half',
    redirect: 'manual',
  } as RequestInit & { duplex: 'half' });

  res.status(upstream.status);
  upstream.headers.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      res.setHeader(name, name.toLowerCase() === 'location' ? rewriteClickClackLocation(value, options.baseUrl) : value);
    }
  });
  if (req.originalUrl.startsWith('/clickclack')) {
    res.setHeader('Content-Security-Policy', CLICKCLACK_SPA_CSP);
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  const bytes = Buffer.from(await upstream.arrayBuffer());
  if (
    contentType.includes('text/html') ||
    contentType.includes('javascript')
  ) {
    res.send(rewriteClickClackText(bytes.toString('utf8')));
    return;
  }
  if (contentType.includes('json')) {
    res.send(rewriteClickClackJson(bytes.toString('utf8')));
    return;
  }

  res.send(bytes);
}

export function registerClickClackProxyRoutes(app: express.Express, options: ClickClackProxyOptions = {}): void {
  const resolved: Required<ClickClackProxyOptions> = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? process.env.ENTITY_CLICKCLACK_BASE_URL ?? DEFAULT_CLICKCLACK_BASE_URL),
    devIdentityHeader: options.devIdentityHeader ?? process.env.ENTITY_CLICKCLACK_DEV_USER ?? '',
    fetcher: options.fetcher ?? fetch,
  };

  app.use('/api/clickclack', (req, res) => {
    if (!requireEntityAuth(req, res)) {
      return;
    }
    const targetUrl = `${resolved.baseUrl}${upstreamPathForApi(stripClickClackAuthQuery(req.originalUrl))}`;
    void proxyRequest(req, res, targetUrl, resolved).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: 'clickclack_proxy_failed', message });
    });
  });

  app.use('/clickclack', (req, res) => {
    if (!requireEntityAuth(req, res)) {
      return;
    }
    if (hasClickClackAuthQuery(req)) {
      res.redirect(302, stripClickClackAuthQuery(req.originalUrl));
      return;
    }
    if (req.originalUrl === '/clickclack' || req.originalUrl === '/clickclack/') {
      res.redirect(302, '/clickclack/app');
      return;
    }
    const targetUrl = `${resolved.baseUrl}${upstreamPathForSpa(req.originalUrl)}`;
    void proxyRequest(req, res, targetUrl, resolved).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).send(`ClickClack proxy failed: ${message}`);
    });
  });
}
