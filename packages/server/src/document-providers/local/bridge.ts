/**
 * T-026 / THE-967 — document-scoped local bridge security boundary.
 *
 * This is deliberately a protocol/security skeleton, not a bridge transport or
 * Office engine. The caller presents document references only; paths enter the
 * boundary through the server-owned allowlist and are canonicalized before use.
 */
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export const LOCAL_BRIDGE_PROTOCOL_VERSION = 1;
export const LOCAL_BRIDGE_OPERATIONS = ['open', 'inspect', 'save'] as const;
export type LocalBridgeOperation = typeof LOCAL_BRIDGE_OPERATIONS[number];
export type LocalBridgeReadiness =
  | 'ready'
  | 'bridge_not_installed'
  | 'bridge_not_running'
  | 'engine_unavailable'
  | 'file_unavailable'
  | 'permission_denied'
  | 'version_conflict'
  | 'degraded';

export interface LocalBridgeDocument {
  documentRef: string;
  managedPath: string;
}

export const LOCAL_BRIDGE_FIELD_LIMITS = {
  origin: 512,
  clientNonce: 256,
  proof: 128,
  sessionId: 128,
  sessionToken: 128,
  requestId: 256,
  documentRef: 256,
} as const;
export const LOCAL_BRIDGE_MAX_SESSIONS = 128;
export const LOCAL_BRIDGE_MAX_REPLAY_NONCES = 256;

export interface LocalBridgeAuditEvent {
  event: 'handshake' | 'authorize' | 'shutdown';
  outcome: 'accepted' | 'rejected';
  code?: string;
  operation?: LocalBridgeOperation;
  readiness: LocalBridgeReadiness;
}

export interface LocalBridgeOptions {
  sharedSecret: string;
  allowedOrigins: readonly string[];
  allowedRoots: readonly string[];
  sessionTtlMs?: number;
  now?: () => number;
  audit?: (event: LocalBridgeAuditEvent) => void;
}

export interface LocalBridgeHandshake {
  protocolVersion: number;
  origin: string;
  clientNonce: string;
  proof: string;
}

export interface LocalBridgeHandshakeResult {
  sessionId: string;
  sessionToken: string;
  expiresAt: number;
  readiness: LocalBridgeReadiness;
}

export interface LocalBridgeRequest {
  sessionId: string;
  sessionToken: string;
  requestId: string;
  documentRef: string;
  operation: LocalBridgeOperation;
}

export interface AuthorizedLocalBridgeRequest {
  sessionId: string;
  documentRef: string;
  operation: LocalBridgeOperation;
  canonicalPath: string;
}

interface Session {
  tokenHash: string;
  expiresAt: number;
  seenRequests: Set<string>;
}

export class LocalBridgeSecurityError extends Error {
  constructor(public readonly code:
    | 'invalid_handshake'
    | 'unauthorized'
    | 'expired_session'
    | 'replayed_request'
    | 'unknown_document'
    | 'invalid_operation'
    | 'path_outside_allowlist'
    | 'symlink_forbidden'
    | 'file_unavailable', message: string) {
    super(message);
    this.name = 'LocalBridgeSecurityError';
  }
}

export class LocalBridgeSecurity {
  private readonly documents = new Map<string, string>();
  private readonly sessions = new Map<string, Session>();
  private allowedRoots: string[];
  private readonly now: () => number;
  private readiness: LocalBridgeReadiness = 'bridge_not_running';
  private readonly ttlMs: number;
  private shutdownRevoked = false;

  constructor(private readonly options: LocalBridgeOptions) {
    if (!options.sharedSecret) throw new Error('local bridge secret is required');
    this.now = options.now ?? Date.now;
    this.allowedRoots = options.allowedRoots.map((root) => path.resolve(root));
    this.ttlMs = options.sessionTtlMs ?? 60_000;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) throw new Error('invalid session TTL');
  }

  setReadiness(readiness: LocalBridgeReadiness): void {
    this.readiness = readiness;
  }

  getReadiness(): LocalBridgeReadiness {
    return this.readiness;
  }

  /** Add a server-resolved managed file. The path is never accepted in a request. */
  async allowDocument(document: LocalBridgeDocument): Promise<void> {
    // Canonicalize configured roots too: macOS temp/workspace roots may themselves
    // be symlinks (for example /var -> /private/var).
    this.allowedRoots = await Promise.all(this.allowedRoots.map(async (root) => {
      try { return await realpath(root); } catch { return root; }
    }));
    const canonical = await this.canonicalizeManagedPath(document.managedPath);
    this.documents.set(document.documentRef, canonical);
  }

  revokeDocument(documentRef: string): void {
    this.documents.delete(documentRef);
  }

  handshake(input: LocalBridgeHandshake): LocalBridgeHandshakeResult {
    if (this.shutdownRevoked || !this.isHandshakeInput(input) || !this.boundedHandshake(input)
      || input.protocolVersion !== LOCAL_BRIDGE_PROTOCOL_VERSION
      || !input.clientNonce || !this.options.allowedOrigins.includes(input.origin)
      || !this.verifyProof(input)) {
      this.audit({ event: 'handshake', outcome: 'rejected', code: 'invalid_handshake' });
      throw new LocalBridgeSecurityError('invalid_handshake', 'handshake rejected');
    }
    if (this.readiness !== 'ready') {
      this.audit({ event: 'handshake', outcome: 'rejected', code: 'unavailable' });
      throw new LocalBridgeSecurityError('unauthorized', 'bridge is not ready');
    }
    this.evictExpiredSessions();
    if (this.sessions.size >= LOCAL_BRIDGE_MAX_SESSIONS) {
      this.audit({ event: 'handshake', outcome: 'rejected', code: 'session_limit' });
      throw new LocalBridgeSecurityError('unauthorized', 'session limit reached');
    }
    const sessionId = randomUUID();
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = this.now() + this.ttlMs;
    this.sessions.set(sessionId, {
      tokenHash: this.hash(sessionToken), expiresAt, seenRequests: new Set(),
    });
    this.audit({ event: 'handshake', outcome: 'accepted' });
    return { sessionId, sessionToken, expiresAt, readiness: this.readiness };
  }

  authorize(request: LocalBridgeRequest): Promise<AuthorizedLocalBridgeRequest> {
    return this.authorizeAsync(request);
  }

  revokeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  shutdown(): void {
    this.sessions.clear();
    this.shutdownRevoked = true;
    this.audit({ event: 'shutdown', outcome: 'accepted' });
  }

  private async authorizeAsync(request: LocalBridgeRequest): Promise<AuthorizedLocalBridgeRequest> {
    if (!this.isRequestInput(request) || !this.boundedRequest(request)) {
      this.audit({ event: 'authorize', outcome: 'rejected', code: 'unauthorized' });
      throw new LocalBridgeSecurityError('unauthorized', 'request rejected');
    }
    if (this.shutdownRevoked) {
      this.audit({ event: 'authorize', outcome: 'rejected', code: 'shutdown' });
      throw new LocalBridgeSecurityError('unauthorized', 'bridge is shut down');
    }
    if (this.readiness !== 'ready') {
      this.audit({ event: 'authorize', outcome: 'rejected', code: 'unavailable', operation: request.operation });
      throw new LocalBridgeSecurityError('unauthorized', 'bridge is not ready');
    }
    const session = this.sessions.get(request.sessionId);
    if (!session) throw new LocalBridgeSecurityError('unauthorized', 'unknown session');
    if (this.now() >= session.expiresAt) {
      this.sessions.delete(request.sessionId);
      throw new LocalBridgeSecurityError('expired_session', 'session expired');
    }
    if (!this.constantTimeEqual(session.tokenHash, this.hash(request.sessionToken))) {
      throw new LocalBridgeSecurityError('unauthorized', 'invalid session token');
    }
    if (!request.requestId || session.seenRequests.has(request.requestId)) {
      throw new LocalBridgeSecurityError('replayed_request', 'request nonce already used');
    }
    if (!LOCAL_BRIDGE_OPERATIONS.includes(request.operation)) {
      throw new LocalBridgeSecurityError('invalid_operation', 'operation is not allowlisted');
    }
    const managedPath = this.documents.get(request.documentRef);
    if (!managedPath) throw new LocalBridgeSecurityError('unknown_document', 'document is not allowlisted');
    try {
      const canonicalPath = await this.verifyManagedPath(managedPath);
      if (session.seenRequests.size >= LOCAL_BRIDGE_MAX_REPLAY_NONCES) {
        const oldest = session.seenRequests.values().next().value;
        if (oldest) session.seenRequests.delete(oldest);
      }
      session.seenRequests.add(request.requestId);
      this.audit({ event: 'authorize', outcome: 'accepted', operation: request.operation });
      return { sessionId: request.sessionId, documentRef: request.documentRef, operation: request.operation, canonicalPath };
    } catch (error) {
      this.audit({ event: 'authorize', outcome: 'rejected', code: error instanceof LocalBridgeSecurityError ? error.code : 'file_unavailable', operation: request.operation });
      throw error;
    }
  }

  private async canonicalizeManagedPath(managedPath: string): Promise<string> {
    const resolved = path.resolve(managedPath);
    const canonical = await this.safeRealpath(resolved);
    if (!this.isUnderAllowedRoot(canonical)) throw new LocalBridgeSecurityError('path_outside_allowlist', 'canonical path is outside allowed roots');
    const info = await lstat(resolved);
    if (info.isSymbolicLink()) throw new LocalBridgeSecurityError('symlink_forbidden', 'symlinked documents are forbidden');
    return canonical;
  }

  private async verifyManagedPath(canonical: string): Promise<string> {
    if (!this.isUnderAllowedRoot(canonical)) throw new LocalBridgeSecurityError('path_outside_allowlist', 'path escaped allowed roots');
    let current: string;
    try { current = await realpath(canonical); } catch { throw new LocalBridgeSecurityError('path_outside_allowlist', 'managed file is unavailable'); }
    if (current !== canonical || !this.isUnderAllowedRoot(current)) throw new LocalBridgeSecurityError('path_outside_allowlist', 'managed path changed');
    try {
      const info = await lstat(current);
      if (!info.isFile()) throw new LocalBridgeSecurityError('file_unavailable', 'managed target is not a regular file');
    } catch (error) {
      if (error instanceof LocalBridgeSecurityError) throw error;
      throw new LocalBridgeSecurityError('file_unavailable', 'managed file is unavailable');
    }
    return current;
  }

  private evictExpiredSessions(): void {
    const now = this.now();
    for (const [sessionId, session] of this.sessions) {
      if (now >= session.expiresAt) this.sessions.delete(sessionId);
    }
  }

  private isHandshakeInput(input: unknown): input is LocalBridgeHandshake {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
  }

  private isRequestInput(input: unknown): input is LocalBridgeRequest {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
  }

  private async safeRealpath(value: string): Promise<string> {
    try { return await realpath(value); } catch { throw new LocalBridgeSecurityError('file_unavailable', 'managed file is unavailable'); }
  }

  private isUnderAllowedRoot(candidate: string): boolean {
    return this.allowedRoots.some((root) => {
      const relative = path.relative(root, candidate);
      return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    });
  }

  private boundedHandshake(input: LocalBridgeHandshake): boolean {
    return this.hasLength(input.origin, LOCAL_BRIDGE_FIELD_LIMITS.origin)
      && this.hasLength(input.clientNonce, LOCAL_BRIDGE_FIELD_LIMITS.clientNonce)
      && this.hasLength(input.proof, LOCAL_BRIDGE_FIELD_LIMITS.proof);
  }

  private boundedRequest(request: LocalBridgeRequest): boolean {
    return this.hasLength(request.sessionId, LOCAL_BRIDGE_FIELD_LIMITS.sessionId)
      && this.hasLength(request.sessionToken, LOCAL_BRIDGE_FIELD_LIMITS.sessionToken)
      && this.hasLength(request.requestId, LOCAL_BRIDGE_FIELD_LIMITS.requestId)
      && this.hasLength(request.documentRef, LOCAL_BRIDGE_FIELD_LIMITS.documentRef);
  }

  private hasLength(value: unknown, max: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= max;
  }

  private audit(event: Omit<LocalBridgeAuditEvent, 'readiness'>): void {
    this.options.audit?.({ ...event, readiness: this.readiness });
  }

  private verifyProof(input: LocalBridgeHandshake): boolean {
    const expected = this.hash(`${input.protocolVersion}:${input.origin}:${input.clientNonce}`, this.options.sharedSecret);
    return this.constantTimeEqual(expected, input.proof);
  }

  private hash(value: string, secret = this.options.sharedSecret): string {
    return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
  }

  private constantTimeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left); const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export function localBridgeHandshakeProof(input: Omit<LocalBridgeHandshake, 'proof'>, sharedSecret: string): string {
  return createHmac('sha256', sharedSecret)
    .update(`${input.protocolVersion}:${input.origin}:${input.clientNonce}`, 'utf8').digest('hex');
}
