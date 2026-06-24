import { Router, type Request, type Response } from 'express';
import {
  createDocumentObjectRepository,
  createEvidenceArtifactRepository,
  normalizeObjectRefs,
  type CreateEvidenceArtifactInput,
  type CreateExternalDocumentRefInput,
  type CreateNativeDocumentInput,
  type DocumentObjectRepository,
  type EvidenceArtifactRepository,
  type ObjectRef,
  type UpdateEvidenceArtifactVersionInput,
  type UpdateNativeDocumentVersionInput,
} from '../../db/src';
import {
  ensureObjectPermission,
  ensureRequestOrgMatches,
  permissionSafeRecord,
  requireRequestOrg,
  type RequestOrgBinding,
} from './request-permissions';
import type { ProtectedObject } from './permissions';

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

  router.get('/external-document-refs/:id', (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;
    const externalDocumentRef = documentRepo.getExternalDocumentRef(req.params.id);
    if (!externalDocumentRef) return res.status(404).json({ error: 'external document ref not found' });
    const object = externalDocumentObject(externalDocumentRef);
    if (!ensureRequestOrgMatches(res, binding, object.org_id)) return undefined;
    const envelope = permissionSafeRecord(binding, object, externalDocumentRef as unknown as Record<string, unknown>, 'read');
    return res.json({ externalDocumentRef: envelope.object, permission: envelope.permission });
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
