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
