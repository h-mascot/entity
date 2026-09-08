import path from 'node:path';
import { LOCAL_ADMIN_PRINCIPAL_ID } from '../principals/admin-identity';
import type { RequestOrgBinding } from '../request-permissions';
import type { FsFileOwnershipRecord, FsFileOwnershipRepository } from '../../../db/src/file-ownership';
import type { FileSourceRecord } from '../../../db/src/file-sources';
import { roleMeets } from '../permissions';
import { isContainedPath, resolveLocalPath, resolvePathThroughNearestExistingAncestor } from './security';
import { encodeUploadScopeSegment } from './scope-path';

export interface OwnershipScope {
  orgId: string;
  isAdmin: boolean;
  hasOrgWide: boolean;
  visibleTeamIds: Set<string>;
}

function canonicalOwnershipPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized.split('/').some((segment) => segment === '.' || segment === '..' || !segment)) return null;
  return normalized;
}

export function resolveOwnershipScope(binding: RequestOrgBinding): OwnershipScope {
  const grants = binding.principal.grants.filter((grant) => !grant.org_id || grant.org_id === binding.orgId);
  const isAdmin = binding.principal.principal_id === LOCAL_ADMIN_PRINCIPAL_ID || grants.some(
    (grant) => grant.role === 'admin' && !grant.org_id && !grant.team_id && !grant.project_id,
  );
  return {
    orgId: binding.orgId,
    isAdmin,
    hasOrgWide: isAdmin || grants.some((grant) => !grant.team_id && !grant.project_id && roleMeets(grant.role, 'viewer')),
    visibleTeamIds: new Set(grants.flatMap((grant) => grant.team_id && !grant.project_id && roleMeets(grant.role, 'viewer') ? [grant.team_id] : [])),
  };
}

export function isReservedUploadPath(filePath: string): boolean {
  const normalized = canonicalOwnershipPath(filePath);
  if (!normalized) return false;
  return normalized === 'uploads' || normalized.startsWith('uploads/');
}

export function ownershipPathVisible(scope: OwnershipScope, filePath: string, records: readonly FsFileOwnershipRecord[]): boolean {
  if (!isReservedUploadPath(filePath)) return true;
  const normalized = canonicalOwnershipPath(filePath);
  if (!normalized) return false;
  return records.some((record) => ownershipVisible(scope, record) && (record.path === normalized || record.path.startsWith(`${normalized}/`)));
}

export class OwnershipAccessDeniedError extends Error {
  constructor(message = 'File is outside file ownership scope.') {
    super(message);
    this.name = 'OwnershipAccessDeniedError';
  }
}

type OwnershipLookup = Pick<FsFileOwnershipRepository, 'getOwnership'>;

export interface OwnershipSourceContext {
  sourceId: string;
  path: string;
}

export interface OwnershipInspection {
  contexts: readonly OwnershipSourceContext[];
  ownerships: readonly FsFileOwnershipRecord[];
  primary: FsFileOwnershipRecord | undefined;
  hasReservedContext: boolean;
}

function normalizedPathOrThrow(filePath: string): string {
  const normalized = canonicalOwnershipPath(filePath);
  if (!normalized) throw new OwnershipAccessDeniedError('Invalid file ownership path.');
  return normalized;
}

function normalizedDirectoryPathOrThrow(filePath: string): string {
  const rootCandidate = filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!rootCandidate) return '';
  return normalizedPathOrThrow(filePath);
}

function realPathWithMissingSuffix(source: FileSourceRecord, relativePath: string): { root: string; target: string } | null {
  const basePath = source.base_path?.trim();
  if (!basePath) return null;
  try {
    const base = resolveLocalPath(basePath, '');
    const target = resolveLocalPath(basePath, relativePath);
    const root = resolvePathThroughNearestExistingAncestor(base);
    const resolvedTarget = resolvePathThroughNearestExistingAncestor(target);
    return isContainedPath(root, resolvedTarget) ? { root, target: resolvedTarget } : null;
  } catch {
    return null;
  }
}

function isRootPath(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') === '';
}

function sourceContexts(
  sourceId: string,
  source: FileSourceRecord | undefined,
  filePath: string,
  sources: readonly FileSourceRecord[] = [],
  options: { allowRoot?: boolean } = {},
): OwnershipSourceContext[] {
  const normalized = canonicalOwnershipPath(filePath);
  const normalizedDirectoryRoot = options.allowRoot && !normalized && isRootPath(filePath) ? '' : null;
  const contextPath = normalized ?? normalizedDirectoryRoot;
  if (contextPath === null) return [{ sourceId, path: filePath }];
  if (!source) return [{ sourceId, path: contextPath }];
  const physical = source.type === 'local' ? realPathWithMissingSuffix(source, contextPath) : null;
  const candidates = physical
    ? [source, ...sources.filter((candidate) => candidate.id !== source.id && candidate.type === 'local')]
    : [source];
  const contexts: OwnershipSourceContext[] = [];

  for (const candidate of candidates) {
    let projectedPath = contextPath;
    if (physical && candidate.type === 'local') {
      const candidateRoot = realPathWithMissingSuffix(candidate, '');
      if (!candidateRoot || !isContainedPath(candidateRoot.root, physical.target)) continue;
      projectedPath = path.relative(candidateRoot.root, physical.target).split(path.sep).filter(Boolean).join('/');
    }
    if (!contexts.some((context) => context.sourceId === candidate.id && context.path === projectedPath)) {
      contexts.push({ sourceId: candidate.id, path: projectedPath });
    }
  }

  return contexts.length > 0 ? contexts : [{ sourceId, path: contextPath }];
}

function sourcePhysicalTarget(sourceId: string, filePath: string, sources: readonly FileSourceRecord[]): string | null {
  const source = sources.find((candidate) => candidate.id === sourceId);
  if (!source || source.type !== 'local') return null;
  return realPathWithMissingSuffix(source, filePath)?.target ?? null;
}

function recordMatchesContext(record: FsFileOwnershipRecord, context: OwnershipSourceContext, sources: readonly FileSourceRecord[]): boolean {
  const contextTarget = sourcePhysicalTarget(context.sourceId, context.path, sources);
  const recordTarget = sourcePhysicalTarget(record.source_id, record.path, sources);
  if (contextTarget && recordTarget) return isContainedPath(contextTarget, recordTarget);
  if (record.source_id !== context.sourceId) return false;
  const contextPath = canonicalOwnershipPath(context.path);
  const recordPath = canonicalOwnershipPath(record.path);
  return Boolean(contextPath && recordPath && (recordPath === contextPath || recordPath.startsWith(`${contextPath}/`)));
}

function recordsSharePhysicalPath(left: FsFileOwnershipRecord, right: FsFileOwnershipRecord, sources: readonly FileSourceRecord[]): boolean {
  const leftTarget = sourcePhysicalTarget(left.source_id, left.path, sources);
  const rightTarget = sourcePhysicalTarget(right.source_id, right.path, sources);
  if (leftTarget && rightTarget) return leftTarget === rightTarget;
  return left.source_id === right.source_id && canonicalOwnershipPath(left.path) === canonicalOwnershipPath(right.path);
}

function contributorCanWrite(grant: RequestOrgBinding['principal']['grants'][number], orgId: string, teamId: string | null): boolean {
  if (grant.project_id || !roleMeets(grant.role, 'contributor') || (grant.org_id && grant.org_id !== orgId)) return false;
  return !grant.team_id || grant.team_id === teamId;
}

function assertOwnedRowsWritable(binding: RequestOrgBinding, scope: OwnershipScope, rows: readonly FsFileOwnershipRecord[]): void {
  const grants = binding.principal.grants;
  if (scope.isAdmin) return;
  const allowed = rows.every((row) => grants.some((grant) => contributorCanWrite(grant, binding.orgId, row.team_id)));
  if (!allowed) throw new OwnershipAccessDeniedError('Contributor role required for this file scope.');
}

function reservedTeamSegment(filePath: string): string | null {
  const segments = filePath.split('/');
  return segments[0] === 'uploads' && segments[1] && segments[2] ? segments[2] : null;
}

function contributorCanCreateReservedPath(binding: RequestOrgBinding, filePath: string): boolean {
  const segments = filePath.split('/');
  if (segments[0] !== 'uploads' || segments[1] !== encodeUploadScopeSegment(binding.orgId)) return false;
  const teamSegment = reservedTeamSegment(filePath);
  return binding.principal.grants.some((grant) => {
    if (!grant.team_id) return contributorCanWrite(grant, binding.orgId, null);
    return Boolean(teamSegment)
      && encodeUploadScopeSegment(grant.team_id) === teamSegment
      && contributorCanWrite(grant, binding.orgId, grant.team_id);
  });
}

export function inspectFileOwnership(
  ownershipRepo: OwnershipLookup,
  sourceId: string,
  filePath: string,
  sources: readonly FileSourceRecord[] = [],
): OwnershipInspection {
  const normalizedPath = normalizedPathOrThrow(filePath);
  return inspectNormalizedFileOwnership(ownershipRepo, sourceId, normalizedPath, sources);
}

function inspectNormalizedFileOwnership(
  ownershipRepo: OwnershipLookup,
  sourceId: string,
  normalizedPath: string,
  sources: readonly FileSourceRecord[] = [],
  options: { allowRoot?: boolean } = {},
): OwnershipInspection {
  const source = sources.find((candidate) => candidate.id === sourceId);
  const contexts = sourceContexts(sourceId, source, normalizedPath, sources, options);
  const ownerships = contexts
    .map((context) => ownershipRepo.getOwnership(context.sourceId, context.path))
    .filter((row): row is FsFileOwnershipRecord => Boolean(row));
  return {
    contexts,
    ownerships,
    primary: ownerships[0],
    hasReservedContext: contexts.some((context) => isReservedUploadPath(context.path)),
  };
}

export function assertOwnedDirectoryWriteAccess(
  binding: RequestOrgBinding,
  ownershipRepo: OwnershipLookup,
  sourceId: string,
  filePath: string,
  sources: readonly FileSourceRecord[],
): void {
  const scope = resolveOwnershipScope(binding);
  const normalizedPath = normalizedDirectoryPathOrThrow(filePath);
  const inspection = inspectNormalizedFileOwnership(ownershipRepo, sourceId, normalizedPath, sources, { allowRoot: true });
  const contexts = inspection.contexts;
  const rows = inspection.ownerships;
  if (rows.some((row) => !ownershipVisible(scope, row))) throw new OwnershipAccessDeniedError();
  if (rows.length > 0) {
    assertOwnedRowsWritable(binding, scope, rows);
    return;
  }

  const reservedContexts = contexts.filter((context) => isReservedUploadPath(context.path));
  const grants = binding.principal.grants;
  if (scope.isAdmin) return;
  const allowed = reservedContexts.length > 0
    ? reservedContexts.every((context) => {
      return contributorCanCreateReservedPath(binding, context.path);
    })
    : grants.some((grant) => contributorCanWrite(grant, binding.orgId, null) && !grant.team_id);
  if (!allowed) throw new OwnershipAccessDeniedError('Contributor role required for this file scope.');
}

export function assertOwnedFileAccess(
  binding: RequestOrgBinding,
  ownershipRepo: OwnershipLookup,
  sourceId: string,
  filePath: string,
  operation: 'read' | 'write',
  sources: readonly FileSourceRecord[] = [],
): FsFileOwnershipRecord | undefined {
  const scope = resolveOwnershipScope(binding);
  const normalizedPath = normalizedPathOrThrow(filePath);
  const inspection = inspectFileOwnership(ownershipRepo, sourceId, normalizedPath, sources);
  const ownerships = inspection.ownerships;
  const ownership = inspection.primary;
  const reservedContexts = inspection.contexts.filter((context) => isReservedUploadPath(context.path));
  if (ownerships.length === 0 && reservedContexts.length > 0) {
    throw new OwnershipAccessDeniedError('File ownership is required for reserved upload paths.');
  }
  if (ownerships.some((row) => !ownershipVisible(scope, row))) throw new OwnershipAccessDeniedError();
  if (operation !== 'write') return ownership;
  if (ownerships.length > 0) {
    assertOwnedRowsWritable(binding, scope, ownerships);
    return ownership;
  }
  if (!scope.isAdmin && !binding.principal.grants.some((grant) => contributorCanWrite(grant, binding.orgId, null) && !grant.team_id)) {
    throw new OwnershipAccessDeniedError('Contributor role required for this file scope.');
  }
  return ownership;
}

/** Creation policy for workflows that reserve ownership before writing bytes. */
export function assertOwnedFileCreationAccess(
  binding: RequestOrgBinding,
  ownershipRepo: OwnershipLookup,
  sourceId: string,
  filePath: string,
  sources: readonly FileSourceRecord[] = [],
): FsFileOwnershipRecord | undefined {
  const scope = resolveOwnershipScope(binding);
  const inspection = inspectFileOwnership(ownershipRepo, sourceId, filePath, sources);
  if (inspection.ownerships.some((row) => !ownershipVisible(scope, row))) throw new OwnershipAccessDeniedError();
  if (inspection.ownerships.length > 0) {
    assertOwnedRowsWritable(binding, scope, inspection.ownerships);
    return inspection.primary;
  }
  const reservedContexts = inspection.contexts.filter((context) => isReservedUploadPath(context.path));
  if (reservedContexts.length > 0) {
    if (!scope.isAdmin && !reservedContexts.every((context) => contributorCanCreateReservedPath(binding, context.path))) {
      throw new OwnershipAccessDeniedError('Contributor role required for this file scope.');
    }
    return undefined;
  }
  if (!scope.isAdmin && !binding.principal.grants.some((grant) => contributorCanWrite(grant, binding.orgId, null) && !grant.team_id)) {
    throw new OwnershipAccessDeniedError('Contributor role required for this file scope.');
  }
  return undefined;
}

export function sourceOwnershipPathVisible(
  scope: OwnershipScope,
  sourceId: string,
  filePath: string,
  records: readonly FsFileOwnershipRecord[],
  sources: readonly FileSourceRecord[] = [],
): boolean {
  const source = sources.find((candidate) => candidate.id === sourceId);
  const contexts = sourceContexts(sourceId, source, filePath, sources);
  const reservedContexts = contexts.filter((context) => isReservedUploadPath(context.path));
  if (reservedContexts.length === 0) return true;

  // A physical file can be exposed through multiple configured local-source
  // aliases. One visible ownership row is sufficient for that file, but an
  // invisible row for the same physical path (foreign or pending) wins closed.
  const matchingRecords = records.filter((record) => reservedContexts.some((context) => recordMatchesContext(record, context, sources)));
  const visibleRecords = matchingRecords.filter((record) => ownershipVisible(scope, record));
  if (visibleRecords.length === 0) return false;
  return visibleRecords.some((visibleRecord) => matchingRecords
    .filter((record) => recordsSharePhysicalPath(record, visibleRecord, sources))
    .every((record) => ownershipVisible(scope, record)));
}

export function sourcePathHasReservedContext(
  sourceId: string,
  filePath: string,
  sources: readonly FileSourceRecord[] = [],
): boolean {
  const source = sources.find((candidate) => candidate.id === sourceId);
  return sourceContexts(sourceId, source, filePath, sources).some((context) => isReservedUploadPath(context.path));
}

export function ownershipVisible(scope: OwnershipScope, ownership: FsFileOwnershipRecord | undefined): boolean {
  if (!ownership) return true;
  // A pending upload reserves its path before broker bytes are written. It is
  // never readable/searchable, including by an org-wide caller.
  if (ownership.origin === 'pending') return false;
  // Admin authority is still constrained by the organization selected for
  // this request. A global/local admin may switch organizations explicitly,
  // but must not use an existing binding to cross-read or mutate ownership
  // rows from another organization.
  if (ownership.org_id !== scope.orgId) return false;
  if (scope.isAdmin || scope.hasOrgWide) return true;
  return ownership.team_id !== null && scope.visibleTeamIds.has(ownership.team_id);
}

export function ownershipEnvelope(ownership: FsFileOwnershipRecord | undefined): Record<string, unknown> | null {
  if (!ownership) return null;
  return {
    orgId: ownership.org_id,
    teamId: ownership.team_id,
    ownerPrincipalId: ownership.owner_principal_id,
    displayName: ownership.display_name,
    origin: ownership.origin,
    uploadedAt: ownership.uploaded_at,
  };
}
