## Parent

THE-20 — Release observability and proof gates


## Source ID

`THE-20.3`

This child issue is anchored to parent slice `THE-20`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-20.3`
- linear_id: `THE-93`
- linear_uuid: `f64b3743-eeca-46ed-a5ff-56feacc6621e`
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

Create an end-to-end proof path: connect/read indexed context, add/register one Helm-backed agent binding, create business-ops task, complete with canonical receipt, review it, inspect proof/search/activity.

## Acceptance criteria

- [ ] E2E spine covers buyer first-session flow from PRD.
- [ ] Proof captures receipt, review, search, activity, degraded-safe behavior.
- [ ] Suite is runnable locally with documented setup.

## Proof required

- [ ] E2E/proof script output.
- [ ] Screenshots/DOM receipts where UI involved.
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