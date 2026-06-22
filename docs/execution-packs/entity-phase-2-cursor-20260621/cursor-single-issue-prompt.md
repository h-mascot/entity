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
4. When `.project-gate.json` has been reviewed/copied into the repo, run CLI Tester — all four steps:

```bash
/Users/enterprise/Code/cli-tester/bin/project-test-gate \
  --root /Users/enterprise/Code/entity \
  --config /Users/enterprise/Code/entity/.project-gate.json \
  request <ISSUE_ID> <branch-or-pr>

/Users/enterprise/Code/cli-tester/bin/project-test-gate \
  --root /Users/enterprise/Code/entity \
  --config /Users/enterprise/Code/entity/.project-gate.json \
  run <ISSUE_ID>

/Users/enterprise/Code/cli-tester/bin/project-test-gate \
  --root /Users/enterprise/Code/entity \
  --config /Users/enterprise/Code/entity/.project-gate.json \
  book-review <ISSUE_ID>

/Users/enterprise/Code/cli-tester/bin/project-test-gate \
  --root /Users/enterprise/Code/entity \
  --config /Users/enterprise/Code/entity/.project-gate.json \
  verify <ISSUE_ID>
```

5. `run` PASS is machine proof only. Because `bookReview.required` is true, this issue is only considered done if `book-review` returns APPROVED with `safeToContinue=true` and `verify` leaves `nextChildBlocked=false`.
6. For UI work, capture browser/DOM/screenshot proof.
7. Comment proof in Linear before considering this issue complete.
8. Update the state file at `.cursor/run-state/entity-phase-2.json` after this issue. This file is local-only and must not be committed.
9. Stop after this issue. Do not proceed to another issue.

Fail-stop on mismapped/stale Linear issue, wrong repo/branch, failed gate, missing Book review approval, blocked `verify`, missing proof, or boundary drift.

Do not merge without Book/SuperAda verification unless Henry has explicitly authorized Cursor to merge.

Compaction/restart contract:
Before starting or resuming any issue, reread the preread files and inspect git status. Continue from the first incomplete acceptance criterion, not from memory.
