import { describe, expect, it } from 'vitest';
import { isProtectedApiPath } from './api-auth';

describe('PROTECTED_UNPREFIXED_ROOTS covers report surfaces (MC #1369 P1 fix)', () => {
  const reportRoots = [
    '/activity-report',
    '/usage-report',
    '/audit-report',
    '/access-report',
    '/reports',
  ];

  it.each(reportRoots)('protects %s exactly and with children', (root) => {
    expect(isProtectedApiPath(root)).toBe(true);
    expect(isProtectedApiPath(`${root}/anything`)).toBe(true);
  });

  it('keeps existing protections and rejects lookalikes', () => {
    expect(isProtectedApiPath('/activities')).toBe(true);
    expect(isProtectedApiPath('/reportserver')).toBe(false);
    expect(isProtectedApiPath('/')).toBe(false);
  });
});
