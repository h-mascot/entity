import { describe, expect, it, vi } from 'vitest';
import {
  buildAudioArtifactIdentity,
  buildEdgeTtsArgs,
  createAudioArtifactCache,
  registerTtsRoutes,
  resolveEdgeTtsCommand,
} from './tts';

describe('buildEdgeTtsArgs', () => {
  it('passes text as a subprocess argument instead of shell-escaping it', () => {
    const text = 'Hello "Ada"; rm -rf / && echo done';
    const args = buildEdgeTtsArgs({
      voice: 'en-GB-SoniaNeural',
      text,
      outputFile: '/tmp/entity-edge.mp3',
    });

    expect(args).toEqual([
      '--voice',
      'en-GB-SoniaNeural',
      '--text',
      text,
      '--write-media',
      '/tmp/entity-edge.mp3',
    ]);
  });
});

describe('resolveEdgeTtsCommand', () => {
  it('uses the repo-local virtualenv command when it exists', () => {
    expect(resolveEdgeTtsCommand('/repo', (path) => path === '/repo/.venv/bin/edge-tts')).toBe(
      '/repo/.venv/bin/edge-tts',
    );
  });

  it('finds the repo-local virtualenv command from a workspace package cwd', () => {
    expect(resolveEdgeTtsCommand('/repo/packages/server', (path) => path === '/repo/.venv/bin/edge-tts')).toBe(
      '/repo/.venv/bin/edge-tts',
    );
  });

  it('falls back to PATH when no repo-local command exists', () => {
    expect(resolveEdgeTtsCommand('/repo', () => false)).toBe('edge-tts');
  });
});

describe('audio artifact identity and reuse', () => {
  const baseIdentityInput = {
    documentRef: 'source:workspace/memory/daily-brief.md',
    text: '# Daily brief\n\nA   governed document.',
    maxChars: 4_000,
    provider: 'openai',
    voice: 'alloy',
    model: 'gpt-4o-mini-tts',
    profileVersion: 'openai-defaults-v1',
    securityNamespace: 'workspace:henry',
    transformVersion: 'markdown-speech-v1',
  };

  it('reuses one artifact for the same effective text and resolved generation profile', async () => {
    const firstIdentity = buildAudioArtifactIdentity(baseIdentityInput);
    const equivalentIdentity = buildAudioArtifactIdentity({
      ...baseIdentityInput,
      text: 'Daily brief A governed document.',
    });
    const truncatedIdentity = buildAudioArtifactIdentity({
      ...baseIdentityInput,
      text: `${baseIdentityInput.text} ignored suffix`,
      maxChars: 20,
    });
    const equivalentTruncatedIdentity = buildAudioArtifactIdentity({
      ...baseIdentityInput,
      text: baseIdentityInput.text,
      maxChars: 20,
    });
    const generate = vi.fn(async () => ({ audioUrl: 'data:audio/mpeg;base64,U0FGRQ==' }));
    const cache = createAudioArtifactCache<{ audioUrl: string }>({ maxEntries: 8 });

    expect(equivalentIdentity).toBe(firstIdentity);
    expect(truncatedIdentity).toBe(equivalentTruncatedIdentity);
    await expect(cache.getOrCreate(firstIdentity, generate)).resolves.toEqual({
      audioUrl: 'data:audio/mpeg;base64,U0FGRQ==',
    });
    await expect(cache.getOrCreate(equivalentIdentity, generate)).resolves.toEqual({
      audioUrl: 'data:audio/mpeg;base64,U0FGRQ==',
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['document', { documentRef: 'source:workspace/memory/other-brief.md' }],
    ['content', { text: '# Daily brief\n\nA different governed document.' }],
    ['provider', { provider: 'deepgram' }],
    ['voice', { voice: 'verse' }],
    ['model', { model: 'tts-1-hd' }],
    ['provider profile', { profileVersion: 'openai-defaults-v2' }],
    ['security namespace', { securityNamespace: 'workspace:other' }],
    ['transform version', { transformVersion: 'markdown-speech-v2' }],
  ])('invalidates reuse when %s changes', async (_dimension, change) => {
    const firstIdentity = buildAudioArtifactIdentity(baseIdentityInput);
    const changedIdentity = buildAudioArtifactIdentity({
      ...baseIdentityInput,
      ...change,
    });
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ audioUrl: 'data:audio/mpeg;base64,RklSU1Q=' })
      .mockResolvedValueOnce({ audioUrl: 'data:audio/mpeg;base64,U0VDT05E' });
    const cache = createAudioArtifactCache<{ audioUrl: string }>({ maxEntries: 8 });

    expect(changedIdentity).not.toBe(firstIdentity);
    await cache.getOrCreate(firstIdentity, generate);
    await cache.getOrCreate(changedIdentity, generate);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('returns only a bounded opaque digest and does not expose source text or sensitive context', () => {
    const sensitiveValues = [
      'PRIVATE_DOCUMENT_SENTENCE',
      'sk-secret-provider-key',
      'https://entity.example/docs/source/private/payroll.md',
      'workspace:private-tenant',
    ];
    const identity = buildAudioArtifactIdentity({
      ...baseIdentityInput,
      documentRef: sensitiveValues[2],
      text: sensitiveValues[0],
      securityNamespace: sensitiveValues[3],
    });

    expect(identity).toMatch(/^[a-f0-9]{64}$/);
    expect(identity).toHaveLength(64);
    for (const sensitiveValue of sensitiveValues) {
      expect(identity).not.toContain(sensitiveValue);
    }
  });

  it('bounds cache growth and evicts the least-recently-used artifact', async () => {
    const cache = createAudioArtifactCache<string>({ maxEntries: 2 });
    const generate = vi.fn(async (value: string) => value);
    const identities = ['one', 'two', 'three'].map((text) =>
      buildAudioArtifactIdentity({ ...baseIdentityInput, text }));

    await cache.getOrCreate(identities[0], () => generate('one'));
    await cache.getOrCreate(identities[1], () => generate('two'));
    await cache.getOrCreate(identities[0], () => generate('one-again'));
    await cache.getOrCreate(identities[2], () => generate('three'));
    await cache.getOrCreate(identities[1], () => generate('two-again'));

    expect(generate).toHaveBeenCalledTimes(4);
    expect(cache.size).toBe(2);
  });
});

describe('POST /api/tts/generate cache integration', () => {
  it('makes one provider request for repeated valid identity and invalidates changed content', async () => {
    const postHandlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
    const app = {
      get: vi.fn(),
      patch: vi.fn(),
      post: (route: string, handler: (req: any, res: any) => Promise<unknown>) => {
        postHandlers.set(route, handler);
      },
    };
    const db = {
      exec: vi.fn(),
      prepare: vi.fn(() => ({ get: vi.fn(() => undefined) })),
    };
    registerTtsRoutes({ app, db: db as any });
    const generate = postHandlers.get('/api/tts/generate');
    expect(generate).toBeTypeOf('function');

    const providerFetch = vi.fn(async () =>
      new Response(Uint8Array.from([82, 73, 70, 70]), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      }));
    vi.stubGlobal('fetch', providerFetch);

    const invoke = async (text: string) => {
      const headers = new Map<string, string>();
      let payload: any;
      const req = {
        body: {
          documentRef: 'source:workspace/memory/daily-brief.md',
          text,
          provider: 'kokoro',
          voice: 'bf_alice',
        },
        header: (name: string) => (
          name.toLowerCase() === 'x-entity-org-id' ? 'org-a' : undefined
        ),
      };
      const res = {
        set: (name: string, value: string) => {
          headers.set(name, value);
          return res;
        },
        status: vi.fn(() => res),
        json: (value: any) => {
          payload = value;
          return value;
        },
      };
      await generate!(req, res);
      return { headers, payload };
    };

    try {
      const first = await invoke('# Daily brief\n\nSame content.');
      const reused = await invoke('Daily brief Same   content.');
      const changed = await invoke('Daily brief changed content.');

      expect(providerFetch).toHaveBeenCalledTimes(2);
      expect(first.headers.get('X-Entity-TTS-Cache')).toBe('MISS');
      expect(first.payload.cached).toBe(false);
      expect(reused.headers.get('X-Entity-TTS-Cache')).toBe('HIT');
      expect(reused.payload.cached).toBe(true);
      expect(reused.payload.audioUrl).toBe(first.payload.audioUrl);
      expect(changed.headers.get('X-Entity-TTS-Cache')).toBe('MISS');
      expect(changed.payload.cached).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
