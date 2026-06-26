import { describe, expect, it } from "vitest";
import type { AgentRegistryRecord } from "../../../db/src";
import { createHelmStatusAdapter } from "./helm-status-adapter";

const now = new Date("2026-06-24T05:15:00.000Z");

function agent(overrides: Partial<AgentRegistryRecord> = {}): AgentRegistryRecord {
  return {
    id: "book",
    slug: "book",
    name: "Book",
    emoji: "B",
    avatar_url: null,
    description: null,
    adapter_type: "helm",
    runtime_type: "remote",
    runtime_binding_id: "runtime-book",
    provider_type: "helm_runtime",
    helm_managed: true,
    binding_state: "bound",
    status: "active",
    instructions_path: null,
    metadata_json: "{}",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...overrides,
  };
}

describe("createHelmStatusAdapter", () => {
  it("returns a safe reachable Helm health summary keyed by runtime binding id", async () => {
    const adapter = createHelmStatusAdapter({
      now: () => now,
      provider: {
        readStatus: async (bindingId) => ({
          bindingId,
          health: "healthy",
          readiness: "ready",
          currentWork: { title: "Review THE-72 proof" },
          heartbeatAt: "2026-06-24T05:14:30.000Z",
          checkedAt: "2026-06-24T05:14:45.000Z",
          helmLink: "https://helm.example/runtimes/runtime-book",
        }),
      },
    });

    await expect(adapter.getStatus(agent())).resolves.toMatchObject({
      source: "helm",
      binding_id: "runtime-book",
      state: "healthy",
      health: "healthy",
      readiness: "ready",
      current_work: "Review THE-72 proof",
      heartbeat_at: "2026-06-24T05:14:30.000Z",
      checked_at: "2026-06-24T05:14:45.000Z",
      stale: false,
      reason: "helm_status_reachable",
      helm_link: "https://helm.example/runtimes/runtime-book",
    });
  });

  it("does not fake health for unavailable or stale bindings", async () => {
    const adapter = createHelmStatusAdapter({ now: () => now });

    await expect(adapter.getStatus(agent({ runtime_binding_id: null }))).resolves.toMatchObject({
      state: "unknown",
      health: "unknown",
      readiness: "unknown",
      reason: "missing_runtime_binding_id",
    });
    await expect(adapter.getStatus(agent({ binding_state: "stale" }))).resolves.toMatchObject({
      state: "degraded",
      health: "degraded",
      readiness: "degraded",
      stale: true,
      reason: "stale_runtime_binding",
    });
    await expect(adapter.getStatus(agent({ binding_state: "unbound" }))).resolves.toMatchObject({
      state: "unknown",
      reason: "runtime_binding_unbound",
    });
  });

  it("returns unavailable when Helm cannot be reached", async () => {
    const adapter = createHelmStatusAdapter({
      now: () => now,
      provider: {
        readStatus: async () => {
          throw new Error("network down");
        },
      },
    });

    await expect(adapter.getStatus(agent())).resolves.toMatchObject({
      state: "unavailable",
      health: "unavailable",
      readiness: "unavailable",
      reason: "helm_status_unreachable",
      current_work: null,
    });
  });

  it("uses an allowlist so Helm secrets and deep config do not leak", async () => {
    const adapter = createHelmStatusAdapter({
      now: () => now,
      provider: {
        readStatus: async () => ({
          health: "healthy",
          readiness: "ready",
          heartbeatAt: "2026-06-24T05:14:30.000Z",
          token: "secret-token-value",
          apiKey: "secret-api-key",
          credentials: { password: "super-secret" },
          providerConfig: { model: "private-model" },
          adminConfigUrl: "https://helm.example/admin/config",
        }),
      },
    });

    const summary = await adapter.getStatus(agent());
    const serialized = JSON.stringify(summary);
    expect(summary.state).toBe("healthy");
    expect(serialized).not.toContain("secret-token-value");
    expect(serialized).not.toContain("secret-api-key");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("private-model");
    expect(serialized).not.toContain("adminConfigUrl");
  });
});
