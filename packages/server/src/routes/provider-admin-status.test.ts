/**
 * GQR-004 — Redacted provider-admin status endpoint.
 *
 * Contract under test (ACTIVE_PLAN GQR-004 item 4):
 *   - GET /api/document-integrations/admin/status returns a workspace-scoped, REDACTED
 *     per-provider runtime status: adapter registration, connection state, effective write
 *     gates, destinations (display metadata only), and capability-honest mutation lanes.
 *   - Redaction is structural: every response key belongs to a fixed allowlist; opaque
 *     provider identities (destination external ids) and anything secret-shaped are absent.
 *   - Production/fail-closed runtimes report truthful fail-closed status (never fabricated
 *     health), and an unresolvable workspace fails closed with a typed WORKSPACE_REQUIRED.
 *
 * Privacy: no credentials, raw tokens, tenant secrets, or operator-specific paths.
 */

import Database from 'better-sqlite3';
import { Readable, Writable } from 'stream';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import {
  composeDocumentProviderRuntime,
  type DocumentProviderRuntime,
} from '../document-providers/sandbox-runtime';
import { createProviderFixtureStore } from '../document-providers/fixture-store';
import { createProviderAdminStatusRouter, type ProviderAdminStatus } from './provider-admin-status';

const openDatabases: Database.Database[] = [];

afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
});

function openFreshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  openDatabases.push(db);
  return db;
}

async function requestApp(
  app: express.Express,
  options: { path: string; method?: string; body?: unknown },
): Promise<Response> {
  const bodyText = options.body === undefined ? '' : JSON.stringify(options.body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(bodyText ? { 'content-length': String(Buffer.byteLength(bodyText)) } : {}),
  };
  return await new Promise<Response>((resolve, reject) => {
    const req = Readable.from(bodyText ? [bodyText] : []) as any;
    req.url = options.path;
    req.method = options.method ?? 'GET';
    req.headers = headers;
    req.rawHeaders = Object.entries(headers).flatMap(([key, value]) => [key, value]);
    req.httpVersion = '1.1';
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    req.socket = { writable: true, on() {}, removeListener() {}, destroy() {} };
    req.connection = req.socket;

    const chunks: Buffer[] = [];
    const res: any = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });
    const headersMap = new Map<string, string>();
    res.statusCode = 200;
    Object.defineProperty(res, 'headersSent', { value: false, writable: true, configurable: true });
    Object.defineProperty(res, 'finished', { value: false, writable: true, configurable: true });
    Object.defineProperty(res, 'writableEnded', { value: false, writable: true, configurable: true });
    res.setHeader = (name: string, value: string) => {
      headersMap.set(String(name).toLowerCase(), String(value));
      return res;
    };
    res.getHeader = (name: string) => headersMap.get(String(name).toLowerCase());
    res.writeHead = (statusCode: number, reasonOrHeaders?: unknown, maybeHeaders?: Record<string, string>) => {
      res.statusCode = statusCode;
      const headerSource = typeof reasonOrHeaders === 'object' && reasonOrHeaders !== null
        ? reasonOrHeaders as Record<string, string>
        : maybeHeaders;
      if (headerSource) for (const [name, value] of Object.entries(headerSource)) res.setHeader(name, value);
      res.headersSent = true;
      return res;
    };
    const end = res.end.bind(res);
    res.end = (chunk?: unknown, encoding?: BufferEncoding, callback?: () => void) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding));
      res.headersSent = true;
      res.finished = true;
      res.writableEnded = true;
      resolve(new Response(Buffer.concat(chunks), {
        status: Number(res.statusCode ?? 200),
        headers: Object.fromEntries(headersMap.entries()),
      }));
      return end(() => {
        if (typeof callback === 'function') callback();
      });
    };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload: unknown) => {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
      return res;
    };
    res.on('error', reject);
    try {
      (app as any).handle(req, res, reject);
    } catch (error) {
      reject(error);
    }
  });
}

function mountStatus(db: Database.Database, runtime: DocumentProviderRuntime, workspace: string | null) {
  const app = express();
  app.use(
    '/api/document-integrations/admin',
    createProviderAdminStatusRouter({ runtime, db, resolveWorkspace: () => workspace }),
  );
  return app;
}

function seedSandboxFixtures(db: Database.Database, workspace = 'ws_A'): void {
  const store = createProviderFixtureStore(db);
  // Fixture ids are globally primary-keyed, so per-workspace seeds use distinct ids.
  const suffix = workspace === 'ws_A' ? 'a' : 'b';
  store.upsertConnection({
    id: `conn-google-${suffix}`,
    workspaceId: workspace,
    tenantId: null,
    provider: 'google_workspace',
    authState: 'authorized',
    enabled: true,
  });
  store.upsertDestination({
    id: `dest_${suffix}`,
    workspaceId: workspace,
    tenantId: null,
    connectionId: `conn-google-${suffix}`,
    provider: 'google_workspace',
    artifactTypes: ['document', 'spreadsheet'],
    destinationKind: 'folder',
    // Opaque provider identity — MUST NOT appear in the redacted status response.
    externalId: `folder-q3-opaque-${suffix}`,
    displayName: 'Q3 Plans folder',
    enabled: true,
  });
  store.upsertPolicy({
    id: `pol-google-${suffix}`,
    workspaceId: workspace,
    tenantId: null,
    connectionId: `conn-google-${suffix}`,
    provider: 'google_workspace',
    artifactType: '*',
    allowedDestinationIds: [`dest_${suffix}`],
    defaultDestinationId: `dest_${suffix}`,
    writeMode: 'create_and_update',
    confirmationPolicy: null,
    writeAuthorizationProven: true,
    adminWriteAuthorized: true,
    enabled: true,
  });
}

/** Every key allowed anywhere in the redacted status response (structural redaction). */
const ALLOWED_KEYS = new Set([
  'runtime',
  'mode',
  'sandboxBootstrap',
  'providers',
  // Provider ids are the fixed DOCUMENT_PROVIDERS vocabulary used as map keys.
  'google_workspace',
  'microsoft_365',
  'local_office',
  'adapterRegistered',
  'connectionState',
  'policyConfigured',
  'effectiveWriteMode',
  'adminWriteAuthorized',
  'writeAuthorizationProven',
  'confirmationPolicy',
  'destinations',
  'id',
  'displayName',
  'kind',
  'enabled',
  'artifactTypes',
  'mutationSupport',
  'agent_text_mutation',
  'agent_range_mutation',
  'agent_slide_mutation',
]);

function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
}

describe('provider-admin status in sandbox mode', () => {
  it('reports workspace-scoped provider status with honest mutation lanes', async () => {
    const db = openFreshDb();
    seedSandboxFixtures(db);
    const runtime = composeDocumentProviderRuntime({ db, env: { NODE_ENV: 'test' } });
    const app = mountStatus(db, runtime, 'ws_A');

    const res = await requestApp(app, { path: '/api/document-integrations/admin/status' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProviderAdminStatus;

    expect(body.runtime).toEqual({ mode: 'sandbox', sandboxBootstrap: 'active' });

    const google = body.providers.google_workspace;
    expect(google.adapterRegistered).toBe(true);
    expect(google.connectionState).toBe('authorized');
    expect(google.policyConfigured).toBe(true);
    expect(google.effectiveWriteMode).toBe('create_and_update');
    expect(google.adminWriteAuthorized).toBe(true);
    expect(google.writeAuthorizationProven).toBe(true);
    expect(google.confirmationPolicy).toBeNull();
    expect(google.destinations).toEqual([
      {
        id: 'dest_a',
        displayName: 'Q3 Plans folder',
        kind: 'folder',
        enabled: true,
        artifactTypes: ['document', 'spreadsheet'],
      },
    ]);
    // Capability-honest mutation lanes straight from the active fake adapter.
    expect(google.mutationSupport).toEqual({
      agent_text_mutation: 'supported',
      agent_range_mutation: 'unsupported',
      agent_slide_mutation: 'unsupported',
    });

    // A provider without fixtures stays fail closed and unknown — never fabricated health.
    const microsoft = body.providers.microsoft_365;
    expect(microsoft.adapterRegistered).toBe(false);
    expect(microsoft.connectionState).toBe('unknown');
    expect(microsoft.policyConfigured).toBe(false);
    expect(microsoft.effectiveWriteMode).toBe('disabled');
    expect(microsoft.destinations).toEqual([]);
    expect(microsoft.mutationSupport).toEqual({
      agent_text_mutation: 'unknown',
      agent_range_mutation: 'unknown',
      agent_slide_mutation: 'unknown',
    });
  });

  it('scopes status to the requesting workspace (no cross-workspace leak)', async () => {
    const db = openFreshDb();
    seedSandboxFixtures(db, 'ws_A');
    seedSandboxFixtures(db, 'ws_B');
    const runtime = composeDocumentProviderRuntime({ db, env: { NODE_ENV: 'test' } });
    const app = mountStatus(db, runtime, 'ws_A');

    const res = await requestApp(app, { path: '/api/document-integrations/admin/status' });
    const body = (await res.json()) as ProviderAdminStatus;
    expect(body.providers.google_workspace.destinations).toHaveLength(1);
    expect(body.providers.google_workspace.destinations[0].id).toBe('dest_a');
    // Same fixture ids were seeded per workspace; ws_B's rows must not aggregate in.
    expect(body.providers.google_workspace.policyConfigured).toBe(true);
  });

  it('reports the effective (fail-closed) write mode, not the stored one', async () => {
    const db = openFreshDb();
    const store = createProviderFixtureStore(db);
    store.upsertConnection({
      id: 'conn-google-a',
      workspaceId: 'ws_A',
      tenantId: null,
      provider: 'google_workspace',
      authState: 'authorized',
      enabled: true,
    });
    // Stored mode says create_and_update, but authorization is NOT proven and NOT admin-authorized.
    store.upsertPolicy({
      id: 'pol-google-a',
      workspaceId: 'ws_A',
      tenantId: null,
      connectionId: null,
      provider: 'google_workspace',
      artifactType: '*',
      allowedDestinationIds: [],
      defaultDestinationId: null,
      writeMode: 'create_and_update',
      confirmationPolicy: null,
      writeAuthorizationProven: false,
      adminWriteAuthorized: false,
      enabled: true,
    });
    const runtime = composeDocumentProviderRuntime({ db, env: { NODE_ENV: 'test' } });
    const app = mountStatus(db, runtime, 'ws_A');

    const res = await requestApp(app, { path: '/api/document-integrations/admin/status' });
    const body = (await res.json()) as ProviderAdminStatus;
    expect(body.providers.google_workspace.effectiveWriteMode).toBe('disabled');
    expect(body.providers.google_workspace.adminWriteAuthorized).toBe(false);
    expect(body.providers.google_workspace.writeAuthorizationProven).toBe(false);
  });
});

describe('provider-admin status in fail-closed modes', () => {
  it('reports refused + fail-closed providers for a production runtime with the sandbox flag set', async () => {
    const db = openFreshDb();
    seedSandboxFixtures(db);
    const runtime = composeDocumentProviderRuntime({
      db,
      env: { NODE_ENV: 'production', ENTITY_DOCUMENT_PROVIDER_SANDBOX: '1' },
    });
    const app = mountStatus(db, runtime, 'ws_A');

    const res = await requestApp(app, { path: '/api/document-integrations/admin/status' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProviderAdminStatus;
    expect(body.runtime).toEqual({ mode: 'production', sandboxBootstrap: 'refused' });
    for (const provider of ['google_workspace', 'microsoft_365', 'local_office'] as const) {
      expect(body.providers[provider]).toEqual({
        adapterRegistered: false,
        connectionState: 'unknown',
        policyConfigured: false,
        effectiveWriteMode: 'disabled',
        adminWriteAuthorized: false,
        writeAuthorizationProven: false,
        confirmationPolicy: null,
        destinations: [],
        mutationSupport: {
          agent_text_mutation: 'unknown',
          agent_range_mutation: 'unknown',
          agent_slide_mutation: 'unknown',
        },
      });
    }
  });

  it('fails closed with a typed WORKSPACE_REQUIRED when the workspace cannot be resolved', async () => {
    const db = openFreshDb();
    const runtime = composeDocumentProviderRuntime({ db, env: { NODE_ENV: 'test' } });
    const app = mountStatus(db, runtime, null);

    const res = await requestApp(app, { path: '/api/document-integrations/admin/status' });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('WORKSPACE_REQUIRED');
  });
});

describe('structural redaction', () => {
  it('emits only allowlisted keys and no secret-shaped or opaque-identity fields', async () => {
    const db = openFreshDb();
    seedSandboxFixtures(db);
    const runtime = composeDocumentProviderRuntime({ db, env: { NODE_ENV: 'test' } });
    const app = mountStatus(db, runtime, 'ws_A');

    const res = await requestApp(app, { path: '/api/document-integrations/admin/status' });
    const text = await res.text();
    const body = JSON.parse(text);

    const keys = new Set<string>();
    collectKeys(body, keys);
    const unexpected = [...keys].filter((key) => !ALLOWED_KEYS.has(key));
    expect(unexpected).toEqual([]);

    // Opaque provider identity is redacted from destinations (both workspaces' seeds).
    expect(text).not.toContain('opaque');
    expect(text).not.toContain('externalId');

    // Nothing secret-shaped may appear anywhere in the payload.
    for (const key of keys) {
      expect(/token|secret|credential|api[-_]?key|password/i.test(key)).toBe(false);
    }
  });
});
