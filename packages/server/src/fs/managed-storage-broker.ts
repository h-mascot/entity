import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface, type Interface } from 'node:readline';

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
const MAX_LINE = 1024 * 1024 * 2;
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

export class ManagedStorageBrokerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly pending: Array<{ resolve: (response: BrokerResponse) => void; reject: (error: Error) => void }> = [];
  private closed = false;

  constructor(options: { executable: string; root: string; spawn?: typeof spawn }) {
    // root is startup configuration only. It is never included in an operation request.
    const launcher = options.spawn ?? spawn;
    this.child = launcher(options.executable, [options.root], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.lines.on('line', (line) => {
      const pending = this.pending.shift();
      if (!pending) return;
      try { pending.resolve(parseResponse(line)); } catch (error) { pending.reject(error instanceof Error ? error : new Error('malformed managed storage response')); }
    });
    // A child can disappear between two requests (or mid-batch) while a write
    // is still in flight; the write then fails with EPIPE on stdin. Reject the
    // affected pending request(s) here so the error surfaces on their Promises
    // instead of becoming an unhandled stream 'error'.
    this.child.stdin.on('error', () => this.failPending(new Error('managed storage broker input failed')));
    this.child.once('exit', () => {
      this.closed = true;
      this.failPending(new Error('managed storage broker exited'));
      this.lines.close();
    });
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
    // Closing the stdin gracefully signals EOF; EPIPE races during close are
    // already routed to pending requests through the shared stdin error path.
    this.child.stdin.end();
    await once(this.child, 'exit');
    this.lines.close();
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
    if (this.closed) return Promise.reject(new Error('managed storage broker is closed'));
    const fields = request.op === 'stat' || request.op === 'read' || request.op === 'list'
      ? [request.op, encode(request.path)]
      : request.op === 'mkdir' ? [request.op, encode(request.path), request.mode.toString(8)]
      : request.op === 'replace-if-equal'
        ? [request.op, encode(request.path), encode(request.recoveryPath), encode(request.expected), encode(request.data)]
        : [request.op === 'exclusive-create' ? 'create' : request.op, encode(request.path), encode(request.data)];
    const payload = `${fields.join('\t')}\n`;
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      this.pending.push(entry);
      try {
        this.child.stdin.write(payload);
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
