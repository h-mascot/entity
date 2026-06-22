## Parent

THE-9 — Canonical receipts


## Source ID

`THE-9.2`

This child issue is anchored to parent slice `THE-9`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-9.2`
- linear_id: `THE-37`
- linear_uuid: `781188e7-bbc9-408d-ba95-dce81c54e5f1`
- parent: `THE-9` (Entity Phase 2 — Implement canonical receipt completion contract)
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

Make completed `entity-mc` tasks synchronously write immutable markdown body, compute hash, write metadata, and transition to done in the same clean completion path.

## Acceptance criteria

- [ ] Clean done transition requires receipt body + metadata + hash + activity event.
- [ ] Receipt body includes all canonical required fields from PRD.
- [ ] Completion event and artifact link are recorded.

## Proof required

- [ ] Generated receipt sample.
- [ ] Snapshot test for required fields.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-9`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.