import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  buildScript,
  executables,
  failureDetail,
  preserveOutputs,
  root,
  run,
  runtimeOut,
  shellQuote,
  sourceOut,
} from './broker-build-test-helpers.mjs';

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

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

    await t.test('preserves published outputs when staged C tests fail after compilation', async () => {
      await rm(sourceOut, { recursive: true, force: true });
      await rm(runtimeOut, { recursive: true, force: true });
      const realCc = run('sh', ['-c', 'command -v cc']).stdout.trim();
      assert.ok(realCc, 'test host must expose a C compiler on PATH');
      const toolDir = await mkdtemp(resolve(tmpdir(), 'entity-broker-failing-test-'));
      const wrapper = resolve(toolDir, 'failing-test-cc');
      const stub = resolve(toolDir, 'fail.c');
      await writeFile(
        wrapper,
        `#!/bin/sh\nfor arg in "$@"; do\n  case "$arg" in *test_managed_storage_broker.c*)\n    out=""; prev=""\n    for a in "$@"; do\n      if [ "$prev" = "-o" ]; then out="$a"; fi\n      prev="$a"\n    done\n    printf 'int main(void) { return 1; }\\n' > ${shellQuote(stub)}\n    exec ${shellQuote(realCc)} ${shellQuote(stub)} -o "$out"\n    ;; esac\ndone\nexec ${shellQuote(realCc)} "$@"\n`,
      );
      await chmod(wrapper, 0o755);
      try {
        const successful = run(process.execPath, [buildScript]);
        assert.equal(successful.status, 0, failureDetail(successful));
        const before = await Promise.all(executables.map((path) => readFile(path)));
        const result = run(process.execPath, [buildScript], {
          env: { ...process.env, CC: wrapper },
        });
        assert.notEqual(result.status, 0, 'failing staged C tests must fail the broker build');
        const after = await Promise.all(executables.map((path) => readFile(path)));
        assert.deepEqual(after, before, 'failed staging must not replace published broker outputs');
        const leftovers = (await readdir(sourceOut)).filter((entry) => entry.includes('.tmp-'));
        assert.deepEqual(leftovers, [], 'staging temps must be cleaned up after failure');
      } finally {
        await rm(toolDir, { recursive: true, force: true });
      }
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

    await t.test('rejects a symlinked runtime intermediate directory without writing through it', async () => {
      await rm(runtimeOut, { recursive: true, force: true });
      const runtimeBrokerDir = dirname(runtimeOut);
      await rm(runtimeBrokerDir, { recursive: true, force: true });
      await mkdir(dirname(runtimeBrokerDir), { recursive: true });
      const target = await mkdtemp(resolve(tmpdir(), 'entity-runtime-symlink-target-'));
      await symlink(target, runtimeBrokerDir, 'dir');
      try {
        const result = run(process.execPath, [buildScript]);
        assert.notEqual(result.status, 0, 'symlinked runtime broker directory must fail closed');
        assert.match(result.stderr, /Unsafe broker (output component|build base)/);
        assert.deepEqual(await readdir(target), [], `symlink target was modified:\n${failureDetail(result)}`);
      } finally {
        await rm(runtimeBrokerDir, { force: true });
        await rm(target, { recursive: true, force: true });
        await mkdir(dirname(runtimeBrokerDir), { recursive: true });
      }
    });

    await t.test('rejects a symlinked C source and publishes nothing', async () => {
      await rm(sourceOut, { recursive: true, force: true });
      await rm(runtimeOut, { recursive: true, force: true });
      const corePath = resolve(root, 'packages/server/native/managed-storage-broker/managed_storage_broker.c');
      const original = await readFile(corePath);
      const originalMode = (await stat(corePath)).mode & 0o777;
      const sourceDir = await mkdtemp(resolve(tmpdir(), 'entity-broker-source-'));
      const realCopy = resolve(sourceDir, 'managed_storage_broker.c');
      await writeFile(realCopy, original);
      await rm(corePath);
      await symlink(realCopy, corePath, 'file');
      try {
        const result = run(process.execPath, [buildScript]);
        assert.notEqual(result.status, 0, 'symlinked broker source must fail closed');
        assert.match(result.stderr, /Unsafe broker source/);
        assert.equal(existsSync(resolve(sourceOut, 'broker')), false, 'no broker may be published');
        assert.equal(existsSync(resolve(runtimeOut, 'broker')), false, 'no runtime broker may be published');
      } finally {
        await rm(corePath, { force: true });
        await writeFile(corePath, original, { mode: originalMode });
        await chmod(corePath, originalMode);
        await rm(sourceDir, { recursive: true, force: true });
      }
    });

    await t.test('rejects a non-regular final output and cannot be redirected through it', async () => {
      await rm(sourceOut, { recursive: true, force: true });
      await rm(runtimeOut, { recursive: true, force: true });
      const guardDir = await mkdtemp(resolve(tmpdir(), 'entity-broker-final-guard-'));
      const canary = resolve(guardDir, 'canary');
      await writeFile(canary, 'do not touch');
      await mkdir(sourceOut, { recursive: true });
      await symlink(canary, resolve(sourceOut, 'broker'), 'file');
      try {
        const result = run(process.execPath, [buildScript]);
        assert.notEqual(result.status, 0, 'symlinked final broker output must fail closed');
        assert.match(result.stderr, /Unsafe broker output/);
        assert.equal(await readFile(canary, 'utf8'), 'do not touch', 'write was redirected through the symlinked final path');
        assert.equal(existsSync(resolve(runtimeOut, 'broker')), false, 'no runtime broker may be published');
      } finally {
        await rm(sourceOut, { recursive: true, force: true });
        await rm(guardDir, { recursive: true, force: true });
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
