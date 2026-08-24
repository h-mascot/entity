import Database from 'better-sqlite3';
import express from 'express';
import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { createCuracelOperationsRepository } from '../../../db/src/curacel-operations';
import { createCuracelOperationsRouter } from './curacel-operations';

const servers: http.Server[] = [];
const databases: Database.Database[] = [];

async function setup() {
  const db = new Database(':memory:');
  databases.push(db);
  const repo = createCuracelOperationsRepository(db, {
    now: () => new Date('2026-07-29T12:00:00.000Z'),
  });
  const app = express();
  app.use(express.json());
  app.use('/api', createCuracelOperationsRouter({
    operationsRepo: repo,
    now: () => new Date('2026-07-29T12:00:00.000Z'),
    skipAdminAuth: true,
  }));
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  const request = async (pathname: string, init: RequestInit = {}) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${pathname}`, init);
    const text = await response.text();
    let body: Record<string, any> = {};
    try {
      body = JSON.parse(text) as Record<string, any>;
    } catch {
      body = { text };
    }
    return { status: response.status, body };
  };
  return { repo, request };
}

function json(method: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()))));
  for (const db of databases.splice(0)) db.close();
});

describe('Curacel operations routes', () => {
  // REC-006 adaptation: the historical membership-role gate test is superseded
  // by main's admin-principal middleware (covered in
  // packages/server/src/middleware/admin-auth.test.ts); these route tests focus
  // on operations logic behind that gate (skipAdminAuth seam).

  it('returns protected policy defaults and applies org/team/agent/task/category audit filters', async () => {
    const context = await setup();
    context.repo.appendAudit({
      org_id: 'org-a',
      team_id: 'claims',
      agent_id: 'atlas',
      task_id: 19,
      actor_principal_id: 'operator-a',
      category: 'approval',
      action: 'claim.approved',
      outcome: 'approved',
    });
    context.repo.appendAudit({
      org_id: 'org-a',
      team_id: 'finance',
      agent_id: 'mafa',
      task_id: 20,
      actor_principal_id: 'operator-b',
      category: 'action',
      action: 'finance.drafted',
      outcome: 'dry_run',
    });
    context.repo.appendAudit({
      org_id: 'org-b',
      team_id: 'claims',
      agent_id: 'atlas',
      task_id: 19,
      actor_principal_id: 'operator-c',
      category: 'approval',
      action: 'other.approved',
      outcome: 'approved',
    });

    const response = await context.request(
      '/curacel/operations?orgId=org-a&teamId=claims&agentId=atlas&taskId=19&category=approval',
    );

    expect(response.status).toBe(200);
    expect(response.body.orgId).toBe('org-a');
    expect(response.body.teamId).toBe('claims');
    expect(response.body.policies).toHaveLength(3);
    expect(response.body.policies.every((policy: any) =>
      policy.review_required === true && policy.bypass_blocked === true)).toBe(true);
    expect(response.body.audit).toHaveLength(1);
    expect(response.body.audit[0]).toMatchObject({
      org_id: 'org-a',
      team_id: 'claims',
      agent_id: 'atlas',
      task_id: 19,
      category: 'approval',
    });
  });

  it('blocks review bypass for protected claims, finance, and customer communication actions', async () => {
    const context = await setup();

    for (const action of ['claims', 'finance', 'customer_external_communication']) {
      const response = await context.request(
        `/orgs/org-a/curacel/review-policies/${action}`,
        json('PUT', { reviewRequired: false, approverRoles: ['owner'] }),
      );
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ code: 'REVIEW_GATE_REQUIRED' });
    }
  });

  it('rejects raw connector credentials and nested draft secrets', async () => {
    const context = await setup();
    const connectorResponse = await context.request(
      '/orgs/org-a/curacel/connectors/gmail',
      json('PUT', {
        name: 'Gmail draft',
        credentialRef: 'vault://curacel/gmail/sandbox',
        apiKey: 'must-not-be-stored',
      }),
    );
    expect(connectorResponse.status).toBe(400);
    expect(connectorResponse.body.code).toBe('RAW_CREDENTIAL_REJECTED');

    const configured = await context.request(
      '/orgs/org-a/curacel/connectors/gmail',
      json('PUT', {
        name: 'Gmail draft',
        credentialRef: 'vault://curacel/gmail/sandbox',
        enabled: false,
        mode: 'dry_run',
        reviewRequired: true,
      }),
    );
    expect(configured.status).toBe(200);

    const draftResponse = await context.request(
      `/orgs/org-a/curacel/connectors/${configured.body.connector.id}/drafts`,
      json('POST', {
        targetRef: 'customer-42',
        payload: { subject: 'Draft only', metadata: { accessToken: 'not-allowed' } },
      }, { 'idempotency-key': 'draft-secret-test' }),
    );
    expect(draftResponse.status).toBe(400);
    expect(draftResponse.body.code).toBe('RAW_CREDENTIAL_REJECTED');
  });

  it('creates an idempotent pending-review draft with audit and one reliability sample', async () => {
    const context = await setup();
    const configured = await context.request(
      '/orgs/org-a/curacel/connectors/email',
      json('PUT', {
        name: 'Email draft',
        credentialRef: 'vault://curacel/email/sandbox',
      }),
    );
    const path = `/orgs/org-a/curacel/connectors/${configured.body.connector.id}/drafts`;
    const input = {
      targetRef: 'claim-19',
      payload: { subject: 'Claim update', body: 'Awaiting review' },
      teamId: 'claims',
      agentId: 'atlas',
      taskId: 19,
      latencyMs: 120,
    };

    const created = await context.request(
      path,
      json('POST', input, { 'idempotency-key': 'claim-email-19' }),
    );
    const replayed = await context.request(
      path,
      json('POST', input, { 'idempotency-key': 'claim-email-19' }),
    );

    expect(created.status).toBe(201);
    expect(created.body.draft).toMatchObject({
      state: 'pending_review',
      review_required: true,
      delivery_attempted: false,
    });
    expect(replayed.status).toBe(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.draft.id).toBe(created.body.draft.id);

    const aggregate = await context.request(
      '/curacel/operations?orgId=org-a&teamId=claims&agentId=atlas',
    );
    expect(aggregate.body.audit.filter((entry: any) =>
      entry.action.startsWith('connector_draft.'))).toHaveLength(3);
    expect(aggregate.body.reliability).toEqual([
      expect.objectContaining({
        agent_id: 'atlas',
        volume: 1,
        successes: 1,
        average_latency_ms: 120,
        review_outcomes: expect.objectContaining({ pending: 1 }),
      }),
    ]);
  });

  it('exposes no connector send or delivery endpoint', async () => {
    const context = await setup();
    const configured = await context.request(
      '/orgs/org-a/curacel/connectors/sms',
      json('PUT', {
        name: 'SMS draft',
        credentialRef: 'vault://curacel/sms/sandbox',
      }),
    );
    const connectorId = configured.body.connector.id;

    expect((await context.request(
      `/orgs/org-a/curacel/connectors/${connectorId}/send`,
      json('POST', {}),
    )).status).toBe(404);
    expect((await context.request(
      `/orgs/org-a/curacel/connectors/${connectorId}/deliver`,
      json('POST', {}),
    )).status).toBe(404);
  });

  it('aggregates per-agent reliability metrics and review outcomes', async () => {
    const context = await setup();
    const samples = [
      {
        teamId: 'ai-ops',
        agentId: 'sabi',
        outcome: 'success',
        latencyMs: 100,
        retries: 1,
        muted: true,
        rateLimited: false,
        reviewOutcome: 'approved',
      },
      {
        teamId: 'ai-ops',
        agentId: 'sabi',
        outcome: 'error',
        latencyMs: 300,
        retries: 2,
        muted: false,
        rateLimited: true,
        reviewOutcome: 'rejected',
      },
    ];
    for (const sample of samples) {
      expect((await context.request(
        '/orgs/org-a/curacel/execution-samples',
        json('POST', sample),
      )).status).toBe(201);
    }

    const report = await context.request(
      '/curacel/operations?orgId=org-a&teamId=ai-ops&agentId=sabi',
    );

    expect(report.status).toBe(200);
    expect(report.body.reliability).toEqual([{
      agent_id: 'sabi',
      team_id: 'ai-ops',
      volume: 2,
      successes: 1,
      errors: 1,
      success_rate: 0.5,
      error_rate: 0.5,
      average_latency_ms: 200,
      total_retries: 3,
      mute_events: 1,
      rate_limit_events: 1,
      review_outcomes: {
        approved: 1,
        rejected: 1,
        pending: 0,
        not_required: 0,
      },
    }]);
  });
});
