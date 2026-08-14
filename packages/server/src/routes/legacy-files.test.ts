import express from "express";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileSourceRecord, FileSourceRepository } from "../../../db/src/file-sources";
import { isInlineSafeContentType, parseByteRange, pathIsCoveredByReadOnlyLocalSource, registerLegacyFileRoutes } from "./legacy-files";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "entity-legacy-files-"));
  tempRoots.push(root);
  return root;
}

function sourceFor(basePath: string): FileSourceRecord {
  const timestamp = "2026-07-01T00:00:00.000Z";
  return {
    id: "workspace",
    display_name: "Workspace",
    type: "local",
    base_url: null,
    base_path: basePath,
    auth_type: "none",
    auth_ref: null,
    enabled: true,
    icon: null,
    capabilities: "{}",
    health: "ok",
    last_synced_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

async function withLegacyFileServer(
  workspaceRoot: string,
  run: (baseUrl: string) => Promise<void>,
  configuredSources?: FileSourceRecord[],
): Promise<void> {
  const source = sourceFor(workspaceRoot);
  const sources = configuredSources ?? [source];
  const sourceRepo: FileSourceRepository = {
    listSources: vi.fn(() => sources),
    getSource: vi.fn((id: string) => sources.find((entry) => entry.id === id)),
    createSource: vi.fn(() => source),
    updateSource: vi.fn(() => source),
    setEnabled: vi.fn(() => source),
    deleteSource: vi.fn(() => false),
  };

  const app = express();
  app.use(express.json());
  registerLegacyFileRoutes(app, {
    workspaceRoot,
    fileSourceRepository: sourceRepo,
    logActivity: vi.fn(),
    broadcast: vi.fn(),
    toWorkspaceRelativePath: (filePath) => path.relative(workspaceRoot, filePath),
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server failed to bind");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

describe("parseByteRange", () => {
  it("returns null when no Range header is supplied", () => {
    expect(parseByteRange(undefined, 1000)).toBeNull();
    expect(parseByteRange(null, 1000)).toBeNull();
  });

  it("parses explicit byte ranges", () => {
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
  });

  it("parses open-ended byte ranges", () => {
    expect(parseByteRange("bytes=100-", 1000)).toEqual({ start: 100, end: 999 });
  });

  it("parses suffix byte ranges", () => {
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("marks ranges outside the content size as unsatisfiable", () => {
    expect(parseByteRange("bytes=99999-", 1000)).toBe("unsatisfiable");
  });
});

describe("isInlineSafeContentType", () => {
  it("allows preview-safe media and document content types inline", () => {
    expect(isInlineSafeContentType("image/png")).toBe(true);
    expect(isInlineSafeContentType("application/pdf")).toBe(true);
    expect(isInlineSafeContentType("video/mp4")).toBe(true);
    expect(isInlineSafeContentType("audio/mpeg")).toBe(true);
    expect(isInlineSafeContentType("text/plain; charset=utf-8")).toBe(true);
  });

  it("rejects active or browser-executable content types", () => {
    expect(isInlineSafeContentType("text/html")).toBe(false);
    expect(isInlineSafeContentType("image/svg+xml")).toBe(false);
    expect(isInlineSafeContentType("application/javascript")).toBe(false);
    expect(isInlineSafeContentType("text/javascript")).toBe(false);
    expect(isInlineSafeContentType("application/xml")).toBe(false);
    expect(isInlineSafeContentType("text/xml")).toBe(false);
  });
});

describe("legacy read-only source protection", () => {
  it("detects workspace paths covered by read-only local sources", () => {
    const readOnly = { ...sourceFor("/workspace/wiki"), capabilities: JSON.stringify({ readOnly: true }) };
    const writable = sourceFor("/workspace/editable");
    expect(pathIsCoveredByReadOnlyLocalSource("/workspace/wiki/page.md", [readOnly, writable])).toBe(true);
    expect(pathIsCoveredByReadOnlyLocalSource("/workspace/editable/page.md", [readOnly, writable])).toBe(false);
    expect(pathIsCoveredByReadOnlyLocalSource("/workspace/other/page.md", [readOnly, writable])).toBe(false);
  });

  it("rejects legacy writes into a nested read-only source", async () => {
    const workspaceRoot = await makeTempRoot();
    const wikiRoot = path.join(workspaceRoot, "wiki");
    const target = path.join(wikiRoot, "page.md");
    const wikiAlias = path.join(workspaceRoot, "wiki-alias");
    await fs.promises.mkdir(wikiRoot, { recursive: true });
    await fs.promises.writeFile(target, "original", "utf8");
    await fs.promises.symlink(wikiRoot, wikiAlias, "dir");
    const workspace = sourceFor(workspaceRoot);
    const wiki = {
      ...sourceFor(wikiRoot),
      id: "entity-wiki",
      capabilities: JSON.stringify({ readOnly: true, source: "entity.config.yaml" }),
    };

    await withLegacyFileServer(workspaceRoot, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/file?path=wiki/page.md`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "mutated" }),
      });
      expect(response.status).toBe(403);
      const aliasResponse = await fetch(`${baseUrl}/api/file?path=wiki-alias/page.md`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "mutated-through-alias" }),
      });
      expect(aliasResponse.status).toBe(403);
      expect(await fs.promises.readFile(target, "utf8")).toBe("original");
    }, [workspace, wiki]);
  });
});

describe("legacy file routes", () => {
  it("rejects symlink escapes on source reads and workspace writes while allowing normal files", async () => {
    const workspaceRoot = await makeTempRoot();
    const outsideRoot = await makeTempRoot();
    const outsideFile = path.join(outsideRoot, "secret.md");
    await fs.promises.writeFile(path.join(workspaceRoot, "inside.md"), "# inside\n", "utf-8");
    await fs.promises.writeFile(outsideFile, "# outside\n", "utf-8");
    await fs.promises.symlink(outsideFile, path.join(workspaceRoot, "read-link.md"));
    await fs.promises.symlink(outsideFile, path.join(workspaceRoot, "write-link.md"));

    await withLegacyFileServer(workspaceRoot, async (baseUrl) => {
      const normalRead = await fetch(`${baseUrl}/api/file/raw?source=workspace&path=inside.md`);
      expect(normalRead.status).toBe(200);
      await expect(normalRead.text()).resolves.toBe("# inside\n");

      const escapedRead = await fetch(`${baseUrl}/api/file/raw?source=workspace&path=read-link.md`);
      expect(escapedRead.status).toBe(403);
      await expect(escapedRead.json()).resolves.toMatchObject({
        error: "Access outside source root is not allowed.",
      });

      const normalWrite = await fetch(`${baseUrl}/api/file?path=inside.md`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "# updated\n" }),
      });
      expect(normalWrite.status).toBe(200);
      await expect(fs.promises.readFile(path.join(workspaceRoot, "inside.md"), "utf-8")).resolves.toBe("# updated\n");

      const escapedWrite = await fetch(`${baseUrl}/api/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "write-link.md", content: "# pwned\n" }),
      });
      expect(escapedWrite.status).toBe(403);
      await expect(escapedWrite.json()).resolves.toMatchObject({
        error: "File mutation path must stay inside the workspace.",
      });
      await expect(fs.promises.readFile(outsideFile, "utf-8")).resolves.toBe("# outside\n");
    });
  });

  it("rejects oversized direct workspace reads at the shared hard ceiling", async () => {
    const workspaceRoot = await makeTempRoot();
    const oversizedPath = path.join(workspaceRoot, "oversized.bin");
    await fs.promises.writeFile(oversizedPath, "x");
    await fs.promises.truncate(oversizedPath, (16 * 1024 * 1024) + 1);

    await withLegacyFileServer(workspaceRoot, async (baseUrl) => {
      for (const endpoint of ["/api/file/raw", "/api/file"]) {
        const response = await fetch(`${baseUrl}${endpoint}?path=oversized.bin`);
        expect(response.status).toBe(413);
        await expect(response.json()).resolves.toEqual({
          error: "Source file exceeds the configured read limit of 16777216 bytes.",
        });
      }
    });
  });

  it("serves byte ranges for raw media files", async () => {
    const workspaceRoot = await makeTempRoot();
    const content = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
    await fs.promises.writeFile(path.join(workspaceRoot, "clip.mp4"), content);

    await withLegacyFileServer(workspaceRoot, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/file/raw?source=workspace&path=clip.mp4`, {
        headers: { Range: "bytes=10-15" },
      });

      expect(response.status).toBe(206);
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("content-type")).toBe("video/mp4");
      expect(response.headers.get("content-disposition")).toBe('inline; filename="clip.mp4"');
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-range")).toBe(`bytes 10-15/${content.length}`);
      expect(response.headers.get("content-length")).toBe("6");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(content.subarray(10, 16));
    });
  });

  it("returns 416 for unsatisfiable raw byte ranges", async () => {
    const workspaceRoot = await makeTempRoot();
    const content = Buffer.from("small file");
    await fs.promises.writeFile(path.join(workspaceRoot, "track.mp3"), content);

    await withLegacyFileServer(workspaceRoot, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/file/raw?source=workspace&path=track.mp3`, {
        headers: { Range: "bytes=99999-" },
      });

      expect(response.status).toBe(416);
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-range")).toBe(`bytes */${content.length}`);
      expect(await response.text()).toBe("");
    });
  });

  it("keeps raw PDF and image responses inline while advertising range support", async () => {
    const workspaceRoot = await makeTempRoot();
    const pdfContent = Buffer.from("%PDF-1.7\n");
    const pngContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await fs.promises.writeFile(path.join(workspaceRoot, "doc.pdf"), pdfContent);
    await fs.promises.writeFile(path.join(workspaceRoot, "image.png"), pngContent);

    await withLegacyFileServer(workspaceRoot, async (baseUrl) => {
      const pdfResponse = await fetch(`${baseUrl}/api/file/raw?source=workspace&path=doc.pdf`);
      expect(pdfResponse.status).toBe(200);
      expect(pdfResponse.headers.get("accept-ranges")).toBe("bytes");
      expect(pdfResponse.headers.get("content-type")).toBe("application/pdf");
      expect(pdfResponse.headers.get("content-disposition")).toBe('inline; filename="doc.pdf"');
      expect(pdfResponse.headers.get("x-content-type-options")).toBe("nosniff");
      expect(Buffer.from(await pdfResponse.arrayBuffer())).toEqual(pdfContent);

      const pngResponse = await fetch(`${baseUrl}/api/file/raw?source=workspace&path=image.png`);
      expect(pngResponse.status).toBe(200);
      expect(pngResponse.headers.get("accept-ranges")).toBe("bytes");
      expect(pngResponse.headers.get("content-type")).toBe("image/png");
      expect(pngResponse.headers.get("content-disposition")).toBe('inline; filename="image.png"');
      expect(pngResponse.headers.get("x-content-type-options")).toBe("nosniff");
      expect(Buffer.from(await pngResponse.arrayBuffer())).toEqual(pngContent);
    });
  });

  it("forces active raw file types to download", async () => {
    const workspaceRoot = await makeTempRoot();
    const htmlContent = Buffer.from("<script>window.__pwned = true</script>");
    await fs.promises.writeFile(path.join(workspaceRoot, "evil.html"), htmlContent);

    await withLegacyFileServer(workspaceRoot, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/file/raw?source=workspace&path=evil.html`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
      expect(response.headers.get("content-disposition")).toBe('attachment; filename="evil.html"');
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(htmlContent);
    });
  });
});
