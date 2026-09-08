import { acquireFileMutationGuard, FileMutationConflictError } from '../fs/mutation-guard';
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import type { ActivityType } from "../../../db/src";
import type { FileSourceRecord, FileSourceRepository } from "../../../db/src/file-sources";
import { createFsFileOwnershipRepository, type FsFileOwnershipPathScope, type FsFileOwnershipRecord, type FsFileOwnershipRepository } from "../../../db/src/file-ownership";
import { readLocalFileBounded } from "../fs/adapters/bounded-read";
import { createFileSourceAdapter } from "../fs/adapters/registry";
import { assertSourceEnabled, assertWriteTargetRealpathContained, emitFsAudit, isContainedPath, normalizeSourceRelativePath, resolvePathThroughNearestExistingAncestor } from "../fs/security";
import { detectContentType, normalizeContentType } from "../file-types";
import { asyncHandler } from "../middleware/async-handler";
import { resolveWorkspaceReadPath } from "../workspace-paths";
import { isMissingPathError } from "../fs/errors";
import { assertOwnedDirectoryWriteAccess, assertOwnedFileAccess, isReservedUploadPath, resolveOwnershipScope, sourceOwnershipPathVisible } from "../fs/ownership";
import { requireRequestOrg, type RequestOrgBinding } from "../request-permissions";

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

export function pathIsCoveredByReadOnlyLocalSource(
  targetPath: string,
  sources: FileSourceRecord[],
): boolean {
  const resolvedTarget = resolvePathThroughNearestExistingAncestor(targetPath);
  return sources.some((source) => {
    if (source.type !== "local" || !source.base_path) return false;
    let readOnly = false;
    try {
      readOnly = (JSON.parse(source.capabilities) as { readOnly?: unknown }).readOnly === true;
    } catch {
      return false;
    }
    if (!readOnly) return false;
    const sourceRoot = resolvePathThroughNearestExistingAncestor(source.base_path);
    const relative = path.relative(sourceRoot, resolvedTarget);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  });
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
  ownershipRepo?: Pick<FsFileOwnershipRepository, 'getOwnership'> & Partial<Pick<FsFileOwnershipRepository, 'listOwnershipForOrg' | 'listOwnershipForPathScopes' | 'deleteOwnershipIfMatches'>>;
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
    ownershipRepo = createFsFileOwnershipRepository(),
  } = deps;

  function assertSourcePathOwnership(binding: RequestOrgBinding, sourceId: string, sourcePath: string, operation: 'read' | 'write' = 'read'): FsFileOwnershipRecord | undefined {
    return assertOwnedFileAccess(binding, ownershipRepo, sourceId, sourcePath, operation, fileSourceRepository.listSources(true));
  }

  function logLegacyFileMutationActivity(input: {
    binding: RequestOrgBinding;
    ownership: readonly FsFileOwnershipRecord[];
    operation: 'edit' | 'create' | 'delete';
    filePath: string;
    action: string;
    description: string;
  }): void {
    if (input.ownership.length > 0) {
      // The legacy activity logger is a deployment-wide persistence and
      // websocket surface with no organization filter. Keep the operator
      // audit trail, but do not publish customer-owned paths to that shared
      // surface. Unowned workspace mutations retain their existing activity.
      emitFsAudit('legacy.file.mutation', {
        operation: input.operation,
        path: input.filePath,
        orgId: input.binding.orgId,
        principalId: input.binding.principal.principal_id,
      });
      return;
    }

    logActivity({
      source: "agent",
      type: "file_edit",
      action: input.action,
      description: input.description,
      filePath: input.filePath,
      agentName: "Entity",
      agentEmoji: "⚡",
      metadata: { orgId: input.binding.orgId },
    });
  }

  async function assertWorkspacePathOwnership(binding: RequestOrgBinding, absolutePath: string, operation: 'read' | 'write' = 'read'): Promise<FsFileOwnershipRecord[]> {
    const normalizedTarget = resolvePathThroughNearestExistingAncestor(absolutePath);
    const sources = fileSourceRepository.listSources(true);
    for (const source of sources) {
      if (source.type !== 'local' || !source.base_path) continue;
      const sourceRoot = resolvePathThroughNearestExistingAncestor(source.base_path);
      if (!isContainedPath(sourceRoot, normalizedTarget)) continue;
      const relative = path.relative(sourceRoot, normalizedTarget);
      if (relative) {
        const sourcePath = normalizeSourceRelativePath(relative);
        const stats = await fs.promises.stat(normalizedTarget).catch(() => null);
        if (stats?.isDirectory()) {
          if (operation === 'write') {
            assertOwnedDirectoryWriteAccess(binding, ownershipRepo, source.id, sourcePath, sources);
          } else {
            const scope = resolveOwnershipScope(binding);
            const records = ownershipRepo.listOwnershipForOrg?.(binding.orgId) ?? [];
            if (!sourceOwnershipPathVisible(scope, source.id, sourcePath, records, sources)) {
              throw new Error('File is outside file ownership scope.');
            }
          }
          return [];
        }
        const ownership = assertSourcePathOwnership(binding, source.id, sourcePath, operation);
        return ownership ? [ownership] : [];
      }
    }

    const workspaceRoot = resolvePathThroughNearestExistingAncestor(WORKSPACE);
    const workspaceRelative = path.relative(workspaceRoot, normalizedTarget);
    const workspacePath = workspaceRelative ? normalizeSourceRelativePath(workspaceRelative) : '';
    if (workspacePath) {
      const stats = await fs.promises.stat(normalizedTarget).catch(() => null);
      if (isReservedUploadPath(workspacePath)) {
        throw new Error('File ownership is required for reserved upload paths.');
      }
      if (stats?.isDirectory()) {
        if (operation === 'write') {
          assertOwnedDirectoryWriteAccess(binding, ownershipRepo, '__workspace__', workspacePath, sources);
        }
        return [];
      }
      const ownership = assertSourcePathOwnership(binding, '__workspace__', workspacePath, operation);
      return ownership ? [ownership] : [];
    }
    return [];
  }

  async function callerCanWriteWorkspacePath(binding: RequestOrgBinding, absolutePath: string): Promise<boolean> {
    try {
      if (pathIsCoveredByReadOnlyLocalSource(absolutePath, fileSourceRepository.listSources(true))) return false;
      await assertWorkspacePathOwnership(binding, absolutePath, 'write');
      return true;
    } catch {
      return false;
    }
  }

  function observedOwnershipForPath(absolutePath: string): FsFileOwnershipRecord[] {
    const target = resolvePathThroughNearestExistingAncestor(absolutePath);
    const records: FsFileOwnershipRecord[] = [];
    const seen = new Set<string>();
    const addRecord = (record: FsFileOwnershipRecord | undefined): void => {
      if (!record) return;
      const key = `${record.source_id}:${record.path}`;
      if (seen.has(key)) return;
      seen.add(key);
      records.push(record);
    };

    for (const source of fileSourceRepository.listSources(true)) {
      if (source.type !== 'local' || !source.base_path) continue;
      const sourceRoot = resolvePathThroughNearestExistingAncestor(source.base_path);
      if (!isContainedPath(sourceRoot, target)) continue;
      const relative = path.relative(sourceRoot, target);
      if (!relative) continue;
      addRecord(ownershipRepo.getOwnership(source.id, normalizeSourceRelativePath(relative)));
    }

    if (records.length === 0) {
      const workspaceRoot = resolvePathThroughNearestExistingAncestor(WORKSPACE);
      if (isContainedPath(workspaceRoot, target)) {
        const relative = path.relative(workspaceRoot, target);
        if (relative) addRecord(ownershipRepo.getOwnership('__workspace__', normalizeSourceRelativePath(relative)));
      }
    }
    return records;
  }

  function recordPhysicalPath(record: FsFileOwnershipRecord, sources: readonly FileSourceRecord[]): string | null {
    const source = sources.find((candidate) => candidate.id === record.source_id);
    const basePath = source?.base_path ?? (record.source_id === '__workspace__' ? WORKSPACE : null);
    if (!basePath || (source && source.type !== 'local')) return null;
    try {
      const sourceRoot = resolvePathThroughNearestExistingAncestor(basePath);
      const recordPath = resolvePathThroughNearestExistingAncestor(path.resolve(basePath, record.path));
      return isContainedPath(sourceRoot, recordPath) ? recordPath : null;
    } catch {
      return null;
    }
  }

  function ownershipPathScopesForMove(absolutePath: string, sources: readonly FileSourceRecord[]): FsFileOwnershipPathScope[] {
    const target = resolvePathThroughNearestExistingAncestor(absolutePath);
    const scopes: FsFileOwnershipPathScope[] = [];
    const seen = new Set<string>();
    const addScope = (sourceId: string, root: string): void => {
      let pathPrefix: string | null = null;
      if (isContainedPath(root, target)) {
        const relative = path.relative(root, target);
        pathPrefix = relative ? normalizeSourceRelativePath(relative) : '';
      } else if (isContainedPath(target, root)) {
        pathPrefix = '';
      }
      if (pathPrefix === null) return;
      const key = `${sourceId}:${pathPrefix}`;
      if (seen.has(key)) return;
      seen.add(key);
      scopes.push({ sourceId, pathPrefix });
    };

    for (const source of sources) {
      if (source.type !== 'local' || !source.base_path) continue;
      try {
        addScope(source.id, resolvePathThroughNearestExistingAncestor(source.base_path));
      } catch {
        // An unavailable source cannot contribute a physical alias to this check.
      }
    }
    try {
      addScope('__workspace__', resolvePathThroughNearestExistingAncestor(WORKSPACE));
    } catch {
      // The workspace path is already validated by the move route.
    }
    return scopes;
  }

  async function assertMoveSourceHasNoOwnedDescendants(binding: RequestOrgBinding, absolutePath: string, options: { skipScan?: boolean } = {}): Promise<void> {
    const stats = await fs.promises.stat(absolutePath);
    if (!stats.isDirectory()) return;

    const sources = fileSourceRepository.listSources(true);
    const sourceTarget = resolvePathThroughNearestExistingAncestor(absolutePath);
    const pathScopes = ownershipPathScopesForMove(absolutePath, sources);
    const hasOwnedDescendants = (): boolean => {
      const listedRecords = ownershipRepo.listOwnershipForPathScopes
        ? ownershipRepo.listOwnershipForPathScopes(pathScopes)
        : ownershipRepo.listOwnershipForOrg?.(binding.orgId) ?? [];
      return listedRecords.some((record) => {
        const recordTarget = recordPhysicalPath(record, sources);
        return Boolean(recordTarget && isContainedPath(sourceTarget, recordTarget));
      });
    };
    if (hasOwnedDescendants()) {
      throw new Error("Moving an owned upload is not supported until ownership is preserved.");
    }
    if (options.skipScan) return;

    const scan = async (directory: string): Promise<void> => {
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const childPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await scan(childPath);
          continue;
        }
        const ownership = await assertWorkspacePathOwnership(binding, childPath, 'write');
        if (ownership.length > 0) {
          throw new Error("Moving an owned upload is not supported until ownership is preserved.");
        }
      }
    };
    await scan(absolutePath);
    if (hasOwnedDescendants()) {
      throw new Error("Moving an owned upload is not supported until ownership is preserved.");
    }
  }

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

  async function resolveWorkspaceWritePath(rawPath: string): Promise<string> {
    const resolvedPath = await resolveWorkspaceMutationPath(rawPath);
    if (pathIsCoveredByReadOnlyLocalSource(resolvedPath, fileSourceRepository.listSources(true))) {
      throw new Error("File source is read-only.");
    }
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

    if (isMissingPathError(message)) {
      return 404;
    }

    if (normalized.startsWith("source file exceeds the configured read limit of ")) {
      return 413;
    }

    if (
      normalized.includes("outside workspace") ||
      normalized.includes("inside the workspace") ||
      normalized.includes("outside source root") ||
      normalized.includes("outside file ownership scope") ||
      normalized.includes("file ownership is required") ||
      normalized.includes("contributor role required") ||
      normalized.includes("outside the principal membership")
    ) {
      return 403;
    }

    if (normalized.includes("owned upload") && normalized.includes("ownership")) {
      return 409;
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

    if (normalized.includes("disabled") || normalized.includes("read-only")) {
      return 403;
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
      readLocalFileBounded(filePath),
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
    binding: RequestOrgBinding,
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
    assertSourcePathOwnership(binding, source.id, normalizedPath, 'read');

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
    const binding = requireRequestOrg(req, res);
    if (!binding) return;
    const rawPath = req.query.path;
    if (typeof rawPath !== "undefined" && typeof rawPath !== "string") {
      return res.status(400).json({ error: "path must be a string" });
    }

    const dirPath = rawPath || WORKSPACE;
    try {
      const resolvedDirPath = await resolveWorkspaceReadPath(dirPath, WORKSPACE);
      await assertWorkspacePathOwnership(binding, resolvedDirPath, 'read');
      const items = await fs.promises.readdir(resolvedDirPath, { withFileTypes: true });
      const files = [];
      for (const item of items) {
        if (item.name.startsWith(".")) continue;
        const childPath = path.join(resolvedDirPath, item.name);
        try {
          await assertWorkspacePathOwnership(binding, childPath, 'read');
          files.push({ name: item.name, isDirectory: item.isDirectory(), path: childPath });
        } catch {
          // Directory listings must not disclose names of foreign, pending, or
          // orphaned reserved uploads.
        }
      }
      return res.json(files);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(mapFileRouteErrorStatus(message)).json({ error: message });
    }
  }));

  app.get("/api/file/raw", asyncHandler(async (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return;
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
        ? await readRawSourceFile(sourceId, requestedPath, binding)
        : await (async () => {
            const resolved = await resolveWorkspaceReadPath(requestedPath, WORKSPACE);
            await assertWorkspacePathOwnership(binding, resolved, 'read');
            return readRawLocalFile(resolved);
          })();

      return sendRawFileResponse(req, res, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(mapFileRouteErrorStatus(message))
        .json({ error: message });
    }
  }));

  app.get("/api/file", asyncHandler(async (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return;
    const filePath = req.query.path;
    if (typeof filePath !== "string") {
      return res.status(400).json({ error: "path required" });
    }

    if (!filePath) {
      return res.status(400).json({ error: "path required" });
    }

    try {
      const resolvedFilePath = await resolveWorkspaceReadPath(filePath, WORKSPACE);
      await assertWorkspacePathOwnership(binding, resolvedFilePath, 'read');
      const readOnly = !(await callerCanWriteWorkspacePath(binding, resolvedFilePath));
      const [contentBuffer, stats] = await Promise.all([
        readLocalFileBounded(resolvedFilePath),
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
        readOnly,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(mapFileRouteErrorStatus(message))
        .json({ error: message });
    }
  }));

  app.post("/api/files/:path(*)/versions", asyncHandler(async (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return;
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
      await assertWorkspacePathOwnership(binding, resolvedFilePath, 'write');
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
    const binding = requireRequestOrg(req, res);
    if (!binding) return;
    const filePath = req.params.path;
    if (!filePath) {
      return res.status(400).json({ error: "path required" });
    }

    try {
      const resolvedFilePath = await resolveWorkspaceMutationPath(filePath);
      await assertWorkspacePathOwnership(binding, resolvedFilePath, 'read');
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
    const binding = requireRequestOrg(req, res);
    if (!binding) return;
    const filePath = req.params.path;
    const { id } = req.params;

    if (!filePath) {
      return res.status(400).json({ error: "path required" });
    }

    try {
      const resolvedFilePath = await resolveWorkspaceMutationPath(filePath);
      await assertWorkspacePathOwnership(binding, resolvedFilePath, 'read');
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
    const binding = requireRequestOrg(req, res);
    if (!binding) return;
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
      const resolvedFilePath = await resolveWorkspaceWritePath(filePath);
      const ownership = await assertWorkspacePathOwnership(binding, resolvedFilePath, 'write');
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
      logLegacyFileMutationActivity({
        binding,
        ownership,
        operation: 'edit',
        filePath: resolvedFilePath,
        action: "Edited file",
        description: `Updated ${relativePath}.`,
      });
      if (ownership.length === 0) {
        broadcast({ type: "file:changed", path: resolvedFilePath, content });
      }
      return res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(mapFileRouteErrorStatus(message)).json({ error: message });
    }
  }));

  app.post("/api/file", asyncHandler(async (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return;
    const { path: filePath, content } = req.body;
    if (typeof filePath !== "string" || !filePath) {
      return res.status(400).json({ error: "path required" });
    }

    try {
      const resolvedFilePath = await resolveWorkspaceWritePath(filePath);
      const ownership = await assertWorkspacePathOwnership(binding, resolvedFilePath, 'write');
      await fs.promises.mkdir(path.dirname(resolvedFilePath), { recursive: true });
      await fs.promises.writeFile(
        resolvedFilePath,
        typeof content === "string" ? content : "",
        "utf-8",
      );
      const relativePath = toWorkspaceRelativePath(resolvedFilePath);
      logLegacyFileMutationActivity({
        binding,
        ownership,
        operation: 'create',
        filePath: resolvedFilePath,
        action: "Created file",
        description: `Created ${relativePath}.`,
      });
      if (ownership.length === 0) {
        broadcast({ type: "file:created", path: resolvedFilePath });
      }
      return res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(mapFileRouteErrorStatus(message)).json({ error: message });
    }
  }));

  app.delete("/api/file", asyncHandler(async (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return;
    const filePath = req.query.path;
    if (typeof filePath !== "string") {
      return res.status(400).json({ error: "path required" });
    }

    if (!filePath) {
      return res.status(400).json({ error: "path required" });
    }

    try {
      const resolvedFilePath = await resolveWorkspaceWritePath(filePath);
      const observedOwnership = observedOwnershipForPath(resolvedFilePath);
      const ownership = await assertWorkspacePathOwnership(binding, resolvedFilePath, 'write');
      if (observedOwnership.length > 0 && !ownershipRepo.deleteOwnershipIfMatches) {
        throw new Error('Ownership cleanup is unavailable.');
      }
      await fs.promises.unlink(resolvedFilePath);
      for (const record of observedOwnership) {
        ownershipRepo.deleteOwnershipIfMatches?.(record);
      }
      fileVersionsByPath.delete(resolvedFilePath);
      const relativePath = toWorkspaceRelativePath(resolvedFilePath);
      logLegacyFileMutationActivity({
        binding,
        ownership,
        operation: 'delete',
        filePath: resolvedFilePath,
        action: "Deleted file",
        description: `Deleted ${relativePath}.`,
      });
      if (ownership.length === 0) {
        broadcast({ type: "file:deleted", path: resolvedFilePath });
      }
      return res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(mapFileRouteErrorStatus(message)).json({ error: message });
    }
  }));

  app.post("/api/file/move", asyncHandler(async (req, res) => {
    const binding = requireRequestOrg(req, res);
    if (!binding) return;
    const { from, to } = req.body;
    if (typeof from !== "string" || typeof to !== "string" || !from || !to) {
      return res.status(400).json({ error: "from and to required" });
    }

    let releaseMutation: (() => void) | undefined;
    try {
      releaseMutation = acquireFileMutationGuard('move');
      const resolvedFrom = await resolveWorkspaceWritePath(from);
      const resolvedTo = await resolveWorkspaceWritePath(to);
      const sourceOwnership = await assertWorkspacePathOwnership(binding, resolvedFrom, 'write');
      if (sourceOwnership.length > 0) {
        throw new Error("Moving an owned upload is not supported until ownership is preserved.");
      }
      await assertMoveSourceHasNoOwnedDescendants(binding, resolvedFrom, { skipScan: true });
      await assertWorkspacePathOwnership(binding, resolvedTo, 'write');
      await assertMoveSourceHasNoOwnedDescendants(binding, resolvedFrom);
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
        metadata: { orgId: binding.orgId },
      });
      if (sourceOwnership.length === 0) {
        broadcast({ type: "file:moved", from: resolvedFrom, to: resolvedTo });
      }
      return res.json({ success: true });
    } catch (err) {
      if (err instanceof FileMutationConflictError) return res.status(409).json({ error: err.message });
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(mapFileRouteErrorStatus(message)).json({ error: message });
    } finally {
      releaseMutation?.();
    }
  }));

}
