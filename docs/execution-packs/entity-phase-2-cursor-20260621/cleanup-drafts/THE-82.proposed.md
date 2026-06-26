## Parent

THE-18 — Google Docs/Drive connector V1


## Source ID

`THE-18.2`

This child issue is anchored to parent slice `THE-18`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-18.2`
- linear_id: `THE-82`
- linear_uuid: `48c8c232-fbc1-403f-9a22-3808c6f3ea4c`
- parent: `THE-18` (Entity Phase 2 — Implement Google Docs/Drive connector V1 read-only posture)
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

Add service/API support for read/list/search metadata and open external doc references, with no create/update/export/sync mutation path by default.

## Acceptance criteria

- [ ] Metadata read/list/search works with mocked or live authorized path.
- [ ] No write/create/update/export/sync endpoint exists in V1 default path.
- [ ] Expired/insufficient auth returns degraded state.

## Proof required

- [ ] Read-only API tests.
- [ ] No-mutation negative tests.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-18`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.