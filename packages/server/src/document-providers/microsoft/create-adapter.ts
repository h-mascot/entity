/**
 * T-022 / THE-963 — Microsoft creation seam.
 *
 * This module is deliberately only an injected, fail-closed boundary. It does not
 * generate OOXML, hold credentials, choose destinations, or perform network I/O.
 * The returned status proves provider creation only; Office-editor opening remains
 * explicitly unproven until the live T-038/T-039 lanes.
 */
import type { DocumentArtifactType } from '../../../../db/src/document-integrations';
import type { MicrosoftConnectionSnapshot, MicrosoftTenantBinding } from './connection';
import type { ResolvedMicrosoftDestination } from './destinations';

export type MicrosoftArtifactFormat = 'docx' | 'xlsx' | 'pptx';

const FORMAT_BY_TYPE: Readonly<Record<DocumentArtifactType, MicrosoftArtifactFormat>> = {
  document: 'docx',
  spreadsheet: 'xlsx',
  presentation: 'pptx',
};
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_BYTES = 10 * 1024 * 1024;

export interface MicrosoftArtifactDescriptor {
  artifactType: DocumentArtifactType;
  format: MicrosoftArtifactFormat;
  title: string;
  content: Uint8Array;
}

export interface MicrosoftCreateRequest {
  descriptor: MicrosoftArtifactDescriptor;
  connection: MicrosoftConnectionSnapshot;
  tenantBinding: MicrosoftTenantBinding;
  destination: ResolvedMicrosoftDestination;
  idempotencyKey: string;
}

export interface MicrosoftCreateTransportInput {
  descriptor: MicrosoftArtifactDescriptor;
  destinationId: string;
  tenantId: string;
  connectionId: string;
  idempotencyKey: string;
}

export interface MicrosoftCreateTransportResult {
  outcome: 'created' | 'existing';
  providerIdentity: string;
  providerUrl: string;
  revision: string;
}

export interface MicrosoftCreateTransport {
  create(input: MicrosoftCreateTransportInput): MicrosoftCreateTransportResult;
}

export interface MicrosoftCreatedArtifact {
  provider: 'microsoft_365';
  providerIdentity: string;
  providerUrl: string;
  revision: string;
  creationStatus: 'created' | 'existing';
  editorOpenProof: 'unproven';
}

export class MicrosoftCreateError extends Error {
  readonly code:
    | 'INVALID_DESCRIPTOR'
    | 'INVALID_BINDING'
    | 'INVALID_DESTINATION'
    | 'CONNECTION_NOT_READY'
    | 'TENANT_MISMATCH'
    | 'MALFORMED_PROVIDER_RESPONSE';
  readonly field?: string;

  constructor(code: MicrosoftCreateError['code'], message: string, field?: string) {
    super(message);
    this.name = 'MicrosoftCreateError';
    this.code = code;
    this.field = field;
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function fail(code: MicrosoftCreateError['code'], message: string, field?: string): never {
  throw new MicrosoftCreateError(code, message, field);
}

function assertDescriptor(descriptor: MicrosoftArtifactDescriptor): void {
  if (!descriptor || !['document', 'spreadsheet', 'presentation'].includes(descriptor.artifactType)) {
    fail('INVALID_DESCRIPTOR', 'artifactType is not a supported Microsoft creation type', 'artifactType');
  }
  if (FORMAT_BY_TYPE[descriptor.artifactType] !== descriptor.format) {
    fail('INVALID_DESCRIPTOR', 'format does not match artifactType', 'format');
  }
  if (!nonEmpty(descriptor.title) || descriptor.title.length > MAX_TITLE_LENGTH) {
    fail('INVALID_DESCRIPTOR', 'title is empty or exceeds the bounded length', 'title');
  }
  if (!(descriptor.content instanceof Uint8Array) || descriptor.content.byteLength > MAX_CONTENT_BYTES) {
    fail('INVALID_DESCRIPTOR', 'content must be bounded Uint8Array data', 'content');
  }
}

function assertBinding(request: MicrosoftCreateRequest): void {
  const { connection, tenantBinding, destination } = request;
  if (!nonEmpty(tenantBinding.tenantId) || !nonEmpty(tenantBinding.issuerForm)) {
    fail('INVALID_BINDING', 'tenant binding is required', 'tenantBinding');
  }
  if (connection.provider !== 'microsoft_365' || connection.revoked || connection.authState !== 'authorized') {
    fail('CONNECTION_NOT_READY', 'Microsoft connection is not authorized for creation');
  }
  if (connection.consentState !== 'not_required' && connection.consentState !== 'user_consented') {
    fail('CONNECTION_NOT_READY', 'Microsoft consent is not resolved for creation');
  }
  if (!connection.scopes.some((scope) => scope.kind === 'write' && scope.granted)) {
    fail('CONNECTION_NOT_READY', 'Microsoft write capability is not granted');
  }
  if (
    connection.tenantBinding.tenantId !== tenantBinding.tenantId ||
    connection.tenantBinding.issuerForm !== tenantBinding.issuerForm ||
    destination.tenantId !== tenantBinding.tenantId
  ) {
    fail('TENANT_MISMATCH', 'connection, binding, and destination tenant authorities disagree');
  }
  if (
    destination.connectionId !== connection.connectionId ||
    !nonEmpty(destination.destination.destinationId) ||
    destination.destination.workspaceId !== destination.workspaceId
  ) {
    fail('INVALID_DESTINATION', 'destination is not an exact resolved permitted destination');
  }
}

function assertProviderResult(result: MicrosoftCreateTransportResult): void {
  if (!result || (result.outcome !== 'created' && result.outcome !== 'existing')) {
    fail('MALFORMED_PROVIDER_RESPONSE', 'provider response has no valid creation outcome');
  }
  if (!nonEmpty(result.providerIdentity)) {
    fail('MALFORMED_PROVIDER_RESPONSE', 'provider response is missing opaque identity', 'providerIdentity');
  }
  if (!nonEmpty(result.revision)) {
    fail('MALFORMED_PROVIDER_RESPONSE', 'provider response is missing revision identity', 'revision');
  }
  if (!nonEmpty(result.providerUrl)) {
    fail('MALFORMED_PROVIDER_RESPONSE', 'provider response is missing provider URL', 'providerUrl');
  }
  try {
    const url = new URL(result.providerUrl);
    if (url.protocol !== 'https:') throw new Error('unsafe');
  } catch {
    fail('MALFORMED_PROVIDER_RESPONSE', 'provider URL is not a safe absolute HTTPS URL', 'providerUrl');
  }
}

export function createMicrosoftArtifact(
  transport: MicrosoftCreateTransport,
  request: MicrosoftCreateRequest,
): MicrosoftCreatedArtifact {
  if (!transport || typeof transport.create !== 'function') {
    fail('MALFORMED_PROVIDER_RESPONSE', 'an injected creation transport is required', 'transport');
  }
  assertDescriptor(request.descriptor);
  if (!nonEmpty(request.idempotencyKey)) fail('INVALID_DESCRIPTOR', 'idempotencyKey is required', 'idempotencyKey');
  assertBinding(request);

  // The transport owns idempotency reconciliation. An `existing` result is returned
  // without retrying, so this seam cannot duplicate a provider-side creation.
  const result = transport.create({
    descriptor: request.descriptor,
    destinationId: request.destination.destination.destinationId,
    tenantId: request.tenantBinding.tenantId,
    connectionId: request.connection.connectionId,
    idempotencyKey: request.idempotencyKey,
  });
  assertProviderResult(result);
  return {
    provider: 'microsoft_365',
    providerIdentity: result.providerIdentity,
    providerUrl: result.providerUrl,
    revision: result.revision,
    creationStatus: result.outcome,
    editorOpenProof: 'unproven',
  };
}
