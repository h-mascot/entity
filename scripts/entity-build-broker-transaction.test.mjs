import assert from 'node:assert/strict';
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { hostname, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
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

test('unexpected final-artifact entries fail closed and are never replaced', { timeout: 120_000 }, async (t) => {
  // existsSync() follows symlinks, so a DANGLING symlink at a final-artifact
  // path used to read as "absent" and publication renamed over it. Every
  // unexpected entry — dangling or pointing elsewhere — must fail the build
  // closed with the entry left byte-identical and nothing published.
  const restoreOutputs = await preserveOutputs();
  try {
    for (const flavor of ['dangling', 'pointing']) {
      await t.test(`preserves a ${flavor} symlink at each final artifact path`, async () => {
        for (const [name, path] of Object.entries(finalArtifacts)) {
          await freshOutputs();
          await mkdir(sourceOut, { recursive: true });
          await mkdir(runtimeOut, { recursive: true });
          const guardDir = await mkdtemp(resolve(tmpdir(), `entity-broker-final-${flavor}-`));
          const target = resolve(guardDir, flavor === 'dangling' ? 'definitely-missing' : 'canary');
          if (flavor === 'pointing') await writeFile(target, 'do not touch');
          await symlink(target, path, 'file');
          try {
            const result = run(process.execPath, [buildScript]);
            assert.notEqual(result.status, 0, `${name} (${flavor} symlink) must fail closed:
${failureDetail(result)}`);
            assert.match(result.stderr, /Unsafe broker output/, `${name} (${flavor}) must report the unsafe output:\n${failureDetail(result)}`);
            const entry = await lstat(path);
            assert.equal(entry.isSymbolicLink(), true, `${name} entry must remain a symlink`);
            assert.equal(await readlink(path), target, `${name} symlink target must be unchanged`);
            if (flavor === 'pointing') {
              assert.equal(await readFile(target, 'utf8'), 'do not touch', `${name} canary must be untouched`);
            }
            for (const [otherName, otherPath] of Object.entries(finalArtifacts)) {
              if (otherName === name) continue;
              assert.equal(existsSync(otherPath), false, `${otherName} must not be published`);
            }
            assert.equal(existsSync(lockPath), false, 'lock must be released');
          } finally {
            await rm(path, { force: true });
            await rm(guardDir, { recursive: true, force: true });
          }
        }
      });
    }
  } finally {
    await restoreOutputs();
  }
});

test('publish and rollback fail closed on unexpected swaps, preserving outside canaries', { timeout: 300_000 }, async (t) => {
  // The build script's test-only swap hooks simulate an external actor that
  // replaces a final artifact (or its whole parent directory) immediately
  // before a guarded publish/rollback boundary. Every case must fail closed
  // with the unexpected entry left byte-identical, never replaced or removed.
  const restoreOutputs = await preserveOutputs();
  const canaryPattern = (phase, artifact) => new RegExp(`^outside-canary-${phase}-${artifact}-.+\n$`);
  try {
    await t.test('publish: an unexpected replacement of the first artifact is never re-replaced', async () => {
      await freshOutputs();
      const seeded = run(process.execPath, [buildScript]);
      assert.equal(seeded.status, 0, `seed build failed:\n${failureDetail(seeded)}`);
      const priorGeneration = await readArtifacts();
      const result = buildWithInjection([], { ENTITY_BROKER_BUILD_SWAP_AT: 'object' });
      assert.notEqual(result.status, 0, `swapped object must fail the build:\n${failureDetail(result)}`);
      assert.match(result.stderr, /refusing to replace an unexpected entry|rollback incomplete/i);
      assert.match(await readFile(finalArtifacts.object, 'utf8'), canaryPattern('publish', 'object'), 'canary must survive at the object final path');
      const [object, ...rest] = await readArtifacts();
      assert.deepEqual(rest, priorGeneration.slice(1), 'test/broker/runtime must keep the prior generation');
      const sourceDebris = (await readdir(sourceOut)).filter((name) => name.includes('.bak-'));
      assert.ok(sourceDebris.length > 0, 'forensic backups must be kept while a final is in an unexpected state');
      assert.equal(existsSync(lockPath), false, 'lock must be released');
    });

    await t.test('publish: a swapped last artifact keeps its canary and restores the rest', async () => {
      await freshOutputs();
      const seeded = run(process.execPath, [buildScript]);
      assert.equal(seeded.status, 0, `seed build failed:\n${failureDetail(seeded)}`);
      const priorGeneration = await readArtifacts();
      const result = buildWithInjection([], { ENTITY_BROKER_BUILD_SWAP_AT: 'runtime' });
      assert.notEqual(result.status, 0, `swapped runtime must fail the build:\n${failureDetail(result)}`);
      assert.match(result.stderr, /refusing to replace an unexpected entry|rollback incomplete/i);
      const [object, test, broker, runtime] = await readArtifacts();
      assert.deepEqual([object, test, broker], priorGeneration.slice(0, 3), 'source artifacts must be restored to the prior generation');
      assert.match(await readFile(finalArtifacts.runtime, 'utf8'), canaryPattern('publish', 'runtime'), 'runtime canary must survive');
      assert.deepEqual((await readdir(sourceOut)).filter((name) => name.includes('.bak-')), [], 'restored source backups must be dropped');
      assert.ok((await readdir(runtimeOut)).some((name) => name.includes('.bak-')), 'runtime forensic backup must be kept');
      assert.equal(existsSync(lockPath), false, 'lock must be released');
    });

    await t.test('publish: an artifact appearing at an absent final path is never replaced', async () => {
      await freshOutputs();
      const result = buildWithInjection([], { ENTITY_BROKER_BUILD_SWAP_AT: 'object' });
      assert.notEqual(result.status, 0, `appeared object must fail the build:\n${failureDetail(result)}`);
      assert.match(result.stderr, /appeared after snapshot|refusing to replace an unexpected entry/i);
      assert.match(await readFile(finalArtifacts.object, 'utf8'), canaryPattern('publish', 'object'), 'appeared canary must survive untouched');
      for (const [name, path] of Object.entries(finalArtifacts)) {
        if (name === 'object') continue;
        assert.equal(existsSync(path), false, `${name} must not be published`);
      }
      assert.deepEqual((await readdir(sourceOut)).filter((name) => name.includes('.bak-')), [], 'no backups exist to keep');
      assert.equal(existsSync(lockPath), false, 'lock must be released');
    });

    await t.test('rollback: an unexpected replacement of a published artifact is never overwritten or removed', async () => {
      await freshOutputs();
      const seeded = run(process.execPath, [buildScript]);
      assert.equal(seeded.status, 0, `seed build failed:\n${failureDetail(seeded)}`);
      const priorGeneration = await readArtifacts();
      const result = buildWithInjection(['publish-test'], { ENTITY_BROKER_BUILD_SWAP_AT_ROLLBACK: 'object' });
      assert.notEqual(result.status, 0, `rollback swap must fail the build:\n${failureDetail(result)}`);
      assert.match(result.stderr, /rollback incomplete/i, 'the incomplete rollback must be reported loudly');
      assert.match(await readFile(finalArtifacts.object, 'utf8'), canaryPattern('rollback', 'object'), 'rollback canary must survive untouched');
      const [object, test, broker, runtime] = await readArtifacts();
      assert.deepEqual([test, broker, runtime], priorGeneration.slice(1), 'unpublished artifacts must keep the prior generation');
      assert.ok((await readdir(sourceOut)).some((name) => name.includes('.bak-')), 'forensic backups must be kept');
      assert.equal(existsSync(lockPath), false, 'lock must be released even after the failed rollback');
    });

    await t.test('publish: a swapped parent directory fails closed without publishing into it', async () => {
      await freshOutputs();
      const seeded = run(process.execPath, [buildScript]);
      assert.equal(seeded.status, 0, `seed build failed:\n${failureDetail(seeded)}`);
      const priorGeneration = await readArtifacts();
      const result = buildWithInjection([], { ENTITY_BROKER_BUILD_SWAP_DIR_AT: 'runtime' });
      assert.notEqual(result.status, 0, `swapped runtime directory must fail the build:\n${failureDetail(result)}`);
      assert.match(result.stderr, /directory identity changed|rollback incomplete/i);
      // The replacement directory at the old path must stay empty...
      assert.deepEqual(await readdir(runtimeOut), [], 'nothing may be published into the replacement directory');
      // ...the real directory survives under the swap name with the prior
      // generation and its forensic backup intact.
      const moved = (await readdir(dirname(runtimeOut))).filter((name) => name.includes('.swapped-'));
      assert.equal(moved.length, 1, `the real runtime directory must survive exactly once: ${moved}`);
      const movedOut = resolve(dirname(runtimeOut), moved[0]);
      assert.deepEqual(await readFile(resolve(movedOut, 'broker')), priorGeneration[3], 'prior runtime generation must survive in the moved directory');
      assert.ok((await readdir(movedOut)).some((name) => name.includes('.bak-')), 'runtime forensic backup must survive in the moved directory');
      const [object, test, broker] = await Promise.all(
        [finalArtifacts.object, finalArtifacts.test, finalArtifacts.broker].map((path) => readFile(path)),
      );
      assert.deepEqual([object, test, broker], priorGeneration.slice(0, 3), 'source artifacts must be restored to the prior generation');
      await rm(movedOut, { recursive: true, force: true });
      assert.equal(existsSync(lockPath), false, 'lock must be released');
    });

    await t.test('swap hooks reject unknown artifact names without publishing', async () => {
      await freshOutputs();
      const result = buildWithInjection([], { ENTITY_BROKER_BUILD_SWAP_AT: 'definitely-not-an-artifact' });
      assert.notEqual(result.status, 0, 'unknown swap hook artifact must fail the build');
      assert.match(result.stderr, /Unknown swap hook artifact/i);
      for (const path of artifactPaths) {
        assert.equal(existsSync(path), false, `unknown hook must not publish ${path}`);
      }
    });
  } finally {
    await restoreOutputs();
  }
});

test('native fs_guard helper: kernel-conditional mutations survive swaps inside the check→mutation interval', { timeout: 120_000 }, async (t) => {
  // Direct proof against the helper the build now uses for every guarded
  // mutation. The ENTITY_BROKER_GUARD_INNER_SWAP hook fires EXACTLY between
  // the helper's final ownership precheck and the mutation syscall — the
  // interval the previous unconditional renameSync/rmSync design left open.
  // The ENTITY_BROKER_GUARD_PRE_DELETE_SWAP hook fires between remove-owned's
  // tomb verification and the tomb's deletion — the post-verify/pre-delete
  // interval Luna generation 23 flagged. Every case must fail closed (or
  // succeed cleanly) with the injected canary byte-identical and nothing
  // unexpected removed.
  const realCc = run('sh', ['-c', 'command -v cc']).stdout.trim();
  assert.ok(realCc, 'test host must expose a C compiler on PATH');
  const toolDir = await mkdtemp(resolve(tmpdir(), 'entity-broker-fs-guard-'));
  const guardSource = resolve(root, 'packages/server/native/managed-storage-broker/fs_guard.c');
  const guardBin = resolve(toolDir, 'fs_guard');
  const scratch = resolve(toolDir, 'scratch');
  await mkdir(scratch);
  const compile = run(realCc, ['-std=c11', '-D_GNU_SOURCE', '-Wall', '-Wextra', '-Werror', '-pedantic', guardSource, '-o', guardBin]);
  assert.equal(compile.status, 0, `fs_guard must compile under the build's exact flags:\n${failureDetail(compile)}`);
  const dirStat = await stat(scratch);
  const dirArgs = [scratch, String(dirStat.dev), String(dirStat.ino)];
  const canaryOf = (token) => `inner-canary-${token}\n`;

  const guard = (args, innerSwap = null, preDeleteSwap = null) => {
    const env = { ...process.env };
    if (innerSwap !== null) env.ENTITY_BROKER_GUARD_INNER_SWAP = innerSwap;
    if (preDeleteSwap !== null) env.ENTITY_BROKER_GUARD_PRE_DELETE_SWAP = preDeleteSwap;
    const result = run(guardBin, args, { env });
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout.trim().split('\n').pop() ?? '');
    } catch {
      parsed = null;
    }
    return { result, parsed };
  };
  const ident = async (name) => {
    const info = await lstat(resolve(scratch, name));
    return [String(info.dev), String(info.ino)];
  };
  const write = async (name, content) => writeFile(resolve(scratch, name), content);
  const read = async (name) => readFile(resolve(scratch, name), 'utf8');

  try {
    await t.test('selftest proves the volume supports the kernel primitives', () => {
      const { result, parsed } = guard(['selftest', ...dirArgs]);
      assert.equal(result.status, 0, `selftest must pass:\n${failureDetail(result)}`);
      assert.equal(parsed.ok, true);
    });

    await t.test('clean exchange atomically swaps exactly the anchored identities', async () => {
      await write('a', 'content-A');
      await write('b', 'content-B');
      const { result } = guard(['exchange', ...dirArgs, 'a', ...(await ident('a')), 'b', ...(await ident('b'))]);
      assert.equal(result.status, 0, failureDetail(result));
      assert.equal(await read('a'), 'content-B');
      assert.equal(await read('b'), 'content-A');
    });

    await t.test('inner-interval swap of the final side is reversed; canary byte-identical', async () => {
      await write('a', 'staged');
      await write('b', 'prior');
      const token = 'publish-exchange:object';
      const { result, parsed } = guard(
        ['exchange', ...dirArgs, 'a', ...(await ident('a')), 'b', ...(await ident('b')), '--token', token],
        token,
      );
      assert.notEqual(result.status, 0, 'a swap inside the interval must fail the mutation');
      assert.equal(parsed.reason, 'identity-drift');
      assert.equal(parsed.recovered, true, 'the exchange must be reversed in place');
      assert.equal(await read('a'), 'staged', 'the staged side must be restored untouched');
      assert.equal(await read('b'), canaryOf(token), 'the canary must survive byte-identical at the final path');
    });

    await t.test('inner-interval swap of the temp side is reversed; canary byte-identical', async () => {
      await write('a', 'staged');
      await write('b', 'prior');
      const token = 'publish-exchange:test';
      const { result, parsed } = guard(
        ['exchange', ...dirArgs, 'a', ...(await ident('a')), 'b', ...(await ident('b')), '--token', token, '--hook-side', 'a'],
        token,
      );
      assert.notEqual(result.status, 0);
      assert.equal(parsed.recovered, true);
      assert.equal(await read('a'), canaryOf(token), 'canary preserved where it was placed');
      assert.equal(await read('b'), 'prior', 'final side untouched');
    });

    await t.test('link-absent is a kernel no-replace: an appearing entry is never replaced', async () => {
      await write('src', 'staged');
      const ok = guard(['link-absent', ...dirArgs, 'src', ...(await ident('src')), 'dst']);
      assert.equal(ok.result.status, 0, failureDetail(ok.result));
      assert.equal(await read('dst'), 'staged');
      const token = 'publish-link:object';
      const { result, parsed } = guard(
        ['link-absent', ...dirArgs, 'src', ...(await ident('src')), 'dst2', '--token', token],
        token,
      );
      assert.notEqual(result.status, 0);
      assert.equal(parsed.reason, 'dst-appeared');
      assert.equal(await read('dst2'), canaryOf(token), 'appeared canary must survive untouched');
      assert.equal(await read('src'), 'staged');
    });

    await t.test('remove-owned removes the verified inode and nothing else', async () => {
      await write('victim', 'mine');
      const { result } = guard(['remove-owned', ...dirArgs, 'victim', ...(await ident('victim'))]);
      assert.equal(result.status, 0, failureDetail(result));
      assert.equal(existsSync(resolve(scratch, 'victim')), false, 'the owned entry must be removed');
    });

    await t.test('inner-interval replacement is relocated then restored; never removed', async () => {
      await write('victim', 'mine');
      const token = 'rollback-remove:object';
      const { result, parsed } = guard(
        ['remove-owned', ...dirArgs, 'victim', ...(await ident('victim')), '--token', token],
        token,
      );
      assert.notEqual(result.status, 0, 'a replacement inside the interval must fail the removal');
      assert.equal(parsed.reason, 'replaced-and-restored');
      assert.equal(parsed.recovered, true);
      assert.equal(await read('victim'), canaryOf(token), 'the canary must remain byte-identical at its path');
    });

    await t.test('post-verify/pre-delete replacement of the tomb is restored; never unlinked', async () => {
      // The replacement lands AFTER remove-owned has verified the tomb
      // anchors exactly the expected inode and BEFORE the tomb is deleted.
      // The old code name-unlinked the tomb on the strength of that earlier
      // verification, destroying the replacement while the link-count audit
      // false-passed (the attacker's rename had already dropped the pinned
      // inode's link). The removal must instead fail closed with the
      // replacement restored byte-identically, the removal never reported as
      // succeeded, and no path deleted.
      await write('victim', 'mine');
      const pathsBefore = (await readdir(scratch)).sort();
      const token = 'rollback-remove:predelete';
      const { result, parsed } = guard(
        ['remove-owned', ...dirArgs, 'victim', ...(await ident('victim')), '--token', token],
        null,
        token,
      );
      assert.notEqual(result.status, 0, 'a replacement inside the post-verify/pre-delete interval must fail the removal');
      assert.equal(parsed.ok, false, 'the removal must never be falsely reported as succeeded');
      assert.equal(parsed.reason, 'replaced-and-restored');
      assert.equal(parsed.recovered, true);
      assert.equal(await read('victim'), `pre-delete-canary-${token}\n`, 'the injected replacement must survive byte-identically at its path');
      assert.deepEqual((await readdir(scratch)).sort(), pathsBefore, 'no unexpected path may be deleted or left behind');
    });

    await t.test('refuses wrong identities, foreign directories, and escaping names', async () => {
      await write('a', 'x');
      await write('b', 'y');
      const wrong = guard(['remove-owned', ...dirArgs, 'a', '1', '2']);
      assert.notEqual(wrong.result.status, 0);
      assert.equal(wrong.parsed.reason, 'identity');
      const foreignDir = guard(['exchange', scratch, '1', '2', 'a', '1', '1', 'b', '2', '2']);
      assert.notEqual(foreignDir.result.status, 0);
      assert.equal(foreignDir.parsed.reason, 'directory-identity');
      const escape = guard(['remove-owned', ...dirArgs, '../escape', '1', '2']);
      assert.notEqual(escape.result.status, 0, 'dirfd-escaping names must be rejected');
      assert.equal(await read('a'), 'x');
      assert.equal(await read('b'), 'y');
    });

    await t.test('leaves no debris', async () => {
      const debris = (await readdir(scratch)).filter((name) => name.startsWith('.guard-'));
      assert.deepEqual(debris, [], `guard helper must not leave tomb/canary debris: ${debris}`);
    });
  } finally {
    await rm(toolDir, { recursive: true, force: true });
  }
});

test('guarded publication and rollback defeat swaps injected inside the actual check→mutation interval', { timeout: 420_000 }, async (t) => {
  // Build-level integration of the fs_guard inner-interval hook: the swap
  // happens after the helper's final ownership check and before the mutation
  // syscall — the exact interval Luna generation 19 flagged. Every case must
  // fail closed with the outside canary byte-identical and no unexpected path
  // removed or overwritten.
  const restoreOutputs = await preserveOutputs();
  const innerCanary = (token) => `inner-canary-${token}\n`;
  const buildWithInnerSwap = (token, extraEnv = {}) =>
    run(process.execPath, [buildScript], {
      env: { ...process.env, ENTITY_BROKER_GUARD_INNER_SWAP: token, ...extraEnv },
    });
  try {
    await t.test('publish over an existing final: first artifact canary survives in place', async () => {
      await freshOutputs();
      const seeded = run(process.execPath, [buildScript]);
      assert.equal(seeded.status, 0, `seed build failed:\n${failureDetail(seeded)}`);
      const priorGeneration = await readArtifacts();
      const token = 'publish-exchange:object';
      const result = buildWithInnerSwap(token);
      assert.notEqual(result.status, 0, `inner-interval swap must fail the build:\n${failureDetail(result)}`);
      assert.match(result.stderr, /refusing to replace an unexpected entry|rollback incomplete/i);
      assert.equal(await readFile(finalArtifacts.object, 'utf8'), innerCanary(token), 'canary must survive byte-identical at the final path');
      const [, test, broker, runtime] = await readArtifacts();
      assert.deepEqual([test, broker, runtime], priorGeneration.slice(1), 'later artifacts must keep the prior generation');
      assert.ok((await readdir(sourceOut)).some((name) => name.includes('.bak-')), 'forensic backups must be kept');
      assert.equal(existsSync(lockPath), false, 'lock must be released');
    });

    await t.test('publish over an existing final: last artifact canary survives, rest restored', async () => {
      await freshOutputs();
      const seeded = run(process.execPath, [buildScript]);
      assert.equal(seeded.status, 0, `seed build failed:\n${failureDetail(seeded)}`);
      const priorGeneration = await readArtifacts();
      const token = 'publish-exchange:runtime';
      const result = buildWithInnerSwap(token);
      assert.notEqual(result.status, 0, `inner-interval swap must fail the build:\n${failureDetail(result)}`);
      assert.match(result.stderr, /refusing to replace an unexpected entry|rollback incomplete/i);
      assert.equal(await readFile(finalArtifacts.runtime, 'utf8'), innerCanary(token), 'runtime canary must survive byte-identical');
      const [object, test, broker] = await Promise.all(
        [finalArtifacts.object, finalArtifacts.test, finalArtifacts.broker].map((path) => readFile(path)),
      );
      assert.deepEqual([object, test, broker], priorGeneration.slice(0, 3), 'source artifacts must be restored to the prior generation');
      assert.deepEqual((await readdir(sourceOut)).filter((name) => name.includes('.bak-')), [], 'restored source backups must be dropped');
      assert.ok((await readdir(runtimeOut)).some((name) => name.includes('.bak-')), 'runtime forensic backup must be kept');
      assert.equal(existsSync(lockPath), false, 'lock must be released');
    });

    await t.test('publish onto an absent final: appearing canary is never replaced', async () => {
      await freshOutputs();
      const token = 'publish-link:object';
      const result = buildWithInnerSwap(token);
      assert.notEqual(result.status, 0, `inner-interval swap must fail the build:\n${failureDetail(result)}`);
      assert.match(result.stderr, /refusing to replace an unexpected entry/i);
      assert.equal(await readFile(finalArtifacts.object, 'utf8'), innerCanary(token), 'appearing canary must survive untouched');
      for (const [name, path] of Object.entries(finalArtifacts)) {
        if (name === 'object') continue;
        assert.equal(existsSync(path), false, `${name} must not be published`);
      }
      assert.equal(existsSync(lockPath), false, 'lock must be released');
    });

    await t.test('rollback restore: canary at the final path is never overwritten', async () => {
      await freshOutputs();
      const seeded = run(process.execPath, [buildScript]);
      assert.equal(seeded.status, 0, `seed build failed:\n${failureDetail(seeded)}`);
      const priorGeneration = await readArtifacts();
      const token = 'rollback-restore:object';
      const result = buildWithInnerSwap(token, { [FAIL_AT]: 'publish-test' });
      assert.notEqual(result.status, 0, `inner-interval rollback swap must fail the build:\n${failureDetail(result)}`);
      assert.match(result.stderr, /rollback incomplete/i);
      assert.equal(await readFile(finalArtifacts.object, 'utf8'), innerCanary(token), 'rollback canary must survive byte-identical at the final path');
      const [, test, broker, runtime] = await readArtifacts();
      assert.deepEqual([test, broker, runtime], priorGeneration.slice(1), 'unpublished artifacts must keep the prior generation');
      assert.ok((await readdir(sourceOut)).some((name) => name.includes('.bak-')), 'forensic backups must be kept');
      assert.equal(existsSync(lockPath), false, 'lock must be released');
    });

    await t.test('rollback removal of a newly published artifact: canary is never removed', async () => {
      await freshOutputs();
      const token = 'rollback-remove:object';
      const result = buildWithInnerSwap(token, { [FAIL_AT]: 'publish-test' });
      assert.notEqual(result.status, 0, `inner-interval rollback swap must fail the build:\n${failureDetail(result)}`);
      assert.match(result.stderr, /rollback incomplete/i);
      assert.equal(await readFile(finalArtifacts.object, 'utf8'), innerCanary(token), 'the canary must never be removed');
      for (const [name, path] of Object.entries(finalArtifacts)) {
        if (name === 'object') continue;
        assert.equal(existsSync(path), false, `${name} must not be published`);
      }
      assert.deepEqual((await readdir(sourceOut)).filter((name) => name.includes('.bak-')), [], 'no backups exist to keep');
      assert.equal(existsSync(lockPath), false, 'lock must be released');
    });

    await t.test('backup cleanup: canary placed on the backup path is preserved', async () => {
      await freshOutputs();
      const seeded = run(process.execPath, [buildScript]);
      assert.equal(seeded.status, 0, `seed build failed:\n${failureDetail(seeded)}`);
      const token = 'backup-cleanup:object';
      const result = buildWithInnerSwap(token);
      assert.notEqual(result.status, 0, `inner-interval cleanup swap must fail the build:\n${failureDetail(result)}`);
      assert.match(result.stderr, /backup cleanup.*refused|forensic backups kept/i);
      const backupNames = (await readdir(sourceOut)).filter((name) => name.startsWith('managed_storage_broker.o.bak-'));
      assert.equal(backupNames.length, 1, `exactly the guarded backup must remain: ${backupNames}`);
      assert.equal(await readFile(resolve(sourceOut, backupNames[0]), 'utf8'), innerCanary(token), 'cleanup canary must survive byte-identical at the backup path');
      const [sourceBroker, runtimeBrokerBytes] = await Promise.all(executables.map((path) => readFile(path)));
      assert.deepEqual(sourceBroker, runtimeBrokerBytes, 'the fully published generation must stay coherent');
      assert.equal(existsSync(lockPath), false, 'lock must be released');
    });
  } finally {
    await restoreOutputs();
  }
});

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
      // The holder blocks while compiling the broker core — the first staging
      // compile that happens AFTER lock acquisition. (The fs_guard bootstrap
      // compile legitimately precedes the lock; it only writes this run's
      // nonce temp and runs the selftest.)
      await writeFile(
        blockingCc,
        `#!/bin/sh\nfor arg in "$@"; do\n  case "$arg" in *managed_storage_broker.c)\n    while [ ! -f ${shellQuote(goFile)} ]; do sleep 0.05; done\n    ;; esac\ndone\nexec ${shellQuote(realCc)} "$@"\n`,
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
      const deadPid = await exitedChildPid();
      await writeLockRecord({
        pid: deadPid,
        hostname: hostname(),
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        nonce: `${deadPid}-stale-fixture`,
      });
      const result = run(process.execPath, [buildScript]);
      assert.equal(result.status, 0, `stale lock must be stolen, not fatal:\n${failureDetail(result)}`);
      assert.equal(existsSync(lockPath), false, 'released lock must be removed after the successful build');
      for (const path of artifactPaths) {
        assert.equal(existsSync(path), true, `stale recovery must still publish ${path}`);
      }
    });

    await t.test('fails closed on a live-pid lock, a foreign-host lock, and a corrupt lock', async () => {
      const foreignPid = await exitedChildPid();
      const cases = [
        {
          name: 'live pid',
          record: { pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString(), nonce: `${process.pid}-live-fixture` },
        },
        {
          name: 'foreign host',
          record: {
            pid: foreignPid,
            hostname: 'definitely-not-this-host',
            startedAt: new Date().toISOString(),
            nonce: `${foreignPid}-foreign-fixture`,
          },
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

    await t.test('fails closed on malformed same-host lock schemas instead of stealing them', async () => {
      // Every case is parseable JSON naming THIS host with a dead pid. Before
      // the schema guard these flowed missing/invalid pids into the liveness
      // check, read as dead, and were stolen as "stale". Each must now fail
      // closed with the lock byte-identical and nothing published.
      await freshOutputs();
      await mkdir(sourceOut, { recursive: true });
      const deadPid = await exitedChildPid();
      const canonical = () => new Date(Date.now() - 60_000).toISOString();
      const valid = () => ({
        pid: deadPid,
        hostname: hostname(),
        startedAt: canonical(),
        nonce: `${deadPid}-schema-fixture`,
      });
      const cases = [
        { name: 'missing pid', record: { ...valid(), pid: undefined } },
        { name: 'zero pid', record: { ...valid(), pid: 0 } },
        { name: 'negative pid', record: { ...valid(), pid: -1 } },
        { name: 'fractional pid', record: { ...valid(), pid: 1.5 } },
        { name: 'string pid', record: { ...valid(), pid: String(deadPid) } },
        { name: 'out-of-range pid', record: { ...valid(), pid: 0x1_0000_0000 } },
        { name: 'missing hostname', record: { ...valid(), hostname: undefined } },
        { name: 'empty hostname', record: { ...valid(), hostname: '' } },
        { name: 'non-string hostname', record: { ...valid(), hostname: 123 } },
        { name: 'missing nonce', record: { ...valid(), nonce: undefined } },
        { name: 'empty nonce', record: { ...valid(), nonce: '' } },
        { name: 'non-string nonce', record: { ...valid(), nonce: 42 } },
        { name: 'missing startedAt', record: { ...valid(), startedAt: undefined } },
        { name: 'numeric startedAt', record: { ...valid(), startedAt: 1756089480000 } },
        { name: 'unparseable startedAt', record: { ...valid(), startedAt: 'yesterday' } },
        { name: 'non-canonical startedAt', record: { ...valid(), startedAt: '2026-08-24T23:18:00Z' } },
        { name: 'unexpected extra field', record: { ...valid(), extra: 'field' } },
        { name: 'null record', raw: 'null' },
        { name: 'array record', raw: '[1]' },
        { name: 'string record', raw: '"lock"' },
        { name: 'number record', raw: '42' },
        { name: 'boolean record', raw: 'true' },
      ];
      for (const { name, record, raw } of cases) {
        const payload = raw !== undefined ? `${raw}\n` : `${JSON.stringify(record)}\n`;
        await writeFile(lockPath, payload);
        const result = run(process.execPath, [buildScript]);
        assert.notEqual(result.status, 0, `${name} lock must fail closed:\n${failureDetail(result)}`);
        assert.match(
          result.stderr,
          /malformed|corrupt/i,
          `${name} must be reported as a malformed record, not stale:\n${failureDetail(result)}`,
        );
        assert.equal(await readFile(lockPath, 'utf8'), payload, `${name} lock must remain byte-identical`);
        for (const path of artifactPaths) {
          assert.equal(existsSync(path), false, `${name} lock must not publish ${path}`);
        }
      }
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
