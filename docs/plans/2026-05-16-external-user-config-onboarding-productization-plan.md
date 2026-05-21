# Entity External-User Config/Onboarding Productization Plan

## Task
Mission Control #563 — turn Entity from Henry/Enterprise-specific runtime into portable product setup.

## Created
2026-05-16 by Book

## Context
This task continues the existing cleanup/open-source-readiness branch. The working tree already contains productization changes from prior agent work; preserve them, tighten correctness, and verify. Public defaults must stay localhost/generic. Enterprise-specific deployment belongs only in internal docs/profiles.

## Acceptance Checklist
- [x] entity.config.yaml schema/loader and safe examples exist
- [x] npm run setup, npm run dev, and npm run doctor are available and use local-safe defaults
- [x] deploy.sh fails closed until deployment profile/env is explicitly configured
- [x] File-source/docs auto-seeding uses config/admin onboarding instead of Henry paths
- [x] Agent registry defaults to generic assistant, with DB/config override
- [x] Terminal targets, health endpoints, and service catalog are config/admin-managed
- [x] Plugin/provider settings are public-safe by default
- [x] Public README/onboarding docs point to portable setup; Enterprise profile is internal only
- [x] CI runs private-default scan guardrail

## Execution Plan
- [x] Step 1: Load Entity context, audit report, current source state, and package scripts.
  - Verify: git status --short --branch, read CONTEXT.md, audit report, package scripts.
- [x] Step 2: Create compaction-safe task plan and promote to ACTIVE_PLAN.
  - Files: docs/plans/2026-05-16-external-user-config-onboarding-productization-plan.md, docs/plans/ACTIVE_PLAN.md.
  - Verify: plan file exists and matches active plan.
- [x] Step 3: Fix schema/examples/first-run config gaps discovered in the existing branch.
  - Files: packages/server/src/config/schema.ts, docs/config/entity.config.example.yaml, entity.config.example.yaml, .env.example, packages/server/.env.example, .github/workflows/main.yml, scripts/scan-private-defaults.mjs.
  - Verify: config tests and scanner pass.
- [x] Step 4: Run verification gates.
  - Verify: npm run scan:private-defaults -- --enforce; cd packages/server && npx vitest run src/config/load.test.ts src/config/effective.test.ts src/config/routes.test.ts src/plugins/entity-services/routes.test.ts src/plugins/entity-linker/routes.test.ts src/terminal.test.ts; npm run build; npm run doctor after setup/config exists.
- [x] Step 5: Summarize evidence and move MC #563 to review.
  - Verify: bash /Users/enterprise/.hermes/.entity-mc/runtime/mc.sh review 563 <summary>.

## Files Touched
- .env.example
- .github/workflows/main.yml
- .gitignore
- README.md
- deploy.sh
- dev.sh
- docs/config/entity-config.md
- docs/config/entity.config.example.yaml
- docs/internal/enterprise-profile.md
- docs/plans/2026-05-16-external-user-config-onboarding-productization-plan.md
- docs/plans/ACTIVE_PLAN.md
- entity.config.example.yaml
- packages/app/src/App.tsx
- packages/db/src/index.ts
- packages/server/.env.example
- packages/server/src/config/onboarding-modules.ts
- packages/server/src/config/routes.ts
- packages/server/src/config/routes.test.ts
- packages/server/src/config/schema.ts
- scripts/entity-doctor.js
- scripts/entity-deploy-webhook-server.mjs
- scripts/ctrl-deploy-path-check.sh
- scripts/entity-setup.js
- scripts/scan-private-defaults.mjs

## Progress Log
- 2026-05-16 06:55 — Context and prior branch state loaded. Existing branch already has config/schema/routes/setup/doctor work; found obvious public-safety correctness gaps in .env.example, root config example, secret redaction regex, workflow deploy header, and scanner roots.
- 2026-05-16 07:01 — Tightened secret-path detection, restored safe env examples, expanded scanner roots, added seeded onboarding skill refs for uninitialized registries, fixed in-memory onboarding route behavior, and corrected mobile tab typing for the token dashboard.
- 2026-05-16 07:03 — Verification: private-default scan enforce passed with warnings-only baseline; targeted server vitest suite passed 29/29; npm run build passed; npm run ctrl:gate passed. ctrl:full intentionally fails closed because CTRL_LIVE_BASE_URL/ENTITY_PROD_HTTP_HOST and deploy env are unset, proving no private production default is assumed.
- 2026-05-16 19:08 — Final verification on Node 22.22.2 after local setup: full server build passed; full server Vitest passed 303/303 across 44 files; private-default scan passed with 128 warnings/0 errors; npm run build passed; npm run doctor passed after npm run setup created ignored local entity.config.yaml; npm run ctrl:gate passed; npm run ctrl:full reached test:live and failed closed because CTRL_LIVE_BASE_URL/ENTITY_PROD_HTTP_HOST is intentionally unset.
- 2026-05-21 13:38 UTC — Follow-up hardening: made deploy runtime port/log/launchd/node entry explicit profile knobs, removed deploy webhook DB/HTTP host fallback defaults, fixed CI deploy authorization header syntax, ignored generated local setup DB/log paths, and documented the deploy profile contract in public/internal docs. Verification: private-default scan enforce passed with 0 errors/152 warnings; targeted config/plugin/terminal/swarm Vitest passed 30/30; full server build passed; full server Vitest passed 311/311 across 45 files; npm run build passed; npm run doctor passed; npm run ctrl:gate passed; deploy.sh missing-env fail-closed exit 78 and dry-run print-config passed; npm run ctrl:full reached test:live and failed closed exit 78 because live/deploy env is intentionally unset.

## Resume Instructions
1. Re-read CONTEXT.md and this plan.
2. Run git status --short --branch in ~/Code/entity on the Mac source checkout.
3. Continue from the first unchecked item above.
4. Do not edit Enterprise runtime copies directly.
5. Before exit, always run the MC review/note command for task #563.
