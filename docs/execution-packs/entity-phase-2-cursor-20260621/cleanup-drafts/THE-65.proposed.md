## Parent

THE-14 — Permissions, sensitivity, and search


## Source ID

`THE-14.5`

This child issue is anchored to parent slice `THE-14`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-14.5`
- linear_id: `THE-65`
- linear_uuid: `826da3e8-f5d0-4734-8db5-8149fc027e6e`
- parent: `THE-14` (Entity Phase 2 — Build permission, sensitivity, and search envelope)
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

Build UI and tests proving permission filtering happens before snippets/previews render, including permission-change propagation that suppresses previously indexed restricted snippets.

## Acceptance criteria

- [ ] Restricted snippets/previews are suppressed in UI and API.
- [ ] Permission changes invalidate/suppress indexed restricted content.
- [ ] Search UI explains access restriction without leaking content.

## Proof required

- [ ] Leakage attempt tests.
- [ ] Screenshot/DOM proof.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-14`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.