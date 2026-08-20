/**
 * T-008 — Provider-neutral Document Integration API — API contract tests.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md §12,
 * route templates under the option (a) default namespace.
 *
 * Coverage (T-008 acceptance "typed errors and revision requirement implemented"):
 *   - All five routes under /api/document-integrations (get/create/mutate/capabilities/versions).
 *   - Typed errors: 409 STALE_REVISION with expected/current revision + retryable:true;
 *     unapproved-destination / missing-policy fail closed; unknown/degraded capability fails
 *     closed; cross-workspace probes are not an existence oracle.
 *   - expectedRevision + idempotencyKey required on mutations.
 *   - Capabilities include reason codes; versions surface revision/actorType/actorId/
 *     observedAt/providerModifiedAt.
 *
 * Provider-neutral: every provider is reached through the deterministic fake adapter (T-005);
 * no provider-specific code, no network, no wall clock, no uncontrolled randomness.
 *
 * Privacy: no credentials, raw tokens, tenant secrets, document contents, or operator-specific
 * absolute paths in fixtures/logs/output.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable, Writable } from 'stream';
import express from 'express';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { DocumentRegistry, RegistryWriteInput } from '../document-providers/registry';
import { createDocumentRegistry } from '../document-providers/registry';
import { createDocumentIntegrationsRepository } from '../../../db/src/document-integrations';
import type { DocumentArtifactType } from '../../../db/src/document-integrations';
import type { DocumentProviderAdapter } from '../document-providers/types';
import { createFakeDocumentProviderAdapter } from '../document-providers/fake-adapter';
import {
  createDocumentIntegrationsRouter,
  DocumentApiError,
  parseMutation,
  type DocumentIntegrationsRouterDeps,
} from './document-integrations';
import type { WritePolicy } from '../document-providers/write-policy';
import { createPolicyForWorkspace } from '../document-providers/write-policy';
import type { DocumentDestination } from '../document-providers/destinations';
import { resolvePhase2Flags } from '../phase2-flags';

interface TestContext {
  app: express.Express;
  registry: DocumentRegistry;
  adapters: Map<string, DocumentProviderAdapter>;
  policies: WritePolicy[];
  destinations: DocumentDestination[];
  defaultWorkspace: string;
}

/** Deterministic injected clock for the test router (B4: frozen determinism belongs to injection). */
const TEST_NOW = '2026-08-18T00:00:00.000Z';

const openDatabases: Database.Database[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openFreshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  openDatabases.push(db);
  return db;
}

function baseWriteInput(overrides: Partial<RegistryWriteInput> = {}): RegistryWriteInput {
  return {
    provider: 'google_workspace',
    artifact_type: 'document',
    title: 'Q3 Operating Plan',
    external_id: 'goog-doc-sample-1',
    provider_url: 'https://example.test/d/sample-1',
    owner_summary: 'owner:acct',
    tenant_external_id: null,
    permissions_summary_json: '{"canEdit":true}',
    sensitivity_label: 'internal',
    auth_state: 'authorized',
    readiness_state: 'ready',
    current_revision: 'rev-1',
    indexed_at: '2026-08-18T00:00:00.000Z',
    conflict_state: 'none',
    preview_state: 'ready',
    ...overrides,
  };
}

function basePolicy(overrides: Partial<WritePolicy> = {}): WritePolicy {
  return createPolicyForWorkspace({
    workspaceId: 'ws_A',
    tenantId: null,
    connectionId: null,
    provider: 'google_workspace',
    artifactType: 'document',
    allowedDestinationIds: new Set(['dest_1']),
    defaultDestinationId: 'dest_1',
    writeMode: 'create_and_update',
    confirmationPolicy: null,
    writeAuthorizationProven: true,
    // T-013 (R-005): base fixtures assume an explicit administrator write authorization.
    adminWriteAuthorized: true,
    ...overrides,
  });
}

function baseDestination(overrides: Partial<DocumentDestination> = {}): DocumentDestination {
  return {
    id: 'dest_1',
    workspaceId: 'ws_A',
    tenantId: null,
    connectionId: null,
    provider: 'google_workspace',
    artifactTypes: new Set<DocumentArtifactType>(['document']),
    destinationKind: 'folder',
    externalId: 'folder-1',
    displayName: 'Folder 1',
    enabled: true,
    ...overrides,
  };
}

function setup(overrides: Partial<DocumentIntegrationsRouterDeps> = {}): TestContext {
  const db = openFreshDb();
  const repo = createDocumentIntegrationsRepository(db);
  repo.ensureSchema();
  const registry = createDocumentRegistry(db);
  const adapters = new Map<string, DocumentProviderAdapter>();
  const policies: WritePolicy[] = [];
  const destinations: DocumentDestination[] = [];

  const deps: DocumentIntegrationsRouterDeps = {
    registry,
    adapters: (provider: string) => adapters.get(provider),
    policies,
    destinations,
    flags: resolvePhase2Flags(),
    resolveWorkspace: (req) => {
      const header = req.headers['x-entity-workspace-id'];
      return typeof header === 'string' && header ? header : 'ws_A';
    },
    // Deterministic clock injected for the tests (B4: frozen determinism is injection-only).
    now: () => TEST_NOW,
    // M2: the route derives connection state from the registered connection. In the default test
    // fixture the fake adapter's registered connection is authorized, so consumers inject that.
    connectionStateFor: () => 'authorized',
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/document-integrations', createDocumentIntegrationsRouter(deps));
  return { app, registry, adapters, policies, destinations, defaultWorkspace: 'ws_A' };
}

async function requestApp(
  app: express.Express,
  options: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<Response> {
  const bodyText = options.body === undefined ? '' : JSON.stringify(options.body);
  const normalizedHeaders: Record<string, string> = { 'content-type': 'application/json' };
  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers)) normalizedHeaders[k.toLowerCase()] = String(v);
  }
  if (bodyText && !normalizedHeaders['content-length']) {
    normalizedHeaders['content-length'] = String(Buffer.byteLength(bodyText));
  }

  return await new Promise<Response>((resolve, reject) => {
    const req = Readable.from(bodyText ? [bodyText] : []) as any;
    req.url = options.path;
    req.method = options.method ?? 'GET';
    req.headers = normalizedHeaders;
    req.rawHeaders = Object.entries(normalizedHeaders).flatMap(([key, value]) => [key, value]);
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
    res.getHeaders = () => Object.fromEntries(headersMap.entries());
    res.removeHeader = (name: string) => {
      headersMap.delete(String(name).toLowerCase());
    };
    res.writeHead = (statusCode: number, reasonOrHeaders?: unknown, maybeHeaders?: Record<string, string>) => {
      res.statusCode = statusCode;
      const headerSource = typeof reasonOrHeaders === 'object' && reasonOrHeaders !== null
        ? reasonOrHeaders as Record<string, string>
        : maybeHeaders;
      if (headerSource) {
        for (const [name, value] of Object.entries(headerSource)) res.setHeader(name, value);
      }
      res.headersSent = true;
      return res;
    };
    const end = res.end.bind(res);
    res.end = (chunk?: unknown, encoding?: BufferEncoding, callback?: () => void) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding));
      }
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
    res.type = (type: string) => {
      res.setHeader('content-type', type);
      return res;
    };
    res.send = (payload: unknown) => {
      res.end(typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : String(payload));
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

async function bodyOf(res: Response): Promise<any> {
  return res.json();
}

/** Deterministic counter for idempotency keys (no unseeded randomness). */
let idempotencySeq = 0;

/** Default create request body for a google_workspace document into dest_1 in ws_A. */
function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  idempotencySeq += 1;
  return {
    artifactType: 'document',
    title: 'Q3 Operating Plan',
    provider: 'google_workspace',
    destinationId: 'dest_1',
    idempotencyKey: `op-create-${idempotencySeq}`,
    ...overrides,
  };
}

/**
 * Create a document through the API (seeds the deterministic fake adapter AND the registry, so
 * the fake's mutate/getVersions can resolve the artifact). Returns the created record id.
 */
async function createViaApi(ctx: TestContext, body: Record<string, unknown>): Promise<string> {
  const res = await requestApp(ctx.app, { path: '/api/document-integrations', method: 'POST', body });
  expect(res.status).toBe(201);
  return (await bodyOf(res)).documentId;
}

describe('T-008 provider-neutral document API — get (§12.1)', () => {
  it('GET returns a document envelope with provider, artifactType, revision, and capabilities', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    const created = ctx.registry.register(baseWriteInput(), 'ws_A');

    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${created.record.id}`,
    });
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.document.id).toBe(created.record.id);
    expect(body.document.provider).toBe('google_workspace');
    expect(body.document.artifactType).toBe('document');
    expect(body.document.revision).toBe('rev-1');
    expect(body.document.capabilities).toBeDefined();
    expect(body.document.capabilities.read.state).toBe('supported');
  });

  it('GET returns typed DOCUMENT_NOT_FOUND for an unknown id (never a bare 500)', async () => {
    const ctx = setup();
    const res = await requestApp(ctx.app, { path: '/api/document-integrations/doc_missing' });
    expect(res.status).toBe(404);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('GET of an id owned by another workspace returns the SAME 404 — not an existence oracle', async () => {
    const ctx = setup();
    const created = ctx.registry.register(baseWriteInput(), 'ws_A');
    // Same id, different workspace header.
    const cross = await requestApp(ctx.app, {
      path: `/api/document-integrations/${created.record.id}`,
      headers: { 'x-entity-workspace-id': 'ws_B' },
    });
    const unknown = await requestApp(ctx.app, { path: '/api/document-integrations/doc_unknown' });
    expect(cross.status).toBe(404);
    expect(unknown.status).toBe(404);
    const crossBody = await bodyOf(cross);
    const unknownBody = await bodyOf(unknown);
    // Indistinguishable responses: the probe cannot learn whether the id exists.
    expect(crossBody.error.code).toBe('DOCUMENT_NOT_FOUND');
    expect(crossBody.error.code).toBe(unknownBody.error.code);
  });

  it('gap 3: a KNOWN document with no registered adapter returns typed 503 PROVIDER_UNAVAILABLE (fail closed)', async () => {
    const ctx = setup();
    // No adapter is registered for google_workspace.
    const created = ctx.registry.register(baseWriteInput(), 'ws_A');
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${created.record.id}`,
    });
    expect(res.status).toBe(503);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('PROVIDER_UNAVAILABLE');
  });
});

describe('T-008 provider-neutral document API — create (§12.2)', () => {
  it('create into an approved destination returns documentId/revision/operationId (201)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());

    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: {
        artifactType: 'document',
        title: 'Q3 Operating Plan',
        provider: 'google_workspace',
        destinationId: 'dest_1',
        idempotencyKey: 'op_1',
      },
    });
    expect(res.status).toBe(201);
    const body = await bodyOf(res);
    expect(body.documentId).toMatch(/^doc_|^[0-9a-f-]{36}$/);
    expect(body.provider).toBe('google_workspace');
    expect(body.revision).toBeTruthy();
    expect(body.operationId).toBe('op_1');
  });

  it('create into an unapproved destination FAILS CLOSED with a typed DESTINATION_NOT_ALLOWED (with cause)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy({ allowedDestinationIds: new Set(['dest_allowed']) }));
    ctx.destinations.push(baseDestination({ id: 'dest_allowed', externalId: 'folder-allowed' }));

    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: {
        artifactType: 'document',
        title: 'Q3',
        provider: 'google_workspace',
        destinationId: 'dest_evil',
        idempotencyKey: 'op_1',
      },
    });
    expect(res.status).toBe(422);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('DESTINATION_NOT_ALLOWED');
    expect(body.error.cause).toBe('not_in_approved_set');
  });

  it('create with no governing policy FAILS CLOSED with a typed DESTINATION_REQUIRED config error', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: {
        artifactType: 'document',
        title: 'Q3',
        provider: 'google_workspace',
        destinationId: 'dest_1',
        idempotencyKey: 'op_1',
      },
    });
    expect(res.status).toBe(409);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('DESTINATION_REQUIRED');
  });

  it('create blocked when the policy write mode is disabled (read-only) — typed WRITE_DISABLED', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy({ writeMode: 'disabled' }));
    ctx.destinations.push(baseDestination());
    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: {
        artifactType: 'document',
        title: 'Q3',
        provider: 'google_workspace',
        destinationId: 'dest_1',
        idempotencyKey: 'op_1',
      },
    });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('WRITE_DISABLED');
  });

  it('cross-workspace create of an existing identity FAILS CLOSED with a typed conflict that reveals nothing (THE-944 r2 F7)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    // ws_A owns the identity; ws_B has its own valid policy so the create reaches the
    // identity-conflict check (never an existence oracle) rather than failing at the policy gate.
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    ctx.policies.push(basePolicy({ workspaceId: 'ws_B' }));
    ctx.destinations.push(baseDestination({ workspaceId: 'ws_B' }));
    // Own the identity in ws_A via a direct strict create of the SAME external_id the fake
    // adapter will mint (deterministic: `google_workspace-document-0` is the fake's first id).
    ctx.registry.create(
      baseWriteInput({ external_id: 'google_workspace-document-0' }),
      'ws_A',
    );

    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      headers: { 'x-entity-workspace-id': 'ws_B' },
      body: {
        artifactType: 'document',
        title: 'Q3',
        provider: 'google_workspace',
        destinationId: 'dest_1',
        idempotencyKey: 'op_1',
      },
    });
    expect(res.status).toBe(409);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('DOCUMENT_ALREADY_EXISTS');
    // The error message must not name the owning workspace.
    expect(body.error.message).not.toMatch(/ws_A/);
  });

  it('B2 (gap 1): a create retry with the SAME idempotencyKey reconciles to the existing record (200, never 409 DOCUMENT_ALREADY_EXISTS)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const body = {
      artifactType: 'document',
      title: 'Q3',
      provider: 'google_workspace',
      destinationId: 'dest_1',
      idempotencyKey: 'op_replay',
    };
    const first = await requestApp(ctx.app, { path: '/api/document-integrations', method: 'POST', body });
    expect(first.status).toBe(201);
    const firstId = (await bodyOf(first)).documentId;

    // Same idempotency key -> idempotent replay (created.created === false) must reconcile.
    const retry = await requestApp(ctx.app, { path: '/api/document-integrations', method: 'POST', body });
    expect(retry.status).toBe(200);
    const retryBody = await bodyOf(retry);
    expect(retryBody.documentId).toBe(firstId);
    expect(retryBody.reconciled).toBe(true);
    expect(retryBody.error).toBeUndefined();
  });

  it('B3: create with initialContent that the lane cannot honor is REJECTED (no silent drop)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: {
        artifactType: 'document',
        title: 'Q3',
        provider: 'google_workspace',
        destinationId: 'dest_1',
        idempotencyKey: 'op_content',
        initialContent: { kind: 'structured_document', blocks: [{ type: 'heading', text: 'Q3' }] },
      },
    });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('B3: create with associations that the lane cannot honor is REJECTED (no silent drop)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: {
        artifactType: 'document',
        title: 'Q3',
        provider: 'google_workspace',
        destinationId: 'dest_1',
        idempotencyKey: 'op_assoc',
        associations: [{ type: 'project', id: 'project_123' }],
      },
    });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('gap 2: create with NO destinationId (but a governing policy) fails closed with WRITE_DISABLED — not DESTINATION_REQUIRED', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: {
        artifactType: 'document',
        title: 'Q3',
        provider: 'google_workspace',
        idempotencyKey: 'op_nodest',
      },
    });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('WRITE_DISABLED');
  });

  it('M2: create does NOT fabricate connection authorized — an unknown connection state fails closed (CAPABILITY_UNSUPPORTED)', async () => {
    // connectionStateFor overridden to return undefined (unknown) — the route must not assume
    // 'authorized' and must fail closed.
    const ctx = setup({ connectionStateFor: () => undefined });
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: {
        artifactType: 'document',
        title: 'Q3',
        provider: 'google_workspace',
        destinationId: 'dest_1',
        idempotencyKey: 'op_unknown_conn',
      },
    });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('M2: a closed mutation gate (runtime evidence) fails create closed (CAPABILITY_UNSUPPORTED)', async () => {
    const ctx = setup({ runtimeEvidence: () => ({ mutationGateOpen: false }) });
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: {
        artifactType: 'document',
        title: 'Q3',
        provider: 'google_workspace',
        destinationId: 'dest_1',
        idempotencyKey: 'op_closed_gate',
      },
    });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('F2: an idempotent replay whose provider identity is NOT yet registered returns 409 CREATE_RECONCILIATION_REQUIRED', async () => {
    const ctx = setup();
    const adapter = createFakeDocumentProviderAdapter();
    ctx.adapters.set('google_workspace', adapter);
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    // Seed the adapter's OWN idempotency map directly (bypassing the registry) so a replay of the
    // same key yields created:false for an artifact the canonical registry has never seen.
    await adapter.create({
      artifact_type: 'document',
      title: 'orphaned provider-side artifact',
      idempotencyKey: 'op_orphan_replay',
      now: TEST_NOW,
    });
    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: {
        artifactType: 'document',
        title: 'Q3',
        provider: 'google_workspace',
        destinationId: 'dest_1',
        idempotencyKey: 'op_orphan_replay',
      },
    });
    expect(res.status).toBe(409);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('CREATE_RECONCILIATION_REQUIRED');
  });

  it('F2: a cross-workspace idempotent replay fails closed (409 CREATE_RECONCILIATION_REQUIRED) without naming the owning workspace', async () => {
    const ctx = setup();
    const adapter = createFakeDocumentProviderAdapter();
    ctx.adapters.set('google_workspace', adapter);
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    // ws_B has its own valid policy so the replay reaches the identity/reconcile path.
    ctx.policies.push(basePolicy({ workspaceId: 'ws_B' }));
    ctx.destinations.push(baseDestination({ workspaceId: 'ws_B' }));
    // Own the identity + replay key in ws_A first (registry record AND the adapter's replay map).
    const first = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      headers: { 'x-entity-workspace-id': 'ws_A' },
      body: { artifactType: 'document', title: 'Q3', provider: 'google_workspace', destinationId: 'dest_1', idempotencyKey: 'op_xws_replay' },
    });
    expect(first.status).toBe(201);

    // Same idempotency key replayed from ws_B: the workspace-scoped registry lookup returns
    // undefined (the record is ws_A-owned), so it fails closed with CREATE_RECONCILIATION_REQUIRED
    // and must NOT name the owning workspace (no existence oracle).
    const replay = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      headers: { 'x-entity-workspace-id': 'ws_B' },
      body: { artifactType: 'document', title: 'Q3', provider: 'google_workspace', destinationId: 'dest_1', idempotencyKey: 'op_xws_replay' },
    });
    expect(replay.status).toBe(409);
    const body = await bodyOf(replay);
    expect(body.error.code).toBe('CREATE_RECONCILIATION_REQUIRED');
    expect(body.error.message).not.toMatch(/ws_A/);
  });
});

describe('T-008 provider-neutral document API — mutate (§12.3, revision requirement)', () => {
  it('mutation requires expectedRevision + idempotencyKey + typed operation', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const created = ctx.registry.register(baseWriteInput(), 'ws_A');

    const noRevision = await requestApp(ctx.app, {
      path: `/api/document-integrations/${created.record.id}/mutations`,
      method: 'POST',
      body: { idempotencyKey: 'op_x', operation: { kind: 'replace_text', content: 'x' } },
    });
    expect(noRevision.status).toBe(400);
    expect((await bodyOf(noRevision)).error.code).toBe('INVALID_REQUEST');

    const noIdem = await requestApp(ctx.app, {
      path: `/api/document-integrations/${created.record.id}/mutations`,
      method: 'POST',
      body: { expectedRevision: 'rev-1', operation: { kind: 'replace_text', content: 'x' } },
    });
    expect(noIdem.status).toBe(400);
    expect((await bodyOf(noIdem)).error.code).toBe('INVALID_REQUEST');
  });

  it('successful mutation returns previousRevision/revision/operationId', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    // Seed the document THROUGH the API so the deterministic fake adapter also knows the
    // artifact (registry-only seeding would leave the fake blind to the external id).
    const documentId = await createViaApi(ctx, createBody());

    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_m1',
        operation: { kind: 'replace_text', content: 'Updated executive summary.' },
      },
    });
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.documentId).toBe(documentId);
    expect(body.previousRevision).toBe('rev-1');
    expect(body.revision).toBe('rev-2');
    expect(body.operationId).toBe('op_m1');
  });

  it('STALE_REVISION: a mutation with a stale expected revision returns 409 with expected/current + retryable:true (§12.3)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody());
    // Advance the document to rev-2 with a successful mutation first, so the pending request
    // can be prepared against the now-stale rev-1.
    const advance = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_advance',
        operation: { kind: 'replace_text', content: 'advance' },
      },
    });
    expect(advance.status).toBe(200);

    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_stale',
        operation: { kind: 'replace_text', content: 'stale' },
      },
    });
    expect(res.status).toBe(409);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('STALE_REVISION');
    expect(body.error.expectedRevision).toBe('rev-1');
    expect(body.error.currentRevision).toBe('rev-2');
    expect(body.error.retryable).toBe(true);
  });

  it('mutation into an unsupported lane FAILS CLOSED (CAPABILITY_UNSUPPORTED)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody());
    // agent_range_mutation is honestly unsupported by the fake baseline.
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_range',
        operation: { kind: 'set_range', cell: 'A1', value: '10' },
      },
    });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('B1 (gap 2): the canonical §12.4 set_range shape (sheet/range/values) is accepted and fails closed as CAPABILITY_UNSUPPORTED, not INVALID_REQUEST', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody());
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_canon_range',
        operation: {
          kind: 'set_range',
          sheet: 'Forecast',
          range: 'B2',
          values: [[10, 20, 30], [40, 50, 60]],
        },
      },
    });
    // The canonical shape is NOT a malformed request; the range lane is honestly unsupported by
    // the active engine, so it is a capability outcome.
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('B1 (gap 2): the canonical §12.5 update_slide_text shape (slideRef/elementRef/text) is accepted and fails closed as CAPABILITY_UNSUPPORTED, not INVALID_REQUEST', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody());
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_canon_slide',
        operation: {
          kind: 'update_slide_text',
          slideRef: 'slide_4',
          elementRef: 'title',
          text: 'Revised market outlook',
        },
      },
    });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('B1 (gap 2): unknown operation.kind returns a typed UNSUPPORTED_OPERATION (400)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const created = ctx.registry.register(baseWriteInput(), 'ws_A');
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${created.record.id}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_unknown_kind',
        operation: { kind: 'insert_hyperlink', url: 'https://x' },
      },
    });
    expect(res.status).toBe(400);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('UNSUPPORTED_OPERATION');
  });

  it('B1: operation.target.anchor is NOT silently dropped — rejected with a typed CAPABILITY_UNSUPPORTED', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody());
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_anchor',
        operation: { kind: 'replace_text', target: { anchor: 'section' }, content: 'x' },
      },
    });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('F1: canonical §12.5 elementRef/text are NOT silently dropped — parseMutation rejects non-empty elementRef/text with typed CAPABILITY_UNSUPPORTED', () => {
    // A non-empty elementRef/text payload cannot be forwarded by the slide lane (which carries only
    // a slideId); it must fail closed with a typed capability outcome instead of returning a
    // mutation that silently ignores the text (accepted-but-dropped, the class B1/B3 eliminated).
    expect(() =>
      parseMutation({ kind: 'update_slide_text', slideRef: 'slide_4', elementRef: 'title', text: 'Revised' }),
    ).toThrow(DocumentApiError);
    try {
      parseMutation({ kind: 'update_slide_text', slideRef: 'slide_4', elementRef: 'title', text: 'Revised' });
      // unreachable
    } catch (err) {
      expect(err).toBeInstanceOf(DocumentApiError);
      expect((err as DocumentApiError).code).toBe('CAPABILITY_UNSUPPORTED');
      expect((err as DocumentApiError).statusCode).toBe(403);
    }
    // A bare §12.5 slideRef with NO elementRef/text payload still maps to the plain slide lane.
    expect(parseMutation({ kind: 'update_slide_text', slideRef: 'slide_4' })).toEqual({ kind: 'slide', slideId: 'slide_4' });
  });

  it('F5: a non-array `values` on the §12.4 range lane is a typed INVALID_REQUEST, not silently ignored', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody());
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_f5_badvalues',
        operation: { kind: 'set_range', sheet: 'Forecast', range: 'B2', values: 'not-an-array' },
      },
    });
    expect(res.status).toBe(400);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('F5: a non-string target.anchor is a typed INVALID_REQUEST, not silently skipped', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody());
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_f5_badanchor',
        operation: { kind: 'replace_text', target: { anchor: 42 }, content: 'x' },
      },
    });
    expect(res.status).toBe(400);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('T-013 (R-005 #1): audited deployment flag disabled DENIES a Google mutation (master write gate, 14.6 rollback)', async () => {
    // Flag-off (rollback posture): the audited feature flag is the MASTER availability switch
    // for Google writes (14.6: disabling restores read-only without schema rollback). A mutation
    // under flag-off is denied at the route with typed WRITE_DISABLED — no provider write is
    // dispatched and the flag can never LIFT a write lane.
    const ctx = setup({
      flags: resolvePhase2Flags({ ENTITY_PHASE2_CAPABILITY_RESOLVER_ENFORCEMENT: 'off' }),
    });
    const adapter = createFakeDocumentProviderAdapter();
    ctx.adapters.set('google_workspace', adapter);
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    // Seed the fake adapter store + registry DIRECTLY (the route create is itself deployment-
    // gated under flag-off, so we seed the artifact without exercising the create route).
    const seeded = await adapter.create({
      artifact_type: 'document',
      title: 'rollback seed',
      idempotencyKey: 'op-seed-rollback',
      now: TEST_NOW,
    });
    const registered = ctx.registry.register(baseWriteInput({ external_id: seeded.descriptor.external_id }), 'ws_A');
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${registered.record.id}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_rollback_master',
        operation: { kind: 'set_range', cell: 'A1', value: '10' },
      },
    });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('WRITE_DISABLED');
  });
});

describe('THE-950 (T-009) — Revision Coordinator at the route boundary (§12.3/R-024/R-025)', () => {
  /**
   * Deterministic no-token adapter: advertises the text lane but returns NO current revision from
   * the authoritative metadata surface, so the Revision Coordinator must fail closed rather than
   * write optimistically on unverifiable state (R-024).
   */
  function noTokenGoogleAdapter() {
    const inner = createFakeDocumentProviderAdapter();
    const wrapped: DocumentProviderAdapter = {
      provider: 'google_workspace',
      resolveCapabilities: (ctx) => inner.resolveCapabilities(ctx),
      discover: (i) => inner.discover(i),
      getMetadata: async (i) =>
        inner.getMetadata(i).then((d) => (d ? { ...d, current_revision: null } : d)),
      create: (i) => inner.create(i),
      read: (i) => inner.read(i),
      mutate: (i) => inner.mutate(i),
      getOpenTarget: (i) => inner.getOpenTarget(i),
      reconcileChanges: (i) => inner.reconcileChanges(i),
    };
    return { inner, wrapped };
  }

  /**
   * Deterministic multi-lane adapter: enables the range and slide mutation lanes (in addition to
   * the default text lane) so the route-level R-024/R-025 proofs can exercise the sheet and slide
   * lanes end-to-end at the HTTP boundary (THE-950 r2 F3) rather than only at coordinator-unit
   * level. The capability resolver folds these to `supported`, so the mutation reaches the
   * Revision Coordinator precondition instead of failing earlier at the capability gate.
   */
  function rangeSlideGoogleAdapter() {
    const inner = createFakeDocumentProviderAdapter({
      capabilities: { agent_range_mutation: 'supported', agent_slide_mutation: 'supported' },
    });
    return { inner };
  }

  it('THE-950 F1: a mutation against a registry record whose provider artifact is GONE returns 404 DOCUMENT_NOT_FOUND (not a misleading 403 no-token)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    // The registry owns a record for external_id 'goog-doc-sample-1' in ws_A with an allowed
    // destination (so the mutation reaches the Revision Coordinator), but the provider artifact was
    // never created (or has vanished): the fake adapter's getMetadata returns null for that id. This
    // is an artifact-not-found (read/metadata target miss) and must surface the typed 404, NOT the
    // "provider exposes no revision/concurrency token" 403 that conflated getMetadata->null with no
    // concurrency evidence (THE-950 r2 F1).
    const created = ctx.registry.register(baseWriteInput({ destination_id: 'dest_1' }), 'ws_A');
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${created.record.id}/mutations`,
      method: 'POST',
      body: { expectedRevision: 'rev-1', idempotencyKey: 'op_gone', operation: { kind: 'replace_text', content: 'x' } },
    });
    expect(res.status).toBe(404);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('sheet lane (set_range): two-writer stale revision returns 409 STALE_REVISION at the HTTP boundary (R-024/R-025)', async () => {
    const ctx = setup();
    const { inner } = rangeSlideGoogleAdapter();
    ctx.adapters.set('google_workspace', inner);
    // The write policy + destination must govern the spreadsheet artifact type for the create to
    // reach the mutation lane (the default fixtures are document-scoped).
    ctx.policies.push(basePolicy({ artifactType: 'spreadsheet' }));
    ctx.destinations.push(baseDestination({ artifactTypes: new Set(['document', 'spreadsheet', 'presentation']) }));
    // Create a spreadsheet through the API (range lane enabled) -> registers rev-1.
    const documentId = await createViaApi(ctx, createBody({ artifactType: 'spreadsheet' }));
    // Writer A commits a range mutation -> advances to rev-2.
    const advance = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: { expectedRevision: 'rev-1', idempotencyKey: 'op_sheet_adv', operation: { kind: 'set_range', sheet: 'Forecast', range: 'B2', values: [[10, 20]] } },
    });
    expect(advance.status).toBe(200);
    expect((await bodyOf(advance)).revision).toBe('rev-2');
    // Writer B (a second independent writer) prepared against the now-stale rev-1 is rejected with
    // the R-025 409 for the sheet lane at the HTTP boundary.
    const stale = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: { expectedRevision: 'rev-1', idempotencyKey: 'op_sheet_stale', operation: { kind: 'set_range', sheet: 'Forecast', range: 'B2', values: [[30]] } },
    });
    expect(stale.status).toBe(409);
    const sb = await bodyOf(stale);
    expect(sb.error.code).toBe('STALE_REVISION');
    expect(sb.error.expectedRevision).toBe('rev-1');
    expect(sb.error.currentRevision).toBe('rev-2');
    expect(sb.error.retryable).toBe(true);
  });

  it('slide lane (update_slide_text bare slideRef): two-writer stale revision returns 409 STALE_REVISION at the HTTP boundary (R-024/R-025)', async () => {
    const ctx = setup();
    const { inner } = rangeSlideGoogleAdapter();
    ctx.adapters.set('google_workspace', inner);
    ctx.policies.push(basePolicy({ artifactType: 'presentation' }));
    ctx.destinations.push(baseDestination({ artifactTypes: new Set(['document', 'spreadsheet', 'presentation']) }));
    // Create a presentation through the API (slide lane enabled) -> registers rev-1.
    const documentId = await createViaApi(ctx, createBody({ artifactType: 'presentation' }));
    // Writer A commits a slide mutation -> advances to rev-2.
    const advance = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: { expectedRevision: 'rev-1', idempotencyKey: 'op_slide_adv', operation: { kind: 'update_slide_text', slideRef: 'slide_4' } },
    });
    expect(advance.status).toBe(200);
    expect((await bodyOf(advance)).revision).toBe('rev-2');
    // Writer B prepared against the now-stale rev-1 is rejected with the R-025 409 for the slide
    // lane at the HTTP boundary.
    const stale = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: { expectedRevision: 'rev-1', idempotencyKey: 'op_slide_stale', operation: { kind: 'update_slide_text', slideRef: 'slide_4' } },
    });
    expect(stale.status).toBe(409);
    const sb = await bodyOf(stale);
    expect(sb.error.code).toBe('STALE_REVISION');
    expect(sb.error.expectedRevision).toBe('rev-1');
    expect(sb.error.currentRevision).toBe('rev-2');
    expect(sb.error.retryable).toBe(true);
  });

  it('sheet lane (set_range): a no-token provider FAILS CLOSED with typed CAPABILITY_UNSUPPORTED at the HTTP boundary (R-024)', async () => {
    const ctx = setup();
    const inner = createFakeDocumentProviderAdapter({
      capabilities: { agent_range_mutation: 'supported' },
    });
    // Wrap so a PRESENT descriptor exposes no concurrency token (artifact exists, no token) —
    // distinct from the vanished-artifact 404 covered above.
    const wrapped: DocumentProviderAdapter = {
      provider: 'google_workspace',
      resolveCapabilities: (c) => inner.resolveCapabilities(c),
      discover: (i) => inner.discover(i),
      getMetadata: async (i) => inner.getMetadata(i).then((d) => (d ? { ...d, current_revision: null } : d)),
      create: (i) => inner.create(i),
      read: (i) => inner.read(i),
      mutate: (i) => inner.mutate(i),
      getOpenTarget: (i) => inner.getOpenTarget(i),
      reconcileChanges: (i) => inner.reconcileChanges(i),
    };
    ctx.adapters.set('google_workspace', wrapped);
    ctx.policies.push(basePolicy({ artifactType: 'spreadsheet' }));
    ctx.destinations.push(baseDestination({ artifactTypes: new Set(['document', 'spreadsheet', 'presentation']) }));
    const documentId = await createViaApi(ctx, createBody({ artifactType: 'spreadsheet' }));
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: { expectedRevision: 'rev-1', idempotencyKey: 'op_sheet_notoken', operation: { kind: 'set_range', sheet: 'Forecast', range: 'B2', values: [[10]] } },
    });
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('slide lane (update_slide_text bare slideRef): a no-token provider FAILS CLOSED with typed CAPABILITY_UNSUPPORTED at the HTTP boundary (R-024)', async () => {
    const ctx = setup();
    const inner = createFakeDocumentProviderAdapter({
      capabilities: { agent_slide_mutation: 'supported' },
    });
    const wrapped: DocumentProviderAdapter = {
      provider: 'google_workspace',
      resolveCapabilities: (c) => inner.resolveCapabilities(c),
      discover: (i) => inner.discover(i),
      getMetadata: async (i) => inner.getMetadata(i).then((d) => (d ? { ...d, current_revision: null } : d)),
      create: (i) => inner.create(i),
      read: (i) => inner.read(i),
      mutate: (i) => inner.mutate(i),
      getOpenTarget: (i) => inner.getOpenTarget(i),
      reconcileChanges: (i) => inner.reconcileChanges(i),
    };
    ctx.adapters.set('google_workspace', wrapped);
    ctx.policies.push(basePolicy({ artifactType: 'presentation' }));
    ctx.destinations.push(baseDestination({ artifactTypes: new Set(['document', 'spreadsheet', 'presentation']) }));
    const documentId = await createViaApi(ctx, createBody({ artifactType: 'presentation' }));
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: { expectedRevision: 'rev-1', idempotencyKey: 'op_slide_notoken', operation: { kind: 'update_slide_text', slideRef: 'slide_4' } },
    });
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('STALE_REVISION 409 preserves the §12.3/R-025 envelope with SANITIZED expected/current revisions', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody());
    // Advance the document to rev-2 so a later request prepared against rev-1 is genuinely stale.
    const advance = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: { expectedRevision: 'rev-1', idempotencyKey: 'op_adv_c', operation: { kind: 'replace_text', content: 'a' } },
    });
    expect(advance.status).toBe(200);

    // A hostile (untrusted) expected revision must be sanitized before inclusion in the response —
    // no HTML injection surface, no unbounded/control characters, no credentials bleed.
    const hostile = '<script>alert(1)</script>Bearer-abcdef';
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: { expectedRevision: hostile, idempotencyKey: 'op_hostile', operation: { kind: 'replace_text', content: 'x' } },
    });
    expect(res.status).toBe(409);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('STALE_REVISION');
    expect(body.error.message).toBe('The document changed after this operation was prepared.');
    expect(body.error.documentId).toBe(documentId);
    expect(body.error.currentRevision).toBe('rev-2');
    expect(body.error.retryable).toBe(true);
    // expectedRevision is sanitized: HTML metacharacters stripped (no HTML injection surface),
    // no control characters, and bounded length (an over-long/credential-like payload is truncated,
    // never echoed in full).
    expect(body.error.expectedRevision).not.toMatch(/[<>]/);
    expect(body.error.expectedRevision).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(String(body.error.expectedRevision).length).toBeLessThanOrEqual(64);
  });

  it('409 STALE_REVISION contract requires NO automatic blind retry — a repeated stale request stays 409', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody());
    const mutateBody = {
      expectedRevision: 'rev-1',
      idempotencyKey: 'op_noretry',
      operation: { kind: 'replace_text', content: 'x' },
    };
    // Advance first so rev-1 becomes stale.
    await requestApp(ctx.app, { path: `/api/document-integrations/${documentId}/mutations`, method: 'POST', body: mutateBody });
    // Same stale expectedRevision sent twice: the server never masks the conflict by auto-retrying.
    const first = await requestApp(ctx.app, { path: `/api/document-integrations/${documentId}/mutations`, method: 'POST', body: mutateBody });
    const second = await requestApp(ctx.app, { path: `/api/document-integrations/${documentId}/mutations`, method: 'POST', body: mutateBody });
    expect(first.status).toBe(409);
    expect(second.status).toBe(409);
    expect((await bodyOf(first)).error.code).toBe('STALE_REVISION');
    expect((await bodyOf(second)).error.code).toBe('STALE_REVISION');
  });

  it('an unsafe provider with NO concurrency evidence FAILS CLOSED (typed CAPABILITY_UNSUPPORTED, no write)', async () => {
    const ctx = setup();
    const { inner, wrapped } = noTokenGoogleAdapter();
    ctx.adapters.set('google_workspace', wrapped);
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    // Create through the API using the wrapped adapter so the registry record + provider artifact
    // both exist (the no-token adapter advertises the lane but exposes no revision token).
    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: {
        artifactType: 'document',
        title: 'Q3',
        provider: 'google_workspace',
        destinationId: 'dest_1',
        idempotencyKey: 'op_notoken_create',
      },
    });
    expect(res.status).toBe(201);
    const documentId = (await bodyOf(res)).documentId;

    // The lane is advertised as supported, so the mutation is not a capability-absent case; the
    // Revision Coordinator must still fail closed because no safe current revision can be
    // established by this provider. Never a silent optimistic write.
    const mutate = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: { expectedRevision: 'rev-1', idempotencyKey: 'op_notoken_mut', operation: { kind: 'replace_text', content: 'x' } },
    });
    expect(mutate.status).toBe(403);
    expect((await bodyOf(mutate)).error.code).toBe('CAPABILITY_UNSUPPORTED');
  });
});

describe('THE-950 (T-009) — carry-forward: present-but-non-string fields are typed 400, never silently dropped (THE-949 r3 F1-LOW)', () => {
  it('slide lane: present-but-non-string elementRef is a typed INVALID_REQUEST (400), not silently dropped', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody());
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_f1_ele',
        operation: { kind: 'update_slide_text', slideRef: 'slide_4', elementRef: 42, text: 'x' },
      },
    });
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error.code).toBe('INVALID_REQUEST');
  });

  it('slide lane: present-but-non-string text is a typed INVALID_REQUEST (400), not silently dropped', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody());
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_f1_text',
        operation: { kind: 'update_slide_text', slideRef: 'slide_4', text: { nope: true } },
      },
    });
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error.code).toBe('INVALID_REQUEST');
  });

  it('range lane: present-but-non-string sheet is a typed INVALID_REQUEST (400), not silently dropped', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody());
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_f1_sheet',
        operation: { kind: 'set_range', sheet: ['Forecast'], range: 'B2', values: [[1]] },
      },
    });
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error.code).toBe('INVALID_REQUEST');
  });
});

describe('T-008 provider-neutral document API — capabilities (§12.6, reason codes + fail closed)', () => {
  it('capabilities include reason codes and honor the T-006 fold', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    const created = ctx.registry.register(baseWriteInput(), 'ws_A');

    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${created.record.id}/capabilities`,
    });
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.capabilities.read).toBeDefined();
    expect(body.capabilities.agent_text_mutation).toBeDefined();
    // honest adapter baseline: range/slide mutation unsupported with a reason code.
    expect(body.capabilities.agent_range_mutation.state).toBe('unsupported');
  });

  it('unknown/degraded capability FAILS CLOSED: degraded connection demotes write lanes', async () => {
    const ctx = setup();
    const adapter = createFakeDocumentProviderAdapter();
    adapter.setConnectionState('degraded');
    ctx.adapters.set('google_workspace', adapter);
    const created = ctx.registry.register(baseWriteInput(), 'ws_A');

    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${created.record.id}/capabilities`,
    });
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    // A degraded connection can never promote a write lane to supported.
    expect(body.capabilities.agent_text_mutation.state).not.toBe('supported');
    expect(body.capabilities.create.state).not.toBe('supported');
  });
});

describe('T-008 provider-neutral document API — versions (§12.7)', () => {
  it('versions include revision, actorType/actorId, observedAt, providerModifiedAt', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    // Seed through the API so the fake adapter knows the artifact. The injected clock is the
    // deterministic TEST_NOW constant (B4: frozen determinism only in test injection).
    const documentId = await createViaApi(ctx, createBody());

    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/versions`,
    });
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(Array.isArray(body.versions)).toBe(true);
    expect(body.versions.length).toBeGreaterThan(0);
    const v = body.versions[0];
    expect(v.revision).toBe('rev-1');
    // M1: honest coarse attribution — the adapter version ref carries no actor, so classify
    // `unknown` rather than fabricating `agent`.
    expect(v.actorType).toBe('unknown');
    expect('actorId' in v).toBe(true);
    expect('observedAt' in v).toBe(true);
    expect(v.observedAt).toBe(TEST_NOW);
    // M1: providerModifiedAt is distinct from observedAt; the provider did not report a separate
    // modification timestamp, so it is unknown (null), never a duplicate of observedAt.
    expect(v.providerModifiedAt).toBeNull();
  });

  it('versions of an unknown id return typed DOCUMENT_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    const res = await requestApp(ctx.app, { path: '/api/document-integrations/doc_missing/versions' });
    expect(res.status).toBe(404);
    expect((await bodyOf(res)).error.code).toBe('DOCUMENT_NOT_FOUND');
  });
});

describe('T-008 provider-neutral document API — workspace isolation blast radius', () => {
  it('mutation of another workspace document is not an existence oracle (404)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    const created = ctx.registry.register(baseWriteInput(), 'ws_A');
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${created.record.id}/mutations`,
      method: 'POST',
      headers: { 'x-entity-workspace-id': 'ws_B' },
      body: {
        expectedRevision: 'rev-1',
        idempotencyKey: 'op_x',
        operation: { kind: 'replace_text', content: 'x' },
      },
    });
    expect(res.status).toBe(404);
    expect((await bodyOf(res)).error.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('a request that cannot be bound to a workspace fails closed with WORKSPACE_REQUIRED', async () => {
    const db = openFreshDb();
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();
    const registry2 = createDocumentRegistry(db);
    const depsNoWs: DocumentIntegrationsRouterDeps = {
      registry: registry2,
      adapters: () => undefined,
      policies: [],
      destinations: [],
      flags: resolvePhase2Flags(),
      resolveWorkspace: () => null,
    };
    const app = express();
    app.use(express.json());
    app.use('/api/document-integrations', createDocumentIntegrationsRouter(depsNoWs));
    const res = await requestApp(app, { path: '/api/document-integrations/doc_x' });
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error.code).toBe('WORKSPACE_REQUIRED');
  });
});

describe('T-008 — B4 wall-clock production clock (no injected `now`)', () => {
  it('the un-injected production clock is WALL-CLOCK (advances with real time), not frozen', async () => {
    const db = openFreshDb();
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();
    const registry2 = createDocumentRegistry(db);
    const adapters = new Map<string, DocumentProviderAdapter>();
    adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    const policies: WritePolicy[] = [basePolicy()];
    const destinations: DocumentDestination[] = [baseDestination()];
    const app = express();
    app.use(express.json());
    // NOTE: NO `now` is injected here — the router must fall back to wall-clock (B4) rather than
    // a frozen constant. connectionStateFor is provided so the create reaches the timestamp path.
    app.use(
      '/api/document-integrations',
      createDocumentIntegrationsRouter({
        registry: registry2,
        adapters: (p) => adapters.get(p),
        policies,
        destinations,
        flags: resolvePhase2Flags(),
        resolveWorkspace: () => 'ws_A',
        connectionStateFor: () => 'authorized',
      }),
    );
    const res = await requestApp(app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: {
        artifactType: 'document',
        title: 'B4',
        provider: 'google_workspace',
        destinationId: 'dest_1',
        idempotencyKey: 'b4-clock',
      },
    });
    expect(res.status).toBe(201);
    const id = (await bodyOf(res)).documentId;
    const getRes = await requestApp(app, { path: `/api/document-integrations/${id}` });
    const body = await bodyOf(getRes);
    // Not the frozen TEST_NOW constant.
    expect(body.document.modifiedAt).not.toBe(TEST_NOW);
    // A wall-clock advance: within 60s of the real current time.
    const modifiedMs = Date.parse(body.document.modifiedAt);
    expect(Number.isFinite(modifiedMs)).toBe(true);
    expect(Math.abs(Date.now() - modifiedMs)).toBeLessThan(60_000);
  });
});

describe('T-013 (THE-954) — Google admin write gate and destination UX (R-005/R-007, one-negative-test-per-gate)', () => {
  it('NEGATIVE flag: audited deployment flag OFF denies a Google create (master write gate, typed WRITE_DISABLED)', async () => {
    const ctx = setup({
      flags: resolvePhase2Flags({ ENTITY_PHASE2_CAPABILITY_RESOLVER_ENFORCEMENT: 'off' }),
    });
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy());
    ctx.destinations.push(baseDestination());
    // Every OTHER gate would pass (admin + destination + write mode + no-confirmation), yet the
    // audited flag is the deployment-level availability gate: off => the write is not deployed.
    const res = await requestApp(ctx.app, { path: '/api/document-integrations', method: 'POST', body: createBody() });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('WRITE_DISABLED');
  });

  it('NEGATIVE admin: a non-admin write authorization denies a Google create (R-005 gate, typed WRITE_DISABLED)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy({ adminWriteAuthorized: false }));
    ctx.destinations.push(baseDestination());
    const res = await requestApp(ctx.app, { path: '/api/document-integrations', method: 'POST', body: createBody() });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('WRITE_DISABLED');
  });

  it('NEGATIVE confirmation: a create whose confirmation policy requires but is not satisfied is denied (CONFIRMATION_REQUIRED)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy({ confirmationPolicy: 'required' }));
    ctx.destinations.push(baseDestination());
    // No `confirmed` flag supplied => confirmation not satisfied => blocked even though every
    // other gate (admin/destination/write mode/flag/capability) is satisfied.
    const res = await requestApp(ctx.app, { path: '/api/document-integrations', method: 'POST', body: createBody({ confirmed: false }) });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('CONFIRMATION_REQUIRED');
  });

  it('NEGATIVE confirmation (update): a mutation whose confirmation policy is not satisfied is denied (CONFIRMATION_REQUIRED)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy({ confirmationPolicy: 'required' }));
    ctx.destinations.push(baseDestination());
    const documentId = await createViaApi(ctx, createBody({ confirmed: true }));
    const res = await requestApp(ctx.app, {
      path: `/api/document-integrations/${documentId}/mutations`,
      method: 'POST',
      body: {
        expectedRevision: 'rev-0',
        idempotencyKey: 'op-confirm-update',
        operation: { kind: 'replace_text', content: 'x', text: 'x' },
        confirmed: false,
      },
    });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('CONFIRMATION_REQUIRED');
  });

  it('SUCCESS: a Google create passes when EVERY gate is satisfied (flag on + admin + approved destination + create mode + confirmation satisfied)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy({ confirmationPolicy: 'required' }));
    ctx.destinations.push(baseDestination());
    const res = await requestApp(ctx.app, { path: '/api/document-integrations', method: 'POST', body: createBody({ confirmed: true }) });
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).documentId).toBeDefined();
  });

  it('R-007: an unauthorized/wrong-scope destination fails without fallback (typed DESTINATION_NOT_ALLOWED)', async () => {
    const ctx = setup();
    ctx.adapters.set('google_workspace', createFakeDocumentProviderAdapter());
    ctx.policies.push(basePolicy({ allowedDestinationIds: new Set(['dest_1']) }));
    // Only dest_1 serves ws_A; dest_OTHER is NOT approved for this scope => no fallback.
    ctx.destinations.push(baseDestination({ id: 'dest_1' }));
    const res = await requestApp(ctx.app, {
      path: '/api/document-integrations',
      method: 'POST',
      body: createBody({ destinationId: 'dest_OTHER' }),
    });
    expect(res.status).toBe(422);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('DESTINATION_NOT_ALLOWED');
  });
});
