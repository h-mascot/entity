import { describe, expect, it } from 'vitest';
import type { CapabilityReport, CapabilityState, CapabilityType, ResolvedCapability } from '../types';
import { CAPABILITY_NAMES } from '../types';
import { normalizeMicrosoftReadState } from './read-state';
import { createMicrosoftReconciler } from './reconciler';
import type { MicrosoftProviderItemEvidence } from './read-state';

function report(overrides: Partial<Record<CapabilityType, CapabilityState>> = {}): CapabilityReport {
  const result = {} as Record<CapabilityType, ResolvedCapability>;
  for (const name of CAPABILITY_NAMES) result[name] = { name, state: overrides[name] ?? 'unsupported', source: 'adapter' };
  return result as CapabilityReport;
}
const item = (overrides: Partial<MicrosoftProviderItemEvidence> = {}): MicrosoftProviderItemEvidence => ({
  provider: 'microsoft_365', artifactType: 'document', externalId: 'item-1', eTag: '2',
  webUrl: 'https://provider.invalid/item-1', thumbnailUrl: 'https://provider.invalid/thumb-1',
  permissions: [{ type: 'user', scope: 'organization' }], ...overrides,
});
function registry(initial: { workspaceId: string; currentRevision: string | null; providerUrl?: string | null; changeToken?: string | null }[]) {
  const records = initial.map((record, index) => ({ ...record, id: `doc-${index}`, externalId: index ? 'other' : 'item-1', previewState: 'unsupported' as const, previewUrl: null, providerUrl: record.providerUrl ?? null, permissionsSummary: 'Unknown', changeToken: record.changeToken ?? null }));
  return { records, find(workspaceId: string, externalId: string) { return records.find((record) => record.workspaceId === workspaceId && record.externalId === externalId); }, update(_workspaceId: string, id: string, patch: Record<string, unknown>) { const record = records.find((candidate) => candidate.id === id); if (record) Object.assign(record, patch); } };
}

describe('T-024 Microsoft versions/permissions/open/change state', () => {
  it('normalizes provider-evidenced versions, permissions summary, preview, and open link', () => {
    const state = normalizeMicrosoftReadState({ capabilityReport: report({ version_history: 'supported', permission_read: 'supported', preview: 'supported', open_external: 'supported', change_tracking: 'supported' }), item: item({ versions: [{ id: 'v1', lastModifiedDateTime: '2026-01-01T00:00:00Z', size: 12 }], deltaLink: 'delta-token' }) });
    expect(state.document).toBe('available'); expect(state.versions).toEqual([{ id: 'v1', modifiedAt: '2026-01-01T00:00:00Z', size: 12 }]);
    expect(state.permissions).toMatchObject({ summary: 'Organization-shared', complete: false, derivable: true });
    expect(state.preview).toBe('ready'); expect(state.canOpen).toBe(true); expect(state.changeToken).toBe('delta-token');
  });
  it('keeps preview unavailable distinct from document unavailable and does not fabricate open data', () => {
    const state = normalizeMicrosoftReadState({ capabilityReport: report({ open_external: 'supported', preview: 'unsupported' }), item: item({ thumbnailUrl: null, webUrl: null, sharedUrl: null }) });
    expect(state.document).toBe('available'); expect(state.previewUnavailable).toBe(true); expect(state.document).not.toBe('unavailable'); expect(state.canOpen).toBe(false);
    const missing = normalizeMicrosoftReadState({ capabilityReport: report(), item: item({ externalId: '' }) });
    expect(missing.document).toBe('unavailable'); expect(missing.previewUnavailable).toBe(false);
  });
  it('reconciles a provider revision only within the requested workspace', async () => {
    const store = registry([{ workspaceId: 'workspace-a', currentRevision: '1' }, { workspaceId: 'workspace-b', currentRevision: '9' }]);
    const result = await createMicrosoftReconciler({ source: { async poll() { return { items: [item({ eTag: '2' }), item({ externalId: 'other', eTag: '10' })], watchActive: true }; } }, registry: store, compareRevisions: (a, b) => Number(a) - Number(b) }).reconcile('workspace-a');
    expect(result.applied).toBe(1); expect(store.records[0]!.currentRevision).toBe('2'); expect(store.records[1]!.currentRevision).toBe('9');
  });
  it('preserves optional metadata when forward evidence omits it', async () => {
    const store = registry([{ workspaceId: 'workspace-a', currentRevision: '1', providerUrl: 'https://provider.invalid/old', changeToken: 'delta-old' }]);
    const result = await createMicrosoftReconciler({ source: { async poll() { return { items: [item({ eTag: '2', webUrl: undefined, deltaLink: undefined })], watchActive: true }; } }, registry: store, compareRevisions: (a, b) => Number(a) - Number(b) }).reconcile('workspace-a');
    expect(result.applied).toBe(1);
    expect(store.records[0]).toMatchObject({ currentRevision: '2', providerUrl: 'https://provider.invalid/old', changeToken: 'delta-old' });
  });
  it('rejects unsafe provider URLs without persisting them', async () => {
    const store = registry([{ workspaceId: 'workspace-a', currentRevision: '1' }]);
    const result = await createMicrosoftReconciler({ source: { async poll() { return { items: [item({ eTag: '2', webUrl: 'http://unsafe.invalid/item-1' })], watchActive: true }; } }, registry: store, compareRevisions: (a, b) => Number(a) - Number(b) }).reconcile('workspace-a');
    expect(result.applied).toBe(1);
    expect(store.records[0]!.providerUrl).toBeNull();
    expect(store.records[0]!.providerUrl).not.toBe('http://unsafe.invalid/item-1');
  });
  it('degrades on unavailable change tracking and never writes', async () => {
    const store = registry([{ workspaceId: 'workspace-a', currentRevision: '1' }]);
    const result = await createMicrosoftReconciler({ source: { async poll() { throw new Error('unavailable'); } }, registry: store, compareRevisions: () => 1 }).reconcile('workspace-a');
    expect(result.health.state).toBe('degraded'); expect(result.applied).toBe(0); expect(store.records[0]!.currentRevision).toBe('1');
  });
});
