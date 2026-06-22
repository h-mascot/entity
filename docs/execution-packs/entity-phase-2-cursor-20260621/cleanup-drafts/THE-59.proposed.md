## Parent

THE-13 — Worktype registry and overlays


## Source ID

`THE-13.4`

This child issue is anchored to parent slice `THE-13`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-13.4`
- linear_id: `THE-59`
- linear_uuid: `703c278d-b07a-4f47-afc7-6f9443bd3a1c`
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

Add people overlay fields for candidate/employee reference, workflow stage, sensitivity class, HR side-effect type, checklist state, and approval requirement.

## Acceptance criteria

- [ ] People overlay validates allowed fields/values.
- [ ] HR sensitivity tightens permissions and can require human gate.
- [ ] Restricted snippets/previews are suppressed.

## Proof required

- [ ] Overlay validation tests.
- [ ] Sensitivity/permission fixture.
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