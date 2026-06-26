## Parent

THE-9 — Canonical receipts


## Source ID

`THE-9.3`

This child issue is anchored to parent slice `THE-9`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-9.3`
- linear_id: `THE-38`
- linear_uuid: `f642cee2-598e-4f2f-84d7-21f77ba969b7`
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

Handle body write failure, metadata failure after body write, orphan artifact reconciliation, and metadata regeneration without rewriting immutable bodies.

## Acceptance criteria

- [ ] Body write failure leaves task non-done with `receipt_status=failed` and event.
- [ ] Metadata failure after body write leaves task non-done with `receipt_status=integrity_error` and reconciliation queue.
- [ ] Regenerate metadata refuses missing body and never rewrites body.

## Proof required

- [ ] Failure-mode tests.
- [ ] Integrity/orphan fixture.
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