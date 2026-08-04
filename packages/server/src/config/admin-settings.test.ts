import { describe, expect, it } from 'vitest';
import {
  AccessControlSettingsSchema,
  ChannelsSettingsSchema,
  parseAdminSettings,
  ADMIN_SETTINGS_KEYS,
  type ScopedSearchSettings,
} from './admin-settings';

describe('admin settings schemas', () => {
  it('rejects invalid access control payloads', () => {
    expect(() => AccessControlSettingsSchema.parse({ loginRequiredDefault: 'yes' })).toThrow();
    expect(() => AccessControlSettingsSchema.parse({ defaultOrgId: '' })).toThrow();
  });

  it('accepts valid channels settings', () => {
    const parsed = ChannelsSettingsSchema.parse({
      referenceAdapterEnabled: true,
      preferredChannels: ['entity_inbox', 'email'],
      degradeOnAdapterFailure: true,
    });
    expect(parsed.preferredChannels).toEqual(['entity_inbox', 'email']);
  });

  it('parses stored admin settings via key router', () => {
    const parsed = parseAdminSettings(ADMIN_SETTINGS_KEYS.scopedSearch, {
      defaultCollection: 'memory',
      labelDegradedResults: true,
      includeTaskProof: false,
    }) as ScopedSearchSettings;
    expect(parsed.defaultCollection).toBe('memory');
  });
});
