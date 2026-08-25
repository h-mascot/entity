import type { Request, Response, Router } from 'express';
import { randomUUID } from 'crypto';
import { createFileSourceRepository, type FileSourceRepository } from '../../../db/src/file-sources';
import { createFsFileOwnershipRepository, type FsFileOwnershipRepository } from '../../../db/src/file-ownership';
import { createFileIndexRepository, type FileIndexRepository } from '../../../db/src/file-index';
import { isTextualContentType } from '../file-types';
import { createFileSourceAdapter } from './adapters/registry';
import { assertSourceEnabled, emitFsAudit, normalizeSourceRelativePath } from './security';
import { recordFsOperation } from './metrics';
import { isMissingPathError } from './errors';
import { readRequestOrg, readRequestPrincipal, sendPermissionDenied, type RequestOrgBinding } from '../request-permissions';
import { isTrustedServiceContext } from '../principals/request-context';
import { LOCAL_ADMIN_PRINCIPAL_ID } from '../principals/admin-identity';
import { roleMeets, type PermissionRole, type PrincipalGrant } from '../permissions';

/**
 * MC #1365 — employee document upload with ownership/team scoping.
 *
 * Closes the MC#1357 P0 gap: the Files surface had browse/search/restricted
 * results but no upload action. This route:
 *   1. gates writes on a persisted grant for the request org meeting
 *      `contributor` (mirrors the chat D-R6 mutation gate, incl. the
 *      trusted-service bypass);
 *   2. constrains teamId to the caller's own team grants (defaulting to the
 *      caller's first team grant for the org);
 *   3. stores files under `uploads/<orgId>/<teamId>/…` with a sanitized
 *      filename (binary content via base64, written through the adapter's
 *      writeRaw so bytes are not utf-8 mangled);
 *   4. records ownership (org/team/owner principal) in fs_file_ownership;
 *   5. upserts a targeted file_index row so search finds the file immediately
 *      even when the background indexer is disabled (as in the Curacel pilot).
 */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_PATH_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export interface UploadRouteDeps {
  sourceRepo?: FileSourceRepository;
  ownershipRepo?: FsFileOwnershipRepository;
  indexRepo?: Pick<FileIndexRepository, 'upsertRecord'>;
}

function applicableGrants(binding: RequestOrgBinding): PrincipalGrant[] {
  return binding.principal.grants.filter((grant) => !grant.org_id || grant.org_id === binding.orgId);
}

function resolveUploadTeamId(
  binding: RequestOrgBinding,
  requestedTeamId: string | null,
): { teamId: string | null; reason?: string } {
  const grants = applicableGrants(binding);
  const teamGrantIds = [
    ...new Set(grants.filter((g) => g.team_id).map((g) => g.team_id as string)),
  ];
  if (requestedTeamId === null) {
    // If the caller has any team grant, bind the upload to the first team
    // grant. This keeps the default ownership scope deterministic even when
    // the same principal also has an org-wide manager grant.
    if (teamGrantIds.length > 0) {
      return { teamId: teamGrantIds[0] };
    }
    return { teamId: null };
  }
  if (!teamGrantIds.includes(requestedTeamId) && !grants.some((g) => !g.team_id)) {
    return { teamId: null, reason: `team ${requestedTeamId} is outside your grants for org ${binding.orgId}` };
  }
  return { teamId: requestedTeamId };
}

function sanitizeFilename(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const base = trimmed.split(/[\\/]/).pop() ?? '';
  if (!base || base === '.' || base === '..') return null;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120);
  if (!cleaned || !UPLOAD_PATH_SEGMENT.test(cleaned)) return null;
  return cleaned;
}

function assertUploadPathSegment(value: string, label: string): void {
  if (!UPLOAD_PATH_SEGMENT.test(value)) {
    throw new Error(`Invalid ${label} scope.`);
  }
}

function buildUploadRoot(orgId: string, teamId: string | null): string {
  return teamId ? `uploads/${orgId}/${teamId}` : `uploads/${orgId}`;
}

function buildUploadPath(orgId: string, teamId: string | null, filename: string): string {
  return `${buildUploadRoot(orgId, teamId)}/${filename}`;
}

function decodeBase64(value: string): Buffer {
  const normalized = value.trim();
  const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!normalized || !canonicalBase64.test(normalized)) {
    throw new Error('file.contentBase64 is not valid base64.');
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.length === 0 || buffer.toString('base64') !== normalized) {
    throw new Error('file.contentBase64 is not valid base64.');
  }
  return buffer;
}

function decodeUploadContent(body: Record<string, unknown>): { content: Buffer; isText: boolean; mimeType: string | null } {
  const file = body.file;
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    throw new Error('file is required.');
  }
  const record = file as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : '';
  if (!name.trim()) {
    throw new Error('file.name is required.');
  }
  const mimeType = typeof record.mimeType === 'string' && record.mimeType.trim() ? record.mimeType.trim() : null;
  const text = typeof record.text === 'string' ? record.text : undefined;
  const contentBase64 = typeof record.contentBase64 === 'string' ? record.contentBase64 : undefined;

  if (typeof text === 'string' && typeof contentBase64 === 'string') {
    throw new Error('Provide either file.text or file.contentBase64, not both.');
  }
  if (typeof text === 'string') {
    return { content: Buffer.from(text, 'utf-8'), isText: true, mimeType };
  }
  if (typeof contentBase64 === 'string') {
    return { content: decodeBase64(contentBase64), isText: false, mimeType };
  }
  throw new Error('file.text or file.contentBase64 is required.');
}

function mapUploadError(message: string, res: Response): Response {
  if (message === 'Source not found.') return res.status(404).json({ error: message });
  if (isMissingPathError(message)) return res.status(404).json({ error: message });
  if (message === 'Source is disabled.') return res.status(403).json({ error: message });
  if (message.includes('read-only')) return res.status(403).json({ error: message });
  if (message.includes('already exists')) return res.status(409).json({ error: message });
  if (message.includes('exceeds') || message.includes('too large')) return res.status(413).json({ error: message });
  if (message.includes('outside the request org/team scope')) {
    return res.status(403).json({ error: message });
  }
  if (
    message.includes('required') ||
    message.includes('Invalid') ||
    message.includes('Path') ||
    message.includes('outside your grants') ||
    message.includes('traversal') ||
    message.includes('outside source root') ||
    message.includes('base64')
  ) {
    return res.status(400).json({ error: message });
  }
  return res.status(500).json({ error: message });
}

export function registerUploadRoutes(router: Router, deps: UploadRouteDeps = {}): void {
  const sourceRepo = deps.sourceRepo ?? createFileSourceRepository();
  const ownershipRepo = deps.ownershipRepo ?? createFsFileOwnershipRepository();
  const indexRepo = deps.indexRepo ?? createFileIndexRepository();

  const requireUploadAuthority = (
    req: Request,
    res: Response,
    binding: RequestOrgBinding,
    requiredRole: PermissionRole,
  ): boolean => {
    if (isTrustedServiceContext(req)) return true;
    const grants = applicableGrants(binding);
    if (grants.length === 0) {
      sendPermissionDenied(res, `${requiredRole} role required for org ${binding.orgId}`);
      return false;
    }
    const effectiveRole = grants.reduce<PermissionRole>(
      (role, grant) => (roleMeets(grant.role, requiredRole) ? grant.role : role),
      'none',
    );
    if (!roleMeets(effectiveRole, requiredRole)) {
      sendPermissionDenied(res, `${requiredRole} role required for org ${binding.orgId}`);
      return false;
    }
    return true;
  };

  router.post('/upload', async (req: Request, res: Response) => {
    let sourceId = '';
    let targetPath = '';

    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body as Record<string, unknown>
        : {};
      sourceId = typeof body.sourceId === 'string' && body.sourceId.trim() ? body.sourceId.trim() : '';
      if (!sourceId) {
        throw new Error('sourceId is required.');
      }

      const orgId = readRequestOrg(req) ?? 'default-org';
      const binding: RequestOrgBinding = { orgId, principal: readRequestPrincipal(req, orgId) };
      if (!requireUploadAuthority(req, res, binding, 'contributor')) {
        return;
      }

      const requestedTeamId = typeof body.teamId === 'string' && body.teamId.trim() ? body.teamId.trim() : null;
      const { teamId, reason } = resolveUploadTeamId(binding, requestedTeamId);
      if (reason) {
        return res.status(403).json({ error: reason });
      }
      assertUploadPathSegment(orgId, 'org');
      if (teamId) {
        assertUploadPathSegment(teamId, 'team');
      }

      const { content, isText, mimeType } = decodeUploadContent(body);
      if (content.length > MAX_UPLOAD_BYTES) {
        throw new Error(`Upload exceeds the ${(MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)} MB limit.`);
      }

      const filename = sanitizeFilename((body.file as Record<string, unknown>).name as string);
      if (!filename) {
        throw new Error('file.name is invalid.');
      }

      const customPath = typeof body.path === 'string' && body.path.trim() ? body.path.trim() : null;
      if (customPath) {
        if (customPath.includes('..')) {
          throw new Error('Path traversal not allowed.');
        }
        targetPath = normalizeSourceRelativePath(customPath);
        const uploadRoot = buildUploadRoot(orgId, teamId);
        if (targetPath !== uploadRoot && !targetPath.startsWith(`${uploadRoot}/`)) {
          throw new Error('Upload path is outside the request org/team scope.');
        }
      } else {
        targetPath = buildUploadPath(orgId, teamId, filename);
      }
      if (!targetPath) {
        throw new Error('path is required.');
      }

      const source = sourceRepo.getSource(sourceId);
      assertSourceEnabled(source);
      const adapter = createFileSourceAdapter(source);
      const capabilities = adapter.capabilities();
      if (!capabilities.write) {
        throw new Error('Source is read-only.');
      }

      // Refuse to clobber an existing file (or an existing ownership row).
      try {
        await adapter.read(targetPath);
        throw new Error('File already exists.');
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (message === 'File already exists.') {
          throw err;
        }
        if (ownershipRepo.getOwnership(sourceId, targetPath)) {
          throw new Error('File already exists.');
        }
        // otherwise: doesn't exist -> proceed
      }
      if (ownershipRepo.getOwnership(sourceId, targetPath)) {
        throw new Error('File already exists.');
      }

      const startedAt = Date.now();
      let writeResult: { updatedAt?: string };
      if (isText) {
        const writeExclusive = (adapter as { writeExclusive?: (p: string, c: string) => Promise<{ updatedAt?: string }> }).writeExclusive;
        writeResult = typeof writeExclusive === 'function'
          ? await writeExclusive.call(adapter, targetPath, content.toString('utf-8'))
          : await adapter.write(targetPath, content.toString('utf-8'));
      } else {
        const writeRawExclusive = (adapter as { writeRawExclusive?: (p: string, c: Buffer) => Promise<{ updatedAt?: string }> }).writeRawExclusive;
        const writeRaw = (adapter as { writeRaw?: (p: string, c: Buffer) => Promise<{ updatedAt?: string }> }).writeRaw;
        const writer = writeRawExclusive ?? writeRaw;
        if (typeof writer !== 'function') {
          throw new Error('Source is read-only for binary uploads.');
        }
        writeResult = await writer.call(adapter, targetPath, content);
      }
      const durationMs = Date.now() - startedAt;

      const displayName = ((body.file as Record<string, unknown>).name as string) ?? filename;
      ownershipRepo.upsertOwnership({
        sourceId,
        path: targetPath,
        orgId,
        teamId,
        ownerPrincipalId: binding.principal.principal_id,
        displayName,
        origin: 'upload',
      });

      // Targeted index upsert so search surfaces the file immediately
      // (background indexer is disabled on some deployments, e.g. Curacel pilot).
      try {
        const textual = isText || (mimeType ? isTextualContentType(mimeType) : false);
        indexRepo.upsertRecord({
          id: randomUUID(),
          source_id: sourceId,
          path: targetPath,
          title: filename,
          type: 'one-off',
          agent: 'user',
          origin: 'manual',
          is_recurring: false,
          tags: '["upload"]',
          updated_at: writeResult.updatedAt ?? new Date().toISOString(),
          org_id: orgId,
          preview: textual ? content.toString('utf-8').slice(0, 500) : null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'index upsert failed';
        emitFsAudit('fs.upload.index.error', { sourceId, path: targetPath, error: message });
      }

      emitFsAudit('fs.upload', {
        sourceId,
        path: targetPath,
        orgId,
        teamId,
        ownerPrincipalId: binding.principal.principal_id,
        size: content.length,
        isText,
        durationMs,
      });
      recordFsOperation({ operation: 'fs.upload', sourceId, durationMs, success: true });
      sourceRepo.updateSource(source.id, {
        health: 'ok',
        last_synced_at: new Date().toISOString(),
      });

      return res.status(201).json({
        sourceId,
        path: targetPath,
        orgId,
        teamId,
        ownerPrincipalId: binding.principal.principal_id,
        displayName,
        size: content.length,
        updatedAt: writeResult.updatedAt ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      emitFsAudit('fs.upload.error', { sourceId, path: targetPath, error: message });
      recordFsOperation({ operation: 'fs.upload', sourceId, success: false, error: message });
      return mapUploadError(message, res);
    }
  });

  router.get('/uploads', (req: Request, res: Response) => {
    try {
      const orgId = readRequestOrg(req) ?? 'default-org';
      const binding: RequestOrgBinding = { orgId, principal: readRequestPrincipal(req, orgId) };
      const grants = applicableGrants(binding);
      if (grants.length === 0 && !isTrustedServiceContext(req)) {
        return sendPermissionDenied(res, `viewer role required for org ${orgId}`);
      }
      const isLocalAdmin = binding.principal.principal_id === LOCAL_ADMIN_PRINCIPAL_ID;
      const hasOrgWide = isLocalAdmin || grants.some((g) => !g.team_id);
      const records = hasOrgWide
        ? ownershipRepo.listOwnershipForOrg(orgId)
        : ownershipRepo.listOwnershipForTeams(
            orgId,
            [...new Set(grants.filter((g) => g.team_id).map((g) => g.team_id as string))],
          );
      return res.json({ orgId, uploads: records });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  });
}
