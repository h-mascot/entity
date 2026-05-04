import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const originalDocsWorkRoot = process.env.DOCS_WORK_ROOT;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

async function withDocsServer(workRoot: string) {
  vi.resetModules();
  process.env.DOCS_WORK_ROOT = workRoot;
  const { registerDocsApiRoutes } = await import('./docs');
  const app = express();
  app.use(express.json());
  registerDocsApiRoutes(app);

  let server: ReturnType<typeof app.listen>;
  const baseUrl = await new Promise<string>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind docs test server');
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => (error ? reject(error) : resolve()));
      }),
  };
}

afterEach(() => {
  vi.resetModules();
  if (originalDocsWorkRoot === undefined) {
    delete process.env.DOCS_WORK_ROOT;
  } else {
    process.env.DOCS_WORK_ROOT = originalDocsWorkRoot;
  }

  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});

describe('docs routes', () => {
  it('does not allow Henry/Enterprise-specific workspace paths as product defaults', () => {
    const source = fs.readFileSync(path.join(__dirname, 'docs.ts'), 'utf-8');

    const privateWorkspaceRoot = path.join('/Users', 'enterprise', 'clawd');
    const privateCheckoutRoot = path.join('/Users', 'enterprise', 'Code', 'Entity');

    expect(source).not.toContain(privateWorkspaceRoot);
    expect(source).not.toContain(privateCheckoutRoot);
  });

  it('serves output docs from DOCS_WORK_ROOT instead of the repo workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-root-'));
    fs.mkdirSync(path.join(root, 'output'), { recursive: true });
    fs.writeFileSync(path.join(root, 'output', 'report.md'), '# Output Report\n\nLoaded from clawd output.');

    const server = await withDocsServer(root);
    try {
      const response = await fetch(`${server.baseUrl}/api/docs/output/report.md`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.root).toBe('output');
      expect(payload.content).toContain('Loaded from clawd output.');
    } finally {
      await server.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports missing OpenAI TTS configuration without falling back to another provider', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-docs-root-'));
    fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(root, 'memory', 'note.md'), '# Note\n\nSpeak this text.');
    delete process.env.OPENAI_API_KEY;

    const server = await withDocsServer(root);
    try {
      const response = await fetch(`${server.baseUrl}/api/docs/memory/note.md/tts?provider=openai`);
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toMatch(/OPENAI_API_KEY/);
    } finally {
      await server.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
