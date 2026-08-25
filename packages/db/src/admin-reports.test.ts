import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let activeDbPath: string | null = null;
let cleanupDbPaths: string[] = [];

function tempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.sqlite`);
}

function removeSqliteFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

async function loadFixture() {
  activeDbPath = tempDbPath('entity-db-admin-reports');
  cleanupDbPaths.push(activeDbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', activeDbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', tempDbPath('missing-mission-control'));

  const db = await import('./index');
  const workspace = db.createWorkspaceScopeRepository();
  workspace.createOrg({ id: 'org-a', name: 'Org A' });
  workspace.createOrg({ id: 'org-b', name: 'Org B' });
  workspace.createTeam({ orgId: 'org-a' }, { id: 'team-a', name: 'Team A' });
  workspace.createTeam({ orgId: 'org-b' }, { id: 'team-b', name: 'Team B' });

  const tasks = db.createTaskRepository();
  const taskA = tasks.createTask({
    name: 'Org A task',
    org_id: 'org-a',
    team_id: 'team-a',
    executor_principal_id: 'ada',
    owner_principal_id: 'ada',
  });
  const taskB = tasks.createTask({
    name: 'Org B task',
    org_id: 'org-b',
    team_id: 'team-b',
    executor_principal_id: 'spock',
    owner_principal_id: 'spock',
  });

  const activities = db.createActivityRepository();
  activities.createActivity({
    source: 'agent',
    type: 'task_completed',
    activity_event_type: 'completion_accepted',
    action: 'task.completed',
    description: 'Ada completed the task',
    task_id: taskA.id,
    agent_name: 'Ada',
    activity_event_payload: { actor_principal_id: 'ada', actor_type: 'human', task_id: taskA.id },
  });
  activities.createActivity({
    source: 'task',
    type: 'task_updated',
    activity_event_type: 'permission_denied',
    action: 'permission.denied',
    description: 'Access was denied',
    task_id: taskA.id,
    agent_name: 'Ada',
    activity_event_payload: { actor_principal_id: 'ada', actor_type: 'human', task_id: taskA.id },
  });
  activities.createActivity({
    source: 'agent',
    type: 'task_updated',
    activity_event_type: 'integration_degraded',
    action: 'integration.error',
    description: 'Spock integration failed',
    task_id: taskB.id,
    agent_name: 'Spock',
    activity_event_payload: { actor_principal_id: 'spock', actor_type: 'agent', task_id: taskB.id },
  });

  const logs = db.createAgentLogRepository();
  logs.createLog({ event: 'manual', task_id: taskA.id, action: 'review', model: 'model-a', tokens_used: 100 });
  logs.createLog({ event: 'manual', task_id: taskA.id, action: 'follow-up', model: 'model-a', tokens_used: 50 });
  logs.createLog({ event: 'manual', task_id: taskB.id, action: 'review', model: 'model-b', tokens_used: 200 });

  const { createPrincipalRepository } = await import('./principals');
  const principals = createPrincipalRepository();
  principals.createPrincipal({ id: 'ada', principal_type: 'human', display_name: 'Ada', email: 'ada@example.com' });
  principals.createGrant({ id: 'grant-ada', principal_id: 'ada', role: 'manager', org_id: 'org-a', team_id: 'team-a' });
  principals.createPrincipal({ id: 'spock', principal_type: 'agent', display_name: 'Spock' });
  principals.createGrant({ id: 'grant-spock', principal_id: 'spock', role: 'viewer', org_id: 'org-b', team_id: 'team-b' });
  principals.createPrincipal({ id: 'disabled', principal_type: 'human', display_name: 'Disabled' });
  principals.disablePrincipal('disabled');

  const { createAccessTokenRepository } = await import('./access-tokens');
  const tokens = createAccessTokenRepository(undefined, principals);
  const createdToken = tokens.createToken({ principal_id: 'ada', label: 'laptop' });

  const { createAdminReportRepository } = await import('./admin-reports');
  const reports = createAdminReportRepository();
  return { db, reports, createdToken, taskA, taskB };
}

afterEach(async () => {
  const dbPathToClose = activeDbPath;
  if (dbPathToClose) {
    const closePath = tempDbPath('entity-db-admin-reports-close');
    cleanupDbPaths.push(closePath);
    vi.stubEnv('ENTITY_TASK_DB_PATH', closePath);
    try {
      const { getEntityDatabase } = await import('./entity-db');
      getEntityDatabase().close();
    } catch {
      // Best effort after a failed fixture setup.
    }
  }
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of cleanupDbPaths) removeSqliteFiles(dbPath);
  activeDbPath = null;
  cleanupDbPaths = [];
});

describe('admin report repository (MC #1369)', () => {
  it('aggregates usage and scopes it by org, team, actor, and date', async () => {
    const { reports } = await loadFixture();

    const report = reports.getUsageReport({ orgId: 'org-a', teamId: 'team-a', actor: 'ada' });
    expect(report.totals).toEqual({ runs: 2, tokens: 150 });
    expect(report.byActor).toEqual([{ actor: 'ada', runs: 2, tokens: 150 }]);
    expect(report.byModel).toEqual([{ model: 'model-a', runs: 2, tokens: 150 }]);
    expect(report.byEvent).toEqual([{ event: 'manual', runs: 2, tokens: 150 }]);
    expect(report.byDay).toHaveLength(1);
  });

  it('returns audit events with outcome counts and excludes another org', async () => {
    const { reports } = await loadFixture();

    const report = reports.getAuditReport({ orgId: 'org-a' });
    expect(report.total).toBe(2);
    expect(report.totals).toEqual({ events: 2, successes: 1, failures: 1, observed: 0 });
    expect(report.events.map((event) => event.actor).sort()).toEqual(['ada', 'ada']);
    expect(report.byOutcome).toEqual([
      { label: 'failure', count: 1 },
      { label: 'success', count: 1 },
    ]);
  });

  it('returns access report rows by scope and never exposes token hashes', async () => {
    const { reports, createdToken } = await loadFixture();

    const report = reports.getAccessReport({ orgId: 'org-a', teamId: 'team-a' });
    expect(report.totals).toMatchObject({ principals: 1, activePrincipals: 1, grants: 1, activeTokens: 1 });
    expect(report.principals).toHaveLength(1);
    expect(report.principals[0]).toMatchObject({ id: 'ada', displayName: 'Ada' });
    expect(report.principals[0].grants).toMatchObject([{ role: 'manager', orgId: 'org-a', teamId: 'team-a' }]);
    expect(report.principals[0].tokens).toMatchObject([{ label: 'laptop', status: 'active' }]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('token_hash');
    expect(serialized).not.toContain(createdToken.token);
  });

  it('can locate access by user and include disabled principals explicitly', async () => {
    const { reports } = await loadFixture();

    expect(reports.getAccessReport({ actor: 'ada' }).principals.map((principal) => principal.id)).toEqual(['ada']);
    const disabled = reports.getAccessReport({ actor: 'Disabled', status: 'disabled' });
    expect(disabled.total).toBe(1);
    expect(disabled.principals[0].status).toBe('disabled');
  });
});
