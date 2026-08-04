# Entity OpenWiki Integration Plan — 2026-08-03

## Goal
Generate and maintain a source-grounded Entity feature/architecture wiki with OpenWiki, expose it through Entity File Sources, and tie documentation freshness to the release workflow without allowing an LLM run to mutate production during deployment.

## Safety / source state
- Preserve the dirty canonical checkout at `/Users/enterprise/Code/entity`.
- Current isolated worktree: `/Users/enterprise/Code/entity-openwiki-main-freshness-20260803`.
- Current hardening branch: `fix/openwiki-release-hash-roots-20260804`, based on `e7ded3a483faba62647596847881d6dd1229ab28`.
- Production remains untouched without Henry's explicit approval.

## Initial integration — complete
- [x] Inspect OpenWiki CLI/provider behavior and Entity file-source/deploy seams.
- [x] Add a secure, pinned OpenWiki runner and deterministic validation tests.
- [x] Add `.openwikiignore` and `openwiki/INSTRUCTIONS.md` defining feature scope and protected/private paths.
- [x] Generate the initial wiki from Entity source.
- [x] Register the wiki as a read-only Entity File Source and add automation/docs.
- [x] Run focused tests, build/CTRL, independent reviews, and CI.
- [x] Merge initial integration and deploy the exact main release to sandbox.

## Release hardening — complete through `e7ded3a`
- [x] Make deploy gating fail closed on exact source checkout and SHA.
- [x] Keep release metadata transport JSON-over-stdin without shell interpolation.
- [x] Exclude path-scoped runtime state while retaining immutable nested `VERSION` files.
- [x] Preflight the remote Node executable before deploy side effects.
- [x] Write release metadata after runtime environment installation.
- [x] Remove temporary runtime environment files on all exits.
- [x] Remove unverifiable OpenWiki `gitHead` metadata during generation.

## Reopened hardening — 2026-08-04
- [x] Reproduce symlinked `package-lock.json` target hashing.
- [x] Reproduce traversal of a symlinked `packages/*/dist` root.
- [x] Reproduce regular-file/symlink hash type confusion.
- [x] Hash lockfile and dist-root symlinks by link identity without following targets.
- [x] Domain-separate file and symlink records in release-tree hashes.
- [x] Add behavior coverage for non-excluded file symlinks and immutable changes in every dist tree.
- [x] Make release/deploy regression tests an explicit non-soft CI gate.
- [x] Make OpenWiki verification reject any reintroduced `.last-update.json.gitHead` claim.
- [ ] Regenerate the wiki fingerprint from the final branch tree.
- [ ] Run focused tests, CTRL, independent review, and GitHub CI.
- [ ] Merge the follow-up and deploy the exact resulting `main` SHA to sandbox.
- [ ] Supersede evidence and Entity LIVE context. Production remains pending approval.

## Design decisions
- OpenWiki updates happen before release and are committed/reviewed; deploy verifies freshness but does not perform unreviewed LLM writes.
- Generated wiki describes capabilities. Entity release metadata remains authoritative for what is live.
- Pin OpenWiki exactly and isolate both package lifecycle and provider environments.
- Disable OpenWiki telemetry for Entity runs.
- Release hashes treat symlinks as opaque entries and include explicit entry kinds; external target bytes never influence release identity.
- Mutable runtime exclusions are release-relative and scope-aware, never blanket basename exclusions.

## Resume
Read this plan, inspect git status/diff in the isolated worktree, and continue from the first unchecked step. Never clean/reset/stash the canonical checkout.
