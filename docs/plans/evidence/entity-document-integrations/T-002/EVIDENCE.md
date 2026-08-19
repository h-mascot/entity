# T-002 — Write capability architecture ADR

Issue: THE-943 ([LOOM-DOCS T-002] Write capability architecture ADR)
Run marker: `loom-run:entity-doc-integrations-20260809`
Worker model: `citadel/daystrom/deepseek` (medium) — pinned externally, not substituted.
Reviewer: `citadel/azure-openai-responses/gpt-5.6-terra` (high) via `review-current.zsh`.

## 1. Issue state and reviewed SHA

| Item | Value |
| --- | --- |
| Pre-issue HEAD (base audit SHA) | `4e015c16bdee46be78805dfdcdec5b77af7590ab` |
| Final reviewed SHA | recorded in the external review receipt + Linear proof comment, per the anti-loop closeout policy (a commit cannot contain its own SHA). This tree is the exact `HEAD` passed to `review-current.zsh`. |
| Branch | `runner/entity-document-integrations-20260818` |
| Current base (`origin/main` at runner creation) | `bdb57421b59bc2739ad5ba9f08a7cc0a57616d83` |
| Working tree | clean at closeout (evidence committed) |

Runtime note: `better-sqlite3` native binding fails under Node 26 (`ERR_DLOPEN_FAILED`). All
Node-22-native commands were executed with `nvm use 22` (v22.22.2) as required by the runner
("Node 22 for native modules").

## 2. Scope delivered (named paths)

| Path | Delivered | Action |
| --- | --- | --- |
| `docs/loom/entity-document-integrations/phase2-canonical-prd.md` | Not modified | Source authority (read-only). Verified on-disk SHA-256 `c82e82d8379c420946735bf79265895cc3a00937d2d9f2ec95de60979e492470` (matches BUILD-CONTEXT). Note: the live Linear/AGENTS/ISSUE-MAP name `83cac…` — stale reference; actual tracked file is `c82e82d8…` (see §8). |
| `docs/adr/2026-08-entity-document-capability-architecture.md` | Added | Full capability architecture ADR (D-003 + R-002). |
| `packages/server/src/document-providers/types.ts` | Added | Capability vocabulary + state/source types + fail-closed guards. |
| `packages/server/src/document-providers/capability-resolver.test.ts` | Added | Sanctioned capability resolver test plan (automated proof). |

No change outside these named paths was made. The ADR (not code) owns the provider adapter
contract concept and resolution precedence; T-005 implements the concrete adapter interface
and T-006 implements the resolver algorithm (both consume this ADR and `types.ts`).

## 3. What the ADR decides (T-002 scope)

- **Provider adapter contract** — uniform adapter that reports capability evidence, layered
  with operation methods; never lives in `provider-registry/`.
- **Capability vocabulary** — the R-002 15-name vocabulary, enforced exhaustively by a
  `CapabilityReport` keyed by `CapabilityType`.
- **Capability state semantics** — `supported` / `unsupported` / `degraded` / `unknown`,
  each with `source` and optional `reasonCode`/`reason`.
- **Degraded/unknown behavior** — writes fail closed on `unknown`; `degraded` suppresses a
  normally supported write while read-like capabilities remain usable when degraded.
- **Resolution precedence** — `adapter < connection < destination < runtime < policy`.
- **D-003 / R-002** — capability report is the only authority; `providerKindEnablesWrite`
  returns `false` as a permanent sentinel so provider name never enables a write.
- **Reversibility** — staged behind the audited Phase 2 flag host (`phase2-flags.ts`);
  T-006 registers the flag. No competing flag store.
- **Examples** — Google (`agent_text_mutation` gated on D-005 write gate + healthy
  connection), Microsoft (`agent_slide_mutation` only after a proven mutation path, else
  fails closed), Local (`human_edit` driven by local-bridge health without changing the
  `local_office` provider kind).

## 4. Automated proof — capability resolver test plan

Focused test: `packages/server/src/document-providers/capability-resolver.test.ts` (16 tests).

```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/capability-resolver.test.ts
#  Test Files  1 passed (1)
#  Tests       16 passed (16)
```

Covered cases:
- Full 15-name R-002 vocabulary present, no more, no less.
- All three provider kinds never enable a write (`providerKindEnablesWrite === false`).
- All four states and all five sources are valid per capability.
- **Negative/security:** `unknown` mutation fails closed; `unknown` embedding fails closed.
- **Degraded:** a `degraded` connection suppresses an otherwise-supported mutation; writes
  are enabled only on `supported`.
- **Read-like:** usable when `supported`/`degraded`, fails closed on `unknown`.
- **R-019 regression (degraded local human_edit):** `human_edit` is actionable only when
  `supported`; `degraded`/`unknown`/`unsupported` are non-actionable so no false-functional
  Edit appears when the local bridge is unavailable.
- **R-002 regression (unsupported read-like):** `unsupported` read-like and `human_edit`
  capabilities are non-actionable (introduced by reviewer round 1, see §7a).
- Capability report resolves every vocabulary member.

### 7a. Reviewer round 1 — finding and RED-first fix

Reviewer (`terraform` run 1) returned `CHANGES_REQUESTED` with one P1:
`capabilityAllowsAction` treated `unsupported` read-like capabilities as actionable
(returned `cap.state !== 'unknown'`), contradicting R-002's requirement that unsupported
capabilities produce a typed unsupported-capability response.

Fix (RED-first):
1. Added a failing regression test asserting `unsupported` for `read`, `preview`,
   `thumbnail`, `open_external`, `human_edit`, `version_history`, `change_tracking`,
   `permission_read`, `export` is non-actionable — **fails before fix**
   (`AssertionError: expected true to be false`).
2. Changed `capabilityAllowsAction` so read-like capabilities are usable only when
   `supported` or `degraded`; `unsupported` and `unknown` are never actionable.
3. Focused suite now 12/12 green; full server suite 1713/1713 green under Node 22.

## 5. Negative / security proof

- `unknown` on `agent_text_mutation` → action disabled (fail closed). ✓
- `unknown` on `embed_editor` → action disabled (fail closed). ✓
- `degraded` / `unsupported` on `create`, `permission_write`, and all mutation capabilities →
  action disabled. ✓
- Provider name `google_workspace` / `microsoft_365` / `local_office` alone → write not
  enabled. ✓ (D-003 / R-002 "no write action enabled solely because provider === …")
- Privacy: no credentials, tokens, tenant secrets, document contents, or operator absolute
  paths appear in code, tests, evidence, or this ADR.

## 6. Broader build / typecheck / ctrl commands (Node 22)

```sh
cd packages/server && npm run build                             # PASS (tsc, strict)
cd packages/server && npx vitest run                            # 203 files, 1712 tests PASS
npm run build                                                   # app + db + server build PASS
npm run ctrl:gate                                               # todo 0, gate passed ✅
npm run scan:private-defaults -- --enforce                      # exit 0
npm run test:release-deploy                                     # 14/14 PASS
bash scripts/proof/entity-phase-2-smoke.sh                      # PASS
git diff --check                                                # clean
```

Every command exists at current HEAD and returned exit 0.

## 7. Manual proof — ADR review

The ADR `docs/adr/2026-08-entity-document-capability-architecture.md` is the manual proof
artifact. It is a complete, reviewer-facing decision record (context → decision →
consequences → test expectations) that represents D-003 and R-002 in full and includes
Google, Microsoft, and local examples. Reviewed to APPROVED in the external review receipt
(see §1 for the exact candidate SHA).

## 8. Canonical-source hash resolution (review round 2, P1)

The actual file `docs/loom/entity-document-integrations/phase2-canonical-prd.md` in this exact
reviewed tree hashes to SHA-256
`c82e82d8379c420946735bf79265895cc3a00937d2d9f2ec95de60979e492470`, which matches
`BUILD-CONTEXT.md:16`. The live Linear THE-943 contract, `AGENTS.md:15`, and `ISSUE-MAP.md:3`
name `83cacbc51a1eb15649d6e0a17759e2115a3c2185a93b7c4532001beee2527137` — a **stale
reference** that does not match the tracked file. This T-002 deliverable is grounded on the
actual tracked canonical PRD (`c82e82d8…`), whose T-002 section (`D-003`, `R-002`) is what
the ADR, `types.ts`, and the resolver test plan represent. The discrepancy is documented, not
silently asserted; this issue does not modify the canonical PRD.

### 8a. Review round 2 — P2 resolution (unknown fails closed, all write capabilities)

Added a table-driven unknown-state regression test covering **every** member of the
fail-closed write/embedding set — `create`, `agent_text_mutation`, `agent_range_mutation`,
`agent_slide_mutation`, `permission_write`, `embed_editor` — so a future capability-set or
guard refactor cannot silently enable an unproven write path. Focused suite now 14 tests.

### 8b. Review round 3 — R-019 fix (degraded local `human_edit` must be non-actionable)

Reviewer round 3 flagged a P1: `capabilityAllowsAction` treated `human_edit` as actionable
in `degraded` state, so a missing/unhealthy local bridge (`human_edit: degraded`) would
surface a functional Edit/Open-local action, violating R-019 ("No local Edit action appears
functional when the runtime cannot complete it").

Fix: introduced `REQUIRES_SUPPORTED_CAPABILITIES` (write/embedding set + `human_edit`) and
`capabilityAllowsAction` now returns `true` for those capabilities only when `supported`.
`human_edit` stays distinct from the agent-write classification (`isWriteCapability`). Added
a regression case asserting degraded/unknown/unsupported `human_edit` is non-actionable and
`supported` is actionable, and updated the ADR's degraded/unknown + local example. Focused
suite now 14 tests.

### 8c. Review rounds 4 (test-completeness) — exhaustive fail-closed matrix

Additional pinned Terra reviews surfaced a P2 test coverage gap: `embed_editor` degraded/
unsupported were not directly asserted in the fail-closed action matrix. The implementation
already fails closed correctly (`embed_editor` is in `REQUIRES_SUPPORTED_CAPABILITIES`), so
this was a coverage-only fix. Added an exhaustive table-driven matrix driving **every**
member of `REQUIRES_SUPPORTED_CAPABILITIES` (`create`, `human_edit`, all three agent
mutations, `permission_write`, `embed_editor`) through **every** non-`supported` state
(`unsupported`/`degraded`/`unknown`) asserting non-actionable, and `supported` actionable.
Focused suite now 15 tests. Every later round's finding was a concrete correctness or
test-gap issue fixed with regression proof — no self-referential bookkeeping loop.

### 8d. Review round 5 — report key/name binding (R-002 fail-closed type soundness)

Round 5 flagged a P1: `CapabilityReport` was `Record<CapabilityType, ResolvedCapability>`,
so a type-valid report could place a degraded `read` under the `create` key, and
`capabilityAllowsAction(report.create)` would then return `true`, enabling a write path.

Fix (RED-first): `CapabilityReport` is now dependently typed
(`{ [K in CapabilityType]: ResolvedCapability & { name: K } }`), so each key binds its value's
`name` at compile time, and a runtime guard `capabilityAllowsActionForKey(report, key)` rejects
any mismatch from untyped adapter data. Added a regression test asserting that a `create`
lookup whose value claims a degraded `read` fails closed. Focused suite now 16 tests. The
remaining round-5 note (reviewed-SHA / Linear closeout proof not yet posted) is addressed at
closeout — per the anti-loop policy a commit cannot contain its own SHA, so the final reviewed
SHA is recorded in the external review receipt and the Linear proof comment, which this issue
posts after APPROVED.

### Open questions

No new open question was resolved into a default. The Google write gate (D-005), Microsoft
mutation proof (T-021/T-023), and local bridge (T-027) decisions remain open and are
represented as conditional capability resolution rather than invented defaults — matching
the runner's rule that open questions are gates, not permission to invent defaults.

## 9. Delivery

This issue is scoped to foundation (ADR + vocabulary types + test plan) and is merged to the
runner branch only. No merge to `main` (Gate 8) and no production promotion in this run.
