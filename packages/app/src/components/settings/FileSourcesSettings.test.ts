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

interface TestFormState {
  displayName: string;
  type: FileSource['type'];
  baseUrl: string;
  basePath: string;
  manifestPath: string;
  authType: FileSource['authType'];
  authRef: string;
  icon: string;
}

interface TestCreatePayload {
  displayName: string;
  type: FileSource['type'];
  baseUrl?: string;
  basePath?: string;
  manifestPath?: string;
  authType: FileSource['authType'];
  authRef?: string;
  icon?: string;
}

async function loadSettingsPolicy() {
  const mod = (await import('./FileSourcesSettings.tsx')) as unknown as {
    buildSourceCreatePayload?: (form: TestFormState) => TestCreatePayload;
    withSourceTypeSwitched?: (form: TestFormState, type: FileSource['type']) => TestFormState;
  };
  assert.ok(
    mod.buildSourceCreatePayload,
    'FileSourcesSettings must export buildSourceCreatePayload so the create payload policy is testable'
  );
  assert.ok(
    mod.withSourceTypeSwitched,
    'FileSourcesSettings must export withSourceTypeSwitched so the type-switch policy is testable'
  );
  return {
    buildSourceCreatePayload: mod.buildSourceCreatePayload,
    withSourceTypeSwitched: mod.withSourceTypeSwitched,
  };
}

const FORM_WITH_STALE_LOCAL_PATH: TestFormState = {
  displayName: 'Docs',
  type: 'github',
  // The operator first picked local and typed a path, then switched type —
  // the hidden field's value must never reach the server for remote types.
  basePath: '/stale/local/path',
  baseUrl: 'https://github.com/acme/widget',
  manifestPath: '',
  authType: 'bearer',
  authRef: 'env:GITHUB_TOKEN',
  icon: '⚡',
};

test('create payload sends only the location field the selected source type uses', async () => {
  const { buildSourceCreatePayload } = await loadSettingsPolicy();

  const remote = buildSourceCreatePayload(FORM_WITH_STALE_LOCAL_PATH);
  assert.equal(remote.basePath, undefined, 'a remote source must not persist the leftover basePath');
  assert.equal(remote.baseUrl, 'https://github.com/acme/widget');

  const local = buildSourceCreatePayload({
    ...FORM_WITH_STALE_LOCAL_PATH,
    type: 'local',
    basePath: '/workspace/docs',
    baseUrl: 'https://stale.example/',
  });
  assert.equal(local.basePath, '/workspace/docs');
  assert.equal(local.baseUrl, undefined, 'a local source must not persist the leftover baseUrl');
});

test('create payload keeps manifest and auth semantics while gating fields by type', async () => {
  const { buildSourceCreatePayload } = await loadSettingsPolicy();

  const manifestBacked = buildSourceCreatePayload({
    ...FORM_WITH_STALE_LOCAL_PATH,
    type: 'http-markdown',
    manifestPath: 'manifest.json',
  });
  assert.equal(manifestBacked.manifestPath, 'manifest.json');

  const notManifestBacked = buildSourceCreatePayload({
    ...FORM_WITH_STALE_LOCAL_PATH,
    manifestPath: 'manifest.json',
  });
  assert.equal(notManifestBacked.type, 'github');
  assert.equal(notManifestBacked.manifestPath, undefined, 'manifestPath belongs to http-markdown only');

  assert.equal(manifestBacked.authRef, 'env:GITHUB_TOKEN');
  const noAuth = buildSourceCreatePayload({ ...FORM_WITH_STALE_LOCAL_PATH, authType: 'none' });
  assert.equal(noAuth.authRef, undefined);
  assert.equal(noAuth.displayName, 'Docs');
});

test('switching source type clears the location field the next type does not use', async () => {
  const { withSourceTypeSwitched } = await loadSettingsPolicy();

  const toLocal = withSourceTypeSwitched(FORM_WITH_STALE_LOCAL_PATH, 'local');
  assert.equal(toLocal.type, 'local');
  assert.equal(toLocal.baseUrl, '', 'switching to local clears the remote URL field');
  assert.equal(toLocal.basePath, '/stale/local/path');

  const backToRemote = withSourceTypeSwitched(toLocal, 'github');
  assert.equal(backToRemote.type, 'github');
  assert.equal(backToRemote.basePath, '', 'switching away from local clears the base path field');
  assert.equal(backToRemote.baseUrl, '');
  assert.equal(backToRemote.displayName, 'Docs');
});

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
