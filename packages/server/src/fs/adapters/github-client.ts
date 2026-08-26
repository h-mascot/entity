/**
 * Injectable GitHub connector client contract (GQR-005).
 *
 * The production adapter talks to GitHub exclusively through this interface,
 * so deterministic fake clients can prove tree/read behavior, pagination,
 * bearer redaction, typed auth/rate/5xx handling, and cache policy without
 * any live network, credential, or secret.
 *
 * No fetch-based implementation ships in this build: wiring a live client is
 * blocked on source authority (see docs/plans/ACTIVE_PLAN.md, GQR-005).
 * `githubErrorFromStatus` is the single status -> typed-error mapping every
 * future client implementation must use.
 */

export interface GitHubTreeEntry {
  /** Repository-relative path using '/' separators, no leading slash. */
  path: string;
  type: 'blob' | 'tree';
  /** Blob size in bytes; absent for tree entries. */
  size?: number;
  sha?: string;
}

export interface GitHubTreePage {
  entries: GitHubTreeEntry[];
  /** Cursor for the next page; null when this is the terminal page. */
  nextCursor: string | null;
}

export interface GitHubBlobResult {
  content: string;
  size: number;
  sha?: string;
}

export interface GitHubClient {
  /** Lists repository tree entries, one page at a time, following cursors. */
  listTree(options: {
    owner: string;
    repo: string;
    ref: string;
    cursor?: string;
  }): Promise<GitHubTreePage>;
  /** Fetches a single blob's content at a path. */
  getBlob(options: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  }): Promise<GitHubBlobResult>;
}

export abstract class GitHubClientError extends Error {
  abstract readonly code: string;
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GitHubClientError';
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export class GitHubAuthError extends GitHubClientError {
  readonly code = 'GITHUB_AUTH';

  constructor(message = 'GitHub rejected the request credentials.', status: number = 401) {
    super(message, status);
    this.name = 'GitHubAuthError';
  }
}

export class GitHubRateLimitError extends GitHubClientError {
  readonly code = 'GITHUB_RATE_LIMIT';
  readonly retryAfterSeconds?: number;
  readonly resetAtEpochSeconds?: number;

  constructor(options: { status?: number; retryAfterSeconds?: number; resetAtEpochSeconds?: number; message?: string } = {}) {
    super(options.message ?? 'GitHub rate limit exceeded.', options.status ?? 403);
    this.name = 'GitHubRateLimitError';
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
    if (options.resetAtEpochSeconds !== undefined) {
      this.resetAtEpochSeconds = options.resetAtEpochSeconds;
    }
  }
}

export class GitHubServerError extends GitHubClientError {
  readonly code = 'GITHUB_SERVER_ERROR';

  constructor(status: number, message?: string) {
    super(message ?? `GitHub upstream server error (${status}).`, status);
    this.name = 'GitHubServerError';
  }
}

export class GitHubNotFoundError extends GitHubClientError {
  readonly code = 'GITHUB_NOT_FOUND';

  constructor(message = 'GitHub resource not found.', status: number = 404) {
    super(message, status);
    this.name = 'GitHubNotFoundError';
  }
}

export class GitHubClientRequestError extends GitHubClientError {
  readonly code = 'GITHUB_REQUEST_ERROR';

  constructor(status: number, message?: string) {
    super(message ?? `GitHub request failed (${status}).`, status);
    this.name = 'GitHubClientRequestError';
  }
}

/** Thrown by the adapter when a tree listing exceeds the page guard. */
export class GitHubPaginationLimitError extends GitHubClientError {
  readonly code = 'GITHUB_PAGINATION_LIMIT';

  constructor(maxPages: number) {
    super(`GitHub tree pagination exceeded ${maxPages} pages; aborting to avoid an unbounded walk.`);
    this.name = 'GitHubPaginationLimitError';
  }
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
  const value = headers[name];
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  return value.trim();
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Canonical HTTP status -> typed error mapping for GitHub clients.
 * 401/403 (without exhausted quota) -> auth; 403/429 with exhausted quota or
 * retry-after -> rate limit; 5xx -> server error; 404 -> not found.
 */
export function githubErrorFromStatus(
  status: number,
  headers: Record<string, string>,
  message?: string,
): GitHubClientError {
  if (status === 404) {
    return new GitHubNotFoundError(message);
  }
  if (status === 429 || (status === 403 && readHeader(headers, 'x-ratelimit-remaining') === '0')) {
    return new GitHubRateLimitError({
      status,
      retryAfterSeconds: parsePositiveInt(readHeader(headers, 'retry-after')),
      resetAtEpochSeconds: parsePositiveInt(readHeader(headers, 'x-ratelimit-reset')),
      message,
    });
  }
  if (status === 401 || status === 403) {
    return new GitHubAuthError(message, status);
  }
  if (status >= 500) {
    return new GitHubServerError(status, message);
  }
  return new GitHubClientRequestError(status, message);
}

/**
 * Defense-in-depth bearer redaction: replaces every occurrence of the token
 * in arbitrary text (error messages, logs) with a redaction marker. Never
 * throws; an absent or empty token leaves the text untouched.
 */
export function redactBearerText(text: string, token: string | undefined | null): string {
  if (!token || token.length === 0 || !text.includes(token)) {
    return text;
  }
  return text.split(token).join('[REDACTED]');
}
