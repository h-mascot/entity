import express from 'express';
import http from 'http';
import { describe, expect, it } from 'vitest';
import { registerRuntimeRoutes } from './runtime';

async function withRuntimeServer(
  devDocumentsToken: string | null,
  shouldExposeDevDocumentsToken: () => boolean,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  registerRuntimeRoutes(app, '/api', {
    agentNativeEditorEnabled: true,
    fsMultiSourceEnabled: true,
    devDocumentsToken,
    shouldExposeDevDocumentsToken,
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed to bind');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('runtime routes', () => {
  it('includes the dev Documents token only when the runtime gate allows it', async () => {
    await withRuntimeServer('random-dev-token', () => true, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/runtime`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        features: {
          fsMultiSourceEnabled: true,
          agentNativeEditorEnabled: true,
        },
        devDocumentsToken: 'random-dev-token',
      });
    });

    await withRuntimeServer('random-dev-token', () => false, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/runtime`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.devDocumentsToken).toBeUndefined();
    });

    await withRuntimeServer(null, () => true, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/runtime`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.devDocumentsToken).toBeUndefined();
    });
  });
});
