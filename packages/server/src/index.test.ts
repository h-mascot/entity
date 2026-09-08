import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiAuthMiddleware } from './middleware/api-auth';

const TOKEN = 'index-registration-test-token';
const originalApiToken = process.env.ENTITY_API_TOKEN;

function startParserContractServer() {
  const app = express();
  app.use(createApiAuthMiddleware());
  app.use('/api/fs/upload', express.json({ limit: '8mb' }));
  app.use(express.json());
  app.post('/api/fs/upload', (req, res) => res.json({ contentLength: req.body.content?.length ?? 0 }));
  app.post('/api/generic', (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  return new Promise<{ server: http.Server; baseUrl: string }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('failed to bind parser contract server');
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

afterEach(() => {
  if (originalApiToken === undefined) delete process.env.ENTITY_API_TOKEN;
  else process.env.ENTITY_API_TOKEN = originalApiToken;
});

describe('server API auth and body-parser registration', () => {
  it('mounts the guarded workspace control adapter separately from customer workspace routes', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'index.ts'), 'utf8');
    expect(source).toContain('app.use("/api/admin/workspace", createAdminWorkspaceRouter({ workspaceRepo }));');
    expect(source).toContain('app.use("/api", createWorkspaceRouter({ workspaceRepo }));');
  });

  it('registers unmounted API auth before the enlarged upload parser in the real entrypoint', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'index.ts'), 'utf8');
    const authRegistration = source.indexOf('app.use(createApiAuthMiddleware());');
    const clickClackParser = source.indexOf('app.use("/api/clickclack", express.raw({ type: "*/*", limit: "50mb" }));');
    const uploadParser = source.indexOf('app.use("/api/fs/upload", express.json({ limit: "8mb" }));');
    const genericParser = source.indexOf('app.use(express.json());');

    expect(authRegistration).toBeGreaterThanOrEqual(0);
    expect(clickClackParser).toBeGreaterThanOrEqual(0);
    expect(uploadParser).toBeGreaterThanOrEqual(0);
    expect(genericParser).toBeGreaterThanOrEqual(0);
    expect(authRegistration).toBeLessThan(clickClackParser);
    expect(authRegistration).toBeLessThan(uploadParser);
    expect(authRegistration).toBeLessThan(genericParser);
  });

  it('rejects unauthenticated malformed and oversized uploads before parsing', async () => {
    process.env.ENTITY_API_TOKEN = TOKEN;
    const { server, baseUrl } = await startParserContractServer();
    try {
      const malformed = await fetch(`${baseUrl}/api/fs/upload`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
      });
      expect(malformed.status).toBe(401);
      await expect(malformed.json()).resolves.toMatchObject({ code: 'AUTH_TOKEN_REQUIRED' });

      const oversized = await fetch(`${baseUrl}/api/fs/upload`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(9 * 1024 * 1024),
      });
      expect(oversized.status).toBe(401);
      await expect(oversized.json()).resolves.toMatchObject({ code: 'AUTH_TOKEN_REQUIRED' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('accepts an authenticated upload envelope through 1 MiB of decoded content', async () => {
    process.env.ENTITY_API_TOKEN = TOKEN;
    const { server, baseUrl } = await startParserContractServer();
    try {
      const content = '\u0001'.repeat(1024 * 1024);
      const response = await fetch(`${baseUrl}/api/fs/upload`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ contentLength: content.length });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('keeps the generic JSON parser bounded at its default 100 KiB limit', async () => {
    process.env.ENTITY_API_TOKEN = TOKEN;
    const { server, baseUrl } = await startParserContractServer();
    try {
      const response = await fetch(`${baseUrl}/api/generic`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ payload: 'x'.repeat(101 * 1024) }),
      });
      expect(response.status).toBe(413);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
