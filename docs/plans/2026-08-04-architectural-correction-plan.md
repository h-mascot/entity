# Architectural Correction Pass — THE-930/931/932/933/934  ✅ IMPLEMENTED

Base HEAD: `4fe53ac9730ce5b81435bc0a6ba1fd83a2cbb90c`. Run tests under Node 22 (`nvm use 22`).

## Status: ALL DEFECTS FIXED + TESTS GREEN (focused). Full gate pending.

## THE-930 — tokenized lease CAS + fail-closed policy + bounded state ✅
- Fixed DB `tryReserve`: retain generated token (no extra SELECT).
- Fixed ordering bug: cooldown/concurrent checked BEFORE capacity (in-cooldown key at capacity now returns `cooldown`, not `capacity`); capacity gate only on new-key path.
- Removed broken in-memory `release` pre-check.
- Added `agent-noise-guard-cas.test.ts` (7 cases, isolated DB/clock each): stale-lease CAS, two same-key reservations, exact bounded capacity (fail-closed), live-cooldown preservation, stale-row eviction, degraded-policy on throw, no-silent-mute-clear.

## THE-934 — own-property schema validation ✅
- Extended `doc-intelligence.test.ts`: `{}` rejects toString/constructor/__proto__/hasOwnProperty/valueOf; combined inherited+own; Owner vs Homeowner; valid own fields.

## THE-933 — canonical grant semantics ✅
- Extracted exported `grantCoversTaskTarget` (canonical team semantics) in tasks.ts; `authorizeHandoffTarget` reuses it.
- Added `tasks-handoff-target-auth.test.ts`: org-wide task rejects team-only grant (negative) + org-wide/matching-team positives + role/org edge cases.

## THE-932 — healer lazy DB load ✅
- Added `healer-production-order.test.ts`: importing swarm seam + healer performs ZERO DB I/O (filesystem probe); lazy restore reads only the configured DB.

## THE-931 — repository-boundary tenant isolation ✅
- `ownsChatResource` reuses canonical `resolveInheritedRole` (not weaker hand-rolled logic).
- Added `ChatTenantScope` + `createScopedChatRepository` (reads no-leak; writes inherit owned parent scope, ignore caller teamId).
- Refactored ALL chat routes through the scoped repo (task-context, list-all, messages, threads, object-refs GET/POST, channel PATCH/DELETE/read, thread create, setup, send + counters).
- Updated `chat-object-refs.test.ts` to stricter behavior (real parent message, consistent org).
- Added `chat-tenant-scope.test.ts` (pure-logic, 8 cases): two orgs/two teams, foreign IDs, legacy fail-closed, team mismatch, write-ownership derivation.
- Added `chat-tenant-http.test.ts` (real principal/grant resolution, 9 cases): list-all, no-grant 403, no-leak 404, mutations, read marker, setup, disabled principal, thread creation.

## Gate (pending)
- [ ] `cd packages/server && npm run build && npx vitest run` (Node 22)
- [ ] `npm run ctrl:gate` serially
- [ ] Coherent commits, clean worktree, receipt
