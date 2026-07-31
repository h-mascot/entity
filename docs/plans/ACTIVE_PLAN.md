# ACTIVE PLAN — THE-877 / WP2-A-02 Invite-kit domain model

**Created:** 2026-07-31  
**Status:** COMPLETE (pending Linear reconcile)  
**Worktree:** `/Users/enterprise/Code/entity-the-877-wp2-a-02`

## Plan

- [x] Step 1: Pure invite-kit status machine + compatibility mapping
- [x] Step 2: Durable `agent_invites` (+ progress) schema/repository
- [x] Step 3: Run focused server/db tests + server build
- [ ] Step 4: Commit + receipts under WP2-A-02/

## Verify

```bash
cd packages/server && npm run build && npx vitest run src/agent/invite-kit
# 2 files / 26 tests PASS
cd packages/db && npx vitest run src/agent-invites.test.ts
# 1 file / 4 tests PASS
```

## Resume

Finish commit + receipts + Linear Done comment if Step 4 unchecked.
