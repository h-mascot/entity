import test from 'node:test';
import assert from 'node:assert/strict';

type DocHubTelemetryEventName =
  | 'doc_hub.copy_share.attempt'
  | 'doc_hub.copy_share.result'
  | 'doc_hub.clipboard_fallback.displayed'
  | 'doc_hub.mobile_tool_sheet.opened'
  | 'doc_hub.mobile_tool.selected'
  | 'doc_hub.audio_generation.started'
  | 'doc_hub.audio_generation.completed'
  | 'doc_hub.audio_playback.error'
  | 'doc_hub.deep_link_restoration.success'
  | 'doc_hub.deep_link_restoration.failure';

type TelemetryInput = {
  name: DocHubTelemetryEventName | string;
  properties?: Record<string, unknown>;
  context?: {
    environment?: string;
    buildId?: string;
    gitSha?: string;
  };
};

type SafeTelemetryEvent = {
  name: DocHubTelemetryEventName;
  properties: Record<string, string | number | boolean>;
  environment?: string;
  buildId?: string;
  gitSha?: string;
};

type DocHubTelemetryModule = {
  buildDocHubTelemetryEvent: (input: TelemetryInput) => SafeTelemetryEvent;
  emitDocHubTelemetry: (
    input: TelemetryInput,
    send?: (event: SafeTelemetryEvent) => void,
    transport?: {
      apiBase?: string;
      fetchImpl?: typeof fetch;
    },
  ) => SafeTelemetryEvent;
};

const modulePath: string = './docHubTelemetry.ts';

async function loadTelemetryModule(): Promise<DocHubTelemetryModule> {
  return import(modulePath) as Promise<DocHubTelemetryModule>;
}

test('client telemetry accepts only the approved Milestone A event families', async () => {
  const { buildDocHubTelemetryEvent } = await loadTelemetryModule();
  const approvedNames: DocHubTelemetryEventName[] = [
    'doc_hub.copy_share.attempt',
    'doc_hub.copy_share.result',
    'doc_hub.clipboard_fallback.displayed',
    'doc_hub.mobile_tool_sheet.opened',
    'doc_hub.mobile_tool.selected',
    'doc_hub.audio_generation.started',
    'doc_hub.audio_generation.completed',
    'doc_hub.audio_playback.error',
    'doc_hub.deep_link_restoration.success',
    'doc_hub.deep_link_restoration.failure',
  ];

  for (const name of approvedNames) {
    assert.equal(buildDocHubTelemetryEvent({ name }).name, name);
  }
  assert.throws(
    () => buildDocHubTelemetryEvent({ name: 'doc_hub.document_body.uploaded' }),
    /unsupported|unknown|event/i,
  );
});

test('client builder and emitter retain safe diagnostics while removing private payloads', async () => {
  const {
    buildDocHubTelemetryEvent,
    emitDocHubTelemetry,
  } = await loadTelemetryModule();
  const canaries = [
    'PRIVATE_DOCUMENT_BODY_CANARY',
    'SELECTED_TEXT_CANARY',
    'CUSTOM_PROMPT_CANARY',
    'GENERATED_OUTPUT_CANARY',
    'sk-provider-token-canary',
    'https://entity.example/docs/source/private/payroll.md?token=preview-canary',
    '/Users/henry/Private/payroll.md',
    'upstream stack trace canary',
  ];
  const input: TelemetryInput = {
    name: 'doc_hub.audio_generation.completed',
    properties: {
      provider: 'openai',
      outcome: 'success',
      cached: true,
      truncated: false,
      durationMs: 321,
      documentBody: canaries[0],
      selectedText: canaries[1],
      prompt: canaries[2],
      output: canaries[3],
      credential: canaries[4],
      canonicalUrl: canaries[5],
      documentPath: canaries[6],
      rawError: canaries[7],
      arbitraryProperty: 'must-not-survive',
    },
    context: {
      environment: 'sandbox',
      buildId: 'build-20260729',
      gitSha: 'abcdef1234567890',
    },
  };

  const built = buildDocHubTelemetryEvent(input);
  const sent: SafeTelemetryEvent[] = [];
  const emitted = emitDocHubTelemetry(input, (event) => sent.push(event));

  assert.deepEqual(built.properties, {
    provider: 'openai',
    outcome: 'success',
    cached: true,
    truncated: false,
    durationMs: 321,
  });
  assert.equal(built.environment, 'sandbox');
  assert.equal(built.buildId, 'build-20260729');
  assert.equal(built.gitSha, 'abcdef1234567890');
  assert.deepEqual(sent, [emitted]);
  assert.deepEqual(emitted, built);
  const serialized = JSON.stringify({ built, sent });
  for (const canary of canaries) {
    assert.equal(serialized.includes(canary), false);
  }
  assert.equal(serialized.includes('must-not-survive'), false);
});

test('client telemetry enforces per-event enum, numeric, and boolean property schemas', async () => {
  const { buildDocHubTelemetryEvent } = await loadTelemetryModule();

  assert.deepEqual(
    buildDocHubTelemetryEvent({
      name: 'doc_hub.mobile_tool.selected',
      properties: {
        tool: 'audio',
        source: 'bottom-sheet',
        durationMs: Number.NaN,
        recoverable: 'yes',
      },
    }).properties,
    {
      tool: 'audio',
      source: 'bottom-sheet',
    },
  );
  assert.deepEqual(
    buildDocHubTelemetryEvent({
      name: 'doc_hub.audio_playback.error',
      properties: {
        phase: 'decode',
        recoverable: true,
        provider: 'kokoro',
        durationMs: 42,
      },
    }).properties,
    {
      phase: 'decode',
      recoverable: true,
      provider: 'kokoro',
    },
    'properties valid for a different event must not cross event-schema boundaries',
  );
});

test('client telemetry sends to the configured API base', async () => {
  const { emitDocHubTelemetry } = await loadTelemetryModule();
  const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ input, init });
    return new Response(null, { status: 202 });
  };

  emitDocHubTelemetry(
    {
      name: 'doc_hub.copy_share.attempt',
      properties: {
        mechanism: 'clipboard',
        surface: 'desktop',
      },
    },
    undefined,
    {
      apiBase: 'https://api.entity.test/root/',
      fetchImpl,
    },
  );

  for (let attempt = 0; requests.length === 0 && attempt < 50; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.input,
    'https://api.entity.test/root/api/telemetry/doc-hub',
    'telemetry must follow the configured backend instead of the frontend origin',
  );
});
