import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPrincipalRepository, ensurePrincipalsSchema } from '../../../db/src/principals';
import { buildLocalCompatPrincipalContext, resolveStoredPrincipalContext } from './resolver';

describe('principal resolver', () => {
  const db = new Database(':memory:');
  const repo = createPrincipalRepository(db);

  beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS principal_grants');
    db.exec('DROP TABLE IF EXISTS entity_principals');
    ensurePrincipalsSchema(db);
  });

  it('uses stored grants and ignores header role when principal exists', () => {
    repo.createPrincipal({
      id: 'stored-user',
      principal_type: 'human',
      display_name: 'Stored User',
      created_by: 'admin',
    });
    repo.createGrant({
      principal_id: 'stored-user',
      role: 'viewer',
      org_id: 'org-a',
      sensitivity_categories: ['customer'],
      created_by: 'admin',
    });

    const resolved = resolveStoredPrincipalContext('stored-user', repo);
    expect(resolved.kind).toBe('stored');
    if (resolved.kind !== 'stored') return;
    expect(resolved.principal.grants).toEqual([
      {
        role: 'viewer',
        org_id: 'org-a',
        team_id: null,
        project_id: null,
        sensitivity_categories: ['customer'],
      },
    ]);
  });

  it('fails closed for disabled principals', () => {
    repo.createPrincipal({
      id: 'disabled-user',
      principal_type: 'human',
      display_name: 'Disabled User',
      created_by: 'admin',
    });
    repo.createGrant({
      principal_id: 'disabled-user',
      role: 'admin',
      created_by: 'admin',
    });
    repo.disablePrincipal('disabled-user', 'admin');

    const resolved = resolveStoredPrincipalContext('disabled-user', repo);
    expect(resolved).toMatchObject({
      kind: 'stored',
      status: 'disabled',
      principal: { principal_id: 'disabled-user', grants: [] },
    });
  });

  it('preserves local compatibility when principal is not stored', () => {
    expect(resolveStoredPrincipalContext('entity-local-user', repo).kind).toBe('local_compat');

    const compat = buildLocalCompatPrincipalContext('entity-local-user', 'org-a', 'admin', 'customer,legal');
    expect(compat).toEqual({
      principal_id: 'entity-local-user',
      grants: [{ role: 'admin', org_id: 'org-a', sensitivity_categories: ['customer', 'legal'] }],
    });
  });
});
