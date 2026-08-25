import express from 'express';
import http from 'http';
import { describe, expect, it, vi } from 'vitest';
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
): Promise<void> {
  const app = express();
  registerAdminReportRoutes(app, '/api', { reportRepository: repository, authorizeAccess });
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
});
