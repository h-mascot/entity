You are the governed Luna-high reviewer for Entity backlog-closure release candidate PR #68 (SECOND review, after remediation).

REPO/WORKTREE: /Users/enterprise/Code/entity-backlog-closure-runnerqa-20260804 (cd here; read files with your tools).
BASE (origin/main, merged): fbee4a9f2ea9fc35f9d3ae95bbceb27607360c33
HEAD (PR #68 tip): 8dca036
BRANCH: runnerqa/backlog-closure-20260804
PRIMARY REMEDIATION DIFF: `git diff 2c04f6d...8dca036` (the scoped-search backend + Workplane wiring; ~3283 insertions across 11 files). Full PR diff vs base: `git diff fbee4a9...8dca036`.

PRIOR VERDICT (on 107136b): CHANGES_REQUESTED, blockerCount=1, securityVerdict=PASS, testGapVerdict=FAIL, regressionRisk=high. The three findings were:
1. [BLOCKER] scoped-search backend wiring — the SRCH-A-05/06 client called /api/search/scoped but the server only registered the legacy /api/search route; every request 404'd. Fix required: implement/register the permission-safe /api/search/scoped contract (entity.scoped-search.v1 envelope, object-type/scope handling, backend health states, pagination, restricted-result projection) OR remove the UI.
2. [HIGH] scoped-search test coverage — proof-pack tests didn't hit the server route/envelope contract.
3. [MEDIUM] Workplane scoped-search integration — WorkplaneShell mounted the panel without orgId or onNavigate.

WHAT CHANGED SINCE THE PRIOR REVIEW (verify each):
- BLOCKER resolved by IMPLEMENTING the backend (not removing UI): packages/server/src/routes/scoped-search.ts (827-line router bound to requireRequestOrg), scoped-search-documents.ts (291), scoped-search-task-proof.ts (408); registered at /api/search/scoped via createSearchRouter's new `scoped` dep in packages/server/src/routes/search.ts. Data layer ported into HEAD: packages/db/src/index.ts adds listNativeDocuments + listArtifacts (both `SELECT ... WHERE org_id = ?` prepared statements) and extends listExternalDocumentRefs; packages/db/src/file-index.ts search() now honors orgId/includeUnscoped (`org_id = ?`) so file results cannot leak cross-org. OrgId is sourced exclusively from requireRequestOrg() (RBAC binding) — never from client query input.
- HIGH resolved: packages/server/src/routes/scoped-search.test.ts (31 server tests covering healthy/empty/degraded/failed/restricted + a NEW cross-org isolation Prove-It test proving an org-a request never surfaces org-b records and the repo is called with the bound org_id). packages/server/src/document-objects.test.ts mocks updated.
- MEDIUM resolved: packages/app/src/components/workplane/WorkplaneShell.tsx now passes orgId + a fail-closed onNavigate (isPermittedWorkplaneScopedRoute in packages/app/src/lib/workplaneScopedSearch.ts) that only dispatches /workplane/:taskId routes and rejects Doc Hub/API/absolute/script URLs; task+proof results now carry /workplane/:taskId deep links (scoped-search-task-proof.ts). New test packages/app/src/lib/workplaneScopedSearch.test.ts.
- origin/main (#69 release manifest hardening, #70 admin-rbac-403 fix) was merged in (e449322); conflicts were non-code (plan doc + openwiki fingerprint, regenerated).

REQUIRED REVIEW DIMENSIONS (cover all; cite file:line; be adversarial):
- ARCHITECTURE: Is the scoped-search router cleanly integrated via createSearchRouter's `scoped` dep? Any duplicate route registration, dead code, or conflict with the legacy /api/search `/` handler (which still uses readScopedSearchRuntimeSettings)? Is the merge with origin/main coherent (no clobbered #69/#70 fixes)?
- CORRECTNESS: envelope shape (entity.scoped-search.v1), object-type/scope validation, cursor pagination (encode/decode, MAX_CURSOR_OFFSET), backend health aggregation (healthy/degraded/failed/unknown), restricted-result projection. Any logic errors in the new DB list methods (listNativeDocuments/listArtifacts/listExternalDocumentRefs extension) or the file-index org-scoping + title-score ranking? Does the Workplane onNavigate guard correctly reject non-workplane routes?
- SECURITY (THERMO-NUCLEAR — this is the highest-risk scope): CROSS-ORG ISOLATION. Confirm that EVERY backend query is org-scoped at the SQL layer (WHERE org_id = ?) and that orgId flows ONLY from requireRequestOrg()'s binding — never from req.query/req.body. Confirm file-index search() cannot return rows from another org (including the includeUnscoped legacy-null fallback which must only attribute to the DEFAULT workspace org). Confirm restricted results are redacted and that a faulty/degraded backend cannot leak private metadata. Confirm requireRequestOrg's default-org fallback is permission-safe (scoped to a real workspace, not a privilege escalation).
- REGRESSIONS: Does the listExternalDocumentRefs extension (new filters + sort + limit bump 100→10101) or the file-index search() change (new org clause + score select + limit bump) weaken any existing main behavior? Does exporting sourcePreviewRestricted from fs/routes-search.ts break encapsulation? Any test asserting success while behavior is broken?
- TEST GAP: Is cross-org isolation adequately proven (the new Prove-It test)? Are degraded/failed/restricted/pagination paths covered? Is the Workplane navigation guard exhaustively tested (permitted vs rejected routes)?

HIGH-RISK SCOPES TO READ IN FULL:
- packages/server/src/routes/scoped-search.ts (the router: requireRequestOrg binding, parseFilters, backend dispatch, envelope assembly, error handling)
- packages/server/src/routes/scoped-search-documents.ts, scoped-search-task-proof.ts (result builders, permissionSafeResult redaction, deep links)
- packages/db/src/index.ts (listNativeDocuments, listArtifacts, listExternalDocumentRefs — confirm org-scoped SQL)
- packages/db/src/file-index.ts (search() org-scoping + includeUnscoped)
- packages/server/src/routes/search.ts (the `scoped` dep wiring + mount at /scoped)
- packages/app/src/lib/workplaneScopedSearch.ts + WorkplaneShell.tsx (onNavigate guard)
- packages/server/src/routes/scoped-search.test.ts (the cross-org isolation test + coverage)

OUTPUT: A single JSON object with this EXACT shape and nothing else:
{
  "base": "fbee4a9...",
  "head": "8dca036...",
  "verdict": "APPROVED" | "CHANGES_REQUESTED" | "BLOCKED",
  "summary": "<2-4 sentences>",
  "findings": [
    {"severity": "BLOCKER"|"HIGH"|"MEDIUM"|"LOW"|"NIT", "scope": "<area>", "location": "<file:line>", "issue": "...", "fix": "..."}
  ],
  "blockerCount": <int>,
  "securityVerdict": "PASS" | "FAIL",
  "testGapVerdict": "PASS" | "FAIL",
  "regressionRisk": "low"|"medium"|"high",
  "priorBlockerResolved": true | false
}
Rules: verdict APPROVED requires blockerCount==0 AND securityVerdict==PASS AND testGapVerdict==PASS. Be concrete and adversarial; cite file:line. Do NOT edit files — this is a read-only review. If the BLOCKER is genuinely resolved and no new blocker exists, say so explicitly in priorBlockerResolved and set verdict APPROVED.
