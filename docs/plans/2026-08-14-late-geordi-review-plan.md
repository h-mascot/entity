# Entity late Geordi review closure

**Base:** `ea07eb334a1aebcc44b975ced8d9ea9dfcd33791`
**Production:** forbidden without explicit approval.

## Plan

- [x] Add RED boundary/config tests for the file-index hard safety ceiling.
  - Verify: focused `index-runner.test.ts` fails for unsafe overrides.
- [x] Add RED Services tests for Host independence, stale revalidation state, and force refresh.
  - Verify: focused `routes.test.ts` fails on all three contracts.
- [x] Implement minimal fixes in index runner, Services route/UI, and deploy runtime-env wiring.
  - Verify: focused tests green.
- [x] Run server/app/build/CTRL gates and adversarial review.
  - Verify: all gates green and review approved.
- [ ] Commit, push, merge after CI, deploy exact merge SHA to sandbox.
  - Verify: immutable identity, 49 tasks, API/browser/runtime stability.
- [ ] Supersede closeout and Entity LIVE context.

## Files touched

Track in `git diff --name-only`.

## Resume

Continue from the first unchecked item. Do not touch production.
