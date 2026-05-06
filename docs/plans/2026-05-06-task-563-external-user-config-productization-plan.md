# Task Plan — MC #563 External-user config/onboarding productization

## Goal
Turn Entity public defaults away from Henry/Enterprise-specific runtime assumptions and toward portable first-run configuration.

## Scope for this pass
- Preserve existing config schema/effective-config/onboarding work already present in main.
- Add portable npm setup/dev/doctor scripts.
- Move deploy/dev defaults from Enterprise hosts/paths to explicit profile/env requirements.
- Keep Enterprise values opt-in via internal/profile docs, not public defaults.
- Tighten private-default scan into CI/local guardrail.
- Verify with targeted config tests, scanner, and build/gate where feasible.

## Steps
- [x] Step 1: Read Entity context, hardcode audit, and existing config implementation.
  - Verify: context and audit files read; git status captured.
- [x] Step 2: Add CLI setup/dev/doctor first-run flow with safe localhost defaults.
  - Verify: `npm run setup`, `npm run setup -- --check`, and `npm run doctor` passed.
- [x] Step 3: Move deploy/dev scripts to config/env-driven safe defaults.
  - Verify: `bash -n deploy.sh && bash -n dev.sh && bash -n scripts/ctrl-deploy-path-check.sh` passed; `npm run ctrl:full` passed with deploy check skipped unless explicit ssh profile exists.
- [x] Step 4: Update docs/README/public env examples for external onboarding and Enterprise opt-in profile.
  - Verify: README and docs/config/entity-config.md document setup/dev/doctor and public-safe defaults; docs/internal/enterprise-profile.md documents private profile handling.
- [x] Step 5: Run targeted tests/build/scan and capture evidence.
  - Verify: `npm run scan:private-defaults -- --enforce`, server config Vitest tests, `npm --prefix packages/server run build`, and `npm run ctrl:full` passed.
- [ ] Step 6: Update Mission Control review with paths/evidence.
  - Verify: mc.sh review 563 called.

## Files touched
- docs/plans/2026-05-06-task-563-external-user-config-productization-plan.md
- docs/plans/ACTIVE_PLAN.md

## Resume instructions
Start with `git status --short`, read this plan, then continue from the first unchecked step. Preserve unrelated dirty files unless they are confirmed part of #563.
