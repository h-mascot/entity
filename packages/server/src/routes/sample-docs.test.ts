import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureSampleDocs,
  getSampleDocPath,
  SAMPLE_DOC_FILENAME,
} from "./sample-docs";

const tempRoots: string[] = [];

function createTempWorkspaceRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "entity-sample-docs-"));
  tempRoots.push(root);
  vi.stubEnv("ENTITY_WORKSPACE_ROOT", root);
  vi.stubEnv("WORKSPACE", undefined);
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("ensureSampleDocs", () => {
  it("writes the demo markdown file under the configured workspace output root", async () => {
    const root = createTempWorkspaceRoot();

    const result = await ensureSampleDocs();

    const expectedPath = path.join(root, "output", SAMPLE_DOC_FILENAME);
    const content = fs.readFileSync(expectedPath, "utf8");
    expect(result).toEqual({ created: true, filePath: expectedPath });
    expect(getSampleDocPath()).toBe(expectedPath);
    expect(content).toContain("# Entity Doc Viewer — Demo Document");
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it("does not overwrite an existing demo document", async () => {
    const root = createTempWorkspaceRoot();
    const existingPath = path.join(root, "output", SAMPLE_DOC_FILENAME);
    const existingContent = "# User-owned demo\n\nKeep this content.";
    fs.mkdirSync(path.dirname(existingPath), { recursive: true });
    fs.writeFileSync(existingPath, existingContent);

    const result = await ensureSampleDocs();

    expect(result).toEqual({ created: false, filePath: existingPath });
    expect(fs.readFileSync(existingPath, "utf8")).toBe(existingContent);
  });
});
