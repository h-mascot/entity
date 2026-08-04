# Final Focused Correction — THE-930/931/933 (R2 split reviews) ✅

Base HEAD: `6ccf28220b1438a56b3d795011bbec7c32f53931`. Branch: `runnerqa/ra-fu-930-934-20260804`.
Node 22 (`~/.nvm/versions/node/v22.22.2/bin` prepended to PATH). No merge/push/deploy/Linear/production.

Review source: `clawd/output/entity/ra-fu-runnerqa-20260804/reviews/split-r2/{THE-930,THE-931,THE-932-934}.txt`.

## THE-932 / THE-934 — PRESERVE (already PASS; do not regress)
- [x] healer lazy DB load; canonical grant semantics; own-property schema validation.

## Slice A — THE-930 tokenless stale release (fail-closed)
- [x] A1 RED: tokenless release after B reacquires is currently NOT a no-op (clears B). New regression test.
- [x] A2 GREEN: release() requires the exact ownerToken returned by that reserve; no `heldTokens` fallback; tokenless == no-op. Make typing reflect token requirement; update all internal callers/tests to pass their own token.
- [x] A3 preserve in-memory semantics via explicit-token tests (update agent-noise-guard.test.ts + agent-noise-guard-db.test.ts).
- Files: `agent-noise-guard.ts`, `agent-noise-guard-tokenless.test.ts`, `agent-noise-guard.test.ts`, `agent-noise-guard-db.test.ts`.

## Slice B — THE-933 deployed table collision (namespaced table)
- [x] B1 RED: precreate legacy `task_handoffs` schema + rows → new repo init must NOT throw / must not purge / must not alter destructively.
- [x] B2 GREEN: new feature table = `entity_task_handoffs_v2`; update all new repo SQL/tests; legacy table untouched.
- [x] B3 compat test: legacy rows unchanged + new handoff atomicity/rollback still work in v2 table.
- Files: `packages/db/src/handoffs.ts`, `packages/db/src/handoffs.test.ts`.

## Slice C — THE-931 creation/category/repository isolation
- [x] C1 RED: zero-grant channel creation denied; caller teamId ignored; same-org/different-team denied; foreign-ID collision no-leak; category list/create/setup scoped; legacy category fail-closed; valid org-wide/single-team creation pass.
- [x] C2 GREEN:
  - `resolveChatCreationScope`/`resolveChatReadScope` from binding/grants (ignore caller ownership; zero/revoked/inactive/no-applicable fail closed).
  - Channel creation derives org/team from grants (org-wide → org-wide; single-team → that team; multi-team ambiguous → fail closed).
  - Categories: add `org_id`/`team_id` (migration-safe); scope list/create/setup; legacy unowned fail-closed for agents (local-admin compat); creation requires assignment + server-derived scope.
  - DB-layer scoped repository (`createTenantChatRepository`) with scoped SQL predicates for channels/categories/threads/messages/ObjectRefs/mutations/counters. Routes use ONLY scoped access for tenant-facing ops.
  - Close raw bypasses: task lookup, thread message listing, ensureDefaults/setup, categories.
  - Remove global-ID existence oracles: tenant channel/thread/message creation always generates authoritative server IDs (ignores caller id); bootstrap/ensureDefaults keep server-supplied ids.
- Files: `packages/db/src/chat.ts`, `packages/server/src/routes/chat.ts`, new + updated tests.

## Slice D — gate & receipt
- [ ] D1 focused exploit tests individually + together under Node 22.
- [ ] D2 `cd packages/server && npm run build && npx vitest run`.
- [ ] D3 `npm --prefix packages/app run build`.
- [ ] D4 `npm run ctrl:gate` serially.
- [ ] D5 self-review all route calls for raw-repository bypasses + SQL scope.
- [ ] D6 coherent commits; clean worktree; update plan/state + worker-final receipt (HEAD/test proof/blockers=[]/productionUntouched=true).
