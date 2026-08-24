# Repair Plan: Luna-high Review Findings (worker run 2026-08-24)

Worktree: `/Users/enterprise/Code/entity-deploy-recovery-reconcile-20260824`
Branch: `recovery/reconcile-all-deploys-20260824` (from `8f5fdca`)
Scope: exactly six Luna-high findings from the governed review. RED-first tests per finding.
Not in scope: org-scoped live WS broadcasts, business invite acceptance (Henry decision slices),
push/PR/merge/deploy (manager owns REC-009/REC-010).

## Steps

- [x] 1. F1 deploy resume: RED unit + end-to-end fake-SSH test (metadata-less non-SHA dir rejected, no sync after rejection); fix `decideDeployTarget`; GREEN. Verify: `node --test scripts/entity-deploy-target-guard.test.mjs`
- [x] 2. F2 live verifier: RED tests per unavailable artifact class (manifest app/server hash, recomputed hashes, release/served index); fail-closed `decideDrift`; GREEN. Verify: `node --test scripts/entity-deploy-live-verify.test.mjs`
- [x] 3. F3 curacel org/team validation: RED cross-org + phantom-org tests (policies, connectors, dashboards, samples) proving no rows; validate via workspace repo before mutation; GREEN. Verify: `cd packages/server && npx vitest run src/routes/curacel-operations.test.ts`
- [x] 4. F4 agent-import channel IDOR: RED cross-tenant channel test (zero side effects); org/team-scoped channel lookup; GREEN. Verify: `npx vitest run src/routes/agent-import.test.ts`
- [x] 5. F5 chat-history scope IDOR: RED cross-tenant test; require channel-to-org/team association before upsertChannelScope; GREEN. Verify: `npx vitest run src/routes/chat-history-access.test.ts`
- [x] 6. F6 cooldown delete mapping: RED cross-tenant delete test (cooldown remains); apply creation-time mapping validation on DELETE; GREEN. Verify: `npx vitest run src/routes/chat-noise-controls.integration.test.ts`
- [x] 7. Suites: server vitest full, db vitest, app tests, `npm run test:release-deploy`
- [x] 8. `npm run ctrl:gate` under Node 22 (`PATH=/opt/homebrew/opt/node@22/bin:$PATH`)
- [x] 9. `npm run docs:wiki:prepare` → inspect → commit if changed → `npm run docs:wiki:verify`
- [x] 10. Write `docs/recovery/deploy-reconciliation-20260824/review-repair-summary.md`; `git diff --check`; clean status; final HEAD report

## Files touched (expected)
- scripts/entity-deploy-target-guard.mjs(+test), scripts/entity-deploy-live-verify.mjs(+test)
- packages/server/src/routes/curacel-operations.ts(+test), agent-import.ts(+test),
  chat-history-access.ts(+test), chat-noise-controls.ts(+integration test)
- packages/server/src/index.ts (curacel router wiring, if needed)
- docs/recovery/deploy-reconciliation-20260824/* (plan, summary)
- openwiki generated docs (only if fingerprint changes)

## Resume
Run `git status`; find first unchecked step; continue. Do not mark REC-009 done.
