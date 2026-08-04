# Plan: Admin RBAC 403 + Doc Conversion Browser QA

**MC Task:** sandbox visual-QA regression
**Created:** 2026-08-04
**Branch:** fix/admin-rbac-403-browser-qa-20260804
**Base:** 75b2b88047a79415231f8f988c4d533aec543412
**Status:** IN PROGRESS

## Task
Repair the Admin > Access Control > Users & Roles 403 regression (sandbox shows
"Failed to load principals (403)") and harden browser/e2e coverage so panel
visibility is never accepted as PASS. Also verify doc-conversion via real UI
controls, preserve 7 admin sections w/ Save/Reset/reload, and run narrow 390x844 QA.

## Root Cause
`packages/server/src/middleware/admin-auth.ts` `createRequireAdminPrincipal`:
when `principalCount===0 && isApiAuthEnabled()`, it 403s every non-POST request
(commit b0d6a64). The UI's bootstrap GET `/api/admin/principals` is blocked, so
the panel never loads the empty list needed to show the create form.

## Constraints (SAFETY)
- No DB reset/deletion, no .env changes, no destructive migrations, no prod mutation.
- Never edit the canonical /Users/enterprise/Code/entity checkout.
- Do NOT trust client role headers when a stored principal exists.
- Do NOT weaken fail-closed RBAC. (Allowing GET of an empty list leaks nothing.)

## Dependencies
- [x] Node 22 toolchain (Node 26 breaks better-sqlite3) — resolved via nvm.
- [x] Root cause identified — bootstrap GET blocked.

## Plan
- [ ] 1. RED: focused failing test — GET /principals during API-auth bootstrap returns 200 [] (admin-auth.test.ts). Run vitest, confirm RED.
- [ ] 2. FIX: allow narrow GET /principals list during empty bootstrap in admin-auth.ts; keep mutation blocking.
- [ ] 3. GREEN: update the over-broad `blocks non-create admin routes` test to target a mutation; add bootstrap-list-200 test. Run vitest GREEN.
- [ ] 4. Add colocated regression coverage for full UI bootstrap path (create→grant→reload→revoke→disable) at the route/middleware level.
- [ ] 5. Full server gate: `cd packages/server && npm run build && npx vitest run`.
- [ ] 6. App build: `npm --prefix packages/app run build`.
- [ ] 7. ctrl:gate at root.
- [ ] 8. Governed review via opencode (gpt-5.6-luna high); save JSON under output/runner-receipts/admin-rbac-403-glm52/. Fix actionable findings.
- [ ] 9. Commit, push, open PR, wait CI, merge to main.
- [ ] 10. Deploy merged SHA to sandbox only; verify /api/version exact SHA.
- [ ] 11. Native Playwright/browser QA: Users & Roles full CRUD + grant/revoke/disable; Convert via real controls (PRD + Blog targets, provenance, source unchanged); 7 sections Save/Reset/reload; 390x844 narrow screenshots.
- [ ] 12. Save JSON receipts + screenshots; update state.json to PASS.

## Files Touched
- packages/server/src/middleware/admin-auth.ts (fix)
- packages/server/src/middleware/admin-auth.test.ts (tests)
- packages/server/src/principals/admin-identity.test.ts (if needed)
- (possibly) browser/e2e hardening
- output/runner-receipts/admin-rbac-403-glm52/{state.json, review JSON, receipts}

## Resume Instructions
Read state.json + this plan. Re-run `git status`. Continue from first unchecked [ ].
