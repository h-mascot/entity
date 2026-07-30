import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKPLANE_PANEL_SEAM_MAP,
  type WorkplanePanelId,
} from '../components/mission-control/taskDetailWorkplaneSeams.ts';
import {
  DEFAULT_WORKPLANE_PANEL,
  WORKPLANE_PANEL_IDS,
  WORKPLANE_PATH_PREFIX,
  WORKPLANE_RETURN_SURFACES,
  WORKPLANE_URL_QUERY_KEYS,
  buildWorkplanePath,
  createDefaultWorkplaneUrlState,
  extractWorkplaneTaskId,
  isWorkplanePanelId,
  normalizeWorkplaneUrlState,
  parseWorkplaneUrlState,
  roundTripWorkplaneUrlState,
  serializeWorkplaneUrlState,
  type WorkplaneUrlState,
} from './workplaneUrlState.ts';

test('panel ids align with THE-856 WORKPLANE_PANEL_SEAM_MAP', () => {
  assert.deepEqual([...WORKPLANE_PANEL_IDS].sort(), Object.keys(WORKPLANE_PANEL_SEAM_MAP).sort());
  assert.equal(isWorkplanePanelId(DEFAULT_WORKPLANE_PANEL), true);
  assert.equal(isWorkplanePanelId('not_a_panel'), false);
  assert.equal(DEFAULT_WORKPLANE_PANEL, 'task_summary');
});

test('createDefaultWorkplaneUrlState sets defaults and rejects invalid task ids', () => {
  assert.deepEqual(createDefaultWorkplaneUrlState(42), {
    taskId: 42,
    activePanel: 'task_summary',
    selectedProof: null,
    returnContext: null,
  });
  assert.throws(() => createDefaultWorkplaneUrlState(0), /positive integer/);
  assert.throws(() => createDefaultWorkplaneUrlState(-1), /positive integer/);
  assert.throws(() => createDefaultWorkplaneUrlState(1.5), /positive integer/);
});

test('extractWorkplaneTaskId parses /workplane/:id and rejects invalid paths', () => {
  assert.equal(extractWorkplaneTaskId('/workplane/7'), 7);
  assert.equal(extractWorkplaneTaskId('/workplane/7/'), 7);
  assert.equal(extractWorkplaneTaskId('/workplane/0'), null);
  assert.equal(extractWorkplaneTaskId('/workplane/-3'), null);
  assert.equal(extractWorkplaneTaskId('/workplane/abc'), null);
  assert.equal(extractWorkplaneTaskId('/task/7'), null);
  assert.equal(extractWorkplaneTaskId('/workplanes/7'), null);
  assert.equal(extractWorkplaneTaskId('/workplane/7/extra'), null);
  assert.equal(buildWorkplanePath(9), `${WORKPLANE_PATH_PREFIX}/9`);
});

test('parse applies defaults for omitted optional fields', () => {
  assert.deepEqual(parseWorkplaneUrlState('/workplane/12'), {
    taskId: 12,
    activePanel: DEFAULT_WORKPLANE_PANEL,
    selectedProof: null,
    returnContext: null,
  });
  assert.deepEqual(parseWorkplaneUrlState('/workplane/12', ''), {
    taskId: 12,
    activePanel: DEFAULT_WORKPLANE_PANEL,
    selectedProof: null,
    returnContext: null,
  });
});

test('parse/serialize cover every Q33 active panel', () => {
  for (const panel of WORKPLANE_PANEL_IDS) {
    const state: WorkplaneUrlState = {
      taskId: 3,
      activePanel: panel,
      selectedProof: null,
      returnContext: null,
    };
    const serialized = serializeWorkplaneUrlState(state);
    const url = new URL(serialized, 'https://entity.local');
    assert.equal(url.pathname, '/workplane/3');
    if (panel === DEFAULT_WORKPLANE_PANEL) {
      assert.equal(url.searchParams.has(WORKPLANE_URL_QUERY_KEYS.panel), false);
    } else {
      assert.equal(url.searchParams.get(WORKPLANE_URL_QUERY_KEYS.panel), panel);
    }
    assert.deepEqual(parseWorkplaneUrlState(url.pathname, url.search), state);
  }
});

test('selected proof round-trips and invalid proof tokens are dropped', () => {
  const withProof = parseWorkplaneUrlState(
    '/workplane/5',
    '?panel=proof_bundle&proof=receipt:phase2_abc',
  );
  assert.deepEqual(withProof, {
    taskId: 5,
    activePanel: 'proof_bundle',
    selectedProof: 'receipt:phase2_abc',
    returnContext: null,
  });

  assert.equal(
    parseWorkplaneUrlState('/workplane/5', '?proof=../secret')?.selectedProof,
    null,
  );
  assert.equal(
    parseWorkplaneUrlState('/workplane/5', '?proof=https://evil.example/x')?.selectedProof,
    null,
  );
  assert.equal(
    parseWorkplaneUrlState('/workplane/5', '?proof=has space')?.selectedProof,
    null,
  );
  assert.equal(
    parseWorkplaneUrlState('/workplane/5', '?proof=')?.selectedProof,
    null,
  );
});

test('return context round-trips for board/detail/tasks surfaces', () => {
  for (const surface of WORKPLANE_RETURN_SURFACES) {
    const state: WorkplaneUrlState = {
      taskId: 8,
      activePanel: 'files_docs',
      selectedProof: 'doc:native-1',
      returnContext: {
        surface,
        board: surface === 'board' ? 'engineering' : undefined,
        taskId: surface === 'detail' ? 8 : undefined,
        path: surface === 'detail' ? '/task/8' : surface === 'tasks' ? '/tasks' : '/tasks',
      },
    };
    const restored = roundTripWorkplaneUrlState(state);
    assert.deepEqual(restored, normalizeWorkplaneUrlState(state));
  }
});

test('return context rejects open redirects and unknown surfaces', () => {
  assert.equal(
    parseWorkplaneUrlState('/workplane/1', '?return=board&returnPath=https://evil.example')
      ?.returnContext?.path,
    undefined,
  );
  assert.equal(
    parseWorkplaneUrlState('/workplane/1', '?return=board&returnPath=//evil.example')
      ?.returnContext?.path,
    undefined,
  );
  assert.equal(
    parseWorkplaneUrlState('/workplane/1', '?return=board&returnPath=/admin/secrets')
      ?.returnContext?.path,
    undefined,
  );
  assert.equal(
    parseWorkplaneUrlState('/workplane/1', '?return=elsewhere')?.returnContext,
    null,
  );
  assert.equal(
    parseWorkplaneUrlState('/workplane/1', '?returnBoard=engineering')?.returnContext,
    null,
  );
});

test('invalid active panel falls back to default without losing task id', () => {
  assert.deepEqual(parseWorkplaneUrlState('/workplane/99', '?panel=unknown_panel&proof=ok-proof'), {
    taskId: 99,
    activePanel: DEFAULT_WORKPLANE_PANEL,
    selectedProof: 'ok-proof',
    returnContext: null,
  });
});

test('non-workplane paths and invalid task ids return null', () => {
  assert.equal(parseWorkplaneUrlState('/task/12', '?panel=proof_bundle'), null);
  assert.equal(parseWorkplaneUrlState('/docs/source/workspace/x.md'), null);
  assert.equal(parseWorkplaneUrlState('/workplane/0'), null);
  assert.equal(parseWorkplaneUrlState('/workplane/'), null);
  assert.equal(parseWorkplaneUrlState('/'), null);
});

test('serialize omits defaults and unrecognized/sensitive fields', () => {
  const serialized = serializeWorkplaneUrlState({
    taskId: 4,
    activePanel: 'task_summary',
    selectedProof: null,
    returnContext: null,
  });
  assert.equal(serialized, '/workplane/4');

  const rich = serializeWorkplaneUrlState({
    taskId: 4,
    activePanel: 'comments_review_checklist',
    selectedProof: 'evidence_1',
    returnContext: {
      surface: 'detail',
      taskId: 4,
      path: '/task/4',
      board: 'ops',
    },
  });
  const url = new URL(rich, 'https://entity.local');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    panel: 'comments_review_checklist',
    proof: 'evidence_1',
    return: 'detail',
    returnBoard: 'ops',
    returnTask: '4',
    returnPath: '/task/4',
  });
  assert.equal(rich.includes('token'), false);
  assert.equal(rich.includes('secret'), false);
});

test('normalize drops invalid optional values instead of inventing healthy state', () => {
  const normalized = normalizeWorkplaneUrlState({
    taskId: 2,
    activePanel: 'bogus' as WorkplanePanelId,
    selectedProof: 'bad proof',
    returnContext: {
      surface: 'board',
      board: '../x',
      taskId: -9,
      path: '/etc/passwd',
    },
  });
  assert.deepEqual(normalized, {
    taskId: 2,
    activePanel: DEFAULT_WORKPLANE_PANEL,
    selectedProof: null,
    returnContext: { surface: 'board' },
  });
});

test('full round-trip preserves task id, panel, proof, and return context', () => {
  const state: WorkplaneUrlState = {
    taskId: 77,
    activePanel: 'missing_proof_warnings',
    selectedProof: 'artifact_42',
    returnContext: {
      surface: 'board',
      board: 'entity-engineering',
      path: '/tasks',
    },
  };
  assert.deepEqual(roundTripWorkplaneUrlState(state), state);
  assert.deepEqual(
    parseWorkplaneUrlState('/workplane/77', 'panel=activity_progress&proof=p1&return=tasks&returnPath=/tasks'),
    {
      taskId: 77,
      activePanel: 'activity_progress',
      selectedProof: 'p1',
      returnContext: { surface: 'tasks', path: '/tasks' },
    },
  );
});
