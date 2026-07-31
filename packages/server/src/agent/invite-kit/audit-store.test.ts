import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let activeDbPath: string | null = null;
let cleanupDbPaths: string[] = [];

function sqliteFiles(dbPath: string): string[] {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

function removeSqliteFiles(dbPath: string): void {
  for (const file of sqliteFiles(dbPath)) {
    fs.rmSync(file, { force: true });
  }
}

function tempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

afterEach(async () => {
  const dbPathToClose = activeDbPath;
  if (dbPathToClose) {
    const closePath = tempDbPath('entity-invite-audit-close');
    cleanupDbPaths.push(closePath);
    vi.stubEnv('ENTITY_TASK_DB_PATH', closePath);
    try {
      const { getEntityDatabase } = await import('../../../../db/src/entity-db');
      getEntityDatabase().close();
    } catch {
      // best-effort
    }
  }
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of cleanupDbPaths) {
    removeSqliteFiles(dbPath);
  }
  activeDbPath = null;
  cleanupDbPaths = [];
});

describe('invite audit store (WP2-B-06)', () => {
  it('appends revoke audit without secrets and redacts sensitive detail', async () => {
    activeDbPath = tempDbPath('entity-invite-audit');
    cleanupDbPaths.push(activeDbPath);
    vi.resetModules();
    vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
    const { createInviteAuditStore, sanitizeAuditDetail, resetInviteAuditStoreForTests } = await import('./audit-store');
    resetInviteAuditStoreForTests();
    const store = createInviteAuditStore();
    store.ensureSchema();

    expect(sanitizeAuditDetail('token=abc123')).toContain('redacted');
    expect(sanitizeAuditDetail('revokedBy=henry')).toBe('revokedBy=henry');

    store.append({
      inviteId: 'inv-1',
      eventType: 'invite_revoked',
      actorId: 'henry',
      agentName: 'Scout',
      status: 'revoked',
      generation: 2,
      detail: 'revokedBy=henry',
    });
    store.append({
      inviteId: 'inv-1',
      eventType: 'invite_regenerated',
      actorId: 'henry',
      agentName: 'Scout',
      status: 'created',
      generation: 3,
      detail: 'generation=3',
    });

    const events = store.list({ inviteId: 'inv-1' });
    expect(events).toHaveLength(2);
    expect(events[0]?.eventType).toBe('invite_regenerated');
    expect(JSON.stringify(events)).not.toMatch(/"token"\s*:/);
    expect(JSON.stringify(events)).not.toMatch(/token_hash/i);
  });
});
