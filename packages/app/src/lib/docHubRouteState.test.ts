import test from 'node:test';
import assert from 'node:assert/strict';

import * as docHubRoute from './docHubRoute.ts';
import {
  parseDocHubRouteState,
  serializeDocHubRouteState,
} from './docHubRoute.ts';

test('shared Doc Hub route state round-trips every supported active tool', () => {
  const target = {
    sourceId: 'crew home',
    path: 'Projects/Daily Brief.md',
  };
  const tools = ['intelligence', 'convert', 'comments', 'share', 'audio'] as const;

  for (const tool of tools) {
    const serialized = serializeDocHubRouteState({ ...target, tool });
    const url = new URL(serialized, 'https://entity.local');

    assert.equal(url.pathname, '/docs/source/crew%20home/Projects/Daily%20Brief.md');
    assert.equal(url.searchParams.get('tool'), tool);
    assert.deepEqual(parseDocHubRouteState(url.pathname, url.search), { ...target, tool });
  }
});

test('shared Doc Hub route state preserves safe Convert configuration and stable identifiers', () => {
  const state = {
    sourceId: 'workspace',
    path: 'output/report.md',
    tool: 'convert' as const,
    convert: {
      sourceKind: 'current-document' as const,
      artifactRef: 'artifact:task-output-42',
      outputType: 'html' as const,
      templateId: 'html-present',
      jobId: 'job_01JZX8Y3K9',
    },
  };

  const serialized = serializeDocHubRouteState(state);
  const url = new URL(serialized, 'https://entity.local');

  assert.deepEqual(
    Object.fromEntries(url.searchParams),
    {
      tool: 'convert',
      convertSource: 'current-document',
      convertArtifact: 'artifact:task-output-42',
      convertOutput: 'html',
      convertTemplate: 'html-present',
      convertJob: 'job_01JZX8Y3K9',
    },
  );
  assert.deepEqual(parseDocHubRouteState(url.pathname, url.search), state);
});

test('shared Doc Hub route state parses legacy links with safe defaults', () => {
  assert.deepEqual(
    parseDocHubRouteState('/docs/source/book/cron/report.pdf'),
    {
      sourceId: 'book',
      path: 'cron/report.pdf',
    },
  );
  assert.deepEqual(
    parseDocHubRouteState('/', '?file=output%2Fdemo.pdf&source=book'),
    {
      sourceId: 'book',
      path: 'output/demo.pdf',
    },
  );
  assert.equal(parseDocHubRouteState('/task/42', '?tool=comments'), null);
});

test('shared Doc Hub route state ignores invalid optional values without losing the document', () => {
  assert.deepEqual(
    parseDocHubRouteState(
      '/docs/source/workspace/output/report.md',
      '?tool=unknown&convertSource=clipboard&convertOutput=pdf&convertTemplate=&convertJob=',
    ),
    {
      sourceId: 'workspace',
      path: 'output/report.md',
    },
  );
});
test('shared Doc Hub route state omits absent Convert properties', () => {
  assert.deepEqual(
    parseDocHubRouteState(
      '/docs/source/workspace/output/report.md',
      '?tool=convert&convertOutput=audio',
    ),
    {
      sourceId: 'workspace',
      path: 'output/report.md',
      tool: 'convert',
      convert: {
        outputType: 'audio',
      },
    },
  );
});

test('shared Doc Hub route state serializes only recognized non-sensitive fields', () => {
  const serialized = serializeDocHubRouteState({
    sourceId: 'workspace',
    path: 'output/report.md',
    tool: 'convert',
    convert: {
      sourceKind: 'selected-text',
      artifactRef: 'artifact-42',
      outputType: 'markdown',
      templateId: 'plain-markdown',
      jobId: 'job-42',
      customPrompt: 'Expose this prompt',
      generatedOutput: 'Private generated text',
    },
    selectedText: 'Private selection',
    sourceContent: 'Private source',
    providerCredentials: 'secret',
    previewAuthorizationToken: 'token',
    unrecognized: 'value',
  } as Parameters<typeof serializeDocHubRouteState>[0] & Record<string, unknown>);
  const url = new URL(serialized, 'https://entity.local');

  assert.deepEqual([...url.searchParams.keys()], [
    'tool',
    'convertSource',
    'convertArtifact',
    'convertOutput',
    'convertTemplate',
    'convertJob',
  ]);
  assert.equal(serialized.includes('Private'), false);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('token'), false);
  assert.equal(serialized.includes('Expose'), false);
  assert.equal(serialized.includes('unrecognized'), false);
});

test('synchronizing a selected document preserves recognized active tool and Convert state', () => {
  const buildSynchronizedDocHubRoute = (
    docHubRoute as typeof docHubRoute & {
      buildSynchronizedDocHubRoute: (
        pathname: string,
        search: string,
        target: { sourceId: string; path: string },
      ) => string;
    }
  ).buildSynchronizedDocHubRoute;

  assert.equal(typeof buildSynchronizedDocHubRoute, 'function');
  assert.equal(
    buildSynchronizedDocHubRoute(
      '/docs/source/workspace/output/old-report.md',
      '?tool=convert&convertSource=selected-text&convertOutput=audio'
        + '&convertTemplate=voice-v1&convertJob=job-42&unrecognized=discard-me',
      { sourceId: 'book', path: 'cron/new-report.md' },
    ),
    '/docs/source/book/cron/new-report.md'
      + '?tool=convert&convertSource=selected-text&convertOutput=audio'
      + '&convertTemplate=voice-v1&convertJob=job-42',
  );
});

test('canonical route state accepts benign tildes and adjacent dots but rejects traversal segments', () => {
  const validTargets = [
    { sourceId: 'workspace', path: 'notes/draft.md~' },
    { sourceId: 'workspace', path: 'output/report..final.md' },
  ];

  for (const target of validTargets) {
    const serialized = serializeDocHubRouteState(target);
    const url = new URL(serialized, 'https://entity.local');
    assert.deepEqual(parseDocHubRouteState(url.pathname, url.search), target);
  }

  assert.throws(
    () => serializeDocHubRouteState({ sourceId: 'workspace', path: 'output/../secret.md' }),
    TypeError,
  );
  assert.equal(
    parseDocHubRouteState('/docs/source/workspace/output/../secret.md'),
    null,
  );
});

test('canonical local Doc Hub links retain local identity and only safe route state', () => {
  const buildCanonicalLocalDocHubUrl = (
    docHubRoute as typeof docHubRoute & {
      buildCanonicalLocalDocHubUrl: (
        path: string,
        pathname: string,
        search: string,
        deploymentUrl: string | URL,
      ) => string;
    }
  ).buildCanonicalLocalDocHubUrl;

  assert.equal(typeof buildCanonicalLocalDocHubUrl, 'function');
  const canonical = new URL(buildCanonicalLocalDocHubUrl(
    'notes/Daily Brief.md',
    '/docs/source/workspace/output/old.md',
    '?tool=convert&convertSource=current-document&convertArtifact=artifact-42'
      + '&convertOutput=html&convertTemplate=html-present&convertJob=job-42'
      + '&source=remote&file=old.md&selectedText=private&prompt=private'
      + '&previewAuthorizationToken=secret&unrecognized=discard-me',
    'https://entity.example/deployment/prefix',
  ));

  assert.equal(canonical.origin, 'https://entity.example');
  assert.equal(canonical.pathname, '/');
  assert.deepEqual(
    Object.fromEntries(canonical.searchParams),
    {
      tab: 'files',
      file: 'notes/Daily Brief.md',
      tool: 'convert',
      convertSource: 'current-document',
      convertArtifact: 'artifact-42',
      convertOutput: 'html',
      convertTemplate: 'html-present',
      convertJob: 'job-42',
    },
  );
  assert.equal(canonical.searchParams.has('source'), false);
  assert.equal(canonical.href.includes('private'), false);
  assert.equal(canonical.href.includes('secret'), false);
  assert.equal(canonical.href.includes('unrecognized'), false);
});

test('local legacy links restore a null source when multisource mode is disabled', () => {
  const resolveDocHubRouteSelection = (
    docHubRoute as typeof docHubRoute & {
      resolveDocHubRouteSelection: (
        pathname: string,
        search: string,
        fsMultiSourceEnabled: boolean,
      ) => { sourceId: string | null; path: string } | null;
    }
  ).resolveDocHubRouteSelection;

  assert.equal(typeof resolveDocHubRouteSelection, 'function');
  const localSearch = '?tab=files&file=notes%2FDaily+Brief.md&tool=comments';
  assert.deepEqual(
    resolveDocHubRouteSelection('/', localSearch, false),
    { sourceId: null, path: 'notes/Daily Brief.md' },
  );
  assert.deepEqual(
    resolveDocHubRouteSelection('/', localSearch, true),
    { sourceId: 'workspace', path: 'notes/Daily Brief.md' },
  );
  assert.deepEqual(
    resolveDocHubRouteSelection(
      '/',
      '?tab=files&file=notes%2FDaily+Brief.md&source=book',
      false,
    ),
    { sourceId: 'book', path: 'notes/Daily Brief.md' },
  );
  assert.deepEqual(
    resolveDocHubRouteSelection(
      '/docs/source/workspace/notes/Daily%20Brief.md',
      '',
      false,
    ),
    { sourceId: 'workspace', path: 'notes/Daily Brief.md' },
  );
});

test('shared route tools map only to implemented Doc Hub rail focuses', () => {
  const resolveDocHubRailFocus = (
    docHubRoute as typeof docHubRoute & {
      resolveDocHubRailFocus: (
        tool: 'intelligence' | 'convert' | 'comments' | 'share' | 'audio' | undefined,
      ) => 'intelligence' | 'comments' | null;
    }
  ).resolveDocHubRailFocus;

  assert.equal(typeof resolveDocHubRailFocus, 'function');
  assert.equal(resolveDocHubRailFocus('intelligence'), 'intelligence');
  assert.equal(resolveDocHubRailFocus('comments'), 'comments');
  assert.equal(resolveDocHubRailFocus('convert'), null);
  assert.equal(resolveDocHubRailFocus('share'), null);
  assert.equal(resolveDocHubRailFocus('audio'), null);
  assert.equal(resolveDocHubRailFocus(undefined), null);
});

test('mobile tool state restores active Share from the shared Doc Hub route', () => {
  assert.deepEqual(
    parseDocHubRouteState(
      '/docs/source/book/memory/Daily%20Brief.md',
      '?tool=share&convertSource=current-document&convertOutput=audio'
        + '&convertTemplate=voice-v1&convertJob=job-42',
    ),
    {
      sourceId: 'book',
      path: 'memory/Daily Brief.md',
      tool: 'share',
      convert: {
        sourceKind: 'current-document',
        outputType: 'audio',
        templateId: 'voice-v1',
        jobId: 'job-42',
      },
    },
  );
});

test('mobile tool activation synchronizes the selected tool without changing document or Convert state', () => {
  const buildActivatedDocHubToolRoute = (
    docHubRoute as typeof docHubRoute & {
      buildActivatedDocHubToolRoute: (
        pathname: string,
        search: string,
        tool: 'intelligence' | 'convert' | 'comments' | 'share' | 'audio',
      ) => string;
    }
  ).buildActivatedDocHubToolRoute;

  assert.equal(typeof buildActivatedDocHubToolRoute, 'function');
  const activatedRoute = buildActivatedDocHubToolRoute(
    '/docs/source/book/memory/Daily%20Brief.md',
    '?tool=share&convertSource=current-document&convertArtifact=artifact-42'
      + '&convertOutput=audio&convertTemplate=voice-v1&convertJob=job-42',
    'comments',
  );
  const activatedUrl = new URL(activatedRoute, 'https://entity.example');

  assert.equal(activatedUrl.pathname, '/docs/source/book/memory/Daily%20Brief.md');
  assert.deepEqual(
    parseDocHubRouteState(activatedUrl.pathname, activatedUrl.search),
    {
      sourceId: 'book',
      path: 'memory/Daily Brief.md',
      tool: 'comments',
      convert: {
        sourceKind: 'current-document',
        artifactRef: 'artifact-42',
        outputType: 'audio',
        templateId: 'voice-v1',
        jobId: 'job-42',
      },
    },
  );
});

test('mobile tool activation preserves the current document fragment', () => {
  const buildActivatedDocHubToolRoute = (
    docHubRoute as typeof docHubRoute & {
      buildActivatedDocHubToolRoute: (
        pathname: string,
        search: string,
        tool: 'intelligence' | 'convert' | 'comments' | 'share' | 'audio',
        hash?: string,
      ) => string;
    }
  ).buildActivatedDocHubToolRoute;

  const activatedRoute = buildActivatedDocHubToolRoute(
    '/docs/source/book/memory/Daily%20Brief.md',
    '?tool=share',
    'comments',
    '#section',
  );
  const activatedUrl = new URL(activatedRoute, 'https://entity.example');

  assert.equal(
    activatedUrl.hash,
    '#section',
    'opening a mobile tool must not move a fragment deep link away from its section',
  );
});
