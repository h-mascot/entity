## Parent

THE-7 — Workspace hierarchy and task accountability


## Source ID

`THE-7.3`

This child issue is anchored to parent slice `THE-7`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-7.3`
- linear_id: `THE-28`
- linear_uuid: `381deeb7-abfa-4a3e-8dd2-07b47de070a7`
- parent: `THE-7` (Entity Phase 2 — Establish org-scoped workspace hierarchy and task accountability)
- title basis: exact live canonical title
- url basis: source section slug present in live Linear URL
- body basis: source key now embedded in body (this section)
## Cursor / local-agent context

Repo: `/Users/enterprise/Code/Entity`

Before coding, read:

* `AGENTS.md`
* `.cursor/rules/entity-phase-2.mdc`
* `docs/context/entity-phase-2-build-context.md`
* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* this issue's parent epic and sibling dependencies

Default local proof commands:

```bash
cd /Users/enterprise/Code/Entity
cd packages/server && npm run build && npx vitest run
npm run build
```

For UI-facing work, also run local browser verification and attach screenshot/DOM receipts. Do not mark done until proof is attached to Linear.

## What to build

Upgrade task creation/update rules so initiator and individual owner are explicit, and executable assignment resolves to an individual principal or allowed Task-Master-drivable state.

## Acceptance criteria

- [ ] New tasks require initiator and individual owner.
- [ ] Team ownership is rejected as final task owner.
- [ ] Assignee/executor rules are explicit and tested.

## Proof required

- [ ] Validation tests for missing initiator/owner/team-owner rejection.
- [ ] Backward-compatibility note for legacy tasks.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-7`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.