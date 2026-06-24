import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSearchRouter } from '../routes/search';
import type { Request, Response } from 'express';
import { execFile } from 'child_process';

// Mock child_process.execFile to prevent actual SSH/qmd calls
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

function mockReq(query: Record<string, any> = {}, headers: Record<string, string> = {}): Partial<Request> {
  const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    query,
    header: vi.fn((name: string) => normalizedHeaders[name.toLowerCase()]),
  } as any;
}

function mockRes(): any {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
  return res;
}

describe('Search Router', () => {
  let router: any;
  let handlers: Record<string, { method: string; path: string; handler: Function }[]>;

  beforeEach(() => {
    mockExecFile.mockReset();
    router = createSearchRouter();
    // Extract registered handlers from the router stack
    handlers = {};
    for (const layer of router.stack) {
      if (layer.route) {
        const routePath = layer.route.path;
        const method = Object.keys(layer.route.methods)[0];
        if (!handlers[routePath]) handlers[routePath] = [];
        handlers[routePath].push({
          method,
          path: routePath,
          handler: layer.route.stack[0].handle,
        });
      }
    }
  });

  describe('GET / (search)', () => {
    it('should return 400 when q is missing', async () => {
      const handler = handlers['/']?.find(h => h.method === 'get')?.handler;
      expect(handler).toBeDefined();

      const req = mockReq({});
      const res = mockRes();
      await handler!(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'q required' });
    });

    it('should return 400 when q is empty string', async () => {
      const handler = handlers['/']?.find(h => h.method === 'get')?.handler;
      const req = mockReq({ q: '   ' });
      const res = mockRes();
      await handler!(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'q required' });
    });

    it('should return 400 for invalid mode', async () => {
      const handler = handlers['/']?.find(h => h.method === 'get')?.handler;
      const req = mockReq({ q: 'test', mode: 'invalid_mode' });
      const res = mockRes();
      await handler!(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'mode must be keyword, semantic, or hybrid' });
    });

    it('should return 400 for invalid collection', async () => {
      const handler = handlers['/']?.find(h => h.method === 'get')?.handler;
      const req = mockReq({ q: 'test', collection: 'invalid_collection' });
      const res = mockRes();
      await handler!(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'invalid collection' });
    });

    it('should return 400 for invalid limit', async () => {
      const handler = handlers['/']?.find(h => h.method === 'get')?.handler;
      const req = mockReq({ q: 'test', limit: '-5' });
      const res = mockRes();
      await handler!(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'limit must be a positive integer' });
    });

    it('should return 400 for invalid full flag', async () => {
      const handler = handlers['/']?.find(h => h.method === 'get')?.handler;
      const req = mockReq({ q: 'test', full: 'maybe' });
      const res = mockRes();
      await handler!(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'full must be a boolean' });
    });

    it('should require request org before executing search', async () => {
      const handler = handlers['/']?.find(h => h.method === 'get')?.handler;
      const req = mockReq({ q: 'test' });
      const res = mockRes();
      await handler!(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'request org required', code: 'request_org_required' });
    });

    it('should suppress restricted search result snippets and content before returning results', async () => {
      const handler = handlers['/']?.find(h => h.method === 'get')?.handler;
      mockExecFile.mockImplementation(((_file: string, _args: readonly string[] | null | undefined, _options: unknown, callback: any) => {
        callback(null, JSON.stringify([
          {
            file: 'qmd://docs/restricted.md',
            title: 'Restricted strategy memo',
            snippet: 'Do not leak this snippet',
            body: 'Do not leak this full content',
            org_id: 'org-a',
            acl_json: JSON.stringify({ restricted: true }),
          },
        ]), '');
        return {} as any;
      }) as any);

      const req = mockReq({ q: 'strategy', full: 'true' }, { 'x-entity-org-id': 'org-a' });
      const res = mockRes();
      await handler!(req, res);

      expect(res.status).not.toHaveBeenCalled();
      const payload = res.json.mock.calls[0][0];
      expect(payload.results[0]).toMatchObject({
        id: 'docs/restricted.md',
        title: null,
        snippet: null,
        content: null,
        permission_state: 'restricted',
        entity_permission_state: 'restricted',
        restricted: true,
        placeholder: true,
        permission: {
          allowed: false,
          object_type: 'search_result',
          object_id: 'docs/restricted.md',
        },
      });
      expect(JSON.stringify(payload)).not.toContain('Do not leak');
      expect(JSON.stringify(payload)).not.toContain('Restricted strategy memo');
    });
  });

  describe('GET /document', () => {
    it('should return 400 when id is missing', async () => {
      const handler = handlers['/document']?.find(h => h.method === 'get')?.handler;
      expect(handler).toBeDefined();

      const req = mockReq({});
      const res = mockRes();
      await handler!(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'id required' });
    });

    it('should return 400 for invalid lines range', async () => {
      const handler = handlers['/document']?.find(h => h.method === 'get')?.handler;
      const req = mockReq({ id: 'test-doc', lines: 'not-a-range' });
      const res = mockRes();
      await handler!(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'lines must be a range like 40-50' });
    });

    it('should require request org before returning document content', async () => {
      const handler = handlers['/document']?.find(h => h.method === 'get')?.handler;
      const req = mockReq({ id: 'test-doc' });
      const res = mockRes();
      await handler!(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'request org required', code: 'request_org_required' });
    });
  });

  describe('GET /collections', () => {
    it('should exist as a route', () => {
      const handler = handlers['/collections']?.find(h => h.method === 'get')?.handler;
      expect(handler).toBeDefined();
    });
  });
});
