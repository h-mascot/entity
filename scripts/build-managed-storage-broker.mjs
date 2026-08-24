import { copyFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

// Compiles the native managed-storage broker from source, runs its direct C
// tests, and installs the broker executable to the runtime path the server
// resolves at deployment time (packages/server/dist/server/native/...).
//
// The source-tree copy under packages/server/native/managed-storage-broker/.build
// serves the local dev path (ts-node resolves __dirname/../../native from src/),
// while the dist copy rides the deploy's server-dist rsync into the runtime path
// the compiled server resolves (__dirname/../../native from dist/server/src/fs),
// so the deployed runtime never ENOENTs on the managed-storage broker (T-038
// blocker 2).
const root = resolve(new URL('..', import.meta.url).pathname);
const source = resolve(root, 'packages/server/native/managed-storage-broker');
const out = resolve(source, '.build');
mkdirSync(out, { recursive: true });
const cc = '/usr/bin/cc';
const common = ['-std=c11', '-D_GNU_SOURCE', '-Wall', '-Wextra', '-Werror', '-pedantic', '-I', source];
execFileSync(cc, [...common, '-c', resolve(source, 'managed_storage_broker.c'), '-o', resolve(out, 'managed_storage_broker.o')], { stdio: 'inherit' });
execFileSync(cc, [...common, resolve(source, 'test_managed_storage_broker.c'), resolve(out, 'managed_storage_broker.o'), '-o', resolve(out, 'test')], { stdio: 'inherit' });
execFileSync(cc, [...common, resolve(source, 'broker_main.c'), resolve(out, 'managed_storage_broker.o'), '-o', resolve(out, 'broker')], { stdio: 'inherit' });
execFileSync(resolve(out, 'test'), [], { stdio: 'inherit' });

// Install the executable at the deployed runtime path. Fails closed: without
// this install the sandbox/gateway would crash-loop on a missing broker.
const runtimeBroker = resolve(root, 'packages/server/dist/server/native/managed-storage-broker/.build/broker');
mkdirSync(dirname(runtimeBroker), { recursive: true });
copyFileSync(resolve(out, 'broker'), runtimeBroker);
console.log(`managed-storage-broker native core and IPC entrypoint: compile and direct tests passed; installed broker at ${resolve(root, 'packages/server/dist/server/native/managed-storage-broker/.build')}`);
