import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDocHubExitPath,
  buildDocHubRoutePath,
  resolveDocHubRouteTarget,
  resolveWorkspaceTabRoute,
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

test('Doc Hub exits to the originating task when one was recorded', () => {
  assert.equal(buildDocHubExitPath(42), '/task/42');
  assert.equal(buildDocHubExitPath(null), '/');
  assert.equal(buildDocHubExitPath('42'), '/');
  assert.equal(buildDocHubExitPath(-1), '/');
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
