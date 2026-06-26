## Parent

THE-19 — Migration and backfill


## Source ID

`THE-19.3`

This child issue is anchored to parent slice `THE-19`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-19.3`
- linear_id: `THE-88`
- linear_uuid: `823be3cc-a1f7-46b2-b447-d9bb87039337`
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

Map existing review packets, evidence fields, output artifacts, and activity logs into Phase 2 structured fields where possible.

## Acceptance criteria

- [ ] Review packets map to structured evidence fields where possible.
- [ ] Historical completed tasks without receipts are marked missing_receipt, not given fake raw receipts.
- [ ] Weak activity structure is flagged.

## Proof required

- [ ] Migration fixture tests.
- [ ] Missing_receipt sample.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-19`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.