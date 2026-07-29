import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DocumentAudioRequestError,
  requestDocumentAudio,
  resolveSafeDocumentAudioUrl,
} from './documentAudioRequest.ts';

const body = {
  text: 'A short governed document.',
  provider: 'openai',
  voice: 'alloy',
};

test('requestDocumentAudio preserves a slow request and returns safe artifact metadata', async () => {
  let calls = 0;
  const result = await requestDocumentAudio({
    urls: ['/api/tts/generate'],
    body,
    timeoutMs: 100,
    fetchImpl: (async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({
      audioUrl: '/api/tts/audio/result.mp3',
      chars: 27,
      truncated: false,
      cached: true,
      }), { status: 200 });
    }) as typeof fetch,
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    audioUrl: '/api/tts/audio/result.mp3',
    chars: 27,
    truncated: false,
    cached: true,
  });
});

test('requestDocumentAudio times out, aborts the request, and returns a safe recoverable error', async () => {
  let aborted = false;
  await assert.rejects(
    requestDocumentAudio({
      urls: ['/api/tts/generate'],
      body,
      timeoutMs: 5,
      fetchImpl: ((_, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as typeof fetch,
    }),
    (error: unknown) => {
      assert.ok(error instanceof DocumentAudioRequestError);
      assert.equal(error.kind, 'timeout');
      assert.match(error.message, /timed out.*try again/i);
      return true;
    },
  );
  assert.equal(aborted, true);
});

test('requestDocumentAudio redacts provider details and identifies missing configuration', async () => {
  const canary = 'secret-token-from-upstream';
  await assert.rejects(
    requestDocumentAudio({
      urls: ['/api/tts/generate'],
      body,
      fetchImpl: (async () => new Response(JSON.stringify({
        error: 'OPENAI_API_KEY is not configured.',
        detail: canary,
      }), { status: 400 })) as typeof fetch,
    }),
    (error: unknown) => {
      assert.ok(error instanceof DocumentAudioRequestError);
      assert.equal(error.kind, 'provider-missing');
      assert.doesNotMatch(error.message, /OPENAI_API_KEY|secret-token/i);
      assert.match(error.message, /voice settings/i);
      return true;
    },
  );
});

test('requestDocumentAudio does not retry a definitive provider failure', async () => {
  let calls = 0;
  await assert.rejects(
    requestDocumentAudio({
      urls: ['/api/tts/generate', '/tts/generate'],
      body,
      fetchImpl: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: 'provider exploded' }), { status: 502 });
      }) as typeof fetch,
    }),
    (error: unknown) => {
      assert.ok(error instanceof DocumentAudioRequestError);
      assert.equal(error.kind, 'provider');
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('resolveSafeDocumentAudioUrl accepts audio data and trusted origins only', () => {
  assert.equal(
    resolveSafeDocumentAudioUrl('data:audio/mpeg;base64,AAAA', 'https://entity.example'),
    'data:audio/mpeg;base64,AAAA',
  );
  assert.equal(
    resolveSafeDocumentAudioUrl('/api/tts/audio/a.mp3', 'https://entity.example'),
    'https://entity.example/api/tts/audio/a.mp3',
  );
  assert.equal(
    resolveSafeDocumentAudioUrl(
      'https://api.entity.example/audio/a.mp3',
      'https://entity.example',
      'https://api.entity.example',
    ),
    'https://api.entity.example/audio/a.mp3',
  );
  assert.equal(
    resolveSafeDocumentAudioUrl('javascript:alert(1)', 'https://entity.example'),
    null,
  );
  assert.equal(
    resolveSafeDocumentAudioUrl('https://attacker.example/audio.mp3', 'https://entity.example'),
    null,
  );
});
