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
