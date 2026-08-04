# Curacel pilot — auth/tenant/acceptance targeted repair (Terra CHANGES_REQUESTED)

**Created:** 2026-08-04
**Agent:** Bounded GLM repair worker — citadel/glm5.2, thinking medium
**Status:** IN PROGRESS
**Base:** origin/main `4c9dd5cfb463e0e992869f27fda26b38859446bc`
**Start HEAD:** `34d3c09a08fd2d58b1aa0ce2308b6de1e8919195`
**Review:** `reviews/01-terra.json` (B1–B7 blockers)
**Receipt:** `workers/02-auth-tenant-repair.json`

## Route env (recorded)
PI_PROVIDER=citadel, PI_MODEL=glm5.2, PI_REASONING_LEVEL=off (contract=medium; worker
cannot self-set; recorded honestly), PI_SESSION_ID=019fce56-c39d-7cbb-b689-6c18f3b0f5ce,
tools=[read,write,edit,bash], extensions=false, skills=false.

## Design (additive, backward-compatible)
1. New `entity_access_tokens` table + repository (db/src/access-tokens.ts): individually
   revocable hashed credential -> active principal. Revoking the token OR disabling the
   principal immediately denies.
2. New server `principals/request-context.ts`: `createCustomerPrincipalMiddleware()` runs
   after api-auth, resolves `x-entity-access-token` -> customer principal attached to req.
   Helpers: getCustomerPrincipal, authorizedOrgIds, isOrgAuthorized, resolveAuthorizedOrg,
   authorizeTaskOrg, filterTasksForRequest, resolveRequestActorId.
3. Preserve trusted service/admin path (PR #71/#72): when no customer token, behavior is
   IDENTICAL to today (resolveTrustedPrincipalId -> apiPrincipalId; caller-org allowed).
4. Wire guards into task routes (list filter, get/update/move/delete guard, create
   org-from-grant), review-gate router (server-derived actor + org guard), handoff router
   (server-derived actor + org guard), task-helpers getTaskActorFromRequest, and
   request-permissions (readRequestPrincipal/readRequestOrg honor customer scope).
5. RED production-composed acceptance tests first, then implement to GREEN.
6. Backup/restore proof upgraded to real restore -> init repos -> post-restore mutation.

## Steps
- [x] Recon (AGENTS, review, historical, current diff, PR #71/#72 machinery).
- [ ] db access-tokens module + colocated test (GREEN leaf).
- [ ] server request-context module + colocated test.
- [ ] RED production-composed auth/tenant acceptance test (fail on current).
- [ ] Wire customer middleware into index.ts; add route/handoff/review/tasks/document guards.
- [ ] GREEN acceptance test.
- [ ] Backup/restore restore-into-clean-DB test.
- [ ] Full server Vitest + focused + build.
- [ ] Update criterion matrix truthfully; sync ACTIVE_PLAN.
- [ ] Commit; worktree clean; receipt JSON.
- [ ] `git diff --check` clean (no trailing whitespace).

## Files
(to be filled as implementation proceeds)

## Resume
1. Read this plan + `reviews/01-terra.json` + `workers/02-auth-tenant-repair.json`.
2. `git status` / `git rev-parse HEAD`.
3. Continue at first unchecked step.
