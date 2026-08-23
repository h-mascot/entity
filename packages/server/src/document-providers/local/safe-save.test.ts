import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LocalRevision } from './file-watcher';
import { safeSave, SafeSaveError } from './safe-save';

const roots: string[] = [];
const revision = (token: string): LocalRevision => ({ token, size: token.length, modifiedAtMs: 1, contentHash: token });
async function fixture(): Promise<{ root: string; target: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'entity-safe-save-')); roots.push(root);
  const target = path.join(root, 'document.txt'); await writeFile(target, 'old'); return { root, target };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('local version watcher and safe save', () => {
  it('deduplicates identical revisions deterministically', async () => {
    let calls = 0;
    const first = revision('same');
    // Exercise the public dedupe seam without depending on timer or filesystem event ordering.
    const observed = new (await import('./file-watcher')).LocalVersionWatcher({ inspect: async () => first, onChange: () => calls++ });
    expect(await observed.observe()).toEqual(first); expect(await observed.observe()).toBeNull(); expect(calls).toBe(1);
    observed.stop();
  });

  it('rejects stale writes and preserves the original', async () => {
    const { target } = await fixture();
    await expect(safeSave({ targetPath: target, candidate: 'new', expectedRevision: revision('old'), currentRevision: async () => revision('changed'), validate: () => {}, workspaceId: 'w', tenantId: 't', authority: 'ready' })).rejects.toMatchObject({ code: 'stale' });
    expect(await readFile(target, 'utf8')).toBe('old');
  });

  it('validates separately, retains recovery, and reopens the replacement', async () => {
    const { target } = await fixture();
    const result = await safeSave({ targetPath: target, candidate: 'new', expectedRevision: revision('old'), currentRevision: async () => revision('new'), validate: (content) => { if (content.toString() !== 'new') throw new Error('bad'); }, workspaceId: 'w', tenantId: 't', authority: 'ready' });
    expect(await readFile(target, 'utf8')).toBe('new'); expect(await readFile(result.recoveryPath, 'utf8')).toBe('old'); expect(result.revision.token).toBe('new');
  });

  it.each(['candidate_written', 'candidate_validated', 'recovery_retained'] as const)('crash before replacement at %s leaves original valid', async (stage) => {
    const { target } = await fixture();
    await expect(safeSave({ targetPath: target, candidate: 'new', expectedRevision: revision('old'), currentRevision: async () => revision('old'), validate: () => {}, workspaceId: 'w', tenantId: 't', authority: 'ready', crashAt: stage })).rejects.toMatchObject({ code: 'crash' });
    expect(await readFile(target, 'utf8')).toBe('old');
  });

  it('fails closed for unknown or degraded authority and invalid scope', async () => {
    const { target } = await fixture();
    for (const authority of ['unknown', 'degraded'] as const) await expect(safeSave({ targetPath: target, candidate: 'new', expectedRevision: revision('old'), currentRevision: async () => revision('old'), validate: () => {}, workspaceId: 'w', tenantId: 't', authority })).rejects.toMatchObject({ code: 'authority' });
    await expect(safeSave({ targetPath: target, candidate: 'new', expectedRevision: revision('old'), currentRevision: async () => revision('old'), validate: () => {}, workspaceId: '../escape', tenantId: 't', authority: 'ready' })).rejects.toMatchObject({ code: 'scope' });
  });
});
