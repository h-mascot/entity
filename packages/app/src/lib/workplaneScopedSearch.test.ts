import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { isPermittedWorkplaneScopedRoute } from './workplaneScopedSearch.ts';
import WorkplaneShell from '../components/workplane/WorkplaneShell.tsx';

test('isPermittedWorkplaneScopedRoute accepts only Workplane task routes', () => {
  // Permitted Workplane task routes — the only deep links the Workplane surface may dispatch.
  assert.equal(isPermittedWorkplaneScopedRoute('/workplane/123'), true);
  assert.equal(isPermittedWorkplaneScopedRoute('/workplane/123?panel=proof'), true);
  assert.equal(isPermittedWorkplaneScopedRoute('/workplane/123#evidence'), true);
  assert.equal(isPermittedWorkplaneScopedRoute('/workplane/42/'), true);

  // Fail-closed: document/external API routes must NOT route into Workplane.
  assert.equal(isPermittedWorkplaneScopedRoute('/api/document-objects/native-documents/x'), false);
  assert.equal(isPermittedWorkplaneScopedRoute('/docs/source/workspace/plans/renewal.md'), false);
  assert.equal(isPermittedWorkplaneScopedRoute('/api/search/scoped?q=x'), false);

  // Fail-closed: absolute / foreign / script URLs are rejected.
  assert.equal(isPermittedWorkplaneScopedRoute('https://evil.example/workplane/1'), false);
  assert.equal(isPermittedWorkplaneScopedRoute('http://evil.example/x'), false);
  assert.equal(isPermittedWorkplaneScopedRoute('javascript:alert(1)'), false);

  // Fail-closed: malformed / non-task workplane paths.
  assert.equal(isPermittedWorkplaneScopedRoute('/workplane/'), false);
  assert.equal(isPermittedWorkplaneScopedRoute('/workplane/abc'), false);
  assert.equal(isPermittedWorkplaneScopedRoute('/workplane'), false);
  assert.equal(isPermittedWorkplaneScopedRoute(''), false);

  // Fail-closed: non-string input.
  assert.equal(isPermittedWorkplaneScopedRoute(undefined), false);
  assert.equal(isPermittedWorkplaneScopedRoute(null), false);
  assert.equal(isPermittedWorkplaneScopedRoute(123), false);
});

test('WorkplaneShell renders the scoped-search entry and accepts a non-default org scope', () => {
  // SRCH-A-05 MEDIUM finding: Workplane must (a) expose the scoped-search entry and
  // (b) accept a non-default orgId without crashing. The lazy panel renders its
  // Suspense fallback under SSR; the entry button + slot wiring are what we assert here.
  const html = renderToStaticMarkup(
    createElement(WorkplaneShell, {
      pathname: '/workplane/865',
      search: '',
      apiBase: '',
      orgId: 'org-solstice',
    }),
  );
  assert.ok(html.includes('data-testid="workplane-scoped-search-entry"'), 'scoped-search entry button present');
  // Non-default org scope is accepted by the shell contract (no throw, entry rendered).
  assert.ok(html.length > 0);
});
