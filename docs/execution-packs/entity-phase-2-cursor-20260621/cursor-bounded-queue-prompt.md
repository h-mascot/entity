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
5. When `.project-gate.json` has been reviewed/copied into the repo, run CLI Tester — all four steps:

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

6. `run` PASS is machine proof only. Because `bookReview.required` is true, continue only if `book-review` returns APPROVED with `safeToContinue=true` and `verify` leaves `nextChildBlocked=false`.
7. For UI work, capture browser/DOM/screenshot proof.
8. Comment proof in Linear before moving on.
9. Update the state file at `.cursor/run-state/entity-phase-2.json` after each issue. This file is local-only and must not be committed.

Fail-stop on mismapped/stale Linear issue, wrong repo/branch, failed gate, missing Book review approval, blocked `verify`, missing proof, boundary drift, or missing approved queue.

Do not merge without Book/SuperAda verification unless Henry has explicitly authorized Cursor to merge.
