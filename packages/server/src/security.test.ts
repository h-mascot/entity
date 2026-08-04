import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { applySecurityHardening, securityHeaders } from './security';

function createResponse() {
  const headers = new Map<string, string>();
  return {
    headers,
    response: {
      setHeader: vi.fn((name: string, value: string) => {
        headers.set(name, value);
      }),
    },
  };
}

describe('securityHeaders', () => {
  it('sets baseline browser security headers', () => {
    const { headers, response } = createResponse();
    const next = vi.fn();

    securityHeaders(
      {
        secure: false,
        get: vi.fn(() => undefined),
      } as any,
      response as any,
      next,
    );

    expect(headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('Content-Security-Policy')).toContain("frame-src 'self' blob:");
    expect(headers.get('Content-Security-Policy')).not.toContain('frame-src *');
    expect(headers.get('Content-Security-Policy')).not.toContain('frame-src data:');
    expect(headers.get('Content-Security-Policy')).toContain(
      "script-src 'self' 'unsafe-inline' blob:",
    );
    expect(headers.get('Content-Security-Policy')).toContain(
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    );
    expect(headers.get('Content-Security-Policy')).toContain("font-src 'self' data: https://fonts.gstatic.com");
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.has('Cross-Origin-Opener-Policy')).toBe(false);
    expect(headers.has('Origin-Agent-Cluster')).toBe(false);
    expect(headers.has('Strict-Transport-Security')).toBe(false);
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets HSTS when the request is HTTPS at the app or proxy boundary', () => {
    const direct = createResponse();
    securityHeaders({ secure: true, get: vi.fn(() => undefined) } as any, direct.response as any, vi.fn());
    expect(direct.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(direct.headers.get('Origin-Agent-Cluster')).toBe('?1');
    expect(direct.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');

    const proxied = createResponse();
    securityHeaders({ secure: false, get: vi.fn(() => 'HTTPS, http') } as any, proxied.response as any, vi.fn());
    expect(proxied.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
  });

  it('sets isolation headers for localhost HTTP during local development', () => {
    const local = createResponse();

    securityHeaders(
      {
        secure: false,
        hostname: 'localhost',
        get: vi.fn((name: string) => (name === 'host' ? 'localhost:3000' : undefined)),
      } as any,
      local.response as any,
      vi.fn(),
    );

    expect(local.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(local.headers.get('Origin-Agent-Cluster')).toBe('?1');
    expect(local.headers.has('Strict-Transport-Security')).toBe(false);
  });
});

describe('applySecurityHardening', () => {
  it('removes Express fingerprinting header', () => {
    const app = express();
    expect(app.get('x-powered-by')).toBe(true);

    applySecurityHardening(app);

    expect(app.get('x-powered-by')).toBe(false);
  });
});
