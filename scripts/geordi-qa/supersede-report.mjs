// Geordi QA superseding-report builder (GQR-006).
//
// Corrects the historical Geordi QA rerun1 report's I2 contract status from
// FAIL to INVALID_PREREQUISITE: the ten server-suite failures were observed
// only because the suite was invoked directly inside the read-only
// deploy-source checkout, which intentionally lacks generated managed-storage
// broker outputs. The supported root `npm run test:server` entry point builds
// those outputs first (GQR-003). The historical report and its receipts are
// preserved verbatim; this module only ever writes a separate superseding
// report and refuses reclassifications that are not backed by the recorded
// broker-absence evidence.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const INVALID_PREREQUISITE = "INVALID_PREREQUISITE";

// The correction is only honest when the historical evidence itself records
// the broker-output absence. Anything else would weaken QA grading.
const BROKER_ABSENCE_MARKER = /broker/i;
const ABSENCE_CONTEXT_MARKER = /(absen|ENOENT|missing|read-only|intentionally)/i;

function assertEvidenceQuote(quote) {
  if (
    typeof quote !== "string" ||
    !BROKER_ABSENCE_MARKER.test(quote) ||
    !ABSENCE_CONTEXT_MARKER.test(quote)
  ) {
    throw new Error(
      "correction evidenceQuote must quote the recorded broker-absence evidence from the historical run",
    );
  }
}

function rowId(row) {
  return Array.isArray(row) ? row[0] : row.id;
}

function contractIndexOf(report) {
  const first = report.features[0];
  if (Array.isArray(first)) return 2;
  return "contractStatus";
}

export function buildSupersedingReport(
  historicalReport,
  { corrections, supersedesPath, supersedesSha256 } = {},
) {
  if (!historicalReport || !Array.isArray(historicalReport.features)) {
    throw new Error("historical report must carry a features array");
  }
  if (!Array.isArray(corrections) || corrections.length === 0) {
    throw new Error("at least one correction is required");
  }
  const contractKey = contractIndexOf(historicalReport);
  const superseding = structuredClone(historicalReport);
  const applied = [];
  const seen = new Set();

  for (const correction of corrections) {
    const { rowId: id, field, evidenceQuote, rationale } = correction ?? {};
    if (typeof id !== "string" || id.length === 0) throw new Error("correction rowId is required");
    if (seen.has(id)) throw new Error(`duplicate correction for row ${id}`);
    seen.add(id);
    const row = superseding.features.find((candidate) => rowId(candidate) === id);
    if (!row) throw new Error(`unknown feature row ${id}`);
    if (field !== "contractStatus") {
      throw new Error("only contractStatus corrections are supported (no visible-grade weakening)");
    }
    if (row[contractKey] !== "FAIL") {
      throw new Error(`row ${id} contract status is not currently FAIL; refusing to reclassify`);
    }
    assertEvidenceQuote(evidenceQuote);
    if (typeof rationale !== "string" || rationale.length === 0) {
      throw new Error("correction rationale is required");
    }
    row[contractKey] = INVALID_PREREQUISITE;
    applied.push({
      rowId: id,
      field,
      from: "FAIL",
      to: INVALID_PREREQUISITE,
      evidenceQuote,
      rationale,
    });
  }

  // Recompute contract counts from the corrected rows, preserving the
  // historical count keys (including zeroed ones) so the schema stays stable;
  // never convert the reclassification into a PASS.
  const contractCounts = Object.fromEntries(
    Object.keys(historicalReport.counts?.contract ?? {}).map((key) => [key, 0]),
  );
  for (const row of superseding.features) {
    const status = row[contractKey];
    contractCounts[status] = (contractCounts[status] ?? 0) + 1;
  }
  superseding.counts = { ...superseding.counts, contract: contractCounts };

  superseding.supersession = {
    supersedesRunId: historicalReport.runId,
    supersedesPath: supersedesPath ?? null,
    supersedesSha256: supersedesSha256 ?? null,
    historicalEvidencePreserved: true,
    classification: INVALID_PREREQUISITE,
    classificationMeaning:
      "invalid prerequisite/setup: the observed failures stem from an unsupported invocation environment, not a product contract failure; this is not a product pass",
    corrections: applied,
  };
  return superseding;
}

export function renderSupersedingMarkdown(superseding) {
  const { supersession } = superseding;
  const lines = [];
  lines.push(`# Geordi QA superseding report — ${superseding.runId}`);
  lines.push("");
  lines.push(
    `Supersedes run \`${supersession.supersedesRunId}\`` +
      (supersession.supersedesPath ? ` at \`${supersession.supersedesPath}\`` : "") +
      (supersession.supersedesSha256
        ? ` (sha256 \`${supersession.supersedesSha256}\`)`
        : "") +
      ".",
  );
  lines.push("");
  lines.push(
    "The historical report and all historical receipts are preserved verbatim; historical evidence preserved, nothing was rewritten.",
  );
  lines.push("");
  lines.push("## Corrections");
  lines.push("");
  lines.push("| Row | Field | From | To | Rationale |");
  lines.push("|---|---|---|---|---|");
  for (const correction of supersession.corrections) {
    lines.push(
      `| ${correction.rowId} | ${correction.field} | ${correction.from} | ${correction.to} | ${correction.rationale} |`,
    );
  }
  lines.push("");
  lines.push("### Recorded evidence for each correction");
  lines.push("");
  for (const correction of supersession.corrections) {
    lines.push(`- **${correction.rowId}**: "${correction.evidenceQuote}"`);
  }
  lines.push("");
  lines.push(
    `\`${INVALID_PREREQUISITE}\` means invalid prerequisite/setup — the observed failures stem from an unsupported invocation environment, not a product contract failure; it is not a product pass.`,
  );
  lines.push("");
  lines.push("## Corrected counts");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(superseding.counts, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Historical blockers (verbatim)");
  lines.push("");
  for (const blocker of superseding.remainingBlockers ?? []) {
    lines.push(`- ${blocker}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function sha256OfFile(file) {
  const buffer = await readFile(file);
  return createHash("sha256").update(buffer).digest("hex");
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--report") args.report = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else args._.push(arg);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.report || !args.out) {
    console.error("usage: supersede-report.mjs --report <historical-report.json> --out <dir>");
    process.exitCode = 2;
    return;
  }
  const sourcePath = path.resolve(args.report);
  const outDir = path.resolve(args.out);
  if (path.dirname(sourcePath) === outDir) {
    console.error(
      "refusing to write the superseding report into the historical report's directory; historical evidence must stay untouched",
    );
    process.exitCode = 1;
    return;
  }
  const historical = JSON.parse(await readFile(sourcePath, "utf8"));
  const superseding = buildSupersedingReport(historical, {
    corrections: [
      {
        rowId: "I2",
        field: "contractStatus",
        evidenceQuote:
          "All ten failures are source-checkout FS/local conversion tests because the read-only deploy-source checkout intentionally has no packages/server/native/managed-storage-broker/.build/broker.",
        rationale:
          "The server suite was invoked directly (cd packages/server && npx vitest run) inside the read-only deploy-source checkout without generated broker outputs. The supported root `npm run test:server` entry point builds the managed-storage broker before testing (GQR-003); the exact-build release-deploy suite proved the broker build/publication contracts 129/129. The failures are an invalid prerequisite/setup artifact, not a product contract failure, and this reclassification is not a product pass.",
      },
    ],
    supersedesPath: sourcePath,
    supersedesSha256: await sha256OfFile(sourcePath),
  });
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "superseding-report.json"), `${JSON.stringify(superseding, null, 2)}\n`);
  await writeFile(path.join(outDir, "superseding-report.md"), renderSupersedingMarkdown(superseding));
  process.stdout.write(`wrote superseding report for ${superseding.runId} to ${outDir}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
