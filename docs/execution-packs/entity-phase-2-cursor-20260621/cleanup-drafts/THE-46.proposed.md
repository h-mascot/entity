## Parent

THE-11 — Review policy and gates


## Source ID

`THE-11.1`

This child issue is anchored to parent slice `THE-11`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-11.1`
- linear_id: `THE-46`
- linear_uuid: `bd02ef70-1ed4-465a-981e-1b7b44e4ceb2`
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

Model review/human-gate policy inputs including worktype, risk, evidence quality, agent trust, owner flags, and ExternalSideEffect records.

## Acceptance criteria

- [ ] Policy inputs include workspace/org/team/project/worktype/task/risk/trust layers.
- [ ] ExternalSideEffect includes type, target system, risk/sensitivity, required gate, requested actor, resolution state.
- [ ] Schema supports human gate and review as separate concepts.

## Proof required

- [ ] Schema/type tests.
- [ ] Policy input fixtures.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-11`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.