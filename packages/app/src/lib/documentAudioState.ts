export type DocumentAudioStatus =
  | 'idle'
  | 'generating'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'failed'
  | 'provider-missing';

export type DocumentAudioTransport = 'browser' | 'media';

export type DocumentAudioProgress =
  | { kind: 'indeterminate' }
  | { kind: 'determinate'; value: number };

export interface DocumentAudioState {
  documentIdentity: string;
  status: DocumentAudioStatus;
  requestId: string | null;
  audioUrl: string | null;
  errorMessage: string | null;
  transport: DocumentAudioTransport | null;
  chars: number | null;
  truncated: boolean;
  cached: boolean;
  progress: DocumentAudioProgress | null;
  playbackProgress: number | null;
  playbackCompleted: boolean;
}

export type DocumentAudioEvent =
  | {
      type: 'listen-requested';
      documentIdentity: string;
      requestId: string;
      transport?: DocumentAudioTransport;
    }
  | {
      type: 'generation-progress';
      documentIdentity: string;
      requestId: string;
      value: number;
    }
  | {
      type: 'generation-succeeded';
      documentIdentity: string;
      requestId: string;
      audioUrl: string;
      chars?: number | null;
      truncated?: boolean;
      cached?: boolean;
    }
  | {
      type: 'generation-failed';
      documentIdentity: string;
      requestId: string;
      message: string;
    }
  | {
      type: 'generation-timed-out';
      documentIdentity: string;
      requestId: string;
    }
  | { type: 'playback-started'; documentIdentity?: string; requestId?: string }
  | { type: 'playback-paused'; documentIdentity?: string; requestId?: string }
  | { type: 'playback-ended'; documentIdentity?: string; requestId?: string }
  | {
      type: 'playback-failed';
      message: string;
      documentIdentity?: string;
      requestId?: string;
    }
  | {
      type: 'playback-progress';
      documentIdentity?: string;
      requestId?: string;
      value: number;
    }
  | {
      type: 'provider-missing';
      message: string;
      documentIdentity?: string;
      requestId?: string;
    }
  | {
      type: 'generation-inputs-changed';
      currentIdentity: string;
      nextIdentity: string;
    }
  | { type: 'document-changed'; documentIdentity: string };

export interface DocumentAudioAction {
  label: string;
  disabled: boolean;
  busy: boolean;
}

export interface MobileDocumentAudioMiniPlayer {
  documentIdentity: string;
  documentLabel: string;
  status: Exclude<DocumentAudioStatus, 'idle'>;
}

export function resolveMobileDocumentAudioMiniPlayer(
  state: DocumentAudioState,
  currentDocumentIdentity: string,
  documentLabel: string,
): MobileDocumentAudioMiniPlayer | null {
  if (
    state.status === 'idle'
    || state.documentIdentity !== currentDocumentIdentity
  ) {
    return null;
  }
  return {
    documentIdentity: state.documentIdentity,
    documentLabel,
    status: state.status,
  };
}

export function createDocumentAudioState(documentIdentity: string): DocumentAudioState {
  return {
    documentIdentity,
    status: 'idle',
    requestId: null,
    audioUrl: null,
    errorMessage: null,
    transport: null,
    chars: null,
    truncated: false,
    cached: false,
    progress: null,
    playbackProgress: null,
    playbackCompleted: false,
  };
}

export function buildDocumentAudioContentIdentity(content: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= BigInt(content.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${content.length.toString(16)}:${hash.toString(16).padStart(16, '0')}`;
}

export function buildDocumentAudioGenerationIdentity({
  documentIdentity,
  contentIdentity,
  provider,
  voice,
  model,
}: {
  documentIdentity: string;
  contentIdentity: string;
  provider: string;
  voice: string;
  model: string;
  playbackRate?: number;
}): string {
  return JSON.stringify([
    documentIdentity,
    contentIdentity,
    provider,
    voice,
    model,
  ]);
}

export function reconcileDocumentAudioGenerationIdentity(
  state: DocumentAudioState,
  currentIdentity: string,
  nextIdentity: string,
): DocumentAudioState {
  return currentIdentity === nextIdentity
    ? state
    : createDocumentAudioState(state.documentIdentity);
}

function isCurrentGeneration(
  state: DocumentAudioState,
  event: { documentIdentity: string; requestId: string },
): boolean {
  return (
    state.status === 'generating'
    || (state.status === 'playing' && state.transport === 'browser')
  )
    && state.documentIdentity === event.documentIdentity
    && state.requestId === event.requestId;
}

function isCurrentPlayback(
  state: DocumentAudioState,
  event: { documentIdentity?: string; requestId?: string },
): boolean {
  return (event.documentIdentity === undefined || event.documentIdentity === state.documentIdentity)
    && (event.requestId === undefined || event.requestId === state.requestId);
}

export function reduceDocumentAudioState(
  state: DocumentAudioState,
  event: DocumentAudioEvent,
): DocumentAudioState {
  switch (event.type) {
    case 'generation-inputs-changed':
      return reconcileDocumentAudioGenerationIdentity(
        state,
        event.currentIdentity,
        event.nextIdentity,
      );
    case 'document-changed':
      return event.documentIdentity === state.documentIdentity
        ? state
        : createDocumentAudioState(event.documentIdentity);
    case 'listen-requested':
      if (
        state.status === 'generating'
        || event.documentIdentity !== state.documentIdentity
      ) {
        return state;
      }
      return {
        ...createDocumentAudioState(state.documentIdentity),
        status: 'generating',
        requestId: event.requestId,
        transport: event.transport ?? 'media',
        progress: { kind: 'indeterminate' },
      };
    case 'generation-progress':
      if (!isCurrentGeneration(state, event)) {
        return state;
      }
      return {
        ...state,
        progress: {
          kind: 'determinate',
          value: Math.max(0, Math.min(1, event.value)),
        },
      };
    case 'generation-succeeded':
      if (!isCurrentGeneration(state, event)) {
        return state;
      }
      return {
        ...state,
        status: 'ready',
        requestId: event.requestId,
        audioUrl: event.audioUrl,
        errorMessage: null,
        transport: 'media',
        chars: event.chars ?? null,
        truncated: Boolean(event.truncated),
        cached: Boolean(event.cached),
        progress: null,
      };
    case 'generation-failed':
      if (!isCurrentGeneration(state, event)) {
        return state;
      }
      return {
        ...state,
        status: 'failed',
        requestId: null,
        audioUrl: null,
        errorMessage: event.message,
        chars: null,
        truncated: false,
        cached: false,
        progress: null,
      };
    case 'generation-timed-out':
      if (!isCurrentGeneration(state, event)) {
        return state;
      }
      return {
        ...state,
        status: 'failed',
        requestId: null,
        audioUrl: null,
        errorMessage: 'Audio generation timed out. Try again.',
        chars: null,
        truncated: false,
        cached: false,
        progress: null,
      };
    case 'provider-missing':
      if (
        event.documentIdentity !== undefined
        && (
          event.documentIdentity !== state.documentIdentity
          || (event.requestId !== undefined && event.requestId !== state.requestId)
        )
      ) {
        return state;
      }
      return {
        ...createDocumentAudioState(state.documentIdentity),
        status: 'provider-missing',
        errorMessage: event.message,
      };
    case 'playback-started':
      if (!isCurrentPlayback(state, event)) {
        return state;
      }
      if (
        state.status !== 'ready'
        && state.status !== 'paused'
        && !(state.status === 'generating' && state.transport === 'browser')
      ) {
        return state;
      }
      return { ...state, status: 'playing', playbackCompleted: false };
    case 'playback-paused':
      if (!isCurrentPlayback(state, event)) {
        return state;
      }
      return state.status === 'playing'
        ? { ...state, status: 'paused' }
        : state;
    case 'playback-progress':
      if (!isCurrentPlayback(state, event) || state.transport !== 'media') {
        return state;
      }
      return {
        ...state,
        playbackProgress: Math.max(0, Math.min(1, event.value)),
      };
    case 'playback-failed':
      if (!isCurrentPlayback(state, event)) {
        return state;
      }
      return {
        ...state,
        status: 'failed',
        errorMessage: event.message,
        playbackProgress: null,
      };
    case 'playback-ended':
      if (!isCurrentPlayback(state, event)) {
        return state;
      }
      if (state.status !== 'playing' && state.status !== 'paused') {
        return state;
      }
      return {
        ...state,
        status: 'ready',
        playbackProgress: 1,
        playbackCompleted: true,
      };
  }
}

export function resolveDocumentAudioAction(state: DocumentAudioState): DocumentAudioAction {
  switch (state.status) {
    case 'generating':
      return { label: 'Generating audio…', disabled: true, busy: true };
    case 'ready':
      return {
        label: state.playbackCompleted ? 'Replay' : 'Play',
        disabled: false,
        busy: false,
      };
    case 'playing':
      return { label: 'Pause', disabled: false, busy: false };
    case 'paused':
      return { label: 'Replay', disabled: false, busy: false };
    case 'failed':
      return { label: 'Try again', disabled: false, busy: false };
    case 'provider-missing':
      return { label: 'Listen', disabled: false, busy: false };
    case 'idle':
      return { label: 'Listen', disabled: false, busy: false };
  }
}
