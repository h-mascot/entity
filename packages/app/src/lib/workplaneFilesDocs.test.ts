import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import FilesDocsPanel from '../components/workplane/FilesDocsPanel.tsx';
import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import {
  buildFilesDocsOpener,
  countFilesDocsKinds,
  createWorkplaneFilesDocsLoadState,
  normalizeWorkplaneFilesDocs,
} from './workplaneFilesDocs.ts';
import { createWorkplaneProofBundleLoadState } from './workplaneProofBundle.ts';
import { createWorkplaneTaskSummaryLoadState } from './workplaneTaskSummary.ts';

const MIXED_TASK = {
  id: 865,
  name: 'Files/docs panel fixture',
  column: 'review',
  output: [
    'Doc: [/docs/workspace/docs/notes/plan.md](/docs/workspace/docs/notes/plan.md)',
    'Raw file: [/docs/output/entity/wp1-b-04/notes.md](/docs/output/entity/wp1-b-04/notes.md)',
    'Skip external output: [https://example.com/not-a-doc-hub-file](https://example.com/not-a-doc-hub-file)',
  ].join('\n'),
  metadata: {
    native_documents: [
      {
        id: 'native_plan',
        title: 'Plan note',
        object_type: 'native_document',
        path: '/docs/workspace/docs/notes/plan.md',
      },
    ],
    external_document_refs: [
      {
        id: 'ext_ref_1',
        title: 'Partner brief',
        object_type: 'external_document_ref',
        external_url: 'https://example.com/partner-brief',
      },
    ],
    curated_artifacts: [
      {
        id: 'curated_1',
        title: 'Curated rollup',
        artifact_kind: 'curated_report',
        stable_path: '/docs/workspace/docs/reports/rollup.md',
      },
    ],
    document_artifacts: [
      {
        id: 'restricted_1',
        title: 'Secret payroll',
        object_type: 'native_document',
        path: '/docs/workspace/private/payroll.md',
        restricted: true,
      },
    ],
  },
};

const EMPTY_TASK = {
  id: 866,
  name: 'No files yet',
  column: 'todo',
  output: '',
  metadata: {},
};

test('buildFilesDocsOpener prefers Doc Hub source routes', () => {
  const opener = buildFilesDocsOpener('/docs/workspace/docs/notes/plan.md');
  assert.equal(opener.kind, 'doc_hub');
  assert.equal(opener.href, '/docs/source/workspace/docs/notes/plan.md');
  assert.equal(opener.sourceId, 'workspace');
  assert.equal(opener.path, 'docs/notes/plan.md');

  const outputOpener = buildFilesDocsOpener('/docs/output/entity/wp1-b-04/notes.md');
  assert.equal(outputOpener.kind, 'doc_hub');
  assert.equal(outputOpener.href, '/docs/source/workspace/output/entity/wp1-b-04/notes.md');
  assert.equal(outputOpener.sourceId, 'workspace');
  assert.equal(outputOpener.path, 'output/entity/wp1-b-04/notes.md');
});

test('buildFilesDocsOpener handles external, restricted, and missing links', () => {
  assert.equal(buildFilesDocsOpener('https://example.com/doc').kind, 'external');
  assert.equal(buildFilesDocsOpener('https://example.com/doc').href, 'https://example.com/doc');

  const restricted = buildFilesDocsOpener('/docs/workspace/private/payroll.md', {
    restricted: true,
  });
  assert.equal(restricted.kind, 'unavailable');
  assert.equal(restricted.href, null);
  assert.match(restricted.reason ?? '', /Restricted/);

  const missing = buildFilesDocsOpener(null);
  assert.equal(missing.kind, 'unavailable');
  assert.match(missing.reason ?? '', /No openable/);
});

test('normalizeWorkplaneFilesDocs yields linked rows + Doc Hub openers', () => {
  const bundle = normalizeWorkplaneFilesDocs(MIXED_TASK);
  assert.equal(bundle.taskId, 865);
  assert.equal(bundle.empty, false);
  assert.ok(bundle.items.length >= 3);

  const counts = countFilesDocsKinds(bundle);
  assert.ok(counts.native >= 1);
  assert.ok(counts.external >= 1);
  assert.ok(counts.curated >= 1);
  assert.ok(counts.file >= 1);

  const docHub = bundle.items.find((item) => item.opener.kind === 'doc_hub');
  assert.ok(docHub);
  assert.match(docHub!.opener.href ?? '', /^\/docs\/source\/workspace\//);

  const external = bundle.items.find((item) => item.kind === 'external');
  assert.ok(external);
  assert.equal(external!.opener.kind, 'external');
  assert.equal(external!.opener.href, 'https://example.com/partner-brief');

  const restricted = bundle.items.find((item) => item.restricted);
  assert.ok(restricted);
  assert.equal(restricted!.opener.kind, 'unavailable');
  assert.equal(restricted!.title, 'Restricted object');
});

test('normalizeWorkplaneFilesDocs empty/malformed fail closed', () => {
  const empty = normalizeWorkplaneFilesDocs(EMPTY_TASK);
  assert.equal(empty.taskId, 866);
  assert.equal(empty.empty, true);
  assert.equal(empty.items.length, 0);

  const malformed = normalizeWorkplaneFilesDocs({ name: 'no-id', metadata: { native_documents: [{}] } });
  assert.equal(malformed.taskId, null);
  assert.equal(malformed.empty, true);

  const nullish = normalizeWorkplaneFilesDocs(null);
  assert.equal(nullish.taskId, null);
  assert.equal(nullish.empty, true);
});

test('createWorkplaneFilesDocsLoadState covers empty/loading/error/ready', () => {
  assert.equal(
    createWorkplaneFilesDocsLoadState({ status: 'loading', taskId: 865 }).status,
    'loading',
  );
  assert.equal(createWorkplaneFilesDocsLoadState({ status: 'empty' }).status, 'empty');
  assert.equal(
    createWorkplaneFilesDocsLoadState({ status: 'error', errorMessage: 'boom' }).errorMessage,
    'boom',
  );
  const ready = createWorkplaneFilesDocsLoadState({
    status: 'ready',
    bundle: normalizeWorkplaneFilesDocs(MIXED_TASK),
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.bundle?.taskId, 865);
  assert.equal(ready.bundle?.empty, false);
});

test('FilesDocsPanel renders loading/empty/error/ready and opener hrefs', () => {
  const loading = renderToStaticMarkup(
    createElement(FilesDocsPanel, {
      loadState: createWorkplaneFilesDocsLoadState({ status: 'loading', taskId: 865 }),
    }),
  );
  assert.match(loading, /data-testid="workplane-files-docs"/);
  assert.match(loading, /data-files-docs-status="loading"/);
  assert.match(loading, /data-testid="workplane-files-docs-loading"/);

  const empty = renderToStaticMarkup(
    createElement(FilesDocsPanel, {
      loadState: createWorkplaneFilesDocsLoadState({ status: 'empty', taskId: null }),
    }),
  );
  assert.match(empty, /data-files-docs-status="empty"/);
  assert.match(empty, /No files or docs available/);

  const error = renderToStaticMarkup(
    createElement(FilesDocsPanel, {
      loadState: createWorkplaneFilesDocsLoadState({
        status: 'error',
        taskId: 865,
        errorMessage: 'upstream failed',
      }),
      onRetry: () => undefined,
    }),
  );
  assert.match(error, /data-files-docs-status="error"/);
  assert.match(error, /upstream failed/);
  assert.match(error, /data-testid="workplane-files-docs-retry"/);

  const ready = renderToStaticMarkup(
    createElement(FilesDocsPanel, {
      loadState: createWorkplaneFilesDocsLoadState({
        status: 'ready',
        bundle: normalizeWorkplaneFilesDocs(MIXED_TASK),
      }),
    }),
  );
  assert.match(ready, /data-testid="workplane-files-docs-ready"/);
  assert.match(ready, /data-testid="workplane-files-docs-opener"/);
  assert.match(ready, /data-opener-kind="doc_hub"/);
  assert.match(ready, /data-opener-href="\/docs\/source\/workspace\//);
  assert.match(ready, /data-opener-kind="external"/);
  assert.match(ready, /data-files-docs-restricted="true"/);
  assert.match(ready, /data-testid="workplane-files-docs-opener-unavailable"/);

  const readyEmpty = renderToStaticMarkup(
    createElement(FilesDocsPanel, {
      loadState: createWorkplaneFilesDocsLoadState({
        status: 'ready',
        bundle: normalizeWorkplaneFilesDocs(EMPTY_TASK),
      }),
    }),
  );
  assert.match(readyEmpty, /data-files-docs-empty="true"/);
  assert.match(readyEmpty, /No linked files or docs/);
});

test('WorkplaneShell renders FilesDocsPanel for files_docs panel', () => {
  const bundle = normalizeWorkplaneFilesDocs(MIXED_TASK);
  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/865',
      search: '?panel=files_docs',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 865 }),
      proofBundleState: createWorkplaneProofBundleLoadState({ status: 'empty', taskId: 865 }),
      filesDocsState: createWorkplaneFilesDocsLoadState({ status: 'ready', bundle }),
    }),
  );
  assert.match(html, /data-workplane-active-panel="files_docs"/);
  assert.match(html, /data-testid="workplane-files-docs-ready"/);
  assert.match(html, /data-opener-kind="doc_hub"/);
  assert.match(html, /data-workplane-files-docs-status="ready"/);
  assert.doesNotMatch(html, /Placeholder — full panel ships/);

  const other = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/865',
      search: '?panel=activity_progress',
      taskSummaryState: createWorkplaneTaskSummaryLoadState({ status: 'empty', taskId: 865 }),
      proofBundleState: createWorkplaneProofBundleLoadState({ status: 'empty', taskId: 865 }),
      filesDocsState: createWorkplaneFilesDocsLoadState({ status: 'ready', bundle }),
    }),
  );
  assert.match(other, /Placeholder — full panel ships/);
  assert.doesNotMatch(other, /data-testid="workplane-files-docs-ready"/);
});
