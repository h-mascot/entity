import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyProofBundleItemKind,
  normalizeProofBundle,
  proofBundleItemsOfKind,
} from './proofBundle.ts';

test('classifyProofBundleItemKind maps raw / curated / external / unknown', () => {
  assert.equal(
    classifyProofBundleItemKind({ artifactKind: 'raw_task_receipt' }),
    'raw',
  );
  assert.equal(
    classifyProofBundleItemKind({ artifactKind: 'curated_report' }),
    'curated',
  );
  assert.equal(
    classifyProofBundleItemKind({ objectType: 'native_document' }),
    'curated',
  );
  assert.equal(
    classifyProofBundleItemKind({ href: 'https://example.com/proof' }),
    'external',
  );
  assert.equal(
    classifyProofBundleItemKind({ href: '/docs/output/entity/run.md' }),
    'raw',
  );
  assert.equal(
    classifyProofBundleItemKind({ href: '/docs/workspace/docs/notes/plan.md' }),
    'curated',
  );
  assert.equal(classifyProofBundleItemKind({}), 'unknown');
});

test('normalizeProofBundle returns explicit empty bundle for missing/null inputs', () => {
  for (const input of [null, undefined, '', 42, {}, { id: 0, name: 'x' }, { name: 'no-id' }]) {
    const bundle = normalizeProofBundle(input);
    assert.equal(bundle.empty, true);
    assert.deepEqual(bundle.items, []);
    assert.equal(bundle.missingEvidenceReason, null);
  }

  const noProof = normalizeProofBundle({
    id: 9,
    name: 'Done without proof',
    column: 'done',
    output: '',
    metadata: {},
  });
  assert.equal(noProof.taskId, 9);
  assert.equal(noProof.empty, true);
  assert.equal(noProof.items.length, 0);
  assert.equal(noProof.missingEvidence, true);
});

test('normalizeProofBundle classifies raw receipt + Entity output links', () => {
  const bundle = normalizeProofBundle({
    id: 22,
    name: 'Restore Workplane on refresh',
    column: 'doing',
    output: 'See output/entity/workplanes/refresh.md for proof.',
    metadata: {
      evidence_summary: 'Refresh restore browser proof attached.',
      phase2_receipt: {
        artifact_id: 'receipt-22',
        artifact_kind: 'raw_task_receipt',
        stable_path: '/artifacts/evidence/receipt-22.md',
        integrity_state: 'valid',
        availability_state: 'available',
        receipt_status: 'created',
      },
    },
  });

  assert.equal(bundle.empty, false);
  assert.equal(bundle.taskId, 22);
  assert.equal(bundle.missingEvidence, false);

  const raw = proofBundleItemsOfKind(bundle, 'raw');
  assert.ok(raw.length >= 2);
  assert.ok(raw.some((item) => item.source === 'receipt' && item.id.includes('receipt-22')));
  assert.ok(
    raw.some(
      (item) =>
        item.source === 'output_link' &&
        item.href === '/docs/output/entity/workplanes/refresh.md',
    ),
  );
});

test('normalizeProofBundle classifies curated native docs and curated artifacts', () => {
  const bundle = normalizeProofBundle({
    id: 5,
    name: 'Curated docs',
    column: 'review',
    output: '',
    metadata: {
      native_documents: [
        {
          id: 'doc-plan',
          title: 'Plan note',
          object_type: 'native_document',
          human_path_alias: 'docs/notes/plan.md',
        },
      ],
      curated_artifacts: [
        {
          id: 'curated-1',
          title: 'Rollup summary',
          artifact_kind: 'rollup',
          stable_path: '/docs/workspace/docs/reports/rollup.md',
        },
      ],
    },
  });

  const curated = proofBundleItemsOfKind(bundle, 'curated');
  assert.equal(curated.length, 2);
  assert.ok(curated.some((item) => item.source === 'native_document' && item.title === 'Plan note'));
  assert.ok(curated.some((item) => item.source === 'curated_artifact' && item.artifactKind === 'rollup'));
  assert.equal(proofBundleItemsOfKind(bundle, 'raw').length, 0);
});

test('normalizeProofBundle classifies external links and refs', () => {
  const bundle = normalizeProofBundle({
    id: 7,
    name: 'External proof',
    column: 'doing',
    output: 'Also https://github.com/org/repo/pull/12',
    metadata: {
      evidence_links: ['https://example.com/evidence.pdf'],
      external_document_refs: [
        {
          id: 'ext-1',
          title: 'Vendor brief',
          object_type: 'external_document_ref',
          external_url: 'https://vendor.example/brief',
        },
      ],
    },
  });

  const external = proofBundleItemsOfKind(bundle, 'external');
  assert.ok(external.length >= 3);
  assert.ok(external.every((item) => item.kind === 'external'));
  assert.ok(external.some((item) => item.href === 'https://example.com/evidence.pdf'));
  assert.ok(external.some((item) => item.href === 'https://vendor.example/brief'));
  assert.ok(external.some((item) => item.href === 'https://github.com/org/repo/pull/12'));
});

test('normalizeProofBundle marks unclassifiable evidence as unknown', () => {
  const bundle = normalizeProofBundle({
    id: 11,
    name: 'Unknown artifact',
    column: 'todo',
    output: '',
    metadata: {
      evidence_artifacts: [
        {
          id: 'blob-9',
          title: 'Opaque blob',
          artifact_kind: 'mystery_blob',
        },
      ],
      evidence_links: ['opaque-token-42'],
    },
  });

  const unknown = proofBundleItemsOfKind(bundle, 'unknown');
  assert.ok(unknown.length >= 2);
  assert.ok(unknown.some((item) => item.title === 'Opaque blob'));
  assert.ok(unknown.some((item) => item.label === 'opaque-token-42'));
  assert.equal(bundle.empty, false);
});

test('normalizeProofBundle dedupes duplicate links and drops malformed entries', () => {
  const bundle = normalizeProofBundle({
    id: 3,
    name: 'Dupes and junk',
    column: 'doing',
    output: 'output/a.md output/a.md',
    metadata: {
      evidence_links: [
        'output/a.md',
        { label: 'Same A', href: '/docs/output/a.md' },
        null,
        '',
        '   ',
        { title: '' },
        { nested: true },
        123,
        { label: 'Keep me', href: 'output/b.md' },
      ],
    },
  });

  const hrefs = bundle.items.map((item) => item.href).filter(Boolean);
  assert.equal(hrefs.filter((href) => href === '/docs/output/a.md').length, 1);
  assert.ok(hrefs.includes('/docs/output/b.md'));
  assert.ok(bundle.items.every((item) => item.title.trim().length > 0));

  // Same input twice → identical item ids/kinds (deterministic).
  const again = normalizeProofBundle({
    id: 3,
    name: 'Dupes and junk',
    column: 'doing',
    output: 'output/a.md output/a.md',
    metadata: {
      evidence_links: [
        'output/a.md',
        { label: 'Same A', href: '/docs/output/a.md' },
        { label: 'Keep me', href: 'output/b.md' },
      ],
    },
  });
  assert.deepEqual(
    again.items.map((item) => ({ id: item.id, kind: item.kind, href: item.href })),
    bundle.items.map((item) => ({ id: item.id, kind: item.kind, href: item.href })),
  );
});

test('normalizeProofBundle preserves status/title/path metadata without inventing fields', () => {
  const bundle = normalizeProofBundle({
    id: 15,
    name: 'Metadata preserve',
    column: 'review',
    output: '',
    metadata: {
      evidence_artifacts: [
        {
          id: 'ev-1',
          title: 'Packet',
          artifact_kind: 'review_packet',
          stable_path: '/artifacts/evidence/ev-1.md',
          integrity_state: 'hash_mismatch',
        },
      ],
    },
  });

  assert.equal(bundle.items.length, 1);
  const item = bundle.items[0]!;
  assert.equal(item.kind, 'raw');
  assert.equal(item.title, 'Packet');
  assert.equal(item.path, '/artifacts/evidence/ev-1.md');
  assert.equal(item.status, 'hash_mismatch');
  assert.equal(item.href, '/artifacts/evidence/ev-1.md');
  assert.equal(item.artifactKind, 'review_packet');
});
