/**
 * Customer access tokens — individually revocable per-request credentials.
 *
 * Each token is a high-entropy secret (presented once at creation) whose
 * SHA-256 hash is stored. A token resolves to exactly one stored principal;
 * resolving fails closed when the token is revoked OR the bound principal is
 * disabled/missing. This is the per-request customer principal/session
 * primitive the data plane previously lacked (Terra B1): it is bound to an
 * active principal and its stored scoped grants, and revoking the token or
 * disabling the principal immediately denies the caller.
 *
 * Additive only: a new table with `IF NOT EXISTS` creation. No change to
 * existing principal/grant tables or to the deployment-wide ENTITY_API_TOKEN
 * transport bearer.
 */

import { createHash, randomBytes, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';
import {
  createPrincipalRepository,
  type PrincipalRecord,
  type PrincipalGrantRecord,
  type PrincipalRepository,
} from './principals';

export const ACCESS_TOKEN_PREFIX = 'ect_';

export interface AccessTokenRecord {
  id: string;
  principal_id: string;
  label: string | null;
  token_hash: string;
  token_prefix: string;
  status: 'active' | 'revoked';
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
  created_by: string | null;
}

export interface CreateAccessTokenInput {
  principal_id: string;
  label?: string | null;
  created_by?: string | null;
}

/** Result of creating a token: the plaintext secret is returned exactly once. */
export interface CreatedAccessToken {
  record: AccessTokenRecord;
  /** Plaintext token. Store/return to the caller; never persisted or recoverable. */
  token: string;
}

export interface ResolvedAccessToken {
  token: AccessTokenRecord;
  principal: PrincipalRecord;
  grants: PrincipalGrantRecord[];
}

export interface AccessTokenRepository {
  createToken: (input: CreateAccessTokenInput) => CreatedAccessToken;
  resolveToken: (rawToken: string) => ResolvedAccessToken | null;
  revokeToken: (id: string) => boolean;
  listTokensForPrincipal: (principalId: string) => AccessTokenRecord[];
  getToken: (id: string) => AccessTokenRecord | undefined;
}

function openEntityDatabase(): Database.Database {
  return getEntityDatabase(ensureAccessTokensSchema);
}

export function ensureAccessTokensSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_access_tokens (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      label TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      created_by TEXT,
      FOREIGN KEY (principal_id) REFERENCES entity_principals(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_access_tokens_hash ON entity_access_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_access_tokens_principal ON entity_access_tokens(principal_id);
    CREATE INDEX IF NOT EXISTS idx_access_tokens_status ON entity_access_tokens(status);
  `);
}

export function hashAccessToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** Generate a new plaintext token. Exported for tests; production uses createToken. */
export function generateAccessToken(): string {
  return ACCESS_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

function mapRow(row: Record<string, unknown>): AccessTokenRecord {
  return {
    id: String(row.id ?? ''),
    principal_id: String(row.principal_id ?? ''),
    label: typeof row.label === 'string' ? row.label : null,
    token_hash: String(row.token_hash ?? ''),
    token_prefix: String(row.token_prefix ?? ''),
    status: row.status === 'revoked' ? 'revoked' : 'active',
    last_used_at: typeof row.last_used_at === 'string' ? row.last_used_at : null,
    created_at: String(row.created_at ?? ''),
    revoked_at: typeof row.revoked_at === 'string' ? row.revoked_at : null,
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
  };
}

export function createAccessTokenRepository(
  db?: Database.Database,
  principalRepo?: PrincipalRepository,
): AccessTokenRepository {
  const database = db ?? openEntityDatabase();
  const principals = principalRepo ?? createPrincipalRepository(database);
  const touchLastUsed = database.prepare(
    "UPDATE entity_access_tokens SET last_used_at = datetime('now') WHERE id = ?",
  );

  return {
    createToken(input) {
      const principal = principals.getPrincipal(input.principal_id);
      if (!principal) {
        throw new Error(`principal ${input.principal_id} not found`);
      }
      if (principal.status !== 'active') {
        throw new Error(`principal ${input.principal_id} is not active`);
      }
      const id = randomUUID();
      const token = generateAccessToken();
      const tokenHash = hashAccessToken(token);
      const prefix = token.slice(0, ACCESS_TOKEN_PREFIX.length + 8);
      const label = input.label?.trim() || null;
      database
        .prepare(
          `INSERT INTO entity_access_tokens
             (id, principal_id, label, token_hash, token_prefix, status, created_by)
           VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        )
        .run(id, input.principal_id, label, tokenHash, prefix, input.created_by ?? null);
      const row = database
        .prepare('SELECT * FROM entity_access_tokens WHERE id = ?')
        .get(id) as Record<string, unknown>;
      return { record: mapRow(row), token };
    },

    resolveToken(rawToken) {
      if (typeof rawToken !== 'string' || !rawToken.trim()) return null;
      const tokenHash = hashAccessToken(rawToken.trim());
      const row = database
        .prepare('SELECT * FROM entity_access_tokens WHERE token_hash = ?')
        .get(tokenHash) as Record<string, unknown> | undefined;
      if (!row) return null;
      const record = mapRow(row);
      if (record.status !== 'active') return null;
      const principal = principals.getPrincipal(record.principal_id);
      if (!principal || principal.status !== 'active') return null;
      // Best-effort last-used touch; never blocks resolution.
      try {
        touchLastUsed.run(record.id);
      } catch {
        /* ignore */
      }
      return { token: record, principal, grants: principals.listGrantsForPrincipal(principal.id) };
    },

    revokeToken(id) {
      const row = database
        .prepare("SELECT 1 FROM entity_access_tokens WHERE id = ? AND status = 'active'")
        .get(id);
      if (!row) return false;
      database
        .prepare(
          `UPDATE entity_access_tokens
             SET status = 'revoked', revoked_at = datetime('now')
           WHERE id = ?`,
        )
        .run(id);
      return true;
    },

    listTokensForPrincipal(principalId) {
      const rows = database
        .prepare(
          'SELECT * FROM entity_access_tokens WHERE principal_id = ? ORDER BY created_at DESC',
        )
        .all(principalId) as Array<Record<string, unknown>>;
      return rows.map(mapRow);
    },

    getToken(id) {
      const row = database
        .prepare('SELECT * FROM entity_access_tokens WHERE id = ?')
        .get(id) as Record<string, unknown> | undefined;
      return row ? mapRow(row) : undefined;
    },
  };
}
