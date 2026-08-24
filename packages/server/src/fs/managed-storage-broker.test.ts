import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { spawn as spawnType } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ManagedStorageBrokerClient, ManagedStorageBrokerError, resolveManagedStorageBrokerExecutable } from './managed-storage-broker';

function controllableChild(): { child: ChildProcessWithoutNullStreams; stdin: PassThrough; stdout: PassThrough } {
  // A fake broker child whose stdio we drive directly, so the EPIPE/exit races
  // are reproduced deterministically with real Node streams (no real subprocess
  // timing). The client's contract requires stdin and stdout only.
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin, stdout }) as unknown as ChildProcessWithoutNullStreams;
  return { child, stdin, stdout };
}

function controlledClient(child: ChildProcessWithoutNullStreams): ManagedStorageBrokerClient {
  return new ManagedStorageBrokerClient({
    executable: 'n/a',
    root: '/bound/root',
    spawn: (() => child) as unknown as typeof spawnType,
  });
}

function fake(body: string, log?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'msb-ipc-'));
  const file = join(dir, 'broker');
  const escaped = body.split("'").join("'\\''");
  writeFileSync(file, `#!/bin/sh\nIFS= read line || exit 0\n${log ? `printf '%s' "$line" > '${log}'` : ''}\nprintf '%s\\n' '${escaped}'\n`, { mode: 0o700 });
  chmodSync(file, 0o700);
  return file;
}

describe('managed storage broker IPC client', () => {
  it('resolves the native executable from the module location, not the process cwd', () => {
    expect(resolveManagedStorageBrokerExecutable('')).toBe(join(process.cwd(), 'native/managed-storage-broker/.build/broker'));
    expect(resolveManagedStorageBrokerExecutable('/configured/broker')).toBe('/configured/broker');
  });

  it('maps all operations to explicit protocol requests and never sends an operation root', async () => {
    const script = fake('ok\tdata\t6162');
    const client = new ManagedStorageBrokerClient({ executable: script, root: '/bound/root' });
    await expect(client.stat('a.txt')).rejects.toThrow('unexpected managed storage response');
    await client.close();
  });

  it('encodes operation-bound compare-and-replace without a caller root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'msb-ipc-log-'));
    const log = join(dir, 'request');
    const client = new ManagedStorageBrokerClient({ executable: fake('ok\tempty', log), root: '/bound/root' });
    await client.replaceIfEqual('document.txt', '.entity-recovery/document.txt', Buffer.from('old'), Buffer.from('new'));
    await client.close();
    expect(readFileSync(log, 'utf8')).toBe('replace-if-equal\t646f63756d656e742e747874\t2e656e746974792d7265636f766572792f646f63756d656e742e747874\t6f6c64\t6e6577');
    expect(readFileSync(log, 'utf8')).not.toContain('/bound/root');
  });

  it('round-trips empty expected and replacement bytes through the native protocol', async () => {
    const root = mkdtempSync(join(tmpdir(), 'msb-ipc-native-'));
    mkdirSync(join(root, '.recovery'));
    writeFileSync(join(root, 'document.txt'), '');
    const executable = join(process.cwd(), 'native/managed-storage-broker/.build/broker');
    const client = new ManagedStorageBrokerClient({ executable, root });
    try {
      await client.replaceIfEqual('document.txt', '.recovery/document.txt', Buffer.alloc(0), Buffer.from('filled'));
      await expect(client.read('document.txt')).resolves.toEqual(new Uint8Array(Buffer.from('filled')));
      await client.replaceIfEqual('document.txt', '.recovery/document.txt', Buffer.from('filled'), Buffer.alloc(0));
      await expect(client.read('document.txt')).resolves.toEqual(new Uint8Array());
    } finally {
      await client.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('propagates typed broker errors', async () => {
    const client = new ManagedStorageBrokerClient({ executable: fake('err\tnot_found'), root: '/bound/root' });
    await expect(client.read('missing')).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<ManagedStorageBrokerError>);
    await client.close();
  });

  it.each(['', 'wat', 'ok\tdata\tzz', 'ok\tstat\t1\t2'])('rejects malformed responses: %j', async (response) => {
    const client = new ManagedStorageBrokerClient({ executable: fake(response), root: '/bound/root' });
    await expect(client.read('a')).rejects.toThrow('malformed managed storage response');
    await client.close();
  });

  it('rejects the exact pending request when a stdin write races a broken pipe, without an unhandled EPIPE', async () => {
    const { child, stdin, stdout } = controllableChild();
    const client = controlledClient(child);
    // Simulate the broker child dying so the pipe to its stdin breaks. The
    // request writes into that broken pipe; its failure must surface on the
    // request Promise (not as an unhandled stream 'error').
    stdin.destroy(new Error('write EPIPE'));
    await expect(client.read('a.txt')).rejects.toThrow('managed storage broker input failed');
    // Emitting exit afterwards is a no-op (no double settlement); closed is set
    // here so any later request is rejected cleanly.
    child.emit('exit', 1, null);
    await expect(client.read('b.txt')).rejects.toThrow('closed');
    stdout.destroy();
  });

  it('rejects pending requests once and only once when the child exits, preserving order and close behaviour', async () => {
    const { child, stdin, stdout } = controllableChild();
    const client = controlledClient(child);
    const a = client.read('a.txt');
    const b = client.read('b.txt');
    child.emit('exit', 0, null);
    await expect(a).rejects.toThrow('managed storage broker exited');
    await expect(b).rejects.toThrow('managed storage broker exited');
    // Queued requests issued after the child has gone are rejected immediately.
    await expect(client.read('c.txt')).rejects.toThrow('closed');
    await client.close();
    stdout.destroy();
  });
});
