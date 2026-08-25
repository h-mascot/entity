import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
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
// is a single transaction whose every mutation is kernel-conditional and
// directory-descriptor-anchored, performed by the fs_guard native helper
// (compiled first from the same trusted sources and self-tested against this
// volume): absent finals are created with a kernel no-replace linkat; an
// existing final is replaced by an atomic kernel exchange (RENAME_SWAP /
// RENAME_EXCHANGE) that cannot overwrite or remove either side and is
// reversed with the unexpected entry restored byte-identically in place on
// any identity drift; removals are kernel no-replace conditional moves that
// only ever relocate the verified inode and restore any foreign entry; the
// parent directories' identities are verified against descriptors pinned at
// start-up so a swapped directory can never redirect a mutation. Any failure
// — including any identity change at any boundary — restores the exact prior
// generation (or publishes nothing) while refusing to overwrite or remove
// anything this run did not own. An exclusive lock (broker-build.lock in the
// source .build directory) is held from staging through publication and
// cleanup so concurrent builds fail fast instead of racing the mutations.
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
    if (lstatOrNull(current) === null) {
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

// Existence test that treats ENOENT as the ONLY form of absence. existsSync()
// follows symlinks, so a dangling symlink at a final-artifact path read as
// "absent" and publication renamed over it; lstat() keeps the entry visible
// so every unexpected entry (including dangling symlinks) fails closed.
// Identity-bearing reads use bigint stats so exact inode numbers reach the
// native guard helper.
function lstatOrNull(path) {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertReplaceableRegularFile(path) {
  if (lstatOrNull(path) === null) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Unsafe broker output (must be absent or a regular file): ${path}`);
  }
}

// --- Descriptor-anchored identity ------------------------------------------
// Every guarded mutation is executed by the fs_guard native helper relative
// to a verified parent-directory descriptor, because Node 22 exposes no
// conditional rename or fd-relative linkat: an unconditional renameSync/
// rmSync after a pathname pre-check leaves an interval in which an external
// actor can replace the final path (or its parent directory) and have the
// unexpected entry destroyed. The helper's kernel primitives close that
// interval (atomic exchange, no-replace link/move); identity is the exact
// {dev, ino} (bigint) pinned through descriptors and re-verified at every
// boundary. Identity is captured with bigint stats so the exact inode reaches
// the helper without number-precision loss.

function inodeOf(stat) {
  return { dev: stat.dev, ino: stat.ino };
}

function sameInode(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

// Anchor a final artifact's identity: classify the path entry with lstat
// (ENOENT is the only absence; any symlink or non-file is unsafe), then open
// the path and require the descriptor to pin the exact inode lstat saw. A
// swap between the two operations changes the resolved inode and fails
// closed. Returns null when absent, else the anchored {dev, ino}.
function anchorFinalArtifact(path) {
  const entry = lstatOrNull(path);
  if (entry === null) return null;
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`Unsafe broker output (must be absent or a regular file): ${path}`);
  }
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const anchored = fstatSync(fd, { bigint: true });
    if (!anchored.isFile() || !sameInode(inodeOf(anchored), inodeOf(entry))) {
      throw new Error(`Broker output identity changed while anchoring ${path} — refusing to publish`);
    }
    return inodeOf(anchored);
  } finally {
    closeSync(fd);
  }
}

// Does the path still anchor exactly the recorded identity (same regular
// file, never a symlink, never absent)?
function pathAnchors(path, identity) {
  const entry = lstatOrNull(path);
  if (entry === null || entry.isSymbolicLink() || !entry.isFile()) return false;
  return sameInode(inodeOf(entry), identity);
}

function anchorRealDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try {
    const stat = fstatSync(fd, { bigint: true });
    if (!stat.isDirectory()) {
      throw new Error(`Unsafe broker build directory (must be a real directory): ${path}`);
    }
    return { fd, identity: inodeOf(stat) };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

// A parent-directory swap (rename away + a new directory at the old path)
// would silently redirect every later path-based mutation. The anchor pins
// the real directory's inode; re-verification at each mutation boundary
// fails closed when the path no longer resolves to the anchored directory.
function verifyDirectoryAnchor(path, anchor) {
  const entry = lstatOrNull(path);
  if (entry === null || entry.isSymbolicLink() || !entry.isDirectory() || !sameInode(inodeOf(entry), anchor.identity)) {
    throw new Error(`Broker build directory identity changed (${path}) — refusing to continue`);
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

// --- Deterministic swap hooks (tests only) ----------------------------------
// ENTITY_BROKER_BUILD_SWAP_AT=<artifact>, ENTITY_BROKER_BUILD_SWAP_DIR_AT=<artifact>,
// and ENTITY_BROKER_BUILD_SWAP_AT_ROLLBACK=<artifact> each fire at most once,
// simulating an external actor that replaces a final artifact (or its whole
// parent directory) immediately before a guarded publish/rollback boundary.
// They are never set in production; a correct build must fail closed and
// leave the unexpected replacement byte-identical.
const swapHooks = {
  publish: (process.env.ENTITY_BROKER_BUILD_SWAP_AT ?? '').trim() || null,
  publishDir: (process.env.ENTITY_BROKER_BUILD_SWAP_DIR_AT ?? '').trim() || null,
  rollback: (process.env.ENTITY_BROKER_BUILD_SWAP_AT_ROLLBACK ?? '').trim() || null,
};
for (const [hook, artifactName] of Object.entries(swapHooks)) {
  if (artifactName !== null && !artifacts.includes(artifactName)) {
    throw new Error(`Unknown swap hook artifact for hook ${hook}: ${artifactName} (known artifacts: ${artifacts.join(', ')})`);
  }
}
const firedHooks = new Set();

function maybeSwapFinalArtifact(phase, artifact) {
  if (swapHooks[phase] !== artifact.name || firedHooks.has(phase)) return;
  firedHooks.add(phase);
  const canary = resolve(dirname(artifact.final), `.outside-canary-${nonce}`);
  writeFileSync(canary, `outside-canary-${phase}-${artifact.name}-${nonce}\n`, { flag: 'wx' });
  renameSync(canary, artifact.final); // deterministic external replacement
}

function maybeSwapParentDirectory(artifact) {
  if (swapHooks.publishDir !== artifact.name || firedHooks.has('publishDir')) return;
  firedHooks.add('publishDir');
  const dir = dirname(artifact.final);
  renameSync(dir, resolve(dirname(dir), `${basename(dir)}.swapped-${nonce}`));
  mkdirSync(dir);
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
  if (lstatOrNull(claim) !== null) claimed = readFileSync(claim, 'utf8');
  if (claimed !== raw) {
    // Lost a race while stealing. Restore the claim only when the lock path
    // is truly absent (ENOENT) so no unexpected replacement — including a
    // symlink — is ever overwritten, then fail closed.
    if (lstatOrNull(lockPath) === null) renameSync(claim, lockPath);
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
const guardSource = resolve(source, 'fs_guard.c');
for (const path of [coreSource, testSource, brokerSource, guardSource]) assertRegularSource(path);

const tempObject = resolve(out, `.managed_storage_broker.o.tmp-${nonce}`);
const tempTest = resolve(out, `.test.tmp-${nonce}`);
const tempBroker = resolve(out, `.broker.tmp-${nonce}`);
const tempGuard = resolve(out, `.fs-guard.tmp-${nonce}`);
const finalObject = resolve(out, 'managed_storage_broker.o');
const finalTest = resolve(out, 'test');
const finalBroker = resolve(out, 'broker');
const runtimeBroker = resolve(runtimeOut, 'broker');
const runtimeTemp = resolve(runtimeOut, `.broker.tmp-${nonce}`);

// Every guarded mutation runs through the fs_guard helper (kernel-conditional,
// dirfd-anchored). Refusals are loud and include the helper's structured
// reason plus the recovery outcome (restored in place / preserved at tomb).
let guardTempIdentity = null;

function runGuard(args, refuseMessage) {
  let stdout = '';
  try {
    stdout = execFileSync(tempGuard, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    let result = null;
    try {
      result = JSON.parse(String(error.stdout ?? ''));
    } catch {
      result = null;
    }
    const reason = result?.reason ? ` (${result.reason})` : '';
    const recovery =
      result?.recovered === true
        ? ' — the unexpected entry was restored in place byte-identically'
        : result?.recovered === false && result?.tomb
          ? ` — the unexpected entry is preserved at ${result.tomb}`
          : '';
    const detail = String(error.stdout ?? error.message ?? '').trim();
    throw new Error(`${refuseMessage}${reason}${recovery}: ${detail}`);
  }
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error(`broker guard helper returned unparseable output: ${stdout.trim()}`);
  }
  if (result.ok !== true) {
    throw new Error(`${refuseMessage}: ${JSON.stringify(result)}`);
  }
  return result;
}

function guardDirArgs(artifact) {
  const anchor = anchorForDirectory(artifact);
  return [dirname(artifact.final), String(anchor.identity.dev), String(anchor.identity.ino)];
}

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
// Reverse publication order. Every mutation is identity-guarded through the
// fs_guard helper: rollback may only atomically exchange a forensic backup
// with the exact inode THIS run published (an unexpected replacement, a
// vanished final, a changed backup, or a swapped parent directory fails
// closed with the unexpected entry preserved), and may only remove the exact
// file this run published via a kernel no-replace conditional move. Every
// refusal is collected, reported loudly, and keeps every forensic backup.
function rollbackPublication(published, backups, tempIdentities, priorIdentities) {
  const errors = [];
  for (const artifact of [...published].reverse()) {
    try {
      injectFailure(`rollback-${artifact.name}`);
      maybeSwapFinalArtifact('rollback', artifact);
      verifyDirectoryAnchor(dirname(artifact.final), anchorForDirectory(artifact));
      const publishedIdentity = tempIdentities.get(artifact.name);
      if (!pathAnchors(artifact.final, publishedIdentity)) {
        throw new Error(
          `unexpected entry at ${artifact.final} (identity changed since publication) — refusing to overwrite or remove it`,
        );
      }
      const backup = backups.get(artifact.name);
      const dirArgs = guardDirArgs(artifact);
      if (backup !== undefined) {
        if (!pathAnchors(backup.path, backup.identity)) {
          throw new Error(`forensic backup for ${artifact.name} changed (${backup.path}) — refusing to restore it`);
        }
        // Kernel atomic exchange of backup and final: neither side can be
        // overwritten or removed by the mutation, and any in-interval swap is
        // reversed with the unexpected entry restored in place.
        runGuard(
          [
            'exchange',
            ...dirArgs,
            basename(backup.path), String(backup.identity.dev), String(backup.identity.ino),
            basename(artifact.final), String(publishedIdentity.dev), String(publishedIdentity.ino),
            '--token', `rollback-restore:${artifact.name}`,
          ],
          `restoration of ${artifact.name} refused — refusing to overwrite an unexpected entry at ${artifact.final}`,
        );
        if (!pathAnchors(artifact.final, backup.identity)) {
          throw new Error(`restoration of ${artifact.name} did not land on the prior generation`);
        }
        // The backup path now holds exactly the inode this run published;
        // drop it with the guarded conditional removal.
        runGuard(
          [
            'remove-owned',
            ...dirArgs,
            basename(backup.path), String(publishedIdentity.dev), String(publishedIdentity.ino),
            '--token', `rollback-backup-drop:${artifact.name}`,
          ],
          `forensic backup drop for ${artifact.name} refused`,
        );
      } else {
        // No prior generation: remove exactly the file this run published
        // through a kernel no-replace conditional move (an in-interval
        // replacement is relocated and restored, never removed).
        runGuard(
          [
            'remove-owned',
            ...dirArgs,
            basename(artifact.final), String(publishedIdentity.dev), String(publishedIdentity.ino),
            '--token', `rollback-remove:${artifact.name}`,
          ],
          `removal of published ${artifact.name} refused — refusing to remove an unexpected entry at ${artifact.final}`,
        );
      }
      backups.delete(artifact.name);
    } catch (error) {
      errors.push(`${artifact.name}: ${error.message}`);
    }
  }
  // Artifacts that were snapshotted but never published: their finals must
  // still anchor exactly what snapshot anchored; anything else keeps every
  // forensic backup (the prior generation's last surviving copy).
  for (const [name, backup] of backups) {
    const final = publication.find((entry) => entry.name === name).final;
    const prior = priorIdentities.get(name);
    if (prior === null || !pathAnchors(final, prior)) {
      errors.push(`${name}: unexpected final state after rollback — refusing to drop the forensic backup`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Broker build rollback incomplete (${errors.join('; ')}) — forensic backups kept in ${out}`);
  }
  for (const [name, backup] of backups) {
    const artifact = publication.find((entry) => entry.name === name);
    if (!pathAnchors(backup.path, backup.identity)) {
      throw new Error(`Broker build backup identity changed during cleanup (${backup.path}) — forensic backups kept in ${out}`);
    }
    runGuard(
      [
        'remove-owned',
        ...guardDirArgs(artifact),
        basename(backup.path), String(backup.identity.dev), String(backup.identity.ino),
        '--token', `backup-cleanup:${name}`,
      ],
      `broker build backup cleanup for ${name} refused — forensic backups kept in ${out}`,
    );
  }
}

const sourceAnchor = anchorRealDirectory(out);
const runtimeAnchor = anchorRealDirectory(runtimeOut);
function anchorForDirectory(artifact) {
  return artifact.name === 'runtime' ? runtimeAnchor : sourceAnchor;
}

try {
  verifyDirectoryAnchor(out, sourceAnchor);
  verifyDirectoryAnchor(runtimeOut, runtimeAnchor);
  acquireLockOrThrow();
  let primaryFailure = null;
  // Tracks what each staging temp currently anchors, updated after every
  // guarded mutation, so temp cleanup only ever removes entries this run can
  // still account for.
  const tempCurrent = new Map();
  try {
    try {
      for (const path of [finalObject, finalTest, finalBroker, runtimeBroker]) {
        assertReplaceableRegularFile(path);
      }

      // The guarded-mutation helper is compiled first, from the same trusted
      // sources with the same compiler, and self-tested against this volume's
      // kernel primitives before any final path is touched. A filesystem (or
      // kernel) without the atomic exchange / no-replace primitives fails the
      // build closed here — there is no unsafe fallback anywhere.
      execFileSync(cc, [...common, guardSource, '-o', tempGuard], { stdio: 'inherit' });
      guardTempIdentity = inodeOf(lstatSync(tempGuard, { bigint: true }));
      runGuard(
        ['selftest', out, String(sourceAnchor.identity.dev), String(sourceAnchor.identity.ino)],
        'broker guard helper selftest failed — this volume lacks the kernel primitives the guarded transaction requires',
      );

      // Staging: every fallible compile/test/copy/chmod step happens on temp
      // paths before any final path is touched.
      execFileSync(cc, [...common, '-c', coreSource, '-o', tempObject], { stdio: 'inherit' });
      tempCurrent.set('object', inodeOf(lstatSync(tempObject, { bigint: true })));
      execFileSync(cc, [...common, testSource, tempObject, '-o', tempTest], { stdio: 'inherit' });
      tempCurrent.set('test', inodeOf(lstatSync(tempTest, { bigint: true })));
      execFileSync(cc, [...common, brokerSource, tempObject, '-o', tempBroker], { stdio: 'inherit' });
      tempCurrent.set('broker', inodeOf(lstatSync(tempBroker, { bigint: true })));
      execFileSync(tempTest, [], { stdio: 'inherit' });
      copyFileSync(tempBroker, runtimeTemp, constants.COPYFILE_EXCL);
      chmodSync(runtimeTemp, 0o755);
      tempCurrent.set('runtime', inodeOf(lstatSync(runtimeTemp, { bigint: true })));

      // Stage identities: the staged temps are this run's files; record the
      // inode each publish step must place at (and verify at) the final path,
      // cross-checked against what staging recorded for the same path.
      const tempIdentities = new Map();
      for (const artifact of publication) {
        const tempStat = lstatOrNull(artifact.temp);
        if (tempStat === null || !tempStat.isFile()) {
          throw new Error(`Broker build staged artifact is missing or not a regular file: ${artifact.temp}`);
        }
        const identity = inodeOf(tempStat);
        if (!sameInode(identity, tempCurrent.get(artifact.name))) {
          throw new Error(`Broker build staged artifact identity changed after staging: ${artifact.temp}`);
        }
        tempIdentities.set(artifact.name, identity);
      }

      // Snapshot: anchor each existing final's identity through a descriptor,
      // back it up as a same-directory hardlink, and verify the backup shares
      // the anchored inode, so publication can only ever replace the exact
      // generation that was validated (fail closed on swaps).
      const backups = new Map();
      const priorIdentities = new Map();
      const published = [];
      try {
        for (const artifact of publication) {
          injectFailure(`snapshot-${artifact.name}`);
          verifyDirectoryAnchor(dirname(artifact.final), anchorForDirectory(artifact));
          const prior = anchorFinalArtifact(artifact.final);
          priorIdentities.set(artifact.name, prior);
          if (prior !== null) {
            const backup = resolve(dirname(artifact.final), `${basename(artifact.final)}.bak-${nonce}`);
            linkSync(artifact.final, backup);
            const backupStat = lstatOrNull(backup);
            if (backupStat === null || !backupStat.isFile() || !sameInode(inodeOf(backupStat), prior)) {
              throw new Error(`Broker build backup inode mismatch for ${artifact.final} — refusing to publish over a swapped path`);
            }
            backups.set(artifact.name, { path: backup, identity: prior });
          }
        }

        // Publish: each step is a kernel-conditional, dirfd-anchored mutation
        // executed by the fs_guard helper. Absent finals are created with a
        // kernel no-replace linkat (EEXIST fails closed if anything appears —
        // nothing is ever replaced). Existing finals are replaced by an atomic
        // kernel exchange of the staged temp with the exact anchored prior
        // generation: the mutation cannot overwrite or remove either side, and
        // an in-interval swap of the final is reversed with the unexpected
        // entry restored byte-identically in place before failing closed into
        // rollback. The temp path receives the prior generation, so the staged
        // inode only ever reaches the final through a kernel-mediated step.
        for (const artifact of publication) {
          injectFailure(`publish-${artifact.name}`);
          maybeSwapFinalArtifact('publish', artifact);
          maybeSwapParentDirectory(artifact);
          verifyDirectoryAnchor(dirname(artifact.final), anchorForDirectory(artifact));
          const prior = priorIdentities.get(artifact.name);
          const staged = tempIdentities.get(artifact.name);
          const dirArgs = guardDirArgs(artifact);
          if (prior === null) {
            if (lstatOrNull(artifact.final) !== null) {
              throw new Error(
                `Broker final artifact appeared after snapshot (${artifact.final}) — refusing to replace an unexpected entry`,
              );
            }
            runGuard(
              [
                'link-absent',
                ...dirArgs,
                basename(artifact.temp), String(staged.dev), String(staged.ino),
                basename(artifact.final),
                '--token', `publish-link:${artifact.name}`,
              ],
              `Broker final artifact appeared during publication (${artifact.final}) — refusing to replace an unexpected entry`,
            );
          } else {
            if (!pathAnchors(artifact.final, prior)) {
              throw new Error(
                `Broker final artifact identity changed between snapshot and publication (${artifact.final}) — refusing to replace an unexpected entry`,
              );
            }
            runGuard(
              [
                'exchange',
                ...dirArgs,
                basename(artifact.temp), String(staged.dev), String(staged.ino),
                basename(artifact.final), String(prior.dev), String(prior.ino),
                '--token', `publish-exchange:${artifact.name}`,
              ],
              `Broker final artifact identity changed during publication (${artifact.final}) — refusing to replace an unexpected entry`,
            );
            // The atomic exchange placed the prior generation at the temp path.
            tempCurrent.set(artifact.name, prior);
          }
          if (!pathAnchors(artifact.final, staged)) {
            throw new Error(`Broker final artifact identity changed during publication (${artifact.final}) — refusing to continue`);
          }
          published.push(artifact);
        }
      } catch (error) {
        primaryFailure = error;
        rollbackPublication(published, backups, tempIdentities, priorIdentities);
        throw error;
      }

      // Success: the prior generation is no longer reachable at its final
      // path; drop the backups, but only through the guarded conditional
      // removal (each must still anchor exactly the hardlink this run made).
      for (const backup of backups.values()) {
        if (!pathAnchors(backup.path, backup.identity)) {
          throw new Error(`Broker build backup identity changed before cleanup (${backup.path}) — forensic backups kept in ${out}`);
        }
      }
      for (const [name, backup] of backups) {
        const artifact = publication.find((entry) => entry.name === name);
        runGuard(
          [
            'remove-owned',
            ...guardDirArgs(artifact),
            basename(backup.path), String(backup.identity.dev), String(backup.identity.ino),
            '--token', `backup-cleanup:${name}`,
          ],
          `Broker build backup cleanup for ${name} refused — forensic backups kept in ${out}`,
        );
      }
    } catch (error) {
      // Mark ANY in-flight failure so the finally block below logs (instead
      // of replacing) secondary cleanup errors.
      primaryFailure = error;
      throw error;
    }
  } finally {
    // Guarded temp cleanup: every staging temp (and the helper itself) is
    // removed only while it still anchors exactly the identity this run last
    // recorded for it — an unexpected entry at a temp path is never removed.
    // Secondary cleanup failures never mask the primary failure.
    const secondary = [];
    for (const path of [...publication.map((entry) => entry.temp), tempGuard]) {
      try {
        const artifact = publication.find((entry) => entry.temp === path);
        const identity = artifact === undefined ? guardTempIdentity : tempCurrent.get(artifact.name);
        if (identity === undefined || identity === null) {
          rmSync(path, { force: true }); // never staged/tracked this run
          continue;
        }
        const anchor = dirname(path) === out ? sourceAnchor : runtimeAnchor;
        runGuard(
          [
            'remove-owned',
            dirname(path), String(anchor.identity.dev), String(anchor.identity.ino),
            basename(path), String(identity.dev), String(identity.ino),
            '--token', `temp-cleanup:${basename(path)}`,
          ],
          `Broker build temp cleanup refused for ${path}`,
        );
      } catch (error) {
        secondary.push(`${path}: ${error.message}`);
      }
    }
    releaseLock();
    if (secondary.length > 0) {
      const combined = `Broker build temp cleanup incomplete (${secondary.join('; ')})`;
      if (primaryFailure === null) {
        throw new Error(combined);
      }
      console.error(combined);
    }
  }
} finally {
  closeSync(sourceAnchor.fd);
  closeSync(runtimeAnchor.fd);
}

console.log(`managed-storage-broker native core and IPC entrypoint: compile and direct tests passed; installed broker at ${runtimeOut}`);
