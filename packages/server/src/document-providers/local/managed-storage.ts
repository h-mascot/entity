import { createFileSourceAdapter } from '../../fs/adapters/registry';
import type { SourcePathMetadata } from '../../fs/adapters/types';
import { normalizeSourceRelativePath } from '../../fs/security';
import {
  createFileSourceRepository,
  type FileSourceRecord,
  type FileSourceRepository,
} from '../../../../db/src/file-sources';

export type ManagedLocalDocumentStatus = 'ready' | 'unavailable';

export interface ManagedLocalFileReference {
  sourceId: string;
  relativePath: string;
}

export interface ManagedLocalDocument {
  reference: string;
  sourceId: string;
  relativePath: string;
  status: ManagedLocalDocumentStatus;
  revision: string | null;
  unavailableReason?: 'file_unavailable' | 'source_unavailable';
}

export interface RegisterManagedLocalDocumentInput {
  sourceId: string;
  relativePath: string;
}

export class ManagedStorageReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagedStorageReferenceError';
  }
}

const REFERENCE_PREFIX = 'file-source:v1.';

/**
 * An opaque, deterministic reference to a File Source entry. The filesystem path
 * is deliberately absent: callers can only name a source and a source-relative
 * path, both resolved by the server-owned File Source adapter.
 */
export function createManagedLocalFileReference(input: ManagedLocalFileReference): string {
  const sourceId = input.sourceId.trim();
  const relativePath = normalizeSourceRelativePath(input.relativePath);
  if (!sourceId || !relativePath) {
    throw new ManagedStorageReferenceError('A managed local source and file reference are required.');
  }

  return `${REFERENCE_PREFIX}${Buffer.from(JSON.stringify({ sourceId, relativePath }), 'utf8').toString('base64url')}`;
}

export function parseManagedLocalFileReference(reference: string): ManagedLocalFileReference {
  if (typeof reference !== 'string' || !reference.startsWith(REFERENCE_PREFIX)) {
    throw new ManagedStorageReferenceError('Invalid managed local file reference.');
  }

  try {
    const encoded = reference.slice(REFERENCE_PREFIX.length);
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<ManagedLocalFileReference>;
    const sourceId = typeof parsed.sourceId === 'string' ? parsed.sourceId.trim() : '';
    const relativePath = typeof parsed.relativePath === 'string'
      ? normalizeSourceRelativePath(parsed.relativePath)
      : '';
    if (!sourceId || !relativePath) throw new Error('missing reference fields');
    return { sourceId, relativePath };
  } catch {
    throw new ManagedStorageReferenceError('Invalid managed local file reference.');
  }
}

function revisionFor(metadata: SourcePathMetadata): string {
  return `${metadata.updatedAt ?? 'unknown'}:${metadata.size ?? 'unknown'}`;
}

function sourceFor(repository: FileSourceRepository, sourceId: string): FileSourceRecord {
  const source = repository.getSource(sourceId);
  if (!source || source.type !== 'local' || !source.enabled) {
    throw new ManagedStorageReferenceError('Managed local file source is unavailable.');
  }
  return source;
}

function unavailable(
  reference: string,
  parsed: ManagedLocalFileReference,
  reason: ManagedLocalDocument['unavailableReason'] = 'file_unavailable',
): ManagedLocalDocument {
  return {
    reference,
    sourceId: parsed.sourceId,
    relativePath: parsed.relativePath,
    status: 'unavailable',
    revision: null,
    unavailableReason: reason,
  };
}

export class ManagedLocalStorage {
  private readonly repository: FileSourceRepository;

  constructor(repository: FileSourceRepository = createFileSourceRepository()) {
    this.repository = repository;
  }

  async register(input: RegisterManagedLocalDocumentInput): Promise<ManagedLocalDocument> {
    const reference = createManagedLocalFileReference(input);
    return this.refresh(reference);
  }

  /** Re-resolves the File Source on every call, making restart and external moves explicit. */
  async refresh(reference: string): Promise<ManagedLocalDocument> {
    const parsed = parseManagedLocalFileReference(reference);
    let source: FileSourceRecord;
    try {
      source = sourceFor(this.repository, parsed.sourceId);
    } catch {
      return unavailable(reference, parsed, 'source_unavailable');
    }
    const adapter = createFileSourceAdapter(source);

    try {
      const metadata = await adapter.stat?.(parsed.relativePath);
      if (!metadata || metadata.kind !== 'file') return unavailable(reference, parsed);
      return {
        reference,
        sourceId: parsed.sourceId,
        relativePath: parsed.relativePath,
        status: 'ready',
        revision: revisionFor(metadata),
      };
    } catch {
      // Do not expose host paths or filesystem errors to document callers.
      return unavailable(reference, parsed);
    }
  }
}
