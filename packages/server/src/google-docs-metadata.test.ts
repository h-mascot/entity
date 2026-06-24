import { describe, expect, it } from 'vitest';
import type { ExternalDocumentRefRecord } from '../../db/src';
import * as googleDocsMetadata from './google-docs-metadata';
import {
  buildGoogleExternalDocumentMetadata,
  buildGoogleExternalDocumentOpen,
} from './google-docs-metadata';

const mutationCapabilities = ['create', 'update', 'write', 'export', 'sync'] as const;

function googleRef(overrides: Partial<ExternalDocumentRefRecord> = {}): ExternalDocumentRefRecord {
  return {
    id: 'google-doc-1',
    org_id: 'org-1',
    connector_type: 'google_docs',
    external_id: 'doc-1',
    external_url: 'https://docs.google.com/document/d/doc-1/edit',
    title: 'Read-only account plan',
    external_mime_type: 'application/vnd.google-apps.document',
    external_canonical_url: 'https://docs.google.com/document/d/doc-1',
    auth_state: 'authorized',
    readiness_state: 'ready',
    granted_scopes: ['read', 'index', 'link', 'preview'],
    missing_scopes: [],
    auth_expires_at: null,
    external_ref_state: 'available',
    capabilities_json: JSON.stringify({
      read: true,
      index: true,
      link: true,
      preview: true,
      create: true,
      update: true,
      write: true,
      export: true,
      sync: true,
    }),
    canonicality: 'entity_reference_only',
    last_indexed_at: null,
    last_checked_at: null,
    entity_visibility_policy_json: '{}',
    external_permission_summary: 'Connector can read this document',
    linked_object_refs: [],
    metadata_json: '{}',
    created_at: '2026-06-24T10:50:00.000Z',
    updated_at: '2026-06-24T10:50:00.000Z',
    ...overrides,
  };
}

describe('Google Docs metadata V1 posture', () => {
  it('exports read-only metadata/open helpers, not mutation helpers', () => {
    expect(Object.keys(googleDocsMetadata).sort()).toEqual([
      'buildGoogleExternalDocumentMetadata',
      'buildGoogleExternalDocumentOpen',
    ]);
  });

  it('forces mutation capabilities off even when connector metadata asks for them', () => {
    const metadata = buildGoogleExternalDocumentMetadata(googleRef());

    expect(metadata.allowed_scopes).toEqual(['read', 'index', 'link', 'preview']);
    expect(metadata.capabilities).toMatchObject({
      read: true,
      index: true,
      link: true,
      preview: true,
    });
    for (const capability of mutationCapabilities) {
      expect(metadata.capabilities[capability]).toBe(false);
      expect(metadata.mutation_capabilities[capability]).toBe(false);
    }
  });

  it('does not add export/write/sync data to the open response', () => {
    const open = buildGoogleExternalDocumentOpen(googleRef());

    expect(open).toEqual({
      target: 'external_google_doc',
      can_open: true,
      url: 'https://docs.google.com/document/d/doc-1',
      degraded: false,
      degraded_reasons: [],
      effective_auth_state: 'authorized',
      effective_readiness_state: 'ready',
    });
    for (const capability of mutationCapabilities) {
      expect(Object.prototype.hasOwnProperty.call(open, capability)).toBe(false);
    }
  });
});
