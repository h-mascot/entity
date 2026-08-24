# Task Plan: Entity Deploy Recovery and Full Reconciliation

## Goal
Preserve every historically deployed code line, reconcile every unique still-valid behavior onto clean main `4af7084fb5f961bc7670767f60bbb5846ffd38b0`, fix deployment drift infrastructure, and prove combined result in sandbox without touching production.

## Immutable constraints
- Never modify dirty canonical worktree `/Users/enterprise/Code/Entity`.
- Work only in isolated worktree `/Users/enterprise/Code/entity-deploy-recovery-reconcile-20260824`.
- Never copy compiled runtime trees back into source.
- Never silently drop a conflict side. Matrix disposition required.
- Never deploy through `/Users/enterprise/Services/entity-sandbox/current`.
- Production forbidden without Henry's explicit approval.
- Shared sandbox identity must be verified before and after browser QA.

## Source authority
1. Current merged `main` `4af7084fb5f961bc7670767f60bbb5846ffd38b0` and PR #92.
2. Verified recovery bundle and `recovery-manifest.json`.
3. Exact historical tips: `e538991`, `b8e3c121`, `33bbfe46`, `ffce217`.
4. Historical tests, screenshots, QA receipts, and live behavior fingerprints.
5. Henry decision only where two desired behaviors genuinely contradict.

## Phases
- [x] Phase 0: Preserve all 78 audited SHAs in two verified bundles.
- [x] Phase 1: Create plan, reconciliation matrix, state machine, manager, and proof contract.
- [x] Phase 2: Fix manual/automatic deployment split and add anti-overwrite regression tests.
- [x] Phase 3: Reconcile Admin navigation behavior and tests.
- [ ] Phase 4: Reconcile Curacel readiness unique behavior and tests.
- [ ] Phase 5: Reconcile OpenWiki deployment unique behavior and tests.
- [ ] Phase 6: Cross-feature integration, generated docs, full CTRL, and exact-diff review.
- [ ] Phase 7: Push PR, require CI, merge when clean, immutable sandbox deploy, browser/API proof.
- [ ] Phase 8: Close receipts, update Entity LIVE context, and leave production pending approval.

## Approved queue
`REC-001` through `REC-010` in `recovery-matrix.json`. No opportunistic work.

## Proof contract
- Focused tests for each recovered behavior before marking item done.
- Deploy tests prove a new SHA cannot mutate an old SHA directory and `UP_TO_DATE` rechecks live identity.
- Navigation browser proof visibly shows Workspace / Work / Team / Admin and grouped Admin sections.
- Curacel/OpenWiki rows require file-level disposition receipts; “already present” needs exact code/test evidence.
- `npm run ctrl:gate`, generated Wiki freshness, app/server builds, clean status.
- Pi Luna-high review against exact final base/head; preserve complete JSONL and settled summary.
- PR checks green for exact merge candidate.
- Sandbox: symlink basename = manifest SHA = API SHA = release path basename; served index matches release; 49 tasks and DB integrity preserved.
- Production remains untouched/pending explicit approval.

## Progress rules
- Runtime state: `/Users/enterprise/Library/Application Support/EntityRunner/entity-deploy-reconciliation-20260824/state.json`.
- Human status: `/Users/enterprise/Library/Application Support/EntityRunner/entity-deploy-reconciliation-20260824/status.md`.
- Every queue transition atomically updates state plus matrix and writes receipt.
- Manager reports only transitions, blockers, sparse heartbeat, and terminal closeout.
- Exactly one worker/reviewer owner while nonterminal.
- Any stale/dead owner triggers evidence inspection and safe recovery, never duplicate launch.

## Decisions made
- Current merged main `4af7084fb5f961bc7670767f60bbb5846ffd38b0` is integration baseline.
- `ffce217` remains archived but is superseded by PR #92 merge.
- Recovery means preserve all source and integrate every unique valid behavior; intermediate/broken behavior is retained in archive and excluded only with proof.
- Prod promotion is outside this run.

## Errors encountered
- Initial `git bundle --all` omitted remote-only commit `5f426e0c`; fixed by fetching every audited SHA into archive refs and verifying 78/78 in cloned bundle.
- First remote plan writer failed because nested shell quoting terminated a Python f-string; no source files were changed. Replaced with file-transported Python writer.
- Historical sandbox had 11 mutated release identities; root cause is manual rsync through `current` plus weak verification/controller cache.

## Status
**Phase 4 next** — REC-005 complete: grouped navigation recovered from e538991 (Workspace/Work/Team/Admin top nav + Workspace/People/Work/Content/System admin groups + Modules settings + hidden-module enforcement), enterprise/Openclaw section preserved from main. Browser proof 14/14 on local dev server.
