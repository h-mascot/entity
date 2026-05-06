# MC #565 — Helm stabilization / external onboarding

## Objective
Package Helm/Entity-facing Helm surface for external onboarding: reconcile source/runtime drift, split Enterprise-local config from product defaults, add onboarding + config/effective-config proof, and remove hard-coded Henry crew assumptions where in scope.

## Resume instructions
1. Read this file and docs/plans/ACTIVE_PLAN.md.
2. Run `git status --short --branch` in /Users/enterprise/code/entity.
3. Continue from first unchecked item.
4. Keep all proof commands and browser/API evidence in the progress log.
5. Before exit, run the MC #565 review/note command required by assignment.

## Steps
- [x] Bootstrap context and source state.
  - Verify: `git status --short --branch`, `git log --oneline -5`
- [x] Reconcile existing external-onboarding commits and current dirty files.
  - Verify: inspected diffs, hard-coded local references search, and source/runtime context.
- [x] Add missing generic config/effective-config/onboarding fixes as narrow slices.
  - Verify: server/app tests and build.
- [x] Browser-click onboarding/config flow proof.
  - Verify: browser navigation + screenshot/console/API evidence.
- [ ] Commit cleanly and produce MC review evidence.
  - Verify: clean branch/commits, build/test pass; deploy proof only if approved/safe.

## Progress log
- Started by Book 2026-05-06 UTC. Existing branch main is ahead 1 with recent commits `feat: productize external Entity setup defaults` and `Add first-run onboarding flow`; dirty files are chat model registry changes and docs/config evaluation note.
- Verified targeted server build/tests: `npm run build && npx vitest run src/config/effective.test.ts src/config/routes.test.ts src/routes/chat-model-registry.test.ts` from `packages/server` passed (25 tests).
- Verified full gate: `npm run scan:private-defaults` (239 files, 161 warnings, 0 errors), `npm --prefix packages/app run build`, `npm --prefix packages/server run build`, and full server `npx vitest run` passed (44 files, 313 tests).
- Browser proof on temp DB at `http://127.0.0.1:3311`: clicked onboarding path through setup step 2, skipped setup into workspace, clicked Admin, observed Effective Entity Config panel with `Local User`, `assistant`, `./workspace`, and env-sourced public URL. Screenshot: `/Users/enterprise/.hermes/cache/screenshots/browser_screenshot_12309236960b4cdfbdb2cc20c71c6df2.png`. Console: no JS errors.
- API proof on temp DB: `/api/config/effective` returned profile owner `Local User`, agents `[assistant]`, public URL `http://127.0.0.1:3311`; `/api/onboarding/state` returned `completed: true`, `currentStep: 2`, `mode: manual`.
