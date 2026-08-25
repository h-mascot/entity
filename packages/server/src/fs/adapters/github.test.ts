import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileSourceRecord } from "../../../../db/src/file-sources";
import { GitHubFileSourceAdapter } from "./github";

function sourceFor(overrides: Partial<FileSourceRecord> = {}): FileSourceRecord {
  return {
    id: "github-test",
    display_name: "GitHub Test",
    type: "github",
    base_url: "https://github.com/acme/widgets",
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
    ...overrides,
  };
}

type FetchMock = ReturnType<typeof vi.fn> & ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>);

function mockFetchJson(responses: Array<{ match: (url: string) => boolean; status: number; body: unknown }>): FetchMock {
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const entry of responses) {
      if (entry.match(url)) {
        return {
          ok: entry.status >= 200 && entry.status < 300,
          status: entry.status,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => entry.body,
        } as unknown as Response;
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return vi.fn(impl) as unknown as FetchMock;
}

describe("GitHubFileSourceAdapter", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("parses owner/repo from an https URL", async () => {
    const adapter = new GitHubFileSourceAdapter(sourceFor());
    expect(adapter.key).toBe("github");
  });

  it("construction never throws for a misconfigured source; validate() reports it", async () => {
    const adapter = new GitHubFileSourceAdapter(sourceFor({ base_url: null }));
    expect(adapter.key).toBe("github");
    await expect(adapter.validate(sourceFor({ base_url: null }))).rejects.toThrow("requires a repository URL");
  });

  it("validate() rejects malformed repository URLs", async () => {
    const adapter = new GitHubFileSourceAdapter(sourceFor({ base_url: "https://github.com/only-owner" }));
    await expect(adapter.validate(sourceFor({ base_url: "https://github.com/only-owner" }))).rejects.toThrow("could not parse owner/repo");
  });

  it("accepts an owner/repo slug without URL", async () => {
    const adapter = new GitHubFileSourceAdapter(sourceFor({ base_url: "acme/widgets" }));
    globalThis.fetch = mockFetchJson([
      { match: (url) => url.includes("/repos/acme/widgets"), status: 200, body: { full_name: "acme/widgets" } },
    ]);
    await expect(adapter.validate(sourceFor({ base_url: "acme/widgets" }))).resolves.toBeUndefined();
  });

  it("validate() throws when auth_ref env var is missing", async () => {
    const adapter = new GitHubFileSourceAdapter(sourceFor({ auth_type: "bearer", auth_ref: "ENTITY_MISSING_TOKEN_VAR" }));
    await expect(
      adapter.validate(sourceFor({ auth_type: "bearer", auth_ref: "ENTITY_MISSING_TOKEN_VAR" }))
    ).rejects.toThrow("ENTITY_MISSING_TOKEN_VAR is not set");
  });

  it("validate() reports 404 as repository not found", async () => {
    globalThis.fetch = mockFetchJson([
      { match: (url) => url.includes("/repos/acme/widgets"), status: 404, body: { message: "Not Found" } },
    ]);
    const adapter = new GitHubFileSourceAdapter(sourceFor());
    await expect(adapter.validate(sourceFor())).rejects.toThrow("repository not found");
  });

  it("validate() reports 401 as authentication failure", async () => {
    globalThis.fetch = mockFetchJson([
      { match: (url) => url.includes("/repos/acme/widgets"), status: 401, body: { message: "Bad credentials" } },
    ]);
    const adapter = new GitHubFileSourceAdapter(sourceFor());
    await expect(adapter.validate(sourceFor())).rejects.toThrow("authentication failed");
  });

  it("validate() passes on a reachable repository", async () => {
    globalThis.fetch = mockFetchJson([
      { match: (url) => url.includes("/repos/acme/widgets"), status: 200, body: { full_name: "acme/widgets" } },
    ]);
    const adapter = new GitHubFileSourceAdapter(sourceFor());
    await expect(adapter.validate(sourceFor())).resolves.toBeUndefined();
  });

  it("sends the bearer token when auth_ref resolves", async () => {
    process.env.ENTITY_TEST_GH_TOKEN = "gh_test_token";
    try {
      const fetchMock = mockFetchJson([
        { match: (url) => url.includes("/repos/acme/widgets"), status: 200, body: { full_name: "acme/widgets" } },
      ]);
      globalThis.fetch = fetchMock;
      const adapter = new GitHubFileSourceAdapter(sourceFor({ auth_type: "bearer", auth_ref: "ENTITY_TEST_GH_TOKEN" }));
      await adapter.validate(sourceFor({ auth_type: "bearer", auth_ref: "ENTITY_TEST_GH_TOKEN" }));
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
      expect(url).toContain("api.github.com/repos/acme/widgets");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer gh_test_token");
    } finally {
      delete process.env.ENTITY_TEST_GH_TOKEN;
    }
  });

  it("list() returns synthesized directory nodes and files from the tree", async () => {
    globalThis.fetch = mockFetchJson([
      {
        match: (url) => url.includes("/git/trees/HEAD"),
        status: 200,
        body: {
          truncated: false,
          tree: [
            { path: "README.md", type: "blob", size: 12 },
            { path: "docs", type: "tree" },
            { path: "docs/guide.md", type: "blob", size: 40 },
            { path: "docs/deep/nested.md", type: "blob", size: 60 },
          ],
        },
      },
    ]);
    const adapter = new GitHubFileSourceAdapter(sourceFor());
    const root = await adapter.list("");
    expect(root.map((node) => node.path).sort()).toEqual(["README.md", "docs", "docs/deep"]);
    const docs = await adapter.list("docs");
    expect(docs.map((node) => node.path).sort()).toEqual(["docs/deep", "docs/guide.md"]);
  });

  it("list() throws for a missing path", async () => {
    globalThis.fetch = mockFetchJson([
      { match: (url) => url.includes("/git/trees/HEAD"), status: 200, body: { truncated: false, tree: [{ path: "README.md", type: "blob", size: 12 }] } },
    ]);
    const adapter = new GitHubFileSourceAdapter(sourceFor());
    await expect(adapter.list("missing-dir")).rejects.toThrow("not found");
  });

  it("read() decodes base64 content", async () => {
    globalThis.fetch = mockFetchJson([
      {
        match: (url) => url.includes("/contents/README.md"),
        status: 200,
        body: { type: "file", encoding: "base64", content: Buffer.from("# hello\n").toString("base64"), size: 8 },
      },
    ]);
    const adapter = new GitHubFileSourceAdapter(sourceFor());
    const result = await adapter.read("README.md");
    expect(result.content).toBe("# hello\n");
    expect(result.contentType).toBe("text/markdown");
  });

  it("read() throws on oversized files", async () => {
    globalThis.fetch = mockFetchJson([
      {
        match: (url) => url.includes("/contents/README.md"),
        status: 200,
        body: { type: "file", encoding: "base64", content: Buffer.alloc(1024).toString("base64"), size: 1024 },
      },
    ]);
    const adapter = new GitHubFileSourceAdapter(sourceFor());
    await expect(adapter.read("README.md", { maxBytes: 16 })).rejects.toThrow("read limit");
  });

  it("read() surfaces 404 as path not found", async () => {
    globalThis.fetch = mockFetchJson([
      { match: (url) => url.includes("/contents/missing.md"), status: 404, body: { message: "Not Found" } },
    ]);
    const adapter = new GitHubFileSourceAdapter(sourceFor());
    await expect(adapter.read("missing.md")).rejects.toThrow("not found");
  });

  it("write() and mkdir() are rejected", async () => {
    const adapter = new GitHubFileSourceAdapter(sourceFor());
    await expect(adapter.write("a.md", "x")).rejects.toThrow("read-only");
    await expect(adapter.mkdir("a")).rejects.toThrow("read-only");
  });
});
