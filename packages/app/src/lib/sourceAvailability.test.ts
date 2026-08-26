import assert from 'node:assert/strict';
import test from 'node:test';

interface SourceAvailabilityModule {
  SOURCE_UNAVAILABLE_NOTICE: string;
  sourceTypeIsAvailableInBuild: (type: string) => boolean;
  sourceIsAvailableInBuild: (source: { type: string; implemented?: boolean }) => boolean;
}

// Non-literal specifier keeps this RED test compiling before the module exists.
const availabilitySpecifier = './sourceAvailability.ts';

async function loadAvailabilityModule(): Promise<SourceAvailabilityModule | null> {
  return import(availabilitySpecifier).catch(() => null) as Promise<SourceAvailabilityModule | null>;
}

test('classifies connector types available in this build', async () => {
  const mod = await loadAvailabilityModule();
  assert.ok(mod, 'sourceAvailability module must exist for build-honest source UI');
  assert.equal(mod.sourceTypeIsAvailableInBuild('local'), true);
  assert.equal(mod.sourceTypeIsAvailableInBuild('docsify'), true);
  assert.equal(mod.sourceTypeIsAvailableInBuild('http-markdown'), true);
  assert.equal(mod.sourceTypeIsAvailableInBuild('github'), false);
  assert.equal(mod.sourceTypeIsAvailableInBuild('s3'), false);
  assert.equal(mod.sourceTypeIsAvailableInBuild('custom'), false);
});

test('trusts the server implementation flag and falls back to build knowledge', async () => {
  const mod = await loadAvailabilityModule();
  assert.ok(mod, 'sourceAvailability module must exist for build-honest source UI');
  assert.equal(mod.sourceIsAvailableInBuild({ type: 'local', implemented: true }), true);
  assert.equal(mod.sourceIsAvailableInBuild({ type: 'local', implemented: false }), false);
  assert.equal(mod.sourceIsAvailableInBuild({ type: 'github', implemented: false }), false);
  assert.equal(mod.sourceIsAvailableInBuild({ type: 'github' }), false);
  assert.equal(mod.sourceIsAvailableInBuild({ type: 'local' }), true);
});

test('exposes the exact user-facing unavailability notice', async () => {
  const mod = await loadAvailabilityModule();
  assert.ok(mod, 'sourceAvailability module must exist for build-honest source UI');
  assert.equal(mod.SOURCE_UNAVAILABLE_NOTICE, 'Not available in this build');
});
