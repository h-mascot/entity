## Task
Fix five verified-exploitable Entity server security blockers.

**MC Task:** N/A
**Created:** 2026-07-01
**Agent:** GPT-5.5
**Status:** COMPLETE

## Context
Security review found exploitable symlink escapes, client-controlled local write capabilities, SSH option injection, and terminal session ownership gaps. User explicitly requested no commit/push. All changes are in `packages/server` with colocated Prove-It tests.

## Dependencies
- [x] Step 1 has no dependencies
- [x] Step 2 depends on reading FS adapter/security/legacy route tests
- [x] Step 3 depends on reading source/file route tests
- [x] Step 4 depends on reading geordi-swarm and entity-services SSH helper/tests
- [x] Step 5 depends on reading terminal ownership tests
- [x] Step 6 depends on all edits

## Plan

- [x] Step 1: Inspect cited files and relevant tests.
  - **Files:** `packages/server/src/fs/adapters/local.ts`, `packages/server/src/fs/security.ts`, `packages/server/src/routes/legacy-files.ts`, `packages/server/src/fs/routes-sources.ts`, `packages/server/src/fs/routes-files.ts`, `packages/server/src/plugins/geordi-swarm/routes.ts`, `packages/server/src/terminal.ts`
  - **Verify:** `git status --short`
- [x] Step 2: Add realpath containment helpers and apply them to local/source/legacy read-write paths.
  - **Files:** `packages/server/src/fs/security.ts`, `packages/server/src/fs/adapters/local.ts`, `packages/server/src/routes/legacy-files.ts`
  - **Verify:** `cd packages/server && npx vitest run src/fs/adapters/local.test.ts src/fs/security.test.ts`
- [x] Step 3: Clamp local capabilities on create/update and route write permission checks.
  - **Files:** `packages/server/src/fs/adapters/local.ts`, `packages/server/src/fs/routes-sources.ts`, `packages/server/src/fs/routes-sources.test.ts`, `packages/server/src/fs/routes-files.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/fs/routes-sources.test.ts src/fs/routes-files.test.ts`
- [x] Step 4: Validate geordi-swarm SSH hosts and compose SSH argv with `--`.
  - **Files:** `packages/server/src/plugins/geordi-swarm/routes.ts`, `packages/server/src/plugins/geordi-swarm/routes.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/plugins/geordi-swarm/routes.test.ts`
- [x] Step 5: Enforce terminal owner checks for subscribe and close.
  - **Files:** `packages/server/src/terminal.ts`, `packages/server/src/terminal.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/terminal.test.ts`
- [x] Step 6: Run required full gate.
  - **Files:** all touched files
  - **Verify:** `cd packages/server && npm run build && npx vitest run`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 23:24 | Step 1 | in progress | Cited files and tests are being inspected. |
| 23:30 | Steps 2-5 | complete | Security fixes and colocated Prove-It tests added. |
| 23:31 | Step 6 | complete | `cd packages/server && npm run build && npx vitest run` passed: 93 files, 642 tests. |

## Files Touched
- `docs/plans/2026-07-01-security-blockers-plan.md` — created — recovery plan
- `docs/plans/ACTIVE_PLAN.md` — updated — active recovery plan
- `packages/server/src/fs/security.ts` — modified — realpath containment helpers
- `packages/server/src/fs/adapters/local.ts` — modified — local realpath checks and local capability policy
- `packages/server/src/fs/adapters/local.test.ts` — modified — local symlink and capability regressions
- `packages/server/src/fs/security.test.ts` — modified — helper regressions
- `packages/server/src/routes/legacy-files.ts` — modified — legacy mutation realpath checks
- `packages/server/src/routes/legacy-files.test.ts` — created — legacy read/write symlink regressions
- `packages/server/src/fs/routes-sources.ts` — modified — local capability clamping on create/update
- `packages/server/src/fs/routes-sources.test.ts` — modified — local capability HTTP regression
- `packages/server/src/fs/routes-files.ts` — modified — source-root error mapping
- `packages/server/src/plugins/geordi-swarm/routes.ts` — modified — SSH host validation and argv terminator
- `packages/server/src/plugins/geordi-swarm/routes.test.ts` — modified — SSH host/argv regressions
- `packages/server/src/terminal.ts` — modified — subscribe/close owner checks
- `packages/server/src/terminal.test.ts` — modified — terminal subscribe/close regressions

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there; do not redo completed steps

## Done
- [x] All steps complete
- [x] Tests pass
- [x] No commit/push performed
