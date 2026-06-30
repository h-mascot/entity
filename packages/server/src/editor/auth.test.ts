import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AgentTokenRepository, AgentTokenRecord } from '../../../db/src/agent-tokens';
import { createEditorRouteAuth } from './auth';

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function makeToken(rawToken: string, scopes: string[] = ['documents:read']): AgentTokenRecord {
  const now = new Date().toISOString();
  return {
    id: 'token-1',
    token_hash: hashToken(rawToken),
    token_type: 'service',
    actor: 'assistant',
    scopes,
    enabled: true,
    created_at: now,
    updated_at: now,
  };
}

function makeRequest(headers: Record<string, string>): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
  } as Request;
}

function makeResponse() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  return res;
}

function makeTokenRepository(token: AgentTokenRecord): AgentTokenRepository {
  return {
    listTokens: () => [token],
    getTokenById: () => token,
    getTokenByTypeAndActor: () => token,
    getTokenByHash: (hash) => (hash === token.token_hash ? token : undefined),
    getAgentTokenByHash: () => undefined,
    getServiceTokenByHash: (hash) => (hash === token.token_hash ? token : undefined),
    upsertToken: () => token,
    setTokenEnabled: () => token,
    deleteToken: () => true,
    validateTokenScopes: () => ({ ok: true, missing_scopes: [], token }),
  };
}

describe('createEditorRouteAuth', () => {
  it('accepts a standard Bearer token and records service actor identity', () => {
    const token = makeToken('doc-token');
    const auth = createEditorRouteAuth({
      tokenRepository: makeTokenRepository(token),
      knownActorIds: ['assistant'],
    });
    const req = makeRequest({
      authorization: 'Bearer doc-token',
      'x-entity-actor': 'assistant',
    });
    const res = makeResponse();
    const next = vi.fn();

    auth.requireScopes(['documents:read'])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(auth.getActorIdentity(req)?.actorId).toBe('assistant');
  });

  it('rejects malformed authorization schemes', () => {
    const token = makeToken('doc-token');
    const auth = createEditorRouteAuth({
      tokenRepository: makeTokenRepository(token),
      knownActorIds: ['assistant'],
    });
    const req = makeRequest({
      authorization: 'Bear doc-token',
      'x-entity-actor': 'assistant',
    });
    const res = makeResponse();
    const next = vi.fn();

    auth.requireScopes(['documents:read'])(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_TOKEN_REQUIRED' }));
  });
});
