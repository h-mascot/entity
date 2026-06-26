## Parent

THE-18 — Google Docs/Drive connector V1


## Source ID

`THE-18.1`

This child issue is anchored to parent slice `THE-18`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-18.1`
- linear_id: `THE-81`
- linear_uuid: `330bc20a-4e1e-4a26-93bb-cff436e8ffd2`
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

Model Google Docs/Drive connector authorization state, scopes, expiry, insufficient scope, revoked/deleted refs, and readiness without mutating external docs.

## Acceptance criteria

- [ ] Connector state distinguishes authorized, expired, insufficient, revoked/deleted, unavailable.
- [ ] V1 scopes support read/index/link/preview only.
- [ ] External connector permission and Entity visibility remain separate.

## Proof required

- [ ] Schema/type tests.
- [ ] Auth-state fixtures.
- [ ] Security note on scopes.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-18`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.