# Entity Phase 2 Cursor Operating Handoff Plan

Generated: 2026-06-21
Project slug: `entity-phase-2`
Repo root: `/Users/enterprise/Code/entity`
Linear project/team: `Entity` / `Theherald (THE)`
Artifact directory: `/Users/enterprise/Code/entity/docs/execution-packs/entity-phase-2-cursor-20260621`

**Human handoff link:** <http://100.104.229.62:3000/docs/source/geordi/docs/execution-packs/entity-phase-2-cursor-20260621/plan.md>
**Raw machine link:** <http://100.104.229.62:3000/api/file/raw?source=geordi&path=docs/execution-packs/entity-phase-2-cursor-20260621/plan.md>

## Current state

- Repo branch/worktree:

```text
## main...origin/main [ahead 1]
 M .gitignore
?? docs/execution-packs/
?? docs/specs/entity-phase-2-linear_id_to_source_id.json
HEAD b47ae8d
```

- Linear parent/child graph exists: 15 parent epics, 75 child implementation issues (`THE-21` through `THE-95`).
- Mapping table exists: `docs/execution-packs/entity-phase-2-cursor-20260621/linear_id_to_source_id.json` and mirrored at `docs/specs/entity-phase-2-linear_id_to_source_id.json`.
- Live Linear preflight fetched all 75 issues and verified UUID, parent, title/source, URL slug, proof commands, and banned-term checks.
- Original live Linear preflight failed because issue bodies lacked explicit child source keys. That blocker has now been fixed.
- 75 body-only Linear description updates were applied from `cleanup-drafts/` with run-state at `cleanup-drafts/cleanup-write-run-state.json`.
- Post-write live Linear preflight PASS is recorded in `linear-live-preflight-postwrite-20260621.md` / `.json`.
- Shared smoke/proof script passed after the Linear updates: `scripts/proof/entity-phase-2-smoke.sh`.
- `.project-gate.json` exists in repo root, copied from the reviewed pack example.

## Cursor-ready verdict

**Cursor-ready: YES for the approved child queue, with the gates and hard rules below.**

Cleared after Henry approval and Book execution:

- 75 body-only Linear updates applied (`THE-21` through `THE-95`), no titles/comments/status/labels/assignees changed.
- Post-write live Linear preflight PASS: body/source-ID alignment is now 75/75.
- Execution-pack validator PASS.
- `.project-gate.json` copied to repo root from the reviewed pack example.
- Smoke/proof gate PASS under Node v22.22.2 after rebuilding `better-sqlite3` for that runtime.
- CLI Tester smoke receipt PASS for `THE-21`: `output/project/test-gate/THE-21.json`.

## Preflight cleanup status

Preflight cleanup is complete. Do not run the old cleanup prompt again.

Completed actions:

- Applied 75 body-only Linear description updates from `cleanup-drafts/`.
- Re-fetched live Linear and confirmed body/source-ID alignment 75/75.
- Copied reviewed `.project-gate.json` to repo root.
- Re-ran validator and proof gates.

## Copy/paste Cursor prompt — approved queue

Use this now for Cursor on the approved queue below. Keep the fail-stop rules intact.

```text
You are Cursor executing the approved Entity Phase 2 child-issue queue.

Repo: /Users/enterprise/Code/entity
Plan: http://100.104.229.62:3000/docs/source/geordi/docs/execution-packs/entity-phase-2-cursor-20260621/plan.md
Raw plan fallback: http://100.104.229.62:3000/api/file/raw?source=geordi&path=docs/execution-packs/entity-phase-2-cursor-20260621/plan.md

Before doing anything, read:
- the full handoff plan linked above
- AGENTS.md
- .cursor/rules/entity-phase-2.mdc
- docs/context/entity-phase-2-build-context.md
- docs/execution-packs/entity-phase-2-cursor-20260621/linear_id_to_source_id.json
- .project-gate.json
- .cursor/run-state/entity-phase-2.json if present
- the full live Linear issue body for the assigned issue

Hard rules:
- Work only the approved queue in the handoff plan.
- Do not discover, add, reorder, skip, or substitute issues.
- Do not work parent epics as build tasks.
- Before each issue, reread the plan, repo rules, mapping table, run-state file, gate config, and live Linear issue body.
- If an issue body lacks its explicit source ID, stop.
- If the issue body appears mismapped or stale, stop.
- Do not introduce private defaults, secrets, local host assumptions, or unrelated changes.
- Do not continue to the next issue unless the current issue’s gate receipt is PASS.

For each issue:
1. Create/update a branch named from the issue ID.
2. Implement only that issue.
3. Run the configured project proof commands from the plan.
4. Run the shared CLI Tester gate:
   /Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json run <ISSUE_ID>
5. Read the receipt under output/entity-phase-2/test-gate/<ISSUE_ID>.json.
6. If FAIL or missing, stop and report the blocker.
7. If PASS, run the required review gates from the plan: Codex autoreview for non-trivial diffs, GitNexus/AGENTS when configured/fresh, thermo-nuclear only for high-risk changes.
8. Open/update a PR with issue ID, changed files, proof commands, receipt path, and blockers.
9. Update .cursor/run-state/entity-phase-2.json.
10. Continue only if the approved queue says to continue and all gates are PASS.

Do not merge without Book/SuperAda verification unless Henry has explicitly authorized Cursor to merge.

## End-to-end goal-mode prompt (Helm-style default) — use only after preflight passes

**Do not use this while `Cursor-ready` is `no`.** This is the whole-goal prompt for approved queues. It mirrors the Helm v1 goal-mode shape and supersedes the bounded-queue prompt above for autonomous runs. Use only after all preflight gates pass.

The full prompt lives at:

```text
docs/execution-packs/entity-phase-2-cursor-20260621/cursor-goal-prompt.md
```

It MUST include:

- `/goal` invocation at the top
- Repository, plan link, raw-fallback link, Linear project, and API key handling
- Authority order ending with the plan file
- "Before coding" reread list aligned with the bounded-queue prompt
- Project-specific known policy block (Entity/Helm boundary, ClickClack/Paperclip/Curacel scoping)
- Hard zero-policy block naming any project-banned external coordination/plugin/service terminology
- All four CLI Tester steps: `request`, `run`, `book-review`, `verify`
- UI proof / video evidence policy consistent with the plan
- Receipts/state/Book-review sections
- Standardized no-merge sentence:
  ```text
  Do not merge without Book/SuperAda verification unless Henry has explicitly authorized Cursor to merge.
  ```

```
```

### Blockers

No current preflight blockers remain for launching Cursor on the approved child queue.

Notes:
- Use Node v22.22.2 for local proof gates; Node v26 cannot rebuild/use this repo's `better-sqlite3@11.10.0` cleanly.
- Do not merge Cursor PRs without explicit authorization.
- Do not let Cursor work parent epics or self-discover issues.

## Source-of-truth inventory

| Source | Path/URL | Status | Cursor-readable? | Notes |
|---|---|---:|---:|---|
| Repo rules | `/Users/enterprise/Code/entity/AGENTS.md` | present | yes | Required before any issue |
| Cursor rules | `/Users/enterprise/Code/entity/.cursor/rules/entity-phase-2.mdc` | present | yes | Required for local Cursor |
| Build context | `/Users/enterprise/Code/entity/docs/context/entity-phase-2-build-context.md` | present | yes | Operating context |
| Canonical PRD | `docs/specs/entity-phase-2-prd-canonical-20260620.md` | present | yes | Source of product scope |
| Oracle spec | `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md` | present | yes | Detail pass |
| Linear issue map | `docs/specs/entity-phase-2-linear-issue-map-20260620.md` | present | yes | Parent/child graph |
| Mapping table | `docs/execution-packs/entity-phase-2-cursor-20260621/linear_id_to_source_id.json` | present | yes | Explicit source mapping |
| Live Linear preflight | `docs/execution-packs/entity-phase-2-cursor-20260621/linear-live-preflight-20260621.md` | present | yes | Fails body-source-key alignment |
| Cleanup write plan | `docs/execution-packs/entity-phase-2-cursor-20260621/linear-cleanup-write-plan-20260621.md` | draft only | yes | Do not apply without approval |
| Gate example | `docs/execution-packs/entity-phase-2-cursor-20260621/.project-gate.example.json` | example only | yes | Review/copy to repo root before hard CLI Tester gate |

## Hard rules

- Cursor may execute only the approved queue after preflight passes.
- Parent epics (`THE-6` through `THE-20`) sequence work; child issues (`THE-21` through `THE-95`) carry implementation contracts.
- No ordinal mapping. Use `linear_id_to_source_id.json` only.
- No Cursor self-discovery, scheduling, or issue reordering unless Henry explicitly approves a new queue.
- Runtime state is local-only and must never be committed.
- CLI Tester gate is the default issue proof gate once `.project-gate.json` is reviewed/copied into repo root.
- Codex autoreview is the default review for non-trivial diffs.
- GitNexus/AGENTS gate is required when configured and fresh.
- Thermo-nuclear review is escalation only for high-risk or disputed changes.
- Cron/check-in automation is opt-in only and must not be registered from this document.

## Approved queue

**Approved queue status: cleared for Cursor execution after post-write preflight and gate checks.** Cursor may process only this explicit queue, in order, with fail-stop gates.

Cursor may eventually process this list in order and no other issue:

```text
- THE-21
- THE-22
- THE-23
- THE-24
- THE-25
- THE-26
- THE-27
- THE-28
- THE-29
- THE-30
- THE-31
- THE-32
- THE-33
- THE-34
- THE-35
- THE-36
- THE-37
- THE-38
- THE-39
- THE-40
- THE-41
- THE-42
- THE-43
- THE-44
- THE-45
- THE-46
- THE-47
- THE-48
- THE-49
- THE-50
- THE-51
- THE-52
- THE-53
- THE-54
- THE-55
- THE-56
- THE-57
- THE-58
- THE-59
- THE-60
- THE-61
- THE-62
- THE-63
- THE-64
- THE-65
- THE-66
- THE-67
- THE-68
- THE-69
- THE-70
- THE-71
- THE-72
- THE-73
- THE-74
- THE-75
- THE-76
- THE-77
- THE-78
- THE-79
- THE-80
- THE-81
- THE-82
- THE-83
- THE-84
- THE-85
- THE-86
- THE-87
- THE-88
- THE-89
- THE-90
- THE-91
- THE-92
- THE-93
- THE-94
- THE-95
```

If the queue is empty or contains any unmapped/stale issue, Cursor must stop.

## State file

Runtime state file:

```text
/Users/enterprise/Code/entity/.cursor/run-state/entity-phase-2.json
```

Rules:

- create/update during execution
- include approved queue, current issue, status, receipts, blockers
- `.cursor/run-state/` is ignored by git
- never commit runtime state
- reread after compaction/restart before continuing

## Per-issue flow

For each issue:

1. Re-read this plan, the live Linear issue body, repo `AGENTS.md`, Cursor rules, build context, mapping table, gate config, and state file.
2. Confirm issue is in approved queue and not completed/blocked.
3. Verify title/body/source mapping against `linear_id_to_source_id.json`.
4. Stop if issue is stale, mismapped, missing source, has banned terms, or has invalid proof commands.
5. Create or use a branch scoped to the issue.
6. Implement only the issue scope.
7. Run repo proof commands.
8. Run shared CLI Tester when gate config is present/reviewed.
9. Run Codex autoreview for non-trivial diffs.
10. Run GitNexus/AGENTS gate when configured and fresh.
11. Run thermo-nuclear review only for high-risk issues.
12. Attach receipts or write receipt paths into state.
13. Stop after failure; do not start next issue until the gate is fixed or waived by Henry.

## Shared CLI Tester gate

Review/copy the pack example to repo root first:

```bash
cp docs/execution-packs/entity-phase-2-cursor-20260621/.project-gate.example.json .project-gate.json
```

Default CLI Tester command:

```bash
/Users/enterprise/Code/cli-tester/bin/project-test-gate \
  --root /Users/enterprise/Code/entity \
  --config /Users/enterprise/Code/entity/.project-gate.json \
  run <ISSUE_ID>
```

Book review command, when configured/required:

```bash
/Users/enterprise/Code/cli-tester/bin/project-test-gate \
  --root /Users/enterprise/Code/entity \
  --config /Users/enterprise/Code/entity/.project-gate.json \
  book-review <ISSUE_ID>
```

Verify command blocks the next child unless gate + Book review pass:

```bash
/Users/enterprise/Code/cli-tester/bin/project-test-gate \
  --root /Users/enterprise/Code/entity \
  --config /Users/enterprise/Code/entity/.project-gate.json \
  verify <ISSUE_ID>
```

Receipt target:

```text
/Users/enterprise/Code/entity/output/entity-phase-2/test-gate/<ISSUE_ID>.json
/Users/enterprise/Code/entity/output/entity-phase-2/test-gate/<ISSUE_ID>.md
```

Do not copy generic gate-runner code into Entity when shared CLI Tester exists.

## UI proof / video evidence policy

- Cursor Cloud can provide video evidence more easily. Prefer Cloud video for broad UI flows when available.
- Local Cursor should still provide browser/DOM/screenshot evidence for UI-facing work.
- If local video is required, use macOS/Playwright/browser recording explicitly as a separate proof step; do not assume local Cursor records video by default.
- For non-UI/backend/docs issues, video is not required; CLI/test receipts are enough unless the issue says otherwise.
- A screenshot or video must be tied to the issue ID, branch/commit, and proof receipt; do not reuse one visual receipt across multiple child issues.

## Proof commands

Repo-real proof commands for Entity Phase 2:

```bash
bash scripts/proof/entity-phase-2-smoke.sh
cd packages/server && npm run build && npx vitest run
npm run build
```

For UI-facing work, also provide browser/DOM/screenshot proof. Do not claim done from tests alone if UI, route rendering, docs rendering, task workflows, search UI, review/gate UI, notifications UI, or integration/degraded-state display changed.

## Commit / PR review gates

Before merge or merge-ready claim:

- CLI Tester receipt = PASS when `.project-gate.json` is present/reviewed.
- Linear issue is linked.
- Diff scope matches assigned issue.
- Repo `AGENTS.md` / Cursor rules were followed.
- Codex autoreview passed or findings were explicitly resolved/rejected with reasons.
- GitNexus detect-changes / impact check passed when configured and fresh.
- Proof artifacts are attached or linked.
- No unrelated files, secrets, private defaults, banned terms, or receipt gaps.

## Code review ladder

- Codex autoreview is required for non-trivial PRs before merge.
- Thermo-nuclear review is required only for high-risk PRs:
  - runtime/provider contracts
  - authority/receipt logic
  - secret/private-default handling
  - live delivery or dangerous-action paths
  - source→gate→service promotion or drift detection
  - release/proof gates
  - broad diffs spanning multiple parent areas
  - any PR where Codex autoreview flags meaningful concerns
- Routine low-risk leaf changes do not require thermo-nuclear review unless requested.

## Current preflight receipt

```text
# Entity Phase 2 Linear Live Preflight — 2026-06-21

- Pack: `/Users/enterprise/Code/Entity/docs/execution-packs/entity-phase-2-cursor-20260621`
- Live issues fetched: **75/75**
- UUID match: **75/75**
- Canonical title patched/exact after patch: **75/75**
- Title contains source ID: **75/75**
- Parent link match: **75/75**
- Body heading contains source ID: **0/75**
- Body contains source ID anywhere: **0/75**
- Source section slug / Linear URL source key match: **75/75**
- Proof commands present in issue body: **75/75**
- Suspicious banned-term issues: **0**

## Verdict

**FAIL — generated pack remains not approved for Cursor execution.**

Blockers:
- `body_source_key_alignment_not_all_confirmed`

## Sample rows

| Issue | Source | UUID | Parent | Title source | Body heading | Body contains source | URL slug | Proof cmds | Suspicious banned |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `THE-21` | `THE-6.1` | True | True | True | False | False | True | True | 0 |
| `THE-22` | `THE-6.2` | True | True | True | False | False | True | True | 0 |
| `THE-23` | `THE-6.3` | True | True | True | False | False | True | True | 0 |
| `THE-24` | `THE-6.4` | True | True | True | False | False | True | True | 0 |
| `THE-25` | `THE-6.5` | True | True | True | False | False | True | True | 0 |
| `THE-91` | `THE-20.1` | True | True | True | False | False | True | True | 0 |
| `THE-92` | `THE-20.2` | True | True | True | False | False | True | True | 0 |
| `THE-93` | `THE-20.3` | True | True | True | False | False | True | True | 0 |
| `THE-94` | `THE-20.4` | True | True | True | False | False | True | True | 0 |
| `THE-95` | `THE-20.5` | True | True | True | False | False | True | True | 0 |

Full per-issue boolean receipt is in `linear-live-preflight-20260621.json`. Raw live fetch is kept under ignored `output/` for local audit only.

## Repo / proof command receipt

- `bash scripts/proof/entity-phase-2-smoke.sh`: **PASS**
- Server build: PASS
- Vitest: **53 files / 385 tests PASS**
- Root build: PASS
- Branch state at check: `main...origin/main [ahead 1]`
- Dirty state at check: `.gitignore` modified; generated pack/spec mapping untracked.
- Runtime state ignore verified: `.cursor/run-state/` and `output/` are ignored.
```

## Cleanup plan needed before Cursor run

```text
# Entity Phase 2 Linear Cleanup Write Plan — 2026-06-21 (DRAFT, DRY-RUN ONLY)

**Status:** generated as a write proposal. **No Linear writes performed in this run.**

- Source mapping: `docs/specs/entity-phase-2-linear_id_to_source_id.json`
- Drafts directory: `docs/execution-packs/entity-phase-2-cursor-20260621/cleanup-drafts/` (per-issue `<ISSUE>.current.md`, `<ISSUE>.proposed.md`, `<ISSUE>.diff`)

## Why this plan exists

The current preflight blocks Cursor because Linear issue bodies do not contain the child source key (e.g. `THE-6.1`). Titles, parent links, and URL slugs already carry the source identity; bodies need an explicit anchor so Cursor does not infer it. This plan adds an explicit `## Source ID` anchor block to each of the 75 children and preserves all existing acceptance/proof/copy below it.

## Change set

- Title: **unchanged** (already canonical post-patch).
- Body: **prepend anchor block** under the existing `## Parent` section.
- Anchor block always contains:
  - `## Source ID` heading with `THE-X.Y` source id
  - `Parent slice: THE-N` line
  - `Parent section heading: <heading>` when present in parent description, else omitted
  - `## Mapping basis (validated 2026-06-21)` block with linear_id/linear_uuid/parent linkage
- Nothing else in the body is altered. Acceptance criteria, proof commands, blocked-by, and source-coverage sections stay byte-for-byte.

## Write order (when approval lands)

1. Lowest parent first: THE-6, then THE-7, ..., then THE-20. Five children per parent, in source-id order (`.1` → `.5`).
2. For each child: fetch live, verify the proposed anchor block matches the latest mapping, then call `issueUpdate` once.
3. After each write, re-fetch and re-run the body-source-key alignment check.
4. After every parent group, run the project test gate to confirm nothing about local state regressed.
5. After all 75 writes, re-run the validator + full preflight.

## Post-write verification

- Per issue: live body now contains `Source ID` heading + source id string + parent slice id.
- Per issue: `mapping_basis.body_contains_source_id` = true.
- Per issue: `mapping_basis.body_heading_match` = true (Source ID heading is the explicit match).
- Pack-level: preflight `body_source_key_alignment_not_all_confirmed` blocker clears.
- Validator: still PASS.
- Proof command: still PASS (body content changes do not affect smoke gate).

## What this plan deliberately does NOT do

- Does NOT rewrite acceptance criteria or proof commands.
- Does NOT rename titles.
- Does NOT change parent epics.
- Does NOT add new comments, labels, or assignees.
- Does NOT change state.
- Does NOT register cron or scheduler.
- Does NOT touch public dispatch surfaces.

## Rollback strategy

Each `<ISSUE>.current.md` artifact in `cleanup-drafts/` is the literal current body. To roll back, re-set `issueUpdate.description` to the captured current body. The dry-run sets are retained until Henry confirms the final state.

## Approval gating

Before any Linear write:

- Henry explicitly approves this plan in-thread.
- No other agent runs the writes without the same approval.
- All 75 mutations happen in one approved session with a clean run-state file at `docs/execution-packs/entity-phase-2-cursor-20260621/cleanup-drafts/cleanup-write-run-state.json`.

## Dry-run coverage summary

- Children drafted: 75
- Parents involved: 15
- Titles changed in any draft: 0
- Average current body length: 1771 chars
- Average proposed body length: 2255 chars

Per-issue full proposed bodies are under `cleanup-drafts/<THE-XX>.proposed.md`. The plan JSON mirrors this summary.
```

## Active Cursor single-issue prompt

Use this when assigning exactly one issue, after preflight clears:

```text
You are Cursor working in `/Users/enterprise/Code/Entity` on Entity Phase 2.

Take exactly one assigned Linear issue. No self-discovery. Do not choose another issue unless explicitly instructed.

Required preread before editing:
- `AGENTS.md`
- `.cursor/rules/entity-phase-2.mdc`
- `docs/context/entity-phase-2-build-context.md`
- `docs/specs/entity-phase-2-prd-canonical-20260620.md`
- `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
- `docs/specs/entity-phase-2-linear-issue-map-20260620.md`
- `docs/execution-packs/entity-phase-2-cursor-20260621/linear_id_to_source_id.json` (mirrored at `docs/specs/entity-phase-2-linear_id_to_source_id.json`)

Then read the assigned Linear issue body and find its mapping in `docs/execution-packs/entity-phase-2-cursor-20260621/linear_id_to_source_id.json`.

Execution rules:
- Work on the current repo only.
- Keep Entity as the work plane. Do not move deep runtime/admin controls into Entity; Helm owns those.
- ClickClack owns chat primitives; Entity owns work-object context.
- Google Docs/Drive V1 is read/index/link/preview only.
- Paperclip is external competitor/reference only.
- Curacel is pilot/design-customer context only.
- Do not expose secrets.

Done standard:
1. Implement the issue with tests/docs as needed.
2. Run relevant package tests/builds.
3. Run `bash scripts/proof/entity-phase-2-smoke.sh` unless the issue is docs-only and explain why.
4. When `.project-gate.json` has been reviewed/copied into the repo, run CLI Tester with `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/Entity --config /Users/enterprise/Code/Entity/.project-gate.json run <ISSUE_ID>`.
5. For UI work, capture browser/DOM/screenshot proof.
6. Add a Linear proof comment with commands, results, changed files, screenshots/artifacts, and blockers.
7. Update the state file at `.cursor/run-state/entity-phase-2.json`; do not commit it.
8. Do not mark done until proof exists.

Compaction/restart contract:
Before starting or resuming any issue, reread the preread files and inspect git status. Continue from the first incomplete acceptance criterion, not from memory.
```

## Active Cursor bounded-queue / autonomous prompt

Use this only for the approved queue above, after preflight clears:

```text
You are Cursor working in `/Users/enterprise/Code/Entity` on Entity Phase 2.

Approved queue only. No self-discovery. Do not self-discover, reorder across parent epics, or add unrelated issues.

Queue order:
- THE-21
- THE-22
- THE-23
- THE-24
- THE-25
- THE-26
- THE-27
- THE-28
- THE-29
- THE-30
- THE-31
- THE-32
- THE-33
- THE-34
- THE-35
- THE-36
- THE-37
- THE-38
- THE-39
- THE-40
- THE-41
- THE-42
- THE-43
- THE-44
- THE-45
- THE-46
- THE-47
- THE-48
- THE-49
- THE-50
- THE-51
- THE-52
- THE-53
- THE-54
- THE-55
- THE-56
- THE-57
- THE-58
- THE-59
- THE-60
- THE-61
- THE-62
- THE-63
- THE-64
- THE-65
- THE-66
- THE-67
- THE-68
- THE-69
- THE-70
- THE-71
- THE-72
- THE-73
- THE-74
- THE-75
- THE-76
- THE-77
- THE-78
- THE-79
- THE-80
- THE-81
- THE-82
- THE-83
- THE-84
- THE-85
- THE-86
- THE-87
- THE-88
- THE-89
- THE-90
- THE-91
- THE-92
- THE-93
- THE-94
- THE-95

For every issue:
1. Reread `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, and the pack mapping at `docs/execution-packs/entity-phase-2-cursor-20260621/linear_id_to_source_id.json` (mirrored at `docs/specs/entity-phase-2-linear_id_to_source_id.json`).
2. Read the Linear issue body and confirm it matches the mapping.
3. Implement only that issue.
4. Run the smallest relevant tests plus `bash scripts/proof/entity-phase-2-smoke.sh` when applicable.
5. When `.project-gate.json` has been reviewed/copied into the repo, run CLI Tester with `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/Entity --config /Users/enterprise/Code/Entity/.project-gate.json run <ISSUE_ID>`.
6. For UI work, capture browser/DOM/screenshot proof.
7. Comment proof in Linear before moving on.
8. Update the state file at `.cursor/run-state/entity-phase-2.json` after each issue. This file is local-only and must not be committed.

Fail-stop on mismapped/stale Linear issue, wrong repo/branch, failed gate, missing proof, boundary drift, or missing approved queue.
```

## Preflight checklist

```text
# Entity Phase 2 Preflight Checklist

Before saying Cursor can run:

- [ ] Repo is `/Users/enterprise/Code/Entity`.
- [ ] `git status --short --branch` reviewed.
- [ ] Phase 2 context files exist.
- [ ] `docs/specs/entity-phase-2-linear_id_to_source_id.json` exists and maps 75 issues.
- [ ] Linear queue is explicit and approved.
- [ ] Shared gate exists: `scripts/proof/entity-phase-2-smoke.sh`.
- [ ] No project-specific gate runner is being invented when shared CLI Tester/proof script exists.
- [ ] Cursor prompt includes compaction/restart reread contract.
- [ ] Cursor prompt forbids self-discovery.

Optional check-in template — opt-in only:
- Daily check: inspect run-state, Linear issue proof comments, and latest gate output; report blockers only.
```

## End-to-end goal-mode prompt — use only after preflight passes

**Do not use this yet.** This is the Helm-style whole-goal prompt. Use only after the plan says `Cursor-ready: YES`, live Linear body/source-key alignment passes, and `.project-gate.json` includes the reviewed gate config including Book review.

```text
# Cursor goal prompt — Entity Phase 2 end-to-end Linear execution

You are Cursor executing Entity Phase 2 from the approved child-issue queue only.

Repo: /Users/enterprise/Code/entity
Plan: http://100.104.229.62:3000/docs/source/geordi/docs/execution-packs/entity-phase-2-cursor-20260621/plan.md
Raw fallback: http://100.104.229.62:3000/api/file/raw?source=geordi&path=docs/execution-packs/entity-phase-2-cursor-20260621/plan.md

Goal: complete the approved Entity Phase 2 child issue queue end-to-end with tests, receipts, review gates, and visible proof where required.

Before starting:
1. Read the full plan.
2. Confirm Cursor-ready is YES. If not, stop.
3. Confirm `.project-gate.json` exists at repo root and includes Book review gate if required by the plan.
4. Confirm `.cursor/run-state/entity-phase-2.json` exists or create it as local-only runtime state.
5. Confirm every issue in the approved queue has a live Linear body containing its explicit source ID.

Execution loop:
For each issue in the approved queue:
1. Reread the plan, AGENTS.md, `.cursor/rules/entity-phase-2.mdc`, build context, mapping table, gate config, run-state, and live Linear body.
2. Verify this issue is the next approved issue. Do not discover, reorder, skip, or substitute.
3. Verify the live Linear body source ID matches the mapping entry. If not, stop.
4. Create/use an issue-scoped branch.
5. Implement only the issue scope.
6. Run the repo-real proof commands from the plan.
7. Run CLI Tester:
   /Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json run <ISSUE_ID>
8. Run Book review if configured/required:
   /Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json book-review <ISSUE_ID>
9. Run verify:
   /Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json verify <ISSUE_ID>
10. Run Codex autoreview for non-trivial diffs, GitNexus/AGENTS when configured/fresh, and thermo-nuclear only for high-risk changes.
11. For UI-facing work, attach browser/DOM/screenshot proof; use Cursor Cloud video when the task requires video.
12. Confirm the receipt is unique to this issue: issue ID, branch/PR, commit SHA, changed files, commands, and visual proof must match this issue. Do not reuse receipts across child issues.
13. Update `.cursor/run-state/entity-phase-2.json` with issue status, receipt paths, blockers, and next issue.
14. Continue only if all gates are PASS and `nextChildBlocked` is false.

Stop immediately if:
- any proof command fails;
- CLI Tester receipt is missing or FAIL;
- Book review is required but missing/not APPROVED;
- visual proof is missing for UI-facing work;
- issue/source mapping is stale;
- changed files exceed issue scope;
- secrets/private defaults/banned terms appear;
- a receipt appears reused or not tied to this issue;
- merge would be required.

Do not merge unless Henry explicitly authorizes it.
```

## Optional cron/check-in prompt for another session — do not run for now

**DO NOT EXECUTE THIS PROMPT FROM THIS DOC.** This is a handoff template for a separate Book session only when Henry explicitly asks. It is intentionally not registered as a Hermes cron and not part of the current build loop.

Why it is here: if a long autonomous run is already approved, another Book session can use this as a read-only watchdog over receipts/state. The CLI Tester and review gates remain the source of truth.

```text
You are a separate Book session. Henry explicitly asked you to check the Entity Phase 2 run.

Read:
- http://100.104.229.62:3000/docs/source/geordi/docs/execution-packs/entity-phase-2-cursor-20260621/plan.md
- /Users/enterprise/Code/entity/.cursor/run-state/entity-phase-2.json
- latest CLI Tester receipts under /Users/enterprise/Code/entity/output/entity-phase-2/test-gate/

Report only:
- current issue/status
- PASS/FAIL receipts
- blockers
- whether Henry approval is needed

Do not mutate Linear.
Do not patch prompts.
Do not start Cursor work.
Do not register a cron for yourself. If you think one is needed, propose it and wait.
```
