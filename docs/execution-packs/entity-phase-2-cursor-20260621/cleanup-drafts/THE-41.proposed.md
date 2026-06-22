## Parent

THE-10 — Docs/files/artifacts object model


## Source ID

`THE-10.1`

This child issue is anchored to parent slice `THE-10`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-10.1`
- linear_id: `THE-41`
- linear_uuid: `66755ece-b079-445c-93b6-d60060867fda`
- parent: `THE-10` (Entity Phase 2 — Add docs/files/artifacts object model with ObjectRef links)
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

Separate Entity-owned markdown, externally owned docs, and proof artifacts into distinct object concepts with explicit ObjectRef links.

## Acceptance criteria

- [ ] NativeDocument, ExternalDocumentRef, EvidenceArtifact concepts are distinct in schema/types.
- [ ] ObjectRef uses `{ object_type, object_id, link_role }` wherever objects link.
- [ ] Existing vague file/artifact references have a migration path.

## Proof required

- [ ] Schema/type tests.
- [ ] ObjectRef fixture.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-10`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.