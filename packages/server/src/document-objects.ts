import { Router, type Request, type Response } from 'express';
import {
  createDocumentObjectRepository,
  createEvidenceArtifactRepository,
  normalizeObjectRefs,
  type CreateEvidenceArtifactInput,
  type CreateExternalDocumentRefInput,
  type ExternalDocumentRefRecord,
  type CreateNativeDocumentInput,
  type ListExternalDocumentRefsInput,
  type DocumentObjectRepository,
  type EvidenceArtifactRepository,
  type NativeDocumentSearchIndexState,
  type ObjectRef,
  type UpdateEvidenceArtifactVersionInput,
  type UpdateNativeDocumentVersionInput,
} from '../../db/src';
import {
  buildGoogleExternalDocumentMetadata,
  buildGoogleExternalDocumentOpen,
} from './google-docs-metadata';
import {
  ensureObjectPermission,
  ensureRequestOrgMatches,
  permissionSafeRecord,
  requireRequestOrg,
  type RequestOrgBinding,
} from './request-permissions';
import type { PermissionAction, ProtectedObject } from './permissions';
import {
  CAPABILITY_NAMES,
  capabilityAllowsAction,
  FAIL_CLOSED_CAPABILITIES,
  type CapabilityReport,
  type CapabilitySource,
  type CapabilityState,
  type CapabilityType,
} from './document-providers/types';

interface DocumentObjectRouterDeps {
  documentRepo?: DocumentObjectRepository;
  artifactRepo?: EvidenceArtifactRepository;
}

class DocumentObjectApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseBody(req: Request): Record<string, unknown> {
  if (!isRecord(req.body)) {
    throw new DocumentObjectApiError(400, 'body must be an object');
  }
  return req.body;
}

function parseBoundBody(req: Request, res: Response): { binding: RequestOrgBinding; body: Record<string, unknown> } | null {
  const binding = requireRequestOrg(req, res);
  if (!binding) return null;
  const body = parseBody(req);
  const bodyOrg = typeof body.org_id === 'string' ? body.org_id.trim() : '';
  if (bodyOrg && bodyOrg !== binding.orgId) {
    res.status(403).json({ error: 'permission denied', code: 'permission_denied', reason: 'body org does not match request org' });
    return null;
  }
  return { binding, body: { ...body, org_id: bodyOrg || binding.orgId } };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  if (!(key in body) || body[key] === null) return undefined;
  const value = readString(body[key]);
  if (!value) throw new DocumentObjectApiError(400, `${key} must be a non-empty string`);
  return value;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = readString(body[key]);
  if (!value) throw new DocumentObjectApiError(400, `${key} is required`);
  return value;
}

function optionalNumber(body: Record<string, unknown>, key: string): number | undefined {
  if (!(key in body) || body[key] === null) return undefined;
  const value = body[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new DocumentObjectApiError(400, `${key} must be a positive integer`);
  }
  return value;
}

function optionalStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  if (!(key in body) || body[key] === null) return undefined;
  const value = body[key];
  if (!Array.isArray(value) || value.some((entry) => !readString(entry))) {
    throw new DocumentObjectApiError(400, `${key} must be an array of non-empty strings`);
  }
  return value.map((entry) => String(entry).trim());
}

function optionalNumberArray(body: Record<string, unknown>, key: string): number[] | undefined {
  if (!(key in body) || body[key] === null) return undefined;
  const value = body[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'number' || !Number.isInteger(entry) || entry < 1)) {
    throw new DocumentObjectApiError(400, `${key} must be an array of positive integers`);
  }
  return value as number[];
}

function jsonObjectString(body: Record<string, unknown>, objectKey: string, jsonKey: string): string | undefined {
  if (jsonKey in body) return optionalString(body, jsonKey);
  if (!(objectKey in body) || body[objectKey] === null) return undefined;
  if (!isRecord(body[objectKey])) {
    throw new DocumentObjectApiError(400, `${objectKey} must be an object`);
  }
  return JSON.stringify(body[objectKey]);
}

function parseObjectRefs(value: unknown): ObjectRef[] | undefined {
  if (typeof value === 'undefined' || value === null) return undefined;
  try {
    return normalizeObjectRefs(value);
  } catch (error) {
    throw new DocumentObjectApiError(400, error instanceof Error ? error.message : 'invalid object refs');
  }
}

function parseObjectRefBody(body: Record<string, unknown>): ObjectRef {
  const rawRef = body.object_ref ?? body;
  try {
    const refs = normalizeObjectRefs([rawRef]);
    return refs[0];
  } catch (error) {
    throw new DocumentObjectApiError(400, error instanceof Error ? error.message : 'invalid object ref');
  }
}

function readQueryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' && first.trim() ? first.trim() : undefined;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const NATIVE_INDEX_STATES: ReadonlyArray<NativeDocumentSearchIndexState> = ['fresh', 'stale', 'degraded', 'indexing_failed'];

interface NativeIndexResultInput {
  state: NativeDocumentSearchIndexState;
  indexedAt?: string;
  error?: string;
}

function parseNativeIndexResult(body: Record<string, unknown>): NativeIndexResultInput {
  const rawState = readString(body.state);
  if (!rawState || !(NATIVE_INDEX_STATES as readonly string[]).includes(rawState)) {
    throw new DocumentObjectApiError(400, 'state must be one of fresh, stale, degraded, or indexing_failed');
  }
  const state = rawState as NativeDocumentSearchIndexState;
  const indexedAt = optionalString(body, 'indexed_at');
  // T-012 carry-forward F3 (THE-952 approved): a `fresh` index outcome must carry a real,
  // parseable `indexed_at`. Reject with a typed 400 instead of silently coercing an absent or
  // unparseable timestamp to server-now, so `{state:'fresh'}` can never yield a contradictory
  // `indexed:false` + `indexState:'fresh'` pair in the search surface.
  if (state === 'fresh') {
    if (!indexedAt) {
      throw new DocumentObjectApiError(400, 'indexed_at is required when state is fresh');
    }
    if (!Number.isFinite(Date.parse(indexedAt))) {
      throw new DocumentObjectApiError(400, 'indexed_at must be a parseable timestamp');
    }
  }
  const error = readString(body.error);
  return { state, indexedAt, error };
}

function readQueryLimit(req: Request): number | undefined {
  const value = readQueryString(req, 'limit');
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new DocumentObjectApiError(400, 'limit must be a positive integer');
  }
  return parsed;
}

function parseOptionalObjectRefQuery(req: Request): ObjectRef | null {
  const objectType = readQueryString(req, 'object_type');
  const objectId = readQueryString(req, 'object_id');
  const linkRole = readQueryString(req, 'link_role') ?? 'source_context';
  if (!objectType && !objectId) return null;
  if (!objectType || !objectId) {
    throw new DocumentObjectApiError(400, 'object_type and object_id must be provided together');
  }
  try {
    return normalizeObjectRefs([{ object_type: objectType, object_id: objectId, link_role: linkRole }])[0];
  } catch (error) {
    throw new DocumentObjectApiError(400, error instanceof Error ? error.message : 'invalid object ref');
  }
}

function parseExternalDocumentListQuery(req: Request, binding: RequestOrgBinding): ListExternalDocumentRefsInput {
  const connectorType = readQueryString(req, 'connector_type') as CreateExternalDocumentRefInput['connector_type'] | undefined;
  return {
    org_id: binding.orgId,
    connector_type: connectorType,
    query: readQueryString(req, 'q') ?? readQueryString(req, 'query'),
    linked_object_ref: parseOptionalObjectRefQuery(req),
    limit: readQueryLimit(req),
  };
}

function sendRouteError(res: Response, error: unknown): Response {
  if (error instanceof DocumentObjectApiError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  const status = message.includes('immutable evidence artifacts') || message.includes('immutable native documents') ? 409 : 500;
  return res.status(status).json({ error: message });
}

function nativeDocumentObject(record: { id: string; org_id: string; team_id: string | null; project_id: number | null; title: string; sensitivity: string | null; acl_json: string }): ProtectedObject {
  return {
    object_type: 'native_document',
    object_id: record.id,
    org_id: record.org_id,
    team_id: record.team_id,
    project_id: record.project_id,
    title: record.title,
    sensitivity: record.sensitivity,
    acl_json: record.acl_json,
  };
}

function externalDocumentObject(record: { id: string; org_id: string; title: string; entity_visibility_policy_json: string }): ProtectedObject {
  return {
    object_type: 'external_document_ref',
    object_id: record.id,
    org_id: record.org_id,
    title: record.title,
    entity_visibility_policy_json: record.entity_visibility_policy_json,
  };
}

function externalDocumentPermissionEnvelope(
  binding: RequestOrgBinding,
  record: ExternalDocumentRefRecord,
  action: PermissionAction,
) {
  return permissionSafeRecord(
    binding,
    externalDocumentObject(record),
    record as unknown as Record<string, unknown>,
    action
  );
}

function evidenceArtifactObject(record: { id: string; org_id: string; team_id: string | null; project_id: number | null; title: string; metadata_json: string }): ProtectedObject {
  return {
    object_type: 'evidence_artifact',
    object_id: record.id,
    org_id: record.org_id,
    team_id: record.team_id,
    project_id: record.project_id,
    title: record.title,
    sensitivity: readMetadataSensitivity(record.metadata_json),
  };
}

function readMetadataSensitivity(metadataJson: string): string | null {
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>).sensitivity;
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    }
  } catch {
    return null;
  }
  return null;
}

function parseCreateNativeDocument(body: Record<string, unknown>): CreateNativeDocumentInput {
  return {
    id: optionalString(body, 'id'),
    org_id: optionalString(body, 'org_id'),
    team_id: optionalString(body, 'team_id'),
    project_id: optionalNumber(body, 'project_id'),
    title: requiredString(body, 'title'),
    document_kind: optionalString(body, 'document_kind') as CreateNativeDocumentInput['document_kind'],
    stable_path: optionalString(body, 'stable_path'),
    content_hash: requiredString(body, 'content_hash'),
    mutability_policy: optionalString(body, 'mutability_policy') as CreateNativeDocumentInput['mutability_policy'],
    version: optionalNumber(body, 'version'),
    lifecycle_state: optionalString(body, 'lifecycle_state') as CreateNativeDocumentInput['lifecycle_state'],
    sensitivity: optionalString(body, 'sensitivity'),
    acl_json: jsonObjectString(body, 'acl', 'acl_json'),
    linked_object_refs: parseObjectRefs(body.linked_object_refs),
    created_by_principal_id: optionalString(body, 'created_by_principal_id'),
    metadata_json: jsonObjectString(body, 'metadata', 'metadata_json'),
  };
}

function parseUpdateNativeDocument(body: Record<string, unknown>): UpdateNativeDocumentVersionInput {
  return {
    title: optionalString(body, 'title'),
    stable_path: optionalString(body, 'stable_path'),
    content_hash: requiredString(body, 'content_hash'),
    metadata_json: jsonObjectString(body, 'metadata', 'metadata_json'),
    updated_by_principal_id: optionalString(body, 'updated_by_principal_id'),
  };
}

function parseCreateExternalDocumentRef(body: Record<string, unknown>): CreateExternalDocumentRefInput {
  return {
    id: optionalString(body, 'id'),
    org_id: optionalString(body, 'org_id'),
    connector_type: requiredString(body, 'connector_type') as CreateExternalDocumentRefInput['connector_type'],
    external_id: optionalString(body, 'external_id'),
    external_url: optionalString(body, 'external_url'),
    title: requiredString(body, 'title'),
    external_mime_type: optionalString(body, 'external_mime_type'),
    external_canonical_url: optionalString(body, 'external_canonical_url'),
    auth_state: optionalString(body, 'auth_state') as CreateExternalDocumentRefInput['auth_state'],
    readiness_state: optionalString(body, 'readiness_state') as CreateExternalDocumentRefInput['readiness_state'],
    granted_scopes: optionalStringArray(body, 'granted_scopes'),
    missing_scopes: optionalStringArray(body, 'missing_scopes'),
    auth_expires_at: optionalString(body, 'auth_expires_at'),
    external_ref_state: optionalString(body, 'external_ref_state') as CreateExternalDocumentRefInput['external_ref_state'],
    capabilities_json: jsonObjectString(body, 'capabilities', 'capabilities_json'),
    canonicality: (optionalString(body, 'canonicality') ?? 'entity_reference_only') as CreateExternalDocumentRefInput['canonicality'],
    last_indexed_at: optionalString(body, 'last_indexed_at'),
    last_checked_at: optionalString(body, 'last_checked_at'),
    entity_visibility_policy_json: jsonObjectString(body, 'entity_visibility_policy', 'entity_visibility_policy_json'),
    external_permission_summary: optionalString(body, 'external_permission_summary'),
    linked_object_refs: parseObjectRefs(body.linked_object_refs),
    metadata_json: jsonObjectString(body, 'metadata', 'metadata_json'),
  };
}

function parseCreateEvidenceArtifact(body: Record<string, unknown>): CreateEvidenceArtifactInput {
  return {
    id: optionalString(body, 'id'),
    org_id: optionalString(body, 'org_id'),
    team_id: optionalString(body, 'team_id'),
    project_id: optionalNumber(body, 'project_id'),
    artifact_kind: optionalString(body, 'artifact_kind') as CreateEvidenceArtifactInput['artifact_kind'],
    title: requiredString(body, 'title'),
    stable_path: optionalString(body, 'stable_path'),
    human_path_alias: optionalString(body, 'human_path_alias'),
    content_hash: requiredString(body, 'content_hash'),
    mutability_policy: optionalString(body, 'mutability_policy') as CreateEvidenceArtifactInput['mutability_policy'],
    version: optionalNumber(body, 'version'),
    origin_task_id: optionalNumber(body, 'origin_task_id'),
    source_activity_event_ids: optionalNumberArray(body, 'source_activity_event_ids'),
    source_artifact_ids: optionalStringArray(body, 'source_artifact_ids'),
    linked_object_refs: parseObjectRefs(body.linked_object_refs),
    provenance_json: jsonObjectString(body, 'provenance', 'provenance_json'),
    integrity_state: optionalString(body, 'integrity_state') as CreateEvidenceArtifactInput['integrity_state'],
    availability_state: optionalString(body, 'availability_state') as CreateEvidenceArtifactInput['availability_state'],
    created_by_principal_id: optionalString(body, 'created_by_principal_id'),
    metadata_json: jsonObjectString(body, 'metadata', 'metadata_json'),
  };
}

function parseUpdateEvidenceArtifact(body: Record<string, unknown>): UpdateEvidenceArtifactVersionInput {
  return {
    title: optionalString(body, 'title'),
    stable_path: optionalString(body, 'stable_path'),
    content_hash: requiredString(body, 'content_hash'),
    metadata_json: jsonObjectString(body, 'metadata', 'metadata_json'),
    updated_by_principal_id: optionalString(body, 'updated_by_principal_id'),
  };
}

export function createDocumentObjectRouter(deps: DocumentObjectRouterDeps = {}): Router {
  const documentRepo = deps.documentRepo ?? createDocumentObjectRepository();
  const artifactRepo = deps.artifactRepo ?? createEvidenceArtifactRepository();
  const router = Router();

  router.post('/native-documents', (req, res) => {
    try {
      const bound = parseBoundBody(req, res);
      if (!bound) return undefined;
      const nativeDocument = documentRepo.createNativeDocument(parseCreateNativeDocument(bound.body));
      return res.status(201).json({ nativeDocument });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/native-documents/:id', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const nativeDocument = documentRepo.getNativeDocument(req.params.id);
    if (!nativeDocument) return res.status(404).json({ error: 'native document not found' });
    const object = nativeDocumentObject(nativeDocument);
    if (!ensureRequestOrgMatches(res, binding, object.org_id)) return undefined;
    const envelope = permissionSafeRecord(binding, object, nativeDocument as unknown as Record<string, unknown>, 'read');
    return res.json({ nativeDocument: envelope.object, permission: envelope.permission });
  });

  router.patch('/native-documents/:id', (req, res) => {
    try {
      const binding = requireRequestOrg(req, res);
      if (!binding) return undefined;
      const current = documentRepo.getNativeDocument(req.params.id);
      if (!current) return res.status(404).json({ error: 'native document not found' });
      if (!ensureObjectPermission(res, binding, nativeDocumentObject(current), 'write')) return undefined;
      const nativeDocument = documentRepo.updateNativeDocumentVersion(req.params.id, parseUpdateNativeDocument(parseBody(req)));
      if (!nativeDocument) return res.status(404).json({ error: 'native document not found' });
      return res.json({ nativeDocument });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/native-documents/:id/versions', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const nativeDocument = documentRepo.getNativeDocument(req.params.id);
    if (!nativeDocument) return res.status(404).json({ error: 'native document not found' });
    const object = nativeDocumentObject(nativeDocument);
    if (!ensureRequestOrgMatches(res, binding, object.org_id)) return undefined;
    const envelope = permissionSafeRecord(binding, object, nativeDocument as unknown as Record<string, unknown>, 'read');
    if (!envelope.permission.allowed) return res.json({ versions: [], permission: envelope.permission });
    return res.json({ versions: documentRepo.listNativeDocumentVersions(req.params.id) });
  });

  router.post('/native-documents/:id/links', (req, res) => {
    try {
      const binding = requireRequestOrg(req, res);
      if (!binding) return undefined;
      const current = documentRepo.getNativeDocument(req.params.id);
      if (!current) return res.status(404).json({ error: 'native document not found' });
      if (!ensureObjectPermission(res, binding, nativeDocumentObject(current), 'write')) return undefined;
      const nativeDocument = documentRepo.linkNativeDocumentObject(req.params.id, parseObjectRefBody(parseBody(req)));
      if (!nativeDocument) return res.status(404).json({ error: 'native document not found' });
      return res.json({ nativeDocument });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  // R-029 — a provider/entity re-index outcome is recorded INDEPENDENTLY of the document
  // write. A failed index never marks the provider write as failed; a stale state keeps the
  // UI able to identify stale/degraded indexing.
  router.post('/native-documents/:id/index-result', (req, res) => {
    try {
      const binding = requireRequestOrg(req, res);
      if (!binding) return undefined;
      const current = documentRepo.getNativeDocument(req.params.id);
      if (!current) return res.status(404).json({ error: 'native document not found' });
      if (!ensureObjectPermission(res, binding, nativeDocumentObject(current), 'write')) return undefined;
      const input = parseNativeIndexResult(parseBody(req));
      const nativeDocument = input.state === 'fresh'
        ? documentRepo.markNativeDocumentIndexed(req.params.id, input.indexedAt)
        : documentRepo.markNativeDocumentIndexFailed(req.params.id, input.error, input.state);
      if (!nativeDocument) return res.status(404).json({ error: 'native document not found' });
      return res.json({ nativeDocument });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/external-document-refs', (req, res) => {
    try {
      const bound = parseBoundBody(req, res);
      if (!bound) return undefined;
      const externalDocumentRef = documentRepo.createExternalDocumentRef(parseCreateExternalDocumentRef(bound.body));
      return res.status(201).json({ externalDocumentRef });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/external-document-refs', (req, res) => {
    try {
      const binding = requireRequestOrg(req, res);
      if (!binding) return undefined;
      const externalDocumentRefs = documentRepo.listExternalDocumentRefs(parseExternalDocumentListQuery(req, binding))
        .map((externalDocumentRef) => {
          const envelope = externalDocumentPermissionEnvelope(binding, externalDocumentRef, 'search');
          return {
            externalDocumentRef: envelope.object,
            metadata: envelope.permission.allowed ? buildGoogleExternalDocumentMetadata(externalDocumentRef) : null,
            permission: envelope.permission,
          };
        });
      return res.json({ externalDocumentRefs });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/external-document-refs/:id', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const externalDocumentRef = documentRepo.getExternalDocumentRef(req.params.id);
    if (!externalDocumentRef) return res.status(404).json({ error: 'external document ref not found' });
    const object = externalDocumentObject(externalDocumentRef);
    if (!ensureRequestOrgMatches(res, binding, object.org_id)) return undefined;
    const envelope = externalDocumentPermissionEnvelope(binding, externalDocumentRef, 'preview');
    return res.json({ externalDocumentRef: envelope.object, permission: envelope.permission });
  });

  router.get('/external-document-refs/:id/metadata', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const externalDocumentRef = documentRepo.getExternalDocumentRef(req.params.id);
    if (!externalDocumentRef) return res.status(404).json({ error: 'external document ref not found' });
    const object = externalDocumentObject(externalDocumentRef);
    if (!ensureRequestOrgMatches(res, binding, object.org_id)) return undefined;
    const envelope = externalDocumentPermissionEnvelope(binding, externalDocumentRef, 'preview');
    return res.json({
      externalDocumentRef: envelope.object,
      metadata: envelope.permission.allowed ? buildGoogleExternalDocumentMetadata(externalDocumentRef) : null,
      permission: envelope.permission,
    });
  });

  router.get('/external-document-refs/:id/open', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const externalDocumentRef = documentRepo.getExternalDocumentRef(req.params.id);
    if (!externalDocumentRef) return res.status(404).json({ error: 'external document ref not found' });
    const object = externalDocumentObject(externalDocumentRef);
    if (!ensureRequestOrgMatches(res, binding, object.org_id)) return undefined;
    const envelope = externalDocumentPermissionEnvelope(binding, externalDocumentRef, 'preview');
    return res.json({
      externalDocumentRef: envelope.object,
      open: envelope.permission.allowed
        ? buildGoogleExternalDocumentOpen(externalDocumentRef)
        : {
          target: 'external_google_doc',
          can_open: false,
          url: null,
          degraded: true,
          degraded_reasons: ['entity_permission_denied'],
          effective_auth_state: externalDocumentRef.auth_state,
          effective_readiness_state: 'degraded',
        },
      permission: envelope.permission,
    });
  });

  router.post('/external-document-refs/:id/links', (req, res) => {
    try {
      const binding = requireRequestOrg(req, res);
      if (!binding) return undefined;
      const current = documentRepo.getExternalDocumentRef(req.params.id);
      if (!current) return res.status(404).json({ error: 'external document ref not found' });
      if (!ensureObjectPermission(res, binding, externalDocumentObject(current), 'write')) return undefined;
      const externalDocumentRef = documentRepo.linkExternalDocumentObject(req.params.id, parseObjectRefBody(parseBody(req)));
      if (!externalDocumentRef) return res.status(404).json({ error: 'external document ref not found' });
      return res.json({ externalDocumentRef });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/evidence-artifacts', (req, res) => {
    try {
      const bound = parseBoundBody(req, res);
      if (!bound) return undefined;
      const evidenceArtifact = artifactRepo.createArtifact(parseCreateEvidenceArtifact(bound.body));
      return res.status(201).json({ evidenceArtifact });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/evidence-artifacts/:id', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const evidenceArtifact = artifactRepo.getArtifact(req.params.id);
    if (!evidenceArtifact) return res.status(404).json({ error: 'evidence artifact not found' });
    const object = evidenceArtifactObject(evidenceArtifact);
    if (!ensureRequestOrgMatches(res, binding, object.org_id)) return undefined;
    const envelope = permissionSafeRecord(binding, object, evidenceArtifact as unknown as Record<string, unknown>, 'read');
    return res.json({ evidenceArtifact: envelope.object, permission: envelope.permission });
  });

  router.patch('/evidence-artifacts/:id', (req, res) => {
    try {
      const binding = requireRequestOrg(req, res);
      if (!binding) return undefined;
      const current = artifactRepo.getArtifact(req.params.id);
      if (!current) return res.status(404).json({ error: 'evidence artifact not found' });
      if (!ensureObjectPermission(res, binding, evidenceArtifactObject(current), 'write')) return undefined;
      const evidenceArtifact = artifactRepo.updateArtifactVersion(req.params.id, parseUpdateEvidenceArtifact(parseBody(req)));
      if (!evidenceArtifact) return res.status(404).json({ error: 'evidence artifact not found' });
      return res.json({ evidenceArtifact });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/evidence-artifacts/:id/versions', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const evidenceArtifact = artifactRepo.getArtifact(req.params.id);
    if (!evidenceArtifact) return res.status(404).json({ error: 'evidence artifact not found' });
    const object = evidenceArtifactObject(evidenceArtifact);
    if (!ensureRequestOrgMatches(res, binding, object.org_id)) return undefined;
    const envelope = permissionSafeRecord(binding, object, evidenceArtifact as unknown as Record<string, unknown>, 'read');
    if (!envelope.permission.allowed) return res.json({ versions: [], permission: envelope.permission });
    return res.json({ versions: artifactRepo.listArtifactVersions(req.params.id) });
  });

  router.post('/evidence-artifacts/:id/links', (req, res) => {
    try {
      const binding = requireRequestOrg(req, res);
      if (!binding) return undefined;
      const current = artifactRepo.getArtifact(req.params.id);
      if (!current) return res.status(404).json({ error: 'evidence artifact not found' });
      if (!ensureObjectPermission(res, binding, evidenceArtifactObject(current), 'write')) return undefined;
      const evidenceArtifact = artifactRepo.linkArtifactObject(req.params.id, parseObjectRefBody(parseBody(req)));
      if (!evidenceArtifact) return res.status(404).json({ error: 'evidence artifact not found' });
      return res.json({ evidenceArtifact });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  return router;
}

/* =============================================================================
 * T-012 — Migrate existing Google read path into unified document model (THE-953).
 *
 * R-004 "Preserve existing Google V1 read-only behavior": map existing Google
 * external-document-ref metadata into the provider-neutral capability vocabulary
 * (T-002 CapabilityReport) so later write tickets negotiate through the unified
 * model, while preserving read/index/link/preview behavior and keeping ALL Google
 * writes disabled until V2 write authorization is explicitly enabled.
 *
 * This COMPOSES the existing read-only surface (buildGoogleExternalDocumentMetadata)
 * into the T-002 capability model — it introduces no second capability namespace,
 * no receipt store, no provider registry, and no event table. Capability honesty:
 * only read-like lanes proven by the legacy read-only flags are actionable, and
 * every write/embedding/human-edit lane fails closed (`unsupported`) regardless of
 * what the connector's capabilities_json claims.
 *
 * R-004: "…when any write endpoint, tool, or UI attempts mutation, then no Google
 * mutation request is sent." A consumer must not reach a provider mutation through
 * this mapping: `assertGoogleUnifiedWritesDisabled` (below) guarantees the mapped
 * report never enables a write lane.
 * ============================================================================= */

/** The legacy V1 Google mutation-capability vocabulary (all read-only, always `false`). */
const GOOGLE_V1_MUTATION_CAPABILITIES = {
  create: false,
  update: false,
  write: false,
  export: false,
  sync: false,
} as const;

/** A Google V1 external ref mapped into the unified capability model (T-012). */
export interface GoogleUnifiedCapabilityMapping {
  /** Provider-neutral T-002 capability report (complete vocabulary). */
  report: CapabilityReport;
  /** Legacy V1 read-only flags preserved from the Google metadata. */
  legacy: {
    read: boolean;
    index: boolean;
    link: boolean;
    preview: boolean;
    mutation_capabilities: typeof GOOGLE_V1_MUTATION_CAPABILITIES;
  };
}

function readLikeCapabilityState(
  legacyFlag: boolean,
  usable: boolean,
  source: CapabilitySource,
): { state: CapabilityState; source: CapabilitySource } {
  if (!legacyFlag) return { state: 'unsupported', source };
  return usable ? { state: 'supported', source } : { state: 'degraded', source };
}

/**
 * Map an existing Google `ExternalDocumentRefRecord` into the unified T-002
 * capability report. Read-only lanes (`read`/`preview`/`open_external`) reflect the
 * legacy read-only flags and connection health; every write/embedding/human-edit lane
 * is hard `unsupported` (R-004 fail-closed / R-002 unknown-fails-closed), and
 * unproven read-like lanes (thumbnail/version_history/change_tracking/permission_read/
 * export) are `unsupported` — never claimed without proof.
 */
export function mapGoogleExternalRefToUnifiedReport(
  record: ExternalDocumentRefRecord,
  now: Date = new Date(),
): GoogleUnifiedCapabilityMapping {
  const meta = buildGoogleExternalDocumentMetadata(record, now);
  const usable = !meta.degraded;
  const legacy = {
    read: meta.capabilities.read === true,
    index: meta.capabilities.index === true,
    link: meta.capabilities.link === true,
    preview: meta.capabilities.preview === true,
    mutation_capabilities: GOOGLE_V1_MUTATION_CAPABILITIES,
  };

  const read = readLikeCapabilityState(legacy.read, usable, 'adapter');
  const preview = readLikeCapabilityState(legacy.preview, usable, 'adapter');
  const openExternal = readLikeCapabilityState(legacy.link && Boolean(meta.open_url), usable, 'adapter');

  const states: Record<CapabilityType, CapabilityState> = {
    read: read.state,
    preview: preview.state,
    open_external: openExternal.state,
    create: 'unsupported',
    agent_text_mutation: 'unsupported',
    agent_range_mutation: 'unsupported',
    agent_slide_mutation: 'unsupported',
    permission_write: 'unsupported',
    embed_editor: 'unsupported',
    human_edit: 'unsupported',
    thumbnail: 'unsupported',
    version_history: 'unsupported',
    change_tracking: 'unsupported',
    permission_read: 'unsupported',
    export: 'unsupported',
  };

  const report = Object.fromEntries(
    CAPABILITY_NAMES.map((name) => [name, { name, state: states[name], source: 'adapter' as CapabilitySource }]),
  ) as CapabilityReport;

  return { report, legacy };
}

/**
 * Typed fail-closed guard for R-004: proves a mapped Google report never enables a
 * Google mutation. Throws when any write/embedding/human-edit lane is actionable;
 * a caller must run this (or equivalent capability negotiation) BEFORE reaching a
 * provider mutation so that "no Google mutation request is sent while disabled".
 *
 * Because the mapping above hard-codes every write/embedding lane to `unsupported`,
 * this guard only ever throws if a later layer mutates the report; it is the
 * defense-in-depth proof point for the T-012 fail-closed invariant.
 */
export function assertGoogleUnifiedWritesDisabled(mapping: GoogleUnifiedCapabilityMapping): void {
  const writeLanes: CapabilityType[] = [...FAIL_CLOSED_CAPABILITIES, 'human_edit'];
  for (const name of writeLanes) {
    const resolved = mapping.report[name];
    if (!resolved) {
      throw new Error(`T-012 fail-closed invariant violated: missing capability ${name}`);
    }
    if (capabilityAllowsAction(resolved)) {
      throw new Error(
        `T-012 fail-closed invariant violated: Google write lane is actionable (${name}); ` +
        'no Google mutation may be sent while the V2 write flag is disabled',
      );
    }
  }
}
