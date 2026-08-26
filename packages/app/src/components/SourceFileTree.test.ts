import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { FileSource } from '../types/filesystem.ts';

const baseSource = {
  id: 'source-1',
  baseUrl: null,
  basePath: null,
  authType: 'none' as const,
  authRef: null,
  enabled: true,
  icon: null,
  capabilities: '{}',
  health: 'ok' as const,
  lastSyncedAt: null,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
};

// `implemented` is typed onto FileSource as part of this issue; cast keeps the
// RED test compiling before the production type lands.
const githubSource = {
  ...baseSource,
  displayName: 'GitHub upstream',
  type: 'github',
  implemented: false,
} as unknown as FileSource;

const localSource: FileSource = {
  ...baseSource,
  id: 'source-2',
  displayName: 'Workspace docs',
  type: 'local',
};

type HeaderProps = {
  source: FileSource;
  expanded: boolean;
  unavailable: boolean;
  pinnedCount: number;
  onToggle: (sourceId: string) => void;
};

async function loadHeader(): Promise<(props: HeaderProps) => React.ReactElement> {
  const mod = (await import('./SourceFileTree.tsx')) as unknown as {
    SourceTreeSourceHeader?: (props: HeaderProps) => React.ReactElement;
  };
  assert.ok(
    mod.SourceTreeSourceHeader,
    'SourceFileTree must export SourceTreeSourceHeader so unavailable rows are visibly not expandable'
  );
  return mod.SourceTreeSourceHeader;
}

function optionTag(markup: string, value: string): string {
  const match = markup.match(new RegExp(`<option[^>]*value="${value}"[^>]*>`));
  assert.ok(match, `expected an <option value="${value}"> in the Add Source form`);
  return match[0];
}

function optionLabel(markup: string, value: string): string {
  const match = markup.match(new RegExp(`<option[^>]*value="${value}"[^>]*>([^<]*)</option>`));
  assert.ok(match, `expected a label for the ${value} option`);
  return match[1];
}

test('unavailable sources render a visible Not available in this build notice and cannot be expanded', async () => {
  const Header = await loadHeader();
  const markup = renderToStaticMarkup(
    React.createElement(Header, {
      source: githubSource,
      expanded: false,
      unavailable: true,
      pinnedCount: 0,
      onToggle: () => {},
    })
  );

  assert.ok(
    markup.includes('Not available in this build'),
    `expected the unavailability notice in the source header, got: ${markup}`
  );
  const buttonTag = markup.match(/<button[^>]*>/)?.[0] ?? '';
  assert.ok(
    /\bdisabled\b/.test(buttonTag),
    `expected the unavailable source header button to be disabled, got: ${buttonTag}`
  );

  // Even if stale expansion state names the source, the header must not claim
  // an expanded state the unavailable connector cannot honor.
  const expandedMarkup = renderToStaticMarkup(
    React.createElement(Header, {
      source: githubSource,
      expanded: true,
      unavailable: true,
      pinnedCount: 0,
      onToggle: () => {},
    })
  );
  assert.ok(
    !expandedMarkup.includes('▾'),
    `unavailable source header must not render an expanded caret, got: ${expandedMarkup}`
  );
});

test('available sources stay expandable without an unavailability notice', async () => {
  const Header = await loadHeader();
  const markup = renderToStaticMarkup(
    React.createElement(Header, {
      source: localSource,
      expanded: false,
      unavailable: false,
      pinnedCount: 0,
      onToggle: () => {},
    })
  );

  assert.ok(!markup.includes('Not available in this build'));
  const buttonTag = markup.match(/<button[^>]*>/)?.[0] ?? '';
  assert.ok(!/\bdisabled\b/.test(buttonTag), `available source header must not be disabled: ${buttonTag}`);
});

test('Add Source labels unsupported connector types as coming soon and keeps them unselectable', async () => {
  const { default: FileSourcesSettings } = await import('./settings/FileSourcesSettings.tsx');
  const markup = renderToStaticMarkup(React.createElement(FileSourcesSettings));

  for (const type of ['github', 's3', 'custom']) {
    const tag = optionTag(markup, type);
    assert.ok(
      /\bdisabled\b/.test(tag),
      `expected the ${type} option to be disabled in Add Source, got: ${tag}`
    );
    assert.match(
      optionLabel(markup, type),
      /coming soon/i,
      `expected the ${type} option label to say coming soon`
    );
  }

  for (const type of ['local', 'docsify', 'http-markdown']) {
    const tag = optionTag(markup, type);
    assert.ok(!/\bdisabled\b/.test(tag), `the supported ${type} option must stay selectable: ${tag}`);
  }
});
