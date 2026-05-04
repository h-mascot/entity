# Update Entity Docs

Update all project context documentation after a build or significant code change.

## What to update

Read the current state of the codebase and update these files in `docs/`:

### 1. `docs/codemap.md` - File structure map
- List all `.ts` and `.tsx` files under `packages/app/src/` and `packages/server/src/`
- Group by: components, hooks, server routes, utilities
- Note any new files added since last update

### 2. `docs/context.md` - Project overview
- Update the "Current Stats" section at the bottom with:
  - Component count, hook count, total TS files, total lines
  - Current branch and last commit hash
  - App and server dependencies from package.json
- Update any architecture sections if new patterns were introduced

### 3. `docs/decisions.md` - Architecture decisions
- If the recent commits introduced new patterns, libraries, or architectural choices, add a dated entry explaining:
  - What was decided
  - Why (tradeoffs considered)
  - Alternatives rejected

### 4. `docs/timeline.md` - Project timeline
- Add dated entry with recent commits (last 12 hours)

### 5. `docs/sessions-log.md` - Build session log
- Add entry with last commit and files changed

## How to run

You can also run the automated script:
```bash
./scripts/update-docs.sh
```

This handles codemap, stats, timeline, and sessions-log automatically. Decisions.md requires manual/AI judgment about what's architecturally significant.

## After updating
- `git add docs/ && git commit -m "docs: update project context" && git push origin main`
