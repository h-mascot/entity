## Parent

THE-6 — Slice 0 inventory


## Source ID

`THE-6.2`

This child issue is anchored to parent slice `THE-6`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-6.2`
- linear_id: `THE-22`
- linear_uuid: `211eb341-4b83-45ea-947e-8ae57fe428ed`
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

Audit existing activity/event/comment/provenance storage and identify how it maps to the target ActivityEvent spine.

## Acceptance criteria

- [ ] Current event sources and payload shapes are documented with file/table references.
- [ ] Target ActivityEvent enum coverage is marked as present, partial, missing, or conflicting.
- [ ] Weak/unstructured provenance risks are called out for migration/backfill.

## Proof required

- [ ] Activity inventory artifact with sample current events.
- [ ] Gap table against PRD ActivityEvent requirements.
- [ ] No production data mutation.

## Blocked by

None - can start immediately

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-6`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.