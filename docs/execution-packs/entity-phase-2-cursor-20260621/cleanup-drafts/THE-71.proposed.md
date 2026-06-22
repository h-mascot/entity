## Parent

THE-16 — Agent Management and Helm runtime binding


## Source ID

`THE-16.1`

This child issue is anchored to parent slice `THE-16`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-16.1`
- linear_id: `THE-71`
- linear_uuid: `04b74623-7a47-405c-aa05-35335a4d6674`
- parent: `THE-16` (Entity Phase 2 — Add Agent Management surface and runtime binding status via Helm)
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

Represent agents as first-class principals separate from Helm-managed runtime/provider records, with runtime_binding_id, provider_type enum, helm_managed, and binding_state.

## Acceptance criteria

- [ ] Agent principal identity is separate from runtime/provider identity.
- [ ] Provider type is generic, not hardcoded to OpenClaw/Hermes.
- [ ] Binding states include bound, unbound, stale, unknown.

## Proof required

- [ ] Schema/type tests.
- [ ] Provider-agnostic fixture.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-16`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.