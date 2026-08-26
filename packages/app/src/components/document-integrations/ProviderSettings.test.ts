import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ProviderSettings, { localReadinessLabel, type ProviderSettingsModel } from './ProviderSettings.tsx';

test('local Office readiness is rendered as an explicit fail-closed state', () => {
  assert.equal(localReadinessLabel('ready'), 'Ready');
  assert.equal(localReadinessLabel('bridge_not_installed'), 'Bridge not installed');
  assert.equal(localReadinessLabel('bridge_not_running'), 'Bridge not running');
  assert.equal(localReadinessLabel('engine_unavailable'), 'Engine unavailable');
  assert.equal(localReadinessLabel('degraded'), 'Degraded');
});

const mutationModel: ProviderSettingsModel = {
  provider: 'Microsoft 365',
  connectionState: 'unknown',
  writeMode: 'disabled',
  adminWriteAuthorized: false,
  writeAuthorizationProven: false,
  confirmationPolicy: 'not_required',
  destinations: [],
  policyControlsEnabled: false,
  mutationSupport: {
    agent_text_mutation: 'unknown',
    agent_range_mutation: 'unsupported',
    agent_slide_mutation: 'supported',
  },
};

test('mutation lanes render capability-honest states (GQR-004)', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ProviderSettings, { model: mutationModel, onChange: () => undefined }),
  );
  // unknown lane names the missing adapter; unsupported says not supported; supported says supported.
  assert.ok(markup.includes('Unavailable (no provider adapter registered)'), 'unknown lane labeled');
  assert.ok(markup.includes('Not supported'), 'unsupported lane labeled');
  assert.ok(markup.includes('Supported'), 'supported lane labeled');
  // Lane names are visible so the states are attributable.
  assert.ok(markup.includes('Document text'));
  assert.ok(markup.includes('Spreadsheet ranges'));
  assert.ok(markup.includes('Presentation slides'));
});

test('an unknown connection state renders an explicit status-unknown label (GQR-004)', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ProviderSettings, { model: mutationModel, onChange: () => undefined }),
  );
  assert.ok(markup.includes('Status unknown'), 'unknown connection labeled honestly');
  assert.ok(markup.includes('fail-closed'), 'unknown connection states fail-closed writes');
});
