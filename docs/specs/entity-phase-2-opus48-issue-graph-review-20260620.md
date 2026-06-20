# Opus 4.8 Issue Graph Review — Entity Phase 2

## Verdict

**Load after minor patching.** The issue graph is structurally sound and faithfully implements all seven Opus PRD critique requirements. Slice 0, receipt atomicity, worktype registry, runtime binding, SoD fallback, gate-before-done, and the org-scoping seam are each represented as concrete, testable acceptance criteria — not hand-waved. Vertical slicing is correct (no monolithic schema/UI/test issues), and the dependency DAG is coherent.

The only blocker-class problems are **broken user-story references** in roughly half the issues, where the cited story numbers exceed the PRD's actual range (1–100). These will misattribute scope to agents and must be fixed before Linear load. Everything else is non-blocking polish.

## Must-fix before Linear load

1. **User-story numbers are out of range and wrong across most issues.** The canonical PRD has exactly 100 user stories (1–100). Yet:
   - Issue 9 cites "98-104"
   - Issue 10 cites "105-110"
   - Issue 11 cites "111-118"
   - Issue 12 cites "119-125"
   - Issue 13 cites "126-133"
   - Issue 14 cites "134-142"
   - Issue 15 cites "143-150"

   All references ≥101 are phantom. Additionally, lower-numbered citations are internally inconsistent: Issue 6 claims "38-49, 65-73, 95-97" but stories 38–49 are agent-identity/Helm/ClickClack stories, not review/gate stories (review/gate is ~61–72). Issue 7 ("57-64, 82-88") overlaps Issue 6's range and pulls notification stories into Task Master. **An agent reading these will pull the wrong scope.** Re-map every `User stories covered` field against the actual 1–100 list before load. This is the one true blocker.

2. **Issue 11 acceptance criteria says `RuntimeProviderRef fields` but lists the PRD's `runtime_binding_id, provider_type, helm_managed, binding_state`.** Minor, but the field-group name doesn't match the PRD's "Agent principal binding fields." Rename to avoid an agent inventing a `RuntimeProviderRef` object that the PRD never defines. Patch the label only.

## Dependency/order audit

The DAG is correct and acyclic. Spot checks:

- **Slice 0 → everything** is right; receipt (4), Task Master (7), and migration (14) all correctly depend on it per the PRD's hard dependency.
- **Receipt (4) before review/gates (6)** is correct, and **6 before 7** correctly enforces that Task Master routing depends on policy resolution existing.
- **Gate-before-done** lives in Issue 6, which depends on Issue 4 (receipt). This ordering is correct: the receipt contract must exist before the gate sequencing that defers receipt writing to the resolved `done` transition.
- **Org-scoping seam in Issue 2**, with all downstream service/search slices depending on Issue 2 (directly or transitively). Correct — matches "All service/API/search/indexing slices depend on this enforcement seam."

One soft concern: **Issue 3 (ActivityEvent spine) depends on 0 and 2, but Issue 6/7's reason-chain and routing events presuppose the gate/routing event types exist in the enum.** Issue 3's enum list does include "gate events" and "Task Master routing," so this is satisfied — no change needed, but verify agents building 6/7 treat Issue 3 as the authoritative enum owner rather than re-declaring events.

## Granularity audit

Granularity is appropriate for AFK agents. Each issue is one product capability split implicitly by layer, consistent with the PRD's hybrid-epic instruction.

- **Issue 6** is the heaviest (policy resolver + human gates + SoD fallback + ExternalSideEffect). It's defensible to keep as one slice because these are tightly coupled, but flag for the implementing agent that this is effectively four sub-deliverables and may warrant sub-tasking inside Linear. Not a blocker.
- **Issue 9** bundles permissions/sensitivity *and* the search envelope. The PRD treats these as separate epics (7 and 9 in its recommended shape). Bundling is acceptable since search permission-filtering depends on the permission evaluator, but the implementing agent should produce distinct proof for RBAC vs. search. Not a blocker.

No issue is too small. No issue is a vague catch-all.

## Acceptance criteria/proof audit

Strong overall. Acceptance criteria are testable and proof-bearing, and they pick up the merge-addendum test additions:

- ✅ Receipt atomicity, integrity_error path, and `regenerate-metadata never rewrites body / refuses missing body` (Issue 4) — fully captured.
- ✅ Gate-before-done + "receipts record resolved decisions only" (Issue 6) — captured.
- ✅ SoD fallback chain stated deterministically with the exact exclusion rule (Issue 6) — captured.
- ✅ `taskmaster_drivable` as cached projection (Issue 7) — captured.
- ✅ Org-scoping fail-by-construction with tests (Issue 2) — captured.
- ✅ Idempotent migration preserving human corrections (Issues 3, 14) — captured.
- ✅ Permission-change propagation suppressing previously-indexed snippets (Issue 9) — captured.
- ✅ Worktype overlay validation + search-indexable-only fields (Issue 8) — captured.

Gaps (non-blocking, recommend patching):

- **No issue explicitly owns the receipt's required field set.** Issue 4 proves atomicity and failure modes but does not assert the receipt *contains* the full canonical field list (initiator/owner/assignee/executor/submitted_by/routing history/gate state/provenance/integrity metadata). Add one acceptance criterion to Issue 4: "Receipt body contains all canonical required fields per PRD receipt model, verified by snapshot test." Otherwise an agent could ship an atomic-but-incomplete receipt.
- **"Reassigned receipt includes full routing chain"** is asserted in Issue 7 but the linkage to Issue 4's receipt generator is implicit. Acceptable, but note the dependency in Issue 7's body.
- **Issue 15's E2E spine** matches the PRD's "buyer's first-session spine" but omits the "add/register one agent via Helm-backed binding" step. Add it for fidelity to the canonical spine.

## Final recommended changes

**Blocking (fix before load):**
1. Re-map every `User stories covered` field to the actual 1–100 range. Delete all phantom ≥101 references and correct the mis-attributed lower ranges (esp. Issues 6, 7).

**Minor (patch in same pass, recommended):**
2. Issue 11: rename `RuntimeProviderRef fields` to match PRD's "agent principal binding fields."
3. Issue 4: add acceptance criterion asserting the receipt body contains the full canonical required-field set (snapshot-tested).
4. Issue 15: add the "register one agent via Helm-backed binding" step to the E2E first-session spine.
5. Issue 7: note explicit dependency on Issue 4's receipt generator for the routing-chain receipt content.

With change #1 applied (and ideally 2–5), this graph is ready for Linear load and AFK agent execution.