## Parent

THE-12 — Task Master routing


## Source ID

`THE-12.2`

This child issue is anchored to parent slice `THE-12`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-12.2`
- linear_id: `THE-52`
- linear_uuid: `75244c84-5e83-44f1-8915-dbacb1e22cce`
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

Allow Task Master to claim unassigned policy-drivable work while preserving original unassigned state and preventing double claims/races.

## Acceptance criteria

- [ ] Claim creates structured ActivityEvent.
- [ ] Current executor becomes Task Master only for allowed work.
- [ ] Double-claim race is handled deterministically.

## Proof required

- [ ] Claim API/service tests.
- [ ] Double-claim race test.
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