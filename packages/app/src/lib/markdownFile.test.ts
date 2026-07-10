import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldRenderMarkdownPreview } from './markdownFile.ts';

test('HTML paths use the HTML viewer when a remote source reports markdown content', () => {
  assert.equal(shouldRenderMarkdownPreview('output/onboarding.html', 'text/markdown'), false);
  assert.equal(shouldRenderMarkdownPreview('output/onboarding.xhtml', 'text/markdown'), false);
});

test('Markdown paths and extensionless markdown content still use the reading view', () => {
  assert.equal(shouldRenderMarkdownPreview('notes/readme.md', 'text/plain'), true);
  assert.equal(shouldRenderMarkdownPreview('notes/readme', 'text/markdown'), true);
});
