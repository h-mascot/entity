import { acquireFileMutationGuard, FileMutationConflictError } from './mutation-guard';
import { randomUUID } from 'crypto';
import type { Request, Response, Router } from 'express';
import { createFileIndexRepository, type FileIndexRepository } from '../../../db/src/file-index';
import { createFileSourceRepository, type FileSourceRecord, type FileSourceRepository } from '../../../db/src/file-sources';
import { createFsFileOwnershipRepository, type FsFileOwnershipRepository } from '../../../db/src/file-ownership';
import { createWorkspaceScopeRepository, type WorkspaceScopeRepository } from '../../../db/src';
import { isTextualContentType } from '../file-types';
import { createFileSourceAdapter } from './adapters/registry';
import type { FileSourceAdapter } from './adapters/types';
import { assertSourceEnabled, emitFsAudit, normalizeSourceRelativePath } from './security';
import { isExclusiveCreateConflict, isMissingPathError } from './errors';
import { recordFsOperation } from './metrics';
import { requireRequestOrg, sendPermissionDenied, type RequestOrgBinding } from '../request-permissions';
import { isTrustedServiceContext } from '../principals/request-context';
import { roleMeets, type PermissionRole, type PrincipalGrant } from '../permissions';
import { inspectFileOwnership, ownershipVisible, resolveOwnershipScope } from './ownership';
import { buildUploadScopeRoot } from './scope-path';

// Keep this aligned with the managed-storage broker's current write safety
// ceiling. The limit can be raised only when the broker contract is raised.
export const MAX_UPLOAD_BYTES = 1 * 1024 * 1024;
const PATH_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export interface UploadRouteDeps {
  sourceRepo?: FileSourceRepository;
  ownershipRepo?: FsFileOwnershipRepository;
  indexRepo?: Pick<FileIndexRepository, 'upsertRecord'>;
  teamRepo?: Pick<WorkspaceScopeRepository, 'getTeam'>;
  createAdapter?: (source: Parameters<typeof createFileSourceAdapter>[0]) => FileSourceAdapter;
}

function grantsFor(binding: RequestOrgBinding): PrincipalGrant[] {
  return binding.principal.grants.filter((grant) => !grant.org_id || grant.org_id === binding.orgId);
}

export function resolveUploadTeamId(binding: RequestOrgBinding, requested: string | null | undefined): { teamId: string | null; reason?: string } {
  const grants = grantsFor(binding);
  const eligibleTeamIds = [...new Set(grants.filter((grant) => grant.team_id && !grant.project_id && roleMeets(grant.role, 'contributor')).map((grant) => grant.team_id as string))];
  const hasEligibleOrgGrant = grants.some((grant) => !grant.team_id && !grant.project_id && roleMeets(grant.role, 'contributor'));
  if (requested === null) {
    if (hasEligibleOrgGrant) return { teamId: null };
    return { teamId: null, reason: 'organization-wide uploads require an organization-wide contributor or administrator grant.' };
  }
  if (requested === undefined) {
    if (hasEligibleOrgGrant) return { teamId: null };
    if (eligibleTeamIds.length > 1) return { teamId: null, reason: 'teamId is required when you have multiple contributor team grants.' };
    return { teamId: eligibleTeamIds[0] ?? null };
  }
  if (!eligibleTeamIds.includes(requested) && !hasEligibleOrgGrant) {
    return { teamId: null, reason: `team ${requested} is outside your grants for org ${binding.orgId}` };
  }
  return { teamId: requested };
}

function isActiveTeamInOrg(
  teamRepo: Pick<WorkspaceScopeRepository, 'getTeam'>,
  orgId: string,
  teamId: string,
): boolean {
  const team = teamRepo.getTeam({ orgId }, teamId);
  return Boolean(
    team
      && team.org_id === orgId
      && team.status.trim().toLowerCase() === 'active',
  );
}

export function sanitizeUploadFilename(name: string): string | null {
  const base = name.trim().split(/[\\/]/).pop() ?? '';
  if (!base || base === '.' || base === '..') return null;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120);
  return PATH_SEGMENT.test(cleaned) ? cleaned : null;
}

function decodeBase64(value: string): Buffer {
  const normalized = value.trim();
  const canonical = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!canonical.test(normalized)) throw new Error('file.contentBase64 is not valid base64.');
  if (!normalized) return Buffer.alloc(0);
  const content = Buffer.from(normalized, 'base64');
  if (content.toString('base64') !== normalized) throw new Error('file.contentBase64 is not valid base64.');
  return content;
}

function decodeUpload(body: Record<string, unknown>): { file: Record<string, unknown>; content: Buffer; isText: boolean; mimeType: string | null } {
  const file = body.file;
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('file is required.');
  const record = file as Record<string, unknown>;
  if (typeof record.name !== 'string' || !record.name.trim()) throw new Error('file.name is required.');
  const text = typeof record.text === 'string' ? record.text : undefined;
  const base64 = typeof record.contentBase64 === 'string' ? record.contentBase64 : undefined;
  if (text !== undefined && base64 !== undefined) throw new Error('Provide either file.text or file.contentBase64, not both.');
  const mimeType = typeof record.mimeType === 'string' && record.mimeType.trim() ? record.mimeType.trim() : null;
  if (text !== undefined) return { file: record, content: Buffer.from(text, 'utf8'), isText: true, mimeType };
  if (base64 !== undefined) return { file: record, content: decodeBase64(base64), isText: false, mimeType };
  throw new Error('file.text or file.contentBase64 is required.');
}

function isBrokerMissingPath(error: unknown): boolean {
  return isMissingPathError(error) || (error as { code?: unknown } | null)?.code === 'not_found';
}

function assertUploadTargetAvailable(
  ownershipRepo: FsFileOwnershipRepository,
  sourceId: string,
  targetPath: string,
  sources: readonly FileSourceRecord[],
): void {
  if (inspectFileOwnership(ownershipRepo, sourceId, targetPath, sources).ownerships.length > 0) {
    throw new Error('File already exists.');
  }
}

async function ensureUploadParents(adapter: FileSourceAdapter, targetPath: string): Promise<void> {
  if (!adapter.stat) throw new Error('Source does not support upload parent inspection.');
  const segments = targetPath.split('/').slice(0, -1);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    try {
      const metadata = await adapter.stat(current);
      if (metadata.kind !== 'directory') throw new Error('Upload parent path is not a directory.');
    } catch (error) {
      if (!isBrokerMissingPath(error)) throw error;
      await adapter.mkdir(current).catch(async (mkdirError) => {
        // Another writer may have created this segment concurrently. Accept
        // only a directory observed through the broker after that race.
        if (!adapter.stat) throw mkdirError;
        try {
          const metadata = await adapter.stat(current);
          if (metadata.kind !== 'directory') throw mkdirError;
        } catch {
          throw mkdirError;
        }
      });
    }
  }
}

function uploadError(message: string, res: Response): Response {
  if (message === 'Source not found.' || isMissingPathError(message)) return res.status(404).json({ error: message });
  if (message === 'Source is disabled.' || message.includes('read-only')) return res.status(403).json({ error: message });
  if (message.includes('already exists') || message.includes('already reserved')) return res.status(409).json({ error: message });
  if (message.includes('exceeds') || message.includes('too large')) return res.status(413).json({ error: message });
  if (message.includes('outside your grants') || message.includes('outside the request org/team scope')) return res.status(403).json({ error: message });
  if (message.includes('atomic exclusive')) return res.status(503).json({ error: message });
  if (message.includes('required') || message.includes('Invalid') || message.includes('Path') || message.includes('traversal') || message.includes('base64')) return res.status(400).json({ error: message });
  return res.status(500).json({ error: message });
}

function hasUploadAuthority(req: Request, binding: RequestOrgBinding, role: PermissionRole): boolean {
  if (isTrustedServiceContext(req)) return true;
  const grants = grantsFor(binding);
  // A project-only grant has no representable upload ownership scope. Do not
  // silently turn it into an org-wide upload grant.
  const allowed = grants.some((grant) => !grant.project_id && roleMeets(grant.role, role));
  return allowed;
}

export function registerUploadRoutes(router: Router, deps: UploadRouteDeps = {}): void {
  const sourceRepo = deps.sourceRepo ?? createFileSourceRepository();
  const ownershipRepo = deps.ownershipRepo ?? createFsFileOwnershipRepository();
  const indexRepo = deps.indexRepo ?? createFileIndexRepository();
  const teamRepo = deps.teamRepo ?? createWorkspaceScopeRepository();
  const createAdapter = deps.createAdapter ?? createFileSourceAdapter;

  router.post('/upload', async (req: Request, res: Response) => {
    let sourceId = '';
    let targetPath = '';
    let releaseMutation: (() => void) | undefined;
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
      sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';
      if (!sourceId) throw new Error('sourceId is required.');
      const binding = requireRequestOrg(req, res);
      if (!binding) return;
      const { orgId } = binding;
      if (!hasUploadAuthority(req, binding, 'contributor')) return sendPermissionDenied(res, `contributor role required for org ${orgId}`);
      const requestedTeamId = !Object.prototype.hasOwnProperty.call(body, 'teamId')
        ? undefined
        : body.teamId === null
          ? null
          : typeof body.teamId === 'string' && body.teamId.trim()
            ? body.teamId.trim()
            : (() => { throw new Error('Invalid teamId: expected a string or null.'); })();
      const resolved = resolveUploadTeamId(binding, requestedTeamId);
      if (resolved.reason) return res.status(403).json({ error: resolved.reason });
      const teamId = resolved.teamId;
      if (!orgId.trim() || (teamId !== null && !teamId.trim())) throw new Error('Invalid org or team scope.');
      if (teamId && !isActiveTeamInOrg(teamRepo, orgId, teamId)) {
        return res.status(403).json({ error: `team ${teamId} is not an active team in org ${orgId}` });
      }
      const decoded = decodeUpload(body);
      if (decoded.content.length > MAX_UPLOAD_BYTES) throw new Error('Upload exceeds the 1 MB limit.');
      const filename = sanitizeUploadFilename(String(decoded.file.name));
      if (!filename) throw new Error('file.name is invalid.');
      const root = buildUploadScopeRoot(orgId, teamId);
      const customPath = typeof body.path === 'string' && body.path.trim() ? body.path.trim() : null;
      targetPath = customPath ? normalizeSourceRelativePath(customPath) : `${root}/${filename}`;
      if (!targetPath) throw new Error('path is required.');
      if (customPath && (customPath.includes('..') || (targetPath !== root && !targetPath.startsWith(`${root}/`)))) {
        throw new Error(customPath.includes('..') ? 'Path traversal not allowed.' : 'Upload path is outside the request org/team scope.');
      }
      const source = sourceRepo.getSource(sourceId);
      assertSourceEnabled(source);
      releaseMutation = acquireFileMutationGuard('create');
      const configuredSources = sourceRepo.listSources(true);
      assertUploadTargetAvailable(ownershipRepo, sourceId, targetPath, configuredSources);
      const adapter = createAdapter(source);
      if (!adapter.capabilities().write) throw new Error('Source is read-only.');
      // Select the writer for this payload before creating parents or reserving
      // ownership. A binary-only adapter must not leave a pending text upload.
      if (decoded.isText ? !adapter.writeExclusive : !adapter.writeRawExclusive) {
        throw new Error(`Source does not support atomic exclusive ${decoded.isText ? 'text' : 'binary'} uploads.`);
      }
      try {
        await ensureUploadParents(adapter, targetPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'broker parent preparation failed';
        throw new Error(`Upload parent preparation failed: ${message}`);
      }
      try {
        await adapter.read(targetPath);
        throw new Error('File already exists.');
      } catch (error) {
        if (error instanceof Error && error.message === 'File already exists.') throw error;
        assertUploadTargetAvailable(ownershipRepo, sourceId, targetPath, configuredSources);
        if (!isBrokerMissingPath(error)) throw error;
      }
      assertUploadTargetAvailable(ownershipRepo, sourceId, targetPath, configuredSources);
      // Reserve ownership before writing bytes. If the process dies after the
      // broker write but before the final update, pending ownership still
      // prevents search/tree/file disclosure and blocks clobbering.
      const ownershipInput = { sourceId, path: targetPath, orgId, teamId, ownerPrincipalId: binding.principal.principal_id, displayName: String(decoded.file.name) };
      const pendingReservation = ownershipRepo.reservePendingOwnership(ownershipInput);
      const startedAt = Date.now();
      let writeResult: { updatedAt?: string };
      try {
        writeResult = decoded.isText
          ? (adapter.writeExclusive ? await adapter.writeExclusive(targetPath, decoded.content.toString('utf8')) : (() => { throw new Error('Source does not support atomic exclusive uploads.'); })())
          : (adapter.writeRawExclusive ? await adapter.writeRawExclusive(targetPath, decoded.content) : (() => { throw new Error('Source does not support atomic exclusive uploads.'); })());
      } catch (error) {
        if (isExclusiveCreateConflict(error)) {
          ownershipRepo.deletePendingOwnership(pendingReservation);
          throw error;
        }
        throw new Error('Upload could not be completed; pending reservation retained for reconciliation.');
      }
      const updatedAt = writeResult.updatedAt ?? new Date().toISOString();
      ownershipRepo.upsertOwnership({ ...ownershipInput, origin: 'upload' });
      try {
        const textual = decoded.isText || (decoded.mimeType ? isTextualContentType(decoded.mimeType) : false);
        indexRepo.upsertRecord({ id: randomUUID(), source_id: sourceId, path: targetPath, title: filename, type: 'one-off', agent: 'user', origin: 'manual', is_recurring: false, tags: '["upload"]', updated_at: updatedAt, org_id: orgId, preview: textual ? decoded.content.toString('utf8').slice(0, 500) : null });
      } catch (error) {
        emitFsAudit('fs.upload.index.error', { sourceId, path: targetPath, error: error instanceof Error ? error.message : 'index upsert failed' });
      }
      const durationMs = Date.now() - startedAt;
      emitFsAudit('fs.upload', { sourceId, path: targetPath, orgId, teamId, ownerPrincipalId: binding.principal.principal_id, size: decoded.content.length, isText: decoded.isText, durationMs });
      recordFsOperation({ operation: 'fs.upload', sourceId, durationMs, success: true });
      sourceRepo.updateSource(source.id, { health: 'ok', last_synced_at: updatedAt });
      return res.status(201).json({ sourceId, path: targetPath, orgId, teamId, ownerPrincipalId: binding.principal.principal_id, displayName: String(decoded.file.name), size: decoded.content.length, updatedAt: writeResult.updatedAt ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      emitFsAudit('fs.upload.error', { sourceId, path: targetPath, error: message });
      recordFsOperation({ operation: 'fs.upload', sourceId, success: false, error: message });
      if (error instanceof FileMutationConflictError) return res.status(409).json({ error: message });
      return uploadError(message, res);
    } finally {
      releaseMutation?.();
    }
  });

  router.get('/uploads', (req: Request, res: Response) => {
    try {
      const binding = requireRequestOrg(req, res);
      if (!binding) return;
      const { orgId } = binding;
      const grants = grantsFor(binding);
      if (grants.length === 0 && !isTrustedServiceContext(req)) return sendPermissionDenied(res, `viewer role required for org ${orgId}`);
      const scope = resolveOwnershipScope(binding);
      const uploads = (scope.hasOrgWide
        ? ownershipRepo.listOwnershipForOrg(orgId)
        : ownershipRepo.listOwnershipForTeams(orgId, [...scope.visibleTeamIds]))
        .filter((record) => record.origin !== 'pending' && ownershipVisible(scope, record));
      return res.json({ orgId, uploads });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
}
