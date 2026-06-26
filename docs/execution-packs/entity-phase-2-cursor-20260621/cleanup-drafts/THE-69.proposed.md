## Parent

THE-15 — Inbox and notifications


## Source ID

`THE-15.4`

This child issue is anchored to parent slice `THE-15`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-15.4`
- linear_id: `THE-69`
- linear_uuid: `9907679d-fae0-482b-89b5-57956491fe3c`
- parent: `THE-15` (Entity Phase 2 — Build Entity inbox, owner accountability, and notification routing)
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

Add inbox/activity UI for notification records, delivery routes, failure/degraded states, policy reasons, and deep links.

## Acceptance criteria

- [ ] UI distinguishes canonical notification state from external channel delivery.
- [ ] Failure/degraded delivery state is visible.
- [ ] Notification detail shows policy reason and object ref.

## Proof required

- [ ] Screenshot/DOM proof.
- [ ] Failed-channel proof.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-15`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.