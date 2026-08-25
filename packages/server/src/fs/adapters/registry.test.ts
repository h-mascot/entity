import { describe, expect, it } from "vitest";
import type { FileSourceRecord } from "../../../../db/src/file-sources";
import { adapterSupportsLiveValidation, createFileSourceAdapter, liveSourceAdapterTypes } from "./registry";

function sourceFor(type: string): FileSourceRecord {
  return {
    id: "test-source",
    display_name: "Test Source",
    type: type as FileSourceRecord["type"],
    base_url: null,
    base_path: null,
    auth_type: "none",
    auth_ref: null,
    enabled: true,
    icon: null,
    capabilities: "{}",
    health: "ok",
    last_synced_at: null,
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
  };
}

describe("source adapter registry honesty", () => {
  it("liveSourceAdapterTypes covers exactly the shipped adapters", () => {
    expect([...liveSourceAdapterTypes].sort()).toEqual(["docsify", "github", "http-markdown", "local"]);
  });

  it("s3 and custom adapters fail validation instead of passing silently", async () => {
    for (const type of ["s3", "custom"] as const) {
      const adapter = createFileSourceAdapter(sourceFor(type));
      await expect(adapter.validate(sourceFor(type))).rejects.toThrow("not implemented yet");
      expect(adapterSupportsLiveValidation(type)).toBe(false);
    }
  });

  it("github sources use the live adapter", () => {
    const githubSource = { ...sourceFor("github"), base_url: "https://github.com/acme/widgets" };
    const adapter = createFileSourceAdapter(githubSource);
    expect(adapter.key).toBe("github");
    expect(adapterSupportsLiveValidation("github")).toBe(true);
  });

  it("rejects unknown source types", () => {
    expect(() => createFileSourceAdapter(sourceFor("ftp"))).toThrow("Unsupported source type");
  });
});
