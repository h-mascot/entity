# 2026-05-21 Entity ClickClack Productization

## Objective

Productize the Entity ClickClack chat setup/dev path so a fresh checkout can run setup, start Entity with the embedded ClickClack sidecar, and verify the bridge with doctor/smoke evidence.

## Checklist

- [x] Load Entity context and identify source-of-truth branch/runtime.
- [x] Port ClickClack sidecar scripts, pin, proxy, bridge, and focused tests from the sandbox artifact into the Git-backed branch.
- [x] Adapt `npm run setup`, `npm run dev`, and `npm run doctor` to the branch's newer config/productization path.
- [x] Run focused tests/builds.
- [x] Run browser/API smoke proof for `/clickclack/` and `/api/chat/send`.
- [x] Capture evidence and move MC #572 to review.

## Files Touched

- `package.json`
- `README.md`
- `docs/plans/ACTIVE_PLAN.md`
- `docs/plans/2026-05-21-entity-clickclack-productization.md`
- `docs/specs/clickclack-sidecar-pin.json`
- `docs/specs/clickclack-reuse-assessment-2026-05-16.md`
- `docs/specs/entity-clickclack-sidecar-spike.goal.txt`
- `docs/specs/entity-discord-core-chat-spec-2026-05-16.md`
- `docs/specs/entity-discord-core-chat-native-wip-before-clickclack-pivot.patch`
- `packages/server/src/clickclack/bridge.ts`
- `packages/server/src/clickclack/bridge.test.ts`
- `packages/server/src/clickclack/proxy.ts`
- `packages/server/src/clickclack/proxy.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/routes/chat.ts`
- `packages/server/src/routes/chat-clickclack.test.ts`
- `scripts/clickclack-sidecar-lib.mjs`
- `scripts/clickclack-sidecar-lib.test.mjs`
- `scripts/clickclack-sidecar.mjs`
- `scripts/entity-dev.js`
- `scripts/entity-doctor.js`
- `scripts/entity-setup.js`

## Progress Log

- 2026-05-21: Confirmed current branch `cleanup/open-source-readiness` at `913fbc6`, with sandbox ClickClack work isolated in `/Users/enterprise/Code/entity-clickclack-dev`.
- 2026-05-21: Merged ClickClack productization into a local patch workspace while preserving the branch's newer external setup/config work.
- 2026-05-21: Verified `npm run clickclack:test`, `npm run build`, `npm run setup -- --check`, `npm run doctor`, `npm run clickclack:smoke`, and Playwright screenshot proof for `/clickclack/`.
- 2026-05-22: Fixed Codex review findings around token manifest ignore rules, bridged message persistence/id reconciliation, ClickClack auth cookie scope, authenticated smoke requests, redirect rewriting, and safe JSON route rewriting.
- 2026-05-22: Final verification passed: `npm run clickclack:test` (17 tests), `npm run build`, authenticated `npm run clickclack:smoke`, and browser screenshot evidence at `docs/plans/evidence/2026-05-22-clickclack-productization-final.png`.

## Resume Instructions

If context compacts, re-read `docs/plans/ACTIVE_PLAN.md`, inspect `git status --short --branch`, then continue from the first unchecked item above. Do not report completion until MC #572 is moved to review with test/browser evidence.
