import { describe, expect, it, afterEach, vi } from 'vitest';
import type { AgentTokenRecord, AgentTokenRepository, UpsertAgentTokenInput } from '../../../db/src/agent-tokens';
import {
  DEV_DOCUMENTS_TOKEN,
  DEV_DOCUMENTS_TOKEN_ACTOR,
  DEV_DOCUMENTS_TOKEN_SCOPES,
  ensureDevDocumentsToken,
  shouldProvisionDevDocumentsToken,
} from './dev-token';
import { hashToken } from './auth';

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeTokenRepository(upserts: UpsertAgentTokenInput[]): AgentTokenRepository {
  const now = new Date().toISOString();
  const record: AgentTokenRecord = {
    id: 'dev-documents-assistant-token',
    token_hash: hashToken(DEV_DOCUMENTS_TOKEN),
    token_type: 'agent',
    actor: DEV_DOCUMENTS_TOKEN_ACTOR,
    scopes: [...DEV_DOCUMENTS_TOKEN_SCOPES],
    enabled: true,
    created_at: now,
    updated_at: now,
  };

  return {
    listTokens: () => [record],
    getTokenById: () => record,
    getTokenByTypeAndActor: () => record,
    getTokenByHash: () => record,
    getAgentTokenByHash: () => record,
    getServiceTokenByHash: () => undefined,
    upsertToken: (input) => {
      upserts.push(input);
      return record;
    },
    setTokenEnabled: () => record,
    deleteToken: () => false,
    validateTokenScopes: () => ({ ok: true, missing_scopes: [], token: record }),
  };
}

describe('ensureDevDocumentsToken', () => {
  it('provisions the fixed scoped bearer token only for tokenless loopback dev mode', () => {
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('ENTITY_API_TOKEN', '');
    const upserts: UpsertAgentTokenInput[] = [];
    const logger = { log: vi.fn() };

    const token = ensureDevDocumentsToken({
      tokenRepository: makeTokenRepository(upserts),
      logger,
    });

    expect(token).toBe(DEV_DOCUMENTS_TOKEN);
    expect(upserts).toEqual([
      expect.objectContaining({
        token_hash: hashToken(DEV_DOCUMENTS_TOKEN),
        token_type: 'agent',
        actor: DEV_DOCUMENTS_TOKEN_ACTOR,
        scopes: DEV_DOCUMENTS_TOKEN_SCOPES,
        enabled: true,
      }),
    ]);
    expect(logger.log).toHaveBeenCalledTimes(1);
  });

  it('does not provision when API auth is enabled, host is non-loopback, or the escape hatch is set', () => {
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('ENTITY_API_TOKEN', 'prod-token');
    expect(shouldProvisionDevDocumentsToken()).toBe(false);

    vi.stubEnv('ENTITY_API_TOKEN', '');
    vi.stubEnv('HOST', '0.0.0.0');
    expect(shouldProvisionDevDocumentsToken()).toBe(false);

    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('ENTITY_DISABLE_DEV_DOCUMENTS_TOKEN', '1');
    expect(shouldProvisionDevDocumentsToken()).toBe(false);
  });

  it('treats an unset host as the non-loopback server default', () => {
    vi.stubEnv('ENTITY_API_TOKEN', '');
    delete process.env.HOST;

    expect(shouldProvisionDevDocumentsToken()).toBe(false);
  });
});
