# Entity Open-Source Readiness Cleanup Plan

## Task
Make the `entity` repo public-safe for open-source use without touching production runtime, DB files, secrets, or live services.

**MC Task:** #575
**Created:** 2026-05-07
**Agent:** Codex
**Status:** IN PROGRESS

## Context
Goal source of truth is the user-provided Geordi goal spec dated 2026-05-07. The local repo already contains one cleanup-related commit on `main` plus additional uncommitted changes touching docs, deploy scripts, config, and scan output. Remote inspection is limited in this environment: `git fetch origin` cannot update `.git/FETCH_HEAD`, and `gh` cannot reach GitHub, so local repo state is the working truth for this session.

## Dependencies
- [x] Step 1 has no dependencies
- [ ] Step 2 depends on Step 1 baseline and local branch choice
- [ ] Step 3 depends on Step 2 identifying the smallest remaining delta
- [ ] Step 4 depends on Step 3 edits landing cleanly
- [ ] Step 5 depends on Step 4 verification evidence

## Plan

- [ ] Step 1: Capture baseline and branch strategy from the current local repo state
  - **Files:** `docs/plans/ACTIVE_PLAN.md`, `docs/plans/2026-05-07-entity-open-source-readiness-cleanup-plan.md`
  - **Verify:** `git status --short --branch && npm run scan:private-defaults && npm run build && cd packages/server && npx vitest run`
- [ ] Step 2: Audit current cleanup changes and private-default findings
  - **Files:** `README.md`, `CONTEXT.md`, `docs/context/entity-context.md`, `deploy.sh`, `.gitignore`, `scripts/scan-private-defaults.mjs`, runtime/config files reported by scan
  - **Verify:** `rg -n "100\\.104\\.229\\.62|100\\.106\\.69\\.9|100\\.86\\.150\\.96|/Users/enterprise|/Users/henrymascot|/home/henrymascot|clawd-spock|clawd-zora|enterprise@" .`
- [ ] Step 3: Apply the smallest safe docs/runtime/deploy/artifact cleanup
  - **Files:** `CONTEXT.md`, `docs/context/entity-context.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.env.example`, `deploy.sh`, `.gitignore`, tracked backup/generated artifacts, any runtime/config files still carrying private defaults
  - **Verify:** `npm run scan:private-defaults`
- [ ] Step 4: Run required verification gates and capture remaining warnings/blockers
  - **Files:** `docs/reports/private-default-scan-baseline.md`, plan files as needed
  - **Verify:** `npm run scan:private-defaults -- --enforce && npm run build && cd packages/server && npx vitest run && npm run doctor && ENTITY_DEPLOY_DRY_RUN=1 ./deploy.sh --print-config`
- [ ] Step 5: Commit, push, and open a PR if the environment allows; otherwise document the exact blocker
  - **Files:** git metadata only
  - **Verify:** `git status --short && git log --oneline --decorate -n 3`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 15:00 | Context | done | Loaded root and docs context, goal spec, and repo planning rules |
| 15:08 | State | done | Found dirty local `main`, one local cleanup commit ahead of `origin/main`, and remote GitHub access limitations |
| 15:10 | Plan | in progress | Creating plan files before baseline and edits |

## Files Touched
- `docs/plans/2026-05-07-entity-open-source-readiness-cleanup-plan.md` - created - compaction-safe plan for MC task #575
- `docs/plans/ACTIVE_PLAN.md` - modified - mirror of current active task

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Re-run the pending verification commands if baseline output is missing
4. Find the first unchecked step above
5. Continue from there without reverting unrelated user changes

## Done
- [ ] All steps complete
- [ ] Required verification passes or blockers are documented with evidence
- [ ] Commit created
- [ ] Push/PR completed or environment blocker documented
- [ ] Completion event sent
