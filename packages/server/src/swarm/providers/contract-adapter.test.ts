/**
 * EEPC-A-04 — Swarm contract adapter proofs.
 */
import { describe, expect, it, vi } from 'vitest';
import { parseExecutionEngineManifest } from '../manifest';
import { getValidatedManifestByProvider } from '../callback-intake/manifest-catalog';
import {
  createSwarmContractAdapter,
  projectProviderHealth,
  redactPublicHealthMessage,
} from './contract-adapter';
import {
  BUILTIN_SWARM_PROVIDER_ORDER,
  isSwarmContractAdapter,
  registerBuiltinContractProviders,
} from './contract-bootstrap';
import type { SwarmProvider } from './interface';
import { listProviders, getProvider, checkProviderHealth } from '../dispatcher';

function fakeProvider(overrides: Partial<SwarmProvider> = {}): SwarmProvider {
  return {
    name: 'acp',
    label: 'Fake ACP',
    healthCheck: vi.fn(async () => ({
      available: true,
      message: 'ACP reachable at http://localhost:8100 under /Users/enterprise/secret-home',
      latencyMs: 12,
    })),
    dispatch: vi.fn(async () => ({ runHandle: 'run-1' })),
    status: vi.fn(async () => ({ state: 'running' as const, progress: 'working' })),
    cancel: vi.fn(async () => undefined),
    collectProof: vi.fn(async () => ({
      commitSha: 'abcdef0123456789',
      branch: 'feat/adapter',
      testResult: 'pass' as const,
      screenshots: ['https://example.com/shot.png', '/var/tmp/private.png'],
      artifacts: {
        note: 'ok',
        api_key: 'should-not-leak',
        token: 'Bearer abcdefghijklmnopqrstuvwxyz012345',
      },
    })),
    ...overrides,
  };
}

describe('EEPC-A-04 Swarm contract adapter', () => {
  it('binds builtin providers to validated manifests in inventory order', () => {
    const registry = {
      providers: [] as SwarmProvider[],
      register(provider: SwarmProvider) {
        this.providers.push(provider);
      },
    };
    const result = registerBuiltinContractProviders(registry);
    expect(result.skipped).toEqual([]);
    expect(result.registered).toEqual([...BUILTIN_SWARM_PROVIDER_ORDER]);
    expect(registry.providers.map((p) => p.name)).toEqual([...BUILTIN_SWARM_PROVIDER_ORDER]);
    for (const provider of registry.providers) {
      expect(isSwarmContractAdapter(provider)).toBe(true);
      if (isSwarmContractAdapter(provider)) {
        expect(provider.engineId).toMatch(/^swarm\./);
        expect(provider.manifest.identity.name).toBe(provider.name);
        expect(provider.meta?.acceptsDispatch).toBe(provider.manifest.execution.acceptsDispatch);
      }
    }
  });

  it('dispatcher bootstrap exposes contract-bound providers with meta and no secret keys', () => {
    const providers = listProviders();
    expect(providers.map((p) => p.name).sort()).toEqual(
      [...BUILTIN_SWARM_PROVIDER_ORDER].slice().sort(),
    );
    for (const entry of providers) {
      expect(entry.meta).toBeDefined();
      expect(entry.meta?.acceptsDispatch).toBeTypeOf('boolean');
    }
    const serialized = JSON.stringify(providers);
    expect(serialized).not.toMatch(/SYMPHONY_API_KEY|api_key|Bearer |sk-/i);

    const acp = getProvider('acp');
    expect(isSwarmContractAdapter(acp)).toBe(true);
  });

  it('applies afterDispatch status mapping when provider omits jobStatus', async () => {
    const manifest = getValidatedManifestByProvider('acp')!;
    const inner = fakeProvider({
      dispatch: vi.fn(async () => ({ runHandle: 'run-acp' })),
    });
    const bound = createSwarmContractAdapter(inner, manifest);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const result = await bound.adapter.dispatch({
      jobId: 'job-1',
      title: 't',
      spec: 's',
      repo: '/repo',
    });
    expect(result.runHandle).toBe('run-acp');
    expect(result.jobStatus).toBe('running');
    expect(bound.adapter.afterDispatchStatus()).toBe('running');
    expect(bound.adapter.mapRunStateToJobStatus('completed')).toBe('proof');
  });

  it('pull provider (symphony) maps afterDispatch to queued', async () => {
    const manifest = getValidatedManifestByProvider('symphony')!;
    const inner = fakeProvider({
      name: 'symphony',
      dispatch: vi.fn(async () => ({
        runHandle: 'symphony-pull:job-9',
        jobStatus: 'queued' as const,
      })),
    });
    const bound = createSwarmContractAdapter(inner, manifest);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const result = await bound.adapter.dispatch({
      jobId: 'job-9',
      title: 't',
      spec: 's',
      repo: '/repo',
    });
    expect(result.jobStatus).toBe('queued');
    expect(bound.adapter.manifest.execution.expectsClaimCallbacks).toBe(true);
  });

  it('fail-closed: stub providers refuse dispatch under contract', async () => {
    const manifest = getValidatedManifestByProvider('ccp')!;
    const inner = fakeProvider({
      name: 'ccp',
      dispatch: vi.fn(async () => ({ runHandle: 'should-not-run' })),
    });
    const bound = createSwarmContractAdapter(inner, manifest);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    await expect(
      bound.adapter.dispatch({
        jobId: 'job-stub',
        title: 't',
        spec: 's',
        repo: '/repo',
      }),
    ).rejects.toThrow(/refuses dispatch/);
    expect(inner.dispatch).not.toHaveBeenCalled();
  });

  it('fail-closed: missing manifest / identity mismatch / malformed dispatch', async () => {
    const inner = fakeProvider();
    expect(createSwarmContractAdapter(inner, null).ok).toBe(false);
    expect(createSwarmContractAdapter(inner, undefined).ok).toBe(false);

    const acpManifest = getValidatedManifestByProvider('acp')!;
    const mismatch = createSwarmContractAdapter(
      fakeProvider({ name: 'symphony' }),
      acpManifest,
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.issues.some((i) => i.code === 'provider_manifest_mismatch')).toBe(true);
    }

    const broken = createSwarmContractAdapter(
      fakeProvider({
        dispatch: vi.fn(async () => ({ runHandle: '   ' })),
      }),
      acpManifest,
    );
    expect(broken.ok).toBe(true);
    if (!broken.ok) return;
    await expect(
      broken.adapter.dispatch({
        jobId: 'job-bad',
        title: 't',
        spec: 's',
        repo: '/repo',
      }),
    ).rejects.toThrow(/missing runHandle/);
  });

  it('fail-closed: invalid kind manifest is rejected', () => {
    const raw = structuredClone(getValidatedManifestByProvider('acp')!) as unknown as Record<
      string,
      unknown
    >;
    raw.kind = 'not-an-engine';
    // Bypass parse — adapter must still refuse bad kind objects.
    const result = createSwarmContractAdapter(fakeProvider(), raw as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'manifest_kind_invalid')).toBe(true);
    }
  });

  it('public health projection redacts urls/paths and respects publicFields', async () => {
    const manifest = getValidatedManifestByProvider('acp')!;
    const inner = fakeProvider();
    const bound = createSwarmContractAdapter(inner, manifest);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const publicHealth = await bound.adapter.projectPublicHealth();
    expect(publicHealth.available).toBe(true);
    expect(publicHealth.latencyMs).toBe(12);
    expect(publicHealth.message).toContain('[redacted-url]');
    expect(publicHealth.message).toContain('[redacted-path]');
    expect(publicHealth.message).not.toContain('http://');
    expect(publicHealth.message).not.toContain('/Users/enterprise');

    // Legacy healthCheck remains unredacted for internal diagnostics.
    const legacy = await bound.adapter.healthCheck();
    expect(legacy.message).toContain('http://localhost:8100');
  });

  it('ccp public health omits latencyMs when not in publicFields', () => {
    const manifest = getValidatedManifestByProvider('ccp')!;
    const projected = projectProviderHealth(
      { available: false, message: 'pending', latencyMs: 99 },
      manifest,
    );
    expect(projected).toEqual({ available: false, message: 'pending' });
    expect('latencyMs' in projected).toBe(false);
  });

  it('maps provider status/proof into EEPC-A-03 callback payloads without secrets', () => {
    const manifest = getValidatedManifestByProvider('acp')!;
    const bound = createSwarmContractAdapter(fakeProvider(), manifest);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const statusMapped = bound.adapter.toStatusCallbackPayload({
      jobId: 'job-42',
      runStatus: { state: 'completed', progress: 'done' },
    });
    expect(statusMapped.ok).toBe(true);
    if (!statusMapped.ok) return;
    expect(statusMapped.payload).toMatchObject({
      event: 'status',
      provider: 'acp',
      jobId: 'job-42',
      status: {
        summary: 'done',
        run_state: 'completed',
        status: 'proof',
      },
    });

    const proofMapped = bound.adapter.toProofCallbackPayload({
      jobId: 'job-42',
      proof: {
        commitSha: 'abcdef0123456789',
        branch: 'feat/adapter',
        testResult: 'pass',
        screenshots: ['https://example.com/shot.png', '/var/tmp/private.png'],
      },
    });
    expect(proofMapped.ok).toBe(true);
    if (!proofMapped.ok) return;
    expect(proofMapped.payload.proof?.artifact_refs).toEqual(['https://example.com/shot.png']);
    expect(JSON.stringify(proofMapped.payload)).not.toContain('/var/tmp');
  });

  it('fail-closed: secret-like status summary and private-only proof artifacts', () => {
    const manifest = getValidatedManifestByProvider('acp')!;
    const bound = createSwarmContractAdapter(fakeProvider(), manifest);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const secretStatus = bound.adapter.toStatusCallbackPayload({
      jobId: 'job-x',
      runStatus: { state: 'failed' },
      summary: 'Bearer abcdefghijklmnopqrstuvwxyz01234567',
    });
    expect(secretStatus.ok).toBe(false);

    const privateProof = bound.adapter.toProofCallbackPayload({
      jobId: 'job-x',
      proof: { screenshots: ['/tmp/private-log.txt', 'file:///etc/passwd'] },
    });
    expect(privateProof.ok).toBe(false);
    if (!privateProof.ok) {
      expect(privateProof.code).toBe('proof_not_public_safe');
    }
  });

  it('collectProof strips secret-bearing artifact keys', async () => {
    const manifest = getValidatedManifestByProvider('acp')!;
    const bound = createSwarmContractAdapter(fakeProvider(), manifest);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const proof = await bound.adapter.collectProof('run-1');
    expect(proof.artifacts).toEqual({ note: 'ok' });
    expect(proof.screenshots).toEqual(['https://example.com/shot.png']);
  });

  it('redact helper refuses entire secret-shaped messages', () => {
    const manifest = parseExecutionEngineManifest(
      structuredClone(getValidatedManifestByProvider('acp')!),
    );
    expect(
      redactPublicHealthMessage('Bearer abcdefghijklmnopqrstuvwxyz01234567', manifest),
    ).toBe('[redacted]');
  });

  it('live stub health remains unavailable and secret-safe via dispatcher', async () => {
    for (const name of ['ccp', 'flywheel'] as const) {
      const health = await checkProviderHealth(name);
      expect(health.available).toBe(false);
      expect(JSON.stringify(health)).not.toMatch(/api_key|Bearer |token=/i);
      const provider = getProvider(name);
      expect(isSwarmContractAdapter(provider)).toBe(true);
      if (isSwarmContractAdapter(provider)) {
        const projected = await provider.projectPublicHealth(health);
        expect(projected.available).toBe(false);
      }
    }
  });
});
