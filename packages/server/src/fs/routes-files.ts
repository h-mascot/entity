import type { Request, Response, Router } from 'express';
import {
  createFileSourceRepository,
  type FileSourceRecord,
  type FileSourceRepository,
} from '../../../db/src/file-sources';
import { isTextualContentType } from '../file-types';
import { createFileSourceAdapter, isFileSourceTypeImplemented } from './adapters/registry';
import { assertSourceEnabled, emitFsAudit, normalizeSourceRelativePath } from './security';
import { recordFsOperation } from './metrics';
import { ConnectorNotImplementedError, isMissingPathError, SourceTextUnsupportedError } from './errors';
import { SourceReadLimitError } from './adapters/bounded-read';

export interface FileRouteDeps {
  sourceRepo?: FileSourceRepository;
}

function parseSourceId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('sourceId is required.');
  }

  return value.trim();
}

function assertConnectorImplemented(source: FileSourceRecord): void {
  if (!isFileSourceTypeImplemented(source.type)) {
    // Typed refusal for placeholder connectors: never a generic 500, and it
    // takes priority over read-only capability gates so clients see the real
    // reason (no connector in this build) rather than a misleading 403.
    throw new ConnectorNotImplementedError(source.type);
  }
}

function mapSourceError(err: unknown, res: Response): Response {
  if (err instanceof ConnectorNotImplementedError) {
    return res.status(501).json({
      error: err.message,
      code: err.code,
      connectorType: err.connectorType,
    });
  }

  const message = err instanceof Error ? err.message : 'Unknown error';

  if (message === 'Source not found.') {
    return res.status(404).json({ error: message });
  }

  if (isMissingPathError(message)) {
    return res.status(404).json({ error: message });
  }

  if (message === 'Source is disabled.') {
    return res.status(403).json({ error: message });
  }

  if (message.startsWith('Source file exceeds the configured read limit of ')) {
    return res.status(413).json({ error: message });
  }

  if (message.includes('read-only')) {
    return res.status(403).json({ error: message });
  }

  if (message.includes('already exists')) {
    return res.status(409).json({ error: message });
  }

  if (
    message.includes('required') ||
    message.includes('Path') ||
    message.includes('Invalid') ||
    message.includes('allowlisted') ||
    message.includes('traversal') ||
    message.includes('outside source root')
  ) {
    return res.status(400).json({ error: message });
  }

  return res.status(500).json({ error: message });
}

function parseContent(value: unknown): string {
  if (typeof value === 'undefined' || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error('content must be a string.');
  }
  return value;
}

function parseWriteMode(value: unknown): 'create' | 'overwrite' {
  if (typeof value !== 'string') {
    return 'create';
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'overwrite' ? 'overwrite' : 'create';
}

export function registerFileRoutes(router: Router, deps: FileRouteDeps = {}): void {
  const sourceRepo = deps.sourceRepo ?? createFileSourceRepository();

  router.get('/tree', async (req: Request, res: Response) => {
    let sourceId = '';
    let normalizedPath = '';

    try {
      sourceId = parseSourceId(req.query.sourceId);
      normalizedPath = normalizeSourceRelativePath(typeof req.query.path === 'string' ? req.query.path : '');
      const source = sourceRepo.getSource(sourceId);
      assertSourceEnabled(source);
      assertConnectorImplemented(source);

      const adapter = createFileSourceAdapter(source);
      const startedAt = Date.now();
      const nodes = (await adapter.list(normalizedPath)).filter((node) => node.kind !== 'other');
      const durationMs = Date.now() - startedAt;

      emitFsAudit('fs.tree', {
        sourceId,
        path: normalizedPath,
        nodeCount: nodes.length,
        durationMs,
      });
      recordFsOperation({ operation: 'fs.tree', sourceId, durationMs, success: true });
      sourceRepo.updateSource(source.id, {
        health: 'ok',
        last_synced_at: new Date().toISOString(),
      });

      return res.json({
        sourceId,
        path: normalizedPath,
        capabilities: adapter.capabilities(),
        nodes,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      emitFsAudit('fs.tree.error', { sourceId, path: normalizedPath, error: message });
      recordFsOperation({ operation: 'fs.tree', sourceId, success: false, error: message });
      if (sourceId) {
        sourceRepo.updateSource(sourceId, {
          health: 'degraded',
          last_synced_at: new Date().toISOString(),
        });
      }
      return mapSourceError(err, res);
    }
  });

  router.get('/file', async (req: Request, res: Response) => {
    let sourceId = '';
    let normalizedPath = '';

    try {
      sourceId = parseSourceId(req.query.sourceId);
      normalizedPath = normalizeSourceRelativePath(typeof req.query.path === 'string' ? req.query.path : '');
      if (!normalizedPath) {
        throw new Error('path is required.');
      }

      const source = sourceRepo.getSource(sourceId);
      assertSourceEnabled(source);
      assertConnectorImplemented(source);

      const adapter = createFileSourceAdapter(source);
      const startedAt = Date.now();
      let file: { content: string; contentType: string; updatedAt?: string; size?: number; isBinary?: boolean };

      try {
        file = await adapter.read(normalizedPath);
      } catch (readErr) {
        if (readErr instanceof SourceReadLimitError) throw readErr;
        if (readErr instanceof SourceTextUnsupportedError && typeof (adapter as { readRaw?: unknown }).readRaw === 'function') {
          const raw = await adapter.readRaw!(normalizedPath);
          file = {
            content: '',
            contentType: raw.contentType,
            updatedAt: raw.updatedAt,
            size: raw.size,
            isBinary: true,
          };
        } else {
          throw readErr;
        }
      }
      const durationMs = Date.now() - startedAt;
      const fileSize = file.size ?? Buffer.byteLength(file.content, 'utf-8');
      const isBinary = typeof file.isBinary === 'boolean' ? file.isBinary : !isTextualContentType(file.contentType);

      emitFsAudit('fs.file', {
        sourceId,
        path: normalizedPath,
        contentType: file.contentType,
        size: fileSize,
        durationMs,
      });
      recordFsOperation({ operation: 'fs.file', sourceId, durationMs, success: true });
      sourceRepo.updateSource(source.id, {
        health: 'ok',
        last_synced_at: new Date().toISOString(),
      });

      return res.json({
        sourceId,
        path: normalizedPath,
        content: file.content,
        contentType: file.contentType,
        size: fileSize,
        isBinary,
        updatedAt: file.updatedAt ?? null,
        readOnly: !adapter.capabilities().write,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      emitFsAudit('fs.file.error', { sourceId, path: normalizedPath, error: message });
      recordFsOperation({ operation: 'fs.file', sourceId, success: false, error: message });
      if (sourceId) {
        sourceRepo.updateSource(sourceId, {
          health: 'error',
          last_synced_at: new Date().toISOString(),
        });
      }
      return mapSourceError(err, res);
    }
  });

  router.post('/file', async (req: Request, res: Response) => {
    let sourceId = '';
    let normalizedPath = '';

    try {
      sourceId = parseSourceId(req.body?.sourceId);
      normalizedPath = normalizeSourceRelativePath(typeof req.body?.path === 'string' ? req.body.path : '');
      if (!normalizedPath) {
        throw new Error('path is required.');
      }

      const mode = parseWriteMode(req.body?.mode);
      const content = parseContent(req.body?.content);

      const source = sourceRepo.getSource(sourceId);
      assertSourceEnabled(source);
      assertConnectorImplemented(source);

      const adapter = createFileSourceAdapter(source);
      const capabilities = adapter.capabilities();
      if (!capabilities.write) {
        throw new Error('Source is read-only.');
      }

      if (mode === 'create') {
        try {
          await adapter.read(normalizedPath);
          throw new Error('File already exists.');
        } catch (err) {
          const message = err instanceof Error ? err.message : '';
          if (message === 'File already exists.') {
            throw err;
          }
          // Anything else means "doesn't exist" or "not readable", so proceed with create.
        }
      }

      const startedAt = Date.now();
      const writeResult = await adapter.write(normalizedPath, content);
      const durationMs = Date.now() - startedAt;

      emitFsAudit('fs.file.write', {
        sourceId,
        path: normalizedPath,
        size: content.length,
        durationMs,
      });
      recordFsOperation({ operation: 'fs.file.write', sourceId, durationMs, success: true });
      sourceRepo.updateSource(source.id, {
        health: 'ok',
        last_synced_at: new Date().toISOString(),
      });

      return res.json({
        sourceId,
        path: normalizedPath,
        updatedAt: writeResult.updatedAt ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      emitFsAudit('fs.file.write.error', { sourceId, path: normalizedPath, error: message });
      recordFsOperation({ operation: 'fs.file.write', sourceId, success: false, error: message });
      if (sourceId) {
        sourceRepo.updateSource(sourceId, {
          health: 'error',
          last_synced_at: new Date().toISOString(),
        });
      }
      return mapSourceError(err, res);
    }
  });

  router.post('/folder', async (req: Request, res: Response) => {
    let sourceId = '';
    let normalizedPath = '';

    try {
      sourceId = parseSourceId(req.body?.sourceId);
      normalizedPath = normalizeSourceRelativePath(typeof req.body?.path === 'string' ? req.body.path : '');
      if (!normalizedPath) {
        throw new Error('path is required.');
      }

      const source = sourceRepo.getSource(sourceId);
      assertSourceEnabled(source);
      assertConnectorImplemented(source);

      const adapter = createFileSourceAdapter(source);
      const capabilities = adapter.capabilities();
      if (!capabilities.write) {
        throw new Error('Source is read-only.');
      }

      const startedAt = Date.now();
      await adapter.mkdir(normalizedPath);
      const durationMs = Date.now() - startedAt;

      emitFsAudit('fs.folder.mkdir', {
        sourceId,
        path: normalizedPath,
        durationMs,
      });
      recordFsOperation({ operation: 'fs.folder.mkdir', sourceId, durationMs, success: true });
      sourceRepo.updateSource(source.id, {
        health: 'ok',
        last_synced_at: new Date().toISOString(),
      });

      return res.json({
        sourceId,
        path: normalizedPath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      emitFsAudit('fs.folder.mkdir.error', { sourceId, path: normalizedPath, error: message });
      recordFsOperation({ operation: 'fs.folder.mkdir', sourceId, success: false, error: message });
      if (sourceId) {
        sourceRepo.updateSource(sourceId, {
          health: 'error',
          last_synced_at: new Date().toISOString(),
        });
      }
      return mapSourceError(err, res);
    }
  });
}
