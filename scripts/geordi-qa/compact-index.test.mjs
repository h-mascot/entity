import assert from "node:assert/strict";
import test from "node:test";

import { verifyCompactIndex } from "./compact-index.mjs";

const LANES = ["00-baseline", "A", "B", "C", "D", "E", "F", "G", "H", "I"];

function indexFixture(entriesOverrides = {}) {
  return {
    schemaVersion: 1,
    runId: "20260826T103159Z-release-recovery-all-features-rerun1",
    generatedAt: "2026-08-26T10:56:59.373Z",
    approved: { sha: "777b20f77dc85b2cf62cdc17067a0e526ef14ae6", environment: "sandbox" },
    native: { embeddedPayloads: false },
    screenshots: entriesOverrides.screenshots ?? [
      { path: "00-baseline/sandbox-home.jpeg", lane: "00-baseline" },
      { path: "A/files-home.jpeg", lane: "A" },
    ],
    axCaptures: entriesOverrides.axCaptures ?? [
      { path: "A/files-home.ax.txt", lane: "A" },
    ],
    actionReceipts: entriesOverrides.actionReceipts ?? [
      { path: "A/files-home.receipt.json", lane: "A" },
    ],
  };
}

function metadataFixture() {
  return [
    { path: "00-baseline/sandbox-home.jpeg", lane: "00-baseline", kind: "screenshot" },
    { path: "A/files-home.jpeg", lane: "A", kind: "screenshot" },
    { path: "A/files-home.ax.txt", lane: "A", kind: "ax" },
    { path: "A/files-home.receipt.json", lane: "A", kind: "receipt" },
  ];
}

test("accepts a well-formed compact index with semantically matching metadata", () => {
  const result = verifyCompactIndex(indexFixture(), metadataFixture(), { allowedLanes: LANES });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.checkedEntries, 4);
});

test("rejects path mismatches that substring matching would pass", () => {
  // metadata path is a strict prefix of the indexed path — a substring check
  // against serialized metadata would accept this; semantics must not.
  const index = indexFixture({
    screenshots: [
      { path: "00-baseline/sandbox-home.jpeg", lane: "00-baseline" },
      { path: "A/files-home.jpeg-backup", lane: "A" },
    ],
  });
  const result = verifyCompactIndex(index, metadataFixture(), { allowedLanes: LANES });
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some((v) => v.field === "path" && v.metadataPath === "A/files-home.jpeg"),
    "violation must name the mismatching path field",
  );
});

test("rejects lane mismatches with field-level evidence", () => {
  const index = indexFixture({
    axCaptures: [{ path: "A/files-home.ax.txt", lane: "B" }],
  });
  const result = verifyCompactIndex(index, metadataFixture(), { allowedLanes: LANES });
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some(
      (v) => v.field === "lane" && v.metadataPath === "A/files-home.ax.txt",
    ),
  );
});

test("every metadata record must be indexed", () => {
  const metadata = metadataFixture();
  metadata.push({ path: "C/task-detail-handoffs.receipt.json", lane: "C", kind: "receipt" });
  const result = verifyCompactIndex(indexFixture(), metadata, { allowedLanes: LANES });
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some(
      (v) => v.type === "missing-from-index" && v.metadataPath === "C/task-detail-handoffs.receipt.json",
    ),
  );
});

test("a metadata note mentioning another entry's path cannot satisfy that entry's check", () => {
  // The serialized metadata blob contains "A/files-home.jpeg-backup" as note
  // text; substring validation would wrongly accept. Semantic matching must
  // still fail the real mismatch.
  const metadata = [
    { path: "A/files-home.jpeg", lane: "A", kind: "screenshot", note: "superseded by A/files-home.jpeg-backup" },
  ];
  const index = indexFixture({
    screenshots: [{ path: "A/files-home.jpeg-backup", lane: "A" }],
    axCaptures: [],
    actionReceipts: [],
  });
  const result = verifyCompactIndex(index, metadata, { allowedLanes: LANES });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.field === "path"));
});

test("rejects embedded base64 payloads anywhere in the index", () => {
  const index = indexFixture();
  index.native = {
    embeddedPayloads: false,
    note: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  };
  const result = verifyCompactIndex(index, metadataFixture(), { allowedLanes: LANES });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.type === "base64-payload"));
});

test("rejects entries outside the allowed lane set", () => {
  const index = indexFixture({
    screenshots: [
      { path: "00-baseline/sandbox-home.jpeg", lane: "00-baseline" },
      { path: "A/files-home.jpeg", lane: "A" },
      { path: "Z/rogue.jpeg", lane: "Z" },
    ],
  });
  const result = verifyCompactIndex(index, metadataFixture(), { allowedLanes: LANES });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.type === "unknown-lane" && v.lane === "Z"));
});

test("malformed indexes throw typed structural errors", () => {
  assert.throws(() => verifyCompactIndex(null, []), /index/i);
  assert.throws(() => verifyCompactIndex({ ...indexFixture(), schemaVersion: 2 }, []), /schemaVersion/);
  assert.throws(() => verifyCompactIndex({ ...indexFixture(), runId: "" }, []), /runId/);
  assert.throws(
    () => verifyCompactIndex({ ...indexFixture(), screenshots: "nope" }, []),
    /screenshots/,
  );
});

test("index entries without metadata are reported but not violations", () => {
  const index = indexFixture(); // 4 entries
  const result = verifyCompactIndex(index, metadataFixture().slice(0, 2), { allowedLanes: LANES });
  assert.equal(result.ok, true);
  assert.equal(result.unindexedEntries, 2);
});

test("accepts the historical receipts section name `actions`", () => {
  const index = indexFixture();
  index.actions = index.actionReceipts;
  delete index.actionReceipts;
  const result = verifyCompactIndex(index, metadataFixture(), { allowedLanes: LANES });
  assert.equal(result.ok, true);
  assert.equal(result.summary.sections.actions, 1);
  // A receipts array under neither name is malformed.
  const stripped = indexFixture();
  delete stripped.actionReceipts;
  assert.throws(() => verifyCompactIndex(stripped, []), /receipts/);
});
