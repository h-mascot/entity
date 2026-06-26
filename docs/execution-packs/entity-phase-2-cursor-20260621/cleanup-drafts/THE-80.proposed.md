## Parent

THE-17 — ClickClack collaboration


## Source ID

`THE-17.5`

This child issue is anchored to parent slice `THE-17`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-17.5`
- linear_id: `THE-80`
- linear_uuid: `fa966ae9-5bfe-4d15-853f-244a0c588232`
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

Update docs/tests around ClickClack sidecar/proxy usage, degraded behavior, and integration smoke commands.

## Acceptance criteria

- [ ] Docs explain optional sidecar and local/cloud differences.
- [ ] Smoke tests cover live/mock and degraded routes.
- [ ] No Entity proof/review dependency on chat availability.

## Proof required

- [ ] Docs committed.
- [ ] ClickClack smoke/test output where available.
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