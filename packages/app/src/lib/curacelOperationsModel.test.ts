import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterCuracelAudit,
  normalizeCuracelOperationsData,
} from './curacelOperationsModel.ts';

test('normalization enforces review and bypass blocking for customer-impacting policies', () => {
  const model = normalizeCuracelOperationsData({
    policies: [
      { area: 'claims', reviewRequired: false, bypassBlocked: false },
      { area: 'finance', reviewer_roles: ['Controller'] },
    ],
  });

  assert.deepEqual(model.policies.map((policy) => policy.area), [
    'claims',
    'finance',
    'customer-communications',
  ]);
  assert.ok(model.policies.every((policy) => policy.reviewRequired && policy.bypassBlocked));
  assert.deepEqual(model.policies[1]?.reviewerRoles, ['Controller']);
});

test('connector normalization remains sandbox-safe even when payload asks to enable sending', () => {
  const model = normalizeCuracelOperationsData({
    connectors: [
      {
        type: 'gmail',
        state: 'enabled',
        mode: 'send',
        reviewRequired: false,
        credential_reference: 'vault://curacel/gmail/test',
      },
      {
        type: 'sms',
        credential_reference: 'live-secret-value-that-must-not-render',
      },
      {
        type: 'ticket',
        credential_ref: 'azure-keyvault://curacel/ticket/sandbox',
        mode: 'dry_run',
      },
    ],
  });

  assert.equal(model.connectors.length, 5);
  assert.ok(model.connectors.every((connector) => connector.state === 'disabled'));
  assert.ok(model.connectors.every((connector) => connector.reviewRequired));
  assert.equal(model.connectors.find((connector) => connector.kind === 'gmail')?.mode, 'draft');
  assert.equal(
    model.connectors.find((connector) => connector.kind === 'gmail')?.credentialReference,
    'vault://curacel/gmail/test',
  );
  assert.equal(
    model.connectors.find((connector) => connector.kind === 'sms')?.credentialReference,
    'vault://curacel/sms/sandbox',
  );
  assert.equal(
    model.connectors.find((connector) => connector.kind === 'ticket')?.credentialReference,
    'azure-keyvault://curacel/ticket/sandbox',
  );
});

test('audit events are sorted and filter across kind, scope, actor, agent, and task', () => {
  const model = normalizeCuracelOperationsData({
    audit_events: [
      {
        id: 'older',
        created_at: '2026-07-28T10:00:00Z',
        actor: { id: 'user-1', name: 'Ada Reviewer' },
        event_type: 'approval',
        action: 'approve claim draft',
        outcome: 'approved',
        org_id: 'org-a',
        team_id: 'claims',
        agent_id: 'atlas',
        task_id: '42',
      },
      {
        id: 'output',
        created_at: '2026-07-28T10:30:00Z',
        actor_principal_id: 'atlas',
        category: 'agent_output',
        action: 'drafted customer response',
        outcome: 'pending_review',
        detail: { summary: 'Response draft is waiting for human review.' },
        org_id: 'org-a',
        team_id: 'customer-success',
        agent_id: 'atlas',
        task_id: 41,
      },
      {
        id: 'newer',
        created_at: '2026-07-28T11:00:00Z',
        actor_id: 'agent-mafa',
        actor_name: 'Mafa',
        kind: 'error',
        action: 'draft failed',
        status: 'recovered',
        summary: 'ERP timeout recovered on retry.',
        org_id: 'org-a',
        team_id: 'finance',
        agent_id: 'mafa',
        task_id: '43',
      },
    ],
  });

  assert.deepEqual(model.audit.map((event) => event.id), ['newer', 'output', 'older']);
  assert.equal(model.audit[1]?.kind, 'output');
  assert.equal(model.audit[1]?.summary, 'Response draft is waiting for human review.');
  assert.deepEqual(filterCuracelAudit(model.audit, { kind: 'approval', teamId: 'claims' }).map((event) => event.id), ['older']);
  assert.deepEqual(filterCuracelAudit(model.audit, { query: 'timeout', agentId: 'mafa', taskId: '43' }).map((event) => event.id), ['newer']);
  assert.deepEqual(filterCuracelAudit(model.audit, { orgId: 'org-b' }), []);
});

test('reliability derives rates and team defaults are always operator-visible', () => {
  const model = normalizeCuracelOperationsData({
    team_dashboards: [{
      id: 'claims-dashboard',
      team_type: 'claims',
      approval_sla_minutes: 15,
      policies: { external_claim_review: true },
      agent_permissions: ['atlas:read-claims', 'mafa:draft-only'],
    }],
    agent_reliability: [{
      agent_id: 'atlas',
      agent_name: 'Atlas',
      successes: 18,
      errors: 2,
      average_latency_ms: 123.6,
      total_retries: 3,
      mute_events: 1,
      rate_limit_events: 2,
      review_outcomes: { approved: 4, rejected: 1, pending: 2 },
    }],
  }, { orgId: 'curacel' });

  assert.equal(model.orgId, 'curacel');
  assert.deepEqual(model.teams.map((team) => team.name), ['Claims', 'Customer Success', 'Finance', 'AI Ops']);
  assert.equal(model.reliability[0]?.volume, 20);
  assert.equal(model.reliability[0]?.successRate, 0.9);
  assert.equal(model.reliability[0]?.averageLatencyMs, 124);
  assert.equal(model.reliability[0]?.retryCount, 3);
  assert.equal(model.reliability[0]?.reviewPending, 2);
  assert.equal(model.teams[0]?.slaLabel, '15 minute approval SLA');
  assert.deepEqual(model.teams[0]?.permissions, ['atlas:read-claims', 'mafa:draft-only']);
});
