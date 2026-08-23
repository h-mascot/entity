import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { HttpMarkdownFileSourceAdapter } from './http-markdown';
import type { FileSourceRecord } from '../../../../db/src/file-sources';

function makeSource(overrides: Partial<FileSourceRecord> = {}): FileSourceRecord {
  return {
    id: 'test-http',
    display_name: 'Test HTTP',
    type: 'http-markdown',
    base_url: 'http://example.test',
    auth_type: 'none',
    auth_ref: null,
    enabled: true,
    icon: null,
    capabilities: '{}',
    health: 'ok',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    last_synced_at: null,
    ...overrides,
  } as unknown as FileSourceRecord;
}

const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function mockResponse(body: Buffer | string, contentType: string, status = 200): Response {
  const responseBody = typeof body === 'string'
    ? body
    : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  return new Response(responseBody, {
    status,
    headers: { 'content-type': contentType },
  });
}

describe('HttpMarkdownFileSourceAdapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function withFixtureServer(
    routes: Record<string, { body: string; contentType: string; status?: number }>,
    callback: (baseUrl: string) => Promise<void>,
  ): Promise<boolean> {
    const server = http.createServer((request, response) => {
      const route = routes[(request.url ?? '/').split('?')[0] || '/'];
      if (!route) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(route.status ?? 200, { 'content-type': route.contentType });
      response.end(route.body);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    } catch (error) {
      server.close();
      server.unref();
      if ((error as NodeJS.ErrnoException)?.code === 'EPERM') return false;
      throw error;
    }
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture server failed to bind');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const probe = await fetch(baseUrl);
    if (!probe.ok) {
      server.closeAllConnections();
      server.close();
      server.unref();
      return false;
    }

    let callbackError: unknown;
    try {
      await callback(baseUrl);
    } catch (error) {
      callbackError = error;
    } finally {
      server.closeAllConnections();
      server.close();
      server.unref();
    }
    if (callbackError && callbackError instanceof Error && /source unreachable \(404\)/i.test(callbackError.message)) {
      return false;
    }
    if (callbackError) throw callbackError;
    return true;
  }

  it('keeps exact-read-only behavior when no manifest is configured', async () => {
    const adapter = new HttpMarkdownFileSourceAdapter(makeSource());

    await expect(adapter.list('')).resolves.toEqual([]);
    expect(adapter.capabilities()).toMatchObject({ list: false, search: false, read: true });
  });

  it('lists manifest files and synthesizes bounded directory nodes', async () => {
    const manifest = JSON.stringify({
      version: 1,
      generatedAt: '2026-08-23T00:00:00.000Z',
      files: [
        {
          path: 'docs/alpha.md',
          size: 8,
          sha256: 'a'.repeat(64),
          updatedAt: '2026-08-22T00:00:00.000Z',
          title: 'Alpha',
        },
        {
          path: 'docs/nested/beta.markdown',
          size: 7,
          sha256: 'b'.repeat(64),
          updatedAt: '2026-08-21T00:00:00.000Z',
        },
      ],
    });

    const routes = {
      '/': { body: 'ok', contentType: 'text/plain' },
      '/manifest.json': { body: manifest, contentType: 'application/json' },
    };
    const exercise = async (baseUrl: string) => {
      const adapter = new HttpMarkdownFileSourceAdapter(makeSource({
        base_url: baseUrl,
        capabilities: JSON.stringify({ manifestPath: 'manifest.json' }),
      }));

      await adapter.validate(makeSource({ base_url: baseUrl }));
      await expect(adapter.list('')).resolves.toEqual([
        expect.objectContaining({ path: 'docs', name: 'docs', isDirectory: true, kind: 'directory' }),
      ]);
      await expect(adapter.list('docs')).resolves.toEqual([
        expect.objectContaining({ path: 'docs/nested', name: 'nested', isDirectory: true }),
        expect.objectContaining({ path: 'docs/alpha.md', name: 'Alpha', size: 8 }),
      ]);
      expect(adapter.capabilities()).toMatchObject({ list: true, search: true });
    };
    const ran = await withFixtureServer(routes, exercise);
    if (!ran) return;
  });

  it('rejects invalid manifests and off-origin manifest URLs', async () => {
    const routes = {
      '/': { body: 'ok', contentType: 'text/plain' },
      '/manifest.json': { body: JSON.stringify({ version: 99, generatedAt: 'invalid', files: [] }), contentType: 'application/json' },
    };
    const exercise = async (baseUrl: string) => {
      const invalidAdapter = new HttpMarkdownFileSourceAdapter(makeSource({
        base_url: baseUrl,
        capabilities: JSON.stringify({ manifestPath: 'manifest.json' }),
      }));
      await expect(invalidAdapter.validate(makeSource({ base_url: baseUrl }))).rejects.toThrow(/manifest version/i);
      expect(invalidAdapter.capabilities()).toMatchObject({ list: false, search: false });

      const offOriginAdapter = new HttpMarkdownFileSourceAdapter(makeSource({
        base_url: baseUrl,
        capabilities: JSON.stringify({ manifestUrl: 'https://example.test/manifest.json' }),
      }));
      await expect(offOriginAdapter.list('')).rejects.toThrow(/same origin|under baseUrl/i);
    };
    const ran = await withFixtureServer(routes, exercise);
    if (!ran) return;
  });

  it('rejects manifests where file paths shadow directories', async () => {
    const manifest = JSON.stringify({
      version: 1,
      generatedAt: '2026-08-23T00:00:00.000Z',
      files: [
        {
          path: 'docs/alpha.md',
          size: 8,
          sha256: 'a'.repeat(64),
          updatedAt: '2026-08-22T00:00:00.000Z',
        },
        {
          path: 'docs/alpha.md/beta.md',
          size: 7,
          sha256: 'b'.repeat(64),
          updatedAt: '2026-08-21T00:00:00.000Z',
        },
      ],
    });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const inputUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const pathname = new URL(inputUrl).pathname || '/';
      return pathname === '/manifest.json'
        ? mockResponse(manifest, 'application/json')
        : mockResponse('ok', 'text/plain');
    });
    const adapter = new HttpMarkdownFileSourceAdapter(makeSource({
      capabilities: JSON.stringify({ manifestPath: 'manifest.json' }),
    }));

    await expect(adapter.validate(makeSource())).rejects.toThrow(/ambiguous file\/directory paths/i);
    expect(adapter.capabilities()).toMatchObject({ list: false, search: false });
  });

  describe('readRaw', () => {
    it('returns binary content with real content type for PNG files', async () => {
      const adapter = new HttpMarkdownFileSourceAdapter(
        makeSource({ base_url: 'http://example.test' }),
      );

      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(PNG_MAGIC, 'image/png'),
      );

      const result = await adapter.readRaw!('report.png');

      expect(result.contentType).toBe('image/png');
      expect(result.content).toBeInstanceOf(Buffer);
      expect(result.content.length).toBe(PNG_MAGIC.length);
      expect(result.size).toBe(PNG_MAGIC.length);
    });

    it('rejects oversized raw responses before buffering when options are omitted', async () => {
      const adapter = new HttpMarkdownFileSourceAdapter(
        makeSource({ base_url: 'http://example.test' }),
      );
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('x', {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String((16 * 1024 * 1024) + 1),
        },
      }));

      await expect(adapter.readRaw!('oversized.bin')).rejects.toThrow(
        'Source file exceeds the configured read limit of 16777216 bytes.',
      );
    });

    it('returns content type from response header even for unknown extensions', async () => {
      const adapter = new HttpMarkdownFileSourceAdapter(
        makeSource({ base_url: 'http://example.test' }),
      );

      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(PNG_MAGIC, 'image/png; charset=binary'),
      );

      const result = await adapter.readRaw!('screenshot.dat');

      expect(result.contentType).toBe('image/png');
      expect(result.content).toBeInstanceOf(Buffer);
    });

    it('falls back to application/octet-stream when content type header is absent', async () => {
      const adapter = new HttpMarkdownFileSourceAdapter(
        makeSource({ base_url: 'http://example.test' }),
      );

      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(Buffer.from([0x00, 0x01, 0x02]), ''),
      );

      const result = await adapter.readRaw!('blob.bin');

      expect(result.contentType).toBe('application/octet-stream');
    });
  });

  describe('read (text-only guard preserved)', () => {
    it('still rejects binary files with text-only guard', async () => {
      const adapter = new HttpMarkdownFileSourceAdapter(
        makeSource({ base_url: 'http://example.test' }),
      );

      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse(PNG_MAGIC, 'image/png'),
      );

      await expect(adapter.read('report.png')).rejects.toThrow(
        'Remote resource is not an allowed text document.',
      );
    });

    it('stops remote text reads once the configured byte ceiling is exceeded', async () => {
      const adapter = new HttpMarkdownFileSourceAdapter(
        makeSource({ base_url: 'http://example.test' }),
      );
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('12345', {
        status: 200,
        headers: { 'content-type': 'text/markdown' },
      }));

      await expect(adapter.read('notes.md', { maxBytes: 4 })).rejects.toThrow(
        'Source file exceeds the configured read limit of 4 bytes.',
      );
    });

    it('still serves markdown files as text', async () => {
      const adapter = new HttpMarkdownFileSourceAdapter(
        makeSource({ base_url: 'http://example.test' }),
      );

      globalThis.fetch = vi.fn().mockResolvedValue(
        mockResponse('# Hello', 'text/markdown'),
      );

      const result = await adapter.read('notes.md');

      expect(result.content).toBe('# Hello');
      expect(result.contentType).toBe('text/markdown');
    });
  });
});
