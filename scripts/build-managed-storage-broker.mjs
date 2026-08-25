import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Compiles the native managed-storage broker from source, runs its direct C
// tests, and installs the broker executable to the runtime path the server
// resolves at deployment time (packages/server/dist/server/native/...).
// Requires a C11 compiler named by CC (single executable path/name) or `cc` on
// PATH. Entity's supported native-build hosts are macOS and Linux.
// Security boundary: this runs only in a trusted, single-writer source checkout.
// Concurrent processes must not mutate source/output path topology during a build.
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

ensureRealDirectoryTree(source, out);
ensureRealDirectoryTree(root, runtimeOut);

const coreSource = resolve(source, 'managed_storage_broker.c');
const testSource = resolve(source, 'test_managed_storage_broker.c');
const brokerSource = resolve(source, 'broker_main.c');
for (const path of [coreSource, testSource, brokerSource]) assertRegularSource(path);

const nonce = `${process.pid}-${Date.now()}`;
const tempObject = resolve(out, `.managed_storage_broker.o.tmp-${nonce}`);
const tempTest = resolve(out, `.test.tmp-${nonce}`);
const tempBroker = resolve(out, `.broker.tmp-${nonce}`);
const finalObject = resolve(out, 'managed_storage_broker.o');
const finalTest = resolve(out, 'test');
const finalBroker = resolve(out, 'broker');
const runtimeBroker = resolve(runtimeOut, 'broker');
const runtimeTemp = resolve(runtimeOut, `.broker.tmp-${nonce}`);

try {
  for (const path of [finalObject, finalTest, finalBroker, runtimeBroker]) {
    assertReplaceableRegularFile(path);
  }
  execFileSync(cc, [...common, '-c', coreSource, '-o', tempObject], { stdio: 'inherit' });
  execFileSync(cc, [...common, testSource, tempObject, '-o', tempTest], { stdio: 'inherit' });
  execFileSync(cc, [...common, brokerSource, tempObject, '-o', tempBroker], { stdio: 'inherit' });
  execFileSync(tempTest, [], { stdio: 'inherit' });

  // Finish every fallible compile/test/copy/chmod step before publishing any
  // final path. Atomic same-directory renames then expose the staged generation.
  copyFileSync(tempBroker, runtimeTemp, constants.COPYFILE_EXCL);
  chmodSync(runtimeTemp, 0o755);

  // Revalidate destinations immediately before publishing so a swapped final
  // path fails closed instead of receiving or redirecting the staged
  // generation (under the single-writer authority documented above).
  for (const path of [finalObject, finalTest, finalBroker, runtimeBroker]) {
    assertReplaceableRegularFile(path);
  }

  renameSync(tempObject, finalObject);
  renameSync(tempTest, finalTest);
  renameSync(tempBroker, finalBroker);
  renameSync(runtimeTemp, runtimeBroker);
} finally {
  for (const path of [tempObject, tempTest, tempBroker, runtimeTemp]) {
    rmSync(path, { force: true });
  }
}

console.log(`managed-storage-broker native core and IPC entrypoint: compile and direct tests passed; installed broker at ${runtimeOut}`);
