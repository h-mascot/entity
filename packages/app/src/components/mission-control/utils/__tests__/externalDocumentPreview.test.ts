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

test('suppresses preview text and link-out when Entity preview policy is restricted', () => {
  const view = buildExternalDocumentPreviewView({
    connector_type: 'google_docs',
    external_canonical_url: 'https://docs.google.com/document/d/restricted-84',
    title: 'Sensitive account plan',
    auth_state: 'authorized',
    readiness_state: 'ready',
    granted_scopes: ['read', 'index', 'link', 'preview'],
    entity_visibility_policy_json: JSON.stringify({ allow_preview: false }),
    metadata: {
      snippet: 'Do not leak this restricted snippet',
      preview_text: 'Do not leak this preview text',
      external_permission_summary: 'Google says the connector can read it',
    },
  });

  assert.equal(view?.title, 'Restricted external document');
  assert.equal(view?.canOpen, false);
  assert.equal(view?.openUrl, null);
  assert.equal(view?.previewAvailable, false);
  assert.equal(view?.previewText, null);
  assert.equal(view?.externalPermissionSummary, null);
  assert.equal(view?.degraded, true);
  assert.deepEqual(view?.degradedMessages, ['Restricted by Entity permissions. Snippets and previews are hidden.']);
});

test('shows deleted or permission-revoked external refs as degraded without preview/open controls', () => {
  const view = buildExternalDocumentPreviewView({
    connector_type: 'google_drive',
    external_url: 'https://drive.google.com/file/d/deleted-84/view',
    title: 'Deleted Drive item',
    auth_state: 'revoked',
    readiness_state: 'degraded',
    granted_scopes: ['read', 'index', 'link', 'preview'],
    external_ref_state: 'deleted',
    metadata: {
      snippet: 'Do not show deleted external content',
      degraded_reasons: ['external_ref_deleted'],
    },
  });

  assert.equal(view?.degraded, true);
  assert.equal(view?.canOpen, false);
  assert.equal(view?.openUrl, null);
  assert.equal(view?.previewAvailable, false);
  assert.equal(view?.previewText, null);
  assert.ok(view?.degradedMessages.some((message) => message.includes('External document state is deleted')));
});

// --- T-018 (THE-959) — R-009 preview/open/permissions honesty ---

test('R-009.1: preview failure does not remove the provider open action', () => {
  const view = buildExternalDocumentPreviewView({
    connector_type: 'google_docs',
    external_canonical_url: 'https://docs.google.com/document/d/preview-fail-85',
    title: 'Preview Failure Doc',
    auth_state: 'authorized',
    readiness_state: 'ready',
    granted_scopes: ['read', 'index', 'link', 'preview'],
    metadata: {
      // No snippet, no preview text: preview fails structurally.
      capabilities: { read: true, link: true, preview: false },
    },
  });

  assert.equal(view?.previewAvailable, false);
  assert.equal(view?.previewText, null);
  // Structural assertion: the provider open affordance survives the preview failure.
  assert.equal(view?.canOpen, true);
  assert.equal(view?.openUrl, 'https://docs.google.com/document/d/preview-fail-85');
  assert.equal(view?.editUrl, 'https://docs.google.com/document/d/preview-fail-85');
  assert.equal(view?.editLabel, 'Edit in Google');
});

test('R-009.2: the edit action resolves the provider-evidenced artifact URL', () => {
  const view = buildExternalDocumentPreviewView({
    connector_type: 'google_docs',
    external_canonical_url: 'https://docs.google.com/document/d/edit-target-86',
    title: 'Edit Target Doc',
    auth_state: 'authorized',
    readiness_state: 'ready',
    granted_scopes: ['read', 'index', 'link', 'preview'],
    metadata: { snippet: 'context only' },
  });

  assert.equal(view?.editLabel, 'Edit in Google');
  assert.equal(view?.editUrl, 'https://docs.google.com/document/d/edit-target-86');
});

test('R-009.3: preview is never labeled as an Entity-native editor', () => {
  const view = buildExternalDocumentPreviewView({
    connector_type: 'google_docs',
    external_canonical_url: 'https://docs.google.com/document/d/native-87',
    title: 'Native Label Doc',
    auth_state: 'authorized',
    readiness_state: 'ready',
    metadata: { snippet: 'snippet' },
  });

  assert.equal(view?.previewIsNativeEditor, false);
  assert.match(view?.previewLabel ?? '', /not an Entity-native editor/i);
  assert.equal(view?.mutationControlsVisible, false);
});

test('§9.3: permission summaries outside the derivable vocabulary collapse to Unknown', () => {
  const view = buildExternalDocumentPreviewView({
    connector_type: 'google_docs',
    external_canonical_url: 'https://docs.google.com/document/d/perm-88',
    title: 'Opaque Permissions Doc',
    auth_state: 'authorized',
    readiness_state: 'ready',
    metadata: {
      snippet: 'context',
      external_permission_summary: 'Visible to linked workspace users',
    },
  });

  assert.equal(view?.externalPermissionSummary, null);
  assert.equal(view?.externalPermissionSummaryKnown, false);
});

test('§9.3: provider sharing evidence maps into the allowed vocabulary and never downgrades external sharing', () => {
  const linkShared = buildExternalDocumentPreviewView({
    connector_type: 'google_docs',
    external_canonical_url: 'https://docs.google.com/document/d/perm-89',
    auth_state: 'authorized',
    readiness_state: 'ready',
    metadata: { snippet: 'context', visibility: 'anyone_with_link' },
  });
  assert.equal(linkShared?.externalPermissionSummary, 'Link-shared');
  assert.equal(linkShared?.externalPermissionSummaryKnown, true);

  const external = buildExternalDocumentPreviewView({
    connector_type: 'google_docs',
    external_canonical_url: 'https://docs.google.com/document/d/perm-90',
    auth_state: 'authorized',
    readiness_state: 'ready',
    metadata: {
      snippet: 'context',
      visibility: 'domain',
      sharing_state: 'external_sharing_detected',
    },
  });
  assert.equal(external?.externalPermissionSummary, 'External sharing detected');
});

test('§9.4: Entity-integration-policy read-only messaging never blames the provider', () => {
  const view = buildExternalDocumentPreviewView({
    connector_type: 'google_docs',
    external_canonical_url: 'https://docs.google.com/document/d/policy-91',
    title: 'Entity Policy Doc',
    auth_state: 'authorized',
    readiness_state: 'ready',
    metadata: { snippet: 'context' },
  });

  assert.equal(view?.writeDisabledSource, 'entity-integration-policy');
  assert.match(view?.writeDisabledMessage ?? '', /Entity/i);
  assert.doesNotMatch(view?.writeDisabledMessage ?? '', /google .*read-only/i);
});

test('§9.4: genuine provider write-protection evidence is attributed to the provider', () => {
  const view = buildExternalDocumentPreviewView({
    connector_type: 'google_docs',
    external_canonical_url: 'https://docs.google.com/document/d/provider-ro-92',
    title: 'Provider Read-Only Doc',
    auth_state: 'authorized',
    readiness_state: 'ready',
    metadata: { snippet: 'context', provider_write_protected: true },
  });

  assert.equal(view?.writeDisabledSource, 'provider');
  assert.match(view?.writeDisabledMessage ?? '', /Google/i);
});
