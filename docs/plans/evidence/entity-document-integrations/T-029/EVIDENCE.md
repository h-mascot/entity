# T-029 Evidence — Local DOCX milestone

## Reviewed scope

The candidate is based on integrated runner SHA
`0b6e4a746116e04463329782c24d400bfb36ff3d`. All work and proof ran in the requested isolated
worktree. No merge, push, deployment, Linear mutation, runner-state edit, or other worktree was
used.

`LocalDocxEngine` implements the accepted `LocalOfficeEngine` seam and composes the existing
managed-reference, safe-save, registry, version/event, normalized activity, canonical receipt,
and document-operation boundaries. The lifecycle fixture proves semantic create, stable
`/documents/:id` link, authorized open, human candidate save/reopen, and receipt-linked bounded
agent text append. No engine input accepts a host path.

The authored fixture covers paragraphs, headings, lists, tables, bold/italic styling, XML
escaping, and Unicode. Images are not claimed. Agent mutation preserves every validated package
part and appends one plain paragraph; it does not claim byte identity or external Office fidelity.

## Security and recovery boundary

Every create, open, save, mutation, and reopen path traverses the same bounded DOCX validator.
The in-memory OOXML reader rejects unsafe or duplicate paths, malformed/truncated directories and
local headers, unsupported flags/data descriptors/compression, encrypted entries, gaps or overlaps
in the local ZIP stream, CRC mismatch, invalid UTF-8, malformed XML, unsafe XML declarations,
macros, ActiveX/OLE/imported/embedded content, external relationships, and absolute or traversing
relationship targets. XML policy checks decode character references and match dangerous local
names independently of namespace prefix. Archive, entry, aggregate expansion, entry-count, and
compression-ratio limits fail closed; the accepted native 1 MiB ceiling was not weakened.

Agent callers cannot use the human candidate-save lane. Agent writes require a real
`CompletionReceiptResult`, use `linkDocumentMutationToReceipt`, and are covered by a complete
auditor traversal from Entity action through receipt, document operation, revision, and local
artifact. Create/save/mutate claim the canonical `document_operations` record before artifact
writes, complete only after canonical evidence succeeds, and become `uncertain` on post-write
failure so an exact retry cannot rewrite. Registry/version/event/activity persistence is supplied
as one canonical database transaction by the runtime contract.

## Adjacent same-issue paths

- `local/ooxml-package.ts` isolates the hostile bounded ZIP/XML package boundary.
- `local/document-operation.ts` adapts the existing operation repository's
  claim/completed/uncertain lifecycle; it adds no store or schema.
- `local/engine-spike.ts` and its test complete the accepted engine interface with create,
  canonical mutation, actor/receipt, revision, candidate, and idempotency fields needed by T-029.
- The durable plan, active plan, task checklist, and this evidence file satisfy repository
  execution/review requirements.

No provider-neutral route, production adapter registry, Electron transport, or UI path changed.
The issue map assigns T-029 implementation to the engine/tests/fixtures, while the accepted bridge
is security-only and no editor transport or local editor has been selected. Inventing those
missing layers would decide open product questions without authority and still would not produce
honest external-editor proof.

## Fixtures

- `packages/server/src/document-providers/local/fixtures/docx/full-fidelity.json`
  SHA-256 `9b93433868a2422f48c9d90004a31ece32d4672c8a2142ba901ae91f963799f4`
- `packages/server/src/document-providers/local/fixtures/docx/README.md`
  SHA-256 `1f094d2b8acdae10621f8eb814f8b63c3562be981dcd22d30bb94a1a10abb801`

Tests convert the sanitized semantic JSON fixture into a real ZIP/OOXML DOCX in memory and reopen
it through the production codec. No customer or external document is used.

## Passing verification

Commands ran locally under Node `22.22.3`:

```sh
cd packages/server
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  src/document-providers/local/docx-engine.test.ts \
  src/document-providers/local/engine-spike.test.ts
# PASS: 2 files, 49 tests (43 DOCX + 6 engine contract).

PATH=/opt/homebrew/opt/node@22/bin:$PATH node ../../scripts/build-managed-storage-broker.mjs
# PASS: native core and IPC entrypoint compiled; direct native tests passed.

/opt/homebrew/opt/node@22/bin/node ../../node_modules/vitest/vitest.mjs run \
  src/document-providers/local/docx-engine.test.ts \
  src/document-providers/local/engine-spike.test.ts \
  src/document-providers/local/bridge.test.ts \
  src/document-providers/local/managed-storage.test.ts \
  src/document-providers/local/safe-save.test.ts \
  src/fs/managed-storage-broker.test.ts \
  src/fs/adapters/local.test.ts \
  src/fs/adapters/local.integration.test.ts \
  src/document-providers/activity-adapter.test.ts \
  src/document-providers/activity-adapter.integration.test.ts \
  src/document-providers/revision-coordinator.test.ts \
  src/document-providers/contract.test.ts \
  src/routes/document-integrations.test.ts
# PASS: 13 files, 212 tests.

PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build
# PASS: server TypeScript build.

cd ../..
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build
# PASS: app, db, and server builds.

npm run scan:private-defaults -- --enforce
# PASS: 931 files scanned; 0 errors; 242 existing baseline warnings.

npm run test:release-deploy
# PASS: 14 tests.

git diff --check
# PASS.
```

Generated `dist` output is ignored. The native `.build` directory used by the broker tests was
moved to Trash after verification and is absent from the candidate.

## Broader gate result

The full server suite built successfully and reported 226/228 files and 2352/2355 tests passing.
All 43 T-029 DOCX tests passed. The three failures are outside and unchanged by the candidate
(`git diff <base> --` is empty for their source/tests):

1. `src/fs/routes-files.test.ts`: hard-ceiling read expects 413, receives 500.
2. `src/fs/routes-files.test.ts`: missing file expects 404, receives 500.
3. `src/routes/legacy-files.test.ts`: symlink escape expects 403, receives 400.

The concurrent full run also emitted broker-process `EPIPE` noise after those route failures. The
212-test local/native matrix passes without it. Raising the broker ceiling, bypassing the broker,
or changing unrelated route error mapping was rejected as unsafe scope expansion.

`npm run ctrl:gate` and `bash scripts/proof/entity-phase-2-smoke.sh` were rerun on the final working
diff. Both build successfully and stop at exactly those same three server assertions. These remain
repository release blockers even though the focused T-029 implementation and accepted adjacent
seams are green.

## Review disposition

Pre-final Codex and adversarial review findings were reproduced and fixed with regression tests:

- agent arbitrary-save bypass and malformed XML acceptance;
- encoded relationship/content-type policy bypasses and namespace-prefix variants;
- XML-comment-shaped mutation insertion;
- XML-illegal semantic create content;
- unaccounted ZIP bytes, unsupported descriptors/flags, and local-stream gaps;
- arbitrary receipt identifiers instead of canonical receipt linkage/traversal;
- artifact writes without operation claim/completed/uncertain recovery;
- mutation retry consulting stale revision before an existing uncertain operation.

Final Codex, two-axis, thermo-nuclear, and Jeff Dean review outcomes are recorded in the task
review receipt after closure.

## Manual proof status and limitations

Manual browser/Electron → external editor → save → reopen proof was **not run** and is not claimed.
This checkout has the accepted bridge authorization seam but no editor transport, selected local
editor/engine, or production `local_office` adapter, so there is no honest browser/Electron path to
exercise. This is an explicit T-029 integration/release blocker, not hidden evidence.

Known capability limitations: DOCX only; one plain-paragraph append agent lane; no images,
comments, tracked changes, macros, embedded objects, external relationships, arbitrary agent
replacement, or external Office fidelity claim. The automated proof is real OOXML construction,
semantic reopen, injected authorized-open invocation, safe-save composition, revisions/activity,
canonical receipt traversal, operation recovery, and malicious-package rejection.
