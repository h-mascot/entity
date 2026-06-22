## Parent

THE-15 — Inbox and notifications


## Source ID

`THE-15.2`

This child issue is anchored to parent slice `THE-15`.

## Mapping basis (validated 2026-06-21)

- source_id: `THE-15.2`
- linear_id: `THE-67`
- linear_uuid: `a7431cf1-8e0d-47c2-9a4b-6291af53202a`
- parent: `THE-15` (Entity Phase 2 — Build Entity inbox, owner accountability, and notification routing)
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

Route notifications to configured channels such as ClickClack, email, Discord, Slack, AgentPush, webhooks, or mocks while preserving Entity as source of truth.

## Acceptance criteria

- [ ] Routing is policy-based by urgency/risk/user preferences/channel availability.
- [ ] External delivery failure is recorded without losing canonical notification.
- [ ] No secrets leak in delivery logs or UI.

## Proof required

- [ ] Routing tests with success/failure fixtures.
- [ ] Delivery failure proof.
- [ ] Build/test output attached.

## Blocked by

THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work.

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

* `docs/specs/entity-phase-2-prd-canonical-20260620.md`
* `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
* Linear parent epic `THE-15`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.