import { createHash } from 'node:crypto';

const SAFE_SCOPE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MAX_SCOPE_SEGMENT_BYTES = 255;

/**
 * Keep historical upload paths for safe IDs. Other IDs are represented by a
 * bounded, non-decodable segment so raw scope IDs never become path syntax.
 */
export function encodeUploadScopeSegment(scopeId: string): string {
  if (Buffer.byteLength(scopeId, 'utf8') <= MAX_SCOPE_SEGMENT_BYTES && SAFE_SCOPE_SEGMENT.test(scopeId)) {
    return scopeId;
  }
  return `~${createHash('sha256').update(scopeId, 'utf8').digest('hex')}`;
}

export function buildUploadScopeRoot(orgId: string, teamId: string | null): string {
  const orgSegment = encodeUploadScopeSegment(orgId);
  return teamId === null
    ? `uploads/${orgSegment}`
    : `uploads/${orgSegment}/${encodeUploadScopeSegment(teamId)}`;
}
