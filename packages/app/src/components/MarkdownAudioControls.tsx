import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
} from 'react';
import { runtime } from '../config/runtime';
import {
  buildDocumentAudioContentIdentity,
  buildDocumentAudioGenerationIdentity,
  createDocumentAudioState,
  reduceDocumentAudioState,
  resolveDocumentAudioAction,
  resolveMobileDocumentAudioMiniPlayer,
} from '../lib/documentAudioState';
import {
  DocumentAudioRequestError,
  requestDocumentAudio,
  resolveSafeDocumentAudioUrl,
} from '../lib/documentAudioRequest';
import { buildApiCandidates, withApiToken } from '../lib/http';
import { emitDocHubTelemetry } from '../lib/docHubTelemetry';

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

interface MarkdownAudioControlsProps {
  docsPath: string;
  documentIdentity?: string;
  content: string;
  settings: DocsTtsSettings;
  onSettingsChange?: (settings: DocsTtsSettings) => void;
  onOpenVoiceSettings?: () => void;
  onToast: (message: string, type: ToastType) => void;
  compact?: boolean;
  mobileSticky?: boolean;
  mobileDocumentLabel?: string;
}

export interface MarkdownAudioControlsHandle {
  activate: () => void;
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

const MarkdownAudioControls = forwardRef<MarkdownAudioControlsHandle, MarkdownAudioControlsProps>(function MarkdownAudioControls({
  docsPath,
  documentIdentity = docsPath,
  content,
  settings,
  onSettingsChange,
  onOpenVoiceSettings,
  onToast,
  compact = false,
  mobileSticky = false,
  mobileDocumentLabel = docsPath,
}, forwardedRef) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioState, dispatchAudio] = useReducer(
    reduceDocumentAudioState,
    documentIdentity,
    createDocumentAudioState,
  );
  const audioStateRef = useRef(audioState);
  audioStateRef.current = audioState;
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<{ documentIdentity: string; requestId: string } | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const browserUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioUrl = audioState.audioUrl;
  const loading = audioState.status === 'generating';
  const errorMessage = audioState.errorMessage;
  const chars = audioState.chars;
  const truncated = audioState.truncated;
  const primaryAction = resolveDocumentAudioAction(audioState);
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const generationIdentity = buildDocumentAudioGenerationIdentity({
    documentIdentity,
    contentIdentity: buildDocumentAudioContentIdentity(content),
    provider: settings.provider,
    voice: getVoiceForProvider(settings),
    model: settings.provider === 'openai' ? settings.openaiModel : '',
    playbackRate: settings.playbackRate,
  });
  const generationIdentityRef = useRef(generationIdentity);
  const telemetrySurface = mobileSticky ? 'mobile' : 'desktop';

  // Reset generated artifacts when the document or synthesis profile changes.
  useEffect(() => {
    const previousGenerationIdentity = generationIdentityRef.current;
    generationIdentityRef.current = generationIdentity;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    activeRequestRef.current = null;
    dispatchAudio({ type: 'document-changed', documentIdentity });
    dispatchAudio({
      type: 'generation-inputs-changed',
      currentIdentity: previousGenerationIdentity,
      nextIdentity: generationIdentity,
    });
    setShowProviderMenu(false);
    setShowVoiceMenu(false);
    setShowSpeedMenu(false);
    setShowSettingsMenu(false);
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    browserUtteranceRef.current = null;
    const audio = audioRef.current;
    audio?.pause();
    audio?.removeAttribute('src');
    return () => {
      requestAbortRef.current?.abort();
      const activeAudio = audioRef.current;
      activeAudio?.pause();
      activeAudio?.removeAttribute('src');
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      browserUtteranceRef.current = null;
    };
  }, [documentIdentity, generationIdentity]);

  // Load voices when provider changes
  useEffect(() => {
    if (settings.provider === 'browser' || settings.provider === 'kokoro') {
      setVoices([]);
      return;
    }

    let cancelled = false;
    setLoadingVoices(true);

    const urls = buildApiCandidates(
      `/api/tts/providers/${encodeURIComponent(settings.provider)}/voices`,
      runtime.apiBase,
    )
      .filter((url) => url.includes('/api/'));
    const providerUrl = urls[0];

    fetch(providerUrl, withApiToken())
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
    const startedAt = Date.now();
    emitDocHubTelemetry({
      name: 'doc_hub.audio_generation.started',
      properties: { provider: 'browser', surface: telemetrySurface },
    });
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      const message = 'Browser speech synthesis is not available.';
      emitDocHubTelemetry({
        name: 'doc_hub.audio_generation.completed',
        properties: {
          provider: 'browser',
          outcome: 'provider-missing',
          cached: false,
          truncated: false,
          durationMs: Date.now() - startedAt,
        },
      });
      dispatchAudio({ type: 'provider-missing', message });
      onToast(message, 'error');
      return;
    }

    const text = markdownToSpeechText(content).slice(0, 4000);
    if (!text) {
      const message = 'Document is empty after TTS cleanup.';
      const requestId = `browser-${++requestSequenceRef.current}`;
      emitDocHubTelemetry({
        name: 'doc_hub.audio_generation.completed',
        properties: {
          provider: 'browser',
          outcome: 'failure',
          cached: false,
          truncated: false,
          durationMs: Date.now() - startedAt,
        },
      });
      dispatchAudio({ type: 'listen-requested', documentIdentity, requestId, transport: 'browser' });
      dispatchAudio({ type: 'generation-failed', documentIdentity, requestId, message });
      onToast(message, 'warning');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const requestId = `browser-${++requestSequenceRef.current}`;
    utterance.rate = settings.playbackRate || 1;
    utterance.onend = () => {
      if (browserUtteranceRef.current !== utterance) {
        return;
      }
      dispatchAudio({
        type: 'playback-ended',
        documentIdentity,
        requestId,
      });
    };
    utterance.onerror = () => {
      if (browserUtteranceRef.current !== utterance) {
        return;
      }
      dispatchAudio({
        type: 'generation-failed',
        documentIdentity,
        requestId,
        message: 'Browser TTS failed.',
      });
      emitDocHubTelemetry({
        name: 'doc_hub.audio_playback.error',
        properties: {
          phase: 'browser',
          recoverable: true,
          provider: 'browser',
        },
      });
      onToast('Browser TTS failed.', 'error');
    };

    window.speechSynthesis.cancel();
    browserUtteranceRef.current = utterance;
    dispatchAudio({ type: 'listen-requested', documentIdentity, requestId, transport: 'browser' });
    dispatchAudio({ type: 'playback-started', documentIdentity, requestId });
    window.speechSynthesis.speak(utterance);
    emitDocHubTelemetry({
      name: 'doc_hub.audio_generation.completed',
      properties: {
        provider: 'browser',
        outcome: 'success',
        cached: false,
        truncated: text.length >= 4000,
        durationMs: Date.now() - startedAt,
      },
    });
    onToast('Browser TTS started.', 'success');
  }, [content, documentIdentity, onToast, settings.playbackRate, telemetrySurface]);

  const handleGenerateAudio = useCallback(async () => {
    if (activeRequestRef.current || audioStateRef.current.status === 'generating') {
      return;
    }
    if (settings.provider === 'browser') {
      handleBrowserAudio();
      return;
    }

    const startedAt = Date.now();
    emitDocHubTelemetry({
      name: 'doc_hub.audio_generation.started',
      properties: {
        provider: settings.provider,
        surface: telemetrySurface,
      },
    });
    const text = markdownToSpeechText(content).slice(0, 4000);
    const requestId = `tts-${++requestSequenceRef.current}`;
    if (!text) {
      const message = 'Document is empty after TTS cleanup.';
      emitDocHubTelemetry({
        name: 'doc_hub.audio_generation.completed',
        properties: {
          provider: settings.provider,
          outcome: 'failure',
          cached: false,
          truncated: false,
          durationMs: Date.now() - startedAt,
        },
      });
      dispatchAudio({ type: 'listen-requested', documentIdentity, requestId });
      dispatchAudio({ type: 'generation-failed', documentIdentity, requestId, message });
      onToast(message, 'warning');
      return;
    }

    const abortController = new AbortController();
    requestAbortRef.current = abortController;
    activeRequestRef.current = { documentIdentity, requestId };
    dispatchAudio({ type: 'listen-requested', documentIdentity, requestId });

    const body = {
      documentRef: documentIdentity,
      text,
      provider: settings.provider,
    } as {
      text: string;
      provider: string;
      documentRef?: string;
      voice?: string;
      model?: string;
    };

    const voice = getVoiceForProvider(settings);
    if (voice) body.voice = voice;
    if (settings.provider === 'openai' && settings.openaiModel) {
      body.model = settings.openaiModel;
    }

    const urls = buildApiCandidates('/api/tts/generate', runtime.apiBase)
      .filter((url) => url.includes('/api/'));

    try {
      const result = await requestDocumentAudio({
        urls,
        body,
        signal: abortController.signal,
        init: withApiToken(),
      });
      const pageOrigin =
        typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin;
      const nextAudioUrl = resolveSafeDocumentAudioUrl(
        result.audioUrl,
        pageOrigin,
        runtime.apiBase,
      );
      if (!nextAudioUrl) {
        throw new DocumentAudioRequestError(
          'provider',
          'The audio provider returned an unsafe or unsupported audio location. Try another provider.',
        );
      }

      dispatchAudio({
        type: 'generation-succeeded',
        documentIdentity,
        requestId,
        audioUrl: nextAudioUrl,
        chars: result.chars,
        truncated: result.truncated,
        cached: result.cached,
      });
      emitDocHubTelemetry({
        name: 'doc_hub.audio_generation.completed',
        properties: {
          provider: settings.provider,
          outcome: 'success',
          cached: result.cached,
          truncated: result.truncated,
          durationMs: Date.now() - startedAt,
        },
      });
      if (
        activeRequestRef.current?.documentIdentity === documentIdentity
        && activeRequestRef.current.requestId === requestId
      ) {
        onToast(
          result.cached
            ? 'Cached audio ready. Select Play to listen.'
            : 'Audio ready. Select Play to listen.',
          'success',
        );
      }
    } catch (error) {
      const requestError = error instanceof DocumentAudioRequestError
        ? error
        : new DocumentAudioRequestError(
            'network',
            'The audio service could not be reached. Check your connection and try again.',
          );
      if (requestError.kind === 'cancelled') {
        emitDocHubTelemetry({
          name: 'doc_hub.audio_generation.completed',
          properties: {
            provider: settings.provider,
            outcome: 'cancelled',
            cached: false,
            truncated: false,
            durationMs: Date.now() - startedAt,
          },
        });
        return;
      }
      const outcome = requestError.kind === 'provider-missing'
        ? 'provider-missing'
        : requestError.kind === 'timeout'
          ? 'timeout'
          : 'failure';
      emitDocHubTelemetry({
        name: 'doc_hub.audio_generation.completed',
        properties: {
          provider: settings.provider,
          outcome,
          cached: false,
          truncated: false,
          durationMs: Date.now() - startedAt,
        },
      });
      if (requestError.kind === 'provider-missing') {
        dispatchAudio({
          type: 'provider-missing',
          documentIdentity,
          requestId,
          message: requestError.message,
        });
      } else if (requestError.kind === 'timeout') {
        dispatchAudio({ type: 'generation-timed-out', documentIdentity, requestId });
      } else {
        dispatchAudio({
          type: 'generation-failed',
          documentIdentity,
          requestId,
          message: requestError.message,
        });
      }
      if (
        activeRequestRef.current?.documentIdentity === documentIdentity
        && activeRequestRef.current.requestId === requestId
      ) {
        onToast(requestError.message, 'error');
      }
    } finally {
      if (
        activeRequestRef.current?.documentIdentity === documentIdentity
        && activeRequestRef.current.requestId === requestId
      ) {
        activeRequestRef.current = null;
        requestAbortRef.current = null;
      }
    }
  }, [content, documentIdentity, handleBrowserAudio, onToast, settings, telemetrySurface]);

  const playMedia = useCallback(async (replay: boolean) => {
    const audio = audioRef.current;
    const current = audioStateRef.current;
    if (!audio || !current.audioUrl) {
      return;
    }
    audio.playbackRate = settings.playbackRate || 1;
    if (replay) {
      audio.currentTime = 0;
    }
    try {
      await audio.play();
      dispatchAudio({
        type: 'playback-started',
        documentIdentity: current.documentIdentity,
        requestId: current.requestId ?? undefined,
      });
    } catch {
      const message = 'Audio playback could not start. Try again.';
      dispatchAudio({
        type: 'playback-failed',
        documentIdentity: current.documentIdentity,
        requestId: current.requestId ?? undefined,
        message,
      });
      emitDocHubTelemetry({
        name: 'doc_hub.audio_playback.error',
        properties: {
          phase: 'play',
          recoverable: true,
          provider: settings.provider,
        },
      });
      onToast(message, 'error');
    }
  }, [onToast, settings.playbackRate, settings.provider]);

  const pausePlayback = useCallback(() => {
    const current = audioStateRef.current;
    if (current.transport === 'browser') {
      window.speechSynthesis?.pause();
    } else {
      audioRef.current?.pause();
    }
    dispatchAudio({
      type: 'playback-paused',
      documentIdentity: current.documentIdentity,
      requestId: current.requestId ?? undefined,
    });
  }, []);

  const replayPlayback = useCallback(() => {
    if (audioStateRef.current.transport === 'browser') {
      handleBrowserAudio();
      return;
    }
    void playMedia(true);
  }, [handleBrowserAudio, playMedia]);

  const resumePlayback = useCallback(() => {
    const current = audioStateRef.current;
    if (current.transport === 'browser') {
      window.speechSynthesis?.resume();
      dispatchAudio({
        type: 'playback-started',
        documentIdentity: current.documentIdentity,
        requestId: current.requestId ?? undefined,
      });
      return;
    }
    void playMedia(false);
  }, [playMedia]);

  const handlePrimaryAction = useCallback(() => {
    const current = audioStateRef.current;
    if (current.status === 'playing') {
      pausePlayback();
      return;
    }
    if (current.status === 'paused') {
      replayPlayback();
      return;
    }
    if (current.status === 'ready') {
      if (current.transport === 'browser') {
        handleBrowserAudio();
      } else {
        void playMedia(current.playbackCompleted);
      }
      return;
    }
    void handleGenerateAudio();
  }, [handleBrowserAudio, handleGenerateAudio, pausePlayback, playMedia, replayPlayback]);

  useImperativeHandle(
    forwardedRef,
    () => ({ activate: handlePrimaryAction }),
    [handlePrimaryAction],
  );

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
  const generationProgress = audioState.progress;
  const playbackProgress = audioState.playbackProgress;
  const audioStatusLabel =
    audioState.status === 'generating'
      ? 'Generating audio…'
      : audioState.status === 'ready'
        ? audioState.playbackCompleted
          ? 'Playback complete. Replay is ready.'
          : audioState.cached
            ? 'Cached audio ready. Select Play.'
            : 'Audio ready. Select Play.'
        : audioState.status === 'playing'
          ? `Playing ${docsPath || 'document audio'}.`
          : audioState.status === 'paused'
            ? 'Audio paused.'
            : audioState.status === 'provider-missing'
              ? errorMessage
              : audioState.status === 'failed'
                ? errorMessage
                : null;

  const mediaEventIdentity = () => {
    const current = audioStateRef.current;
    return {
      documentIdentity: current.documentIdentity,
      requestId: current.requestId ?? undefined,
    };
  };

  const handleMediaError = useCallback(() => {
    const current = audioStateRef.current;
    if (
      current.transport !== 'media'
      || (
        current.status !== 'ready'
        && current.status !== 'playing'
        && current.status !== 'paused'
      )
    ) {
      return;
    }
    const message = 'Audio playback failed. Try again.';
    dispatchAudio({
      type: 'playback-failed',
      documentIdentity: current.documentIdentity,
      requestId: current.requestId ?? undefined,
      message,
    });
    emitDocHubTelemetry({
      name: 'doc_hub.audio_playback.error',
      properties: {
        phase: 'media',
        recoverable: true,
        provider: settings.provider,
      },
    });
    onToast(message, 'error');
  }, [onToast, settings.provider]);

  const mobileMiniPlayer = resolveMobileDocumentAudioMiniPlayer(
    audioState,
    documentIdentity,
    mobileDocumentLabel,
  );

  if (mobileSticky) {
    if (!mobileMiniPlayer) {
      return null;
    }
    const mobilePrimaryAction =
      audioState.status === 'paused'
        ? {
            label: 'Resume',
            disabled: false,
            busy: false,
            onClick: resumePlayback,
          }
        : {
            ...primaryAction,
            onClick: handlePrimaryAction,
          };
    return (
      <section
        className="fixed inset-x-3 z-50 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/95 p-3 shadow-2xl backdrop-blur md:hidden"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
        role="region"
        aria-label={`Audio for ${mobileMiniPlayer.documentLabel}`}
        data-document-identity={mobileMiniPlayer.documentIdentity}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Current document audio
            </div>
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]" title={docsPath}>
              {mobileMiniPlayer.documentLabel}
            </div>
            {audioStatusLabel ? (
              <div className={`mt-0.5 truncate text-xs ${errorMessage ? 'text-[var(--error)]' : 'text-[var(--text-secondary)]'}`} role="status" aria-live="polite">
                {audioStatusLabel}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={mobilePrimaryAction.onClick}
              disabled={mobilePrimaryAction.disabled}
              aria-busy={mobilePrimaryAction.busy}
              className="mc-shell-btn min-h-[44px] px-3 py-2 text-xs font-semibold"
            >
              {mobilePrimaryAction.label}
            </button>
            {(audioState.status === 'playing' || audioState.status === 'paused') ? (
              <button
                type="button"
                onClick={replayPlayback}
                className="mc-shell-btn min-h-[44px] px-3 py-2 text-xs font-semibold"
              >
                Replay
              </button>
            ) : null}
          </div>
        </div>
        {loading ? (
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
            role="progressbar"
            aria-label="Audio generation progress"
            aria-valuemin={0}
            aria-valuemax={100}
            {...(generationProgress?.kind === 'determinate'
              ? { 'aria-valuenow': Math.round(generationProgress.value * 100) }
              : {})}
          >
            <div
              className={`h-full rounded-full bg-[var(--accent)] ${
                generationProgress?.kind === 'determinate' ? '' : 'w-1/3 animate-pulse'
              }`}
              style={generationProgress?.kind === 'determinate'
                ? { width: `${generationProgress.value * 100}%` }
                : undefined}
            />
          </div>
        ) : null}
        {playbackProgress !== null && audioState.transport === 'media' ? (
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
            role="progressbar"
            aria-label="Audio playback progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(playbackProgress * 100)}
          >
            <div
              className="h-full rounded-full bg-[var(--accent)]"
              style={{ width: `${playbackProgress * 100}%` }}
            />
          </div>
        ) : null}
        {audioState.status === 'provider-missing' && onOpenVoiceSettings ? (
          <button
            type="button"
            onClick={onOpenVoiceSettings}
            className="mc-shell-btn mt-2 min-h-[44px] px-3 py-2 text-xs"
          >
            Open Voice Settings
          </button>
        ) : null}
        {audioUrl ? (
          <audio
            ref={audioRef}
            preload="none"
            className="hidden"
            src={audioUrl}
            onPlay={() => dispatchAudio({ type: 'playback-started', ...mediaEventIdentity() })}
            onPause={() => dispatchAudio({ type: 'playback-paused', ...mediaEventIdentity() })}
            onEnded={() => dispatchAudio({ type: 'playback-ended', ...mediaEventIdentity() })}
            onError={handleMediaError}
            onTimeUpdate={(event) => {
              const { currentTime, duration } = event.currentTarget;
              if (Number.isFinite(duration) && duration > 0) {
                dispatchAudio({
                  type: 'playback-progress',
                  ...mediaEventIdentity(),
                  value: currentTime / duration,
                });
              }
            }}
          >
            Your browser does not support inline audio.
          </audio>
        ) : null}
      </section>
    );
  }

  // Compact mode
  if (compact) {
    return (
      <div className="relative inline-flex items-center gap-1">
        <button
          type="button"
          onClick={handlePrimaryAction}
          disabled={primaryAction.disabled}
          aria-busy={primaryAction.busy}
          className={`mc-shell-btn px-2 py-1 text-xs ${primaryAction.busy ? 'cursor-wait opacity-70' : ''} ${audioState.status === 'playing' ? 'mc-shell-btn-active text-[var(--text-primary)]' : ''}`}
          title={`${primaryAction.label} with ${providerLabel}`}
        >
          🔊 {primaryAction.label}
        </button>
        {(audioState.status === 'playing' || audioState.status === 'paused') ? (
          <>
            {audioState.status === 'paused' ? (
              <button
                type="button"
                onClick={resumePlayback}
                className="mc-shell-btn px-2 py-1 text-xs"
              >
                Resume
              </button>
            ) : null}
            <button
              type="button"
              onClick={replayPlayback}
              className="mc-shell-btn px-2 py-1 text-xs"
            >
              Replay
            </button>
          </>
        ) : null}

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

        {audioStatusLabel ? (
          <div
            className={`absolute right-0 top-10 z-20 w-72 rounded-lg border bg-[var(--bg-secondary)] p-2 text-xs shadow-lg ${
              errorMessage ? 'border-[var(--error)]/40 text-[var(--error)]' : 'border-[var(--border-primary)] text-[var(--text-secondary)]'
            }`}
            role="status"
            aria-live="polite"
          >
            <div>{audioStatusLabel}</div>
            {loading ? (
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
                role="progressbar"
                aria-label="Audio generation progress"
                aria-valuemin={0}
                aria-valuemax={100}
                {...(generationProgress?.kind === 'determinate'
                  ? { 'aria-valuenow': Math.round(generationProgress.value * 100) }
                  : {})}
              >
                <div
                  className={`h-full rounded-full bg-[var(--accent)] ${
                    generationProgress?.kind === 'determinate' ? '' : 'w-1/3 animate-pulse'
                  }`}
                  style={generationProgress?.kind === 'determinate'
                    ? { width: `${generationProgress.value * 100}%` }
                    : undefined}
                />
              </div>
            ) : null}
            {audioState.status === 'provider-missing' && onOpenVoiceSettings ? (
              <button
                type="button"
                onClick={onOpenVoiceSettings}
                className="mc-shell-btn mt-2 px-2 py-1 text-xs"
              >
                Open Voice Settings
              </button>
            ) : null}
          </div>
        ) : null}

        {audioUrl ? (
          <audio
            ref={audioRef}
            preload="none"
            className="hidden"
            src={audioUrl}
            onPlay={() => dispatchAudio({ type: 'playback-started', ...mediaEventIdentity() })}
            onPause={() => dispatchAudio({ type: 'playback-paused', ...mediaEventIdentity() })}
            onEnded={() => dispatchAudio({ type: 'playback-ended', ...mediaEventIdentity() })}
            onError={handleMediaError}
            onTimeUpdate={(event) => {
              const { currentTime, duration } = event.currentTarget;
              if (Number.isFinite(duration) && duration > 0) {
                dispatchAudio({
                  type: 'playback-progress',
                  ...mediaEventIdentity(),
                  value: currentTime / duration,
                });
              }
            }}
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
          onClick={handlePrimaryAction}
          disabled={primaryAction.disabled}
          aria-busy={primaryAction.busy}
          className={`mc-shell-btn px-3 py-1 text-xs font-medium ${primaryAction.busy ? 'cursor-wait opacity-70' : ''}`}
        >
          {primaryAction.label}
        </button>
        {(audioState.status === 'playing' || audioState.status === 'paused') ? (
          <>
            {audioState.status === 'paused' ? (
              <button
                type="button"
                onClick={resumePlayback}
                className="mc-shell-btn px-3 py-1 text-xs font-medium"
              >
                Resume
              </button>
            ) : null}
            <button
              type="button"
              onClick={replayPlayback}
              className="mc-shell-btn px-3 py-1 text-xs font-medium"
            >
              Replay
            </button>
          </>
        ) : null}

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

      {audioStatusLabel ? (
        <div
          className={`mt-2 text-xs ${
            errorMessage ? 'text-[var(--error)]' : 'text-[var(--text-secondary)]'
          }`}
          role="status"
          aria-live="polite"
        >
          {audioStatusLabel}
          {audioState.status === 'provider-missing' && onOpenVoiceSettings ? (
            <button
              type="button"
              onClick={onOpenVoiceSettings}
              className="mc-shell-btn ml-2 px-2 py-1 text-xs"
            >
              Open Voice Settings
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
          role="progressbar"
          aria-label="Audio generation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          {...(generationProgress?.kind === 'determinate'
            ? { 'aria-valuenow': Math.round(generationProgress.value * 100) }
            : {})}
        >
          <div
            className={`h-full rounded-full bg-[var(--accent)] ${
              generationProgress?.kind === 'determinate' ? '' : 'w-1/3 animate-pulse'
            }`}
            style={generationProgress?.kind === 'determinate'
              ? { width: `${generationProgress.value * 100}%` }
              : undefined}
          />
        </div>
      ) : null}

      {playbackProgress !== null && audioState.transport === 'media' ? (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
          role="progressbar"
          aria-label="Audio playback progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(playbackProgress * 100)}
        >
          <div
            className="h-full rounded-full bg-[var(--accent)]"
            style={{ width: `${playbackProgress * 100}%` }}
          />
        </div>
      ) : null}

      {audioUrl ? (
        <audio
          ref={audioRef}
          preload="none"
          className="hidden"
          src={audioUrl}
          onPlay={() => dispatchAudio({ type: 'playback-started', ...mediaEventIdentity() })}
          onPause={() => dispatchAudio({ type: 'playback-paused', ...mediaEventIdentity() })}
          onEnded={() => dispatchAudio({ type: 'playback-ended', ...mediaEventIdentity() })}
          onError={handleMediaError}
          onTimeUpdate={(event) => {
            const { currentTime, duration } = event.currentTarget;
            if (Number.isFinite(duration) && duration > 0) {
              dispatchAudio({
                type: 'playback-progress',
                ...mediaEventIdentity(),
                value: currentTime / duration,
              });
            }
          }}
        >
          Your browser does not support inline audio playback.
        </audio>
      ) : null}
    </div>
  );
});

export default MarkdownAudioControls;
