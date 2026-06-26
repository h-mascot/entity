# Opus 4.8 PRD Critique — Entity Phase 2

## 1. Verdict

- The PRD is broadly fit for purpose and faithfully traces Q1–Q43. It does not violate the hard boundaries (Paperclip external, Helm separate, ClickClack non-blocking, Google Docs non-canonical, no fake implementation claims). It is mergeable, not discardable.
- It is over-broad in places that will produce un-ticketable epics. The `entity-mc` completion invariant, policy resolution, and Task Master routing are well-specified, but several epics are described as one capability when they contain 3–5 independently shippable slices.
- The receipt completion transaction is the strongest part and is ready to ticket; however the atomicity mechanism is explicitly deferred to "implementation choice," which leaves the single most important invariant ("no done without receipt") without a concrete failure-handling contract. That is a must-fix.
- The principal model is asserted but under-specified at the agent/runtime boundary. "RuntimeProviderRef" exists but the contract for how an agent principal binds to a Helm-managed runtime — and what Entity does when that binding is stale — is missing.
- The PRD leans on "existing Entity surfaces" (review_packet shape, activity log, Task Master design, `review.sh`) as authority but never pins the actual current schema. Migration tickets cannot be cut cleanly until an inventory ticket is mandated as a hard dependency.
- Non-engineering workflow coverage is present in user stories but thin in the object model. Worktype overlays are named but there is no concrete overlay contract or registry, so biz-ops differentiation is asserted, not specified.
- Degraded-state coverage is excellent and should survive merge largely intact. This is the PRD's second strongest area.
- Net: usable as canonical input after merge, conditional on resolving the must-fix gaps in section 2, especially receipt atomicity, the activity-log inventory dependency, worktype overlay contract, and the agent↔runtime binding contract.

## 2. Must-fix gaps before canonical PRD

1. **Receipt atomicity / failure contract is deferred, not specified.**
   - Gap: The completion flow requires DB metadata + markdown body written before `done`, but the actual atomicity mechanism and the post-failure task state are left as "implementation policy" (`receipt_status = failed` OR "remains non-done"). This is the load-bearing invariant of the whole PRD and it currently has two divergent outcomes.
   - Why it matters: `/to-issues` will produce a receipt ticket whose acceptance criteria contradict themselves. A reviewer cannot test "no done without receipt" if the failure state is ambiguous.
   - Edit: Pin a single contract. State: completion is a two-phase write — (a) write markdown artifact body to stable path + compute hash, (b) write DB receipt metadata referencing that artifact_id + hash in the same transaction as the `done` transition. If (a) fails, task stays in `review`/`doing` with `receipt_status=failed` and a `receipt_failed` activity event; `done` is never reached. If (b) fails after (a), task stays non-done with `receipt_status=integrity_error` and an orphaned-artifact reconciliation job. Remove the "OR" language.

2. **Activity-log structural inventory is a hidden hard dependency, not a ticket.**
   - Gap: The PRD says "if the current activity log lacks structure, add structured payloads via migration" but does not make the inventory of the *actual* current activity log a blocking precondition for receipt, Task Master, and migration epics.
   - Why it matters: Receipt generation, routing history, and migration all read from the activity log as source of truth. If `/to-issues` cuts those epics without first cutting the inventory, every downstream ticket is built on assumption.
   - Edit: Add a mandatory Slice 0 ticket: "Inventory current Entity activity-log event types, payload structure, and review_packet shape; produce gap report against required ActivityEvent event_type enum." Mark receipt, Task Master, and migration epics as `depends_on` this ticket.

3. **Worktype overlay contract is named but not specified.**
   - Gap: `worktype_overlay?: Record<string, unknown>` is the entire technical specification for the differentiator that prevents Entity from being an engineering-only board (Q8, Q17, Q20). An untyped record is not a contract.
   - Why it matters: The whole biz-ops positioning rests on sales/CS/people overlays. `Record<string, unknown>` cannot be validated, searched, or filtered, yet section "Search" requires filtering by worktype and the UI tests require "sales stage / CS stage" rendering.
   - Edit: Specify a worktype registry: each worktype declares an overlay schema (named fields, types, allowed values), a default risk contribution, and a default Plan domain-label. Require that overlay fields used in search filters be registered/indexable. Add one concrete worked example each for sales, CS, and people overlays.

4. **Agent principal ↔ runtime binding contract is missing.**
   - Gap: Agents are "user-added principals"; runtime identity is "separate." But there is no contract for how an Entity agent principal references a Helm/provider-managed runtime, nor what Entity shows when that runtime is unknown/offline/reassigned.
   - Why it matters: Q4/Q5/Q13 require Entity to show runtime status without owning runtime config. Without a binding contract, the Helm adapter epic cannot be ticketed and "agent shows offline" has no data model.
   - Edit: Specify `RuntimeProviderRef` binding fields on the Agent principal: `runtime_binding_id`, `provider_type` (generic enum, not OpenClaw/Hermes-only), `helm_managed: bool`, `binding_state: bound|unbound|stale|unknown`. Define that Entity reads status via Helm adapter keyed on `runtime_binding_id` and renders `unknown` when the adapter is unreachable.

5. **Separation-of-duties rule is stated inconsistently for initiator review.**
   - Gap: Q24 says human work defaults to *initiator* as reviewer. The review section says reviewer must not be `submitted_by`, `created_by`, or `assignee`. But initiator is frequently also the owner and sometimes the created_by. The PRD does not resolve the precedence when initiator-default collides with the SoD exclusion set.
   - Why it matters: This is a deterministic policy that must be testable. The current text allows a state where the policy assigns the initiator and the SoD check rejects them with no defined fallback ordering.
   - Edit: Specify the fallback chain explicitly: initiator → (if SoD-excluded) same-team capable reviewer pool → (if empty) owner-if-eligible → (if empty) escalate-to-admin as routing problem. State that initiator is excluded as reviewer iff initiator ∈ {assignee, executor, submitted_by}.

6. **Human-gate-blocks-completion semantics conflict with the receipt-at-completion invariant.**
   - Gap: Job 7 says external side effects "are not treated as complete until gate passes," but the receipt is written synchronously at completion and Q35 says no `done` without receipt. It is unclear whether a task pending a human gate is `done-with-receipt-but-side-effect-held`, or blocked before `done`, or `review`→gate→`done`.
   - Why it matters: Determines the order of receipt write vs gate decision, which changes the receipt content (gate decision may be "pending" in a "completed" receipt — that contradicts "no evidence-less fog").
   - Edit: State the ordering: human gate resolves *before* `done`. A task with a required, unapproved gate cannot be `done`; it sits in `review` (or a `gate_pending` modifier). The receipt is written at the `done` transition *after* gate approval, so the receipt always records a resolved gate decision, never `pending`.

7. **Cross-org isolation is asserted as "hard failure" but has no enforcement seam specified.**
   - Gap: R2/§5.3 declare cross-org leakage a hard failure and tests require cross-org denial, but no architectural enforcement point (org-scoping middleware, row-level scoping, query guard) is specified.
   - Why it matters: Enterprise self-deploy + multi-tenant is foundational (Q2). "Tested" without a named enforcement seam means every service re-implements scoping ad hoc.
   - Edit: Specify a single org-scoping enforcement layer (request-context org binding + mandatory org_id predicate on all queries) as a foundational ticket that all service epics depend on.

## 3. Product framing improvements

- The "work plane vs Mission Control" distinction is well-argued in prose but the IA does not yet show *agent management as first-class*. Q1 explicitly calls out "a section for agent management" and "spin up new agents from any runtime." The PRD treats agents mostly as task principals; it under-sells the agent-management surface (skills, recurring crons/loops visibility, current work). Sharpen §3.2 to name an Agent Management surface distinct from Agent Activity, and clarify that "spin up from any runtime" routes to Helm for config but Entity owns the collaboration/visibility view.
- The buyer is the company/workspace buyer, but the PRD never states the *wedge buyer's first 10-minute experience*. Add a short "first session" narrative: connect Google Docs (read-only), add one agent, create one biz-ops task, watch the receipt appear, review it. This anchors `/to-issues` slice ordering toward a demonstrable spine.
- Positioning leans on "G Suite/M365 for human-agent teams" which is correct per Q1, but the PRD should explicitly state what Entity is *not* competing on (it is not an agent runtime, not a chat app, not a doc editor war with Google). This protects the boundaries during merge.
- Non-engineering language is handled in stories but the framing should state the rule once, prominently: *no engineering vocabulary is mandatory anywhere in the biz-ops path.* Currently "spec" leaks into several generic descriptions.

## 4. User story coverage audit

- **Over-covered:** Boundary/guardrail "stories" (95, 96, 97, 100) are not user stories — they are constraints restated as stories. They inflate the count and will mislead `/to-issues` into cutting tickets for them. Move these to Implementation Decisions/guardrails.
- **Under-covered — agent management:** No story for "as an agent manager, I want to see an agent's skills/capabilities and recurring crons/loops" (Q1 explicitly). Story 38/41 cover identity/status but not skills/recurring-loop visibility. Add it.
- **Under-covered — spin up agent:** No story for adding/registering a new agent from a runtime (Q1, Q2 tenant-safe onboarding). Story 39 says "agents are user-added" but there is no add-flow story. Add one, routing config to Helm.
- **Under-covered — owner accountability loop:** Owner is required (Q26) but there is no story for "as an owner, I want to see all tasks I'm accountable for, including stalled/escalated ones." The escalation target has no inbox view story.
- **Under-covered — biz-ops Plan domain labels:** Story 13 mentions plans generically; no story exercises a concrete domain plan (account plan / hiring plan) with its own lifecycle. Add one to force the DomainPlan contract.
- **Under-covered — enterprise/self-deploy admin:** Story 98/99 mention seams but no story covers tenant data isolation verification or connector authorization scoping from the admin's view.
- **Missing — Task Master review of agent work (Q24 `review.sh` path):** Story 67 covers peer-agent review generically but does not tie to the existing `entity-mc review.sh` policy being folded in. Add a story that explicitly preserves that path.

## 5. Implementation decision audit

- **Policy storage format is open** (acknowledged in Further Notes) but the policy *resolution order and conflict semantics* are specified well enough to ticket. Keep resolution-order in PRD; leave storage to implementation. Make sure `/to-issues` does not block on storage format.
- **"taskmaster_drivable" is both a task field and a policy output.** §5.6 has it as a Task field; policy resolution also emits it. Specify which is authoritative (policy resolution computes it; the task field is a cached projection of the policy result) to avoid drift.
- **Receipt `regenerate-metadata` endpoint risks violating immutability.** `POST /receipt/regenerate-metadata` is exposed but raw receipts are immutable. Clarify that this regenerates *DB index metadata* from the immutable artifact body only (never rewrites the body), and cannot run if the body is missing.
- **DerivedHealth computation source is unspecified.** It's a stored object with fields but no contract for when/how it recomputes (on task event? polled? cached TTL?). This is too vague to ticket; specify event-driven recompute on linked-task state changes.
- **External side-effect model is referenced but not defined.** `ExternalSideEffect[]` drives human-gate policy but has no schema. Define it (type enum: email_send, crm_update, hr_action, financial_commitment, etc.) since the entire gate policy keys off it.
- **ObjectRef / linked_object_refs is the backbone of the link model** (artifacts→goals/specs/projects, Q16) but never typed. Specify `ObjectRef { object_type, object_id, link_role }` — it appears everywhere and is currently implicit.
- **Search source "helm" and "runtime_provider"** appear in the SearchResult source enum, but searching Helm/runtime objects is never specified as in-scope and risks duplicating Helm. Remove or scope these to status-reference-only.

## 6. Testing/proof audit

- Strong: degraded-state matrix, receipt failure/integrity tests, self-review rejection, no-secret/no-mutation negatives, cross-org denial. Keep these.
- **Missing: gate-before-done ordering test.** No test asserts a task with an unapproved required human gate cannot reach `done`. Add it (ties to must-fix #6).
- **Missing: receipt-records-resolved-gate test.** Assert a completed receipt never contains a `pending` gate/review decision.
- **Missing: worktype overlay validation tests.** Once overlays are typed (must-fix #3), add tests that reject unregistered overlay fields and that overlay fields don't override universal core state.
- **Missing: agent-runtime binding degraded test.** Assert that a stale/unbound runtime binding renders `unknown` status, not fake health, and does not block task flows (parallels must-fix #4).
- **Missing: SoD fallback-chain test.** Assert the initiator→pool→owner→admin fallback (must-fix #5) resolves deterministically and never assigns an SoD-excluded reviewer.
- **Missing: migration idempotency / re-run test.** Progressive migration implies re-runs; assert backfill is idempotent and does not overwrite human-corrected fields with re-inferred lower-confidence values.
- **Missing: permission-change propagation test.** When object sensitivity is tightened, assert previously-indexed search snippets stop rendering. Snippet suppression is tested at render but not on sensitivity *change*.
- **Thin: org-scoping enforcement test at the middleware seam** (must-fix #7) — current tests check denial behaviorally; add a test at the enforcement layer that an un-scoped query is rejected by construction.

## 7. Issue-breakdown guidance

`/to-issues` should cut vertical slices, each shippable and proof-bearing. Dependency-ordered:

- **Slice 0 — Foundations & inventory (hard gate for everything).** Activity-log + review_packet + current-schema inventory (must-fix #2); org-scoping enforcement seam (must-fix #7); ObjectRef + principal model + SensitivityClass + ExternalSideEffect type definitions. No product capability ships before this.
- **Slice 1 — Workspace hierarchy & tenancy.** Org→Team→Project→Task required fields, individual-owner/initiator enforcement, lifecycle vs status modifier. Depends on Slice 0.
- **Slice 2 — Activity log structuring.** Required ActivityEvent event_type enum + structured payloads + migration of existing log. Depends on Slice 0 inventory. Blocks receipts and Task Master.
- **Slice 3 — Canonical receipts & proof-backed completion.** The completion transaction with pinned atomicity (must-fix #1), gate-before-done ordering (must-fix #6), receipt-from-activity-log generation. Depends on Slices 1–2. This is the trust-wedge spine — prioritize it.
- **Slice 4 — Docs/files/artifacts object model.** NativeDocument / ExternalDocumentRef / EvidenceArtifact distinction, raw-immutable vs curated-versioned. Depends on Slice 0; overlaps Slice 3 for receipt storage.
- **Slice 5 — Review, policy resolution, human gates.** Layered resolver, reason chains, SoD fallback chain (must-fix #5), reviewer assignment + override audit. Depends on Slices 2–3.
- **Slice 6 — Task Master routing.** Claim/nudge/escalate/auto-reassign, drivable as policy projection, full execution-chain in receipts. Depends on Slices 2, 3, 5.
- **Slice 7 — Worktype overlays & biz-ops.** Worktype registry + typed overlays (must-fix #3) + DomainPlan. Depends on Slice 1; needed before search filters are meaningful.

First 5–8 slices above. Search, permissions/sensitivity, notifications, agent identity/runtime binding, ClickClack, Google Docs connector, Helm adapter, and migration cleanup queues follow, with agent↔runtime binding (must-fix #4) gating the Helm adapter slice.

## 8. Suggested canonical PRD patch list

- Pin receipt atomicity to a single two-phase contract; delete the "OR remains non-done" ambiguity (must-fix #1).
- Add Slice 0 inventory ticket and mark receipts/Task Master/migration as depending on it (must-fix #2).
- Replace `worktype_overlay: Record<string, unknown>` with a worktype registry + typed overlay schema; add sales/CS/people worked examples (must-fix #3).
- Add `RuntimeProviderRef` binding contract on Agent principal with `binding_state` and `unknown` rendering rule (must-fix #4).
- Add the explicit SoD reviewer fallback chain and the initiator-exclusion condition (must-fix #5).
- State gate-before-done ordering; receipts always record resolved gate/review decisions (must-fix #6).
- Name a single org-scoping enforcement seam as a foundational dependency (must-fix #7).
- Move guardrail "stories" 95–97, 100 out of User Stories into Implementation Decisions/guardrails.
- Add user stories: agent skills/recurring-loop visibility; add/register agent (config→Helm); owner accountability inbox; concrete DomainPlan lifecycle; tenant-isolation admin view; explicit `review.sh` agent-review path preservation.
- Define `ExternalSideEffect` and `ObjectRef` schemas; they are load-bearing and currently implicit.
- Clarify `taskmaster_drivable` as a cached projection of policy resolution, not an independently authoritative field.
- Constrain `receipt/regenerate-metadata` to DB-index-only, never body rewrite, never run on missing body.
- Specify DerivedHealth as event-driven recompute on linked-task state changes.
- Remove or scope-down `helm`/`runtime_provider` from the search source enum to status-reference-only.
- Add tests: gate-before-done, resolved-gate-in-receipt, overlay validation, runtime-binding degraded, SoD fallback, migration idempotency, permission-change snippet propagation, org-scoping at the seam.
- Add the "first session" buyer narrative to §3 to anchor slice ordering.
- Name an Agent Management surface in §3.2 distinct from Agent Activity, with config routing to Helm.