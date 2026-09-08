import { acquireFileMutationGuard, FileMutationConflictError } from './mutation-guard';
import type { Request, Response, Router } from 'express';
import { createFileSourceRepository, type FileSourceRepository } from '../../../db/src/file-sources';
import { createFsFileOwnershipRepository, type FsFileOwnershipRecord, type FsFileOwnershipRepository } from '../../../db/src/file-ownership';
import { createFileSourceAdapter } from './adapters/registry';
import type { FileSourceAdapter } from './adapters/types';
import { assertSourceEnabled, normalizeSourceRelativePath } from './security';
import { assertOwnedFileAccess, assertOwnedFileCreationAccess, isReservedUploadPath, sourcePathHasReservedContext } from './ownership';
import { isExclusiveCreateConflict } from './errors';
import { requireRequestOrg, type RequestOrgBinding } from '../request-permissions';
import {
  buildConvertedDocumentContent,
  parseDocumentConvertTargetType,
} from './document-convert';

export interface DocumentConvertRouteDeps {
  sourceRepo?: FileSourceRepository;
  ownershipRepo?: Pick<FsFileOwnershipRepository, 'getOwnership' | 'reservePendingOwnership' | 'deletePendingOwnership' | 'upsertOwnership'>;
  createAdapter?: (source: Parameters<typeof createFileSourceAdapter>[0]) => FileSourceAdapter;
}

function mapSourceError(message: string, res: Response): Response {
  const normalized = message.toLowerCase();
  if (message === 'Source not found.') return res.status(404).json({ error: message });
  if (message === 'Source is disabled.') return res.status(403).json({ error: message });
  if (message.includes('read-only') || message.includes('writable')) return res.status(403).json({ error: message });
  if (normalized.includes('outside file ownership scope') || normalized.includes('contributor role required') || normalized.includes('file ownership is required')) return res.status(403).json({ error: message });
  if (normalized.includes('atomic exclusive')) return res.status(503).json({ error: message });
  if (message.includes('required') || message.includes('unsupported') || message.includes('Invalid') || message.includes('already exists')) {
    return res.status(400).json({ error: message });
  }
  return res.status(500).json({ error: message });
}

export function registerDocumentConvertRoutes(router: Router, deps: DocumentConvertRouteDeps = {}): void {
  const sourceRepo = deps.sourceRepo ?? createFileSourceRepository();
  const ownershipRepo = deps.ownershipRepo ?? createFsFileOwnershipRepository();
  const createAdapter = deps.createAdapter ?? createFileSourceAdapter;

  const assertOwnedPath = (binding: RequestOrgBinding, sourceId: string, sourcePath: string, operation: 'read' | 'write', sources = sourceRepo.listSources(true)) => {
    return assertOwnedFileAccess(binding, ownershipRepo, sourceId, sourcePath, operation, sources);
  };

  router.post('/documents/convert', async (req: Request, res: Response) => {
    let sourceId = '';
    let sourcePath = '';
    let releaseMutation: (() => void) | undefined;

    try {
      sourceId = typeof req.body?.sourceId === 'string' ? req.body.sourceId.trim() : '';
      sourcePath = normalizeSourceRelativePath(typeof req.body?.path === 'string' ? req.body.path : '');
      const targetType = parseDocumentConvertTargetType(req.body?.targetType);
      const targetName = typeof req.body?.targetName === 'string' ? req.body.targetName.trim() : undefined;
      const dryRun = req.body?.dryRun === true;

      if (!sourceId) throw new Error('sourceId is required.');
      if (!sourcePath) throw new Error('path is required.');
      if (!targetType) throw new Error('unsupported or missing targetType.');
      const binding = requireRequestOrg(req, res);
      if (!binding) return;
      const configuredSources = sourceRepo.listSources(true);

      const source = sourceRepo.getSource(sourceId);
      assertSourceEnabled(source);
      if (source.type !== 'local') {
        throw new Error('Document conversion v1 supports writable local sources only.');
      }

      releaseMutation = acquireFileMutationGuard('create');
      const sourceOwnership = assertOwnedPath(binding, source.id, sourcePath, dryRun ? 'read' : 'write', configuredSources);

      const adapter = createAdapter(source);
      if (!adapter.capabilities().write) {
        throw new Error('Source is read-only.');
      }

      const file = await adapter.read(sourcePath);
      if (file.isBinary) {
        throw new Error('Binary sources are unsupported for conversion.');
      }

      const converted = buildConvertedDocumentContent({
        sourceId,
        sourcePath,
        sourceContent: file.content,
        targetType,
        targetName,
      });

      if (dryRun) {
        return res.json({
          dryRun: true,
          sourceId,
          sourcePath,
          ...converted,
        });
      }

      // Authorize the target before probing its existence or creating parents.
      // New reserved targets use this creation-specific policy and are reserved
      // below immediately before the broker write.
      const targetAccess = assertOwnedFileCreationAccess(binding, ownershipRepo, source.id, converted.targetPath, configuredSources);
      const reservedTarget = isReservedUploadPath(converted.targetPath) || sourcePathHasReservedContext(source.id, converted.targetPath, configuredSources);

      try {
        await adapter.read(converted.targetPath);
        throw new Error('Converted document already exists.');
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'Converted document already exists.') throw error;
      }

      const folder = converted.targetPath.split('/').slice(0, -1).join('/');
      if (folder) {
        try {
          await adapter.mkdir(folder);
        } catch {
          // mkdir is best-effort when parent already exists
        }
      }

      if (!adapter.writeExclusive) {
        throw new Error('Source does not support atomic exclusive conversion writes.');
      }

      let pendingReservation: FsFileOwnershipRecord | undefined;
      if (reservedTarget) {
        const targetOwnership = ownershipRepo.getOwnership(source.id, converted.targetPath);
        if (targetOwnership) {
          assertOwnedPath(binding, source.id, converted.targetPath, 'write', configuredSources);
        } else {
          pendingReservation = ownershipRepo.reservePendingOwnership({
            sourceId: source.id,
            path: converted.targetPath,
            orgId: sourceOwnership?.org_id ?? binding.orgId,
            teamId: targetAccess?.team_id ?? sourceOwnership?.team_id ?? null,
            ownerPrincipalId: binding.principal.principal_id,
            displayName: converted.targetName,
          });
        }
      }

      try {
        await adapter.writeExclusive(converted.targetPath, converted.content);
      } catch (error) {
        if (pendingReservation && isExclusiveCreateConflict(error)) {
          ownershipRepo.deletePendingOwnership(pendingReservation);
        }
        throw error;
      }
      if (reservedTarget) {
        ownershipRepo.upsertOwnership({
          sourceId: source.id,
          path: converted.targetPath,
          orgId: sourceOwnership?.org_id ?? binding.orgId,
          teamId: targetAccess?.team_id ?? sourceOwnership?.team_id ?? null,
          ownerPrincipalId: binding.principal.principal_id,
          displayName: converted.targetName,
          origin: 'manual',
        });
      }

      return res.status(201).json({
        sourceId,
        sourcePath,
        targetPath: converted.targetPath,
        targetType: converted.targetType,
        targetName: converted.targetName,
        provenance: converted.provenance,
        preview: converted.preview,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (error instanceof FileMutationConflictError) return res.status(409).json({ error: message });
      return mapSourceError(message, res);
    } finally {
      releaseMutation?.();
    }
  });
}
