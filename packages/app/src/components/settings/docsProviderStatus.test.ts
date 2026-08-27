import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROVIDER_CARD_ORDER,
  providerCardsFromStatus,
  type ProviderAdminStatusView,
} from './docsProviderStatus.ts';

/**
 * A faithful sandbox status payload (same shape the redacted provider-admin endpoint
 * returns; fixture values mirror the live GQR-004 smoke).
 */
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
        {
          id: 'dest_a',
          displayName: 'Q3 Plans folder',
          kind: 'folder',
          enabled: true,
          artifactTypes: ['document'],
        },
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

test('the Microsoft 365 card is part of the canonical card order', () => {
  assert.deepEqual(PROVIDER_CARD_ORDER, ['google_workspace', 'microsoft_365', 'local_office']);
});

test('sandbox status maps the Google card with API-backed gates and honest lanes', () => {
  const cards = providerCardsFromStatus(sandboxStatus);
  const google = cards.find((card) => card.model.provider === 'Google Workspace');
  assert.ok(google, 'google card present');
  assert.equal(google.model.connectionState, 'ready');
  assert.equal(google.model.writeMode, 'create_and_update');
  assert.equal(google.model.adminWriteAuthorized, true);
  assert.equal(google.model.writeAuthorizationProven, true);
  assert.equal(google.model.confirmationPolicy, 'not_required');
  assert.deepEqual(
    google.model.destinations.map((d) => d.displayName),
    ['Q3 Plans folder'],
  );
  assert.deepEqual(google.model.mutationSupport, {
    agent_text_mutation: 'supported',
    agent_range_mutation: 'unsupported',
    agent_slide_mutation: 'unsupported',
  });
  // Server-authoritative readout: policy controls stay read-only in the UI.
  assert.equal(google.model.policyControlsEnabled, false);
});

test('sandbox status maps the Microsoft 365 card fail closed with unknown lanes', () => {
  const cards = providerCardsFromStatus(sandboxStatus);
  const microsoft = cards.find((card) => card.model.provider === 'Microsoft 365');
  assert.ok(microsoft, 'microsoft card present');
  assert.equal(microsoft.model.connectionState, 'unknown');
  assert.equal(microsoft.model.writeMode, 'disabled');
  assert.equal(microsoft.model.adminWriteAuthorized, false);
  assert.deepEqual(microsoft.model.destinations, []);
  assert.deepEqual(microsoft.model.mutationSupport, {
    agent_text_mutation: 'unknown',
    agent_range_mutation: 'unknown',
    agent_slide_mutation: 'unknown',
  });
  // Capability-honest diagnostics: no adapter means mutations are unavailable, not hidden.
  assert.ok(
    microsoft.model.diagnostics?.some((line) => /no .*adapter.*registered|no .*connector.*registered/i.test(line)),
    `diagnostics mention the missing adapter: ${JSON.stringify(microsoft.model.diagnostics)}`,
  );
});

test('a null status (fetch failed) maps every card to fail-closed defaults with an honest diagnostic', () => {
  const cards = providerCardsFromStatus(null, { loadError: 'boom' });
  assert.equal(cards.length, 3);
  for (const card of cards) {
    assert.equal(card.model.writeMode, 'disabled');
    assert.equal(card.model.adminWriteAuthorized, false);
    assert.equal(card.model.writeAuthorizationProven, false);
    assert.deepEqual(card.model.destinations, []);
    assert.deepEqual(card.model.mutationSupport, {
      agent_text_mutation: 'unknown',
      agent_range_mutation: 'unknown',
      agent_slide_mutation: 'unknown',
    });
    assert.ok(
      card.model.diagnostics?.some((line) => /could not be loaded/i.test(line)),
      `card ${card.model.provider} reports the unavailable status`,
    );
  }
});

test('a refused production posture is surfaced honestly on every card', () => {
  const refused: ProviderAdminStatusView = {
    runtime: { mode: 'production', sandboxBootstrap: 'refused' },
    providers: sandboxStatus.providers,
  };
  const cards = providerCardsFromStatus(refused);
  for (const card of cards) {
    assert.ok(
      card.model.diagnostics?.some((line) => /fail.closed|refused/i.test(line)),
      `card ${card.model.provider} states the fail-closed posture`,
    );
  }
});

test('a required confirmation policy is carried through truthfully', () => {
  const withConfirmation: ProviderAdminStatusView = {
    runtime: sandboxStatus.runtime,
    providers: {
      ...sandboxStatus.providers,
      google_workspace: {
        ...sandboxStatus.providers.google_workspace,
        confirmationPolicy: 'required',
      },
    },
  };
  const google = providerCardsFromStatus(withConfirmation).find(
    (card) => card.model.provider === 'Google Workspace',
  );
  assert.equal(google?.model.confirmationPolicy, 'required');
});

test('connection states map to honest UI vocabulary', () => {
  const withStates = (connectionState: string): ProviderAdminStatusView => ({
    runtime: sandboxStatus.runtime,
    providers: {
      ...sandboxStatus.providers,
      google_workspace: {
        ...sandboxStatus.providers.google_workspace,
        connectionState: connectionState as never,
      },
    },
  });
  assert.equal(providerCardsFromStatus(withStates('authorized'))[0].model.connectionState, 'ready');
  assert.equal(providerCardsFromStatus(withStates('degraded'))[0].model.connectionState, 'degraded');
  assert.equal(
    providerCardsFromStatus(withStates('unauthorized'))[0].model.connectionState,
    'reauthorization_required',
  );
  assert.equal(providerCardsFromStatus(withStates('unknown'))[0].model.connectionState, 'unknown');
});

test('a degraded connection lane passes through and is never upgraded', () => {
  const degraded: ProviderAdminStatusView = {
    runtime: sandboxStatus.runtime,
    providers: {
      ...sandboxStatus.providers,
      google_workspace: {
        ...sandboxStatus.providers.google_workspace,
        connectionState: 'degraded',
        mutationSupport: {
          agent_text_mutation: 'degraded',
          agent_range_mutation: 'unsupported',
          agent_slide_mutation: 'unknown',
        },
      },
    },
  };
  const google = providerCardsFromStatus(degraded).find(
    (card) => card.model.provider === 'Google Workspace',
  );
  assert.equal(google?.model.connectionState, 'degraded');
  assert.equal(google?.model.mutationSupport?.agent_text_mutation, 'degraded');
});

test('the Local Office card keeps its bridge-not-installed readiness fact', () => {
  const cards = providerCardsFromStatus(sandboxStatus);
  const local = cards.find((card) => card.model.provider === 'Local Office');
  assert.ok(local);
  assert.equal(local.model.localReadiness, 'bridge_not_installed');
});
