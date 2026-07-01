import { createHash, randomUUID } from "crypto";
import type { Express, Request, Response } from "express";
import { getDocumentsDatabase } from "../documents/db";

interface RegisterDocumentRoutesDeps {
  workspaceRoot: string;
}

const AUTHOR_SET_VALID = new Set([
  "human",
  "assistant",
  "unknown",
]);
const DOCUMENT_PRESENCE_STATUS_SET = new Set([
  "active",
  "idle",
  "away",
  "offline",
]);
const DOCUMENT_SUGGESTION_TYPE_SET = new Set([
  "insert",
  "replace",
  "delete",
  "other",
]);
const DOCUMENT_SUGGESTION_STATUS_SET = new Set([
  "pending",
  "accepted",
  "rejected",
]);
const DOCUMENT_REVIEW_MODE_SET = new Set(["quick", "deep", "security"]);
const DOCUMENT_REVIEW_STATUS_SET = new Set([
  "pending",
  "running",
  "completed",
  "failed",
]);

type DocumentJsonPrimitive = string | number | boolean | null;
type DocumentJsonValue =
  | DocumentJsonPrimitive
  | DocumentJsonValue[]
  | { [key: string]: DocumentJsonValue };
type SqlRow = Record<string, unknown>;

interface ParsedDocumentId {
  docId: string;
  sourceId: string;
  path: string;
}

export function registerDocumentRoutes(
  app: Express,
  prefix: "" | "/api",
  deps: RegisterDocumentRoutesDeps,
): void {
  const base = `${prefix}/documents`;
  const documentsDb = getDocumentsDatabase(deps.workspaceRoot);
  const allCapabilities = {
    read: true,
    write: true,
    rename: true,
    delete: true,
    list: true,
    search: true,
  };

  function toDocumentJsonValue(value: unknown): DocumentJsonValue {
    if (value === null) {
      return null;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => toDocumentJsonValue(entry));
    }

    if (typeof value === "object") {
      const normalized: { [key: string]: DocumentJsonValue } = {};
      for (const [key, entry] of Object.entries(
        value as Record<string, unknown>,
      )) {
        normalized[key] = toDocumentJsonValue(entry);
      }
      return normalized;
    }

    return null;
  }

  function parseStoredJson(
    value: unknown,
    fallback: DocumentJsonValue,
  ): DocumentJsonValue {
    if (value === null || typeof value === "undefined") {
      return fallback;
    }

    if (typeof value === "string") {
      try {
        return toDocumentJsonValue(JSON.parse(value) as unknown);
      } catch {
        return fallback;
      }
    }

    return toDocumentJsonValue(value);
  }

  function toBoolean(value: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return value !== 0;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return (
        normalized === "1" ||
        normalized === "true" ||
        normalized === "yes" ||
        normalized === "on"
      );
    }

    return false;
  }

  function toNumberOrNull(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  function toIntegerOffset(value: unknown): number | null {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      return null;
    }

    return value;
  }

  function parseRequiredRange(
    from: unknown,
    to: unknown,
  ): { from: number; to: number } | null {
    const parsedFrom = toIntegerOffset(from);
    const parsedTo = toIntegerOffset(to);
    if (parsedFrom === null || parsedTo === null || parsedTo < parsedFrom) {
      return null;
    }

    return { from: parsedFrom, to: parsedTo };
  }

  function parseDocumentId(rawDocId: unknown): ParsedDocumentId | null {
    if (typeof rawDocId !== "string") {
      return null;
    }

    const trimmed = rawDocId.trim();
    if (!trimmed) {
      return null;
    }

    const splitIndex = trimmed.indexOf(":");
    if (splitIndex < 0) {
      return {
        docId: `default:${trimmed}`,
        sourceId: "default",
        path: trimmed,
      };
    }

    const sourceIdRaw = trimmed.slice(0, splitIndex).trim();
    const pathRaw = trimmed.slice(splitIndex + 1).trim();
    if (!pathRaw) {
      return null;
    }

    const sourceId = sourceIdRaw || "default";
    return {
      docId: `${sourceId}:${pathRaw}`,
      sourceId,
      path: pathRaw,
    };
  }

  function parseRequiredDocId(
    req: Request,
    res: Response,
  ): ParsedDocumentId | null {
    const parsed = parseDocumentId(req.params.docId);
    if (!parsed) {
      res.status(400).json({ error: "invalid docId" });
      return null;
    }

    return parsed;
  }

  function getActorFromRequest(
    req: Request,
    fallback = "human",
  ): string {
    const header = req.header("X-Entity-Actor");
    if (typeof header !== "string") {
      return fallback;
    }

    const normalized = header.trim();
    return normalized || fallback;
  }

  function normalizeOptionalString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  function ensureSession(parts: ParsedDocumentId) {
    const existing = documentsDb
      .prepare("SELECT * FROM document_sessions WHERE doc_id = ? LIMIT 1")
      .get(parts.docId) as SqlRow | undefined;
    if (existing) {
      return mapSession(existing);
    }

    const id = randomUUID();
    documentsDb
      .prepare(
        `
        INSERT INTO document_sessions (id, doc_id, source_id, path, content_hash, version)
        VALUES (?, ?, ?, ?, NULL, 1)
      `,
      )
      .run(id, parts.docId, parts.sourceId, parts.path);

    const inserted = documentsDb
      .prepare("SELECT * FROM document_sessions WHERE id = ? LIMIT 1")
      .get(id) as SqlRow | undefined;
    if (!inserted) {
      throw new Error("Failed to create document session.");
    }

    return mapSession(inserted);
  }

  function mapSession(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      source_id: String(row.source_id ?? ""),
      path: String(row.path ?? ""),
      content_hash:
        row.content_hash === null ? null : String(row.content_hash ?? ""),
      version: Number(row.version ?? 1),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapAuthorshipRange(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      start_offset: Number(row.start_offset ?? 0),
      end_offset: Number(row.end_offset ?? 0),
      author: String(row.author ?? "unknown"),
      reviewed: toBoolean(row.reviewed),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapAuthorshipHistory(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      range_id: row.range_id === null ? null : String(row.range_id ?? ""),
      author: String(row.author ?? ""),
      diff_json: parseStoredJson(row.diff_json, {}),
      timestamp: String(row.timestamp ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapPresence(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      agent_id: String(row.agent_id ?? ""),
      status: String(row.status ?? "active"),
      cursor_json: parseStoredJson(row.cursor_json, {}),
      last_activity_at: String(row.last_activity_at ?? ""),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapComment(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      author: String(row.author ?? ""),
      start_offset: Number(row.start_offset ?? 0),
      end_offset: Number(row.end_offset ?? 0),
      selected_text:
        row.selected_text === null ? null : String(row.selected_text ?? ""),
      text: String(row.text ?? ""),
      resolved: toBoolean(row.resolved),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapCommentReply(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      comment_id: String(row.comment_id ?? ""),
      author: String(row.author ?? ""),
      text: String(row.text ?? ""),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapSuggestion(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      author: String(row.author ?? ""),
      type: String(row.type ?? "replace"),
      start_offset: Number(row.start_offset ?? 0),
      end_offset: Number(row.end_offset ?? 0),
      original_text: String(row.original_text ?? ""),
      suggested_text: String(row.suggested_text ?? ""),
      reason: row.reason === null ? null : String(row.reason ?? ""),
      status: String(row.status ?? "pending"),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapReviewRun(row: SqlRow) {
    return {
      id: String(row.id ?? ""),
      doc_id: String(row.doc_id ?? ""),
      requested_by: String(row.requested_by ?? ""),
      mode: String(row.mode ?? "quick"),
      status: String(row.status ?? "pending"),
      result_json: parseStoredJson(row.result_json, null),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }

  function mapReviewFinding(row: SqlRow) {
    const startOffset = toNumberOrNull(row.start_offset);
    const endOffset = toNumberOrNull(row.end_offset);
    let range: { from: number; to: number } | null = null;
    if (
      startOffset !== null &&
      endOffset !== null &&
      endOffset >= startOffset
    ) {
      range = { from: startOffset, to: endOffset };
    }

    const suggestedFixCandidate = parseStoredJson(row.suggested_fix_json, null);
    let suggestedFix: { replacement: string } | null = null;
    if (
      suggestedFixCandidate !== null &&
      typeof suggestedFixCandidate === "object" &&
      !Array.isArray(suggestedFixCandidate)
    ) {
      const replacement = (suggestedFixCandidate as Record<string, unknown>)
        .replacement;
      if (typeof replacement === "string") {
        suggestedFix = { replacement };
      }
    }

    const status = String(row.status ?? "open");
    return {
      id: String(row.id ?? ""),
      type: String(row.type ?? "issue"),
      severity: String(row.severity ?? "info"),
      message: String(row.message ?? ""),
      range,
      suggestedFix,
      status,
    };
  }

  function getSnapshot(docId: string) {
    const session = documentsDb
      .prepare("SELECT * FROM document_sessions WHERE doc_id = ? LIMIT 1")
      .get(docId) as SqlRow | undefined;

    const authorshipRanges = (
      documentsDb
        .prepare(
          "SELECT * FROM authorship_ranges WHERE doc_id = ? ORDER BY start_offset ASC, created_at ASC",
        )
        .all(docId) as SqlRow[]
    ).map(mapAuthorshipRange);

    const authorshipHistory = (
      documentsDb
        .prepare(
          "SELECT * FROM authorship_history WHERE doc_id = ? ORDER BY timestamp DESC, updated_at DESC",
        )
        .all(docId) as SqlRow[]
    ).map(mapAuthorshipHistory);

    const presence = (
      documentsDb
        .prepare(
          "SELECT * FROM document_presence WHERE doc_id = ? ORDER BY last_activity_at DESC, created_at ASC",
        )
        .all(docId) as SqlRow[]
    ).map(mapPresence);

    const comments = (
      documentsDb
        .prepare(
          "SELECT * FROM document_comments WHERE doc_id = ? ORDER BY created_at ASC",
        )
        .all(docId) as SqlRow[]
    ).map(mapComment);

    const replies = (
      documentsDb
        .prepare(
          "SELECT * FROM document_comment_replies WHERE doc_id = ? ORDER BY created_at ASC",
        )
        .all(docId) as SqlRow[]
    ).map(mapCommentReply);

    const suggestions = (
      documentsDb
        .prepare(
          "SELECT * FROM document_suggestions WHERE doc_id = ? ORDER BY created_at DESC",
        )
        .all(docId) as SqlRow[]
    ).map(mapSuggestion);

    const reviewRuns = (
      documentsDb
        .prepare(
          "SELECT * FROM document_review_runs WHERE doc_id = ? ORDER BY created_at DESC",
        )
        .all(docId) as SqlRow[]
    ).map(mapReviewRun);

    return {
      session: session ? mapSession(session) : undefined,
      authorship_ranges: authorshipRanges,
      authorship_history: authorshipHistory,
      presence,
      comments,
      comment_replies: replies,
      suggestions,
      review_runs: reviewRuns,
    };
  }

  function percent(part: number, total: number): number {
    if (total <= 0) {
      return 0;
    }

    return Number(((part / total) * 100).toFixed(2));
  }

  function buildAuthorshipStats(
    authorshipRanges: Array<ReturnType<typeof mapAuthorshipRange>>,
  ) {
    const byAuthor: Record<
      string,
      { ranges: number; reviewedRanges: number; coveredCharacters: number }
    > = {};
    let coveredCharacters = 0;
    let reviewedRanges = 0;

    for (const range of authorshipRanges) {
      const span = Math.max(0, range.end_offset - range.start_offset);
      coveredCharacters += span;
      if (range.reviewed) {
        reviewedRanges += 1;
      }

      if (!byAuthor[range.author]) {
        byAuthor[range.author] = {
          ranges: 0,
          reviewedRanges: 0,
          coveredCharacters: 0,
        };
      }

      byAuthor[range.author].ranges += 1;
      byAuthor[range.author].coveredCharacters += span;
      if (range.reviewed) {
        byAuthor[range.author].reviewedRanges += 1;
      }
    }

    return {
      totalRanges: authorshipRanges.length,
      reviewedRanges,
      reviewedPercent: percent(reviewedRanges, authorshipRanges.length),
      coveredCharacters,
      human: percent(byAuthor.human?.coveredCharacters ?? 0, coveredCharacters),
      ada: percent(byAuthor.ada?.coveredCharacters ?? 0, coveredCharacters),
      spock: percent(byAuthor.spock?.coveredCharacters ?? 0, coveredCharacters),
      scotty: percent(
        byAuthor.scotty?.coveredCharacters ?? 0,
        coveredCharacters,
      ),
      byAuthor,
    };
  }

  function buildCommentsSummary(
    comments: Array<ReturnType<typeof mapComment>>,
    replies: Array<ReturnType<typeof mapCommentReply>>,
  ) {
    const total = comments.length;
    const resolved = comments.reduce(
      (count, comment) => count + (comment.resolved ? 1 : 0),
      0,
    );
    return {
      total,
      resolved,
      open: Math.max(0, total - resolved),
      replies: replies.length,
    };
  }

  function buildSuggestionsSummary(
    suggestions: Array<ReturnType<typeof mapSuggestion>>,
  ) {
    const byType = {
      insert: 0,
      replace: 0,
      delete: 0,
      other: 0,
    };

    let open = 0;
    let accepted = 0;
    let rejected = 0;
    for (const suggestion of suggestions) {
      if (suggestion.status === "accepted") {
        accepted += 1;
      } else if (suggestion.status === "rejected") {
        rejected += 1;
      } else {
        open += 1;
      }

      if (
        suggestion.type === "insert" ||
        suggestion.type === "replace" ||
        suggestion.type === "delete"
      ) {
        byType[suggestion.type] += 1;
      } else {
        byType.other += 1;
      }
    }

    return {
      total: suggestions.length,
      open,
      accepted,
      rejected,
      byType,
    };
  }

  function buildReviewSummary(
    reviewRuns: Array<ReturnType<typeof mapReviewRun>>,
  ) {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const run of reviewRuns) {
      if (run.status === "pending") {
        pending += 1;
      } else if (run.status === "running") {
        running += 1;
      } else if (run.status === "completed") {
        completed += 1;
      } else if (run.status === "failed") {
        failed += 1;
      }
    }

    return {
      total: reviewRuns.length,
      pending,
      running,
      completed,
      failed,
      latestRun: reviewRuns[0] ?? null,
    };
  }

  function buildCommentsResponse(docId: string) {
    const comments = (
      documentsDb
        .prepare(
          "SELECT * FROM document_comments WHERE doc_id = ? ORDER BY created_at ASC",
        )
        .all(docId) as SqlRow[]
    ).map(mapComment);
    const replies = (
      documentsDb
        .prepare(
          "SELECT * FROM document_comment_replies WHERE doc_id = ? ORDER BY created_at ASC",
        )
        .all(docId) as SqlRow[]
    ).map(mapCommentReply);

    const repliesByComment = new Map<
      string,
      Array<ReturnType<typeof mapCommentReply>>
    >();
    for (const reply of replies) {
      const list = repliesByComment.get(reply.comment_id) ?? [];
      list.push(reply);
      repliesByComment.set(reply.comment_id, list);
    }

    const threads = comments.map((comment) => ({
      id: comment.id,
      range: {
        from: comment.start_offset,
        to: comment.end_offset,
      },
      text: comment.text,
      author: comment.author,
      createdAt: comment.created_at,
      selectedText: comment.selected_text,
      resolved: comment.resolved,
      replies: (repliesByComment.get(comment.id) ?? []).map((reply) => ({
        id: reply.id,
        author: reply.author,
        text: reply.text,
        createdAt: reply.created_at,
      })),
    }));

    return {
      docId,
      threads,
    };
  }

  function buildSuggestionsResponse(docId: string) {
    const suggestions = (
      documentsDb
        .prepare(
          "SELECT * FROM document_suggestions WHERE doc_id = ? ORDER BY created_at DESC",
        )
        .all(docId) as SqlRow[]
    ).map(mapSuggestion);

    return {
      docId,
      suggestions: suggestions.map((suggestion) => ({
        id: suggestion.id,
        range: {
          from: suggestion.start_offset,
          to: suggestion.end_offset,
        },
        originalText: suggestion.original_text,
        suggestedText: suggestion.suggested_text,
        author: suggestion.author,
        status: suggestion.status,
        type: suggestion.type,
        createdAt: suggestion.created_at,
        updatedAt: suggestion.updated_at,
        reason: suggestion.reason,
      })),
    };
  }

  function buildReviewRunResponse(docId: string, runId: string) {
    const run = documentsDb
      .prepare(
        "SELECT * FROM document_review_runs WHERE doc_id = ? AND id = ? LIMIT 1",
      )
      .get(docId, runId) as SqlRow | undefined;
    if (!run) {
      return null;
    }

    const findings = (
      documentsDb
        .prepare(
          "SELECT * FROM document_review_findings WHERE doc_id = ? AND run_id = ? ORDER BY created_at ASC",
        )
        .all(docId, runId) as SqlRow[]
    ).map(mapReviewFinding);

    return {
      docId,
      run: mapReviewRun(run),
      findings,
    };
  }

  function normalizeSuggestionType(value: unknown): string {
    if (typeof value !== "string") {
      return "replace";
    }

    const normalized = value.trim().toLowerCase();
    if (!DOCUMENT_SUGGESTION_TYPE_SET.has(normalized)) {
      return "replace";
    }

    return normalized;
  }

  function normalizePresenceStatus(
    value: unknown,
    fallback = "active",
  ): string {
    if (typeof value !== "string") {
      return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "disconnected") {
      return "offline";
    }

    if (!DOCUMENT_PRESENCE_STATUS_SET.has(normalized)) {
      return fallback;
    }

    return normalized;
  }

  function normalizeReviewMode(value: unknown): string {
    if (typeof value !== "string") {
      return "quick";
    }

    const normalized = value.trim().toLowerCase();
    if (DOCUMENT_REVIEW_MODE_SET.has(normalized)) {
      return normalized;
    }

    if (normalized === "style" || normalized === "grammar") {
      return "quick";
    }

    if (normalized === "technical") {
      return "deep";
    }

    return "quick";
  }

  app.get(base, (_req, res) => {
    res.json({
      status: "ok",
      feature: "entity.agent_native_editor",
      storage: "sqlite",
      routes: {
        health: "/api/documents/health",
        state: "/api/documents/:docId/state",
        edit: "/api/documents/:docId/edit",
        authorship: "/api/documents/:docId/authorship",
        cursor: "/api/documents/:docId/cursor",
        comments: "/api/documents/:docId/comments",
        suggestions: "/api/documents/:docId/suggestions",
        reviews: "/api/documents/:docId/reviews",
      },
    });
  });

  app.get(`${base}/health`, (_req, res) => {
    res.json({
      status: "ok",
      feature: "entity.agent_native_editor",
      storage: "sqlite",
    });
  });

  app.get(`${base}/:docId/state`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    try {
      const session = ensureSession(parts);
      const snapshot = getSnapshot(parts.docId);
      const commentsSummary = buildCommentsSummary(
        snapshot.comments,
        snapshot.comment_replies,
      );
      const suggestionsSummary = buildSuggestionsSummary(snapshot.suggestions);
      const reviewSummary = buildReviewSummary(snapshot.review_runs);
      const authorshipStats = buildAuthorshipStats(snapshot.authorship_ranges);

      res.json({
        docId: session.doc_id,
        contentRef: {
          docId: session.doc_id,
          sourceId: session.source_id,
          path: session.path,
          contentHash: session.content_hash,
        },
        sourceId: session.source_id,
        path: session.path,
        capabilities: allCapabilities,
        authorshipStats,
        presence: snapshot.presence,
        commentsSummary,
        suggestionsSummary,
        reviewSummary,
        version: session.version,
        collaboration: snapshot,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.get(`${base}/:docId/comments`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    try {
      ensureSession(parts);
      res.json(buildCommentsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/comments`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const range = parseRequiredRange(req.body?.from, req.body?.to);
    if (!range) {
      return res.status(400).json({
        error: "from/to must be valid non-negative offsets and to >= from",
      });
    }

    if (typeof req.body?.text !== "string" || !req.body.text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const selectedText = Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "selectedText",
    )
      ? normalizeOptionalString(req.body?.selectedText)
      : null;
    const author = getActorFromRequest(req, "human");

    try {
      ensureSession(parts);
      documentsDb
        .prepare(
          `
          INSERT INTO document_comments (
            id, doc_id, author, start_offset, end_offset, selected_text, text, resolved
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `,
        )
        .run(
          randomUUID(),
          parts.docId,
          author,
          range.from,
          range.to,
          selectedText,
          req.body.text.trim(),
        );
      return res.status(201).json(buildCommentsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/comments/:commentId/replies`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const commentId =
      typeof req.params.commentId === "string"
        ? req.params.commentId.trim()
        : "";
    if (!commentId) {
      return res.status(400).json({ error: "commentId is required" });
    }

    if (typeof req.body?.text !== "string" || !req.body.text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const author = getActorFromRequest(req, "human");

    try {
      ensureSession(parts);
      const comment = documentsDb
        .prepare(
          "SELECT id FROM document_comments WHERE doc_id = ? AND id = ? LIMIT 1",
        )
        .get(parts.docId, commentId) as SqlRow | undefined;
      if (!comment) {
        return res.status(404).json({ error: "comment not found" });
      }

      documentsDb
        .prepare(
          `
          INSERT INTO document_comment_replies (id, doc_id, comment_id, author, text)
          VALUES (?, ?, ?, ?, ?)
        `,
        )
        .run(
          randomUUID(),
          parts.docId,
          commentId,
          author,
          req.body.text.trim(),
        );
      return res.status(201).json(buildCommentsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/comments/:commentId/resolve`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const commentId =
      typeof req.params.commentId === "string"
        ? req.params.commentId.trim()
        : "";
    if (!commentId) {
      return res.status(400).json({ error: "commentId is required" });
    }

    if (typeof req.body?.resolved !== "boolean") {
      return res.status(400).json({ error: "resolved must be a boolean" });
    }

    try {
      ensureSession(parts);
      const result = documentsDb
        .prepare(
          `
          UPDATE document_comments
          SET resolved = ?, updated_at = datetime('now')
          WHERE doc_id = ? AND id = ?
        `,
        )
        .run(req.body.resolved ? 1 : 0, parts.docId, commentId);
      if (result.changes === 0) {
        return res.status(404).json({ error: "comment not found" });
      }

      return res.json(buildCommentsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.get(`${base}/:docId/suggestions`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    try {
      ensureSession(parts);
      return res.json(buildSuggestionsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/suggestions`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const range = parseRequiredRange(req.body?.from, req.body?.to);
    if (!range) {
      return res.status(400).json({
        error: "from/to must be valid non-negative offsets and to >= from",
      });
    }

    if (typeof req.body?.originalText !== "string") {
      return res.status(400).json({ error: "originalText is required" });
    }

    if (typeof req.body?.suggestedText !== "string") {
      return res.status(400).json({ error: "suggestedText is required" });
    }

    const author = getActorFromRequest(req, "human");
    const suggestionType = normalizeSuggestionType(req.body?.type);
    const reason = Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "reason",
    )
      ? normalizeOptionalString(req.body?.reason)
      : null;

    try {
      ensureSession(parts);
      documentsDb
        .prepare(
          `
          INSERT INTO document_suggestions (
            id, doc_id, author, type, start_offset, end_offset, original_text, suggested_text, reason, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `,
        )
        .run(
          randomUUID(),
          parts.docId,
          author,
          suggestionType,
          range.from,
          range.to,
          req.body.originalText,
          req.body.suggestedText,
          reason,
        );
      return res.status(201).json(buildSuggestionsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/suggestions/:suggestionId/accept`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const suggestionId =
      typeof req.params.suggestionId === "string"
        ? req.params.suggestionId.trim()
        : "";
    if (!suggestionId) {
      return res.status(400).json({ error: "suggestionId is required" });
    }

    try {
      ensureSession(parts);
      const existing = documentsDb
        .prepare("SELECT id FROM document_suggestions WHERE doc_id = ? AND id = ? LIMIT 1")
        .get(parts.docId, suggestionId) as SqlRow | undefined;
      if (!existing) {
        return res.status(404).json({ error: "suggestion not found" });
      }

      return res.status(409).json({
        error: "Legacy document editor cannot apply suggestions to source content. Reject the suggestion or enable the agent-native editor.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/suggestions/:suggestionId/reject`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const suggestionId =
      typeof req.params.suggestionId === "string"
        ? req.params.suggestionId.trim()
        : "";
    if (!suggestionId) {
      return res.status(400).json({ error: "suggestionId is required" });
    }

    try {
      ensureSession(parts);
      const result = documentsDb
        .prepare(
          `
          UPDATE document_suggestions
          SET status = 'rejected', updated_at = datetime('now')
          WHERE doc_id = ? AND id = ?
        `,
        )
        .run(parts.docId, suggestionId);
      if (result.changes === 0) {
        return res.status(404).json({ error: "suggestion not found" });
      }

      return res.json(buildSuggestionsResponse(parts.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/reviews`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const mode = normalizeReviewMode(req.body?.mode);
    if (!DOCUMENT_REVIEW_MODE_SET.has(mode)) {
      return res
        .status(400)
        .json({ error: "mode must be quick, deep, or security" });
    }

    const requestedBy = getActorFromRequest(req, "human");
    const runId = randomUUID();
    const resultJson = JSON.stringify({ findings: [] });

    try {
      ensureSession(parts);
      documentsDb
        .prepare(
          `
          INSERT INTO document_review_runs (
            id, doc_id, requested_by, mode, status, result_json
          ) VALUES (?, ?, ?, ?, 'completed', ?)
        `,
        )
        .run(runId, parts.docId, requestedBy, mode, resultJson);

      const response = buildReviewRunResponse(parts.docId, runId);
      if (!response) {
        return res.status(500).json({ error: "failed to create review run" });
      }

      return res.status(201).json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.get(`${base}/:docId/reviews/:runId`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const runId =
      typeof req.params.runId === "string" ? req.params.runId.trim() : "";
    if (!runId) {
      return res.status(400).json({ error: "runId is required" });
    }

    try {
      ensureSession(parts);
      const response = buildReviewRunResponse(parts.docId, runId);
      if (!response) {
        return res.status(404).json({ error: "review run not found" });
      }

      return res.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(
    `${base}/:docId/reviews/:runId/findings/:findingId/apply`,
    (req, res) => {
      const parts = parseRequiredDocId(req, res);
      if (!parts) {
        return;
      }

      const runId =
        typeof req.params.runId === "string" ? req.params.runId.trim() : "";
      const findingId =
        typeof req.params.findingId === "string"
          ? req.params.findingId.trim()
          : "";
      if (!runId || !findingId) {
        return res
          .status(400)
          .json({ error: "runId and findingId are required" });
      }

      try {
        ensureSession(parts);
        const run = documentsDb
          .prepare(
            "SELECT id FROM document_review_runs WHERE doc_id = ? AND id = ? LIMIT 1",
          )
          .get(parts.docId, runId) as SqlRow | undefined;
        if (!run) {
          return res.status(404).json({ error: "review run not found" });
        }

        const existing = documentsDb
          .prepare("SELECT id FROM document_review_findings WHERE doc_id = ? AND run_id = ? AND id = ? LIMIT 1")
          .get(parts.docId, runId, findingId) as SqlRow | undefined;
        if (!existing) {
          return res.status(404).json({ error: "review finding not found" });
        }

        return res.status(409).json({
          error: "Legacy document editor cannot apply review findings to source content. Ignore the finding or enable the agent-native editor.",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return res.status(500).json({ error: message });
      }
    },
  );

  app.post(
    `${base}/:docId/reviews/:runId/findings/:findingId/ignore`,
    (req, res) => {
      const parts = parseRequiredDocId(req, res);
      if (!parts) {
        return;
      }

      const runId =
        typeof req.params.runId === "string" ? req.params.runId.trim() : "";
      const findingId =
        typeof req.params.findingId === "string"
          ? req.params.findingId.trim()
          : "";
      if (!runId || !findingId) {
        return res
          .status(400)
          .json({ error: "runId and findingId are required" });
      }

      try {
        ensureSession(parts);
        const run = documentsDb
          .prepare(
            "SELECT id FROM document_review_runs WHERE doc_id = ? AND id = ? LIMIT 1",
          )
          .get(parts.docId, runId) as SqlRow | undefined;
        if (!run) {
          return res.status(404).json({ error: "review run not found" });
        }

        const result = documentsDb
          .prepare(
            `
          UPDATE document_review_findings
          SET status = 'ignored'
          WHERE doc_id = ? AND run_id = ? AND id = ?
        `,
          )
          .run(parts.docId, runId, findingId);
        if (result.changes === 0) {
          return res.status(404).json({ error: "review finding not found" });
        }

        const response = buildReviewRunResponse(parts.docId, runId);
        if (!response) {
          return res.status(404).json({ error: "review run not found" });
        }

        return res.json(response);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return res.status(500).json({ error: message });
      }
    },
  );

  app.post(`${base}/:docId/edit`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const range = parseRequiredRange(req.body?.from, req.body?.to);
    if (!range) {
      return res.status(400).json({
        error: "from/to must be valid non-negative offsets and to >= from",
      });
    }

    if (typeof req.body?.insert !== "string") {
      return res.status(400).json({ error: "insert is required" });
    }

    const actorId = getActorFromRequest(req, "human");
    const attribution =
      normalizeOptionalString(req.body?.attribution) ?? actorId;
    const clientVersionRaw = req.body?.clientVersion;
    let clientVersion: number | null = null;
    if (typeof clientVersionRaw !== "undefined") {
      if (
        typeof clientVersionRaw !== "number" ||
        !Number.isInteger(clientVersionRaw) ||
        clientVersionRaw < 1
      ) {
        return res.status(400).json({
          error: "clientVersion must be a positive integer when provided",
        });
      }
      clientVersion = clientVersionRaw;
    }

    try {
      const session = ensureSession(parts);
      if (clientVersion !== null && clientVersion !== session.version) {
        return res.status(409).json({
          error: "version mismatch",
          version: session.version,
        });
      }

      const previousVersion = session.version;
      const nextVersion = previousVersion + 1;
      const contentHash = createHash("sha1")
        .update(
          JSON.stringify({
            docId: parts.docId,
            from: range.from,
            to: range.to,
            insert: req.body.insert,
            version: nextVersion,
          }),
        )
        .digest("hex");

      documentsDb
        .prepare(
          `
          UPDATE document_sessions
          SET version = ?, content_hash = ?, updated_at = datetime('now')
          WHERE doc_id = ?
        `,
        )
        .run(nextVersion, contentHash, parts.docId);

      const diffPayload = {
        operation: "edit",
        from: range.from,
        to: range.to,
        insert: req.body.insert,
        previousVersion,
        version: nextVersion,
        attribution,
        actorId,
      };
      documentsDb
        .prepare(
          `
          INSERT INTO authorship_history (
            id, doc_id, range_id, author, diff_json, timestamp, updated_at
          ) VALUES (?, ?, NULL, ?, ?, datetime('now'), datetime('now'))
        `,
        )
        .run(
          randomUUID(),
          parts.docId,
          attribution,
          JSON.stringify(diffPayload),
        );

      const updatedSession = documentsDb
        .prepare("SELECT * FROM document_sessions WHERE doc_id = ? LIMIT 1")
        .get(parts.docId) as SqlRow | undefined;
      if (!updatedSession) {
        return res
          .status(500)
          .json({ error: "document session not found after update" });
      }

      const mappedSession = mapSession(updatedSession);
      return res.json({
        docId: mappedSession.doc_id,
        actorId,
        attribution,
        sourceId: mappedSession.source_id,
        path: mappedSession.path,
        from: range.from,
        to: range.to,
        insert: req.body.insert,
        previousVersion,
        version: mappedSession.version,
        contentHash,
        contentLength: req.body.insert.length,
        updatedAt: mappedSession.updated_at,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/authorship`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const range = parseRequiredRange(req.body?.from, req.body?.to);
    if (!range) {
      return res.status(400).json({
        error: "from/to must be valid non-negative offsets and to >= from",
      });
    }

    if (typeof req.body?.author !== "string") {
      return res.status(400).json({ error: "author is required" });
    }

    const author = req.body.author.trim().toLowerCase();
    if (!AUTHOR_SET_VALID.has(author)) {
      return res.status(400).json({
        error:
          "author must be one of human, assistant, unknown",
      });
    }

    const actorId = getActorFromRequest(req, "human");
    try {
      ensureSession(parts);
      const existing = documentsDb
        .prepare(
          `
          SELECT * FROM authorship_ranges
          WHERE doc_id = ? AND start_offset = ? AND end_offset = ? AND author = ?
          LIMIT 1
        `,
        )
        .get(parts.docId, range.from, range.to, author) as SqlRow | undefined;

      let toggledOff = false;
      let mappedRange: ReturnType<typeof mapAuthorshipRange> | null = null;
      if (existing) {
        documentsDb
          .prepare("DELETE FROM authorship_ranges WHERE id = ?")
          .run(existing.id);
        documentsDb
          .prepare(
            `
            INSERT INTO authorship_history (id, doc_id, range_id, author, diff_json, timestamp, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `,
          )
          .run(
            randomUUID(),
            parts.docId,
            String(existing.id),
            author,
            JSON.stringify({
              operation: "remove_authorship_range",
              from: range.from,
              to: range.to,
              actorId,
            }),
          );
        toggledOff = true;
      } else {
        const rangeId = randomUUID();
        documentsDb
          .prepare(
            `
            INSERT INTO authorship_ranges (
              id, doc_id, start_offset, end_offset, author, reviewed
            ) VALUES (?, ?, ?, ?, ?, 0)
          `,
          )
          .run(rangeId, parts.docId, range.from, range.to, author);

        const inserted = documentsDb
          .prepare("SELECT * FROM authorship_ranges WHERE id = ? LIMIT 1")
          .get(rangeId) as SqlRow | undefined;
        mappedRange = inserted ? mapAuthorshipRange(inserted) : null;
        documentsDb
          .prepare(
            `
            INSERT INTO authorship_history (id, doc_id, range_id, author, diff_json, timestamp, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `,
          )
          .run(
            randomUUID(),
            parts.docId,
            rangeId,
            author,
            JSON.stringify({
              operation: "set_authorship_range",
              from: range.from,
              to: range.to,
              actorId,
            }),
          );
      }

      const snapshot = getSnapshot(parts.docId);
      return res.json({
        docId: parts.docId,
        actorId,
        from: range.from,
        to: range.to,
        author,
        toggledOff,
        range: mappedRange,
        authorshipStats: buildAuthorshipStats(snapshot.authorship_ranges),
        collaboration: snapshot,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/:docId/cursor`, (req, res) => {
    const parts = parseRequiredDocId(req, res);
    if (!parts) {
      return;
    }

    const actorId = getActorFromRequest(req, "human");
    const status = normalizePresenceStatus(req.body?.status, "active");
    if (!DOCUMENT_PRESENCE_STATUS_SET.has(status)) {
      return res
        .status(400)
        .json({ error: "status must be active, idle, away, or offline" });
    }

    const payloadRecord: Record<string, DocumentJsonValue> = {};
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "cursor")) {
      payloadRecord.cursor = toDocumentJsonValue(req.body?.cursor);
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "position")) {
      payloadRecord.position = toDocumentJsonValue(req.body?.position);
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "selection")) {
      payloadRecord.selection = toDocumentJsonValue(req.body?.selection);
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "action")) {
      payloadRecord.action = toDocumentJsonValue(req.body?.action);
    }

    const cursorPayload: DocumentJsonValue =
      Object.keys(payloadRecord).length > 0 ? payloadRecord : null;

    try {
      ensureSession(parts);
      documentsDb
        .prepare(
          `
          INSERT INTO document_presence (
            id, doc_id, agent_id, status, cursor_json, last_activity_at
          ) VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(doc_id, agent_id) DO UPDATE SET
            status = excluded.status,
            cursor_json = excluded.cursor_json,
            last_activity_at = datetime('now'),
            updated_at = datetime('now')
        `,
        )
        .run(
          randomUUID(),
          parts.docId,
          actorId,
          status,
          cursorPayload === null ? null : JSON.stringify(cursorPayload),
        );

      const presenceRow = documentsDb
        .prepare(
          "SELECT * FROM document_presence WHERE doc_id = ? AND agent_id = ? LIMIT 1",
        )
        .get(parts.docId, actorId) as SqlRow | undefined;
      if (!presenceRow) {
        return res.status(500).json({ error: "presence update failed" });
      }

      const presence = mapPresence(presenceRow);
      return res.json({
        docId: parts.docId,
        actor: actorId,
        status: presence.status,
        heartbeatAt: presence.last_activity_at,
        presence,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  });
}

