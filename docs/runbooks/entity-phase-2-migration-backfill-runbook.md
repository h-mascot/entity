# Entity Phase 2 Migration / Backfill Runbook

**Linear:** `THE-90` / source `THE-19.5`  
**Parent:** `THE-19` - Progressive migration/backfill and cleanup queues  
**Last updated:** 2026-06-24

This runbook covers the Phase 2 migration and backfill surfaces implemented by `THE-86` through `THE-89`. The migration posture is progressive and conservative: old tasks stay visible, inferred fields carry provenance, unresolved uncertainty remains in cleanup queues, and historical proof certainty is never fabricated.

## Scope

The current migration surfaces are:

- `dryRunPhase2MigrationInventory()` / `scripts/entity-phase-2-migration-inventory.mjs` from `THE-86`.
- `backfillTaskHierarchyAndAccountability()` from `THE-87`.
- `mapReviewPacketsAndEvidenceForPhase2()` from `THE-88`.
- `buildMigrationCleanupQueuesForPhase2()` and `applyMigrationCleanupCorrectionForPhase2()` from `THE-89`.
- `/api/migration-cleanup-queues` for cleanup queue listing and task correction writes.

This runbook does not authorize destructive schema rollback, raw receipt fabrication, Google Docs mutation, Helm runtime/admin changes, or broad strict enforcement. Feature-flagged strict enforcement belongs to `THE-91`; until those gates exist, run migration/backfill manually and preserve compatibility markers for old data.

## Preflight

1. Confirm the repo and branch:

```bash
cd /Users/enterprise/Code/entity
git status --short --branch
```

2. Build the DB/server code before running CLI migration proof:

```bash
cd packages/server && npm run build
```

3. Capture an inventory dry run before any apply step:

```bash
node scripts/entity-phase-2-migration-inventory.mjs \
  --json \
  --out output/entity-phase-2/migration-runbook/THE-90-inventory-before.json
```

The inventory report must show `noMutationProof.unchanged=true` and `writeStatementsExecuted=0`.

## Staged Backfill

Run migration in stages. Do not skip directly from inventory to strict enforcement.

1. Dry-run inventory (`THE-86`):

```bash
node scripts/entity-phase-2-migration-inventory.mjs \
  --out output/entity-phase-2/migration-runbook/THE-90-inventory-before.md
```

2. Apply hierarchy/accountability backfill only after reviewing inferred field confidence. This function updates task hierarchy/accountability fields only when a conservative source exists. It records `tasks.metadata.phase2_backfill` with `previous_value`, `inferred_value`, `source`, and `confidence`.

3. Map review packets/evidence (`THE-88`) only as structured metadata. It writes `tasks.metadata.phase2_review_evidence_mapping`; it must not create raw historical receipts.

4. Build cleanup queues (`THE-89`) after the backfill/mapping stages:

```bash
node scripts/entity-phase-2-migration-cleanup-queues.mjs \
  --json \
  --out output/entity-phase-2/migration-runbook/THE-90-cleanup-queues.json
```

5. Resolve only known-safe cleanup items through the correction API or db-layer writer. Human corrections are authoritative and stored in `tasks.metadata.phase2_cleanup_corrections`; supported task fields are updated directly.

6. Re-run the backfill and cleanup queue steps. A successful rerun is idempotent: already-applied inferences are not rewritten, and human-corrected fields are not overwritten.

## Cleanup Queues

Cleanup queues are derived from current rows plus migration metadata. There is no queue table to migrate or roll back. Queue items must expose `old_task_visible=true` so historical work remains accessible while ambiguity is resolved.

Use `include_corrected=true` or `--include-corrected` when auditing resolved cleanup work. Corrected items should appear as `status=corrected` with the correction record attached.

Missing historical receipts may be acknowledged with a cleanup correction on `field_name=acknowledgement`, but that acknowledgement is not a raw receipt and must not create an `evidence_artifacts` row with `artifact_kind='raw_task_receipt'`.

## Rollback

Rollback is narrow and metadata-aware. Do not restore from a stale DB dump unless the entire environment is being recovered.

- Inventory dry runs require no rollback because they perform no writes.
- Hierarchy/accountability backfill rollback uses the saved report: restore only the listed `previous_value` fields for affected task IDs, then remove or supersede `tasks.metadata.phase2_backfill`.
- Review/evidence mapping rollback removes or supersedes `tasks.metadata.phase2_review_evidence_mapping` for affected task IDs.
- Cleanup correction rollback removes or supersedes the matching entry in `tasks.metadata.phase2_cleanup_corrections`; if the correction changed a supported task field, restore the correction's `previous_value`.
- Cleanup queue reports require no rollback because they are derived views.

Never roll back by deleting old tasks, hiding compatibility markers, or synthesizing "original" receipts for old completed work.

## Non-Fabrication Rules

These rules are fail-stop:

- A completed historical task without a canonical raw receipt is marked `missing_receipt`.
- A missing receipt may be queued or acknowledged, but no fake `raw_task_receipt` artifact is created.
- Ambiguous document/artifact links remain cleanup warnings instead of new NativeDocument, ExternalDocumentRef, or EvidenceArtifact records.
- Weak activity rows remain `weak_activity_structure` / `legacy_unknown` rather than being rewritten as certain structured events.
- Missing owner, initiator, project, assignee, team, worktype, and permission mapping remain warnings when no conservative source exists.
- Human corrections are authoritative for reruns and must not be overwritten by backfill inference.

## Feature Flags And Enforcement

Current `THE-90` migration tools are manual/operator-run surfaces. New strict enforcement for newly-created tasks should stay staged until `THE-91` adds feature flags and enforcement gates. Before those gates exist:

- Keep old tasks readable with compatibility markers such as `legacy-unknown`, `legacy-owner`, `unknown`, and `routing_problem`.
- Use cleanup queues to expose ambiguity instead of hiding or blocking historical records.
- Do not turn cleanup warnings into hard runtime failures outside a ticket that explicitly implements staged enforcement.

## Required Proof

Run these commands before considering `THE-90` done:

```bash
rg "THE-90|non-fabrication|rollback|cleanup queues" docs/runbooks/entity-phase-2-migration-backfill-runbook.md
cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts
cd packages/server && npm run build && npx vitest run
npm run build
bash scripts/proof/entity-phase-2-smoke.sh
```

For proof artifacts:

```bash
node scripts/entity-phase-2-migration-inventory.mjs \
  --json \
  --out output/entity-phase-2/migration-runbook/THE-90-inventory.json

node scripts/entity-phase-2-migration-cleanup-queues.mjs \
  --fixture-sample \
  --json \
  --out output/entity-phase-2/migration-runbook/THE-90-cleanup-queues.json
```

Attach the command results and Book review receipt to the Linear issue. UI/browser proof is not required for this ticket unless a UI surface is changed.
