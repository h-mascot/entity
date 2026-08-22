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
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]+$/;

type IdempotencyLedgerEntry =
  | { state: 'in_flight'; fingerprint: string }
  | { state: 'completed'; fingerprint: string; result: MicrosoftCreatedArtifact }
  | { state: 'uncertain'; fingerprint: string };

const idempotencyLedgers = new WeakMap<MicrosoftCreateTransport, Map<string, IdempotencyLedgerEntry>>();

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
    | 'IDEMPOTENCY_CONFLICT'
    | 'IDEMPOTENCY_UNCERTAIN'
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

function exactString(value: unknown): value is string {
  return nonEmpty(value) && value.trim() === value;
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
  if (!exactString(descriptor.title) || descriptor.title.length > MAX_TITLE_LENGTH) {
    fail('INVALID_DESCRIPTOR', 'title must be a trimmed, bounded non-empty string', 'title');
  }
  if (!(descriptor.content instanceof Uint8Array) || descriptor.content.byteLength === 0 || descriptor.content.byteLength > MAX_CONTENT_BYTES) {
    fail('INVALID_DESCRIPTOR', 'content must be non-empty bounded Uint8Array data', 'content');
  }
}

function assertBinding(request: MicrosoftCreateRequest): void {
  const { connection, tenantBinding, destination } = request;
  if (!nonEmpty(tenantBinding.tenantId) || !nonEmpty(tenantBinding.issuerForm)) {
    fail('INVALID_BINDING', 'tenant binding is required', 'tenantBinding');
  }
  if (
    connection.provider !== 'microsoft_365' ||
    connection.revoked ||
    connection.authState !== 'authorized' ||
    connection.readinessState !== 'ready'
  ) {
    fail('CONNECTION_NOT_READY', 'Microsoft connection is not exactly ready and authorized for creation');
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
    destination.tenantId !== tenantBinding.tenantId ||
    destination.observed.observedTenantId !== tenantBinding.tenantId ||
    destination.observed.observedIssuer !== tenantBinding.issuerForm
  ) {
    fail('TENANT_MISMATCH', 'connection, binding, destination, and observed tenant authorities disagree');
  }
  const permitted = destination.destination;
  const observed = destination.observed;
  const identityMatches = Object.entries(permitted.identity).every(([axis, value]) =>
    observed.observedIdentity[axis as keyof typeof observed.observedIdentity] === value,
  );
  if (
    destination.connectionId !== connection.connectionId ||
    destination.workspaceId !== permitted.workspaceId ||
    !exactString(permitted.destinationId) ||
    permitted.tenantId !== tenantBinding.tenantId ||
    permitted.connectionId !== connection.connectionId ||
    observed.requestedDestinationId !== permitted.destinationId ||
    !permitted.enabled ||
    !permitted.artifactTypes.has(request.descriptor.artifactType) ||
    !identityMatches
  ) {
    fail('INVALID_DESTINATION', 'destination is not an exact resolved permitted destination');
  }
}

function descriptorFingerprint(request: MicrosoftCreateRequest): string {
  const bytes = Buffer.from(request.descriptor.content).toString('base64');
  return JSON.stringify({
    artifactType: request.descriptor.artifactType,
    format: request.descriptor.format,
    title: request.descriptor.title,
    content: bytes,
    destinationId: request.destination.destination.destinationId,
    tenantId: request.tenantBinding.tenantId,
    connectionId: request.connection.connectionId,
  });
}

function assertIdempotencyKey(key: unknown): asserts key is string {
  if (!exactString(key) || key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    fail('INVALID_DESCRIPTOR', 'idempotencyKey must be a bounded printable non-whitespace string', 'idempotencyKey');
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
  assertIdempotencyKey(request.idempotencyKey);
  assertBinding(request);

  const fingerprint = descriptorFingerprint(request);
  let ledger = idempotencyLedgers.get(transport);
  if (!ledger) {
    ledger = new Map();
    idempotencyLedgers.set(transport, ledger);
  }
  const prior = ledger.get(request.idempotencyKey);
  if (prior && prior.fingerprint !== fingerprint) {
    fail('IDEMPOTENCY_CONFLICT', 'idempotencyKey was already used for a different creation request', 'idempotencyKey');
  }
  if (prior?.state === 'completed') return prior.result;
  if (prior?.state === 'in_flight') {
    fail('IDEMPOTENCY_UNCERTAIN', 'creation is already in flight for this idempotency key; reconciliation is required before retry', 'idempotencyKey');
  }
  if (prior?.state === 'uncertain') {
    fail('IDEMPOTENCY_UNCERTAIN', 'prior transport outcome is uncertain; reconciliation is required before retry', 'idempotencyKey');
  }
  ledger.set(request.idempotencyKey, { state: 'in_flight', fingerprint });

  let result: MicrosoftCreateTransportResult;
  try {
    result = transport.create({
      descriptor: request.descriptor,
      destinationId: request.destination.destination.destinationId,
      tenantId: request.tenantBinding.tenantId,
      connectionId: request.connection.connectionId,
      idempotencyKey: request.idempotencyKey,
    });
  } catch (error) {
    // A synchronous throw may follow a provider-side create. Never retry or fabricate a
    // successful artifact; require an explicit provider reconciliation before reuse.
    ledger.set(request.idempotencyKey, { state: 'uncertain', fingerprint });
    throw error;
  }
  try {
    assertProviderResult(result);
  } catch (error) {
    ledger.set(request.idempotencyKey, { state: 'uncertain', fingerprint });
    throw error;
  }
  const created: MicrosoftCreatedArtifact = {
    provider: 'microsoft_365',
    providerIdentity: result.providerIdentity,
    providerUrl: result.providerUrl,
    revision: result.revision,
    creationStatus: result.outcome,
    editorOpenProof: 'unproven',
  };
  ledger.set(request.idempotencyKey, { state: 'completed', fingerprint, result: created });
  return created;
}
