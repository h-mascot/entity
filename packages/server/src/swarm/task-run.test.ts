import { describe, expect, it } from 'vitest';
import {
  ACTIVE_SWARM_JOB_STATUSES,
  isSwarmJobActive,
  findActiveSwarmJob,
  buildRunWithAgentsJobInput,
  resolveRunWithAgentsTarget,
  isTaskEligibleForAgentRun,
  isTaskInScope,
  NoExecutionTargetError,
} from './task-run';

describe('swarm task-run helpers', () => {
  it('treats in-flight statuses as active and post-run/terminal as inactive', () => {
    expect(ACTIVE_SWARM_JOB_STATUSES).toEqual(['draft', 'queued', 'dispatched', 'running']);
    for (const status of ['draft', 'queued', 'dispatched', 'running']) {
      expect(isSwarmJobActive({ status })).toBe(true);
    }
    for (const status of ['proof', 'review', 'done', 'failed', '']) {
      expect(isSwarmJobActive({ status })).toBe(false);
    }
  });

  it('finds the first active job for a task and ignores terminal ones', () => {
    const jobs = [
      { id: 'a', task_id: 7, status: 'done' },
      { id: 'b', task_id: 7, status: 'queued' },
      { id: 'c', task_id: 7, status: 'running' },
    ];
    expect(findActiveSwarmJob(jobs)?.id).toBe('b');

    expect(findActiveSwarmJob([
      { id: 'x', task_id: 7, status: 'done' },
      { id: 'y', task_id: 7, status: 'failed' },
    ])).toBeUndefined();

    expect(findActiveSwarmJob([])).toBeUndefined();
  });

  describe('buildRunWithAgentsJobInput (dispatch target must be explicit)', () => {
    it('uses the resolved target verbatim and links the task id', () => {
      const input = buildRunWithAgentsJobInput(
        { id: 42, name: '  Fix login redirect  ', description: '  Blank page after SSO.  ' },
        { target: { repo: 'https://github.com/acme/mono', branch: 'dev', provider: 'e2b' } },
      );
      expect(input).toMatchObject({
        title: 'Run: Fix login redirect',
        spec: 'Blank page after SSO.',
        task_id: 42,
        repo: 'https://github.com/acme/mono',
        branch: 'dev',
        provider: 'e2b',
      });
    });

    it('falls back to the task name for the spec when there is no description', () => {
      const input = buildRunWithAgentsJobInput(
        { id: 5, name: 'Ship it' },
        { target: { repo: 'https://github.com/acme/mono', branch: 'main', provider: 'acp' } },
      );
      expect(input.spec).toBe('Ship it');
      expect(input.title).toBe('Run: Ship it');
    });

    it('throws NoExecutionTargetError when no target is supplied (never an example placeholder)', () => {
      expect(() =>
        // intentionally omit target — the builder must fail closed, not invent a repo
        buildRunWithAgentsJobInput(
          { id: 9, name: 'T' },
          {} as { target: { repo: string; branch: string; provider: string } },
        ),
      ).toThrow(NoExecutionTargetError);
    });
  });

  describe('resolveRunWithAgentsTarget (fail closed unless a real target is configured)', () => {
    it('returns null when nothing supplies a repo (no example placeholder)', () => {
      expect(resolveRunWithAgentsTarget({ task: { metadata: null } })).toBeNull();
      expect(
        resolveRunWithAgentsTarget({ task: { metadata: '{"branch":"main"}' } }),
      ).toBeNull();
    });

    it('prefers an explicit request body override', () => {
      const target = resolveRunWithAgentsTarget({
        body: { repo: 'https://github.com/acme/override', branch: 'feat', provider: 'codex' },
        task: { metadata: '{"repo":"https://github.com/acme/metadata"}' },
        env: { ENTITY_SWARM_RUN_REPO: 'https://github.com/acme/env' },
      });
      expect(target).toEqual({
        repo: 'https://github.com/acme/override',
        branch: 'feat',
        provider: 'codex',
      });
    });

    it('falls back to governed env config when the body omits a field', () => {
      const target = resolveRunWithAgentsTarget({
        body: { provider: 'codex' },
        task: { metadata: null },
        env: {
          ENTITY_SWARM_RUN_REPO: 'https://github.com/acme/env',
          ENTITY_SWARM_RUN_BRANCH: 'main',
        },
      });
      expect(target).toEqual({
        repo: 'https://github.com/acme/env',
        branch: 'main',
        provider: 'codex',
      });
    });

    it('falls back to task metadata when neither body nor env supply a field', () => {
      const target = resolveRunWithAgentsTarget({
        task: {
          metadata: JSON.stringify({
            repo: 'https://github.com/acme/from-task',
            branch: 'task-branch',
            provider: 'acp',
          }),
        },
      });
      expect(target).toEqual({
        repo: 'https://github.com/acme/from-task',
        branch: 'task-branch',
        provider: 'acp',
      });
    });

    it('treats a missing repo anywhere as fail-closed null even if branch/provider exist', () => {
      expect(
        resolveRunWithAgentsTarget({
          body: { branch: 'main', provider: 'acp' },
          task: { metadata: null },
        }),
      ).toBeNull();
    });
  });

  describe('isTaskEligibleForAgentRun', () => {
    it('accepts a normal actionable task', () => {
      expect(isTaskEligibleForAgentRun({ name: 'Do thing', archived: false, column: 'todo' })).toBe(true);
      expect(isTaskEligibleForAgentRun({ name: 'Do thing', archived: false, column: 'doing' })).toBe(true);
    });

    it('rejects archived and done/terminal tasks', () => {
      expect(isTaskEligibleForAgentRun({ name: 'Done', archived: false, column: 'done' })).toBe(false);
      expect(isTaskEligibleForAgentRun({ name: 'Archived', archived: true, column: 'todo' })).toBe(false);
    });

    it('rejects a task with no usable name', () => {
      expect(isTaskEligibleForAgentRun({ name: '   ', archived: false, column: 'todo' })).toBe(false);
      expect(isTaskEligibleForAgentRun({ archived: false, column: 'todo' })).toBe(false);
    });
  });

  describe('isTaskInScope (request-derived tenant authorization)', () => {
    it('matches when task org/team agree with the request scope', () => {
      expect(
        isTaskInScope({ org_id: 'org-a', team_id: 'team-1' }, { orgId: 'org-a', teamId: 'team-1' }),
      ).toBe(true);
    });

    it('rejects cross-org and cross-team tasks (fail closed)', () => {
      expect(
        isTaskInScope({ org_id: 'org-b', team_id: 'team-1' }, { orgId: 'org-a', teamId: 'team-1' }),
      ).toBe(false);
      expect(
        isTaskInScope({ org_id: 'org-a', team_id: 'team-2' }, { orgId: 'org-a', teamId: 'team-1' }),
      ).toBe(false);
    });

    it('defaults a task with no explicit scope to the configured default workspace', () => {
      expect(
        isTaskInScope({ org_id: undefined, team_id: undefined }, { orgId: 'default-org', teamId: 'default-team' }),
      ).toBe(true);
    });
  });
});
