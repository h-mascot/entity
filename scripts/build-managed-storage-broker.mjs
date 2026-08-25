import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Compiles the native managed-storage broker from source, runs its direct C
// tests, and installs the broker executable to the runtime path the server
// resolves at deployment time (packages/server/dist/server/native/...).
// Requires a C11 compiler named by CC (single executable path/name) or `cc` on
// PATH. Entity's supported native-build hosts are macOS and Linux.
// Security boundary: this runs only in a trusted source checkout. Publication
// is a single transaction: prior generations are snapshotted as same-directory
// hardlink backups, all four artifacts are exposed via atomic renames, and any
// failure restores the exact prior generation (or publishes nothing). An
// exclusive lock (broker-build.lock in the source .build directory) is held
// from staging through publication and cleanup so concurrent builds fail fast
// instead of racing the renames.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'packages/server/native/managed-storage-broker');
const out = resolve(source, '.build');
const runtimeOut = resolve(root, 'packages/server/dist/server/native/managed-storage-broker/.build');
const cc = process.env.CC?.trim() || 'cc';
const common = ['-std=c11', '-D_GNU_SOURCE', '-Wall', '-Wextra', '-Werror', '-pedantic', '-I', source];

function ensureRealDirectoryTree(base, target) {
  const baseStat = lstatSync(base);
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
    throw new Error(`Unsafe broker build base (must be a real directory): ${base}`);
  }
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(base, rel) !== resolve(target)) {
    throw new Error(`Broker output escapes trusted build root: ${target}`);
  }
  let current = base;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (!existsSync(current)) {
      mkdirSync(current);
      continue;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Unsafe broker output component (must be a real directory): ${current}`);
    }
  }
}

function assertRegularSource(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Unsafe broker source (must be a regular file): ${path}`);
  }
}

function assertReplaceableRegularFile(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Unsafe broker output (must be absent or a regular file): ${path}`);
  }
}

// --- Deterministic fault injection (tests only) -----------------------------
// ENTITY_BROKER_BUILD_FAIL_AT is a comma-separated list of boundary labels; each
// fires at most once. Unknown labels fail immediately so a typo can never
// silently weaken a test.
const FAIL_AT = 'ENTITY_BROKER_BUILD_FAIL_AT';
const artifacts = ['object', 'test', 'broker', 'runtime'];
const knownLabels = new Set([
  ...artifacts.map((name) => `snapshot-${name}`),
  ...artifacts.map((name) => `publish-${name}`),
  ...artifacts.map((name) => `rollback-${name}`),
]);
const pendingInjections = new Set(
  (process.env[FAIL_AT] ?? '')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean),
);
for (const label of pendingInjections) {
  if (!knownLabels.has(label)) {
    throw new Error(`Unknown ${FAIL_AT} label: ${label} (known labels: ${[...knownLabels].join(', ')})`);
  }
}
function injectFailure(label) {
  if (!pendingInjections.has(label)) return;
  pendingInjections.delete(label);
  throw new Error(`Injected broker build failure at ${label} (${FAIL_AT})`);
}

// --- Exclusive build lock ----------------------------------------------------
const lockPath = resolve(out, 'broker-build.lock');
const nonce = `${process.pid}-${Date.now()}`;
const lockRecord = { pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString(), nonce };
const lockPayload = `${JSON.stringify(lockRecord)}\n`;
let lockHeld = false;

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'EPERM') return true; // exists, owned by another user
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

// The complete writer schema: a plain object with exactly pid, hostname,
// startedAt, and nonce. Parseable-but-invalid same-host records must fail
// closed here, BEFORE stale evaluation — otherwise missing/invalid pids flow
// into isPidAlive(), read as dead, and the lock is wrongly stolen.
const lockRecordFields = new Set(['pid', 'hostname', 'startedAt', 'nonce']);

function lockRecordSchemaError(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return 'record must be a plain object';
  }
  for (const key of Object.keys(record)) {
    if (!lockRecordFields.has(key)) return `unexpected field "${key}"`;
  }
  // process.pid on every supported host is a positive int32; the bound keeps
  // absurd integer values from ever reaching process.kill as a RangeError.
  if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || record.pid > 0x7fffffff) {
    return 'pid must be a positive integer';
  }
  if (typeof record.hostname !== 'string' || record.hostname.length === 0) {
    return 'hostname must be a non-empty string';
  }
  // The writer stores new Date().toISOString(); require the exact canonical
  // form (a finite instant that round-trips) so no foreign representation is
  // mistaken for a holder record.
  if (
    typeof record.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.startedAt)) ||
    new Date(record.startedAt).toISOString() !== record.startedAt
  ) {
    return 'startedAt must be the writer\'s canonical ISO-8601 timestamp';
  }
  if (typeof record.nonce !== 'string' || record.nonce.length === 0) {
    return 'nonce must be a non-empty string';
  }
  return null;
}

function readLockRecord() {
  const stat = lstatSync(lockPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Unsafe broker build lock (must be absent or a regular file): ${lockPath}`);
  }
  const raw = readFileSync(lockPath, 'utf8');
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new Error(`Broker build lock is corrupt (unparseable JSON): ${lockPath}`);
  }
  const schemaError = lockRecordSchemaError(record);
  if (schemaError !== null) {
    throw new Error(`Broker build lock is malformed (invalid record schema: ${schemaError}): ${lockPath}`);
  }
  return { raw, record };
}

// Analyze an existing lock. Live holders, foreign hosts, malformed or corrupt
// records (any schema deviation fails in readLockRecord before evaluation),
// and non-regular lock paths all fail closed WITHOUT touching the lock. A
// stale lock (same host, dead pid) is stolen via re-verify + rename claim +
// claim content check; returns true when the stale lock is gone and
// acquisition should be retried.
function stealStaleLockOrThrow() {
  const { raw, record } = readLockRecord();
  const detail = `pid ${record?.pid ?? '?'} on ${record?.hostname ?? '?'} started ${record?.startedAt ?? '?'}`;
  if (record?.hostname !== hostname()) {
    throw new Error(`Broker build lock held by another broker build (${detail}, foreign host) — refusing to run concurrently`);
  }
  if (isPidAlive(record?.pid)) {
    throw new Error(`Broker build lock held by another broker build (${detail}) — refusing to run concurrently`);
  }
  if (readFileSync(lockPath, 'utf8') !== raw) {
    // Lock content changed between reads: treat as contention, retry.
    return true;
  }
  const claim = resolve(out, `.broker-build.lock.stale-${nonce}`);
  renameSync(lockPath, claim);
  let claimed = '';
  if (existsSync(claim)) claimed = readFileSync(claim, 'utf8');
  if (claimed !== raw) {
    // Lost a race while stealing. Restore the claim when the lock path is
    // absent so a live lock is never left missing, then fail closed.
    if (!existsSync(lockPath)) renameSync(claim, lockPath);
    throw new Error(`Broker build lock changed while stealing stale lock (${detail}) — refusing to run concurrently`);
  }
  rmSync(claim, { force: true });
  return true;
}

function acquireLockOrThrow() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const temp = resolve(out, `.broker-build.lock.tmp-${nonce}-${attempt}`);
    writeFileSync(temp, lockPayload, { flag: 'wx' });
    try {
      try {
        // Hardlink claim: the lock path never exists in a half-written state.
        linkSync(temp, lockPath);
        lockHeld = true;
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (stealStaleLockOrThrow()) continue; // stale lock removed — retry claim
      }
    } finally {
      rmSync(temp, { force: true });
    }
  }
  throw new Error(`Broker build lock could not be acquired after stale cleanup (${lockPath}) — concurrent build may have claimed it`);
}

function releaseLock() {
  if (!lockHeld) return;
  lockHeld = false;
  try {
    const current = readFileSync(lockPath, 'utf8');
    if (current === lockPayload) {
      rmSync(lockPath, { force: true });
    } else {
      // The lock no longer contains our record: never remove someone else's.
      console.error(`broker build lock content changed before release (${lockPath}) — leaving it in place`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

ensureRealDirectoryTree(source, out);
ensureRealDirectoryTree(root, runtimeOut);

const coreSource = resolve(source, 'managed_storage_broker.c');
const testSource = resolve(source, 'test_managed_storage_broker.c');
const brokerSource = resolve(source, 'broker_main.c');
for (const path of [coreSource, testSource, brokerSource]) assertRegularSource(path);

const tempObject = resolve(out, `.managed_storage_broker.o.tmp-${nonce}`);
const tempTest = resolve(out, `.test.tmp-${nonce}`);
const tempBroker = resolve(out, `.broker.tmp-${nonce}`);
const finalObject = resolve(out, 'managed_storage_broker.o');
const finalTest = resolve(out, 'test');
const finalBroker = resolve(out, 'broker');
const runtimeBroker = resolve(runtimeOut, 'broker');
const runtimeTemp = resolve(runtimeOut, `.broker.tmp-${nonce}`);

// Publication order is fixed: object, test binary, source broker, runtime
// broker. Each entry stages in the same directory as its final path so every
// publish step is an atomic rename.
const publication = [
  { name: 'object', temp: tempObject, final: finalObject },
  { name: 'test', temp: tempTest, final: finalTest },
  { name: 'broker', temp: tempBroker, final: finalBroker },
  { name: 'runtime', temp: runtimeTemp, final: runtimeBroker },
];

// Restore the exact prior generation for every artifact that was published.
// Reverse publication order; artifacts without a prior generation are removed
// (the transaction publishes all-or-nothing). A failing rollback step is
// collected, reported loudly, and keeps the remaining forensic backups.
function rollbackPublication(published, backups) {
  const errors = [];
  for (const artifact of [...published].reverse()) {
    try {
      injectFailure(`rollback-${artifact.name}`);
      const backup = backups.get(artifact.name);
      if (backup !== undefined && existsSync(backup)) {
        renameSync(backup, artifact.final);
      } else {
        rmSync(artifact.final, { force: true });
      }
    } catch (error) {
      errors.push(`${artifact.name}: ${error.message}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Broker build rollback incomplete (${errors.join('; ')}) — forensic backups kept in ${out}`);
  }
  for (const backup of backups.values()) {
    rmSync(backup, { force: true });
  }
}

acquireLockOrThrow();
try {
  for (const path of [finalObject, finalTest, finalBroker, runtimeBroker]) {
    assertReplaceableRegularFile(path);
  }

  // Staging: every fallible compile/test/copy/chmod step happens on temp
  // paths before any final path is touched.
  execFileSync(cc, [...common, '-c', coreSource, '-o', tempObject], { stdio: 'inherit' });
  execFileSync(cc, [...common, testSource, tempObject, '-o', tempTest], { stdio: 'inherit' });
  execFileSync(cc, [...common, brokerSource, tempObject, '-o', tempBroker], { stdio: 'inherit' });
  execFileSync(tempTest, [], { stdio: 'inherit' });
  copyFileSync(tempBroker, runtimeTemp, constants.COPYFILE_EXCL);
  chmodSync(runtimeTemp, 0o755);

  // Snapshot: back up each existing final as a same-directory hardlink and
  // verify the backup shares the final's inode, so publication can only ever
  // replace the exact generation that was validated (fail closed on swaps).
  const backups = new Map();
  const published = [];
  try {
    for (const artifact of publication) {
      injectFailure(`snapshot-${artifact.name}`);
      if (existsSync(artifact.final)) {
        assertReplaceableRegularFile(artifact.final);
        const backup = resolve(dirname(artifact.final), `${basename(artifact.final)}.bak-${nonce}`);
        linkSync(artifact.final, backup);
        const finalStat = statSync(artifact.final);
        const backupStat = statSync(backup);
        if (finalStat.dev !== backupStat.dev || finalStat.ino !== backupStat.ino) {
          throw new Error(`Broker build backup inode mismatch for ${artifact.final} — refusing to publish over a swapped path`);
        }
        backups.set(artifact.name, backup);
      }
    }

    // Publish: atomic same-directory renames expose the staged generation.
    for (const artifact of publication) {
      injectFailure(`publish-${artifact.name}`);
      renameSync(artifact.temp, artifact.final);
      published.push(artifact);
    }
  } catch (error) {
    rollbackPublication(published, backups);
    throw error;
  }

  // Success: the prior generation is no longer reachable; drop the backups.
  for (const backup of backups.values()) {
    rmSync(backup, { force: true });
  }
} finally {
  for (const path of [tempObject, tempTest, tempBroker, runtimeTemp]) {
    rmSync(path, { force: true });
  }
  releaseLock();
}

console.log(`managed-storage-broker native core and IPC entrypoint: compile and direct tests passed; installed broker at ${runtimeOut}`);
