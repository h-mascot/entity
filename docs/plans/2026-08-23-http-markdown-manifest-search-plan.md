# HTTP Markdown Manifest Search Plan

## Task
Add bounded manifest-backed listing and indexing for `http-markdown` sources while preserving exact-read-only behavior without a valid manifest.

**Created:** 2026-08-23  
**Agent:** Geordi  
**Status:** IN PROGRESS

## Context
`http-markdown` currently supports exact reads only. The follow-up must avoid remote crawling, keep existing path/text/read limits, and distinguish configured exact-read-only sources from manifest-backed searchable sources. No production deployment or push is in scope.

## Dependencies
- [x] Existing adapter, source config, index runner, and UI/API seams inspected
- [ ] Manifest contract and security tests added
- [ ] Adapter/config/index runner implementation complete
- [ ] Focused and full server/app verification complete

## Plan

- [x] Step 1: Add the versioned, bounded manifest contract and adapter listing/capability behavior.
  - **Files:** `packages/server/src/fs/adapters/http-markdown.ts`, `packages/server/src/fs/adapters/http-markdown.test.ts`
  - **Verify:** `cd packages/server && /opt/homebrew/opt/node@22/bin/npx vitest run src/fs/adapters/http-markdown.test.ts`
- [x] Step 2: Wire `manifestPath` through config/API persistence and expose truthful source mode in the UI/API.
  - **Files:** `packages/server/src/config/schema.ts`, `packages/server/src/config/runtime.ts`, `packages/server/src/fs/routes-sources.ts`, `packages/app/src/types/filesystem.ts`, `packages/app/src/components/settings/FileSourcesSettings.tsx`, related tests
  - **Verify:** focused config/source tests and app build
- [x] Step 3: Prove the index runner indexes manifest-listed markdown files without crawling.
  - **Files:** `packages/server/src/fs/index-runner.test.ts` or a focused integration test
  - **Verify:** focused index runner test
- [ ] Step 4: Run the required gates, review the diff, and write a receipt.
  - **Files:** `docs/receipts/2026-08-23-http-markdown-manifest-search.md`
  - **Verify:** server build + full Vitest + app build; no deploy/push

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-08-23 | Context | done | Adapter is exact-read-only; persisted capabilities JSON is the compatible extension seam. |
| 2026-08-23 | Step 1 | done | Manifest validation/listing/capability tests pass; loopback fixture branch is unavailable in this sandbox. |
| 2026-08-23 | Steps 2-3 | done | Config/API/UI wiring and runner indexing assertion pass. |
| 2026-08-23 | Step 4 | partial | Builds and focused tests pass; full DB-backed suite awaits native better-sqlite3 binding. |

## Files Touched
- `docs/plans/2026-08-23-http-markdown-manifest-search-plan.md` — created — task plan
- `docs/plans/ACTIVE_PLAN.md` — updated — compaction resume mirror
- `docs/receipts/2026-08-23-http-markdown-manifest-search.md` — created — changed files, verification, result, and open questions

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff`.
3. Continue from the first unchecked step.
4. Do not deploy or push.

## Done
- [ ] All steps complete
- [ ] Tests pass
- [ ] Receipt written
- [ ] ACTIVE_PLAN.md updated for task closeout
