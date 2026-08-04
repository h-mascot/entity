import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrincipalRepository, ensurePrincipalsSchema } from '../../../db/src/principals';
import {
  hasGlobalAdminGrant,
  LOCAL_ADMIN_PRINCIPAL_ID,
  resolveTrustedAdminPrincipalId,
} from './admin-identity';

const db = new Database(':memory:');
const repo = createPrincipalRepository(db);

function mockReq(headers: Record<string, string> = {}) {
  return {
    header: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? undefined,
  } as any;
}

describe('admin identity resolution', () => {
  beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS principal_grants');
    db.exec('DROP TABLE IF EXISTS entity_principals');
    ensurePrincipalsSchema(db);
    vi.unstubAllEnvs();
  });

  it('allows bootstrap principal when no principals exist', () => {
    expect(resolveTrustedAdminPrincipalId(mockReq(), repo)).toBe(LOCAL_ADMIN_PRINCIPAL_ID);
  });

  it('allows bootstrap principal binding when API auth is enabled for a sole principal', () => {
    vi.stubEnv('ENTITY_API_TOKEN', 'secret-token');
    repo.createPrincipal({ id: 'bootstrap-admin', principal_type: 'human', display_name: 'Bootstrap', created_by: 'seed' });
    expect(resolveTrustedAdminPrincipalId(
      mockReq({ 'x-entity-principal-id': 'bootstrap-admin' }),
      repo,
    )).toBe('bootstrap-admin');
  });

  it('uses header principal in local dev without API auth', () => {
    repo.createPrincipal({ id: 'admin', principal_type: 'human', display_name: 'Admin', created_by: 'seed' });
    expect(resolveTrustedAdminPrincipalId(mockReq({ 'x-entity-principal-id': 'admin' }), repo)).toBe('admin');
  });

  it('treats scoped admin grants as non-global', () => {
    repo.createPrincipal({ id: 'scoped-admin', principal_type: 'human', display_name: 'Scoped', created_by: 'seed' });
    repo.createGrant({
      principal_id: 'scoped-admin',
      role: 'admin',
      org_id: 'org-a',
      created_by: 'seed',
    });
    expect(hasGlobalAdminGrant('scoped-admin', repo)).toBe(false);

    repo.createPrincipal({ id: 'global-admin', principal_type: 'human', display_name: 'Global', created_by: 'seed' });
    repo.createGrant({ principal_id: 'global-admin', role: 'admin', created_by: 'seed' });
    expect(hasGlobalAdminGrant('global-admin', repo)).toBe(true);
  });
});
