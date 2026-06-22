## Parent

THE-13 — Worktype registry and overlays


## Source ID

`THE-13.5`

This child issue is anchored to parent slice `THE-13`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-13.5`
- linear_id: `THE-60`
- linear_uuid: `b6de5e43-1b40-48a3-8eee-cf70bbb33a57`
- parent: `THE-13` (Entity Phase 2 — Add worktype registry and business-ops overlays)
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

Render domain-appropriate sales/CS/people/business-ops fields without forcing engineering/spec language, and expose declared filter fields safely.

## Acceptance criteria

- [ ] Task create/detail supports worktype overlays.
- [ ] Search/filter UI includes declared indexable overlay fields.
- [ ] Docs explain registry, overlay versioning, and migration behavior.

## Proof required

- [ ] Screenshot/DOM proof.
- [ ] Docs/ADR.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-13`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.