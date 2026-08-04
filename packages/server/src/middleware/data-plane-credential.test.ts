/**
 * Terra R1 — `createDataPlaneCredentialGuard` unit behavior.
 *
 * Pure middleware-level proof of the R1 invariant:
 *   - With API auth ENABLED, a request bearing only the shared transport token
 *     (no customer principal) is DENIED on data-plane routes. A valid customer
 *     principal proceeds.
 *   - Public and control routes pass through (they have their own authz).
 *   - With API auth DISABLED (local dev) the guard is inert.
 *
 * Composition-faithful HTTP proof (real routers + real DB) lives in
 * `__tests__/curacel-r1-customer-dataplane-credential.test.ts`.
 */
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataPlaneCredentialGuard } from './data-plane-credential';
import type { CustomerPrincipalContext } from '../principals/request-context';

function makeReq(path: string, customer?: CustomerPrincipalContext): Request {
  return {
    path,
    entityCustomerPrincipal: customer,
    header: () => undefined,
  } as unknown as Request;
}

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { res: { status, json } as unknown as Response, status, json };
}

function customer(orgIds: string[] = ['org-a']): CustomerPrincipalContext {
  return {
    principalId: 'cust-1',
    principalType: 'human',
    permission: { principal_id: 'cust-1', grants: [] },
    orgIds,
    isGlobalAdmin: false,
  };
}

describe('createDataPlaneCredentialGuard (R1)', () => {
  const origToken = process.env.ENTITY_API_TOKEN;

  beforeEach(() => {
    process.env.ENTITY_API_TOKEN = 'transport-only-token';
  });

  afterEach(() => {
    if (origToken === undefined) delete process.env.ENTITY_API_TOKEN;
    else process.env.ENTITY_API_TOKEN = origToken;
    vi.restoreAllMocks();
  });

  it('denies a data-plane request with no customer principal (shared bearer only)', () => {
    const guard = createDataPlaneCredentialGuard();
    const req = makeReq('/api/tasks');
    const { res, status, json } = makeRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'customer_credential_required' }),
    );
  });

  it('admits a data-plane request with a valid customer principal', () => {
    const guard = createDataPlaneCredentialGuard();
    const req = makeReq('/api/tasks', customer());
    const { res } = makeRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('admits a data-plane request with a global-admin customer principal', () => {
    const guard = createDataPlaneCredentialGuard();
    const req = makeReq('/api/tasks', { ...customer(), isGlobalAdmin: true });
    const { res } = makeRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes public routes without a customer principal', () => {
    const guard = createDataPlaneCredentialGuard();
    for (const path of ['/api/health', '/api/version', '/', '/index.html', '/api/clickclack/x']) {
      const req = makeReq(path);
      const { res } = makeRes();
      const next = vi.fn();
      guard(req, res, next);
      expect(next, path).toHaveBeenCalledTimes(1);
    }
  });

  it('passes the control-plane /api/admin boundary without a customer principal', () => {
    const guard = createDataPlaneCredentialGuard();
    for (const path of ['/api/admin', '/api/admin/principals', '/api/admin/principals/p-1/grants']) {
      const req = makeReq(path);
      const { res } = makeRes();
      const next = vi.fn();
      guard(req, res, next);
      expect(next, path).toHaveBeenCalledTimes(1);
    }
  });

  it('is inert when API auth is disabled (local dev trusted path preserved)', () => {
    delete process.env.ENTITY_API_TOKEN;
    const guard = createDataPlaneCredentialGuard();
    const req = makeReq('/api/tasks'); // no customer principal
    const { res } = makeRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('denies every representative data-plane surface for shared bearer only', () => {
    const guard = createDataPlaneCredentialGuard();
    const paths = [
      '/api/tasks',
      '/api/tasks/42/comments',
      '/api/tasks/42/review/accept',
      '/api/tasks/42/handoffs',
      '/api/document-objects',
      '/api/chat/channels',
      '/api/search',
      '/api/activity-events',
      '/api/worktype-registry',
      '/api/swarm/jobs',
      // Formerly broad control exceptions are now data-plane.
      '/api/onboarding/state',
      '/api/config/effective',
      '/api/runtime',
      '/api/db-mode',
      '/api/migration-cleanup-queues',
      '/api/node-operations',
      '/api/plugins',
    ];
    for (const path of paths) {
      const req = makeReq(path);
      const { res, status } = makeRes();
      const next = vi.fn();
      guard(req, res, next);
      expect(next, path).not.toHaveBeenCalled();
      expect(status, path).toHaveBeenCalledWith(403);
    }
  });

  it('the control carve-out never leaks a partial prefix (/api/administrivia is data-plane)', () => {
    const guard = createDataPlaneCredentialGuard();
    const req = makeReq('/api/administrivia/things');
    const { res, status } = makeRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});
