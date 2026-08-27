/**
 * Injectable S3 connector client contract (GQR-005).
 *
 * The production adapter talks to object storage exclusively through this
 * interface, so deterministic fake clients can prove URI parsing,
 * ListObjectsV2 pagination, bounded GetObject, traversal rejection, ETag and
 * version normalization, and typed auth/not-found/throttle behavior without
 * any live network, credential, or secret.
 *
 * No fetch/AWS-SDK client ships in this build: wiring a live client is
 * blocked on source authority (see docs/plans/ACTIVE_PLAN.md, GQR-005).
 */

export interface S3ObjectSummary {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
  versionId?: string;
}

export interface S3ListPage {
  objects: S3ObjectSummary[];
  commonPrefixes: string[];
  /** Next ListObjectsV2 continuation token; null on the terminal page. */
  nextContinuationToken: string | null;
}

export interface S3Client {
  /** ListObjectsV2: one page of keys/common prefixes under a prefix. */
  listObjectsV2(options: {
    bucket: string;
    prefix: string;
    continuationToken?: string;
    maxKeys?: number;
    delimiter?: string;
  }): Promise<S3ListPage>;
  /** GetObject: returns a fetch Response so bounded reads stay reusable. */
  getObject(options: { bucket: string; key: string }): Promise<Response>;
}

export abstract class S3ClientError extends Error {
  abstract readonly code: string;
  readonly status?: number;
  /** S3 XML <Code> value (NoSuchKey, AccessDenied, SlowDown, ...). */
  readonly errorCode?: string;

  constructor(message: string, options: { status?: number; errorCode?: string } = {}) {
    super(message);
    this.name = 'S3ClientError';
    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.errorCode !== undefined) {
      this.errorCode = options.errorCode;
    }
  }
}

export class S3AuthError extends S3ClientError {
  readonly code = 'S3_AUTH';

  constructor(message = 'S3 rejected the request credentials.', options: { status?: number; errorCode?: string } = {}) {
    super(message, { status: options.status ?? 403, errorCode: options.errorCode });
    this.name = 'S3AuthError';
  }
}

export class S3NotFoundError extends S3ClientError {
  readonly code = 'S3_NOT_FOUND';

  constructor(message = 'S3 object not found.', options: { status?: number; errorCode?: string } = {}) {
    super(message, { status: options.status ?? 404, errorCode: options.errorCode });
    this.name = 'S3NotFoundError';
  }
}

export class S3ThrottleError extends S3ClientError {
  readonly code = 'S3_THROTTLE';
  readonly retryAfterSeconds?: number;

  constructor(
    message = 'S3 throttled the request.',
    options: { status?: number; errorCode?: string; retryAfterSeconds?: number } = {},
  ) {
    super(message, { status: options.status ?? 503, errorCode: options.errorCode });
    this.name = 'S3ThrottleError';
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

export class S3ServerError extends S3ClientError {
  readonly code = 'S3_SERVER_ERROR';

  constructor(status: number, message?: string, errorCode?: string) {
    super(message ?? `S3 upstream server error (${status}).`, { status, errorCode });
    this.name = 'S3ServerError';
  }
}

export class S3ClientRequestError extends S3ClientError {
  readonly code = 'S3_REQUEST_ERROR';

  constructor(status: number, message?: string, errorCode?: string) {
    super(message ?? `S3 request failed (${status}).`, { status, errorCode });
    this.name = 'S3ClientRequestError';
  }
}

/** Thrown by the adapter when a listing exceeds the pagination guard. */
export class S3PaginationLimitError extends S3ClientError {
  readonly code = 'S3_PAGINATION_LIMIT';

  constructor(maxPages: number) {
    super(`S3 ListObjectsV2 exceeded ${maxPages} pages; aborting to avoid an unbounded walk.`);
    this.name = 'S3PaginationLimitError';
  }
}

/**
 * Parses `s3://bucket/key-prefix/` source URIs. The prefix is normalized to
 * carry no leading slash and a trailing slash when non-empty, so it always
 * scopes a subtree. Rejects non-s3 schemes, empty buckets, traversal, and
 * query/fragment components.
 */
export function parseS3Uri(raw: string): { bucket: string; prefix: string } {
  const value = (raw ?? '').trim();
  if (!value || !/^s3:\/\//i.test(value)) {
    throw new S3ConfigError('S3 source requires base_url of the form "s3://bucket/prefix/".');
  }

  const rest = value.slice('s3://'.length);
  if (rest.includes('?') || rest.includes('#')) {
    throw new S3ConfigError('S3 source base_url must not include query or fragment components.');
  }

  const [bucket, ...prefixParts] = rest.split('/');
  if (!bucket || !/^[a-z0-9][a-z0-9.-]*$/i.test(bucket)) {
    throw new S3ConfigError('S3 source base_url must include a valid bucket name.');
  }

  const prefix = prefixParts.join('/').replace(/\/{2,}/g, '/').replace(/^\/+/, '');
  if (prefix.includes('..')) {
    throw new S3ConfigError('S3 source prefix must not contain path traversal segments.');
  }
  const normalizedPrefix = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;
  return { bucket, prefix: normalizedPrefix };
}

/** S3 URI / configuration error (thrown before any client call). */
export class S3ConfigError extends Error {
  readonly code = 'S3_CONFIG';

  constructor(message: string) {
    super(message);
    this.name = 'S3ConfigError';
  }
}

/**
 * Normalizes an S3 ETag: strips surrounding quotes and the weak marker,
 * trims whitespace. Empty or quote-only values normalize to undefined.
 */
export function normalizeS3ETag(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const normalized = raw.trim().replace(/^W\//i, '').replace(/^"|"$/g, '').trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Normalizes an S3 version id. The literal "null" marks an unversioned
 * object, so it normalizes to undefined like any empty value.
 */
export function normalizeS3VersionId(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const normalized = raw.trim();
  if (normalized.length === 0 || normalized.toLowerCase() === 'null') {
    return undefined;
  }
  return normalized;
}

/** Extracts the <Code> value from an S3 XML error body, if present. */
export function extractS3ErrorCode(body: string): string | undefined {
  const match = /<Code>\s*([^<]+?)\s*<\/Code>/.exec(body);
  return match ? match[1] : undefined;
}

/**
 * Canonical status/error-code -> typed error mapping for S3 responses:
 * 404/NoSuchKey -> not found; 403/AccessDenied/InvalidAccessKeyId/
 * SignatureDoesNotMatch -> auth; 503/SlowDown (+Retry-After) -> throttle;
 * other 5xx -> server error.
 */
export function interpretS3Response(
  status: number,
  headers: Record<string, string>,
  errorCode?: string,
): S3ClientError {
  const retryAfterRaw = headers['retry-after'];
  const retryAfter = Number(retryAfterRaw);
  const retryAfterSeconds = typeof retryAfterRaw === 'string' && Number.isFinite(retryAfter) && retryAfter >= 0
    ? retryAfter
    : undefined;

  if (status === 404 || errorCode === 'NoSuchKey') {
    return new S3NotFoundError('S3 object not found.', { status, errorCode });
  }
  if (status === 403 || errorCode === 'AccessDenied' || errorCode === 'InvalidAccessKeyId' || errorCode === 'SignatureDoesNotMatch') {
    return new S3AuthError('S3 rejected the request credentials.', { status, errorCode });
  }
  if (status === 503 || errorCode === 'SlowDown') {
    return new S3ThrottleError('S3 throttled the request.', { status, errorCode, retryAfterSeconds });
  }
  if (status >= 500) {
    return new S3ServerError(status, undefined, errorCode);
  }
  return new S3ClientRequestError(status, undefined, errorCode);
}
