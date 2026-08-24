import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrincipalRepository, ensurePrincipalsSchema } from '../../db/src/principals';
import { evaluatePermission } from './permissions';
import {
  readExplicitRequestOrgHeader,
  readRequestPrincipal,
  resolveCustomerWorkspaceScope,
} from './request-permissions';

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
    vi.unstubAllEnvs();
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

  it('binds data-plane principal from API settings instead of spoofed headers', () => {
    vi.stubEnv('ENTITY_API_TOKEN', 'secret-token');
    vi.stubEnv('ENTITY_API_PRINCIPAL_ID', 'viewer-user');
    repo.createPrincipal({ id: 'global-admin', principal_type: 'human', display_name: 'Global', created_by: 'seed' });
    repo.createGrant({ principal_id: 'global-admin', role: 'admin', created_by: 'seed' });
    repo.createPrincipal({ id: 'viewer-user', principal_type: 'human', display_name: 'Viewer', created_by: 'seed' });
    repo.createGrant({
      principal_id: 'viewer-user',
      role: 'viewer',
      org_id: 'org-a',
      created_by: 'seed',
    });

    const principal = readRequestPrincipal(fakeRequest({
      'x-entity-principal-id': 'global-admin',
      'x-entity-role': 'admin',
    }), 'org-a', repo);

    expect(principal.principal_id).toBe('viewer-user');
    expect(principal.grants[0]?.role).toBe('viewer');
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

describe('THE-949 T-008 L1e — readExplicitRequestOrgHeader (header-only, no default fallback)', () => {
  it('reads x-entity-org-id and trims surrounding whitespace', () => {
    expect(readExplicitRequestOrgHeader(fakeRequest({ 'x-entity-org-id': '  org-a  ' }))).toBe('org-a');
  });

  it('falls back to the x-entity-org alias header', () => {
    expect(readExplicitRequestOrgHeader(fakeRequest({ 'x-entity-org': 'org-b' }))).toBe('org-b');
  });

  it('returns null when absent, blank, or whitespace-only (never a default-org fallback)', () => {
    expect(readExplicitRequestOrgHeader(fakeRequest({}))).toBeNull();
    expect(readExplicitRequestOrgHeader(fakeRequest({ 'x-entity-org-id': '   ' }))).toBeNull();
    // Body/query org selectors must NOT steer the header-only selector.
    const req = fakeRequest({});
    (req as any).body = { org_id: 'org-a' };
    (req as any).query = { org_id: 'org-a' };
    expect(readExplicitRequestOrgHeader(req)).toBeNull();
  });
});

describe('THE-949 T-008 L1d — resolveCustomerWorkspaceScope fails closed on ambiguity', () => {
  it('global admin: explicit header wins', () => {
    expect(resolveCustomerWorkspaceScope({ isGlobalAdmin: true, orgIds: ['a', 'b'] }, 'a', true)).toBe('a');
  });

  it('explicit ?? single-org with NO default-org fallback', () => {
    // Single org, no explicit header -> the single membership org.
    expect(resolveCustomerWorkspaceScope({ isGlobalAdmin: true, orgIds: ['org-a'] }, null, false)).toBe('org-a');
    expect(resolveCustomerWorkspaceScope({ isGlobalAdmin: false, orgIds: ['org-a'] }, null, false)).toBe('org-a');
    // Single org + explicit -> explicit.
    expect(resolveCustomerWorkspaceScope({ isGlobalAdmin: true, orgIds: ['org-a'] }, 'org-b', true)).toBe('org-b');
  });

  it('ambiguous global admin (no explicit, multiple orgs) FAILS CLOSED (null -> WORKSPACE_REQUIRED), never the deployment default', () => {
    expect(resolveCustomerWorkspaceScope({ isGlobalAdmin: true, orgIds: ['a', 'b'] }, null, false)).toBeNull();
    // Non-global multi-org with no explicit explicit scope also fails closed.
    expect(resolveCustomerWorkspaceScope({ isGlobalAdmin: false, orgIds: ['a', 'b'] }, null, false)).toBeNull();
  });

  it('non-global customer: an out-of-membership explicit header fails closed (null)', () => {
    expect(resolveCustomerWorkspaceScope({ isGlobalAdmin: false, orgIds: ['org-a'] }, 'org-other', false)).toBeNull();
    // Within-membership explicit header is honored.
    expect(resolveCustomerWorkspaceScope({ isGlobalAdmin: false, orgIds: ['org-a'] }, 'org-a', true)).toBe('org-a');
  });
});
