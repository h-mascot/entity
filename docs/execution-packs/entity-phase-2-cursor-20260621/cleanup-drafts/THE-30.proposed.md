## Parent

THE-7 — Workspace hierarchy and task accountability


## Source ID

`THE-7.5`

This child issue is anchored to parent slice `THE-7`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-7.5`
- linear_id: `THE-30`
- linear_uuid: `5e02025a-95ee-4db4-a8de-e2f1158c71ff`
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

Add non-destructive backfill for org/team/project/initiator/owner/assignee fields with confidence/provenance and cleanup warnings for unresolved data.

## Acceptance criteria

- [ ] Backfill is dry-runnable and idempotent.
- [ ] Inferred fields record source and confidence.
- [ ] Missing owner/initiator/project creates cleanup warning, not fake certainty.

## Proof required

- [ ] Dry-run report sample.
- [ ] Before/after fixture tests.
- [ ] Rollback/non-destructive notes.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-7`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.