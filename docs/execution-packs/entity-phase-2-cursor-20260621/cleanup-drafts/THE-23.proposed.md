## Parent

THE-6 — Slice 0 inventory


## Source ID

`THE-6.3`

This child issue is anchored to parent slice `THE-6`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-6.3`
- linear_id: `THE-23`
- linear_uuid: `2b1f003a-98fb-4fee-b52e-b6a37b57c0e4`
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

Audit the existing `entity-mc` review path, review packets, task output docs, proof links, and any receipt-like artifacts before changing completion behavior.

## Acceptance criteria

- [ ] Existing review packet shape and submission path are documented.
- [ ] Output artifact/link conventions are documented.
- [ ] Gaps against canonical receipt required fields are listed.

## Proof required

- [ ] Review/proof inventory artifact.
- [ ] At least one current sample shape is captured or described without exposing secrets.
- [ ] Gap report references canonical PRD receipt fields.

## Blocked by

None - can start immediately

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-6`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.