import { describe, expect, it } from 'vitest';
import {
  AccessControlSettingsSchema,
  ChannelsSettingsSchema,
  NavigationSettingsSchema,
  parseAdminSettings,
  ADMIN_SETTINGS_KEYS,
  type NavigationSettings,
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

  it('accepts workspace module visibility settings and rejects missing module flags', () => {
    const parsed = NavigationSettingsSchema.parse({
      files: true,
      tasks: true,
      agents: true,
      services: false,
      chat: false,
      terminal: false,
    });

    expect(parsed.chat).toBe(false);
    expect(parsed.terminal).toBe(false);
    expect(() => NavigationSettingsSchema.parse({ chat: false })).toThrow();
  });

  it('routes navigation settings through the persisted admin settings contract', () => {
    const parsed = parseAdminSettings(ADMIN_SETTINGS_KEYS.navigation, {
      files: true,
      tasks: false,
      agents: true,
      services: true,
      chat: false,
      terminal: true,
    }) as NavigationSettings;

    expect(parsed.tasks).toBe(false);
    expect(parsed.services).toBe(true);
  });
});
