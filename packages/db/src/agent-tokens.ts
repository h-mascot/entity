import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export const AGENT_TOKEN_TYPES = ['agent', 'service'] as const;
export type AgentTokenType = (typeof AGENT_TOKEN_TYPES)[number];

export interface AgentTokenRecord {
  id: string;
  token_hash: string;
  token_type: AgentTokenType;
  actor: string;
  scopes: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertAgentTokenInput {
  id?: string;
  token_hash: string;
  token_type: AgentTokenType | string;
  actor: string;
  scopes?: readonly string[];
  enabled?: boolean;
}

export interface AgentTokenLookupOptions {
  token_type?: AgentTokenType;
  include_disabled?: boolean;
}

export interface AgentTokenListFilters {
  token_type?: AgentTokenType;
  actor?: string;
  include_disabled?: boolean;
  limit?: number;
}

export interface TokenScopeValidationResult {
  ok: boolean;
  missing_scopes: string[];
  token: AgentTokenRecord | null;
}

export interface AgentTokenRepository {
  listTokens: (filters?: AgentTokenListFilters) => AgentTokenRecord[];
  getTokenById: (id: string) => AgentTokenRecord | undefined;
  getTokenByTypeAndActor: (tokenType: AgentTokenType, actor: string) => AgentTokenRecord | undefined;
  getTokenByHash: (tokenHash: string, options?: AgentTokenLookupOptions) => AgentTokenRecord | undefined;
  getAgentTokenByHash: (tokenHash: string, includeDisabled?: boolean) => AgentTokenRecord | undefined;
  getServiceTokenByHash: (tokenHash: string, includeDisabled?: boolean) => AgentTokenRecord | undefined;
  upsertToken: (input: UpsertAgentTokenInput) => AgentTokenRecord;
  setTokenEnabled: (id: string, enabled: boolean) => AgentTokenRecord | undefined;
  deleteToken: (id: string) => boolean;
  validateTokenScopes: (
    tokenHash: string,
    requiredScopes: readonly string[],
    options?: AgentTokenLookupOptions
  ) => TokenScopeValidationResult;
}

function openEntityDatabase(): Database.Database {
  return getEntityDatabase(ensureTokenSchema);
}

function ensureTokenSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      token_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tokens_hash ON agent_tokens(token_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tokens_type_actor ON agent_tokens(token_type, actor);
    CREATE INDEX IF NOT EXISTS idx_agent_tokens_updated_at ON agent_tokens(updated_at DESC);
  `);
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string') {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  return false;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} is required`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }

  return trimmed;
}

function normalizeTokenType(value: unknown): AgentTokenType {
  if (typeof value !== 'string') {
    throw new Error('token_type is required');
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'agent':
    case 'service':
      return normalized;
    default:
      throw new Error(`Unsupported token_type: ${value}`);
  }
}

function normalizeMappedTokenType(value: unknown): AgentTokenType {
  if (typeof value !== 'string') {
    return 'agent';
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'service' ? 'service' : 'agent';
}

function clampLimit(limit: number | undefined, fallback = 200, minimum = 1, maximum = 1000): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit)) {
    return fallback;
  }

  if (limit < minimum) {
    return minimum;
  }

  if (limit > maximum) {
    return maximum;
  }

  return limit;
}

function normalizeScopeValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeScopeList(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const scope of scopes) {
    const normalized = normalizeScopeValue(scope);
    if (normalized) {
      deduped.add(normalized);
    }
  }

  return Array.from(deduped.values());
}

function parseScopesJson(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return normalizeScopeList(parsed);
    } catch {
      return [];
    }
  }

  return normalizeScopeList(value);
}

function mapTokenRow(row: Record<string, unknown>): AgentTokenRecord {
  return {
    id: String(row.id ?? ''),
    token_hash: String(row.token_hash ?? ''),
    token_type: normalizeMappedTokenType(row.token_type),
    actor: String(row.actor ?? ''),
    scopes: parseScopesJson(row.scopes_json),
    enabled: normalizeBoolean(row.enabled),
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
  };
}

export function normalizeRequiredScopes(scopes: readonly string[]): string[] {
  return normalizeScopeList(scopes as unknown);
}

export function scopeMatches(grantedScope: string, requiredScope: string): boolean {
  const granted = normalizeScopeValue(grantedScope);
  const required = normalizeScopeValue(requiredScope);
  if (!granted || !required) {
    return false;
  }

  if (granted === '*' || granted === required) {
    return true;
  }

  if (granted.endsWith(':*')) {
    const prefix = granted.slice(0, -1);
    return required.startsWith(prefix);
  }

  return false;
}

export function hasScope(grantedScopes: readonly string[], requiredScope: string): boolean {
  const normalizedRequired = normalizeScopeValue(requiredScope);
  if (!normalizedRequired) {
    return false;
  }

  const normalizedGranted = normalizeScopeList(grantedScopes as unknown);
  return normalizedGranted.some((scope) => scopeMatches(scope, normalizedRequired));
}

export function tokenHasScope(token: Pick<AgentTokenRecord, 'scopes'>, requiredScope: string): boolean {
  return hasScope(token.scopes, requiredScope);
}

export function missingScopes(grantedScopes: readonly string[], requiredScopes: readonly string[]): string[] {
  const normalizedRequired = normalizeRequiredScopes(requiredScopes);
  return normalizedRequired.filter((scope) => !hasScope(grantedScopes, scope));
}

export function tokenMissingScopes(
  token: Pick<AgentTokenRecord, 'scopes'>,
  requiredScopes: readonly string[]
): string[] {
  return missingScopes(token.scopes, requiredScopes);
}

export function hasAllScopes(grantedScopes: readonly string[], requiredScopes: readonly string[]): boolean {
  return missingScopes(grantedScopes, requiredScopes).length === 0;
}

export function tokenHasAllScopes(token: Pick<AgentTokenRecord, 'scopes'>, requiredScopes: readonly string[]): boolean {
  return hasAllScopes(token.scopes, requiredScopes);
}

export function createAgentTokenRepository(): AgentTokenRepository {
  const db = openEntityDatabase();

  const getTokenByIdStmt = db.prepare('SELECT * FROM agent_tokens WHERE id = ?');
  const getTokenByTypeActorStmt = db.prepare('SELECT * FROM agent_tokens WHERE token_type = ? AND actor = ?');
  const upsertTokenStmt = db.prepare(`
    INSERT INTO agent_tokens (
      id,
      token_hash,
      token_type,
      actor,
      scopes_json,
      enabled,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(token_type, actor) DO UPDATE SET
      token_hash = excluded.token_hash,
      scopes_json = excluded.scopes_json,
      enabled = excluded.enabled,
      updated_at = CURRENT_TIMESTAMP
  `);
  const setTokenEnabledStmt = db.prepare('UPDATE agent_tokens SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  const deleteTokenStmt = db.prepare('DELETE FROM agent_tokens WHERE id = ?');
  const lookupTokenByHash = (
    tokenHash: string,
    options: AgentTokenLookupOptions = {}
  ): AgentTokenRecord | undefined => {
    const normalizedHash = requireNonEmptyString(tokenHash, 'tokenHash');
    const includeDisabled = normalizeBoolean(options.include_disabled ?? false);
    const clauses: string[] = ['token_hash = ?'];
    const values: unknown[] = [normalizedHash];

    if (!includeDisabled) {
      clauses.push('enabled = 1');
    }

    if (options.token_type) {
      clauses.push('token_type = ?');
      values.push(normalizeTokenType(options.token_type));
    }

    const stmt = db.prepare(`SELECT * FROM agent_tokens WHERE ${clauses.join(' AND ')} LIMIT 1`);
    const row = stmt.get(...values) as Record<string, unknown> | undefined;
    return row ? mapTokenRow(row) : undefined;
  };

  return {
    listTokens: (filters: AgentTokenListFilters = {}) => {
      const includeDisabled = normalizeBoolean(filters.include_disabled ?? false);
      const clauses: string[] = [];
      const values: unknown[] = [];
      if (!includeDisabled) {
        clauses.push('enabled = 1');
      }

      if (filters.token_type) {
        clauses.push('token_type = ?');
        values.push(filters.token_type);
      }

      if (typeof filters.actor === 'string' && filters.actor.trim()) {
        clauses.push('actor = ?');
        values.push(filters.actor.trim());
      }

      const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const limit = clampLimit(filters.limit, 200);
      const stmt = db.prepare(
        `SELECT * FROM agent_tokens ${whereClause} ORDER BY datetime(updated_at) DESC, id DESC LIMIT ?`
      );
      const rows = stmt.all(...values, limit) as Array<Record<string, unknown>>;
      return rows.map(mapTokenRow);
    },

    getTokenById: (id: string) => {
      const normalizedId = requireNonEmptyString(id, 'id');
      const row = getTokenByIdStmt.get(normalizedId) as Record<string, unknown> | undefined;
      return row ? mapTokenRow(row) : undefined;
    },

    getTokenByTypeAndActor: (tokenType: AgentTokenType, actor: string) => {
      const normalizedTokenType = normalizeTokenType(tokenType);
      const normalizedActor = requireNonEmptyString(actor, 'actor');
      const row = getTokenByTypeActorStmt.get(normalizedTokenType, normalizedActor) as Record<string, unknown> | undefined;
      return row ? mapTokenRow(row) : undefined;
    },

    getTokenByHash: (tokenHash: string, options: AgentTokenLookupOptions = {}) => {
      return lookupTokenByHash(tokenHash, options);
    },

    getAgentTokenByHash: (tokenHash: string, includeDisabled = false) => {
      return lookupTokenByHash(tokenHash, {
        token_type: 'agent',
        include_disabled: includeDisabled,
      });
    },

    getServiceTokenByHash: (tokenHash: string, includeDisabled = false) => {
      return lookupTokenByHash(tokenHash, {
        token_type: 'service',
        include_disabled: includeDisabled,
      });
    },

    upsertToken: (input: UpsertAgentTokenInput) => {
      const id = normalizeOptionalString(input.id) ?? randomUUID();
      const tokenHash = requireNonEmptyString(input.token_hash, 'token_hash');
      const tokenType = normalizeTokenType(input.token_type);
      const actor = requireNonEmptyString(input.actor, 'actor');
      const scopes = normalizeScopeList(input.scopes as unknown);
      const enabled = normalizeBoolean(input.enabled ?? true);

      upsertTokenStmt.run(id, tokenHash, tokenType, actor, JSON.stringify(scopes), enabled ? 1 : 0);
      const row = getTokenByTypeActorStmt.get(tokenType, actor) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to upsert agent token');
      }

      return mapTokenRow(row);
    },

    setTokenEnabled: (id: string, enabled: boolean) => {
      const normalizedId = requireNonEmptyString(id, 'id');
      const result = setTokenEnabledStmt.run(enabled ? 1 : 0, normalizedId);
      if (result.changes < 1) {
        return undefined;
      }

      const row = getTokenByIdStmt.get(normalizedId) as Record<string, unknown> | undefined;
      return row ? mapTokenRow(row) : undefined;
    },

    deleteToken: (id: string) => {
      const normalizedId = requireNonEmptyString(id, 'id');
      const result = deleteTokenStmt.run(normalizedId);
      return result.changes > 0;
    },

    validateTokenScopes: (
      tokenHash: string,
      requiredScopes: readonly string[],
      options: AgentTokenLookupOptions = {}
    ): TokenScopeValidationResult => {
      const token = lookupTokenByHash(tokenHash, options) ?? null;

      const normalizedRequired = normalizeRequiredScopes(requiredScopes);
      if (!token) {
        return {
          ok: false,
          missing_scopes: normalizedRequired,
          token: null,
        };
      }

      const missing = tokenMissingScopes(token, normalizedRequired);
      return {
        ok: missing.length === 0,
        missing_scopes: missing,
        token,
      };
    },
  };
}
