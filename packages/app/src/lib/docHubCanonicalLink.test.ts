import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCanonicalDocHubUrl } from './docHubRoute.ts';

test('builds absolute deployment URLs for every supported Doc Hub content class', () => {
  const cases = [
    {
      contentClass: 'source document',
      state: {
        sourceId: 'book',
        path: 'Projects/Entity/operating-manual.pdf',
        tool: 'intelligence' as const,
      },
    },
    {
      contentClass: 'task-output document',
      state: {
        sourceId: 'workspace',
        path: 'output/tasks/42/research-notes.txt',
        tool: 'comments' as const,
      },
    },
    {
      contentClass: 'generated report or artifact',
      state: {
        sourceId: 'workspace',
        path: 'output/reports/daily-brief.html',
        tool: 'convert' as const,
        convert: {
          sourceKind: 'artifact' as const,
          artifactRef: 'artifact:daily-brief',
          outputType: 'html' as const,
          jobId: 'job_01JZX8Y3K9',
        },
      },
    },
    {
      contentClass: 'Markdown document',
      state: {
        sourceId: 'crew home',
        path: 'memory/Daily Notes/2026-07-28.md',
        tool: 'audio' as const,
      },
    },
    {
      contentClass: 'HTML preview',
      state: {
        sourceId: 'ada-gateway',
        path: 'output/previews/interactive-demo.html',
        tool: 'share' as const,
      },
    },
  ];

  for (const { contentClass, state } of cases) {
    const canonicalUrl = buildCanonicalDocHubUrl(
      state,
      'https://entity.example/app?previewToken=signed#embedded-frame',
    );
    const url = new URL(canonicalUrl);

    assert.equal(url.origin, 'https://entity.example', contentClass);
    assert.match(url.pathname, /^\/docs\/source\//, contentClass);
    assert.equal(url.searchParams.get('tool'), state.tool, contentClass);
    assert.equal(url.hash, '', contentClass);
  }
});

test('preserves durable Convert job state while omitting transient and unsafe share state', () => {
  const canonicalUrl = buildCanonicalDocHubUrl(
    {
      sourceId: 'workspace',
      path: 'output/reports/daily-brief.html',
      tool: 'convert',
      convert: {
        sourceKind: 'artifact',
        artifactRef: 'artifact:daily-brief',
        outputType: 'html',
        templateId: 'html-present',
        jobId: 'job_01JZX8Y3K9',
        generatedOutput: '<h1>Private result</h1>',
        customPrompt: 'Private prompt',
      },
      selectedText: 'Private selection',
      sourceContent: 'Private source body',
      previewAuthorizationToken: 'signed-preview-token',
      iframeUrl: 'https://preview.example/iframe/signed',
      blobUrl: 'blob:https://entity.example/1234',
      rawSourceUrl: 'https://entity.example/api/sources/book/raw/report.html',
    } as Parameters<typeof buildCanonicalDocHubUrl>[0] & Record<string, unknown>,
    'https://entity.example',
  );
  const url = new URL(canonicalUrl);

  assert.equal(url.searchParams.get('tool'), 'convert');
  assert.equal(url.searchParams.get('convertJob'), 'job_01JZX8Y3K9');
  assert.equal(url.searchParams.get('convertArtifact'), 'artifact:daily-brief');
  assert.deepEqual([...url.searchParams.keys()], [
    'tool',
    'convertSource',
    'convertArtifact',
    'convertOutput',
    'convertTemplate',
    'convertJob',
  ]);
  assert.equal(canonicalUrl.includes('Private'), false);
  assert.equal(canonicalUrl.includes('signed'), false);
  assert.equal(canonicalUrl.includes('iframe'), false);
  assert.equal(canonicalUrl.includes('blob:'), false);
  assert.equal(canonicalUrl.includes('/api/sources/'), false);
});

test('rejects base URLs that cannot identify an HTTP deployment origin', () => {
  const state = {
    sourceId: 'workspace',
    path: 'output/report.md',
  };

  for (const baseUrl of [
    'blob:https://entity.example/1234',
    'file:///tmp/entity/index.html',
    'data:text/html,preview',
    'javascript:alert(1)',
    '/relative/deployment',
  ]) {
    assert.throws(
      () => buildCanonicalDocHubUrl(state, baseUrl),
      TypeError,
      baseUrl,
    );
  }
});
