import test from 'node:test';
import assert from 'node:assert/strict';

import * as docHubRoute from './docHubRoute.ts';
import { parseDocHubRouteState } from './docHubRoute.ts';

test('relative Markdown navigation preserves source-less local Doc Hub identity', () => {
  type RelativeDocHubNavigation = {
    target: {
      sourceId: string | null;
      path: string;
    };
    route: string;
  };
  const resolveRelativeDocHubNavigation = (
    docHubRoute as typeof docHubRoute & {
      resolveRelativeDocHubNavigation: (
        pathname: string,
        search: string,
        href: string,
        fsMultiSourceEnabled: boolean,
      ) => RelativeDocHubNavigation | null;
    }
  ).resolveRelativeDocHubNavigation;

  assert.equal(
    typeof resolveRelativeDocHubNavigation,
    'function',
    'relative links need a route helper that retains local-vs-source authority',
  );
  assert.deepEqual(
    resolveRelativeDocHubNavigation(
      '/',
      '?tab=files&file=notes%2FDaily+Brief.md',
      './Follow Up.md',
      false,
    ),
    {
      target: {
        sourceId: null,
        path: 'notes/Follow Up.md',
      },
      route: '/?tab=files&file=notes%2FFollow+Up.md',
    },
    'a local relative link must remain a portable local route rather than becoming source/workspace',
  );
});

test('same-origin absolute task-output links open from task routes without weakening relative-link context', () => {
  type RelativeDocHubNavigation = {
    target: {
      sourceId: string | null;
      path: string;
    };
    route: string;
  };
  const resolveRelativeDocHubNavigation = docHubRoute.resolveRelativeDocHubNavigation as (
    pathname: string,
    search: string,
    href: string,
    fsMultiSourceEnabled: boolean,
    deploymentOrigin?: string,
  ) => RelativeDocHubNavigation | null;

  assert.deepEqual(
    resolveRelativeDocHubNavigation(
      '/task/42',
      '',
      '/docs/source/workspace/output/tasks/42/final-report.md'
        + '?tool=comments&convertJob=job-42&selectedText=private-selection'
        + '&rawSourceUrl=https%3A%2F%2Fentity.example%2Fapi%2Fprivate',
      true,
      'https://entity.example',
    ),
    {
      target: {
        sourceId: 'workspace',
        path: 'output/tasks/42/final-report.md',
      },
      route: '/docs/source/workspace/output/tasks/42/final-report.md'
        + '?tool=comments&convertJob=job-42',
    },
    'an absolute same-origin task-output route must open and retain only safe route state',
  );
  assert.equal(
    resolveRelativeDocHubNavigation(
      '/task/42',
      '',
      './sibling-report.md',
      true,
      'https://entity.example',
    ),
    null,
    'a relative link still requires an active Doc Hub document as its resolution base',
  );
});

test('relative Markdown navigation preserves safe destination tool and Convert state', () => {
  const resolved = docHubRoute.resolveRelativeDocHubNavigation(
    '/docs/source/book/memory/Daily%20Brief.md',
    '',
    './note.md?tool=convert&convertSource=current-document&convertOutput=audio'
      + '&convertTemplate=voice-v1&convertJob=job-42'
      + '&selectedText=private&previewAuthorizationToken=secret&unknown=discard-me',
    true,
    'https://entity.example',
  );

  assert.ok(resolved);
  const route = new URL(resolved.route, 'https://entity.example');
  assert.deepEqual(
    parseDocHubRouteState(route.pathname, route.search),
    {
      sourceId: 'book',
      path: 'memory/note.md',
      tool: 'convert',
      convert: {
        sourceKind: 'current-document',
        outputType: 'audio',
        templateId: 'voice-v1',
        jobId: 'job-42',
      },
    },
  );
  assert.equal(route.searchParams.has('selectedText'), false);
  assert.equal(route.searchParams.has('previewAuthorizationToken'), false);
  assert.equal(route.searchParams.has('unknown'), false);
});

test('relative Markdown navigation cannot traverse above its source root', () => {
  const resolve = (href: string) => docHubRoute.resolveRelativeDocHubNavigation(
    '/docs/source/book/readme.md',
    '',
    href,
    true,
    'https://entity.example',
  );

  for (const href of [
    '../foo.md',
    '../another-source/foo.md',
    '../../foo.md',
    '../../../foo.md',
  ]) {
    assert.equal(
      resolve(href),
      null,
      `${href} must not escape source book or be reinterpreted as another source`,
    );
  }

  assert.deepEqual(resolve('./foo.md'), {
    target: {
      sourceId: 'book',
      path: 'foo.md',
    },
    route: '/docs/source/book/foo.md',
  });
  assert.deepEqual(resolve('./guides/foo.md'), {
    target: {
      sourceId: 'book',
      path: 'guides/foo.md',
    },
    route: '/docs/source/book/guides/foo.md',
  });
});

test('relative cross-document navigation preserves its destination anchor fragment', () => {
  const resolved = docHubRoute.resolveRelativeDocHubNavigation(
    '/docs/source/book/memory/Daily%20Brief.md',
    '',
    './guide.md?tool=comments#install',
    true,
    'https://entity.example',
  );

  assert.ok(resolved);
  const route = new URL(resolved.route, 'https://entity.example');
  assert.deepEqual(
    parseDocHubRouteState(route.pathname, route.search),
    {
      sourceId: 'book',
      path: 'memory/guide.md',
      tool: 'comments',
    },
    'preserving an anchor must not corrupt the parseable document route state',
  );
  assert.equal(
    route.hash,
    '#install',
    'cross-document Markdown navigation must retain the requested destination anchor',
  );
});

test('fragment-only navigation preserves current document and tool state', () => {
  const resolved = docHubRoute.resolveRelativeDocHubNavigation(
    '/docs/source/book/memory/guide.md',
    '?tool=comments',
    '#install',
    true,
    'https://entity.example',
  );

  assert.ok(resolved);
  assert.deepEqual(resolved.target, {
    sourceId: 'book',
    path: 'memory/guide.md',
  });
  const route = new URL(resolved.route, 'https://entity.example');
  assert.equal(route.pathname, '/docs/source/book/memory/guide.md');
  assert.equal(route.searchParams.get('tool'), 'comments');
  assert.equal(route.hash, '#install');
});

test('fragment scroll intent is immediate for same-document interception and load-driven across documents', () => {
  type FragmentScrollIntent = {
    hash: string;
    timing: 'immediate' | 'after-document-load';
  };
  const resolveDocHubFragmentScrollIntent = (
    docHubRoute as typeof docHubRoute & {
      resolveDocHubFragmentScrollIntent: (
        currentPathname: string,
        currentSearch: string,
        destinationRoute: string,
      ) => FragmentScrollIntent | null;
    }
  ).resolveDocHubFragmentScrollIntent;

  assert.equal(
    typeof resolveDocHubFragmentScrollIntent,
    'function',
    'intercepted Markdown links need an explicit fragment-scroll timing contract',
  );
  assert.deepEqual(
    resolveDocHubFragmentScrollIntent(
      '/docs/source/book/memory/guide.md',
      '?tool=comments',
      '/docs/source/book/memory/guide.md?tool=comments#install',
    ),
    {
      hash: '#install',
      timing: 'immediate',
    },
    'same-document fragment navigation must request scrolling without waiting for a file reload',
  );
  assert.deepEqual(
    resolveDocHubFragmentScrollIntent(
      '/docs/source/book/memory/guide.md',
      '?tool=comments',
      '/docs/source/book/memory/other-guide.md?tool=comments#install',
    ),
    {
      hash: '#install',
      timing: 'after-document-load',
    },
    'cross-document fragment navigation must defer scrolling until destination content loads',
  );
  assert.equal(
    resolveDocHubFragmentScrollIntent(
      '/docs/source/book/memory/guide.md',
      '?tool=comments',
      '/docs/source/book/memory/other-guide.md?tool=comments',
    ),
    null,
  );
});

test('mobile Convert controls hydrate safely from the current canonical route', () => {
  type MobileConvertControlState = {
    outputType: 'html' | 'markdown' | 'audio';
    templateId: string;
    jobId: string | null;
  };
  const resolveMobileConvertControlState = (
    docHubRoute as typeof docHubRoute & {
      resolveMobileConvertControlState: (
        pathname: string,
        search: string,
      ) => MobileConvertControlState;
    }
  ).resolveMobileConvertControlState;

  assert.equal(typeof resolveMobileConvertControlState, 'function');
  const pathname = '/docs/source/book/memory/Daily%20Brief.md';
  assert.deepEqual(
    resolveMobileConvertControlState(
      pathname,
      '?tool=convert&convertOutput=audio&convertTemplate=voice-v1&convertJob=job-42',
    ),
    {
      outputType: 'audio',
      templateId: 'voice-v1',
      jobId: 'job-42',
    },
  );
  assert.deepEqual(
    resolveMobileConvertControlState(
      pathname,
      '?tool=convert&convertOutput=pdf&convertTemplate=%2Funsafe&convertJob=%2Fsecret',
    ),
    {
      outputType: 'markdown',
      templateId: 'Default',
      jobId: null,
    },
    'invalid route values must fall back rather than hydrating unsupported controls',
  );
  assert.deepEqual(
    resolveMobileConvertControlState(
      pathname,
      '?tool=convert&convertOutput=html&convertTemplate=html-present&convertJob=job-43',
    ),
    {
      outputType: 'html',
      templateId: 'html-present',
      jobId: 'job-43',
    },
    'control state must re-resolve from the new URL after route navigation',
  );
});

test('transient history Back carries only safe route state for the same document identity', () => {
  const buildTransientDocHubHistoryRoute = (
    docHubRoute as typeof docHubRoute & {
      buildTransientDocHubHistoryRoute: (
        currentPathname: string,
        currentSearch: string,
        destinationPathname: string,
        destinationSearch: string,
      ) => string;
    }
  ).buildTransientDocHubHistoryRoute;

  assert.equal(typeof buildTransientDocHubHistoryRoute, 'function');
  const pathname = '/docs/source/book/memory/Daily%20Brief.md';
  const restoredConvert = new URL(
    buildTransientDocHubHistoryRoute(
      pathname,
      '?tool=convert&convertSource=artifact&convertArtifact=artifact-42'
        + '&convertOutput=html&convertTemplate=executive-brief&convertJob=job-42'
        + '&selectedText=private&customPrompt=private&unknown=discard-me',
      pathname,
      '?tool=convert&convertSource=artifact&convertOutput=html&convertJob=job-42',
    ),
    'https://entity.example',
  );

  assert.deepEqual(
    parseDocHubRouteState(restoredConvert.pathname, restoredConvert.search),
    {
      sourceId: 'book',
      path: 'memory/Daily Brief.md',
      tool: 'convert',
      convert: {
        sourceKind: 'artifact',
        artifactRef: 'artifact-42',
        outputType: 'html',
        templateId: 'executive-brief',
        jobId: 'job-42',
      },
    },
    'an older same-document Convert entry must regain the latest safe template and job state',
  );
  assert.deepEqual(
    [...restoredConvert.searchParams.keys()],
    [
      'tool',
      'convertSource',
      'convertArtifact',
      'convertOutput',
      'convertTemplate',
      'convertJob',
    ],
    'private and unknown parameters must not cross transient history entries',
  );

  const restoredShare = new URL(
    buildTransientDocHubHistoryRoute(
      pathname,
      '?tool=share',
      pathname,
      '',
    ),
    'https://entity.example',
  );
  assert.deepEqual(
    parseDocHubRouteState(restoredShare.pathname, restoredShare.search),
    {
      sourceId: 'book',
      path: 'memory/Daily Brief.md',
      tool: 'share',
    },
    'the original no-tool entry must regain an activated same-document Share tool',
  );

  const differentDocument = new URL(
    buildTransientDocHubHistoryRoute(
      pathname,
      '?tool=share&convertJob=job-42',
      '/docs/source/book/memory/Another%20Brief.md',
      '',
    ),
    'https://entity.example',
  );
  assert.deepEqual(
    parseDocHubRouteState(differentDocument.pathname, differentDocument.search),
    {
      sourceId: 'book',
      path: 'memory/Another Brief.md',
    },
    'a different destination document must not inherit tool or Convert state',
  );
});

test('right split-pane relative links resolve from the pane document instead of the left route', () => {
  type RelativeDocHubNavigation = {
    target: {
      sourceId: string | null;
      path: string;
    };
    route: string;
  };
  const resolvePaneRelativeDocHubNavigation = (
    docHubRoute as typeof docHubRoute & {
      resolvePaneRelativeDocHubNavigation: (
        windowPathname: string,
        windowSearch: string,
        paneTarget: { sourceId: string | null; path: string },
        href: string,
        fsMultiSourceEnabled: boolean,
        deploymentOrigin?: string,
      ) => RelativeDocHubNavigation | null;
    }
  ).resolvePaneRelativeDocHubNavigation;

  assert.equal(typeof resolvePaneRelativeDocHubNavigation, 'function');
  assert.deepEqual(
    resolvePaneRelativeDocHubNavigation(
      '/docs/source/workspace/output/left/Overview.md',
      '?tool=comments',
      {
        sourceId: 'book',
        path: 'memory/right/Guide.md',
      },
      './next.md',
      true,
      'https://entity.example',
    ),
    {
      target: {
        sourceId: 'book',
        path: 'memory/right/next.md',
      },
      route: '/docs/source/book/memory/right/next.md',
    },
    'the right pane must not resolve its relative link beneath output/left',
  );
});
