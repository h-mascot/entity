import { useCallback, useEffect, useState } from 'react';

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

interface ProviderHealth {
  id: string;
  enabled: boolean;
  voice: string | null;
  voiceId: string | null;
  model: string | null;
  baseUrl: string | null;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const PROVIDER_LABELS: Record<TtsProvider, string> = {
  kokoro: 'Kokoro (local)',
  edge: 'Microsoft Edge TTS',
  browser: 'Browser TTS',
  openai: 'OpenAI',
  deepgram: 'Deepgram',
  elevenlabs: 'ElevenLabs',
};

const PAID_PROVIDERS: TtsProvider[] = ['openai', 'deepgram', 'elevenlabs'];

function isPaidProvider(p: TtsProvider): boolean {
  return PAID_PROVIDERS.includes(p);
}

function providerNeedsSecret(p: TtsProvider): boolean {
  return p === 'openai' || p === 'deepgram' || p === 'elevenlabs';
}

export default function VoiceSettings({ apiBase }: { apiBase?: string }) {
  const [settings, setSettings] = useState<TtsSettings | null>(null);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state (mirrors current settings)
  const [provider, setProvider] = useState<TtsProvider>('kokoro');
  const [defaultSpeed, setDefaultSpeed] = useState(1);
  const [maxChars, setMaxChars] = useState(3800);

  // Provider-specific fields
  const [kokoroBaseUrl, setKokoroBaseUrl] = useState('');
  const [openaiApiKeyEnv, setOpenaiApiKeyEnv] = useState('OPENAI_API_KEY');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o-mini-tts');
  const [openaiVoice, setOpenaiVoice] = useState('alloy');
  const [deepgramApiKeyEnv, setDeepgramApiKeyEnv] = useState('DEEPGRAM_API_KEY');
  const [deepgramVoice, setDeepgramVoice] = useState('aura-2-luna-en');
  const [elevenlabsApiKeyEnv, setElevenlabsApiKeyEnv] = useState('ELEVENLABS_API_KEY');
  const [elevenlabsVoiceId, setElevenlabsVoiceId] = useState('EXAVITc4tvU7xuL82wvV');

  // Test controls
  const [testText, setTestText] = useState('This is a test of the text to speech system.');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testAudioUrl, setTestAudioUrl] = useState<string | null>(null);

  const base = apiBase ?? '';

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, healthRes] = await Promise.all([
        fetch(`${base}/api/tts/settings`),
        fetch(`${base}/api/tts/providers`),
      ]);

      if (!settingsRes.ok) throw new Error(`Failed to load settings: ${settingsRes.status}`);
      const settingsData: TtsSettings = await settingsRes.json();

      let healthData: ProviderHealth[] = [];
      if (healthRes.ok) {
        const healthJson = await healthRes.json();
        healthData = healthJson.providers ?? [];
      }

      setSettings(settingsData);
      setHealth(healthData);

      // Populate form
      setProvider(settingsData.provider as TtsProvider);
      setDefaultSpeed(settingsData.defaultSpeed);
      setMaxChars(settingsData.maxChars);

      const providers = settingsData.providers;
      if (providers['local-kokoro']) {
        setKokoroBaseUrl(providers['local-kokoro'].baseUrl ?? 'http://127.0.0.1:8000');
      }
      if (providers.openai) {
        setOpenaiApiKeyEnv(providers.openai.apiKeyEnv ?? 'OPENAI_API_KEY');
        setOpenaiModel(providers.openai.model ?? 'gpt-4o-mini-tts');
        setOpenaiVoice(providers.openai.voice ?? 'alloy');
      }
      if (providers.deepgram) {
        setDeepgramApiKeyEnv(providers.deepgram.apiKeyEnv ?? 'DEEPGRAM_API_KEY');
        setDeepgramVoice(providers.deepgram.voice ?? 'aura-2-luna-en');
      }
      if (providers.elevenlabs) {
        setElevenlabsApiKeyEnv(providers.elevenlabs.apiKeyEnv ?? 'ELEVENLABS_API_KEY');
        setElevenlabsVoiceId(providers.elevenlabs.voiceId ?? 'EXAVITc4tvU7xuL82wvV');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<TtsSettings> = {
        provider,
        defaultSpeed,
        maxChars,
        providers: {
          'local-kokoro': { enabled: true, baseUrl: kokoroBaseUrl },
          openai: { enabled: true, apiKeyEnv: openaiApiKeyEnv, model: openaiModel, voice: openaiVoice },
          deepgram: { enabled: true, apiKeyEnv: deepgramApiKeyEnv, voice: deepgramVoice },
          elevenlabs: { enabled: true, apiKeyEnv: elevenlabsApiKeyEnv, voiceId: elevenlabsVoiceId },
        },
      };

      const res = await fetch(`${base}/api/tts/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const updated: TtsSettings = await res.json();
      setSettings(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [base, provider, defaultSpeed, maxChars, kokoroBaseUrl, openaiApiKeyEnv, openaiModel, openaiVoice, deepgramApiKeyEnv, deepgramVoice, elevenlabsApiKeyEnv, elevenlabsVoiceId]);

  const handleTestVoice = useCallback(async () => {
    if (!testText.trim()) return;
    setTesting(true);
    setTestResult(null);
    setTestAudioUrl(null);
    try {
      const res = await fetch(`${base}/api/tts/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: testText,
          provider,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ ok: false, message: data.error ?? 'Test failed' });
      } else {
        setTestResult({ ok: true, message: `✅ Test successful — ${data.chars ?? testText.length} chars processed via ${data.provider ?? provider}.` });
        if (data.audioUrl) setTestAudioUrl(data.audioUrl);
      }
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  }, [base, testText, provider]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-sm text-[var(--text-muted)]">Loading TTS settings…</span>
      </div>
    );
  }

  const paidProvidersMissingSecret = (['openai', 'deepgram', 'elevenlabs'] as TtsProvider[]).filter(
    (p) => p === provider
  );

  // Check if selected provider is paid and check its env var presence in health
  // We can't directly check env vars — health just tells us if it's enabled.
  // The warning is shown based on provider selection, not actual env presence.
  const showPaidWarning = isPaidProvider(provider);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="text-sm font-semibold text-[var(--text-primary)]">Voice / TTS Settings</div>
        <div className="mt-1 text-xs text-[var(--text-muted)]">
          Configure the text-to-speech provider, voice preferences, and test playback.
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--error)]">
          {error}
        </div>
      )}

      {/* Provider health strip */}
      {health.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-6">
          {health.map((h) => (
            <div key={h.id} className="mc-shell-card border border-[var(--border-secondary)] p-3">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{h.id}</div>
              <div className={`mt-1.5 text-sm font-medium ${h.enabled ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                {h.enabled ? 'Enabled' : 'Disabled'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Paid provider warning */}
      {showPaidWarning && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-300">
          ⚠️ <strong>{PROVIDER_LABELS[provider]}</strong> is a paid provider. Ensure the required API key is
          configured in the server environment (e.g. <code className="text-yellow-200">{provider === 'openai' ? openaiApiKeyEnv : provider === 'deepgram' ? deepgramApiKeyEnv : elevenlabsApiKeyEnv}</code>).
        </div>
      )}

      {/* Active provider */}
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">Active provider</div>
        <div className="mb-3 text-xs text-[var(--text-muted)]">Select which TTS engine to use for voice output.</div>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as TtsProvider)}
          className="mc-shell-input w-full max-w-sm px-3 py-2 text-sm"
        >
          {(Object.keys(PROVIDER_LABELS) as TtsProvider[]).map((p) => (
            <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
          ))}
        </select>
      </div>

      {/* Provider-specific config */}
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="mb-4 text-sm font-medium text-[var(--text-primary)]">Provider settings</div>

        {provider === 'kokoro' && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Base URL</label>
              <input
                type="text"
                value={kokoroBaseUrl}
                onChange={(e) => setKokoroBaseUrl(e.target.value)}
                className="mc-shell-input w-full max-w-sm px-3 py-2 text-sm"
                placeholder="http://127.0.0.1:8000"
              />
            </div>
          </div>
        )}

        {provider === 'openai' && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">API key env var name</label>
              <input
                type="text"
                value={openaiApiKeyEnv}
                onChange={(e) => setOpenaiApiKeyEnv(e.target.value)}
                className="mc-shell-input w-full max-w-sm px-3 py-2 text-sm"
                placeholder="OPENAI_API_KEY"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Model</label>
              <input
                type="text"
                value={openaiModel}
                onChange={(e) => setOpenaiModel(e.target.value)}
                className="mc-shell-input w-full max-w-sm px-3 py-2 text-sm"
                placeholder="gpt-4o-mini-tts"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Voice</label>
              <input
                type="text"
                value={openaiVoice}
                onChange={(e) => setOpenaiVoice(e.target.value)}
                className="mc-shell-input w-full max-w-sm px-3 py-2 text-sm"
                placeholder="alloy"
              />
            </div>
          </div>
        )}

        {provider === 'deepgram' && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">API key env var name</label>
              <input
                type="text"
                value={deepgramApiKeyEnv}
                onChange={(e) => setDeepgramApiKeyEnv(e.target.value)}
                className="mc-shell-input w-full max-w-sm px-3 py-2 text-sm"
                placeholder="DEEPGRAM_API_KEY"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Voice</label>
              <input
                type="text"
                value={deepgramVoice}
                onChange={(e) => setDeepgramVoice(e.target.value)}
                className="mc-shell-input w-full max-w-sm px-3 py-2 text-sm"
                placeholder="aura-2-luna-en"
              />
            </div>
          </div>
        )}

        {provider === 'elevenlabs' && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">API key env var name</label>
              <input
                type="text"
                value={elevenlabsApiKeyEnv}
                onChange={(e) => setElevenlabsApiKeyEnv(e.target.value)}
                className="mc-shell-input w-full max-w-sm px-3 py-2 text-sm"
                placeholder="ELEVENLABS_API_KEY"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Voice ID</label>
              <input
                type="text"
                value={elevenlabsVoiceId}
                onChange={(e) => setElevenlabsVoiceId(e.target.value)}
                className="mc-shell-input w-full max-w-sm px-3 py-2 text-sm"
                placeholder="EXAVITc4tvU7xuL82wvV"
              />
            </div>
          </div>
        )}

        {(provider === 'edge' || provider === 'browser') && (
          <div className="text-xs text-[var(--text-muted)]">
            {provider === 'edge'
              ? 'Edge TTS uses a local edge-tts subprocess. Ensure edge-tts is installed on the server.'
              : 'Browser TTS uses the Web Speech API in the client browser — no server configuration needed.'}
          </div>
        )}
      </div>

      {/* Defaults section */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
          <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">Default speed</div>
          <div className="mb-3 text-xs text-[var(--text-muted)]">Playback speed for generated audio.</div>
          <select
            value={defaultSpeed}
            onChange={(e) => setDefaultSpeed(Number(e.target.value))}
            className="mc-shell-input w-full px-3 py-2 text-sm"
          >
            {SPEED_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}×</option>
            ))}
          </select>
        </div>

        <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
          <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">Max chars per request</div>
          <div className="mb-3 text-xs text-[var(--text-muted)]">Maximum characters submitted per TTS request.</div>
          <input
            type="number"
            min={100}
            max={4000}
            value={maxChars}
            onChange={(e) => setMaxChars(Math.max(100, Math.min(4000, Number(e.target.value))))}
            className="mc-shell-input w-full px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--text-primary)]"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {/* Test voice */}
      <div className="mc-shell-card border border-[var(--border-secondary)] p-4">
        <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">Test voice</div>
        <div className="mb-3 text-xs text-[var(--text-muted)]">
          Enter text and play it back with the currently selected provider.
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            className="mc-shell-input flex-1 px-3 py-2 text-sm"
            placeholder="Type something to test…"
          />
          <button
            type="button"
            onClick={() => void handleTestVoice()}
            disabled={testing || !testText.trim()}
            className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--text-primary)]"
          >
            {testing ? 'Playing…' : 'Test voice'}
          </button>
        </div>
        {testResult && (
          <div className={`mt-3 rounded-lg px-4 py-3 text-xs ${testResult.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>
            {testResult.message}
          </div>
        )}
        {testAudioUrl && (
          <div className="mt-3">
            <audio src={testAudioUrl} controls className="w-full max-w-sm" />
          </div>
        )}
      </div>
    </div>
  );
}