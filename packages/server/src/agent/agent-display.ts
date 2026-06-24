import type { AgentRegistryRecord } from "../../../db/src";

function present(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function mergeRegistryAgentDisplay(input: {
  entry: Record<string, unknown>;
  registryAgent?: AgentRegistryRecord;
  capabilities?: unknown;
}): Record<string, unknown> {
  const { entry, registryAgent, capabilities } = input;
  if (!registryAgent) {
    return {
      ...entry,
      avatarUrl: present(entry.avatarUrl) ?? present(entry.avatar_url),
      capabilities: capabilities ?? entry.capabilities,
    };
  }

  const agentRuntime = present(registryAgent.adapter_type);
  const runtimeType = present(registryAgent.runtime_type);
  const runtimeBindingId = present(registryAgent.runtime_binding_id);
  const avatarUrl =
    present(registryAgent.avatar_url) ??
    present(entry.avatarUrl) ??
    present(entry.avatar_url);

  return {
    ...entry,
    id: registryAgent.id,
    slug: registryAgent.slug,
    name: registryAgent.name,
    emoji: registryAgent.emoji,
    description: present(registryAgent.description) ?? present(entry.description),
    avatar_url: registryAgent.avatar_url,
    avatarUrl,
    adapter_type: agentRuntime ?? null,
    adapterType: agentRuntime,
    agent_runtime: agentRuntime ?? null,
    agentRuntime,
    runtime_type: runtimeType ?? null,
    runtimeType,
    runtime_binding_id: runtimeBindingId ?? null,
    runtimeBindingId,
    provider_type: registryAgent.provider_type,
    providerType: registryAgent.provider_type,
    helm_managed: registryAgent.helm_managed,
    helmManaged: registryAgent.helm_managed,
    binding_state: registryAgent.binding_state,
    bindingState: registryAgent.binding_state,
    capabilities: capabilities ?? entry.capabilities,
  };
}
