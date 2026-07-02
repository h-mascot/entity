import express from 'express';
import http from 'http';
import { describe, expect, it } from 'vitest';
import { registerRuntimeRoutes } from './runtime';

async function withRuntimeServer(devDocumentsToken: string | null, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  registerRuntimeRoutes(app, '/api', {
    agentNativeEditorEnabled: true,
    fsMultiSourceEnabled: true,
    devDocumentsToken,
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
  it('includes the dev Documents token only when startup provisioned it', async () => {
    await withRuntimeServer('entity-dev-documents-token', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/runtime`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        features: {
          fsMultiSourceEnabled: true,
          agentNativeEditorEnabled: true,
        },
        devDocumentsToken: 'entity-dev-documents-token',
      });
    });

    await withRuntimeServer(null, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/runtime`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.devDocumentsToken).toBeUndefined();
    });
  });
});
