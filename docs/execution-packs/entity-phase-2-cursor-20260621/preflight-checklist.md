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
