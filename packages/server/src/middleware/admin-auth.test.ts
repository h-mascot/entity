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
    middleware({
      header: () => undefined,
      hostname: 'localhost',
      method: 'POST',
      path: '/principals',
      params: {},
      body: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as any, { status: () => ({ json: vi.fn() }) } as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows the read-only principal list during API-auth bootstrap', () => {
    // The browser UI must GET /api/admin/principals to discover the empty
    // bootstrap state and render the create form. Blocking this read produces
    // the "Failed to load principals (403)" regression. The list is empty
    // during bootstrap, so allowing the read leaks nothing.
    vi.stubEnv('ENTITY_API_TOKEN', 'secret-token');
    const middleware = createRequireAdminPrincipal(repo);
    const next = vi.fn();
    middleware({
      header: () => undefined,
      hostname: 'localhost',
      method: 'GET',
      path: '/principals',
      params: {},
      body: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as any, { status: vi.fn(() => ({ json: vi.fn() })) } as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('authorizes GET /principals in local dev without role header once a sole admin principal exists', () => {
    // Regression contract for the "Failed to load principals (403)" bug: after
    // the browser bootstraps the first principal + global admin grant, the
    // GET must succeed WITHOUT the client-supplied x-entity-role: admin
    // header. The authorization comes from the server-trusted sole stored
    // principal's global admin grant, not from a client header.
    repo.createPrincipal({ id: 'bootstrap-admin', principal_type: 'human', display_name: 'Bootstrap', created_by: 'seed' });
    repo.createGrant({ principal_id: 'bootstrap-admin', role: 'admin', created_by: 'seed' });

    const middleware = createRequireAdminPrincipal(repo);
    const next = vi.fn();
    middleware({
      // Deliberately NO x-entity-role and NO x-entity-principal-id header.
      header: () => undefined,
      hostname: 'localhost',
      method: 'GET',
      path: '/principals',
      params: {},
      body: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as any, { status: vi.fn(() => ({ json: vi.fn() })) } as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('fail-closes a sole principal with no global admin grant (no header elevation)', () => {
    // Identity resolution returns the sole principal, but the middleware must
    // still require a global admin grant — a spoofed x-entity-role header must
    // not elevate a non-admin principal in local dev either.
    repo.createPrincipal({ id: 'no-grant', principal_type: 'human', display_name: 'NoGrant', created_by: 'seed' });

    const middleware = createRequireAdminPrincipal(repo);
    const denied = vi.fn();
    const res = { status: vi.fn(() => ({ json: denied })) };
    const next = vi.fn();
    middleware({
      header: (name: string) => (name === 'x-entity-role' ? 'admin' : undefined),
      hostname: 'localhost',
      method: 'GET',
      path: '/principals',
      params: {},
      body: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({ code: 'admin_grant_required' }));
  });

  it('rejects self-bootstrap grant when the sole principal is disabled', () => {
    // HIGH blocker fix: a disabled sole principal must NOT be able to create
    // a new global-admin grant via the isSelfBootstrapGrant carve-out. The
    // carve-out is narrowed to active sole principals only.
    repo.createPrincipal({ id: 'disabled-sole', principal_type: 'human', display_name: 'Disabled', created_by: 'seed' });
    repo.createGrant({ principal_id: 'disabled-sole', role: 'admin', created_by: 'seed' });
    repo.disablePrincipal('disabled-sole');

    const middleware = createRequireAdminPrincipal(repo);
    const denied = vi.fn();
    const res = { status: vi.fn(() => ({ json: denied })) };
    const next = vi.fn();
    middleware({
      header: (name: string) => (name === 'x-entity-principal-id' ? 'disabled-sole' : undefined),
      hostname: 'localhost',
      method: 'POST',
      path: '/principals/disabled-sole/grants',
      params: {},
      body: { role: 'admin' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    // The resolver self-heals the sole principal id, the carve-out rejects it
    // (not active), and normal stored-principal auth returns principal_disabled.
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({ code: 'principal_disabled' }));
  });

  it('rejects self-bootstrap grant that is scoped (not global)', () => {
    // HIGH blocker fix: the self-bootstrap carve-out must only apply to a
    // GLOBAL admin grant. A sole principal with NO existing grant attempting
    // a scoped (org-scoped) admin grant must be rejected: the carve-out does
    // not apply (not global) and normal auth rejects (no admin grant).
    repo.createPrincipal({ id: 'pre-bootstrap', principal_type: 'human', display_name: 'Pre', created_by: 'seed' });

    const middleware = createRequireAdminPrincipal(repo);
    const denied = vi.fn();
    const res = { status: vi.fn(() => ({ json: denied })) };
    const next = vi.fn();
    middleware({
      header: (name: string) => (name === 'x-entity-principal-id' ? 'pre-bootstrap' : undefined),
      hostname: 'localhost',
      method: 'POST',
      path: '/principals/pre-bootstrap/grants',
      params: {},
      body: { role: 'admin', org_id: 'org-a' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({ code: 'admin_grant_required' }));
  });

  it('rejects self-bootstrap grant when the sole principal already has a global admin grant (carve-out is first-grant only)', () => {
    // HIGH blocker fix: the carve-out is for the FIRST global-admin grant
    // only. Once the sole principal already has a global admin grant, a
    // second admin-grant POST from a DIFFERENT (non-authorized) identity
    // must NOT be able to ride the carve-out. We simulate this by having a
    // second stored principal appear mid-request: principalCount becomes 2
    // so the carve-out's principalCount===1 guard deactivates and normal
    // auth applies to the non-admin requester.
    repo.createPrincipal({ id: 'bootstrap-admin', principal_type: 'human', display_name: 'Bootstrap', created_by: 'seed' });
    repo.createGrant({ principal_id: 'bootstrap-admin', role: 'admin', created_by: 'seed' });
    repo.createPrincipal({ id: 'interloper', principal_type: 'human', display_name: 'Interloper', created_by: 'seed' });

    const middleware = createRequireAdminPrincipal(repo);
    const denied = vi.fn();
    const res = { status: vi.fn(() => ({ json: denied })) };
    const next = vi.fn();
    middleware({
      header: (name: string) => (name === 'x-entity-principal-id' ? 'interloper' : undefined),
      hostname: 'localhost',
      method: 'POST',
      path: '/principals/interloper/grants',
      params: {},
      body: { role: 'admin' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    // With 2+ principals and no server-trusted binding, the resolver fails
    // closed (admin_principal_binding_required) — the carve-out does not apply
    // (principalCount !== 1) and client headers cannot elevate the interloper.
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({ code: 'admin_principal_binding_required' }));
  });

  it('blocks non-create mutations during API-auth bootstrap', () => {
    vi.stubEnv('ENTITY_API_TOKEN', 'secret-token');
    const middleware = createRequireAdminPrincipal(repo);
    const denied = vi.fn();
    const res = { status: vi.fn(() => ({ json: denied })) };
    const next = vi.fn();
    middleware({
      header: () => undefined,
      hostname: 'localhost',
      method: 'PATCH',
      path: '/principals/some-id',
      params: {},
      body: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({ code: 'admin_bootstrap_required' }));
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
      socket: { remoteAddress: '127.0.0.1' },
      method: 'PATCH',
      params: {},
      body: {},
    } as any, { status: vi.fn(() => ({ json: vi.fn() })) } as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows sole principal to bootstrap a global admin grant', () => {
    repo.createPrincipal({ id: 'bootstrap-admin', principal_type: 'human', display_name: 'Bootstrap', created_by: 'seed' });

    const middleware = createRequireAdminPrincipal(repo);
    const next = vi.fn();
    middleware({
      header: (name: string) => (name === 'x-entity-principal-id' ? 'bootstrap-admin' : undefined),
      hostname: 'localhost',
      method: 'POST',
      path: '/principals/bootstrap-admin/grants',
      params: {},
      body: { role: 'admin' },
      socket: { remoteAddress: '127.0.0.1' },
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
