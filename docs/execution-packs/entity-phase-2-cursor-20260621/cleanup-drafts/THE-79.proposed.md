## Parent

THE-17 — ClickClack collaboration


## Source ID

`THE-17.4`

This child issue is anchored to parent slice `THE-17`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-17.4`
- linear_id: `THE-79`
- linear_uuid: `17e405d9-45e9-447d-98d7-66d3d6880a8e`
- parent: `THE-17` (Entity Phase 2 — Integrate ClickClack as degraded-safe collaboration context)
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

Harden docs/files/proof/review/search/task flows so ClickClack outage cannot block core Entity work.

## Acceptance criteria

- [ ] Core APIs work with ClickClack disabled/unavailable.
- [ ] UI shows degraded chat readiness without breaking task/proof/review flows.
- [ ] Tests cover unavailable sidecar/bridge.

## Proof required

- [ ] Degraded-mode tests.
- [ ] Manual/browser proof if UI affected.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-17`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.