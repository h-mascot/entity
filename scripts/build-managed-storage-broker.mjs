import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const source = resolve(root, 'packages/server/native/managed-storage-broker');
const out = resolve(source, '.build');
mkdirSync(out, { recursive: true });
const cc = '/usr/bin/cc';
const common = ['-std=c11', '-D_GNU_SOURCE', '-Wall', '-Wextra', '-Werror', '-pedantic', '-I', source];
execFileSync(cc, [...common, '-c', resolve(source, 'managed_storage_broker.c'), '-o', resolve(out, 'managed_storage_broker.o')], { stdio: 'inherit' });
execFileSync(cc, [...common, resolve(source, 'test_managed_storage_broker.c'), resolve(out, 'managed_storage_broker.o'), '-o', resolve(out, 'test')], { stdio: 'inherit' });
execFileSync(resolve(out, 'test'), [], { stdio: 'inherit' });
console.log('managed-storage-broker native core: compile and direct tests passed');
