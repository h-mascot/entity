import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_SETTINGS_KEYS } from './admin-settings';
import {
  getAdminSettings,
  patchAdminSettings,
  resetAdminSettings,
  setAdminSettings,
} from './admin-settings-store';
import { ensureAppSettingsTable } from './settings-store';

const db = new Database(':memory:');

describe('admin settings store partial patch', () => {
  beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS app_settings');
    ensureAppSettingsTable(db);
  });

  afterEach(() => {
    db.exec('DROP TABLE IF EXISTS app_settings');
  });

  it('rejects a partial payload via strict setAdminSettings (the regression)', () => {
    // This is exactly what the RBAC bootstrap UI sends: only { apiPrincipalId }.
    // The strict full-schema parse must reject it (the pre-fix behavior).
    expect(() =>
      setAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl, { apiPrincipalId: 'p-1' }),
    ).toThrow();
  });

  it('merges a partial patch onto current settings and validates the result', () => {
    // From defaults, PATCH only apiPrincipalId.
    const updated = patchAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl, { apiPrincipalId: 'p-bootstrap' }) as { apiPrincipalId: string };
    expect(updated.apiPrincipalId).toBe('p-bootstrap');
    // Other required fields preserved from defaults.
    const stored = getAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl) as Record<string, unknown>;
    expect(stored.loginRequiredDefault).toBe(false);
    expect(stored.defaultOrgId).toBe('default-org');
    expect(stored.enforceStoredPrincipals).toBe(true);
    expect(stored.allowHeaderCompat).toBe(true);
    expect(stored.apiPrincipalId).toBe('p-bootstrap');
  });

  it('still rejects an invalid partial value after merge', () => {
    expect(() =>
      patchAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl, { defaultOrgId: '' }),
    ).toThrow();
    expect(() =>
      patchAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl, { loginRequiredDefault: 'not-a-bool' }),
    ).toThrow();
  });

  it('preserves a previously-patched value across subsequent patches', () => {
    patchAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl, { apiPrincipalId: 'p-first' });
    patchAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl, { allowHeaderCompat: false });
    const stored = getAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl) as Record<string, unknown>;
    expect(stored.apiPrincipalId).toBe('p-first');
    expect(stored.allowHeaderCompat).toBe(false);
  });

  it('reset restores defaults', () => {
    patchAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl, { apiPrincipalId: 'p-temp', allowHeaderCompat: false });
    resetAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl);
    const stored = getAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl) as Record<string, unknown>;
    expect(stored.apiPrincipalId).toBeNull();
    expect(stored.allowHeaderCompat).toBe(true);
  });

  it('rolls back to the prior value when an invalid patch is rejected (atomic)', () => {
    // Establish committed state.
    patchAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl, { apiPrincipalId: 'p-stable', allowHeaderCompat: true });
    // An invalid patch must reject AND leave the previously committed value
    // intact — the read-merge-write is wrapped in a transaction so a failed
    // validation rolls back rather than corrupting stored settings.
    expect(() =>
      patchAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl, { defaultOrgId: '' }),
    ).toThrow();
    const stored = getAdminSettings(db, ADMIN_SETTINGS_KEYS.accessControl) as Record<string, unknown>;
    expect(stored.apiPrincipalId).toBe('p-stable');
    expect(stored.defaultOrgId).toBe('default-org');
    expect(stored.allowHeaderCompat).toBe(true);
  });
});
