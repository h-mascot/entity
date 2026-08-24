import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDocumentIntegrationsRepository, type DocumentIntegrationsRepository } from '../../../../db/src/document-integrations';
import type { MicrosoftConnectionSnapshot } from './connection';
import type { MicrosoftPermittedDestination, ResolvedMicrosoftDestination } from './destinations';
import {
  createMicrosoftArtifact,
  type MicrosoftArtifactDescriptor,
  type MicrosoftCreateTransportInput,
} from './create-adapter';

const binding = { tenantId: 'tenant-a', issuerForm: 'issuer-a' };
const connection: MicrosoftConnectionSnapshot = {
  connectionId: 'connection-a', provider: 'microsoft_365', tenantBinding: binding,
  secretReferences: { tokenRef: 'ref-token', clientSecretRef: 'ref-client' },
  scopes: [{ name: 'opaque-write', kind: 'write', granted: true }],
  authState: 'authorized', readinessState: 'ready', consentState: 'user_consented',
  entityMetadataJson: '{}', revoked: false, requiresAdminConsent: false,
};
const permitted: MicrosoftPermittedDestination = {
  destinationId: 'destination-a', workspaceId: 'workspace-a', tenantId: 'tenant-a', connectionId: 'connection-a',
  artifactTypes: new Set(['document', 'spreadsheet', 'presentation']),
  identity: { kind: 'onedrive', driveId: 'drive-a', ownerUserId: 'owner-a', siteId: null, libraryId: null },
  displayName: 'fixture', enabled: true,
};
const destination: ResolvedMicrosoftDestination = {
  workspaceId: 'workspace-a', tenantId: 'tenant-a', connectionId: 'connection-a', destination: permitted,
  observed: { requestedDestinationId: 'destination-a', outcome: 'resolved', observedIdentity: permitted.identity, observedTenantId: 'tenant-a', observedIssuer: 'issuer-a' },
};
const descriptors: readonly MicrosoftArtifactDescriptor[] = [
  { artifactType: 'document', format: 'docx', title: 'Doc', content: new Uint8Array([1]) },
  { artifactType: 'spreadsheet', format: 'xlsx', title: 'Sheet', content: new Uint8Array([2]) },
  { artifactType: 'presentation', format: 'pptx', title: 'Deck', content: new Uint8Array([3]) },
];

function transport(result: { outcome: 'created' | 'existing'; providerIdentity: string; providerUrl: string; revision: string } = { outcome: 'created', providerIdentity: 'opaque-item', providerUrl: 'https://provider.invalid/item', revision: 'rev-1' }) {
  const calls: MicrosoftCreateTransportInput[] = [];
  return { calls, create(input: MicrosoftCreateTransportInput) { calls.push(input); return result; } };
}
let db: Database.Database;
let repository: DocumentIntegrationsRepository;
beforeEach(() => { db?.close(); db = new Database(':memory:'); repository = createDocumentIntegrationsRepository(db); repository.ensureSchema(); });
function request(descriptor: MicrosoftArtifactDescriptor) {
  return { descriptor, connection, tenantBinding: binding, destination, idempotencyKey: 'idem-1', workspaceId: 'workspace-a', repository };
}

describe('T-022 Microsoft creation seam', () => {
  it.each(descriptors)('creates the $artifactType shape through injected transport only', (descriptor) => {
    const injected = transport();
    const result = createMicrosoftArtifact(injected, request(descriptor));
    expect(result).toMatchObject({ provider: 'microsoft_365', creationStatus: 'created', editorOpenProof: 'unproven', providerIdentity: 'opaque-item', revision: 'rev-1' });
    expect(injected.calls).toHaveLength(1);
    expect(injected.calls[0]?.descriptor).toEqual(descriptor);
  });

  it('returns an existing provider creation without retrying or minting an Entity id', () => {
    const injected = transport({ outcome: 'existing', providerIdentity: 'opaque-existing', providerUrl: 'https://provider.invalid/existing', revision: 'rev-2' });
    expect(createMicrosoftArtifact(injected, request(descriptors[0]!))).toMatchObject({ creationStatus: 'existing', providerIdentity: 'opaque-existing' });
    expect(injected.calls).toHaveLength(1);
  });

  it.each([
    ['tenant mismatch', { ...request(descriptors[0]!), tenantBinding: { tenantId: 'other', issuerForm: 'issuer-a' } }, 'TENANT_MISMATCH'],
    ['destination mismatch', { ...request(descriptors[0]!), destination: { ...destination, connectionId: 'other' } }, 'INVALID_DESTINATION'],
    ['observed tenant mismatch', { ...request(descriptors[0]!), destination: { ...destination, observed: { ...destination.observed, observedTenantId: 'other' } } }, 'TENANT_MISMATCH'],
    ['observed issuer mismatch', { ...request(descriptors[0]!), destination: { ...destination, observed: { ...destination.observed, observedIssuer: 'other' } } }, 'TENANT_MISMATCH'],
    ['observed destination echo mismatch', { ...request(descriptors[0]!), destination: { ...destination, observed: { ...destination.observed, requestedDestinationId: 'other' } } }, 'INVALID_DESTINATION'],
    ['observed identity mismatch', { ...request(descriptors[0]!), destination: { ...destination, observed: { ...destination.observed, observedIdentity: { ...permitted.identity, driveId: 'other' } } } }, 'INVALID_DESTINATION'],
    ['capability denied', { ...request(descriptors[0]!), connection: { ...connection, scopes: [] } }, 'CONNECTION_NOT_READY'],
    ['revoked', { ...request(descriptors[0]!), connection: { ...connection, revoked: true } }, 'CONNECTION_NOT_READY'],
    ['degraded readiness', { ...request(descriptors[0]!), connection: { ...connection, readinessState: 'degraded' } }, 'CONNECTION_NOT_READY'],
    ['unknown readiness', { ...request(descriptors[0]!), connection: { ...connection, readinessState: 'unknown' } }, 'CONNECTION_NOT_READY'],
  ] as const)('rejects %s before transport', (_name, input, code) => {
    const injected = transport();
    expect(() => createMicrosoftArtifact(injected, input)).toThrow(expect.objectContaining({ code }));
    expect(injected.calls).toHaveLength(0);
  });

  it.each([
    ['blank title', { ...descriptors[0]!, title: ' ' }],
    ['empty content', { ...descriptors[0]!, content: new Uint8Array() }],
    ['invalid key', { descriptor: descriptors[0]!, idempotencyKey: ' bad ' }],
  ] as const)('rejects bounded input %s before transport', (_name, input) => {
    const injected = transport();
    const candidate = 'descriptor' in input ? { ...request(input.descriptor), idempotencyKey: input.idempotencyKey } : request(input);
    expect(() => createMicrosoftArtifact(injected, candidate)).toThrow(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));
    expect(injected.calls).toHaveLength(0);
  });

  it('rejects mismatched artifact format before transport', () => {
    const injected = transport();
    expect(() => createMicrosoftArtifact(injected, request({ ...descriptors[0]!, format: 'xlsx' }))).toThrow(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));
    expect(injected.calls).toHaveLength(0);
  });

  it.each(['not-json', JSON.stringify({ provider: 'microsoft_365' }), JSON.stringify({ provider: 'microsoft_365', providerIdentity: 'x', providerUrl: 'http://unsafe', revision: 'r', creationStatus: 'created', editorOpenProof: 'unproven' })])('fails closed on invalid persisted replay result', (result_json) => {
    const injected = transport();
    const first = createMicrosoftArtifact(injected, request(descriptors[0]!));
    db.prepare('UPDATE document_operations SET result_json = ? WHERE workspace_id = ? AND idempotency_key = ?').run(result_json, 'workspace-a', 'idem-1');
    const freshRepository = createDocumentIntegrationsRepository(db);
    const replayTransport = transport();
    expect(() => createMicrosoftArtifact(replayTransport, { ...request(descriptors[0]!), repository: freshRepository })).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_UNCERTAIN' }));
    expect(replayTransport.calls).toHaveLength(0);
    expect(first.providerIdentity).toBe('opaque-item');
  });

  it('replays from a fresh repository/adapter instance without a provider call', () => {
    const firstTransport = transport();
    const first = createMicrosoftArtifact(firstTransport, request(descriptors[0]!));
    const freshRepository = createDocumentIntegrationsRepository(db);
    const secondTransport = transport();
    const replay = createMicrosoftArtifact(secondTransport, { ...request(descriptors[0]!), repository: freshRepository });
    expect(replay).toEqual(first);
    expect(secondTransport.calls).toHaveLength(0);
  });

  it('isolates identical keys across workspaces', () => {
    const firstTransport = transport();
    createMicrosoftArtifact(firstTransport, request(descriptors[0]!));
    const otherTransport = transport();
    const other = createMicrosoftArtifact(otherTransport, { ...request(descriptors[0]!), workspaceId: 'workspace-b' });
    expect(other.providerIdentity).toBe('opaque-item');
    expect(otherTransport.calls).toHaveLength(1);
  });

  it('does not silently duplicate or accept conflicting reuse of an idempotency key', () => {
    const injected = transport();
    const first = createMicrosoftArtifact(injected, request(descriptors[0]!));
    expect(createMicrosoftArtifact(injected, request(descriptors[0]!))).toEqual(first);
    expect(() => createMicrosoftArtifact(injected, { ...request(descriptors[0]!), descriptor: descriptors[1]! })).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    expect(injected.calls).toHaveLength(1);
  });

  it('does not fabricate success after a transport throw that may have created remotely', () => {
    const injected = { calls: [] as MicrosoftCreateTransportInput[], create(input: MicrosoftCreateTransportInput) { this.calls.push(input); throw new Error('provider uncertain'); } };
    expect(() => createMicrosoftArtifact(injected, request(descriptors[0]!))).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_UNCERTAIN' }));
    const freshTransport = transport();
    const freshRepository = createDocumentIntegrationsRepository(db);
    expect(() => createMicrosoftArtifact(freshTransport, { ...request(descriptors[0]!), repository: freshRepository })).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_UNCERTAIN' }));
    expect(injected.calls).toHaveLength(1);
    expect(freshTransport.calls).toHaveLength(0);
  });

  it.each([
    ['identity', { providerIdentity: '', providerUrl: 'https://provider.invalid/item', revision: 'rev' }],
    ['url', { providerIdentity: 'opaque', providerUrl: 'http://unsafe', revision: 'rev' }],
    ['revision', { providerIdentity: 'opaque', providerUrl: 'https://provider.invalid/item', revision: '' }],
  ] as const)('rejects malformed provider %s response after one transport call', (_name, result) => {
    const injected = transport({ outcome: 'created', ...result });
    expect(() => createMicrosoftArtifact(injected, request(descriptors[0]!))).toThrow(expect.objectContaining({ code: 'MALFORMED_PROVIDER_RESPONSE' }));
    const freshTransport = transport();
    const freshRepository = createDocumentIntegrationsRepository(db);
    expect(() => createMicrosoftArtifact(freshTransport, { ...request(descriptors[0]!), repository: freshRepository })).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_UNCERTAIN' }));
    expect(injected.calls).toHaveLength(1);
    expect(freshTransport.calls).toHaveLength(0);
  });
});
