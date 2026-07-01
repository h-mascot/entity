import { describe, expect, it } from 'vitest';
import { shouldRegisterTestErrorRoute } from './test-error-route';

describe('shouldRegisterTestErrorRoute', () => {
  it('does not register the uncaught-error route in production', () => {
    expect(shouldRegisterTestErrorRoute('production')).toBe(false);
  });

  it('keeps the route available outside production for Sentry checks', () => {
    expect(shouldRegisterTestErrorRoute('development')).toBe(true);
    expect(shouldRegisterTestErrorRoute('test')).toBe(true);
  });
});
