import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { hostname, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  buildScript,
  executables,
  failureDetail,
  finalArtifacts,
  isTransientBuildName,
  preserveOutputs,
  root,
  run,
  runtimeOut,
  shellQuote,
  sourceOut,
} from './broker-build-test-helpers.mjs';

const FAIL_AT = 'ENTITY_BROKER_BUILD_FAIL_AT';
const lockPath = resolve(sourceOut, 'broker-build.lock');
const snapshotLabels = ['snapshot-object', 'snapshot-test', 'snapshot-broker', 'snapshot-runtime'];
const publishLabels = ['publish-object', 'publish-test', 'publish-broker', 'publish-runtime'];
const rollbackLabels = ['rollback-object', 'rollback-test', 'rollback-broker', 'rollback-runtime'];
const artifactPaths = Object.values(finalArtifacts);

function buildWithInjection(labels, extraEnv = {}) {
  return run(process.execPath, [buildScript], {
    env: { ...process.env, [FAIL_AT]: labels.join(','), ...extraEnv },
  });
}

async function readArtifacts(paths = artifactPaths) {
  return Promise.all(paths.map((path) => readFile(path)));
}

async function freshOutputs() {
  await rm(sourceOut, { recursive: true, force: true });
  await rm(runtimeOut, { recursive: true, force: true });
}

async function assertNoTransientDebris(context) {
  for (const dir of [sourceOut, runtimeOut]) {
    const debris = (await readdir(dir)).filter((name) => isTransientBuildName(name));
    assert.deepEqual(debris, [], `${context} must leave no transient build debris in ${dir}`);
  }
}

async function writeLockRecord(record) {
  await writeFile(lockPath, `${JSON.stringify(record)}\n`);
}

async function exitedChildPid() {
  const child = run(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(child.status, 0, 'helper child must exit cleanly');
  // The child has exited, so its pid is not a live build holder. Pid reuse on
  // this host within the test window is negligible.
  return child.pid;
}

const sleep = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

// The holder build is spawned as its own process group/session leader whenever
// the platform supports it, so cleanup can signal the COMPLETE descendant tree
// (the blocking compiler wrapper is a grandchild of this test process and must
// never outlive the fixture — an orphaned wrapper holding the inherited stdio
// pipes would keep the whole test runner alive after the TAP summary).
const supportsProcessGroups = process.platform !== 'win32';

function spawnHolderBuild(env) {
  return spawn(process.execPath, [buildScript], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: supportsProcessGroups,
  });
}

// Deterministic teardown on EVERY path: release the gate file the blocking
// compiler waits on, bounded-wait for a clean close, then escalate SIGTERM and
// SIGKILL to the holder's whole process group, and finally destroy the stdio
// streams so no descendant can pin the test runner's event loop. Resolves only
// once the holder has actually closed; rejects if the tree refuses to die.
async function settleHolderTree(holder, groupPid, goFile, closePromise, log) {
  await writeFile(goFile, 'release\n').catch(() => {});
  for (const [signal, graceMs] of [[null, 15_000], ['SIGTERM', 5_000], ['SIGKILL', 5_000]]) {
    const closed = await Promise.race([closePromise.then(() => true), sleep(graceMs).then(() => false)]);
    if (closed) {
      holder.stdout?.destroy();
      holder.stderr?.destroy();
      return;
    }
    if (signal) {
      try {
        if (supportsProcessGroups) process.kill(-groupPid, signal);
        else holder.kill(signal);
      } catch {
        // tree already gone; the next bounded wait observes the close
      }
    }
  }
  holder.stdout?.destroy();
  holder.stderr?.destroy();
  const closed = await Promise.race([closePromise.then(() => true), sleep(2_000).then(() => false)]);
  if (!closed) throw new Error(`holder build process tree refused to terminate:\n${log()}`);
}

test('broker publication is a coherent transaction guarded by an exclusive build lock', { timeout: 300_000 }, async (t) => {
  const restoreOutputs = await preserveOutputs();
  try {
    await t.test('restores every published artifact to the prior generation when publication fails at any boundary', async () => {
      await freshOutputs();
      const seeded = run(process.execPath, [buildScript]);
      assert.equal(seeded.status, 0, `seed build failed:\n${failureDetail(seeded)}`);
      const priorGeneration = await readArtifacts();
      for (const label of publishLabels) {
        const result = buildWithInjection([label]);
        assert.notEqual(result.status, 0, `${label} must fail the build:\n${failureDetail(result)}`);
        assert.deepEqual(await readArtifacts(), priorGeneration, `${label} must restore the prior generation`);
        await assertNoTransientDebris(label);
        assert.equal(existsSync(lockPath), false, `${label} must release the build lock`);
      }
    });

    await t.test('publishes nothing when publication fails with no prior generation', async () => {
      for (const label of publishLabels) {
        await freshOutputs();
        const result = buildWithInjection([label]);
        assert.notEqual(result.status, 0, `${label} must fail the build:\n${failureDetail(result)}`);
        for (const path of artifactPaths) {
          assert.equal(existsSync(path), false, `${label} must not publish ${path}`);
        }
      }
    });

    await t.test('snapshot failure leaves the prior generation untouched with no debris', async () => {
      await freshOutputs();
      const seeded = run(process.execPath, [buildScript]);
      assert.equal(seeded.status, 0, `seed build failed:\n${failureDetail(seeded)}`);
      const priorGeneration = await readArtifacts();
      for (const label of snapshotLabels) {
        const result = buildWithInjection([label]);
        assert.notEqual(result.status, 0, `${label} must fail the build:\n${failureDetail(result)}`);
        assert.deepEqual(await readArtifacts(), priorGeneration, `${label} must not alter the prior generation`);
        await assertNoTransientDebris(label);
      }
    });

    await t.test('reports rollback failures loudly instead of claiming success', async () => {
      await freshOutputs();
      const seeded = run(process.execPath, [buildScript]);
      assert.equal(seeded.status, 0, `seed build failed:\n${failureDetail(seeded)}`);
      // Fails publication after the object rename, then fails the object
      // rollback: the run must report an incomplete rollback, keep forensic
      // backups, and still release the lock.
      const result = buildWithInjection(['publish-test', 'rollback-object']);
      assert.notEqual(result.status, 0, `injected rollback failure must fail the build:\n${failureDetail(result)}`);
      assert.match(result.stderr, /rollback incomplete/i, `stderr must report the incomplete rollback:\n${failureDetail(result)}`);
      const sourceDebris = (await readdir(sourceOut)).filter((name) => /\.bak-/.test(name));
      assert.ok(sourceDebris.length > 0, 'forensic backups must be kept when rollback fails');
      assert.equal(existsSync(lockPath), false, 'lock must be released even when rollback fails');
    });

    await t.test('rejects unknown fault-injection labels without publishing', async () => {
      await freshOutputs();
      const result = buildWithInjection(['definitely-not-a-label']);
      assert.notEqual(result.status, 0, 'unknown injection label must fail the build');
      assert.match(result.stderr, /ENTITY_BROKER_BUILD_FAIL_AT|unknown/i);
      for (const path of artifactPaths) {
        assert.equal(existsSync(path), false, `unknown label must not publish ${path}`);
      }
    });

    await t.test('holds an exclusive lock across staging and publication', { timeout: 120_000 }, async () => {
      await freshOutputs();
      const realCc = run('sh', ['-c', 'command -v cc']).stdout.trim();
      assert.ok(realCc, 'test host must expose a C compiler on PATH');
      const toolDir = await mkdtemp(resolve(tmpdir(), 'entity-broker-lock-'));
      const goFile = resolve(toolDir, 'go');
      const blockingCc = resolve(toolDir, 'blocking-cc');
      await writeFile(
        blockingCc,
        `#!/bin/sh\nwhile [ ! -f ${shellQuote(goFile)} ]; do sleep 0.05; done\nexec ${shellQuote(realCc)} "$@"\n`,
      );
      await chmod(blockingCc, 0o755);
      const holder = spawnHolderBuild({ CC: blockingCc });
      const holderGroupPid = holder.pid;
      let holderLog = '';
      const holderClosed = new Promise((resolveClose) => {
        holder.once('close', (code, signal) => resolveClose({ code, signal }));
      });
      holder.stdout.setEncoding('utf8');
      holder.stderr.setEncoding('utf8');
      holder.stdout.on('data', (chunk) => {
        holderLog += chunk;
      });
      holder.stderr.on('data', (chunk) => {
        holderLog += chunk;
      });
      const settle = () => settleHolderTree(holder, holderGroupPid, goFile, holderClosed, () => holderLog);
      try {
        const deadline = Date.now() + 30_000;
        while (!existsSync(lockPath)) {
          if (holder.exitCode !== null) throw new Error(`holder build exited before acquiring the lock:\n${holderLog}`);
          if (Date.now() > deadline) {
            // Kill the entire holder tree BEFORE throwing so the blocking
            // compiler descendant can never outlive this subtest.
            try {
              if (supportsProcessGroups) process.kill(-holderGroupPid, 'SIGKILL');
              else holder.kill('SIGKILL');
            } catch {
              // already gone
            }
            throw new Error(`holder build never acquired the lock:\n${holderLog}`);
          }
          await sleep(50);
        }
        // A second build while the holder is blocked in staging must fail fast
        // without acquiring the lock, compiling, or touching any artifact.
        const contender = run(process.execPath, [buildScript]);
        assert.notEqual(contender.status, 0, 'concurrent build must be rejected by the lock');
        assert.match(
          contender.stderr,
          /held by another broker build|another broker build/i,
          `contention must be reported clearly:\n${failureDetail(contender)}`,
        );
        assert.equal(existsSync(lockPath), true, 'contender must not remove the holder lock');
        for (const path of artifactPaths) {
          assert.equal(existsSync(path), false, `contender must not publish ${path}`);
        }
        await writeFile(goFile, 'release\n');
        await settle();
        assert.equal(holder.exitCode, 0, `holder build failed:\n${holderLog}`);
        assert.equal(holder.signal ?? null, null, `holder build was signaled:\n${holderLog}`);
        assert.equal(existsSync(lockPath), false, 'holder must release the lock after publishing');
        const [sourceBroker, runtimeBroker] = await Promise.all(executables.map((path) => readFile(path)));
        assert.deepEqual(sourceBroker, runtimeBroker, 'source and runtime broker must be byte-identical after success');
        for (const executable of executables) {
          await access(executable, constants.X_OK);
        }
      } finally {
        await settle();
        await rm(toolDir, { recursive: true, force: true });
      }
    });

    await t.test('recovers a stale lock left by a dead same-host build', async () => {
      await freshOutputs();
      await mkdir(sourceOut, { recursive: true });
      await writeLockRecord({
        pid: await exitedChildPid(),
        hostname: hostname(),
        startedAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const result = run(process.execPath, [buildScript]);
      assert.equal(result.status, 0, `stale lock must be stolen, not fatal:\n${failureDetail(result)}`);
      assert.equal(existsSync(lockPath), false, 'released lock must be removed after the successful build');
      for (const path of artifactPaths) {
        assert.equal(existsSync(path), true, `stale recovery must still publish ${path}`);
      }
    });

    await t.test('fails closed on a live-pid lock, a foreign-host lock, and a corrupt lock', async () => {
      const cases = [
        {
          name: 'live pid',
          record: { pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() },
        },
        {
          name: 'foreign host',
          record: { pid: await exitedChildPid(), hostname: 'definitely-not-this-host', startedAt: new Date().toISOString() },
        },
      ];
      for (const { name, record } of cases) {
        await freshOutputs();
        await mkdir(sourceOut, { recursive: true });
        await writeLockRecord(record);
        const result = run(process.execPath, [buildScript]);
        assert.notEqual(result.status, 0, `${name} lock must fail closed`);
        assert.match(result.stderr, /held by another broker build/i, `${name} contention must be reported:\n${failureDetail(result)}`);
        assert.equal(await readFile(lockPath, 'utf8'), `${JSON.stringify(record)}\n`, `${name} lock must be left untouched`);
        for (const path of artifactPaths) {
          assert.equal(existsSync(path), false, `${name} lock must not publish ${path}`);
        }
      }
      await freshOutputs();
      await mkdir(sourceOut, { recursive: true });
      await writeFile(lockPath, 'this is not broker lock JSON\n');
      const corrupt = run(process.execPath, [buildScript]);
      assert.notEqual(corrupt.status, 0, 'corrupt lock must fail closed');
      assert.equal(await readFile(lockPath, 'utf8'), 'this is not broker lock JSON\n', 'corrupt lock must be left untouched');
    });

    await t.test('removes the lock after a failed build', async () => {
      await freshOutputs();
      const result = run(process.execPath, [buildScript], {
        env: { ...process.env, CC: resolve(tmpdir(), 'entity-definitely-missing-cc') },
      });
      assert.notEqual(result.status, 0, 'missing CC must fail the broker build');
      assert.equal(existsSync(lockPath), false, 'failed build must release the lock');
    });

    await t.test('fails closed on a symlinked lock path', async () => {
      await freshOutputs();
      await mkdir(sourceOut, { recursive: true });
      const guardDir = await mkdtemp(resolve(tmpdir(), 'entity-broker-lock-guard-'));
      const canary = resolve(guardDir, 'canary');
      await writeFile(canary, 'do not touch');
      await symlink(canary, lockPath, 'file');
      try {
        const result = run(process.execPath, [buildScript]);
        assert.notEqual(result.status, 0, 'symlinked lock path must fail closed');
        assert.match(result.stderr, /Unsafe broker build lock/);
        assert.equal(await readFile(canary, 'utf8'), 'do not touch', 'lock symlink must not be followed');
      } finally {
        await rm(lockPath, { force: true });
        await rm(guardDir, { recursive: true, force: true });
      }
    });
  } finally {
    await restoreOutputs();
  }
});
