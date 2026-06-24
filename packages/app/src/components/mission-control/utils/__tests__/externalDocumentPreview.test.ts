import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExternalDocumentPreviewView } from '../externalDocumentPreview.ts';

test('builds a read-only Google Docs link and preview view', () => {
  const view = buildExternalDocumentPreviewView({
    connector_type: 'google_docs',
    external_canonical_url: 'https://docs.google.com/document/d/doc-83',
    title: 'Board Account Plan',
    external_mime_type: 'application/vnd.google-apps.document',
    auth_state: 'authorized',
    readiness_state: 'ready',
    granted_scopes: ['read', 'index', 'link', 'preview'],
    metadata: {
      snippet: 'Q3 expansion plan preview',
      external_permission_summary: 'Visible to linked workspace users',
    },
  });

  assert.equal(view?.ownershipLabel, 'Externally owned Google Docs/Drive document');
  assert.equal(view?.openUrl, 'https://docs.google.com/document/d/doc-83');
  assert.equal(view?.canOpen, true);
  assert.equal(view?.previewAvailable, true);
  assert.equal(view?.previewText, 'Q3 expansion plan preview');
  assert.equal(view?.authLabel, 'authorized');
  assert.equal(view?.readinessLabel, 'ready');
  assert.equal(view?.mutationControlsVisible, false);
  assert.match(view?.readOnlyMessage ?? '', /does not edit, export, sync, or write/);
});

test('shows expired Google auth as degraded while keeping the link-out', () => {
  const view = buildExternalDocumentPreviewView({
    connector_type: 'google_drive',
    external_url: 'https://drive.google.com/file/d/drive-83/view',
    title: 'Expired Drive Brief',
    auth_state: 'authorized',
    readiness_state: 'ready',
    auth_expires_at: '2000-01-01T00:00:00Z',
    granted_scopes: ['read', 'index', 'link', 'preview'],
    metadata: { snippet: 'Should be hidden because auth is expired' },
  }, new Date('2026-06-24T09:35:00Z'));

  assert.equal(view?.canOpen, true);
  assert.equal(view?.openUrl, 'https://drive.google.com/file/d/drive-83/view');
  assert.equal(view?.degraded, true);
  assert.equal(view?.authLabel, 'expired');
  assert.equal(view?.readinessLabel, 'degraded');
  assert.equal(view?.previewAvailable, false);
  assert.equal(view?.previewText, null);
  assert.ok(view?.degradedMessages.some((message) => message.includes('auth is expired')));
});

test('shows insufficient preview scope as degraded', () => {
  const view = buildExternalDocumentPreviewView({
    connector_type: 'google_docs',
    external_canonical_url: 'https://docs.google.com/document/d/insufficient-83',
    title: 'Insufficient Scope Doc',
    auth_state: 'insufficient_scope',
    readiness_state: 'ready',
    granted_scopes: ['read', 'link'],
    missing_scopes: ['index', 'preview'],
    metadata: { snippet: 'Should be hidden because preview scope is missing' },
  });

  assert.equal(view?.degraded, true);
  assert.equal(view?.previewAvailable, false);
  assert.equal(view?.previewText, null);
  assert.equal(view?.scopeLabel, 'Missing index, preview');
  assert.ok(view?.degradedMessages.some((message) => message.includes('missing index, preview')));
});

test('never surfaces Google mutation controls from preview metadata', () => {
  const view = buildExternalDocumentPreviewView({
    connector_type: 'google_docs',
    external_url: 'https://docs.google.com/document/d/no-mutation-83/edit',
    title: 'No Mutation Doc',
    auth_state: 'authorized',
    readiness_state: 'ready',
    metadata: {
      snippet: 'Read-only context',
      capabilities: {
        read: true,
        link: true,
        preview: true,
        create: true,
        update: true,
        write: true,
        export: true,
        sync: true,
      },
    },
  });

  assert.equal(view?.previewAvailable, true);
  assert.equal(view?.mutationControlsVisible, false);
  assert.match(view?.readOnlyMessage ?? '', /Read-only preview only/);
});
