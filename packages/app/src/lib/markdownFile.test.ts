import test from 'node:test';
import assert from 'node:assert/strict';

import * as markdownFile from './markdownFile.ts';
import { shouldRenderMarkdownPreview } from './markdownFile.ts';

test('HTML paths use the HTML viewer when a remote source reports markdown content', () => {
  assert.equal(shouldRenderMarkdownPreview('output/onboarding.html', 'text/markdown'), false);
  assert.equal(shouldRenderMarkdownPreview('output/onboarding.xhtml', 'text/markdown'), false);
});

test('Markdown paths and extensionless markdown content still use the reading view', () => {
  assert.equal(shouldRenderMarkdownPreview('notes/readme.md', 'text/plain'), true);
  assert.equal(shouldRenderMarkdownPreview('notes/readme', 'text/markdown'), true);
});

test('Markdown docs navigation candidates include ordinary relative document references', () => {
  const resolveMarkdownDocsLinkCandidate = (
    markdownFile as typeof markdownFile & {
      resolveMarkdownDocsLinkCandidate: (href: string) => string | null;
    }
  ).resolveMarkdownDocsLinkCandidate;

  assert.equal(typeof resolveMarkdownDocsLinkCandidate, 'function');
  for (const href of [
    './next.md',
    '../next.md',
    './Daily%20Brief.md?tool=comments',
    '/docs/source/book/memory/next.md',
  ]) {
    assert.equal(
      resolveMarkdownDocsLinkCandidate(href),
      href,
      `${href} must be eligible for onDocsLinkNavigate`,
    );
  }
});

test('Markdown docs navigation candidates exclude anchors and non-Doc-Hub destinations', () => {
  const resolveMarkdownDocsLinkCandidate = (
    markdownFile as typeof markdownFile & {
      resolveMarkdownDocsLinkCandidate: (href: string) => string | null;
    }
  ).resolveMarkdownDocsLinkCandidate;

  assert.equal(typeof resolveMarkdownDocsLinkCandidate, 'function');
  for (const href of [
    'mailto:henry@example.com',
    'javascript:alert(1)',
    'https://example.com/next.md',
    '//example.com/next.md',
  ]) {
    assert.equal(
      resolveMarkdownDocsLinkCandidate(href),
      null,
      `${href} must retain normal non-Doc-Hub link behavior`,
    );
  }
});

test('fragment-only Markdown links retain Doc Hub document context', () => {
  assert.equal(
    markdownFile.resolveMarkdownDocsLinkCandidate(
      '#install',
      { hasDocumentBase: true },
    ),
    '#install',
    'Doc Hub must classify a same-document fragment so route resolution can preserve the selected document',
  );
  assert.equal(
    markdownFile.resolveMarkdownDocsLinkCandidate(
      '#install',
      { hasDocumentBase: false },
    ),
    null,
    'a fragment without a Doc Hub document base must retain native handling',
  );
});

test('Markdown docs links intercept only an unmodified primary click', () => {
  type MarkdownClick = {
    button: number;
    defaultPrevented: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  };
  const shouldInterceptMarkdownDocsClick = (
    markdownFile as typeof markdownFile & {
      shouldInterceptMarkdownDocsClick: (event: MarkdownClick) => boolean;
    }
  ).shouldInterceptMarkdownDocsClick;
  const primaryClick: MarkdownClick = {
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  assert.equal(typeof shouldInterceptMarkdownDocsClick, 'function');
  assert.equal(shouldInterceptMarkdownDocsClick(primaryClick), true);
  for (const modifiedClick of [
    { ...primaryClick, metaKey: true },
    { ...primaryClick, ctrlKey: true },
    { ...primaryClick, shiftKey: true },
    { ...primaryClick, altKey: true },
    { ...primaryClick, button: 1 },
    { ...primaryClick, button: 2 },
    { ...primaryClick, defaultPrevented: true },
  ]) {
    assert.equal(shouldInterceptMarkdownDocsClick(modifiedClick), false);
  }
});

test('relative Markdown links require an active Doc Hub document base', () => {
  const resolveMarkdownDocsLinkCandidate = (
    markdownFile.resolveMarkdownDocsLinkCandidate as (
      href: string,
      context: { hasDocumentBase: boolean },
    ) => string | null
  );

  assert.equal(
    resolveMarkdownDocsLinkCandidate('./follow-up.md', { hasDocumentBase: false }),
    null,
    'task-output and other non-Doc-Hub surfaces must retain native relative-link handling',
  );
  assert.equal(
    resolveMarkdownDocsLinkCandidate('./follow-up.md', { hasDocumentBase: true }),
    './follow-up.md',
  );
});

test('duplicate Markdown headings receive unique deterministic IDs', () => {
  const createMarkdownHeadingIdFactory = (
    markdownFile as typeof markdownFile & {
      createMarkdownHeadingIdFactory: () => (headingText: string) => string;
    }
  ).createMarkdownHeadingIdFactory;

  assert.equal(typeof createMarkdownHeadingIdFactory, 'function');
  const headingId = createMarkdownHeadingIdFactory();

  assert.deepEqual(
    ['Overview', 'Overview', 'Installation', 'Overview'].map(headingId),
    ['overview', 'overview-1', 'installation', 'overview-2'],
  );

  const collidingHeadingId = createMarkdownHeadingIdFactory();
  assert.deepEqual(
    ['Overview', 'Overview', 'Overview 1', 'Overview'].map(collidingHeadingId),
    ['overview', 'overview-1', 'overview-1-1', 'overview-2'],
    'generated suffixes must not collide with a naturally suffixed heading',
  );
});

test('authored Markdown heading IDs are preserved and reserve their collision slot', () => {
  const headingId = (
    markdownFile.createMarkdownHeadingIdFactory() as (
      headingText: string,
      existingId?: string,
    ) => string
  );

  assert.equal(
    headingId('Setup guide', 'installation'),
    'installation',
    'raw HTML heading IDs are authored link targets and must not be overwritten',
  );
  assert.equal(
    headingId('Installation'),
    'installation-1',
    'a generated ID must avoid a previously authored ID',
  );
  assert.equal(
    headingId('Installation'),
    'installation-2',
    'subsequent generated IDs must continue deterministic collision allocation',
  );
});
