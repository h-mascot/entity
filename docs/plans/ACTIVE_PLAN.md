# RA-FU 930–934 Luna-Review R2 Repair Plan (2026-08-04)

Branch: `runnerqa/ra-fu-930-934-20260804` (HEAD `13ab8bb`). Production forbidden.
Gate: `cd packages/server && npm run build && npx vitest run` (Node 22) + `npm --prefix packages/app run build`.
Review source: `clawd/output/entity/ra-fu-runnerqa-20260804/reviews/luna-review-r2.txt` (4 blockers + matrix gaps).

## Slice 1 — THE-932 healer success-state restore (blocker 3)
- [x] 1a RED: reload module after persisting success → restored `{result,timestamp,error:null}`.
- [x] 1b GREEN: `loadPersistedHealOutcome` accepts `error: null`.
- Files: `packages/server/src/swarm/healer.ts`, `packages/server/src/swarm/healer.test.ts`.

## Slice 2 — THE-932 healer DB consistency (blocker 4)
- [x] 2a RED: nonempty stuck-job; injected DB row healed; default/global DB untouched.
- [x] 2b GREEN: add `updateSwarmJobOn(db,...)`; healer writes via injected db only.
- Files: `packages/server/src/swarm/db.ts`, `packages/server/src/swarm/healer.ts`, `healer.test.ts`.

## Slice 3 — THE-933 cloud isolation (blocker 1)
- [x] 3a RED: spies/counters prove ZERO taskSyncLayer + repo access in cloud mode (list/create/rollback, incl. cloud/local id collision); remove `cloudHandoffAdapter` branches.
- [x] 3b GREEN: determine mode BEFORE getTask/authorization/repo; cloud permanently 503 before any local access; drop misleading adapter dep.
- Files: `packages/server/src/routes/tasks.ts`, `tasks-handoffs-route.test.ts`.

## Slice 4 — THE-932 SMTP boundary (blocker 2)
- [x] 4a RED: route tests — configured TLS registers with public-safe health; configured plaintext AUTH never registers/appears; no credential/internal leak; router errors sanitized.
- [x] 4b GREEN: env config loader for email adapter; register via `createChannelAdapterRegistryForRuntime`; explicit no-send boundary; sanitize router errors.
- Files: `packages/server/src/channels/router.ts`, `email-config.ts` (new), `email-adapter.test.ts`.

## Slice 5 — THE-930 DB-backed atomic reservation + admin auth (matrix gap)
- [x] 5a RED: two guard instances vs same DB → only one concurrent reservation wins; expiry/retry; mixed-target; admin negative route test.
- [x] 5b GREEN: DB-backed reservation backend (tx compare-and-set, lease expiry, success-only cooldown, bounded cleanup, injectable clock); `createAgentNoiseGuard({db})`; chat route uses DB-backed guard + admin-only PATCH.
- Files: `packages/server/src/routes/agent-noise-guard.ts`, `chat.ts`, `agent-noise-guard.test.ts`, `chat-noise-controls.test.ts`.

## Slice 6 — gate & receipt
- [ ] 6a server build + vitest (Node 22).
- [ ] 6b app build.
- [ ] 6c `npm run ctrl:gate`.
- [ ] 6d self-review full diff.
- [ ] 6e commit on branch; replace worker-final receipt.

## Preserved (must stay PASS)
- THE-931 (chat-history auth), THE-934 (doc-intelligence schema), prior THE-930 reservation/cooldown, broadcasts, rollback scope.
