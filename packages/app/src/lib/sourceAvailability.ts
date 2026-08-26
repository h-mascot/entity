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
 * Truthful build availability for a configured source. The server-reported
 * `implemented` flag wins when present; otherwise fall back to the build's
 * known connector list.
 */
export function sourceIsAvailableInBuild(source: Pick<FileSource, 'type' | 'implemented'>): boolean {
  if (typeof source.implemented === 'boolean') {
    return source.implemented;
  }
  return sourceTypeIsAvailableInBuild(source.type);
}
