import express from 'express';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDocumentObjectRouter } from './document-objects';
import type {
  CreateEvidenceArtifactInput,
  CreateExternalDocumentRefInput,
  CreateNativeDocumentInput,
  DocumentObjectRepository,
  EvidenceArtifactRepository,
  EvidenceArtifactRecord,
  EvidenceArtifactVersionRecord,
  ExternalDocumentRefRecord,
  NativeDocumentRecord,
  NativeDocumentVersionRecord,
  ObjectRef,
  UpdateEvidenceArtifactVersionInput,
  UpdateNativeDocumentVersionInput,
} from '../../db/src';

const now = '2026-06-23T17:20:00.000Z';
const googleConnectorV1Scopes = ['read', 'index', 'link', 'preview'] as const;

function normalizeGoogleScopes(value: string[] | undefined): Array<typeof googleConnectorV1Scopes[number]> {
  const allowed = new Set<string>(googleConnectorV1Scopes);
  return (value ?? []).filter((scope, index, scopes): scope is typeof googleConnectorV1Scopes[number] =>
    allowed.has(scope) && scopes.indexOf(scope) === index
  );
}

function normalizeOptionalTimestamp(value: string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function normalizeExternalCapabilities(value: string | undefined): string {
  const parsed = value ? JSON.parse(value) as Record<string, unknown> : {};
  return JSON.stringify({
    read: parsed.read === false ? false : true,
    index: parsed.index === false ? false : true,
    link: parsed.link === false ? false : true,
    preview: parsed.preview === false ? false : true,
    write: false,
    export: false,
    sync: false,
    create: false,
    update: false,
  });
}

function appendObjectRef(current: ObjectRef[], objectRef: ObjectRef): ObjectRef[] {
  const exists = current.some((entry) =>
    entry.object_type === objectRef.object_type &&
    entry.object_id === objectRef.object_id &&
    entry.link_role === objectRef.link_role
  );
  return exists ? current : [...current, objectRef];
}

function createFakeRepos(): {
  documentRepo: DocumentObjectRepository;
  artifactRepo: EvidenceArtifactRepository;
} {
  const nativeDocuments = new Map<string, NativeDocumentRecord>();
  const nativeVersions = new Map<string, NativeDocumentVersionRecord[]>();
  const externalRefs = new Map<string, ExternalDocumentRefRecord>();
  const artifacts = new Map<string, EvidenceArtifactRecord>();
  const artifactVersions = new Map<string, EvidenceArtifactVersionRecord[]>();

  const documentRepo: DocumentObjectRepository = {
    createNativeDocument: (input: CreateNativeDocumentInput) => {
      const id = input.id ?? `native-${nativeDocuments.size + 1}`;
      const record: NativeDocumentRecord = {
        id,
        org_id: input.org_id ?? 'default-org',
        team_id: input.team_id ?? null,
        project_id: input.project_id ?? null,
        title: input.title,
        document_kind: input.document_kind ?? 'internal_doc',
        body_format: 'markdown',
        stable_path: input.stable_path ?? `/documents/native/${id}.md`,
        content_hash: input.content_hash,
        mutability_policy: input.mutability_policy ?? 'editable_versioned',
        version: input.version ?? 1,
        lifecycle_state: input.lifecycle_state ?? 'active',
        sensitivity: input.sensitivity ?? null,
        acl_json: input.acl_json ?? '{}',
        linked_object_refs: input.linked_object_refs ?? [],
        created_by_principal_id: input.created_by_principal_id ?? null,
        metadata_json: input.metadata_json ?? '{}',
        created_at: now,
        updated_at: now,
      };
      nativeDocuments.set(id, record);
      nativeVersions.set(id, [{
        id: nativeVersions.size + 1,
        document_id: id,
        version: record.version,
        stable_path: record.stable_path,
        content_hash: record.content_hash,
        metadata_json: record.metadata_json,
        created_by_principal_id: record.created_by_principal_id,
        created_at: now,
      }]);
      return record;
    },
    getNativeDocument: (id: string) => nativeDocuments.get(id),
    listNativeDocuments: (input) => {
      const query = input.query?.toLowerCase() ?? null;
      return Array.from(nativeDocuments.values())
        .filter((entry) => entry.org_id === input.org_id)
        .filter((entry) => !input.team_id || entry.team_id === input.team_id)
        .filter((entry) => !input.project_id || entry.project_id === input.project_id)
        .filter((entry) => !input.lifecycle_state || entry.lifecycle_state === input.lifecycle_state)
        .filter((entry) => {
          if (!query) return true;
          return [entry.title, entry.stable_path, entry.metadata_json].join(' ').toLowerCase().includes(query);
        });
    },
    updateNativeDocumentVersion: (id: string, input: UpdateNativeDocumentVersionInput) => {
      const current = nativeDocuments.get(id);
      if (!current) return undefined;
      if (current.mutability_policy !== 'editable_versioned') {
        throw new Error('immutable native documents cannot be overwritten; create a superseding document');
      }
      const version = current.version + 1;
      const updated: NativeDocumentRecord = {
        ...current,
        title: input.title ?? current.title,
        stable_path: input.stable_path ?? current.stable_path,
        content_hash: input.content_hash,
        metadata_json: input.metadata_json ?? current.metadata_json,
        version,
        updated_at: now,
      };
      nativeDocuments.set(id, updated);
      nativeVersions.set(id, [
        ...(nativeVersions.get(id) ?? []),
        {
          id: (nativeVersions.get(id)?.length ?? 0) + 1,
          document_id: id,
          version,
          stable_path: updated.stable_path,
          content_hash: updated.content_hash,
          metadata_json: updated.metadata_json,
          created_by_principal_id: input.updated_by_principal_id ?? null,
          created_at: now,
        },
      ]);
      return updated;
    },
    listNativeDocumentVersions: (id: string) => nativeVersions.get(id) ?? [],
    linkNativeDocumentObject: (id: string, objectRef: ObjectRef) => {
      const current = nativeDocuments.get(id);
      if (!current) return undefined;
      const updated = { ...current, linked_object_refs: appendObjectRef(current.linked_object_refs, objectRef) };
      nativeDocuments.set(id, updated);
      return updated;
    },
    createExternalDocumentRef: (input: CreateExternalDocumentRefInput) => {
      const id = input.id ?? `external-${externalRefs.size + 1}`;
      const record: ExternalDocumentRefRecord = {
        id,
        org_id: input.org_id ?? 'default-org',
        connector_type: input.connector_type,
        external_id: input.external_id ?? null,
        external_url: input.external_url ?? null,
        title: input.title,
        external_mime_type: input.external_mime_type ?? null,
        external_canonical_url: input.external_canonical_url ?? null,
        auth_state: input.auth_state ?? 'unknown',
        readiness_state: input.readiness_state ?? 'unknown',
        granted_scopes: normalizeGoogleScopes(input.granted_scopes),
        missing_scopes: normalizeGoogleScopes(input.missing_scopes),
        auth_expires_at: normalizeOptionalTimestamp(input.auth_expires_at),
        external_ref_state: input.external_ref_state ?? 'unknown',
        capabilities_json: normalizeExternalCapabilities(input.capabilities_json),
        canonicality: input.canonicality ?? 'entity_reference_only',
        last_indexed_at: input.last_indexed_at ?? null,
        last_checked_at: input.last_checked_at ?? null,
        entity_visibility_policy_json: input.entity_visibility_policy_json ?? '{}',
        external_permission_summary: input.external_permission_summary ?? null,
        linked_object_refs: input.linked_object_refs ?? [],
        metadata_json: input.metadata_json ?? '{}',
        created_at: now,
        updated_at: now,
      };
      externalRefs.set(id, record);
      return record;
    },
    getExternalDocumentRef: (id: string) => externalRefs.get(id),
    listExternalDocumentRefs: (input) => {
      const query = input.query?.toLowerCase() ?? null;
      return Array.from(externalRefs.values())
        .filter((entry) => entry.org_id === input.org_id)
        .filter((entry) => !input.connector_type || entry.connector_type === input.connector_type)
        .filter((entry) => {
          if (!query) return true;
          return [
            entry.title,
            entry.external_id,
            entry.external_url,
            entry.external_canonical_url,
            entry.external_mime_type,
            entry.external_permission_summary,
            entry.metadata_json,
          ].filter(Boolean).join(' ').toLowerCase().includes(query);
        })
        .filter((entry) => {
          const objectRef = input.linked_object_ref;
          if (!objectRef) return true;
          return entry.linked_object_refs.some((ref) =>
            ref.object_type === objectRef.object_type &&
            ref.object_id === objectRef.object_id &&
            ref.link_role === objectRef.link_role
          );
        })
        .slice(0, input.limit ?? 50);
    },
    linkExternalDocumentObject: (id: string, objectRef: ObjectRef) => {
      const current = externalRefs.get(id);
      if (!current) return undefined;
      const updated = { ...current, linked_object_refs: appendObjectRef(current.linked_object_refs, objectRef) };
      externalRefs.set(id, updated);
      return updated;
    },
  };

  const artifactRepo: EvidenceArtifactRepository = {
    createArtifact: (input: CreateEvidenceArtifactInput) => {
      if (input.artifact_kind === 'raw_task_receipt' && input.mutability_policy === 'editable_versioned') {
        throw new Error('raw task receipt artifacts must be immutable_append_only');
      }
      const id = input.id ?? `artifact-${artifacts.size + 1}`;
      const record: EvidenceArtifactRecord = {
        id,
        org_id: input.org_id ?? 'default-org',
        team_id: input.team_id ?? null,
        project_id: input.project_id ?? null,
        artifact_kind: input.artifact_kind ?? 'raw_task_receipt',
        title: input.title,
        body_format: 'markdown',
        stable_path: input.stable_path ?? `/artifacts/evidence/${id}.md`,
        human_path_alias: input.human_path_alias ?? null,
        content_hash: input.content_hash,
        mutability_policy: input.mutability_policy ?? 'immutable_append_only',
        version: input.version ?? 1,
        origin_task_id: input.origin_task_id ?? null,
        source_activity_event_ids: input.source_activity_event_ids ?? [],
        source_artifact_ids: input.source_artifact_ids ?? [],
        linked_object_refs: input.linked_object_refs ?? [],
        provenance_json: input.provenance_json ?? '{}',
        integrity_state: input.integrity_state ?? 'valid',
        availability_state: input.availability_state ?? 'available',
        created_by_principal_id: input.created_by_principal_id ?? null,
        metadata_json: input.metadata_json ?? '{}',
        created_at: now,
        updated_at: now,
      };
      artifacts.set(id, record);
      artifactVersions.set(id, [{
        id: artifactVersions.size + 1,
        artifact_id: id,
        version: record.version,
        stable_path: record.stable_path,
        content_hash: record.content_hash,
        metadata_json: record.metadata_json,
        created_by_principal_id: record.created_by_principal_id,
        created_at: now,
      }]);
      return record;
    },
    getArtifact: (id: string) => artifacts.get(id),
    listArtifacts: (input) => {
      const query = input.query?.toLowerCase() ?? null;
      return Array.from(artifacts.values())
        .filter((entry) => entry.org_id === input.org_id)
        .filter((entry) => !input.team_id || entry.team_id === input.team_id)
        .filter((entry) => !input.project_id || entry.project_id === input.project_id)
        .filter((entry) => !input.artifact_kinds?.length || input.artifact_kinds.includes(entry.artifact_kind))
        .filter((entry) => {
          if (!query) return true;
          return [entry.title, entry.artifact_kind, entry.human_path_alias].filter(Boolean).join(' ').toLowerCase().includes(query);
        });
    },
    listArtifactsByOriginTask: (taskId: number) =>
      Array.from(artifacts.values()).filter((entry) => entry.origin_task_id === taskId),
    updateArtifactVersion: (id: string, input: UpdateEvidenceArtifactVersionInput) => {
      const current = artifacts.get(id);
      if (!current) return undefined;
      if (current.mutability_policy !== 'editable_versioned') {
        throw new Error('immutable evidence artifacts cannot be overwritten; create a superseding artifact');
      }
      const version = current.version + 1;
      const updated: EvidenceArtifactRecord = {
        ...current,
        title: input.title ?? current.title,
        stable_path: input.stable_path ?? current.stable_path,
        content_hash: input.content_hash,
        metadata_json: input.metadata_json ?? current.metadata_json,
        version,
        updated_at: now,
      };
      artifacts.set(id, updated);
      artifactVersions.set(id, [
        ...(artifactVersions.get(id) ?? []),
        {
          id: (artifactVersions.get(id)?.length ?? 0) + 1,
          artifact_id: id,
          version,
          stable_path: updated.stable_path,
          content_hash: updated.content_hash,
          metadata_json: updated.metadata_json,
          created_by_principal_id: input.updated_by_principal_id ?? null,
          created_at: now,
        },
      ]);
      return updated;
    },
    listArtifactVersions: (id: string) => artifactVersions.get(id) ?? [],
    linkArtifactObject: (id: string, objectRef: ObjectRef) => {
      const current = artifacts.get(id);
      if (!current) return undefined;
      if (current.mutability_policy !== 'editable_versioned') {
        throw new Error('immutable evidence artifacts cannot be relinked; create a superseding artifact');
      }
      const updated = { ...current, linked_object_refs: appendObjectRef(current.linked_object_refs, objectRef) };
      artifacts.set(id, updated);
      return updated;
    },
    updateHumanPathAlias: (id: string, humanPathAlias: string | null) => {
      const current = artifacts.get(id);
      if (!current) return undefined;
      const updated = { ...current, human_path_alias: humanPathAlias };
      artifacts.set(id, updated);
      return updated;
    },
  };

  return { documentRepo, artifactRepo };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('document object routes', () => {
  let baseUrl = '';
  let server: http.Server;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (!req.headers['x-entity-org-id']) {
        req.headers['x-entity-org-id'] = 'org-a';
      }
      next();
    });
    app.use('/api/document-objects', createDocumentObjectRouter(createFakeRepos()));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('creates, reads, and links native documents with explicit ObjectRefs', async () => {
    const createRes = await fetch(`${baseUrl}/api/document-objects/native-documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'native-api-doc',
        org_id: 'org-a',
        title: 'Renewal notes',
        content_hash: 'sha256:native-api',
        metadata: { fixture: 'THE-42' },
      }),
    });
    expect(createRes.status).toBe(201);
    expect(await readJson(createRes)).toMatchObject({
      nativeDocument: {
        id: 'native-api-doc',
        org_id: 'org-a',
        stable_path: '/documents/native/native-api-doc.md',
        metadata_json: JSON.stringify({ fixture: 'THE-42' }),
      },
    });

    const linkRes = await fetch(`${baseUrl}/api/document-objects/native-documents/native-api-doc/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ object_ref: { object_type: 'task', object_id: '42', link_role: 'source_context' } }),
    });
    expect(linkRes.status).toBe(200);
    expect(await readJson(linkRes)).toMatchObject({
      nativeDocument: {
        id: 'native-api-doc',
        linked_object_refs: [{ object_type: 'task', object_id: '42', link_role: 'source_context' }],
      },
    });

    const readRes = await fetch(`${baseUrl}/api/document-objects/native-documents/native-api-doc`);
    expect(readRes.status).toBe(200);
    expect(await readJson(readRes)).toMatchObject({ nativeDocument: { id: 'native-api-doc' } });
  });

  it('versions editable native markdown documents and rejects immutable overwrites', async () => {
    const createRes = await fetch(`${baseUrl}/api/document-objects/native-documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'versioned-native-api-doc',
        title: 'Versioned native note',
        content_hash: 'sha256:native-v1',
        metadata: { version: 1 },
      }),
    });
    expect(createRes.status).toBe(201);

    const updateRes = await fetch(`${baseUrl}/api/document-objects/native-documents/versioned-native-api-doc`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content_hash: 'sha256:native-v2',
        metadata: { version: 2 },
        updated_by_principal_id: 'human-reviewer',
      }),
    });
    expect(updateRes.status).toBe(200);
    expect(await readJson(updateRes)).toMatchObject({
      nativeDocument: {
        id: 'versioned-native-api-doc',
        version: 2,
        content_hash: 'sha256:native-v2',
        metadata_json: JSON.stringify({ version: 2 }),
      },
    });

    const versionsRes = await fetch(`${baseUrl}/api/document-objects/native-documents/versioned-native-api-doc/versions`);
    expect(versionsRes.status).toBe(200);
    expect(await readJson(versionsRes)).toMatchObject({
      versions: [
        { version: 1, content_hash: 'sha256:native-v1' },
        { version: 2, content_hash: 'sha256:native-v2', created_by_principal_id: 'human-reviewer' },
      ],
    });

    const immutableCreate = await fetch(`${baseUrl}/api/document-objects/native-documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'immutable-native-api-doc',
        title: 'Immutable native note',
        content_hash: 'sha256:immutable-v1',
        mutability_policy: 'immutable',
      }),
    });
    expect(immutableCreate.status).toBe(201);

    const immutableUpdate = await fetch(`${baseUrl}/api/document-objects/native-documents/immutable-native-api-doc`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content_hash: 'sha256:immutable-v2' }),
    });
    expect(immutableUpdate.status).toBe(409);
    expect(await readJson(immutableUpdate)).toEqual({
      error: 'immutable native documents cannot be overwritten; create a superseding document',
    });
  });

  it('links external refs as Entity references without write capability', async () => {
    const createRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'external-api-doc',
        org_id: 'org-a',
        connector_type: 'google_docs',
        external_url: 'https://docs.example.test/document/abc',
        title: 'Customer-owned account plan',
      }),
    });
    expect(createRes.status).toBe(201);
    const payload = await readJson(createRes);
    expect(payload).toMatchObject({
      externalDocumentRef: {
        id: 'external-api-doc',
        canonicality: 'entity_reference_only',
      },
    });
    expect(JSON.parse((payload.externalDocumentRef as { capabilities_json: string }).capabilities_json)).toMatchObject({
      link: true,
      write: false,
    });
  });

  it('models Google auth expiry, read-only scopes, deleted refs, and Entity visibility separately', async () => {
    const createRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'google-auth-scope-fixture',
        org_id: 'org-a',
        connector_type: 'google_drive',
        external_id: 'drive-file-123',
        title: 'Revoked drive planning sheet',
        auth_state: 'insufficient_scope',
        readiness_state: 'degraded',
        granted_scopes: ['read', 'link'],
        missing_scopes: ['index', 'preview'],
        auth_expires_at: '2026-06-24T08:20:00Z',
        external_ref_state: 'deleted',
        external_permission_summary: 'connector lost access to this Drive item',
        entity_visibility_policy: { visibility: 'restricted', allowed_principal_ids: ['owner-1'] },
        capabilities: { read: true, index: true, link: true, preview: true, write: true, export: true },
      }),
    });

    expect(createRes.status).toBe(201);
    const payload = await readJson(createRes);
    expect(payload).toMatchObject({
      externalDocumentRef: {
        id: 'google-auth-scope-fixture',
        auth_state: 'insufficient_scope',
        readiness_state: 'degraded',
        granted_scopes: ['read', 'link'],
        missing_scopes: ['index', 'preview'],
        auth_expires_at: '2026-06-24T08:20:00.000Z',
        external_ref_state: 'deleted',
        external_permission_summary: 'connector lost access to this Drive item',
        entity_visibility_policy_json: JSON.stringify({ visibility: 'restricted', allowed_principal_ids: ['owner-1'] }),
      },
    });
    expect(JSON.parse((payload.externalDocumentRef as { capabilities_json: string }).capabilities_json)).toEqual({
      read: true,
      index: true,
      link: true,
      preview: true,
      write: false,
      export: false,
      sync: false,
      create: false,
      update: false,
    });
  });

  it('serves read-only Google Docs metadata list, search, read, and open-link responses', async () => {
    const createRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'google-readonly-doc',
        org_id: 'org-a',
        connector_type: 'google_docs',
        external_id: 'docs-file-82',
        external_url: 'https://docs.google.com/document/d/docs-file-82/edit',
        external_canonical_url: 'https://docs.google.com/document/d/docs-file-82',
        title: 'Board Account Plan',
        external_mime_type: 'application/vnd.google-apps.document',
        auth_state: 'authorized',
        readiness_state: 'ready',
        granted_scopes: ['read', 'index', 'link', 'preview'],
        external_ref_state: 'available',
        linked_object_refs: [{ object_type: 'task', object_id: '82', link_role: 'source_context' }],
        metadata: { snippet: 'Q3 expansion plan', owner: 'sales' },
        capabilities: { create: true, update: true, write: true, export: true, sync: true },
      }),
    });
    expect(createRes.status).toBe(201);

    const listRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs?connector_type=google_docs&q=board&object_type=task&object_id=82&link_role=source_context`);
    expect(listRes.status).toBe(200);
    const listPayload = await readJson(listRes);
    expect(listPayload).toMatchObject({
      externalDocumentRefs: [{
        externalDocumentRef: { id: 'google-readonly-doc', title: 'Board Account Plan' },
        metadata: {
          id: 'google-readonly-doc',
          effective_readiness_state: 'ready',
          degraded: false,
          open_url: 'https://docs.google.com/document/d/docs-file-82',
          allowed_scopes: ['read', 'index', 'link', 'preview'],
          mutation_capabilities: {
            create: false,
            update: false,
            write: false,
            export: false,
            sync: false,
          },
        },
      }],
    });
    expect(((listPayload.externalDocumentRefs as Array<{ metadata: { capabilities: Record<string, boolean> } }>)[0].metadata.capabilities)).toMatchObject({
      read: true,
      index: true,
      link: true,
      preview: true,
      create: false,
      update: false,
      write: false,
      export: false,
      sync: false,
    });

    const metadataRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs/google-readonly-doc/metadata`);
    expect(metadataRes.status).toBe(200);
    expect(await readJson(metadataRes)).toMatchObject({
      metadata: {
        title: 'Board Account Plan',
        effective_auth_state: 'authorized',
        effective_readiness_state: 'ready',
        granted_scopes: ['read', 'index', 'link', 'preview'],
      },
    });

    const openRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs/google-readonly-doc/open`);
    expect(openRes.status).toBe(200);
    expect(await readJson(openRes)).toMatchObject({
      open: {
        target: 'external_google_doc',
        can_open: true,
        url: 'https://docs.google.com/document/d/docs-file-82',
        degraded: false,
      },
    });
  });

  it('returns degraded metadata for expired and insufficient Google auth', async () => {
    const expiredRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'google-expired-doc',
        connector_type: 'google_drive',
        external_id: 'drive-expired-82',
        title: 'Expired drive sheet',
        auth_state: 'authorized',
        readiness_state: 'ready',
        granted_scopes: ['read', 'index', 'link', 'preview'],
        auth_expires_at: '2000-01-01T00:00:00Z',
        external_ref_state: 'available',
      }),
    });
    expect(expiredRes.status).toBe(201);

    const expiredMetadataRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs/google-expired-doc/metadata`);
    expect(expiredMetadataRes.status).toBe(200);
    expect(await readJson(expiredMetadataRes)).toMatchObject({
      metadata: {
        effective_auth_state: 'expired',
        effective_readiness_state: 'degraded',
        degraded: true,
        degraded_reasons: ['auth_expired'],
      },
    });

    const insufficientRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'google-insufficient-doc',
        connector_type: 'google_docs',
        external_id: 'docs-insufficient-82',
        title: 'Insufficient scope doc',
        auth_state: 'insufficient_scope',
        readiness_state: 'ready',
        granted_scopes: ['read', 'link'],
        missing_scopes: ['index', 'preview'],
        external_ref_state: 'available',
      }),
    });
    expect(insufficientRes.status).toBe(201);

    const insufficientListRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs?connector_type=google_docs&q=insufficient`);
    expect(insufficientListRes.status).toBe(200);
    expect(await readJson(insufficientListRes)).toMatchObject({
      externalDocumentRefs: [{
        metadata: {
          effective_auth_state: 'insufficient_scope',
          effective_readiness_state: 'degraded',
          degraded: true,
          degraded_reasons: ['insufficient_scope'],
          missing_scopes: ['index', 'preview'],
        },
      }],
    });
  });

  it('suppresses restricted Google snippets, previews, titles, and open URLs before output', async () => {
    const createRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'google-restricted-preview-doc',
        connector_type: 'google_docs',
        external_id: 'docs-restricted-84',
        external_url: 'https://docs.google.com/document/d/restricted-84/edit',
        external_canonical_url: 'https://docs.google.com/document/d/restricted-84',
        title: 'Restricted customer renewal strategy',
        auth_state: 'authorized',
        readiness_state: 'ready',
        granted_scopes: ['read', 'index', 'link', 'preview'],
        external_ref_state: 'available',
        metadata: { snippet: 'Do not leak customer renewal snippet', preview_text: 'Do not leak preview text' },
        entity_visibility_policy: { allow_preview: false },
      }),
    });
    expect(createRes.status).toBe(201);

    const listRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs?connector_type=google_docs&q=renewal`);
    expect(listRes.status).toBe(200);
    const listBody = await readJson(listRes);
    expect(listBody).toMatchObject({
      externalDocumentRefs: [{
        externalDocumentRef: {
          id: 'google-restricted-preview-doc',
          object_type: 'external_document_ref',
          title: null,
          permission_state: 'restricted',
          entity_permission_state: 'restricted',
          restricted: true,
          placeholder: true,
        },
        metadata: null,
        permission: {
          allowed: false,
          action: 'search',
          reasons: ['object policy disables preview/search'],
        },
      }],
    });
    expect(JSON.stringify(listBody)).not.toContain('Restricted customer renewal strategy');
    expect(JSON.stringify(listBody)).not.toContain('Do not leak customer renewal snippet');
    expect(JSON.stringify(listBody)).not.toContain('https://docs.google.com/document/d/restricted-84');

    const metadataRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs/google-restricted-preview-doc/metadata`);
    expect(metadataRes.status).toBe(200);
    const metadataBody = await readJson(metadataRes);
    expect(metadataBody).toMatchObject({
      externalDocumentRef: {
        id: 'google-restricted-preview-doc',
        title: null,
        restricted: true,
        placeholder: true,
      },
      metadata: null,
      permission: {
        allowed: false,
        action: 'preview',
      },
    });
    expect(JSON.stringify(metadataBody)).not.toContain('Do not leak preview text');

    const openRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs/google-restricted-preview-doc/open`);
    expect(openRes.status).toBe(200);
    expect(await readJson(openRes)).toMatchObject({
      open: {
        target: 'external_google_doc',
        can_open: false,
        url: null,
        degraded: true,
        degraded_reasons: ['entity_permission_denied'],
      },
      permission: {
        allowed: false,
      },
    });
  });

  it('marks deleted Google refs degraded without losing Entity-native proof artifacts', async () => {
    const proofRes = await fetch(`${baseUrl}/api/document-objects/evidence-artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'deleted-google-native-proof',
        artifact_kind: 'raw_task_receipt',
        title: 'Canonical Entity proof remains',
        content_hash: 'sha256:deleted-google-proof',
        origin_task_id: 84,
        linked_object_refs: [{ object_type: 'task', object_id: '84', link_role: 'receipt' }],
      }),
    });
    expect(proofRes.status).toBe(201);

    const externalRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'google-deleted-doc',
        connector_type: 'google_drive',
        external_id: 'drive-deleted-84',
        external_url: 'https://drive.google.com/file/d/deleted-84/view',
        title: 'Deleted external context',
        auth_state: 'revoked',
        readiness_state: 'degraded',
        granted_scopes: ['read', 'index', 'link', 'preview'],
        external_ref_state: 'deleted',
        external_permission_summary: 'Connector reports the Drive item was deleted',
        linked_object_refs: [{ object_type: 'task', object_id: '84', link_role: 'source_context' }],
      }),
    });
    expect(externalRes.status).toBe(201);

    const metadataRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs/google-deleted-doc/metadata`);
    expect(metadataRes.status).toBe(200);
    expect(await readJson(metadataRes)).toMatchObject({
      metadata: {
        effective_auth_state: 'revoked',
        effective_readiness_state: 'degraded',
        degraded: true,
        degraded_reasons: ['external_ref_deleted', 'readiness_degraded'],
        external_ref_state: 'deleted',
      },
    });

    const openRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs/google-deleted-doc/open`);
    expect(openRes.status).toBe(200);
    expect(await readJson(openRes)).toMatchObject({
      open: {
        can_open: false,
        url: null,
        degraded: true,
      },
    });

    const proofRead = await fetch(`${baseUrl}/api/document-objects/evidence-artifacts/deleted-google-native-proof`);
    expect(proofRead.status).toBe(200);
    expect(await readJson(proofRead)).toMatchObject({
      evidenceArtifact: {
        id: 'deleted-google-native-proof',
        title: 'Canonical Entity proof remains',
        origin_task_id: 84,
        availability_state: 'available',
      },
    });
  });

  it('does not expose Google Docs create, update, write, export, or sync mutation endpoints', async () => {
    const createRes = await fetch(`${baseUrl}/api/document-objects/external-document-refs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'google-no-mutation-doc',
        connector_type: 'google_docs',
        external_id: 'docs-no-mutation-82',
        title: 'No mutation fixture',
        auth_state: 'authorized',
        readiness_state: 'ready',
        external_ref_state: 'available',
      }),
    });
    expect(createRes.status).toBe(201);

    for (const route of ['create', 'update', 'write', 'export', 'sync']) {
      const response = await fetch(`${baseUrl}/api/document-objects/external-document-refs/google-no-mutation-doc/${route}`, {
        method: route === 'update' ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'attempted external mutation' }),
      });
      expect(response.status, route).toBe(404);
    }

    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      const response = await fetch(`${baseUrl}/api/document-objects/external-document-refs/google-no-mutation-doc`, { method });
      expect(response.status, method).toBe(404);
    }
  });

  it('allows curated artifact links and rejects immutable raw evidence relinks', async () => {
    const rawRes = await fetch(`${baseUrl}/api/document-objects/evidence-artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'raw-api-artifact',
        artifact_kind: 'raw_task_receipt',
        title: 'Raw receipt',
        content_hash: 'sha256:raw-api',
      }),
    });
    expect(rawRes.status).toBe(201);

    const blockedLink = await fetch(`${baseUrl}/api/document-objects/evidence-artifacts/raw-api-artifact/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ object_type: 'task', object_id: '42', link_role: 'receipt' }),
    });
    expect(blockedLink.status).toBe(409);
    expect(await readJson(blockedLink)).toEqual({
      error: 'immutable evidence artifacts cannot be relinked; create a superseding artifact',
    });

    const curatedRes = await fetch(`${baseUrl}/api/document-objects/evidence-artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'curated-api-artifact',
        artifact_kind: 'curated_report',
        title: 'Curated report',
        content_hash: 'sha256:curated-api',
        mutability_policy: 'editable_versioned',
      }),
    });
    expect(curatedRes.status).toBe(201);

    const linkedRes = await fetch(`${baseUrl}/api/document-objects/evidence-artifacts/curated-api-artifact/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ object_type: 'task', object_id: '42', link_role: 'summary' }),
    });
    expect(linkedRes.status).toBe(200);
    expect(await readJson(linkedRes)).toMatchObject({
      evidenceArtifact: {
        id: 'curated-api-artifact',
        linked_object_refs: [{ object_type: 'task', object_id: '42', link_role: 'summary' }],
      },
    });
  });

  it('versions editable curated artifacts and blocks raw evidence overwrites', async () => {
    const curatedRes = await fetch(`${baseUrl}/api/document-objects/evidence-artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'versioned-curated-api-artifact',
        artifact_kind: 'curated_report',
        title: 'Editable curated report',
        content_hash: 'sha256:curated-v1',
        mutability_policy: 'editable_versioned',
      }),
    });
    expect(curatedRes.status).toBe(201);

    const updateRes = await fetch(`${baseUrl}/api/document-objects/evidence-artifacts/versioned-curated-api-artifact`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content_hash: 'sha256:curated-v2',
        metadata: { source_artifacts: ['raw-api-artifact'] },
        updated_by_principal_id: 'human-editor',
      }),
    });
    expect(updateRes.status).toBe(200);
    expect(await readJson(updateRes)).toMatchObject({
      evidenceArtifact: {
        id: 'versioned-curated-api-artifact',
        version: 2,
        content_hash: 'sha256:curated-v2',
      },
    });

    const versionsRes = await fetch(`${baseUrl}/api/document-objects/evidence-artifacts/versioned-curated-api-artifact/versions`);
    expect(versionsRes.status).toBe(200);
    expect(await readJson(versionsRes)).toMatchObject({
      versions: [
        { version: 1, content_hash: 'sha256:curated-v1' },
        { version: 2, content_hash: 'sha256:curated-v2', created_by_principal_id: 'human-editor' },
      ],
    });

    const rawUpdate = await fetch(`${baseUrl}/api/document-objects/evidence-artifacts/raw-api-artifact`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content_hash: 'sha256:raw-v2' }),
    });
    expect(rawUpdate.status).toBe(409);
    expect(await readJson(rawUpdate)).toEqual({
      error: 'immutable evidence artifacts cannot be overwritten; create a superseding artifact',
    });
  });

  it('rejects malformed ObjectRef request bodies before linking', async () => {
    const response = await fetch(`${baseUrl}/api/document-objects/native-documents/native-api-doc/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ object_type: 'task', object_id: '42', link_role: '' }),
    });
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: 'ObjectRef requires object_type, object_id, and link_role' });
  });

  it('uses default org binding when request org header is absent', async () => {
    const createRes = await fetch(`${baseUrl}/api/document-objects/native-documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'default-org-binding-doc',
        org_id: 'org-a',
        title: 'Default org binding',
        content_hash: 'sha256:default-org-binding',
      }),
    });
    expect(createRes.status).toBe(201);

    const response = await fetch(`${baseUrl}/api/document-objects/native-documents/default-org-binding-doc`);
    expect(response.status).not.toBe(400);
    expect(await readJson(response)).not.toMatchObject({ code: 'request_org_required' });
  });

  it('denies cross-org document access without leaking the object body', async () => {
    const createRes = await fetch(`${baseUrl}/api/document-objects/native-documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-org-id': 'org-b' },
      body: JSON.stringify({
        id: 'cross-org-native-doc',
        org_id: 'org-b',
        title: 'Other org strategy',
        content_hash: 'sha256:cross-org',
      }),
    });
    expect(createRes.status).toBe(201);

    const denied = await fetch(`${baseUrl}/api/document-objects/native-documents/cross-org-native-doc`, {
      headers: { 'x-entity-org-id': 'org-a' },
    });
    expect(denied.status).toBe(403);
    expect(await readJson(denied)).toEqual({
      error: 'permission denied',
      code: 'permission_denied',
      reason: 'object is outside the request org',
    });
  });

  it('returns a restricted placeholder envelope for same-org document policy denial', async () => {
    const createRes = await fetch(`${baseUrl}/api/document-objects/native-documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entity-org-id': 'org-a' },
      body: JSON.stringify({
        id: 'restricted-native-doc',
        org_id: 'org-a',
        title: 'Restricted people note',
        content_hash: 'sha256:restricted',
        sensitivity: 'people',
      }),
    });
    expect(createRes.status).toBe(201);

    const denied = await fetch(`${baseUrl}/api/document-objects/native-documents/restricted-native-doc`, {
      headers: { 'x-entity-org-id': 'org-a' },
    });
    expect(denied.status).toBe(200);
    const body = await readJson(denied);
    expect(body).toMatchObject({
      nativeDocument: {
        id: 'restricted-native-doc',
        object_id: 'restricted-native-doc',
        object_type: 'native_document',
        title: null,
        permission_state: 'restricted',
        entity_permission_state: 'restricted',
        restricted: true,
        placeholder: true,
      },
      permission: {
        allowed: false,
        object_type: 'native_document',
        object_id: 'restricted-native-doc',
      },
    });
    expect(JSON.stringify(body)).not.toContain('Restricted people note');
  });
});
