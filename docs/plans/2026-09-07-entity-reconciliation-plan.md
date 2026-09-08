# Entity reconciliation and sandbox delivery

## Task
Preserve all work and functionality, reconcile local changes and outstanding branches/PRs, deliver accepted changes to main and sandbox, and clean only proven redundant references.

**Created:** 2026-09-07
**Agent:** Geordi (root integration owner)
**Status:** IN PROGRESS
**Integration checkout:** `/Users/enterprise/Code/entity-reconcile-20260907`
**Branch:** `codex/reconcile-entity-20260907`
**Initial main/sandbox base:** `9ca58e4` (PR #111; supersedes earlier audit fc8ade4)
**Evidence/recovery:** `/Users/enterprise/Code/entity-reconciliation-evidence-20260907`

## Authority and invariants
Henry authorized execution, cheaper-model subagents, finishing in goal mode, and preserving functionality. This covers planned merge/push/sandbox delivery and verified redundant branch cleanup. Production promotion is not in scope. Standing crew agents must not be contacted without explicit authorization. Root is the only integration/ref/PR/deploy writer; workers own bounded source files after assignment. Other active work remains preserved until ownership and exact snapshot are reconciled.

## Dependencies
- Preservation precedes any root update or cleanup.
- Semantic branch comparison precedes merge/closure/deletion.
- Tests and reviews precede code commits; browser proof precedes user-facing completion.
- Sandbox deploy must use reviewed main SHA and supported pipeline.

## Plan
- [x] Preserve root/audit dirty files and full Git history, create isolated integration checkout.
  - Verify: `git bundle verify /Users/enterprise/Code/entity-reconciliation-evidence-20260907/pre-reconcile.bundle` (pass); inspect backup patches/files.
- [x] Resolve concurrent builder ownership, current deployment and all outstanding branch dispositions.
  - Verify: GitHub PR head/state queries, git comparisons, current session/worktree records, live `/api/version`.
- [x] Integrate and test board isolation, task-priority changes and any confirmed missing functionality.
  - Verify: focused app/db/server tests plus changed-path semantic evidence; preserve regression cases.
- [x] Reconcile obsolete open PRs and dependency proposals with explicit disposition; preserve every surviving delta.
  - Verify: recorded comparison of every open PR and no-PR divergent branch against final main.
- [ ] Run required full gates, Codex autoreview, high-risk review and browser verification; fix accepted findings to closure.
  - Verify: `npm run test:server`, app/db tests/build as affected, `npm run ctrl:full`, private scan, OpenWiki verification, review receipts, UI evidence.
- [ ] Commit accepted slices, merge/push main through supported pipeline, deploy sandbox exact SHA and verify live functionality.
  - Verify: main/origin/main/sandbox SHA agreement, successful CI, health and browser exercises of changed controls.
- [ ] Update original root while preserving concurrent edits, clean proven redundant refs and stale worktree metadata with recovery receipts.
  - Verify: bundle recovery, before/after ref comparison, root status, final branch/PR dispositions.

## Checkpoints
- 2026-09-07: Prior audit stale. origin/main advanced to 9ca58e4 (#111 chat delivery errors). Root main remains e0ebf08, now eight commits behind. Root additionally has task-priority and generated docs edits. Fresh doc-intelligence worktree also discovered; ownership must be resolved.
- 2026-09-07: Full pre-reconcile bundle verified (297 refs, full history incl. worktree HEADs). Root and audit dirty patches/files and previous ACTIVE_PLAN archived outside repo. Integration checkout created on latest origin/main.

- 2026-09-07 19:42 UTC: First final CTRL run exposed a docs test mock/real read-path regression, fixed with 72 focused docs/legacy/scoped-search tests. Codex autoreview accepted four findings (ownership test type, customer org resolution, non-default legacy index scope, multi-team upload choice); focused fixes and second review remain pending. Root also requires generic reserved writes fail closed and JSON-escaped 1 MiB upload boundary support. All failed gate/review evidence is retained externally.
- 2026-09-07 19:42 UTC: Reconciled all 39 previously unreviewed branch refs. 36 are integrated/superseded; three refs retain two deferred UX ideas (generic document actions and MC-1372 recovery/open-vs-upload copy). These and unfinished physical worktrees remain preserved. Cleanup candidates are guarded 97 local/29 remote refs, not yet deleted. GitNexus pre-refresh index backed up externally; refresh after landing remains pending.

## Files Touched
- App: priorities, board filtering/customization, organization/team administration, upload scope and source capability checks, supporting hooks/types/tests.
- DB: new General/Engineering defaults with existing filters preserved, opt-in legacy seed policy, upload ownership persistence and tests.
- Server: report/chat/workspace/task authorization, sample seed policy, managed-storage exclusive uploads, shared physical-alias ownership, docs/legacy/files/search/conversion/index consumers and colocated tests.
- Dependencies: root/server lockfiles, app/db/server package manifests, pinned checkout/setup-node workflow actions. Expo and react-markdown major proposals remain deferred.
- Generated OpenWiki Markdown/HTML and fingerprints: refreshed through the supported generator after final source freeze; never copied from older branch fingerprints.
- `docs/plans/2026-09-07-entity-reconciliation-plan.md` (this plan)
- `docs/plans/ACTIVE_PLAN.md` (integration checkout only; original root plan preserved)
- External recovery directory: full bundle, root/audit patches and changed-file copies, prior ACTIVE_PLAN.

## Reconciliation decisions
- Integrate General/Engineering isolation and the preserved priority policy, task-create scope aliases/default team (#96), opt-in sample/legacy seeding (#48), admin report control-plane hardening (f308246), scoped chat authorization, org/team Admin UI, and upload/ownership/search through the current managed-storage broker.
- Superseded feature PRs #9, #11, #18, #83, #99, #100 retain successor behavior. #82 grouped navigation is present; keep later-reintroduced OpenClaw capability under the no-functionality-loss constraint.
- Refresh low-risk dependency/action intents from current main, not historical lockfiles. Defer incompatible Expo SDK57 and react-markdown major migration; preserve those proposals/recovery refs with explicit disposition.
- No import of old Coolify deployment files or obsolete generated-doc fingerprints. Normal sandbox pipeline remains authoritative.
- Preserved unfinished doc-intelligence (8 files) and Mariam modal (2 plan files) worktrees in external evidence. No live writer found; do not claim their unfinished work delivered.
- Browser proof uses isolated loopback server, workspace and SQLite DB on port3017. Early create-task proof encountered stale lazy-loaded chunk after concurrent app rebuild; retained browser error evidence, reload current build before retesting.
- Deep review found cross-team role aggregation, unguarded legacy reports, and upload access paths not covered by the old branch. These require failing-first regression coverage and closure before delivery. Keep existing native broker write bound at 1 MiB; match upload UI/API to that bound, rather than widening native memory/write authority as part of reconciliation.
- Initial integrated server gate passed 252 files / 2775 tests. Release/deployment tests passed 133. These precede final adversarial fixes and must be rerun on the final source. Private-default scan passed with 0 errors (304 baseline warnings).

## Resume Instructions
- 2026-09-08 07:00 UTC: Sol19 fixes are complete. Project mutation tests pass8/8; directory-move tests pass37/37, with all-org physical-prefix DB coverage and ordinary unowned controls. Actual invite RED/GREEN now passes: changing from default-team to organization组织核验 clears the stale team and persists a viewer grant with team_id:null; same-org selection preserves loaded teams. Explicit server27 hit two loopback transport failures (socket closed/connect timeout); unchanged focused rerun passed37/37 and a full retry follows. Preserve the failed receipt, do not describe transport failures as code assertions. Narrow closure, final gates/wiki and Sol20 precede landing. No commit/main update/push/deploy/ref cleanup has occurred.
- 2026-09-08 06:49 UTC: Sol19 returned three accepted findings. Project writes now enforce the existing contributor threshold at the exact org/team/project scope (the hole also existed in the base); legitimate project-scoped contributors remain supported. Root reproduced the invite team's stale cross-org state and now clears team options/selection and stale rename state on organization changes. Foreign pending ownership during directory moves is being fixed through an all-org physical-prefix reservation query with real DB regression coverage. Full gates, wiki refresh, actual invite retest, narrow high-risk closure and Sol20 follow the completed fixes; no landing or cleanup has occurred.
- 2026-09-08 06:09 UTC: Sol18 returned two accepted P1 findings (not a clean review). Owned legacy edit/create/delete now use operator-only FS audit instead of the unscoped persisted/global activity feed; unowned activity remains unchanged. The Admin org/team panel now uses narrowly guarded `/api/admin/workspace` routes so deployment-bearer authentication works without weakening customer data-plane credentials. Root mounted the adapter with failing-first entrypoint coverage; focused combined tests pass43/43. Auth-enabled isolated UI proof, independent high-risk closure, full gates/wiki refresh, and Sol19 remain required. No main update, commit, push, deployment or cleanup yet.
- 2026-09-07 21:58 UTC: CTRL9 passed (578 app / 255 DB / 2,825 server tests). Final Codex6 then identified seven accepted upload/authority lifecycle regressions, now fixed and frozen with failing-first focused coverage: deployment-wide chat noise authority; source health unchanged on ownership denial; conversion conflict reservation cleanup; expected-record ownership deletion after unlink; original upload bytes; explicit org-wide intent; active exact-org team validation. Actual UI BOM upload preserved the original SHA256 and explicit teamId:null. Required Codex7, high-risk closure, CTRL10 and final wiki verification follow this freeze. No commits, root update, pushes, deploys or ref cleanup yet. Final completion evidence remains external in final-validation.md and the delivery receipt.
- 2026-09-07 21:11 UTC: CTRL full 6 passed on its snapshot (571 app / 255 DB / 2,822 server tests); wiki fingerprint e97f776 was verified. Sol review 5 then found three accepted upload regressions: directory moves detaching ownership, team-owned search permission envelopes missing team scope, and selected organization lost on result opening. Legacy moves now reject any owned file/descendant (including converted/manual aliases), and search passes ownership org/team plus redacts owner metadata on denied results; focused high-risk closure is approved. Per-file organization context is being completed by reconcile_open_features. Final-5 was stopped as stale after source edits (exit143), not approved. Use external codex-sol-review-bounded for the next required pass after freeze, then rerun full gate/wiki/browser proof. No reconciliation commits, main update, push, sandbox deploy, branch deletion, or actual worktree prune yet. Final delivery receipts remain external.
- 2026-09-07 20:33 UTC: Full CTRL retry 5 passed (570 app / 254 DB / 2,817 server tests); final review 4 then identified missing organization mutation authority, org-wide upload selection being overridden by team grants, and dangling reservations after verified exclusive-create conflicts. Canonical authority and narrowly guarded reservation fixes are in place, with focused regressions. A Sol workhorse final Codex pass follows the Luna execution workers; do not trust the helper clean footer when actual findings remain. Final gate, wiki freshness and delivery receipts remain external.
- 2026-09-07 20:13 UTC: Final Codex review 3 found three compatibility regressions (legacy upload directory browsing, fallback workspace upload availability, empty binary uploads). Fixed with focused regressions, including per-child directory visibility and no-source write authorization. Full CTRL and Codex review 4 now run on the frozen fixes. Nested review's Node26/SQLite ABI failures are retained separately from the green supported Node22 gate. Generated wiki restoration now preserves the original files/docs page; final fingerprint refresh follows these last source changes.
- 2026-09-07 19:49 UTC: Final CTRL full gate passed on frozen functional source: app build, DB/server TypeScript, native broker, 570 app tests, 254 DB tests, 2,813 server tests, sandbox live smoke and deployment DB/symlink checks. Independent core and upload high-risk reviews are APPROVED with 0 blockers. A final Codex autoreview is running; release tests and generated-wiki refresh/verification follow before commit.
- Browser additionally verified explicit team upload, upload into a second organization with corresponding search result, and customization of a General-style board from Board to Analytics preserving the engineering exclusion. All browser mutations use the isolated loopback fixture, not sandbox/production data.
- Completion receipts, exact landed/deployed SHA, final PR/ref cleanup and final review outcomes will be written to the external evidence directory after delivery. Do not edit committed source plans solely to insert their own commit SHA or invalidate the generated-wiki fingerprint.
- Final browser proof completed for priorities, board isolation, team create/rename, StrictMode org/team loading, failed-grant retry preserving one principal, and actual broker upload/search/open/render/read-only/oversize behavior. Evidence is external `browser-proof.md` and inspected conversation screenshots.
- Core B1–B5 high-risk re-review approved with 0 blockers. File ownership follows one shared policy across routes; final alias/move checks and full source gates remain pending. Corrected two app test files to the package's actual Node test runner; 566 app tests pass and 254 DB tests pass.
- Original root tracked dirty patch revalidated unchanged against preserved SHA256 `252eb58ae2d8a01322c7090d11b3a8d19b84ca556d969f84e15a9a96898984da`; no root changes discarded.

Read this plan, inspect integration and original root statuses, check goal and worker state. Continue first unchecked step. Do not repeat preservation destructively or replace newer snapshots. Revalidate origin/main and active owners before mutations. Never relaunch a healthy writer or treat stale worktree metadata as an active process.
