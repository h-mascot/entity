# Entity Phase 2 Build Context — Cursor / Local Agent Pack

**Date:** 2026-06-20
**Repo:** `/Users/enterprise/Code/Entity`
**Linear project:** Entity (`https://linear.app/theheraldlab/project/entity-ae52ac8f59f9`)
**Parent epics:** THE-6 through THE-20

This file converts the Hermes/Book PRD/spec work into repo-native context for Cursor and other local coding agents. Cursor Cloud may not have Hermes skills, so treat this file plus `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, and the linked specs as the operating context.

## Source of truth docs

Read these before taking any Entity Phase 2 Linear issue:

1. `AGENTS.md` — repo-wide build/test/deploy guardrails.
2. `.cursor/rules/entity-phase-2.mdc` — Cursor-specific Phase 2 execution rules.
3. `docs/context/entity-phase-2-build-context.md` — this context pack.
4. `docs/specs/entity-phase-2-prd-canonical-20260620.md` — canonical PRD.
5. `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md` — full generated spec/detail pass.
6. `docs/specs/entity-phase-2-parent-epic-spine-20260620.md` — original 15 parent epics.
7. `docs/specs/entity-phase-2-linear-issue-map-20260620.md` — full Linear parent/child graph after load.

## Product boundaries that must not drift

- Entity is the work plane / workspace OS: orgs, teams, projects, tasks, docs, files, artifacts, receipts, review, gates, activity, search, permissions, notifications, object links, and workspace context.
- Helm owns deep runtime/admin: runtimes, providers, credentials, schedules, tools, health, deploy/admin controls, destructive runtime actions, and secrets. Entity can show status and safe audited light controls only.
- ClickClack owns chat primitives. Entity owns work-object context and must keep docs/files/proof/review working when ClickClack is unavailable.
- Google Docs/Drive V1 is read/index/link/preview only. No default create/update/export/sync/mutation.
- OpenClaw, Hermes, Codex, Claude Code, etc. are runtime/provider-backed agents, not Entity itself.
- **Paperclip is an external competitor/reference only. Do not model it as an Entity internal product, module, layer, or dependency.**
- Curacel is design-customer/pilot context only. Do not turn Entity Phase 2 into a Curacel-specific demo.

## Local build / verification commands

Root commands from `AGENTS.md` and `package.json`:

```bash
npm install
npm run build
cd packages/server && npm run build && npx vitest run
ENTITY_CLICKCLACK_SIDECAR=0 PORT=3000 npm run dev
```

Useful Phase 2 proof wrapper:

```bash
bash scripts/proof/entity-phase-2-smoke.sh
```

For UI-facing work, local/browser verification is mandatory. Do not claim done from tests alone if the task changes UI, route rendering, docs rendering, task workflows, search UI, review/gate UI, notifications UI, or integration/degraded-state display.

## Implementation priority spine

1. Slice 0 current-state inventory and gap report.
2. Org/request scoping seam, workspace hierarchy, principals, task required fields.
3. ActivityEvent structure and canonical receipt/proof-backed completion.
4. Review policy, human gates, separation-of-duties, Task Master routing.
5. Docs/files/artifacts and ObjectRef model.
6. Worktype registry and business-ops overlays.
7. Permissions/RBAC/search envelope.
8. Notifications/inbox and owner accountability.
9. Agent management, Helm boundary, ClickClack, Google Docs connector.
10. Migration/backfill, observability, flags, QA, rollback.

## Ticket execution standard

A Linear issue is not done until it has:

- implementation changes committed locally or in PR;
- relevant tests added/updated;
- command output attached or summarized in Linear;
- screenshots/DOM receipts for UI-facing work;
- degraded/negative-state proof where specified;
- notes for any blocked/unresolved decisions.

Every issue should update its Linear status only after proof exists. If proof cannot run, add the exact blocker and alternative evidence.

## Codebase areas to inspect first

Use search before editing. Likely areas:

- `packages/db/src/index.ts` — SQLite data layer and migrations.
- `packages/server/src/index.ts` — Express routes and task API surface.
- `packages/server/src/**` — domain services, review/taskmaster/clickclack/search/notification code.
- `packages/app/src/**` — frontend UI/workspace/task detail/search/admin surfaces.
- `scripts/` — setup, deploy, proof and smoke scripts.
- `docs/plans/` and `docs/specs/` — prior design/productization context.

## Safety and migration constraints

- Do not overwrite production DBs. Mac source is the source of truth; ada-gateway is runtime mirror.
- New stricter invariants should be feature-flagged or gated so old data remains visible.
- Historical completed tasks without canonical receipts must be marked missing/legacy, not given fake raw receipts.
- Backfill must carry confidence/provenance and be idempotent; do not overwrite human-corrected values.
- Permission filtering must happen before snippets/previews/activity/artifact content render.
- No secret exposure through Helm status, search, activity, or Linear issue bodies.

## Degraded states to test explicitly

- receipt writer failure;
- receipt metadata integrity failure;
- missing evidence;
- pending/rejected human gate;
- self-review attempt;
- unassigned non-drivable task;
- Task Master double-claim race;
- Helm unavailable/stale binding;
- ClickClack unavailable;
- Google auth expired/insufficient/revoked;
- restricted snippet leakage attempt;
- notification delivery failure;
- migration uncertainty.
