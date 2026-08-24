import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createCuracelOperationsRepository } from './curacel-operations';

const databases: Database.Database[] = [];

function fixture() {
  const db = new Database(':memory:');
  databases.push(db);
  const repo = createCuracelOperationsRepository(db, {
    now: () => new Date('2026-07-29T10:00:00.000Z'),
  });
  return { db, repo };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('Curacel operations repository', () => {
  it('defaults protected actions to review and blocks attempts to bypass them', () => {
    const { repo } = fixture();

    expect(repo.resolveReviewPolicy({
      org_id: 'org-a',
      team_id: 'claims',
      action: 'claim_decision',
    })).toMatchObject({
      action: 'claim_decision',
      review_required: true,
      source: 'protected_default',
    });

    expect(() => repo.upsertReviewPolicy({
      org_id: 'org-a',
      team_id: 'claims',
      action: 'claim_decision',
      review_required: false,
      actor_principal_id: 'owner-a',
    })).toThrow(/cannot bypass/i);

    const policy = repo.upsertReviewPolicy({
      org_id: 'org-a',
      team_id: 'claims',
      action: 'claim_decision',
      review_required: true,
      approver_roles: ['claims_manager'],
      actor_principal_id: 'owner-a',
    });
    expect(repo.resolveReviewPolicy({
      org_id: 'org-a',
      team_id: 'claims',
      action: 'claim_decision',
    })).toMatchObject({ id: policy.id, source: 'team_policy' });
    expect(repo.listReviewPolicies('org-b')).toEqual([]);
  });

  it('keeps outbound connectors disabled, draft-only, reviewed, scoped, and secret-free', () => {
    const { repo } = fixture();
    const connector = repo.upsertConnector({
      org_id: 'org-a',
      team_id: 'customer-success',
      type: 'gmail',
      name: 'Customer reply drafts',
      credential_ref: 'vault://entity/org-a/customer-success/gmail',
      actor_principal_id: 'owner-a',
    });
    expect(connector).toMatchObject({
      type: 'gmail',
      enabled: false,
      mode: 'dry_run',
      review_required: true,
    });

    for (const credential_ref of [
      'sk-proj-this-is-a-raw-secret-value',
      'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      'plain-password',
    ]) {
      expect(() => repo.upsertConnector({
        org_id: 'org-a',
        type: 'email',
        name: 'Unsafe',
        credential_ref,
        actor_principal_id: 'owner-a',
      })).toThrow(/credential reference/i);
    }
    expect(() => repo.upsertConnector({
      org_id: 'org-a',
      type: 'sms',
      name: 'Unsafe send',
      credential_ref: 'env://CURACEL_SMS_CREDENTIAL',
      enabled: true,
      actor_principal_id: 'owner-a',
    })).toThrow(/cannot be enabled/i);

    expect(() => repo.createConnectorDraft({
      org_id: 'org-a',
      connector_id: connector.id,
      actor_principal_id: 'agent-cs',
      idempotency_key: 'unsafe-payload',
      target_ref: 'customer://case-42',
      payload: { api_key: 'raw-secret' },
    })).toThrow(/raw credentials/i);

    const draft = repo.createConnectorDraft({
      org_id: 'org-a',
      connector_id: connector.id,
      actor_principal_id: 'agent-cs',
      idempotency_key: 'case-42-reply-v1',
      target_ref: 'customer://case-42',
      payload: { subject: 'Claim update', body: 'Draft response' },
    });
    expect(draft).toMatchObject({
      state: 'pending_review',
      delivery_attempted: false,
      review_required: true,
    });
    expect(repo.createConnectorDraft({
      org_id: 'org-a',
      connector_id: connector.id,
      actor_principal_id: 'agent-cs',
      idempotency_key: 'case-42-reply-v1',
      target_ref: 'customer://case-42',
      payload: { subject: 'Changed', body: 'Must not replace original' },
    })).toEqual(draft);
    expect(() => repo.createConnectorDraft({
      org_id: 'org-b',
      connector_id: connector.id,
      actor_principal_id: 'agent-b',
      idempotency_key: 'cross-tenant',
      target_ref: 'customer://case-42',
      payload: {},
    })).toThrow(/connector not found/i);
  });

  it('records a unified, idempotent audit trail with tenant-safe filters', () => {
    const { repo } = fixture();
    const event = repo.appendAudit({
      org_id: 'org-a',
      team_id: 'finance',
      agent_id: 'agent-finance',
      task_id: 19,
      actor_principal_id: 'approver-a',
      category: 'approval',
      action: 'finance_commitment_approved',
      outcome: 'approved',
      detail: { receipt_id: 'receipt-19' },
      idempotency_key: 'approval-19-v1',
    });
    expect(repo.appendAudit({
      org_id: 'org-a',
      team_id: 'finance',
      agent_id: 'agent-finance',
      task_id: 19,
      actor_principal_id: 'approver-a',
      category: 'approval',
      action: 'ignored_duplicate',
      outcome: 'approved',
      idempotency_key: 'approval-19-v1',
    })).toEqual(event);
    repo.appendAudit({
      org_id: 'org-b',
      team_id: 'finance',
      agent_id: 'agent-finance',
      task_id: 19,
      actor_principal_id: 'approver-b',
      category: 'error',
      action: 'private_failure',
      outcome: 'error',
    });

    expect(repo.listAudit({
      org_id: 'org-a',
      team_id: 'finance',
      agent_id: 'agent-finance',
      task_id: 19,
    })).toEqual([event]);
  });

  it('aggregates per-agent reliability, controls, retries, latency, and review outcomes', () => {
    const { repo } = fixture();
    repo.recordExecution({
      org_id: 'org-a',
      team_id: 'claims',
      agent_id: 'atlas',
      task_id: 19,
      outcome: 'success',
      latency_ms: 120,
      retries: 1,
      review_outcome: 'approved',
    });
    repo.recordExecution({
      org_id: 'org-a',
      team_id: 'claims',
      agent_id: 'atlas',
      outcome: 'error',
      latency_ms: 280,
      retries: 2,
      muted: true,
      rate_limited: true,
      review_outcome: 'rejected',
    });
    repo.recordExecution({
      org_id: 'org-b',
      team_id: 'claims',
      agent_id: 'atlas',
      outcome: 'success',
      latency_ms: 1,
    });

    expect(repo.getUsageReport({ org_id: 'org-a' })).toEqual([{
      agent_id: 'atlas',
      team_id: 'claims',
      volume: 2,
      successes: 1,
      errors: 1,
      success_rate: 0.5,
      error_rate: 0.5,
      average_latency_ms: 200,
      total_retries: 3,
      mute_events: 1,
      rate_limit_events: 1,
      review_outcomes: { approved: 1, rejected: 1, pending: 0, not_required: 0 },
    }]);
    expect(() => repo.recordExecution({
      org_id: 'org-a',
      agent_id: 'atlas',
      outcome: 'success',
      latency_ms: -1,
    })).toThrow(/latency/i);
    expect(() => repo.recordExecution({
      org_id: 'org-a',
      agent_id: 'atlas',
      outcome: 'success',
      latency_ms: 1,
      retries: 1.5,
    })).toThrow(/retries/i);
  });

  it('supports isolated Claims, Customer Success, Finance, and AI Ops dashboards', () => {
    const { repo } = fixture();
    const types = ['claims', 'customer_success', 'finance', 'ai_ops'] as const;
    types.forEach((team_type) => repo.upsertTeamDashboard({
      org_id: 'org-a',
      team_id: `team-${team_type}`,
      team_type,
      queue_label: `${team_type} queue`,
      approval_sla_minutes: 30,
      policies: { review: 'mandatory' },
      agent_permissions: ['read_queue', 'create_draft'],
      actor_principal_id: 'owner-a',
    }));

    expect(repo.listTeamDashboards('org-a').map((row) => row.team_type)).toEqual(types);
    expect(repo.getTeamDashboard('org-a', 'team-finance')).toMatchObject({
      team_type: 'finance',
      approval_sla_minutes: 30,
    });
    expect(repo.listTeamDashboards('org-b')).toEqual([]);
    expect(() => repo.upsertTeamDashboard({
      org_id: 'org-a',
      team_id: 'team-sales',
      team_type: 'sales' as 'claims',
      queue_label: 'Sales',
      approval_sla_minutes: 30,
      policies: {},
      agent_permissions: [],
      actor_principal_id: 'owner-a',
    })).toThrow(/team type/i);
  });
});
