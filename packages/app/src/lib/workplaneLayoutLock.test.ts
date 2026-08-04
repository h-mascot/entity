import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';
import { WORKPLANE_PANEL_IDS, parseWorkplaneUrlState } from './workplaneUrlState.ts';
import { buildWorkplanePanelHref, resolveWorkplaneShellModel } from './workplaneShellModel.ts';
import {
  WORKPLANE_LAYOUT_VERSION,
  applyWorkplaneLayoutMutation,
  extractAgentLayoutMutationAttempts,
  formatWorkplanePanelOrder,
  getCanonicalWorkplaneLayout,
  isCanonicalWorkplanePanelOrder,
  resolveLockedWorkplaneLayout,
  selectWorkplanePanelAsHuman,
} from './workplaneLayoutLock.ts';

test('canonical Workplane v1 layout is locked to Q33 panel order', () => {
  const layout = getCanonicalWorkplaneLayout();
  assert.equal(layout.version, WORKPLANE_LAYOUT_VERSION);
  assert.equal(layout.locked, true);
  assert.equal(layout.humanOwnsLayout, true);
  assert.equal(layout.agentsMayMutateLayout, false);
  assert.deepEqual([...layout.panelIds], [...WORKPLANE_PANEL_IDS]);
  assert.equal(
    formatWorkplanePanelOrder(),
    'task_summary,proof_bundle,files_docs,activity_progress,comments_review_checklist,missing_proof_warnings',
  );
  assert.equal(isCanonicalWorkplanePanelOrder(layout.panelIds), true);
  assert.equal(isCanonicalWorkplanePanelOrder(['proof_bundle', 'task_summary']), false);
});

test('human can select a canonical active panel (navigation)', () => {
  const result = selectWorkplanePanelAsHuman('task_summary', 'proof_bundle');
  assert.equal(result.accepted, true);
  assert.equal(result.activePanel, 'proof_bundle');
  assert.equal(result.layout.locked, true);
  assert.deepEqual([...result.layout.panelIds], [...WORKPLANE_PANEL_IDS]);
  assert.equal(result.rejectionCode, null);
});

test('human structural layout mutations are rejected; layout stays canonical', () => {
  const reorder = applyWorkplaneLayoutMutation('task_summary', {
    actor: 'human',
    kind: 'reorder_panels',
    panelIds: ['proof_bundle', 'task_summary', 'files_docs'],
  });
  assert.equal(reorder.accepted, false);
  assert.equal(reorder.rejectionCode, 'structural_layout_mutation_forbidden');
  assert.equal(reorder.activePanel, 'task_summary');
  assert.equal(isCanonicalWorkplanePanelOrder(reorder.layout.panelIds), true);

  const hide = applyWorkplaneLayoutMutation('proof_bundle', {
    actor: 'human',
    kind: 'hide_panel',
    panelId: 'missing_proof_warnings',
  });
  assert.equal(hide.accepted, false);
  assert.equal(hide.rejectionCode, 'structural_layout_mutation_forbidden');
  assert.equal(hide.activePanel, 'proof_bundle');

  const custom = applyWorkplaneLayoutMutation('task_summary', {
    actor: 'human',
    kind: 'add_custom_panel',
    customPanel: { id: 'agent_widget', label: 'Agent Widget' },
  });
  assert.equal(custom.accepted, false);
  assert.equal(custom.rejectionCode, 'custom_panel_forbidden');
});

test('NEGATIVE: agent reorder/hide/custom/active-panel mutations fail closed', () => {
  const cases = [
    {
      kind: 'reorder_panels' as const,
      panelIds: ['files_docs', 'task_summary', 'proof_bundle'],
    },
    {
      kind: 'hide_panel' as const,
      panelId: 'proof_bundle',
    },
    {
      kind: 'add_custom_panel' as const,
      customPanel: { id: 'plugin_sandbox', label: 'Sandbox' },
    },
    {
      kind: 'set_active_panel' as const,
      activePanel: 'files_docs',
      panelId: 'files_docs',
    },
    {
      kind: 'replace_layout' as const,
      panelIds: ['custom_only'],
    },
    {
      kind: 'override_panel_state' as const,
      panelId: 'task_summary',
    },
  ];

  for (const attempt of cases) {
    const result = applyWorkplaneLayoutMutation('task_summary', {
      actor: 'agent',
      ...attempt,
      source: 'negative_path_test',
    });
    assert.equal(result.accepted, false, attempt.kind);
    assert.equal(result.rejectionCode, 'agent_layout_mutation_forbidden', attempt.kind);
    assert.equal(result.activePanel, 'task_summary', attempt.kind);
    assert.equal(result.layout.locked, true, attempt.kind);
    assert.equal(isCanonicalWorkplanePanelOrder(result.layout.panelIds), true, attempt.kind);
    assert.match(result.reason, /Agent layout mutation rejected/);
  }
});

test('NEGATIVE: unknown actor mutations fail closed', () => {
  const result = applyWorkplaneLayoutMutation('files_docs', {
    actor: 'unknown',
    kind: 'set_active_panel',
    activePanel: 'proof_bundle',
  });
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionCode, 'unknown_actor_forbidden');
  assert.equal(result.activePanel, 'files_docs');
});

test('agent payload layout smuggling is extracted and rejected without changing layout', () => {
  const payload = {
    workplane_layout: {
      panel_order: ['proof_bundle', 'task_summary', 'files_docs'],
      hidden_panels: ['missing_proof_warnings'],
      custom_panels: [{ id: 'agent_chart' }],
      active_panel: 'activity_progress',
    },
  };

  const extracted = extractAgentLayoutMutationAttempts(payload);
  assert.ok(extracted.length >= 3);
  assert.ok(extracted.every((attempt) => attempt.actor === 'agent'));

  const resolved = resolveLockedWorkplaneLayout({
    activePanel: 'task_summary',
    agentPayload: payload,
  });

  assert.equal(resolved.layoutIntact, true);
  assert.equal(resolved.activePanel, 'task_summary');
  assert.equal(isCanonicalWorkplanePanelOrder(resolved.layout.panelIds), true);
  assert.ok(resolved.rejectedAttempts.length >= 3);
  assert.ok(
    resolved.rejectedAttempts.every(
      (rejected) => rejected.rejectionCode === 'agent_layout_mutation_forbidden',
    ),
  );
});

test('resolveLockedWorkplaneLayout preserves human active panel across rejected agent attempts', () => {
  const resolved = resolveLockedWorkplaneLayout({
    activePanel: 'files_docs',
    attempts: [
      {
        actor: 'agent',
        kind: 'set_active_panel',
        activePanel: 'proof_bundle',
      },
      {
        actor: 'agent',
        kind: 'reorder_panels',
        panelIds: ['activity_progress', 'task_summary'],
      },
      {
        actor: 'human',
        kind: 'set_active_panel',
        activePanel: 'missing_proof_warnings',
      },
    ],
  });

  assert.equal(resolved.activePanel, 'missing_proof_warnings');
  assert.equal(resolved.rejectedAttempts.length, 2);
  assert.equal(formatWorkplanePanelOrder(resolved.layout.panelIds), formatWorkplanePanelOrder());
});

test('shell model panel list matches locked canonical order', () => {
  const model = resolveWorkplaneShellModel('/workplane/12', '?panel=proof_bundle');
  assert.equal(model.status, 'ready');
  assert.equal(model.layoutLocked, true);
  assert.equal(model.layoutVersion, WORKPLANE_LAYOUT_VERSION);
  assert.equal(model.layoutOwner, 'human');
  assert.equal(model.panelOrder, formatWorkplanePanelOrder());
  assert.deepEqual(
    model.panels.map((panel) => panel.id),
    [...WORKPLANE_PANEL_IDS],
  );
});

test('human panel href builder still works under layout lock', () => {
  const state = parseWorkplaneUrlState('/workplane/9', '?return=tasks');
  assert.ok(state);
  const href = buildWorkplanePanelHref(state, 'proof_bundle');
  assert.equal(href, '/workplane/9?panel=proof_bundle&return=tasks');

  const nav = selectWorkplanePanelAsHuman(state.activePanel, 'proof_bundle');
  assert.equal(nav.accepted, true);
  assert.equal(nav.activePanel, 'proof_bundle');
});

test('WorkplaneShell exposes layout-lock DOM contract and canonical tabs', () => {
  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/42',
      search: '?panel=files_docs',
      agentLayoutPayload: {
        panel_order: ['custom_panel', 'task_summary'],
        active_panel: 'proof_bundle',
        custom_panels: [{ id: 'evil_widget' }],
        hidden_panels: ['files_docs'],
      },
    }),
  );

  assert.match(html, /data-workplane-layout-locked="true"/);
  assert.match(html, /data-workplane-layout-version="v1"/);
  assert.match(html, /data-workplane-layout-owner="human"/);
  assert.match(
    html,
    /data-workplane-panel-order="task_summary,proof_bundle,files_docs,activity_progress,comments_review_checklist,missing_proof_warnings"/,
  );
  assert.match(html, /data-workplane-layout-intact="true"/);
  assert.match(html, /data-workplane-agent-layout-rejected="true"/);
  // Human URL panel preserved — agent active_panel override ignored.
  assert.match(html, /data-workplane-active-panel="files_docs"/);
  // Canonical tabs still present (not reordered/hidden).
  assert.match(html, /data-testid="workplane-panel-tab-task_summary"/);
  assert.match(html, /data-testid="workplane-panel-tab-proof_bundle"/);
  assert.match(html, /data-testid="workplane-panel-tab-files_docs"/);
  assert.match(html, /data-testid="workplane-panel-tab-missing_proof_warnings"/);
  assert.doesNotMatch(html, /evil_widget|custom_panel/);
});

test('invalid human panel id is rejected; active panel unchanged', () => {
  const result = selectWorkplanePanelAsHuman('task_summary', 'not_a_panel');
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionCode, 'invalid_panel_id');
  assert.equal(result.activePanel, 'task_summary');
});
