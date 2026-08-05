import { describe, expect, it } from 'vitest';
import {
  ACTIVE_SWARM_JOB_STATUSES,
  isSwarmJobActive,
  findActiveSwarmJob,
  buildRunWithAgentsJobInput,
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

  it('builds a task-linked job input titled from the task with a sensible spec', () => {
    const input = buildRunWithAgentsJobInput({
      id: 42,
      name: '  Fix login redirect  ',
      description: '  Users hit a blank page after SSO.  ',
    });
    expect(input).toMatchObject({
      title: 'Run: Fix login redirect',
      spec: 'Users hit a blank page after SSO.',
      task_id: 42,
      repo: 'https://github.com/example/entity',
      branch: 'main',
      provider: 'acp',
    });

    // Falls back to the name when there is no description.
    const minimal = buildRunWithAgentsJobInput({ id: 5, name: 'Ship it' });
    expect(minimal.spec).toBe('Ship it');
    expect(minimal.title).toBe('Run: Ship it');
  });

  it('respects caller-provided repo/branch/provider overrides', () => {
    const input = buildRunWithAgentsJobInput(
      { id: 9, name: 'T' },
      { repo: 'https://github.com/acme/mono', branch: 'dev', provider: 'e2b' },
    );
    expect(input).toMatchObject({
      repo: 'https://github.com/acme/mono',
      branch: 'dev',
      provider: 'e2b',
    });
  });
});
