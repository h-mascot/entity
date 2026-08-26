/**
 * GQR-004 — Runtime composition integration suite.
 *
 * Exercises the deterministic fake provider through the REAL mounted
 * `/api/document-integrations` composition (ACTIVE_PLAN GQR-004 items 2 + 7): the same
 * `mountDocumentIntegrations` helper the server entry point uses (migration + registry +
 * composed provider runtime + admin status router + T-008 router), driven end-to-end over
 * HTTP with fixtures persisted through the authoritative fixture store.
 *
 * Write-gate truthfulness: Google / Microsoft / Local writes stay fail closed when any
 * gate is missing (no adapter, no policy, unproven authorization, missing admin
 * authorization, wrong write mode, unapproved destination) — exactly the R-003/R-005
 * fail-closed contract.
 *
 * Determinism: injected fixtures only; no network, no wall clock, no randomness.
 */

import Database from 'better-sqlite3';
import { Readable, Writable } from 'stream';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { mountDocumentIntegrations } from '../routes/document-integrations-mount';
import { createProviderFixtureStore } from './fixture-store';
import { resolvePhase2Flags } from '../phase2-flags';

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

/** Mount the REAL composition against a fresh in-memory db bound to workspace ws_A. */
function mountFixtureServer(db: Database.Database, env: Record<string, string | undefined> = { NODE_ENV: 'test' }) {
  const app = express();
  app.use(express.json());
  mountDocumentIntegrations(app, {
    db,
    env,
    flags: resolvePhase2Flags({}),
    resolveWorkspace: () => 'ws_A',
    logger: console,
  });
  return app;
}

interface SeedOptions {
  provider: 'google_workspace' | 'microsoft_365' | 'local_office';
  authState?: 'authorized' | 'degraded' | 'unauthorized' | 'unknown';
  destinationKind?: 'folder' | 'shared_drive' | 'onedrive' | 'sharepoint_library' | 'local_managed_storage';
  writeMode?: 'disabled' | 'create_only' | 'create_and_update';
  writeAuthorizationProven?: boolean;
  adminWriteAuthorized?: boolean;
  seedPolicy?: boolean;
  seedDestination?: boolean;
  allowedDestinationIds?: string[];
}

/** Persist the authoritative fixtures for one provider in ws_A through the fixture store. */
function seedProviderFixtures(db: Database.Database, options: SeedOptions): void {
  const store = createProviderFixtureStore(db);
  const tag = options.provider;
  store.upsertConnection({
    id: `conn-${tag}`,
    workspaceId: 'ws_A',
    tenantId: null,
    provider: options.provider,
    authState: options.authState ?? 'authorized',
    enabled: true,
  });
  if (options.seedDestination !== false) {
    store.upsertDestination({
      id: `dest_${tag}`,
      workspaceId: 'ws_A',
      tenantId: null,
      // Null connection id: the fake adapter's descriptors are connectionless, and the
      // R-003 destination predicate requires an exact connection match with the scope.
      connectionId: null,
      provider: options.provider,
      artifactTypes: ['document'],
      destinationKind: options.destinationKind ?? 'folder',
      externalId: `opaque-${tag}`,
      displayName: `Approved ${tag} destination`,
      enabled: true,
    });
  }
  if (options.seedPolicy !== false) {
    store.upsertPolicy({
      id: `pol-${tag}`,
      workspaceId: 'ws_A',
      tenantId: null,
      connectionId: null,
      provider: options.provider,
      artifactType: '*',
      allowedDestinationIds: options.allowedDestinationIds ?? [`dest_${tag}`],
      defaultDestinationId: `dest_${tag}`,
      writeMode: options.writeMode ?? 'create_and_update',
      confirmationPolicy: null,
      writeAuthorizationProven: options.writeAuthorizationProven ?? true,
      adminWriteAuthorized: options.adminWriteAuthorized ?? true,
      enabled: true,
    });
  }
}

let idempotencySeq = 0;

function createBody(provider: SeedOptions['provider'], overrides: Record<string, unknown> = {}) {
  idempotencySeq += 1;
  return {
    artifactType: 'document',
    title: 'Q3 Operating Plan',
    provider,
    destinationId: `dest_${provider}`,
    idempotencyKey: `op-create-${idempotencySeq}`,
    ...overrides,
  };
}

describe('fake provider through the real mounted composition', () => {
  it('create → get → mutate → versions end-to-end with persisted sandbox fixtures', async () => {
    const db = openFreshDb();
    seedProviderFixtures(db, { provider: 'google_workspace' });
    const app = mountFixtureServer(db);

    const created = await requestApp(app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: createBody('google_workspace'),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.provider).toBe('google_workspace');
    expect(createdBody.revision).toBe('rev-1');
    const documentId = createdBody.documentId as string;

    const fetched = await requestApp(app, { path: `/api/document-integrations/${documentId}` });
    expect(fetched.status).toBe(200);
    const document = (await fetched.json()).document;
    expect(document.title).toBe('Q3 Operating Plan');
    expect(document.provider).toBe('google_workspace');
    expect(document.capabilities.create.state).toBe('supported');

    const mutated = await requestApp(app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: `op-mutate-${documentId}`,
        operation: { kind: 'replace_text', content: 'updated body' },
      },
    });
    expect(mutated.status).toBe(200);
    const mutationBody = await mutated.json();
    expect(mutationBody.previousRevision).toBe('rev-1');
    expect(mutationBody.revision).toBe('rev-2');

    const versions = await requestApp(app, { path: `/api/document-integrations/${documentId}/versions` });
    expect(versions.status).toBe(200);
    expect(((await versions.json()).versions as unknown[]).length).toBeGreaterThan(0);

    // The admin status router is mounted by the same helper and reports the active sandbox.
    const status = await requestApp(app, { path: '/api/document-integrations/admin/status' });
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody.runtime).toEqual({ mode: 'sandbox', sandboxBootstrap: 'active' });
    expect(statusBody.providers.google_workspace.adapterRegistered).toBe(true);
  });

  it('idempotent create replay reconciles to the same document (R-026)', async () => {
    const db = openFreshDb();
    seedProviderFixtures(db, { provider: 'google_workspace' });
    const app = mountFixtureServer(db);

    const body = createBody('google_workspace');
    const first = await requestApp(app, { path: '/api/document-integrations', method: 'POST', body });
    expect(first.status).toBe(201);
    const replay = await requestApp(app, { path: '/api/document-integrations', method: 'POST', body });
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.reconciled).toBe(true);
    expect(replayBody.documentId).toBe((await first.json()).documentId);
  });
});

describe('write gates stay fail closed per provider', () => {
  it('google_workspace: no governing policy blocks creation with a typed DESTINATION_REQUIRED', async () => {
    const db = openFreshDb();
    seedProviderFixtures(db, { provider: 'google_workspace', seedPolicy: false });
    const app = mountFixtureServer(db);

    const res = await requestApp(app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: createBody('google_workspace'),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('DESTINATION_REQUIRED');
  });

  it('google_workspace: unproven write authorization keeps the effective mode disabled', async () => {
    const db = openFreshDb();
    seedProviderFixtures(db, { provider: 'google_workspace', writeAuthorizationProven: false });
    const app = mountFixtureServer(db);

    const res = await requestApp(app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: createBody('google_workspace'),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('WRITE_DISABLED');
  });

  it('microsoft_365: without fixtures there is no adapter — typed PROVIDER_UNAVAILABLE, never a write', async () => {
    const db = openFreshDb();
    seedProviderFixtures(db, { provider: 'google_workspace' });
    const app = mountFixtureServer(db);

    const res = await requestApp(app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: createBody('microsoft_365'),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('microsoft_365: fixture-backed adapter still writes only through every satisfied gate', async () => {
    const db = openFreshDb();
    seedProviderFixtures(db, { provider: 'microsoft_365', destinationKind: 'onedrive', adminWriteAuthorized: false });
    const app = mountFixtureServer(db);

    const res = await requestApp(app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: createBody('microsoft_365'),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('WRITE_DISABLED');
  });

  it('local_office: create_only permits creation but blocks mutation (WRITE_DISABLED)', async () => {
    const db = openFreshDb();
    seedProviderFixtures(db, {
      provider: 'local_office',
      destinationKind: 'local_managed_storage',
      writeMode: 'create_only',
    });
    const app = mountFixtureServer(db);

    const created = await requestApp(app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: createBody('local_office'),
    });
    expect(created.status).toBe(201);
    const documentId = (await created.json()).documentId as string;

    const mutated = await requestApp(app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: `op-mutate-${documentId}`,
        operation: { kind: 'replace_text', content: 'nope' },
      },
    });
    expect(mutated.status).toBe(403);
    expect((await mutated.json()).error.code).toBe('WRITE_DISABLED');
  });

  it('an unapproved destination is a typed veto, never a fallback location (R-007)', async () => {
    const db = openFreshDb();
    seedProviderFixtures(db, { provider: 'google_workspace', allowedDestinationIds: ['dest_elsewhere'] });
    const app = mountFixtureServer(db);

    const res = await requestApp(app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: createBody('google_workspace'),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('DESTINATION_NOT_ALLOWED');
  });
});

describe('production composition through the real mount', () => {
  it('mounts fail closed (no fake providers) and the status reports the refusal', async () => {
    const db = openFreshDb();
    seedProviderFixtures(db, { provider: 'google_workspace' });
    const app = mountFixtureServer(db, {
      NODE_ENV: 'production',
      ENTITY_DOCUMENT_PROVIDER_SANDBOX: '1',
    });

    const created = await requestApp(app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: createBody('google_workspace'),
    });
    expect(created.status).toBe(503);
    expect((await created.json()).error.code).toBe('PROVIDER_UNAVAILABLE');

    const status = await requestApp(app, { path: '/api/document-integrations/admin/status' });
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody.runtime).toEqual({ mode: 'production', sandboxBootstrap: 'refused' });
    expect(statusBody.providers.google_workspace.adapterRegistered).toBe(false);
  });
});
