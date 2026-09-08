import test from 'node:test';
import assert from 'node:assert/strict';

import * as docHubRoute from './docHubRoute.ts';
import {
  buildDocHubExitPath,
  buildDocHubRoutePath,
  parseDocHubRouteState,
  resolveDocHubRouteTarget,
  resolveWorkspaceTabRoute,
  serializeDocHubRouteState,
  shouldRestoreLastDocHubFile,
} from './docHubRoute.ts';

test('pathname source route wins over stale Doc Hub query state', () => {
  assert.deepEqual(
    resolveDocHubRouteTarget(
      '/docs/source/ada-gateway/output/herald-labs-beta-engine/ritesh-nero-onboarding.html',
      '?file=cron%2Foutput%2F46d73e9d7717%2F2026-07-03_00-01-15.md&source=book',
    ),
    {
      sourceId: 'ada-gateway',
      path: 'output/herald-labs-beta-engine/ritesh-nero-onboarding.html',
    },
  );
});

test('maps every legacy document root into the workspace Doc Hub source', () => {
  assert.deepEqual(resolveDocHubRouteTarget('/docs/output/report.md'), {
    sourceId: 'workspace',
    path: 'output/report.md',
  });
  assert.deepEqual(resolveDocHubRouteTarget('/docs/memory/notes.json'), {
    sourceId: 'workspace',
    path: 'memory/notes.json',
  });
  assert.deepEqual(resolveDocHubRouteTarget('/docs/projects/demo/video.mp4'), {
    sourceId: 'workspace',
    path: 'projects/demo/video.mp4',
  });
  assert.deepEqual(resolveDocHubRouteTarget('/docs/workspace/readme.txt'), {
    sourceId: 'workspace',
    path: 'readme.txt',
  });
  assert.deepEqual(resolveDocHubRouteTarget('/workspace/readme.txt'), {
    sourceId: 'workspace',
    path: 'readme.txt',
  });
  assert.deepEqual(resolveDocHubRouteTarget('/docs/book/cron/report.md'), {
    sourceId: 'book',
    path: 'cron/report.md',
  });
});

test('keeps root query links as a backwards-compatible Doc Hub alias', () => {
  assert.deepEqual(resolveDocHubRouteTarget('/', '?file=output%2Fdemo.pdf&source=book'), {
    sourceId: 'book',
    path: 'output/demo.pdf',
  });
  assert.deepEqual(resolveDocHubRouteTarget('/', '?file=output%2Flocal.md'), {
    sourceId: 'workspace',
    path: 'output/local.md',
  });
  assert.equal(resolveDocHubRouteTarget('/task/42', '?file=output%2Fdemo.pdf&source=book'), null);
});

test('builds one shareable docs route for source-backed and workspace files', () => {
  assert.equal(
    buildDocHubRoutePath({ sourceId: 'crew home', path: 'Vision Board/image 1.png' }),
    '/docs/source/crew%20home/Vision%20Board/image%201.png',
  );
  assert.equal(
    buildDocHubRoutePath({ sourceId: 'workspace', path: 'output/demo.md' }),
    '/docs/source/workspace/output/demo.md',
  );
});

test('canonical source routes round-trip without changing authority', () => {
  const targets = [
    { sourceId: 'workspace', path: 'output/demo.md' },
    { sourceId: 'book', path: 'cron/report.pdf' },
  ];
  for (const target of targets) {
    assert.deepEqual(resolveDocHubRouteTarget(buildDocHubRoutePath(target)), target);
  }
});

test('preserves an explicit organization through canonical and relative Doc Hub routes', () => {
  const state = { sourceId: 'book', path: 'cron/report.pdf', orgId: 'org-beta' };
  const route = serializeDocHubRouteState(state);
  assert.equal(route, '/docs/source/book/cron/report.pdf?org=org-beta');
  assert.deepEqual(parseDocHubRouteState('/docs/source/book/cron/report.pdf', '?org=org-beta'), state);
  assert.deepEqual(
    docHubRoute.resolveDocHubRouteSelection('/docs/source/book/cron/report.pdf', '?org=org-beta', true),
    state,
  );

  const relative = docHubRoute.resolveRelativeDocHubNavigation(
    '/docs/source/book/cron/report.pdf',
    '?org=org-beta',
    './next.pdf',
    true,
  );
  assert.equal(relative?.target.orgId, 'org-beta');
  assert.equal(relative?.route, '/docs/source/book/cron/next.pdf?org=org-beta');
});

test('preserves arbitrary trimmed organization IDs across Doc Hub route helpers', () => {
  for (const rawOrgId of [' Sales Org ', '组织/北']) {
    const orgId = rawOrgId.trim();
    const state = {
      sourceId: 'book',
      path: 'cron/report.pdf',
      orgId: rawOrgId,
      tool: 'convert' as const,
      convert: { outputType: 'markdown' as const, templateId: 'Default' },
    };
    const route = serializeDocHubRouteState(state);
    const routeUrl = new URL(route, 'https://entity.test');

    assert.equal(routeUrl.searchParams.get('org'), orgId);
    assert.deepEqual(parseDocHubRouteState(routeUrl.pathname, routeUrl.search), {
      ...state,
      orgId,
    });

    const relative = docHubRoute.resolveRelativeDocHubNavigation(
      routeUrl.pathname,
      routeUrl.search,
      './next.pdf',
      true,
    );
    assert.equal(relative?.target.orgId, orgId);
    assert.equal(new URL(relative!.route, 'https://entity.test').searchParams.get('org'), orgId);

    const paneRelative = docHubRoute.resolvePaneRelativeDocHubNavigation(
      routeUrl.pathname,
      routeUrl.search,
      { sourceId: state.sourceId, path: state.path, orgId: rawOrgId },
      './next.pdf',
      true,
    );
    assert.equal(new URL(paneRelative!.route, 'https://entity.test').searchParams.get('org'), orgId);

    const activated = docHubRoute.buildActivatedDocHubToolRoute(
      routeUrl.pathname,
      routeUrl.search,
      'share',
    );
    assert.equal(new URL(activated, 'https://entity.test').searchParams.get('org'), orgId);

    const canonical = docHubRoute.buildCanonicalDocHubUrl(state, 'https://entity.test');
    assert.equal(new URL(canonical).searchParams.get('org'), orgId);

    const selectedTool = docHubRoute.buildCanonicalSelectedDocHubToolUrl(
      { sourceId: state.sourceId, path: state.path, orgId: rawOrgId },
      routeUrl.pathname,
      routeUrl.search,
      'share',
      'https://entity.test',
    );
    assert.equal(new URL(selectedTool).searchParams.get('org'), orgId);

    const local = docHubRoute.buildCanonicalLocalDocHubUrl(
      '/workspace/uploads/Sales Org/guide.md',
      '/',
      '?tab=files',
      'https://entity.test',
      rawOrgId,
    );
    assert.equal(new URL(local).searchParams.get('org'), orgId);

    const transient = docHubRoute.buildTransientDocHubHistoryRoute(
      routeUrl.pathname,
      routeUrl.search,
      routeUrl.pathname,
      '?tool=share',
    );
    assert.equal(new URL(transient, 'https://entity.test').searchParams.get('org'), orgId);
  }

  const unscoped = serializeDocHubRouteState({ sourceId: 'book', path: 'cron/report.pdf', orgId: '   ' });
  assert.equal(new URL(unscoped, 'https://entity.test').searchParams.has('org'), false);
  assert.equal(parseDocHubRouteState('/docs/source/book/cron/report.pdf', '?org=+')?.orgId, undefined);
});

test('Doc Hub exits to the originating task when one was recorded', () => {
  assert.equal(buildDocHubExitPath(42), '/task/42');
  assert.equal(buildDocHubExitPath(null), '/');
  assert.equal(buildDocHubExitPath('42'), '/');
  assert.equal(buildDocHubExitPath(-1), '/');
});

test('legacy selected file URL preserves explicit organization when the file path changes', () => {
  const url = docHubRoute.buildCanonicalLocalDocHubUrl(
    '/workspace/uploads/org-beta/guide.md', '/', '?tab=files', 'https://entity.test', 'org-beta',
  );
  assert.equal(new URL(url).searchParams.get('org'), 'org-beta');
  assert.equal(docHubRoute.resolveDocHubRouteSelection('/', new URL(url).search, false)?.orgId, 'org-beta');
  assert.equal(docHubRoute.resolveDocHubRouteSelection('/', new URL(url).search, false)?.path, '/workspace/uploads/org-beta/guide.md');
  const cleared = docHubRoute.buildCanonicalLocalDocHubUrl(
    'guide.md', '/', '?file=old.md&org=org-alpha', 'https://entity.test', null,
  );
  assert.equal(new URL(cleared).searchParams.has('org'), false);
});

test('selected-source tool URL clears stale route organization when target scope is omitted', () => {
  const url = docHubRoute.buildCanonicalSelectedDocHubToolUrl(
    { sourceId: 'source-a', path: 'output/guide.md' },
    '/docs/source/source-a/output/guide.md',
    '?org=org-stale',
    'share',
    'https://entity.test',
  );

  assert.equal(new URL(url).searchParams.has('org'), false);
});

test('last-opened files never replace an authoritative task route on startup', () => {
  assert.equal(shouldRestoreLastDocHubFile('/'), true);
  assert.equal(shouldRestoreLastDocHubFile('/task/42'), false);
  assert.equal(shouldRestoreLastDocHubFile('/showclaw/entity-featured'), false);
  assert.equal(shouldRestoreLastDocHubFile('/', '?tab=tasks'), false);
  assert.equal(resolveDocHubRouteTarget('/', '?tab=tasks&file=old.md&source=book'), null);
});

test('workspace tab routes round-trip through browser history state', () => {
  assert.equal(resolveWorkspaceTabRoute('/', ''), 'files');
  assert.equal(resolveWorkspaceTabRoute('/', '?tab=agents'), 'agents');
  assert.equal(resolveWorkspaceTabRoute('/', '?tab=tasks'), 'tasks');
  assert.equal(resolveWorkspaceTabRoute('/task/42', '?tab=agents'), null);
});

test('workspace tab deep links resolve every supported tab including admin (QA-ADMIN-NAVIGATION)', () => {
  // The visible Admin control pushes /?tab=admin; the workspace shell must
  // resolve it to the admin tab on both click and cold reload/deep-link so the
  // existing AdminView renders instead of falling through to the default.
  assert.equal(resolveWorkspaceTabRoute('/', '?tab=admin'), 'admin');
  assert.equal(resolveWorkspaceTabRoute('/', '?tab=services'), 'services');
  assert.equal(resolveWorkspaceTabRoute('/', '?tab=chat'), 'chat');
  assert.equal(resolveWorkspaceTabRoute('/', '?tab=files'), 'files');
  // Unknown / missing tabs never return null on root — they default to files so
  // a stale or malformed link still renders a supported surface.
  assert.equal(resolveWorkspaceTabRoute('/', '?tab=bogus'), 'files');
  assert.equal(resolveWorkspaceTabRoute('/', '?tab='), 'files');
  // Non-root pathnames are not workspace-tab routes; the standalone /admin path
  // is intentionally classified as unsupported elsewhere (Page not found).
  assert.equal(resolveWorkspaceTabRoute('/admin', ''), null);
  assert.equal(resolveWorkspaceTabRoute('/admin', '?tab=admin'), null);
  assert.equal(resolveWorkspaceTabRoute('/tasks', ''), null);
  assert.equal(resolveWorkspaceTabRoute('/task/42', '?tab=admin'), null);
});

test('workspace tab deep links never restore a stale Doc Hub file for non-files tabs', () => {
  // Cold load of /?tab=admin must not pull a last-opened file back out of
  // localStorage, otherwise the shell would switch to the files/Doc Hub surface.
  assert.equal(shouldRestoreLastDocHubFile('/', '?tab=admin'), false);
  assert.equal(shouldRestoreLastDocHubFile('/', '?tab=services'), false);
  assert.equal(shouldRestoreLastDocHubFile('/', '?tab=chat'), false);
  assert.equal(shouldRestoreLastDocHubFile('/', '?tab=tasks'), false);
  assert.equal(shouldRestoreLastDocHubFile('/', '?tab=files'), true);
  assert.equal(resolveDocHubRouteTarget('/', '?tab=admin'), null);
  assert.equal(resolveDocHubRouteTarget('/', '?tab=admin&file=old.md&source=book'), null);
});
