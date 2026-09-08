import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { createAccessTokenRepository, ensureAccessTokensSchema } from '../../../db/src/access-tokens';
import { createPrincipalRepository, ensurePrincipalsSchema } from '../../../db/src/principals';
import { createApiAuthMiddleware } from '../middleware/api-auth';
import { createDataPlaneCredentialGuard } from '../middleware/data-plane-credential';
import { createRequireAdminPrincipal } from '../middleware/admin-auth';
import { createCustomerPrincipalMiddleware } from '../principals/request-context';
import { registerAdminReportRoutes } from './admin-reports';

function createFakeRepository() {
  return {
    getUsageReport: vi.fn().mockReturnValue({ totals: { runs: 2, tokens: 150 }, byActor: [], byModel: [], byDay: [], byEvent: [] }),
    getAuditReport: vi.fn().mockReturnValue({ totals: { events: 1, successes: 1, failures: 0, observed: 0 }, events: [], total: 1, byOutcome: [], byActor: [] }),
    getAccessReport: vi.fn().mockReturnValue({ totals: { principals: 1, activePrincipals: 1, grants: 1, activeTokens: 1 }, principals: [], total: 1, byOrg: [], byTeam: [], byRole: [] }),
  };
}

async function withServer(
  repository: ReturnType<typeof createFakeRepository>,
  authorizeAccess: ((req: express.Request, res: express.Response, next: express.NextFunction) => void) | undefined,
  run: (baseUrl: string) => Promise<void>,
  prefix: '' | '/api' | '/api/admin' = '/api',
): Promise<void> {
  const app = express();
  registerAdminReportRoutes(app, prefix, { reportRepository: repository, authorizeAccess });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed to bind');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('admin report routes (MC #1369)', () => {
  it('normalizes org/team/user aliases and passes filters to usage', async () => {
    const repo = createFakeRepository();
    await withServer(repo, undefined, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/usage-report?org_id=org-a&team_id=team-a&userId=ada&from=2026-08-01&to=2026-08-25&model=model-a&limit=20&offset=5`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ totals: { runs: 2 } });
      expect(repo.getUsageReport).toHaveBeenCalledWith({
        orgId: 'org-a',
        teamId: 'team-a',
        actor: 'ada',
        from: '2026-08-01',
        to: '2026-08-25',
        model: 'model-a',
        limit: 20,
        offset: 5,
      });
    });
  });

  it('exposes audit and resource-shaped aliases', async () => {
    const repo = createFakeRepository();
    await withServer(repo, undefined, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/api/audit-report?actor=Ada`)).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/reports/usage`)).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/reports/audit`)).status).toBe(200);
      expect(repo.getAuditReport).toHaveBeenCalledWith({ actor: 'Ada' });
    });
  });

  it('protects access reports when an authorization middleware is supplied', async () => {
    const repo = createFakeRepository();
    const deny = (_req: express.Request, res: express.Response) => {
      res.status(403).json({ code: 'admin_required' });
    };
    await withServer(repo, deny, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/access-report`);
      expect(response.status).toBe(403);
      expect(repo.getAccessReport).not.toHaveBeenCalled();
    });
  });

  it('protects every legacy usage/audit alias when authorization is supplied', async () => {
    const repo = createFakeRepository();
    const deny = (_req: express.Request, res: express.Response) => {
      res.status(403).json({ code: 'admin_required' });
    };
    await withServer(repo, deny, async (baseUrl) => {
      for (const path of ['/api/usage-report', '/api/audit-report', '/api/reports/usage', '/api/reports/audit']) {
        const response = await fetch(`${baseUrl}${path}`);
        expect(response.status, path).toBe(403);
      }
      expect(repo.getUsageReport).not.toHaveBeenCalled();
      expect(repo.getAuditReport).not.toHaveBeenCalled();
    });
  });

  it('keeps authorized legacy report aliases available', async () => {
    const repo = createFakeRepository();
    const allow = (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
    await withServer(repo, allow, async (baseUrl) => {
      for (const path of [
        '/api/usage-report',
        '/api/audit-report',
        '/api/access-report',
        '/api/reports/usage',
        '/api/reports/audit',
        '/api/reports/access',
      ]) {
        expect((await fetch(`${baseUrl}${path}`)).status, path).toBe(200);
      }
    });
  });

  it('denies customer access to control-plane reports, including resource aliases', async () => {
    const repo = createFakeRepository();
    const deny = (_req: express.Request, res: express.Response) => {
      res.status(403).json({ code: 'admin_required' });
    };
    await withServer(repo, deny, async (baseUrl) => {
      for (const path of ['/api/admin/usage-report', '/api/admin/reports/usage']) {
        const response = await fetch(`${baseUrl}${path}`);
        expect(response.status, path).toBe(403);
      }
      expect(repo.getUsageReport).not.toHaveBeenCalled();
    }, '/api/admin');
  });

  it('denies a valid customer token from reading an unfiltered legacy report', async () => {
    const repo = createFakeRepository();
    const db = new Database(':memory:');
    ensurePrincipalsSchema(db);
    const principals = createPrincipalRepository(db);
    ensureAccessTokensSchema(db);
    const tokens = createAccessTokenRepository(db, principals);
    principals.createPrincipal({ id: 'customer-a', principal_type: 'human', display_name: 'Customer A' });
    principals.createGrant({ principal_id: 'customer-a', role: 'viewer', org_id: 'org-a' });
    principals.createPrincipal({ id: 'other-admin', principal_type: 'human', display_name: 'Other Admin' });
    principals.createGrant({ principal_id: 'other-admin', role: 'admin' });
    const customerToken = tokens.createToken({ principal_id: 'customer-a' }).token;
    vi.stubEnv('ENTITY_API_TOKEN', 'report-transport-token');
    vi.stubEnv('ENTITY_API_PRINCIPAL_ID', undefined);

    const app = express();
    app.use(createApiAuthMiddleware());
    app.use(createCustomerPrincipalMiddleware(tokens));
    app.use(createDataPlaneCredentialGuard());
    registerAdminReportRoutes(app, '/api', {
      reportRepository: repo,
      authorizeAccess: createRequireAdminPrincipal(principals),
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/usage-report`, {
        headers: {
          authorization: 'Bearer report-transport-token',
          'x-entity-access-token': customerToken,
        },
      });
      expect(response.status).toBe(403);
      expect(repo.getUsageReport).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      db.close();
    }
  });

  it('allows an authorized admin through every control-plane report and alias', async () => {
    const repo = createFakeRepository();
    const allow = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next());
    await withServer(repo, allow, async (baseUrl) => {
      for (const path of [
        '/api/admin/usage-report',
        '/api/admin/audit-report',
        '/api/admin/access-report',
        '/api/admin/reports/usage',
        '/api/admin/reports/audit',
        '/api/admin/reports/access',
      ]) {
        const response = await fetch(`${baseUrl}${path}`);
        expect(response.status, path).toBe(200);
      }
      expect(allow).toHaveBeenCalledTimes(6);
      expect(repo.getUsageReport).toHaveBeenCalledTimes(2);
      expect(repo.getAuditReport).toHaveBeenCalledTimes(2);
      expect(repo.getAccessReport).toHaveBeenCalledTimes(2);
    }, '/api/admin');
  });
});
