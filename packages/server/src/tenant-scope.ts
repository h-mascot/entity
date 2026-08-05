/**
 * Trusted tenant authority boundary (D4 / BRD-001+004).
 *
 * Boards and task-linked Swarm operations must derive their org/team scope from
 * a TRUSTED source, not from arbitrary caller-supplied headers. The trusted
 * source is the server-configured workspace identity (`DEFAULT_WORKSPACE_*`,
 * optionally overridden via `ENTITY_WORKSPACE_ORG_ID` / `ENTITY_WORKSPACE_TEAM_ID`).
 *
 * Caller `x-entity-org-id` / `x-entity-team-id` headers are honored ONLY when an
 * operator has explicitly enabled trusted-proxy tenant headers
 * (`ENTITY_TRUST_TENANT_HEADERS`). Without that explicit opt-in the headers are
 * ignored and the scope resolves to the configured workspace — fail closed — so
 * no authenticated caller can select another organization/team by setting a
 * header. This reuses the existing `x-entity-*` header convention (now gated as a
 * trusted-proxy path) and the existing configured workspace identity, without
 * inventing identity claims.
 *
 * This boundary is deliberately scoped to the customizable-board surface and the
 * task-linked Swarm (Run-with-agents) surface. The broader workspace/search/chat
 * routes keep their own request-scoping and are intentionally untouched here.
 */

import type { Request } from 'express';
import { DEFAULT_WORKSPACE_ORG_ID, DEFAULT_WORKSPACE_TEAM_ID } from '../../db/src';

export interface TenantScope {
  orgId: string;
  teamId: string;
}

/** Configured (trusted) workspace org identity. */
export function trustedWorkspaceOrgId(): string {
  const env = process.env.ENTITY_WORKSPACE_ORG_ID?.trim();
  return env ? env : DEFAULT_WORKSPACE_ORG_ID;
}

/** Configured (trusted) workspace team identity. */
export function trustedWorkspaceTeamId(): string {
  const env = process.env.ENTITY_WORKSPACE_TEAM_ID?.trim();
  return env ? env : DEFAULT_WORKSPACE_TEAM_ID;
}

/**
 * Whether caller-supplied tenant headers may be trusted as a tenant selector.
 * Default OFF — an explicit operator opt-in is required (trusted-proxy path).
 */
export function isTrustedTenantHeaderSource(): boolean {
  const raw = process.env.ENTITY_TRUST_TENANT_HEADERS;
  if (raw === undefined) return false;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return false;
  return !(normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off');
}

function readTrimmedHeader(req: Request, name: string): string | undefined {
  const value = req.header(name);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Resolve the authoritative org/team tenant scope for a request.
 *
 * Fail-closed trust model: scope = configured workspace identity, except behind
 * an explicit trusted-proxy opt-in where validated caller headers are honored.
 */
export function resolveTrustedTenantScope(req: Request): TenantScope {
  if (isTrustedTenantHeaderSource()) {
    const orgId = readTrimmedHeader(req, 'x-entity-org-id') ?? trustedWorkspaceOrgId();
    const teamId = readTrimmedHeader(req, 'x-entity-team-id') ?? trustedWorkspaceTeamId();
    return { orgId, teamId };
  }
  return { orgId: trustedWorkspaceOrgId(), teamId: trustedWorkspaceTeamId() };
}
