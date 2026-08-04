import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLocalPreviewInvite,
  createEmptyDraft,
} from './addAgentInviteCreation.ts';
import {
  absolutizeInviteUrl,
  buildInvitePrompt,
  buildInvitePromptText,
  buildInviteUrlBundle,
  copyInviteText,
  createInitialCopyState,
  extractInviteToken,
  textForCopyTarget,
  validateInviteUrlPaths,
} from './addAgentInvitePrompt.ts';

const ORIGIN = 'http://127.0.0.1:3054';

function sampleInvite() {
  return buildLocalPreviewInvite(
    createEmptyDraft({
      agentName: 'Scout',
      role: 'reviewer',
      projectId: 'engineering',
      selectedBundle: 'minimal',
      taskId: '42',
      workplaneId: 'wp-demo',
      permissionsScope: ['workspace_read', 'task_comment'],
    }),
    {
      now: new Date('2026-07-31T05:00:00.000Z'),
      randomId: () => 'tokprompt01',
    },
  );
}

test('absolutizeInviteUrl joins origin and relative path', () => {
  assert.equal(
    absolutizeInviteUrl('/onboard/agent/abc', ORIGIN),
    'http://127.0.0.1:3054/onboard/agent/abc',
  );
});

test('absolutizeInviteUrl keeps absolute URLs', () => {
  assert.equal(
    absolutizeInviteUrl('https://entity.example/onboard/agent/x', ORIGIN),
    'https://entity.example/onboard/agent/x',
  );
});

test('absolutizeInviteUrl empty input stays empty (no silent fake URL)', () => {
  assert.equal(absolutizeInviteUrl('', ORIGIN), '');
  assert.equal(absolutizeInviteUrl('   ', ORIGIN), '');
});

test('buildInviteUrlBundle shapes setup/manifest/bundle/skill/progress', () => {
  const invite = sampleInvite();
  const urls = buildInviteUrlBundle(invite, ORIGIN);
  assert.equal(urls.setup, 'http://127.0.0.1:3054/onboard/agent/tokprompt01');
  assert.equal(
    urls.manifest,
    'http://127.0.0.1:3054/api/onboarding/agent-session/tokprompt01/manifest',
  );
  assert.equal(
    urls.bundle,
    'http://127.0.0.1:3054/api/onboarding/agent-session/tokprompt01/bundle',
  );
  assert.equal(
    urls.skill,
    'http://127.0.0.1:3054/api/onboarding/agent-session/tokprompt01/skill',
  );
  assert.equal(
    urls.progress,
    'http://127.0.0.1:3054/api/onboarding/agent-session/tokprompt01/progress',
  );
});

test('extractInviteToken reads setup path token', () => {
  assert.equal(extractInviteToken(sampleInvite()), 'tokprompt01');
});

test('validateInviteUrlPaths fails closed on missing paths', () => {
  const invite = sampleInvite();
  const broken = { ...invite, skillPath: '', progressPath: '   ' };
  const result = validateInviteUrlPaths(broken);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.missing, ['skill', 'progress']);
    assert.match(result.error, /incomplete/i);
  }
});

test('prompt golden fixture matches invite-kit required sections', () => {
  const invite = sampleInvite();
  const prompt = buildInvitePromptText({
    invite,
    origin: ORIGIN,
    workspaceName: 'Crew Home',
    chiefRouting: 'disabled',
    roleDisplay: 'Reviewer',
  });

  assert.match(prompt, /^You are being invited to join Entity as Scout\/reviewer\./m);
  assert.match(prompt, /Setup URL: http:\/\/127\.0\.0\.1:3054\/onboard\/agent\/tokprompt01/);
  assert.match(prompt, /Manifest URL: .*\/manifest/);
  assert.match(prompt, /Bundle URL: .*\/bundle/);
  assert.match(prompt, /Skill\/Context URL: .*\/skill/);
  assert.match(prompt, /Progress URL: .*\/progress/);
  assert.match(prompt, /Expires: 2026-07-31T05:30:00\.000Z/);
  assert.match(prompt, /Work domain\/project: engineering/);
  assert.match(prompt, /Workplane\/task: wp-demo \/ task 42/);
  assert.match(prompt, /Role: Reviewer/);
  assert.match(prompt, /Chief routing: disabled/);
  assert.match(prompt, /entity-agent-contracts/);
  assert.match(prompt, /entity-mc/);
  assert.match(prompt, /workspace_read/);
  assert.match(prompt, /Open setup URL or fetch manifest/);
  assert.match(prompt, /Treat manifest as source of truth/);
  assert.match(prompt, /Invite status: created/);
  assert.match(prompt, /Creation source: agents_invite/);
  assert.match(prompt, /Persistence: local_preview_not_durable/);
});

test('buildInvitePrompt success includes local_preview warning', () => {
  const result = buildInvitePrompt({ invite: sampleInvite(), origin: ORIGIN });
  assert.equal(result.ok, true);
  assert.equal(result.degraded, false);
  assert.ok(result.warnings.some((w) => /not durable/i.test(w)));
  assert.match(result.prompt, /Setup URL:/);
});

test('buildInvitePrompt degraded when URL bundle incomplete', () => {
  const invite = { ...sampleInvite(), manifestPath: '' };
  const result = buildInvitePrompt({ invite, origin: ORIGIN });
  assert.equal(result.ok, false);
  assert.equal(result.degraded, true);
  if (!result.ok) {
    assert.match(result.error, /missing: manifest/i);
  }
  assert.match(result.prompt, /unavailable/i);
  assert.equal(result.urls.manifest, '');
});

test('copyInviteText success path records lastCopied', async () => {
  const writes: string[] = [];
  const state = await copyInviteText('hello kit', 'prompt', async (text) => {
    writes.push(text);
  });
  assert.deepEqual(writes, ['hello kit']);
  assert.equal(state.lastCopied, 'prompt');
  assert.equal(state.error, null);
});

test('copyInviteText empty text is explicit error (no silent success)', async () => {
  const state = await copyInviteText('   ', 'setup', async () => {
    throw new Error('should not write');
  });
  assert.equal(state.lastCopied, null);
  assert.match(state.error ?? '', /Nothing to copy/);
});

test('copyInviteText clipboard failure surfaces error', async () => {
  const state = await copyInviteText('payload', 'bundle', async () => {
    throw new Error('Clipboard API unavailable.');
  });
  assert.equal(state.lastCopied, null);
  assert.match(state.error ?? '', /Clipboard API unavailable/);
});

test('textForCopyTarget selects prompt vs individual URL', () => {
  const build = buildInvitePrompt({ invite: sampleInvite(), origin: ORIGIN });
  assert.ok(build.ok);
  assert.equal(textForCopyTarget(build, 'prompt'), build.prompt);
  assert.equal(textForCopyTarget(build, 'setup'), build.urls.setup);
  assert.equal(createInitialCopyState().lastCopied, null);
});
