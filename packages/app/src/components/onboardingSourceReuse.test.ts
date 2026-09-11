import assert from 'node:assert/strict';
import test from 'node:test';

import { findReusableOnboardingSource } from './onboardingSourceReuse.ts';

test('reuses an existing onboarding source with identical identity', () => {
  const sources = [
    { id: 'other', displayName: 'Some other source', type: 'github', baseUrl: 'https://github.com/acme/other', enabled: true },
    { id: 'onboard-github', displayName: 'GitHub source', type: 'github', baseUrl: 'https://github.com/acme/widget/', enabled: true },
  ];

  const match = findReusableOnboardingSource(sources, {
    displayName: 'GitHub source',
    type: 'github',
    baseUrl: 'https://github.com/acme/widget',
  });

  assert.equal(match?.id, 'onboard-github', 'identical config (modulo trailing slash) must be reused');
});

test('re-clicks after a failed test reuse the same source instead of duplicating it', () => {
  const firstClickResult = { id: 'onboard-github', displayName: 'GitHub source', type: 'github', baseUrl: null, enabled: true };

  const match = findReusableOnboardingSource([firstClickResult], {
    displayName: 'GitHub source',
    type: 'github',
    // The wizard posts the URL it was given; the placeholder test fails, so
    // the operator clicks Test again with the same values.
    baseUrl: 'https://github.com/acme/widget',
  });

  // baseUrl differs because the earlier create stored a baseUrl — this click
  // must NOT reuse the mismatched source; it only reuses identical config.
  assert.equal(match, undefined);
});

test('a local source is reused when displayName, type, and basePath match', () => {
  const sources = [
    { id: 'onboard-entity', displayName: 'Entity source', type: 'local', basePath: '/workspace/project/', enabled: true },
  ];

  const match = findReusableOnboardingSource(sources, {
    displayName: 'Entity source',
    type: 'local',
    basePath: '/workspace/project',
  });

  assert.equal(match?.id, 'onboard-entity');
});

test('a disabled source is never reused even when the identity matches', () => {
  const sources = [
    { id: 'onboard-entity', displayName: 'Entity source', type: 'local', basePath: '/workspace/project', enabled: false },
  ];

  const match = findReusableOnboardingSource(sources, {
    displayName: 'Entity source',
    type: 'local',
    basePath: '/workspace/project',
  });

  assert.equal(
    match,
    undefined,
    'a deliberately disabled source must not be reported Reachable while it stays out of listings and the index'
  );
});

test('prefers the enabled match when a disabled source with the same identity exists', () => {
  const sources = [
    { id: 'disabled-first', displayName: 'Entity source', type: 'local', basePath: '/workspace/project', enabled: false },
    { id: 'enabled-second', displayName: 'Entity source', type: 'local', basePath: '/workspace/project', enabled: true },
  ];

  const match = findReusableOnboardingSource(sources, {
    displayName: 'Entity source',
    type: 'local',
    basePath: '/workspace/project',
  });

  assert.equal(match?.id, 'enabled-second', 'only enabled sources are eligible for reuse');
});

test('repeated test clicks keep reusing the same enabled source unchanged', () => {
  const sources = [
    { id: 'onboard-github', displayName: 'GitHub source', type: 'github', baseUrl: 'https://github.com/acme/widget', enabled: true },
  ];
  const draft = { displayName: 'GitHub source', type: 'github', baseUrl: 'https://github.com/acme/widget' };

  const first = findReusableOnboardingSource(sources, draft);
  const second = findReusableOnboardingSource(sources, draft);

  assert.equal(first?.id, 'onboard-github');
  assert.equal(second?.id, first?.id, 'the second click must reuse, not fork, the enabled source');
});

test('does not reuse when the location changed even if the display name matches', () => {
  const sources = [
    { id: 'onboard-github', displayName: 'GitHub source', type: 'github', baseUrl: 'https://github.com/acme/old', enabled: true },
  ];

  const match = findReusableOnboardingSource(sources, {
    displayName: 'GitHub source',
    type: 'github',
    baseUrl: 'https://github.com/acme/new',
  });

  assert.equal(match, undefined, 'a stale source must not be tested in place of the requested one');
});

test('does not reuse across connector types even with the same display name and location', () => {
  const sources = [
    { id: 'onboard-github', displayName: 'Shared name', type: 'github', baseUrl: 'https://github.com/acme/widget', enabled: true },
  ];

  const match = findReusableOnboardingSource(sources, {
    displayName: 'Shared name',
    type: 'http-markdown',
    baseUrl: 'https://github.com/acme/widget',
  });

  assert.equal(match, undefined);
});

test('does not reuse when the display name differs', () => {
  const sources = [
    { id: 'onboard-github', displayName: 'GitHub source ', type: 'github', baseUrl: 'https://github.com/acme/widget', enabled: true },
  ];

  const renamed = findReusableOnboardingSource(sources, {
    displayName: 'Renamed source',
    type: 'github',
    baseUrl: 'https://github.com/acme/widget',
  });
  assert.equal(renamed, undefined, 'a differently named source is a different source');

  const trimmed = findReusableOnboardingSource(sources, {
    displayName: 'GitHub source',
    type: 'github',
    baseUrl: 'https://github.com/acme/widget',
  });
  assert.equal(trimmed?.id, 'onboard-github', 'surrounding whitespace is not part of the identity');
});

test('returns nothing for an empty source list', () => {
  const match = findReusableOnboardingSource([], { displayName: 'GitHub source', type: 'github', baseUrl: 'x' });
  assert.equal(match, undefined);
});

test('reuses repeated clicks with empty locations rather than duplicating them', () => {
  const sources = [{ id: 'onboard-github', displayName: 'GitHub source', type: 'github', baseUrl: null, enabled: true }];

  const match = findReusableOnboardingSource(sources, {
    displayName: 'GitHub source',
    type: 'github',
    baseUrl: '',
  });

  assert.equal(match?.id, 'onboard-github', 're-clicks with the same empty location must not fork a new source');
});
