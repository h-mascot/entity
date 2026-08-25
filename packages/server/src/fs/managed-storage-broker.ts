import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface, type Interface } from 'node:readline';

type SpawnFn = typeof spawn;

export type BrokerErrorCode = 'invalid' | 'not_found' | 'io' | 'exists' | 'limit';
export type BrokerStat = { size: number; mode: number; isDirectory: boolean };
export type BrokerRequest =
  | { op: 'stat'; path: string }
  | { op: 'read'; path: string }
  | { op: 'write'; path: string; data: Uint8Array }
  | { op: 'exclusive-create'; path: string; data: Uint8Array }
  | { op: 'replace-if-equal'; path: string; recoveryPath: string; expected: Uint8Array; data: Uint8Array }
  | { op: 'mkdir'; path: string; mode: number }
  | { op: 'list'; path: string };

type BrokerResponse =
  | { kind: 'stat'; size: number; mode: number; isDirectory: boolean }
  | { kind: 'data'; data: Uint8Array }
  | { kind: 'ok' }
  | { kind: 'error'; code: BrokerErrorCode };

const ERROR_CODES = new Set<BrokerErrorCode>(['invalid', 'not_found', 'io', 'exists', 'limit']);
// The native read ceiling (16 MiB) matches DEFAULT_SOURCE_READ_LIMIT_BYTES and
// MSB_MAX_READ. A read response hex payload is 2 hex chars per byte (32 MiB) plus
// framing ("ok\tdata\t") and trailing newline. This bound safely fits the largest
// legal hex payload while staying finite so a stray/oversized line is still
// rejected as malformed rather than buffered without limit.
const MAX_READ_BYTES = 16 * 1024 * 1024;
const MAX_LINE = MAX_READ_BYTES * 2 + 64;
const encode = (data: Uint8Array | string) => Buffer.from(data).toString('hex');

export function resolveManagedStorageBrokerExecutable(configured = process.env.MANAGED_STORAGE_BROKER_EXECUTABLE): string {
  if (configured?.trim()) return configured.trim();
  const candidates = [
    path.resolve(__dirname, '../../native/managed-storage-broker/.build/broker'),
    path.resolve(__dirname, '../../../../native/managed-storage-broker/.build/broker'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export class ManagedStorageBrokerError extends Error {
  constructor(readonly code: BrokerErrorCode, message?: string) {
    super(message ?? `managed storage broker: ${code}`);
    this.name = 'ManagedStorageBrokerError';
  }
}

/**
 * A broker child could not be launched (missing/unexecutable executable, i.e.
 * spawn ENOENT/EACCES). It is a typed broker error (code `io`) so adapters and
 * route layers keep their existing typed-broker mapping and error paths, while
 * remaining distinguishable for fail-closed messaging.
 */
export class ManagedStorageBrokerSpawnError extends ManagedStorageBrokerError {
  constructor(message = 'managed storage broker could not be launched') {
    super('io', message);
    this.name = 'ManagedStorageBrokerSpawnError';
  }
}

export class ManagedStorageBrokerClient {
  private readonly child: ChildProcessWithoutNullStreams | undefined;
  private readonly lines: Interface | undefined;
  private readonly pending: Array<{ resolve: (response: BrokerResponse) => void; reject: (error: Error) => void }> = [];
  private readonly spawnError: Error | undefined;
  private closed = false;
  private failed = false;

  constructor(options: { executable: string; root: string; spawn?: SpawnFn }) {
    // root is startup configuration only. It is never included in an operation request.
    const launcher = options.spawn ?? spawn;
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      child = launcher(options.executable, [options.root], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      // spawn can throw synchronously on some platforms for ENOENT/EACCES. Fail
      // closed: keep construction non-throwing so the owning adapter surfaces a
      // typed request failure on use instead of crashing the server.
      this.failed = true;
      this.closed = true;
      this.child = undefined;
      this.lines = undefined;
      this.spawnError = new ManagedStorageBrokerSpawnError(
        error instanceof Error ? `managed storage broker could not be launched: ${error.message}` : undefined,
      );
      return;
    }
    this.child = child;
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.spawnError = undefined;
    this.lines.on('line', (line) => {
      const pending = this.pending.shift();
      if (!pending) return;
      try { pending.resolve(parseResponse(line)); } catch (error) { pending.reject(error instanceof Error ? error : new Error('malformed managed storage response')); }
    });
    // A child can disappear between two requests (or mid-batch) while a write
    // is still in flight; the write then fails with EPIPE on stdin. Reject the
    // affected pending request(s) here so the error surfaces on their Promises
    // instead of becoming an unhandled stream 'error'.
    child.stdin.on('error', () => this.failPending(new Error('managed storage broker input failed')));
    // Spawn failure is signalled asynchronously through the child 'error' event
    // (ENOENT/EACCES). Without a listener that is an unhandled event and crashes
    // the server. Fail closed: settle all pending/current requests with a typed
    // broker error and never let the event escape. failPending is idempotent, so
    // the eventual 'exit' (if any) cannot double-settle the same requests.
    child.once('error', (error) => {
      this.failed = true;
      this.closed = true;
      this.failPending(new ManagedStorageBrokerSpawnError(
        error instanceof Error ? `managed storage broker could not be launched: ${error.message}` : undefined,
      ));
      this.lines?.close();
    });
    child.once('exit', () => {
      this.closed = true;
      this.failPending(new Error('managed storage broker exited'));
      this.lines?.close();
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get isFailed(): boolean {
    return this.failed;
  }

  async stat(path: string): Promise<BrokerStat> { return this.request({ op: 'stat', path }).then((r) => this.expect(r, 'stat')); }
  async read(path: string): Promise<Uint8Array> { return this.request({ op: 'read', path }).then((r) => this.expect(r, 'data').data); }
  async write(path: string, data: Uint8Array): Promise<void> { await this.request({ op: 'write', path, data }).then((r) => this.expect(r, 'ok')); }
  async exclusiveCreate(path: string, data: Uint8Array): Promise<void> { await this.request({ op: 'exclusive-create', path, data }).then((r) => this.expect(r, 'ok')); }
  async replaceIfEqual(path: string, recoveryPath: string, expected: Uint8Array, data: Uint8Array): Promise<void> { await this.request({ op: 'replace-if-equal', path, recoveryPath, expected, data }).then((r) => this.expect(r, 'ok')); }
  async mkdir(path: string, mode = 0o700): Promise<void> { await this.request({ op: 'mkdir', path, mode }).then((r) => this.expect(r, 'ok')); }
  async list(path: string): Promise<string[]> { return this.request({ op: 'list', path }).then((r) => Buffer.from(this.expect(r, 'data').data).toString('utf8').split('\n').filter(Boolean)); }

  async close(): Promise<void> {
    if (this.closed) return;
    if (!this.child) {
      // Spawn failed synchronously; there is no process to signal.
      this.closed = true;
      return;
    }
    const child = this.child;
    // Closing the stdin gracefully signals EOF; EPIPE races during close are
    // already routed to pending requests through the shared stdin error path.
    child.stdin.end();
    // A child that failed to spawn emits 'error' but not 'exit' (Node semantics),
    // so wait on whichever settles first to avoid hanging shutdown on a broker
    // that can never exit.
    await Promise.race([once(child, 'exit'), once(child, 'error')]);
    this.closed = true;
    this.lines?.close();
  }

  /**
   * Reject every queued request exactly once. Called from the stdin write-error
   * path and the child exit path; both are safe to invoke repeatedly because
   * the queue is drained, so no request is ever settled twice.
   */
  private failPending(error: Error): void {
    while (this.pending.length) this.pending.shift()!.reject(error);
  }

  private request(request: BrokerRequest): Promise<BrokerResponse> {
    if (this.failed) return Promise.reject(this.spawnError ?? new ManagedStorageBrokerSpawnError());
    if (this.closed) return Promise.reject(new Error('managed storage broker is closed'));
    if (!this.child) return Promise.reject(new ManagedStorageBrokerSpawnError());
    // The UI/API represent source-root traversal as an empty relative path. The
    // native broker deliberately accepts `.` as its only root descriptor and
    // rejects an empty protocol path, so normalize only this exact boundary.
    const operationPath = request.path === '' ? '.' : request.path;
    const fields = request.op === 'stat' || request.op === 'read' || request.op === 'list'
      ? [request.op, encode(operationPath)]
      : request.op === 'mkdir' ? [request.op, encode(operationPath), request.mode.toString(8)]
      : request.op === 'replace-if-equal'
        ? [request.op, encode(operationPath), encode(request.recoveryPath), encode(request.expected), encode(request.data)]
        : [request.op === 'exclusive-create' ? 'create' : request.op, encode(operationPath), encode(request.data)];
    const payload = `${fields.join('\t')}\n`;
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      this.pending.push(entry);
      try {
        this.child!.stdin.write(payload);
      } catch (error) {
        // Synchronous write failure (e.g. write-after-end): reject this request
        // through its Promise, not by throwing an unhandled EPIPE.
        const index = this.pending.indexOf(entry);
        if (index !== -1) this.pending.splice(index, 1);
        reject(error instanceof Error ? error : new Error('managed storage broker write failed'));
      }
    });
  }

  private expect<T extends BrokerResponse['kind']>(response: BrokerResponse, kind: T): Extract<BrokerResponse, { kind: T }> {
    if (response.kind === 'error') throw new ManagedStorageBrokerError(response.code);
    if (response.kind !== kind) throw new Error(`unexpected managed storage response: ${response.kind}`);
    return response as Extract<BrokerResponse, { kind: T }>;
  }
}

/**
 * Reuses one broker child per { executable, root } so repeated local-source
 * operations (route requests, index scans) do not spawn a fresh long-lived
 * broker process each time. The broker is stateless between line-based
 * requests for the same root, and concurrent requests on one client are
 * already serialized by the pending queue, so reuse is safe and keeps the
 * child-process count bounded by the number of distinct local sources.
 */
export class ManagedStorageBrokerClientPool {
  private readonly clients = new Map<string, ManagedStorageBrokerClient>();
  private spawn: SpawnFn | undefined;
  private totalClients = 0;

  constructor(options: { spawn?: SpawnFn } = {}) {
    this.spawn = options.spawn;
  }

  /** Test-only: replace the launcher used for subsequently acquired clients. */
  setTestSpawn(spawn: SpawnFn | undefined): void {
    this.spawn = spawn;
  }

  /** Count of client children ever created, for bounded-process proofs. */
  get createdCount(): number {
    return this.totalClients;
  }

  /** Number of live (cached) clients currently held. */
  get size(): number {
    return this.clients.size;
  }

  acquire(options: { executable: string; root: string }): ManagedStorageBrokerClient {
    const key = `${options.executable}\u0000${options.root}`;
    const existing = this.clients.get(key);
    if (existing && !existing.isFailed && !existing.isClosed) {
      return existing;
    }
    if (existing) {
      // A cached child failed (spawn error) or exited; evict it so a later
      // operation gets a fresh child rather than a dead one.
      this.clients.delete(key);
    }
    const client = new ManagedStorageBrokerClient({
      executable: options.executable,
      root: options.root,
      ...(this.spawn ? { spawn: this.spawn } : {}),
    });
    this.clients.set(key, client);
    this.totalClients += 1;
    return client;
  }

  async close(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(clients.map((client) => client.close()));
  }
}

/**
 * Default per-process pool shared by every LocalFileSourceAdapter that does not
 * inject its own broker client. Closed on server shutdown via
 * `closeManagedStorageBrokerPool()`.
 */
const defaultPool = new ManagedStorageBrokerClientPool();

export function acquireManagedStorageBrokerClient(options: { executable: string; root: string }): ManagedStorageBrokerClient {
  return defaultPool.acquire(options);
}

export function closeManagedStorageBrokerPool(): Promise<void> {
  return defaultPool.close();
}

export function managedStorageBrokerPoolStats(): { created: number; size: number } {
  return { created: defaultPool.createdCount, size: defaultPool.size };
}

/**
 * Test-only helper: close and clear the per-process pool, optionally replacing
 * the client launcher for tests that want deterministic/controllable children.
 */
export function resetManagedStorageBrokerPool(spawn?: SpawnFn): Promise<void> {
  const closed = defaultPool.close();
  defaultPool.setTestSpawn(spawn);
  return closed;
}

function parseResponse(line: string): BrokerResponse {
  if (!line || line.length > MAX_LINE) throw new Error('malformed managed storage response');
  const fields = line.split('\t');
  if (fields[0] === 'err' && fields.length === 2 && ERROR_CODES.has(fields[1] as BrokerErrorCode)) return { kind: 'error', code: fields[1] as BrokerErrorCode };
  if (fields[0] === 'ok' && fields.length === 2 && fields[1] === 'empty') return { kind: 'ok' };
  if (fields[0] === 'ok' && fields.length === 5 && fields[1] === 'stat') {
    const size = Number(fields[2]); const mode = Number(fields[3]);
    if (Number.isSafeInteger(size) && size >= 0 && Number.isSafeInteger(mode) && mode >= 0 && (fields[4] === '0' || fields[4] === '1')) return { kind: 'stat', size, mode, isDirectory: fields[4] === '1' };
  }
  if (fields[0] === 'ok' && fields[1] === 'data' && fields.length === 3) {
    if (!/^[0-9a-f]*$/i.test(fields[2]) || fields[2].length % 2 !== 0) throw new Error('malformed managed storage response data');
    return { kind: 'data', data: new Uint8Array(Buffer.from(fields[2], 'hex')) };
  }
  throw new Error('malformed managed storage response');
}
