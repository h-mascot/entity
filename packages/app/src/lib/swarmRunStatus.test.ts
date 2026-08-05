import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POLLING_SWARM_JOB_STATUSES,
  TERMINAL_SWARM_JOB_STATUSES,
  isAgentRunPolling,
  isAgentRunTerminal,
  shouldPollAgentRun,
  deriveAgentRunViewState,
} from './swarmRunStatus.js';

test('polling/terminal status sets partition the swarm job lifecycle', () => {
  assert.deepEqual([...POLLING_SWARM_JOB_STATUSES], ['draft', 'queued', 'dispatched', 'running']);
  assert.deepEqual([...TERMINAL_SWARM_JOB_STATUSES], ['done', 'failed', 'cancelled']);
});

test('shouldPollAgentRun is true only while a run is in-flight', () => {
  for (const status of ['draft', 'queued', 'dispatched', 'running']) {
    assert.equal(shouldPollAgentRun({ id: 'j', status }), true);
  }
  for (const status of ['proof', 'review', 'done', 'failed', 'cancelled']) {
    assert.equal(shouldPollAgentRun({ id: 'j', status }), false);
  }
  assert.equal(shouldPollAgentRun(null), false);
  assert.equal(shouldPollAgentRun(undefined), false);
});

test('isAgentRunTerminal flags finished runs', () => {
  assert.equal(isAgentRunTerminal({ id: 'j', status: 'done' }), true);
  assert.equal(isAgentRunTerminal({ id: 'j', status: 'failed' }), true);
  assert.equal(isAgentRunTerminal({ id: 'j', status: 'cancelled' }), true);
  assert.equal(isAgentRunTerminal({ id: 'j', status: 'running' }), false);
  assert.equal(isAgentRunTerminal({ id: 'j', status: 'proof' }), false);
});

test('deriveAgentRunViewState reports idle for no job', () => {
  const state = deriveAgentRunViewState(null);
  assert.equal(state.phase, 'idle');
  assert.equal(state.terminal, false);
  assert.equal(state.hasProof, false);
  assert.equal(state.outcome, null);
});

test('deriveAgentRunViewState reports running/poll for in-flight jobs', () => {
  const state = deriveAgentRunViewState({ id: 'j', status: 'dispatched' });
  assert.equal(state.phase, 'running');
  assert.equal(state.terminal, false);
  assert.equal(state.outcome, null);
  assert.match(state.summary, /dispatched/);
});

test('deriveAgentRunViewState reports a terminal success outcome and surfaces proof', () => {
  const state = deriveAgentRunViewState(
    { id: 'j', status: 'done', completed_at: '2026-08-05T00:00:00Z' },
    [{ id: 'p', commit_sha: 'abc', test_result: 'pass' }],
  );
  assert.equal(state.phase, 'terminal');
  assert.equal(state.terminal, true);
  assert.equal(state.outcome, 'success');
  assert.equal(state.hasProof, true);
  assert.match(state.summary, /completed/);
  assert.match(state.summary, /Proof available/);
});

test('deriveAgentRunViewState reports a failure outcome for failed/cancelled', () => {
  const failed = deriveAgentRunViewState({ id: 'j', status: 'failed' });
  assert.equal(failed.terminal, true);
  assert.equal(failed.outcome, 'failure');
  assert.equal(failed.hasProof, false);

  const cancelled = deriveAgentRunViewState({ id: 'j', status: 'cancelled' });
  assert.equal(cancelled.outcome, 'failure');
});
