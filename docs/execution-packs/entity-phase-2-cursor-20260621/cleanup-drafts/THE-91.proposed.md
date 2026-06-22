## Parent

THE-20 — Release observability and proof gates


## Source ID

`THE-20.1`

This child issue is anchored to parent slice `THE-20`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-20.1`
- linear_id: `THE-91`
- linear_uuid: `415cecb1-b635-4111-b452-e61c743e3081`
- parent: `THE-20` (Entity Phase 2 — Release observability, feature flags, proof gates, and rollback)
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

Gate Phase 2 strict invariants and surfaces behind flags so new tasks can enforce stricter behavior while legacy data remains usable.

## Acceptance criteria

- [ ] Flags cover receipt completion, review/gate policy, worktype registry, migration enforcement, search/permission strictness where needed.
- [ ] Legacy tasks remain visible.
- [ ] Flag state is visible in diagnostics.

## Proof required

- [ ] Feature flag tests/proof.
- [ ] Legacy compatibility fixture.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-20`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.