import { describe, expect, it } from 'vitest';
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
function request(descriptor: MicrosoftArtifactDescriptor) {
  return { descriptor, connection, tenantBinding: binding, destination, idempotencyKey: 'idem-1' };
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
    ['capability denied', { ...request(descriptors[0]!), connection: { ...connection, scopes: [] } }, 'CONNECTION_NOT_READY'],
    ['revoked', { ...request(descriptors[0]!), connection: { ...connection, revoked: true } }, 'CONNECTION_NOT_READY'],
  ] as const)('rejects %s before transport', (_name, input, code) => {
    const injected = transport();
    expect(() => createMicrosoftArtifact(injected, input)).toThrow(expect.objectContaining({ code }));
    expect(injected.calls).toHaveLength(0);
  });

  it('rejects mismatched artifact format before transport', () => {
    const injected = transport();
    expect(() => createMicrosoftArtifact(injected, request({ ...descriptors[0]!, format: 'xlsx' }))).toThrow(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));
    expect(injected.calls).toHaveLength(0);
  });

  it.each([
    ['identity', { providerIdentity: '', providerUrl: 'https://provider.invalid/item', revision: 'rev' }],
    ['url', { providerIdentity: 'opaque', providerUrl: 'http://unsafe', revision: 'rev' }],
    ['revision', { providerIdentity: 'opaque', providerUrl: 'https://provider.invalid/item', revision: '' }],
  ] as const)('rejects malformed provider %s response after one transport call', (_name, result) => {
    const injected = transport({ outcome: 'created', ...result });
    expect(() => createMicrosoftArtifact(injected, request(descriptors[0]!))).toThrow(expect.objectContaining({ code: 'MALFORMED_PROVIDER_RESPONSE' }));
    expect(injected.calls).toHaveLength(1);
  });
});
