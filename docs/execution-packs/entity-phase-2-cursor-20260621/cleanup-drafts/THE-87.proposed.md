## Parent

THE-19 — Migration and backfill


## Source ID

`THE-19.2`

This child issue is anchored to parent slice `THE-19`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-19.2`
- linear_id: `THE-87`
- linear_uuid: `fa05bc27-ffa5-4b58-9cf6-d5e42a696366`
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

Backfill org/team/project, initiator, owner, assignee/executor, and worktype where inferable, with source and confidence metadata.

## Acceptance criteria

- [ ] Inferred fields carry source/confidence.
- [ ] Owner resolves to individual principal where possible.
- [ ] Missing/ambiguous fields create cleanup warning rather than fake value.

## Proof required

- [ ] Before/after fixture.
- [ ] Idempotency test.
- [ ] Rollback notes.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-19`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.