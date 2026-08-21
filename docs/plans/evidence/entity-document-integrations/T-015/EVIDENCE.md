# T-015 (THE-956) — Google Sheets create / bounded range mutation — EVIDENCE

Date: 2026-08-18 · Base: `e88649eadfdd05dadff2689490d137ab30915cd7` (T-014 approved) · Node 22 (`v26.5.0` runtime used; see Verification note) · Branch `runner/entity-document-integrations-20260818`

## Verbatim acceptance (phase2-canonical-prd.md, T-015 block)

> "Same required task contract as T-014, applied to spreadsheet/range semantics."

> "Not done until: range targeting and revision behavior pass."

## Deliverable

`packages/server/src/document-providers/google/sheets-adapter.ts` (+ its colocated test): a Google
Sheets adapter on the T-005 `DocumentProviderAdapter` contract, mirroring the T-014 Docs adapter's
transport-injected, capability-honest, fail-closed structure. Spreadsheet create + bounded §12.4
`set_range` mutation only; text/slide lanes and every undeclared surface fail closed with typed
`UnsupportedAdapterMutationError`.

## Acceptance one-liners (each RED→GREEN in `sheets-adapter.test.ts`)

- **create** — `create returns a provider descriptor with stable provider identity (spreadsheet artifact)` (RED at base by construction: adapter did not exist; GREEN after implementation). Create is transport-injected, idempotency-reconciling (`created:false` replay), fail-closed on degraded/unknown connections.
- **stable Entity URL** — `stable provider identity across create/read/getMetadata/open_external (external_id IS the spreadsheet id)`; provider_url is the durable Google workbook URL. No new registry: Entity-side stable URL mapping stays the T-004/T-008 machinery.
- **bounded range mutation (§12.4)** — `mutate applies ONLY the declared setRange envelope (sheet/range/values)` + `text mutation … FAILS CLOSED` + `slide mutation … FAILS CLOSED` + `a transport WITHOUT structured range mutation gets a TYPED rejection — never reinterpretation (§12.4)`. Only the declared `GoogleSheetsSetRangeRequest` kind is ever forwarded; every request is re-checked against `DECLARED_SHEETS_REQUEST_KINDS` before the transport call.
- **revision capture** — `every create/mutate captures the provider revision token (descriptor.current_revision === resultRevision, observable via fresh read)`; boundary strictness uses the THE-950-r2 extended unsafe set (it.each over U+2066–U+2069, U+FEFF, U+2060, U+00AD, U+061C, controls, metacharacters).
- **conflict rejection** — `mutation against a STALE revision fails closed (StaleRevisionError)` / `… UNKNOWN revision …` / `transport conflict maps to the typed provider-neutral retryable StaleRevisionError`.
- **range targeting** — `rejects a target whose sheet does not exist (fail-closed, no write)` + `rejects a malformed A1 range` + `rejects non-rectangular or type-unbounded values`; validation happens BEFORE any transport write.

Final count: **39/39 passing** in `sheets-adapter.test.ts`.

### Failing-test fix during this session (disclosure)

The typed-rejection negative initially failed with `TypeError: this.transport.createSpreadsheet is not a function`. Root cause was in the TEST harness, not the adapter: `stripRangeMutation` used an object spread of a class instance, which silently drops ALL prototype methods (not just `valuesBatchUpdate`). Fixed by preserving the prototype and shadowing `valuesBatchUpdate` with an own `undefined` property (exactly the capability probe the adapter uses). The test was NOT weakened; it now isolates exactly what it claims to.

## Carry-forward dispositions

- **F1/THE-955-r1 (docs-adapter live-state fold)** — DONE. `open_external`/`human_edit`/`version_history` fold from the folded live connection state (no hardcoded `'supported'`). Negatives added in `docs-adapter.test.ts` ("T-015 carry F1"): authorized→supported, degraded→degraded, unknown→unknown, unauthorized→unsupported, plus the degraded-transport-evidence-wins case. During this work the cross-source fold was aligned with the T-005 fake-adapter semantics (unauthorized dominates > degraded > unanimous-authorized > unknown) in BOTH adapters — still fail-closed at every step.
- **F2/THE-955-r1 (replace_text semantics)** — DONE as INSERT-only typed rejection. `replaceAllText` removed from `DECLARED_DOCS_REQUEST_KINDS`; anchorless replace cannot be expressed through the T-005 text lane, so there is no replace path and no silent prepend-as-replace. Tests: "replaceAllText is NOT in the declared request kinds" and "the text lane NEVER forwards an anchorless replaceAllText".
- **F6/THE-955-r1 (docs-adapter test gaps)** — DONE. Added: create-time unsafe-revision rejection negative (`create rejects a create-response revision containing an unsafe character`, asserting the T-014 EVIDENCE correction below), unauthorized-connection probe (capability states + create rejects typed), `discover({limit})`=2/truncated=true vs full discover truncated=false. Removed the dead `docsWithUnsafeRevision` harness field and its metaFor injection branch (superseded by the `nextReportedRevision` hook).
- **F7/THE-955-r1 (regex/comment reconciliation)** — DONE (in the inherited working-tree diff). The regex comment now documents that U+2028 (LINE SEPARATOR) is kept with rationale and that U+2022 (bullet, benign printable) was REMOVED; benign-token acceptance test retained.
- **F2-core/THE-950-r2** — DONE (in the inherited working-tree diff). `UNSAFE_TOKEN_CHARS` in `revision-coordinator.ts` extended with U+2066–U+2069, U+061C, U+FEFF, U+2060, U+00AD (+ comment), with RED→GREEN coverage in `revision-coordinator.test.ts`.

## T-014 EVIDENCE correction (THE-955 r1 F6)

A dated correction note was appended to `docs/plans/evidence/entity-document-integrations/T-014/EVIDENCE.md`: stale "Unresolved risk 1" resolved — create DOES validate the create-response revision via `requireSafeReportedRevision` inside `descriptorFor()`, proven by the new create-time negative test. No history rewrite.

## F8 disposition (spreadsheet artifacts vs Docs ARTIFACT_MIME_TYPES)

Observation only: the Docs adapter still admits `spreadsheet` in its `ARTIFACT_MIME_TYPES` map (docs-adapter.ts, base lines ~222–226) while route-level dispatch is out of this lane's path. With the Sheets adapter landing, the Sheets adapter is the owner of spreadsheet create/mutate SEMANTICS (structured §12.4 range lane); the Docs adapter's spreadsheet MIME admission is now redundant-but-harmless duplication to be reconciled in a route-owning wiring lane. No route dispatch was invented here; nothing was wired into production (`index.ts` untouched).

## Rule-outs (with citations)

- **PRD is read-only authority**: `docs/loom/entity-document-integrations/phase2-canonical-prd.md` not edited (T-015 block, §12.4, rows R-004/R-005/R-007 consulted only).
- **routes/\* out of path**: `routes/document-integrations.ts` and its test untouched. F3 (route envelope mapping for `UnsafeRevisionTokenError`) and F4 (fake-transport conflict `instanceof`) carry to the next route-owning lane, unchanged from THE-955 r1.
- **Sandbox/manual-proof deferral**: per `docs/loom/entity-document-integrations/BUILD-CONTEXT.md:38` ("Do not deploy a sandbox or production environment as part of this Loom run."), no sandbox deployment or browser proof; defers to T-038/T-039. Automated proof = the transport-injected adapter contract suites (`runAdapterContractSuite` runs against the Docs adapter; Sheets has its own deterministic suite).
- **Receipt wiring deferred**: routes keep `receiptId: null` exactly as at base (t010-wiring-deferral-signoff pending Henry); nothing wired.
- **OQ-003 / OQ-018 open observations**: the `confirmed` body boolean remains caller-attested (NOT a human-confirmation control); `capability_resolver_enforcement` flag wiring untouched. No product defaults invented.
- Other out-of-path files untouched: `types.ts`, `fake-adapter.ts`, `write-policy.ts`, `document-objects.ts`, `packages/server/src/index.ts`, receipt-writer, `DocsSettings.tsx`.

## Verification commands & results (Node 22)

| Command | Result |
| --- | --- |
| `npx vitest run src/document-providers/google/sheets-adapter.test.ts` | 39/39 pass |
| `npx vitest run …/sheets-adapter.test.ts …/docs-adapter.test.ts …/revision-coordinator.test.ts` | 3 files, 131/131 pass |
| `npm run build` (strict tsc) | pass (exit 0) |
| full server suite | see final-answer transcript (run at final HEAD) |
| `git diff --check` | clean |

## Open-question observations (no invented defaults)

- Sheet-tab existence is validated against the workbook metadata reported by the injected transport; real-Google tab enumeration semantics belong to the concrete transport implementation (out of scope here).
- Preview/version-history/permissions remain honestly `unsupported` on the Sheets adapter (deferred surfaces T-038/T-039).

---

# R2 addendum — THE-956 GLM 5.3 review round 1 fixes (2026-08-18)

Base for this round: `b8cf3d3` (r1 commit). All blocking findings fixed with RED→GREEN discipline; RED confirmed at base before each fix (22 failing tests for the stated reasons), then GREEN.

## Note on the verdict file
`reviews/THE-956-b8cf3d3-glm53-r1-verdict.md` was not present at the stated runner-root path (nor anywhere discoverable on this machine); this round was executed from the full finding set quoted in the dispatch (C1/C2/C3/T1/T2 + minors (i)/(ii)/T3). No finding was skipped for lack of the file.

## C1 — bare-range sheet resolution (FIXED, reviewer option (a): first sheet from workbook metadata)
- `sheets-adapter.ts`: `parsed.sheet ?? workbook.title` replaced by `parsed.sheet ?? workbookMetadata.sheets[0]?.title` (Google A1 semantics); a workbook reporting no tabs fails closed typed. The workbook metadata is now resolved exactly once per mutate (see minor (ii)).
- RED→GREEN: "wrong-tab vector: workbook titled like a tab — bare A1 targets the first tab (Data), NOT \"My Workbook\"" (RED at base: forwarded sheet was `"My Workbook"`); "typical workbook (title matches no tab): bare A1 still targets the first tab"; "a workbook reporting NO tabs fails closed typed".

## C2 — multi-cell ranges typed-rejected (FIXED, reviewer-sanctioned typed-reject option)
- `sheets-adapter.ts` mutate: any parsed range containing `:` is rejected with `UnsupportedAdapterMutationError` before any transport write (the single-value T-005 range lane cannot express a full rectangular §12.4 grid; a forwarded 1×1 grid would be a silent partial write under real `values.update`).
- RED→GREEN: "Sheet1!A1:B2 NEVER reaches the transport with a mismatched 1×1 values envelope" (RED at base: envelope forwarded; GREEN: typed reject, `recordedRangeUpdates` empty). This test drives the PRODUCTION `mutate` lane (T2(a)).

## C3 — canonical shared unsafe-token set (FIXED via shared export; tightened only)
- `revision-coordinator.ts` now exports `UNSAFE_REVISION_TOKEN_CHARACTERS` — the union of the previous coordinator strip set and the previous adapter reject set (adds U+2028 to the strip set; adds C1 U+0080–U+009F, U+200B–U+200D, `'`, `&`, `\` to both adapter reject sets). Both Google adapters consume the exported constant; the sanitizer strips via a `/g` copy of the same source. Only tightened, never loosened. The false "matches" comment was replaced with an accurate shared-set description.
- Boundary rejections remain the typed `UnsafeRevisionTokenError` (never a generic conflict).
- RED→GREEN: ZWSP (`rev\u200bX`), ZWNJ, C1 U+0085, apostrophe, ampersand, backslash now rejected typed at BOTH adapter boundaries (RED at base: passed the boundary as generic `StaleRevisionError`); coordinator equivalence pinned by "every unsafe probe is BOTH stripped by the sanitizer AND matched by the canonical class" / benign-probe negative (RED at base: U+2028 not stripped).

## T1 — A1 bounds and ordering enforced for the RIGHT reason (FIXED)
- Implemented the row bound the module's own comment documents: row ≤ 1048576 (`MAX_A1_ROW`); reversed ranges (start after end on either axis, columns compared base-26) rejected; `parseCellSelector` now applies both; mutate reports the SPECIFIC reason (`row exceeds the documented A1 bound (1048576)` / `range start is after its end (reversed)`). The `A1:C1048577` case was removed from the generic malformed list and now has a dedicated test asserting the BOUNDS reason.
- Column bound: NO column limit beyond the 1–3-letter pattern is enforced — no wider column bound (e.g. XFD/16384) is documented in-tree; recorded as an observation, not invented.
- RED→GREEN: `Sheet1!A9999999` and `Sheet1!B2:A1` (RED at base: both reached the transport unvalidated — `recordedRangeUpdates.length === 1`); `A1:C1048577` (RED at base for message-shape reason: rejected via C1 sheet lookup, not bounds).

## T2 — suite gaps (ALL closed)
- (a) multi-cell range through the production `mutate` lane = the C2 test above (PRD §12.4 canonical shape exercised end-to-end through `adapter.mutate`, not just pattern units).
- (b) `vanishAll` is now real harness: vanished-artifact tests for BOTH `read` and `mutate` asserting typed `AdapterArtifactNotFoundError` (pairs with minor (ii)).
- (c) read-lane enforcement on `unauthorized` is now asserted via `adapter.read` THROWING `UnsupportedAdapterMutationError`, in addition to report states.
- (d) `isRectangularValues`/`isTypeBoundedValues` are now ENFORCED inside `mutate` on the outbound envelope before any transport write (defense in depth over the statically-typed `[[value]]` construction); exports retained and now load-bearing.

## Minors
- (ii) FIXED: `mutate` no longer calls `getSpreadsheet` with a non-null `!`; the pre-write metadata read is resolved once with a typed `AdapterArtifactNotFoundError` on null. The post-write revision refresh remains a second (legitimate) read and also fails typed — proven by the vanish-on-Nth-call probe (RED at base: untyped `TypeError: Cannot read properties of null`).
- (i) EVIDENCE wording corrected: the r1 sentence "fold precedence aligned with the T-005 fake-adapter semantics" overstated identity. Accurate statement: the Google adapters fold `unauthorized → unsupported` (writes typed-reject) while the T-005 fake adapter folds unauthorized to `degraded`; both fail closed for write lanes, but the fold targets differ by design.
- T3 (no code): the §19.2 shared-contract-fixture deferral for the Sheets adapter carries to the ROUTE/WIRING lane — `contract.test.ts` remains outside T-015's path set and was not touched.

## Rule-outs (r2)
- Only the five allowed source/test files plus this EVIDENCE file were modified. Explicitly untouched and verified via `git status`: `routes/*`, `index.ts`, `receipt-writer`, `fake-adapter.ts`, `types.ts`, `write-policy.ts`, `contract.test.ts`, PRD, OpenWiki. No receipt wiring, no registry/namespace/event table, no push, no deploy.

## Verification commands (Node 22.22.2)
| Command | Result |
| --- | --- |
| focused: `npx vitest run src/document-providers/google/sheets-adapter.test.ts src/document-providers/google/docs-adapter.test.ts src/document-providers/revision-coordinator.test.ts` | RED at base: 22 failed / 134 passed; GREEN at fix: 156/156 pass |
| `npm run build` (strict tsc) | exit 0 |
| full server suite (Node 22) | 213 files / 2112 tests pass (under default Node 26 the documented better-sqlite3 NODE_MODULE_VERSION 127-vs-147 ABI mismatch reproduces — environmental, not code) |
| `npm run ctrl:gate` | PASSED (exit 0; the previously documented std-env/vitest hoisting crash did NOT reproduce under Node 22) |
| `git diff --check` | clean |

## Open-question observations (r2)
- No column bound beyond the A1 pattern is enforced (none documented in-tree); if the PRD later documents XFD/16384, extend `classifyA1Range` with a cited bound.
- The canonical token set is now strictly larger at the adapter boundary; any real provider token containing C1 controls, zero-width format characters, or `'&\` would now be typed-rejected — judged correct fail-closed behavior for opaque concurrency tokens.
