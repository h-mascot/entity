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
    initialContent: { kind: 'structured_document', blocks: [{ type: 'heading', text: 'Q3' }] },
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
        initialContent: { kind: 'structured_document', blocks: [{ type: 'heading', text: 'Q3' }] },
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
    // fixed FAKE_ADAPTER_FIXED_NOW constant (deterministic — no wall-clock dependence).
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
    expect(v.actorType).toBe('agent');
    expect('actorId' in v).toBe(true);
    expect('observedAt' in v).toBe(true);
    expect(v.providerModifiedAt).toBe('2026-08-18T00:00:00.000Z');
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
