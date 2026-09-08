import type { FileSource } from '../types/filesystem.ts';

export const SOURCE_UNAVAILABLE_NOTICE = 'Not available in this build';

// Mirror of the server adapter registry's implemented connector types. Used
// only as a fallback when the server does not report `implemented` per source.
const AVAILABLE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'local',
  'docsify',
  'http-markdown',
]);

export function sourceTypeIsAvailableInBuild(type: FileSource['type']): boolean {
  return AVAILABLE_SOURCE_TYPES.has(type);
}

/**
 * Truthful build availability for a configured source. Fail closed: the
 * connector type must be implemented in this local build, and the
 * server-reported `implemented` flag can only veto (`false`), never
 * positively enable a type this build cannot serve.
 */
export function sourceIsAvailableInBuild(source: Pick<FileSource, 'type' | 'implemented'>): boolean {
  return sourceTypeIsAvailableInBuild(source.type) && source.implemented !== false;
}

/** Uploads are currently supported only by writable local broker adapters. */
export function sourceCanUpload(source: Pick<FileSource, 'type' | 'implemented' | 'enabled' | 'capabilities'>): boolean {
  if (!source.enabled || source.type !== 'local' || !sourceIsAvailableInBuild(source)) return false;
  try {
    const capabilities = JSON.parse(source.capabilities) as unknown;
    if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return false;
    const metadata = capabilities as { write?: unknown; readOnly?: unknown };
    // Local source metadata historically exposed only readOnly, and the
    // auto-created workspace source persists the default `{}` payload. Treat
    // an empty capability object as the adapter default; explicit read-only or
    // write:false metadata still vetoes uploads, and other malformed/unknown
    // metadata remains fail-closed.
    if (metadata.readOnly === true || metadata.write === false) return false;
    if (metadata.readOnly === false || metadata.write === true) return true;
    return Object.keys(capabilities).length === 0;
  } catch {
    return false;
  }
}
