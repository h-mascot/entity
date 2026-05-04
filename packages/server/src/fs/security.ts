import path from 'path';
import type { FileSourceRecord } from '../../../db/src/file-sources';

const SENSITIVE_KEYS = ['authRef', 'auth_ref', 'token', 'password', 'secret', 'authorization'];

export function normalizeSourceRelativePath(input: string | undefined | null): string {
  const raw = (input ?? '').trim();
  if (!raw || raw === '.') {
    return '';
  }

  if (raw.includes('\0')) {
    throw new Error('Invalid path.');
  }

  const normalized = path.posix.normalize(raw.replace(/\\/g, '/')).replace(/^\/+/, '');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Path traversal is not allowed.');
  }

  return normalized;
}

export function resolveLocalPath(basePath: string, relativePath: string): string {
  const normalizedRelative = normalizeSourceRelativePath(relativePath);
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(resolvedBase, normalizedRelative || '.');
  const relative = path.relative(resolvedBase, resolvedTarget);

  if (relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Access outside source root is not allowed.');
  }

  return resolvedTarget;
}

function readAllowedHosts(): string[] {
  const raw = process.env.ENTITY_FS_ALLOWED_HOSTS;
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function assertAllowedRemoteUrl(rawUrl: string): void {
  const allowedHosts = readAllowedHosts();
  const parsed = new URL(rawUrl);

  if (allowedHosts.length === 0) {
    return;
  }

  const host = parsed.hostname.toLowerCase();
  const allowed = allowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
  if (!allowed) {
    throw new Error(`Remote host is not allowlisted: ${host}`);
  }
}

export function redactSensitive<T extends Record<string, unknown>>(payload: T): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const isSensitive = SENSITIVE_KEYS.some((token) => key.toLowerCase().includes(token.toLowerCase()));
    redacted[key] = isSensitive ? '[REDACTED]' : value;
  }
  return redacted;
}

export function emitFsAudit(event: string, payload: Record<string, unknown>): void {
  const safePayload = redactSensitive(payload);
  // Keep logs structured and searchable.
  console.info(`[FS AUDIT] ${event}`, safePayload);
}

export function assertSourceEnabled(source: FileSourceRecord | undefined): asserts source is FileSourceRecord {
  if (!source) {
    throw new Error('Source not found.');
  }

  if (!source.enabled) {
    throw new Error('Source is disabled.');
  }
}

