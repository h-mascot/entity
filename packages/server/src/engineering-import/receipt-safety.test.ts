import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertDatabaseIdentityUnchanged,
  writeReceiptAppendOnly,
} from './receipt-safety';

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const temporaryPath of temporaryPaths.splice(0)) {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
  }
});

describe('import dry-run receipt safety', () => {
  it('aborts when the database or WAL identity changes during the read', () => {
    const before = {
      database: { path: '/db', size: 10, mtimeNs: '1', sha256: 'aaa' },
      wal: { path: '/db-wal', size: 5, mtimeNs: '1', sha256: 'bbb' },
      shm: null,
    };
    const after = {
      ...before,
      wal: { path: '/db-wal', size: 6, mtimeNs: '2', sha256: 'ccc' },
    };

    expect(() => assertDatabaseIdentityUnchanged(before, after)).toThrow(
      'Database identity changed during dry run',
    );
  });

  it('creates a receipt once and refuses overwrite collisions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-b-05-receipt-'));
    temporaryPaths.push(directory);
    const receiptPath = path.join(directory, 'dry-run.json');

    writeReceiptAppendOnly(receiptPath, '{"first":true}\n');
    expect(fs.readFileSync(receiptPath, 'utf8')).toBe('{"first":true}\n');
    expect(() => writeReceiptAppendOnly(receiptPath, '{"second":true}\n')).toThrow(
      'Refusing to overwrite existing receipt',
    );
  });
});
