import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LocalRevision } from './file-watcher';
import { safeSave } from './safe-save';

const targetFor = (root: string, target: string, workspaceId = 'w', tenantId = 't') => ({ canonicalPath: target, approvedRoot: root, workspaceId, tenantId });

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
    await expect(safeSave({ target: targetFor(path.dirname(target), target), candidate: 'new', expectedRevision: revision('old'), currentRevision: async () => revision('changed'), validate: () => {}, authority: 'ready' })).rejects.toMatchObject({ code: 'stale' });
    expect(await readFile(target, 'utf8')).toBe('old');
  });

  it('validates separately, retains recovery, and reopens the replacement', async () => {
    const { target } = await fixture();
    let checks = 0;
    const result = await safeSave({ target: targetFor(path.dirname(target), target), candidate: 'new', expectedRevision: revision('old'), currentRevision: async () => { checks++; return revision(checks === 1 ? 'old' : 'new'); }, validate: (content) => { if (content.toString() !== 'new') throw new Error('bad'); }, authority: 'ready' });
    expect(await readFile(target, 'utf8')).toBe('new'); expect(await readFile(result.recoveryPath, 'utf8')).toBe('old'); expect(result.revision.token).toBe('new');
  });

  it.each(['candidate_written', 'candidate_validated', 'recovery_retained'] as const)('crash before replacement at %s leaves original valid', async (stage) => {
    const { target } = await fixture();
    await expect(safeSave({ target: targetFor(path.dirname(target), target), candidate: 'new', expectedRevision: revision('old'), currentRevision: async () => revision('old'), validate: () => {}, authority: 'ready', crashAt: stage })).rejects.toMatchObject({ code: 'crash' });
    expect(await readFile(target, 'utf8')).toBe('old');
  });

  it('fails closed for unknown or degraded authority and invalid scope', async () => {
    const { target } = await fixture();
    for (const authority of ['unknown', 'degraded'] as const) await expect(safeSave({ target: targetFor(path.dirname(target), target), candidate: 'new', expectedRevision: revision('old'), currentRevision: async () => revision('old'), validate: () => {}, authority })).rejects.toMatchObject({ code: 'authority' });
    await expect(safeSave({ target: { ...targetFor(path.dirname(target), target), approvedRoot: path.dirname(path.dirname(target)) }, candidate: 'new', expectedRevision: revision('old'), currentRevision: async () => revision('old'), validate: () => {}, authority: 'ready' })).rejects.toMatchObject({ code: 'scope' });
  });

  it('rejects a revision changed after inspection before replacement', async () => {
    const { root, target } = await fixture(); let checks = 0;
    await expect(safeSave({ target: targetFor(root, target), candidate: 'new', expectedRevision: revision('old'), currentRevision: async () => {
      checks++; if (checks === 2) return revision('changed'); return revision('old');
    }, validate: () => {}, authority: 'ready' })).rejects.toMatchObject({ code: 'stale' });
    expect(await readFile(target, 'utf8')).toBe('old');
  });
});
