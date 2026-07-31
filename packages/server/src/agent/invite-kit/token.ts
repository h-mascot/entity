import { createHash, randomBytes } from 'crypto';

/** Mint a raw invite token (show-once). Persist only the hash. */
export function mintInviteToken(bytes = 12): string {
  return randomBytes(bytes).toString('hex');
}

/** SHA-256 hex digest of a raw invite token (matches api-auth bearer hashing style). */
export function hashInviteToken(rawToken: string): string {
  if (typeof rawToken !== 'string' || rawToken.length < 8) {
    throw new Error('Invite token must be a string of length >= 8');
  }
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}
