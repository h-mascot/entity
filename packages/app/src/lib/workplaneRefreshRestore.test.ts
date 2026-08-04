import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import {
  parseWorkplaneStateAfterRefresh,
  restoreWorkplaneAfterRefresh,
  shouldBypassGatesForWorkplaneDeepLink,
  simulateWorkplaneUrlRefresh,
} from './workplaneRefreshRestore.ts';
import { serializeWorkplaneUrlState, type WorkplaneUrlState } from './workplaneUrlState.ts';

test('shouldBypassGatesForWorkplaneDeepLink is true only for /workplane paths', () => {
  assert.equal(shouldBypassGatesForWorkplaneDeepLink('/workplane/12'), true);
  assert.equal(shouldBypassGatesForWorkplaneDeepLink('/workplane'), true);
  assert.equal(shouldBypassGatesForWorkplaneDeepLink('/workplane/abc'), true);
  assert.equal(shouldBypassGatesForWorkplaneDeepLink('/task/12'), false);
  assert.equal(shouldBypassGatesForWorkplaneDeepLink('/onboarding'), false);
  assert.equal(shouldBypassGatesForWorkplaneDeepLink('/'), false);
});

test('restoreWorkplaneAfterRefresh restores task id and non-default active panel', () => {
  const result = restoreWorkplaneAfterRefresh(
    '/workplane/42',
    '?panel=proof_bundle&proof=receipt:phase2&return=detail&returnTask=42&returnPath=/task/42',
  );

  assert.equal(result.isWorkplaneDeepLink, true);
  assert.equal(result.bypassWorkspaceGates, true);
  assert.equal(result.restored, true);
  assert.equal(result.model.status, 'ready');
  assert.equal(result.model.taskId, 42);
  assert.equal(result.model.activePanel, 'proof_bundle');
  assert.equal(result.model.selectedProof, 'receipt:phase2');
  assert.deepEqual(result.restoredState, {
    taskId: 42,
    activePanel: 'proof_bundle',
    selectedProof: 'receipt:phase2',
    returnContext: {
      surface: 'detail',
      taskId: 42,
      path: '/task/42',
    },
  });
});

test('restoreWorkplaneAfterRefresh defaults omitted panel without losing task context', () => {
  const result = restoreWorkplaneAfterRefresh('/workplane/7');
  assert.equal(result.restored, true);
  assert.equal(result.model.taskId, 7);
  assert.equal(result.model.activePanel, 'task_summary');
  assert.equal(result.model.selectedProof, null);
});

test('restoreWorkplaneAfterRefresh fail-closes invalid/missing task id', () => {
  for (const pathname of ['/workplane', '/workplane/', '/workplane/0', '/workplane/abc']) {
    const result = restoreWorkplaneAfterRefresh(pathname, '?panel=proof_bundle');
    assert.equal(result.isWorkplaneDeepLink, true, pathname);
    assert.equal(result.bypassWorkspaceGates, true, pathname);
    assert.equal(result.restored, false, pathname);
    assert.equal(result.restoredState, null, pathname);
    assert.equal(result.model.status, 'invalid_route', pathname);
    assert.match(result.model.invalidReason ?? '', /positive integer task id/);
  }

  const nonRoute = restoreWorkplaneAfterRefresh('/task/9', '?panel=proof_bundle');
  assert.equal(nonRoute.isWorkplaneDeepLink, false);
  assert.equal(nonRoute.bypassWorkspaceGates, false);
  assert.equal(nonRoute.restored, false);
});

test('simulateWorkplaneUrlRefresh round-trips every panel after serialize→reload', () => {
  const panels = [
    'task_summary',
    'proof_bundle',
    'files_docs',
    'activity_progress',
    'comments_review_checklist',
    'missing_proof_warnings',
  ] as const;

  for (const activePanel of panels) {
    const state: WorkplaneUrlState = {
      taskId: 99,
      activePanel,
      selectedProof: activePanel === 'proof_bundle' ? 'artifact_1' : null,
      returnContext: {
        surface: 'detail',
        taskId: 99,
        path: '/task/99',
      },
    };
    const afterRefresh = simulateWorkplaneUrlRefresh(state);
    assert.equal(afterRefresh.restored, true, activePanel);
    assert.deepEqual(afterRefresh.restoredState, state);
    assert.equal(afterRefresh.model.activePanel, activePanel);
    assert.equal(afterRefresh.model.taskId, 99);
  }
});

test('refresh restore does not depend on history.state (URL alone)', () => {
  const href = serializeWorkplaneUrlState({
    taskId: 22,
    activePanel: 'files_docs',
    selectedProof: 'doc-link-1',
    returnContext: {
      surface: 'board',
      board: 'engineering',
      path: '/tasks',
    },
  });
  const url = new URL(href, 'https://entity.local');
  // Cold load: only pathname/search exist; history.state is null after hard refresh.
  const parsed = parseWorkplaneStateAfterRefresh(url.pathname, url.search);
  const restored = restoreWorkplaneAfterRefresh(url.pathname, url.search);
  assert.ok(parsed);
  assert.equal(parsed.activePanel, 'files_docs');
  assert.equal(restored.restored, true);
  assert.equal(restored.model.activePanel, 'files_docs');
  assert.equal(restored.model.taskId, 22);
});

test('WorkplaneShell cold-load props restore active panel after refresh-shaped input', () => {
  const afterRefresh = simulateWorkplaneUrlRefresh({
    taskId: 55,
    activePanel: 'activity_progress',
    selectedProof: null,
    returnContext: null,
  });
  assert.equal(afterRefresh.restored, true);
  assert.ok(afterRefresh.model.serializedHref);

  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/55',
      search: '?panel=activity_progress',
    }),
  );

  assert.match(html, /data-workplane-status="ready"/);
  assert.match(html, /data-workplane-task-id="55"/);
  assert.match(html, /data-workplane-active-panel="activity_progress"/);
  assert.match(html, /data-workplane-restored-from-url="true"/);
  assert.match(html, /data-testid="workplane-panel-tab-activity_progress"/);
  assert.match(html, /aria-current="page"/);
});

test('WorkplaneShell invalid deep link after refresh stays degraded', () => {
  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, { pathname: '/workplane/not-a-task' }),
  );
  assert.match(html, /data-workplane-status="invalid_route"/);
  assert.match(html, /data-workplane-restored-from-url="false"/);
  assert.match(html, /data-testid="workplane-invalid"/);
  assert.match(html, /Workplane unavailable/);
});
