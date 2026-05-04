/**
 * Codex Swarm Provider
 *
 * Wraps the Codex app server (ws://localhost:8300) as a swarm provider.
 * Each dispatched job creates a new thread and sends a turn with the task.
 */

import { WebSocket } from 'ws';
import type {
  SwarmProvider,
  BuildJobPayload,
  DispatchResult,
  RunStatus,
  ProviderHealth,
  ProofBundle,
  SwarmProviderMetadata,
} from './interface';

const CODEX_APP_SERVER_URL =
  process.env.CODEX_APP_SERVER_URL || 'ws://127.0.0.1:8300';
const CODEX_CODEX_HOME =
  process.env.CODEX_CODEX_HOME || '/Users/enterprise/.codex';

interface RpcMessage {
  jsonrpc: '2.0';
  id: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export class CodexProvider implements SwarmProvider {
  readonly name = 'codex';
  readonly label = 'Codex (app server)';
  readonly meta: SwarmProviderMetadata = {
    category: 'build-system',
    executionMode: 'push',
    description:
      'OpenAI Codex agent via app server WebSocket RPC',
    acceptsDispatch: true,
    capabilities: [
      'code-review',
      'refactor',
      'test-generation',
      'general',
    ],
  };

  private ws: WebSocket | null = null;
  private pending = new Map<
    string | number,
    (msg: RpcMessage) => void
  >();
  private streamChunks = new Map<string, string>();
  private currentThreadId: string | null = null;
  private _wsReady = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null =
    null;

  // ── Connection management ────────────────────────────────────────

  private async ensureConnection(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    await this.connect();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      const ws = new WebSocket(CODEX_APP_SERVER_URL);
      this.ws = ws;

      ws.on('open', async () => {
        this._wsReady = false;
        try {
          await this.rpc('initialize', {
            clientInfo: { name: 'entity-swarm', version: '1.0.0' },
            capabilities: {},
          });

          const threads =
            await this.rpc<{ threads: Array<{ id: string }> }>(
              'thread/list',
              {}
            );
          const existing = threads?.threads?.[0];
          if (existing) {
            this.currentThreadId = existing.id;
          } else {
            const created =
              await this.rpc<{ thread: { id: string } }>(
                'thread/start',
                { cwd: CODEX_CODEX_HOME }
              );
            this.currentThreadId = created?.thread?.id ?? null;
          }

          this._wsReady = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      ws.on(
        'message',
        (data: Buffer | ArrayBuffer | Buffer[]) => {
          try {
            const raw =
              data instanceof Buffer
                ? data.toString()
                : data instanceof ArrayBuffer
                  ? Buffer.from(data).toString()
                  : Buffer.concat(data as Buffer[]).toString();
            const msg: RpcMessage = JSON.parse(raw);

            if (msg.id === undefined && msg.method) {
              this.handleNotification(
                msg as { method: string; params?: unknown }
              );
              return;
            }

            const resolver = this.pending.get(
              msg.id as string | number
            );
            if (resolver) {
              this.pending.delete(msg.id as string | number);
              resolver(msg);
            }
          } catch {
            // ignore parse errors
          }
        }
      );

      ws.on('error', () => {
        this._wsReady = false;
      });

      ws.on('close', () => {
        this._wsReady = false;
        this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        // will retry on next operation
      }
    }, 5000);
  }

  private rpc<T = unknown>(
    method: string,
    params: Record<string, unknown>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Codex WS not connected'));
        return;
      }
      const id = Math.random().toString(36).slice(2);
      this.pending.set(id, (msg) => {
        if (msg.error)
          reject(new Error(msg.error.message));
        else resolve(msg.result as T);
      });
      this.ws.send(
        JSON.stringify({ jsonrpc: '2.0', id, method, params })
      );
    });
  }

  private handleNotification(msg: {
    method: string;
    params?: unknown;
  }): void {
    if (msg.method === 'item/agentMessage/delta') {
      const p = msg.params as {
        delta?: { text?: string };
        turnId?: string;
      };
      const turnId = p?.turnId ?? 'default';
      if (p?.delta?.text) {
        this.streamChunks.set(
          turnId,
          (this.streamChunks.get(turnId) ?? '') + p.delta.text
        );
      }
    }
  }

  // ── SwarmProvider implementation ───────────────────────────────

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.ensureConnection();
      return {
        available: this._wsReady,
        message: this._wsReady
          ? `Codex app server reachable at ${CODEX_APP_SERVER_URL}`
          : 'Codex app server not connected',
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        available: false,
        message: `Codex unreachable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  async dispatch(
    job: BuildJobPayload
  ): Promise<DispatchResult> {
    await this.ensureConnection();
    if (!this._wsReady || !this.ws) {
      throw new Error('Codex WS not ready');
    }

    const jobId = job.jobId;
    this.streamChunks.set(jobId, '');

    const threadResp = await this.rpc<{
      thread: { id: string };
    }>('thread/start', {
      cwd: job.repo || CODEX_CODEX_HOME,
    });
    const threadId = threadResp?.thread?.id;
    if (!threadId) throw new Error('Failed to create Codex thread');

    await this.rpc('turn/start', {
      threadId,
      input: [{ type: 'text', text: job.spec }],
    });

    return {
      runHandle: `${threadId}::${jobId}`,
      estimatedMinutes: 10,
    };
  }

  async status(runHandle: string): Promise<RunStatus> {
    const [threadId] = runHandle.split('::');
    try {
      const thread = await this.rpc<{
        thread: { status: { type: string } };
      }>('thread/read', { threadId });
      const status = thread?.thread?.status?.type;
      if (status === 'idle')
        return { state: 'completed', updatedAt: new Date().toISOString() };
      if (status === 'inProgress')
        return { state: 'running', updatedAt: new Date().toISOString() };
      return { state: 'queued', updatedAt: new Date().toISOString() };
    } catch {
      return {
        state: 'queued',
        updatedAt: new Date().toISOString(),
      };
    }
  }

  async cancel(runHandle: string): Promise<void> {
    const [threadId] = runHandle.split('::');
    try {
      await this.rpc('turn/interrupt', { threadId });
    } catch {
      // best-effort
    }
  }

  async collectProof(runHandle: string): Promise<ProofBundle> {
    const [, jobId] = runHandle.split('::');
    const transcript = this.streamChunks.get(jobId) ?? '';
    return {
      buildLog: transcript,
      durationSec: 0,
    };
  }
}
