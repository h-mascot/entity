#!/usr/bin/env python3
"""Load Entity Phase 2 child implementation issues into Linear.

Idempotent by exact issue title: existing issues are updated; missing issues are created.
Requires LINEAR_API_KEY. Does not contain secrets.
"""
from __future__ import annotations

import json
import os
import time
import urllib.request
from pathlib import Path
from typing import Any

API_URL = "https://api.linear.app/graphql"
PROJECT_NAME = "Entity"
TEAM_KEY = "THE"
FEATURE_LABEL = "Feature"
REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_JSON = REPO_ROOT / "docs/specs/entity-phase-2-linear-child-load-receipt-20260620.json"
OUT_MD = REPO_ROOT / "docs/specs/entity-phase-2-linear-issue-map-20260620.md"

CONTEXT_BLOCK = """## Cursor / local-agent context

Repo: `/Users/enterprise/Code/Entity`

Before coding, read:
- `AGENTS.md`
- `.cursor/rules/entity-phase-2.mdc`
- `docs/context/entity-phase-2-build-context.md`
- `docs/specs/entity-phase-2-prd-canonical-20260620.md`
- `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
- this issue's parent epic and sibling dependencies

Default local proof commands:
```bash
cd /Users/enterprise/Code/Entity
cd packages/server && npm run build && npx vitest run
npm run build
```

For UI-facing work, also run local browser verification and attach screenshot/DOM receipts. Do not mark done until proof is attached to Linear.
"""

PARENTS: list[dict[str, Any]] = [
    {
        "identifier": "THE-6",
        "short": "Slice 0 inventory",
        "children": [
            ("THE-6.1", "Inventory current schema and data model", "Produce a current-state inventory of Entity's SQLite/data model, task fields, project/team fields, metadata blobs, and migration seams. This is read-only planning work that downstream schema tickets depend on.", ["Inventory lists all current task/project/team/org/principal-like tables and fields with file references.", "Existing metadata/json blobs are classified by purpose and migration risk.", "Required Phase 2 fields from the PRD are mapped to existing, missing, ambiguous, or obsolete fields."], ["Markdown inventory committed under `docs/context/` or `docs/plans/`.", "Commands/file reads used for inventory are listed.", "No source schema changes made in this inventory ticket."]),
            ("THE-6.2", "Inventory activity log and provenance events", "Audit existing activity/event/comment/provenance storage and identify how it maps to the target ActivityEvent spine.", ["Current event sources and payload shapes are documented with file/table references.", "Target ActivityEvent enum coverage is marked as present, partial, missing, or conflicting.", "Weak/unstructured provenance risks are called out for migration/backfill."], ["Activity inventory artifact with sample current events.", "Gap table against PRD ActivityEvent requirements.", "No production data mutation."]),
            ("THE-6.3", "Inventory review packets, proof artifacts, and receipt-like outputs", "Audit the existing `entity-mc` review path, review packets, task output docs, proof links, and any receipt-like artifacts before changing completion behavior.", ["Existing review packet shape and submission path are documented.", "Output artifact/link conventions are documented.", "Gaps against canonical receipt required fields are listed."], ["Review/proof inventory artifact.", "At least one current sample shape is captured or described without exposing secrets.", "Gap report references canonical PRD receipt fields."]),
            ("THE-6.4", "Inventory integration boundaries: Helm, ClickClack, Google Docs, notifications", "Map current integration seams and degraded states for Helm/runtime status, ClickClack, Google Docs/Drive, and notification/channel delivery.", ["Current integration code paths and config/env requirements are documented.", "Known unavailable/degraded states are listed.", "Boundary risks are mapped to Phase 2 requirements."], ["Integration inventory artifact.", "No secrets copied into docs.", "No external mutations performed."]),
            ("THE-6.5", "Publish Phase 2 gap matrix and dependency map", "Consolidate Slice 0 inventories into a gap matrix that downstream tickets can use as the binding current-state reference.", ["Gap matrix covers schema, ActivityEvent, review/proof, integrations, permissions/search, notifications, and migration.", "Dependencies and recommended implementation order are explicit.", "Open product/architecture decisions are separated from confirmed gaps."], ["`docs/context/entity-phase-2-current-state-gap-matrix.md` or equivalent exists.", "Downstream blockers reference the gap matrix.", "No claims that implementation is complete."]),
        ],
    },
    {
        "identifier": "THE-7",
        "short": "Workspace hierarchy and task accountability",
        "children": [
            ("THE-7.1", "Add org/team/project schema and request org-scoping seam", "Introduce the foundational org-scoping seam: request-context org binding plus mandatory org predicates for service queries, supporting Org -> Team -> Project -> Task hierarchy.", ["Org, team, project, and task scoping fields exist or migration path is defined.", "Service query helpers require org context rather than ad hoc filtering.", "Cross-org access fails by construction in tests."], ["Schema/migration or feature-flagged data-layer proof.", "Cross-org denial test.", "Build/test output attached."]),
            ("THE-7.2", "Implement workspace hierarchy service APIs", "Expose create/read/update/list flows for orgs, teams, and projects, with tenant isolation and lifecycle/health metadata where applicable.", ["APIs enforce org scope and reject cross-org access.", "Project/team list and lookup endpoints support the workspace shell.", "Errors are explicit for missing/unauthorized scopes."], ["API tests and request/response fixtures.", "Permission-denial fixture.", "Build/test output attached."]),
            ("THE-7.3", "Enforce task initiator, owner, assignee, and executor accountability", "Upgrade task creation/update rules so initiator and individual owner are explicit, and executable assignment resolves to an individual principal or allowed Task-Master-drivable state.", ["New tasks require initiator and individual owner.", "Team ownership is rejected as final task owner.", "Assignee/executor rules are explicit and tested."], ["Validation tests for missing initiator/owner/team-owner rejection.", "Backward-compatibility note for legacy tasks.", "Build/test output attached."]),
            ("THE-7.4", "Build workspace navigation and accountability UI", "Update local UI so users can see workspace hierarchy, task ownership, initiator, assignee/executor, and accountability without opening raw metadata.", ["Workspace shell presents Entity as a work plane, not only a task board.", "Task detail distinguishes initiator, owner, assignee, executor, submitted_by, reviewer, and approver.", "Legacy/unknown fields display as explicit unknown/degraded states."], ["Screenshot/DOM proof.", "Browser verification notes.", "Build/test output attached."]),
            ("THE-7.5", "Backfill hierarchy and accountability fields safely", "Add non-destructive backfill for org/team/project/initiator/owner/assignee fields with confidence/provenance and cleanup warnings for unresolved data.", ["Backfill is dry-runnable and idempotent.", "Inferred fields record source and confidence.", "Missing owner/initiator/project creates cleanup warning, not fake certainty."], ["Dry-run report sample.", "Before/after fixture tests.", "Rollback/non-destructive notes."]),
        ],
    },
    {
        "identifier": "THE-8",
        "short": "ActivityEvent spine",
        "children": [
            ("THE-8.1", "Define ActivityEvent schema, enum, and payload versioning", "Create the structured ActivityEvent spine for routing, review, gates, receipt generation, connector state, and notifications.", ["Target event enum covers PRD-required event types.", "Payloads are typed/versioned enough for migration and future compatibility.", "Unknown legacy events can be represented without losing provenance."], ["Schema/types diff.", "Event fixture samples.", "Type/build/test output attached."]),
            ("THE-8.2", "Implement append/query ActivityEvent service", "Add service methods to append structured events and query task-safe activity under permission constraints.", ["Task create/update/status/assignment paths append structured events.", "Activity query returns permission-safe envelopes.", "Malformed/unknown payloads fail safely or render degraded."], ["Service/API tests.", "Permission-denial test where applicable.", "Build/test output attached."]),
            ("THE-8.3", "Migrate existing activity payloads progressively", "Provide a migration/backfill path from current unstructured or weak activity logs into ActivityEvent records without inventing certainty.", ["Migration maps known legacy events with confidence/provenance.", "Weak events are flagged, not rewritten as certain.", "Old tasks remain visible and usable."], ["Dry-run migration report.", "Legacy event fixture tests.", "Rollback/idempotency proof."]),
            ("THE-8.4", "Render task activity provenance UI", "Update task detail/activity UI to show structured events, routing history, degraded/unknown payloads, and provenance safely.", ["Activity UI shows event type, actor, object ref, timestamp, reason/provenance where available.", "Unknown/weak legacy events are labeled honestly.", "Restricted activity content does not leak."], ["Screenshot/DOM proof.", "Restricted/unknown-state proof.", "Build/test output attached."]),
            ("THE-8.5", "Wire ActivityEvent consumers for receipts, review, routing, and notifications", "Ensure downstream services consume ActivityEvent rather than ad hoc reconstruction for receipts, review decisions, Task Master routing, and notifications.", ["Receipt generation uses ActivityEvent history for routing/review/gate details.", "Review/routing/notification paths append and read canonical events.", "Regression tests cover required event consumers."], ["Consumer tests and fixture receipts.", "Build/test output attached.", "Gap notes for any deferred consumers."]),
        ],
    },
    {
        "identifier": "THE-9",
        "short": "Canonical receipts",
        "children": [
            ("THE-9.1", "Add receipt artifact metadata and stable identity", "Define EvidenceArtifact/receipt metadata for immutable canonical receipts: artifact id, stable path/alias, hash, mutability, origin task, integrity state, and availability.", ["Receipt metadata persists stable artifact identity and origin task linkage.", "Human-friendly path changes do not break canonical identity.", "Raw receipt mutability policy is explicit."], ["Schema/data tests.", "Fixture showing stable id/path/hash metadata.", "Build/test output attached."]),
            ("THE-9.2", "Implement synchronous receipt writer in completion transaction", "Make completed `entity-mc` tasks synchronously write immutable markdown body, compute hash, write metadata, and transition to done in the same clean completion path.", ["Clean done transition requires receipt body + metadata + hash + activity event.", "Receipt body includes all canonical required fields from PRD.", "Completion event and artifact link are recorded."], ["Generated receipt sample.", "Snapshot test for required fields.", "Build/test output attached."]),
            ("THE-9.3", "Implement receipt failure and integrity recovery states", "Handle body write failure, metadata failure after body write, orphan artifact reconciliation, and metadata regeneration without rewriting immutable bodies.", ["Body write failure leaves task non-done with `receipt_status=failed` and event.", "Metadata failure after body write leaves task non-done with `receipt_status=integrity_error` and reconciliation queue.", "Regenerate metadata refuses missing body and never rewrites body."], ["Failure-mode tests.", "Integrity/orphan fixture.", "Build/test output attached."]),
            ("THE-9.4", "Build receipt viewer and missing-evidence UI", "Expose canonical receipt status, evidence summary, missing evidence, output links, provenance, integrity state, and raw-vs-curated distinction in task detail.", ["Task detail shows receipt status and link when present.", "Missing evidence and integrity/degraded states are visible.", "Raw proof and curated interpretation are visually distinct."], ["Screenshot/DOM proof.", "Missing-evidence proof.", "Build/test output attached."]),
            ("THE-9.5", "Harden receipt immutability, path stability, and protocol docs", "Add tests and documentation for immutable raw receipt behavior, task/project move path stability, receipt protocol, and not-done-until-proof standard.", ["Raw receipt overwrite attempts are rejected.", "Task/project/team move does not break receipt link.", "Protocol docs explain receipt creation, failure, regeneration, and review usage."], ["Immutability/path tests.", "Protocol doc under `docs/`.", "Build/test output attached."]),
        ],
    },
    {
        "identifier": "THE-10",
        "short": "Docs/files/artifacts object model",
        "children": [
            ("THE-10.1", "Define NativeDocument, ExternalDocumentRef, EvidenceArtifact, and ObjectRef schema", "Separate Entity-owned markdown, externally owned docs, and proof artifacts into distinct object concepts with explicit ObjectRef links.", ["NativeDocument, ExternalDocumentRef, EvidenceArtifact concepts are distinct in schema/types.", "ObjectRef uses `{ object_type, object_id, link_role }` wherever objects link.", "Existing vague file/artifact references have a migration path."], ["Schema/type tests.", "ObjectRef fixture.", "Build/test output attached."]),
            ("THE-10.2", "Implement document/artifact link services", "Add service/API support to create/read/link NativeDocuments, ExternalDocumentRefs, and EvidenceArtifacts while preserving mutability and ownership rules.", ["Native docs can be created/read/linked.", "External refs can be linked without claiming ownership.", "Evidence artifacts enforce raw/curated mutability semantics."], ["API/service tests.", "Request/response fixtures.", "Build/test output attached."]),
            ("THE-10.3", "Implement native markdown storage and versioning seams", "Provide the storage/versioning behavior needed for Entity-native markdown docs, editable curated reports, and immutable raw evidence receipts.", ["Editable docs/reports are versioned.", "Immutable raw artifacts are append-only.", "Storage backend choice is documented without overcommitting if still abstracted."], ["Versioning tests.", "Storage ADR or implementation note.", "Build/test output attached."]),
            ("THE-10.4", "Build docs/files/artifacts UI distinctions", "Update UI to show external docs, native markdown, raw proof artifacts, and curated reports side by side without blurring ownership or mutability.", ["UI labels external docs, native docs, raw proof, and curated interpretation distinctly.", "Task detail/object panels show ObjectRef link role.", "Restricted/degraded docs show safe placeholders."], ["Screenshot/DOM proof.", "Restricted/degraded UI proof.", "Build/test output attached."]),
            ("THE-10.5", "Migrate existing docs/artifacts and add permission tests", "Map current docs, output artifacts, review packets, and task links into the new object model safely, with permission tests for previews and snippets.", ["Existing artifacts/docs are classified into target object types or cleanup warnings.", "Preview/snippet permissions are enforced.", "Migration is idempotent and non-destructive."], ["Migration dry-run sample.", "Permission/leakage tests.", "Build/test output attached."]),
        ],
    },
    {
        "identifier": "THE-11",
        "short": "Review policy and gates",
        "children": [
            ("THE-11.1", "Define policy schema, risk inputs, and ExternalSideEffect", "Model review/human-gate policy inputs including worktype, risk, evidence quality, agent trust, owner flags, and ExternalSideEffect records.", ["Policy inputs include workspace/org/team/project/worktype/task/risk/trust layers.", "ExternalSideEffect includes type, target system, risk/sensitivity, required gate, requested actor, resolution state.", "Schema supports human gate and review as separate concepts."], ["Schema/type tests.", "Policy input fixtures.", "Build/test output attached."]),
            ("THE-11.2", "Implement layered policy resolver with reason chains", "Create deterministic policy resolution that outputs review required, human gate required, reviewer/approver target, Task Master drivability, thresholds, routes, and reason chain.", ["Higher-risk layers escalate requirements.", "Lower-risk layers cannot bypass mandatory org/workspace gates.", "Resolver emits stable reason chains for UI and receipts."], ["Policy matrix tests.", "Reason-chain snapshots.", "Build/test output attached."]),
            ("THE-11.3", "Implement reviewer assignment and separation-of-duties fallback", "Apply the canonical SoD chain: initiator, same-team reviewer pool, owner if eligible, admin/routing problem when no eligible reviewer exists.", ["Initiator is excluded if also assignee, executor, or submitted_by.", "Skipped candidates include reason chain.", "Admin/routing problem state appears when no eligible reviewer exists."], ["SoD fallback tests.", "Self-review rejection fixture.", "Build/test output attached."]),
            ("THE-11.4", "Implement review and human gate services with gate-before-done ordering", "Add accept/request-fix review actions, human gate request/approve/reject, eligibility enforcement, and completion ordering where required gates resolve before done.", ["Review controls require eligible reviewer.", "Human gate requires eligible human approver.", "Required unresolved gate blocks done and receipt writes only after final done transition."], ["Review/gate API tests.", "Gate-before-done test.", "Receipt contains resolved gate/review decisions only."]),
            ("THE-11.5", "Build review/gate UI panels and policy documentation", "Show review reason chains, eligible controls, separate human gate state, and override audit in task detail/admin surfaces.", ["Review panel and human gate panel are visually separate.", "Controls only render for eligible actors.", "Policy docs explain resolver, SoD, override, and gate semantics."], ["Screenshot/DOM proof.", "Policy docs.", "Build/test output attached."]),
        ],
    },
    {
        "identifier": "THE-12",
        "short": "Task Master routing",
        "children": [
            ("THE-12.1", "Add Task Master routing policy projections", "Represent Task Master drivability, stall thresholds, nudge routes, escalation eligibility, and reassignment eligibility as cached policy projections, not authoritative standalone truth.", ["`taskmaster_drivable` is derived from policy resolution.", "Thresholds/routes/eligibility carry reason/provenance.", "High-risk exclusions are representable."], ["Schema/projection tests.", "Policy fixture coverage.", "Build/test output attached."]),
            ("THE-12.2", "Implement claim flow and double-claim protection", "Allow Task Master to claim unassigned policy-drivable work while preserving original unassigned state and preventing double claims/races.", ["Claim creates structured ActivityEvent.", "Current executor becomes Task Master only for allowed work.", "Double-claim race is handled deterministically."], ["Claim API/service tests.", "Double-claim race test.", "Build/test output attached."]),
            ("THE-12.3", "Implement nudges and owner escalation", "For assigned stalled tasks, Task Master must nudge the assignee first and escalate to owner after thresholds instead of taking over immediately.", ["Assigned work is nudged before escalation/reassignment.", "Escalation routes to owner with visible event and notification.", "Nudge channel failure is recorded/degraded."], ["Nudge/escalation event fixtures.", "Notification integration proof.", "Build/test output attached."]),
            ("THE-12.4", "Implement auto-reassignment audit chain", "Auto-reassign stalled tasks only where policy permits and preserve full prior assignee, new assignee, escalation, policy reason, actor, and final executor chain.", ["Auto-reassignment requires exhausted thresholds and policy eligibility.", "New assignee resolves to individual principal.", "Receipts include full routing/execution chain."], ["Reassignment tests.", "Reassigned receipt sample.", "Build/test output attached."]),
            ("THE-12.5", "Build routing state UI and routing matrix docs", "Expose unassigned drivable, routing problem, claimed, nudged, owner escalated, auto-reassigned, and excluded states in UI with policy reasons.", ["Task detail/board shows routing state and reason.", "Routing problem is visible and actionable.", "Docs explain Task Master is not universal executor."], ["Screenshot/DOM proof.", "Routing matrix docs.", "Build/test output attached."]),
        ],
    },
    {
        "identifier": "THE-13",
        "short": "Worktype registry and overlays",
        "children": [
            ("THE-13.1", "Implement worktype registry schema and versioning", "Replace untyped `worktype_overlay` assumptions with a registry defining schema name/version, fields, allowed values, risk defaults, indexability, sensitivity, and plan labels.", ["Registry supports schema versioning and allowed field definitions.", "Unknown/legacy overlays degrade safely.", "Overlay validation can be run on create/update."], ["Schema/type tests.", "Registry fixture.", "Build/test output attached."]),
            ("THE-13.2", "Implement sales overlay", "Add sales/account worktype overlay fields such as account, deal stage, next action, stakeholder map, external-send risk, and CRM side-effect type.", ["Sales overlay validates allowed fields/values.", "External-send/CRM risk contributes to policy resolution.", "Search/indexable fields are declared."], ["Overlay validation tests.", "Policy/search fixture.", "Build/test output attached."]),
            ("THE-13.3", "Implement customer-success overlay", "Add CS overlay fields for customer, health state, renewal/escalation marker, support context, SLA/customer-impact risk, and external-response risk.", ["CS overlay validates allowed fields/values.", "Customer-impacting risk can require review/gate.", "Search/indexable fields are declared."], ["Overlay validation tests.", "Policy/search fixture.", "Build/test output attached."]),
            ("THE-13.4", "Implement people/HR overlay", "Add people overlay fields for candidate/employee reference, workflow stage, sensitivity class, HR side-effect type, checklist state, and approval requirement.", ["People overlay validates allowed fields/values.", "HR sensitivity tightens permissions and can require human gate.", "Restricted snippets/previews are suppressed."], ["Overlay validation tests.", "Sensitivity/permission fixture.", "Build/test output attached."]),
            ("THE-13.5", "Build worktype overlay UI, filters, and docs", "Render domain-appropriate sales/CS/people/business-ops fields without forcing engineering/spec language, and expose declared filter fields safely.", ["Task create/detail supports worktype overlays.", "Search/filter UI includes declared indexable overlay fields.", "Docs explain registry, overlay versioning, and migration behavior."], ["Screenshot/DOM proof.", "Docs/ADR.", "Build/test output attached."]),
        ],
    },
    {
        "identifier": "THE-14",
        "short": "Permissions, sensitivity, and search",
        "children": [
            ("THE-14.1", "Implement layered RBAC, ACL, and sensitivity evaluator", "Create the permission/sensitivity evaluator for org/team/project inheritance, object ACL overrides, and sensitive categories across tasks/docs/artifacts/activity/search/notifications.", ["Evaluator handles inherited roles and object-level tightening.", "Sensitive categories include HR, customer, legal, financial, security, production, confidential strategy, workspace-defined.", "Denied access does not leak restricted content."], ["RBAC/sensitivity tests.", "Cross-org denial fixture.", "Build/test output attached."]),
            ("THE-14.2", "Enforce org/query permission seam across APIs", "Apply mandatory org predicates and permission checks across service/API/search/indexing seams so cross-org and restricted content fail before rendering.", ["All relevant service queries require request org binding.", "Cross-org access fails by construction.", "Permission-denial responses are safe and explicit."], ["API denial tests.", "Service query review notes.", "Build/test output attached."]),
            ("THE-14.3", "Implement permission-safe content envelopes", "Wrap tasks, artifacts, activity, docs, external refs, previews, snippets, notifications, and Helm status refs in permission-aware envelopes.", ["Restricted users see safe placeholder or no object where policy requires.", "Preview/snippet/activity content is suppressed before render.", "Connector access and Entity visibility remain separate."], ["Leakage tests.", "Restricted placeholder UI/API proof.", "Build/test output attached."]),
            ("THE-14.4", "Build global/scoped search envelope and indexers", "Implement search result envelope, indexers, filters, and degraded/index-lag visibility for tasks, docs, artifacts, external refs, activity, planning objects, people/agents, and ClickClack refs where integrated.", ["Search envelope includes object type, title, permitted snippet, source, deep link, scope, recency, provenance, permission state, connector state.", "Filters cover PRD-required fields.", "Index lag/degraded state is observable."], ["Search API tests.", "Index fixture samples.", "Build/test output attached."]),
            ("THE-14.5", "Harden restricted snippet suppression and search UI", "Build UI and tests proving permission filtering happens before snippets/previews render, including permission-change propagation that suppresses previously indexed restricted snippets.", ["Restricted snippets/previews are suppressed in UI and API.", "Permission changes invalidate/suppress indexed restricted content.", "Search UI explains access restriction without leaking content."], ["Leakage attempt tests.", "Screenshot/DOM proof.", "Build/test output attached."]),
        ],
    },
    {
        "identifier": "THE-15",
        "short": "Inbox and notifications",
        "children": [
            ("THE-15.1", "Implement canonical notification and inbox schema", "Create canonical Entity notification/inbox records for review requests, human gates, nudges, escalations, reassignment, receipt failures, connector degradation, and policy warnings.", ["Notification records link to canonical Entity event/object/ref.", "Inbox state is separate from external delivery status.", "All PRD notification types are represented."], ["Schema/tests.", "Notification fixture samples.", "Build/test output attached."]),
            ("THE-15.2", "Implement notification routing policy and delivery adapters", "Route notifications to configured channels such as ClickClack, email, Discord, Slack, AgentPush, webhooks, or mocks while preserving Entity as source of truth.", ["Routing is policy-based by urgency/risk/user preferences/channel availability.", "External delivery failure is recorded without losing canonical notification.", "No secrets leak in delivery logs or UI."], ["Routing tests with success/failure fixtures.", "Delivery failure proof.", "Build/test output attached."]),
            ("THE-15.3", "Build owner accountability inbox and escalation queues", "Give owners a canonical view of tasks they are accountable for, including stalled, escalated, review-blocked, gate-pending, receipt-failed, and migration-warning items.", ["Owner inbox queries all accountable tasks across relevant states.", "Escalation/review/gate/receipt failure states are grouped visibly.", "Deep links point to canonical Entity objects."], ["API/query tests.", "Screenshot/DOM proof.", "Build/test output attached."]),
            ("THE-15.4", "Build inbox and notification UI", "Add inbox/activity UI for notification records, delivery routes, failure/degraded states, policy reasons, and deep links.", ["UI distinguishes canonical notification state from external channel delivery.", "Failure/degraded delivery state is visible.", "Notification detail shows policy reason and object ref."], ["Screenshot/DOM proof.", "Failed-channel proof.", "Build/test output attached."]),
            ("THE-15.5", "Document notification contracts and degraded behavior", "Add docs and tests that external channels are delivery routes only and Entity inbox/activity remains canonical.", ["Docs cover source-of-truth behavior, delivery route status, failure handling, and supported notification types.", "Tests cover channel failure and retained canonical notification.", "No notification claim depends solely on external channel success."], ["Docs committed.", "Degraded tests.", "Build/test output attached."]),
        ],
    },
    {
        "identifier": "THE-16",
        "short": "Agent Management and Helm runtime binding",
        "children": [
            ("THE-16.1", "Define agent principal and runtime binding schema", "Represent agents as first-class principals separate from Helm-managed runtime/provider records, with runtime_binding_id, provider_type enum, helm_managed, and binding_state.", ["Agent principal identity is separate from runtime/provider identity.", "Provider type is generic, not hardcoded to OpenClaw/Hermes.", "Binding states include bound, unbound, stale, unknown."], ["Schema/type tests.", "Provider-agnostic fixture.", "Build/test output attached."]),
            ("THE-16.2", "Implement Helm status adapter and degraded runtime states", "Read runtime status through Helm adapter keyed by runtime_binding_id and render unknown/degraded status honestly when Helm or binding is unavailable.", ["Reachable Helm status returns safe health/readiness/current work/heartbeat summary.", "Unavailable/stale binding returns degraded/unknown without faking health.", "No secrets or deep admin config are exposed."], ["Adapter tests/mocks.", "No-secret negative test.", "Build/test output attached."]),
            ("THE-16.3", "Build Agent Management surface", "Create Agent Management UI distinct from Agent Activity, showing identity, capabilities/skills, current work, recurring crons/loops visibility, and runtime binding status.", ["UI shows agent identity and binding state clearly.", "Agent Activity remains separate from management/configuration.", "Unknown/offline/degraded agents are explicit."], ["Screenshot/DOM proof.", "Degraded binding proof.", "Build/test output attached."]),
            ("THE-16.4", "Implement safe light controls and Helm deep links", "Expose only policy-allowed, reversible, audited controls such as pause/resume/request retry, and deep-link to Helm for deep admin/configuration.", ["Safe controls are policy checked and audited.", "Deep admin controls/secrets/model config/schedules/deploy settings are not duplicated in Entity.", "Helm unavailable preserves core Entity flows."], ["Boundary tests.", "Audit fixture.", "Screenshot/DOM proof."]),
            ("THE-16.5", "Document runtime/admin boundary and provider-agnostic behavior", "Add docs and tests proving Entity remains runtime-agnostic and Helm owns deep runtime/admin configuration.", ["Docs define Entity vs Helm vs runtime/provider responsibility.", "Tests prevent OpenClaw/Hermes hardcoding as Entity-only model.", "Search surfaces Helm status refs only, not deep Helm object search."], ["Boundary ADR/docs.", "Provider-agnostic tests.", "Build/test output attached."]),
        ],
    },
    {
        "identifier": "THE-17",
        "short": "ClickClack collaboration",
        "children": [
            ("THE-17.1", "Define Entity to ClickClack contract and readiness states", "Document and implement the contract for ClickClack readiness states: live, staged, degraded, unavailable, not configured.", ["Readiness state maps current bridge/proxy behavior honestly.", "Entity-owned work state is independent of chat readiness.", "Contract docs define ownership boundary."], ["Contract doc/ADR.", "Readiness tests/mocks.", "Build/test output attached."]),
            ("THE-17.2", "Link ClickClack threads/channels to Entity objects with ObjectRef", "Allow ClickClack channel/thread references to link tasks/docs/artifacts/projects without making chat the source of truth.", ["Thread/channel refs use ObjectRef link roles.", "Permission checks apply before rendering chat-linked context.", "Links survive ClickClack degraded/unavailable state as Entity-owned refs."], ["API/service tests.", "ObjectRef fixtures.", "Build/test output attached."]),
            ("THE-17.3", "Build embedded/staged chat context panel", "Render ClickClack-powered or staged chat context near work objects where bridge is ready while preserving task/doc/proof context.", ["Panel shows live/staged/degraded/unavailable readiness.", "Task/doc/proof links remain canonical Entity links.", "Unavailable chat does not hide proof/review/docs."], ["Screenshot/DOM proof.", "Unavailable-state proof.", "Build/test output attached."]),
            ("THE-17.4", "Guarantee degraded ClickClack does not block core Entity flows", "Harden docs/files/proof/review/search/task flows so ClickClack outage cannot block core Entity work.", ["Core APIs work with ClickClack disabled/unavailable.", "UI shows degraded chat readiness without breaking task/proof/review flows.", "Tests cover unavailable sidecar/bridge."], ["Degraded-mode tests.", "Manual/browser proof if UI affected.", "Build/test output attached."]),
            ("THE-17.5", "Document ClickClack reuse, proxy, and bridge tests", "Update docs/tests around ClickClack sidecar/proxy usage, degraded behavior, and integration smoke commands.", ["Docs explain optional sidecar and local/cloud differences.", "Smoke tests cover live/mock and degraded routes.", "No Entity proof/review dependency on chat availability."], ["Docs committed.", "ClickClack smoke/test output where available.", "Build/test output attached."]),
        ],
    },
    {
        "identifier": "THE-18",
        "short": "Google Docs/Drive connector V1",
        "children": [
            ("THE-18.1", "Define Google connector auth, scope, and readiness model", "Model Google Docs/Drive connector authorization state, scopes, expiry, insufficient scope, revoked/deleted refs, and readiness without mutating external docs.", ["Connector state distinguishes authorized, expired, insufficient, revoked/deleted, unavailable.", "V1 scopes support read/index/link/preview only.", "External connector permission and Entity visibility remain separate."], ["Schema/type tests.", "Auth-state fixtures.", "Security note on scopes."]),
            ("THE-18.2", "Implement read-only Docs/Drive metadata service", "Add service/API support for read/list/search metadata and open external doc references, with no create/update/export/sync mutation path by default.", ["Metadata read/list/search works with mocked or live authorized path.", "No write/create/update/export/sync endpoint exists in V1 default path.", "Expired/insufficient auth returns degraded state."], ["Read-only API tests.", "No-mutation negative tests.", "Build/test output attached."]),
            ("THE-18.3", "Implement external doc link and preview UI", "Allow users to link Google Docs/Drive items to tasks/plans/specs/goals/projects and preview permitted metadata/snippets with clear external ownership labels.", ["UI labels external docs as externally owned.", "Preview/open link respects connector/auth state.", "No V1 write controls appear."], ["Screenshot/DOM proof.", "Expired/insufficient auth proof.", "Build/test output attached."]),
            ("THE-18.4", "Enforce restricted preview/snippet suppression", "Ensure Google external permissions do not automatically grant Entity visibility and restricted snippets/previews are suppressed before render/index output.", ["Entity permission evaluator runs before snippets/previews render.", "Users without access see safe restricted/degraded states.", "Permission revoked/deleted external doc state does not lose Entity-native proof."], ["Restricted snippet tests.", "Revoked/deleted fixture.", "Build/test output attached."]),
            ("THE-18.5", "Document connector posture and future write gates", "Document Google V1 read-only posture, explicit later gates for writes/export/sync, audit trail requirements, and security caveats.", ["Docs say Google Docs is not canonical low-level proof storage.", "Future writes/export/sync are out of V1 default path and require explicit gates.", "Security review notes include minimal scopes and no mutation proof."], ["Connector docs committed.", "No-mutation test output.", "Build/test output attached."]),
        ],
    },
    {
        "identifier": "THE-19",
        "short": "Migration and backfill",
        "children": [
            ("THE-19.1", "Build migration dry-run inventory report", "Create a dry-run inventory that counts existing tasks, projects, docs, review packets, activity logs, artifacts, and gaps before any backfill mutation.", ["Dry run produces counts and gap categories.", "Report identifies missing owner/initiator/project/assignee/receipt/worktype/activity/permission gaps.", "No data mutation in dry-run mode."], ["Dry-run report sample.", "Command documented.", "No mutation proof."]),
            ("THE-19.2", "Backfill required hierarchy/accountability fields with confidence", "Backfill org/team/project, initiator, owner, assignee/executor, and worktype where inferable, with source and confidence metadata.", ["Inferred fields carry source/confidence.", "Owner resolves to individual principal where possible.", "Missing/ambiguous fields create cleanup warning rather than fake value."], ["Before/after fixture.", "Idempotency test.", "Rollback notes."]),
            ("THE-19.3", "Map review packets and evidence into structured artifacts/events", "Map existing review packets, evidence fields, output artifacts, and activity logs into Phase 2 structured fields where possible.", ["Review packets map to structured evidence fields where possible.", "Historical completed tasks without receipts are marked missing_receipt, not given fake raw receipts.", "Weak activity structure is flagged."], ["Migration fixture tests.", "Missing_receipt sample.", "Build/test output attached."]),
            ("THE-19.4", "Build migration warning and cleanup queues", "Expose cleanup queues for missing owner, unknown initiator, ambiguous team, uncertain permissions, weak activity, missing receipts, and other migration warnings.", ["Warnings are visible in UI/API without blocking old task visibility.", "Cleanup queue allows human correction without overwriting by rerun.", "Corrected values are protected from later backfill overwrite."], ["Screenshot/DOM or API proof.", "Human-corrected value idempotency test.", "Build/test output attached."]),
            ("THE-19.5", "Document migration runbook and rollback/non-fabrication rules", "Write runbook and tests proving migration is progressive, non-destructive, idempotent, and does not fabricate historical proof certainty.", ["Runbook covers dry run, staged backfill, rollback, cleanup queues, feature flags.", "Tests cover no fake raw receipts and no overwritten human-corrected values.", "Old tasks remain visible."], ["Runbook committed.", "Non-fabrication/idempotency tests.", "Build/test output attached."]),
        ],
    },
    {
        "identifier": "THE-20",
        "short": "Release observability and proof gates",
        "children": [
            ("THE-20.1", "Add feature flags and staged enforcement gates", "Gate Phase 2 strict invariants and surfaces behind flags so new tasks can enforce stricter behavior while legacy data remains usable.", ["Flags cover receipt completion, review/gate policy, worktype registry, migration enforcement, search/permission strictness where needed.", "Legacy tasks remain visible.", "Flag state is visible in diagnostics."], ["Feature flag tests/proof.", "Legacy compatibility fixture.", "Build/test output attached."]),
            ("THE-20.2", "Add observability for receipts, review, search, integrations, and migration", "Instrument metrics/logs/diagnostics for receipt failures, review/gate queues, search index lag, Helm/ClickClack/Google degraded states, notification failures, and migration warnings.", ["Key degraded states emit diagnostics without secrets.", "Operators can see receipt/search/integration health.", "Observability distinguishes unknown/degraded/failed/healthy."], ["Metrics/log fixture proof.", "No-secret log check.", "Build/test output attached."]),
            ("THE-20.3", "Build E2E proof suite for first-session spine", "Create an end-to-end proof path: connect/read indexed context, add/register one Helm-backed agent binding, create business-ops task, complete with canonical receipt, review it, inspect proof/search/activity.", ["E2E spine covers buyer first-session flow from PRD.", "Proof captures receipt, review, search, activity, degraded-safe behavior.", "Suite is runnable locally with documented setup."], ["E2E/proof script output.", "Screenshots/DOM receipts where UI involved.", "Build/test output attached."]),
            ("THE-20.4", "Run security/privacy/boundary release gate", "Create a release gate that verifies no Paperclip internal dependency, no Curacel-specific framing, no Helm secrets/deep admin exposure, no Google mutation, no ClickClack blocking, and no permission leaks.", ["Boundary checks from PRD are automated or checklist-backed.", "Security/permission leak tests run before release.", "Release gate fails on forbidden product boundary drift."], ["Release gate script/checklist.", "Boundary test output.", "Build/test output attached."]),
            ("THE-20.5", "Write rollback runbook and release checklist", "Document rollout/rollback procedures, release readiness tests, proof attachment standards, and operator checklist for Phase 2 launch.", ["Runbook covers flags, migration rollback, receipt failure recovery, connector degradation, and notification failures.", "Release checklist includes all PRD release readiness tests.", "Docs point to proof scripts and Linear issue map."], ["Rollback runbook committed.", "Release checklist committed.", "Smoke/proof command output attached."]),
        ],
    },
]


def gql(query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    key = os.environ.get("LINEAR_API_KEY", "").strip()
    if not key:
        raise SystemExit("LINEAR_API_KEY is required")
    payload = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={"Authorization": key, "Content-Type": "application/json", "User-Agent": "entity-phase2-loader/1.0"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    if data.get("errors"):
        raise RuntimeError(json.dumps(data["errors"], indent=2))
    return data["data"]


def get_workspace() -> dict[str, Any]:
    q = """query($project:String!, $team:String!) {
      projects(filter:{name:{eq:$project}}, first:5){ nodes { id name url teams { nodes { id key name } } } }
      issueLabels(first:200){ nodes { id name } }
      workflowStates(filter:{team:{key:{eq:$team}}}, first:50){ nodes { id name type } }
      issues(filter:{project:{name:{eq:$project}}, title:{startsWith:"Entity Phase 2"}}, first:250) {
        nodes { id identifier title url description project { id name } team { key } state { id name type } parent { id identifier title } }
      }
    }"""
    data = gql(q, {"project": PROJECT_NAME, "team": TEAM_KEY})
    project_nodes = data["projects"]["nodes"]
    if not project_nodes:
        raise SystemExit(f"Project not found: {PROJECT_NAME}")
    project = project_nodes[0]
    team = next((t for t in project["teams"]["nodes"] if t["key"] == TEAM_KEY), None)
    if not team:
        raise SystemExit(f"Project {PROJECT_NAME} is not attached to team {TEAM_KEY}")
    labels = {l["name"]: l["id"] for l in data["issueLabels"]["nodes"]}
    states = {s["name"]: s["id"] for s in data["workflowStates"]["nodes"]}
    issues = data["issues"]["nodes"]
    return {"project": project, "team": team, "labels": labels, "states": states, "issues": issues}


def make_description(parent: dict[str, Any], child: tuple[str, str, str, list[str], list[str]]) -> str:
    key, title, what, acceptance, proof = child
    blocker = "None - can start immediately" if parent["identifier"] == "THE-6" else "THE-6 Slice 0 inventory/gap matrix should be complete before code-changing work."
    acceptance_md = "\n".join(f"- [ ] {item}" for item in acceptance)
    proof_md = "\n".join(f"- [ ] {item}" for item in proof)
    return f"""## Parent

{parent['identifier']} — {parent['short']}

{CONTEXT_BLOCK}

## What to build

{what}

## Acceptance criteria

{acceptance_md}

## Proof required

{proof_md}

## Blocked by

{blocker}

## Source coverage

This child issue is part of the full Entity Phase 2 PRD/spec decomposition, not a standalone idea. It traces to:

- `docs/specs/entity-phase-2-prd-canonical-20260620.md`
- `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
- Linear parent epic `{parent['identifier']}`

## Not done until

A Cursor/local agent can attach concrete proof to this Linear issue: changed files, test/build output, and browser/DOM/screenshot receipts for UI-facing work.
"""


def make_markdown(receipt: dict[str, Any]) -> str:
    lines = [
        "# Entity Phase 2 Linear Issue Map",
        "",
        "Generated: 2026-06-20",
        f"Linear project: {receipt['project']['name']} — {receipt['project']['url']}",
        f"Team: {receipt['team']['key']} ({receipt['team']['name']})",
        "",
        "## Summary",
        "",
        f"- Parent epics: {receipt['parent_count']}",
        f"- Child implementation issues planned: {receipt['child_count']}",
        f"- Created: {receipt['created_count']}",
        f"- Updated/skipped existing: {receipt['updated_count']}",
        "",
        "## Repo-native context",
        "",
        "- `AGENTS.md`",
        "- `.cursor/rules/entity-phase-2.mdc`",
        "- `docs/context/entity-phase-2-build-context.md`",
        "- `docs/specs/entity-phase-2-prd-canonical-20260620.md`",
        "- `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`",
        "",
        "## Parent / child graph",
        "",
    ]
    for parent in receipt["parents"]:
        lines += [f"### {parent['identifier']} — {parent['short']}", "", f"Parent URL: {parent.get('url','')}", ""]
        for child in parent["children"]:
            lines.append(f"- {child['identifier']} — {child['title']} — {child['url']}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    workspace = get_workspace()
    project = workspace["project"]
    team = workspace["team"]
    feature_label_id = workspace["labels"].get(FEATURE_LABEL)
    if not feature_label_id:
        raise SystemExit(f"Missing label: {FEATURE_LABEL}")
    todo_state_id = workspace["states"].get("Todo")
    if not todo_state_id:
        raise SystemExit("Missing Todo state")

    existing_by_title = {i["title"]: i for i in workspace["issues"]}
    parents_by_identifier = {i["identifier"]: i for i in workspace["issues"] if not i.get("parent") and i["identifier"].startswith("THE-")}

    create_mut = """mutation($input: IssueCreateInput!) { issueCreate(input:$input) { success issue { id identifier title url parent { identifier } project { name } } } }"""
    update_mut = """mutation($id:String!, $input:IssueUpdateInput!) { issueUpdate(id:$id, input:$input) { success issue { id identifier title url parent { identifier } project { name } } } }"""

    receipt: dict[str, Any] = {
        "project": {"id": project["id"], "name": project["name"], "url": project["url"]},
        "team": {"id": team["id"], "key": team["key"], "name": team["name"]},
        "parent_count": len(PARENTS),
        "child_count": sum(len(p["children"]) for p in PARENTS),
        "created_count": 0,
        "updated_count": 0,
        "parents": [],
    }

    for parent in PARENTS:
        parent_issue = parents_by_identifier.get(parent["identifier"])
        if not parent_issue:
            raise SystemExit(f"Missing parent issue {parent['identifier']}")
        parent_entry = {"identifier": parent["identifier"], "short": parent["short"], "url": parent_issue["url"], "children": []}
        for child in parent["children"]:
            key, child_short_title, *_ = child
            title = f"Entity Phase 2 — {key}: {child_short_title}"
            desc = make_description(parent, child)
            existing = existing_by_title.get(title)
            input_data = {
                "teamId": team["id"],
                "projectId": project["id"],
                "parentId": parent_issue["id"],
                "stateId": todo_state_id,
                "labelIds": [feature_label_id],
                "priority": 3,
                "title": title,
                "description": desc,
            }
            if existing:
                data = gql(update_mut, {"id": existing["id"], "input": input_data})["issueUpdate"]["issue"]
                receipt["updated_count"] += 1
                action = "updated"
            else:
                data = gql(create_mut, {"input": input_data})["issueCreate"]["issue"]
                receipt["created_count"] += 1
                action = "created"
                time.sleep(0.15)
            parent_entry["children"].append({"key": key, "id": data["id"], "identifier": data["identifier"], "title": child_short_title, "url": data["url"], "action": action})
            print(f"{action}: {data['identifier']} parent={parent['identifier']} title={title}")
        receipt["parents"].append(parent_entry)

    # Add simple sibling dependency relations inside each parent: child N blocks child N+1.
    # This keeps Cursor/Linear sequencing explicit without overfitting cross-epic dependencies.
    relation_mut = """mutation($input: IssueRelationCreateInput!) { issueRelationCreate(input:$input) { success issueRelation { id type issue { identifier } relatedIssue { identifier } } } }"""
    relation_count = 0
    relation_errors: list[dict[str, str]] = []
    for parent_entry in receipt["parents"]:
        children = parent_entry["children"]
        for left, right in zip(children, children[1:]):
            try:
                # type=blocks means left blocks right.
                rel = gql(relation_mut, {"input": {"type": "blocks", "issueId": left["id"], "relatedIssueId": right["id"]}})
                if rel["issueRelationCreate"]["success"]:
                    relation_count += 1
            except Exception as exc:
                # Relation may already exist on idempotent reruns. Keep the issue load successful.
                relation_errors.append({"from": left["identifier"], "to": right["identifier"], "error": str(exc)[:500]})
    receipt["relation_count"] = relation_count
    receipt["relation_errors"] = relation_errors

    OUT_JSON.write_text(json.dumps(receipt, indent=2) + "\n")
    OUT_MD.write_text(make_markdown(receipt))
    print(f"receipt_json={OUT_JSON}")
    print(f"receipt_md={OUT_MD}")
    print(f"created={receipt['created_count']} updated={receipt['updated_count']} children={receipt['child_count']} relations={relation_count} relation_errors={len(relation_errors)}")


if __name__ == "__main__":
    main()
