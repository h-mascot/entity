# T-029 — Local DOCX milestone

**Linear:** THE-970 / T-029
**Created:** 2026-08-23
**Agent:** Codex CLI (Geordi)
**Base:** `0b6e4a746116e04463329782c24d400bfb36ff3d`
**Status:** IN PROGRESS

## Context

Deliver the first real local Office format behind the accepted T-025 engine boundary and
the T-026–T-028 bridge, managed-storage, watcher, safe-save, revision, activity, registry,
and stable-link seams. The implementation stays in this isolated worktree and must not
mutate Linear, runner state, main, sandbox, or production. Capability and fidelity claims
must be limited to automated local fixture evidence actually produced.

## Dependencies

- [x] Exact isolated worktree is clean and based at the requested integrated runner SHA.
- [x] Step 2 depends on the accepted T-025–T-028 seams and provider contract being mapped.
- [x] Step 3 depends on the lifecycle tracer test and public engine surface from Step 2.
- [x] Step 4 depends on all write paths using the same validated OOXML boundary.
- [x] Step 5 depends on focused tests being green.
- [x] Step 6 depends on all implementation and evidence being complete.

## Plan

- [x] Step 1: Read and map the canonical T-029 requirements and accepted seams.
  - **Files:** canonical PRD, issue map, local engine ADR, T-025–T-028 code/tests/evidence, provider/revision/activity/registry contracts
  - **Verify:** `git rev-parse HEAD && git status --short`
- [x] Step 2: Add a RED lifecycle fixture test, then implement DOCX create/open and human save/reopen through the canonical local seams.
  - **Files:** `packages/server/src/document-providers/local/docx-engine.ts`, colocated tests and DOCX fixtures
  - **Verify:** `cd packages/server && npx vitest run src/document-providers/local/docx-engine.test.ts`
- [x] Step 3: Add RED tests, then implement bounded structured text mutation with stale-revision, version/activity, receipt, and stable Entity-link integration.
  - **Files:** DOCX engine/tests plus only same-issue adjacent canonical seams proven necessary
  - **Verify:** focused DOCX and touched-seam Vitest suites
- [x] Step 4: Add malicious/invalid OOXML fixture tests and enforce path, macro, relationship, size, ratio, entry-count, and package-shape limits without weakening configured ceilings.
  - **Files:** DOCX engine/tests/fixtures
  - **Verify:** focused DOCX security tests
- [x] Step 5: Record evidence and run focused, native/local, typecheck/build, full server, and diff/artifact gates.
  - **Files:** `docs/plans/evidence/entity-document-integrations/T-029/EVIDENCE.md`
  - **Verify:** exact commands and results recorded in evidence
- [ ] Step 6: Run Codex, two-axis, Jeff Dean, and required adversarial reviews; fix verified findings; create one focused commit.
  - **Files:** all T-029 paths
  - **Verify:** clean review result, clean post-commit worktree, final 40-character SHA

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-08-23 | Step 1 | ✅ | Canonical PRD, issue map, ADR, provider/revision/activity, and T-025–T-028 seams mapped. |
| 2026-08-23 | Steps 2–4 | ✅ | 49 focused tests pass; server TypeScript build passes under Node 22. |
| 2026-08-23 | Step 5 | ✅ | 212 local/native tests, builds, private scan, and release tests pass; three unchanged broader route assertions recorded. |

## Files Touched

- `docs/plans/2026-08-23-t029-local-docx-milestone-plan.md` — created — durable execution plan.
- `docs/plans/ACTIVE_PLAN.md` — modified during execution — active resume state.
- `tasks/todo.md` — modified — task checklist and final review receipt.
- `packages/server/src/document-providers/local/docx-engine.ts` — created — bounded DOCX codec and canonical lifecycle orchestration.
- `packages/server/src/document-providers/local/ooxml-package.ts` — created — audited in-memory ZIP boundary separated from lifecycle orchestration.
- `packages/server/src/document-providers/local/document-operation.ts` — created — canonical operation claim/completion/uncertain recovery adapter.
- `packages/server/src/document-providers/local/docx-engine.test.ts` — created — lifecycle, fidelity, stale-write, and hostile OOXML proof.
- `packages/server/src/document-providers/local/fixtures/docx/` — created — sanitized semantic fixture and capability-honest fixture notes.
- `packages/server/src/document-providers/local/engine-spike.ts` — modified — completes the accepted LocalOfficeEngine lifecycle/mutation types for T-029.
- `packages/server/src/document-providers/local/engine-spike.test.ts` — modified — provider-neutral engine contract regression.
- `docs/plans/evidence/entity-document-integrations/T-029/EVIDENCE.md` — created — exact automated, manual, and blocker proof.

## Resume Instructions

1. Re-read this file and `docs/plans/ACTIVE_PLAN.md` fully.
2. Run `git status --short`, `git diff`, and `git rev-parse HEAD`.
3. Confirm no work occurred outside this exact worktree and no runner-state paths changed.
4. Continue from the first unchecked step; do not repeat completed RED→GREEN slices.
5. Preserve capability honesty: automated OOXML semantics are not external Office/editor proof.

## Done

- [ ] All steps complete.
- [x] Focused/relevant tests pass and unchanged broader failures are recorded exactly.
- [ ] Generated build artifacts are absent from git.
- [x] Evidence records exact commands, outcomes, and manual-proof status.
- [ ] One focused commit created without merge, push, deploy, Linear, or runner-state mutation.
