import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUSINESS_ONBOARDING_PATH,
  ONBOARDING_PATH,
  classifyAppRoute,
  extractOnboardingToken,
  extractTaskRouteId,
} from './routeClassification.ts';

test('extractTaskRouteId recognizes /task/:id and /tasks/:id with positive integers', () => {
  assert.equal(extractTaskRouteId('/task/42'), 42);
  assert.equal(extractTaskRouteId('/tasks/42'), 42);
  assert.equal(extractTaskRouteId('/task/42/'), 42);
  assert.equal(extractTaskRouteId('/task/1'), 1);
  assert.equal(extractTaskRouteId('/tasks/999999'), 999999);
});

test('extractTaskRouteId rejects non-task or malformed paths', () => {
  assert.equal(extractTaskRouteId('/'), null);
  assert.equal(extractTaskRouteId('/tasks'), null);
  assert.equal(extractTaskRouteId('/task/abc'), null);
  assert.equal(extractTaskRouteId('/task/0'), null);
  assert.equal(extractTaskRouteId('/task/-5'), null);
  assert.equal(extractTaskRouteId('/task/'), null);
  assert.equal(extractTaskRouteId('/tasksabc/1'), null);
  assert.equal(extractTaskRouteId('/onboarding'), null);
  assert.equal(extractTaskRouteId(''), null);
});

test('extractOnboardingToken only matches /onboard/agent/:token exactly', () => {
  assert.equal(extractOnboardingToken('/onboard/agent/abc-123'), 'abc-123');
  assert.equal(extractOnboardingToken('/onboard/agent/definitely-nonexistent-token-qa-20260805'), 'definitely-nonexistent-token-qa-20260805');
  // Extra segments are not a valid onboarding token route.
  assert.equal(extractOnboardingToken('/onboard/agent/abc/extra'), null);
  assert.equal(extractOnboardingToken('/onboard/agent/'), null);
  assert.equal(extractOnboardingToken('/onboarding'), null);
  assert.equal(extractOnboardingToken('/onboarding/business'), null);
  assert.equal(extractOnboardingToken('/onboarding/random'), null);
});

test('classifyAppRoute marks known surfaces as supported', () => {
  assert.equal(classifyAppRoute('/'), 'workspace');
  assert.equal(classifyAppRoute('/showclaw/entity-featured'), 'showclaw-featured');
  assert.equal(classifyAppRoute('/workplane'), 'workplane');
  assert.equal(classifyAppRoute('/workplane/abc'), 'workplane');
  assert.equal(classifyAppRoute(ONBOARDING_PATH), 'onboarding');
  assert.equal(classifyAppRoute(BUSINESS_ONBOARDING_PATH), 'business-onboarding');
  assert.equal(classifyAppRoute('/onboard/agent/abc-123'), 'onboard-agent');
  assert.equal(classifyAppRoute('/task/42'), 'task-detail');
  assert.equal(classifyAppRoute('/tasks/42'), 'task-detail');
  assert.equal(classifyAppRoute('/task/999999'), 'task-detail');
  assert.equal(classifyAppRoute('/tasks'), 'tasks-board');
  assert.equal(classifyAppRoute('/docs'), 'docs');
  assert.equal(classifyAppRoute('/docs/workspace/readme.md'), 'docs');
  assert.equal(classifyAppRoute('/docs/source/src/main.ts'), 'docs');
  assert.equal(classifyAppRoute('/workspace/readme.md'), 'docs');
  assert.equal(classifyAppRoute('/output/report.json'), 'docs');
  assert.equal(classifyAppRoute('/memory/note.md'), 'docs');
  assert.equal(classifyAppRoute('/projects/plan.md'), 'docs');
});

test('classifyAppRoute marks the QA failure cases as supported (task) or not-found (onboarding)', () => {
  // The deep-link task route is supported; existence is resolved by the panel.
  assert.equal(classifyAppRoute('/task/999999'), 'task-detail');
  // The unsupported onboarding path from QA must be not-found, not workspace.
  assert.equal(classifyAppRoute('/onboarding/definitely-nonexistent-token-qa-20260805'), 'not-found');
});

test('classifyAppRoute marks unsupported onboarding/onboard variants as not-found', () => {
  assert.equal(classifyAppRoute('/onboarding/random'), 'not-found');
  assert.equal(classifyAppRoute('/onboarding/definitely-nonexistent-token-qa-20260805'), 'not-found');
  assert.equal(classifyAppRoute('/onboard/agent'), 'not-found');
  assert.equal(classifyAppRoute('/onboard/agent/'), 'not-found');
  assert.equal(classifyAppRoute('/onboard/something-else'), 'not-found');
  assert.equal(classifyAppRoute('/onboard/agent/abc/extra'), 'not-found');
});

test('classifyAppRoute marks arbitrary unsupported pathnames as not-found', () => {
  assert.equal(classifyAppRoute('/definitely-does-not-exist'), 'not-found');
  assert.equal(classifyAppRoute('/files'), 'not-found');
  assert.equal(classifyAppRoute('/random/deep/path'), 'not-found');
  assert.equal(classifyAppRoute('/task'), 'not-found');
  assert.equal(classifyAppRoute('/task/'), 'not-found');
  assert.equal(classifyAppRoute('/onboarding/'), 'not-found');
  assert.equal(classifyAppRoute('/tasks/'), 'not-found');
});

test('classifyAppRoute ignores ?tab= for unsupported pathnames', () => {
  // ?tab= does not rescue an unsupported pathname.
  assert.equal(classifyAppRoute('/onboarding/random', '?tab=tasks'), 'not-found');
  assert.equal(classifyAppRoute('/nope', '?tab=files'), 'not-found');
  // Root with any tab stays the workspace surface.
  assert.equal(classifyAppRoute('/', '?tab=tasks'), 'workspace');
});
