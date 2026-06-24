# Entity Phase 2 Rollback Runbook

Linear issue: `THE-95` / source `THE-20.5`

This runbook defines Phase 2 rollout rollback triggers and actions. Rollback for Phase 2 is staged and evidence-preserving: disable or narrow the affected surface first, keep old tasks visible, preserve raw receipt artifacts and audit trail, and attach proof to the Linear issue before resuming release.

## Scope

Use this runbook for Phase 2 surfaces covered by `THE-91` through `THE-95`:

- Feature flag and staged enforcement rollback.
- Migration rollback and non-fabrication safeguards.
- Receipt writer defect and receipt integrity recovery.
- Task Master runaway loop or unsafe automation.
- Search permission leak or restricted snippet exposure.
- Helm, ClickClack, and Google connector degradation.
- Notification delivery failure.
- Proof, Book review, and release checklist failures.

This runbook does not authorize destructive data restore, broad deletion, Google Docs/Drive mutation, Helm deep admin changes, or fabricated historical receipts.

## Preflight

1. Confirm the source branch and current diff:

```bash
cd /Users/enterprise/Code/entity
git status --short --branch
git diff --stat
```

2. Capture current flag and diagnostics posture from the running server when available:

```bash
curl -s http://localhost:3000/api/phase2/diagnostics
```

3. Preserve the release evidence already generated under ignored `output/` before rerunning proof:

```bash
ls output/entity-phase-2
```

Generated output is review evidence, not a rollback target. Do not delete it to make a gate look clean.

## Rollback Triggers

Start rollback when any of these occur:

- A Phase 2 proof command fails after a release candidate is assembled.
- Book review returns `REQUESTED` or `safeToContinue=false`.
- `npm run proof:phase2:boundary` reports blocking boundary drift.
- Receipt write failures, receipt integrity errors, pending gate ordering errors, or missing evidence appear in diagnostics.
- Search returns restricted snippets/previews/activity/evidence for a denied object.
- Task Master repeatedly claims, nudges, escalates, or reassigns outside policy.
- Helm, ClickClack, Google, or notification degradation hides or blocks core Entity work-plane flows.
- Migration/backfill overwrites a human correction, invents certainty, or hides old tasks.

## Feature Flag Rollback

Prefer flags before code rollback when the defect is isolated to staged Phase 2 enforcement. THE-91 defines these rollout switches in `packages/server/src/phase2-flags.ts`:

| Flag key | Environment override | Rollback use |
|---|---|---|
| `receipt_completion_enforcement` | `ENTITY_PHASE2_RECEIPT_COMPLETION_ENFORCEMENT=0` | Stop strict receipt-before-done enforcement while preserving receipt data and failure records. |
| `review_gate_policy_enforcement` | `ENTITY_PHASE2_REVIEW_GATE_POLICY_ENFORCEMENT=0` | Stop strict review/gate transition enforcement while preserving review packet and gate evidence. |
| `worktype_registry_surface` | `ENTITY_PHASE2_WORKTYPE_REGISTRY_SURFACE=0` | Hide the worktype registry surface without deleting registry data. |
| `migration_enforcement` | `ENTITY_PHASE2_MIGRATION_ENFORCEMENT=0` | Keep migration warnings observation-only and old tasks visible. |
| `search_permission_strictness` | `ENTITY_PHASE2_SEARCH_PERMISSION_STRICTNESS=0` | Fail closed for search strictness defects; do not return snippets until fixed. |
| `taskmaster_automation` | `ENTITY_PHASE2_TASKMASTER_AUTOMATION=0` | Stop Task Master automated claiming/routing while leaving manual task work usable. |

Bulk switches are also supported by `ENTITY_PHASE2_DISABLE_FLAGS`, for example:

```bash
ENTITY_PHASE2_DISABLE_FLAGS=taskmaster_automation,review_gate_policy_enforcement npm run dev
```

After changing flags, restart the affected local server process and verify diagnostics:

```bash
curl -s http://localhost:3000/api/phase2/diagnostics
```

Do not use flag rollback to erase generated artifacts, activity, reviews, gates, or notification records.

## Migration Rollback

For migration/backfill defects, follow the narrower THE-90 migration runbook:

- `docs/runbooks/entity-phase-2-migration-backfill-runbook.md`

Required posture:

- Inventory dry runs require no rollback because they execute no writes.
- Backfill rollback restores only saved `previous_value` fields for affected task IDs.
- Review/evidence mapping rollback removes or supersedes the specific mapping metadata.
- Cleanup correction rollback restores the correction's recorded `previous_value` when a supported task field changed.
- Historical completed tasks without canonical receipts stay `missing_receipt`; no raw receipt is invented.
- Human corrections remain authoritative on reruns.

Re-run the migration dry-run or cleanup queue report after rollback and attach the before/after reports to the issue.

## Receipt Failure Recovery

If receipt writing or integrity checks fail:

1. Stop clean `done` transitions for affected work by disabling `receipt_completion_enforcement` only if the defect blocks unrelated review operations.
2. Keep the task non-done or in explicit failure/integrity state. Do not mark it done manually.
3. Preserve existing receipt markdown bodies and hashes. Never rewrite a raw receipt body to make metadata match.
4. If metadata failed after an immutable body exists, queue or record reconciliation for metadata only.
5. Verify receipt status through diagnostics and focused receipt tests before re-enabling strict enforcement.

Proof commands:

```bash
cd packages/server && npx vitest run src/receipt-writer.test.ts
cd packages/server && npx vitest run src/phase2-observability.test.ts
```

## Task Master Runaway Loop

If Task Master claims, nudges, escalates, or reassigns unexpectedly:

1. Disable automation:

```bash
ENTITY_PHASE2_TASKMASTER_AUTOMATION=0 npm run dev
```

2. Preserve existing activity, comments, notifications, and agent log records.
3. Identify the last safe event for each affected task.
4. Do not delete routing history; supersede bad automation with a corrective activity/comment if needed.
5. Re-run Task Master route/event tests before re-enabling automation.

Proof commands:

```bash
cd packages/server && npx vitest run src/agent/events.test.ts
cd packages/server && npx vitest run src/phase2-flags.test.ts
```

## Search Permission Leak

Treat restricted snippet, preview, activity, evidence, or open-URL leakage as fail-closed:

1. Disable the affected search path or strictness flag so the route fails safely rather than returning content.
2. Keep object existence disclosure at the most restrictive permitted state.
3. Do not attach leaked content to Linear, logs, docs, or proof comments.
4. Rebuild search/index fixtures only after permission filtering is proven before render.

Proof commands:

```bash
cd packages/server && npx vitest run src/routes/search.test.ts
npm run proof:phase2:boundary -- --out output/entity-phase-2/boundary-release-gate/THE-94
```

## Connector Degradation

Connector rollback preserves Entity-owned work flows:

- Helm unavailable or stale binding: render unknown/degraded runtime status, keep docs/files/proof/review/search usable, and route deep runtime actions to Helm.
- ClickClack unavailable: show degraded/unavailable readiness, keep Entity-owned docs/files/proof/review/tasks/search usable, and do not block core flows.
- Google auth expired, insufficient, deleted, or revoked: stop preview/index refresh where unauthorized, preserve linked refs where Entity policy permits, and do not create/update/export/sync Google Docs or Drive content by default.

Proof commands:

```bash
cd packages/server && npx vitest run src/clickclack/proxy.test.ts src/routes/chat-degraded-core-flows.test.ts
cd packages/server && npx vitest run src/google-docs-metadata.test.ts
```

## Notification Failure

Notification rollback keeps Entity inbox/activity as canonical:

1. Preserve the canonical notification record and object reference.
2. Mark external delivery as failed or degraded.
3. Retry only the route that failed; do not duplicate the canonical notification.
4. Keep review requests, gate requests, nudges, escalations, reassignment notices, receipt failures, connector degradation, and policy warnings visible in Entity.

Proof commands:

```bash
cd packages/server && npx vitest run src/routes/notifications.test.ts
cd packages/server && npx vitest run src/phase2-observability.test.ts
```

If a listed focused test file does not exist on the current branch, use the closest colocated notification or observability test and record the substitution in proof.

## Audit Preservation Rules

These rules are mandatory during rollback:

- Preserve raw receipt bodies, content hashes, review packets, human gate decisions, activity events, notification records, migration reports, and generated proof artifacts.
- Supersede bad metadata with corrective records; do not silently rewrite history.
- Keep old tasks visible with compatibility markers.
- Do not fabricate raw receipts for historical work.
- Do not attach restricted content from restricted snippets, connector payloads, runtime config, or customer/private documents to proof comments.

## Release Re-Entry

After rollback or mitigation:

```bash
cd packages/server && npm run build && npx vitest run
npm run build
bash scripts/proof/entity-phase-2-smoke.sh
npm run proof:phase2:first-session -- --out output/entity-phase-2/first-session-spine/THE-93
npm run proof:phase2:boundary -- --out output/entity-phase-2/boundary-release-gate/THE-94
```

Attach command results, generated output paths, Book review receipt, and the completed `docs/runbooks/entity-phase-2-release-checklist.md` staging sample to `THE-95`.
