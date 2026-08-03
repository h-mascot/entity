import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPrincipalRepository, ensurePrincipalsSchema } from '../../db/src/principals';
import { evaluatePermission } from './permissions';
import { readRequestPrincipal } from './request-permissions';

const db = new Database(':memory:');
const repo = createPrincipalRepository(db);

function fakeRequest(headers: Record<string, string>) {
  return {
    header(name: string) {
      const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
      return key ? headers[key] : undefined;
    },
  } as any;
}

describe('request permissions with stored principals', () => {
  beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS principal_grants');
    db.exec('DROP TABLE IF EXISTS entity_principals');
    ensurePrincipalsSchema(db);
  });

  it('ignores x-entity-role when stored principal exists even without API auth', () => {
    repo.createPrincipal({
      id: 'stored-user',
      principal_type: 'human',
      display_name: 'Stored',
      created_by: 'admin',
    });
    repo.createGrant({
      principal_id: 'stored-user',
      role: 'viewer',
      org_id: 'org-a',
      created_by: 'admin',
    });

    const principal = readRequestPrincipal(fakeRequest({
      'x-entity-principal-id': 'stored-user',
      'x-entity-role': 'admin',
    }), 'org-a', repo);

    const decision = evaluatePermission({
      principal,
      object: {
        object_type: 'native_document',
        object_id: 'doc-1',
        org_id: 'org-a',
        title: 'Doc',
      },
      action: 'write',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.effective_role).toBe('viewer');
  });

  it('uses local compatibility headers when principal is not stored', () => {
    const principal = readRequestPrincipal(fakeRequest({
      'x-entity-principal-id': 'entity-local-user',
      'x-entity-role': 'admin',
      'x-entity-sensitivity': 'customer',
    }), 'org-a', repo);

    expect(principal.grants[0]).toMatchObject({
      role: 'admin',
      org_id: 'org-a',
      sensitivity_categories: ['customer'],
    });
  });

  it('fails closed for disabled stored principals', () => {
    repo.createPrincipal({
      id: 'disabled-user',
      principal_type: 'human',
      display_name: 'Disabled',
      created_by: 'admin',
    });
    repo.createGrant({
      principal_id: 'disabled-user',
      role: 'admin',
      org_id: 'org-a',
      created_by: 'admin',
    });
    repo.disablePrincipal('disabled-user', 'admin');

    const principal = readRequestPrincipal(fakeRequest({
      'x-entity-principal-id': 'disabled-user',
      'x-entity-role': 'admin',
    }), 'org-a', repo);

    const decision = evaluatePermission({
      principal,
      object: {
        object_type: 'task',
        object_id: 'task-1',
        org_id: 'org-a',
      },
      action: 'read',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.effective_role).toBe('none');
  });

  it('allows header compat when enforceStoredPrincipals is disabled', () => {
    repo.createPrincipal({
      id: 'stored-user',
      principal_type: 'human',
      display_name: 'Stored',
      created_by: 'admin',
    });
    repo.createGrant({
      principal_id: 'stored-user',
      role: 'viewer',
      org_id: 'org-a',
      created_by: 'admin',
    });

    const principal = readRequestPrincipal(fakeRequest({
      'x-entity-principal-id': 'stored-user',
      'x-entity-role': 'admin',
    }), 'org-a', repo, { enforceStoredPrincipals: false });

    expect(principal.grants[0]?.role).toBe('admin');
  });
});
