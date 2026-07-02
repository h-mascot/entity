import { describe, expect, it, afterEach, vi } from 'vitest';
import type { AgentTokenRecord, AgentTokenRepository, UpsertAgentTokenInput } from '../../../db/src/agent-tokens';
import {
  DEV_DOCUMENTS_TOKEN_ACTOR,
  DEV_DOCUMENTS_TOKEN_SCOPES,
  ensureDevDocumentsToken,
  shouldProvisionDevDocumentsToken,
} from './dev-token';
import { hashToken } from './auth';

const LEGACY_DEV_DOCUMENTS_TOKEN = 'entity-dev-documents-token';

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeToken(overrides: Partial<AgentTokenRecord> = {}): AgentTokenRecord {
  const now = new Date().toISOString();
  return {
    id: 'dev-documents-token',
    token_hash: hashToken('existing-dev-documents-token'),
    token_type: 'agent',
    actor: DEV_DOCUMENTS_TOKEN_ACTOR,
    scopes: [...DEV_DOCUMENTS_TOKEN_SCOPES],
    enabled: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeLegacyToken(): AgentTokenRecord {
  return makeToken({
    id: 'dev-documents-assistant-token',
    token_hash: hashToken(LEGACY_DEV_DOCUMENTS_TOKEN),
    actor: 'assistant',
  });
}

function makeTokenRepository(initialRecords: AgentTokenRecord[] = []): {
  deletedIds: string[];
  records: () => AgentTokenRecord[];
  repository: AgentTokenRepository;
  upserts: UpsertAgentTokenInput[];
} {
  const recordsById = new Map(initialRecords.map((record) => [record.id, { ...record }]));
  const deletedIds: string[] = [];
  const upserts: UpsertAgentTokenInput[] = [];

  const repository: AgentTokenRepository = {
    listTokens: (filters = {}) => {
      return Array.from(recordsById.values()).filter((record) => {
        if (!filters.include_disabled && !record.enabled) {
          return false;
        }
        if (filters.token_type && record.token_type !== filters.token_type) {
          return false;
        }
        if (filters.actor && record.actor !== filters.actor) {
          return false;
        }
        return true;
      });
    },
    getTokenById: (id) => recordsById.get(id),
    getTokenByTypeAndActor: (tokenType, actor) =>
      Array.from(recordsById.values()).find((record) => record.token_type === tokenType && record.actor === actor),
    getTokenByHash: (tokenHash, options = {}) =>
      Array.from(recordsById.values()).find((record) =>
        record.token_hash === tokenHash &&
        (!options.token_type || record.token_type === options.token_type) &&
        (options.include_disabled || record.enabled)
      ),
    getAgentTokenByHash: (tokenHash, includeDisabled = false) =>
      Array.from(recordsById.values()).find((record) =>
        record.token_type === 'agent' &&
        record.token_hash === tokenHash &&
        (includeDisabled || record.enabled)
      ),
    getServiceTokenByHash: (tokenHash, includeDisabled = false) =>
      Array.from(recordsById.values()).find((record) =>
        record.token_type === 'service' &&
        record.token_hash === tokenHash &&
        (includeDisabled || record.enabled)
      ),
    upsertToken: (input) => {
      upserts.push(input);
      const now = new Date().toISOString();
      const id = input.id ?? 'generated-token';
      for (const [existingId, record] of recordsById.entries()) {
        if (record.token_type === input.token_type && record.actor === input.actor && existingId !== id) {
          recordsById.delete(existingId);
        }
      }
      const record = makeToken({
        id,
        token_hash: input.token_hash,
        token_type: input.token_type === 'service' ? 'service' : 'agent',
        actor: input.actor,
        scopes: [...(input.scopes ?? [])],
        enabled: input.enabled ?? true,
        created_at: recordsById.get(id)?.created_at ?? now,
        updated_at: now,
      });
      recordsById.set(id, record);
      return record;
    },
    setTokenEnabled: (id, enabled) => {
      const record = recordsById.get(id);
      if (!record) {
        return undefined;
      }
      const updated = { ...record, enabled };
      recordsById.set(id, updated);
      return updated;
    },
    deleteToken: (id) => {
      deletedIds.push(id);
      return recordsById.delete(id);
    },
    validateTokenScopes: () => ({ ok: true, missing_scopes: [], token: null }),
  };

  return {
    deletedIds,
    records: () => Array.from(recordsById.values()),
    repository,
    upserts,
  };
}

describe('ensureDevDocumentsToken', () => {
  it('provisions a random scoped bearer token only for tokenless loopback dev mode', () => {
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('ENTITY_API_TOKEN', '');
    const repo = makeTokenRepository([makeToken()]);
    const logger = { log: vi.fn() };

    const token = ensureDevDocumentsToken({
      tokenRepository: repo.repository,
      logger,
    });

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(token).not.toBe(LEGACY_DEV_DOCUMENTS_TOKEN);
    expect(repo.deletedIds).toContain('dev-documents-token');
    expect(repo.upserts).toEqual([
      expect.objectContaining({
        token_hash: hashToken(token ?? ''),
        token_type: 'agent',
        actor: DEV_DOCUMENTS_TOKEN_ACTOR,
        scopes: DEV_DOCUMENTS_TOKEN_SCOPES,
        enabled: true,
      }),
    ]);
    expect(repo.records()).toEqual([
      expect.objectContaining({
        actor: DEV_DOCUMENTS_TOKEN_ACTOR,
        token_hash: hashToken(token ?? ''),
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

  it('does not provision and purges the dev token row when API auth is enabled', () => {
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('ENTITY_API_TOKEN', 'prod-token');
    const repo = makeTokenRepository([makeToken(), makeLegacyToken()]);

    const token = ensureDevDocumentsToken({ tokenRepository: repo.repository });

    expect(token).toBeNull();
    expect(repo.upserts).toHaveLength(0);
    expect(repo.deletedIds).toEqual(expect.arrayContaining(['dev-documents-token', 'dev-documents-assistant-token']));
    expect(repo.records()).toEqual([]);
  });

  it('does not provision and purges the dev token row when HOST is non-loopback', () => {
    vi.stubEnv('HOST', '0.0.0.0');
    vi.stubEnv('ENTITY_API_TOKEN', '');
    const repo = makeTokenRepository([makeToken()]);

    const token = ensureDevDocumentsToken({ tokenRepository: repo.repository });

    expect(token).toBeNull();
    expect(repo.upserts).toHaveLength(0);
    expect(repo.deletedIds).toEqual(['dev-documents-token']);
    expect(repo.records()).toEqual([]);
  });

  it('does not provision and purges the dev token row when disabled by env', () => {
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('ENTITY_API_TOKEN', '');
    vi.stubEnv('ENTITY_DISABLE_DEV_DOCUMENTS_TOKEN', 'true');
    const repo = makeTokenRepository([makeToken()]);

    const token = ensureDevDocumentsToken({ tokenRepository: repo.repository });

    expect(token).toBeNull();
    expect(repo.upserts).toHaveLength(0);
    expect(repo.deletedIds).toEqual(['dev-documents-token']);
    expect(repo.records()).toEqual([]);
  });

  it('treats an unset host as the non-loopback server default', () => {
    vi.stubEnv('ENTITY_API_TOKEN', '');
    delete process.env.HOST;

    expect(shouldProvisionDevDocumentsToken()).toBe(false);
  });
});
