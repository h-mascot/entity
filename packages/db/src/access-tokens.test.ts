import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  createAccessTokenRepository,
  ensureAccessTokensSchema,
  generateAccessToken,
  hashAccessToken,
  ACCESS_TOKEN_PREFIX,
} from './access-tokens';
import { createPrincipalRepository, ensurePrincipalsSchema } from './principals';

function setup() {
  const db = new Database(':memory:');
  ensurePrincipalsSchema(db);
  ensureAccessTokensSchema(db);
  const principals = createPrincipalRepository(db);
  const tokens = createAccessTokenRepository(db, principals);
  return { db, principals, tokens };
}

describe('customer access tokens (Terra B1 primitive)', () => {
  it('creates a token bound to an active principal and resolves it to that principal', () => {
    const { principals, tokens } = setup();
    const principal = principals.createPrincipal({
      principal_type: 'human',
      display_name: 'Reviewer One',
    });
    principals.createGrant({ principal_id: principal.id, role: 'manager', org_id: 'org-acme' });

    const created = tokens.createToken({ principal_id: principal.id, label: 'laptop' });
    expect(created.token.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(created.record.principal_id).toBe(principal.id);
    expect(created.record.status).toBe('active');
    // Only the hash is stored; the plaintext is not recoverable.
    expect(created.record.token_hash).toBe(hashAccessToken(created.token));

    const resolved = tokens.resolveToken(created.token);
    expect(resolved).not.toBeNull();
    expect(resolved!.principal.id).toBe(principal.id);
    expect(resolved!.grants.some((g) => g.role === 'manager' && g.org_id === 'org-acme')).toBe(true);
  });

  it('two distinct credentials resolve to two distinct principals (per-request identity)', () => {
    const { principals, tokens } = setup();
    const alice = principals.createPrincipal({ principal_type: 'human', display_name: 'Alice' });
    principals.createGrant({ principal_id: alice.id, role: 'viewer', org_id: 'org-acme' });
    const bob = principals.createPrincipal({ principal_type: 'human', display_name: 'Bob' });
    principals.createGrant({ principal_id: bob.id, role: 'manager', org_id: 'org-beta' });

    const a = tokens.createToken({ principal_id: alice.id }).token;
    const b = tokens.createToken({ principal_id: bob.id }).token;
    expect(a).not.toBe(b);

    expect(tokens.resolveToken(a)!.principal.id).toBe(alice.id);
    expect(tokens.resolveToken(b)!.principal.id).toBe(bob.id);
    // A credential cannot impersonate the other principal.
    expect(tokens.resolveToken(a)!.principal.id).not.toBe(bob.id);
  });

  it('revoking a token immediately denies resolution (individually revocable)', () => {
    const { principals, tokens } = setup();
    const principal = principals.createPrincipal({ principal_type: 'human', display_name: 'Op' });
    const created = tokens.createToken({ principal_id: principal.id });
    expect(tokens.resolveToken(created.token)).not.toBeNull();

    expect(tokens.revokeToken(created.record.id)).toBe(true);
    expect(tokens.resolveToken(created.token)).toBeNull();
    // Idempotent: revoking again is a no-op (already revoked).
    expect(tokens.revokeToken(created.record.id)).toBe(false);
  });

  it('disabling the bound principal immediately denies resolution even with a live token', () => {
    const { principals, tokens } = setup();
    const principal = principals.createPrincipal({ principal_type: 'human', display_name: 'Op' });
    const created = tokens.createToken({ principal_id: principal.id });
    expect(tokens.resolveToken(created.token)).not.toBeNull();

    principals.disablePrincipal(principal.id);
    expect(tokens.resolveToken(created.token)).toBeNull();
  });

  it('does not create a token for a missing or disabled principal', () => {
    const { principals, tokens } = setup();
    expect(() => tokens.createToken({ principal_id: 'no-such-principal' })).toThrow();
    const principal = principals.createPrincipal({ principal_type: 'human', display_name: 'Op' });
    principals.disablePrincipal(principal.id);
    expect(() => tokens.createToken({ principal_id: principal.id })).toThrow(/not active/);
  });

  it('rejects malformed/garbage tokens and unknown hashes (fail closed)', () => {
    const { tokens } = setup();
    expect(tokens.resolveToken('')).toBeNull();
    expect(tokens.resolveToken('   ')).toBeNull();
    expect(tokens.resolveToken('not-a-real-token')).toBeNull();
    expect(tokens.resolveToken(generateAccessToken())).toBeNull();
  });

  it('stores only the hash, never the plaintext token', () => {
    const { db, principals, tokens } = setup();
    const principal = principals.createPrincipal({ principal_type: 'human', display_name: 'Op' });
    const created = tokens.createToken({ principal_id: principal.id });
    const allRows = JSON.stringify(
      db.prepare('SELECT * FROM entity_access_tokens').all(),
    );
    expect(allRows).not.toContain(created.token);
    expect(allRows).toContain(hashAccessToken(created.token));
  });
});
