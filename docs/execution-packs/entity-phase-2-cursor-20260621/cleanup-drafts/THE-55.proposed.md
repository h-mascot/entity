## Parent

THE-12 — Task Master routing


## Source ID

`THE-12.5`

This child issue is anchored to parent slice `THE-12`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-12.5`
- linear_id: `THE-55`
- linear_uuid: `82526983-e9aa-481a-9495-3da791e73109`
- parent: `THE-12` (Entity Phase 2 — Implement Task Master routing, nudges, escalation, and reassignment)
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

Expose unassigned drivable, routing problem, claimed, nudged, owner escalated, auto-reassigned, and excluded states in UI with policy reasons.

## Acceptance criteria

- [ ] Task detail/board shows routing state and reason.
- [ ] Routing problem is visible and actionable.
- [ ] Docs explain Task Master is not universal executor.

## Proof required

- [ ] Screenshot/DOM proof.
- [ ] Routing matrix docs.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-12`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.