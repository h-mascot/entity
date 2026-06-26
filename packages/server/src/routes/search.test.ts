import express from 'express';
import http from 'http';
import { describe, expect, it } from 'vitest';
import { resolvePhase2Flags } from '../phase2-flags';
import { createSearchRouter } from './search';

async function withSearchServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use('/api/search', createSearchRouter({
    flags: resolvePhase2Flags({ ENTITY_PHASE2_SEARCH_PERMISSION_STRICTNESS: 'off' }),
  }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server failed to bind');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe('search route feature flags', () => {
  it('fails closed before returning snippets or documents when permission strictness is disabled', async () => {
    await withSearchServer(async (baseUrl) => {
      const searchResponse = await fetch(`${baseUrl}/api/search?q=customer`);
      expect(searchResponse.status).toBe(503);
      expect(await searchResponse.json()).toMatchObject({
        error: 'search permission strictness disabled',
        flag: {
          key: 'search_permission_strictness',
          enabled: false,
          source: 'env',
        },
      });

      const documentResponse = await fetch(`${baseUrl}/api/search/document?id=memory/customer.md`);
      expect(documentResponse.status).toBe(503);
      expect(await documentResponse.json()).toMatchObject({
        error: 'search permission strictness disabled',
      });
    });
  });
});
