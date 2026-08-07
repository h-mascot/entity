# Hide legacy standalone Swarm navigation

Date: 2026-08-08
Branch: `fix/hide-legacy-swarm-tab-20260808`
Base: `origin/main` at `af965939e0d9a3cfcb6ed108022dbfe44d2e2b23`

## Product contract

- General and Analytics are default boards.
- Engineering and Strategic are optional/customizable boards.
- Swarm is not a board or peer task-navigation tab.
- Agent execution is invoked through `Run with agents` in task detail.
- Preserve Swarm APIs, task-linked job status/proofs, provider/admin controls, and plugin implementation.

## Root cause

`App.tsx` correctly renders customizable boards through `BoardSwitcher`, but then appends every enabled `module-sub-view` plugin for `tasks` as a peer button. The `geordi-swarm` plugin still declares that mount point, so its legacy Swarm button remains visible even though Swarm was removed from board state.

## Steps

- [ ] Add a focused RED regression test proving execution-only task plugins are excluded from board navigation.
- [ ] Add the smallest pure selection helper and wire it into `App.tsx`.
- [ ] Verify the focused test GREEN and ensure task-level `Run with agents` tests still pass.
- [ ] Run app test/build and `npm run ctrl:gate` under Node 22.
- [ ] Run code review, fix findings, commit, push, PR, CI, merge.
- [ ] Deploy exact merged SHA to sandbox and browser-verify no standalone Swarm tab while `Run with agents` remains in task detail.
- [ ] Do not promote production without Henry's explicit approval.

## Files expected

- `packages/app/src/lib/mcBoardTabs.ts`
- `packages/app/src/lib/mcBoardTabs.test.ts`
- `packages/app/src/App.tsx`

## Verification

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm --prefix packages/app test -- --test-name-pattern="Swarm"
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm --prefix packages/app test
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm --prefix packages/app run build
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run ctrl:gate
```
