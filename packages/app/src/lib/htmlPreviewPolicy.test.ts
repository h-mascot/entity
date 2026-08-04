import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStaticHtmlPreviewUrl,
  htmlPreviewSandboxForSource,
  isStaticHtmlPreviewSource,
} from './htmlPreviewPolicy.ts';

test('Entity Wiki uses a scriptless opaque-origin HTML sandbox', () => {
  assert.equal(isStaticHtmlPreviewSource('entity-wiki'), true);
  assert.equal(
    htmlPreviewSandboxForSource('entity-wiki'),
    'allow-popups allow-top-navigation-by-user-activation',
  );
});

test('other HTML sources retain the interactive report sandbox', () => {
  assert.equal(isStaticHtmlPreviewSource('workspace'), false);
  assert.equal(
    htmlPreviewSandboxForSource('workspace'),
    'allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation',
  );
});

test('static HTML preview carries the top-level route fragment into a Blob URL', async () => {
  const blobs: Blob[] = [];
  const result = createStaticHtmlPreviewUrl(
    '<!doctype html><h2 id="release">Release</h2>',
    '#release',
    (blob) => {
      blobs.push(blob);
      return 'blob:https://entity.test/wiki';
    },
  );

  assert.deepEqual(result, {
    objectUrl: 'blob:https://entity.test/wiki',
    src: 'blob:https://entity.test/wiki#release',
  });
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0]?.type, 'text/html');
  assert.equal(await blobs[0]?.text(), '<!doctype html><h2 id="release">Release</h2>');
});

test('static HTML preview ignores non-fragment route input', () => {
  const result = createStaticHtmlPreviewUrl('<h1>Wiki</h1>', 'javascript:alert(1)', () => 'blob:wiki');
  assert.deepEqual(result, { objectUrl: 'blob:wiki', src: 'blob:wiki' });
});
