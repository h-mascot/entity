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
} from '../../db/src';

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
  const status = message.includes('immutable evidence artifacts') ? 409 : 500;
  return res.status(status).json({ error: message });
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

export function createDocumentObjectRouter(deps: DocumentObjectRouterDeps = {}): Router {
  const documentRepo = deps.documentRepo ?? createDocumentObjectRepository();
  const artifactRepo = deps.artifactRepo ?? createEvidenceArtifactRepository();
  const router = Router();

  router.post('/native-documents', (req, res) => {
    try {
      const nativeDocument = documentRepo.createNativeDocument(parseCreateNativeDocument(parseBody(req)));
      return res.status(201).json({ nativeDocument });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/native-documents/:id', (req, res) => {
    const nativeDocument = documentRepo.getNativeDocument(req.params.id);
    if (!nativeDocument) return res.status(404).json({ error: 'native document not found' });
    return res.json({ nativeDocument });
  });

  router.post('/native-documents/:id/links', (req, res) => {
    try {
      const nativeDocument = documentRepo.linkNativeDocumentObject(req.params.id, parseObjectRefBody(parseBody(req)));
      if (!nativeDocument) return res.status(404).json({ error: 'native document not found' });
      return res.json({ nativeDocument });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/external-document-refs', (req, res) => {
    try {
      const externalDocumentRef = documentRepo.createExternalDocumentRef(parseCreateExternalDocumentRef(parseBody(req)));
      return res.status(201).json({ externalDocumentRef });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/external-document-refs/:id', (req, res) => {
    const externalDocumentRef = documentRepo.getExternalDocumentRef(req.params.id);
    if (!externalDocumentRef) return res.status(404).json({ error: 'external document ref not found' });
    return res.json({ externalDocumentRef });
  });

  router.post('/external-document-refs/:id/links', (req, res) => {
    try {
      const externalDocumentRef = documentRepo.linkExternalDocumentObject(req.params.id, parseObjectRefBody(parseBody(req)));
      if (!externalDocumentRef) return res.status(404).json({ error: 'external document ref not found' });
      return res.json({ externalDocumentRef });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/evidence-artifacts', (req, res) => {
    try {
      const evidenceArtifact = artifactRepo.createArtifact(parseCreateEvidenceArtifact(parseBody(req)));
      return res.status(201).json({ evidenceArtifact });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.get('/evidence-artifacts/:id', (req, res) => {
    const evidenceArtifact = artifactRepo.getArtifact(req.params.id);
    if (!evidenceArtifact) return res.status(404).json({ error: 'evidence artifact not found' });
    return res.json({ evidenceArtifact });
  });

  router.post('/evidence-artifacts/:id/links', (req, res) => {
    try {
      const evidenceArtifact = artifactRepo.linkArtifactObject(req.params.id, parseObjectRefBody(parseBody(req)));
      if (!evidenceArtifact) return res.status(404).json({ error: 'evidence artifact not found' });
      return res.json({ evidenceArtifact });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  return router;
}
