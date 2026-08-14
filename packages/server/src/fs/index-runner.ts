import { createFileIndexRepository } from '../../../db/src/file-index';
import { createFileSourceRepository, type FileSourceRecord } from '../../../db/src/file-sources';
import { classifyFile, extractIndexableFileContent } from './classify';
import { createFileSourceAdapter } from './adapters/registry';
import { emitFsAudit } from './security';
import { recordFsOperation } from './metrics';
import { isMissingPathError } from './errors';
import type { FileSourceAdapter, SourceNode, SourcePathMetadata } from './adapters/types';

const MAX_SOURCE_DEPTH = 8;
const MAX_DIRECTORIES_PER_SOURCE = 5000;
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const DEFAULT_EXCLUDES = ['state-snapshots/**'];

const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', '.next', '.cache', 'dist', '__pycache__',
  '.venv', 'venv', '.tox', 'coverage', '.nyc_output', 'build',
  'chromadb', '.openclaw',
  'box', 'tmp', 'secrets', 'orphaned-sessions', 'calls',
]);

const sourceIndexRuns = new Map<string, Promise<void>>();

async function withSourceIndexLock(sourceId: string, task: () => Promise<void>): Promise<void> {
  const previous = sourceIndexRuns.get(sourceId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  sourceIndexRuns.set(sourceId, current);

  try {
    await current;
  } finally {
    if (sourceIndexRuns.get(sourceId) === current) {
      sourceIndexRuns.delete(sourceId);
    }
  }
}

function normalizeDirectoryPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.') {
    return '';
  }

  return trimmed.replace(/\/+$/, '');
}

function readMaxFileBytes(): number {
  const raw = process.env.ENTITY_FS_AUDIT_MAX_FILE_BYTES;
  if (!raw) {
    return DEFAULT_MAX_FILE_BYTES;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_FILE_BYTES;
  }

  return Math.floor(parsed);
}

function readAuditExcludes(): string[] {
  const raw = process.env.ENTITY_FS_AUDIT_EXCLUDES;
  const values = raw === undefined ? DEFAULT_EXCLUDES : raw.split(',');
  return values.map((value) => value.trim()).filter(Boolean);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\/+/, '');
  let regex = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*' && next === '*') {
      regex += '.*';
      i += 1;
      continue;
    }
    if (char === '*') {
      regex += '[^/]*';
      continue;
    }
    regex += escapeRegex(char);
  }
  return new RegExp(`^${regex}$`);
}

interface ExcludeMatcher {
  pattern: string;
  regex: RegExp;
  rootPrefix?: string;
}

function createExcludeMatchers(patterns: string[]): ExcludeMatcher[] {
  return patterns.map((pattern) => {
    const normalized = pattern.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const rootPrefix = normalized.endsWith('/**') ? normalized.slice(0, -3) : undefined;
    return {
      pattern: normalized,
      regex: globToRegex(normalized),
      rootPrefix,
    };
  });
}

function matchesExclude(pathValue: string, matchers: ExcludeMatcher[]): string | undefined {
  const normalized = pathValue.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  for (const matcher of matchers) {
    if (matcher.regex.test(normalized)) {
      return matcher.pattern;
    }
    if (matcher.rootPrefix && (normalized === matcher.rootPrefix || normalized.startsWith(`${matcher.rootPrefix}/`))) {
      return matcher.pattern;
    }
  }
  return undefined;
}

function metadataFromNode(node: SourceNode): SourcePathMetadata {
  return {
    sourceId: node.sourceId,
    path: node.path,
    name: node.name,
    kind: node.isDirectory ? 'directory' : 'file',
    size: node.size,
    updatedAt: node.updatedAt,
    orgId: node.orgId,
    sensitivity: node.sensitivity,
    aclJson: node.aclJson,
    entityVisibilityPolicyJson: node.entityVisibilityPolicyJson,
  };
}

async function classifyCandidate(adapter: FileSourceAdapter, node: SourceNode): Promise<SourcePathMetadata> {
  if (adapter.stat) {
    return adapter.stat(node.path);
  }

  return metadataFromNode(node);
}

type SkipReason = 'directory' | 'oversize' | 'excluded' | 'non-regular';

function metadataSignature(metadata: SourcePathMetadata | undefined): string {
  if (!metadata) {
    return 'no-metadata';
  }

  return [
    metadata.kind,
    metadata.size ?? '',
    metadata.updatedAt ?? '',
  ].join(':');
}

interface IndexRunnerOptions {
  maxConcurrentSources?: number;
  maxFilesPerSource?: number;
  maxFileBytes?: number;
  excludes?: string[];
}

export class FileIndexRunner {
  private readonly sourceRepo = createFileSourceRepository();
  private readonly indexRepo = createFileIndexRepository();
  private readonly maxConcurrentSources: number;
  private readonly maxFilesPerSource: number;
  private readonly maxFileBytes: number;
  private readonly excludeMatchers: ExcludeMatcher[];
  private readonly deterministicSkips = new Map<string, string>();

  constructor(options: IndexRunnerOptions = {}) {
    this.maxConcurrentSources = Math.max(1, options.maxConcurrentSources ?? 2);
    this.maxFilesPerSource = Math.max(10, options.maxFilesPerSource ?? 10000);
    this.maxFileBytes = Math.max(1, options.maxFileBytes ?? readMaxFileBytes());
    this.excludeMatchers = createExcludeMatchers(options.excludes ?? readAuditExcludes());
  }

  async runOnce(): Promise<void> {
    const sources = this.sourceRepo.listSources(false);
    const queue = [...sources];
    const workers: Promise<void>[] = [];

    for (let i = 0; i < this.maxConcurrentSources; i += 1) {
      workers.push(
        (async () => {
          let source: FileSourceRecord | undefined = queue.shift();
          while (source) {
            const currentSource = source;
            await withSourceIndexLock(currentSource.id, () => this.indexSource(currentSource));
            source = queue.shift();
          }
        })()
      );
    }

    await Promise.all(workers);
  }

  async runOnceForSource(sourceId: string): Promise<void> {
    const normalized = sourceId.trim();
    if (!normalized) {
      return;
    }

    const source = this.sourceRepo.getSource(normalized);
    if (!source || !source.enabled) {
      return;
    }

    await withSourceIndexLock(source.id, () => this.indexSource(source));
  }

  private rememberDeterministicSkip(
    sourceId: string,
    pathValue: string,
    reason: SkipReason,
    metadata?: SourcePathMetadata,
    extra?: Record<string, unknown>
  ): boolean {
    const normalizedPath = pathValue.replace(/\\/g, '/').replace(/^\/+/, '');
    const key = `${sourceId}:${normalizedPath}:${reason}`;
    const signature = metadataSignature(metadata);
    if (this.deterministicSkips.get(key) === signature) {
      return false;
    }

    this.deterministicSkips.set(key, signature);
    this.indexRepo.deleteBySourcePathPrefix(sourceId, normalizedPath);
    emitFsAudit('index.path.skipped', {
      sourceId,
      path: normalizedPath,
      reason,
      kind: metadata?.kind,
      size: metadata?.size,
      updatedAt: metadata?.updatedAt,
      ...extra,
    });
    return true;
  }

  private enqueueDirectory(
    queue: Array<{ path: string; depth: number }>,
    queuedDirectories: Set<string>,
    visitedDirectories: Set<string>,
    pathValue: string,
    depth: number
  ): boolean {
    const nextDepth = depth + 1;
    if (nextDepth > MAX_SOURCE_DEPTH) {
      return false;
    }

    const childPath = normalizeDirectoryPath(pathValue);
    if (visitedDirectories.has(childPath) || queuedDirectories.has(childPath)) {
      return true;
    }

    if (visitedDirectories.size + queuedDirectories.size >= MAX_DIRECTORIES_PER_SOURCE) {
      return false;
    }

    queue.push({ path: childPath, depth: nextDepth });
    queuedDirectories.add(childPath);
    return true;
  }

  private async indexSource(source: FileSourceRecord): Promise<void> {
    const startedAt = Date.now();
    const run = this.indexRepo.startSyncRun(source.id);
    let filesScanned = 0;
    let filesIndexed = 0;

    try {
      const adapter = createFileSourceAdapter(source);
      await adapter.validate(source);

      const queue: Array<{ path: string; depth: number }> = [{ path: '', depth: 0 }];
      const queuedDirectories = new Set<string>(['']);
      const visitedDirectories = new Set<string>();
      const visitedFiles = new Set<string>();
      let scanComplete = true;

      while (queue.length > 0) {
        if (filesScanned >= this.maxFilesPerSource) {
          scanComplete = false;
          break;
        }

        if (visitedDirectories.size >= MAX_DIRECTORIES_PER_SOURCE) {
          scanComplete = false;
          break;
        }

        const next = queue.shift();
        if (!next) {
          break;
        }

        const directoryPath = normalizeDirectoryPath(next.path);
        queuedDirectories.delete(directoryPath);
        if (visitedDirectories.has(directoryPath)) {
          continue;
        }

        visitedDirectories.add(directoryPath);

        let nodes: SourceNode[] = [];
        try {
          nodes = await adapter.list(directoryPath);
        } catch (err) {
          if (isMissingPathError(err)) {
            if (directoryPath) {
              this.indexRepo.deleteBySourcePathPrefix(source.id, directoryPath);
            }
            continue;
          }
          const message = err instanceof Error ? err.message : 'Unknown list error';
          emitFsAudit('index.dir.error', { sourceId: source.id, path: directoryPath, error: message });
          if (!directoryPath) {
            throw err;
          }
          scanComplete = false;
          continue;
        }

        for (const node of nodes) {
          if (filesScanned >= this.maxFilesPerSource) {
            scanComplete = false;
            break;
          }

          const excludedBy = matchesExclude(node.path, this.excludeMatchers);
          if (excludedBy) {
            this.rememberDeterministicSkip(source.id, node.path, 'excluded', metadataFromNode(node), { pattern: excludedBy });
            continue;
          }

          if (visitedFiles.has(node.path)) {
            continue;
          }

          let metadata: SourcePathMetadata;
          try {
            metadata = await classifyCandidate(adapter, node);
          } catch (err) {
            if (isMissingPathError(err)) {
              this.indexRepo.deleteBySourcePathPrefix(source.id, node.path);
              continue;
            }
            const message = err instanceof Error ? err.message : 'Unknown stat error';
            emitFsAudit('index.path.error', { sourceId: source.id, path: node.path, error: message });
            scanComplete = false;
            continue;
          }

          if (metadata.kind === 'directory') {
            const dirName = metadata.name.toLowerCase();
            if (IGNORED_DIRECTORIES.has(dirName)) {
              this.rememberDeterministicSkip(source.id, metadata.path, 'directory', metadata, { ignored: true });
              continue;
            }

            if (!this.enqueueDirectory(queue, queuedDirectories, visitedDirectories, metadata.path, next.depth)) {
              scanComplete = false;
            }
            continue;
          }

          if (metadata.kind !== 'file') {
            this.rememberDeterministicSkip(source.id, metadata.path, 'non-regular', metadata);
            continue;
          }

          const fileSize = metadata.size ?? node.size;
          if (typeof fileSize === 'number' && fileSize > this.maxFileBytes) {
            this.rememberDeterministicSkip(source.id, metadata.path, 'oversize', { ...metadata, size: fileSize }, {
              maxFileBytes: this.maxFileBytes,
            });
            continue;
          }

          const filePath = metadata.path || node.path;
          if (visitedFiles.has(filePath)) {
            continue;
          }

          visitedFiles.add(filePath);
          filesScanned += 1;

          try {
            const file = await adapter.read(filePath);
            const classification = classifyFile(filePath, file.content);
            const indexable = extractIndexableFileContent(filePath, file.content);

            this.indexRepo.upsertRecord({
              id: `${source.id}:${filePath}`,
              source_id: source.id,
              path: filePath,
              title: classification.title,
              type: classification.type,
              agent: classification.agent,
              origin: classification.origin,
              is_recurring: classification.isRecurring,
              recurring_pattern: classification.recurringPattern ?? null,
              tags: JSON.stringify(classification.tags),
              updated_at: file.updatedAt ?? metadata.updatedAt ?? null,
              indexed_at: new Date().toISOString(),
              preview: indexable.text.slice(0, 280),
              content_hash: classification.contentHash,
              org_id: metadata.orgId ?? null,
              sensitivity: metadata.sensitivity ?? null,
              acl_json: metadata.aclJson ?? null,
              entity_visibility_policy_json: metadata.entityVisibilityPolicyJson ?? null,
            });

            filesIndexed += 1;
          } catch (err) {
            if (isMissingPathError(err)) {
              this.indexRepo.deleteBySourcePathPrefix(source.id, filePath);
              continue;
            }
            const message = err instanceof Error ? err.message : 'Unknown read error';
            emitFsAudit('index.file.error', { sourceId: source.id, path: filePath, error: message });
            scanComplete = false;
          }
        }
      }

      if (scanComplete) {
        this.indexRepo.reconcileSourcePaths(source.id, Array.from(visitedFiles));
      }

      this.indexRepo.finishSyncRun(run.id, 'ok', {
        filesScanned,
        filesIndexed,
      });
      recordFsOperation({
        operation: 'index.source',
        sourceId: source.id,
        durationMs: Date.now() - startedAt,
        success: true,
      });
      this.sourceRepo.updateSource(source.id, {
        health: filesIndexed > 0 || filesScanned === 0 ? 'ok' : 'degraded',
        last_synced_at: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown index error';
      this.indexRepo.finishSyncRun(run.id, 'error', {
        error: message,
        filesScanned,
        filesIndexed,
      });
      this.sourceRepo.updateSource(source.id, {
        health: 'error',
        last_synced_at: new Date().toISOString(),
      });
      recordFsOperation({
        operation: 'index.source',
        sourceId: source.id,
        durationMs: Date.now() - startedAt,
        success: false,
        error: message,
      });
      emitFsAudit('index.source.error', { sourceId: source.id, error: message });
    }
  }
}
