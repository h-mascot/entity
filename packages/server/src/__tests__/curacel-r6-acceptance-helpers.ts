/**
 * Curacel pilot — R6 / CRITERION-5 acceptance test helpers.
 *
 * Shared, stateless utilities for the production-composed acceptance suite:
 * temp-DB lifecycle, request auth headers, JSON parsing, and a deterministic
 * secret-leak scanner. Kept separate from the test file so the suite stays
 * under the 500 LOC file-size guideline (AGENTS.md).
 *
 * Nothing here is security-relevant on its own; it only exists to let the
 * composed acceptance proof assert "no raw secrets in responses" and provision
 * two orgs / roles on an isolated DB.
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';

/** A freshly-named temp SQLite path for an isolated acceptance run. */
export function tempDbPath(): string {
  return path.join(os.tmpdir(), `curacel-r6-${process.pid}-${randomUUID()}.sqlite`);
}

/** Remove a SQLite file and its WAL/SHM sidecars (best-effort). */
export function removeSqliteFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    fs.rmSync(file, { force: true });
  }
}

/** Parse a fetch Response body as JSON (typed loosely for assertions). */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** Standard auth header set: shared deployment bearer + optional customer token. */
export function authHeaders(
  apiToken: string,
  customerToken?: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${apiToken}` };
  if (customerToken) headers['x-entity-access-token'] = customerToken;
  return { ...headers, ...extra };
}

/**
 * Secret-bearing patterns that must NEVER appear as a value in a response.
 * Matches high-entropy bearer/opaque tokens, sk-* API keys, and explicit
 * `api_key=`/`token=`/`secret=` assignments. Env-var NAMES (e.g. the literal
 * string "ENTITY_API_TOKEN" listed in node-operations webhooks) are NOT values
 * and are allowed; the scanner only inspects string VALUES.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{10,}\b/, // OpenAI/Anthropic-style keys
  /Bearer\s+[A-Za-z0-9._\-]{32,}/i, // bearer + long opaque token
  /api[_-]?key\s*[:=]\s*[A-Za-z0-9_\-]{16,}/i, // explicit api_key=<value>
  /\b[A-Za-z0-9_\-]{40,}\b/, // generic long opaque secret-shaped blob (40+)
];

interface ScanAccumulator {
  hits: string[];
  knownLeaks: string[];
}

function scanValue(value: unknown, trail: string, knownSecrets: string[], acc: ScanAccumulator): void {
  if (typeof value === 'string') {
    for (const known of knownSecrets) {
      if (known.length >= 8 && value.includes(known)) {
        acc.knownLeaks.push(`${trail}: embedded known secret`);
      }
    }
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        acc.hits.push(`${trail}: matches ${pattern.source}`);
      }
    }
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanValue(entry, `${trail}[${index}]`, knownSecrets, acc));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // Skip object KEYS whose names are env-var identifiers (e.g. the
      // node-operations webhook `env` field lists env var NAMES, not values).
      scanValue(child, `${trail}.${key}`, knownSecrets, acc);
    }
  }
}

/**
 * Assert that `body` contains no raw secret values. `knownSecrets` are exact
 * secret strings (e.g. the test API token, customer access tokens) that must
 * never be echoed back. Throws a descriptive AssertionError on the first leak.
 */
export function assertNoSecretLeaks(body: unknown, knownSecrets: string[]): void {
  const acc: ScanAccumulator = { hits: [], knownLeaks: [] };
  scanValue(body, 'root', knownSecrets, acc);
  const all = [...acc.knownLeaks, ...acc.hits];
  if (all.length > 0) {
    throw new Error(`secret leak detected in response: ${all.join('; ')}`);
  }
}

/** The composed acceptance fixture: endpoints, credentials, org ids, handles. */
export interface AcceptanceFixture {
  baseUrl: string;
  apiToken: string;
  /** All secret values that must NEVER appear in any response body. */
  allSecrets: string[];
  tokens: {
    viewerAcme: string;
    managerAcme: string;
    managerBeta: string;
    globalAdmin: string;
  };
  ids: {
    viewerAcme: string;
    managerAcme: string;
    managerBeta: string;
    globalAdmin: string;
  };
  org: { acme: string; beta: string };
  server: http.Server;
}
