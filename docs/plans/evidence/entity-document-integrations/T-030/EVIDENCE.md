# T-030 Evidence — Local XLSX milestone

## Reviewed scope

The candidate is based on isolated worktree HEAD `7ef10870dea366faf16231fa430c27415fbfef14`. All
work and proof ran in the requested isolated worktree as DSH worker `citadel/daystrom/deepseek`.
No merge, push, deployment, Linear mutation, runner-state edit, other worktree, or Git metadata
write was performed.

`LocalXlsxEngine` implements the accepted `LocalOfficeEngine` seam and composes the existing
managed-reference, safe-save, registry, version/event, normalized activity, canonical receipt,
and document-operation boundaries. It reuses `local/ooxml-package.ts` for the hostile bounded
package boundary and `local/document-operation.ts` for the claim/completed/uncertain lifecycle —
it adds no store, schema, route, adapter registry, or transport.

The lifecycle fixture proves semantic create (real SpreadsheetML ZIP built in memory), stable
`/documents/:id` link, authorized open, human candidate save/reopen, multi-sheet round-trip, and
receipt-linked authorized **bounded range mutation** (`{ kind: 'range', cell, value }`). The
engine does not accept a host path and does not claim formula recalculation or perfect Excel
fidelity (PRD 16.5 / T-030 non-goal).

## Format gate and mutation

The XLSX format gate accepts only packages whose content types identify a SpreadsheetML
workbook, with A root `officeDocument` relationship targeting `xl/workbook.xml`, at least one
worksheet relationship, and semantic text bounded by `XLSX_LIMITS` (single-sheet
inline strings; values, formulas-as-text, multiple sheets, formatting-shaped values,
escaping, and Unicode are covered in the fixture).

The sole structured agent lane is authorized mutation of **one bounded existing cell range** in
the first sheet (reference `A1`-style with multi-letter columns; bounds-capped). The mutation
preserves every other validated part and cell. Out-of-bound, malformed, or never-authored
references fail closed. Formula-shaped content is treated as text and documented rather than
recalculated.

## Security and recovery boundary

Every create, open, save, mutation, and reopen path traverses the same bounded XLSX validator.
The in-memory OOXML reader rejects unsafe or duplicate paths, malformed/truncated directories and
local headers, unsupported flags, encrypted entries, gaps or overlaps in the local ZIP stream,
CRC mismatch, invalid UTF-8, malformed/unsafe XML declarations, macros, embedded objects/external
links, external relationships, and absolute or traversing relationship targets. Archive/entry/
expansion/entry-count/compression-ratio limits fail closed; the accepted native ceiling is not
weakened.

Agent callers cannot use the human candidate-save lane. Agent writes require a real
`CompletionReceiptResult`, are receipt-linked via `linkDocumentMutationToReceipt`, and are gated
on a resolvable canonical Entity receipt. Create/save/mutate claim the canonical
`document_operations` record before artifact writes, complete only after canonical evidence
succeeds, and become `uncertain` on post-write failure so an exact retry cannot rewrite.
Registry/version/event/activity persistence is supplied as one canonical database transaction by
the runtime contract. Stale expected revisions never silently overwrite.

## Tenant/workspace isolation

Per the accepted `LocalOfficeEngine` contract, the engine binds every document operation and
persistence write to the `workspaceId` supplied at construction; a document from one workspace
cannot reference another workspace's managed reference, and all canonical writes carry the single
workspace identity.

## Fixtures

- `packages/server/src/document-providers/local/fixtures/xlsx/full-fidelity.json`
- `packages/server/src/document-providers/local/fixtures/xlsx/README.md`

Tests convert the sanitized semantic JSON fixture into a real SpreadsheetML XLSX ZIP in memory
and reopen it through the production codec. No customer, personal, or external document is used.

## Passing verification

Commands ran locally under Node `22.22.3` (the checkout's `better-sqlite3` native module is not
buildable under the system Node 26):

```sh
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
cd packages/server
node ../../node_modules/vitest/vitest.mjs run \
  src/document-providers/local/xlsx-engine.test.ts \
  src/document-providers/local/docx-engine.test.ts \
  src/document-providers/local/engine-spike.test.ts \
  src/document-providers/local/safe-save.test.ts
# PASS: 4 files, 93 tests (31 XLSX + 43 DOCX + 6 engine contract + 13 safe-save).

npm run build   # PASS: server TypeScript build (tsc).
```

Generated `dist` output is ignored and was removed from the candidate (see limitations). The
focused XLSX suite is the milestone gate; the broader server suite retains the three unrelated
DOCX-era route failures documented in T-029 evidence and is unchanged by this candidate.

## Review disposition

Pre-final adversarial review findings were addressed and covered with regression tests: the sheet
row/cell scanner masking out structural rows, self-closing cell handling, bounded cell reference
limits, macro/embedded/external/traversal rejection (including entity-encoded variants), stale
revision determinism, unsupported mutation capability, unresolved-agent-receipt rejection, and
uncertain-on-evidence-failure recovery.

## Manual proof status and limitations

Manual browser/Electron → external editor → save → reopen proof was **not run** and is not
claimed; this checkout has only the accepted bridge authorization seam, no editor transport or
selected local editor. The automated proof is real SpreadsheetML construction, semantic reopen,
authorized-open invocation, safe-save composition, revisions/activity, canonical receipt
linkage, operation recovery, authorized range mutation, and malicious-package rejection.

Known capability limitations: XLSX only; one authorized single-cell range mutation lane; no
formula recalculation, charts, images, pivot tables, external links, macros, embedded objects,
shared strings, or full number/date fidelity claim; no external Excel/Office fidelity claim.
Multiple named sheets and formatting-shaped values are preserved at the semantics supported by
the inline-string codec.
