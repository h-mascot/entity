## Parent

THE-18 — Google Docs/Drive connector V1


## Source ID

`THE-18.4`

This child issue is anchored to parent slice `THE-18`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-18.4`
- linear_id: `THE-84`
- linear_uuid: `08fb4e8f-4172-4762-90e3-0b59755de2e1`
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

Ensure Google external permissions do not automatically grant Entity visibility and restricted snippets/previews are suppressed before render/index output.

## Acceptance criteria

- [ ] Entity permission evaluator runs before snippets/previews render.
- [ ] Users without access see safe restricted/degraded states.
- [ ] Permission revoked/deleted external doc state does not lose Entity-native proof.

## Proof required

- [ ] Restricted snippet tests.
- [ ] Revoked/deleted fixture.
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