import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrincipalRepository, ensurePrincipalsSchema } from '../../../db/src/principals';
import { createRequireAdminPrincipal } from './admin-auth';
import Database from 'better-sqlite3';

const db = new Database(':memory:');
const repo = createPrincipalRepository(db);

describe('admin auth middleware', () => {
  beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS principal_grants');
    db.exec('DROP TABLE IF EXISTS entity_principals');
    ensurePrincipalsSchema(db);
    vi.unstubAllEnvs();
  });

  it('allows bootstrap when no principals exist', () => {
    const middleware = createRequireAdminPrincipal(repo);
    const next = vi.fn();
    middleware({ header: () => undefined, hostname: 'localhost' } as any, { status: () => ({ json: vi.fn() }) } as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows local header compat admin for unknown principals', () => {
    repo.createPrincipal({ id: 'admin', principal_type: 'human', display_name: 'Admin', created_by: 'seed' });
    repo.createGrant({ principal_id: 'admin', role: 'admin', created_by: 'seed' });

    const middleware = createRequireAdminPrincipal(repo);
    const next = vi.fn();
    middleware({
      header: (name: string) => {
        if (name === 'x-entity-principal-id') return 'entity-local-user';
        if (name === 'x-entity-role') return 'admin';
        return undefined;
      },
      hostname: 'localhost',
      method: 'PATCH',
      params: {},
      body: {},
    } as any, { status: vi.fn(() => ({ json: vi.fn() })) } as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('requires global admin grant once principals exist', () => {
    repo.createPrincipal({ id: 'admin', principal_type: 'human', display_name: 'Admin', created_by: 'seed' });
    repo.createGrant({ principal_id: 'admin', role: 'admin', created_by: 'seed' });
    repo.createPrincipal({ id: 'viewer', principal_type: 'human', display_name: 'Viewer', created_by: 'seed' });

    const middleware = createRequireAdminPrincipal(repo);
    const denied = vi.fn();
    const res = { status: vi.fn(() => ({ json: denied })) };
    const next = vi.fn();
    middleware({
      header: () => 'viewer',
      hostname: 'localhost',
      method: 'GET',
      params: {},
      body: {},
    } as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects scoped admin grants for admin mutations', () => {
    repo.createPrincipal({ id: 'scoped-admin', principal_type: 'human', display_name: 'Scoped', created_by: 'seed' });
    repo.createGrant({
      principal_id: 'scoped-admin',
      role: 'admin',
      org_id: 'org-a',
      created_by: 'seed',
    });

    const middleware = createRequireAdminPrincipal(repo);
    const denied = vi.fn();
    const res = { status: vi.fn(() => ({ json: denied })) };
    const next = vi.fn();
    middleware({
      header: (name: string) => (name === 'x-entity-principal-id' ? 'scoped-admin' : undefined),
      hostname: 'localhost',
      method: 'PATCH',
      params: {},
      body: {},
    } as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
