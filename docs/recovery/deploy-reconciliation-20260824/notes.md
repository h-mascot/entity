# Notes: Entity Deploy Recovery Reconciliation

## Baseline
- Current main/sandbox: `4af7084fb5f961bc7670767f60bbb5846ffd38b0` from merged PR #92.
- Sandbox release identity currently consistent and task count 49.
- Canonical worktree is dirty and 240 commits behind; forbidden for edits.
- Isolated recovery worktree: `/Users/enterprise/Code/entity-deploy-recovery-reconcile-20260824`.

## Preservation
- 78 audited SHAs verified in bundle; zero missing.
- Bundle SHA-256: `5e2b759b6167d731b85be3a2782e9a42ff03293c7bd659e9065328c07dd19a73`.
- Copies on Enterprise and Hermes host.
- 73 release directories currently inventoried; 11 carry historical identity mismatches.

## Historical lines

### document-integrations
- Tip: `ffce21789943e3cd7f25aa60c851145c73f8e842`
- Merge base: `bdb57421b59bc2739ad5ba9f08a7cc0a57616d83`
- Ahead/behind current baseline: 94/2
- Historical changed files: 200
- Disposition: preserved; superseded by merged PR #92 / main 4af7084

### admin-navigation
- Tip: `e538991d8fe6d9a1750f3edfbea6d60523e41b39`
- Merge base: `91d54e4cc92f6f7bf809c8c13c516c58ab6c481f`
- Ahead/behind current baseline: 3/21
- Historical changed files: 21
- Disposition: recover unique behavior onto current main

### curacel-readiness
- Tip: `b8e3c12108028afb5180c79468eaee2d83d79bd1`
- Merge base: `f0f5bd3064bbace0e0c11cfa1303bd8527794d3f`
- Ahead/behind current baseline: 15/227
- Historical changed files: 107
- Disposition: semantic audit; recover every unique non-superseded change

### openwiki-deploy
- Tip: `33bbfe46cb6ce5bc75d155a4918e8996a573031b`
- Merge base: `f0ee1d450e01a1424724274b40eb6de162a05c76`
- Ahead/behind current baseline: 6/201
- Historical changed files: 65
- Disposition: semantic audit; recover every unique non-superseded change


## Root cause
- Manual sandbox profile targets `.../entity-sandbox/current`.
- Manual deploy maps that path to rsync destination and follows symlink into prior SHA directory.
- Exact-SHA readback checked bytes/manifest through same unsafe target, not directory identity.
- Pull-deployer state cache could report `UP_TO_DATE` without revalidating live artifact.

## Current runtime caveat
Workspace and Entity Wiki file sources report pre-existing health errors related to managed storage broker/indexing. Track separately; do not misattribute to reconciliation unless before/after evidence changes.

## REC-005 reconciliation record (2026-08-24)
- Recovered from tip e538991: workspaceNavigation lib + tests (verbatim port),
  admin.navigation settings key/schema/defaults/routes + tests, AdminSettingsForm
  onSettingsChange, MobileView Modules/Users&Access sections + visibleMobileTabs,
  MobileBottomNav visibleTabs filtering, App.tsx grouped top nav
  (Workspace/Work/Team/Admin) + per-group subnav + hidden-module enforcement +
  grouped admin sidebar (Workspace/People/Work/Content/System) + Modules section,
  AdminView navigation section.
- Preserved from current main (historical had removed): enterprise/Openclaw
  admin section, iframe branch, props, and state (kept reachable under System
  group + mini rail). ENTERPRISE_ADMIN_URL is '' on main, so the removed
  quick-link buttons were dead UI; capability retained.
- Goal-text discrepancy: no audited tip contains the labels "AI & Agents",
  "Execution", or "System & Data" (verified via git log -S across all refs).
  The actual historical admin groupings are Workspace/People/Work/Content/System.
  Restored the historical truth; flagged for manager summary.
- OpenWiki doc regeneration from e538991 deliberately deferred to REC-008 per plan.

## REC-006 reconciliation record (2026-08-24)
- Disposition receipt: dispositions/curacel-readiness.json (107 files, 15 commits, zero silent drops).
- Included (adapted to main's admin-principal trust model, precedent = main's own task-handoffs port):
  curacel-operations subsystem (db/routes/UI), agent-import subsystem (+ registry identity
  tombstones), chat-history-access roster, chat-noise-controls roster, resolved task-policy
  persistence + stable reason-chain filtering, /tasks/:id HTML deep-link fall-through,
  ctrl-live-smoke bearer probes (+ new test).
- Superseded with proof: membership RBAC/cookie sessions (main principals; R6 acceptance
  explicitly replaces "stale session auth"), provider health (main swarm providers health, R6
  criterion 1), task handoffs (main THE-933 + C-8), chat noise read path (THE-930), business
  onboarding provisioning (main router, R6 criterion 3), runtime/system gating (node-operations),
  deploy script changes (REC-003/004), docs/plans (bundle).
- Blocked for Henry (genuine architecture/product decisions, receipts in disposition JSON):
  1) org-scoped live WS activity broadcasts (ScopedBroadcast) — main's WS layer is global;
  2) business org invite acceptance — requires choosing historical vs main onboarding architecture.

## REC-007 reconciliation record (2026-08-24)
- Disposition receipt: dispositions/openwiki-deploy.json (65 files, 6 commits).
- The OpenWiki deployment line is fully absorbed on main via PR #61 + evolution
  (HTML presentation layer, gitHead verification hardening, PR-head CI freshness).
  26 files byte-identical; all drifted files carry main-ahead evolution only;
  zero tip-unique behaviors missing (verified with file:line evidence in receipt).
- Deploy-path files classified superseded: tip's hooks are on main and release
  safety is now enforced stronger by REC-003/REC-004.
- Generated docs refresh + docs:wiki:verify deferred to REC-008 per plan.

## Terminal receipt (2026-08-24, implementation worker)
- REC-002..REC-008 complete with proof; branch recovery/reconcile-all-deploys-20260824 @ b32db2b (local only).
- Final gates: server 2544/2544; db 214/214; app 524/524; ctrl:gate pass; docs:wiki:verify pass
  (fingerprint a6be0e491131a61ad2c0fc48941b909ec6b35880e943e959a247ff879cc26ac1, 24 pages);
  scan:private-defaults exit 0; test:release-deploy 57/57; ctrl-live-smoke test 1/1; git clean.
- validate_matrix.py OK (4/4 lines). Dispositions: curacel-readiness.json, openwiki-deploy.json.
- Blocked for Henry (exact receipts in curacel-readiness.json): WS tenant-scoped broadcasts;
  business invite acceptance architecture.
- Production untouched. No push/PR/merge/deploy (delivery boundary). REC-009/REC-010 = manager.
- Worker exits; wrapper (owner pid 93311) releases the lease; manager resumes from REC-009.

## Manager pre-review transition
- Worker generation 1 exited 0 with `agent_settled`; REC-002 through REC-008 complete.
- First manager `ctrl:gate` rerun accidentally used shell Node 26 and failed only because `better-sqlite3` was built for Node ABI 127. This is environmental, not accepted proof. Authoritative rerun pins runtime/CI Node 22 before review.
- Fixed pre-existing Markdown trailing whitespace found by `git diff --check`.
