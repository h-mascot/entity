import type { Request, Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import type Database from 'better-sqlite3';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// ---------------------------------------------------------------------------
// Env / constants
// ---------------------------------------------------------------------------
const KOKORO_BASE_URL = process.env.KOKORO_TTS_BASE_URL?.trim() || 'http://127.0.0.1:8000';
const KOKORO_TTS_DEFAULT_VOICE = process.env.KOKORO_TTS_DEFAULT_VOICE?.trim() || 'bf_alice';
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL?.trim() || 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE?.trim() || 'alloy';
const EDGE_TTS_VOICE = process.env.EDGE_TTS_VOICE?.trim() || 'en-GB-SoniaNeural';
const DEEPGRAM_TTS_VOICE = process.env.DEEPGRAM_TTS_VOICE?.trim() || 'aura-angus-en';
const ELEVENLABS_TTS_VOICE = process.env.ELEVENLABS_TTS_VOICE?.trim() || 'pFZP5JQG7iQjIQuC4Bku';
const MAX_CHARS = Math.min(Number(process.env.TTS_MAX_CHARS ?? 3800), 4000);
const EDGE_TTS_TIMEOUT_MS = Math.max(Number(process.env.EDGE_TTS_TIMEOUT_MS ?? 120_000), 1_000);
const SETTINGS_KEY = 'tts_settings';
const AUDIO_TRANSFORM_VERSION = 'markdown-speech-v1';
const AUDIO_ARTIFACT_CACHE_ENTRIES = 16;

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

interface AudioArtifactIdentityInput {
  documentRef: string;
  text: string;
  maxChars: number;
  provider: string;
  voice: string;
  model: string;
  profileVersion: string;
  securityNamespace: string;
  transformVersion: string;
}

interface AudioArtifactCache<T> {
  readonly size: number;
  getOrCreate(identity: string, factory: () => Promise<T>): Promise<T>;
}

class TtsUpstreamError extends Error {}

// ---------------------------------------------------------------------------
// Defaults (must match PRD section 7.1)
// ---------------------------------------------------------------------------
const DEFAULTS: TtsSettings = {
  provider: 'kokoro',
  defaultSpeed: 1.0,
  maxChars: 3800,
  providers: {
    'local-kokoro': { enabled: true, baseUrl: KOKORO_BASE_URL, voice: KOKORO_TTS_DEFAULT_VOICE },
    browser: { enabled: true },
    'edge-tts': { enabled: true, voice: EDGE_TTS_VOICE },
    openai: { enabled: Boolean(process.env.OPENAI_API_KEY?.trim()), apiKeyEnv: 'OPENAI_API_KEY', model: OPENAI_TTS_MODEL, voice: OPENAI_TTS_VOICE },
    deepgram: { enabled: Boolean(process.env.DEEPGRAM_API_KEY?.trim()), apiKeyEnv: 'DEEPGRAM_API_KEY', voice: DEEPGRAM_TTS_VOICE },
    elevenlabs: { enabled: Boolean(process.env.ELEVENLABS_API_KEY?.trim()), apiKeyEnv: 'ELEVENLABS_API_KEY', voiceId: ELEVENLABS_TTS_VOICE },
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

export function buildAudioArtifactIdentity(input: AudioArtifactIdentityInput): string {
  const synthesizedText = sanitizeText(input.text).slice(0, input.maxChars);
  return createHash('sha256')
    .update(JSON.stringify({
      documentRef: input.documentRef,
      synthesizedText,
      provider: input.provider,
      voice: input.voice,
      model: input.model,
      profileVersion: input.profileVersion,
      securityNamespace: input.securityNamespace,
      transformVersion: input.transformVersion,
    }))
    .digest('hex');
}

export function createAudioArtifactCache<T>({
  maxEntries,
}: {
  maxEntries: number;
}): AudioArtifactCache<T> {
  const entries = new Map<string, Promise<T>>();
  const capacity = Math.max(1, Math.floor(maxEntries));

  return {
    get size() {
      return entries.size;
    },
    async getOrCreate(identity, factory) {
      const existing = entries.get(identity);
      if (existing) {
        entries.delete(identity);
        entries.set(identity, existing);
        return existing;
      }

      const pending = factory();
      entries.set(identity, pending);
      while (entries.size > capacity) {
        const oldestIdentity = entries.keys().next().value;
        if (typeof oldestIdentity === 'string') {
          entries.delete(oldestIdentity);
        }
      }

      try {
        return await pending;
      } catch (error) {
        if (entries.get(identity) === pending) {
          entries.delete(identity);
        }
        throw error;
      }
    },
  };
}

function resolveAudioSecurityNamespace(req: Request): string {
  return createHash('sha256')
    .update(JSON.stringify({
      org: req.header('x-entity-org-id')?.trim() || 'default-org',
      principal: req.header('x-entity-principal-id')?.trim() || 'entity-local-user',
      authorization: req.header('authorization')?.trim() || '',
    }))
    .digest('hex');
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

async function requestKokoroAudio(text: string, voice: string): Promise<Buffer> {
  const openAiCompatible = await fetch(`${KOKORO_BASE_URL}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'kokoro', voice, input: text, response_format: 'wav' }),
  });

  if (openAiCompatible.ok) {
    return Buffer.from(await openAiCompatible.arrayBuffer());
  }

  const openAiDetail = await openAiCompatible.text().catch(() => '');
  const legacy = await fetch(`${KOKORO_BASE_URL}/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (legacy.ok) {
    return Buffer.from(await legacy.arrayBuffer());
  }

  const legacyDetail = await legacy.text().catch(() => '');
  throw new Error(
    legacyDetail || openAiDetail || `Kokoro returned ${openAiCompatible.status} and legacy returned ${legacy.status}.`,
  );
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
    { id: 'tzhoVKULF1uUbdfTSiBd', name: 'Henry Mascot', language: 'en' },
    { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily (F)', language: 'en' },
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
  const audioArtifactCache = createAudioArtifactCache<{ audioUrl: string }>({
    maxEntries: AUDIO_ARTIFACT_CACHE_ENTRIES,
  });

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
      const resolvedVoice = normalizeVoice(voice, cfg.voice || KOKORO_TTS_DEFAULT_VOICE);
      try {
        const audioBuffer = await requestKokoroAudio(sanitized, resolvedVoice);
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
      const resolvedVoice = normalizeVoice(voice, cfg.voice || OPENAI_TTS_VOICE);
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
      const resolvedVoice = normalizeVoice(voice, cfg.voice || DEEPGRAM_TTS_VOICE);
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
      const resolvedVoice = normalizeVoice(voice, cfg.voiceId || cfg.voice || ELEVENLABS_TTS_VOICE);
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
    const { text, provider, voice, model, documentRef } = req.body as {
      text?: string;
      provider?: string;
      voice?: string;
      model?: string;
      documentRef?: string;
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
    const resolveArtifact = async (
      resolvedVoice: string,
      resolvedModel: string,
      profileVersion: string,
      generate: () => Promise<{ audioUrl: string }>,
    ): Promise<{ artifact: { audioUrl: string }; cached: boolean }> => {
      if (typeof documentRef !== 'string' || !documentRef.trim()) {
        return { artifact: await generate(), cached: false };
      }

      const identity = buildAudioArtifactIdentity({
        documentRef: documentRef.trim(),
        text,
        maxChars: MAX_CHARS,
        provider: resolvedProvider,
        voice: resolvedVoice,
        model: resolvedModel,
        profileVersion,
        securityNamespace: resolveAudioSecurityNamespace(req),
        transformVersion: AUDIO_TRANSFORM_VERSION,
      });
      let generated = false;
      const artifact = await audioArtifactCache.getOrCreate(identity, async () => {
        generated = true;
        return generate();
      });
      return { artifact, cached: !generated };
    };

    // Kokoro (OpenAI-compatible endpoint)
    if (resolvedProvider === 'kokoro') {
      const cfg = settings.providers['local-kokoro'] ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voice || KOKORO_TTS_DEFAULT_VOICE);
      try {
        const { artifact, cached } = await resolveArtifact(
          resolvedVoice,
          'kokoro',
          'kokoro-wav-v1',
          async () => {
            const audioBuffer = await requestKokoroAudio(truncatedText, resolvedVoice);
            return { audioUrl: `data:audio/wav;base64,${audioBuffer.toString('base64')}` };
          },
        );
        res.set('X-Entity-TTS-Cache', cached ? 'HIT' : 'MISS');
        return res.json({
          status: 'ok',
          provider: 'kokoro',
          requestId: randomUUID(),
          audioUrl: artifact.audioUrl,
          voice: resolvedVoice,
          chars: truncatedText.length,
          truncated,
          cached,
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
      const resolvedVoice = normalizeVoice(voice, cfg.voice || OPENAI_TTS_VOICE);
      const resolvedModel = normalizeModel(model, cfg.model ?? OPENAI_TTS_MODEL);
      try {
        const { artifact, cached } = await resolveArtifact(
          resolvedVoice,
          resolvedModel,
          'openai-mp3-v1',
          async () => {
            const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
              method: 'POST',
              headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
              body: JSON.stringify({ model: resolvedModel, voice: resolvedVoice, input: truncatedText, format: 'mp3' }),
            });
            if (!upstream.ok) {
              const detail = await upstream.text().catch(() => '');
              throw new TtsUpstreamError(detail || `OpenAI returned ${upstream.status}.`);
            }
            const audioBuffer = Buffer.from(await upstream.arrayBuffer());
            return { audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}` };
          },
        );
        res.set('X-Entity-TTS-Cache', cached ? 'HIT' : 'MISS');
        return res.json({
          status: 'ok',
          provider: 'openai',
          requestId: randomUUID(),
          audioUrl: artifact.audioUrl,
          voice: resolvedVoice,
          model: resolvedModel,
          chars: truncatedText.length,
          truncated,
          cached,
        });
      } catch (err) {
        return res.status(err instanceof TtsUpstreamError ? 502 : 500).json({ error: 'OpenAI TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // Edge TTS (subprocess)
    if (resolvedProvider === 'edge') {
      const cfg = settings.providers['edge-tts'] ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voice ?? EDGE_TTS_VOICE);
      const { execFileSync } = await import('child_process');
      try {
        const { artifact, cached } = await resolveArtifact(
          resolvedVoice,
          'edge-tts',
          'edge-mp3-v1',
          async () => {
            const tmpFile = `/tmp/edge-tts-${randomUUID()}.mp3`;
            try {
              execFileSync(resolveEdgeTtsCommand(), buildEdgeTtsArgs({ voice: resolvedVoice, text: truncatedText, outputFile: tmpFile }), { timeout: EDGE_TTS_TIMEOUT_MS });
              const audioBuffer = fs.readFileSync(tmpFile);
              fs.unlinkSync(tmpFile);
              return { audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}` };
            } catch (error) {
              try { fs.unlinkSync(tmpFile); } catch {}
              throw error;
            }
          },
        );
        res.set('X-Entity-TTS-Cache', cached ? 'HIT' : 'MISS');
        return res.json({
          status: 'ok',
          provider: 'edge',
          requestId: randomUUID(),
          audioUrl: artifact.audioUrl,
          voice: resolvedVoice,
          chars: truncatedText.length,
          truncated,
          cached,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Edge TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // Deepgram
    if (resolvedProvider === 'deepgram') {
      const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
      if (!apiKey) return res.status(400).json({ error: 'DEEPGRAM_API_KEY is not configured.' });
      const cfg = settings.providers.deepgram ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voice || DEEPGRAM_TTS_VOICE);
      try {
        const { artifact, cached } = await resolveArtifact(
          resolvedVoice,
          'aura',
          'deepgram-default-v1',
          async () => {
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
              throw new TtsUpstreamError(detail || `Deepgram returned ${upstream.status}.`);
            }
            const audioBuffer = Buffer.from(await upstream.arrayBuffer());
            return { audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}` };
          },
        );
        res.set('X-Entity-TTS-Cache', cached ? 'HIT' : 'MISS');
        return res.json({
          status: 'ok',
          provider: 'deepgram',
          requestId: randomUUID(),
          audioUrl: artifact.audioUrl,
          voice: resolvedVoice,
          chars: truncatedText.length,
          truncated,
          cached,
        });
      } catch (err) {
        return res.status(err instanceof TtsUpstreamError ? 502 : 500).json({ error: 'Deepgram TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // ElevenLabs
    if (resolvedProvider === 'elevenlabs') {
      const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
      if (!apiKey) return res.status(400).json({ error: 'ELEVENLABS_API_KEY is not configured.' });
      const cfg = settings.providers.elevenlabs ?? {};
      const resolvedVoice = normalizeVoice(voice, cfg.voiceId || cfg.voice || ELEVENLABS_TTS_VOICE);
      try {
        const { artifact, cached } = await resolveArtifact(
          resolvedVoice,
          'eleven-multilingual-v2',
          'elevenlabs-stability-0.5-similarity-0.75-v1',
          async () => {
            const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoice}`, {
              method: 'POST',
              headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: truncatedText, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
            });
            if (!upstream.ok) {
              const detail = await upstream.text().catch(() => '');
              throw new TtsUpstreamError(detail || `ElevenLabs returned ${upstream.status}.`);
            }
            const audioBuffer = Buffer.from(await upstream.arrayBuffer());
            return { audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}` };
          },
        );
        res.set('X-Entity-TTS-Cache', cached ? 'HIT' : 'MISS');
        return res.json({
          status: 'ok',
          provider: 'elevenlabs',
          requestId: randomUUID(),
          audioUrl: artifact.audioUrl,
          voice: resolvedVoice,
          chars: truncatedText.length,
          truncated,
          cached,
        });
      } catch (err) {
        return res.status(err instanceof TtsUpstreamError ? 502 : 500).json({ error: 'ElevenLabs TTS request failed.', detail: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  });
}
