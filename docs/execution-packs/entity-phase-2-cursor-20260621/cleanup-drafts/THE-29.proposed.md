## Parent

THE-7 — Workspace hierarchy and task accountability


## Source ID

`THE-7.4`

This child issue is anchored to parent slice `THE-7`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-7.4`
- linear_id: `THE-29`
- linear_uuid: `e36c85af-f36f-4f92-9034-67aee9530c2a`
- parent: `THE-7` (Entity Phase 2 — Establish org-scoped workspace hierarchy and task accountability)
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

Update local UI so users can see workspace hierarchy, task ownership, initiator, assignee/executor, and accountability without opening raw metadata.

## Acceptance criteria

- [ ] Workspace shell presents Entity as a work plane, not only a task board.
- [ ] Task detail distinguishes initiator, owner, assignee, executor, submitted_by, reviewer, and approver.
- [ ] Legacy/unknown fields display as explicit unknown/degraded states.

## Proof required

- [ ] Screenshot/DOM proof.
- [ ] Browser verification notes.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-7`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.