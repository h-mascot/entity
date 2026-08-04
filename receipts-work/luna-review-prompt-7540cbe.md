You are the governed Luna-high reviewer for Entity backlog-closure release candidate PR #68 (THIRD review, after the second remediation). Be adversarial but precise; do not invent issues.

REPO/WORKTREE: /Users/enterprise/Code/entity-backlog-closure-runnerqa-20260804 (cd here; read files with your tools).
BASE (origin/main, merged): fbee4a9f2ea9fc35f9d3ae95bbceb27607360c33
HEAD (PR #68 tip): 7540cbe
BRANCH: runnerqa/backlog-closure-20260804
PRIMARY REMEDIATION DIFF: `git diff 8dca036...7540cbe` (the org-authority hardening) and `git diff 2c04f6d...7540cbe` (full scoped-search backend + Workplane wiring).

═══════════════════════════════════════════════════════════════════
CRITICAL — RUNTIME REQUIREMENT (read before any test execution)
═══════════════════════════════════════════════════════════════════
This host's DEFAULT `node` is v26.5.0 (NODE_MODULE_VERSION 147). The project's better-sqlite3 native binding is prebuilt for node@22 (NODE_MODULE_VERSION 127), and the project REQUIRES node@22 (root package.json engines; ctrl:gate runs under node@22). Running `npx vitest` under the default node produces a spurious "better-sqlite3 ABI mismatch" 500 and is NOT a real failure.

If you execute any test, you MUST prepend the node@22 path:
    export PATH="/opt/homebrew/opt/node@22/bin:$PATH"   # node v22.22.3
Do NOT base any finding on a run under the default node. The authoritative proof is the receipt at /Users/enterprise/clawd/output/entity/backlog-closure-runnerqa/receipts/node22-proof-7540cbe.txt (ctrl:gate green: db 39, app suite, server 1167; scoped-search 32/32 — all under node@22).

═══════════════════════════════════════════════════════════════════
PRIOR VERDICT (2nd review, on 8dca036): CHANGES_REQUESTED, blockerCount=1, securityVerdict=FAIL, testGapVerdict=FAIL, priorBlockerResolved=true.
═══════════════════════════════════════════════════════════════════

The two prior findings and what changed since (verify each in code):

• [was BLOCKER] cross-org authority / request-org binding (request-permissions.ts:20-38).
  Prior issue: readRequestOrg accepts req.query/req.body org selectors, so the scoped-search org scope could be attacker-selected.
  RESOLUTION (commit 3466c66): the scoped-search route NO LONGER uses requireRequestOrg(). It uses a route-local requireScopedSearchOrg() (packages/server/src/routes/scoped-search.ts) that reads the org ONLY from the authenticated workspace header `x-entity-org-id`/`x-entity-org` (+ readDefaultOrgId() fallback), and IGNORES req.query/req.body org. The client already sends org via that header (packages/app/src/lib/scopedSearch.ts:446 `'x-entity-org-id': orgId`), so this is a safe, local hardening; HEAD's other routes keep requireRequestOrg unchanged.
  DEFENSE-IN-DEPTH: per-object visibility is still gated by the principal's org-scoped grants — packages/server/src/permissions.ts grantCoversObject() returns false when `grantOrg && objectOrg && grantOrg !== objectOrg`, so evaluatePermission() DENIES objects in orgs the principal has no grant for, and buildPermissionSafeRecordEnvelope() redacts denied records to placeholders. scoped-search-documents.ts / scoped-search-task-proof.ts pass every result through permissionSafeResult()→permissionSafeRecord() before return.
  NEW REGRESSION TEST (scoped-search.test.ts): "ignores client-controlled query/body org and binds the authenticated header org" — a request with header org-a + query `?org_id=org-b` binds org-a, returns only org-a rows, and the repo is called with org_id 'org-a' (never 'org-b'). Plus the earlier cross-org isolation test.

• [was HIGH] scoped-search verification (test ABI mismatch).
  Prior issue: the reviewer ran the suite under the default node (v26) and hit a better-sqlite3 ABI mismatch, reporting 31 failures.
  This was an ENVIRONMENT artifact, not a code defect. The suite passes 32/32 under the project's required node@22 (see receipt above). Do not reproduce this artifact; use node@22.

REQUIRED REVIEW DIMENSIONS (cover all; cite file:line; be adversarial but precise):
- ARCHITECTURE: Is requireScopedSearchOrg() correctly header-only and wired as the sole org authority for the route? Does it preserve the principal resolution (readRequestPrincipal) so per-object grants still apply? Any conflict with the legacy /api/search `/` handler?
- CORRECTNESS: envelope (entity.scoped-search.v1), object-type/scope validation, cursor pagination, backend health aggregation, restricted projection, deep links (/workplane/:taskId), Workplane onNavigate guard (isPermittedWorkplaneScopedRoute).
- SECURITY (THERMO-NUCLEAR): (1) Confirm requireScopedSearchOrg reads ONLY the header (not query/body) — read the function. (2) Confirm every backend SQL query is org-scoped (WHERE org_id = ?) with orgId from the header binding. (3) Confirm the principal's org-scoped grants gate per-object visibility (permissionSafeRecord → grantCoversObject) so even a spoofed header org yields only redacted/restricted results for objects the principal lacks grants for. (4) Confirm file-index search() includeUnscoped legacy-null fallback attributes only to the DEFAULT workspace org.
- REGRESSIONS: Does the header-only change break the client (it uses the header) or any existing behavior? Does exporting sourcePreviewRestricted or the file-index/listExternalDocumentRefs extensions weaken main?
- TEST GAP: cross-org isolation + header-authority override regression both present and meaningful? degraded/failed/restricted/pagination covered? Workplane guard exhaustive?

OUTPUT: A single JSON object with this EXACT shape and nothing else:
{
  "base": "fbee4a9...",
  "head": "7540cbe",
  "verdict": "APPROVED" | "CHANGES_REQUESTED" | "BLOCKED",
  "summary": "<2-4 sentences>",
  "findings": [
    {"severity": "BLOCKER"|"HIGH"|"MEDIUM"|"LOW"|"NIT", "scope": "<area>", "location": "<file:line>", "issue": "...", "fix": "..."}
  ],
  "blockerCount": <int>,
  "securityVerdict": "PASS" | "FAIL",
  "testGapVerdict": "PASS" | "FAIL",
  "regressionRisk": "low"|"medium"|"high",
  "priorBlockerResolved": true | false,
  "priorHighResolved": true | false
}
Rules: verdict APPROVED requires blockerCount==0 AND securityVerdict==PASS AND testGapVerdict==PASS. Do NOT raise the better-sqlite3 ABI mismatch as a finding — it is a node-version artifact; the authoritative proof is the node@22 receipt. Do NOT edit files — read-only review. If the org-authority BLOCKER is genuinely resolved and tests pass under node@22, set verdict APPROVED.
