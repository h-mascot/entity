# Entity Phase 2 Canonical Receipt Protocol

## Scope

This protocol applies to completed `entity-mc` task work that creates a canonical raw receipt. The receipt is the immutable proof artifact for the task. Curated summaries, reports, and rollups may reference the raw receipt, but they do not replace it.

## Creation Order

Clean completion follows this order:

1. Build the receipt body from the current task projection plus structured activity events.
2. Write the markdown body to the stable artifact path using exclusive creation.
3. Compute and persist the canonical content hash.
4. Create `EvidenceArtifact` metadata with `artifact_kind=raw_task_receipt` and `mutability_policy=immutable_append_only`.
5. Record a `receipt_created` activity event linking the task and artifact.
6. Move the task to `done` only after receipt body, metadata, hash, and activity linkage exist.

If any required receipt step fails, the task must remain non-done and visibly blocked or degraded.

## Stable Identity And Paths

The stable receipt identity is the artifact id and canonical path:

```text
/artifacts/evidence/<artifact_id>.md
```

Human-friendly aliases such as task, project, or team paths are projections. Moving or renaming a task, project, or team may update the alias, but must not change the canonical artifact path, artifact id, origin task id, content hash, or raw receipt body.

## Immutability

Raw task receipts are immutable append-only.

- The receipt body is written with exclusive creation; an existing body at the target path blocks the write.
- Raw receipt artifacts must use `immutable_append_only`.
- Raw receipt overwrite attempts are rejected rather than silently replacing proof.
- Corrections, retries, disputes, or supersessions create new artifacts/events that reference the original receipt.
- Curated reports are editable/versioned and must clearly reference source raw artifacts.

## Failure States

Body-write failure:

- The task remains in its previous non-done state.
- `receipt_status=failed` is recorded in task metadata.
- A `receipt_failed` activity event records the body-write failure.
- The error is visible for review and owner cleanup.

Metadata failure after body write:

- The task remains in its previous non-done state.
- `receipt_status=integrity_error` is recorded in task metadata.
- The immutable body is treated as an orphaned artifact candidate.
- A reconciliation queue entry records stable path, storage path, content hash, timestamp, and reason.

## Metadata Regeneration

Metadata regeneration is an indexing and recovery operation only.

- It reads the existing immutable receipt body.
- It recomputes metadata and hash from that body.
- It must never rewrite the body.
- It refuses to run when the body is missing.

## Review Usage

Reviewers should inspect the receipt before approving completed work. The task detail UI must show:

- receipt status and link;
- evidence summary and explicit missing-evidence state;
- output links;
- provenance, artifact identity, and content hash;
- integrity or availability degradation;
- raw proof versus curated interpretation.

Missing evidence, missing body, hash mismatch, metadata mismatch, or pending recovery must remain visible and must not be presented as a clean green state.

## Not Done Until Proof

An implementation issue that changes receipt behavior is not complete until it has:

- focused tests for success and degraded/negative paths;
- `bash scripts/proof/entity-phase-2-smoke.sh`;
- `npm run build`;
- `cd packages/server && npm run build && npx vitest run`;
- CLI Tester `request`, `run`, `book-review`, and `verify` receipts;
- Linear proof comment with changed files, commands, exit codes, and receipt paths.
