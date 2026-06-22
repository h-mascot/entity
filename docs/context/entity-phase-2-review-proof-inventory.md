# Entity Phase 2 Review, Proof, and Receipt-Like Inventory

**Linear issue:** `THE-23` / source `THE-6.3`
**Date:** 2026-06-23
**Scope:** Read-only inventory of current review packets, review submission/completion paths, task output evidence conventions, plugin proof bundles, and receipt-like gaps against the Phase 2 canonical receipt model.

This document is a Slice 0 input for later receipt, review, document/artifact, migration, search, and release-gate tickets. It does not change source schema or production data.

## Sources Inspected

- `packages/server/src/agent/review-policy.ts` - review metadata parsing, review packet validation, output/evidence scoring, artifact reference extraction, and review completion checks.
- `packages/server/src/agent/review-policy.test.ts` - current review packet fixtures and accepted/rejected review lifecycle tests.
- `packages/server/src/index.ts` - task create/update/move routes, review transition gates, completion validation, output normalization, and activity writes.
- `packages/server/src/task-output-links.ts` - output link normalization into Entity docs URLs.
- `packages/server/src/agent/events.ts` and `packages/server/src/agent/tools.ts` - Task Master review hygiene, output candidate discovery, artifact validation, and review feedback notes.
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` - task detail review panel, output link rendering, linked evidence tab, and review decision mutation.
- `packages/app/src/components/mission-control/TaskCard.tsx`, `packages/app/src/components/mission-control/MCTaskCard.tsx`, and `packages/app/src/hooks/useTaskBoard.ts` - board-level review/output indicators and output-link counts.
- `packages/server/src/swarm/types.ts`, `packages/server/src/swarm/db.ts`, `packages/server/src/swarm/routes.ts`, `packages/server/src/swarm/dispatcher.ts`, and related tests - plugin-owned job/proof records.
- `packages/db/src/index.ts` - current task, activity, comment, history, and output storage seams.
- `docs/specs/entity-phase-2-prd-canonical-20260620.md` and `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md` - target receipt, review, EvidenceArtifact, and migration requirements.
- `docs/plans/2026-06-19-self-driving-taskmaster-design.md` - prior design note for current review/proof metadata conventions.

Commands and searches used:

```bash
linear_api.py get-issue THE-23
linear_api.py get-issue THE-6
rg "review_packet|reviewPacket|review_brief|reviewBrief|done_criteria|doneCriteria|output_artifact|outputArtifact" .
rg "review_decision|submitted_by|reviewer|review_owner|review_type|review_class|risk_level" packages
rg "receipt|proof|evidence|artifact" packages/server/src
rg "entity-mc|review\\.sh|review packet|proof artifact|receipt-like|receipt" .
rg "CREATE TABLE IF NOT EXISTS tasks|output\\s+TEXT|metadata\\s+TEXT|task_history|task_comments|activities" packages/db/src/index.ts
```

## Current Review Packet Model

Current review state is stored on `tasks.metadata` as JSON text. There is no `reviews` table, no `review_packets` table, and no first-class `EvidenceArtifact` table for review packets.

The compatibility shape is split across current code and prior design:

- Current server validation accepts `metadata.review_packet` or `metadata.review_brief`.
- Current server validation requires `review_type`/`review_class`, `reviewer`/`review_owner` for non-auto review, `risk_level`, `requested_outcome`, `evidence`, and `done_criteria` or `validation_checklist`.
- Prior design describes proof as `metadata.review_packet = { evidence, output_artifact, done_criteria[] }`.
- In practice, output artifacts are usually carried by the top-level `tasks.output` string and linked docs paths, not only by `review_packet.output_artifact`.

Sanitized current packet shape:

```json
{
  "review_type": "peer",
  "reviewer": "Book",
  "henry_required": false,
  "risk_level": "low",
  "submitted_by": "Ada",
  "review_packet": {
    "requested_outcome": "Validate review hardening patch",
    "evidence": "Patch touches review policy and task routes; tests were run.",
    "done_criteria": [
      "wrong reviewer blocked",
      "missing packet blocked",
      "accepted review can close"
    ]
  },
  "review_decision": "accepted",
  "reviewed_by": "Book",
  "review_note": "Verified packet, evidence, tests, and independent reviewer route."
}
```

Accepted aliases and compatibility fields:

| Concept | Current field(s) | Notes |
|---|---|---|
| Review class/type | `review_type`, `review_class` | Must be `henry`, `peer`, or `auto` in server validation. |
| Reviewer | `reviewer`, `review_owner` | Required for non-auto review. String display identity, not principal ID. |
| Human-required flag | `henry_required`, `requires_henry` | Current legacy human gate signal, not a general Phase 2 human-gate model. |
| Risk | `risk_level` | Must be `low`, `medium`, or `high`; high risk requires the human-required flag unless delegated. |
| Submitted by | `submitted_by`, `producer`, `created_by` | Used only for separation-of-duties completion validation. Not a principal ref. |
| Review packet | `review_packet`, `review_brief` | Must be object-like; no separate immutable artifact identity. |
| Requested outcome | `review_packet.requested_outcome`, sometimes `outcome` in UI summary | Server requires `requested_outcome`. |
| Evidence | `review_packet.evidence` | Server requires non-empty evidence text. |
| Done criteria | `review_packet.done_criteria`, `review_packet.validation_checklist` | Array or non-empty string accepted. |
| Review decision | `review_decision` | Completion requires `accepted`; UI also emits `needs_fix` and `rejected`, while server's completion validator accepts known values but only closes on `accepted`. |
| Review note | `review_note` | Completion requires a substantive note for non-auto review. |

## Current Submission and Completion Path

### Moving into review

Task routes in `packages/server/src/index.ts` call `shouldValidateReviewEntryOnTransition(previousColumn, nextColumn)` when a task enters `review` from a non-review, non-done state.

The route then:

1. Parses `metadata` through `validateReviewEntry()`.
2. Rejects the transition if review type, reviewer, risk, or packet fields are missing.
3. Runs `taskAgent.assessReview()` against the task preview.
4. Rejects invalid output/evidence before allowing the task into `review`.
5. Writes a generic `task_updated` or `task_moved` activity row after the task changes.
6. Starts the Task Master review hygiene hook when configured.

This gives Entity useful early validation, but the validated packet remains mutable task metadata.

### Completing review-gated work

When a task moves to `done`, the server checks `isReviewGatedTask(metadata)`. Tasks without review signals can move to done without review validation. Review-gated tasks must pass `validateReviewCompletion()`.

Current completion validation requires:

- explicit reviewer actor from request context;
- valid review type;
- accepted review decision;
- required human reviewer if `henry_required` is true unless delegated;
- actor matches reviewer or is the human override path;
- reviewer is not the task assignee or `submitted_by`;
- substantive review note for non-auto review;
- auto review has accepted decision plus review note or explicit chat-delivery proof.

Current completion behavior does **not**:

- write receipt metadata;
- write a markdown receipt body;
- compute or store a receipt hash;
- record `receipt_created` or `receipt_failed`;
- atomically link completion, receipt, review, and evidence artifacts.

## Current Output Artifact and Link Conventions

Task output is a top-level `tasks.output` text column added by migration, also mirrored through `metadata.output` in some frontend compatibility paths.

Current conventions:

- `normalizeTaskOutputLinks()` rewrites supported local docs/file roots into Entity docs URLs.
- Supported output roots include `output`, `memory`, `workspace`, `projects`, and a few cross-agent output roots.
- `TaskDetailPanel` parses output text for links and labels them as `Entity docs link` or `External link`.
- `TaskDetailPanel` has a `Linked Evidence` tab sourced from parsed output links.
- `useTaskBoard()` derives `output_links_count` by regex counting URLs, docs routes, local docs roots, and local absolute paths.
- `TaskAgent` discovers output candidates from the current task output, description, task activity descriptions/metadata, and task comments.
- `TaskAgent` can auto-attach exactly one reviewable output candidate into `tasks.output`.

Output artifacts are therefore string references and link conventions, not stable artifact records. They can point at Entity docs routes, filesystem-like paths, URLs, source-control references, or free-form text.

Sanitized output examples:

```text
Changed packages/server/src/agent/events.ts and output/review-hygiene.md. Tests passed and the patch is ready.
```

```text
Artifacts: output/current-review.md, workspace/reviews/evidence.txt, commit abc1234.
```

## Current Artifact Validation

`packages/server/src/agent/review-policy.ts` extracts artifact references from output text using:

- URLs;
- `output/`, `memory/`, and `workspace/` style docs paths;
- file paths;
- source-control references such as commits and pull requests.

`packages/server/src/agent/tools.ts` then attempts to validate references:

- source-control references are accepted as accessible;
- URLs are checked via `HEAD`, falling back to `GET` for unsupported methods;
- docs/local paths are resolved under workspace or configured docs roots;
- missing, empty, dead URL, and outside-root files become blocking or degraded evidence states;
- unknown references can remain reviewable enough to proceed, depending on task type and score.

This is useful proof hygiene, but it is not an immutable artifact model. Validation results are not stored as first-class evidence records and can change if the referenced file or URL changes later.

## Current Review Hygiene Path

Task Master review hooks live in `packages/server/src/agent/events.ts` and `packages/server/src/agent/index.ts`.

Current behavior:

- `handleTaskMovedToReview()` runs review hygiene when a task enters `review`.
- `onOutputMissing()` discovers output candidates and can auto-attach a single reviewable candidate.
- Invalid review output moves a review task back to `doing`, adds a note, notifies the assignee, and records operational log actions.
- Weak output adds a note and notification but does not move the task.
- Actions are written to `agent_log` via `writeAgentLog()`.
- User-visible notes are written to `task_comments`.
- Activity rows are generic `task_updated`, `task_moved`, `task_comment`, or `message_sent` records.

Current review hygiene produces useful provenance fragments, but not a single receipt-ready source of truth.

## Current UI Review and Proof Surface

`TaskDetailPanel` renders a review panel based directly on `metadataRecord`.

Visible fields:

- reviewer or human-required reviewer label;
- review decision;
- review type and risk;
- reviewed-by;
- packet summary;
- review note;
- buttons for `Accept review`, `Accept + Done`, `Needs fix`, and `Reject`.

The panel shows `Packet present` if any review metadata signal exists and `Needs packet` otherwise. It summarizes packet outcome and done criteria count, but does not render the full packet, immutable receipt metadata, hash, provenance event range, or stable artifact identity.

Task cards show review summaries like `Review: <reviewer> / <decision>` for review/done tasks, and output badges based on output presence/link count.

## Current Plugin Proof Bundle Surface

The current swarm plugin has separate proof storage:

| Table/API | Current fields | Fit for Phase 2 evidence |
|---|---|---|
| `swarm_jobs` | `id`, optional `task_id`, title/spec/repo/branch/provider/status, run handle, feedback, timestamps | Useful execution/job source, but plugin-owned and not the universal Task model. |
| `swarm_proofs` | `id`, `job_id`, provider, commit SHA, branch, build log, test result/output, screenshots JSON, artifacts JSON, duration, proof type/ref, created time | Useful proof bundle, but not a Phase 2 `EvidenceArtifact` and not tied to receipt metadata/hash/mutability. |
| `POST /api/swarm/jobs/:id/proof` | Appends proof record and moves running/dispatched jobs to `proof` | Proof append path exists, but it does not create task activity artifact links or receipts. |
| `GET /api/swarm/jobs/:id/proofs` | Reads proof rows | Readback exists, but no permission envelope or canonical work-object link. |

Sanitized current proof shape:

```json
{
  "provider": "symphony",
  "commit_sha": "abc123",
  "branch": "feat/example",
  "build_log": "npm run build: exit 0",
  "test_result": "pass",
  "test_output": "42 tests passed, 0 failed",
  "screenshots": ["screenshot.png"],
  "artifacts": {
    "pr_url": "https://example.invalid/org/repo/pull/123"
  },
  "duration_sec": 180
}
```

Swarm proof bundles are the closest current first-class proof rows, but they are not used by Mission Control review packets or task completion receipts.

## Current Receipt-Like Coverage

| Receipt-like need | Current coverage | Source |
|---|---|---|
| Task identity | Present | `tasks.id`, `tasks.name`, task routes/UI. |
| Task status transition | Partial | `tasks.column`, generic activity rows. |
| Submitted by | Partial | `metadata.submitted_by`, `producer`, `created_by` strings. |
| Reviewer | Partial | `metadata.reviewer`, `review_owner`, `reviewed_by`. |
| Evidence summary | Partial | `review_packet.evidence`, `tasks.output`, comments/activity text. |
| Done criteria | Present in packet | `review_packet.done_criteria` or `validation_checklist`. |
| Output artifact links | Partial | `tasks.output` string links, attachments metadata, swarm proofs. |
| Review decision | Partial | `metadata.review_decision`, `review_note`, UI metadata patch. |
| Human gate | Legacy/specific | `henry_required`/`requires_henry`; no general human-gate object. |
| Routing/execution history | Partial/fractured | `activities`, `agent_log`, `task_history`, comments, swarm job status. |
| Artifact identity | Missing for task receipts | No receipt/EvidenceArtifact ID for Mission Control task proof. |
| Content hash | Missing | No hash for review packets or task output. |
| Mutability policy | Missing | Review packets and output text are mutable task fields. |
| Receipt body | Missing | No canonical markdown receipt body. |
| Integrity state | Missing | No receipt integrity state. |
| Receipt failure | Missing | Completion validation errors are returned but no durable receipt failure state/event exists. |

## Gap Against Canonical Receipt Fields

The canonical PRD requires a minimal receipt to include task identity, org/team/project, worktype, created_by, initiator, owner, assignee, executor, submitted_by, timestamps, status transition, done criteria, evidence summary or explicit missing evidence, output links, review state/reviewer, human gate state/approver, routing/execution history, provenance/source, artifact identity, and integrity metadata.

| Canonical receipt field | Current state | Gap |
|---|---|---|
| Task ID/title | Present | Available from `tasks`. |
| Org/team/project | Missing/partial | No org/team scope; project is flat label plus task-project joins. |
| Worktype | Missing | No worktype registry/overlay on current tasks. |
| Created by | Missing/ambiguous | Comments/activity may imply actor; task row lacks creator. |
| Initiator | Missing/ambiguous | `origin_channel` can hint source but is not an initiator principal. |
| Owner | Missing/ambiguous | Current assignee doubles as owner-like field. |
| Assignee | Present/weak | String display field, not individual principal ID. |
| Executor | Missing | No distinct executor field. |
| Submitted by | Partial | Metadata strings only. |
| Timestamps | Partial | Task created/updated and plugin proof timestamps exist; no submitted/reviewed/completed receipt timestamps as structured fields. |
| Prior/new status | Partial | Generic activity records can show current column, but old/new status is not structured consistently. |
| Done criteria | Present/partial | Packet criteria exist but remain mutable metadata. |
| Evidence summary | Partial | Packet evidence and task output exist but no normalized evidence summary field. |
| Explicit missing evidence | Partial | Review validator rejects/notes missing evidence; no receipt field records missing evidence after completion. |
| Output links | Partial | Parsed from output string; no `ObjectRef` or artifact IDs. |
| Review state/reviewer | Partial | Metadata fields exist; no `Review` object or assignment provenance. |
| Human gate/approver | Missing/general gap | Legacy human-required flag exists, not a general gate object or approver field. |
| Routing/execution history | Partial/fractured | Activities, comments, agent logs, and swarm jobs are separate sources. |
| Provenance/source | Partial | Activity source/agent display and plugin provider exist; no stable actor/runtime/provider provenance envelope. |
| Artifact identity | Missing | No task receipt artifact ID. |
| Content hash/integrity | Missing | No hash or integrity state for task proof. |
| Receipt mutability | Missing | Packet/output fields can be overwritten. |

## Migration and Backfill Risks

- `tasks.metadata` mixes review workflow state with unrelated UI and compatibility values.
- `review_packet` and `review_brief` are mutable blobs without versioning or hash.
- `tasks.output` is both human-readable summary and proof link carrier.
- Artifact references can point outside Entity-controlled roots or to live URLs that drift.
- Review decision values differ slightly across server and UI paths (`needs_fix`, `rejected`, `escalated`, `pending`, `accepted`), so migration must normalize carefully.
- Current human-required flags are specific legacy signals, not a full Phase 2 human-gate model.
- Swarm proof rows are append-only proof-like records but are plugin-owned and not automatically linked to task receipts.
- Historical completed tasks without receipt metadata must be marked missing receipt; do not fabricate original raw receipts.

## Downstream Recommendations

1. Treat `metadata.review_packet` and `metadata.review_brief` as compatibility inputs for migration, not the target review packet store.
2. Preserve current packet field aliases during migration, but normalize into structured review/evidence fields with source and confidence.
3. Split task output into explicit evidence references, human summary text, and artifact links before enforcing canonical receipts.
4. Promote output links and swarm proof bundles into `EvidenceArtifact` candidates through an idempotent migration/report, carrying source labels and confidence.
5. Add receipt creation only after the ActivityEvent spine can record `artifact_linked`, `receipt_created`, `receipt_failed`, `completion_accepted`, and `completion_blocked`.
6. Store review decision and human gate decision separately before final receipt generation.
7. Keep raw receipt bodies immutable; corrections, retries, or re-reviews should create new artifacts/events.
8. Backfill historical tasks as `missing_receipt` unless a real synchronous receipt artifact and metadata already exist.

## Acceptance Coverage

- Existing review packet shape and submission path are documented.
- Output artifact/link conventions are documented.
- Current sample shapes are captured with sanitized data.
- Gaps against canonical receipt required fields are listed.
- No source schema changes or production data writes were performed for this inventory.
