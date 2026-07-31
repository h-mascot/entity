import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADVANCED_FIELDS,
  BASIC_FIELDS,
  beginEditing,
  buildLocalPreviewInvite,
  createEmptyDraft,
  createInitialCreationState,
  createInviteKit,
  creationSummary,
  inviteStatusLabel,
  resetCreation,
  roleLabel,
  toggleAdvanced,
  updateDraft,
  validateDraft,
  visibleFields,
} from './addAgentInviteCreation.ts';

test('initial state is empty with basic fields only', () => {
  const state = createInitialCreationState();
  assert.equal(state.uiStatus, 'empty');
  assert.equal(state.invite, null);
  assert.equal(state.error, null);
  assert.deepEqual(visibleFields(state.draft), [...BASIC_FIELDS]);
  assert.ok(!visibleFields(state.draft).includes('selectedBundle'));
});

test('progressive disclosure reveals advanced fields', () => {
  const state = toggleAdvanced(createInitialCreationState());
  assert.equal(state.draft.showAdvanced, true);
  assert.equal(state.uiStatus, 'editing');
  const fields = visibleFields(state.draft);
  for (const field of ADVANCED_FIELDS) {
    assert.ok(fields.includes(field), `expected ${field}`);
  }
});

test('validateDraft requires agent name', () => {
  const result = validateDraft(createEmptyDraft({ agentName: '   ' }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /required/i);
  }
});

test('validateDraft accepts a minimal happy draft', () => {
  const result = validateDraft(createEmptyDraft({ agentName: 'Scout' }));
  assert.equal(result.ok, true);
});

test('validateDraft rejects too-short TTL', () => {
  const result = validateDraft(createEmptyDraft({ agentName: 'Scout', ttlMs: 1000 }));
  assert.equal(result.ok, false);
});

test('beginEditing moves empty → editing', () => {
  const next = beginEditing(createInitialCreationState());
  assert.equal(next.uiStatus, 'editing');
});

test('updateDraft clears ready invite when editing again', () => {
  const ready = {
    ...createInitialCreationState(),
    uiStatus: 'ready' as const,
    invite: buildLocalPreviewInvite(createEmptyDraft({ agentName: 'Scout' }), {
      randomId: () => 'abc123',
    }),
  };
  const next = updateDraft(ready, { agentName: 'Scout 2' });
  assert.equal(next.uiStatus, 'editing');
  assert.equal(next.invite, null);
  assert.equal(next.draft.agentName, 'Scout 2');
});

test('buildLocalPreviewInvite uses invite-kit created status and agents_invite source', () => {
  const now = new Date('2026-07-31T05:00:00.000Z');
  const invite = buildLocalPreviewInvite(
    createEmptyDraft({
      agentName: 'Scout',
      role: 'reviewer',
      projectId: 'engineering',
      selectedBundle: 'minimal',
      taskId: '42',
    }),
    { now, randomId: () => 'tokpreview01' },
  );

  assert.equal(invite.status, 'created');
  assert.equal(invite.creationSource, 'agents_invite');
  assert.equal(invite.persistence, 'local_preview_not_durable');
  assert.equal(invite.seam, 'local_preview');
  assert.equal(invite.agentName, 'Scout');
  assert.equal(invite.role, 'reviewer');
  assert.equal(invite.projectId, 'engineering');
  assert.equal(invite.taskId, 42);
  assert.equal(invite.setupPath, '/onboard/agent/tokpreview01');
  assert.match(invite.manifestPath, /\/api\/onboarding\/agent-session\/tokpreview01\/manifest$/);
  assert.equal(invite.expiresAt, '2026-07-31T05:30:00.000Z');
  assert.deepEqual(invite.selectedModules, ['entity-agent-contracts', 'entity-mc']);
  assert.match(invite.nextStep, /invite prompt/i);
  assert.match(invite.nextStep, /WP2-A-05/);
});

test('createInviteKit success path → ready local_preview', async () => {
  const state = updateDraft(createInitialCreationState(), { agentName: 'Nova' });
  const next = await createInviteKit(state, {
    now: new Date('2026-07-31T06:00:00.000Z'),
    randomId: () => 'readytoken01',
  });
  assert.equal(next.uiStatus, 'ready');
  assert.equal(next.error, null);
  assert.equal(next.seam, 'local_preview');
  assert.ok(next.invite);
  assert.equal(next.invite?.status, 'created');
  assert.equal(creationSummary(next.invite!), 'Nova · Worker · Created');
});

test('createInviteKit validation error path', async () => {
  const next = await createInviteKit(createInitialCreationState());
  assert.equal(next.uiStatus, 'error');
  assert.match(next.error ?? '', /required/i);
  assert.equal(next.invite, null);
  assert.equal(next.seam, 'unavailable');
});

test('createInviteKit forced error path (degraded)', async () => {
  const state = updateDraft(createInitialCreationState(), { agentName: 'Nova' });
  const next = await createInviteKit(state, { forceError: 'Simulated invite creation failure' });
  assert.equal(next.uiStatus, 'error');
  assert.equal(next.error, 'Simulated invite creation failure');
  assert.equal(next.invite, null);
});

test('createInviteKit uses durable probe when available', async () => {
  const state = updateDraft(createInitialCreationState(), { agentName: 'Durable' });
  const next = await createInviteKit(state, {
    probeDurableCreate: async (draft) => ({
      ...buildLocalPreviewInvite(draft, { randomId: () => 'dur01' }),
      id: 'durable-1',
      seam: 'agents_invites_api',
      persistence: 'local_preview_not_durable',
    }),
  });
  assert.equal(next.uiStatus, 'ready');
  assert.equal(next.seam, 'agents_invites_api');
  assert.equal(next.invite?.id, 'durable-1');
});

test('createInviteKit falls back to local_preview when durable probe returns null', async () => {
  const state = updateDraft(createInitialCreationState(), { agentName: 'Fallback' });
  const next = await createInviteKit(state, {
    randomId: () => 'fallback01',
    probeDurableCreate: async () => null,
  });
  assert.equal(next.uiStatus, 'ready');
  assert.equal(next.seam, 'local_preview');
  assert.equal(next.invite?.persistence, 'local_preview_not_durable');
});

test('resetCreation returns empty shell', () => {
  const reset = resetCreation({
    ...createInitialCreationState(),
    uiStatus: 'ready',
    draft: createEmptyDraft({ agentName: 'X' }),
  });
  assert.equal(reset.uiStatus, 'empty');
  assert.equal(reset.draft.agentName, '');
  assert.equal(reset.invite, null);
});

test('invite status + role labels cover product enum', () => {
  assert.equal(inviteStatusLabel('in_progress'), 'In progress');
  assert.equal(inviteStatusLabel('revoked'), 'Revoked');
  assert.equal(roleLabel('chief'), 'Chief / coordinator');
});
