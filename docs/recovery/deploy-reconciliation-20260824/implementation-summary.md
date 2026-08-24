# Implementation Summary — Entity Deploy Reconciliation Run `entity-deploy-reconciliation-20260824`

Worker: Pi `citadel` / `glm5.2` — implementation role (REC-002…REC-008).
Worktree: `/Users/enterprise/Code/entity-deploy-recovery-reconcile-20260824`
Branch: `recovery/reconcile-all-deploys-20260824` (local only; not pushed — manager owns REC-009/REC-010)
Baseline: `4af7084fb5f961bc7670767f60bbb5846ffd38b0` (merged main, PR #92)

## Commits (in order, all on top of baseline)

| Commit | REC | Subject |
| --- | --- | --- |
| `04da803` | (pre-work) | docs(recovery): plan no-loss deploy reconciliation |
| `d09d9b4` | REC-002 | chore(recovery): complete REC-002 — matrix validation tooling |
| `657dde5` | REC-003 | fix(deploy): hard-block symlink-target release mutation |
| `05e4393` | REC-004 | fix(deploy): drift-aware UP_TO_DATE and live verification |
| `623e057` | REC-005 | feat(app): recover grouped workspace navigation from e538991 |
| `926feb6` | REC-006 | feat(curacel): recover readiness line onto main trust model |
| `121f311` | REC-007 | docs(recovery): verify OpenWiki line already-equivalent on main |
| `c54d3b7` | REC-008 | docs(wiki): regenerate OpenWiki for recovered navigation and curacel surfaces |

## What was implemented

### REC-002 — plan/tracker infrastructure
- `docs/recovery/deploy-reconciliation-20260824/validate_matrix.py`: validates the recovery
  matrix against live Git facts (tips, merge-bases, ahead/behind, changed files, commits).
  Result: 4/4 lines fully validated; used as tracked re-runnable proof.

### REC-003 — hard-block symlink-target sandbox mutation (TDD)
- New `scripts/entity-deploy-target-guard.mjs` + `scripts/entity-deploy-target-guard.test.mjs`
  (17 tests incl. end-to-end fake-ssh regression of the exact historical `current`-symlink
  mutation path). `deploy.sh` now probes the remote destination and fail-closes before any
  sync-capable step on: `SYMLINK_TARGET` (deploy through `current`), `IDENTITY_COLLISION`
  (RELEASE.json/VERSION carries another SHA), `BASENAME_COLLISION` (SHA-named dir contradicts
  candidate), `RELEASE_UNREADABLE`. Fresh dirs, resume dirs, and same-SHA redeploys pass.
- `scripts/entity-deploy-sandbox.sh` refuses `current`/`previous` profiles up front.
- DB/env/credentials/node_modules/artifact lane contracts unchanged (guard only gates
  destination identity). All deploy entry points (sandbox, prod promote, webhook,
  pull-deployer) funnel through the guarded `deploy.sh`.

### REC-004 — drift-aware verification/controller (TDD)
- New `scripts/entity-deploy-live-verify.mjs` + test (15 tests incl. the historical
  `fa2e439`-directory-serving-`ffce217` regression). `collectLiveState` reads live truth
  (current symlink target, RELEASE.json/VERSION, recomputed dist tree hashes via exported
  `maybeTreeHash` from `entity-release-info.mjs`, served index bytes, `/api/version` SHA,
  listening service cwd via lsof, DB symlink realpath); `decideDrift` fails closed on any
  contradiction or unavailable fact.
- `entity-gateway-pull-deploy.mjs`: `UP_TO_DATE` now requires live revalidation
  (`decideUpToDate`); drift logs `DRIFT_DETECTED` and falls through to redeploy (heals).
  `verifyLive` runs the full drift check after readiness; drift triggers rollback.

### REC-005 — grouped navigation recovery (tip `e538991`, semantic)
- Ported verbatim: `packages/app/src/lib/workspaceNavigation.ts` + tests (7).
- Applied to current main (zero-drift files applied cleanly; App.tsx/AdminView 3-way +
  restoration of current-main enterprise/Openclaw behavior the historical line had removed):
  admin.navigation settings (schema/defaults/routes + server tests), AdminSettingsForm
  `onSettingsChange`, grouped top nav Workspace/Work/Team/Admin + per-group subnav,
  hidden-module enforcement across all navigation entry points (deep links, popstate,
  file/task handlers), grouped Admin sidebar (Workspace/People/Work/Content/System),
  Modules admin section, MobileView sections + `visibleMobileTabs`, MobileBottomNav
  `visibleTabs`, terminal visibility gate.
- Goal-text discrepancy recorded: no audited tip contains "AI & Agents / Execution /
  System & Data" labels (verified via `git log -S` across all refs); restored the actual
  historical groupings.
- Browser proof: 14/14 checks on local dev server (groups render, subnavs, Modules form,
  hide-chat round-trip live save/apply/restore).

### REC-006 — Curacel readiness reconciliation (tip `b8e3c121`)
- Full disposition receipt: `dispositions/curacel-readiness.json` — 107 files, 15 commits,
  zero silent drops (37 included, 66 superseded-with-proof, 5 explicit-Henry-decision-required).
- Included (adapted to main's admin-principal trust model, precedent = main's own
  task-handoffs port): curacel-operations subsystem (db/routes/UI), agent-import subsystem
  (+ agent-identity tombstones + registry retirement guards), chat-history-access roster,
  chat-noise-controls roster (mute/cooldown/audit/evaluate), resolved task-policy persistence
  on create/update + stable reason-chain filtering, `/tasks/:id` HTML deep-link fall-through,
  ctrl-live-smoke bearer-token probes (+ new node test).
- Superseded with proof: membership RBAC/cookie sessions (main principals; R6 acceptance
  header explicitly replaces "stale session auth"), provider health (main swarm providers
  health, R6 criterion 1), task handoffs (main THE-933 + C-8), chat noise read path
  (THE-930), business onboarding provisioning (main router, R6 criterion 3), runtime/system
  gating (node-operations), deploy scripts (REC-003/004), docs/plans (bundle).
- Blocked for Henry (receipts in disposition JSON, exact conflict sides preserved):
  1. org-scoped live WS activity broadcasts (`ScopedBroadcast`): main's WS layer is global;
     scoping under main's principal model is an open architecture decision.
  2. Business org invite acceptance: requires choosing between the historical
     business-onboarding db architecture and main's re-implemented onboarding.

### REC-007 — OpenWiki deployment reconciliation (tip `33bbfe46`)
- Disposition receipt: `dispositions/openwiki-deploy.json` — 65 files, 6 commits.
  Main already carries the entire line (PR #61 + evolution): 26 files byte-identical, all
  drifted files carry main-ahead evolution only, zero tip-unique behaviors missing
  (file:line evidence in receipt). No code changes required.

### REC-008 — integration proof (all green)
- `npm run build` — app + db + server: pass.
- `cd packages/server && npx vitest run`: **2544/2544**.
- `cd packages/db && npx vitest run`: **214/214**.
- `cd packages/app && npm test`: **524/524** (includes 7 new workspaceNavigation tests
  + ported component/model tests).
- `npm run ctrl:gate`: **pass** (build + unit gates).
- OpenWiki refresh: `npm run docs:wiki:prepare` regenerated docs (exit 75 reviewed +
  committed as `c54d3b7`); `npm run docs:wiki:verify`: **verified** fingerprint
  `a6be0e49…` with 24 HTML pages.
- `npm run scan:private-defaults`: exit 0 (260 warnings = accepted baseline, not rewritten).
- `npm run test:release-deploy`: **57/57** (25 release-info + 17 deploy-target-guard +
  15 live-verify). `node --test scripts/ctrl-live-smoke.test.mjs`: **1/1**.
- Local browser verification (dev server, port 3999): REC-005 14/14; REC-006 4/4
  (operations center, communication controls, agent import surface, zero console errors).
- `git status`: clean after final commit. No runtime state committed (dev DB/env/gitignored).

## Remaining decisions for Henry (blocked slices — receipts preserved)
1. WS tenant-scoped activity broadcasts (see REC-006 blocked slice 1).
2. Business invite acceptance architecture (see REC-006 blocked slice 2).

## Production status
Untouched. No push, no PR, no merge, no deploy, no sandbox mutation — manager owns
REC-009 (governed review/PR/CI/merge) and REC-010 (immutable sandbox deploy + QA).
