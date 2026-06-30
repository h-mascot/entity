## Task
Fix `/api/fs/tree` closed database connection caused by stale file source repository binding.

**MC Task:** n/a
**Created:** 2026-06-30
**Agent:** GPT-5.5
**Status:** COMPLETE

## Context
User reports `curl -s "http://127.0.0.1:3000/api/fs/tree?sourceId=workspace&path="` hangs and logs `The database connection is not open` from `packages/db/src/file-sources.ts:290` via `packages/server/src/fs/routes-files.ts:105`. The server runs with config bootstrap and a configured DB path.

## Dependencies
- [x] Step 1 has no dependencies.
- [x] Step 2 depends on identifying repository construction order.
- [x] Step 3 depends on a minimal route/repository patch.
- [x] Step 4 depends on server restart with patched code.

## Plan

- [x] Step 1: Confirm runtime root cause and affected construction order.
  - **Files:** `packages/server/src/index.ts`, `packages/server/src/fs/routes-files.ts`, `packages/db/src/entity-db.ts`, `packages/server/src/config/runtime.ts`
  - **Verify:** `timeout 5 curl -sS "http://127.0.0.1:3000/api/fs/tree?sourceId=workspace&path="`
- [x] Step 2: Patch file routes to avoid a repository created before bootstrap DB path selection.
  - **Files:** `packages/server/src/fs/routes-files.ts`, possibly `packages/server/src/fs/index.ts`
  - **Verify:** `npm --prefix packages/server run build`
- [x] Step 3: Add/adjust colocated coverage for DB path switching or route dependency injection.
  - **Files:** `packages/server/src/fs/routes-files.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/fs/routes-files.test.ts`
- [x] Step 4: Verify provided repro and healthy document state endpoint on the local server.
  - **Files:** none
  - **Verify:** `timeout 10 curl -sS "http://127.0.0.1:3000/api/fs/tree?sourceId=workspace&path="` and document state curl

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 22:35 | Step 1 | ✅ | Found module-level `sourceRepo` constructed before bootstrap env can run. |
| 22:40 | Step 2 | ✅ | Moved file-route repository creation to registration time and passed the FS router repo. |
| 22:41 | Step 3 | ✅ | Added route regression coverage for DB path switching and missing-source response. |
| 22:43 | Step 4 | ✅ | Restarted tmux server; fs tree and document state endpoints returned HTTP 200. |

## Files Touched
- `docs/plans/2026-06-30-file-source-closed-db-plan.md` — created — completed resumable plan.
- `docs/plans/ACTIVE_PLAN.md` — created — current active plan.
- `packages/server/src/fs/routes-files.ts` — modified — register-time repository creation with injectable dependency.
- `packages/server/src/fs/index.ts` — modified — passes the post-bootstrap source repository to file routes.
- `packages/server/src/fs/routes-files.test.ts` — created — regression coverage for DB path switching and missing source errors.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections.
5. Continue from there — do NOT redo completed steps.

## Done
- [x] All steps complete
- [x] Tests pass (if applicable)
- [ ] MC task moved to review
- [x] ACTIVE_PLAN.md cleared or updated for next task
## Task

Audit Doc Hub interactive features, test what works locally, and fix document comment @agent replies with document context.

**MC Task:** N/A
**Created:** 2026-06-30
**Agent:** GPT-5.5
**Status:** IN PROGRESS

## Context

User wants an exhaustive audit of Doc Hub capabilities beyond viewing documents, especially the workflow: open/edit a markdown document, select text, comment, tag an agent, and have the agent respond with the right context. Initial code audit found document comments are persisted and anchored, but @mentions in document comments are not routed to any agent responder.

## Dependencies

- [x] Step 1 has no dependencies
- [x] Step 2 depends on identifying existing UI/API flows
- [x] Step 3 depends on backend doc-comment and task-comment responder context
- [x] Step 4 depends on implementation changes
- [x] Step 5 depends on automated tests passing
- [x] Step 6 depends on a local server with built app assets

## Plan

- [x] Step 1: Inventory Doc Hub interactive features and identify broken paths
  - **Files:** read-only audit of `packages/app/src/**`, `packages/server/src/**`, `packages/db/src/**`
  - **Verify:** `rg -i "documents|comments|mention|MarkdownPreview|CodeMirrorEditor" packages`
- [x] Step 2: Establish test strategy and fixtures for document comment agent replies
  - **Files:** `packages/server/src/editor/**`, `packages/server/src/agent/**`
  - **Verify:** Identify existing Vitest setup and injectable dependencies
- [x] Step 3: Implement document-comment @mention responder with selected-text and document context
  - **Files:** `packages/server/src/editor/service.ts`, `packages/server/src/editor/routes.ts`, `packages/server/src/agent/comment-responder.ts`, related tests
  - **Verify:** New/updated Vitest tests cover success and degraded no-model paths
- [x] Step 4: Build and run automated gates
  - **Files:** server/app build output only
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm run build`
- [x] Step 5: Manually verify Doc Hub workflows in browser
  - **Files:** none
  - **Verify:** Browser proof for open/edit markdown, selected-text comment, agent reply, and a degraded/no-model response
- [x] Step 6: Commit, push, and create/update PR
  - **Files:** all modified files
  - **Verify:** `git status --short`; `git push -u origin cursor/doc-comment-agent-replies-c07b`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 22:15 | Step 1 | ⏳ | Parallel code audit started; major doc-comment @mention gap found |
| 22:22 | Step 1-3 | ✅ | Added document-comment responder and editor service hook |
| 22:23 | Step 4 | ✅ | `cd packages/server && npm run build && npx vitest run` passed |
| 22:27 | Step 4 | ✅ | Fixed malformed editor bearer auth regex; full server gate and workspace build pass |
| 22:52 | Step 5 | ⏳ | Browser found comment sidebar hidden; made collaboration sidebar visible and auto-expanded when panels load |
| 23:02 | Step 5 | ⏳ | Browser found UI/backend docId mismatch; normalized frontend doc IDs to `source:/path` |
| 23:08 | Step 5-6 | ✅ | Browser proof recorded and PR request updated |

## Files Touched

- `docs/plans/2026-06-30-doc-comment-agent-replies-plan.md` — created — compaction-safe plan
- `docs/plans/ACTIVE_PLAN.md` — created/updated — active execution plan
- `packages/server/src/agent/document-comment-responder.ts` — created — document comment @mention reply path
- `packages/server/src/agent/document-comment-responder.test.ts` — created — responder unit tests
- `packages/server/src/editor/service.ts` — modified — invokes document mention responder from comments/replies
- `packages/server/src/editor/service.test.ts` — created — service hook tests
- `packages/server/src/editor/auth.ts` — modified — fixes Documents API bearer token parsing
- `packages/server/src/editor/auth.test.ts` — created — route-level service token auth tests
- `packages/server/src/editor/index.ts` — modified — accepts agent registry dependency
- `packages/server/src/index.ts` — modified — passes agent registry into editor module
- `packages/app/src/App.tsx` — modified — makes document collaboration sidebar visible and auto-expands when threads load
- `packages/app/src/App.tsx` — modified — normalizes document IDs to `source:/path`

## Resume Instructions

1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done

- [x] All steps complete
- [x] Tests pass (if applicable)
- [x] PR created or updated
- [x] ACTIVE_PLAN.md cleared or updated for next task
## Task

Write the Entity Phase 2 rollback runbook and release checklist.

**MC Task:** THE-95
**Created:** 2026-06-24T18:15Z
**Agent:** GPT-5.5
**Status:** IN PROGRESS

## Context

Implement THE-20.5 / THE-95 from the release observability and proof gates parent. THE-95 documents rollout/rollback procedures, release readiness tests, proof attachment standards, and the operator checklist for Phase 2 launch.

Branch: `THE-95-rollback-runbook-release-checklist`
Linear: `THE-95` / parent `THE-20`
Base checkpoint: THE-94 approved commit `b426844`.

This ticket is documentation and proof only. It must not add runtime behavior, broaden strict enforcement, expose sensitive material, add Google mutation, add Helm deep admin controls, block core Entity flows on ClickClack availability, or fabricate historical receipt certainty.

## Dependencies

- [x] Required Phase 2 repo context read: `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, build context, canonical PRD, detailed spec excerpt `E15.T5`/`E15.T6`, current gap matrix, local live-verified THE-95 issue packet, and THE-20 parent excerpt.
- [x] THE-94 supervisor approval received; THE-94 is safe to continue.
- [x] Branch created from clean THE-94 checkpoint.
- [x] Runbook content depends on THE-90 migration rollback docs, THE-91 staged flags, THE-92 diagnostics, THE-93 first-session proof, and THE-94 boundary gate.
- [ ] Book/packet verify depends on docs proof and required repo proof passing.

## Plan

- [x] Step 1: Add THE-95 rollback runbook covering flags, migration rollback, receipt failure recovery, Task Master runaway loop, search permission leak, connector degradation, notification failure, and audit preservation.
  - **Files:** `docs/runbooks/entity-phase-2-rollback-runbook.md`
  - **Verify:** `rg "THE-95|feature flag|migration rollback|receipt writer|Task Master|search permission|connector degradation|notification failure|audit trail" docs/runbooks/entity-phase-2-rollback-runbook.md`
- [x] Step 2: Add THE-95 release checklist with PRD release readiness tests, boundary checks, proof scripts, Linear issue map links, and a completed staging sample checklist.
  - **Files:** `docs/runbooks/entity-phase-2-release-checklist.md`
  - **Verify:** `rg "THE-95|release readiness|receipt proof|Curacel|Paperclip|Entity/Helm/ClickClack|proof:phase2:first-session|proof:phase2:boundary|staging sample" docs/runbooks/entity-phase-2-release-checklist.md`
- [x] Step 3: Run focused documentation proof.
  - **Files:** none
  - **Verify:** focused `rg` checks above and `git diff --check`
- [x] Step 4: Run required repo proof.
  - **Files:** none
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm run build`; `bash scripts/proof/entity-phase-2-smoke.sh`
- [ ] Step 5: Run CLI Tester request/run/book-review/verify flow. BLOCKED: packet-only Book review returned `decision=REQUESTED`, `safeToContinue=false`; verify was not run.
  - **Files:** ignored `output/entity-phase-2/test-gate/THE-95.json`, `output/entity-phase-2/book-review/THE-95.json`
  - **Verify:** `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json verify THE-95 THE-95-rollback-runbook-release-checklist`
- [x] Step 6: Inspect final status and report.
  - **Files:** none
  - **Verify:** `git status --short --branch`, proof receipt paths, Book gate status

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 18:15Z | Setup | COMPLETE | Read required repo context, THE-95 local issue packet, parent THE-20 excerpt, detailed spec `E15.T5`/`E15.T6`, current gap matrix, and prior THE-90 through THE-94 proof surfaces. |
| 18:15Z | Branch | COMPLETE | Created `THE-95-rollback-runbook-release-checklist` from approved THE-94 commit `b426844`. |
| 18:15Z | Plan | COMPLETE | Created compaction-survivable THE-95 plan before doc implementation. |
| 18:20Z | Steps 1-3 | COMPLETE | Added rollback runbook and release checklist; focused doc `rg` checks and `git diff --check` passed. |
| 18:25Z | Step 4 | COMPLETE | Node 26 hit the known `better-sqlite3` ABI mismatch; reran under Node 22.22.2 and server build + 74 files / 552 Vitest tests, root build, Phase 2 smoke, first-session proof, and boundary gate passed. |
| 18:30Z | Step 5 | BLOCKED | CLI Tester request/run PASS, banned/private scans 0/0, but Book review is packet-only `REQUESTED` with `safeToContinue=false`; stopped before verify per gate discipline. |
| 18:32Z | Step 6 | COMPLETE | Final status/diff inspected; `git diff --check` passes; GitNexus detect_changes reports low risk, no changed symbols, no affected processes. |

## Files Touched

- `docs/plans/2026-06-24T181500Z-entity-phase-2-the-95-rollback-runbook-release-checklist-plan.md` - created - compaction-survivable THE-95 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-95.
- `docs/runbooks/entity-phase-2-rollback-runbook.md` - created - Phase 2 rollback triggers, actions, recovery proof, and audit-preservation rules.
- `docs/runbooks/entity-phase-2-release-checklist.md` - created - Phase 2 release readiness checklist, proof commands, PRD release tests, and staging sample.
- `output/entity-phase-2/test-gate/THE-95.json` - generated - CLI Tester request/run receipt (ignored).
- `output/entity-phase-2/book-review/THE-95.json` - generated - packet-only Book review request receipt (ignored).

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Confirm branch is `THE-95-rollback-runbook-release-checklist`.
4. Find the first unchecked step above.
5. Continue from the first unchecked step; do not redo completed proof unless changed files affect it.
6. If Book review returns packet-only `REQUESTED`, stop at the Book gate and wait for supervisor review.

## Done

- [ ] All steps complete
- [x] Focused documentation proof passes
- [x] Full repo proof passes
- [x] Proof artifacts generated
- [x] Book review completed or stopped at requested Book gate
