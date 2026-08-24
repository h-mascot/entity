# Review Repair Summary — Luna-high Findings (worker run 2026-08-24)

Run: `entity-deploy-reconciliation-20260824` — bounded repair worker for the Luna-high
review of `8f5fdca5fa2e02f2d8e6900707bddaa8822b69d4` (base `4af7084fb5f961bc7670767f60bbb5846ffd38b0`).
Worktree: `/Users/enterprise/Code/entity-deploy-recovery-reconcile-20260824`, branch
`recovery/reconcile-all-deploys-20260824` (local only — not pushed; manager owns REC-009/REC-010).
All commands run under Node 22 (`PATH=/opt/homebrew/opt/node@22/bin:$PATH`).

## Finding → fix → test mapping

### F1 (P1) immutable deploy resume — commit `6dfd14a`
- **Finding:** existing metadata-less non-SHA directories were accepted as deploy
  resume targets (`NO_METADATA_RESUME`), so rsync could mutate an unidentifiable
  directory in place.
- **Fix:** `scripts/entity-deploy-target-guard.mjs` — an existing destination is
  resumable only when its resolved basename exactly equals the expected release SHA.
  Mismatched SHA-like basenames reject with `BASENAME_COLLISION`; any other basename
  (e.g. `legacy-pin`) rejects with the new `NON_SHA_DESTINATION`. Release-identity
  checks (`IDENTITY_COLLISION`, `RELEASE_UNREADABLE`, `SAME_SHA_REDEPLOY`) unchanged
  and now only reachable under a matching basename. `deploy.sh` needed no change (it
  already pipes the probe and fail-closes on guard rejection).
- **Tests (RED→GREEN):** unit `decision: metadata-less destination whose basename is
  not the expected SHA is rejected` + `SHA-like resume requires exact basename`;
  end-to-end fake-SSH `deploy.sh: refuses an existing metadata-less non-SHA
  destination before any sync or DB preflight` (asserts no `select count(*)`,
  no rsync/backup/restart in the ssh log). The pre-existing e2e identity-collision
  scenario was re-pinned to the true case (candidate-named dir carrying a foreign
  RELEASE.json) since basename now gates first.

### F2 (P1) live verifier fail-open artifacts — commit `404b655`
- **Finding:** `decideDrift` skipped comparisons when evidence was absent (missing
  manifest hash, null recomputed tree hash, null index bytes on either side) —
  fail-open.
- **Fix:** `scripts/entity-deploy-live-verify.mjs` — manifest app/server dist hashes,
  recomputed app/server tree hashes, release index bytes, and served index bytes are
  required evidence. New explicit drift reasons: `MANIFEST_APP_HASH_MISSING`,
  `MANIFEST_SERVER_HASH_MISSING`, `APP_DIST_UNREADABLE`, `SERVER_DIST_UNREADABLE`,
  `RELEASE_INDEX_UNREADABLE`, `SERVED_INDEX_UNAVAILABLE`; each yields `ok:false`.
- **Tests (RED→GREEN):** one negative test per unavailable artifact class (6), all
  failing pre-fix; base `liveState` fixture updated to a fully-evidenced state.

### F3 (P1) Curacel org/team validation — commit `af9c61d`
- **Finding:** `curacel-operations.ts` mutations and execution-sample writes trusted
  caller-supplied org/team ids with no authoritative existence check.
- **Fix:** router gains `workspaceRepo` (default `createWorkspaceScopeRepository()`);
  `requireOrgTeamScope(orgId, teamId)` runs before every mutation in review policies,
  connectors, connector drafts, team dashboards, and execution samples. Phantom orgs →
  404 `CURACEL_ORG_NOT_FOUND`; teams outside the org → 404 `CURACEL_TEAM_NOT_FOUND`.
- **Tests (RED→GREEN, stash-verified):** `rejects phantom organizations before any
  policy, connector, dashboard, or sample write` and `rejects teams that belong to
  another organization before any mutation` cover all four surfaces + drafts and
  prove zero rows (policies resolve to defaults, no connectors/dashboards/samples/
  drafts/audit rows created or updated). Existing 6 tests unchanged and green.

### F4 (P1) agent-import channel IDOR — commit `067a673`
- **Finding:** channel references were resolved with an unscoped
  `getChannel(channelId)`, so an import could reference another org's channels
  (baked into grant scopes, mappings, receipts).
- **Fix:** `agent-import.ts` resolves channels through the authoritative org-scoped
  lookup `getChannel(channelId, orgId)` (uniform not-found on foreign/unowned
  channels — no oracle) and rejects same-org channels team-scoped outside the
  import's team set, before `importBatch` (no mappings, grants, or receipts).
- **Tests (RED→GREEN):** `rejects channels owned by another organization with zero
  side effects` and `rejects same-org channels scoped to a team outside the import
  with zero side effects` (agents/mappings/grants/receipts all empty after rejection).

### F5 (P1) chat-history channel scope IDOR — commit `b44fbfb`
- **Finding:** `upsertChannelScope` accepted any existing channel id — an org-A admin
  could claim ownership of an unscoped org-B channel and then grant agents into its
  history.
- **Fix:** `chat-history-access.ts` scope PUT now treats the channel's own
  org/team ownership as authoritative: cross-org channels → 403
  `CHAT_HISTORY_SCOPE_FORBIDDEN`; team-scoped channels accept only their exact team
  (never a sibling team, never org-wide). Unowned legacy channels remain adoptable
  (first scope row wins; later foreign claims already blocked). Rejection precedes
  any mutation.
- **Tests (RED→GREEN):** `rejects scoping another organization's channel without
  mutating any scope` (incl. follow-on grant stays 404) and `rejects re-scoping a
  team-owned channel to a different team or to org-wide` (no scope row written).

### F6 (P2) cooldown delete mapping — commit `938a488`
- **Finding:** cooldown DELETE validated the channel scope but not the agent
  mapping/org/team (creation did), allowing a foreign-org agent's cooldown to be
  cleared through this org's route.
- **Fix:** `chat-noise-controls.ts` DELETE applies the identical creation-time
  validation (`getMappingByAgent` org match + channel-scope team membership) → 404
  `AGENT_NOT_FOUND` before `clearCooldown`.
- **Tests (RED→GREEN):** `refuses to clear a cooldown for an agent mapped to another
  organization` — target cooldown (300s) remains and no `cooldown_cleared` audit is
  written.

## Proof commands and results

| Gate | Command | Result |
| --- | --- | --- |
| F1 focused | `node --test scripts/entity-deploy-target-guard.test.mjs` | **20/20** (2 RED pre-fix) |
| F2 focused | `node --test scripts/entity-deploy-live-verify.test.mjs` | **21/21** (6 RED pre-fix) |
| F3 focused | `npx vitest run src/routes/curacel-operations.test.ts` | **8/8** (2 RED pre-fix via stash) |
| F4 focused | `npx vitest run src/routes/agent-import.test.ts` | **9/9** (2 RED pre-fix) |
| F5 focused | `npx vitest run src/routes/chat-history-access.test.ts` | **7/7** (2 RED pre-fix) |
| F6 focused | `npx vitest run src/routes/chat-noise-controls.integration.test.ts` + `chat-noise-controls.test.ts` | **7/7** (1 RED pre-fix) |
| Release/deploy suite | `npm run test:release-deploy` | **66/66** |
| Server suite | `cd packages/server && npx vitest run` | **2551/2551** (3 consecutive full runs; one unrelated transient failure in the first run that did not reproduce) |
| DB suite | `cd packages/db && npx vitest run` | **214/214** |
| App suite | `cd packages/app && npm test` | **524/524** |
| Controller gate | `npm run ctrl:gate` (Node 22) | **pass** (build + 2551/2551 unit gate) |
| OpenWiki | `npm run docs:wiki:prepare` → reviewed diff → committed `docs(wiki)` → `npm run docs:wiki:verify` | fingerprint `90a91bfd…` verified, 24 HTML pages |
| Browser verification | dev server on `localhost:3998` + Playwright | **6/6**: operations API 200 with ≥3 policies; valid review-policy upsert 200; phantom-org upsert 404 `CURACEL_ORG_NOT_FOUND` over live HTTP; app shell renders (143 KB DOM); zero console errors. Screenshot `/tmp/entity-repair-ui.png`. (Negative tenant paths are not UI-reachable; UI happy paths exercised live.) |
| Hygiene | `git diff --check` | clean |

Server log note: the single first-run suite failure did not reproduce in three
immediate full reruns (2551/2551 each) nor inside `ctrl:gate`; treated as an
environment transient, not a regression.

## Henry decision slices — unchanged (explicitly not resolved here)

1. **Org-scoped live WS activity broadcasts** (`ScopedBroadcast`) — main's WS layer
   remains global; scoping under main's principal model is still an open
   architecture decision (see REC-006 blocked slice 1, `dispositions/curacel-readiness.json`).
2. **Business org invite acceptance architecture** — historical business-onboarding
   db architecture vs main's re-implemented onboarding remains undecided
   (REC-006 blocked slice 2).

## Production status

Untouched. No push, no PR, no merge, no sandbox deploy, no production action, no
destructive data operation, no credential work. The canonical dirty worktree
`/Users/enterprise/Code/Entity` was never read for edits or mutated.

## Handoff

REC-009 is **not** done: the manager must rerun the Luna-high review against the new
HEAD of this branch before any PR/CI/merge. Repair commits (in order):
`6dfd14a` (F1), `404b655` (F2), `af9c61d` (F3), `067a673` (F4), `b44fbfb` (F5), `938a488` (F6), `3151080` (wiki regeneration), plus this
summary and `review-repair-plan.md`.
