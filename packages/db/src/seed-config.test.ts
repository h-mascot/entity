import { describe, expect, it } from 'vitest';
import { isExplicitSeedOptIn } from './seed-config';

describe('isExplicitSeedOptIn', () => {
  it.each(['true', 'TRUE', '1', 'on', 'ON', 'yes', ' yes '])('enables %j', (value) => {
    expect(isExplicitSeedOptIn(value)).toBe(true);
  });

  it.each([undefined, '', 'false', '0', 'off', 'no', 'enabled', '2'])(
    'disables %j',
    (value) => {
      expect(isExplicitSeedOptIn(value)).toBe(false);
    },
  );
});
