import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

async function loadModule() {
  activeDbPath = tempDbPath('entity-invite-admin-settings');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  return import('./admin-settings');
}

afterEach(async () => {
  const dbPathToClose = activeDbPath;
  if (dbPathToClose) {
    const closePath = tempDbPath('entity-invite-admin-settings-close');
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

describe('agent invite admin settings (WP2-B-06)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns defaults and clamps TTL/module policy on update', async () => {
    const mod = await loadModule();
    const initial = mod.getAgentInviteAdminSettings();
    expect(initial.defaultTtlMs).toBe(30 * 60 * 1000);
    expect(initial.allowedModules).toContain('entity-mc');
    expect(initial.catalogModules.length).toBeGreaterThan(0);
    expect(JSON.stringify(initial)).not.toMatch(/"token"\s*:/);

    const updated = mod.updateAgentInviteAdminSettings({
      defaultTtlMs: 2 * 60 * 60 * 1000,
      minTtlMs: 5 * 60 * 1000,
      maxTtlMs: 6 * 60 * 60 * 1000,
      allowedModules: ['entity-mc', 'entity-fs'],
      defaultModules: ['entity-mc'],
      updatedBy: 'henry',
    });
    expect(updated.defaultTtlMs).toBe(2 * 60 * 60 * 1000);
    expect(updated.allowedModules).toEqual(['entity-mc', 'entity-fs']);
    expect(updated.defaultModules).toEqual(['entity-mc']);
    expect(updated.updatedBy).toBe('henry');
  });

  it('rejects unknown modules and out-of-range TTL resolution', async () => {
    const mod = await loadModule();
    expect(() => mod.updateAgentInviteAdminSettings({
      allowedModules: ['not-a-real-module'],
    })).toThrow(/Unknown module/);

    mod.updateAgentInviteAdminSettings({
      minTtlMs: 10 * 60 * 1000,
      maxTtlMs: 60 * 60 * 1000,
      defaultTtlMs: 30 * 60 * 1000,
      allowedModules: ['entity-mc'],
      defaultModules: ['entity-mc'],
    });
    const settings = mod.getAgentInviteAdminSettings();
    expect(mod.resolveInviteTtlMs(60_000, settings).ok).toBe(false);
    expect(mod.resolveInviteTtlMs(undefined, settings)).toEqual({
      ok: true,
      ttlMs: 30 * 60 * 1000,
    });
    expect(mod.resolveInviteModules(['entity-services'], settings).ok).toBe(false);
    expect(mod.resolveInviteModules(undefined, settings)).toEqual({
      ok: true,
      modules: ['entity-mc'],
    });
  });
});
