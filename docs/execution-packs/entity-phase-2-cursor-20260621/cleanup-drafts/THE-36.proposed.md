## Parent

THE-9 — Canonical receipts


## Source ID

`THE-9.1`

This child issue is anchored to parent slice `THE-9`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-9.1`
- linear_id: `THE-36`
- linear_uuid: `5fc06a20-b93c-4109-9dd3-c89463ca0d8b`
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

Define EvidenceArtifact/receipt metadata for immutable canonical receipts: artifact id, stable path/alias, hash, mutability, origin task, integrity state, and availability.

## Acceptance criteria

- [ ] Receipt metadata persists stable artifact identity and origin task linkage.
- [ ] Human-friendly path changes do not break canonical identity.
- [ ] Raw receipt mutability policy is explicit.

## Proof required

- [ ] Schema/data tests.
- [ ] Fixture showing stable id/path/hash metadata.
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