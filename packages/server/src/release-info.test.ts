import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";
import { readReleaseInfo } from "./release-info";

describe("readReleaseInfo", () => {
  it("reads release identity from RELEASE.json and VERSION", () => {
    const dir = mkdtempSync(join(tmpdir(), "entity-release-info-"));
    try {
      const sha = "1234567890abcdef1234567890abcdef12345678";
      writeFileSync(join(dir, "VERSION"), `${sha}\n`);
      writeFileSync(
        join(dir, "RELEASE.json"),
        JSON.stringify({
          gitSha: sha,
          artifactHash: "sha256:artifact",
          builtAt: "2026-06-30T18:00:00Z",
          environment: "sandbox",
          version: "v-test",
        }),
      );

      const info = readReleaseInfo(dir);

      expect(info).toMatchObject({
        app: "entity",
        environment: "sandbox",
        gitSha: sha,
        artifactHash: "sha256:artifact",
        builtAt: "2026-06-30T18:00:00Z",
        version: "v-test",
        manifestPresent: true,
        source: "manifest",
      });
      expect(info.releasePath).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to VERSION when no manifest is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "entity-release-info-"));
    try {
      const sha = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
      writeFileSync(join(dir, "VERSION"), `${sha}\n`);

      const info = readReleaseInfo(dir);

      expect(info.gitSha).toBe(sha);
      expect(info.version).toBe(sha);
      expect(info.manifestPresent).toBe(false);
      expect(info.source).toBe("version-file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
