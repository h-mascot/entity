import { describe, expect, it, vi } from 'vitest';
import { resolveFrontendDist, sendIndexNoCache, setApiNoStoreHeaders, setFrontendStaticCacheHeaders } from './static-cache';

function createResponse() {
  return {
    setHeader: vi.fn(),
    sendFile: vi.fn(),
  };
}

describe('static-cache helpers', () => {
  it('marks API responses no-store', () => {
    const res = createResponse();
    const next = vi.fn();

    setApiNoStoreHeaders({} as any, res as any, next);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).toHaveBeenCalledOnce();
  });

  it('marks hashed asset files immutable for long-lived caching', () => {
    const res = createResponse();

    setFrontendStaticCacheHeaders(res as any, '/srv/app/dist/assets/index-C0FFEE42.js');

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable');
  });

  it('marks index.html/root shell responses no-cache', () => {
    const res = createResponse();

    setFrontendStaticCacheHeaders(res as any, '/srv/app/dist/index.html');
    sendIndexNoCache(res as any, '/srv/app/dist/index.html');

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.sendFile).toHaveBeenCalledWith('/srv/app/dist/index.html');
  });

  it('resolves the app dist from the repo root before stale server-dist copies', () => {
    const exists = (candidate: string) => candidate === '/repo/packages/app/dist/index.html';

    expect(resolveFrontendDist('/repo', '/repo/packages/server/dist/server/src', exists)).toBe('/repo/packages/app/dist');
  });

  it('falls back to the compiled runtime-relative app dist when cwd is not the repo root', () => {
    const exists = (candidate: string) => candidate === '/repo/packages/app/dist/index.html';

    expect(resolveFrontendDist('/tmp', '/repo/packages/server/dist/server/src', exists)).toBe('/repo/packages/app/dist');
  });
});
