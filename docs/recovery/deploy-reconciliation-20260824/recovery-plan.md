# Entity No-Loss Deploy Recovery Plan

Canonical tracker: [`task_plan.md`](./task_plan.md)
Machine reconciliation ledger: [`recovery-matrix.json`](./recovery-matrix.json)

## Outcome
One reviewed mainline containing current document integrations plus every unique, still-valid behavior from historical deployed lines, with contradictory choices surfaced rather than silently dropped. Deployment creates a fresh SHA directory before switching sandbox.

## Delivery boundary
This run may commit, push, open/update PR, merge after green proof/review/CI, and deploy to sandbox. Production promotion requires separate explicit Henry approval.

## Final acceptance
- All 78 historical SHAs remain recoverable from verified archive.
- Every maximal non-main line has a complete disposition matrix.
- Grouped navigation works through real controls and refresh.
- Curacel readiness and OpenWiki unique behavior have focused proof.
- Manual deploy cannot mutate an existing release directory.
- Controller detects live drift even when cached target SHA is unchanged.
- Sandbox exact identity and served asset checks pass with 49 tasks preserved.
- Production untouched.
