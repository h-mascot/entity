# RA-FU 930–934 Luna-Review Repair Plan (2026-08-04)

Branch: `runnerqa/ra-fu-930-934-20260804` (base `4c9dd5c`, repair HEAD after `b7d302a`).
Production forbidden. Gate: `cd packages/server && npm run build && npx vitest run` (Node 22) + app build.

## Luna blockers (5) + original-criteria gaps — ALL DONE

### Slice A — THE-930 (blockers 1 & 2): chat trust boundary + reservation leak
- [x] A1 noise guard — `release(...,{delivered})`; cooldown only on delivered=true.
- [x] A2 `/api/chat/send` derives sender/emoji/timestamp/isLocal from principal + server clock; ignores forged body.
- [x] A3 sidecar failure releases every reservation (try/finally); retry not duplicate-concurrent; no cooldown on failure.
- [x] A4 native path `release(...,{delivered:true})` on success.
- [x] A5 Chat UI surfaces `/api/chat/send` degraded state (Delivery degraded notice).

### Slice B — THE-932 (blocker 3 + healer gap): SMTP validator wired live + healer DB
- [x] B1 `createEmailChannelAdapter` validates SMTP at construction; plaintext auth fails closed.
- [x] B2 production `/api/channel-adapters` route exposes public-safe registry; plaintext cannot be registered.
- [x] B3 healer persistence uses injected `getDatabase` consistently.

### Slice C — THE-933 (blockers 4 & 5 + gaps)
- [x] C1 cloud-mode handoff returns 503 fail-closed before local repo; collision test.
- [x] C2 target principal authorized (exists/active/org+team/role); negatives.
- [x] C3 rollback scoped by id+task_id+mode+cloud_id+org; mismatch rejected.
- [x] C4 source/target task broadcast after committed local handoff.
- [x] C5 legacy `task_handoffs` schema fail-closed.

### Slice D — gate & receipt
- [x] D1 server build + vitest (Node 22): 1263 pass.
- [x] D2 app build OK.
- [x] D3 `npm run ctrl:gate` passed ✅ (db 44 + server 1263 + builds + 415).
- [x] D4 diff reviewed; backend-health no longer orphan (used by email-adapter); no dead parallel API.
- [x] D5 committed to branch.
- [x] D6 receipts/worker-final.json replaced.
- [x] D7 browser smoke: app loads, Chat composer renders, /api/channel-adapters + noise-settings + healer/status live, 0 console errors.

## Preserved
- THE-931 (chat-history auth) PASS — chat-history-auth + api-auth suites green.
- THE-934 (doc-intelligence schema) PASS — doc-intelligence suites green.
