import { createHash } from 'node:crypto';
import type { DocumentIntegrationsRepository } from '../../../../db/src/document-integrations';

type OperationRepository = Pick<
  DocumentIntegrationsRepository,
  'claimDocumentOperation' | 'completeDocumentOperation'
>;

export class LocalDocumentOperationError extends Error {
  constructor(public readonly code: 'conflict' | 'uncertain' | 'invalid_replay', message: string) {
    super(message);
    this.name = 'LocalDocumentOperationError';
  }
}

export interface LocalDocumentOperation<T> {
  replay: T | null;
  complete(result: T, documentId: string, documentRef: string): void;
  uncertain(documentId?: string, documentRef?: string): void;
}

/** Claim the canonical operation record before a local artifact can be changed. */
export function claimLocalDocumentOperation<T>(input: {
  repository: OperationRepository;
  workspaceId: string;
  idempotencyKey: string;
  fingerprintInput: unknown;
}): LocalDocumentOperation<T> {
  const requestFingerprint = createHash('sha256')
    .update(JSON.stringify(input.fingerprintInput)).digest('hex');
  const claim = input.repository.claimDocumentOperation({
    workspace_id: input.workspaceId,
    idempotency_key: input.idempotencyKey,
    provider: 'local_office',
    artifact_type: 'document',
    request_fingerprint: requestFingerprint,
  });
  if (claim.kind === 'conflict') {
    throw new LocalDocumentOperationError('conflict', 'local document operation key conflicts with another request');
  }
  if (claim.kind === 'uncertain') {
    throw new LocalDocumentOperationError('uncertain', 'local document operation requires reconciliation before retry');
  }
  let replay: T | null = null;
  if (claim.kind === 'completed') {
    try { replay = JSON.parse(claim.record.result_json!) as T; }
    catch { throw new LocalDocumentOperationError('invalid_replay', 'local document operation replay is invalid'); }
  }
  const transition = (operation_status: 'completed' | 'uncertain', result?: T, documentId?: string, documentRef?: string): void => {
    input.repository.completeDocumentOperation(input.workspaceId, input.idempotencyKey, {
      request_fingerprint: requestFingerprint,
      operation_status,
      provider_external_id: documentRef,
      document_id: documentId,
      ...(result === undefined ? {} : { result_json: JSON.stringify(result) }),
    });
  };
  return {
    replay,
    complete: (result, documentId, documentRef) => transition('completed', result, documentId, documentRef),
    uncertain: (documentId, documentRef) => {
      try { transition('uncertain', undefined, documentId, documentRef); }
      catch { /* Preserve the originating failure; the in-flight claim remains reconcilable. */ }
    },
  };
}
