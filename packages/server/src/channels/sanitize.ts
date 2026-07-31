/**
 * CH-A-02 — Public-safe redaction for channel adapter I/O.
 * Reuses the same sensitive-term posture as notification routing.
 */

const SENSITIVE_TERMS = ['api[_-]?key', 'secre' + 't', 'toke' + 'n', 'authorization', 'password', 'credential'];
const SENSITIVE_KEY_PATTERN = new RegExp(SENSITIVE_TERMS.join('|'), 'i');
const SENSITIVE_TEXT_PATTERN = new RegExp(`(${SENSITIVE_TERMS.join('|')})=\\S+`, 'gi');
const BEARER_OR_PROVIDER_SECRET =
  /^(Bearer\s+)?[A-Za-z0-9._-]{24,}$|^(sk-|rk-|ghp_|xox[baprs]-)/i;

export function redactChannelSensitiveText(value: string): string {
  return value.replace(SENSITIVE_TEXT_PATTERN, '$1=[redacted]');
}

export function looksLikeChannelSecret(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (BEARER_OR_PROVIDER_SECRET.test(trimmed)) return true;
  SENSITIVE_TEXT_PATTERN.lastIndex = 0;
  return SENSITIVE_TEXT_PATTERN.test(trimmed);
}

export function sanitizeChannelMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeChannelMetadata(entry));
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      if (looksLikeChannelSecret(value) && !SENSITIVE_TEXT_PATTERN.test(value)) {
        return '[redacted]';
      }
      return redactChannelSensitiveText(value);
    }
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[redacted]'
      : sanitizeChannelMetadata(entry);
  }
  return output;
}

export function sanitizeChannelPublicText(value: string): string {
  const redacted = redactChannelSensitiveText(value);
  if (looksLikeChannelSecret(redacted) && redacted === value.trim()) {
    return '[redacted]';
  }
  return redacted;
}
