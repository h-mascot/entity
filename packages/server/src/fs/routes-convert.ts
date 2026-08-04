import type { Request, Response, Router } from 'express';
import { createFileSourceRepository, type FileSourceRepository } from '../../../db/src/file-sources';
import { createFileSourceAdapter } from './adapters/registry';
import { assertSourceEnabled, normalizeSourceRelativePath } from './security';
import {
  buildConvertedDocumentContent,
  parseDocumentConvertTargetType,
} from './document-convert';

export interface DocumentConvertRouteDeps {
  sourceRepo?: FileSourceRepository;
}

function mapSourceError(message: string, res: Response): Response {
  if (message === 'Source not found.') return res.status(404).json({ error: message });
  if (message === 'Source is disabled.') return res.status(403).json({ error: message });
  if (message.includes('read-only') || message.includes('writable')) return res.status(403).json({ error: message });
  if (message.includes('required') || message.includes('unsupported') || message.includes('Invalid') || message.includes('already exists')) {
    return res.status(400).json({ error: message });
  }
  return res.status(500).json({ error: message });
}

export function registerDocumentConvertRoutes(router: Router, deps: DocumentConvertRouteDeps = {}): void {
  const sourceRepo = deps.sourceRepo ?? createFileSourceRepository();

  router.post('/documents/convert', async (req: Request, res: Response) => {
    let sourceId = '';
    let sourcePath = '';

    try {
      sourceId = typeof req.body?.sourceId === 'string' ? req.body.sourceId.trim() : '';
      sourcePath = normalizeSourceRelativePath(typeof req.body?.path === 'string' ? req.body.path : '');
      const targetType = parseDocumentConvertTargetType(req.body?.targetType);
      const targetName = typeof req.body?.targetName === 'string' ? req.body.targetName.trim() : undefined;
      const dryRun = req.body?.dryRun === true;

      if (!sourceId) throw new Error('sourceId is required.');
      if (!sourcePath) throw new Error('path is required.');
      if (!targetType) throw new Error('unsupported or missing targetType.');

      const source = sourceRepo.getSource(sourceId);
      assertSourceEnabled(source);
      if (source.type !== 'local') {
        throw new Error('Document conversion v1 supports writable local sources only.');
      }

      const adapter = createFileSourceAdapter(source);
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

      if (adapter.writeExclusive) {
        await adapter.writeExclusive(converted.targetPath, converted.content);
      } else {
        await adapter.write(converted.targetPath, converted.content);
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
      return mapSourceError(message, res);
    }
  });
}
