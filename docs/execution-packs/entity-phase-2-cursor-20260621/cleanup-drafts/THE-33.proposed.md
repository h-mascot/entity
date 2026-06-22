## Parent

THE-8 — ActivityEvent spine


## Source ID

`THE-8.3`

This child issue is anchored to parent slice `THE-8`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-8.3`
- linear_id: `THE-33`
- linear_uuid: `621444e2-e457-4a1d-9de3-aefa10bc5eab`
- parent: `THE-8` (Entity Phase 2 — Structure ActivityEvent spine and migrate current event payloads)
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

Provide a migration/backfill path from current unstructured or weak activity logs into ActivityEvent records without inventing certainty.

## Acceptance criteria

- [ ] Migration maps known legacy events with confidence/provenance.
- [ ] Weak events are flagged, not rewritten as certain.
- [ ] Old tasks remain visible and usable.

## Proof required

- [ ] Dry-run migration report.
- [ ] Legacy event fixture tests.
- [ ] Rollback/idempotency proof.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-8`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.