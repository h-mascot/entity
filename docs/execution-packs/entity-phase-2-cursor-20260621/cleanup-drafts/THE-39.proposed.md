## Parent

THE-9 — Canonical receipts


## Source ID

`THE-9.4`

This child issue is anchored to parent slice `THE-9`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-9.4`
- linear_id: `THE-39`
- linear_uuid: `b515af23-29fc-4bf5-8c42-a3bb976088a1`
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

Expose canonical receipt status, evidence summary, missing evidence, output links, provenance, integrity state, and raw-vs-curated distinction in task detail.

## Acceptance criteria

- [ ] Task detail shows receipt status and link when present.
- [ ] Missing evidence and integrity/degraded states are visible.
- [ ] Raw proof and curated interpretation are visually distinct.

## Proof required

- [ ] Screenshot/DOM proof.
- [ ] Missing-evidence proof.
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