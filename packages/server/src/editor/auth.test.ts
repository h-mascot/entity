import { createHash } from 'crypto';
import express from 'express';
import http from 'http';
import { describe, expect, it } from 'vitest';
import type { AgentTokenRecord, AgentTokenRepository } from '../../../db/src/agent-tokens';
import { createEditorRouteAuth } from './auth';

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function makeToken(rawToken: string, scopes: string[]): AgentTokenRecord {
  const now = new Date().toISOString();
  return {
    id: 'token-1',
    token_hash: hashToken(rawToken),
    token_type: 'service',
    actor: 'henry',
    scopes,
    enabled: true,
    created_at: now,
    updated_at: now,
  };
}

function makeTokenRepository(token: AgentTokenRecord): AgentTokenRepository {
  return {
    listTokens: () => [token],
    getTokenById: () => token,
    getTokenByTypeAndActor: () => token,
    getTokenByHash: (tokenHash) => (tokenHash === token.token_hash && token.enabled ? token : undefined),
    getAgentTokenByHash: () => undefined,
    getServiceTokenByHash: (tokenHash) => (tokenHash === token.token_hash && token.enabled ? token : undefined),
    upsertToken: () => token,
    setTokenEnabled: () => token,
    deleteToken: () => false,
    validateTokenScopes: () => ({ ok: true, missing_scopes: [], token }),
  };
}

async function withAuthServer<T>(token: AgentTokenRecord, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  const auth = createEditorRouteAuth({
    tokenRepository: makeTokenRepository(token),
    knownActorIds: ['henry'],
  });
  app.get('/protected', auth.requireScopes(['documents:read']), (req, res) => {
    res.json(auth.getActorIdentity(req));
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('test server failed to bind');
    }
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function withDefaultKnownActorServer<T>(token: AgentTokenRecord, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  const auth = createEditorRouteAuth({
    tokenRepository: makeTokenRepository(token),
  });
  app.get('/protected', auth.requireScopes(['documents:read']), (req, res) => {
    res.json(auth.getActorIdentity(req));
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('test server failed to bind');
    }
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('createEditorRouteAuth', () => {
  it('accepts valid service bearer tokens and X-Entity-Actor context', async () => {
    await withAuthServer(makeToken('valid-token', ['documents:read']), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: {
          Authorization: 'Bearer valid-token',
          'X-Entity-Actor': 'henry',
        },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        actorId: 'henry',
        tokenType: 'service',
      });
    });
  });

  it('rejects malformed bearer headers before token lookup', async () => {
    await withAuthServer(makeToken('valid-token', ['documents:read']), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: {
          Authorization: 'Bear valid-token',
          'X-Entity-Actor': 'henry',
        },
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: 'AUTH_TOKEN_REQUIRED',
      });
    });
  });

  it('accepts default UI service actors without extra env flags', async () => {
    await withDefaultKnownActorServer(makeToken('valid-token', ['documents:read']), async (baseUrl) => {
      for (const actor of ['ada', 'spock', 'scotty']) {
        const response = await fetch(`${baseUrl}/protected`, {
          headers: {
            Authorization: 'Bearer valid-token',
            'X-Entity-Actor': actor,
          },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          actorId: actor,
          tokenType: 'service',
        });
      }
    });
  });
});
