import test from 'node:test';
import assert from 'node:assert/strict';

type AudioStatus =
  | 'idle'
  | 'generating'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'failed'
  | 'provider-missing';

type DocumentAudioState = {
  documentIdentity: string;
  status: AudioStatus;
  requestId: string | null;
  audioUrl: string | null;
  cached: boolean;
  errorMessage: string | null;
  playbackProgress: number | null;
  playbackCompleted: boolean;
};

type DocumentAudioEvent =
  | { type: 'listen-requested'; documentIdentity: string; requestId: string }
  | {
      type: 'generation-succeeded';
      documentIdentity: string;
      requestId: string;
      audioUrl: string;
      cached?: boolean;
    }
  | {
      type: 'generation-failed';
      documentIdentity: string;
      requestId: string;
      message: string;
    }
  | { type: 'playback-started'; documentIdentity?: string; requestId?: string }
  | { type: 'playback-paused'; documentIdentity?: string; requestId?: string }
  | { type: 'playback-ended'; documentIdentity?: string; requestId?: string }
  | { type: 'provider-missing'; message: string }
  | { type: 'document-changed'; documentIdentity: string };

type DocumentAudioStateModule = {
  createDocumentAudioState: (documentIdentity: string) => DocumentAudioState;
  reduceDocumentAudioState: (
    state: DocumentAudioState,
    event: DocumentAudioEvent,
  ) => DocumentAudioState;
};

const modulePath: string = './documentAudioState.ts';

async function loadStateModule(): Promise<DocumentAudioStateModule> {
  return import(modulePath) as Promise<DocumentAudioStateModule>;
}

test('document audio moves from idle through one controlled generation to ready', async () => {
  const {
    createDocumentAudioState,
    reduceDocumentAudioState,
  } = await loadStateModule();
  const documentIdentity = '["workspace","memory/daily-brief.md"]';
  const idle = createDocumentAudioState(documentIdentity);

  assert.equal(idle.status, 'idle');
  assert.equal(idle.audioUrl, null);

  const generating = reduceDocumentAudioState(idle, {
    type: 'listen-requested',
    documentIdentity,
    requestId: 'request-1',
  });
  assert.equal(generating.status, 'generating');
  assert.equal(generating.requestId, 'request-1');

  assert.strictEqual(
    reduceDocumentAudioState(generating, {
      type: 'listen-requested',
      documentIdentity,
      requestId: 'duplicate-request',
    }),
    generating,
    'Listen cannot start an uncontrolled duplicate while generation is pending',
  );

  const ready = reduceDocumentAudioState(generating, {
    type: 'generation-succeeded',
    documentIdentity,
    requestId: 'request-1',
    audioUrl: '/api/tts/artifacts/audio-1.mp3',
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.audioUrl, '/api/tts/artifacts/audio-1.mp3');
  assert.equal(ready.cached, false);
  assert.equal(ready.errorMessage, null);
});

test('cached artifact state is explicit and document changes discard it', async () => {
  const {
    createDocumentAudioState,
    reduceDocumentAudioState,
  } = await loadStateModule();
  const documentIdentity = '["workspace","memory/cached.md"]';
  const generating = reduceDocumentAudioState(createDocumentAudioState(documentIdentity), {
    type: 'listen-requested',
    documentIdentity,
    requestId: 'request-cached',
  });
  const cached = reduceDocumentAudioState(generating, {
    type: 'generation-succeeded',
    documentIdentity,
    requestId: 'request-cached',
    audioUrl: '/audio/cached.mp3',
    cached: true,
  });

  assert.equal(cached.status, 'ready');
  assert.equal(cached.cached, true);
  const changed = reduceDocumentAudioState(cached, {
    type: 'document-changed',
    documentIdentity: '["workspace","memory/changed.md"]',
  });
  assert.equal(changed.status, 'idle');
  assert.equal(changed.audioUrl, null);
  assert.equal(changed.cached, false);
});

test('mobile mini-player represents only requested audio for the current document', async () => {
  type MiniPlayerModel = {
    documentIdentity: string;
    documentLabel: string;
    status: 'generating' | 'ready' | 'playing' | 'paused' | 'failed';
  };
  const audioStateModule = await loadStateModule() as DocumentAudioStateModule & {
    resolveMobileDocumentAudioMiniPlayer: (
      state: DocumentAudioState,
      currentDocumentIdentity: string,
      documentLabel: string,
    ) => MiniPlayerModel | null;
  };
  const {
    createDocumentAudioState,
    reduceDocumentAudioState,
    resolveMobileDocumentAudioMiniPlayer,
  } = audioStateModule;
  assert.equal(
    typeof resolveMobileDocumentAudioMiniPlayer,
    'function',
    'mobile needs one pure current-document mini-player projection',
  );

  const documentIdentity = '["workspace","memory/Daily Brief.md"]';
  const documentLabel = 'Daily Brief.md';
  const idle = createDocumentAudioState(documentIdentity);
  assert.equal(
    resolveMobileDocumentAudioMiniPlayer(idle, documentIdentity, documentLabel),
    null,
    'idle audio stays hidden until Listen is explicitly requested',
  );

  const generating = reduceDocumentAudioState(idle, {
    type: 'listen-requested',
    documentIdentity,
    requestId: 'request-mini-player',
  });
  const ready = reduceDocumentAudioState(generating, {
    type: 'generation-succeeded',
    documentIdentity,
    requestId: 'request-mini-player',
    audioUrl: '/api/tts/artifacts/daily-brief.mp3',
  });
  const playing = reduceDocumentAudioState(ready, {
    type: 'playback-started',
    documentIdentity,
    requestId: 'request-mini-player',
  });
  const paused = reduceDocumentAudioState(playing, {
    type: 'playback-paused',
    documentIdentity,
    requestId: 'request-mini-player',
  });
  const failedRequest = reduceDocumentAudioState(idle, {
    type: 'listen-requested',
    documentIdentity,
    requestId: 'request-failed',
  });
  const failed = reduceDocumentAudioState(failedRequest, {
    type: 'generation-failed',
    documentIdentity,
    requestId: 'request-failed',
    message: 'Audio generation failed. Try again.',
  });

  for (const state of [generating, ready, playing, paused, failed]) {
    const model = resolveMobileDocumentAudioMiniPlayer(
      state,
      documentIdentity,
      documentLabel,
    );
    assert.ok(model, `${state.status} must remain visible`);
    assert.equal(model.documentIdentity, documentIdentity);
    assert.equal(model.documentLabel, documentLabel);
    assert.equal(model.status, state.status);
  }
});

test('mobile mini-player resets on document switch and never projects a cross-document queue', async () => {
  type MiniPlayerModel = {
    documentIdentity: string;
    documentLabel: string;
    status: 'generating' | 'ready' | 'playing' | 'paused' | 'failed';
  };
  const audioStateModule = await loadStateModule() as DocumentAudioStateModule & {
    resolveMobileDocumentAudioMiniPlayer: (
      state: DocumentAudioState,
      currentDocumentIdentity: string,
      documentLabel: string,
    ) => MiniPlayerModel | null;
  };
  const {
    createDocumentAudioState,
    reduceDocumentAudioState,
    resolveMobileDocumentAudioMiniPlayer,
  } = audioStateModule;
  assert.equal(typeof resolveMobileDocumentAudioMiniPlayer, 'function');

  const firstIdentity = '["workspace","memory/First.md"]';
  const secondIdentity = '["workspace","memory/Second.md"]';
  const generating = reduceDocumentAudioState(createDocumentAudioState(firstIdentity), {
    type: 'listen-requested',
    documentIdentity: firstIdentity,
    requestId: 'request-first',
  });
  const firstPlaying = reduceDocumentAudioState(
    reduceDocumentAudioState(generating, {
      type: 'generation-succeeded',
      documentIdentity: firstIdentity,
      requestId: 'request-first',
      audioUrl: '/api/tts/artifacts/first.mp3',
    }),
    {
      type: 'playback-started',
      documentIdentity: firstIdentity,
      requestId: 'request-first',
    },
  );

  assert.equal(
    resolveMobileDocumentAudioMiniPlayer(firstPlaying, secondIdentity, 'Second.md'),
    null,
    'an artifact from another document must not appear as a queue item',
  );

  const switched = reduceDocumentAudioState(firstPlaying, {
    type: 'document-changed',
    documentIdentity: secondIdentity,
  });
  assert.equal(switched.documentIdentity, secondIdentity);
  assert.equal(switched.status, 'idle');
  assert.equal(switched.audioUrl, null);
  assert.equal(
    resolveMobileDocumentAudioMiniPlayer(switched, secondIdentity, 'Second.md'),
    null,
  );
});

test('mounted audio invalidates cached artifacts only when generation identity changes', async () => {
  type GenerationInputs = {
    documentIdentity: string;
    contentIdentity: string;
    provider: string;
    voice: string;
    model: string;
    playbackRate: number;
  };
  const audioStateModule = await loadStateModule() as DocumentAudioStateModule & {
    buildDocumentAudioGenerationIdentity: (inputs: GenerationInputs) => string;
    reconcileDocumentAudioGenerationIdentity: (
      state: DocumentAudioState,
      currentIdentity: string,
      nextIdentity: string,
    ) => DocumentAudioState;
  };
  const {
    buildDocumentAudioGenerationIdentity,
    createDocumentAudioState,
    reconcileDocumentAudioGenerationIdentity,
    reduceDocumentAudioState,
  } = audioStateModule;
  const documentIdentity = '["workspace","memory/mounted.md"]';
  const inputs: GenerationInputs = {
    documentIdentity,
    contentIdentity: 'sha256:content-v1',
    provider: 'openai',
    voice: 'alloy',
    model: 'gpt-4o-mini-tts',
    playbackRate: 1,
  };
  const currentGenerationIdentity = buildDocumentAudioGenerationIdentity(inputs);
  const generating = reduceDocumentAudioState(createDocumentAudioState(documentIdentity), {
    type: 'listen-requested',
    documentIdentity,
    requestId: 'request-mounted-cache',
  });
  const cachedReady = reduceDocumentAudioState(generating, {
    type: 'generation-succeeded',
    documentIdentity,
    requestId: 'request-mounted-cache',
    audioUrl: '/audio/mounted-cache.mp3',
    cached: true,
  });

  const playbackSpeedIdentity = buildDocumentAudioGenerationIdentity({
    ...inputs,
    playbackRate: 1.5,
  });
  assert.equal(
    playbackSpeedIdentity,
    currentGenerationIdentity,
    'playback speed is not a synthesis input and must preserve ready cached audio',
  );
  assert.strictEqual(
    reconcileDocumentAudioGenerationIdentity(
      cachedReady,
      currentGenerationIdentity,
      playbackSpeedIdentity,
    ),
    cachedReady,
  );

  for (const nextInputs of [
    { ...inputs, contentIdentity: 'sha256:content-v2' },
    { ...inputs, provider: 'deepgram' },
    { ...inputs, voice: 'nova' },
    { ...inputs, model: 'gpt-4o-tts' },
  ]) {
    const invalidated = reconcileDocumentAudioGenerationIdentity(
      cachedReady,
      currentGenerationIdentity,
      buildDocumentAudioGenerationIdentity(nextInputs),
    );
    assert.equal(invalidated.status, 'idle');
    assert.equal(invalidated.audioUrl, null);
    assert.equal(invalidated.cached, false);
  }
});

test('ready audio exposes deterministic playing, paused, and replay transitions', async () => {
  const {
    createDocumentAudioState,
    reduceDocumentAudioState,
  } = await loadStateModule();
  const documentIdentity = '["book","memory/note.md"]';
  const generating = reduceDocumentAudioState(
    createDocumentAudioState(documentIdentity),
    {
      type: 'listen-requested',
      documentIdentity,
      requestId: 'request-2',
    },
  );
  const ready = reduceDocumentAudioState(generating, {
    type: 'generation-succeeded',
    documentIdentity,
    requestId: 'request-2',
    audioUrl: '/audio/note.mp3',
  });
  const playing = reduceDocumentAudioState(ready, { type: 'playback-started' });
  const paused = reduceDocumentAudioState(playing, { type: 'playback-paused' });
  const replaying = reduceDocumentAudioState(paused, { type: 'playback-started' });

  assert.equal(playing.status, 'playing');
  assert.equal(paused.status, 'paused');
  assert.equal(replaying.status, 'playing');
  assert.equal(
    reduceDocumentAudioState(replaying, { type: 'playback-ended' }).status,
    'ready',
  );
});

test('generation failures are visible and recoverable by retry', async () => {
  const {
    createDocumentAudioState,
    reduceDocumentAudioState,
  } = await loadStateModule();
  const documentIdentity = '["workspace","output/report.md"]';
  const generating = reduceDocumentAudioState(
    createDocumentAudioState(documentIdentity),
    {
      type: 'listen-requested',
      documentIdentity,
      requestId: 'request-timeout',
    },
  );
  const failed = reduceDocumentAudioState(generating, {
    type: 'generation-failed',
    documentIdentity,
    requestId: 'request-timeout',
    message: 'Audio generation timed out. Try again.',
  });

  assert.equal(failed.status, 'failed');
  assert.match(failed.errorMessage ?? '', /timed out/i);

  const retrying = reduceDocumentAudioState(failed, {
    type: 'listen-requested',
    documentIdentity,
    requestId: 'request-retry',
  });
  assert.equal(retrying.status, 'generating');
  assert.equal(retrying.requestId, 'request-retry');
  assert.equal(retrying.errorMessage, null);
});

test('missing provider configuration is an explicit state', async () => {
  const {
    createDocumentAudioState,
    reduceDocumentAudioState,
  } = await loadStateModule();
  const providerMissing = reduceDocumentAudioState(
    createDocumentAudioState('["workspace","output/report.md"]'),
    {
      type: 'provider-missing',
      message: 'Choose a TTS provider in Voice Settings.',
    },
  );

  assert.equal(providerMissing.status, 'provider-missing');
  assert.match(providerMissing.errorMessage ?? '', /provider|voice settings/i);
  assert.equal(providerMissing.audioUrl, null);
});

test('document and request identity reject stale audio completions', async () => {
  const {
    createDocumentAudioState,
    reduceDocumentAudioState,
  } = await loadStateModule();
  const firstIdentity = '["book","memory/first.md"]';
  const secondIdentity = '["workspace","output/second.md"]';
  const firstGenerating = reduceDocumentAudioState(
    createDocumentAudioState(firstIdentity),
    {
      type: 'listen-requested',
      documentIdentity: firstIdentity,
      requestId: 'request-first',
    },
  );
  const secondIdle = reduceDocumentAudioState(firstGenerating, {
    type: 'document-changed',
    documentIdentity: secondIdentity,
  });

  assert.equal(secondIdle.documentIdentity, secondIdentity);
  assert.equal(secondIdle.status, 'idle');
  assert.equal(secondIdle.audioUrl, null);
  assert.strictEqual(
    reduceDocumentAudioState(secondIdle, {
      type: 'generation-succeeded',
      documentIdentity: firstIdentity,
      requestId: 'request-first',
      audioUrl: '/audio/stale-first.mp3',
    }),
    secondIdle,
  );

  const secondGenerating = reduceDocumentAudioState(secondIdle, {
    type: 'listen-requested',
    documentIdentity: secondIdentity,
    requestId: 'request-second',
  });
  assert.strictEqual(
    reduceDocumentAudioState(secondGenerating, {
      type: 'generation-succeeded',
      documentIdentity: secondIdentity,
      requestId: 'wrong-request',
      audioUrl: '/audio/stale-request.mp3',
    }),
    secondGenerating,
  );
});

test('generation exposes indeterminate progress and accepts provider progress updates', async () => {
  type ProgressState = DocumentAudioState & {
    progress:
      | { kind: 'indeterminate' }
      | { kind: 'determinate'; value: number }
      | null;
  };
  const {
    createDocumentAudioState,
    reduceDocumentAudioState,
  } = await loadStateModule();
  const documentIdentity = '["workspace","output/slow-report.md"]';
  const reduceWithProgress = reduceDocumentAudioState as unknown as (
    state: ProgressState,
    event:
      | DocumentAudioEvent
      | {
          type: 'generation-progress';
          documentIdentity: string;
          requestId: string;
          value: number;
        },
  ) => ProgressState;
  const generating = reduceWithProgress(
    createDocumentAudioState(documentIdentity) as ProgressState,
    {
      type: 'listen-requested',
      documentIdentity,
      requestId: 'request-progress',
    },
  );

  assert.deepEqual(generating.progress, { kind: 'indeterminate' });

  const progressing = reduceWithProgress(generating, {
    type: 'generation-progress',
    documentIdentity,
    requestId: 'request-progress',
    value: 0.4,
  });
  assert.equal(progressing.status, 'generating');
  assert.deepEqual(progressing.progress, { kind: 'determinate', value: 0.4 });

  const ready = reduceWithProgress(progressing, {
    type: 'generation-succeeded',
    documentIdentity,
    requestId: 'request-progress',
    audioUrl: '/audio/slow-report.mp3',
  });
  assert.equal(ready.progress, null);
});

test('a matching generation timeout becomes a recoverable failure', async () => {
  const {
    createDocumentAudioState,
    reduceDocumentAudioState,
  } = await loadStateModule();
  const documentIdentity = '["workspace","output/timeout.md"]';
  const generating = reduceDocumentAudioState(
    createDocumentAudioState(documentIdentity),
    {
      type: 'listen-requested',
      documentIdentity,
      requestId: 'request-timeout-explicit',
    },
  );
  const timedOut = (
    reduceDocumentAudioState as unknown as (
      state: DocumentAudioState,
      event: {
        type: 'generation-timed-out';
        documentIdentity: string;
        requestId: string;
      },
    ) => DocumentAudioState
  )(generating, {
    type: 'generation-timed-out',
    documentIdentity,
    requestId: 'request-timeout-explicit',
  });

  assert.equal(timedOut.status, 'failed');
  assert.match(timedOut.errorMessage ?? '', /timed out|timeout/i);

  const retrying = reduceDocumentAudioState(timedOut, {
    type: 'listen-requested',
    documentIdentity,
    requestId: 'request-after-timeout',
  });
  assert.equal(retrying.status, 'generating');
});

test('audio states expose explicit primary actions for Listen, progress, Play, Pause, Replay, and retry', async () => {
  type AudioAction = {
    label: string;
    disabled: boolean;
    busy: boolean;
  };
  const audioStateModule = await loadStateModule() as DocumentAudioStateModule & {
    resolveDocumentAudioAction: (state: DocumentAudioState) => AudioAction;
  };
  const {
    createDocumentAudioState,
    reduceDocumentAudioState,
    resolveDocumentAudioAction,
  } = audioStateModule;
  const documentIdentity = '["workspace","output/actions.md"]';
  const idle = createDocumentAudioState(documentIdentity);
  const generating = reduceDocumentAudioState(idle, {
    type: 'listen-requested',
    documentIdentity,
    requestId: 'request-actions',
  });
  const ready = reduceDocumentAudioState(generating, {
    type: 'generation-succeeded',
    documentIdentity,
    requestId: 'request-actions',
    audioUrl: '/audio/actions.mp3',
  });
  const playing = reduceDocumentAudioState(ready, { type: 'playback-started' });
  const paused = reduceDocumentAudioState(playing, { type: 'playback-paused' });
  const retryGenerating = reduceDocumentAudioState(idle, {
    type: 'listen-requested',
    documentIdentity,
    requestId: 'request-failure-action',
  });
  const failed = reduceDocumentAudioState(retryGenerating, {
    type: 'generation-failed',
    documentIdentity,
    requestId: 'request-failure-action',
    message: 'Network unavailable.',
  });

  assert.deepEqual(resolveDocumentAudioAction(idle), {
    label: 'Listen',
    disabled: false,
    busy: false,
  });
  assert.deepEqual(resolveDocumentAudioAction(generating), {
    label: 'Generating audio…',
    disabled: true,
    busy: true,
  });
  assert.deepEqual(resolveDocumentAudioAction(ready), {
    label: 'Play',
    disabled: false,
    busy: false,
  });
  assert.deepEqual(resolveDocumentAudioAction(playing), {
    label: 'Pause',
    disabled: false,
    busy: false,
  });
  assert.deepEqual(resolveDocumentAudioAction(paused), {
    label: 'Replay',
    disabled: false,
    busy: false,
  });
  assert.deepEqual(resolveDocumentAudioAction(failed), {
    label: 'Try again',
    disabled: false,
    busy: false,
  });
});

test('completed playback exposes Replay while stale media events cannot mutate a new artifact', async () => {
  const {
    createDocumentAudioState,
    reduceDocumentAudioState,
  } = await loadStateModule();
  const documentIdentity = '["workspace","output/replay.md"]';
  const firstGenerating = reduceDocumentAudioState(
    createDocumentAudioState(documentIdentity),
    {
      type: 'listen-requested',
      documentIdentity,
      requestId: 'request-first-artifact',
    },
  );
  const firstReady = reduceDocumentAudioState(firstGenerating, {
    type: 'generation-succeeded',
    documentIdentity,
    requestId: 'request-first-artifact',
    audioUrl: '/audio/first.mp3',
  });
  const firstPlaying = reduceDocumentAudioState(firstReady, {
    type: 'playback-started',
    documentIdentity,
    requestId: 'request-first-artifact',
  });
  const completed = reduceDocumentAudioState(firstPlaying, {
    type: 'playback-ended',
    documentIdentity,
    requestId: 'request-first-artifact',
  });

  assert.equal(completed.status, 'ready');
  assert.equal(completed.playbackCompleted, true);
  assert.equal(completed.playbackProgress, 1);

  const secondGenerating = reduceDocumentAudioState(completed, {
    type: 'listen-requested',
    documentIdentity,
    requestId: 'request-second-artifact',
  });
  assert.strictEqual(
    reduceDocumentAudioState(secondGenerating, {
      type: 'playback-ended',
      documentIdentity,
      requestId: 'request-first-artifact',
    }),
    secondGenerating,
  );
});
