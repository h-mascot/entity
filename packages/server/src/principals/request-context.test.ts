import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import {
  buildCustomerPrincipalContext,
  authorizeTaskOrg,
  authorizedOrgIds,
  filterTasksForRequest,
  isOrgAuthorized,
  isTrustedServiceContext,
  resolveAuthorizedOrg,
  resolveRequestActorId,
  resolveRequestActorType,
  sendPermissionDenied,
  type CustomerPrincipalContext,
} from './request-context';

function reqWith(ctx: CustomerPrincipalContext | undefined): Request {
  return { entityCustomerPrincipal: ctx } as unknown as Request;
}

function ctx(overrides: Partial<CustomerPrincipalContext> = {}): CustomerPrincipalContext {
  return {
    principalId: 'p-1',
    principalType: 'human',
    permission: { principal_id: 'p-1', grants: [] },
    orgIds: ['org-acme'],
    isGlobalAdmin: false,
    ...overrides,
  };
}

function mockRes(): { res: any; state: { status: number; body: unknown } } {
  const state = { status: 0, body: undefined as unknown };
  const res: any = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
    headersSent: false,
  };
  return { res, state };
}

describe('request-context authorization helpers (B1–B4)', () => {
  it('isTrustedServiceContext: true when no customer principal attached', () => {
    expect(isTrustedServiceContext(reqWith(undefined))).toBe(true);
    expect(isTrustedServiceContext(reqWith(ctx()))).toBe(false);
  });

  it('authorizedOrgIds: null for trusted path and for customer global admin; scoped otherwise', () => {
    expect(authorizedOrgIds(reqWith(undefined))).toBeNull();
    expect(authorizedOrgIds(reqWith(ctx({ isGlobalAdmin: true })))).toBeNull();
    expect(authorizedOrgIds(reqWith(ctx({ orgIds: ['org-a', 'org-b'] })))).toEqual(['org-a', 'org-b']);
  });

  it('isOrgAuthorized: trusted/global-admin allow all; scoped membership enforced', () => {
    expect(isOrgAuthorized(reqWith(undefined), 'anything')).toBe(true);
    expect(isOrgAuthorized(reqWith(ctx()), 'org-acme')).toBe(true);
    expect(isOrgAuthorized(reqWith(ctx()), 'org-beta')).toBe(false);
    expect(isOrgAuthorized(reqWith(ctx()), null)).toBe(false);
    expect(isOrgAuthorized(reqWith(ctx({ orgIds: [] })), 'org-acme')).toBe(false);
  });

  it('resolveAuthorizedOrg: denies a requested org outside membership (403)', () => {
    const { res, state } = mockRes();
    const out = resolveAuthorizedOrg(reqWith(ctx()), res, 'org-beta');
    expect(out).toBeNull();
    expect(state.status).toBe(403);
  });

  it('resolveAuthorizedOrg: defaults to the sole membership org when none requested', () => {
    const { res } = mockRes();
    const out = resolveAuthorizedOrg(reqWith(ctx()), res, null);
    expect(out).toEqual({ orgId: 'org-acme' });
  });

  it('resolveAuthorizedOrg: requires an explicit org when multiple scopes', () => {
    const { res, state } = mockRes();
    const out = resolveAuthorizedOrg(reqWith(ctx({ orgIds: ['org-a', 'org-b'] })), res, null);
    expect(out).toBeNull();
    expect(state.status).toBe(400);
  });

  it('resolveAuthorizedOrg: returns null for trusted path (caller decides)', () => {
    const { res } = mockRes();
    expect(resolveAuthorizedOrg(reqWith(undefined), res, 'org-x')).toBeNull();
  });

  it('authorizeTaskOrg: trusted path always allows; customer denied cross-org (404, no leak)', () => {
    const trusted = mockRes();
    expect(authorizeTaskOrg(reqWith(undefined), trusted.res, { org_id: 'other' }, 'read')).toBe(true);
    expect(trusted.state.status).toBe(0);

    const denied = mockRes();
    expect(authorizeTaskOrg(reqWith(ctx()), denied.res, { org_id: 'org-beta' }, 'write')).toBe(false);
    expect(denied.state.status).toBe(404);

    const allowed = mockRes();
    expect(authorizeTaskOrg(reqWith(ctx()), allowed.res, { org_id: 'org-acme' }, 'read')).toBe(true);
    expect(allowed.state.status).toBe(0);
  });

  it('authorizeTaskOrg: null task -> 404', () => {
    const { res, state } = mockRes();
    expect(authorizeTaskOrg(reqWith(ctx()), res, null, 'read')).toBe(false);
    expect(state.status).toBe(404);
  });

  it('filterTasksForRequest: scopes list to membership; trusted path unchanged', () => {
    const tasks = [{ org_id: 'org-acme' }, { org_id: 'org-beta' }, { org_id: 'org-acme' }];
    expect(filterTasksForRequest(reqWith(undefined), tasks)).toHaveLength(3);
    expect(filterTasksForRequest(reqWith(ctx()), tasks)).toHaveLength(2);
  });

  it('resolveRequestActorId: server principal id for customer; header convention for trusted', () => {
    expect(resolveRequestActorId(reqWith(ctx()), 'fallback')).toBe('p-1');
    const trustedReq = { header: () => 'reviewer-evil', body: {} } as unknown as Request;
    // Customer path ignores the spoofed header.
    expect(resolveRequestActorId(reqWith(ctx()), 'fallback')).toBe('p-1');
    // Trusted path still honors the header (PR #71/#72 preserved).
    expect(resolveRequestActorId(trustedReq, 'fallback')).toBe('reviewer-evil');
  });

  it('resolveRequestActorType: customer principal type mapped; trusted fallback', () => {
    expect(resolveRequestActorType(reqWith(ctx({ principalType: 'agent' })), 'human')).toBe('agent');
    expect(resolveRequestActorType(reqWith(ctx({ principalType: 'service_account' })), 'human')).toBe('system');
    expect(resolveRequestActorType(reqWith(undefined), 'human')).toBe('human');
  });

  it('buildCustomerPrincipalContext: derives orgIds + global admin flag from grants', () => {
    const c = buildCustomerPrincipalContext({
      principalId: 'p',
      principalType: 'human',
      permission: {
        principal_id: 'p',
        grants: [
          { role: 'manager', org_id: 'org-a' },
          { role: 'viewer', org_id: 'org-b' },
          { role: 'admin' }, // org-less admin => global
        ],
      },
    });
    expect(c.orgIds).toEqual(['org-a', 'org-b']);
    expect(c.isGlobalAdmin).toBe(true);
  });

  it('sendPermissionDenied writes 403 + permission_denied code', () => {
    const { res, state } = mockRes();
    sendPermissionDenied(res, 'nope');
    expect(state.status).toBe(403);
    expect((state.body as { code: string }).code).toBe('permission_denied');
  });
});
