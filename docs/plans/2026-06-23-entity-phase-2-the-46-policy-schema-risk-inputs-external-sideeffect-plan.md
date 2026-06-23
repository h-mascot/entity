## Task
Implement `THE-46` / `THE-11.1`: define policy schema, risk inputs, and ExternalSideEffect.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Live Linear `THE-46` is a child issue under parent `THE-11`, source `THE-11.1`. Scope is schema/types and focused tests for review/human-gate policy inputs, including workspace/org/team/project/worktype/task/risk/trust layers and ExternalSideEffect records. Entity remains the work/collaboration/review plane; review and human gate are separate concepts.

Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, canonical PRD, Oracle spec, `.project-gate.json`, execution-pack plan.

## Dependencies
- [x] Required repo rules, context, canonical PRD, Oracle spec, gate config, package scripts, issue map, and run-state read.
- [x] Live Linear `THE-46` read and confirmed as child `THE-11.1` under parent `THE-11`.
- [x] Live Linear parent `THE-11` read and confirms review policy/human gate/separation-of-duties scope.
- [x] Prior `THE-45` gate verified under Node v22.22.2: machine gate `PASS`, Book review `APPROVED`, verify `PASS`, `nextChildBlocked=false`.
- [x] Current branch created: `THE-46-define-policy-schema-risk-inputs-and-external-sideeffect`.

## Plan
- [x] Step 1: Inspect existing task, review, receipt, policy, worktype, and DB schema seams.
  - **Files:** `packages/db/src/**`, `packages/server/src/**`, `packages/app/src/**`
  - **Verify:** identify the smallest type/schema/test surface matching live `THE-46`.
- [x] Step 2: Implement policy input schema/types and ExternalSideEffect validation without deep gate orchestration.
  - **Files:** likely `packages/db/src/**` and/or `packages/server/src/**`
  - **Verify:** schema supports the required layers, risk inputs, trust inputs, separate review and human gate concepts.
- [x] Step 3: Add focused success and negative tests.
  - **Files:** colocated server/db tests
  - **Verify:** valid policy fixtures pass; malformed side effects, missing layers, or collapsed review/gate concepts fail safely.
- [x] Step 4: Run focused tests and required proof commands under Node 22.
  - **Files:** command receipts only
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, and `cd packages/server && npm run build && npx vitest run` pass.
- [ ] Step 5: Run CLI Tester four-step for `THE-46`.
  - **Files:** `output/entity-phase-2/test-gate/THE-46.*`, `output/entity-phase-2/book-review/THE-46.*`
  - **Verify:** request, run, book-review, and verify pass; verify reports `nextChildBlocked=false`.
- [ ] Step 6: Comment Linear, update run-state, commit, and advance only if gates pass.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-46`
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 21:12 | Setup | done | `THE-45` verify rerun passed under Node 22; `THE-46` and parent `THE-11` live Linear bodies read; branch created. |
| 21:16 | Steps 1-3 | done | Added additive task policy schema fields, ExternalSideEffect validation/envelope helpers, and DB repository tests for policy layers, separated review/gate state, and malformed side effects. Focused DB repository test and server build pass under Node 22. |
| 21:18 | Step 4 | done | `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, and `cd packages/server && npm run build && npx vitest run` passed under Node v22.22.2. GitNexus detect-changes reported low risk and no affected processes. |
| 21:20 | Step 5 | blocked | CLI Tester request and run passed. Book review receipt is `BLOCKED` / `REQUESTED` with `safeToContinue=false`. `verify` reran machine proof successfully but exited non-zero because Book approval is missing. Do not start `THE-47`. |
| 21:22 | Linear | done | Posted blocker/proof comment `07140823-6e51-45e3-836c-576e779e9043` to `THE-46`; run-state records the same blocker. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-46-policy-schema-risk-inputs-external-sideeffect-plan.md` - created - compaction-safe plan for `THE-46`.
- `docs/plans/ACTIVE_PLAN.md` - modified - active resume plan for `THE-46`.
- `packages/db/src/index.ts` - modified - policy input types, task schema columns, ExternalSideEffect validation, policy envelope helper, and repository persistence.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - policy fixture, review/gate separation, and malformed side-effect tests.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from the first unchecked step above.
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start `THE-47` until `THE-46` proof commands, CLI Tester run, Book review, and verify pass.

## Done
- [ ] `THE-46` implementation complete.
- [x] Focused tests pass.
- [x] Required proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass with `nextChildBlocked=false`.
- [x] Linear proof comment posted.
- [ ] Scoped commit created.
- [ ] Run-state advanced to `THE-47`.
