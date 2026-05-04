import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Env / constants
// ---------------------------------------------------------------------------
const KOKORO_BASE_URL = process.env.KOKORO_TTS_BASE_URL?.trim() || 'http://127.0.0.1:8881';
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL?.trim() || 'gpt-4o-mini-tts';
const EDGE_TTS_VOICE = process.env.EDGE_TTS_VOICE?.trim() || 'en-GB-SoniaNeural';
const MAX_CHARS = Math.min(Number(process.env.TTS_MAX_CHARS ?? 3800), 4000);
const EDGE_TTS_TIMEOUT_MS = Math.max(Number(process.env.EDGE_TTS_TIMEOUT_MS ?? 120_000), 1_000);
const SETTINGS_KEY = 'tts_settings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type TtsProvider = 'browser' | 'kokoro' | 'edge' | 'openai' | 'deepgram' | 'elevenlabs';

interface ProviderConfig {
  enabled: boolean;
  baseUrl?: string;
  voice?: string;
  voiceId?: string;
  model?: string;
  apiKeyEnv?: string;
}

interface TtsSettings {
  provider: TtsProvider;
  defaultSpeed: number;
  maxChars: number;
  providers: Record<string, ProviderConfig>;
}

// ---------------------------------------------------------------------------
// Defaults (must match PRD section 7.1)
// ---------------------------------------------------------------------------
const DEFAULTS: TtsSettings = {
  provider: 'kokoro',
  defaultSpeed: 1.0,
  maxChars: 3800,
  providers: {
    'local-kokoro': { enabled: true, baseUrl: 'http://127.0.0.1:8881', voice: 'bf_alice' },
    browser: { enabled: true },
    'edge-tts': { enabled: true, voice: 'en-GB-SoniaNeural' },
    openai: { enabled: false, apiKeyEnv: 'OPENAI_API_KEY', model: 'gpt-4o-mini-tts', voice: 'alloy' },
    deepgram: { enabled: false, apiKeyEnv: 'DEEPGRAM_API_KEY', voice: 'aura-2-luna-en' },
    elevenlabs: { enabled: false, apiKeyEnv: 'ELEVENLABS_API_KEY', voiceId: '' },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeProvider(value: unknown): TtsProvider {
  const map: Record<string, TtsProvider> = {
    browser: 'browser',
    kokoro: 'kokoro',
    edge: 'edge',
    openai: 'openai',
    deepgram: 'deepgram',
    elevenlabs: 'elevenlabs',
  };
  const normalized = typeof value === 'string' ? value.toLowerCase().trim() : '';
  return map[normalized] ?? 'kokoro';
}

function normalizeVoice(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeModel(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function sanitizeText(markdown: string): string {
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

export function buildEdgeTtsArgs({ voice, text, outputFile }: { voice: string; text: string; outputFile: string }): string[] {
  return ['--voice', voice, '--text', text, '--write-media', outputFile];
}

export function resolveEdgeTtsCommand(cwd = process.cwd(), exists: (candidate: string) => boolean = fs.existsSync): string {
  const configuredCommand = process.env.EDGE_TTS_COMMAND?.trim();
  if (configuredCommand) {
    return configuredCommand;
  }

  let currentDir = path.resolve(cwd);
  while (true) {
    const localCommand = path.join(currentDir, '.venv', 'bin', 'edge-tts');
    if (exists(localCommand)) {
      return localCommand;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return 'edge-tts';
    }
    currentDir = parentDir;
  }
}

// ---------------------------------------------------------------------------
// Settings persistence (using entityDb)
// ---------------------------------------------------------------------------
function ensureTtsSettingsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function loadSettings(db: Database.Database): TtsSettings {
  ensureTtsSettingsTable(db);
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(SETTINGS_KEY) as
    | { value_json: string }
    | undefined;
  if (!row) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(row.value_json) } as TtsSettings;
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(db: Database.Database, settings: TtsSettings): void {
  ensureTtsSettingsTable(db);
  db.prepare(
    `INSERT INTO app_settings (key, value_json, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(SETTINGS_KEY, JSON.stringify(settings));
}

// ---------------------------------------------------------------------------
// Voice catalog (static – fetched at registration time)
// ---------------------------------------------------------------------------
interface Voice {
  id: string;
  name: string;
  language?: string;
  gender?: string;
}

const VOICE_CATALOG: Record<string, Voice[]> = {
  kokoro: [
    { id: 'bf_alice', name: 'Alice (F)', language: 'en-US' },
    { id: 'bf_emma', name: 'Emma (F)', language: 'en-US' },
    { id: 'bf_isabelle', name: 'Isabelle (F)', language: 'en-US' },
    { id: 'bf_nicole', name: 'Nicole (F)', language: 'en-US' },
    { id: 'bf_sky', name: 'Sky (F)', language: 'en-US' },
    { id: 'bm_daniel', name: 'Daniel (M)', language: 'en-US' },
    { id: 'bm_federico', name: 'Federico (M)', language: 'en-US' },
    { id: 'bm_george', name: 'George (M)', language: 'en-US' },
    { id: 'bm_lewis', name: 'Lewis (M)', language: 'en-GB' },
    { id: 'bm_matilda', name: 'Matilda (F)', language: 'en-AU' },
  ],
  edge: [
    { id: 'en-GB-SoniaNeural', name: 'Sonia (F)', language: 'en-GB' },
    { id: 'en-GB-RyanNeural', name: 'Ryan (M)', language: 'en-GB' },
    { id: 'en-US-JennyNeural', name: 'Jenny (F)', language: 'en-US' },
    { id: 'en-US-GuyNeural', name: 'Guy (M)', language: 'en-US' },
    { id: 'en-US-AriaNeural', name: 'Aria (F)', language: 'en-US' },
    { id: 'en-AU-NatashaNeural', name: 'Natasha (F)', language: 'en-AU' },
    { id: 'en-NZ-MollyNeural', name: 'Molly (F)', language: 'en-NZ' },
  ],
  openai: [
    { id: 'alloy', name: 'Alloy', language: 'multilingual' },
    { id: 'echo', name: 'Echo', language: 'multilingual' },
    { id: 'fable', name: 'Fable', language: 'multilingual' },
    { id: 'onyx', name: 'Onyx', language: 'multilingual' },
    { id: 'nova', name: 'Nova', language: 'multilingual' },
    { id: 'shimmer', name: 'Shimmer', language: 'multilingual' },
  ],
  deepgram: [
    { id: 'aura-angus-en', name: 'Angus (M)', language: 'en-US' },
    { id: 'aura-asteria-en', name: 'Asteria (F)', language: 'en-US' },
    { id: 'aura-luna-en', name: 'Luna (F)', language: 'en-US' },
    { id: 'aura-orion-en', name: 'Orion (M)', language: 'en-US' },
    { id: 'aura-pearl-en', name: 'Pearl (F)', language: 'en-US' },
    { id: 'aura-stella-en', name: 'Stella (F)', language: 'en-US' },
    { id: 'aura-venus-en', name: 'Venus (F)', language: 'en-US' },
    { id: 'aura-zephyr-en', name: 'Zephyr (M)', language: 'en-US' },
  ],
  elevenlabs: [
    { id: 'EXAVITc4tvU7xuL82wvV', name: 'Bella (F)', language: 'en' },
    { id: 'AZnzlk1XvdvUeBnXmlwd', name: 'Domi (F)', language: 'en' },
    { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold (M)', language: 'en' },
    { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Charlie (M)', language: 'en' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Charlotte (F)', language: 'en' },
    { id: 'jsCqWAovKJY24Y7SuImR', name: 'George (M)', language: 'en' },
    { id: 'jIBiP1OkJlaXZq8yGqbS', name: 'Emily (F)', language: 'en' },
  ],
  browser: [],
};

function toCatalogKey(provider: string): string {
  const map: Record<string, string> = {
    'local-kokoro': 'kokoro',
    kokoro: 'kokoro',
    'edge-tts': 'edge',
    edge: 'edge',
    openai: 'openai',
    deepgram: 'deepgram',
    elevenlabs: 'elevenlabs',
    browser: 'browser',
  };
  return map[provider.toLowerCase()] ?? provider.toLowerCase();
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
interface TtsDependencies {
  app: any;
  db: Database.Database;
}

export function registerTtsRoutes({ app, db }: TtsDependencies): void {
  // GET /api/tts/settings
  app.get('/api/tts/settings', (_req: Request, res: Response) => {
    const settings = loadSettings(db);
    return res.json(settings);
  });

  // PATCH /api/tts/settings
  app.patch('/api/tts/settings', (req: Request, res: Response) => {
    const updates = req.body as Partial<TtsSettings>;
    const current = loadSettings(db);

    const next: TtsSettings = {
      provider: normalizeProvider(updates.provider ?? current.provider),
      defaultSpeed:
        typeof updates.defaultSpeed === 'number'
          ? Math.max(0.25, Math.min(4.0, updates.defaultSpeed))
          : current.defaultSpeed,
      maxChars:
        typeof updates.maxChars === 'number'
          ? Math.max(100, Math.min(4000, updates.maxChars))
          : current.maxChars,
      providers: {
        ...current.providers,
      },
    };

    if (updates.providers) {
      for (const [key, val] of Object.entries(updates.providers)) {
        if (val && typeof val === 'object') {
          next.providers[key] = { ...next.providers[key], ...val } as ProviderConfig;
        }
      }
    }

    saveSettings(db, next);
    return res.json(next);
  });

  // GET /api/tts/providers
  app.get('/api/tts/providers', (_req: Request, res: Response) => {
    const settings = loadSettings(db);
    const result = Object.entries(settings.providers).map(([key, cfg]) => ({
      id: key,
      enabled: cfg.enabled,
      // Don't expose apiKeyEnv values to client – credentials stay server-side
      voice: cfg.voice ?? null,
      voiceId: cfg.voiceId ?? null,
      model: cfg.model ?? null,
      baseUrl: cfg.baseUrl ?? null,
    }));
    return res.json({ providers: result });
  });

  // GET /api/tts/providers/:provider/voices
  app.get('/api/tts/providers/:provider/voices', (req: Request, res: Response) => {
    const catalogKey = toCatalogKey(req.params.provider);
    const voices = VOICE_CATALOG[catalogKey] ?? [];
    return res.json({ provider: req.params.provider, voices });
  });

  // POST /api/tts/test  – same body as generate but returns minimal response
  app.post('/api/tts/test', async (req: Request, res: Response) => {
    const { text = 'This is a test of the text to speech system.', provider, voice, model } =
      req.body as {
        text?: string;
        provider?: string;
        voice?: string;
        model?: string;
      };

    const sanitized = sanitizeText(text).slice(0, MAX_CHARS);
    if (!sanitized) {
      return res.status(400).json({ error: 'Empty text after sanitization.' });
    }

    const resolvedProvider = normalizeProvider(provider);
    const settings = loadSettings(db);

    // Kokoro (OpenAI-compatible endpoint)
    if (resolvedProvider === 'kokoro') {
      const cfg = settings.providers['local-kokoro'] ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voice ?? 'bf_alice');
      try {
        const upstream = await fetch(`${KOKORO_BASE_URL}/v1/text-to-speech/${resolvedVoice}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: sanitized }),
        });
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => '');
          return res.status(502).json({ error: 'Kokoro TTS service unavailable.', detail: detail || `Upstream returned ${upstream.status}.` });
        }
        const audioBuffer = Buffer.from(await upstream.arrayBuffer());
        return res.json({
          status: 'ok',
          provider: 'kokoro',
          requestId: randomUUID(),
          audioUrl: `data:audio/wav;base64,${audioBuffer.toString('base64')}`,
          voice: resolvedVoice,
          chars: sanitized.length,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Kokoro TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // OpenAI
    if (resolvedProvider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) return res.status(400).json({ error: 'OPENAI_API_KEY is not configured.' });
      const cfg = settings.providers.openai ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voice ?? 'alloy');
      const resolvedModel = normalizeModel(model, cfg.model ?? OPENAI_TTS_MODEL);
      try {
        const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: resolvedModel, voice: resolvedVoice, input: sanitized, format: 'mp3' }),
        });
        if (!upstream.ok) {
          return res.status(502).json({ error: 'OpenAI TTS request failed.', detail: `OpenAI returned ${upstream.status}.` });
        }
        const audioBuffer = Buffer.from(await upstream.arrayBuffer());
        return res.json({
          status: 'ok',
          provider: 'openai',
          requestId: randomUUID(),
          audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
          voice: resolvedVoice,
          model: resolvedModel,
          chars: sanitized.length,
        });
      } catch (err) {
        return res.status(500).json({ error: 'OpenAI TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // Edge TTS (subprocess)
    if (resolvedProvider === 'edge') {
      const cfg = settings.providers['edge-tts'] ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voice ?? EDGE_TTS_VOICE);
      const { execFileSync } = await import('child_process');
      const tmpFile = `/tmp/edge-tts-${randomUUID()}.mp3`;
      try {
        execFileSync(resolveEdgeTtsCommand(), buildEdgeTtsArgs({ voice: resolvedVoice, text: sanitized, outputFile: tmpFile }), { timeout: EDGE_TTS_TIMEOUT_MS });
        const audioBuffer = fs.readFileSync(tmpFile);
        fs.unlinkSync(tmpFile);
        return res.json({
          status: 'ok',
          provider: 'edge',
          requestId: randomUUID(),
          audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
          voice: resolvedVoice,
          chars: sanitized.length,
        });
      } catch (err) {
        try { require('fs').unlinkSync(tmpFile); } catch {}
        return res.status(500).json({ error: 'Edge TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // Deepgram
    if (resolvedProvider === 'deepgram') {
      const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
      if (!apiKey) return res.status(400).json({ error: 'DEEPGRAM_API_KEY is not configured.' });
      const cfg = settings.providers.deepgram ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voice ?? 'aura-angus-en');
      try {
        const upstream = await fetch(
          `https://api.deepgram.com/v1/speak?voice=${encodeURIComponent(resolvedVoice)}`,
          {
            method: 'POST',
            headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: sanitized }),
          }
        );
        if (!upstream.ok) {
          return res.status(502).json({ error: 'Deepgram TTS request failed.', detail: `Deepgram returned ${upstream.status}.` });
        }
        const audioBuffer = Buffer.from(await upstream.arrayBuffer());
        return res.json({
          status: 'ok',
          provider: 'deepgram',
          requestId: randomUUID(),
          audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
          voice: resolvedVoice,
          chars: sanitized.length,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Deepgram TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // ElevenLabs
    if (resolvedProvider === 'elevenlabs') {
      const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
      if (!apiKey) return res.status(400).json({ error: 'ELEVENLABS_API_KEY is not configured.' });
      const cfg = settings.providers.elevenlabs ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voiceId ?? 'EXAVITc4tvU7xuL82wvV');
      try {
        const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoice}`, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sanitized, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
        });
        if (!upstream.ok) {
          return res.status(502).json({ error: 'ElevenLabs TTS request failed.', detail: `ElevenLabs returned ${upstream.status}.` });
        }
        const audioBuffer = Buffer.from(await upstream.arrayBuffer());
        return res.json({
          status: 'ok',
          provider: 'elevenlabs',
          requestId: randomUUID(),
          audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
          voice: resolvedVoice,
          chars: sanitized.length,
        });
      } catch (err) {
        return res.status(500).json({ error: 'ElevenLabs TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // Browser – client-side only
    return res.json({ status: 'ok', provider: 'browser', requestId: randomUUID(), chars: sanitized.length });
  });

  // POST /api/tts/generate
  app.post('/api/tts/generate', async (req: Request, res: Response) => {
    const { text, provider, voice, model } = req.body as {
      text?: string;
      provider?: string;
      voice?: string;
      model?: string;
    };

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required.' });
    }

    const sanitized = sanitizeText(text);
    const truncated = sanitized.length > MAX_CHARS;
    const truncatedText = sanitized.slice(0, MAX_CHARS);

    if (!truncatedText) {
      return res.status(400).json({ error: 'Document is empty after TTS cleanup.' });
    }

    const resolvedProvider = normalizeProvider(provider);

    // Browser – client-side synthesis
    if (resolvedProvider === 'browser') {
      return res.json({
        status: 'ok',
        provider: 'browser',
        requestId: randomUUID(),
        chars: truncatedText.length,
        truncated,
      });
    }

    const settings = loadSettings(db);

    // Kokoro (OpenAI-compatible endpoint)
    if (resolvedProvider === 'kokoro') {
      const cfg = settings.providers['local-kokoro'] ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voice ?? 'bf_alice');
      try {
        const upstream = await fetch(`${KOKORO_BASE_URL}/v1/text-to-speech/${resolvedVoice}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: truncatedText }),
        });
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => '');
          return res.status(502).json({ error: 'Kokoro TTS service unavailable.', detail: detail || `Upstream returned ${upstream.status}.`, upstream: KOKORO_BASE_URL });
        }
        const audioBuffer = Buffer.from(await upstream.arrayBuffer());
        return res.json({
          status: 'ok',
          provider: 'kokoro',
          requestId: randomUUID(),
          audioUrl: `data:audio/wav;base64,${audioBuffer.toString('base64')}`,
          voice: resolvedVoice,
          chars: truncatedText.length,
          truncated,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Kokoro TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // OpenAI
    if (resolvedProvider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) return res.status(400).json({ error: 'OPENAI_API_KEY is not configured.' });
      const cfg = settings.providers.openai ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voice ?? 'alloy');
      const resolvedModel = normalizeModel(model, cfg.model ?? OPENAI_TTS_MODEL);
      try {
        const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: resolvedModel, voice: resolvedVoice, input: truncatedText, format: 'mp3' }),
        });
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => '');
          return res.status(502).json({ error: 'OpenAI TTS request failed.', detail: detail || `OpenAI returned ${upstream.status}.` });
        }
        const audioBuffer = Buffer.from(await upstream.arrayBuffer());
        return res.json({
          status: 'ok',
          provider: 'openai',
          requestId: randomUUID(),
          audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
          voice: resolvedVoice,
          model: resolvedModel,
          chars: truncatedText.length,
          truncated,
        });
      } catch (err) {
        return res.status(500).json({ error: 'OpenAI TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // Edge TTS (subprocess)
    if (resolvedProvider === 'edge') {
      const cfg = settings.providers['edge-tts'] ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voice ?? EDGE_TTS_VOICE);
      const { execFileSync } = await import('child_process');
      const tmpFile = `/tmp/edge-tts-${randomUUID()}.mp3`;
      try {
        execFileSync(resolveEdgeTtsCommand(), buildEdgeTtsArgs({ voice: resolvedVoice, text: truncatedText, outputFile: tmpFile }), { timeout: EDGE_TTS_TIMEOUT_MS });
        const audioBuffer = fs.readFileSync(tmpFile);
        fs.unlinkSync(tmpFile);
        return res.json({
          status: 'ok',
          provider: 'edge',
          requestId: randomUUID(),
          audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
          voice: resolvedVoice,
          chars: truncatedText.length,
          truncated,
        });
      } catch (err) {
        try { require('fs').unlinkSync(tmpFile); } catch {}
        return res.status(500).json({ error: 'Edge TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // Deepgram
    if (resolvedProvider === 'deepgram') {
      const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
      if (!apiKey) return res.status(400).json({ error: 'DEEPGRAM_API_KEY is not configured.' });
      const cfg = settings.providers.deepgram ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voice ?? 'aura-angus-en');
      try {
        const upstream = await fetch(
          `https://api.deepgram.com/v1/speak?voice=${encodeURIComponent(resolvedVoice)}`,
          {
            method: 'POST',
            headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: truncatedText }),
          }
        );
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => '');
          return res.status(502).json({ error: 'Deepgram TTS request failed.', detail: detail || `Deepgram returned ${upstream.status}.` });
        }
        const audioBuffer = Buffer.from(await upstream.arrayBuffer());
        return res.json({
          status: 'ok',
          provider: 'deepgram',
          requestId: randomUUID(),
          audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
          voice: resolvedVoice,
          chars: truncatedText.length,
          truncated,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Deepgram TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // ElevenLabs
    if (resolvedProvider === 'elevenlabs') {
      const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
      if (!apiKey) return res.status(400).json({ error: 'ELEVENLABS_API_KEY is not configured.' });
      const cfg = settings.providers.elevenlabs ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voiceId ?? 'EXAVITc4tvU7xuL82wvV');
      try {
        const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoice}`, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: truncatedText, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
        });
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => '');
          return res.status(502).json({ error: 'ElevenLabs TTS request failed.', detail: detail || `ElevenLabs returned ${upstream.status}.` });
        }
        const audioBuffer = Buffer.from(await upstream.arrayBuffer());
        return res.json({
          status: 'ok',
          provider: 'elevenlabs',
          requestId: randomUUID(),
          audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
          voice: resolvedVoice,
          chars: truncatedText.length,
          truncated,
        });
      } catch (err) {
        return res.status(500).json({ error: 'ElevenLabs TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  });
}
