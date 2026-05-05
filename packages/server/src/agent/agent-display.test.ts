import { describe, expect, it } from "vitest";
import type { AgentRegistryRecord } from "../../../db/src";
import { mergeRegistryAgentDisplay } from "./agent-display";

const now = "2026-05-04T00:00:00.000Z";

function registryAgent(overrides: Partial<AgentRegistryRecord> = {}): AgentRegistryRecord {
  return {
    id: "book",
    slug: "book",
    name: "Book",
    emoji: "📚",
    avatar_url: "/agent-avatars/book.png",
    description: "Hermes continuity operator",
    adapter_type: "hermes",
    runtime_type: "remote",
    status: "active",
    instructions_path: null,
    metadata_json: "{}",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("mergeRegistryAgentDisplay", () => {
  it("uses registry runtime fields over stale live adapter fields", () => {
    const merged = mergeRegistryAgentDisplay({
      entry: {
        id: "book",
        slug: "book",
        name: "Book",
        adapter_type: "openclaw",
        runtime_type: "remote",
        avatarUrl: "/stale.png",
      },
      registryAgent: registryAgent(),
      capabilities: { runtimeLabel: "Hermes · Remote · Active" },
    });

    expect(merged.adapter_type).toBe("hermes");
    expect(merged.adapterType).toBe("hermes");
    expect(merged.agent_runtime).toBe("hermes");
    expect(merged.agentRuntime).toBe("hermes");
    expect(merged.runtime_type).toBe("remote");
    expect(merged.runtimeType).toBe("remote");
    expect(merged.avatarUrl).toBe("/agent-avatars/book.png");
    expect(merged.capabilities).toEqual({ runtimeLabel: "Hermes · Remote · Active" });
  });

  it("preserves live-only agents when no registry record exists", () => {
    const merged = mergeRegistryAgentDisplay({
      entry: {
        id: "external",
        adapter_type: "openclaw",
        runtime_type: "remote",
        avatar_url: "/external.png",
      },
    });

    expect(merged.adapter_type).toBe("openclaw");
    expect(merged.runtime_type).toBe("remote");
    expect(merged.avatarUrl).toBe("/external.png");
  });
});
