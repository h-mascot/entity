import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import {
  WORKPLANE_PANEL_IDS,
  parseWorkplaneUrlState,
  serializeWorkplaneUrlState,
} from './workplaneUrlState.ts';
import {
  buildWorkplanePanelHref,
  buildWorkplaneProofHref,
  isWorkplaneRoutePath,
  resolveWorkplaneShellModel,
} from './workplaneShellModel.ts';

test('isWorkplaneRoutePath detects /workplane prefix including invalid ids', () => {
  assert.equal(isWorkplaneRoutePath('/workplane'), true);
  assert.equal(isWorkplaneRoutePath('/workplane/'), true);
  assert.equal(isWorkplaneRoutePath('/workplane/12'), true);
  assert.equal(isWorkplaneRoutePath('/workplane/abc'), true);
  assert.equal(isWorkplaneRoutePath('/task/12'), false);
  assert.equal(isWorkplaneRoutePath('/workplanes/12'), false);
  assert.equal(isWorkplaneRoutePath('/'), false);
});

test('resolveWorkplaneShellModel restores ready state from URL', () => {
  const model = resolveWorkplaneShellModel(
    '/workplane/42',
    '?panel=proof_bundle&proof=receipt:phase2&return=detail&returnTask=42&returnPath=/task/42',
  );

  assert.equal(model.status, 'ready');
  assert.equal(model.isWorkplaneRoute, true);
  assert.equal(model.taskId, 42);
  assert.equal(model.activePanel, 'proof_bundle');
  assert.equal(model.selectedProof, 'receipt:phase2');
  assert.equal(model.returnContext.present, true);
  assert.equal(model.returnContext.surface, 'detail');
  assert.equal(model.returnContext.taskId, 42);
  assert.equal(model.returnContext.path, '/task/42');
  assert.equal(model.returnContext.href, '/task/42');
  assert.match(model.returnContext.label, /task detail/i);
  assert.equal(model.invalidReason, null);
  assert.equal(
    model.serializedHref,
    serializeWorkplaneUrlState({
      taskId: 42,
      activePanel: 'proof_bundle',
      selectedProof: 'receipt:phase2',
      returnContext: {
        surface: 'detail',
        taskId: 42,
        path: '/task/42',
      },
    }),
  );
  assert.equal(model.panels.length, WORKPLANE_PANEL_IDS.length);
  assert.ok(model.panels.every((panel) => panel.status === 'placeholder'));
});

test('resolveWorkplaneShellModel applies defaults for omitted/invalid optionals', () => {
  const omitted = resolveWorkplaneShellModel('/workplane/7');
  assert.equal(omitted.status, 'ready');
  assert.equal(omitted.activePanel, 'task_summary');
  assert.equal(omitted.selectedProof, null);
  assert.equal(omitted.returnContext.present, false);
  assert.equal(omitted.serializedHref, '/workplane/7');

  const invalidOptional = resolveWorkplaneShellModel(
    '/workplane/7',
    '?panel=not_a_panel&proof=../evil&return=elsewhere&returnPath=https://evil.example',
  );
  assert.equal(invalidOptional.status, 'ready');
  assert.equal(invalidOptional.activePanel, 'task_summary');
  assert.equal(invalidOptional.selectedProof, null);
  assert.equal(invalidOptional.returnContext.present, false);
  assert.deepEqual(invalidOptional.state, parseWorkplaneUrlState('/workplane/7', '?panel=not_a_panel'));
});

test('resolveWorkplaneShellModel fail-closes invalid workplane routes', () => {
  for (const pathname of ['/workplane', '/workplane/', '/workplane/0', '/workplane/abc', '/workplane/-1']) {
    const model = resolveWorkplaneShellModel(pathname);
    assert.equal(model.status, 'invalid_route', pathname);
    assert.equal(model.isWorkplaneRoute, true, pathname);
    assert.equal(model.state, null, pathname);
    assert.equal(model.serializedHref, null, pathname);
    assert.match(model.invalidReason ?? '', /positive integer task id/);
  }

  const nonRoute = resolveWorkplaneShellModel('/task/9');
  assert.equal(nonRoute.status, 'invalid_route');
  assert.equal(nonRoute.isWorkplaneRoute, false);
  assert.match(nonRoute.invalidReason ?? '', /Not a Workplane route/);
});

test('return context presence and href wiring for board/tasks surfaces', () => {
  const board = resolveWorkplaneShellModel(
    '/workplane/3',
    '?return=board&returnBoard=entity-engineering&returnPath=/tasks',
  );
  assert.equal(board.returnContext.present, true);
  assert.equal(board.returnContext.surface, 'board');
  assert.equal(board.returnContext.board, 'entity-engineering');
  assert.equal(board.returnContext.boardTab, 'engineering');
  assert.equal(board.returnContext.href, '/?tab=tasks');
  assert.match(board.returnContext.label, /board/i);

  const tasks = resolveWorkplaneShellModel('/workplane/3', '?return=tasks');
  assert.equal(tasks.returnContext.present, true);
  assert.equal(tasks.returnContext.href, '/?tab=tasks');
});

test('ready shell always exposes fallback return href when return context absent', () => {
  const omitted = resolveWorkplaneShellModel('/workplane/7');
  assert.equal(omitted.returnContext.present, false);
  assert.equal(omitted.returnContext.href, '/task/7');
  assert.match(omitted.returnContext.label, /task detail/i);
});

test('panel/proof href builders serialize via THE-857 contract', () => {
  const state = parseWorkplaneUrlState(
    '/workplane/11',
    '?return=detail&returnTask=11&returnPath=/task/11',
  );
  assert.ok(state);
  assert.equal(
    buildWorkplanePanelHref(state, 'activity_progress'),
    '/workplane/11?panel=activity_progress&return=detail&returnTask=11&returnPath=%2Ftask%2F11',
  );
  assert.equal(
    buildWorkplaneProofHref(state, 'artifact_1'),
    '/workplane/11?proof=artifact_1&return=detail&returnTask=11&returnPath=%2Ftask%2F11',
  );
  assert.equal(
    buildWorkplaneProofHref({ ...state, selectedProof: 'artifact_1' }, null),
    '/workplane/11?return=detail&returnTask=11&returnPath=%2Ftask%2F11',
  );
});

test('WorkplaneShell renders ready route with restored URL state', () => {
  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/42',
      search:
        '?panel=files_docs&proof=doc-link-1&return=detail&returnTask=42&returnPath=/task/42',
    }),
  );

  assert.match(html, /data-testid="workplane-shell"/);
  assert.match(html, /data-workplane-status="ready"/);
  assert.match(html, /data-workplane-task-id="42"/);
  assert.match(html, /data-workplane-active-panel="files_docs"/);
  assert.match(html, /data-workplane-selected-proof="doc-link-1"/);
  assert.match(html, /data-workplane-return-present="true"/);
  assert.match(html, /data-testid="workplane-selected-proof"/);
  assert.match(html, /data-testid="workplane-return"/);
  assert.match(html, /data-return-surface="detail"/);
  assert.match(html, /data-return-href="\/task\/42"/);
  assert.match(html, /Return to task detail/);
  assert.match(html, /data-testid="workplane-panel-tab-files_docs"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /data-testid="workplane-files-docs"/);
  assert.doesNotMatch(html, /Placeholder — full panel ships/);
});

test('WorkplaneShell renders invalid/default degraded states with return action', () => {
  const invalid = renderToStaticMarkup(
    createElement(WorkplaneShell, { pathname: '/workplane/abc' }),
  );
  assert.match(invalid, /data-workplane-status="invalid_route"/);
  assert.match(invalid, /data-testid="workplane-invalid"/);
  assert.match(invalid, /Workplane unavailable/);
  assert.match(invalid, /data-testid="workplane-return"/);

  const defaults = renderToStaticMarkup(
    createElement(WorkplaneShell, { pathname: '/workplane/5' }),
  );
  assert.match(defaults, /data-workplane-status="ready"/);
  assert.match(defaults, /data-workplane-active-panel="task_summary"/);
  assert.match(defaults, /data-testid="workplane-selected-proof-empty"/);
  assert.match(defaults, /data-workplane-return-present="false"/);
  // THE-860: always expose return control (fallback to task detail).
  assert.match(defaults, /data-testid="workplane-return"/);
  assert.match(defaults, /data-return-href="\/task\/5"/);
  assert.match(defaults, /Return to task detail/);
});

test('WorkplaneShell panel click serializes URL via onNavigate', () => {
  const navigations: Array<{ href: string; replace?: boolean }> = [];
  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/9',
      search: '?return=tasks&returnPath=/tasks',
      onNavigate: (href, options) => {
        navigations.push({ href, replace: options?.replace });
      },
    }),
  );

  // Static markup cannot fire clicks; assert tabs + serialized href wiring exist for integration.
  assert.match(html, /data-testid="workplane-panel-tab-proof_bundle"/);
  assert.match(html, /data-workplane-href="\/workplane\/9\?return=tasks&amp;returnPath=%2Ftasks"/);
  assert.equal(navigations.length, 0);

  const state = parseWorkplaneUrlState('/workplane/9', '?return=tasks&returnPath=/tasks');
  assert.ok(state);
  assert.equal(
    buildWorkplanePanelHref(state, 'proof_bundle'),
    '/workplane/9?panel=proof_bundle&return=tasks&returnPath=%2Ftasks',
  );
});
