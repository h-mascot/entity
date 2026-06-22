## Parent

THE-7 — Workspace hierarchy and task accountability


## Source ID

`THE-7.1`

This child issue is anchored to parent slice `THE-7`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-7.1`
- linear_id: `THE-26`
- linear_uuid: `68ac1c1f-b162-4f5c-b941-26db1a41586d`
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

Introduce the foundational org-scoping seam: request-context org binding plus mandatory org predicates for service queries, supporting Org -> Team -> Project -> Task hierarchy.

## Acceptance criteria

- [ ] Org, team, project, and task scoping fields exist or migration path is defined.
- [ ] Service query helpers require org context rather than ad hoc filtering.
- [ ] Cross-org access fails by construction in tests.

## Proof required

- [ ] Schema/migration or feature-flagged data-layer proof.
- [ ] Cross-org denial test.
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