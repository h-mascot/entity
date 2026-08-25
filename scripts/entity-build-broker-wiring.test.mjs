import assert from 'node:assert/strict';
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const buildScript = resolve(root, 'scripts/build-managed-storage-broker.mjs');
const sourceOut = resolve(root, 'packages/server/native/managed-storage-broker/.build');
const runtimeOut = resolve(root, 'packages/server/dist/server/native/managed-storage-broker/.build');
const executables = [resolve(sourceOut, 'broker'), resolve(runtimeOut, 'broker')];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

function failureDetail(result) {
  return [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').slice(-8000);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function preserveOutputs() {
  const backups = [];
  for (const output of [sourceOut, runtimeOut]) {
    const backup = `${output}.entity-test-backup-${process.pid}`;
    await rm(backup, { recursive: true, force: true });
    if (existsSync(output)) {
      await rename(output, backup);
      backups.push([output, backup]);
    }
  }
  return async () => {
    for (const output of [sourceOut, runtimeOut]) {
      await rm(output, { recursive: true, force: true });
    }
    for (const [output, backup] of backups.reverse()) {
      await rename(backup, output);
    }
  };
}

test('clean root build owns a portable, fail-closed managed-storage broker build', async (t) => {
  const restoreOutputs = await preserveOutputs();
  try {
    await t.test('wires the broker after TypeScript server build', () => {
      assert.match(
        packageJson.scripts.build,
        /packages\/server run build && node scripts\/build-managed-storage-broker\.mjs$/,
        'npm run build must create the native broker after server compilation',
      );
    });

    await t.test('honors CC, fails closed, and preserves published outputs on compiler failure', async () => {
      await rm(sourceOut, { recursive: true, force: true });
      await rm(runtimeOut, { recursive: true, force: true });
      const successful = run(process.execPath, [buildScript]);
      assert.equal(successful.status, 0, failureDetail(successful));
      const before = await Promise.all(executables.map((path) => readFile(path)));
      const result = run(process.execPath, [buildScript], {
        env: { ...process.env, CC: resolve(tmpdir(), 'entity-definitely-missing-cc') },
      });
      assert.notEqual(result.status, 0, 'missing CC must fail the broker build');
      const after = await Promise.all(executables.map((path) => readFile(path)));
      assert.deepEqual(after, before, 'failed staging must not replace published broker outputs');
    });

    await t.test('rejects a symlinked output directory without writing through it', async () => {
      await rm(sourceOut, { recursive: true, force: true });
      const target = await mkdtemp(resolve(tmpdir(), 'entity-broker-symlink-target-'));
      await symlink(target, sourceOut, 'dir');
      try {
        const result = run(process.execPath, [buildScript]);
        assert.notEqual(result.status, 0, 'symlinked broker output must fail closed');
        assert.deepEqual(await readdir(target), [], `symlink target was modified:\n${failureDetail(result)}`);
      } finally {
        await rm(sourceOut, { force: true });
        await rm(target, { recursive: true, force: true });
      }
    });

    await t.test('observes server-build completion before broker compilation in a clean root build', async () => {
      await rm(sourceOut, { recursive: true, force: true });
      await rm(runtimeOut, { recursive: true, force: true });
      const realNpm = run('sh', ['-c', 'command -v npm']).stdout.trim();
      const realCc = run('sh', ['-c', 'command -v cc']).stdout.trim();
      assert.ok(realNpm, 'test host must expose npm on PATH');
      assert.ok(realCc, 'test host must expose a C compiler on PATH');

      const toolDir = await mkdtemp(resolve(tmpdir(), 'entity-build-order-'));
      const npmWrapper = resolve(toolDir, 'npm');
      const ccWrapper = resolve(toolDir, 'controlled-cc');
      const phaseLog = resolve(toolDir, 'phases.log');
      await writeFile(
        npmWrapper,
        `#!/bin/sh\n${shellQuote(realNpm)} "$@"\nstatus=$?\nif [ "$status" -eq 0 ] && [ "$1" = "--prefix" ] && [ "$2" = "packages/server" ] && [ "$3" = "run" ] && [ "$4" = "build" ]; then printf '%s\\n' server-complete >> ${shellQuote(phaseLog)}; fi\nexit "$status"\n`,
      );
      await writeFile(
        ccWrapper,
        `#!/bin/sh\nprintf '%s\\n' broker-compiler >> ${shellQuote(phaseLog)}\nexec ${shellQuote(realCc)} "$@"\n`,
      );
      await chmod(npmWrapper, 0o755);
      await chmod(ccWrapper, 0o755);
      try {
        const result = run(realNpm, ['run', 'build'], {
          env: {
            ...process.env,
            PATH: `${toolDir}:${process.env.PATH ?? ''}`,
            CC: ccWrapper,
          },
        });
        assert.equal(result.status, 0, `clean root build failed:\n${failureDetail(result)}`);
        const phases = (await readFile(phaseLog, 'utf8')).trim().split('\n');
        const serverComplete = phases.indexOf('server-complete');
        const brokerCompile = phases.indexOf('broker-compiler');
        assert.ok(serverComplete >= 0, `server completion was not observed: ${phases}`);
        assert.ok(brokerCompile > serverComplete, `broker compiled before server build completed: ${phases}`);
        for (const executable of executables) {
          await access(executable, constants.X_OK);
          const info = await stat(executable);
          assert.equal(info.isFile(), true, `${executable} must be a regular file`);
          assert.notEqual(info.mode & 0o111, 0, `${executable} must be executable`);
        }
      } finally {
        await rm(toolDir, { recursive: true, force: true });
      }
    });
  } finally {
    await restoreOutputs();
  }
});
