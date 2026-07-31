import { createHash } from 'crypto';
import fs from 'fs';

export const EXPECTED_BACKUP_GATE_SHA256 =
  '34093f24d012ea36931b739e1c3b5a735c1eb13691a5f874da52585affcb5388';

export interface BackupGateReceipt {
  issue: string;
  gate: string;
  status: string;
  generatedAt: string;
  repository: string;
  repositoryHead: string;
  backupDir: string;
  sqliteBackupSucceeded: boolean;
  databaseIdentityUnchanged: boolean;
  productionPromotion: boolean;
  importExecuted: boolean;
  henryApproval: string;
  databaseBefore: unknown;
  databaseAfter: unknown;
  backupFiles: Array<{ path: string; sha256: string }>;
}

export interface ValidatedBackupGate {
  receiptPath: string;
  receiptSha256: string;
  receipt: BackupGateReceipt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Backup gate receipt missing string field: ${key}`);
  }
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Backup gate receipt missing boolean field: ${key}`);
  }
  return value;
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function parseBackupGateReceipt(raw: unknown): BackupGateReceipt {
  if (!isRecord(raw)) throw new Error('Backup gate receipt must be a JSON object');
  const backupFiles = raw.backupFiles;
  if (!Array.isArray(backupFiles) || backupFiles.length === 0) {
    throw new Error('Backup gate receipt must list backupFiles');
  }
  for (const entry of backupFiles) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
      throw new Error('Backup gate receipt backupFiles entries are malformed');
    }
  }
  return {
    issue: requireString(raw, 'issue'),
    gate: requireString(raw, 'gate'),
    status: requireString(raw, 'status'),
    generatedAt: requireString(raw, 'generatedAt'),
    repository: requireString(raw, 'repository'),
    repositoryHead: requireString(raw, 'repositoryHead'),
    backupDir: requireString(raw, 'backupDir'),
    sqliteBackupSucceeded: requireBoolean(raw, 'sqliteBackupSucceeded'),
    databaseIdentityUnchanged: requireBoolean(raw, 'databaseIdentityUnchanged'),
    productionPromotion: requireBoolean(raw, 'productionPromotion'),
    importExecuted: requireBoolean(raw, 'importExecuted'),
    henryApproval: requireString(raw, 'henryApproval'),
    databaseBefore: raw.databaseBefore,
    databaseAfter: raw.databaseAfter,
    backupFiles: backupFiles as Array<{ path: string; sha256: string }>,
  };
}

export function validateBackupGateReceipt(options: {
  receiptPath: string;
  expectedSha256?: string;
  expectedRepository?: string;
}): ValidatedBackupGate {
  const receiptPath = options.receiptPath;
  if (!fs.existsSync(receiptPath)) {
    throw new Error(`Backup gate receipt not found: ${receiptPath}`);
  }
  const receiptSha256 = sha256File(receiptPath);
  const expectedSha256 = options.expectedSha256 ?? EXPECTED_BACKUP_GATE_SHA256;
  if (receiptSha256 !== expectedSha256) {
    throw new Error(
      `Backup gate receipt SHA-256 mismatch: expected ${expectedSha256}, got ${receiptSha256}`,
    );
  }
  const receipt = parseBackupGateReceipt(JSON.parse(fs.readFileSync(receiptPath, 'utf8')));
  if (receipt.issue !== 'THE-854 / EE-B-06') {
    throw new Error(`Unexpected backup gate issue: ${receipt.issue}`);
  }
  if (receipt.gate !== 'backup-before-import') {
    throw new Error(`Unexpected backup gate type: ${receipt.gate}`);
  }
  if (receipt.status !== 'PASS') {
    throw new Error(`Backup gate status is not PASS: ${receipt.status}`);
  }
  if (!receipt.sqliteBackupSucceeded) {
    throw new Error('Backup gate sqliteBackupSucceeded is false');
  }
  if (!receipt.databaseIdentityUnchanged) {
    throw new Error('Backup gate databaseIdentityUnchanged is false');
  }
  if (receipt.productionPromotion) {
    throw new Error('Backup gate must not authorize production promotion');
  }
  if (receipt.importExecuted) {
    throw new Error('Backup gate must not claim importExecuted');
  }
  if (options.expectedRepository && receipt.repository !== options.expectedRepository) {
    throw new Error(
      `Backup gate repository mismatch: expected ${options.expectedRepository}, got ${receipt.repository}`,
    );
  }
  const sqliteBackup = receipt.backupFiles.find((file) =>
    file.path.endsWith('entity-tasks.sqlite-backup.db'),
  );
  if (!sqliteBackup) {
    throw new Error('Backup gate is missing entity-tasks.sqlite-backup.db');
  }
  if (!fs.existsSync(sqliteBackup.path)) {
    throw new Error(`Backup sqlite file missing: ${sqliteBackup.path}`);
  }
  const backupSha = sha256File(sqliteBackup.path);
  if (backupSha !== sqliteBackup.sha256) {
    throw new Error('Backup sqlite file SHA-256 no longer matches the gate receipt');
  }
  return { receiptPath, receiptSha256, receipt };
}
