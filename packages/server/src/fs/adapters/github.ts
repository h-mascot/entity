import path from "path";
import type { FileSourceRecord } from "../../../../db/src/file-sources";
import { assertAllowedRemoteUrl, normalizeSourceRelativePath } from "../security";
import { DEFAULT_SOURCE_READ_LIMIT_BYTES } from "./bounded-read";
import type { FileSourceAdapter, SourceCapability, SourceFileReadResult, SourceNode, SourceReadOptions } from "./types";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_TREES_MAX_ENTRIES = 100_000;
const MAX_TREE_PATH_LENGTH = 1024;

interface GitHubTreeEntry {
  path: string;
  type: string;
  size?: number;
  sha?: string;
}

async function githubFetch(url: string, token?: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "entity-fs-source",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(url, { headers, redirect: "manual" });
}

function parseRepoSlug(source: FileSourceRecord): { owner: string; repo: string } {
  const raw = (source.base_url ?? "").trim() || (source.base_path ?? "").trim();
  if (!raw) {
    throw new Error("GitHub source requires a repository URL (baseUrl) like https://github.com/owner/repo.");
  }

  let owner = "";
  let repo = "";
  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if ((parsed.hostname === "github.com" || parsed.hostname === "www.github.com") && segments.length >= 2) {
      owner = segments[0];
      repo = segments[1];
    }
  } catch {
    // Not a URL; fall through to owner/repo slug parsing.
  }

  if (!owner) {
    const segments = raw.replace(/^git@github\.com:/, "").replace(/\.git$/, "").split("/").filter(Boolean);
    if (segments.length === 2) {
      owner = segments[0];
      repo = segments[1];
    }
  }

  if (!owner || !repo || repo === ".git") {
    throw new Error(`GitHub source could not parse owner/repo from: ${raw}`);
  }
  repo = repo.replace(/\.git$/, "");
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    throw new Error(`GitHub source owner/repo contains invalid characters: ${owner}/${repo}`);
  }
  return { owner, repo };
}

function resolveToken(source: FileSourceRecord): string | undefined {
  const ref = source.auth_ref?.trim();
  if (ref) {
    const value = process.env[ref];
    if (value && value.trim()) {
      return value.trim();
    }
    throw new Error(`GitHub token environment variable ${ref} is not set on the Entity server.`);
  }
  return undefined;
}

async function requireOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;
  const status = response.status;
  if (status === 401) throw new Error(`GitHub authentication failed (${status}). Check the token and its expiry.`);
  if (status === 403) throw new Error(`GitHub access denied (${status}). Check token scopes (repo/read) and rate limits.`);
  if (status === 404) throw new Error(`GitHub repository not found (${status}). Check the URL and token access.`);
  if (status >= 500) throw new Error(`GitHub server error (${status}) while ${action}.`);
  throw new Error(`GitHub request failed while ${action} (${status}).`);
}

function entryToNode(sourceId: string, entry: GitHubTreeEntry): SourceNode {
  return {
    sourceId,
    path: entry.path,
    name: path.posix.basename(entry.path),
    isDirectory: entry.type === "tree",
    kind: entry.type === "tree" ? "directory" : entry.type === "blob" ? "file" : "other",
    size: typeof entry.size === "number" ? entry.size : undefined,
  };
}

export class GitHubFileSourceAdapter implements FileSourceAdapter {
  readonly key = "github";
  private readonly source: FileSourceRecord;
  private resolved: { owner: string; repo: string; token: string | undefined } | null = null;
  private treeEntries: GitHubTreeEntry[] | null = null;

  constructor(source: FileSourceRecord) {
    // Construction never throws (adapter contract); configuration errors surface in validate()/operations.
    this.source = source;
  }

  private resolve(source?: FileSourceRecord): { owner: string; repo: string; token: string | undefined } {
    if (!this.resolved) {
      const record = source ?? this.source;
      const { owner, repo } = parseRepoSlug(record);
      this.resolved = { owner, repo, token: resolveToken(record) };
    }
    return this.resolved;
  }

  async validate(source: FileSourceRecord): Promise<void> {
    const { owner, repo, token } = this.resolve(source);
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;
    const response = await githubFetch(url, token);
    if (response.status === 404) {
      throw new Error(`GitHub repository not found: ${owner}/${repo}. Check the URL${token ? "" : " and add a token for private repos"} (404).`);
    }
    await requireOk(response, "validating the repository");
    assertAllowedRemoteUrl(url);
  }

  capabilities(): SourceCapability {
    return {
      read: true,
      write: false,
      rename: false,
      delete: false,
      list: true,
      search: false,
    };
  }

  private async loadTree(refresh = false): Promise<GitHubTreeEntry[]> {
    if (this.treeEntries && !refresh) {
      return this.treeEntries;
    }
    const { owner, repo, token } = this.resolve();
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`;
    const response = await githubFetch(url, token);
    if (response.status === 404) throw new Error(`GitHub repository has no git tree: ${owner}/${repo}.`);
    await requireOk(response, "listing the repository tree");
    const payload = await response.json() as { truncated?: boolean; tree?: GitHubTreeEntry[] };
    if (payload.truncated) {
      throw new Error("GitHub repository tree is truncated (too many entries); source exceeds the current adapter limit.");
    }
    const entries = (payload.tree ?? []).filter((entry) => entry.type === "blob" || entry.type === "tree");
    if (entries.length > GITHUB_TREES_MAX_ENTRIES) {
      throw new Error(`GitHub repository tree exceeds ${GITHUB_TREES_MAX_ENTRIES} entries.`);
    }
    for (const entry of entries) {
      if (!entry.path || entry.path.length > MAX_TREE_PATH_LENGTH) {
        throw new Error("GitHub repository tree contains an invalid file path.");
      }
    }
    this.treeEntries = entries;
    return entries;
  }

  async list(relativePath: string): Promise<SourceNode[]> {
    const normalized = normalizeSourceRelativePath(relativePath);
    const entries = await this.loadTree();
    const prefix = normalized ? `${normalized}/` : "";
    const seenDirectories = new Set<string>();
    const nodes: SourceNode[] = [];
    for (const entry of entries) {
      if (prefix && !entry.path.startsWith(prefix)) continue;
      const remainder = prefix ? entry.path.slice(prefix.length) : entry.path;
      if (!remainder) continue;
      if (entry.type === "tree") {
        nodes.push(entryToNode(this.source.id, entry));
        seenDirectories.add(entry.path);
        continue;
      }
      const slash = remainder.lastIndexOf("/");
      if (slash === -1) {
        nodes.push(entryToNode(this.source.id, entry));
      } else {
        const directoryPath = `${prefix}${remainder.slice(0, slash)}`;
        if (!seenDirectories.has(directoryPath)) {
          seenDirectories.add(directoryPath);
          nodes.push({
            sourceId: this.source.id,
            path: directoryPath,
            name: path.posix.basename(directoryPath),
            isDirectory: true,
            kind: "directory",
          });
        }
      }
    }
    if (nodes.length === 0 && normalized) {
      throw new Error(`GitHub path not found: ${normalized}`);
    }
    return nodes;
    }
  async read(relativePath: string, options?: SourceReadOptions): Promise<SourceFileReadResult> {
    const normalized = normalizeSourceRelativePath(relativePath);
    if (!normalized) throw new Error("GitHub path is required.");
    const maxBytes = options?.maxBytes ?? DEFAULT_SOURCE_READ_LIMIT_BYTES;
    const { owner, repo, token } = this.resolve();
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodeURI(normalized)}`;
    const response = await githubFetch(url, token);
    if (response.status === 404) throw new Error(`GitHub path not found: ${normalized}`);
    if (response.status === 403 && response.headers.get("content-type")?.includes("json")) {
      const payload = await response.json() as { message?: string };
      if ((payload.message ?? "").toLowerCase().includes("too large")) {
        throw new Error(`GitHub file exceeds the direct-contents size limit: ${normalized}.`);
      }
    }
    await requireOk(response, `reading ${normalized}`);
    const payload = await response.json() as { content?: string; encoding?: string; size?: number; type?: string; sha?: string };
    if (payload.type === "submodule" || payload.type === "symlink") {
      throw new Error(`GitHub path is not a readable file: ${normalized}.`);
    }
    if (payload.encoding !== "base64" || typeof payload.content !== "string") {
      throw new Error(`GitHub path did not return file content: ${normalized}.`);
    }
    const buffer = Buffer.from(payload.content, "base64");
    if (buffer.byteLength > maxBytes) {
      throw new Error(`File exceeds the ${maxBytes}-byte read limit: ${normalized}.`);
    }
    const contentType = path.extname(normalized).toLowerCase() === ".md" ? "text/markdown" : "text/plain";
    return {
      content: buffer.toString("utf8"),
      contentType,
      size: buffer.byteLength,
    };
  }

  async write(_path: string, _content: string): Promise<never> {
    throw new Error("GitHub sources are read-only.");
  }

  async mkdir(_path: string): Promise<never> {
    throw new Error("GitHub sources are read-only.");
  }
}
