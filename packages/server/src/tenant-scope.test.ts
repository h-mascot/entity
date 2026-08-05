import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Request } from 'express';

// Helper to build a minimal Express-like request with headers.
function reqWithHeaders(headers: Record<string, string> = {}): Request {
  return { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

describe('resolveTrustedTenantScope — fail-closed tenant authority (D4)', () => {
  let originalFlag: string | undefined;
  let originalOrg: string | undefined;
  let originalTeam: string | undefined;

  beforeEach(() => {
    originalFlag = process.env.ENTITY_TRUST_TENANT_HEADERS;
    originalOrg = process.env.ENTITY_WORKSPACE_ORG_ID;
    originalTeam = process.env.ENTITY_WORKSPACE_TEAM_ID;
    delete process.env.ENTITY_TRUST_TENANT_HEADERS;
    delete process.env.ENTITY_WORKSPACE_ORG_ID;
    delete process.env.ENTITY_WORKSPACE_TEAM_ID;
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.ENTITY_TRUST_TENANT_HEADERS;
    else process.env.ENTITY_TRUST_TENANT_HEADERS = originalFlag;
    if (originalOrg === undefined) delete process.env.ENTITY_WORKSPACE_ORG_ID;
    else process.env.ENTITY_WORKSPACE_ORG_ID = originalOrg;
    if (originalTeam === undefined) delete process.env.ENTITY_WORKSPACE_TEAM_ID;
    else process.env.ENTITY_WORKSPACE_TEAM_ID = originalTeam;
  });

  it('fails closed to the configured workspace when tenant headers are absent', async () => {
    const { resolveTrustedTenantScope } = await import('./tenant-scope');
    const scope = resolveTrustedTenantScope(reqWithHeaders({}));
    expect(scope.orgId).toBe('default-org');
    expect(scope.teamId).toBe('default-team');
  });

  it('ignores caller-supplied tenant headers unless the trusted-proxy flag is enabled', async () => {
    const { resolveTrustedTenantScope } = await import('./tenant-scope');
    // An authenticated caller setting arbitrary headers MUST NOT select another
    // tenant. Fail closed to the trusted workspace identity.
    const scope = resolveTrustedTenantScope(
      reqWithHeaders({ 'x-entity-org-id': 'attacker-org', 'x-entity-team-id': 'attacker-team' }),
    );
    expect(scope.orgId).toBe('default-org');
    expect(scope.teamId).toBe('default-team');
  });

  it('honors caller tenant headers only behind the explicit trusted-proxy flag', async () => {
    process.env.ENTITY_TRUST_TENANT_HEADERS = '1';
    const { resolveTrustedTenantScope, isTrustedTenantHeaderSource } = await import('./tenant-scope');
    expect(isTrustedTenantHeaderSource()).toBe(true);
    const scope = resolveTrustedTenantScope(
      reqWithHeaders({ 'x-entity-org-id': 'org-a', 'x-entity-team-id': 'team-a' }),
    );
    expect(scope.orgId).toBe('org-a');
    expect(scope.teamId).toBe('team-a');
  });

  it('falls back to the trusted workspace when a header is missing under the trusted flag', async () => {
    process.env.ENTITY_TRUST_TENANT_HEADERS = 'on';
    const { resolveTrustedTenantScope } = await import('./tenant-scope');
    const scope = resolveTrustedTenantScope(reqWithHeaders({ 'x-entity-org-id': 'org-a' }));
    expect(scope.orgId).toBe('org-a');
    expect(scope.teamId).toBe('default-team');
  });

  it('uses an explicit trusted workspace identity override when configured', async () => {
    process.env.ENTITY_WORKSPACE_ORG_ID = 'acme';
    process.env.ENTITY_WORKSPACE_TEAM_ID = 'platform';
    const { resolveTrustedTenantScope } = await import('./tenant-scope');
    const scope = resolveTrustedTenantScope(
      reqWithHeaders({ 'x-entity-org-id': 'attacker-org' }),
    );
    expect(scope.orgId).toBe('acme');
    expect(scope.teamId).toBe('platform');
  });

  it.each([
    ['0', false],
    ['false', false],
    ['no', false],
    ['', false],
    ['1', true],
    ['true', true],
    ['yes', true],
    ['on', true],
  ])('treats ENTITY_TRUST_TENANT_HEADERS=%p as trusted=%p', async (value, expected) => {
    process.env.ENTITY_TRUST_TENANT_HEADERS = value;
    const { isTrustedTenantHeaderSource } = await import('./tenant-scope');
    expect(isTrustedTenantHeaderSource()).toBe(expected);
  });
});
