# Cursor goal prompt — Entity Phase 2 end-to-end Linear execution

Run Cursor from repo root:

```bash
cd /Users/enterprise/Code/entity
```

Paste this into Cursor:

```text
/goal

You are Cursor executing the remaining Entity Phase 2 Linear implementation program end-to-end.

Repository:
- Root: /Users/enterprise/Code/entity
- Plan/reference: /Users/enterprise/Code/entity/docs/execution-packs/entity-phase-2-cursor-20260621/plan.md
- Public plan link: http://100.104.229.62:3000/docs/source/geordi/docs/execution-packs/entity-phase-2-cursor-20260621/plan.md
- Raw fallback: http://100.104.229.62:3000/api/file/raw?source=geordi&path=docs/execution-packs/entity-phase-2-cursor-20260621/plan.md
- Linear project: Entity
- Linear API: use `LINEAR_API_KEY` from the environment or `/Users/enterprise/.hermes/.env`. Never print, commit, log, or expose the key. If Cursor cannot see `LINEAR_API_KEY`, do **not** start OAuth; use terminal commands that source the env file non-verbosely, for example:

```bash
set -a
. /Users/enterprise/.hermes/.env
set +a
python3 /Users/enterprise/.hermes/skills/productivity/linear/scripts/linear_api.py whoami
```

Do not echo the key. Do not paste it into chat. Do not write it into repo files.

Mission:
Implement every remaining dependency-safe Entity Phase 2 child issue, one at a time, until the approved queue is complete or a real fail-stop blocker prevents safe progress.

Authority order:
1. Live Linear issue body
2. AGENTS.md
3. .cursor/rules/entity-phase-2.mdc
4. docs/context/entity-phase-2-build-context.md
5. docs/specs/entity-phase-2-prd-canonical-20260620.md
6. docs/specs/entity-phase-2-spec-oracle55pro-20260620.md
7. package.json and .project-gate.json
8. The plan file above as operating guidance

Before coding:
1. Read AGENTS.md.
2. Read .cursor/rules/entity-phase-2.mdc.
3. Read docs/context/entity-phase-2-build-context.md.
4. Read docs/specs/entity-phase-2-prd-canonical-20260620.md.
5. Read docs/specs/entity-phase-2-spec-oracle55pro-20260620.md.
6. Read package.json.
7. Read .project-gate.json.
8. Inspect git status.
9. Read the live Linear body for the assigned child issue.
10. Confirm the issue is a child issue, not a parent epic.
11. Respect dependencies/blockers; pick only dependency-safe child issues.

Known Entity policy:
- Entity stays the work/collaboration/review plane.
- Helm owns runtime/admin authority; do not move deep runtime/admin controls into Entity.
- Helm is the source of dangerous-action authority and confirmation gates — not Entity.
- Action Gate, agent-action-gate, Ada observer, and external observer are not Entity concepts unless Henry explicitly approves a named exception.
- ClickClack owns chat primitives; Entity owns work-object context.
- Google Docs/Drive V1 is read/index/link/preview only.
- Paperclip is external competitor/reference only.
- Curacel is pilot/design-customer context only.

Execution mode:
- Work one child issue at a time.
- Do not fan out.
- Continue autonomously across the remaining dependency-safe child issues.
- Do not stop for routine choices; make the smallest safe implementation.
- Do not start the next child until the current child has passed proof, gate, Book review, and verify — or has an explicit Henry-approved waiver.
- Stop only for real blockers:
  - missing or contradictory Linear issue body
  - dependency violation
  - unclear destructive action
  - failing gate you cannot safely fix
  - missing required secret/API access
  - repo state conflict
  - instruction conflict
  - issue scope mismatch

Per issue:
1. Fetch and read the full Linear issue body.
2. Confirm the issue is a child issue, not a parent epic.
3. Confirm it is dependency-safe now.
4. Create or switch to branch: <ISSUE-ID>-<short-slug>
5. Implement only that issue.
6. Add/update focused tests where applicable.
7. Update docs only when the issue requires it.
8. Keep receipts/proof artifacts under the expected paths.
9. Comment back to Linear with proof once complete.

Hard zero-policy:
Do not introduce named external coordination/plugin/service terminology or observer/owner framing into Entity issues, code, docs, fixtures, UI, logs, receipts, or comments unless Henry explicitly approves a named exception.

Banned terms:
- Action Gate
- agent-action-gate
- Ada observer
- external observer

Use generic Entity product language only:
- work/collaboration/review plane
- task/work-object context
- audit/evidence references
- proof trails
- review/approval receipts

Do not:
- implement Action Gate inside Entity
- add generic gate/orchestration code to Entity
- add private Enterprise/Henry defaults
- commit hostnames, local profile values, secrets, env files, API keys, or tokens
- hide unrelated dirty files
- mix unrelated issues into one commit
- close parent epics directly

Proof commands:
Run the repo-real proof commands from `.project-gate.json`:

```bash
bash scripts/proof/entity-phase-2-smoke.sh
npm run build
cd packages/server && npm run build && npx vitest run
```

Shared CLI Tester gate:
For each issue, run all four steps:

```bash
/Users/enterprise/Code/cli-tester/bin/project-test-gate \
  --root /Users/enterprise/Code/entity \
  --config /Users/enterprise/Code/entity/.project-gate.json \
  request <ISSUE-ID> <branch-or-pr>

/Users/enterprise/Code/cli-tester/bin/project-test-gate \
  --root /Users/enterprise/Code/entity \
  --config /Users/enterprise/Code/entity/.project-gate.json \
  run <ISSUE-ID>

/Users/enterprise/Code/cli-tester/bin/project-test-gate \
  --root /Users/enterprise/Code/entity \
  --config /Users/enterprise/Code/entity/.project-gate.json \
  book-review <ISSUE-ID>

/Users/enterprise/Code/cli-tester/bin/project-test-gate \
  --root /Users/enterprise/Code/entity \
  --config /Users/enterprise/Code/entity/.project-gate.json \
  verify <ISSUE-ID>
```

Important:
- `run` PASS is machine proof only.
- Because `bookReview.required` is true, continuation requires `book-review` plus `verify`.
- Continue only if Book review returns APPROVED and `safeToContinue=true`.
- If `verify` blocks, do not start the next issue.

Receipt paths:
- Machine gate: `output/entity-phase-2/test-gate/<ISSUE-ID>.json` and `.md`
- Book review: `output/entity-phase-2/book-review/<ISSUE-ID>...`
- Autonomous run log: `output/entity-phase-2/cursor-autonomous-run/receipt.md`
- Local run state: `.cursor/run-state/entity-phase-2.json`

Maintain `.cursor/run-state/entity-phase-2.json` with:
- current issue
- completed issues
- skipped/blocked issues
- branch names
- gate receipt paths
- Book review receipt paths
- proof commands/results
- Linear comment URLs if available
- next issue candidate

Review gates before considering an issue complete:
- proof commands passed
- project-test-gate `run` PASS receipt exists
- `book-review` APPROVED receipt exists
- `verify` passes with next child unblocked
- Linear issue linked/commented with branch, files changed, commands, exit codes, proof paths, and blockers if any
- diff scope matches assigned issue
- no unrelated files
- no secrets/private defaults
- no banned terms in non-allowlisted packageable changes
- AGENTS.md and Cursor rules followed
- Codex autoreview for non-trivial PRs when available
- GitNexus detect-changes/impact when configured and fresh
- thermo-nuclear review only for high-risk PRs:
  - runtime/provider contracts
  - authority/receipt logic
  - secret/private-default handling
  - live delivery or dangerous-action paths
  - source→gate→service promotion or drift detection
  - release/proof gates
  - broad diffs spanning multiple parent areas
  - any PR where Codex autoreview flags meaningful concerns

UI proof / video evidence policy:
- Local image proof (screenshots/DOM/browser snapshots) is the default for UI-facing issues.
- Local video is opt-in only — use only when an issue actually requires motion / interaction proof, or when Henry explicitly asks.
- When local video is required, record via Playwright/browser recording or macOS screen recording as an explicit proof step.
- A screenshot or video must be tied to the issue ID, branch/commit, and proof receipt; do not reuse one visual receipt across multiple child issues.

Linear update after each issue:
Comment with:
- issue ID
- branch name
- files changed
- commands run
- exit codes
- proof artifact paths
- gate receipt path
- Book review receipt path
- blockers, if any

Mark status according to the team workflow only if proof supports it.
Do not create new Linear issues unless clearly required and justified.
Do not close parent epics directly.

Git behavior:
- Commit completed issue work in scoped commits.
- One issue per branch/PR unless a dependency-safe tight batch is explicitly justified.
- Do not merge without Book/SuperAda verification unless Henry has explicitly authorized Cursor to merge.
- Never commit LINEAR_API_KEY, env files, secrets, local hostnames, private defaults, or generated run-state.

Completion condition:
Continue until every remaining dependency-safe Entity Phase 2 child issue is implemented and verified, or until a real blocker prevents safe progress.

Final report:
When done or blocked, produce:
- completed issue list
- blocked issue list with exact blocker
- branches/PRs
- commits
- files changed
- proof commands and exit codes
- gate receipts
- Book review receipts
- Linear comments/status updates
- screenshots/DOM receipts if any
- whether final Entity Phase 2 readiness can or cannot be claimed

Do not claim final Entity Phase 2 readiness unless all release/proof gates pass.
```