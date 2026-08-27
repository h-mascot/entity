import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { FileSource } from '../../types/filesystem.ts';

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

const localSource: FileSource = {
  ...baseSource,
  displayName: 'Workspace docs',
  type: 'local',
};

const githubSource = {
  ...baseSource,
  displayName: 'GitHub upstream',
  type: 'github',
} as unknown as FileSource;

const s3Source = {
  ...baseSource,
  displayName: 'S3 archive',
  type: 's3',
  implemented: false,
} as unknown as FileSource;

interface SyncButtonProps {
  source: Pick<FileSource, 'enabled' | 'type' | 'implemented'>;
  busy: boolean;
  onSync: () => void;
}

async function loadSyncButton(): Promise<(props: SyncButtonProps) => React.ReactElement> {
  const mod = (await import('./FileSourcesSettings.tsx')) as unknown as {
    SourceSyncButton?: (props: SyncButtonProps) => React.ReactElement;
  };
  assert.ok(
    mod.SourceSyncButton,
    'FileSourcesSettings must export SourceSyncButton so Admin Sync truthfulness is testable'
  );
  return mod.SourceSyncButton;
}

function buttonTag(markup: string): string {
  return markup.match(/<button[^>]*>/)?.[0] ?? '';
}

test('Sync now is disabled for enabled sources whose connector is unimplemented', async () => {
  const SyncButton = await loadSyncButton();

  for (const source of [githubSource, s3Source]) {
    const markup = renderToStaticMarkup(
      React.createElement(SyncButton, { source, busy: false, onSync: () => {} })
    );
    const tag = buttonTag(markup);
    assert.ok(
      /\bdisabled\b/.test(tag),
      `Sync now must be disabled for the enabled ${source.type} source, got: ${tag}`
    );
    assert.ok(
      markup.includes('Sync now'),
      `expected the Sync now label to stay visible for ${source.type}, got: ${markup}`
    );
  }
});

test('Sync now stays actionable for supported connectors', async () => {
  const SyncButton = await loadSyncButton();

  const markup = renderToStaticMarkup(
    React.createElement(SyncButton, { source: localSource, busy: false, onSync: () => {} })
  );
  const tag = buttonTag(markup);
  assert.ok(!/\bdisabled\b/.test(tag), `supported local source must stay syncable, got: ${tag}`);
});

test('Sync now stays disabled while busy or when the source itself is disabled', async () => {
  const SyncButton = await loadSyncButton();

  const busyMarkup = renderToStaticMarkup(
    React.createElement(SyncButton, { source: localSource, busy: true, onSync: () => {} })
  );
  assert.ok(/\bdisabled\b/.test(buttonTag(busyMarkup)), 'busy supported source must stay disabled');

  const disabledMarkup = renderToStaticMarkup(
    React.createElement(SyncButton, {
      source: { ...localSource, enabled: false },
      busy: false,
      onSync: () => {},
    })
  );
  assert.ok(/\bdisabled\b/.test(buttonTag(disabledMarkup)), 'disabled supported source must stay disabled');
});
