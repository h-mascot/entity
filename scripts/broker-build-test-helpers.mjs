import { copyFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Shared fixtures for the managed-storage broker build tests. Both the wiring
// suite (entity-build-broker-wiring.test.mjs) and the transaction/lock suite
// (entity-build-broker-transaction.test.mjs) spawn the real build script and
// must restore the exact prior repository artifacts afterwards.
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const buildScript = resolve(root, 'scripts/build-managed-storage-broker.mjs');
export const sourceOut = resolve(root, 'packages/server/native/managed-storage-broker/.build');
export const runtimeOut = resolve(root, 'packages/server/dist/server/native/managed-storage-broker/.build');
export const executables = [resolve(sourceOut, 'broker'), resolve(runtimeOut, 'broker')];
export const finalArtifacts = {
  object: resolve(sourceOut, 'managed_storage_broker.o'),
  test: resolve(sourceOut, 'test'),
  broker: resolve(sourceOut, 'broker'),
  runtime: resolve(runtimeOut, 'broker'),
};

// Transient names the build script owns: staging temps, transaction backups,
// lock-steal claims, the build lock itself, and the fs_guard helper's tombs,
// inner-swap/pre-delete canaries, and selftest scratch. Test fixtures never
// preserve or restore these between runs.
export function isTransientBuildName(name) {
  return (
    name === 'broker-build.lock' ||
    /\.tmp-|\.bak-|\.stale-|\.swapped-|\.outside-canary-|\.guard-tomb-|\.guard-inner-canary-|\.guard-predelete-canary-|\.guard-selftest-/.test(name)
  );
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

export function failureDetail(result) {
  return [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').slice(-8000);
}

export function shellQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

// Back up both broker output directories outside the repository so every
// adversarial subtest can replace, delete, or symlink their parent directories
// while the suite still restores the exact prior repository artifacts.
export async function preserveOutputs() {
  const backupRoots = [];
  const backedUp = [];
  for (const output of [sourceOut, runtimeOut]) {
    if (!existsSync(output)) continue;
    const backupRoot = await mkdtemp(resolve(tmpdir(), 'entity-broker-outputs-'));
    const backup = resolve(backupRoot, basename(output));
    await mkdir(backup);
    for (const entry of await readdir(output, { withFileTypes: true })) {
      if (!entry.isFile() || isTransientBuildName(entry.name)) continue;
      const info = await stat(resolve(output, entry.name));
      await copyFile(resolve(output, entry.name), resolve(backup, entry.name));
      await chmod(resolve(backup, entry.name), info.mode & 0o777);
    }
    await rm(output, { recursive: true, force: true });
    backupRoots.push(backupRoot);
    backedUp.push([output, backup]);
  }
  return async () => {
    for (const output of [sourceOut, runtimeOut]) {
      await rm(output, { recursive: true, force: true });
    }
    for (const [output, backup] of backedUp.reverse()) {
      await mkdir(output, { recursive: true });
      for (const entry of await readdir(backup, { withFileTypes: true })) {
        if (!entry.isFile() || isTransientBuildName(entry.name)) continue;
        const info = await stat(resolve(backup, entry.name));
        await copyFile(resolve(backup, entry.name), resolve(output, entry.name));
        await chmod(resolve(output, entry.name), info.mode & 0o777);
      }
    }
    for (const backupRoot of backupRoots) {
      await rm(backupRoot, { recursive: true, force: true });
    }
  };
}
