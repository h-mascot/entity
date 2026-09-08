import express from "express";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileSourceRecord, FileSourceRepository } from "../../../db/src/file-sources";
import type { FsFileOwnershipRecord, FsFileOwnershipRepository } from "../../../db/src/file-ownership";
import type { FileSourceAdapter, SourcePathMetadata } from "../fs/adapters/types";
import { registerUploadRoutes } from "../fs/routes-upload";
import { createActivityLogger } from "./activity-log";
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
  ownershipRepo?: Pick<FsFileOwnershipRepository, "getOwnership"> & Partial<Pick<FsFileOwnershipRepository, "listOwnershipForOrg" | "listOwnershipForPathScopes" | "deleteOwnershipIfMatches">>,
  customerPermission?: { principal_id: string; grants: Array<{ role: 'viewer' | 'contributor' | 'admin'; org_id?: string; team_id?: string }> },
  broadcastCapture?: (message: unknown) => void,
  activityCapture?: (activity: unknown) => void,
  activityLogger?: ReturnType<typeof createActivityLogger>,
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
  if (customerPermission) {
    app.use((req, _res, next) => {
      req.entityCustomerPrincipal = {
        principalId: customerPermission.principal_id,
        principalType: 'human',
        orgIds: ['org-a'],
        isGlobalAdmin: false,
        permission: customerPermission,
      };
      next();
    });
  }
  app.use(express.json());
  registerLegacyFileRoutes(app, {
    workspaceRoot,
    fileSourceRepository: sourceRepo,
    logActivity: activityLogger ?? vi.fn((activity: unknown) => activityCapture?.(activity)),
    broadcast: broadcastCapture ?? vi.fn(),
    toWorkspaceRelativePath: (filePath) => path.relative(workspaceRoot, filePath),
    ownershipRepo,
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

describe("legacy file activity scope", () => {
  it("records the request-bound organization on every file mutation activity", async () => {
    const workspaceRoot = await makeTempRoot();
    await fs.promises.writeFile(path.join(workspaceRoot, "ordinary.md"), "original", "utf8");
    const activities: Array<{ type: string; metadata?: Record<string, unknown> }> = [];

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const edited = await fetch(`${baseUrl}/api/file?path=ordinary.md`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "edited" }),
        });
        expect(edited.status).toBe(200);

        const created = await fetch(`${baseUrl}/api/file`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "created.md", content: "created" }),
        });
        expect(created.status).toBe(200);

        const deleted = await fetch(`${baseUrl}/api/file?path=created.md`, {
          method: "DELETE",
        });
        expect(deleted.status).toBe(200);

        const moved = await fetch(`${baseUrl}/api/file/move`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ from: "ordinary.md", to: "moved.md" }),
        });
        expect(moved.status).toBe(200);
      },
      undefined,
      undefined,
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
      undefined,
      (activity) => activities.push(activity as { type: string; metadata?: Record<string, unknown> }),
    );

    expect(activities).toHaveLength(4);
    expect(activities.map((activity) => activity.type)).toEqual([
      "file_edit",
      "file_edit",
      "file_edit",
      "file_edit",
    ]);
    expect(activities.map((activity) => activity.metadata)).toEqual([
      { orgId: "org-a" },
      { orgId: "org-a" },
      { orgId: "org-a" },
      { orgId: "org-a" },
    ]);
  });

  it("redacts path-bearing fields from shared activity records for owned mutations", async () => {
    const workspaceRoot = await makeTempRoot();
    await fs.promises.writeFile(path.join(workspaceRoot, "owned.md"), "original", "utf8");
    await fs.promises.writeFile(path.join(workspaceRoot, "ordinary.md"), "ordinary", "utf8");
    const aliasSource = { ...sourceFor(workspaceRoot), id: "workspace-alias", display_name: "Workspace alias" };
    const configuredSources = [aliasSource, sourceFor(workspaceRoot)];
    const ownedFile = (filePath: string): FsFileOwnershipRecord => ({
      source_id: "workspace-alias", path: filePath, org_id: "org-a", team_id: null,
      owner_principal_id: "owner-a", display_name: path.basename(filePath), origin: "upload",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    });
    const persisted: Array<Record<string, unknown>> = [];
    const activityBroadcasts: unknown[] = [];
    const directFileBroadcasts: unknown[] = [];
    const auditLog = vi.spyOn(console, "info").mockImplementation(() => {});
    const activityLogger = createActivityLogger({
      activityRepository: {
        createActivity: vi.fn((input: Record<string, unknown>) => {
          const activity = {
            ...input,
            file_path: input.file_path ?? null,
            metadata: input.metadata ? JSON.parse(String(input.metadata)) : null,
          };
          persisted.push(activity);
          return activity;
        }),
      },
      broadcast: (message) => activityBroadcasts.push(message),
    });
    const ownershipRepo = {
      getOwnership: vi.fn((_sourceId: string, filePath: string) => {
        if (filePath === "owned.md" || filePath === "created-owned.md") return ownedFile(filePath);
        return undefined;
      }),
      deleteOwnershipIfMatches: vi.fn(),
    } satisfies Pick<FsFileOwnershipRepository, "getOwnership"> & Partial<Pick<FsFileOwnershipRepository, "deleteOwnershipIfMatches">>;

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const edited = await fetch(`${baseUrl}/api/file?path=owned.md`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "edited" }),
        });
        expect(edited.status).toBe(200);

        const created = await fetch(`${baseUrl}/api/file`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "created-owned.md", content: "created" }),
        });
        expect(created.status).toBe(200);

        const deleted = await fetch(`${baseUrl}/api/file?path=created-owned.md`, { method: "DELETE" });
        expect(deleted.status).toBe(200);
      },
      configuredSources,
      ownershipRepo,
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
      (message) => directFileBroadcasts.push(message),
      undefined,
      activityLogger,
    );

    expect(persisted).toHaveLength(0);
    expect(activityBroadcasts).toHaveLength(0);
    expect(directFileBroadcasts).toHaveLength(0);
    expect(auditLog.mock.calls.filter(([event]) => event === "[FS AUDIT] legacy.file.mutation")).toHaveLength(3);
    expect(auditLog.mock.calls.filter(([event]) => event === "[FS AUDIT] legacy.file.mutation").map(([, payload]) => payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "edit", orgId: "org-a", principalId: "org-contributor", path: path.join(workspaceRoot, "owned.md") }),
      expect.objectContaining({ operation: "create", orgId: "org-a", principalId: "org-contributor", path: path.join(workspaceRoot, "created-owned.md") }),
      expect.objectContaining({ operation: "delete", orgId: "org-a", principalId: "org-contributor", path: path.join(workspaceRoot, "created-owned.md") }),
    ]));

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const edited = await fetch(`${baseUrl}/api/file?path=ordinary.md`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "ordinary-edited" }),
        });
        expect(edited.status).toBe(200);
      },
      configuredSources,
      ownershipRepo,
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
      (message) => directFileBroadcasts.push(message),
      undefined,
      activityLogger,
    );

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      description: "Updated ordinary.md.",
      file_path: path.join(workspaceRoot, "ordinary.md"),
      metadata: { orgId: "org-a" },
    });
    expect(activityBroadcasts).toHaveLength(1);
    expect(directFileBroadcasts).toEqual([{ type: "file:changed", path: path.join(workspaceRoot, "ordinary.md"), content: "ordinary-edited" }]);
    auditLog.mockRestore();
  });
});

describe("legacy file routes", () => {
  it("denies a team-B customer from downloading a team-A upload through the legacy source route", async () => {
    const workspaceRoot = await makeTempRoot();
    const uploadPath = "uploads/org-a/team-a/secret.md";
    await fs.promises.mkdir(path.join(workspaceRoot, "uploads/org-a/team-a"), { recursive: true });
    await fs.promises.writeFile(path.join(workspaceRoot, uploadPath), "secret", "utf8");
    const ownership: FsFileOwnershipRecord = {
      source_id: "workspace", path: uploadPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "secret.md", origin: "upload",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file/raw?source=workspace&path=${uploadPath}`);
        expect(response.status).toBe(403);
      },
      undefined,
      { getOwnership: vi.fn(() => ownership) },
      { principal_id: "reader-b", grants: [{ role: "viewer", org_id: "org-a", team_id: "team-b" }] },
    );
  });

  it("infers a single customer org for an authorized team upload and rejects a foreign org selector", async () => {
    const workspaceRoot = await makeTempRoot();
    const uploadPath = "uploads/org-a/team-a/secret.md";
    await fs.promises.mkdir(path.join(workspaceRoot, "uploads/org-a/team-a"), { recursive: true });
    await fs.promises.writeFile(path.join(workspaceRoot, uploadPath), "secret", "utf8");
    const ownership: FsFileOwnershipRecord = {
      source_id: "workspace", path: uploadPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "secret.md", origin: "upload",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const inferred = await fetch(`${baseUrl}/api/file/raw?source=workspace&path=${uploadPath}`);
        expect(inferred.status).toBe(200);
        const foreign = await fetch(`${baseUrl}/api/file/raw?source=workspace&path=${uploadPath}`, {
          headers: { "x-entity-org-id": "org-b" },
        });
        expect(foreign.status).toBe(403);
      },
      undefined,
      { getOwnership: vi.fn(() => ownership) },
      { principal_id: "reader-a", grants: [{ role: "viewer", org_id: "org-a", team_id: "team-a" }] },
    );
  });

  it("reports caller-effective readOnly for owned viewers and contributors", async () => {
    const workspaceRoot = await makeTempRoot();
    const uploadPath = "uploads/org-a/team-a/effective.md";
    await fs.promises.mkdir(path.join(workspaceRoot, "uploads/org-a/team-a"), { recursive: true });
    await fs.promises.writeFile(path.join(workspaceRoot, uploadPath), "effective", "utf8");
    const ownership: FsFileOwnershipRecord = {
      source_id: "workspace", path: uploadPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "effective.md", origin: "upload",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    const ownershipRepo = { getOwnership: vi.fn(() => ownership) };

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file?path=${uploadPath}`);
        expect(response.status).toBe(200);
        expect((await response.json()).readOnly).toBe(true);
      },
      undefined,
      ownershipRepo,
      { principal_id: "team-viewer", grants: [{ role: "viewer", org_id: "org-a", team_id: "team-a" }] },
    );

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file?path=${uploadPath}`);
        expect(response.status).toBe(200);
        expect((await response.json()).readOnly).toBe(false);
      },
      undefined,
      ownershipRepo,
      { principal_id: "team-contributor", grants: [{ role: "contributor", org_id: "org-a", team_id: "team-a" }] },
    );
  });

  it("allows an owning team to list its upload directory through the legacy route", async () => {
    const workspaceRoot = await makeTempRoot();
    const directoryPath = "uploads/org-a/team-a";
    const uploadPath = `${directoryPath}/secret.md`;
    await fs.promises.mkdir(path.join(workspaceRoot, directoryPath), { recursive: true });
    await fs.promises.writeFile(path.join(workspaceRoot, uploadPath), "secret", "utf8");
    const ownership: FsFileOwnershipRecord = {
      source_id: "workspace", path: uploadPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "secret.md", origin: "upload",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/files?path=${directoryPath}`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([{ name: "secret.md", isDirectory: false, path: path.join(workspaceRoot, uploadPath) }]);
      },
      undefined,
      {
        getOwnership: vi.fn(() => ownership),
        listOwnershipForOrg: vi.fn(() => [ownership]),
      },
      { principal_id: "reader-a", grants: [{ role: "viewer", org_id: "org-a", team_id: "team-a" }] },
    );
  });

  it("filters foreign, pending, and orphan upload names from directory listings", async () => {
    const workspaceRoot = await makeTempRoot();
    const parentPath = "uploads/org-a";
    const ownDirectory = `${parentPath}/team-a`;
    const foreignDirectory = `${parentPath}/team-b`;
    const ownPath = `${ownDirectory}/secret.md`;
    const pendingPath = `${ownDirectory}/pending.md`;
    const orphanPath = `${ownDirectory}/orphan.md`;
    await fs.promises.mkdir(path.join(workspaceRoot, ownDirectory), { recursive: true });
    await fs.promises.mkdir(path.join(workspaceRoot, foreignDirectory), { recursive: true });
    await fs.promises.writeFile(path.join(workspaceRoot, ownPath), "secret", "utf8");
    await fs.promises.writeFile(path.join(workspaceRoot, pendingPath), "pending", "utf8");
    await fs.promises.writeFile(path.join(workspaceRoot, orphanPath), "orphan", "utf8");
    const own: FsFileOwnershipRecord = {
      source_id: "workspace", path: ownPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "secret.md", origin: "upload",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    const foreign: FsFileOwnershipRecord = { ...own, path: `${foreignDirectory}/other.md`, team_id: "team-b", display_name: "other.md" };
    const pending: FsFileOwnershipRecord = { ...own, path: pendingPath, origin: "pending", display_name: "pending.md" };
    const records = [own, foreign, pending];

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const parentResponse = await fetch(`${baseUrl}/api/files?path=${parentPath}`);
        expect(parentResponse.status).toBe(200);
        expect((await parentResponse.json()).map((entry: { name: string }) => entry.name)).toEqual(["team-a"]);

        const teamResponse = await fetch(`${baseUrl}/api/files?path=${ownDirectory}`);
        expect(teamResponse.status).toBe(200);
        expect((await teamResponse.json()).map((entry: { name: string }) => entry.name)).toEqual(["secret.md"]);
      },
      undefined,
      { getOwnership: vi.fn((sourceId: string, sourcePath: string) => records.find((record) => record.source_id === sourceId && record.path === sourcePath)), listOwnershipForOrg: vi.fn(() => records) },
      { principal_id: "reader-a", grants: [{ role: "viewer", org_id: "org-a", team_id: "team-a" }] },
    );

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/files?path=${ownDirectory}`);
        expect(response.status).toBe(403);
      },
      undefined,
      { getOwnership: vi.fn((sourceId: string, sourcePath: string) => records.find((record) => record.source_id === sourceId && record.path === sourcePath)), listOwnershipForOrg: vi.fn(() => records) },
      { principal_id: "reader-b", grants: [{ role: "viewer", org_id: "org-a", team_id: "team-b" }] },
    );
  });

  it("preserves no-source write authorization for ordinary files", async () => {
    const workspaceRoot = await makeTempRoot();
    const filePath = "ordinary.md";
    await fs.promises.writeFile(path.join(workspaceRoot, filePath), "original", "utf8");

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file?path=${filePath}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "customer write" }),
        });
        expect(response.status).toBe(403);
      },
      [],
      undefined,
      { principal_id: "viewer", grants: [{ role: "viewer", org_id: "default-org", team_id: "team-a" }] },
    );

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file?path=${filePath}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "admin write" }),
        });
        expect(response.status).toBe(200);
      },
      [],
    );

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const read = await fetch(`${baseUrl}/api/file?path=${filePath}`);
        expect(read.status).toBe(200);
        expect((await read.json()).readOnly).toBe(false);
      },
      [],
      undefined,
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );
  });

  it("fails closed for a symlink alias covered by overlapping workspace sources", async () => {
    const workspaceRoot = await makeTempRoot();
    const nestedRoot = path.join(workspaceRoot, "nested");
    const aliasRoot = path.join(workspaceRoot, "nested-alias");
    const uploadPath = "uploads/org-a/team-a/secret.md";
    await fs.promises.mkdir(path.join(nestedRoot, "uploads/org-a/team-a"), { recursive: true });
    await fs.promises.writeFile(path.join(nestedRoot, uploadPath), "secret", "utf8");
    await fs.promises.symlink(nestedRoot, aliasRoot, "dir");

    const workspace = sourceFor(workspaceRoot);
    const nested = { ...sourceFor(nestedRoot), id: "nested" };
    const ownership: FsFileOwnershipRecord = {
      source_id: "nested", path: uploadPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "secret.md", origin: "upload",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file/raw?path=nested-alias/${uploadPath}`);
        expect(response.status).toBe(403);
      },
      [workspace, nested],
      { getOwnership: vi.fn((sourceId: string) => sourceId === "nested" ? ownership : undefined) },
      { principal_id: "reader-b", grants: [{ role: "viewer", org_id: "org-a", team_id: "team-b" }] },
    );
  });

  it("refuses moving an owned upload until ownership metadata can follow the file", async () => {
    const workspaceRoot = await makeTempRoot();
    const uploadPath = "uploads/org-a/team-a/secret.md";
    await fs.promises.mkdir(path.join(workspaceRoot, "uploads/org-a/team-a"), { recursive: true });
    await fs.promises.mkdir(path.join(workspaceRoot, "legacy"), { recursive: true });
    await fs.promises.writeFile(path.join(workspaceRoot, uploadPath), "secret", "utf8");
    const ownership: FsFileOwnershipRecord = {
      source_id: "workspace", path: uploadPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "secret.md", origin: "upload",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file/move`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
          body: JSON.stringify({ from: uploadPath, to: "legacy/secret.md" }),
        });
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: "Moving an owned upload is not supported until ownership is preserved.",
        });
        await expect(fs.promises.readFile(path.join(workspaceRoot, uploadPath), "utf8")).resolves.toBe("secret");
        await expect(fs.promises.access(path.join(workspaceRoot, "legacy/secret.md"))).rejects.toMatchObject({ code: "ENOENT" });
      },
      undefined,
      { getOwnership: vi.fn((_sourceId: string, sourcePath: string) => sourcePath === uploadPath ? ownership : undefined) },
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );
  });

  it("refuses moving an ordinary directory containing an owned upload through an overlapping source", async () => {
    const workspaceRoot = await makeTempRoot();
    const nestedRoot = path.join(workspaceRoot, "nested");
    const uploadPath = "uploads/org-a/team-a/secret.md";
    await fs.promises.mkdir(path.join(nestedRoot, "uploads/org-a/team-a"), { recursive: true });
    await fs.promises.writeFile(path.join(nestedRoot, uploadPath), "secret", "utf8");
    const workspace = sourceFor(workspaceRoot);
    const nested = { ...sourceFor(nestedRoot), id: "nested" };
    const ownership: FsFileOwnershipRecord = {
      source_id: "nested", path: uploadPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "secret.md", origin: "upload",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file/move`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
          body: JSON.stringify({ from: "nested", to: "moved" }),
        });
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: "Moving an owned upload is not supported until ownership is preserved.",
        });
        await expect(fs.promises.readFile(path.join(nestedRoot, uploadPath), "utf8")).resolves.toBe("secret");
        await expect(fs.promises.access(path.join(workspaceRoot, "moved"))).rejects.toMatchObject({ code: "ENOENT" });
      },
      [workspace, nested],
      { getOwnership: vi.fn((sourceId: string, sourcePath: string) => sourceId === "nested" && sourcePath === uploadPath ? ownership : undefined), listOwnershipForOrg: vi.fn(() => [ownership]) },
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file/raw?path=nested/${uploadPath}`);
        expect(response.status).toBe(403);
      },
      [workspace, nested],
      { getOwnership: vi.fn((sourceId: string, sourcePath: string) => sourceId === "nested" && sourcePath === uploadPath ? ownership : undefined), listOwnershipForOrg: vi.fn(() => [ownership]) },
      { principal_id: "team-b-viewer", grants: [{ role: "viewer", org_id: "org-a", team_id: "team-b" }] },
    );
  });

  it("refuses moving an alias root with a foreign pending reservation that has no file bytes", async () => {
    const workspaceRoot = await makeTempRoot();
    const nestedRoot = path.join(workspaceRoot, "nested");
    const pendingPath = "uploads/org-a/team-a/pending.bin";
    await fs.promises.mkdir(path.join(nestedRoot, "uploads/org-a/team-a"), { recursive: true });
    const workspace = sourceFor(workspaceRoot);
    const nested = { ...sourceFor(nestedRoot), id: "nested" };
    const pending: FsFileOwnershipRecord = {
      source_id: "nested", path: pendingPath, org_id: "org-b", team_id: "team-b",
      owner_principal_id: "other-principal", display_name: "pending.bin", origin: "pending",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    const listOwnershipForPathScopes = vi.fn(() => [pending]);

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file/move`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
          body: JSON.stringify({ from: "nested", to: "moved" }),
        });
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error: "Moving an owned upload is not supported until ownership is preserved." });
        await expect(fs.promises.access(nestedRoot)).resolves.toBeUndefined();
        await expect(fs.promises.access(path.join(workspaceRoot, "moved"))).rejects.toMatchObject({ code: "ENOENT" });
      },
      [workspace, nested],
      {
        getOwnership: vi.fn(() => undefined),
        listOwnershipForOrg: vi.fn(() => []),
        listOwnershipForPathScopes,
      },
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );
    expect(listOwnershipForPathScopes).toHaveBeenCalledWith(expect.arrayContaining([
      { sourceId: "nested", pathPrefix: "" },
      { sourceId: "workspace", pathPrefix: "nested" },
      { sourceId: "__workspace__", pathPrefix: "nested" },
    ]));
  });

  it("blocks a same-organization pending reservation through a nested alias", async () => {
    const workspaceRoot = await makeTempRoot();
    const nestedRoot = path.join(workspaceRoot, "nested");
    const pendingPath = "uploads/org-a/team-a/pending.bin";
    await fs.promises.mkdir(path.join(nestedRoot, "uploads/org-a/team-a"), { recursive: true });
    const workspace = sourceFor(workspaceRoot);
    const nested = { ...sourceFor(nestedRoot), id: "nested" };
    const pending: FsFileOwnershipRecord = {
      source_id: "nested", path: pendingPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "pending.bin", origin: "pending",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    const listOwnershipForPathScopes = vi.fn(() => [pending]);

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file/move`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
          body: JSON.stringify({ from: "nested", to: "moved" }),
        });
        expect(response.status).toBe(409);
        await expect(fs.promises.access(path.join(workspaceRoot, "moved"))).rejects.toMatchObject({ code: "ENOENT" });
      },
      [workspace, nested],
      {
        getOwnership: vi.fn(() => undefined),
        listOwnershipForOrg: vi.fn(() => [pending]),
        listOwnershipForPathScopes,
      },
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );
    expect(listOwnershipForPathScopes).toHaveBeenCalledWith(expect.arrayContaining([
      { sourceId: "nested", pathPrefix: "" },
    ]));
  });

  it("checks disabled aliases when a foreign pending reservation has no bytes", async () => {
    const workspaceRoot = await makeTempRoot();
    const nestedRoot = path.join(workspaceRoot, "nested");
    const pendingPath = "uploads/org-a/team-a/pending.bin";
    await fs.promises.mkdir(path.join(nestedRoot, "uploads/org-a/team-a"), { recursive: true });
    const workspace = sourceFor(workspaceRoot);
    const disabledAlias = { ...sourceFor(nestedRoot), id: "disabled-alias", enabled: false };
    const pending: FsFileOwnershipRecord = {
      source_id: "disabled-alias", path: pendingPath, org_id: "org-b", team_id: "team-b",
      owner_principal_id: "other-principal", display_name: "pending.bin", origin: "pending",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    const listOwnershipForPathScopes = vi.fn(() => [pending]);

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file/move`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
          body: JSON.stringify({ from: "nested", to: "moved" }),
        });
        expect(response.status).toBe(409);
        await expect(fs.promises.access(path.join(workspaceRoot, "moved"))).rejects.toMatchObject({ code: "ENOENT" });
      },
      [workspace, disabledAlias],
      {
        getOwnership: vi.fn(() => undefined),
        listOwnershipForOrg: vi.fn(() => []),
        listOwnershipForPathScopes,
      },
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );
    expect(listOwnershipForPathScopes).toHaveBeenCalledWith(expect.arrayContaining([
      { sourceId: "disabled-alias", pathPrefix: "" },
    ]));
  });

  it("rechecks all-org reservations after the directory scan", async () => {
    const workspaceRoot = await makeTempRoot();
    const nestedRoot = path.join(workspaceRoot, "nested");
    const pendingPath = "uploads/org-a/team-a/late.bin";
    await fs.promises.mkdir(path.join(nestedRoot, "uploads/org-a/team-a"), { recursive: true });
    await fs.promises.writeFile(path.join(nestedRoot, "scan-trigger.txt"), "ordinary", "utf8");
    const workspace = sourceFor(workspaceRoot);
    const nested = { ...sourceFor(nestedRoot), id: "nested" };
    const pending: FsFileOwnershipRecord = {
      source_id: "nested", path: pendingPath, org_id: "org-b", team_id: "team-b",
      owner_principal_id: "other-principal", display_name: "late.bin", origin: "pending",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    let lateReservation = false;

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file/move`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
          body: JSON.stringify({ from: "nested", to: "moved" }),
        });
        expect(response.status).toBe(409);
        await expect(fs.promises.access(path.join(workspaceRoot, "moved"))).rejects.toMatchObject({ code: "ENOENT" });
      },
      [workspace, nested],
      {
        getOwnership: vi.fn((_sourceId: string, sourcePath: string) => {
          if (sourcePath === "scan-trigger.txt") lateReservation = true;
          return undefined;
        }),
        listOwnershipForOrg: vi.fn(() => []),
        listOwnershipForPathScopes: vi.fn(() => lateReservation ? [pending] : []),
      },
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );
    expect(lateReservation).toBe(true);
  });

  it("checks the legacy __workspace__ ownership fallback for directory moves", async () => {
    const workspaceRoot = await makeTempRoot();
    await fs.promises.mkdir(path.join(workspaceRoot, "ordinary"), { recursive: true });
    const pending: FsFileOwnershipRecord = {
      source_id: "__workspace__", path: "ordinary/pending.bin", org_id: "org-b", team_id: "team-b",
      owner_principal_id: "other-principal", display_name: "pending.bin", origin: "pending",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    const listOwnershipForPathScopes = vi.fn(() => [pending]);

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file/move`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
          body: JSON.stringify({ from: "ordinary", to: "moved" }),
        });
        expect(response.status).toBe(409);
        await expect(fs.promises.access(path.join(workspaceRoot, "moved"))).rejects.toMatchObject({ code: "ENOENT" });
      },
      undefined,
      { getOwnership: vi.fn(() => undefined), listOwnershipForOrg: vi.fn(() => []), listOwnershipForPathScopes },
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );
    expect(listOwnershipForPathScopes).toHaveBeenCalledWith(expect.arrayContaining([
      { sourceId: "__workspace__", pathPrefix: "ordinary" },
    ]));
  });

  it("still permits moving a truly unowned directory", async () => {
    const workspaceRoot = await makeTempRoot();
    await fs.promises.mkdir(path.join(workspaceRoot, "ordinary"), { recursive: true });
    await fs.promises.writeFile(path.join(workspaceRoot, "ordinary", "note.md"), "ordinary", "utf8");

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file/move`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
          body: JSON.stringify({ from: "ordinary", to: "moved" }),
        });
        expect(response.status).toBe(200);
        await expect(fs.promises.readFile(path.join(workspaceRoot, "moved", "note.md"), "utf8")).resolves.toBe("ordinary");
        await expect(fs.promises.access(path.join(workspaceRoot, "ordinary"))).rejects.toMatchObject({ code: "ENOENT" });
      },
      undefined,
      undefined,
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );
  });

  it.each(["move-first", "upload-first"])("keeps alias upload ownership attached during concurrent moves (%s)", async (order) => {
    const workspaceRoot = await makeTempRoot();
    const nestedRoot = path.join(workspaceRoot, "nested");
    await fs.promises.mkdir(nestedRoot, { recursive: true });

    const workspace = sourceFor(workspaceRoot);
    const nested = { ...sourceFor(nestedRoot), id: "nested" };
    const sources = [workspace, nested];
    const rows = new Map<string, FsFileOwnershipRecord>();
    const keyFor = (sourceId: string, sourcePath: string) => `${sourceId}:${sourcePath}`;
    const ownershipRepo: FsFileOwnershipRepository = {
      getOwnership: vi.fn((sourceId, sourcePath) => rows.get(keyFor(sourceId, sourcePath))),
      reservePendingOwnership: vi.fn((input) => {
        const now = new Date().toISOString();
        const row: FsFileOwnershipRecord = {
          source_id: input.sourceId,
          path: input.path,
          org_id: input.orgId,
          team_id: input.teamId ?? null,
          owner_principal_id: input.ownerPrincipalId ?? null,
          display_name: input.displayName ?? null,
          origin: "pending",
          uploaded_at: now,
          updated_at: now,
        };
        rows.set(keyFor(input.sourceId, input.path), row);
        return row;
      }),
      upsertOwnership: vi.fn((input) => {
        const previous = rows.get(keyFor(input.sourceId, input.path));
        const now = previous?.uploaded_at ?? new Date().toISOString();
        const row: FsFileOwnershipRecord = {
          source_id: input.sourceId,
          path: input.path,
          org_id: input.orgId,
          team_id: input.teamId ?? null,
          owner_principal_id: input.ownerPrincipalId ?? null,
          display_name: input.displayName ?? null,
          origin: input.origin ?? "upload",
          uploaded_at: now,
          updated_at: new Date().toISOString(),
        };
        rows.set(keyFor(input.sourceId, input.path), row);
        return row;
      }),
      listOwnershipForOrg: vi.fn((orgId) => [...rows.values()].filter((row) => row.org_id === orgId)),
      listOwnershipForTeams: vi.fn((orgId, teamIds) => [...rows.values()].filter((row) => row.org_id === orgId && row.team_id !== null && teamIds.includes(row.team_id))),
      listOwnershipForPathScopes: vi.fn(() => [...rows.values()]),
      deleteOwnership: vi.fn((sourceId, sourcePath) => rows.delete(keyFor(sourceId, sourcePath))),
      deletePendingOwnership: vi.fn((reservation) => rows.delete(keyFor(reservation.source_id, reservation.path))),
    };
    const sourceRepo: FileSourceRepository = {
      listSources: vi.fn(() => sources),
      getSource: vi.fn((id) => sources.find((source) => source.id === id)),
      createSource: vi.fn(() => nested),
      updateSource: vi.fn(() => nested),
      setEnabled: vi.fn(() => nested),
      deleteSource: vi.fn(() => false),
    };
    let concurrentMoveResponse: Response | undefined;
    const adapter: FileSourceAdapter = {
      key: "race-test",
      validate: vi.fn(async () => undefined),
      capabilities: () => ({ read: true, write: true, rename: false, delete: false, list: true, search: true }),
      list: vi.fn(async () => []),
      stat: vi.fn(async (sourcePath: string): Promise<SourcePathMetadata> => {
        if (order === "upload-first" && !concurrentMoveResponse) {
          concurrentMoveResponse = await fetch(`${baseUrl}/api/file/move`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
            body: JSON.stringify({ from: "nested", to: "moved" }),
          });
        }
        const absolutePath = path.join(nestedRoot, sourcePath || ".");
        const stats = await fs.promises.stat(absolutePath);
        return {
          sourceId: nested.id,
          path: sourcePath,
          name: path.posix.basename(sourcePath) || path.basename(nestedRoot),
          kind: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
          size: stats.size,
        };
      }),
      read: vi.fn(async (sourcePath) => {
        const content = await fs.promises.readFile(path.join(nestedRoot, sourcePath), "utf8");
        return { content, contentType: "text/plain", size: Buffer.byteLength(content), isBinary: false };
      }),
      write: vi.fn(async () => ({})),
      writeExclusive: vi.fn(async (sourcePath, content) => {
        await fs.promises.writeFile(path.join(nestedRoot, sourcePath), content, "utf8");
        return {};
      }),
      mkdir: vi.fn(async (sourcePath) => {
        await fs.promises.mkdir(path.join(nestedRoot, sourcePath), { recursive: true });
      }),
    };

    const app = express();
    app.use(express.json({ limit: "8mb" }));
    app.use((req, _res, next) => {
      req.entityCustomerPrincipal = {
        principalId: "principal-a",
        principalType: "human",
        orgIds: ["org-a"],
        isGlobalAdmin: false,
        permission: { principal_id: "principal-a", grants: [{ role: "contributor", org_id: "org-a" }] },
      };
      next();
    });
    registerLegacyFileRoutes(app, {
      workspaceRoot,
      fileSourceRepository: sourceRepo,
      logActivity: vi.fn(),
      broadcast: vi.fn(),
      toWorkspaceRelativePath: (filePath) => path.relative(workspaceRoot, filePath),
      ownershipRepo,
    });
    const uploadRouter = express.Router();
    registerUploadRoutes(uploadRouter, {
      sourceRepo,
      ownershipRepo,
      indexRepo: { upsertRecord: vi.fn(() => ({}) as never) },
      teamRepo: { getTeam: vi.fn(() => undefined) },
      createAdapter: () => adapter,
    });
    app.use("/api/fs", uploadRouter);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server failed to bind");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    let uploadResponse: Response | undefined;
    let uploadBody: unknown;
    const realRename = fs.promises.rename.bind(fs.promises);
    const rename = vi.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
      // This is the real interleaving: the move has completed its final
      // reservation scan, then an upload reserves and writes before rename.
      uploadResponse = await fetch(`${baseUrl}/api/fs/upload`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
        body: JSON.stringify({ sourceId: "nested", file: { name: "race.txt", text: "race bytes" } }),
      });
      uploadBody = await uploadResponse.json();
      await realRename(from, to);
    });

    try {
      if (order === "upload-first") {
        const created = await fetch(`${baseUrl}/api/fs/upload`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
          body: JSON.stringify({ sourceId: "nested", file: { name: "race.txt", text: "race bytes" } }),
        });
        expect(created.status).toBe(201);
        expect(concurrentMoveResponse?.status).toBe(409);
        expect(rename).not.toHaveBeenCalled();
        await expect(fs.promises.readFile(path.join(nestedRoot, "uploads/org-a/race.txt"), "utf8")).resolves.toBe("race bytes");
        expect(rows.get(keyFor("nested", "uploads/org-a/race.txt"))).toMatchObject({ origin: "upload" });
      } else {
        const moveResponse = await fetch(`${baseUrl}/api/file/move`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
          body: JSON.stringify({ from: "nested", to: "moved" }),
        });
        expect(moveResponse.status).toBe(200);
        expect(uploadResponse?.status).toBe(409);
        expect(uploadBody).toMatchObject({ error: expect.stringContaining("Retry the request") });
        expect(ownershipRepo.reservePendingOwnership).not.toHaveBeenCalled();
      }
      await expect(fs.promises.access(path.join(workspaceRoot, "moved", "uploads/org-a/race.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      const exposed = await fetch(`${baseUrl}/api/file/raw?path=moved/uploads/org-a/race.txt`);
      expect(exposed.status).toBe(403);
    } finally {
      rename.mockRestore();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("refuses moving a directory containing a manually owned file through an alias", async () => {
    const workspaceRoot = await makeTempRoot();
    const nestedRoot = path.join(workspaceRoot, "nested");
    const manualPath = "notes/converted.md";
    await fs.promises.mkdir(path.join(nestedRoot, "notes"), { recursive: true });
    await fs.promises.writeFile(path.join(nestedRoot, manualPath), "converted", "utf8");
    const workspace = sourceFor(workspaceRoot);
    const nested = { ...sourceFor(nestedRoot), id: "nested" };
    const ownership: FsFileOwnershipRecord = {
      source_id: "nested", path: manualPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "converted.md", origin: "manual",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file/move`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-entity-org-id": "org-a" },
          body: JSON.stringify({ from: "nested", to: "moved" }),
        });
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: "Moving an owned upload is not supported until ownership is preserved.",
        });
        await expect(fs.promises.readFile(path.join(nestedRoot, manualPath), "utf8")).resolves.toBe("converted");
        await expect(fs.promises.access(path.join(workspaceRoot, "moved"))).rejects.toMatchObject({ code: "ENOENT" });
      },
      [workspace, nested],
      { getOwnership: vi.fn((sourceId: string, sourcePath: string) => sourceId === "nested" && sourcePath === manualPath ? ownership : undefined), listOwnershipForOrg: vi.fn(() => [ownership]) },
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );
  });

  it("clears observed ownership after a successful authorized unlink", async () => {
    const workspaceRoot = await makeTempRoot();
    const uploadPath = "uploads/org-a/team-a/deletable.md";
    await fs.promises.mkdir(path.join(workspaceRoot, "uploads/org-a/team-a"), { recursive: true });
    await fs.promises.writeFile(path.join(workspaceRoot, uploadPath), "secret", "utf8");
    const ownership: FsFileOwnershipRecord = {
      source_id: "workspace", path: uploadPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "deletable.md", origin: "upload",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    let current: FsFileOwnershipRecord | undefined = ownership;
    const deleteOwnershipIfMatches = vi.fn((expected: FsFileOwnershipRecord) => {
      if (!current || expected.source_id !== current.source_id || expected.path !== current.path || expected.updated_at !== current.updated_at) return false;
      current = undefined;
      return true;
    });

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file?path=${uploadPath}`, {
          method: "DELETE", headers: { "x-entity-org-id": "org-a" },
        });
        expect(response.status).toBe(200);
        expect(deleteOwnershipIfMatches).toHaveBeenCalledWith(ownership);
        expect(current).toBeUndefined();
        await expect(fs.promises.access(path.join(workspaceRoot, uploadPath))).rejects.toMatchObject({ code: "ENOENT" });
      },
      undefined,
      { getOwnership: vi.fn(() => current), deleteOwnershipIfMatches },
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );
  });

  it("preserves ownership when unlink fails", async () => {
    const workspaceRoot = await makeTempRoot();
    const directoryPath = "uploads/org-a/team-a/folder";
    await fs.promises.mkdir(path.join(workspaceRoot, directoryPath), { recursive: true });
    const ownership: FsFileOwnershipRecord = {
      source_id: "workspace", path: directoryPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "folder", origin: "upload",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    const deleteOwnershipIfMatches = vi.fn(() => true);

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file?path=${directoryPath}`, {
          method: "DELETE", headers: { "x-entity-org-id": "org-a" },
        });
        expect(response.status).toBe(500);
        expect(deleteOwnershipIfMatches).not.toHaveBeenCalled();
        await expect(fs.promises.access(path.join(workspaceRoot, directoryPath))).resolves.toBeUndefined();
      },
      undefined,
      { getOwnership: vi.fn(() => ownership), deleteOwnershipIfMatches },
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );
  });

  it("clears ownership records for every physical alias after unlink", async () => {
    const workspaceRoot = await makeTempRoot();
    const nestedRoot = path.join(workspaceRoot, "nested");
    const nestedPath = "uploads/org-a/team-a/alias.md";
    const workspacePath = `nested/${nestedPath}`;
    await fs.promises.mkdir(path.join(nestedRoot, "uploads/org-a/team-a"), { recursive: true });
    await fs.promises.writeFile(path.join(nestedRoot, nestedPath), "secret", "utf8");
    const workspace = sourceFor(workspaceRoot);
    const nested = { ...sourceFor(nestedRoot), id: "nested" };
    const records: FsFileOwnershipRecord[] = [
      { source_id: "workspace", path: workspacePath, org_id: "org-a", team_id: "team-a", owner_principal_id: "owner-a", display_name: "alias.md", origin: "upload", uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
      { source_id: "nested", path: nestedPath, org_id: "org-a", team_id: "team-a", owner_principal_id: "owner-a", display_name: "alias.md", origin: "upload", uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    ];
    const deleteOwnershipIfMatches = vi.fn((expected: FsFileOwnershipRecord) => {
      const index = records.findIndex((record) => record.source_id === expected.source_id && record.path === expected.path && record.updated_at === expected.updated_at);
      if (index < 0) return false;
      records.splice(index, 1);
      return true;
    });

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file?path=${workspacePath}`, {
          method: "DELETE", headers: { "x-entity-org-id": "org-a" },
        });
        expect(response.status).toBe(200);
        expect(deleteOwnershipIfMatches).toHaveBeenCalledTimes(2);
        expect(records).toHaveLength(0);
        await expect(fs.promises.access(path.join(nestedRoot, nestedPath))).rejects.toMatchObject({ code: "ENOENT" });
      },
      [workspace, nested],
      { getOwnership: vi.fn((sourceId: string, sourcePath: string) => records.find((record) => record.source_id === sourceId && record.path === sourcePath)), deleteOwnershipIfMatches },
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
    );
  });

  it("does not broadcast owned file content while preserving ordinary file broadcasts", async () => {
    const workspaceRoot = await makeTempRoot();
    const uploadPath = "uploads/org-a/team-a/secret.md";
    await fs.promises.mkdir(path.join(workspaceRoot, "uploads/org-a/team-a"), { recursive: true });
    await fs.promises.writeFile(path.join(workspaceRoot, uploadPath), "secret", "utf8");
    const ordinaryPath = "legacy.md";
    const ownership: FsFileOwnershipRecord = {
      source_id: "workspace", path: uploadPath, org_id: "org-a", team_id: "team-a",
      owner_principal_id: "owner-a", display_name: "secret.md", origin: "upload",
      uploaded_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    const events: unknown[] = [];

    await withLegacyFileServer(
      workspaceRoot,
      async (baseUrl) => {
        const headers = { "content-type": "application/json", "x-entity-org-id": "org-a" };
        const ownedResponse = await fetch(`${baseUrl}/api/file?path=${uploadPath}`, {
          method: "PUT", headers, body: JSON.stringify({ content: "updated secret" }),
        });
        expect(ownedResponse.status).toBe(200);
        expect(events).toEqual([]);

        const ordinaryResponse = await fetch(`${baseUrl}/api/file?path=${ordinaryPath}`, {
          method: "PUT", headers, body: JSON.stringify({ content: "ordinary update" }),
        });
        expect(ordinaryResponse.status).toBe(200);
        expect(events).toEqual([{ type: "file:changed", path: path.join(workspaceRoot, ordinaryPath), content: "ordinary update" }]);
      },
      undefined,
      { getOwnership: vi.fn((_sourceId: string, sourcePath: string) => sourcePath === uploadPath ? ownership : undefined) },
      { principal_id: "org-contributor", grants: [{ role: "contributor", org_id: "org-a" }] },
      (message) => events.push(message),
    );
  });

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
