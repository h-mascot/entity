import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  const headers = new Map<string, string>();
  headers.set('content-type', contentType);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    text: async () => (typeof body === 'string' ? body : body.toString('utf-8')),
    arrayBuffer: async () =>
      typeof body === 'string'
        ? new TextEncoder().encode(body).buffer
        : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response;
}

describe('HttpMarkdownFileSourceAdapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
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
