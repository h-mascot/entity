# Entity Phase 2 — Final Linear Issue Graph

Source: canonical PRD + Opus 4.8 issue graph review patches.
Status: Ready for Linear load.

## Issue order
1. **Slice 0: Inventory current Entity schema, activity log, and review packet shape** — Blocked by: None - can start immediately
2. **Establish org-scoped workspace hierarchy and task accountability** — Blocked by: Slice 0
3. **Structure ActivityEvent spine and migrate current event payloads** — Blocked by: Slices 0, 2
4. **Implement canonical receipt completion contract** — Blocked by: Slices 0, 2, 3
5. **Add docs/files/artifacts object model with ObjectRef links** — Blocked by: Slices 0, 2
6. **Implement review policy, human gates, and separation-of-duties** — Blocked by: Slices 0, 2, 3, 4
7. **Implement Task Master routing, nudges, escalation, and reassignment** — Blocked by: Slices 0, 2, 3, 4, 6
8. **Add worktype registry and business-ops overlays** — Blocked by: Slices 0, 2
9. **Build permission, sensitivity, and search envelope** — Blocked by: Slices 0, 2, 5, 8
10. **Build Entity inbox, owner accountability, and notification routing** — Blocked by: Slices 0, 2, 3, 6, 7
11. **Add Agent Management surface and runtime binding status via Helm** — Blocked by: Slices 0, 2
12. **Integrate ClickClack as degraded-safe collaboration context** — Blocked by: Slices 0, 2, 5, 9
13. **Implement Google Docs/Drive connector V1 read-only posture** — Blocked by: Slices 0, 2, 5, 9
14. **Progressive migration/backfill and cleanup queues** — Blocked by: Slices 0, 2, 3, 4, 5
15. **Release observability, feature flags, proof gates, and rollback** — Blocked by: Slices 1-14

---

## Issue 1: Slice 0: Inventory current Entity schema, activity log, and review packet shape

**Priority:** Urgent

**Blocked by:** None - can start immediately

**User stories covered:** Foundational inventory for all PRD user stories; no direct end-user story, enables implementation proof

### What to build

Create the current-state inventory that all later slices depend on: current schema, activity-log event types/payloads, existing review_packet shape, current proof/receipt/review storage, current task lifecycle fields, and gaps against the Phase 2 canonical PRD. Produce a gap report and migration-readiness checklist without changing production data.

### Acceptance criteria

- [ ] Current schema inventory is documented with tables/entities and required/optional fields.
- [ ] Activity-log event inventory lists every event type, payload shape, producer, and consumer.
- [ ] review_packet/proof/receipt storage shapes are documented.
- [ ] Gap report maps current state to target ActivityEvent, receipt, review, ObjectRef, ExternalSideEffect, and principal models.
- [ ] Receipt, Task Master, review, and migration slices explicitly reference this inventory as their input.
- [ ] No production mutation occurs; output is a dry-run/inventory artifact.

### Blocked by

None - can start immediately

## Issue 2: Establish org-scoped workspace hierarchy and task accountability

**Priority:** Urgent

**Blocked by:** Slice 0

**User stories covered:** Workspace hierarchy, tenancy, task accountability, org-scoped work access

### What to build

Implement the foundational Org → Team → Project → Task hierarchy and accountability model. Every operational work item must map to a task with initiator, individual owner, lifecycle state, assignee/executor or policy-allowed Task-Master-drivable unassigned state, and org-scoped access by construction.

### Acceptance criteria

- [ ] Org, team, project, and task objects enforce required identifiers and hierarchy.
- [ ] Every task requires initiator and individual owner.
- [ ] Executable work validates assignee/executor or policy-allowed Task-Master-drivable unassigned state.
- [ ] Request-context org binding and mandatory org_id query predicate are enforced at the service seam.
- [ ] Cross-org reads/writes/search/index access fail by construction and have tests.
- [ ] UI/API proof shows a task can be created and viewed under org/team/project with accountability fields.

### Blocked by

Slice 0

## Issue 3: Structure ActivityEvent spine and migrate current event payloads

**Priority:** Urgent

**Blocked by:** Slices 0, 2

**User stories covered:** Activity history, proof history, migration readiness, auditability

### What to build

Create the structured ActivityEvent spine for task/proof/review/routing history. Backfill existing activity logs non-destructively into structured payloads where confidence is sufficient; mark uncertain events clearly instead of inventing certainty.

### Acceptance criteria

- [ ] ActivityEvent enum covers task lifecycle, receipt events, review events, gate events, Task Master routing, notification routing, permission denial, integration degraded, and migration warning events.
- [ ] Structured payload schema exists for each event type.
- [ ] Current logs are migrated or mapped in dry-run with confidence and warning fields.
- [ ] Uncertain/partial historical events remain visible with warnings.
- [ ] Re-running migration is idempotent and does not overwrite human-corrected fields.
- [ ] API fixture and migration report prove the structured event spine.

### Blocked by

Slices 0, 2

## Issue 4: Implement canonical receipt completion contract

**Priority:** Urgent

**Blocked by:** Slices 0, 2, 3

**User stories covered:** Canonical receipts, proof-backed completion, receipt failure visibility

### What to build

Implement proof-backed completion: completed entity-mc tasks synchronously create immutable canonical markdown receipts, compute hash, and write metadata in the same transaction as done. Failure states must keep the task non-done and visible.

### Acceptance criteria

- [ ] Completion writes immutable markdown receipt body to stable artifact path.
- [ ] Receipt body hash is computed and persisted in DB metadata.
- [ ] DB receipt metadata and task done transition happen in one transaction.
- [ ] Body-write failure keeps task non-done with receipt_status=failed and receipt_failed ActivityEvent.
- [ ] Metadata failure after body write keeps task non-done with receipt_status=integrity_error and queues orphaned-artifact reconciliation.
- [ ] receipt/regenerate-metadata only rebuilds DB/index metadata from immutable body; it never rewrites body and refuses missing body.
- [ ] Receipt sample, API fixture, and failure-mode tests are attached as proof.
- [ ] Receipt body contains all canonical required fields per PRD receipt model — initiator, owner, assignee/executor, submitted_by, task lifecycle, routing history, review/gate decisions, artifacts, provenance, and integrity metadata — verified by snapshot test.

### Blocked by

Slices 0, 2, 3

## Issue 5: Add docs/files/artifacts object model with ObjectRef links

**Priority:** High

**Blocked by:** Slices 0, 2

**User stories covered:** Docs/files/artifacts, ObjectRef linking, immutable proof vs mutable docs

### What to build

Separate NativeDocument, ExternalDocumentRef, EvidenceArtifact, and canonical Receipt artifacts. Add explicit ObjectRef links so artifacts can attach to tasks, projects, plans, specs, goals, external docs, and review packets without conflating mutable docs and immutable proof.

### Acceptance criteria

- [ ] NativeDocument, ExternalDocumentRef, EvidenceArtifact, ReceiptArtifact concepts are represented distinctly.
- [ ] ObjectRef {object_type, object_id, link_role} is used for cross-object links.
- [ ] Raw proof/receipts are immutable; curated docs are versioned.
- [ ] External docs are linked refs, not canonical proof stores.
- [ ] Artifact links survive task/project title changes and moves.
- [ ] API and UI proof show a task with native doc, external doc ref, evidence artifact, and receipt links.

### Blocked by

Slices 0, 2

## Issue 6: Implement review policy, human gates, and separation-of-duties

**Priority:** Urgent

**Blocked by:** Slices 0, 2, 3, 4

**User stories covered:** Review policy, human gates, separation of duties, ExternalSideEffect risk controls

### What to build

Implement policy-based review and human-gate model with auditable reason chains. Human gates resolve before done; receipts record resolved review/gate decisions only. Separation-of-duties fallback must be deterministic.

### Acceptance criteria

- [ ] Policy resolver emits required review/gate decisions and reason chains.
- [ ] Human gate pending blocks done and keeps task in review/gate_pending.
- [ ] Receipt at done includes resolved gate/review decisions only, never pending gates.
- [ ] Reviewer fallback chain is initiator → capable reviewer pool → owner-if-eligible → admin escalation.
- [ ] Initiator is excluded iff also assignee, executor, or submitted_by.
- [ ] ExternalSideEffect schema drives gate requirements.
- [ ] Self-review/SoD rejection tests and gate-before-done tests pass.

### Blocked by

Slices 0, 2, 3, 4

## Issue 7: Implement Task Master routing, nudges, escalation, and reassignment

**Priority:** High

**Blocked by:** Slices 0, 2, 3, 4, 6

**User stories covered:** Task Master claim/nudge/escalate/reassign workflows and routing receipts

### What to build

Implement Task Master behavior for unassigned/self-assigned/stalled work. Task Master can claim or route allowed work, nudge assigned stalled work, escalate to owner, and auto-reassign only when policy permits. `taskmaster_drivable` is a cached projection of policy resolution. This slice depends on the receipt generator from Slice 4 for receipt content that includes the full routing chain.

### Acceptance criteria

- [ ] Policy resolution computes Task-Master-drivable state; task field is only cached projection.
- [ ] Task Master routes allowed unassigned work to an eligible executor.
- [ ] Assigned stalled work is nudged before escalation.
- [ ] Owner escalation creates visible activity and inbox notification.
- [ ] Auto-reassignment only occurs when policy permits and records reason chain.
- [ ] Receipts include execution/routing chain.
- [ ] Activity fixtures prove claim, nudge, escalation, reassignment, and denied auto-reassign flows.

### Blocked by

Slices 0, 2, 3, 4, 6

## Issue 8: Add worktype registry and business-ops overlays

**Priority:** High

**Blocked by:** Slices 0, 2

**User stories covered:** Sales, customer success, people, business-ops DomainPlan/worktype overlays

### What to build

Implement typed worktype overlays and DomainPlan support so sales, customer success, people, and business-ops workflows do not have to use engineering-only vocabulary. Overlay fields must be validated, sensitivity-aware, and optionally searchable where registered.

### Acceptance criteria

- [ ] Worktype registry supports schema name/version, fields/types, allowed values, default risk, DomainPlan labels, sensitivity defaults, and indexable fields.
- [ ] Sales overlay supports account/deal stage/next action/external-send risk.
- [ ] CS overlay supports customer health/renewal/escalation/support context.
- [ ] People overlay supports candidate/employee workflow stage/sensitivity/HR action risk.
- [ ] Unregistered overlay fields are rejected or quarantined.
- [ ] Search filters only registered indexable overlay fields.
- [ ] UI proof shows one sales/account plan or CS plan task with business-language labels.

### Blocked by

Slices 0, 2

## Issue 9: Build permission, sensitivity, and search envelope

**Priority:** High

**Blocked by:** Slices 0, 2, 5, 8

**User stories covered:** RBAC, object sensitivity, search, snippets/previews, permission-denial audit

### What to build

Implement layered RBAC, object sensitivity, snippet suppression, and search envelopes across tasks, docs, artifacts, receipts, activity, external refs, and status references. Search must not leak restricted snippets or duplicate Helm deep runtime/admin search.

### Acceptance criteria

- [ ] RBAC checks org/team/project/object permission and sensitivity.
- [ ] Search result envelope includes object type, permission verdict, sensitivity, source, and allowed snippet/preview.
- [ ] Restricted snippets/previews are suppressed or replaced by allowed placeholders.
- [ ] Permission-tightening propagates to previously indexed snippets.
- [ ] Denied-access audit events are generated where policy requires.
- [ ] Helm/runtime search is scoped to status-reference-only.
- [ ] Cross-org and sensitivity denial fixtures are attached.

### Blocked by

Slices 0, 2, 5, 8

## Issue 10: Build Entity inbox, owner accountability, and notification routing

**Priority:** High

**Blocked by:** Slices 0, 2, 3, 6, 7

**User stories covered:** Entity inbox, owner accountability, notifications, escalation routing

### What to build

Make Entity inbox/activity canonical for notifications while external channels remain delivery routes. Owners, reviewers, and admins need one place to see tasks needing action: stalled, escalated, gate-pending, review-pending, degraded, and failed receipt/integrity states.

### Acceptance criteria

- [ ] Canonical notification record exists for review, gate, receipt failure, stale task, escalation, degraded integration, and permission denial events.
- [ ] Owner accountability inbox lists owned stalled/escalated/review/gate/failure tasks.
- [ ] External delivery routes are recorded as delivery attempts, not source of truth.
- [ ] Notification routing respects object sensitivity and org/team permission.
- [ ] Degraded external channels do not hide Entity inbox notifications.
- [ ] UI/API proof shows owner inbox and reviewer/admin notifications.

### Blocked by

Slices 0, 2, 3, 6, 7

## Issue 11: Add Agent Management surface and runtime binding status via Helm

**Priority:** Medium

**Blocked by:** Slices 0, 2

**User stories covered:** Agent management, skills/crons/current work visibility, Helm-backed runtime binding

### What to build

Create Agent Management as an Entity surface distinct from Agent Activity. It shows agent identity, capabilities/skills, recurring crons/loops visibility, current work, and runtime binding state. Runtime configuration and spin-up route to Helm, while Entity renders safe status and light controls only.

### Acceptance criteria

- [ ] Agent principal supports binding fields: runtime_binding_id, provider_type, helm_managed, binding_state.
- [ ] Entity displays bound/unbound/stale/unknown runtime binding state.
- [ ] Helm adapter provides runtime status keyed by runtime_binding_id.
- [ ] Helm unreachable renders unknown/degraded without faking health or blocking docs/files/proof/review.
- [ ] Agent skills/capabilities and recurring crons/loops are visible where permissioned.
- [ ] Add/register agent flow routes runtime configuration to Helm.
- [ ] Boundary tests prove Entity does not duplicate Helm deep admin controls.

### Blocked by

Slices 0, 2

## Issue 12: Integrate ClickClack as degraded-safe collaboration context

**Priority:** Medium

**Blocked by:** Slices 0, 2, 5, 9

**User stories covered:** ClickClack work-object collaboration, degraded chat readiness, permissioned chat links

### What to build

Integrate ClickClack as chat/collaboration substrate around work objects without making it load-bearing for docs/files/proof/review. Chat links and staged messages must obey Entity object permissions and sensitivity.

### Acceptance criteria

- [ ] Entity↔ClickClack contract is explicit for channels, threads, messages, composer, and bridge/proxy readiness.
- [ ] Work-object chat context links to tasks/docs/artifacts where permissioned.
- [ ] ClickClack unavailable shows degraded/staged state but docs/files/proof/review remain usable.
- [ ] Chat-linked snippets/previews obey sensitivity and permission.
- [ ] No external chat notification becomes source of truth over Entity inbox/activity.
- [ ] Degraded bridge/proxy fixture and UI proof are attached.

### Blocked by

Slices 0, 2, 5, 9

## Issue 13: Implement Google Docs/Drive connector V1 read-only posture

**Priority:** Medium

**Blocked by:** Slices 0, 2, 5, 9

**User stories covered:** Google Docs/Drive read-only metadata/index/link/preview connector

### What to build

Implement Google Docs/Drive as external document refs: read-only metadata/index/link/preview first. Writes/mutation are out of scope unless explicitly gated later. Google Docs never becomes canonical low-level proof storage.

### Acceptance criteria

- [ ] Connector reads metadata, indexes allowed snippets, links/embeds previews where permissioned.
- [ ] Expired/revoked/insufficient scopes render degraded external ref without mutation attempts.
- [ ] Entity-native receipts remain canonical proof.
- [ ] No default writes to Google Docs exist in V1.
- [ ] Permission/sensitivity filters apply to doc snippets/previews.
- [ ] Connector degraded-state and revoked-permission fixtures are attached.

### Blocked by

Slices 0, 2, 5, 9

## Issue 14: Progressive migration/backfill and cleanup queues

**Priority:** Medium

**Blocked by:** Slices 0, 2, 3, 4, 5

**User stories covered:** Progressive migration/backfill, uncertainty warnings, cleanup queue

### What to build

Implement non-destructive migration/backfill from existing tasks, activity, review packets, and artifacts into Phase 2 structures. Unknowns must remain visible; no historical certainty may be invented.

### Acceptance criteria

- [ ] Migration dry-run reports counts, confidence, warnings, and required manual cleanup.
- [ ] Backfill requires initiator/owner/executor where inferable and marks missing data.
- [ ] Historical receipts are not faked; curated summaries, if created, are marked as backfill summaries not raw receipts.
- [ ] Cleanup queue exists for incomplete/uncertain records.
- [ ] Re-run is idempotent and preserves human corrections.
- [ ] Rollback plan and migration warning UI are documented/proven.

### Blocked by

Slices 0, 2, 3, 4, 5

## Issue 15: Release observability, feature flags, proof gates, and rollback

**Priority:** Medium

**Blocked by:** Slices 1-14

**User stories covered:** Rollout, observability, feature flags, E2E proof suite, rollback

### What to build

Create rollout controls and release proof so Phase 2 can ship safely: feature flags, degraded-state observability, metrics/logs, E2E proof suite, security/permission release gate, and rollback runbook.

### Acceptance criteria

- [ ] Feature flags gate major Phase 2 surfaces.
- [ ] Metrics/logs cover receipt failures, gate blocks, review outcomes, Task Master routes, permission denials, connector degradation, and migration warnings.
- [ ] E2E proof suite covers first-session spine: register one agent via Helm-backed binding, create business task, attach context, complete with receipt, review, search, inbox.
- [ ] Security/permission release gate must pass before broad rollout.
- [ ] Rollback runbook covers schema, indexing, connector, UI, and policy rollback.
- [ ] Release checklist links every slice to proof artifacts.

### Blocked by

Slices 1-14
