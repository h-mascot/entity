import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

function mockReq(params: Record<string, any> = {}): any {
  return { params };
}

function mockRes(): any {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    sendFile: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  };
}

describe('Docs Route Handlers', () => {
  let handlers: Record<string, Function> = {};
  let docsRoot: string;

  const fakeApp = {
    get: (route: string, handler: Function) => {
      handlers[route] = handler;
    },
  };

  beforeEach(async () => {
    handlers = {};
    docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-route-'));
    process.env.DOCS_WORK_ROOT = docsRoot;
    vi.resetModules();
    const { registerDocsRoute } = await import('../routes/docs');
    registerDocsRoute(fakeApp);
  });

  afterEach(() => {
    delete process.env.DOCS_WORK_ROOT;
    fs.rmSync(docsRoot, { recursive: true, force: true });
    vi.resetModules();
  });

  describe('GET /api/docs/:root/*', () => {
    const getHandler = () => handlers['/api/docs/:root/*'];

    it('should reject invalid root', async () => {
      const res = mockRes();
      await getHandler()(mockReq({ root: 'evil', '0': 'file.md' }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid docs root' });
    });

    it('should reject path traversal with ..', async () => {
      const res = mockRes();
      await getHandler()(mockReq({ root: 'output', '0': '../../etc/passwd.md' }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should reject path with tilde', async () => {
      const res = mockRes();
      await getHandler()(mockReq({ root: 'output', '0': '~/secret.md' }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should reject unsupported file extensions', async () => {
      const res = mockRes();
      await getHandler()(mockReq({ root: 'output', '0': 'file.exe' }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Only text document files are allowed' });
    });

    it('should serve existing .txt evidence files', async () => {
      const outputRoot = path.join(docsRoot, 'output');
      const testFile = path.join(outputRoot, '_test_docs_route.txt');

      try {
        fs.mkdirSync(outputRoot, { recursive: true });
        fs.writeFileSync(testFile, 'plain evidence');

        const res = mockRes();
        await getHandler()(mockReq({ root: 'output', '0': '_test_docs_route.txt' }), res);
        expect(res.json).toHaveBeenCalledWith({
          root: 'output',
          path: '_test_docs_route.txt',
          filename: '_test_docs_route.txt',
          content: 'plain evidence',
        });
      } finally {
        try { fs.unlinkSync(testFile); } catch {}
      }
    });

    it('should return 404 for missing file', async () => {
      const res = mockRes();
      await getHandler()(mockReq({ root: 'output', '0': 'nonexistent-xyz.md' }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should serve existing .md file', async () => {
      const outputRoot = path.join(docsRoot, 'output');
      const testFile = path.join(outputRoot, '_test_docs_route.md');

      try {
        fs.mkdirSync(outputRoot, { recursive: true });
        fs.writeFileSync(testFile, '# Test\nHello world');

        const res = mockRes();
        await getHandler()(mockReq({ root: 'output', '0': '_test_docs_route.md' }), res);
        expect(res.json).toHaveBeenCalledWith({
          root: 'output',
          path: '_test_docs_route.md',
          filename: '_test_docs_route.md',
          content: '# Test\nHello world',
        });
      } finally {
        try { fs.unlinkSync(testFile); } catch {}
      }
    });
  });

  describe('GET /docs/*', () => {
    it('should serve the SPA shell for docs routes', () => {
      const res = mockRes();
      handlers['/docs/*'](mockReq(), res);
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=60');
      expect(res.sendFile).toHaveBeenCalledWith(expect.stringContaining('app/dist/index.html'));
    });
  });
});
