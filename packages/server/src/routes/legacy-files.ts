import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import type { ActivityType } from "../../../db/src";
import type { FileSourceRepository } from "../../../db/src/file-sources";
import { createFileSourceAdapter } from "../fs/adapters/registry";
import { assertSourceEnabled, assertWriteTargetRealpathContained, normalizeSourceRelativePath } from "../fs/security";
import { detectContentType, normalizeContentType } from "../file-types";
import { asyncHandler } from "../middleware/async-handler";
import { resolveWorkspaceReadPath } from "../workspace-paths";

export interface ByteRange {
  start: number;
  end: number;
}

export type ByteRangeParseResult = ByteRange | null | "unsatisfiable";

export function parseByteRange(
  rangeHeader: string | null | undefined,
  size: number,
): ByteRangeParseResult {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    return null;
  }

  if (!Number.isSafeInteger(size) || size <= 0) {
    return "unsatisfiable";
  }

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "unsatisfiable";
    }

    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start >= size) {
    return "unsatisfiable";
  }

  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isSafeInteger(end) || end < start) {
    return "unsatisfiable";
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

export function isInlineSafeContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType);
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("image/")) {
    return normalized !== "image/svg+xml";
  }

  if (normalized.startsWith("audio/") || normalized.startsWith("video/")) {
    return true;
  }

  return (
    normalized === "application/pdf" ||
    normalized === "text/plain" ||
    normalized === "text/markdown" ||
    normalized === "application/json" ||
    normalized === "text/csv"
  );
}

interface RegisterLegacyFileRoutesDeps {
  workspaceRoot: string;
  fileSourceRepository: FileSourceRepository;
  logActivity: (input: {
    source: "agent" | "task";
    type: ActivityType;
    action: string;
    description: string;
    taskId?: number;
    taskColumn?: string;
    filePath?: string;
    agentName?: string;
    agentEmoji?: string;
    metadata?: Record<string, unknown>;
  }) => unknown;
  broadcast: (message: unknown) => void;
  toWorkspaceRelativePath: (filePath: string) => string;
}

export function registerLegacyFileRoutes(
  app: Express,
  deps: RegisterLegacyFileRoutesDeps,
): void {
  const {
    workspaceRoot: WORKSPACE,
    fileSourceRepository,
    logActivity,
    broadcast,
    toWorkspaceRelativePath,
  } = deps;

  async function resolveWorkspaceMutationPath(rawPath: string): Promise<string> {
    if (rawPath.includes("\0")) {
      throw new Error("Invalid path.");
    }

    const workspaceRoot = path.resolve(WORKSPACE);
    const resolvedPath = path.resolve(workspaceRoot, rawPath);
    const relativePath = path.relative(workspaceRoot, resolvedPath);

    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error("File mutation path must stay inside the workspace.");
    }

    await assertWriteTargetRealpathContained(
      workspaceRoot,
      resolvedPath,
      "File mutation path must stay inside the workspace.",
    );

    return resolvedPath;
  }


  type FileVersion = {
    id: string;
    content: string;
    author: string;
    timestamp: string;
    summary: string;
  };

  type FileVersionMeta = Omit<FileVersion, "content">;

  // In-memory version history (last 10 per path).
  const fileVersionsByPath = new Map<string, FileVersion[]>();
  const MAX_TRACKED_VERSION_FILES = 500;

  function generateVersionId(): string {
    try {
      return randomUUID();
    } catch {
      return `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function normalizeVersionAuthor(value: unknown): string {
    if (typeof value !== "string") return "You";
    const trimmed = value.trim();
    return trimmed ? trimmed : "You";
  }

  function normalizeVersionSummary(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  function pushFileVersion(filePath: string, version: FileVersion) {
    const existing = fileVersionsByPath.get(filePath) ?? [];
    existing.unshift(version);
    if (existing.length > 10) {
      existing.length = 10;
    }
    // Keep Map insertion order aligned with recency for cheap eviction.
    fileVersionsByPath.delete(filePath);
    fileVersionsByPath.set(filePath, existing);
    while (fileVersionsByPath.size > MAX_TRACKED_VERSION_FILES) {
      const oldestKey = fileVersionsByPath.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) {
        break;
      }
      fileVersionsByPath.delete(oldestKey);
    }
  }

  function countLineEdits(
    previousContent: string,
    nextContent: string,
  ): { added: number; removed: number } {
    const prevLines = previousContent.split("\n");
    const nextLines = nextContent.split("\n");
    const prevLen = prevLines.length;
    const nextLen = nextLines.length;

    if (previousContent === nextContent) {
      return { added: 0, removed: 0 };
    }

    if (prevLen === 0) {
      return { added: nextLen, removed: 0 };
    }

    if (nextLen === 0) {
      return { added: 0, removed: prevLen };
    }

    const n = prevLen;
    const m = nextLen;
    const cellBudget = 2_000_000;
    if (n * m > cellBudget) {
      // Fallback: approximate counts via set diff (handles large files cheaply, but may overcount duplicates).
      const prevSet = new Set(prevLines);
      const nextSet = new Set(nextLines);
      let added = 0;
      let removed = 0;
      for (const line of nextLines) {
        if (!prevSet.has(line)) added += 1;
      }
      for (const line of prevLines) {
        if (!nextSet.has(line)) removed += 1;
      }
      return { added, removed };
    }

    // Compute LCS length with O(min(n, m)) memory.
    const a = prevLines;
    const b = nextLines;
    const small = b.length <= a.length ? b : a;
    const large = b.length <= a.length ? a : b;
    const dp = new Array<number>(small.length + 1).fill(0);

    for (let i = 1; i <= large.length; i += 1) {
      let prev = 0;
      const largeLine = large[i - 1];
      for (let j = 1; j <= small.length; j += 1) {
        const temp = dp[j];
        if (largeLine === small[j - 1]) {
          dp[j] = prev + 1;
        } else {
          dp[j] = Math.max(dp[j], dp[j - 1]);
        }
        prev = temp;
      }
    }

    const lcs = dp[small.length];
    const added = nextLen - lcs;
    const removed = prevLen - lcs;
    return { added: Math.max(0, added), removed: Math.max(0, removed) };
  }

  function buildAutoSaveSummary(
    previousContent: string,
    nextContent: string,
  ): string {
    const { added, removed } = countLineEdits(previousContent, nextContent);
    if (added === 0 && removed === 0) {
      return "Saved (no changes)";
    }

    const parts: string[] = [];
    if (added > 0) parts.push(`+${added}`);
    if (removed > 0) parts.push(`-${removed}`);
    return `Saved (${parts.join(" ")})`;
  }

  interface RawFilePayload {
    content: Buffer;
    contentType: string;
    size: number;
    updatedAt?: string;
    fileName: string;
  }

  function sanitizeContentDispositionFilename(value: string): string {
    return (
      value
        .trim()
        .replace(/[\r\n]+/g, " ")
        .replace(/["\\]/g, "_") || "file"
    );
  }

  function mapFileRouteErrorStatus(message: string): number {
    const normalized = message.trim().toLowerCase();

    if (
      normalized.includes("outside workspace") ||
      normalized.includes("inside the workspace") ||
      normalized.includes("outside source root")
    ) {
      return 403;
    }

    if (
      normalized.includes("required") ||
      normalized.includes("invalid") ||
      normalized.includes("allowlisted") ||
      normalized.includes("traversal") ||
      normalized.includes("not a file") ||
      normalized.includes("is a directory") ||
      normalized.includes("eisdir")
    ) {
      return 400;
    }

    if (normalized.includes("disabled")) {
      return 403;
    }

    if (
      normalized.includes("not found") ||
      normalized.includes("does not exist") ||
      normalized.includes("no such file")
    ) {
      return 404;
    }

    return 500;
  }

  function sendRawFileResponse(req: Request, res: Response, payload: RawFilePayload): Response {
    const fileName = sanitizeContentDispositionFilename(payload.fileName);
    const contentType = payload.contentType || "application/octet-stream";
    const disposition = isInlineSafeContentType(contentType) ? "inline" : "attachment";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `${disposition}; filename="${fileName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Accept-Ranges", "bytes");

    if (payload.updatedAt) {
      const updatedAt = new Date(payload.updatedAt);
      if (!Number.isNaN(updatedAt.getTime())) {
        res.setHeader("Last-Modified", updatedAt.toUTCString());
      }
    }

    if (Buffer.isBuffer(payload.content)) {
      const totalSize = payload.content.length;
      const range = parseByteRange(req.headers.range, totalSize);
      if (range === "unsatisfiable") {
        res.status(416);
        res.setHeader("Content-Range", `bytes */${totalSize}`);
        res.setHeader("Content-Length", "0");
        return res.end();
      }

      if (range) {
        const chunk = payload.content.subarray(range.start, range.end + 1);
        res.status(206);
        res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${totalSize}`);
        res.setHeader("Content-Length", String(chunk.length));
        return res.send(chunk);
      }
    }

    res.setHeader("Content-Length", String(payload.size));
    return res.send(payload.content);
  }

  async function readRawLocalFile(filePath: string): Promise<RawFilePayload> {
    const [content, stats] = await Promise.all([
      fs.promises.readFile(filePath),
      fs.promises.stat(filePath),
    ]);

    if (!stats.isFile()) {
      throw new Error("Target path is not a file.");
    }

    const detected = detectContentType({ filePath, content });
    return {
      content,
      contentType: detected.contentType,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
      fileName: path.basename(filePath) || "file",
    };
  }

  async function readRawSourceFile(
    sourceId: string,
    relativePath: string,
  ): Promise<RawFilePayload> {
    const normalizedSourceId = sourceId.trim();
    if (!normalizedSourceId) {
      throw new Error("source is required.");
    }

    const normalizedPath = normalizeSourceRelativePath(relativePath);
    if (!normalizedPath) {
      throw new Error("path required");
    }

    const source = fileSourceRepository.getSource(normalizedSourceId);
    assertSourceEnabled(source);

    const adapter = createFileSourceAdapter(source);
    const fileName = path.posix.basename(normalizedPath) || "file";

    if (typeof adapter.readRaw === "function") {
      const raw = await adapter.readRaw(normalizedPath);
      return {
        content: raw.content,
        contentType: raw.contentType || "application/octet-stream",
        size: raw.size,
        updatedAt: raw.updatedAt,
        fileName,
      };
    }

    const file = await adapter.read(normalizedPath);
    const content = Buffer.from(file.content, "utf-8");
    const detected = detectContentType({
      filePath: normalizedPath,
      headerContentType: file.contentType,
      content,
    });

    return {
      content,
      contentType: detected.contentType,
      size: content.length,
      updatedAt: file.updatedAt,
      fileName,
    };
  }

  app.get("/api/files", asyncHandler(async (req, res) => {
    const rawPath = req.query.path;
    if (typeof rawPath !== "undefined" && typeof rawPath !== "string") {
      return res.status(400).json({ error: "path must be a string" });
    }

    const dirPath = rawPath || WORKSPACE;
    try {
      const resolvedDirPath = await resolveWorkspaceReadPath(dirPath, WORKSPACE);
      const items = await fs.promises.readdir(resolvedDirPath, { withFileTypes: true });
      const files = items
        .filter((item) => !item.name.startsWith("."))
        .map((item) => ({
          name: item.name,
          isDirectory: item.isDirectory(),
          path: path.join(resolvedDirPath, item.name),
        }));
      return res.json(files);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.get("/api/file/raw", asyncHandler(async (req, res) => {
    const requestedPath = req.query.path;
    if (typeof requestedPath !== "string" || !requestedPath) {
      return res.status(400).json({ error: "path required" });
    }

    const sourceId =
      typeof req.query.source === "string"
        ? req.query.source
        : typeof req.query.sourceId === "string"
          ? req.query.sourceId
          : "";

    try {
      const payload = sourceId
        ? await readRawSourceFile(sourceId, requestedPath)
        : await readRawLocalFile(await resolveWorkspaceReadPath(requestedPath, WORKSPACE));

      return sendRawFileResponse(req, res, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(mapFileRouteErrorStatus(message))
        .json({ error: message });
    }
  }));

  app.get("/api/file", asyncHandler(async (req, res) => {
    const filePath = req.query.path;
    if (typeof filePath !== "string") {
      return res.status(400).json({ error: "path required" });
    }

    if (!filePath) {
      return res.status(400).json({ error: "path required" });
    }

    try {
      const resolvedFilePath = await resolveWorkspaceReadPath(filePath, WORKSPACE);
      const [contentBuffer, stats] = await Promise.all([
        fs.promises.readFile(resolvedFilePath),
        fs.promises.stat(resolvedFilePath),
      ]);

      if (!stats.isFile()) {
        throw new Error("Target path is not a file.");
      }

      const detected = detectContentType({ filePath: resolvedFilePath, content: contentBuffer });
      return res.json({
        content: detected.isBinary ? "" : contentBuffer.toString("utf-8"),
        size: stats.size,
        mtime: stats.mtime,
        contentType: detected.contentType,
        isBinary: detected.isBinary,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(mapFileRouteErrorStatus(message))
        .json({ error: message });
    }
  }));

  app.post("/api/files/:path(*)/versions", asyncHandler(async (req, res) => {
    const filePath = req.params.path;
    if (!filePath) {
      return res.status(400).json({ error: "path required" });
    }

    const content = req.body?.content;
    if (typeof content !== "string") {
      return res.status(400).json({ error: "content required" });
    }

    const author = normalizeVersionAuthor(req.body?.author);
    const summary = normalizeVersionSummary(req.body?.summary) ?? "Snapshot";

    try {
      const resolvedFilePath = await resolveWorkspaceMutationPath(filePath);
      const version: FileVersion = {
        id: generateVersionId(),
        content,
        author,
        timestamp: new Date().toISOString(),
        summary,
      };

      pushFileVersion(resolvedFilePath, version);
      return res.json({ version });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(mapFileRouteErrorStatus(message))
        .json({ error: message });
    }
  }));

  app.get("/api/files/:path(*)/versions", asyncHandler(async (req, res) => {
    const filePath = req.params.path;
    if (!filePath) {
      return res.status(400).json({ error: "path required" });
    }

    try {
      const resolvedFilePath = await resolveWorkspaceMutationPath(filePath);
      const versions = fileVersionsByPath.get(resolvedFilePath) ?? [];
      const metas: FileVersionMeta[] = versions.map(
        ({ content: _content, ...meta }) => meta,
      );
      return res.json({ versions: metas });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(mapFileRouteErrorStatus(message))
        .json({ error: message });
    }
  }));

  app.get("/api/files/:path(*)/versions/:id", asyncHandler(async (req, res) => {
    const filePath = req.params.path;
    const { id } = req.params;

    if (!filePath) {
      return res.status(400).json({ error: "path required" });
    }

    try {
      const resolvedFilePath = await resolveWorkspaceMutationPath(filePath);
      const versions = fileVersionsByPath.get(resolvedFilePath) ?? [];
      const version = versions.find((entry) => entry.id === id);
      if (!version) {
        return res.status(404).json({ error: "version not found" });
      }

      return res.json({ version });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(mapFileRouteErrorStatus(message))
        .json({ error: message });
    }
  }));

  app.put("/api/file", asyncHandler(async (req, res) => {
    const filePath = req.query.path;
    if (typeof filePath !== "string") {
      return res.status(400).json({ error: "path required" });
    }

    if (!filePath) {
      return res.status(400).json({ error: "path required" });
    }

    const content = req.body?.content;
    if (typeof content !== "string") {
      return res.status(400).json({ error: "content required" });
    }

    const author = normalizeVersionAuthor(req.body?.author);
    const requestSummary = normalizeVersionSummary(req.body?.summary);
    try {
      const resolvedFilePath = await resolveWorkspaceMutationPath(filePath);
      // Auto-save a version snapshot before overwriting.
      try {
        const previousContent = await fs.promises.readFile(resolvedFilePath, "utf-8");
        if (previousContent !== content) {
          const version: FileVersion = {
            id: generateVersionId(),
            content: previousContent,
            author,
            timestamp: new Date().toISOString(),
            summary:
              requestSummary ?? buildAutoSaveSummary(previousContent, content),
          };
          pushFileVersion(resolvedFilePath, version);
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          // File did not exist yet; no snapshot to capture.
        } else {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.warn(
            "[Versions] Failed to snapshot previous content:",
            message,
          );
        }
      }

      await fs.promises.writeFile(resolvedFilePath, content, "utf-8");
      const relativePath = toWorkspaceRelativePath(resolvedFilePath);
      logActivity({
        source: "agent",
        type: "file_edit",
        action: "Edited file",
        description: `Updated ${relativePath}.`,
        filePath: resolvedFilePath,
        agentName: "Entity",
        agentEmoji: "⚡",
      });
      broadcast({ type: "file:changed", path: resolvedFilePath, content });
      return res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(mapFileRouteErrorStatus(message)).json({ error: message });
    }
  }));

  app.post("/api/file", asyncHandler(async (req, res) => {
    const { path: filePath, content } = req.body;
    if (typeof filePath !== "string" || !filePath) {
      return res.status(400).json({ error: "path required" });
    }

    try {
      const resolvedFilePath = await resolveWorkspaceMutationPath(filePath);
      await fs.promises.mkdir(path.dirname(resolvedFilePath), { recursive: true });
      await fs.promises.writeFile(
        resolvedFilePath,
        typeof content === "string" ? content : "",
        "utf-8",
      );
      const relativePath = toWorkspaceRelativePath(resolvedFilePath);
      logActivity({
        source: "agent",
        type: "file_edit",
        action: "Created file",
        description: `Created ${relativePath}.`,
        filePath: resolvedFilePath,
        agentName: "Entity",
        agentEmoji: "⚡",
      });
      broadcast({ type: "file:created", path: resolvedFilePath });
      return res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(mapFileRouteErrorStatus(message)).json({ error: message });
    }
  }));

  app.delete("/api/file", asyncHandler(async (req, res) => {
    const filePath = req.query.path;
    if (typeof filePath !== "string") {
      return res.status(400).json({ error: "path required" });
    }

    if (!filePath) {
      return res.status(400).json({ error: "path required" });
    }

    try {
      const resolvedFilePath = await resolveWorkspaceMutationPath(filePath);
      await fs.promises.unlink(resolvedFilePath);
      fileVersionsByPath.delete(resolvedFilePath);
      const relativePath = toWorkspaceRelativePath(resolvedFilePath);
      logActivity({
        source: "agent",
        type: "file_edit",
        action: "Deleted file",
        description: `Deleted ${relativePath}.`,
        filePath: resolvedFilePath,
        agentName: "Entity",
        agentEmoji: "⚡",
      });
      broadcast({ type: "file:deleted", path: resolvedFilePath });
      return res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(mapFileRouteErrorStatus(message)).json({ error: message });
    }
  }));

  app.post("/api/file/move", asyncHandler(async (req, res) => {
    const { from, to } = req.body;
    if (typeof from !== "string" || typeof to !== "string" || !from || !to) {
      return res.status(400).json({ error: "from and to required" });
    }

    try {
      const resolvedFrom = await resolveWorkspaceMutationPath(from);
      const resolvedTo = await resolveWorkspaceMutationPath(to);
      await fs.promises.rename(resolvedFrom, resolvedTo);
      const existingVersions = fileVersionsByPath.get(resolvedFrom);
      if (existingVersions) {
        fileVersionsByPath.delete(resolvedFrom);
        fileVersionsByPath.set(resolvedTo, existingVersions);
      }
      logActivity({
        source: "agent",
        type: "file_edit",
        action: "Moved file",
        description: `Moved ${toWorkspaceRelativePath(resolvedFrom)} to ${toWorkspaceRelativePath(resolvedTo)}.`,
        filePath: resolvedTo,
        agentName: "Entity",
        agentEmoji: "⚡",
      });
      broadcast({ type: "file:moved", from: resolvedFrom, to: resolvedTo });
      return res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(mapFileRouteErrorStatus(message)).json({ error: message });
    }
  }));

}
