import { describe, expect, it } from 'vitest';
import express from 'express';
import {
  parseDocHubTelemetryEvent,
  registerDocHubTelemetryRoute,
  type ParsedDocHubTelemetryEvent,
} from './doc-hub-telemetry';

describe('parseDocHubTelemetryEvent', () => {
  const release = {
    environment: 'production',
    gitSha: 'fedcba9876543210',
  };
  const approvedEvents = [
    {
      name: 'doc_hub.copy_share.attempt',
      properties: { mechanism: 'clipboard', surface: 'desktop' },
    },
    {
      name: 'doc_hub.copy_share.result',
      properties: { mechanism: 'native-share', outcome: 'fallback', recoverable: true },
    },
    {
      name: 'doc_hub.clipboard_fallback.displayed',
      properties: { surface: 'mobile', reason: 'clipboard-unavailable' },
    },
    {
      name: 'doc_hub.mobile_tool_sheet.opened',
      properties: { source: 'document-header' },
    },
    {
      name: 'doc_hub.mobile_tool.selected',
      properties: { tool: 'audio', source: 'bottom-sheet' },
    },
    {
      name: 'doc_hub.audio_generation.started',
      properties: { provider: 'kokoro', surface: 'mobile' },
    },
    {
      name: 'doc_hub.audio_generation.completed',
      properties: {
        provider: 'kokoro',
        outcome: 'success',
        cached: true,
        truncated: false,
        durationMs: 321,
      },
    },
    {
      name: 'doc_hub.audio_playback.error',
      properties: { phase: 'media', recoverable: true, provider: 'kokoro' },
    },
    {
      name: 'doc_hub.deep_link_restoration.success',
      properties: { contentClass: 'source', hasTool: true },
    },
    {
      name: 'doc_hub.deep_link_restoration.failure',
      properties: { reason: 'document-missing', recoverable: true },
    },
  ] as const;

  it.each(approvedEvents)('accepts the complete $name event contract', (event) => {
    expect(parseDocHubTelemetryEvent(event, release)).toMatchObject(event);
  });

  it('independently accepts an approved event and overwrites release metadata authoritatively', () => {
    expect(parseDocHubTelemetryEvent({
      name: 'doc_hub.copy_share.result',
      properties: {
        mechanism: 'native-share',
        outcome: 'fallback',
        recoverable: true,
      },
      environment: 'sandbox',
      gitSha: 'client-supplied-sha',
    }, release)).toEqual({
      name: 'doc_hub.copy_share.result',
      properties: {
        mechanism: 'native-share',
        outcome: 'fallback',
        recoverable: true,
      },
      environment: 'production',
      gitSha: 'fedcba9876543210',
    });
  });

  it.each([
    { mechanism: 'native-share', recoverable: true },
    { mechanism: 'native-share', outcome: 'fallback' },
  ])('rejects an approved event missing a required diagnostic property: %s', (properties) => {
    expect(() => parseDocHubTelemetryEvent({
      name: 'doc_hub.copy_share.result',
      properties,
    }, release)).toThrow();
  });

  it.each([
    [{ name: 'doc_hub.unknown', properties: {} }, 'unknown event name'],
    [{
      name: 'doc_hub.mobile_tool_sheet.opened',
      properties: { source: 'header', documentPath: '/private/report.md' },
    }, 'unknown property'],
    [{
      name: 'doc_hub.mobile_tool.selected',
      properties: { tool: 'secrets', source: 'bottom-sheet' },
    }, 'invalid enum'],
    [{
      name: 'doc_hub.audio_generation.completed',
      properties: { provider: 'openai', durationMs: -1 },
    }, 'invalid numeric value'],
    [{
      name: 'doc_hub.audio_playback.error',
      properties: { phase: 'decode', recoverable: 'yes' },
    }, 'invalid boolean value'],
  ])('rejects %s (%s)', (input, _reason) => {
    expect(() => parseDocHubTelemetryEvent(input, release)).toThrow();
  });

  it('rejects every private payload field before serialization', () => {
    const canaries = {
      documentBody: 'PRIVATE_DOCUMENT_BODY_CANARY',
      selectedText: 'SELECTED_TEXT_CANARY',
      prompt: 'CUSTOM_PROMPT_CANARY',
      output: 'GENERATED_OUTPUT_CANARY',
      credential: 'sk-provider-token-canary',
      previewToken: 'preview-token-canary',
      canonicalUrl: 'https://entity.example/private?token=canary',
      documentPath: '/Users/henry/Private/payroll.md',
      rawError: 'provider stack trace canary',
    };

    for (const [property, value] of Object.entries(canaries)) {
      expect(() => parseDocHubTelemetryEvent({
        name: 'doc_hub.deep_link_restoration.failure',
        properties: {
          reason: 'document-missing',
          [property]: value,
        },
      }, release)).toThrow();
    }
  });

  it('accepts a safe API event without echoing it and rejects private fields', async () => {
    const app = express();
    app.use(express.json());
    const recorded: Array<ParsedDocHubTelemetryEvent & { recordedAt: string }> = [];
    registerDocHubTelemetryRoute(app, { record: (event) => recorded.push(event) });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Telemetry test server failed');
    const endpoint = `http://127.0.0.1:${address.port}/api/telemetry/doc-hub`;

    try {
      const accepted = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'doc_hub.mobile_tool.selected',
          properties: { tool: 'audio', source: 'bottom-sheet' },
        }),
      });
      expect(accepted.status).toBe(202);
      expect(await accepted.json()).toEqual({ accepted: true });
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        name: 'doc_hub.mobile_tool.selected',
        properties: { tool: 'audio', source: 'bottom-sheet' },
      });

      const rejected = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'doc_hub.mobile_tool.selected',
          properties: {
            tool: 'audio',
            source: 'bottom-sheet',
            documentBody: 'PRIVATE_DOCUMENT_BODY_CANARY',
          },
        }),
      });
      expect(rejected.status).toBe(400);
      expect(recorded).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
