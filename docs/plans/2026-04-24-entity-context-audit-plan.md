# Task Plan — Entity Context Audit

## Task
Validate the Entity context markdown against the current codebase and update stale context.

**MC Task:** #___
**Created:** 2026-04-24
**Agent:** Codex
**Status:** COMPLETE

## Context
- The user asked to load the Entity context markdown, compare it to the existing codebase, and update it if it is behind.
- Likely context docs are `CONTEXT.md`, `docs/context/entity-context.md`, and `memory/projects/entity/context.md`.
- Existing local app/server changes are present and must not be reverted.
- Server code edits are not expected. If any `packages/server/` source changes become necessary, add/update colocated tests and run `cd packages/server && npx vitest run`.

## Dependencies
- [x] Step 1 has no dependencies
- [x] Step 2 depends on Step 1 identifying the context docs and live repo shape
- [x] Step 3 depends on Step 2 producing specific stale claims
- [x] Step 4 depends on Step 3 patching only documentation

## Plan

- [x] Step 1: Inventory context docs and current monorepo structure
  - **Files:** `CONTEXT.md`, `docs/context/entity-context.md`, `memory/projects/entity/context.md`, `README.md`, `package.json`
  - **Verify:** `rg --files -g '*.md' | rg '(^CONTEXT.md$|docs/context|memory/projects/entity/context.md|README.md)'`
- [x] Step 2: Validate doc claims against package manifests and key app/server source paths
  - **Files:** `packages/app`, `packages/server`, `packages/db`, `packages/mobile`, `packages/desktop`
  - **Verify:** `find packages -maxdepth 2 -type f | sort | sed -n '1,160p'`
- [x] Step 3: Update stale context docs with current architecture, commands, and known constraints
  - **Files:** `CONTEXT.md`, `docs/context/entity-context.md`, `memory/projects/entity/context.md`
  - **Verify:** `git diff -- CONTEXT.md docs/context/entity-context.md memory/projects/entity/context.md`
- [x] Step 4: Run doc verification and summarize drift fixed
  - **Files:** docs only
  - **Verify:** `git diff --check`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 03:19 | Step 1 | ✅ | Found root, docs/context, and memory context files; read manifests and source tree |
| 03:25 | Step 2 | ✅ | Validated stack, deployment path, current package layout, APIs, plugins, fs/editor/swarm modules |
| 03:32 | Step 3 | ✅ | Updated stale host/deploy/stack/source-file/API context across all three context docs |
| 03:35 | Step 4 | ✅ | `git diff --check` passed and stale-claim search returned no matches |

## Files Touched
- `docs/plans/2026-04-24-entity-context-audit-plan.md` — created — durable plan for context audit
- `docs/plans/ACTIVE_PLAN.md` — modified — active execution pointer for compaction recovery
- `CONTEXT.md` — modified — refreshed root project context
- `docs/context/entity-context.md` — modified — refreshed expanded canonical context
- `memory/projects/entity/context.md` — modified — refreshed compact memory context

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done
- [x] All steps complete
- [x] Tests pass (not applicable: docs-only change)
- [x] ACTIVE_PLAN.md updated with completed task state
