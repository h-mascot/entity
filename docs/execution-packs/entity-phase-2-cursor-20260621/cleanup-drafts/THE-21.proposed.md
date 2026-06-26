## Parent

THE-6 — Slice 0 inventory


## Source ID

`THE-6.1`

This child issue is anchored to parent slice `THE-6`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-6.1`
- linear_id: `THE-21`
- linear_uuid: `4b1fec2f-bc77-4a85-a5ed-ba2eb26971a1`
- parent: `THE-6` (Entity Phase 2 — Slice 0: Inventory current Entity schema, activity log, and review packet shape)
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

Produce a current-state inventory of Entity's SQLite/data model, task fields, project/team fields, metadata blobs, and migration seams. This is read-only planning work that downstream schema tickets depend on.

## Acceptance criteria

- [ ] Inventory lists all current task/project/team/org/principal-like tables and fields with file references.
- [ ] Existing metadata/json blobs are classified by purpose and migration risk.
- [ ] Required Phase 2 fields from the PRD are mapped to existing, missing, ambiguous, or obsolete fields.

## Proof required

- [ ] Markdown inventory committed under `docs/context/` or `docs/plans/`.
- [ ] Commands/file reads used for inventory are listed.
- [ ] No source schema changes made in this inventory ticket.

## Blocked by

None - can start immediately

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-6`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.