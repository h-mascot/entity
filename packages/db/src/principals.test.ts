import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPrincipalRepository, ensurePrincipalsSchema } from './principals';

describe('principal repository', () => {
  const db = new Database(':memory:');
  const repo = createPrincipalRepository(db);

  beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS principal_grants');
    db.exec('DROP TABLE IF EXISTS entity_principals');
    ensurePrincipalsSchema(db);
  });

  it('creates principals with audit metadata and lists active only by default', () => {
    const principal = repo.createPrincipal({
      id: 'user-1',
      principal_type: 'human',
      display_name: 'Ada Lovelace',
      handle: 'ada',
      email: 'ada@example.com',
      created_by: 'admin-local',
    });

    expect(principal).toMatchObject({
      id: 'user-1',
      principal_type: 'human',
      display_name: 'Ada Lovelace',
      status: 'active',
      created_by: 'admin-local',
    });

    repo.disablePrincipal('user-1', 'admin-local');
    expect(repo.listPrincipals()).toHaveLength(0);
    expect(repo.listPrincipals({ includeDisabled: true })).toHaveLength(1);
  });

  it('manages scoped grants with sensitivity categories', () => {
    repo.createPrincipal({
      id: 'user-2',
      principal_type: 'human',
      display_name: 'Spock',
      created_by: 'admin-local',
    });

    const grant = repo.createGrant({
      principal_id: 'user-2',
      role: 'manager',
      org_id: 'org-a',
      team_id: 'team-a',
      project_id: 42,
      sensitivity_categories: ['customer', 'legal'],
      created_by: 'admin-local',
    });

    expect(grant.role).toBe('manager');
    expect(repo.listGrantsForPrincipal('user-2')).toHaveLength(1);

    repo.updateGrant(grant.id, { role: 'admin', updated_by: 'admin-local' });
    expect(repo.getGrant(grant.id)?.role).toBe('admin');

    expect(repo.revokeGrant(grant.id)).toBe(true);
    expect(repo.listGrantsForPrincipal('user-2')).toHaveLength(0);
  });
});
