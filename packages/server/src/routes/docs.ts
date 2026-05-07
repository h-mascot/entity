import type { Request, Response } from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { buildDocsRootCandidates } from '../docs-paths';
import { createFileSourceRepository } from '../../../db/src/file-sources';
import { createFileSourceAdapter } from '../fs/adapters/registry';

const HOME_DIR = process.env.HOME?.trim() || os.homedir();
const DEFAULT_DOCS_ROOT = path.join(HOME_DIR, 'entity-workspace');
const CLAWD_ROOT =
  process.env.DOCS_WORKSPACE_ROOT?.trim() ||
  process.env.WORKSPACE?.trim() ||
  process.env.DOCS_WORK_ROOT?.trim() ||
  DEFAULT_DOCS_ROOT;
const FALLBACK_DOCS_ROOT = path.resolve(process.cwd(), 'packages/app/dist/docs');

function parseDocsWorkspaceFallbacks(): string[] {
  const configured = process.env.DOCS_WORKSPACE_FALLBACKS?.trim();
  const defaults = [
    CLAWD_ROOT,
    DEFAULT_DOCS_ROOT,
    process.cwd(),
  ];

  const parsed = configured
    ? configured.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean)
    : [];

  return [...parsed, ...defaults].filter((value, index, list) => list.indexOf(value) === index);
}

const WORKSPACE_FALLBACKS = parseDocsWorkspaceFallbacks();
const LEGACY_SERVER_DOCS_ROOTS = [
  path.resolve(process.cwd(), 'packages/server/3000/docs'),
  path.resolve(__dirname, '../../3000/docs'),
  path.resolve(__dirname, '../../../3000/docs'),
];

// Allowed roots for docs serving
const ALLOWED_ROOTS: Record<string, string[]> = {
  output: [
    ...buildDocsRootCandidates('output', path.join(CLAWD_ROOT, 'output'), WORKSPACE_FALLBACKS),
    path.join(FALLBACK_DOCS_ROOT, 'output'),
    ...LEGACY_SERVER_DOCS_ROOTS.map((root) => path.join(root, 'output')),
  ],
  memory: [
    ...buildDocsRootCandidates('memory', path.join(CLAWD_ROOT, 'memory'), WORKSPACE_FALLBACKS),
    ...(process.env.DOCS_VAULT_MEMORY_ROOT?.trim() ? [process.env.DOCS_VAULT_MEMORY_ROOT.trim()] : []),
    path.join(FALLBACK_DOCS_ROOT, 'memory'),
  ],
  projects: [
    ...buildDocsRootCandidates('projects', path.join(CLAWD_ROOT, 'projects'), WORKSPACE_FALLBACKS),
    path.join(FALLBACK_DOCS_ROOT, 'projects'),
  ],
  workspace: buildDocsRootCandidates('workspace', CLAWD_ROOT, WORKSPACE_FALLBACKS),

};

// Simple HTML template for docs viewer
const DOCS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loading... - Entity Docs</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e4e4e7; }
    .header { display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; background: #16213e; border-bottom: 1px solid #2d3748; }
    .title { display: flex; align-items: center; gap: 12px; }
    .title span:first-child { font-size: 24px; }
    .breadcrumb { background: #1f2937; padding: 4px 12px; border-radius: 4px; font-size: 14px; color: #9ca3af; }
    .back-btn { padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; text-decoration: none; }
    .back-btn:hover { background: #2563eb; }
    .content { max-width: 900px; margin: 0 auto; padding: 32px 24px; line-height: 1.7; }
    .content h1, .content h2, .content h3 { color: #f3f4f6; margin-top: 32px; }
    .content h1:first-child { margin-top: 0; }
    .content a { color: #60a5fa; }
    .content code { background: #1f2937; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    .content pre { background: #1f2937; padding: 16px; border-radius: 8px; overflow-x: auto; }
    .content pre code { background: none; padding: 0; }
    .content table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    .content th, .content td { border: 1px solid #374151; padding: 12px; text-align: left; }
    .content th { background: #374151; }
    .loading { display: flex; align-items: center; justify-content: center; height: 200px; color: #9ca3af; }
    .error { background: #7f1d1d; padding: 16px; border-radius: 8px; color: #fecaca; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">
      <span>📄</span>
      <span class="title-text">Loading...</span>
      <span class="breadcrumb"></span>
    </div>
    <a href="/" class="back-btn">← Back to Entity</a>
  </div>
  <div class="content">
    <div class="loading">Loading document...</div>
  </div>
  <script>
    const path = window.location.pathname;
    const match = path.match(/^\/docs\/([^/]+)\/(.+)$/);
    if (!match) {
      document.querySelector('.content').innerHTML = '<div class="error">Invalid URL format</div>';
    } else {
      const [_, root, filePath] = match;
      fetch('/api/docs/' + root + '/' + filePath)
        .then(r => {
          if (!r.ok) throw new Error('File not found');
          return r.text();
        })
        .then(markdown => {
          document.querySelector('.title-text').textContent = filePath;
          document.querySelector('.breadcrumb').textContent = root;
          document.querySelector('.content').innerHTML = marked.parse(markdown);
          document.title = filePath + ' - Entity Docs';
        })
        .catch(err => {
          document.querySelector('.content').innerHTML = '<div class="error">' + err.message + '</div>';
        });
    }
  </script>
</body>
</html>`;

const DOCS_TTS_BASE_URL = process.env.KOKORO_TTS_BASE_URL?.trim() || 'http://127.0.0.1:8000';
const DOCS_TTS_DEFAULT_VOICE = process.env.KOKORO_TTS_DEFAULT_VOICE?.trim() || 'bf_alice';
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL?.trim() || 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE?.trim() || 'alloy';
const DOCS_TTS_MAX_CHARS = Math.min(Number(process.env.DOCS_TTS_MAX_CHARS ?? 3800), 4000);

type DocsTtsProvider = 'kokoro' | 'openai';

interface DocsDocument {
  root: string;
  path: string;
  filename: string;
  content: string;
  sourceId?: string;
  resolvedPath?: string;
}

let fileSourceRepository: ReturnType<typeof createFileSourceRepository> | null = null;

function getFileSourceRepository(): ReturnType<typeof createFileSourceRepository> {
  fileSourceRepository ??= createFileSourceRepository();
  return fileSourceRepository;
}

function docsTextToSpeechInput(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveDocsPath(root: string, filePath: string): Promise<string | null> {
  const candidates = ALLOWED_ROOTS[root] ?? [];
  for (const basePath of candidates) {
    const resolvedBase = path.resolve(basePath);
    const resolvedPath = path.resolve(path.join(resolvedBase, filePath));
    const relativeToBase = path.relative(resolvedBase, resolvedPath);
    if (relativeToBase.startsWith('..') || path.isAbsolute(relativeToBase)) {
      continue;
    }

    try {
      const stats = await fs.promises.stat(resolvedPath);
      if (stats.isFile()) {
        return resolvedPath;
      }
    } catch {
      // Try the next allowed root candidate.
    }
  }
  return null;
}

function normalizeDocsTtsProvider(value: unknown): DocsTtsProvider {
  return value === 'openai' ? 'openai' : 'kokoro';
}

function normalizeTtsVoice(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeTtsModel(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function isAllowedDocsFile(filePath: string): boolean {
  return /\.(md|markdown|txt|log|json|jsonl|yaml|yml|csv|tsv)$/i.test(filePath);
}

function validateDocsRequestShape(
  root: string,
  filePath: string,
): { ok: true } | { ok: false; status: number; payload: Record<string, string> } {
  const candidates = ALLOWED_ROOTS[root];
  if (!candidates?.length) {
    return { ok: false, status: 403, payload: { error: 'Invalid docs root' } };
  }

  if (filePath.includes('..') || filePath.includes('~')) {
    return { ok: false, status: 403, payload: { error: 'Path traversal not allowed' } };
  }

  if (!isAllowedDocsFile(filePath)) {
    return { ok: false, status: 400, payload: { error: 'Only text document files are allowed' } };
  }

  return { ok: true };
}

function sourceRelativePathForDocsRoot(root: string, filePath: string): string | null {
  if (root === 'output' || root === 'memory' || root === 'projects') {
    return `${root}/${filePath}`;
  }

  if (root === 'workspace') {
    return filePath;
  }

  return null;
}

async function readDocsDocument(root: string, filePath: string): Promise<DocsDocument | null> {
  const resolvedPath = await resolveDocsPath(root, filePath);
  if (resolvedPath) {
    const content = await fs.promises.readFile(resolvedPath, 'utf-8');
    return {
      root,
      path: filePath,
      filename: path.basename(resolvedPath),
      content,
    };
  }

  const sourceRelativePath = sourceRelativePathForDocsRoot(root, filePath);
  if (!sourceRelativePath) {
    return null;
  }

  let sources;
  try {
    sources = getFileSourceRepository().listSources(false);
  } catch {
    return null;
  }

  for (const source of sources) {
    try {
      const adapter = createFileSourceAdapter(source);
      const file = await adapter.read(sourceRelativePath);
      if (file.isBinary) {
        continue;
      }

      return {
        root,
        path: filePath,
        filename: path.posix.basename(sourceRelativePath) || path.basename(filePath),
        content: file.content,
        sourceId: source.id,
      };
    } catch {
      // Try the next configured source. A missing file on one source should not
      // prevent /docs links from resolving against another registered source.
    }
  }

  return null;
}

export function registerDocsRoute(app: any) {
  app.get('/api/docs/:root/*/tts', async (req: Request, res: Response) => {
    const root = req.params.root;
    const filePath = req.params[0] as string;
    const validation = validateDocsRequestShape(root, filePath);
    if (!validation.ok) {
      return res.status(validation.status).json(validation.payload);
    }

    try {
      const document = await readDocsDocument(root, filePath);
      if (!document) {
        return res.status(404).json({ error: 'File not found' });
      }
      const sanitized = docsTextToSpeechInput(document.content);
      const text = sanitized.slice(0, DOCS_TTS_MAX_CHARS);
      if (!text) {
        return res.status(400).json({ error: 'Document is empty after TTS cleanup.' });
      }

      const provider = normalizeDocsTtsProvider(req.query.provider);

      if (provider === 'openai') {
        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) {
          return res.status(400).json({ error: 'OPENAI_API_KEY is not configured for OpenAI TTS.' });
        }

        const voice = normalizeTtsVoice(req.query.voice, OPENAI_TTS_VOICE);
        const model = normalizeTtsModel(req.query.model, OPENAI_TTS_MODEL);
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            voice,
            input: text,
            format: 'mp3',
          }),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          return res.status(502).json({
            error: 'OpenAI TTS request failed.',
            detail: detail || `OpenAI returned ${response.status}.`,
            model,
            voice,
          });
        }

        const audioBuffer = Buffer.from(await response.arrayBuffer());
        return res.json({
          status: 'ok',
          provider,
          requestId: randomUUID(),
          audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
          voice,
          model,
          chars: text.length,
          truncated: sanitized.length > text.length,
        });
      }

      const voice = normalizeTtsVoice(req.query.voice, DOCS_TTS_DEFAULT_VOICE);
      const response = await fetch(`${DOCS_TTS_BASE_URL}/tts/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return res.status(502).json({
          error: 'Kokoro TTS service unavailable.',
          detail: detail || `TTS upstream returned ${response.status}.`,
          upstream: DOCS_TTS_BASE_URL,
        });
      }

      const payload = await response.json();
      return res.json({
        status: 'ok',
        provider,
        requestId: payload.request_id ?? randomUUID(),
        audioUrl: payload.audio_url ?? null,
        mulawUrl: payload.mulaw_url ?? null,
        voice: payload.voice ?? voice,
        upstream: DOCS_TTS_BASE_URL,
        chars: text.length,
        truncated: sanitized.length > text.length,
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to generate TTS for document.',
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  app.get('/api/docs/:root/*', async (req: Request, res: Response) => {
    const root = req.params.root;
    const filePath = req.params[0] as string;
    const validation = validateDocsRequestShape(root, filePath);
    if (!validation.ok) {
      return res.status(validation.status).json(validation.payload);
    }

    try {
      const document = await readDocsDocument(root, filePath);
      if (!document) {
        return res.status(404).json({ error: 'File not found' });
      }
      return res.json(document);
    } catch {
      return res.status(500).json({ error: 'Failed to read file' });
    }
  });

  app.get('/docs/*', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.sendFile(path.resolve(process.cwd(), 'packages/app/dist/index.html'));
  });
}

export const registerDocsApiRoutes = registerDocsRoute;
