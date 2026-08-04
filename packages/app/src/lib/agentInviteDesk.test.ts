import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canCopyInviteSecrets,
  canRegenerateInvite,
  canRevokeInvite,
  createInitialDeskState,
  deskApplyInviteUpdate,
  deskBeginLoad,
  deskForgetShowOnce,
  deskFromListError,
  deskFromListSuccess,
  deskRememberShowOnce,
  deskStatusDisplay,
  extractShowOnce,
  mergeShowOnce,
  normalizeDeskInvite,
  stripTokenFromView,
  urlsUnavailableReason,
  verificationSummary,
  type DeskInviteView,
} from './agentInviteDesk.ts';

function sampleInvite(overrides: Partial<DeskInviteView> = {}): DeskInviteView {
  return {
    id: 'inv-1',
    status: 'created',
    agentName: 'Scout',
    role: 'worker',
    creationSource: 'agents_invite',
    createdAt: '2026-07-31T05:00:00.000Z',
    expiresAt: '2026-07-31T05:30:00.000Z',
    openedAt: null,
    completedAt: null,
    revokedAt: null,
    revokedBy: null,
    generation: 1,
    rotated: false,
    selectedBundle: 'default',
    selectedModules: ['entity-mc'],
    permissionsScope: ['workspace_read'],
    safeStopConditions: ['Stop if revoked.'],
    projectId: null,
    workplaneId: null,
    taskId: null,
    persistence: 'durable',
    progress: [
      {
        stepId: 'install-entity-mc',
        label: 'Install Entity MC',
        moduleId: 'entity-mc',
        status: 'pending',
        updatedAt: '2026-07-31T05:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

test('normalizeDeskInvite maps durable GET payload without token', () => {
  const invite = normalizeDeskInvite({
    id: 'abc',
    status: 'opened',
    agentName: 'Ada',
    role: 'chief',
    creationSource: 'agents_invite',
    createdAt: '2026-07-31T01:00:00.000Z',
    expiresAt: '2026-07-31T02:00:00.000Z',
    openedAt: '2026-07-31T01:05:00.000Z',
    completedAt: null,
    revokedAt: null,
    revokedBy: null,
    generation: 2,
    rotated: true,
    selectedBundle: 'minimal',
    selectedModules: ['entity-mc'],
    permissionsScope: [],
    safeStopConditions: [],
    projectId: 'eng',
    workplaneId: null,
    taskId: 12,
    persistence: 'durable',
    progress: [
      {
        stepId: 's1',
        label: 'Step 1',
        status: 'done',
        updatedAt: '2026-07-31T01:10:00.000Z',
      },
    ],
  });
  assert.ok(invite);
  assert.equal(invite!.status, 'opened');
  assert.equal(invite!.rotated, true);
  assert.equal(invite!.token, undefined);
  assert.equal(invite!.progress.length, 1);
  assert.equal(deskStatusDisplay(invite!), 'Opened · rotated (gen 2)');
});

test('deskFromListSuccess empty and ready paths', () => {
  const loading = deskBeginLoad(createInitialDeskState());
  assert.equal(loading.uiStatus, 'loading');

  const empty = deskFromListSuccess(loading, { invites: [], count: 0 });
  assert.equal(empty.uiStatus, 'empty');
  assert.equal(empty.invites.length, 0);

  const ready = deskFromListSuccess(loading, {
    invites: [sampleInvite({ token: 'should-strip', setupPath: '/onboard/agent/x' })],
    count: 1,
  });
  assert.equal(ready.uiStatus, 'ready');
  assert.equal(ready.invites[0]!.token, undefined);
  assert.equal(ready.selectedInviteId, 'inv-1');
});

test('deskFromListError is visible and clears invites', () => {
  const prior = createInitialDeskState({
    uiStatus: 'ready',
    invites: [sampleInvite()],
  });
  const errored = deskFromListError(prior, 'network down');
  assert.equal(errored.uiStatus, 'error');
  assert.equal(errored.error, 'network down');
  assert.equal(errored.invites.length, 0);
});

test('revoke/regenerate/copy affordances fail closed', () => {
  const created = sampleInvite({ status: 'created' });
  const revoked = sampleInvite({ status: 'revoked' });
  const expired = sampleInvite({ status: 'expired' });

  assert.equal(canRevokeInvite(created), true);
  assert.equal(canRevokeInvite(revoked), false);
  assert.equal(canRevokeInvite(expired), true);
  assert.equal(canRegenerateInvite(revoked), true);

  assert.equal(canCopyInviteSecrets('inv-1', {}), false);
  const secrets = extractShowOnce(sampleInvite({
    token: 'tok12345678',
    setupPath: '/onboard/agent/tok12345678',
    manifestPath: '/api/onboarding/agent-session/tok12345678/manifest',
    bundlePath: '/api/onboarding/agent-session/tok12345678/bundle',
    skillPath: '/api/onboarding/agent-session/tok12345678/skill',
    progressPath: '/api/onboarding/agent-session/tok12345678/progress',
  }));
  assert.ok(secrets);
  assert.equal(canCopyInviteSecrets('inv-1', { 'inv-1': secrets! }), true);

  assert.match(
    urlsUnavailableReason(revoked, {}) ?? '',
    /revoked/i,
  );
  assert.match(
    urlsUnavailableReason(expired, {}) ?? '',
    /expired/i,
  );
});

test('show-once secrets remembered then cleared on revoke', () => {
  const withToken = sampleInvite({
    token: 'tokABCDEF12',
    setupPath: '/onboard/agent/tokABCDEF12',
    manifestPath: '/m',
    bundlePath: '/b',
    skillPath: '/s',
    progressPath: '/p',
  });
  let state = deskRememberShowOnce(createInitialDeskState(), withToken);
  assert.ok(state.showOnceById['inv-1']);
  const merged = mergeShowOnce(stripTokenFromView(withToken), state.showOnceById);
  assert.equal(merged.token, 'tokABCDEF12');

  state = deskApplyInviteUpdate(state, {
    ...sampleInvite({ status: 'revoked', revokedAt: '2026-07-31T06:00:00.000Z' }),
  });
  assert.equal(state.invites[0]!.status, 'revoked');
  assert.equal(state.showOnceById['inv-1'], undefined);
});

test('regenerate applies show-once secrets into desk memory', () => {
  const state = deskApplyInviteUpdate(
    createInitialDeskState({ uiStatus: 'ready', invites: [sampleInvite()] }),
    sampleInvite({
      generation: 2,
      rotated: true,
      status: 'created',
      token: 'newtoken99',
      setupPath: '/onboard/agent/newtoken99',
      manifestPath: '/api/onboarding/agent-session/newtoken99/manifest',
      bundlePath: '/api/onboarding/agent-session/newtoken99/bundle',
      skillPath: '/api/onboarding/agent-session/newtoken99/skill',
      progressPath: '/api/onboarding/agent-session/newtoken99/progress',
    }),
    { rememberShowOnce: true },
  );
  assert.equal(state.invites[0]!.token, undefined);
  assert.equal(state.showOnceById['inv-1']?.token, 'newtoken99');
  assert.equal(state.invites[0]!.generation, 2);
  assert.match(deskStatusDisplay(state.invites[0]!), /rotated/);
});

test('verificationSummary covers empty/error/done', () => {
  assert.equal(
    verificationSummary(sampleInvite({ progress: [] })),
    'No verification steps yet',
  );
  assert.equal(
    verificationSummary(sampleInvite({
      progress: [
        { stepId: 'a', label: 'A', status: 'done', updatedAt: 't' },
        { stepId: 'b', label: 'B', status: 'error', updatedAt: 't' },
      ],
    })),
    '1/2 verified · 1 failed',
  );
  assert.equal(
    verificationSummary(sampleInvite({
      progress: [
        { stepId: 'a', label: 'A', status: 'done', updatedAt: 't' },
      ],
    })),
    '1/1 verified',
  );
});

test('deskForgetShowOnce is idempotent', () => {
  const state = deskForgetShowOnce(createInitialDeskState(), 'missing');
  assert.deepEqual(state.showOnceById, {});
});

test('normalizeDeskInvite rejects invalid status', () => {
  assert.equal(normalizeDeskInvite({ id: 'x', status: 'bogus' }), null);
});
