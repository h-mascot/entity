## Parent

THE-14 — Permissions, sensitivity, and search


## Source ID

`THE-14.3`

This child issue is anchored to parent slice `THE-14`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-14.3`
- linear_id: `THE-63`
- linear_uuid: `18238416-f368-46e5-b334-f694c6aa7fea`
- parent: `THE-14` (Entity Phase 2 — Build permission, sensitivity, and search envelope)
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

Wrap tasks, artifacts, activity, docs, external refs, previews, snippets, notifications, and Helm status refs in permission-aware envelopes.

## Acceptance criteria

- [ ] Restricted users see safe placeholder or no object where policy requires.
- [ ] Preview/snippet/activity content is suppressed before render.
- [ ] Connector access and Entity visibility remain separate.

## Proof required

- [ ] Leakage tests.
- [ ] Restricted placeholder UI/API proof.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-14`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.