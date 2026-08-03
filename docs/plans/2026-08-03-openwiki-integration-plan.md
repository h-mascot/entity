# Entity OpenWiki Integration Plan — 2026-08-03

## Goal
Generate and maintain a source-grounded Entity feature/architecture wiki with OpenWiki, expose it through Entity File Sources, and tie documentation freshness to the release workflow without allowing an LLM run to mutate production during deployment.

## Safety / source state
- Preserve the dirty canonical checkout at `/Users/enterprise/Code/entity`.
- Work in isolated worktree `/Users/enterprise/Code/entity-openwiki-20260803`.
- Base on current local `main` (`f3d86e3`), which is 39 commits ahead of `origin/main`; do not push/merge those unrelated commits without separate reconciliation.
- No production deployment without Henry's explicit approval.

## Steps
- [ ] Inspect OpenWiki CLI/provider behavior and current Entity file-source/deploy seams.
  - Verify: pinned OpenWiki CLI starts with pnpm minimum release age enforcement.
- [ ] Add a secure, pinned OpenWiki runner and deterministic validation tests.
  - Verify: focused tests fail before implementation, then pass.
- [ ] Add `.openwikiignore` and `openwiki/INSTRUCTIONS.md` defining feature-oriented scope and protected/private paths.
  - Verify: validation script checks required exclusions and instructions.
- [ ] Generate the initial wiki from the current Entity source.
  - Verify: OpenWiki exits 0, OKF index exists, links/metadata pass validation.
- [ ] Register the generated wiki as a generic Entity local File Source and add automation workflow/docs.
  - Verify: config parser/test and workflow validation pass.
- [ ] Run build, focused tests, `npm run ctrl:gate`, independent code review, and security scan.
- [ ] Deploy the isolated build to sandbox only and verify source/API/UI at `http://sandbox.entity`.
- [ ] Record outcome in EntityBuilder LIVE context. Production remains pending approval.

## Design decisions
- OpenWiki updates happen before release and are committed/reviewed; deploy itself verifies freshness but does not perform unreviewed LLM writes.
- Generated wiki describes capabilities. Entity release metadata remains authoritative for what is actually live.
- Pin OpenWiki exactly. Enforce a seven-day minimum release age for dependencies, with a tool-sandbox-only exception for the pinned OpenWiki/LangChain packages because v0.2.5 introduced the required Copilot provider after GitHub Models retirement. Entity application dependencies remain age-gated.
- Disable OpenWiki telemetry for Entity runs.

## Files expected
- `.openwikiignore`
- `openwiki/INSTRUCTIONS.md`
- `scripts/entity-openwiki.*`
- focused tests for the wrapper/validator
- `entity.config.example.yaml`
- `package.json`
- `.github/workflows/openwiki-update.yml`
- generated `openwiki/*.md`

## Resume
Read this plan, inspect git status/diff in the isolated worktree, and continue from the first unchecked step. Never clean/reset/stash the canonical checkout.
