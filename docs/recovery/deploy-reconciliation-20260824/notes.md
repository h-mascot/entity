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
