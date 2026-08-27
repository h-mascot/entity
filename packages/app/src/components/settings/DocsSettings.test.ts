import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProviderAdminCards } from './DocsSettings.tsx';
import type { ProviderAdminStatusView } from './docsProviderStatus.ts';

const sandboxStatus: ProviderAdminStatusView = {
  runtime: { mode: 'sandbox', sandboxBootstrap: 'active' },
  providers: {
    google_workspace: {
      adapterRegistered: true,
      connectionState: 'authorized',
      policyConfigured: true,
      effectiveWriteMode: 'create_and_update',
      adminWriteAuthorized: true,
      writeAuthorizationProven: true,
      confirmationPolicy: null,
      destinations: [
        { id: 'dest_a', displayName: 'Q3 Plans folder', kind: 'folder', enabled: true, artifactTypes: ['document'] },
      ],
      mutationSupport: {
        agent_text_mutation: 'supported',
        agent_range_mutation: 'unsupported',
        agent_slide_mutation: 'unsupported',
      },
    },
    microsoft_365: {
      adapterRegistered: false,
      connectionState: 'unknown',
      policyConfigured: false,
      effectiveWriteMode: 'disabled',
      adminWriteAuthorized: false,
      writeAuthorizationProven: false,
      confirmationPolicy: null,
      destinations: [],
      mutationSupport: {
        agent_text_mutation: 'unknown',
        agent_range_mutation: 'unknown',
        agent_slide_mutation: 'unknown',
      },
    },
    local_office: {
      adapterRegistered: false,
      connectionState: 'unknown',
      policyConfigured: false,
      effectiveWriteMode: 'disabled',
      adminWriteAuthorized: false,
      writeAuthorizationProven: false,
      confirmationPolicy: null,
      destinations: [],
      mutationSupport: {
        agent_text_mutation: 'unknown',
        agent_range_mutation: 'unknown',
        agent_slide_mutation: 'unknown',
      },
    },
  },
};

test('DocsSettings renders all three API-backed provider cards (GQR-004)', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ProviderAdminCards, { status: sandboxStatus }),
  );
  assert.ok(markup.includes('Google Workspace connection'), 'google card rendered');
  assert.ok(markup.includes('Microsoft 365 connection'), 'microsoft card rendered');
  assert.ok(markup.includes('Local Office connection'), 'local card rendered');
  // API-backed detail from the redacted status endpoint.
  assert.ok(markup.includes('Q3 Plans folder'), 'approved destination rendered from the API');
  assert.ok(markup.includes('Healthy'), 'authorized connection rendered healthy');
});

test('DocsSettings renders capability-honest unsupported mutation states (GQR-004)', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ProviderAdminCards, { status: sandboxStatus }),
  );
  assert.ok(markup.includes('Not supported'), 'unsupported lane visible');
  assert.ok(markup.includes('Unavailable (no capability evidence)'), 'unknown lane visible');
});

test('DocsSettings keeps cards fail closed when the status API is unreachable (GQR-004)', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ProviderAdminCards, {
      status: null,
      loadError: 'Failed to load provider status.',
    }),
  );
  assert.ok(markup.includes('Failed to load provider status.'), 'load error surfaced truthfully');
  assert.ok(markup.includes('Write lane locked (fail closed)'), 'cards stay fail closed');
  assert.ok(!markup.includes('Q3 Plans folder'), 'no stale destination data is invented');
});

test('DocsSettings shows the runtime posture line from the API (GQR-004)', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ProviderAdminCards, { status: sandboxStatus }),
  );
  assert.ok(markup.includes('sandbox'), 'sandbox posture is visible');
  const refusedMarkup = renderToStaticMarkup(
    React.createElement(ProviderAdminCards, {
      status: { runtime: { mode: 'production', sandboxBootstrap: 'refused' }, providers: sandboxStatus.providers },
    }),
  );
  assert.ok(refusedMarkup.includes('refused'), 'refused posture is visible');
});
