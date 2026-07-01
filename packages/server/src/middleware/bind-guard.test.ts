import { describe, expect, it, vi } from 'vitest';
import { assertSecureBindOrThrow } from './bind-guard';

describe('assertSecureBindOrThrow', () => {
  it('allows loopback binds without an API token for local development', () => {
    expect(() => assertSecureBindOrThrow({ host: '127.0.0.1', hasToken: false })).not.toThrow();
    expect(() => assertSecureBindOrThrow({ host: 'localhost', hasToken: false })).not.toThrow();
    expect(() => assertSecureBindOrThrow({ host: '::1', hasToken: false })).not.toThrow();
  });

  it('rejects all-interface binds without a token or explicit escape hatch', () => {
    expect(() => assertSecureBindOrThrow({ host: '0.0.0.0', hasToken: false })).toThrow(
      /Refusing to start Entity on non-loopback host 0\.0\.0\.0 without ENTITY_API_TOKEN/,
    );
  });

  it('allows non-loopback binds when an API token is configured', () => {
    expect(() => assertSecureBindOrThrow({ host: '0.0.0.0', hasToken: true })).not.toThrow();
  });

  it('allows explicitly insecure non-loopback binds and logs a warning', () => {
    const logger = { warn: vi.fn() };

    expect(() =>
      assertSecureBindOrThrow({
        host: '0.0.0.0',
        hasToken: false,
        allowInsecure: '1',
        logger,
      }),
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('WARNING'));
  });
});
