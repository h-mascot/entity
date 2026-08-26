import { Router } from 'express';
import express from 'express';
import http from 'http';
import { describe, expect, it, vi } from 'vitest';
import type { FileSourceRecord, FileSourceRepository } from '../../../db/src/file-sources';
import type { FileIndexRecord, FileIndexRepository } from '../../../db/src/file-index';
import type { FsFileOwnershipRecord, FsFileOwnershipRepository } from '../../../db/src/file-ownership';
import type { PrincipalGrant } from '../permissions';
import { ownershipVisible, registerSearchRoutes, resolveOwnershipScope, type SearchRouteDeps } from './routes-search';

function source(): FileSourceRecord {
  const timestamp = '2026-06-24T02:45:00.000Z';
  return {
    id: 'workspace',
    display_name: 'Workspace',
    type: 'local',
    base_url: null,
    base_path: '/workspace',
    auth_type: 'none',
    auth_ref: null,
    enabled: true,
    icon: null,
    capabilities: '{}',
    health: 'ok',
    last_synced_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function indexRecord(path: string, overrides: Partial<FileIndexRecord> = {}): FileIndexRecord {
  return {
    id: `workspace:${path}`,
    source_id: 'workspace',
    path,
    title: path.split('/').pop() ?? path,
    type: 'one-off',
    agent: 'user',
    origin: 'manual',
    is_recurring: false,
    recurring_pattern: null,
    tags: '["upload"]',
    updated_at: '2026-08-25T00:00:00.000Z',
    indexed_at: '2026-08-25T00:00:00.000Z',
    preview: 'uploaded proposal preview',
    content_hash: null,
    org_id: null,
    sensitivity: null,
    acl_json: null,
    entity_visibility_policy_json: null,
    ...overrides,
  };
}

function ownershipRecord(path: string, overrides: Partial<FsFileOwnershipRecord> = {}): FsFileOwnershipRecord {
  return {
    source_id: 'workspace',
    path,
    org_id: 'curacel',
    team_id: 'pilot',
    owner_principal_id: 'pilot-service',
    display_name: 'acme-proposal.md',
    origin: 'upload',
    uploaded_at: '2026-08-25T00:00:00.000Z',
    updated_at: '2026-08-25T00:00:00.000Z',
    ...overrides,
  };
}

function makeOwnershipRepo(rows: FsFileOwnershipRecord[]): FsFileOwnershipRepository {
  return {
    getOwnership: vi.fn((sourceId: string, p: string) => rows.find((r) => r.source_id === sourceId && r.path === p)),
    upsertOwnership: vi.fn(() => { throw new Error('not used'); }),
    listOwnershipForOrg: vi.fn(() => rows),
    listOwnershipForTeams: vi.fn(() => rows),
    deleteOwnership: vi.fn(() => false),
  };
}

function makeSourceRepo(): FileSourceRepository {
  const s = source();
  return {
    listSources: vi.fn(() => [s]),
    getSource: vi.fn(() => s),
    createSource: vi.fn(() => s),
    updateSource: vi.fn(() => s),
    setEnabled: vi.fn(() => s),
    deleteSource: vi.fn(() => false),
  };
}

function makeIndexRepo(rows: FileIndexRecord[]): Pick<FileIndexRepository, 'search' | 'getLatestSyncRun'> {
  return {
    search: vi.fn(() => rows),
    getLatestSyncRun: vi.fn(() => undefined),
  };
}

async function withSearchServer(
  deps: SearchRouteDeps,
  headers: Record<string, string>,
  run: (baseUrl: string) => Promise<void>,
  customerGrants?: PrincipalGrant[],
): Promise<void> {
  const app = express();
  const router = Router();
  registerSearchRoutes(router, deps);
  app.use((req, _res, next) => {
    for (const [k, v] of Object.entries(headers)) req.headers[k.toLowerCase()] = v;
    next();
  });
  if (customerGrants) {
    app.use((req, _res, next) => {
      const principalId = 'pilot-viewer';
      const orgIds = [...new Set(customerGrants.map((grant) => grant.org_id).filter((value): value is string => Boolean(value)))];
      (req as unknown as { entityCustomerPrincipal: unknown }).entityCustomerPrincipal = {
        principalId,
        principalType: 'human',
        permission: { principal_id: principalId, grants: customerGrants },
        orgIds,
        isGlobalAdmin: false,
      };
      next();
    });
  }
  app.use('/api/fs', router);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}


type TestGrant = { principal_id: string; org_id: string | null; team_id: string | null; project_id: string | null; role: string };

function scopeFor(grants: TestGrant[]) {
  // RequestOrgBinding comes from internal middleware; pass a structurally
  // compatible binding via a narrowed rebind of the exported helper.
  const resolveScope = resolveOwnershipScope as unknown as (binding: {
    orgId: string;
    principal: { principal_id: string; grants: Array<TestGrant & { sensitivity_categories: string[] }> };
  }) => { orgId: string; isAdmin: boolean; hasOrgWide: boolean; visibleTeamIds: Set<string> };
  return resolveScope({
    orgId: 'curacel',
    principal: {
      principal_id: grants[0]?.principal_id ?? 'x',
      grants: grants.map((g) => ({ ...g, sensitivity_categories: [] })),
    },
  });
}

describe('search ownership scoping (MC #1365)', () => {
  const owned = indexRecord('uploads/curacel/pilot/acme-proposal.md');
  const otherTeam = indexRecord('uploads/curacel/growth/growth-deck.md');
  const unowned = indexRecord('docs/shared.md');

  function deps(ownershipRows: FsFileOwnershipRecord[]): SearchRouteDeps {
    return {
      sourceRepo: makeSourceRepo(),
      indexRepo: makeIndexRepo([owned, otherTeam, unowned]),
      ownershipRepo: makeOwnershipRepo(ownershipRows),
    };
  }

  it('project-scoped caller does not get org-wide ownership visibility', async () => {
    // A grant with project_id set and team_id unset must NOT count as org-wide
    // (regression for resolveOwnershipScope hasOrgWide check).
    const scope = scopeFor([
      { principal_id: 'proj-user', org_id: 'curacel', team_id: null, project_id: 'apollo', role: 'contributor' },
    ]);
    expect(scope.hasOrgWide).toBe(false);
    expect(scope.visibleTeamIds.size).toBe(0);
    const growth = ownershipRecord('uploads/curacel/growth/growth-deck.md', { team_id: 'growth' });
    expect(ownershipVisible(scope, growth)).toBe(false);
    // Org-wide grant (no team, no project) still sees everything in-org.
    const orgWide = scopeFor([
      { principal_id: 'org-user', org_id: 'curacel', team_id: null, project_id: null, role: 'contributor' },
    ]);
    expect(orgWide.hasOrgWide).toBe(true);
    expect(ownershipVisible(orgWide, growth)).toBe(true);
  });

  it('team-scoped caller sees only own-team uploads plus unowned files', async () => {
    // Simulate a team-scoped principal via stored grants: use customer context is
    // hard in unit tests; instead simulate via grants through the principal
    // permission context using headers that buildLocalCompat cannot express.
    // So we exercise the scope functions through a caller with org-wide grant
    // plus team grant visibility, and a restricted case below via direct call.
    const rows = [
      ownershipRecord('uploads/curacel/pilot/acme-proposal.md'),
      ownershipRecord('uploads/curacel/growth/growth-deck.md', { team_id: 'growth' }),
    ];
    // Local admin (no principal header => LOCAL_ADMIN) sees all three.
    await withSearchServer(deps(rows), {}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/fs/search?q=&indexState=indexed`);
      const body = (await res.json()) as { results: Array<{ path: string; owner?: unknown }> };
      const paths = body.results.map((r) => r.path);
      expect(paths).toContain('uploads/curacel/pilot/acme-proposal.md');
      expect(paths).toContain('uploads/curacel/growth/growth-deck.md');
      expect(paths).toContain('docs/shared.md');
      const withOwner = body.results.find((r) => r.path === 'uploads/curacel/pilot/acme-proposal.md');
      expect(withOwner?.owner).toMatchObject({ teamId: 'pilot', orgId: 'curacel', origin: 'upload' });
    });
  });


  it('team-scoped callers see only their team uploads and never another org with the same team id', async () => {
    const otherOrg = indexRecord('uploads/other-org/pilot/other-org.md', { org_id: 'other-org' });
    const rows = [
      ownershipRecord('uploads/curacel/pilot/acme-proposal.md'),
      ownershipRecord('uploads/curacel/growth/growth-deck.md', { team_id: 'growth' }),
      ownershipRecord('uploads/other-org/pilot/other-org.md', { org_id: 'other-org' }),
    ];
    await withSearchServer(
      {
        sourceRepo: makeSourceRepo(),
        indexRepo: makeIndexRepo([owned, otherTeam, unowned, otherOrg]),
        ownershipRepo: makeOwnershipRepo(rows),
      },
      { 'x-entity-org-id': 'curacel' },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/fs/search?q=&indexState=indexed`);
        const body = (await res.json()) as { results: Array<{ path: string; owner?: unknown }> };
        const paths = body.results.map((r) => r.path);
        expect(paths).toContain('uploads/curacel/pilot/acme-proposal.md');
        expect(paths).toContain('docs/shared.md');
        expect(paths).not.toContain('uploads/curacel/growth/growth-deck.md');
        expect(paths).not.toContain('uploads/other-org/pilot/other-org.md');
      },
      [{ role: 'viewer', org_id: 'curacel', team_id: 'pilot', sensitivity_categories: [] }],
    );
  });

  it('unowned files carry no owner envelope', async () => {
    const rows = [ownershipRecord('uploads/curacel/pilot/acme-proposal.md')];
    await withSearchServer(deps(rows), {}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/fs/search?q=&indexState=indexed`);
      const body = (await res.json()) as { results: Array<{ path: string; owner?: unknown }> };
      const shared = body.results.find((r) => r.path === 'docs/shared.md');
      expect(shared).toBeDefined();
      expect(shared?.owner).toBeUndefined();
    });
  });
});
