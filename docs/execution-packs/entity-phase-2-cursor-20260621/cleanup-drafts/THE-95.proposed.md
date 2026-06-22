## Parent

THE-20 — Release observability and proof gates


## Source ID

`THE-20.5`

This child issue is anchored to parent slice `THE-20`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-20.5`
- linear_id: `THE-95`
- linear_uuid: `180a8636-f445-4c2d-a8ab-9d2e452d0c57`
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

Document rollout/rollback procedures, release readiness tests, proof attachment standards, and operator checklist for Phase 2 launch.

## Acceptance criteria

- [ ] Runbook covers flags, migration rollback, receipt failure recovery, connector degradation, and notification failures.
- [ ] Release checklist includes all PRD release readiness tests.
- [ ] Docs point to proof scripts and Linear issue map.

## Proof required

- [ ] Rollback runbook committed.
- [ ] Release checklist committed.
- [ ] Smoke/proof command output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-20`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.