import test from 'node:test';
import assert from 'node:assert/strict';

import { createShareAdapter } from './shareAdapter.ts';

test('copy writes through the injected clipboard when secure clipboard access succeeds', async () => {
  const writes: string[] = [];
  const adapter = createShareAdapter({
    isSecureContext: true,
    clipboard: {
      writeText: async (value: string) => {
        writes.push(value);
      },
    },
  });

  assert.deepEqual(await adapter.copy('https://entity.example/docs/source/book/report.md'), {
    status: 'copied',
  });
  assert.deepEqual(writes, ['https://entity.example/docs/source/book/report.md']);
});

test('copy requires manual selection when the clipboard API is missing', async () => {
  const adapter = createShareAdapter({
    isSecureContext: true,
    clipboard: undefined,
  });

  assert.deepEqual(await adapter.copy('copy me'), {
    status: 'manual-required',
    value: 'copy me',
  });
});

test('copy requires manual selection outside a secure context without calling the clipboard', async () => {
  let clipboardCalled = false;
  const adapter = createShareAdapter({
    isSecureContext: false,
    clipboard: {
      writeText: async () => {
        clipboardCalled = true;
      },
    },
  });

  assert.deepEqual(await adapter.copy('copy me'), {
    status: 'manual-required',
    value: 'copy me',
  });
  assert.equal(clipboardCalled, false);
});

test('copy requires manual selection when clipboard permission is denied', async () => {
  const adapter = createShareAdapter({
    isSecureContext: true,
    clipboard: {
      writeText: async () => {
        throw new DOMException('User denied clipboard permission', 'NotAllowedError');
      },
    },
  });

  assert.deepEqual(await adapter.copy('copy me'), {
    status: 'manual-required',
    value: 'copy me',
  });
});

test('copy reports unexpected clipboard failures without leaking values or error internals', async () => {
  const privateValue = 'https://entity.example/private?token=secret-value';
  const internalError = 'webview IPC failed at /Users/henry/private/path';
  const adapter = createShareAdapter({
    isSecureContext: true,
    clipboard: {
      writeText: async () => {
        throw new Error(internalError);
      },
    },
  });

  const result = await adapter.copy(privateValue);

  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') {
    assert.fail('unexpected copy result');
  }
  assert.equal(result.safeMessage.length > 0, true);
  assert.equal(result.safeMessage.includes(privateValue), false);
  assert.equal(result.safeMessage.includes('secret-value'), false);
  assert.equal(result.safeMessage.includes(internalError), false);
  assert.equal(result.safeMessage.includes('/Users/henry/private/path'), false);
});

test('native share receives only the title and canonical URL when it resolves', async () => {
  const sharedPayloads: Array<{ title?: string; text?: string; url?: string }> = [];
  const clipboardWrites: string[] = [];
  const adapter = createShareAdapter({
    isSecureContext: true,
    share: async (payload) => {
      sharedPayloads.push(payload);
    },
    clipboard: {
      writeText: async (value) => {
        clipboardWrites.push(value);
      },
    },
  });

  assert.deepEqual(
    await adapter.share({
      title: 'Daily brief',
      url: 'https://entity.example/docs/source/workspace/output/daily-brief.md?tool=share',
      text: 'Private selected text must not enter native share',
    }),
    { status: 'copied' },
  );
  assert.deepEqual(sharedPayloads, [{
    title: 'Daily brief',
    url: 'https://entity.example/docs/source/workspace/output/daily-brief.md?tool=share',
  }]);
  assert.deepEqual(clipboardWrites, []);
});

test('missing native share support falls back to copying the canonical URL', async () => {
  const clipboardWrites: string[] = [];
  const adapter = createShareAdapter({
    isSecureContext: true,
    clipboard: {
      writeText: async (value) => {
        clipboardWrites.push(value);
      },
    },
  });
  const canonicalUrl = 'https://entity.example/docs/source/book/report.md?tool=share';

  assert.deepEqual(
    await adapter.share({
      title: 'Report',
      url: canonicalUrl,
      text: 'Private document body',
    }),
    { status: 'copied' },
  );
  assert.deepEqual(clipboardWrites, [canonicalUrl]);
});

test('rejected native sharing falls back through copy and then manual selection', async () => {
  const canonicalUrl = 'https://entity.example/docs/source/book/report.md?tool=share';
  const clipboardWrites: string[] = [];
  const rejectedShare = async () => {
    throw new DOMException('Native share failed', 'NotAllowedError');
  };
  const copyFallback = createShareAdapter({
    isSecureContext: true,
    share: rejectedShare,
    clipboard: {
      writeText: async (value) => {
        clipboardWrites.push(value);
      },
    },
  });
  const manualFallback = createShareAdapter({
    isSecureContext: true,
    share: rejectedShare,
    clipboard: undefined,
  });

  assert.deepEqual(
    await copyFallback.share({ title: 'Report', url: canonicalUrl }),
    { status: 'copied' },
  );
  assert.deepEqual(clipboardWrites, [canonicalUrl]);
  assert.deepEqual(
    await manualFallback.share({ title: 'Report', url: canonicalUrl }),
    { status: 'manual-required', value: canonicalUrl },
  );
});

test('cancelling native share returns cancelled without copying', async () => {
  const clipboardWrites: string[] = [];
  const adapter = createShareAdapter({
    isSecureContext: true,
    share: async () => {
      throw new DOMException('User cancelled sharing', 'AbortError');
    },
    clipboard: {
      writeText: async (value) => {
        clipboardWrites.push(value);
      },
    },
  });

  assert.deepEqual(
    await adapter.share({
      title: 'Report',
      url: 'https://entity.example/docs/source/book/report.md?tool=share',
    }),
    { status: 'cancelled' },
  );
  assert.deepEqual(clipboardWrites, []);
});

test('empty share payload fails safely without invoking native share or copy', async () => {
  let nativeShareCalled = false;
  let clipboardCalled = false;
  const adapter = createShareAdapter({
    isSecureContext: true,
    share: async () => {
      nativeShareCalled = true;
    },
    clipboard: {
      writeText: async () => {
        clipboardCalled = true;
      },
    },
  });

  const result = await adapter.share({});

  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') {
    assert.fail('unexpected empty-payload result');
  }
  assert.equal(result.safeMessage.length > 0, true);
  assert.equal(nativeShareCalled, false);
  assert.equal(clipboardCalled, false);
});
