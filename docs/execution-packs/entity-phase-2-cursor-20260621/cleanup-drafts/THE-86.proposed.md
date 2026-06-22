## Parent

THE-19 — Migration and backfill


## Source ID

`THE-19.1`

This child issue is anchored to parent slice `THE-19`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-19.1`
- linear_id: `THE-86`
- linear_uuid: `bf3fda7c-c5ef-47bb-9995-5c51b9ac5d86`
- parent: `THE-19` (Entity Phase 2 — Progressive migration/backfill and cleanup queues)
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

Create a dry-run inventory that counts existing tasks, projects, docs, review packets, activity logs, artifacts, and gaps before any backfill mutation.

## Acceptance criteria

- [ ] Dry run produces counts and gap categories.
- [ ] Report identifies missing owner/initiator/project/assignee/receipt/worktype/activity/permission gaps.
- [ ] No data mutation in dry-run mode.

## Proof required

- [ ] Dry-run report sample.
- [ ] Command documented.
- [ ] No mutation proof.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-19`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.