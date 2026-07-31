/**
 * THE-888 / WP2-B-07 — Workplanes slice 2 end-to-end HTTP proof chain.
 *
 * invite → progress → presence → Chief ASK (+ admin settings, no secret leak)
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { Readable, Writable } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

let activeDbPath: string | null = null;
let cleanupDbPaths: string[] = [];

function sqliteFiles(dbPath: string): string[] {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

function removeSqliteFiles(dbPath: string): void {
  for (const file of sqliteFiles(dbPath)) {
    fs.rmSync(file, { force: true });
  }
}

function tempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

function hasSecretKeys(payload: unknown): boolean {
  const raw = JSON.stringify(payload);
  return /"token"\s*:|"apiKey"\s*:|"api_key"\s*:|"password"\s*:|"secret"\s*:|"authorization"\s*:|"tokenHash"\s*:|"previousTokenHash"\s*:/i.test(raw);
}

async function requestApp(
  app: express.Express,
  options: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<Response> {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
  const bodyText = options.body ?? '';
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
        for (const [name, value] of Object.entries(headerSource)) {
          res.setHeader(name, value);
        }
      }
      res.headersSent = true;
      return res;
    };
    const end = res.end.bind(res);
    res.end = (chunk?: unknown, encoding?: BufferEncoding, callback?: () => void) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk), encoding));
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

async function createServer(nowIso = '2026-07-31T10:00:00.000Z') {
  activeDbPath = tempDbPath('entity-wp2-b-07-e2e');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);

  const { resetInviteControlsForTests, createInviteControls } = await import('../agent/invite-kit/controls');
  resetInviteControlsForTests();
  const { resetPresenceServiceForTests, createPresenceService } = await import('../agent/presence/service');
  resetPresenceServiceForTests();
  const {
    resetWorkplaneAttachServiceForTests,
    createWorkplaneAttachService,
  } = await import('../agent/workplane-attach/service');
  resetWorkplaneAttachServiceForTests();
  const {
    resetChiefRoutingServiceForTests,
    createChiefRoutingService,
  } = await import('../agent/chief-routing/service');
  resetChiefRoutingServiceForTests();
  const {
    resetAskFlowServiceForTests,
    createAskFlowService,
  } = await import('../agent/ask-flow/service');
  resetAskFlowServiceForTests();
  try {
    const { resetInviteAuditStoreForTests } = await import('../agent/invite-kit/audit-store');
    resetInviteAuditStoreForTests();
  } catch {
    // optional
  }
  try {
    const { clearAgentInviteAdminSettingsForTests } = await import('../agent/invite-kit/admin-settings');
    clearAgentInviteAdminSettingsForTests();
  } catch {
    // optional
  }

  // Shared DB-backed controls; config tokenized routes use getInviteControls() singleton.
  const invites = createInviteControls({
    now: () => new Date(nowIso),
  });
  const nowMs = Date.parse(nowIso);
  const presence = createPresenceService({
    invites,
    now: () => new Date(nowMs),
    staleAfterMs: 60_000,
  });
  const attach = createWorkplaneAttachService({
    invites,
    presence,
    now: () => new Date(nowMs),
  });
  const routing = createChiefRoutingService({
    attach,
    presence,
    now: () => new Date(nowMs),
  });
  const asks = createAskFlowService({
    attach,
    presence,
    now: () => new Date(nowMs),
  });

  const { registerAgentInviteRoutes } = await import('./agent-invites');
  const { registerAgentAdminSettingsRoutes } = await import('./agent-admin-settings');
  const { registerConfigRoutes } = await import('../config/routes');
  const { registerAgentPresenceRoutes } = await import('./agent-presence');
  const { registerWorkplaneAgentRoutes } = await import('./workplane-agents');
  const { registerWorkplaneChiefRoutingRoutes } = await import('./workplane-chief-routing');
  const { registerWorkplaneAskRoutes } = await import('./workplane-asks');

  const app = express();
  app.use(express.json());
  registerAgentAdminSettingsRoutes(app);
  registerAgentInviteRoutes(app, { controls: invites });
  registerConfigRoutes(app);
  registerAgentPresenceRoutes(app, { presence });
  registerWorkplaneAgentRoutes(app, { attach });
  registerWorkplaneChiefRoutingRoutes(app, { routing });
  registerWorkplaneAskRoutes(app, { asks });

  return {
    request: (requestPath: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
      requestApp(app, { path: requestPath, ...init }),
  };
}

afterEach(async () => {
  try {
    const { resetAskFlowServiceForTests } = await import('../agent/ask-flow/service');
    resetAskFlowServiceForTests();
  } catch { /* ignore */ }
  try {
    const { resetChiefRoutingServiceForTests } = await import('../agent/chief-routing/service');
    resetChiefRoutingServiceForTests();
  } catch { /* ignore */ }
  try {
    const { resetWorkplaneAttachServiceForTests } = await import('../agent/workplane-attach/service');
    resetWorkplaneAttachServiceForTests();
  } catch { /* ignore */ }
  try {
    const { resetPresenceServiceForTests } = await import('../agent/presence/service');
    resetPresenceServiceForTests();
  } catch { /* ignore */ }
  try {
    const { resetInviteControlsForTests } = await import('../agent/invite-kit/controls');
    resetInviteControlsForTests();
  } catch { /* ignore */ }
  if (activeDbPath) {
    const closePath = tempDbPath('entity-wp2-b-07-e2e-close');
    cleanupDbPaths.push(closePath);
    vi.stubEnv('ENTITY_TASK_DB_PATH', closePath);
    try {
      const { getEntityDatabase } = await import('../../../db/src/entity-db');
      getEntityDatabase().close();
    } catch { /* ignore */ }
    activeDbPath = null;
  }
  for (const dbPath of cleanupDbPaths) {
    removeSqliteFiles(dbPath);
  }
  cleanupDbPaths = [];
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Workplanes slice 2 E2E (THE-888 / WP2-B-07)', () => {
  it('invite → progress → presence → Chief ASK with admin settings (no secret leak)', async () => {
    const { request } = await createServer();
    const workplaneId = 'wp-slice2-e2e';
    const taskId = 888;

    // Admin settings baseline (TTL + modules) — no secrets.
    const settingsRes = await request('/api/agents/admin-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        defaultTtlMs: 45 * 60 * 1000,
        minTtlMs: 5 * 60 * 1000,
        maxTtlMs: 2 * 60 * 60 * 1000,
        allowedModules: ['entity-mc', 'entity-fs'],
        defaultModules: ['entity-mc'],
        updatedBy: 'wp2-b-07-proof',
      }),
    });
    expect(settingsRes.status).toBe(200);
    const settings = await settingsRes.json();
    expect(hasSecretKeys(settings)).toBe(false);

    // 1) Invite
    const inviteRes = await request('/api/agents/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentName: 'Slice2 Chief',
        role: 'chief',
        selectedModules: ['entity-mc'],
        workplaneId,
        taskId,
        creationSource: 'agents_invite',
        createdBy: 'wp2-b-07-proof',
      }),
    });
    expect(inviteRes.status).toBe(201);
    const invite = await inviteRes.json() as {
      id: string;
      token: string;
      status: string;
      progressPath: string;
      progress: Array<{ stepId: string; status: string }>;
    };
    expect(invite.status).toBe('created');
    expect(invite.token.length).toBeGreaterThanOrEqual(8);
    expect(invite.progress.some((step) => step.stepId === 'install-entity-mc')).toBe(true);

    // 2) Progress: open manifest → report progress → durable in_progress/completed
    const manifestRes = await request(`/api/onboarding/agent-session/${invite.token}/manifest`);
    expect(manifestRes.status).not.toBe(401);

    const progressRunning = await request(`/api/onboarding/agent-session/${invite.token}/progress`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        progress: [{ id: 'install-entity-mc', status: 'running', message: 'installing entity-mc' }],
      }),
    });
    expect(progressRunning.status).toBe(200);

    const midInvite = await request(`/api/agents/invites/${invite.id}`);
    expect(midInvite.status).toBe(200);
    const midBody = await midInvite.json() as {
      status: string;
      token?: string;
      progress: Array<{ stepId: string; status: string }>;
    };
    expect(midBody.token).toBeUndefined();
    expect(hasSecretKeys(midBody)).toBe(false);
    expect(['in_progress', 'opened']).toContain(midBody.status);
    expect(midBody.progress.find((s) => s.stepId === 'install-entity-mc')?.status).toBe('running');

    const progressDone = await request(`/api/onboarding/agent-session/${invite.token}/progress`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        progress: [{ id: 'install-entity-mc', status: 'done', message: 'verified' }],
      }),
    });
    expect(progressDone.status).toBe(200);

    const doneInvite = await request(`/api/agents/invites/${invite.id}`);
    const doneBody = await doneInvite.json() as {
      status: string;
      progress: Array<{ stepId: string; status: string }>;
    };
    expect(doneBody.status).toBe('completed');
    expect(doneBody.progress.every((s) => s.status === 'done')).toBe(true);

    // Attach chief + worker, then presence heartbeats.
    const chiefAgentId = `invite:${invite.id}`;
    await request(`/api/workplanes/${workplaneId}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: chiefAgentId,
        inviteId: invite.id,
        agentName: 'Slice2 Chief',
        role: 'chief',
        taskId,
      }),
    });
    await request(`/api/workplanes/${workplaneId}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'worker-slice2',
        agentName: 'Slice2 Worker',
        role: 'worker',
        taskId,
      }),
    });

    // 3) Presence
    const heartbeat = await request('/api/agents/presence/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: chiefAgentId,
        inviteId: invite.id,
        status: 'live',
        currentTaskId: taskId,
        currentWorkplaneId: workplaneId,
        runtime: 'proof',
        capabilities: ['ask', 'routing'],
      }),
    });
    expect(heartbeat.status).toBe(200);

    const presenceRes = await request(`/api/workplanes/${workplaneId}/presence`);
    expect(presenceRes.status).toBe(200);
    const presence = await presenceRes.json() as {
      counts: { live: number; total: number };
      agents: Array<{ agentId: string; presenceStatus: string }>;
    };
    expect(presence.counts.live).toBeGreaterThanOrEqual(1);
    expect(presence.agents.some((a) => a.agentId === chiefAgentId && a.presenceStatus === 'live')).toBe(true);
    expect(hasSecretKeys(presence)).toBe(false);

    // Chief routing + ASK
    const chiefPut = await request(`/api/workplanes/${workplaneId}/routing/chief`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: chiefAgentId,
        assignedBy: 'wp2-b-07-proof',
        priorityWindowMs: 300000,
      }),
    });
    expect([200, 201]).toContain(chiefPut.status);

    const askCreate = await request(`/api/workplanes/${workplaneId}/asks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Slice2 Chief ASK proof',
        taskId,
        createdBy: 'wp2-b-07-proof',
      }),
    });
    expect(askCreate.status).toBe(201);
    const createdAsk = await askCreate.json() as {
      ask: { id: string; status: string; version: number };
    };
    expect(createdAsk.ask.status).toBe('chief_review');
    expect(createdAsk.ask.version).toBe(1);

    // Negative: worker claim denied under live chief priority
    const workerDenied = await request(
      `/api/workplanes/${workplaneId}/asks/${createdAsk.ask.id}/claim`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: 'worker-slice2',
          expectedVersion: 1,
        }),
      },
    );
    expect(workerDenied.status).toBe(409);
    const deniedBody = await workerDenied.json() as { code: string };
    expect(deniedBody.code).toBe('chief_priority');

    // 4) Chief ASK claim + resolve
    const claimRes = await request(
      `/api/workplanes/${workplaneId}/asks/${createdAsk.ask.id}/claim`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: chiefAgentId,
          expectedVersion: 1,
        }),
      },
    );
    expect(claimRes.status).toBe(201);
    const claimed = await claimRes.json() as {
      ask: { status: string; version: number; claimantAgentId: string };
    };
    expect(claimed.ask.status).toBe('claimed');
    expect(claimed.ask.claimantAgentId).toBe(chiefAgentId);

    const resolveRes = await request(
      `/api/workplanes/${workplaneId}/asks/${createdAsk.ask.id}/resolve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resolvedBy: chiefAgentId,
          expectedVersion: 2,
          note: 'Slice2 E2E proof closed',
        }),
      },
    );
    expect(resolveRes.status).toBe(200);
    const resolved = await resolveRes.json() as { ask: { status: string; version: number } };
    expect(resolved.ask.status).toBe('resolved');
    expect(resolved.ask.version).toBe(3);

    const panelRes = await request(`/api/workplanes/${workplaneId}/asks?panel=1`);
    expect(panelRes.status).toBe(200);
    const panel = await panelRes.json() as { resolvedCount: number; summary: string };
    expect(panel.resolvedCount).toBe(1);
    expect(hasSecretKeys(panel)).toBe(false);

    const auditRes = await request('/api/agents/admin-settings/audit');
    expect(auditRes.status).toBe(200);
    const audit = await auditRes.json();
    expect(hasSecretKeys(audit)).toBe(false);
  });
});
