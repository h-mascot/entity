import { useCallback, useEffect, useRef, useState } from 'react';
import { runtime } from '../config/runtime';
import { buildApiCandidates, toErrorMessage } from '../lib/http';

type ToastType = 'success' | 'error' | 'info' | 'warning';
type DocsTtsProvider = 'browser' | 'kokoro' | 'edge' | 'openai' | 'deepgram' | 'elevenlabs';

interface Voice {
  id: string;
  name: string;
  language?: string;
}

export interface DocsTtsSettings {
  provider: DocsTtsProvider;
  kokoroVoice: string;
  edgeVoice: string;
  openaiVoice: string;
  openaiModel: string;
  deepgramVoice: string;
  elevenlabsVoice: string;
  playbackRate: number;
}

interface DocsTtsResponse {
  audioUrl?: string | null;
  chars?: number;
  truncated?: boolean;
  error?: string;
  detail?: string;
}

interface MarkdownAudioControlsProps {
  docsPath: string;
  content: string;
  settings: DocsTtsSettings;
  onSettingsChange?: (settings: DocsTtsSettings) => void;
  onToast: (message: string, type: ToastType) => void;
  compact?: boolean;
}

const PROVIDER_LABELS: Record<DocsTtsProvider, string> = {
  browser: 'Browser',
  kokoro: 'Kokoro',
  edge: 'Edge',
  openai: 'OpenAI',
  deepgram: 'Deepgram',
  elevenlabs: 'ElevenLabs',
};

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function markdownToSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveAudioUrl(rawUrl: string): string {
  const base =
    (typeof window !== 'undefined' && window.location.origin) ||
    runtime.apiBase ||
    'http://localhost:3000';

  try {
    return new URL(rawUrl, base).toString();
  } catch {
    return rawUrl;
  }
}

function getVoiceForProvider(settings: DocsTtsSettings): string {
  switch (settings.provider) {
    case 'kokoro': return settings.kokoroVoice || 'bf_alice';
    case 'edge': return settings.edgeVoice || 'en-GB-SoniaNeural';
    case 'openai': return settings.openaiVoice || 'alloy';
    case 'deepgram': return settings.deepgramVoice || 'aura-angus-en';
    case 'elevenlabs': return settings.elevenlabsVoice || 'EXAVITc4tvU7xuL82wvV';
    default: return '';
  }
}

export default function MarkdownAudioControls({
  docsPath,
  content,
  settings,
  onSettingsChange,
  onToast,
  compact = false,
}: MarkdownAudioControlsProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [chars, setChars] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [browserSpeaking, setBrowserSpeaking] = useState(false);
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);

  const stopBrowserSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setBrowserSpeaking(false);
  }, []);

  // Reset state when doc changes
  useEffect(() => {
    setAudioUrl(null);
    setErrorMessage(null);
    setChars(null);
    setTruncated(false);
    setBrowserSpeaking(false);
    setShowProviderMenu(false);
    setShowVoiceMenu(false);
    setShowSpeedMenu(false);
    setShowSettingsMenu(false);
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, [docsPath]);

  // Load voices when provider changes
  useEffect(() => {
    if (settings.provider === 'browser' || settings.provider === 'kokoro') {
      setVoices([]);
      return;
    }

    let cancelled = false;
    setLoadingVoices(true);

    const urls = buildApiCandidates('/api/tts/voices', runtime.apiBase)
      .filter((url) => url.includes('/api/'));

    const providerUrl = `${urls[0]}?provider=${settings.provider}`;

    fetch(providerUrl)
      .then((r) => r.json())
      .then((data: { voices?: Voice[] }) => {
        if (!cancelled) setVoices(data.voices ?? []);
      })
      .catch(() => {
        if (!cancelled) setVoices([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingVoices(false);
      });

    return () => {
      cancelled = true;
    };
  }, [settings.provider]);

  const handleBrowserAudio = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      const message = 'Browser speech synthesis is not available.';
      setErrorMessage(message);
      onToast(message, 'error');
      return;
    }

    if (browserSpeaking) {
      stopBrowserSpeech();
      return;
    }

    const text = markdownToSpeechText(content).slice(0, 4000);
    if (!text) {
      const message = 'Document is empty after TTS cleanup.';
      setErrorMessage(message);
      onToast(message, 'warning');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = settings.playbackRate || 1;
    utterance.onend = () => setBrowserSpeaking(false);
    utterance.onerror = () => {
      setBrowserSpeaking(false);
      setErrorMessage('Browser TTS failed.');
      onToast('Browser TTS failed.', 'error');
    };

    setAudioUrl(null);
    setChars(text.length);
    setTruncated(markdownToSpeechText(content).length > text.length);
    setErrorMessage(null);
    setBrowserSpeaking(true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    onToast('Browser TTS started.', 'success');
  }, [browserSpeaking, content, onToast, settings.playbackRate, stopBrowserSpeech]);

  const handleGenerateAudio = useCallback(async () => {
    if (settings.provider === 'browser') {
      handleBrowserAudio();
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setAudioUrl(null);

    const text = markdownToSpeechText(content).slice(0, 4000);
    if (!text) {
      setLoading(false);
      setErrorMessage('Document is empty after TTS cleanup.');
      onToast('Document is empty after TTS cleanup.', 'warning');
      return;
    }

    const body: Record<string, string> = {
      text,
      provider: settings.provider,
    };

    const voice = getVoiceForProvider(settings);
    if (voice) body.voice = voice;
    if (settings.provider === 'openai' && settings.openaiModel) {
      body.model = settings.openaiModel;
    }

    const urls = buildApiCandidates('/api/tts/generate', runtime.apiBase)
      .filter((url) => url.includes('/api/'));
    let lastError: Error | null = null;

    try {
      for (const baseUrl of urls) {
        try {
          const response = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });

          const payload = (await response.json().catch(() => null)) as DocsTtsResponse | null;

          if (!response.ok) {
            const message =
              [payload?.error, payload?.detail].filter(Boolean).join(' ') ||
              `TTS request failed (${response.status}).`;
            throw new Error(message);
          }

          const nextAudioUrl =
            typeof payload?.audioUrl === 'string' && payload.audioUrl.trim()
              ? payload.audioUrl.trim()
              : null;

          if (!nextAudioUrl) {
            throw new Error('TTS succeeded but did not return an audio URL.');
          }

          setAudioUrl(resolveAudioUrl(nextAudioUrl));
          setChars(typeof payload?.chars === 'number' ? payload.chars : null);
          setTruncated(Boolean(payload?.truncated));
          onToast('Audio ready.', 'success');
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Failed to generate audio.');
        }
      }

      const message = toErrorMessage(lastError, 'Failed to generate audio.');
      setErrorMessage(message);
      onToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [content, handleBrowserAudio, onToast, settings]);

  // Auto-play when audioUrl changes
  useEffect(() => {
    if (!audioUrl || !audioRef.current) return;

    audioRef.current.playbackRate = settings.playbackRate || 1;
    audioRef.current
      .play()
      .catch(() => {});
  }, [audioUrl, settings.playbackRate]);

  const updateSetting = useCallback(
    (key: keyof DocsTtsSettings, value: DocsTtsSettings[keyof DocsTtsSettings]) => {
      if (!onSettingsChange) return;
      onSettingsChange({ ...settings, [key]: value });
    },
    [settings, onSettingsChange]
  );

  const handleSpeedChange = useCallback(
    (speed: number) => {
      updateSetting('playbackRate', speed);
      if (audioRef.current) {
        audioRef.current.playbackRate = speed;
      }
      setShowSpeedMenu(false);
    },
    [updateSetting]
  );

  const handleProviderChange = useCallback(
    (provider: DocsTtsProvider) => {
      updateSetting('provider', provider);
      setShowProviderMenu(false);
      setShowVoiceMenu(false);
    },
    [updateSetting]
  );

  const handleVoiceChange = useCallback(
    (voiceId: string) => {
      switch (settings.provider) {
        case 'kokoro': updateSetting('kokoroVoice', voiceId); break;
        case 'edge': updateSetting('edgeVoice', voiceId); break;
        case 'openai': updateSetting('openaiVoice', voiceId); break;
        case 'deepgram': updateSetting('deepgramVoice', voiceId); break;
        case 'elevenlabs': updateSetting('elevenlabsVoice', voiceId); break;
      }
      setShowVoiceMenu(false);
    },
    [settings.provider, updateSetting]
  );

  const currentVoice = getVoiceForProvider(settings);
  const availableVoices = settings.provider === 'browser' || settings.provider === 'kokoro'
    ? (settings.provider === 'kokoro' ? [{ id: 'bf_alice', name: 'Alice' }, { id: 'bf_emma', name: 'Emma' }, { id: 'bm_lewis', name: 'Lewis' }] : [])
    : voices;
  const providerLabel = PROVIDER_LABELS[settings.provider] || settings.provider;

  // Compact mode
  if (compact) {
    return (
      <div className="relative inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => void handleGenerateAudio()}
          disabled={loading}
          className={`mc-shell-btn px-2 py-1 text-xs ${loading ? 'cursor-wait opacity-70' : ''} ${browserSpeaking ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''}`}
          title={`Listen with ${providerLabel}`}
        >
          {loading ? '...' : browserSpeaking ? '■ Stop' : '🔊 Listen'}
        </button>

        {/* Listen settings */}
        {onSettingsChange && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSettingsMenu(!showSettingsMenu)}
              className="mc-shell-btn px-1.5 py-1 text-xs"
              title="Listen settings"
            >
              ⚙
            </button>
            {showSettingsMenu && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 space-y-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 shadow-lg">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Provider</label>
                  <select
                    className="mc-shell-input w-full px-2 py-1 text-xs"
                    value={settings.provider}
                    onChange={(e) => {
                      updateSetting('provider', e.target.value as DocsTtsProvider);
                    }}
                  >
                    {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                {availableVoices.length > 0 || loadingVoices ? (
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Voice</label>
                    <select
                      className="mc-shell-input w-full px-2 py-1 text-xs"
                      value={currentVoice}
                      disabled={loadingVoices}
                      onChange={(e) => {
                        switch (settings.provider) {
                          case 'kokoro': updateSetting('kokoroVoice', e.target.value); break;
                          case 'edge': updateSetting('edgeVoice', e.target.value); break;
                          case 'openai': updateSetting('openaiVoice', e.target.value); break;
                          case 'deepgram': updateSetting('deepgramVoice', e.target.value); break;
                          case 'elevenlabs': updateSetting('elevenlabsVoice', e.target.value); break;
                        }
                      }}
                    >
                      {loadingVoices ? (
                        <option disabled>Loading voices…</option>
                      ) : (
                        availableVoices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}{v.language ? ` (${v.language})` : ''}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                ) : null}
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Speed</label>
                  <select
                    className="mc-shell-input w-full px-2 py-1 text-xs"
                    value={String(settings.playbackRate)}
                    onChange={(e) => {
                      const speed = Number(e.target.value);
                      updateSetting('playbackRate', speed);
                      if (audioRef.current) {
                        audioRef.current.playbackRate = speed;
                      }
                    }}
                  >
                    {SPEED_OPTIONS.map((speed) => (
                      <option key={speed} value={String(speed)}>{speed}x</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSettingsMenu(false)}
                  className="mc-shell-btn w-full justify-center px-2 py-1 text-xs"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {errorMessage ? (
          <div className="absolute right-0 top-10 z-20 w-64 rounded-lg border border-[var(--error)]/40 bg-[var(--bg-secondary)] p-2 text-xs text-[var(--error)] shadow-lg">
            {errorMessage}
          </div>
        ) : null}

        {/* Audio player */}
        {audioUrl ? (
          <audio
            ref={audioRef}
            controls
            preload="none"
            className="absolute right-0 top-10 z-20 w-64 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)]"
            src={audioUrl}
          >
            Your browser does not support inline audio.
          </audio>
        ) : null}
      </div>
    );
  }

  // Full mode
  return (
    <div className="mb-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleGenerateAudio()}
          disabled={loading}
          className={`mc-shell-btn px-3 py-1 text-xs font-medium ${loading ? 'cursor-wait opacity-70' : ''}`}
        >
          {loading
            ? 'Generating audio…'
            : browserSpeaking
              ? '■ Stop browser TTS'
              : audioUrl
                ? 'Regenerate audio'
                : `Listen with ${providerLabel}`}
        </button>

        {/* Provider dropdown */}
        {onSettingsChange && (
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowProviderMenu(!showProviderMenu); setShowVoiceMenu(false); setShowSpeedMenu(false); }}
              className="mc-shell-btn px-2 py-1 text-xs"
            >
              Provider: {providerLabel} ▾
            </button>
            {showProviderMenu && (
              <div className="absolute left-0 top-full z-30 mt-1 w-36 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-lg">
                {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void handleProviderChange(key as DocsTtsProvider)}
                    className={`w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-primary)] ${settings.provider === key ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-primary)]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Voice dropdown */}
        {onSettingsChange && availableVoices.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowVoiceMenu(!showVoiceMenu); setShowProviderMenu(false); setShowSpeedMenu(false); }}
              className="mc-shell-btn px-2 py-1 text-xs"
              disabled={loadingVoices}
            >
              {loadingVoices ? 'Loading voices…' : `Voice: ${currentVoice || 'default'} ▾`}
            </button>
            {showVoiceMenu && (
              <div className="absolute left-0 top-full z-30 mt-1 w-48 max-h-48 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-lg">
                {availableVoices.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => void handleVoiceChange(v.id)}
                    className={`w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-primary)] ${currentVoice === v.id ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-primary)]'}`}
                  >
                    {v.name} <span className="text-[var(--text-muted)]">{v.language}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Speed selector */}
        {onSettingsChange && (
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowSpeedMenu(!showSpeedMenu); setShowProviderMenu(false); setShowVoiceMenu(false); }}
              className="mc-shell-btn px-2 py-1 text-xs"
            >
              Speed: {settings.playbackRate}x ▾
            </button>
            {showSpeedMenu && (
              <div className="absolute left-0 top-full z-30 mt-1 w-20 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-lg">
                {SPEED_OPTIONS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => void handleSpeedChange(speed)}
                    className={`w-full px-3 py-1.5 text-center text-xs hover:bg-[var(--bg-primary)] ${settings.playbackRate === speed ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-primary)]'}`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <span className="text-[11px] text-[var(--text-muted)]">
          {providerLabel}.{chars !== null ? ` ${chars.toLocaleString()} chars${truncated ? ' · truncated' : ''}.` : ''}
        </span>
      </div>

      {errorMessage ? (
        <div className="mt-2 text-xs text-[var(--error)]">{errorMessage}</div>
      ) : null}

      {audioUrl ? (
        <audio
          ref={audioRef}
          controls
          preload="none"
          className="mt-3 w-full"
          src={audioUrl}
        >
          Your browser does not support inline audio playback.
        </audio>
      ) : null}
    </div>
  );
}
