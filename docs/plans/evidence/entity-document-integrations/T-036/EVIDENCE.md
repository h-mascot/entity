# T-036 (THE-977) — Cross-provider contract/E2E matrix — Evidence

Ticket: Linear THE-977 / T-036 — Entity Document Integrations, P-06 Observability and
cross-provider QA.

Base HEAD: `3b2bd2824ba7d4083c84c7289a7fddc91159e0f5` (immutable).

Scope: §20 "Cross-Provider MVP Acceptance Matrix" — every required cell tied to automated
proof or an EXPLICIT, truthful manual/deferred disposition across Google Workspace,
Microsoft 365, and local Office. No production implementation was modified to make a matrix
cell pass; no provider support was invented; no competing API namespace, registry, receipt
store, event table, or UI was added (T-037/T-038 out of scope).

## Scope (primary ticket paths touched)

- `packages/server/src/document-providers/e2e.test.ts` — NEW cross-provider §20 acceptance
  matrix. A data-driven `SECTION_20_MATRIX` ledger maps every §20 cell × provider to either
  an `automated` proof (a real seam suite that executes here or a referenced colocated
  suite) or an explicit `manual`/`deferred` disposition. Machine tests walk the ledger and
  reject empty/fabricated proof, then execute real seam probes:
  - Google: runs the SHARED §19.2 provider contract suite (`runAdapterContractSuite`) against
    a **real `google_workspace` docs adapter** (injected deterministic transport), plus real
    Google docs/sheets/slides capability-truthfulness and bounded-mutation/degraded
    fail-closed probes.
  - Microsoft: `createMicrosoftArtifact` create-by-format (document/spreadsheet/presentation)
    over an injected transport + in-memory canonical repository; capability-honest assertion
    that all three mutation lanes are non-actionable (`microsoftMutationAllowed` false;
    `microsoftCapabilityState` never `supported`); read-state normalization never leaks
    tokens.
  - Local Office: pure bounded engines — DOCX text (`appendTextToDocx`), XLSX range
    (`setXlsxRange`), PPTX slide (`setSlideText`) each advance the deterministic sha256
    revision; `LocalBridgeSecurity` non-ready gate rejects handshake/authorize (auth/degraded
    cell); stale-revision conflict seam.
  - Cross-cutting: the ledger asserts no cell is stamped `automated` with an empty/fabricated
    proof and Microsoft mutation cells are automated ONLY as capability-honest denial.
- `docs/plans/evidence/entity-document-integrations/T-036/EVIDENCE.md` — this file
  (issue-required evidence destination).

The canonical PRD was treated as read-only. `contract.test.ts` is the shared-suite source
that `e2e.test.ts` imports and reuses — no competing fixture was added. No app path changed,
so no `packages/app` build/typecheck is required by the proof gate.

No colocated existing test helper was copied or modified (the deterministic Google transport
in `e2e.test.ts` is a minimal inline reconstruction of the T-014 transport, kept colocated so
the matrix does not edit out-of-path test files).

## Section 20 matrix coverage (cell × provider → evidence)

Legend: ✅ = automated seam execution (this or a referenced suite); 🔸 = explicit manual or
deferred disposition (truthful, no fabricated parity).

| §20 cell | Google | Microsoft | Local Office |
|---|---|---|---|
| Stable Entity identity | ✅ adapter stable `external_id` + registry canonical id (`google/*.test.ts`, `registry.test.ts`) | ✅ `createMicrosoftArtifact` stable `providerIdentity`; reconciler `sameEntityDocumentIdentity` (`create-adapter.test.ts`, `reconciler.test.ts`) | ✅ sha256(package) revision determinism + `createManagedLocalFileReference` (`local/*engine.test.ts`, `managed-storage.test.ts`) |
| Human create | ✅ create lane + idempotent replay (`docs-adapter.test.ts` shared suite) | 🔸 create seam proven by injected transport; live M365 auth/route activation deferred — manual | 🔸 DOCX create staged per PRD §20; local human-create UX needs live bridge — deferred |
| Agent create document | ✅ docs create + T-032 `document.create` (`tools.test.ts`) | ✅ `createMicrosoftArtifact` document→docx (e2e) | 🔸 DOCX agent create staged — deferred |
| Agent create spreadsheet | ✅ sheets + T-032 `spreadsheet.range.update` (`sheets-adapter.test.ts`, `tools.test.ts`) | ✅ `createMicrosoftArtifact` spreadsheet→xlsx (e2e) | 🔸 XLSX create staged (pre-3-format) — deferred |
| Agent create presentation | ✅ slides + T-032 `presentation.slide.update` (`slides-adapter.test.ts`, `tools.test.ts`) | ✅ `createMicrosoftArtifact` presentation→pptx (e2e) | 🔸 PPTX create staged (pre-3-format) — deferred |
| Preview | ✅ capability-aware `getPreview` readiness (R-034) | ✅ `normalizeMicrosoftReadState` capability-aware preview (e2e) | 🔸 local preview requires desktop/engine — deferred |
| Human edit | ✅ `getOpenTarget` provider edit URL | 🔸 open-in-M365 requires live tenant — manual | 🔸 open-local via desktop bridge — manual |
| Structured text mutation | ✅ docs bounded `insertText` envelope, bounded length, stale rejection | ✅ CAPABILITY-HONEST unsupported (`microsoftMutationAllowed=false`) | ✅ `appendTextToDocx` bounded text + revision advance (e2e) |
| Structured range mutation | ✅ sheets bounded range lane | ✅ CAPABILITY-HONEST unsupported | ✅ `setXlsxRange` bounded range + revision advance (e2e) |
| Structured slide mutation | ✅ slides bounded slide-text lane | ✅ CAPABILITY-HONEST unsupported | ✅ `setSlideText` bounded slide + revision advance (e2e) |
| Versions/activity | ✅ `getVersions` + version capture + `activity-adapter` | ✅ revision capture + reconciler change tracking (`reconciler.test.ts`) | 🔸 revision determinism proven; full local version/activity UI deferred |
| Conflict rejection | ✅ typed `StaleRevisionError` across docs/sheets/slides | ✅ create idempotency conflict + stale reconcile | ✅ safe-save stale-revision rejection (`safe-save.test.ts`); e2e revision precondition |
| Auth/bridge degraded state | ✅ unknown/degraded folds write lanes fail-closed | ✅ TENANT_MISMATCH / revoked / degraded → `CONNECTION_NOT_READY` (`connection.test.ts`) | ✅ `LocalBridgeSecurity` non-ready rejects handshake/authorize (e2e) |
| Search/associations | ✅ discover + reconcileChanges idempotent | 🔸 OneDrive/SharePoint search requires live tenant — manual | 🔸 local file search over managed storage requires desktop bridge — manual |

Capability honesty note: Google supports its text/range/slide lanes; Microsoft's three
mutation lanes are truthfully **unsupported** at the capability spike (no runtime/product
authorization lane) — never fabricated as parity. Local Office engines prove bounded text/
range/slide mutation at the pure byte level, while local create/preview/search cells remain
staged per PRD §20 and are recorded as deferred/manual.

## Proof (Node 22, `packages/server`, Vitest)

Environment: Node v22.22.2 via nvm; deps installed with `npm ci` (isolated cache). All
commands run from `packages/server`.

- `npx vitest run src/document-providers/e2e.test.ts` — **PASS (43/43)**.
  The RED-before-GREEN loop was recorded: the first run failed 4 local-fixture/signature
  assertions; each was fixed to assert the genuine seam semantics, then went green. No
  production code changed.
- `npx vitest run src/document-providers/contract.test.ts` — **PASS (17/17)** (shared §19.2
  suite reused by the matrix).
- `npx vitest run src/document-providers src/agent/tools.test.ts` — **PASS 682/685 across
  26/27 files.** The only failing file is the PRE-EXISTING `local/managed-storage.test.ts` (3
  errors), which requires the native `native/managed-storage-broker/.build/broker` binary
  that is not built in this isolated worker. It is unrelated to T-036 (the matrix does not
  touch managed-storage) and fails identically at base HEAD; recorded as an environment
  limitation, not a regression.
- `npx tsc` (server build/typecheck) — **PASS (exit 0)**.
- `git diff --check` — **PASS (exit 0)** (see verification section).

### Relevant existing provider/agent-tool/local-engine/UI-contract suites (re-run, GREEN)
`src/document-providers/google/docs-adapter.test.ts` (79), `slides-adapter.test.ts`,
`sheets-adapter.test.ts`, `microsoft/capability-spike.test.ts`, `microsoft/create-adapter.test.ts`
(28), `microsoft/connection.test.ts`, `microsoft/reconciler.test.ts`,
`local/engine-spike.test.ts`, `local/docx-engine.test.ts`, `local/xlsx-engine.test.ts`,
`local/pptx-engine.test.ts`, `local/bridge.test.ts`, `src/agent/tools.test.ts`,
`capability-resolver.test.ts` all pass.

## Limitations / explicit deferred cells

- **Microsoft mutation search/associations & versions-vs-live** — no runtime/product
  authorization lane exists; all three mutation lanes are capability-honest `unsupported`.
  `create-adapter` injectable transports prove create-by-format; live tenant behaviors
  (M365 edit/open, OneDrive/SharePoint search) require a real authorized tenant and are
  recorded **manual**.
- **Local Office create/preview/search** — DOCX create is staged; XLSX/PPTX create staged
  (pre-3-format completion per PRD §20). Local preview/human-edit/search require the desktop
  bridge and are recorded **manual/deferred**.
- **Google search/associations** beyond adapter `discover`/`reconcileChanges` idempotency is
  not automated here; real Google Drive discovery scope is a live-surface milestone.
- **managed-storage.test.ts** native broker binary unavailable in this worker — pre-existing,
  out of T-036 scope.

No credentials, tokens, tenant secrets, document contents, or operator-specific absolute
paths are included in this evidence. No production source file changed; only the new matrix
test and this evidence were added.

Final commit SHA: to be filled by the supervisor in the external receipt (not self-referential).
