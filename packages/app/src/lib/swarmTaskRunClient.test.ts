import assert from 'node:assert/strict';
import test from 'node:test';
import { findNewestTaskSwarmJob, type SwarmTaskJobSummary } from './swarmRunStatus.js';

interface JobLike extends SwarmTaskJobSummary {
  title: string;
  status: string;
}

function job(id: string, status: string, createdAt: string): JobLike {
  return { id, task_id: 7, title: `Run ${id}`, status, created_at: createdAt };
}

test('findNewestTaskSwarmJob returns null for an empty job list', () => {
  assert.equal(findNewestTaskSwarmJob([]), null);
});

test('findNewestTaskSwarmJob retains the newest task-linked job when it is terminal (active→terminal)', () => {
  // The API returns jobs newest-first, but the selector must be robust to order.
  // Here the newest job has already reached a terminal status; the run must be
  // retained so the task detail can surface its status/proof/details.
  const jobs = [
    job('newest', 'done', '2026-08-05T10:00:00Z'),
    job('older-active', 'running', '2026-08-05T09:00:00Z'),
  ];
  const selected = findNewestTaskSwarmJob(jobs);
  assert.equal(selected?.id, 'newest');
  assert.equal(selected?.status, 'done');
});

test('findNewestTaskSwarmJob returns the in-flight job when it is the newest', () => {
  const jobs = [
    job('live', 'dispatched', '2026-08-05T10:00:00Z'),
    job('past', 'failed', '2026-08-05T09:00:00Z'),
  ];
  assert.equal(findNewestTaskSwarmJob(jobs)?.id, 'live');
});

test('findNewestTaskSwarmJob is order-independent and deterministic on created_at ties', () => {
  const sameTime = '2026-08-05T10:00:00Z';
  // Unsorted input: the selector must still pick the newest by created_at.
  const unsorted = [
    job('b', 'done', '2026-08-05T09:00:00Z'),
    job('c', 'done', sameTime),
    job('a', 'running', '2026-08-05T11:00:00Z'),
  ];
  assert.equal(findNewestTaskSwarmJob(unsorted)?.id, 'a');

  // Tie on created_at falls back to a stable, deterministic id ordering.
  const tied = [job('zzz', 'done', sameTime), job('aaa', 'done', sameTime)];
  const tiedWinner = findNewestTaskSwarmJob(tied);
  assert.ok(tiedWinner);
  assert.equal(tiedWinner.created_at, sameTime);
  // Deterministic: same answer regardless of input order.
  assert.equal(
    findNewestTaskSwarmJob([job('aaa', 'done', sameTime), job('zzz', 'done', sameTime)])?.id,
    tiedWinner.id,
  );
});

test('findNewestTaskSwarmJob ignores jobs not linked to a task', () => {
  const jobs: JobLike[] = [
    { id: 'unlinked', task_id: null, title: 'free-form', status: 'running', created_at: '2026-08-05T12:00:00Z' },
    job('linked', 'done', '2026-08-05T10:00:00Z'),
  ];
  assert.equal(findNewestTaskSwarmJob(jobs)?.id, 'linked');
});
