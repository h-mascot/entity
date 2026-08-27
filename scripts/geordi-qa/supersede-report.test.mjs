import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  INVALID_PREREQUISITE,
  buildSupersedingReport,
  renderSupersedingMarkdown,
} from "./supersede-report.mjs";

// Shape mirrors the historical Geordi QA rerun1 report.json rows:
// [id, visibleGrade, contractStatus, evidencePath]
function historicalReportFixture() {
  return {
    schemaVersion: 1,
    runId: "20260826T103159Z-release-recovery-all-features-rerun1",
    verdict: "PARTIAL",
    approvedSha: "777b20f77dc85b2cf62cdc17067a0e526ef14ae6",
    environment: "sandbox",
    target: "http://sandbox.entity",
    counts: {
      visible: { PASS: 22, PARTIAL: 8, FAIL: 1, "WRONG BUILD": 0, BLOCKED: 31 },
      contract: { PASS: 61, FAIL: 1, BLOCKED: 0, NOT_APPLICABLE: 0 },
    },
    features: [
      ["I1", "PASS", "PASS", "I/fresh-test-summary.json"],
      ["I2", "PARTIAL", "FAIL", "I/fresh-test-summary.json"],
      ["I3", "PASS", "PASS", "I/fresh-test-summary.json"],
    ],
    remainingBlockers: [
      "source-checkout server suite has 10 broker-absence failures",
    ],
  };
}

const BROKER_ABSENCE_EVIDENCE =
  "All ten failures are source-checkout FS/local conversion tests because the read-only deploy-source checkout intentionally has no packages/server/native/managed-storage-broker/.build/broker.";

function correction(overrides = {}) {
  return {
    rowId: "I2",
    field: "contractStatus",
    evidenceQuote: BROKER_ABSENCE_EVIDENCE,
    rationale:
      "The suite was invoked directly inside the read-only deploy-source checkout without generated broker outputs; the supported root `npm run test:server` entry point builds them first (GQR-003).",
    ...overrides,
  };
}

test("reclassifies exactly the I2 contract status from FAIL to INVALID_PREREQUISITE", () => {
  const superseding = buildSupersedingReport(historicalReportFixture(), {
    corrections: [correction()],
  });
  const row = superseding.features.find((f) => f[0] === "I2");
  assert.equal(row[2], INVALID_PREREQUISITE);
  assert.equal(row[1], "PARTIAL", "visible grade must remain untouched");
});

test("recomputes contract counts without claiming a pass", () => {
  const superseding = buildSupersedingReport(historicalReportFixture(), {
    corrections: [correction()],
  });
  // Fixture rows: I1 PASS, I2 reclassified, I3 PASS.
  assert.equal(superseding.counts.contract.PASS, 2);
  assert.equal(superseding.counts.contract.FAIL, 0);
  assert.equal(superseding.counts.contract[INVALID_PREREQUISITE], 1);
  assert.equal(superseding.counts.visible.PARTIAL, 8, "visible counts preserved verbatim");
});

test("never mutates the historical report object", () => {
  const original = historicalReportFixture();
  const frozen = JSON.parse(JSON.stringify(original));
  buildSupersedingReport(original, { corrections: [correction()] });
  assert.deepEqual(original, frozen);
});

test("records provenance and preserves historical evidence", () => {
  const superseding = buildSupersedingReport(historicalReportFixture(), {
    corrections: [correction()],
    supersedesPath:
      "/historical/geordi-qa/entity/20260826T103159Z-release-recovery-all-features-rerun1/report.json",
    supersedesSha256: "a".repeat(64),
  });
  assert.equal(
    superseding.supersession.supersedesRunId,
    "20260826T103159Z-release-recovery-all-features-rerun1",
  );
  assert.equal(
    superseding.supersession.supersedesPath,
    "/historical/geordi-qa/entity/20260826T103159Z-release-recovery-all-features-rerun1/report.json",
  );
  assert.equal(superseding.supersession.supersedesSha256, "a".repeat(64));
  assert.equal(superseding.supersession.historicalEvidencePreserved, true);
  const applied = superseding.supersession.corrections[0];
  assert.equal(applied.rowId, "I2");
  assert.equal(applied.from, "FAIL");
  assert.equal(applied.to, INVALID_PREREQUISITE);
  assert.ok(applied.evidenceQuote.includes("broker"));
  assert.ok(applied.rationale.includes("test:server"));
});

test("refuses to reclassify a row that is not currently FAIL (no weakening guard)", () => {
  const report = historicalReportFixture();
  report.features[1][2] = "PASS";
  assert.throws(
    () => buildSupersedingReport(report, { corrections: [correction()] }),
    /currently FAIL/,
  );
});

test("refuses a correction without the recorded broker-absence evidence quote", () => {
  assert.throws(
    () =>
      buildSupersedingReport(historicalReportFixture(), {
        corrections: [correction({ evidenceQuote: "looked wrong to me" })],
      }),
    /evidence/i,
  );
});

test("refuses unknown row ids and duplicate corrections", () => {
  assert.throws(
    () =>
      buildSupersedingReport(historicalReportFixture(), {
        corrections: [correction({ rowId: "Z9" })],
      }),
    /Z9/,
  );
  assert.throws(
    () =>
      buildSupersedingReport(historicalReportFixture(), {
        corrections: [correction(), correction()],
      }),
    /duplicate/i,
  );
});

test("keeps historical remainingBlockers verbatim", () => {
  const superseding = buildSupersedingReport(historicalReportFixture(), {
    corrections: [correction()],
  });
  assert.deepEqual(superseding.remainingBlockers, [
    "source-checkout server suite has 10 broker-absence failures",
  ]);
});

test("markdown states the correction without claiming I2 passed", () => {
  const superseding = buildSupersedingReport(historicalReportFixture(), {
    corrections: [correction()],
    supersedesPath: "/historical/report.json",
    supersedesSha256: "b".repeat(64),
  });
  const markdown = renderSupersedingMarkdown(superseding);
  assert.match(markdown, /I2/);
  assert.match(markdown, /INVALID_PREREQUISITE/);
  assert.match(markdown, /FAIL/);
  assert.match(markdown, /historical evidence preserved/i);
  assert.match(markdown, /not a product pass/i);
  assert.doesNotMatch(markdown, /I2[^.]*contract PASS/);
});

test("CLI writes the superseding pair beside the source but never into it", async (t) => {
  const script = path.join(import.meta.dirname, "supersede-report.mjs");
  const sourceDir = await mkdtemp(path.join(tmpdir(), "geordi-supersede-src-"));
  const outDir = await mkdtemp(path.join(tmpdir(), "geordi-supersede-out-"));
  t.after(() => {
    rm(sourceDir, { recursive: true, force: true });
    rm(outDir, { recursive: true, force: true });
  });
  const sourceReport = path.join(sourceDir, "report.json");
  await writeFile(sourceReport, JSON.stringify(historicalReportFixture()));
  const sourceBefore = await readFile(sourceReport, "utf8");

  const { spawnSync } = await import("node:child_process");
  const ok = spawnSync(process.execPath, [
    script,
    "--report",
    sourceReport,
    "--out",
    outDir,
  ], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const written = JSON.parse(await readFile(path.join(outDir, "superseding-report.json"), "utf8"));
  assert.equal(
    written.supersession.corrections[0].to,
    INVALID_PREREQUISITE,
  );
  await readFile(path.join(outDir, "superseding-report.md"), "utf8");
  assert.equal(await readFile(sourceReport, "utf8"), sourceBefore, "historical file untouched");

  // Writing into the source directory is refused to protect historical evidence.
  const refused = spawnSync(process.execPath, [
    script,
    "--report",
    sourceReport,
    "--out",
    sourceDir,
  ], { encoding: "utf8" });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /historical/i);
  assert.equal(await readFile(sourceReport, "utf8"), sourceBefore);
});
