import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCuracelSyntheticRows } from '../lib/curacelAgentImportRows.ts';

test('creates four stable review-gated Curacel identities in the selected team', () => {
  const rows = buildCuracelSyntheticRows('claims-team');

  assert.deepEqual(rows.map((row) => row.name), ['Atlas', 'Mafa', 'Sabi', 'Kashy']);
  assert.equal(new Set(rows.map((row) => row.externalId)).size, 4);
  assert.ok(rows.every((row) =>
    row.teamIds.includes('claims-team')
    && row.reviewRequired
    && row.humanGateRequired));
});
