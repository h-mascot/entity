import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrincipalRepository, ensurePrincipalsSchema } from '../../../db/src/principals';
import {
  hasGlobalAdminGrant,
  LOCAL_ADMIN_PRINCIPAL_ID,
  resolveTrustedAdminPrincipalId,
} from './admin-identity';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { ensureAppSettingsTable, setSettingJson } from '../config/settings-store';
import { ADMIN_SETTINGS_KEYS, ADMIN_SETTINGS_DEFAULTS } from '../config/admin-settings';

const db = new Database(':memory:');
const repo = createPrincipalRepository(db);

function mockReq(headers: Record<string, string> = {}) {
  return {
    header: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? undefined,
  } as any;
}

// Persist an accessControl patch into the SAME entity DB the resolver reads
// from (getEntityDatabase). The resolver consults this stored binding in both
// auth modes, so tests that exercise the persisted-binding path must write
// through the production settings store rather than the in-memory repo DB.
// Each call writes a fresh temp DB path so cached state cannot leak between
// tests, and ENTITY_TASK_DB_PATH redirects getEntityDatabase to it.
let settingDbIndex = 0;
function persistTestAccessControlSetting(patch: Partial<{ apiPrincipalId: string | null }>): void {
  settingDbIndex += 1;
  const tmpPath = `${require('node:os').tmpdir()}/entity-test-admin-${process.pid}-${settingDbIndex}.sqlite`;
  try { require('node:fs').unlinkSync(tmpPath); } catch { /* fine */ }
  vi.stubEnv('ENTITY_TASK_DB_PATH', tmpPath);
  const settingsDb = getEntityDatabase(ensureAppSettingsTable);
  const merged = { ...ADMIN_SETTINGS_DEFAULTS[ADMIN_SETTINGS_KEYS.accessControl], ...patch };
  setSettingJson(settingsDb, ADMIN_SETTINGS_KEYS.accessControl, merged, 'test');
}

describe('admin identity resolution', () => {
  beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS principal_grants');
    db.exec('DROP TABLE IF EXISTS entity_principals');
    ensurePrincipalsSchema(db);
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    // vi.unstubAllEnvs() (called in beforeEach) resets all stubbed envs,
    // including ENTITY_TASK_DB_PATH. There is no single-env unstub API.
  });

  it('allows bootstrap principal when no principals exist', () => {
    expect(resolveTrustedAdminPrincipalId(mockReq(), repo)).toBe(LOCAL_ADMIN_PRINCIPAL_ID);
  });

  it('allows bootstrap principal binding when API auth is enabled for a sole principal', () => {
    vi.stubEnv('ENTITY_API_TOKEN', 'secret-token');
    repo.createPrincipal({ id: 'bootstrap-admin', principal_type: 'human', display_name: 'Bootstrap', created_by: 'seed' });
    expect(resolveTrustedAdminPrincipalId(
      mockReq({ 'x-entity-principal-id': 'bootstrap-admin' }),
      repo,
    )).toBe('bootstrap-admin');
  });

  it('uses header principal in local dev without API auth', () => {
    repo.createPrincipal({ id: 'admin', principal_type: 'human', display_name: 'Admin', created_by: 'seed' });
    expect(resolveTrustedAdminPrincipalId(mockReq({ 'x-entity-principal-id': 'admin' }), repo)).toBe('admin');
  });

  it('self-heals the sole global-admin principal in local dev without any client header', () => {
    // Regression: prior to the fix, once a stored principal existed the local
    // dev GET /api/admin/principals resolved to LOCAL_ADMIN_PRINCIPAL_ID (no
    // stored row) and the middleware 403'd with admin_grant_required unless
    // the browser sent x-entity-role: admin. The UI must NOT be required to
    // trust client-supplied role headers when a stored principal exists.
    repo.createPrincipal({ id: 'bootstrap-admin', principal_type: 'human', display_name: 'Bootstrap', created_by: 'seed' });
    repo.createGrant({ principal_id: 'bootstrap-admin', role: 'admin', created_by: 'seed' });
    expect(resolveTrustedAdminPrincipalId(mockReq(), repo)).toBe('bootstrap-admin');
  });

  it('resolves the sole principal identity even before it has a grant (self-bootstrap window)', () => {
    // Identity resolution is decoupled from authorization. During the brief
    // window between creating the first principal and self-bootstrapping its
    // admin grant, the resolver must still identify the sole principal so the
    // middleware's isSelfBootstrapGrant carve-out can authorize the grant POST.
    repo.createPrincipal({ id: 'pre-grant', principal_type: 'human', display_name: 'Pre', created_by: 'seed' });
    expect(resolveTrustedAdminPrincipalId(mockReq(), repo)).toBe('pre-grant');
  });

  it('does not self-heal when multiple principals exist (fail closed in API auth)', () => {
    repo.createPrincipal({ id: 'admin1', principal_type: 'human', display_name: 'One', created_by: 'seed' });
    repo.createGrant({ principal_id: 'admin1', role: 'admin', created_by: 'seed' });
    repo.createPrincipal({ id: 'admin2', principal_type: 'human', display_name: 'Two', created_by: 'seed' });
    vi.stubEnv('ENTITY_API_TOKEN', 'secret-token');
    // No binding, two principals — must NOT pick one arbitrarily.
    expect(resolveTrustedAdminPrincipalId(mockReq(), repo)).toBeNull();
  });

  it('fails closed in LOCAL DEV when multiple principals exist and no binding (no client-header spoofing)', () => {
    // Security contract: once stored principals exist, a missing/ambiguous
    // server identity must fail closed in BOTH auth modes. The local-dev
    // header fallback (x-entity-principal-id / x-entity-role) is only for the
    // no-stored-principal bootstrap/legacy state. With 2+ principals and no
    // persisted binding, the resolver must NOT return a client-supplied or
    // LOCAL id — that would let any localhost caller spoof an admin identity.
    repo.createPrincipal({ id: 'admin1', principal_type: 'human', display_name: 'One', created_by: 'seed' });
    repo.createGrant({ principal_id: 'admin1', role: 'admin', created_by: 'seed' });
    repo.createPrincipal({ id: 'admin2', principal_type: 'human', display_name: 'Two', created_by: 'seed' });
    // API auth deliberately OFF (local dev). Spoofed client headers present.
    expect(resolveTrustedAdminPrincipalId(
      mockReq({ 'x-entity-principal-id': 'admin1', 'x-entity-role': 'admin' }),
      repo,
    )).toBeNull();
  });

  it('fails closed when a persisted apiPrincipalId points at a missing principal', () => {
    // HIGH blocker fix: a server-trusted binding whose target no longer
    // exists is a broken binding. Returning it lets the middleware resolve
    // local_compat in local dev and re-enable header-trust authorization.
    // Instead the resolver must fail closed (null) so a stale/malformed
    // persisted binding cannot resurrect the legacy client-header path.
    repo.createPrincipal({ id: 'real-admin', principal_type: 'human', display_name: 'Real', created_by: 'seed' });
    repo.createGrant({ principal_id: 'real-admin', role: 'admin', created_by: 'seed' });
    // Persist a binding to a principal id that does not exist.
    persistTestAccessControlSetting({ apiPrincipalId: 'ghost-admin' });
    expect(resolveTrustedAdminPrincipalId(mockReq(), repo)).toBeNull();
  });

  it('fails closed when a persisted apiPrincipalId points at a disabled principal', () => {
    repo.createPrincipal({ id: 'disabled-bound', principal_type: 'human', display_name: 'Disabled', created_by: 'seed' });
    repo.createGrant({ principal_id: 'disabled-bound', role: 'admin', created_by: 'seed' });
    repo.disablePrincipal('disabled-bound');
    persistTestAccessControlSetting({ apiPrincipalId: 'disabled-bound' });
    expect(resolveTrustedAdminPrincipalId(mockReq(), repo)).toBeNull();
  });

  it('treats scoped admin grants as non-global', () => {
    repo.createPrincipal({ id: 'scoped-admin', principal_type: 'human', display_name: 'Scoped', created_by: 'seed' });
    repo.createGrant({
      principal_id: 'scoped-admin',
      role: 'admin',
      org_id: 'org-a',
      created_by: 'seed',
    });
    expect(hasGlobalAdminGrant('scoped-admin', repo)).toBe(false);

    repo.createPrincipal({ id: 'global-admin', principal_type: 'human', display_name: 'Global', created_by: 'seed' });
    repo.createGrant({ principal_id: 'global-admin', role: 'admin', created_by: 'seed' });
    expect(hasGlobalAdminGrant('global-admin', repo)).toBe(true);
  });
});
