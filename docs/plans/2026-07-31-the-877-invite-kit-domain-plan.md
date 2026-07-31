# THE-877 / WP2-A-02 — Invite-kit domain model + status machine

**MC Task:** THE-877  
**Created:** 2026-07-31  
**Agent:** cursor-grok-4.5-high-fast  
**Status:** COMPLETE (pending commit/receipts)

## Context

Define durable invite-kit domain model and status machine for Agents invite productization. Source truth: THE-876 audit. Do not ship `/api/agents/invites*` routes. Keep tokenized onboarding session compatibility.

## Dependencies

- [x] WP2-A-01 / THE-876 Done (`f9bc960`)

## Plan

- [x] Step 1: Pure invite-kit status machine + compatibility mapping under `packages/server/src/agent/invite-kit/`
  - **Verify:** `cd packages/server && npx vitest run src/agent/invite-kit` → 26 PASS
- [x] Step 2: Durable `agent_invites` (+ progress) schema/repository foundation in `packages/db/src/agent-invites.ts`
  - **Verify:** `cd packages/db && npx vitest run src/agent-invites.test.ts` → 4 PASS
- [x] Step 3: Context doc + server/db builds
  - **Verify:** `cd packages/server && npm run build && npx vitest run src/agent/invite-kit` and db tests
- [ ] Step 4: Commit + receipts under remaining-roadmap-runner/receipts/proof/WP2-A-02/

## Files Touched

- `packages/server/src/agent/invite-kit/*`
- `packages/db/src/agent-invites.ts` (+ test)
- `packages/db/src/index.ts` (schema ensure)
- `docs/context/entity-wp2-a-02-invite-kit-domain-model.md`
- `docs/plans/2026-07-31-the-877-invite-kit-domain-plan.md`
- `docs/plans/ACTIVE_PLAN.md`

## Resume Instructions

1. Re-read this file + THE-876 audit
2. `git status` / `git diff`
3. Continue from first unchecked step
4. Do not invent `/api/agents/invites*` HTTP routes

## Non-goals

- No Agents UI, no regenerate/revoke HTTP endpoints (WP2-A-03/05)
- No production promotion / secrets / OAuth
- Do not touch canonical dirty worktree `/Users/enterprise/Code/Entity`
