/**
 * EEPC-A-07 — Public-safe callback error scrubbing (no secrets / private paths).
 */

import type { CallbackValidationIssue } from './types';

const SECRET_VALUE_RE =
  /^(Bearer\s+)?[A-Za-z0-9_\-]{32,}$|api[_-]?key\s*=|token\s*=|sk-[A-Za-z0-9]{10,}/i;

const ABS_PATH_RE =
  /(^|[^\w.-])(\/(?:Users|home|var|tmp|etc|opt|private)\/[^\s"']+|[A-Za-z]:\\[^\s"']+)/g;

const SECRET_INLINE_RE =
  /\b(Bearer\s+[A-Za-z0-9_\-.+/=]{8,}|sk-[A-Za-z0-9]{10,}|(?:api[_-]?key|token|secret|password|authorization|credential)\s*=\s*\S+)/gi;

export function containsPrivatePath(value: string): boolean {
  ABS_PATH_RE.lastIndex = 0;
  return ABS_PATH_RE.test(value);
}

export function containsSecretLikeValue(value: string): boolean {
  return SECRET_VALUE_RE.test(value.trim());
}

export function scrubPublicSafeText(value: string): string {
  return value
    .replace(SECRET_INLINE_RE, '[redacted]')
    .replace(ABS_PATH_RE, '$1[redacted-path]');
}

export function scrubPublicSafeIssue(issue: CallbackValidationIssue): CallbackValidationIssue {
  return {
    path: scrubPublicSafeText(issue.path),
    code: issue.code,
    message: scrubPublicSafeText(issue.message),
  };
}

export function toPublicCallbackErrorBody(input: {
  code: string;
  message: string;
  issues: CallbackValidationIssue[];
}): { error: string; message: string; issues: CallbackValidationIssue[] } {
  return {
    error: input.code,
    message: scrubPublicSafeText(input.message),
    issues: input.issues.map(scrubPublicSafeIssue),
  };
}

/** Walk payload strings and collect private-path issues (public callback surface). */
export function collectPrivatePathLeaks(
  value: unknown,
  trail: string,
  out: CallbackValidationIssue[],
): void {
  if (typeof value === 'string') {
    if (containsPrivatePath(value)) {
      out.push({
        path: trail,
        code: 'private_path_forbidden',
        message: 'Callback payload must not embed private filesystem paths',
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectPrivatePathLeaks(entry, `${trail}[${index}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectPrivatePathLeaks(child, `${trail}.${key}`, out);
    }
  }
}
