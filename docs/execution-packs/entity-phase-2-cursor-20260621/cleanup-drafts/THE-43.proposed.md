## Parent

THE-10 — Docs/files/artifacts object model


## Source ID

`THE-10.3`

This child issue is anchored to parent slice `THE-10`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-10.3`
- linear_id: `THE-43`
- linear_uuid: `86962b53-040f-4bd3-925b-112bc648fa7e`
- parent: `THE-10` (Entity Phase 2 — Add docs/files/artifacts object model with ObjectRef links)
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

Provide the storage/versioning behavior needed for Entity-native markdown docs, editable curated reports, and immutable raw evidence receipts.

## Acceptance criteria

- [ ] Editable docs/reports are versioned.
- [ ] Immutable raw artifacts are append-only.
- [ ] Storage backend choice is documented without overcommitting if still abstracted.

## Proof required

- [ ] Versioning tests.
- [ ] Storage ADR or implementation note.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-10`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.