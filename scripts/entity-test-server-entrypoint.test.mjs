import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  executables,
  failureDetail,
  preserveOutputs,
  root,
  run,
  runtimeOut,
  sourceOut,
} from './broker-build-test-helpers.mjs';

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const brokerClientTestFile = 'src/fs/managed-storage-broker.test.ts';

test('root test:server is the supported server-test entry point with explicit broker prerequisites', async (t) => {
  const restoreOutputs = await preserveOutputs();
  try {
    await t.test('declares test:server with the broker build ordered before server tests', () => {
      const script = packageJson.scripts['test:server'];
      assert.ok(typeof script === 'string' && script.length > 0, 'root package.json must declare a supported test:server script');
      assert.match(
        script,
        /^node scripts\/build-managed-storage-broker\.mjs && npm --prefix packages\/server run test$/,
        'test:server must build the generated managed-storage broker outputs before running the server test suite',
      );
    });

    await t.test('server broker-client tests genuinely require the generated broker outputs', async () => {
      await rm(sourceOut, { recursive: true, force: true });
      await rm(runtimeOut, { recursive: true, force: true });
      const result = run('npm', ['--prefix', 'packages/server', 'run', 'test', '--', brokerClientTestFile]);
      assert.notEqual(result.status, 0, 'direct server tests must fail from absent generated broker outputs');
      assert.match(result.stdout, /failed/, 'the focused suite must report the failure');
    });

    await t.test('npm run test:server succeeds from absent generated broker outputs and repopulates them', async () => {
      await rm(sourceOut, { recursive: true, force: true });
      await rm(runtimeOut, { recursive: true, force: true });
      const result = run('npm', ['run', 'test:server', '--', brokerClientTestFile]);
      assert.equal(result.status, 0, `test:server must build prerequisites before server tests:\n${failureDetail(result)}`);
      for (const path of executables) {
        assert.ok(existsSync(path), `test:server must produce ${path}`);
      }
    });
  } finally {
    await restoreOutputs();
  }
});
