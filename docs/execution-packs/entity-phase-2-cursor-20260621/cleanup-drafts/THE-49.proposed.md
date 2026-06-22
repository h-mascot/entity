## Parent

THE-11 — Review policy and gates


## Source ID

`THE-11.4`

This child issue is anchored to parent slice `THE-11`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-11.4`
- linear_id: `THE-49`
- linear_uuid: `78d7aeae-aea4-4ec5-997d-17e33a0b8429`
- parent: `THE-11` (Entity Phase 2 — Implement review policy, human gates, and separation-of-duties)
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

Add accept/request-fix review actions, human gate request/approve/reject, eligibility enforcement, and completion ordering where required gates resolve before done.

## Acceptance criteria

- [ ] Review controls require eligible reviewer.
- [ ] Human gate requires eligible human approver.
- [ ] Required unresolved gate blocks done and receipt writes only after final done transition.

## Proof required

- [ ] Review/gate API tests.
- [ ] Gate-before-done test.
- [ ] Receipt contains resolved gate/review decisions only.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-11`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.