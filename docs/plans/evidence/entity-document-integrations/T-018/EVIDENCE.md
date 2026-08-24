# T-018 (THE-959) — Google preview/open/permissions states — EVIDENCE

Base: `65a63b5be67bfa29660339d43d69b9c15d0bc672` (T-017 approved). Branch: `runner/entity-document-integrations-20260818`.

## Verbatim authority quotes

Ticket block (phase2-canonical-prd.md ~:3892):

> ### T-018 — Implement Google preview/open/permissions states
>
> Dependencies: T-012.
>
> Acceptance: R-009 and permissions-summary honesty.
>
> Manual proof: browser capture/proof.

R-009 (~:959-981):

> Entity may preview Google artifacts where supported and reliable.
>
> Full human editing uses Edit in Google.
>
> Embedding must remain unsupported unless independently proven.
>
> Acceptance criteria
>
> Preview failure does not remove the provider open action.
>
> Edit action opens the correct provider artifact.
>
> UI never labels a preview as a full Entity-native editor.
>
> Validation
>
> Browser visual proof.
>
> Provider-link test.
>
> Preview failure test.

§9.3 Permission summary (~:1936-1945):

> UI may show:
>
> Private
> Workspace-shared
> Organization-shared
> Link-shared
> External sharing detected
> Unknown
>
> Only values actually derivable from provider evidence may be displayed.

§9.4 Write-disabled state (~:1947+):

> The UI must not tell the user the provider itself is read-only when only Entity's integration policy is read-only.

Dependency graph row (~:4199): `+--> T-017` / `+--> T-018` (T-018 hangs off the completed T-012 chain).

## RED → GREEN proof per acceptance element

RED was reproduced at base (module absent / fields absent), then implemented, then GREEN.

| Element | RED failing tests | GREEN |
|---|---|---|
| R-009.1 preview-failure-preserves-open | server `keeps the provider open action when preview fails (R-009 criterion 1)` + `...preview evidence is unknown...` (module import failed at base); app `R-009.1: preview failure does not remove the provider open action` (TS compile fail at base) | both pass |
| R-009.2 edit-action-opens-correct-artifact | server `resolves the edit action to the provider-evidenced artifact URL, never minted`; app `R-009.2: the edit action resolves the provider-evidenced artifact URL` | pass |
| R-009.3 preview-never-labeled-native-editor | server `never labels the preview as an Entity-native editor (R-009 criterion 3)`; app `R-009.3: preview is never labeled as an Entity-native editor` (`previewLabel`, `previewIsNativeEditor: false`) | pass |
| permissions-summary-honesty §9.3 | server `maps provider sharing evidence into the §9.3 vocabulary only`, `never downgrades detected external sharing...`, `returns Unknown when no provider evidence...`; app `§9.3: permission summaries outside the derivable vocabulary collapse to Unknown`, `§9.3: provider sharing evidence maps into the allowed vocabulary and never downgrades external sharing` | pass |
| §9.4 write-disabled framing | server `frames write-disabled as Entity integration policy, never as provider read-only`, `distinguishes genuine provider read-only evidence...`; app `§9.4: Entity-integration-policy read-only messaging never blames the provider`, `§9.4: genuine provider write-protection evidence is attributed to the provider` | pass |

Provider-link test: app `R-009.1`/`R-009.2` assert `openUrl`/`editUrl` equal the provider-evidenced canonical URL exactly; server asserts URL null when metadata carries no link evidence (never minted).
Preview-failure test: named above; structural assertion on `canOpen`/`openUrl`/`editUrl`, not merely "no crash".

## Commands and exit codes (Node 22.22.2 via nvm; Node 26 default has better-sqlite3 ABI mismatch)

1. `cd packages/server && npx vitest run src/document-providers/google/read-state.test.ts` — RED first (import error, exit 1); final: `Test Files 1 passed (1)` / `Tests 11 passed (11)`, exit 0.
2. `cd packages/app && TS_NODE_PROJECT=tsconfig.test.json node --loader ts-node/esm --test src/components/mission-control/utils/__tests__/externalDocumentPreview.test.ts` — RED first (TS missing-member compile failure under default Node 26); final under Node 22: `pass 13 / fail 0`.
3. `cd packages/server && npm run build` — strict tsc clean (initial run surfaced one fixture-typing error in the new test file; fixed by mirroring capability-resolver's `Record<CapabilityType, ResolvedCapability>` build+cast; re-run clean).
4. `cd packages/app && npm run build` — tsc && vite build succeeded, exit 0.
5. Full server suite at final HEAD: `npx vitest run` — **216 files passed / 2162 tests passed** (ticket expected 215/2151+; delta = this ticket's 1 new file / 11 new tests plus intervening approved lanes' growth since the ticket text was written).
6. `npm run ctrl:gate` — run 1 aborted with `Tests 1 failed | 2161 passed` (the known pre-existing environmental flake documented in T-017 EVIDENCE S7); rerun once: `[ctrl] gate passed ✅`, exit 0. Both results stated verbatim.
7. `git diff --check` — clean.

## Implementation summary

- `packages/server/src/document-providers/google/read-state.ts` (NEW, pure/unwired library like T-017 reconciler): `deriveGoogleReadState({capabilityReport, providerMetadata, entityIntegrationWriteAllowed})`. Preview folds through T-006 resolver vocabulary (supported/degraded actionable; unsupported/unknown fail closed with reason code). Open/edit URLs derived ONLY from provider-evidenced link fields; never minted from IDs. Preview failure never removes open/edit (R-009.1); only absent link evidence or non-actionable `open_external` does (fail closed). Permission summary maps provider sharing tokens into the exact §9.3 vocabulary, most-exposed-wins so external sharing is never downgraded; unrecognized → `Unknown` + `permissionSummaryDerivable:false`. §9.4 framing distinguishes `entity-integration-policy` from `provider` write protection with distinct honest messages.
- App view-model additions (backward-compatible; no existing field changed shape or value except `externalPermissionSummary`, which now collapses raw free-text to `null` per §9.3 — disclosed here as an intentional honesty fix forced by "Only values actually derivable from provider evidence may be displayed"; its previous verbatim passthrough could display arbitrary strings): new fields `externalPermissionSummaryKnown`, `editUrl`, `editLabel: 'Edit in Google'`, `previewLabel`, `previewIsNativeEditor: false`, `writeDisabledSource`, `writeDisabledMessage`. `mutationControlsVisible: false` discipline preserved everywhere.

## Rule-outs (explicit)

- `docs/loom/entity-document-integrations/phase2-canonical-prd.md` — READ-ONLY AUTHORITY; quoted, never edited.
- `packages/server/src/document-objects.ts` and `packages/server/src/google-docs-metadata.ts` — out of path. THE-953 r1 F1 open_external-derivation and F2-guard-half export-lane carries belong to the next `document-objects.ts`-owning lane; not acted on.
- `packages/server/src/document-providers/google/reconciler.ts` (+test) — out of path; THE-958 r1 F1-F4 carries → next reconciler-owning/wiring lane. F5 fold-type `source` mapping likewise wiring-lane, untouched.
- `packages/db/src/index.ts` — out of path; THE-953 r1 F3 carry on a db-owning lane, untouched.
- `routes/*`, adapters (`google/docs-adapter.ts`, `sheets-adapter.ts`, `slides-adapter.ts`), `types.ts`, `fake-adapter.ts`, `revision-coordinator.ts`, `write-policy.ts`, `index.ts` — observed untouched (`git status` shows only the four allowed paths). No production wiring added; nothing mounted; no route changes.
- Browser visual proof (R-009 validation bullet 1) — DEFERRED to manager-side browser capture at T-038/T-039 per BUILD-CONTEXT.md delivery boundary (~:30-45): "For T-038 through T-040, the usual 'Always Land on Main' rule is suspended by the canonical PRD…", "Do not merge this branch.", "Do not deploy a sandbox or production environment as part of this Loom run." Semantics covered by deterministic automated tests instead.
- Receipt wiring stays deferred (`receiptId: null` semantics untouched; pending Henry `t010-wiring-deferral-signoff`). No new flag host, API namespace, receipt store, event table, package dependency, or live network call.

## Standing observations (no action taken)

- OQ-003 `confirmed` caller-attested body boolean — unchanged.
- OQ-018 `capability_resolver_enforcement` flag-reuse coupling — unchanged.
- Scoped AGENTS PRD-hash pin drift — noted; authority-pin-drift escalation pending; pins not edited.

## Unresolved risk

None blocking. Note: the R-009 "Embedding must remain unsupported" line is honored structurally (`embed_editor` remains in FAIL_CLOSED_CAPABILITIES; nothing here surfaces embedding affordances).

## r2 Addendum — THE-959 GLM 5.3 round-1 review fixes (2026-08-21, base `2e37eb83…`)

Round 2 of 3. All blocking findings (B1, B2) and in-path should-fixes (S2, S3, S4) fixed RED→GREEN; S1 recorded per manager-directed record-only disposition. Allowed paths only: `read-state.ts`/`read-state.test.ts`, `externalDocumentPreview.ts`/`__tests__/externalDocumentPreview.test.ts`, this EVIDENCE file.

### Findings fixed

- **B1 — write-disabled message honesty (§9.4/R-009).**
  - Server (`read-state.ts`): provider-read-only message is now derived from the same object's affordances — claims "You can still preview it." ONLY when preview is actionable in that same return object, otherwise "read-only on the provider side, and no further actions are available for it here."; entity-policy message claims an open target only when `openUrl` is non-null.
  - App (`externalDocumentPreview.ts`): restricted-branch message rewritten to claim nothing ("…Entity permissions restrict this document, so no preview or open action is available here." — no "can still"/"you can"); main-path messages now branch on the same view's actual `previewAvailable`/`canOpen`.
  - RED→GREEN: server test "§9.4 honesty: the provider read-only message never claims a preview the same object suppresses" failed at base (message contained suppressed-affordance claims), passes at fix. App tests B1a/B1b could not even import at base (missing export) and after export-existence fix fail against base logic's hardcoded promises — both pass at fix.
- **B2 — editUrl unavailable-ref masking (R-009.2).** `editUrl` now consumes the masked value (`maskedOpenUrl`, null under `externalRefUnavailable` for deleted/permission-revoked refs), symmetric with `openUrl`/`canOpen`. RED→GREEN: app tests "B2: editUrl is masked when the external ref is unavailable (deleted)" and "(permission-revoked)" failed at base (`editUrl` carried the live URL), pass at fix.
- **S2 — app/server derivation parity.** App link-token set gains `'linkshared'`; both sides now export their canonical token map (`GOOGLE_SHARING_EVIDENCE_TOKENS_BY_SUMMARY` / `PERMISSION_SUMMARY_EVIDENCE_TOKENS_BY_SUMMARY`) with identical member lists, pinned by a `toEqual`/`deepEqual` parity test on each side. §9.4 evidence-key divergence (`provider_write_protected` vs `providerWriteProtected`/`write_protected` vs `providerMetadata.*`) remains a WIRING-LANE carry — full consolidation deliberately not done here (no cross-package restructuring allowed).
- **S3 — https scheme allowlist.** `read-state.ts` accepts only well-formed `https://` URLs as provider-evidenced open/edit links; `javascript:` (any case), `data:` (any case), `http:`, protocol-relative, empty-after-trim, and non-URL strings all resolve to null without throwing. RED→GREEN: server S3 test failed at base (`javascript:alert(1)` rode through as `openUrl`), passes at fix. Base `readOpenUrl` predecessor in the app copy remains unvalidated-by-scheme — pre-existing surface, observed only (out of this finding's stated path).
- **S4 — doctrine reuse + fail-closed coverage.** Hand-rolled supported/degraded lookup replaced with the exported `capabilityAllowsActionForKey(report, key)` from `../types` (import-only; `types.ts` untouched); input type tightened to `CapabilityReport`. Fail-closed branch covered by two new tests (foreign entry whose `name` mismatches its key → preview unavailable; report missing a capability key entirely → open/edit null).

### S1 disposition (record-only, manager-directed)

The §9.3 evidence vocabulary has ZERO non-test producers today: `sharing_state`/`sharingState`/`visibility`/`permission_summary_state`/`permissionSummaryState` have no writer in `packages/server`/`packages/db`. The only field actually produced is `external_permission_summary` (free-text passthrough, body-suppliable), which this derivation intentionally does not ingest. Consequence: until the wiring lane adds a token producer, the live UI permission row renders Unknown for every Google doc. Whether to accept vocabulary-exact values from the existing `external_permission_summary` field, or to add a producer, is a WIRING-LANE decision — not acted on here.

### Commands + exit codes (Node 22 via /opt/homebrew/opt/node@22/bin)

1. RED (at base): `cd packages/server && npx vitest run src/document-providers/google/read-state.test.ts` → 3 failed | 13 passed (16): §9.4-honesty, S2-parity, S3-https. Exit 0 (vitest run exit code masked by pipe tail; failures verbatim above).
2. RED (at base): `cd packages/app && node --test src/components/mission-control/utils/__tests__/externalDocumentPreview.test.ts` (Node 26 default) → module-load failure: missing export `PERMISSION_SUMMARY_EVIDENCE_TOKENS_BY_SUMMARY` (tests unwritable at base without it; individual assertions verified by inspection + re-run post-export under Node 22).
3. GREEN focused server: same command → 16 passed (16).
4. GREEN focused app: `cd packages/app && PATH=/opt/homebrew/opt/node@22/bin:$PATH node --test src/components/mission-control/utils/__tests__/externalDocumentPreview.test.ts` → 18 pass, 0 fail, exit 0.
5. `cd packages/server && npm run build` → clean strict tsc, exit 0 (after one intermediate TS2345 fix: input typed as `CapabilityReport`). Full server suite at final HEAD: `npx vitest run` → 216 files, 2167 tests passed.
6. `npm --prefix packages/app run build` (tsc && vite build) → exit 0 (chunk-size warning pre-existing, non-error).

### ctrl:gate

`npm run ctrl:gate` → PASSED on first run, exit 0 (`[ctrl] gate passed ✅`); 216 files / 2167 tests green. The known `doc-intelligence-ask-schema.test.ts` flake did NOT occur; no rerun needed.

### Rule-outs

- `types.ts` — IMPORT-ONLY (S4); untouched. No routes/adapters/`fake-adapter.ts`/`contract.test.ts`/`TaskDetailPanel.tsx` edits. No OpenWiki regeneration, no receipt wiring, no flag host/event table, no network calls. Worktree diff contains exactly the four allowed paths + this EVIDENCE addendum.

### Unresolved risk / carries

- S1 producer gap (above) → wiring lane.
- §9.4 evidence-key divergence (S2 disclosure) → wiring lane consolidation.
- Browser visual proof deferral (tracked) must be carried at wiring (T-038/T-039).

---

## Round 3 addendum — r2 GLM 5.3 verdict fixes (F1–F4)

Round 3 of 3 (FINAL). Base for this round: `0794a2ce` (r2-fix commit). All findings fixed RED→GREEN; allowed paths only (`read-state.ts`/test, `externalDocumentPreview.ts`/test, this EVIDENCE).

### Findings fixed

- **F1 BLOCKER (security) — app-side https allowlist.** The r2 S3 fix hardened only the unwired server copy; the mounted app `readOpenUrl` still passed `javascript:` through as a clickable `openUrl`/`editUrl`. Fix: app-local `wellFormedHttpsUrl` in `externalDocumentPreview.ts` mirrors the server's allowlist — rejects case-variant `javascript:`/`data:`, `http:`, protocol-relative, empty-after-trim, and non-URL strings; resolves to null fail-closed, no throw. Validation applied to the candidate BEFORE any consumer: both `openUrl` AND `editUrl` derive from the validated value. **Corrected F1 rule-out:** the r2 statement "pre-existing surface… out of this finding's stated path" was INACCURATE — `externalDocumentPreview.ts` was an allowed path all round; the app copy is now fixed in-path.
  - RED→GREEN: app test "F1: only well-formed https:// URLs qualify as clickable open/edit links (app-side allowlist)" failed at base `0794a2ce` (`javascript:` rode through as `openUrl`/`editUrl`, `canOpen: true`); passes at fix.
- **F2 MEDIUM — provider-branch message branches on canOpen too (deny-direction honesty).** Server provider branch keyed only on `previewActionable`; with preview non-actionable + open_external actionable + https link the message claimed "no further actions are available" while `canOpen === true`. Fix applied identically on both sides: hierarchy preview → open → none ("You can still open the document in Google." when the same object carries `canOpen`; server branches on `openUrl`, which is exactly `canOpen = Boolean(openUrl)`).
  - RED→GREEN: server test "F2: provider read-only message offers the live open action instead of denying all affordances" and app test of the same name each failed at base; both pass at fix.
- **F3 LOW — message/canOpen consistency pins.** The r2 tests enshrined F2 (absence-only assertions). New explicit consistency assertions on both sides: if `canOpen === true` the write-disabled message must not claim "no further actions"; if it names preview/open that affordance must be true in the same object; "no further actions" requires both `previewAvailable === false` and `canOpen === false`. Covered by deny-direction matrices: server test "F3: write-disabled message/canOpen consistency holds across the deny-direction matrix" (5 scenarios), app equivalent (4 scenarios incl. scheme-rejected URL), plus the F1 app URL-scheme test per the brief.
  - RED→GREEN: server F3 matrix failed at base (scenario 4 hit the dishonest "no further actions" branch while `canOpen === true`); app F3 matrix likewise (B1b fixture). Both pass at fix.
- **F4 NIT — parity-literal key typing.** `PERMISSION_SUMMARY_EVIDENCE_TOKENS_BY_SUMMARY` retyped from `Record<string, …>` to `Readonly<Record<GooglePermissionSummary, …>>` via a local union mirroring the canonical member list (no cross-package import). No behavior change; exhaustive-key typo protection only.

### Commands + exit codes (Node 22 via /opt/homebrew/opt/node@22/bin)

1. RED baseline confirmed at base `0794a2ce` by the interrupted session start of this round: server focused → 2 failed (F2, F3); app focused → 5 failed (F1, F2, F3, B1b consistency extension).
2. GREEN focused server: `cd packages/server && npx vitest run src/document-providers/google/read-state.test.ts` → 18 passed (18), exit 0.
3. GREEN focused app: `cd packages/app && PATH=/opt/homebrew/opt/node@22/bin:$PATH TS_NODE_PROJECT=tsconfig.test.json node --loader ts-node/esm --test src/components/mission-control/utils/__tests__/externalDocumentPreview.test.ts` → 21 pass, 0 fail, exit 0. (Plain `node --test` without the ts-node loader crashed the runner under Node 22 — loader invocation is required for this .ts suite.)
4. `cd packages/server && npm run build` → clean strict tsc, exit 0. Full server suite at final HEAD: `npx vitest run` → 216 files / 2169 tests passed, exit 0.
5. `cd packages/app && npm run build` (tsc && vite build) → exit 0 (pre-existing chunk-size warning, non-error). App suite `npm test` → 508 pass / 0 fail, exit 0.
6. `npm run ctrl:gate` → PASSED on first run, exit 0 (`[ctrl] gate passed ✅`), 216 files / 2169 tests. The known `doc-intelligence-ask-schema.test.ts` flake did NOT occur; no rerun needed.
7. `git diff --check` → clean.

### Rule-outs

- `types.ts` import-only; untouched. `routes/*`, `fake-adapter.ts`, adapters, `contract.test.ts`, `TaskDetailPanel.tsx` (read-only mounting evidence) untouched. No receipt wiring, no OpenWiki regeneration, no network calls, no browser launch. Diff contains exactly the four allowed code/test paths + this EVIDENCE addendum. Single new commit on top of `0794a2ce`; no amend/rebase/push.

### Tracked items (unchanged carries)

- Browser visual proof deferral to T-038/T-039 must be carried at wiring.
- Scoped-AGENTS PRD-hash pin drift escalation remains pending with the manager.
