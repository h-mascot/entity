# Main Consolidation Plan (Phase 0)

## Task
Consolidate all live branches/worktrees into `main`, prune stale worktrees, and leave `main` green so feature work (stabilization, multiplayer, self-driving board) can proceed from one trunk.

## Created
2026-06-12 by Claude (approved by Henry: "consolidate and push main").

## Branch graph findings (verified 2026-06-12)

| Branch | vs main | Disposition |
|---|---|---|
| `origin/feature/clickclack-productization` | +17 / -0 | **Merge to main.** Superset: contains all 13 commits of `cleanup/open-source-readiness` AND all of `feature/discord-core-chat`. Adds ClickClack sidecar, entity-setup/doctor/dev scripts, gateway pull deployer. |
| `cleanup/open-source-readiness` (current) | +13 / -0 | Absorbed by the merge above. Delete after. |
| `feature/discord-core-chat` | +7 / -0 | Fully contained in clickclack branch (verified `git merge-base --is-ancestor`). Delete + remove worktree `~/Code/entity-discord-core-chat`. |
| `feature/entity-agent-contracts` | +8 / -0 | One unique commit: `284926c` (agent contracts plugin). Cherry-pick onto main, then delete + remove worktree `~/Code/entity-agent-contracts-wt`. |
| `task-400-github-gateway-deploy` | +5 / -1 | Mostly duplicated in clickclack (pull deployer exists in both). Sweep with `git cherry main task-400-github-gateway-deploy` after merge; cherry-pick anything unique (likely the manual-approval deploy CI commit `c234758`), then delete + prune `/tmp/entity-task400`. |
| `origin/book/mc-565-helm-stabilization` | +3 / -1 | Sweep same way; likely docs-only. |
| `origin/fix/auto-deploy-public-bore-url` | +4 / -1 | Sweep; the fail-fast webhook CI check may be unique. |
| `codex/onboarding-flow`, `codex/task-master-terminal-admin` | 0 ahead | Already merged. Delete. |

Stale worktrees to remove (verify clean first with `git -C <path> status --short`):
- 12 detached-HEAD worktrees under `~/.codex/worktrees/*/entity`
- `/tmp/entity-task400` (already marked prunable)

## Working-tree notes (current checkout)
- `docs/context/entity-context.md` is locally a symlink to `CONTEXT.md`; restore with `git checkout -- docs/context/entity-context.md` before switching branches. Do NOT commit the symlink (absolute machine path).
- `scripts/entity-fs-link.sh` is untracked and contains private Tailscale IP/Enterprise paths. Keep untracked; never commit.
- `docs/reports/private-default-scan-baseline.md` local timestamp drift already reverted.

## Execution steps
- [ ] Step 1: `git checkout -- docs/context/entity-context.md`; confirm `git status --short` shows only the untracked `scripts/entity-fs-link.sh`.
- [ ] Step 2: `git fetch origin --prune`.
- [ ] Step 3: `git checkout main && git pull --ff-only origin main`.
- [ ] Step 4: `git merge --no-ff origin/feature/clickclack-productization` (should be conflict-free; it is a strict superset of main).
- [ ] Step 5: `git cherry-pick 284926c` (agent contracts plugin).
- [ ] Step 6: Sweep small branches: `git cherry main <branch>` for `task-400-github-gateway-deploy`, `origin/book/mc-565-helm-stabilization`, `origin/fix/auto-deploy-public-bore-url`; cherry-pick `+` commits whose content is wanted; record dropped commits here.
- [ ] Step 7: Gates: `npm install && npm run build`; `cd packages/server && npx vitest run` (expect ~303 passing); `npm run scan:private-defaults -- --enforce`; `npm run ctrl:gate`.
- [ ] Step 8: `git push origin main`.
- [ ] Step 9: Delete merged local branches (`cleanup/open-source-readiness`, `feature/discord-core-chat`, `feature/entity-agent-contracts`, `task-400-github-gateway-deploy`, `codex/*`) and remote branches that are now contained in main.
- [ ] Step 10: Remove worktrees: for each stale path, `git -C <path> status --short` must be empty, then `git worktree remove <path>`; finish with `git worktree prune`.

## Verification
- `git log --oneline -5 main` shows merge + cherry-picks.
- All gates from Step 7 green.
- `git worktree list` shows only the primary checkout.
- `git branch -a` shows main (+ anything intentionally kept).

## Context for follow-on phases (approved sequence)
1. Stabilize + e2e every surface (next after Phase 0).
2. Split god files: `packages/app/src/App.tsx` (6,452 lines), `packages/server/src/index.ts` (6,029 lines); code-split frontend.
3. Multiplayer v1: no `users` table exists today; auth is single bearer token (`packages/server/src/middleware/api-auth.ts`), skipped when unset. Editor presence/session tables exist but lack identity.
4. Add-an-agent UX (OpenClaw, Claude Code/ACP providers first-class).
5. Self-driving task board: swarm dispatcher (`packages/server/src/swarm/dispatcher.ts`) already has an `autoDispatch` plugin setting plus TODOs for background poll loop, retry, WS notifications; Task Master scheduler only runs hygiene scans today.
6. Docs beyond markdown (code/images/CSV/PDF), ClickClack chat polish.
