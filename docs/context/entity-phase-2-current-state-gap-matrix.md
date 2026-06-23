# Entity Phase 2 Current-State Gap Matrix

**Linear issue:** `THE-25` / source `THE-6.5`  
**Date:** 2026-06-23  
**Scope:** Consolidated Slice 0 gap matrix and dependency map for downstream Entity Phase 2 implementation tickets.

This document consolidates the read-only inventories from `THE-21` through `THE-24`. It is a binding current-state reference for later Phase 2 slices until superseded by implementation-specific migration docs. It does not change source schema, mutate production data, call external connector writes, or claim that Phase 2 implementation is complete.

## Inputs

- `docs/context/entity-phase-2-current-schema-inventory.md` (`THE-21`)
- `docs/context/entity-phase-2-activity-provenance-inventory.md` (`THE-22`)
- `docs/context/entity-phase-2-review-proof-inventory.md` (`THE-23`)
- `docs/context/entity-phase-2-integration-boundary-inventory.md` (`THE-24`)
- `docs/specs/entity-phase-2-prd-canonical-20260620.md`
- `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`
- Live Linear child issue `THE-25` and parent epic `THE-6`

## Executive Summary

Entity already has useful seams for tasks, projects, activity display, review metadata, output links, document/file sources, agent registry, ClickClack compatibility, service health, and plugin proof bundles. The system is not blank slate.

The confirmed Phase 2 gap is that these seams are fragmented and mostly not yet first-class Phase 2 objects. Core work-plane concepts still need additive schema/service work before strict enforcement:

- No foundational org/team/request-scoping seam exists.
- Task accountability is display-string based: initiator, owner, executor, submitted-by, reviewer, and approver are not unified principal references.
- Activity/provenance exists, but it is generic, loosely typed, and split across `activities`, `agent_log`, comments, history, file sync runs, document collaboration tables, and plugin proof tables.
- Review/proof data is mostly mutable task metadata and output text rather than durable Review, HumanGate, EvidenceArtifact, receipt metadata, and immutable receipt body records.
- Integration readiness exists only as adjacent service/source/sidecar health. Helm, ClickClack refs, Google Docs/Drive refs, notifications, and connector permission state are not yet normalized into Phase 2 contracts.
- Permissions, search envelopes, notifications, migration confidence/provenance, and cleanup queues need dedicated model work before they can safely consume snippets, previews, activity, proof, or connector state.

## Confirmed Gap Matrix

| Area | Current confirmed state | Target Phase 2 state | Gap severity | Primary downstream tickets |
|---|---|---|---:|---|
| Org scoping | No `orgs` table, request org binding, or mandatory org predicates in task/project/document/search routes. | Every task, project, document, artifact, activity, search result, notification, and connector ref is org-scoped by construction. | Critical | `THE-26`, `THE-27`, `THE-61`, `THE-62` |
| Team/project hierarchy | `projects` are flat labels plus `task_projects`; no required Team; project lacks lifecycle, owner, default policy, sensitivity, and derived health. | Org -> Team -> Project -> Task hierarchy with project lifecycle and derived health. | High | `THE-26`, `THE-27`, `THE-30` |
| Principal model | Agent registry and service-auth actors exist, but no unified human/agent/system/workflow principal table. Task actors are mostly strings. | Unified principal references for humans, agents, systems, workflows, imports, and external events. | High | `THE-26`, `THE-28`, `THE-71` |
| Task accountability | `tasks.assignee` doubles as assignment/ownership; no required initiator, owner, executor, submitted-by, approver, or policy result fields. | Required initiator and individual owner; executable assignment/executor state; submitted-by, reviewer, and approver separated. | Critical | `THE-28`, `THE-30`, `THE-48`, `THE-49` |
| Universal task state | `tasks.column` already uses `backlog`, `todo`, `doing`, `review`, `done`; blocked/archived/output are adjacent fields. | Universal lifecycle plus explicit modifiers, worktype overlays, policy projections, and receipt status. | Medium | `THE-28`, `THE-31`, `THE-56` |
| Worktype overlays | No worktype registry or typed overlay schema. Metadata may carry conventions but is not authoritative. | Versioned worktype registry with allowed overlay fields, defaults, risk contribution, indexability, and sensitivity. | High | `THE-56` through `THE-60` |
| ActivityEvent envelope | `activities` is visible and per-task queryable, but has coarse `source`, narrow `type`, display actors, and JSON metadata. Unknown types normalize loosely. | Org-scoped ActivityEvent with stable event type enum, actor principal/type, typed payload, reason, and policy reason chain. | Critical | `THE-31`, `THE-32`, `THE-33` |
| Activity producers | Task routes, comments, Task Master tools, agent logs, file sync runs, document collaboration, and plugin proof tables all write separate provenance-like data. | One canonical activity/provenance source for task routing, review, receipt, notification, connector, and artifact events, with migration inputs labeled. | High | `THE-32`, `THE-33`, `THE-35`, `THE-88` |
| Completion-blocked events | Transition failures return API errors; blocked completion and receipt failures are not durably recorded. | `completion_blocked`, `receipt_failed`, and retry/recovery events are recorded and visible. | High | `THE-31`, `THE-35`, `THE-38` |
| Review packet shape | `tasks.metadata.review_packet` / `review_brief` stores requested outcome, evidence, criteria, reviewer, risk, submitted-by, and decisions as mutable JSON. | First-class Review plus normalized evidence fields, reason chains, assignment provenance, and immutable source artifact links. | Critical | `THE-46`, `THE-47`, `THE-48`, `THE-49` |
| Human gate model | Legacy human-required metadata flags exist; no generic human gate object, approver field, side-effect model, or gate-before-done record. | Human gate separate from review with approver, decision, side effects covered, and gate-before-done ordering. | Critical | `THE-46`, `THE-49`, `THE-50` |
| Evidence artifacts | Task output text, parsed links, file index rows, document data, and plugin proof bundles exist but are not stable EvidenceArtifact records. | EvidenceArtifact with artifact kind, stable path/identity, content hash, provenance, mutability policy, integrity state, and object refs. | Critical | `THE-36`, `THE-41`, `THE-42`, `THE-88` |
| Canonical receipts | No receipt metadata, markdown body, receipt hash, integrity state, receipt failure state, or receipt event exists for Mission Control tasks. | Completed `entity-mc` tasks write immutable receipt body plus transactional metadata before clean `done`. | Critical | `THE-36`, `THE-37`, `THE-38`, `THE-40` |
| Output links | `tasks.output` is both summary text and proof-link carrier; link normalization can route supported paths into Entity docs URLs. | Output summaries, evidence refs, artifact IDs, and object refs are separated. | High | `THE-37`, `THE-41`, `THE-42`, `THE-88` |
| Native documents | Document collaboration tables and file index provide useful seams, but no NativeDocument object with mutability, ACL, linked refs, and org scope. | NativeDocument first-class markdown object with versioning/mutability and object refs. | High | `THE-41`, `THE-43`, `THE-44`, `THE-45` |
| External document refs | File sources/index support local/docsify/http-markdown and placeholder adapters; no first-class Google Docs/Drive connector or ExternalDocumentRef. | ExternalDocumentRef with connector auth/readiness, external permission summary, Entity visibility policy, and no default write behavior. | High | `THE-41`, `THE-81`, `THE-82`, `THE-83`, `THE-84` |
| ObjectRef links | Current links are strings, URLs, docs paths, task IDs, file paths, and plugin proof refs. | Explicit `{ object_type, object_id, link_role }` references wherever objects are linked. | High | `THE-41`, `THE-42`, `THE-77` |
| RBAC and sensitivity | Module grants, auth scopes, path checks, and file-source auth references exist, but no layered org/team/project/object sensitivity evaluator. | Layered RBAC plus object sensitivity and ACLs applied before snippets, previews, activity, artifacts, notifications, and connector refs render. | Critical | `THE-61`, `THE-62`, `THE-63`, `THE-65` |
| Search envelope | File search and route-level search exist, but no unified object envelope or permission-state-first rendering. | Global/scoped search across tasks, docs, artifacts, external refs, activity, planning objects, people/agents, and eligible chat refs. | High | `THE-64`, `THE-65` |
| Notifications | Frontend toasts/history are in-memory; activity rows and WebSocket broadcasts provide best-effort notification-like behavior. | Durable canonical notification/inbox record before route attempts, with delivery status, failure/degraded state, object refs, and policy reason. | Critical | `THE-66`, `THE-67`, `THE-68`, `THE-69`, `THE-70` |
| Task Master routing | Task-agent scans and tools nudge/escalate through comments, activity, and agent logs; no first-class claim/nudge/escalation/reassignment events. | Policy projections and auditable claim, nudge, owner escalation, auto-reassignment, and no-takeover behavior. | High | `THE-51`, `THE-52`, `THE-53`, `THE-54`, `THE-55` |
| Helm boundary | No dedicated Helm adapter. Agent registry, service health, runtime config, and swarm providers are adjacent status/control seams. | Helm-backed runtime binding/status adapter with safe light controls only, without sensitive runtime config in Entity. | High | `THE-71`, `THE-72`, `THE-73`, `THE-74`, `THE-75` |
| ClickClack boundary | Sidecar pin, dev launcher, proxy routes, and optional chat bridge exist. Bridge can create sidecar workspace/channel/bots when enabled. | Entity-owned ClickClack readiness and thread/channel refs with work-object permissions; core docs/proof/review unaffected when unavailable. | Medium | `THE-76`, `THE-77`, `THE-78`, `THE-79`, `THE-80` |
| Google Docs/Drive posture | No Google-specific connector found; current file-source layer is adjacent and partly placeholder-backed. | Read-only/index/link/preview V1 connector with explicit auth/readiness and no default create/update/export/sync mutation. | High | `THE-81`, `THE-82`, `THE-83`, `THE-84`, `THE-85` |
| Migration confidence | Legacy data can be inferred from task/project/activity/comment/metadata sources, but confidence/provenance is not stored. | Dry-run inventory, inferred fields with source/confidence, cleanup queues, and no fabricated raw receipts. | Critical | `THE-86`, `THE-87`, `THE-88`, `THE-89`, `THE-90` |
| Observability/proof gates | Existing proof commands and CLI Tester receipts exist outside product runtime; product observability for receipts/review/search/integrations is not unified. | Feature flags, observability, first-session proof suite, boundary release checks, rollback checklist. | High | `THE-91` through `THE-95` |

## Dependency-Safe Implementation Order

The recommended order below is dependency-driven. A later issue may read this matrix, but it should not enforce stricter behavior until its listed prerequisites exist and pass proof.

1. `THE-26` through `THE-30`: Add foundational org/team/project/principal/accountability fields and backfill posture first. These are prerequisites for request scoping, ActivityEvent scope, permissions, search, notifications, connector refs, and receipts.
2. `THE-31` through `THE-35`: Establish ActivityEvent schema/service/migration before receipt, review, routing, notification, or connector events depend on it.
3. `THE-36` through `THE-40`: Add receipt artifact metadata and receipt writer after activity events can record artifact/receipt/completion outcomes.
4. `THE-41` through `THE-45`: Add NativeDocument, ExternalDocumentRef, EvidenceArtifact, ObjectRef, markdown storage, and migration seams so proof/docs/search can distinguish object kinds.
5. `THE-46` through `THE-50`: Add policy, review assignment, human gate, and gate-before-done ordering once task accountability and artifact/event seams exist.
6. `THE-51` through `THE-55`: Implement Task Master routing projections and events after ActivityEvent and policy results exist.
7. `THE-56` through `THE-60`: Add worktype registry and overlays before search filters and risk-sensitive policy rely on overlay values.
8. `THE-61` through `THE-65`: Implement RBAC/sensitivity and search envelope before showing snippets/previews/activity/artifacts/connector data broadly.
9. `THE-66` through `THE-70`: Implement durable notifications/inbox after ActivityEvent, ObjectRef, policy, and permissions can provide safe inputs.
10. `THE-71` through `THE-85`: Implement Helm, ClickClack, and Google Docs/Drive integration slices after object refs, permissions, and degraded-state conventions are in place.
11. `THE-86` through `THE-90`: Run migration/backfill after target fields/events/artifacts exist, preserving confidence and non-fabrication rules.
12. `THE-91` through `THE-95`: Add feature flags, observability, proof suite, boundary release checks, rollback, and release checklist only after the capability slices exist.

## Downstream Blocker References

Downstream child issues should cite this document in their implementation notes and proof comments when relying on Slice 0 findings. Use these references as the current-state blocker list:

| Downstream area | Blocker to clear before enforcement | Gap matrix reference |
|---|---|---|
| Workspace hierarchy/accountability | No org/request seam, no Team, no unified principal/accountability refs. | Confirmed Gap Matrix: Org scoping, Team/project hierarchy, Principal model, Task accountability |
| ActivityEvent spine | Existing provenance is generic and split across multiple stores. | Confirmed Gap Matrix: ActivityEvent envelope, Activity producers, Completion-blocked events |
| Canonical receipts | No stable EvidenceArtifact/receipt metadata/body/hash/integrity fields. | Confirmed Gap Matrix: Evidence artifacts, Canonical receipts, Output links |
| Docs/files/artifacts | Native docs, external refs, evidence artifacts, and object refs are not distinct objects yet. | Confirmed Gap Matrix: Native documents, External document refs, Evidence artifacts, ObjectRef links |
| Review/policy/human gate | Current review is mutable metadata and legacy human-required flags. | Confirmed Gap Matrix: Review packet shape, Human gate model, Task accountability |
| Task Master routing | Current routing evidence is split across comments, activities, and agent logs. | Confirmed Gap Matrix: Task Master routing, Activity producers |
| Worktypes/search/permissions | No worktype registry; no layered RBAC/sensitivity/search envelope. | Confirmed Gap Matrix: Worktype overlays, RBAC and sensitivity, Search envelope |
| Notifications | No durable notification/inbox/delivery route records. | Confirmed Gap Matrix: Notifications |
| Integrations | Current status is adjacent service/source/sidecar health, not normalized contracts. | Confirmed Gap Matrix: Helm boundary, ClickClack boundary, Google Docs/Drive posture |
| Migration/backfill | Historical certainty is not available for many fields and receipts must not be fabricated. | Confirmed Gap Matrix: Migration confidence |

## Confirmed Inputs for Migration

Use these as migration sources, each with explicit source/confidence metadata:

- `tasks`, `projects`, and `task_projects` for task and project mapping.
- `tasks.metadata`, especially review packet fields, as compatibility input only.
- `tasks.output` and parsed output links as candidate evidence references, not stable artifact truth.
- `activities` as the visible activity stream and primary candidate provenance source.
- `agent_log` as Task Master and review-hygiene operational evidence.
- `task_comments` and `task_history` as contextual/provenance inputs, not canonical by themselves.
- `file_sources`, `file_index`, and `file_sync_runs` as document/source/search/connector readiness inputs.
- `document_*` collaboration tables as NativeDocument/domain provenance inputs.
- `swarm_jobs` and `swarm_proofs` as plugin-owned proof bundle inputs.

Do not use these inputs to invent certainty. Missing owner, unknown initiator, missing assignee, weak activity structure, missing receipt, ambiguous project/team, and uncertain permission mapping must remain warnings or cleanup items until resolved.

## Task Accountability Compatibility Note

`THE-28` adds additive task accountability fields for initiator, owner, executor, assignment state, and Task-Master-drivable state. New task API writes enforce initiator and individual owner, reject team ownership as final task ownership, and require active executable work to have an individual assignee/executor or explicit Task-Master-drivable unassigned state.

Legacy repository-created or historical tasks remain readable. When historical rows do not have accountable principals yet, Entity exposes compatibility markers such as `legacy-unknown`, `legacy-owner`, `unknown`, and `routing_problem` rather than fabricating certainty. `THE-30` and later migration/backfill tickets remain responsible for safe inference, confidence/provenance, and cleanup queues.

## Open Product and Architecture Decisions

These are not confirmed gaps; they are decisions that later tickets must resolve or keep configurable:

- Whether initial `principals` are represented in the existing Entity DB as one table or projected from users/agents/system actors plus a compatibility view.
- How strict new task invariants should be staged for existing data versus new tasks.
- Whether ActivityEvent should be an additive evolution of `activities`, a new table with compatibility projection, or a hybrid during migration.
- The exact storage backend for immutable receipt markdown bodies and NativeDocument markdown.
- The final policy storage format for layered review, human gate, notification, Task Master, and risk decisions.
- Default worktype overlay vocabularies and risk contributions for sales, customer-success, people/HR, and ops.
- How reviewer pools and availability are represented for automatic reviewer assignment.
- Exact Helm API shape and safe light-control authorization contract.
- Exact Google Docs/Drive scopes and connector account model.
- Notification channel priority, delivery retry policy, and recipient preference model.
- Search backend choice and index freshness observability.

## Non-Claims

- This matrix does not claim any downstream implementation ticket is complete.
- This matrix does not create org/team/project/principal/receipt/review/notification tables.
- This matrix does not assert that historical completed tasks have canonical receipts.
- This matrix does not authorize external document mutation, runtime/admin control, or credential exposure in Entity.
- This matrix does not replace the live Linear issue body for each downstream child issue.

## Acceptance Mapping

- Gap matrix covers schema: yes.
- Gap matrix covers ActivityEvent: yes.
- Gap matrix covers review/proof/receipt-like outputs: yes.
- Gap matrix covers integrations: yes.
- Gap matrix covers permissions/search: yes.
- Gap matrix covers notifications: yes.
- Gap matrix covers migration/backfill: yes.
- Dependencies and recommended order are explicit: yes.
- Open product/architecture decisions are separate from confirmed gaps: yes.
- Downstream blockers reference this gap matrix: yes, see "Downstream Blocker References".
- No implementation-complete claims are made: yes.
