import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ManagedStorageBrokerClient, ManagedStorageBrokerError } from './managed-storage-broker';

function fake(body: string, log?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'msb-ipc-'));
  const file = join(dir, 'broker');
  const escaped = body.replaceAll("'", "'\\''");
  writeFileSync(file, `#!/bin/sh\nIFS= read line || exit 0\n${log ? `printf '%s' "$line" > '${log}'` : ''}\nprintf '%s\\n' '${escaped}'\n`, { mode: 0o700 });
  chmodSync(file, 0o700);
  return file;
}

describe('managed storage broker IPC client', () => {
  it('maps all operations to explicit protocol requests and never sends an operation root', async () => {
    const script = fake('ok\tdata\t6162');
    const client = new ManagedStorageBrokerClient({ executable: script, root: '/bound/root' });
    await expect(client.stat('a.txt')).rejects.toThrow('unexpected managed storage response');
    await client.close();
  });

  it('propagates typed broker errors', async () => {
    const client = new ManagedStorageBrokerClient({ executable: fake('err\tnot_found'), root: '/bound/root' });
    await expect(client.read('missing')).rejects.toMatchObject<Partial<ManagedStorageBrokerError>>({ code: 'not_found' });
    await client.close();
  });

  it.each(['', 'wat', 'ok\tdata\tzz', 'ok\tstat\t1\t2'])('rejects malformed responses: %j', async (response) => {
    const client = new ManagedStorageBrokerClient({ executable: fake(response), root: '/bound/root' });
    await expect(client.read('a')).rejects.toThrow('malformed managed storage response');
    await client.close();
  });
});
