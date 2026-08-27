import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

test('Entity Wiki sandbox never enables scripts or same-origin access', () => {
  const sandbox = htmlPreviewSandboxForSource('entity-wiki');
  assert.equal(sandbox.includes('allow-scripts'), false);
  assert.equal(sandbox.includes('allow-same-origin'), false);
});
