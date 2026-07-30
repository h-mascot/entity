import fs from 'fs';
import path from 'path';

export interface FileIdentity {
  path: string;
  size: number;
  mtimeNs: string;
  sha256: string;
}

export interface DatabaseIdentity {
  database: FileIdentity | null;
  wal: FileIdentity | null;
  shm: FileIdentity | null;
}

export function assertDatabaseIdentityUnchanged(
  before: DatabaseIdentity,
  after: DatabaseIdentity,
): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('Database identity changed during dry run');
  }
}

export function writeReceiptAppendOnly(receiptPath: string, content: string): void {
  if (fs.existsSync(receiptPath)) {
    throw new Error(`Refusing to overwrite existing receipt: ${receiptPath}`);
  }
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, content, { encoding: 'utf8', flag: 'wx' });
}
