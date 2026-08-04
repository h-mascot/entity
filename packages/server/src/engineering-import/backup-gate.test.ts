import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EXPECTED_BACKUP_GATE_SHA256,
  parseBackupGateReceipt,
  validateBackupGateReceipt,
} from './backup-gate';

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const temporaryPath of temporaryPaths.splice(0)) {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
  }
});

function writeTempReceipt(content: unknown): { directory: string; receiptPath: string; backupPath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-b-06-backup-'));
  temporaryPaths.push(directory);
  const backupPath = path.join(directory, 'entity-tasks.sqlite-backup.db');
  fs.writeFileSync(backupPath, 'backup-bytes');
  const receipt = {
    issue: 'THE-854 / EE-B-06',
    gate: 'backup-before-import',
    status: 'PASS',
    generatedAt: '2026-07-30T19:15:11.410106Z',
    repository: '/tmp/repo',
    repositoryHead: 'abc',
    backupDir: directory,
    sqliteBackupSucceeded: true,
    databaseIdentityUnchanged: true,
    productionPromotion: false,
    importExecuted: false,
    henryApproval: 'approved',
    databaseBefore: {},
    databaseAfter: {},
    backupFiles: [
      {
        path: backupPath,
        size: 12,
        mtimeNs: 1,
        sha256: createHash('sha256').update('backup-bytes').digest('hex'),
      },
    ],
    ...((content && typeof content === 'object') ? content : {}),
  };
  const receiptPath = path.join(directory, 'backup-gate.json');
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { directory, receiptPath, backupPath };
}

describe('backup gate validation', () => {
  it('accepts a PASS receipt with matching backup bytes', () => {
    const { receiptPath, directory } = writeTempReceipt({});
    const sha = createHash('sha256').update(fs.readFileSync(receiptPath)).digest('hex');
    const validated = validateBackupGateReceipt({
      receiptPath,
      expectedSha256: sha,
      expectedRepository: '/tmp/repo',
    });
    expect(validated.receipt.status).toBe('PASS');
    expect(validated.receipt.backupDir).toBe(directory);
  });

  it('rejects SHA mismatch and production promotion', () => {
    const { receiptPath } = writeTempReceipt({ productionPromotion: true });
    expect(() =>
      validateBackupGateReceipt({
        receiptPath,
        expectedSha256: '0'.repeat(64),
      }),
    ).toThrow('Backup gate receipt SHA-256 mismatch');

    const sha = createHash('sha256').update(fs.readFileSync(receiptPath)).digest('hex');
    expect(() =>
      validateBackupGateReceipt({
        receiptPath,
        expectedSha256: sha,
      }),
    ).toThrow('must not authorize production promotion');
  });

  it('parses only complete receipts', () => {
    expect(() => parseBackupGateReceipt({ issue: 'THE-854 / EE-B-06' })).toThrow(
      'Backup gate receipt must list backupFiles',
    );
  });

  it('pins the authority SHA constant used by EE-B-06', () => {
    expect(EXPECTED_BACKUP_GATE_SHA256).toHaveLength(64);
  });
});
