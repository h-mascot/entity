import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentTokenRecord,
  AgentTokenRepository,
} from '../../../db/src/agent-tokens';
import { createEditorRouteAuth } from './auth';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function makeTokenRepo(tokens: AgentTokenRecord[]): AgentTokenRepository {
  const byHash = new Map(tokens.map((token) => [token.token_hash, token]));
  return {
    listTokens: () => tokens,
    getTokenById: () => undefined,
    getTokenByTypeAndActor: () => undefined,
    getTokenByHash: (hash) => byHash.get(hash),
    getAgentTokenByHash: (hash) => byHash.get(hash),
    getServiceTokenByHash: (hash) => byHash.get(hash),
    upsertToken: () => {
      throw new Error('not implemented');
    },
    setTokenEnabled: () => undefined,
    deleteToken: () => false,
    validateTokenScopes: () => ({ ok: true, missing_scopes: [], token: null }),
  } as unknown as AgentTokenRepository;
}

function agentToken(overrides: Partial<AgentTokenRecord> = {}): AgentTokenRecord {
  const now = new Date().toISOString();
  return {
    id: 'tok-1',
    token_hash: hashToken('secret-token'),
    token_type: 'agent',
    actor: 'henry',
    scopes: ['documents:read', 'documents:comment:write'],
    enabled: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function mockReqRes(headers: Record<string, string>) {
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  } as unknown as Response & { statusCode: number; body: unknown };
  return { req, res };
}

describe('createEditorRouteAuth bearer parsing', () => {
  it('accepts a well-formed "Bearer <token>" header and resolves the actor', () => {
    const auth = createEditorRouteAuth({ tokenRepository: makeTokenRepo([agentToken()]) });
    const { req, res } = mockReqRes({ authorization: 'Bearer secret-token' });
    const next = vi.fn();

    auth.requireScopes(['documents:read'])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((res as Response & { statusCode: number }).statusCode).toBe(200);
    expect(auth.getActorIdentity(req)?.actorId).toBe('henry');
  });

  it('accepts case-insensitive scheme and extra whitespace', () => {
    const auth = createEditorRouteAuth({ tokenRepository: makeTokenRepo([agentToken()]) });
    const { req, res } = mockReqRes({ authorization: 'bearer   secret-token' });
    const next = vi.fn();

    auth.requireScopes([])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing or malformed Authorization header', () => {
    const auth = createEditorRouteAuth({ tokenRepository: makeTokenRepo([agentToken()]) });
    const next = vi.fn();

    const missing = mockReqRes({});
    auth.requireScopes([])(missing.req, missing.res, next);
    expect(next).not.toHaveBeenCalled();
    expect((missing.res as Response & { statusCode: number }).statusCode).toBe(401);

    const malformed = mockReqRes({ authorization: 'Token secret-token' });
    auth.requireScopes([])(malformed.req, malformed.res, next);
    expect(next).not.toHaveBeenCalled();
  });
});
