# MC-1465: Hide raw ClickClack/Go errors from Chat delivery failures

Date: 2026-09-07
Task: Mission Control #1465 (P1, reported by Mariam / miriampeter)
Worktree: /Users/enterprise/Code/entity-mc-1465 (detached at origin/main fc8ade4)

## Problem
Chat -> send -> ClickClack sidecar delivery failure returned the raw bridge
error into the chat UI: internal `go run ./apps/api/cmd/clickclack admin bot
create ...` command, absolute paths, workspace ID, bot handle, and the Go
toolchain error (`go.mod file not found ...`). (Exact path from the dogfood
report kept out of this public repo; see the private intake thread.)

## Root cause chain
1. `packages/server/src/clickclack/bridge.ts` `execFileText` (line ~180)
   throws `${command} ${args.join(' ')} failed: ${stderr}` — full command,
   paths, IDs, toolchain stderr.
2. `packages/server/src/routes/chat.ts` sidecar catch (~line 1761) put that
   raw `error.message` into the 202 degraded JSON: `error` and
   `clickclack.error`.
3. `packages/app/src/components/Chat/ChatOfflineProvider.tsx` rendered
   `payload.error` verbatim as the chat notice:
   `Delivery degraded — agent replies unavailable (${degradedReason}).`

## Fix (both ends of the boundary)
- Server: `publicChatDeliveryFailure()` in routes/chat.ts returns a fixed
  plain-language string (`SAFE_CHAT_DELIVERY_FAILURE`) for the 202 response and
  logs the full raw error to server telemetry
  (`[chat] agent delivery failed {event: chat_agent_delivery_failed, ...}`).
- App: ChatOfflineProvider no longer reads `payload.error` at all; degraded
  notices are the fixed string. Defense against stale-server drift.

Safe text: "The agent is temporarily unavailable. Please try again later or
contact your workspace admin to check the agent configuration."

## Checklist
- [x] Trace delivery failure flow and define safe boundary
- [x] Implement public sanitization with operator diagnostics
- [x] Add regression tests (chat-clickclack.test.ts: 'hides raw ClickClack/Go
      errors from the degraded delivery response'; updated legacy expectation)
- [x] Browser-verify failed-delivery UI (2 scenarios incl. raw-error drift)
- [x] Focused + full verification; close MC via review

## Verification receipts
- Focused: `npm --prefix packages/server run test -- src/routes/chat-clickclack.test.ts src/routes/chat.test.ts` -> 9 passed.
- Server suite (with change): 248 files, 2708/2710 passed; failures:
  terminal.test.ts shell-fallback (pre-existing, fails on clean baseline too)
  and managed-storage-broker.test.ts not_found (flaky under full-suite load;
  passes 21/21 focused).
- App unit suite: 553/553 pass.
- Builds: server tsc clean; app vite build clean.
- Browser (Playwright, real UI on :5187):
  - /tmp/mc1465-delivery-failure-ui.png — safe notice rendered, no raw detail.
  - /tmp/mc1465-raw-error-suppressed.png — server returns the EXACT raw dogfood
    error; UI still renders only the fixed notice (drift defense).

## Files touched
- packages/server/src/routes/chat.ts
- packages/server/src/routes/chat-clickclack.test.ts
- packages/app/src/components/Chat/ChatOfflineProvider.tsx
- docs/plans/2026-09-07-mc-1465-delivery-error-plan.md (this file)
- docs/plans/ACTIVE_PLAN.md (points here)

## Resume
Re-read this plan, inspect the worktree; if context compacts mid-review, all
receipts above are re-runnable from the commands listed.
