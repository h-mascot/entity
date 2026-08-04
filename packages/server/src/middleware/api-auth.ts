/**
 * API Authentication Middleware
 *
 * Protects all /api/* routes with bearer token authentication.
 * The token is configured via ENTITY_API_TOKEN env var.
 *
 * Public routes that don't require auth:
 *   - GET /api/health (health checks)
 *   - /api/clickclack/* (ClickClack proxy handles bearer/cookie auth)
 *
 * When ENTITY_API_TOKEN is not set, auth is SKIPPED (development mode).
 * When set, all /api/* requests require Authorization: Bearer <token>.
 */

import { createHash } from "crypto";
import type { Request, RequestHandler } from "express";
import type { IncomingMessage } from "http";

const AUTH_HEADER_PATTERN = /^Bearer\s+(.+)$/i;

let cachedTokenHash: string | null = null;
let cachedRawToken: string | null = null;

/**
 * Get SHA-256 hex hash of the configured API token.
 * Returns null if no token is configured (dev mode, no auth).
 */
function getTokenHash(): string | null {
  const raw = process.env.ENTITY_API_TOKEN?.trim();
  if (!raw) {
    return null;
  }

  // Re-compute only if token changed (shouldn't happen in practice)
  if (raw !== cachedRawToken) {
    cachedRawToken = raw;
    cachedTokenHash = createHash("sha256").update(raw, "utf8").digest("hex");
  }

  return cachedTokenHash;
}

/**
 * Extract bearer token from an Express Request or raw IncomingMessage.
 * Works with both Express requests (req.header()) and raw Node HTTP (req.headers).
 */
function extractBearerToken(req: Request | IncomingMessage): string | null {
  // Try Express-style req.header() first
  let headerValue: string | undefined;
  if (typeof (req as Request).header === "function") {
    headerValue = (req as Request).header("authorization");
  } else {
    // Raw IncomingMessage uses req.headers (lowercase keys)
    const val = req.headers?.authorization;
    headerValue = typeof val === "string" ? val : undefined;
  }

  if (typeof headerValue !== "string") {
    return null;
  }

  const match = AUTH_HEADER_PATTERN.exec(headerValue.trim());
  if (!match) {
    return null;
  }

  const token = match[1].trim();
  return token || null;
}

/**
 * Routes that are always public (no auth required).
 * These are typically health checks and client configuration endpoints.
 */
/** Routes that match exactly (no sub-paths). */
const PUBLIC_EXACT_ROUTES: readonly string[] = [
  "/api/health",
  "/api/version",
];

/** Routes where the prefix and all sub-paths are public. */
const PUBLIC_PREFIX_ROUTES: readonly string[] = [
  "/api/clickclack",      // has its own auth for SPA cookie requests
];

const SELF_AUTH_PREFIX_ROUTES: readonly string[] = [
  "/api/documents",       // agent-native editor routes enforce document token/scopes
];

/** Routes matched by pattern because they self-authenticate via a path token. */
const PUBLIC_PATTERN_ROUTES: readonly RegExp[] = [
  // Onboarding setup-agent entrypoints authenticate via the session token in
  // the path, so they must bypass the global bearer check.
  /^\/api\/onboarding\/agent-session\/[^/]+\/(manifest|progress|skill|bundle)$/,
];

/**
 * Legacy unprefixed API route roots mirrored alongside the /api/* surface
 * (registerTaskRoutes(""), registerAgentRoutes(""), etc.). They must be
 * protected too, otherwise a token-auth server leaks the same read/write
 * surface via /tasks, /agent/trigger, and friends.
 */
const PROTECTED_UNPREFIXED_ROOTS: readonly string[] = [
  "/tasks",
  "/activities",
  "/agent",
  "/crews",
  "/db-mode",
  "/doc-intelligence",
  "/documents",
  "/projects",
  "/roadmaps",
  "/roadmap-items",
  "/runtime",
];

/**
 * Check if a request path matches a public route pattern.
 *
 * Exported so the data-plane credential guard (Terra R1) can reuse the exact
 * same public-route definition instead of duplicating it.
 */
export function isPublicRoute(path: string): boolean {
  for (const exact of PUBLIC_EXACT_ROUTES) {
    if (path === exact) return true;
  }
  for (const prefix of PUBLIC_PREFIX_ROUTES) {
    if (path === prefix || path.startsWith(prefix + "/")) return true;
  }
  if (isAgentNativeEditorEnabled()) {
    for (const prefix of SELF_AUTH_PREFIX_ROUTES) {
      if (path === prefix || path.startsWith(prefix + "/")) return true;
    }
  }
  for (const pattern of PUBLIC_PATTERN_ROUTES) {
    if (pattern.test(path)) return true;
  }
  return false;
}

function isAgentNativeEditorEnabled(): boolean {
  const value = process.env.ENTITY_AGENT_NATIVE_EDITOR;
  if (typeof value === "undefined") {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return !(normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off");
}

/**
 * Whether a path is part of the protected API surface: the /api/* routes plus
 * the legacy unprefixed mirrors. Static assets and the SPA shell are
 * intentionally excluded so they keep serving without a token.
 *
 * Exported so the data-plane credential guard (Terra R1) can layer customer
 * credentials on exactly the same surface that the transport bearer protects.
 */
export function isProtectedApiPath(path: string): boolean {
  if (path === "/api" || path.startsWith("/api/")) {
    return true;
  }
  for (const root of PROTECTED_UNPREFIXED_ROOTS) {
    if (path === root || path.startsWith(root + "/")) return true;
  }
  return false;
}

/**
 * Create the API authentication middleware.
 *
 * When ENTITY_API_TOKEN is set: validates bearer token on all /api/* routes
 * except explicitly public ones.
 *
 * When ENTITY_API_TOKEN is NOT set: passes through (dev mode).
 */
export function createApiAuthMiddleware(): RequestHandler {
  return (req, res, next) => {
    // Skip auth if no token configured (development mode)
    const tokenHash = getTokenHash();
    if (!tokenHash) {
      return next();
    }

    // Skip auth for public routes
    if (isPublicRoute(req.path)) {
      return next();
    }

    // Protect /api/* and the legacy unprefixed API mirror routes
    if (!isProtectedApiPath(req.path)) {
      return next();
    }

    // Validate bearer token
    const bearerToken = extractBearerToken(req);
    if (!bearerToken) {
      res.status(401).json({
        code: "AUTH_TOKEN_REQUIRED",
        error: "Authorization bearer token is required.",
      });
      return;
    }

    const providedHash = createHash("sha256")
      .update(bearerToken, "utf8")
      .digest("hex");

    if (providedHash !== tokenHash) {
      res.status(401).json({
        code: "AUTH_TOKEN_INVALID",
        error: "Authorization token is invalid.",
      });
      return;
    }

    // Token is valid — proceed
    next();
  };
}

/**
 * Create WebSocket authentication handler.
 * Validates the initial HTTP upgrade request has a valid token.
 *
 * Supports token via:
 *   1. Authorization: Bearer <token> header
 *   2. ?token=<token> query parameter
 *
 * Works with raw Node.js IncomingMessage (not Express).
 */
export function createWsAuthHandler() {
  return (req: IncomingMessage): boolean => {
    const tokenHash = getTokenHash();

    // Skip if no token configured
    if (!tokenHash) {
      return true;
    }

    // Try Authorization header first
    const bearerToken = extractBearerToken(req);
    if (bearerToken) {
      const providedHash = createHash("sha256")
        .update(bearerToken, "utf8")
        .digest("hex");
      return providedHash === tokenHash;
    }

    // Try query parameter
    try {
      const url = new URL(req.url || "", "http://localhost");
      const queryToken = url.searchParams.get("token");
      if (typeof queryToken === "string" && queryToken.trim()) {
        const providedHash = createHash("sha256")
          .update(queryToken.trim(), "utf8")
          .digest("hex");
        return providedHash === tokenHash;
      }
    } catch {
      // URL parsing failed, no query token
    }

    return false;
  };
}

/**
 * Check if API authentication is enabled (i.e., ENTITY_API_TOKEN is set).
 */
export function isApiAuthEnabled(): boolean {
  return !!process.env.ENTITY_API_TOKEN?.trim();
}
