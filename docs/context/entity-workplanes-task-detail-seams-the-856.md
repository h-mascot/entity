# THE-856 / WP1-A-01 — TaskDetailPanel proof/review/output seams

**Decision:** CHARACTERIZED
**Date:** 2026-07-30
**Worktree:** `/Users/enterprise/Code/entity-the-856-wp1-a-01`
**Workplane route:** not implemented (deferred to WP1-A-02+)
**Invented Engineering board data:** none

## Purpose

Characterize the existing Mission Control `TaskDetailPanel` seams that Workplanes Slice 1 should reuse for:

- proof bundle
- files/docs objects
- missing-proof warnings
- comments/review checklist
- output-link ingestion

This issue does **not** add a Workplane route, shell, or Open Workplane action.

## Extracted reusable module

`packages/app/src/components/mission-control/taskDetailWorkplaneSeams.ts`

| Export | Workplane use |
| --- | --- |
| `extractTaskOutputLinks` | Ingest task.output into ProofBundle candidates |
| `normalizeTaskOutputHref` | Canonicalize docs/task/external hrefs |
| `TASK_OUTPUT_LINK_PATTERN` / `splitTaskOutputLinkToken` | Shared token parsing with detail renderer |
| `receiptStatusTone` | Fail-closed proof status tone |
| `deriveMissingEvidenceState` | Explicit missing-proof warnings |
| `hasReviewMetadata` | Whether review checklist panel has content |
| `normalizeReviewDecision` / `buildReviewDecisionMetadata` | Re-export from `reviewActions.ts` write seam |
| `WORKPLANE_PANEL_SEAM_MAP` | Q33 panel → seam inventory |

## Still embedded in TaskDetailPanel (reuse later)

| Seam | Approx. location | Notes |
| --- | --- | --- |
| `buildReceiptProofView` | Receipt and Proof panel builder | Nearest ProofBundle precursor; WP1-B-02 owns normalization |
| `buildTaskDocumentObjectViews` | Files/docs object list | Distinguishes native/external/raw_proof/curated/unknown |
| `collectReceiptDisplayLinks` | Evidence/output link normalization | Feeds ReceiptProofView |
| `reviewPacketSummary` | Review checklist summary | Packet outcome + done criteria count |
| `saveReviewDecision` / human-gate UI | Review actions | Prefer `/review/accept` + `reviewActions` metadata patch |
| Launch Workplane CTA | absent | WP1-A-04 |

## Q33 panel mapping

| Panel | Status | Source |
| --- | --- | --- |
| Task summary | partial | Form/header fields; not a standalone panel |
| Proof bundle | reusable_now | output links + receipt proof + evidence links |
| Files/docs | reusable_now | DocumentObjectView builders |
| Activity/progress | partial | Activity tab exists; not ActivityEvent spine yet |
| Comments/review checklist | reusable_now | comments API + review metadata/gates |
| Missing-proof warnings | reusable_now | `deriveMissingEvidenceState` + degradedMessages |

## Metadata keys

See `TASK_DETAIL_PROOF_METADATA_KEYS` in the seam module for receipt, evidence, review, and document keys.

## Non-goals honored

- No Workplane route/URL state
- No Mission Control redesign
- No invented imported Engineering board rows (THE-854/THE-855 remain fail-closed)
- No production mutation / secrets exposure

## Next

1. WP1-A-02 — URL state schema using these panel ids
2. WP1-B-02 — ProofBundle normalization from `extractTaskOutputLinks` + `buildReceiptProofView` inputs
3. WP1-A-04 — Open Workplane action from task detail
