import { describe, expect, it, vi } from 'vitest';
import type { AgentRegistryRecord } from '../../../db/src';
import { createHelmLightControlAdapter } from './helm-light-controls';

const now = new Date('2026-07-01T12:00:00.000Z');

function agent(overrides: Partial<AgentRegistryRecord> = {}): AgentRegistryRecord {
  return {
    id: 'geordi',
    slug: 'geordi',
    name: 'Geordi',
    emoji: 'G',
    avatar_url: null,
    description: null,
    adapter_type: 'helm',
    runtime_type: 'remote',
    runtime_binding_id: 'runtime-geordi',
    provider_type: 'helm_runtime',
    helm_managed: true,
    binding_state: 'bound',
    status: 'active',
    instructions_path: null,
    metadata_json: '{}',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...overrides,
  };
}

describe('createHelmLightControlAdapter', () => {
  it.each([
    { patch: { helm_managed: false }, reason: 'not_helm_managed' },
    { patch: { runtime_binding_id: null }, reason: 'missing_runtime_binding_id' },
    { patch: { binding_state: 'stale' as const }, reason: 'runtime_binding_stale' },
    { patch: { binding_state: 'unbound' as const }, reason: 'runtime_binding_unbound' },
  ])('denies reversible controls when policy returns $reason', async ({ patch, reason }) => {
    const provider = { sendControl: vi.fn() };
    const adapter = createHelmLightControlAdapter({ provider, now: () => now });

    await expect(adapter.requestControl(agent(patch), 'pause', 'principal-1')).resolves.toMatchObject({
      accepted: false,
      status: 'denied',
      action: 'pause',
      reason,
      helm_link: null,
      audit: {
        policy_allowed: false,
        policy_reason: reason,
        forwarded_to_helm: false,
        created_at: now.toISOString(),
      },
    });
    expect(provider.sendControl).not.toHaveBeenCalled();
  });

  it('forwards allowed controls with a complete audit record and normalized Helm link', async () => {
    const provider = {
      sendControl: vi.fn(async () => ({ helmLink: ' https://helm.example/runtimes/runtime-geordi ' })),
    };
    const adapter = createHelmLightControlAdapter({ provider, now: () => now });

    const result = await adapter.requestControl(agent(), 'resume', '');

    expect(result).toMatchObject({
      accepted: true,
      status: 'accepted',
      action: 'resume',
      reason: 'policy_allowed_reversible_control',
      helm_link: 'https://helm.example/runtimes/runtime-geordi',
      audit: {
        event_type: 'helm_light_control_requested',
        agent_id: 'geordi',
        action: 'resume',
        actor_principal_id: 'unknown',
        runtime_binding_id: 'runtime-geordi',
        policy_allowed: true,
        policy_reason: 'policy_allowed_reversible_control',
        forwarded_to_helm: true,
        created_at: now.toISOString(),
      },
    });
    expect(provider.sendControl).toHaveBeenCalledWith('runtime-geordi', 'resume', result.audit);
  });

  it('returns unavailable without forwarding when Helm control provider is missing', async () => {
    const adapter = createHelmLightControlAdapter({ now: () => now });

    await expect(adapter.requestControl(agent(), 'request_retry', 'principal-1')).resolves.toMatchObject({
      accepted: false,
      status: 'unavailable',
      action: 'request_retry',
      reason: 'helm_control_provider_unavailable',
      helm_link: null,
      audit: {
        policy_allowed: true,
        policy_reason: 'helm_control_provider_unavailable',
        forwarded_to_helm: false,
      },
    });
  });

  it('converts provider failures into degraded unavailable results without leaking a forwarded audit', async () => {
    const provider = {
      sendControl: vi.fn(async () => {
        throw new Error('network timeout');
      }),
    };
    const adapter = createHelmLightControlAdapter({ provider, now: () => now });

    await expect(adapter.requestControl(agent(), 'pause', 'principal-1')).resolves.toMatchObject({
      accepted: false,
      status: 'unavailable',
      reason: 'helm_control_provider_unavailable',
      helm_link: null,
      audit: {
        policy_allowed: true,
        policy_reason: 'helm_control_provider_unavailable',
        forwarded_to_helm: false,
      },
    });
    expect(provider.sendControl).toHaveBeenCalledOnce();
  });

  it('only accepts http and https Helm links from provider payloads', async () => {
    const adapter = createHelmLightControlAdapter({
      now: () => now,
      provider: { sendControl: vi.fn(async () => ({ url: 'javascript:alert(1)' })) },
    });

    await expect(adapter.requestControl(agent(), 'pause', 'principal-1')).resolves.toMatchObject({
      accepted: true,
      status: 'accepted',
      helm_link: null,
    });
  });
});
