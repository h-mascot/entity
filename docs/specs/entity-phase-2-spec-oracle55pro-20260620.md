# Entity Phase 2 — Agent-Native Work Plane Spec + Implementation Ticket Graph

**Owner:** Book
**Requested by:** Henry Mascot
**Date:** 2026-06-20
**Artifact type:** Product specification + technical specification + implementation ticket graph
**Phase:** Entity Phase 2 of 4-phase product/docs/spec roadmap
**Authority:** Attached Grill-Me input packet, Q1–Q43 decisions plus supporting Entity + ClickClack + Helm scope/design docs
**Cutline:** This artifact specifies the product, architecture, contracts, migration, rollout, risks, and tickets. It does **not** claim that any code has been built, tested, deployed, or proven.

---

## 1. Title block and provenance

# Entity Phase 2 — Agent-Native Work Plane Spec + Implementation Ticket Graph

Entity Phase 2 defines the next productized version of Entity as an **agent-native work plane / workspace OS for human-agent teams**.

The source of truth for this spec is the attached input packet. Where context conflicts, this spec follows the newest explicit correction in Q1–Q43.

### Settled constraints

Entity is **not just Mission Control**. Mission Control/task review is a major wedge, but Entity is the broader work plane where humans and agents manage work, docs, files, evidence, review, activity, collaboration, and agent participation.

Paperclip is an **external competitor/reference**, not a Crew product, Entity layer, orchestration system, or internal module.

There is **no Curacel demo in this phase**. Curacel is a likely design-customer / pilot context and useful evidence for business-ops workflows and Google Docs usage. Phase 2 is a spec + implementation ticket graph, not a Curacel demo build.

Entity, Helm, and ClickClack are separate surfaces:

* **Entity** owns the human-agent work plane: workspace hierarchy, tasks, docs/files/artifacts, proof, review, permissions, search, activity, work object context, and collaboration around work.
* **Helm** owns runtime/admin control: runtimes, models, credentials, schedules/crons/loops, tools, health, deployment/admin knobs, and operational configuration.
* **ClickClack** owns chat/collaboration primitives where integrated: channels, threads, composer, bridge/proxy behavior. Entity owns work-object context and permissions around those integrations.

OpenClaw and Hermes are **runtime/providers**, not Entity. Entity must be runtime-agnostic. Helm may manage OpenClaw, Hermes, or other providers, but Entity must not hard-code them as the only execution substrate.

### Phase 2 deliverable

Phase 2 produces:

1. Product framing.
2. Technical architecture.
3. Core data/schema model.
4. API/service contracts.
5. Policy/review/receipt model.
6. Permissions/RBAC model.
7. Integration contracts.
8. Migration/backfill plan.
9. Rollout/observability/rollback plan.
10. Hybrid implementation ticket graph with acceptance criteria and proof requirements.

Phase 2 does **not** require prototype code, a production deployment, a Curacel demo, or destructive migration.

---

## 2. Executive decision

Entity Phase 2 should productize Entity into a **multi-user, multi-org, agent-native work plane** for companies where humans and agents do real business work together.

The first trust wedge is **proof-backed agent work review**: humans and eligible agents can inspect what an agent did, inspect receipts, review evidence, approve, request fixes, and preserve context.

The first workflow context is **business operations**: sales, people, and customer success. This matters because Entity cannot look like an engineering-only task board. Non-engineering teams need plans, account workflows, customer follow-up, people/admin checklists, research packets, approvals, and external-send gates.

The product is non-greenfield. The input packet says existing Entity surfaces include Mission Control/tasks, files/source APIs, documents, agents registry/status/activity, plugins/services, worktype paths, ClickClack bridge/proxy/chat direction, desktop/mobile shells, review/proof packet model, Task Master design, live runtime API, and private task DB/backups. The packet also says existing Helm surfaces include config/onboarding/effective config, agent registry providers, OpenClaw/admin control, Schedule Manager/cron-health, AgentPush events/escalation, runtime/deployment docs, and packaging/productization work.

Phase 2 therefore specifies **consolidation and productization**, not a blank-slate rewrite.

### Product decision

Build Entity around five durable pillars:

1. **Workspace hierarchy:** orgs, teams, projects, tasks, optional goals/plans/specs.
2. **Agent-native execution:** humans and agents are first-class principals; Task Master routes, claims, nudges, escalates, and reassigns according to policy.
3. **Evidence-first work:** every completed `entity-mc` task gets a minimal canonical markdown receipt synchronously at completion.
4. **Review and human gates:** review is policy-based by worktype/risk; human gates protect external sends, people/HR actions, customer commitments, legal/financial exposure, production/security changes, and other high-risk classes.
5. **Integrated but bounded surfaces:** Entity integrates with Helm, ClickClack, Google Docs, and runtime providers through explicit contracts without collapsing into them.

### Technical decision

Use a layered architecture:

```text
Entity UI / Work Plane
  ├─ Workspace shell
  ├─ Mission Control / task detail / review
  ├─ Docs & files
  ├─ Evidence artifacts / receipts
  ├─ Agent activity
  ├─ Search
  ├─ Notifications / inbox
  ├─ ClickClack-integrated chat panels
  └─ Helm-backed runtime status widgets

Entity API / Services
  ├─ Org/team/project/task service
  ├─ Planning-object service
  ├─ Artifact/document service
  ├─ Receipt writer
  ├─ Activity log service
  ├─ Review/policy resolver
  ├─ Task Master routing service
  ├─ Search indexing service
  ├─ RBAC/sensitivity service
  ├─ Notification router
  ├─ Integration adapters
  └─ Migration/backfill jobs

External / Adjacent Systems
  ├─ Helm: runtime/admin control plane
  ├─ ClickClack: chat substrate
  ├─ Google Drive/Docs: external document refs, read/index/link/preview first
  ├─ Agent runtimes/providers: OpenClaw, Hermes, Codex, Claude Code, others
  └─ AgentPush/webhooks/email/Slack/Discord/etc. for outward notifications
```

### Acceptance posture

A builder should be able to implement this spec without guessing the product boundaries, canonical objects, receipt invariants, review policy, or integration ownership.

A reviewer should reject any implementation that:

* treats Entity as only Mission Control;
* treats Paperclip as internal;
* implies a Curacel demo is part of Phase 2;
* merges Entity and Helm;
* makes ClickClack availability block docs/files/proof/review;
* stores low-level proof only in Google Docs;
* allows completed `entity-mc` tasks without canonical markdown receipts;
* permits self-review where separation of duties forbids it;
* hides missing evidence behind a green status;
* claims implementation proof without actual proof artifacts.

---

## 3. Product framing and non-goals

## 3.1 Product framing

Entity is the **agent-native work plane** for human-agent teams.

The closest category analogy is what G Suite or Microsoft 365 did for human-human organizations, but for organizations where humans and agents collaborate on work. Entity is where a company sees its human and agent workforce, assigns work, reviews output, inspects proof, organizes documents, links external context, searches across work, and coordinates execution.

Entity should feel like a workspace OS, not a dashboard bolted onto an agent runner.

### Product promise

Entity gives teams one place to answer:

* What work exists?
* Who or what initiated it?
* Who owns it?
* Who or what is executing it?
* What did the agent or human do?
* What proof exists?
* Does this need review?
* Does this need a human gate?
* What documents, files, chats, and artifacts belong to it?
* What agent/runtime/provider is involved?
* What is blocked, stalled, escalated, reassigned, approved, or done?
* Can I trust the output?

### First wedge

The first workflow that must be excellent is **proof-backed review of agent work**.

That means Entity must make receipts and evidence obvious, structured, searchable, permissioned, and reviewable. It is not enough to show task status. The product must preserve enough provenance that users can inspect the chain of work.

### First workflow context

The first workflow context is **Ops / Business**, specifically:

* sales;
* people;
* customer success.

This does not mean Entity is only for ops. It means Phase 2 should avoid engineering-only language and should prove that non-engineering work can be represented without forcing every plan into a coding “spec.”

### Deployment model

Entity should be specified as a **multi-user, multi-org product**.

Target posture:

* multi-tenant SaaS;
* enterprise/self-deploy option for companies to run in their own cloud;
* open-source, if used, is early access / trial / distribution, not the long-term strategic core.

Foundational seams:

* org;
* team;
* project;
* principals;
* roles;
* permissions;
* audit;
* data isolation;
* enterprise deploy configuration;
* tenant-safe runtime onboarding;
* connector authorization state.

## 3.2 Product surfaces

Entity Phase 2 should consolidate these surfaces into one coherent work plane:

1. Workspace shell and navigation.
2. Mission Control / tasks.
3. Task detail and review/proof.
4. Docs and files.
5. Evidence artifacts and receipts.
6. External document references.
7. Agent registry/status/activity.
8. Skills/capabilities and recurring work visibility.
9. Task Master routing, nudging, escalation, reassignment.
10. Search.
11. Notifications and inbox.
12. ClickClack-integrated chat where ready.
13. Helm-backed runtime status/light controls.
14. Plugin/worktype surfaces.
15. Migration/backfill and data-quality warnings.

## 3.3 Non-goals

### Not Mission Control only

Mission Control is a wedge and key surface. It is not the whole product.

### Not Helm

Entity does not own runtime/admin control. Helm owns:

* credentials/secrets;
* model/provider configuration;
* cron/schedule editing;
* tool permission grants;
* deployment/admin settings;
* destructive runtime actions;
* billing/org-level runtime policy;
* deep runtime operations.

Entity may show Helm-backed status and safe light controls when policy permits.

### Not ClickClack

ClickClack is the collaboration/chat substrate where integrated. Entity owns work objects, workspace context, permissions, object links, proof/review, and canonical work state.

ClickClack availability must not block Entity docs/files/artifacts/proof/review.

### Not OpenClaw or Hermes

OpenClaw and Hermes are runtimes/providers. Entity consumes runtime-backed agents as collaborators/workers. Entity must remain runtime-agnostic.

### Not Paperclip

Paperclip is an external competitor/reference. It is not Entity, Helm, ClickClack, or any internal Crew product layer.

### Not a Curacel demo

Curacel is design-customer/pilot context and evidence. This phase is the Entity Phase 2 spec + ticket graph.

### Not Google Docs as canonical proof store

Google Docs is an external document system. Entity should link/index/preview Google Docs first. Native Entity markdown is canonical for low-level machine/proof artifacts such as `entity-mc` receipts.

### Not strict migration first

Phase 2 should use progressive migration. Old tasks remain usable. Unknown fields are flagged honestly rather than blocking all usability.

### Not destructive deployment

No destructive DB work, production deployment, or irreversible runtime action belongs in this spec as a required implementation step.

---

## 4. Users, jobs, and workflows

## 4.1 User/principal model

Entity has one unified principal space for humans and agents.

### Human principal

A human principal is a real account with server-verified identity.

Examples:

* sales lead;
* CS manager;
* people ops owner;
* founder/admin;
* reviewer;
* approver;
* team lead.

### Agent principal

An agent principal is a user-added worker/collaborator, not hardcoded.

Examples from the input packet:

* OpenClaw-backed agent;
* Hermes-backed agent;
* Codex;
* Claude Code;
* Task Master;
* other runtime/provider-backed agents.

Agent identity must not imply that a runtime is Entity itself.

### System/workflow/import principal

A system or workflow can initiate work.

Examples:

* automation;
* imported task source;
* external event;
* scheduled loop;
* connector trigger.

Every task must still record initiator and owner according to the task model.

## 4.2 Primary users

### Company/workspace buyer

The product should optimize for company/team workspace adoption, not only single-user hobby usage.

Jobs:

* onboard teams and agents;
* manage permissions and sensitivity;
* preserve auditability;
* connect docs and runtime systems;
* understand risk and productivity.

### Business-ops user

A sales, people, or customer-success user who needs agents to help with operational work.

Jobs:

* create or receive tasks;
* attach customer/company/context docs;
* ask an agent to research, draft, summarize, update, or prepare work;
* inspect what the agent did;
* approve, request fixes, or human-gate risky work;
* search prior evidence and outputs.

### Work owner

The individual accountable for the task outcome.

Jobs:

* ensure work matters and moves;
* respond to escalations;
* resolve stalled/reassigned work;
* override reviewer/approver assignment where authorized;
* accept accountability even when an agent executes.

### Reviewer

A human or eligible agent assigned to judge submitted work.

Jobs:

* inspect receipt and evidence;
* compare output against done criteria;
* accept review or request fixes;
* preserve separation of duties;
* record decision and reason.

### Human approver / gatekeeper

A human required by policy for high-risk work.

Jobs:

* approve or reject external sends;
* approve people/HR actions;
* approve customer-impacting commitments;
* approve legal/financial/security/production-sensitive actions;
* provide auditable gate decision.

### Task Master

Task Master is the board orchestration loop. It routes, gates, and runs the review queue. It is not the universal executor.

Jobs:

* drive unassigned Task-Master-drivable work;
* claim unassigned work by policy;
* nudge stalled assigned principals;
* escalate to owner;
* auto-reassign after thresholds where policy permits;
* preserve routing/provenance;
* assign reviewers according to policy;
* keep review queue moving.

### Admin/operator

An admin handles workspace configuration and runtime/admin links.

Jobs:

* configure org/team/project roles;
* configure connectors;
* manage object sensitivity defaults;
* configure policy thresholds;
* open Helm for deeper runtime/admin control;
* audit notifications, escalations, receipts, and access.

## 4.3 Core jobs to be done

### Job 1 — See the work plane

A user enters Entity and understands the company’s human-agent workspace: teams, projects, tasks, docs, agents, activity, review, proof, search, chat, and runtime readiness.

Acceptance:

* workspace entry does not look like a disconnected set of modules;
* primary navigation names the major surfaces;
* empty states are honest;
* no fake “all green” status.

### Job 2 — Track work as tasks

Every operationally trackable unit maps to a task under Org → Team → Project.

Acceptance:

* a task has required project, initiator, owner, and lifecycle state;
* executable tasks resolve to an individual assignee/executor or to an allowed Task-Master-drivable unassigned policy state;
* tasks can optionally link to Goal, Plan, Spec, or domain-specific plan objects.

### Job 3 — Represent non-engineering work cleanly

Sales, people, CS, and ops workflows should not be forced into engineering “spec” language.

Acceptance:

* non-coding work can use Plan or domain-specific plan labels;
* engineering work can use Spec;
* task core state remains universal;
* worktype overlays can carry sales/CS/people metadata.

### Job 4 — Attach context

Users and agents attach or discover context across NativeDocuments, ExternalDocumentRefs, and EvidenceArtifacts.

Acceptance:

* external Google Docs/Drive items are visibly external and connector-backed;
* Entity-native markdown docs are visibly Entity-owned;
* EvidenceArtifacts are visibly proof/audit artifacts;
* permissions apply consistently to all three.

### Job 5 — Produce proof

Every completed `entity-mc` task creates a minimal canonical markdown receipt.

Acceptance:

* task cannot transition to `done` until receipt DB metadata and markdown body are written;
* receipt names task, assignee/submitted_by, timestamps, worktype, status transition, done criteria if present, evidence summary or “missing evidence,” output artifact links if present, review state/reviewer, and source/provenance;
* missing evidence is explicit.

### Job 6 — Review work

Review is policy-driven by worktype/risk. Reviewers inspect receipts and make decisions.

Acceptance:

* policy resolver produces review_required, reason chain, reviewer target, and human_gate_required when applicable;
* review UI shows accept/request-fix where allowed;
* self-review is blocked according to separation-of-duties;
* peer-agent / Task Master review path preserves existing `entity-mc` review policy for agent work where applicable.

### Job 7 — Human-gate risky work

High-risk actions require a human gate.

Examples:

* external sends;
* HR/people actions;
* customer commitments;
* CRM/customer-impacting updates;
* legal/financial commitments;
* production/security-sensitive work.

Acceptance:

* human gate is separate from review;
* gate reason is visible;
* external side effects are not treated as complete until gate passes.

### Job 8 — Route and recover stalled work

Task Master handles unassigned and stalled work by policy.

Acceptance:

* unassigned Task-Master-drivable tasks can be claimed by Task Master;
* assigned stalled tasks get nudge → owner escalation → policy-based reassignment;
* auto-reassignment occurs only when policy permits and thresholds are exhausted;
* receipts include execution/routing history.

### Job 9 — Search across the workspace

Global search covers work, docs, artifacts, activity, external refs, and integrated chat.

Acceptance:

* users can search globally and filter by object type/source/team/project/worktype/owner/assignee/initiator/state/review/risk/date/connector state;
* permission filtering prevents snippets or metadata leaks;
* evidence and activity are searchable.

### Job 10 — Collaborate in chat without losing work context

ClickClack powers chat where integrated. Entity preserves work-object context.

Acceptance:

* chat readiness is visible;
* degraded ClickClack state does not block work;
* threads/channels link to Entity objects where integrated;
* Entity permissions are respected around object links.

### Job 11 — See agent/runtime status without leaving the work plane

Entity surfaces light Helm-backed status.

Acceptance:

* agent/runtime health, current work, last heartbeat, schedule/loop summary, and deep Helm links are visible where available;
* secrets and deep runtime config remain in Helm;
* safe pause/resume/retry controls are reversible, policy-checked, and audited.

---

## 5. Core object model and hierarchy

## 5.1 Required hierarchy

The settled required hierarchy is:

```text
Org
└─ Team
   └─ Project
      └─ Task              required executable/tracking unit
         ├─ parent Goal?   optional outcome parent/container
         ├─ parent Plan?   optional non-coding planning parent/container
         └─ parent Spec?   optional coding/engineering planning parent/container
```

Task is the universal execution/tracking unit. Everything operationally trackable in Entity becomes or maps to a task.

Goal, Plan, and Spec are optional first-class planning/container objects. They do not replace tasks.

### Conflict resolution

The supporting Task Master design contains an older hierarchy of `Project → Goal → Spec → Task`. The newer Q17/Q18 decisions supersede it for Phase 2:

* Org → Team → Project are required.
* Task is required.
* Goal, Plan, and Spec are optional.
* Plan is for non-coding planning.
* Spec is for coding/engineering planning.
* Domain labels can sit on top of Plan/Spec semantics.

## 5.2 Object summary

| Object              |                                Required? | Owner                                      | Purpose                                    |
| ------------------- | ---------------------------------------: | ------------------------------------------ | ------------------------------------------ |
| Org                 |                                      Yes | Entity                                     | Company/workspace tenant boundary          |
| Team                |                                      Yes | Entity                                     | Department/team scope under org            |
| Project             |                                      Yes | Entity                                     | Durable work container under team          |
| Task                |                                      Yes | Entity                                     | Universal executable/tracking unit         |
| Goal                |                                 Optional | Entity                                     | Outcome parent/container                   |
| Plan                |                                 Optional | Entity                                     | Non-coding planning object                 |
| Spec                |                                 Optional | Entity                                     | Coding/engineering planning object         |
| DomainPlan          |                                 Optional | Entity                                     | Domain label over Plan semantics           |
| NativeDocument      |                                 Optional | Entity                                     | Entity-owned markdown/doc object           |
| ExternalDocumentRef |                                 Optional | Entity pointer to external owner           | External doc link/index/preview metadata   |
| EvidenceArtifact    | Required for completed `entity-mc` tasks | Entity                                     | Proof/audit/receipt object                 |
| ActivityEvent       |                  Required for provenance | Entity                                     | Structured task/work history               |
| Review              |                            Policy-driven | Entity                                     | Review decision and reason                 |
| HumanGate           |                            Policy-driven | Entity                                     | Human approval decision for high-risk work |
| Notification        |                             Event-driven | Entity                                     | Canonical notification/inbox record        |
| Agent               |                       Optional principal | Entity identity, runtime via Helm/provider | Agent worker/collaborator                  |
| RuntimeProviderRef  |                                 Optional | Helm/provider                              | Runtime/provider identity/status reference |
| ClickClackThreadRef |                                 Optional | ClickClack pointer                         | Chat thread/channel link                   |

## 5.3 Org

### Purpose

Tenant/company boundary for SaaS and enterprise deployment.

### Key fields

```ts
type Org = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "archived";
  deployment_mode: "saas" | "enterprise_self_deploy";
  created_at: string;
  updated_at: string;
  default_policy_id?: string;
  data_region?: string;
  plan_key?: string;
};
```

### Requirements

* All teams, projects, tasks, documents, artifacts, activity, search records, and notifications are org-scoped.
* Cross-org data leakage is a hard failure.
* Enterprise deployment seams must not be retrofitted later.

## 5.4 Team

### Purpose

Department/team scope under an org.

Examples:

* sales;
* people;
* customer success;
* ops;
* engineering;
* design.

### Key fields

```ts
type Team = {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "archived";
  default_project_id?: string;
  default_policy_id?: string;
  supported_worktypes: string[];
  created_at: string;
  updated_at: string;
};
```

### Requirements

* Teams can own projects, queues, reviewer pools, and intake routes.
* Teams cannot be final accountable task owners.
* Each task must resolve to an individual owner.

## 5.5 Project

### Purpose

Durable required work container under a team.

### Key fields

```ts
type Project = {
  id: string;
  org_id: string;
  team_id: string;
  name: string;
  slug: string;
  description?: string;
  lifecycle_state: "draft" | "active" | "paused" | "review" | "complete" | "archived" | "cancelled";
  owner_principal_id?: string;
  default_policy_id?: string;
  sensitivity?: SensitivityClass;
  created_at: string;
  updated_at: string;
};
```

### Requirements

* Every task belongs to exactly one project.
* Project can have an owner, but this does not replace individual task owner.
* Project permissions inherit from org/team and can be tightened by object sensitivity.

## 5.6 Task

### Purpose

Universal executable/tracking unit.

### Required fields

A task must record:

* org;
* team;
* project;
* title;
* universal core state;
* initiator;
* owner;
* created_by;
* worktype;
* sensitivity/risk fields;
* activity log;
* policy resolution result;
* receipt linkage once completed by `entity-mc`.

### Core state

```text
backlog → todo → doing → review → done
              ↘ cancelled / blocked / paused as policy/status modifiers
```

### Key fields

```ts
type Task = {
  id: string;
  org_id: string;
  team_id: string;
  project_id: string;

  title: string;
  description?: string;

  lifecycle_state: "backlog" | "todo" | "doing" | "review" | "done";
  status_modifier?: "blocked" | "paused" | "cancelled";
  worktype: string;
  worktype_overlay?: Record<string, unknown>;

  parent_task_id?: string;
  goal_ids?: string[];
  plan_ids?: string[];
  spec_ids?: string[];

  created_by_principal_id: string;
  initiator_principal_id: string;
  initiator_type: "human" | "agent" | "workflow" | "automation" | "imported_system" | "external_event" | "unknown";
  initiator_source_ref?: string;

  owner_principal_id: string;

  assignee_principal_id?: string;
  executor_principal_id?: string;
  assignment_state: "unassigned" | "assigned" | "claimed" | "routing_problem";
  taskmaster_drivable: boolean;

  submitted_by_principal_id?: string;

  priority?: "low" | "normal" | "high" | "urgent";
  risk_level?: "low" | "medium" | "high" | "critical";
  sensitivity?: SensitivityClass;
  external_side_effects?: ExternalSideEffect[];

  due_at?: string;
  sla_policy_id?: string;

  done_criteria?: DoneCriterion[];

  review_required: boolean;
  review_reason?: string;
  review_reason_chain?: PolicyReason[];
  reviewer_principal_id?: string;
  review_decision?: "pending" | "accepted" | "request_fix" | "skipped_by_policy";
  review_decision_reason?: string;

  human_gate_required: boolean;
  human_gate_reason?: string;
  approver_principal_id?: string;
  human_gate_decision?: "pending" | "approved" | "rejected" | "not_required";

  receipt_artifact_id?: string;
  receipt_status?: "not_required_yet" | "pending" | "created" | "failed" | "integrity_error";
  receipt_error?: string;

  migration_status?: MigrationStatus;

  created_at: string;
  updated_at: string;
  completed_at?: string;
};
```

### Required principal distinctions

The following are distinct concepts:

* `created_by`: actor who created the task record.
* `initiator`: who/what requested the work.
* `owner`: individual accountable for outcome.
* `assignee`: individual human/agent assigned to execute.
* `executor`: individual human/agent that actually executes.
* `submitted_by`: principal that submitted for review.
* `reviewer`: principal assigned to review.
* `approver`: human assigned to gate high-risk work.

### Owner

Owner is required and must be an individual principal. Team ownership is not allowed as final task accountability.

### Assignee/executor

Assignee/executor should be individual principal only for executable tasks.

Unassigned tasks are allowed only when policy marks them as Task-Master-drivable. When Task Master claims such a task, the task’s current executor becomes Task Master, and the original unassigned state remains in activity history.

## 5.7 Goal

### Purpose

Optional outcome container.

### Key fields

```ts
type Goal = {
  id: string;
  org_id: string;
  team_id: string;
  project_id: string;
  title: string;
  description?: string;
  lifecycle_state: PlanningLifecycleState;
  derived_health: DerivedHealth;
  owner_principal_id?: string;
  linked_task_ids?: string[];
  linked_artifact_ids?: string[];
  created_at: string;
  updated_at: string;
};
```

## 5.8 Plan

### Purpose

Optional bigger-than-task planning object for non-coding work.

Examples:

* account plan;
* CS escalation plan;
* hiring plan;
* people ops process;
* campaign;
* customer renewal plan;
* onboarding plan.

### Key fields

```ts
type Plan = {
  id: string;
  org_id: string;
  team_id: string;
  project_id: string;
  domain_label?: string;
  worktype: string;
  title: string;
  description?: string;
  lifecycle_state: PlanningLifecycleState;
  derived_health: DerivedHealth;
  owner_principal_id?: string;
  linked_task_ids?: string[];
  linked_document_ids?: string[];
  linked_artifact_ids?: string[];
  created_at: string;
  updated_at: string;
};
```

## 5.9 Spec

### Purpose

Optional bigger-than-task planning object for coding/engineering work.

### Key fields

```ts
type Spec = {
  id: string;
  org_id: string;
  team_id: string;
  project_id: string;
  title: string;
  description?: string;
  lifecycle_state: PlanningLifecycleState;
  derived_health: DerivedHealth;
  owner_principal_id?: string;
  linked_task_ids?: string[];
  linked_document_ids?: string[];
  linked_artifact_ids?: string[];
  created_at: string;
  updated_at: string;
};
```

## 5.10 Planning lifecycle and derived health

Goal, Plan, and Spec have explicit lifecycle state and derived health/progress. These must not be collapsed.

```ts
type PlanningLifecycleState =
  | "draft"
  | "active"
  | "paused"
  | "review"
  | "complete"
  | "archived"
  | "cancelled";

type DerivedHealth = {
  status: "healthy" | "at_risk" | "blocked" | "unknown";
  progress_percent?: number;
  open_task_count?: number;
  blocked_task_count?: number;
  review_pending_count?: number;
  missing_evidence_count?: number;
  updated_at: string;
};
```

A Plan can be active while derived health is blocked. A Goal can be paused while child tasks remain open. Completion should require explicit lifecycle transition unless workspace policy says otherwise.

## 5.11 NativeDocument

### Purpose

Entity-owned markdown/doc file. NativeDocuments are the default/fallback document layer for companies without an external doc system and the editable native layer for specs, notes, reports, internal docs, and generated markdown outputs.

### Key fields

```ts
type NativeDocument = {
  id: string;
  org_id: string;
  team_id?: string;
  project_id?: string;

  title: string;
  body_format: "markdown";
  storage_path: string;
  content_hash: string;

  mutability: "editable_versioned" | "immutable";
  version: number;
  version_history_ref?: string;

  created_by_principal_id: string;
  updated_by_principal_id?: string;

  sensitivity?: SensitivityClass;
  acl?: ObjectAcl;

  linked_object_refs?: ObjectRef[];

  created_at: string;
  updated_at: string;
};
```

## 5.12 ExternalDocumentRef

### Purpose

Reference to externally owned human/company docs such as Google Docs/Drive items.

Entity links, indexes, previews metadata/snippets where authorized, tracks auth/readiness/permissions, and attaches refs to work objects without becoming the canonical store.

### Key fields

```ts
type ExternalDocumentRef = {
  id: string;
  org_id: string;
  connector_type: "google_drive" | "google_docs" | "other";
  external_id: string;
  external_url?: string;

  title: string;
  mime_type?: string;
  source_owner?: string;

  connector_account_id?: string;
  auth_state: "authorized" | "unauthorized" | "expired" | "insufficient_scope" | "unknown";
  readiness_state: "ready" | "degraded" | "unavailable" | "not_configured";

  capabilities: {
    can_read_metadata: boolean;
    can_preview: boolean;
    can_index_snippet: boolean;
    can_write: boolean;
    can_export: boolean;
  };

  canonicality: "external_canonical" | "entity_snapshot" | "linked_context_only";

  last_synced_at?: string;
  last_checked_at?: string;
  sync_error?: string;

  entity_visibility_policy?: ObjectVisibilityPolicy;
  external_permission_summary?: string;

  linked_object_refs?: ObjectRef[];

  created_at: string;
  updated_at: string;
};
```

### V1 posture

Google Docs/Drive V1 is read-only / index / link / preview. No default mutation.

Writes, export, sync, Docs creation, or Docs updates are later-phase and require explicit permission gates, audit trail, and user confirmation.

## 5.13 EvidenceArtifact

### Purpose

Machine/proof/audit output.

Examples:

* `entity-mc` canonical markdown receipt;
* review packet;
* output receipt;
* generated summary;
* task proof;
* agent handoff;
* audit trail;
* curated report/rollup derived from raw receipts.

### Key fields

```ts
type EvidenceArtifact = {
  id: string;
  org_id: string;
  team_id?: string;
  project_id?: string;

  artifact_kind:
    | "raw_task_receipt"
    | "review_packet"
    | "output_receipt"
    | "generated_summary"
    | "agent_handoff"
    | "audit_trail"
    | "curated_report"
    | "rollup";

  title: string;
  body_format: "markdown";
  storage_path: string;
  content_hash: string;

  mutability_policy: "immutable_append_only" | "editable_versioned";
  version: number;

  origin_task_id?: string;
  source_activity_event_ids?: string[];
  source_artifact_ids?: string[];

  provenance: ArtifactProvenance;
  integrity_state: "valid" | "missing_body" | "hash_mismatch" | "metadata_mismatch" | "unknown";

  review_state?: "not_required" | "pending" | "accepted" | "request_fix";
  reviewer_principal_id?: string;

  sensitivity?: SensitivityClass;
  acl?: ObjectAcl;

  linked_object_refs?: ObjectRef[];

  created_by_principal_id: string;
  created_at: string;
  updated_at?: string;
};
```

### Mutability model

Hybrid:

* raw proof receipts are immutable append-only;
* corrections, retries, supersessions, or disputes create new artifacts/events;
* curated summaries/reports/rollups are editable versioned with audit history;
* UI must distinguish raw proof from curated interpretation.

### Task relationship

Hybrid:

* raw receipts are task-owned at creation through `origin_task_id`;
* raw receipts can link upward/sideways to goals, specs, plans, projects, reviews, workspace activity, and curated reports;
* curated reports/rollups are workspace-owned and can link to many tasks/artifacts.

## 5.14 ActivityEvent

### Purpose

Structured provenance source for tasks and receipts. The input packet says Entity already has per-task activity logs; Phase 2 should treat the activity log as the event log source of truth if it captures required structure.

### Key fields

```ts
type ActivityEvent = {
  id: string;
  org_id: string;
  team_id?: string;
  project_id?: string;
  task_id?: string;

  event_type:
    | "task_created"
    | "task_updated"
    | "assignment_changed"
    | "taskmaster_claimed"
    | "nudge_sent"
    | "owner_escalated"
    | "auto_reassigned"
    | "submission_created"
    | "review_requested"
    | "review_decision"
    | "human_gate_requested"
    | "human_gate_decision"
    | "status_changed"
    | "artifact_linked"
    | "receipt_created"
    | "receipt_failed"
    | "completion_accepted"
    | "completion_blocked"
    | "task_cancelled"
    | "task_paused"
    | "task_blocked"
    | "connector_state_changed"
    | "notification_routed";

  actor_principal_id?: string;
  actor_type: "human" | "agent" | "system" | "workflow" | "unknown";

  payload: Record<string, unknown>;
  reason?: string;
  policy_reason_chain?: PolicyReason[];

  created_at: string;
};
```

### Required events

Activity log must capture:

* assignment/claim;
* nudge;
* owner escalation;
* reassignment;
* submission;
* review decision;
* human gate;
* completion;
* cancellation;
* artifact/receipt creation.

If current activity logs lack structure, migration should add structured payloads rather than introduce a second provenance truth source.

## 5.15 Receipt

Receipt is represented as an EvidenceArtifact plus transactional DB metadata.

### Canonical storage

```text
/artifacts/evidence/<artifact_id>.md
```

### Virtual/deep-link examples

```text
/orgs/<org>/teams/<team>/projects/<project>/tasks/<task_id>/receipt
/tasks/<task_id>/artifacts/<artifact_id>
```

Stable artifact identity is canonical. Pretty paths are projections/aliases.

### Minimal receipt body sections

A minimal canonical markdown receipt must include:

```md
# Task Receipt: <task title>

## Identity
- Task ID:
- Org:
- Team:
- Project:
- Worktype:
- Origin:
- Created By:
- Initiator:
- Owner:
- Assignee:
- Executor:
- Submitted By:

## Status Transition
- Previous State:
- New State:
- Completed At:
- Completion Actor:

## Done Criteria
- [ ] ...

## Evidence Summary
- Summary:
- Missing Evidence: yes/no
- Evidence Links:

## Output Artifacts
- ...

## Review
- Review Required:
- Reviewer:
- Decision:
- Decision Reason:

## Human Gate
- Human Gate Required:
- Approver:
- Decision:
- Gate Reason:

## Routing / Execution History
- Original Assignment:
- Task Master Claim:
- Nudges:
- Owner Escalations:
- Reassignments:
- Final Executor:

## Provenance
- Source Activity Event Range:
- Runtime/Provider:
- Receipt Artifact ID:
- Content Hash:
```

If evidence is missing, receipt must say so explicitly. A completed task cannot be evidence-less fog.

---

## 6. Key requirements with acceptance criteria and validation method

| ID  | Requirement                                                                                                         | Acceptance criteria                                                                                                                                | Validation method                                            | Trace              |
| --- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------ |
| R1  | Entity is an agent-native work plane, not just Mission Control.                                                     | Workspace includes tasks, docs/files, evidence, agents/activity, search, notifications, chat readiness, and Helm status boundaries.                | Product review against IA; UI route inspection; spec review. | Q1, Q3, Q6, Q7     |
| R2  | Multi-org, multi-user product seams are foundational.                                                               | Org/team/project/principal fields exist in core object contracts; tenant isolation assumptions are explicit.                                       | Schema/API review; permission tests.                         | Q2                 |
| R3  | Curacel is context/evidence, not demo scope.                                                                        | No ticket requires a Curacel demo; business-ops examples may be synthetic/sanitized.                                                               | Spec review.                                                 | Q8, Q9             |
| R4  | Paperclip is external competitor/reference only.                                                                    | Paperclip is absent from internal product architecture and ticket dependencies.                                                                    | Spec/product catalog review.                                 | Q5                 |
| R5  | Entity, Helm, ClickClack are separate surfaces.                                                                     | Integration contracts define ownership; no deep Helm admin inside Entity; ClickClack unavailable state does not block proof/docs.                  | Architecture review; integration tests.                      | Q4, Q12, Q13       |
| R6  | Entity is runtime-agnostic.                                                                                         | Runtime/provider refs are generic; OpenClaw/Hermes not hardcoded as only runtimes.                                                                 | Schema/API review; provider fixture tests.                   | Q5                 |
| R7  | Work hierarchy is Org → Team → Project → Task, with optional Goal/Plan/Spec.                                        | Every task has org/team/project; tasks can exist without goal/plan/spec; Plan supports non-coding work.                                            | Migration tests; task create/update API tests.               | Q17, Q18           |
| R8  | Task has required initiator and owner.                                                                              | Create/update rejects ready executable task with missing initiator or owner unless migration-warning state applies; owner is individual principal. | API tests; migration validation.                             | Q25, Q26, Q27      |
| R9  | Assignee/executor final assignment is individual principal.                                                         | Executable tasks resolve to individual human/agent or allowed Task-Master-drivable unassigned state.                                               | API tests; Task Master routing tests.                        | Q28, Q29, Q30      |
| R10 | Universal task core state with worktype overlays.                                                                   | All tasks use universal state; worktype-specific fields do not replace it.                                                                         | Schema/API tests; UI tests.                                  | Q20                |
| R11 | NativeDocument, ExternalDocumentRef, EvidenceArtifact are separate concepts.                                        | Backend models and UI labels distinguish the three; permissions apply to each.                                                                     | Schema review; UI tests.                                     | Q14                |
| R12 | EvidenceArtifact mutability is hybrid.                                                                              | Raw receipts immutable append-only; curated reports editable versioned; UI labels distinguish raw vs curated.                                      | API mutation tests; UI tests.                                | Q15                |
| R13 | Every completed `entity-mc` task creates a minimal canonical markdown receipt.                                      | Completion cannot reach `done` without DB metadata and markdown artifact body.                                                                     | Transaction tests; failure injection.                        | Q10, Q35, Q36      |
| R14 | Receipt path uses stable artifact identity.                                                                         | Canonical path uses `/artifacts/evidence/<artifact_id>.md`; task moves do not break links.                                                         | Storage tests; task move tests.                              | Q37                |
| R15 | Receipts are generated from activity log plus task projection.                                                      | Receipt includes routing/review/provenance fields from structured activity events.                                                                 | Receipt fixture tests.                                       | Q33, Q34           |
| R16 | Review is policy-based by worktype/risk.                                                                            | Policy resolver produces review decision, reason chain, reviewer/approver targets.                                                                 | Policy unit tests; UI reason-chain tests.                    | Q21, Q22           |
| R17 | Reviewer assignment is automatic with audited overrides.                                                            | Assignment records mode, actor, reason, override details; self-review blocked.                                                                     | API tests; audit tests.                                      | Q23, Q24           |
| R18 | Human gate is distinct from review.                                                                                 | High-risk work can require human gate even after peer review; gate decision stored separately.                                                     | Policy tests; UI tests.                                      | Q21, Q22           |
| R19 | Task Master drives unassigned/self-assigned work, nudges assigned stalled work, then escalates/reassigns by policy. | Events show claim/nudge/escalate/reassign path; no default takeover of assigned work.                                                              | Task Master simulation tests.                                | Q29, Q30, Q31, Q32 |
| R20 | Auto-reassignment is allowed only when policy permits.                                                              | Thresholds and eligibility are explicit; auto-reassign event includes policy reason.                                                               | Policy tests; event tests.                                   | Q32                |
| R21 | Auto-reassigned task receipt includes full execution chain.                                                         | Receipt names original assignee, nudges, owner escalation, reassignment, final executor, reviewer, gate.                                           | Receipt snapshot tests.                                      | Q33                |
| R22 | Search is global + scoped hybrid.                                                                                   | Search covers tasks/docs/evidence/external refs/activity/chat where integrated; filters work.                                                      | Search index tests; permissioned search tests.               | Q38                |
| R23 | Permissions use layered RBAC + object sensitivity.                                                                  | Org/team/project defaults inherit; object sensitivity/ACL overrides; snippets/previews obey access.                                                | RBAC tests; leakage tests.                                   | Q39                |
| R24 | Notifications use layered routing with Entity inbox as canonical.                                                   | Canonical notification exists before external routing; channel failure does not lose notification.                                                 | Notification tests; degraded channel tests.                  | Q40                |
| R25 | Google Docs connector starts read-only/index/link/preview.                                                          | No V1 default Docs mutation; connector state shown; external refs attach to tasks.                                                                 | Connector tests; UI tests.                                   | Q9, Q11, Q14       |
| R26 | ClickClack staged-but-real.                                                                                         | Chat panel shows live/staged/degraded state; Entity flow continues without ClickClack.                                                             | Bridge/proxy tests; degraded UI tests.                       | Q12                |
| R27 | Helm status/light controls only.                                                                                    | Entity shows runtime status/health/heartbeat/schedule summary/deep links; secrets/deep config absent.                                              | Integration tests; security review.                          | Q4, Q13            |
| R28 | Progressive migration.                                                                                              | Backfilled fields include confidence/provenance; unknowns surfaced; old tasks usable.                                                              | Migration dry run; data-quality reports.                     | Q41                |
| R29 | Phase 2 is spec + implementation ticket graph.                                                                      | Tickets include acceptance criteria and proof requirements; no fake implementation claims.                                                         | Artifact review.                                             | Q42, Q43           |

---

## 7. Technical architecture and API/data contracts

## 7.1 Architecture principles

1. **Entity owns work truth.** Tasks, review, receipts, activity, permissions, search envelopes, and canonical notifications belong to Entity.
2. **Evidence artifacts are first-class.** Receipts are not appendix files; they are queryable, linkable, permissioned objects.
3. **Activity log is provenance truth.** Current task state is projection; activity events preserve history.
4. **External systems are referenced through contracts.** Helm, ClickClack, Google Docs, and runtimes/providers integrate through adapters.
5. **No hidden green states.** Unknown, missing, degraded, unauthorized, expired, unavailable, and failed states must be explicit.
6. **Policy decisions are auditable.** Review/gate/routing/reassignment decisions store input signals and reason chains.
7. **Permission filtering precedes content rendering.** Search snippets, previews, activity, artifacts, external refs, and chat-linked content cannot leak restricted details.
8. **Migration is progressive.** Unknown fields are not invented; they are marked with uncertainty.

## 7.2 Service boundaries

```text
Entity API
├─ Identity / Principal Service
├─ Org / Team / Project Service
├─ Task Service
├─ Planning Object Service
├─ Document Service
├─ Artifact / Receipt Service
├─ Activity Log Service
├─ Policy Resolution Service
├─ Review Service
├─ Human Gate Service
├─ Task Master Routing Service
├─ Search Service
├─ Permission / Sensitivity Service
├─ Notification Service
├─ Connector Service
│  ├─ Google Docs/Drive Adapter
│  ├─ ClickClack Adapter
│  └─ Helm Adapter
└─ Migration / Backfill Service
```

## 7.3 API conventions

All APIs must be org-scoped and permission-checked.

Common envelope:

```ts
type ApiEnvelope<T> = {
  data: T;
  meta?: {
    request_id: string;
    org_id?: string;
    warnings?: ApiWarning[];
  };
};

type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  request_id: string;
};
```

Permission errors should not reveal restricted content. They may reveal that access is restricted when policy allows object existence disclosure.

## 7.4 Core APIs

### Org/team/project

```http
GET /api/orgs
POST /api/orgs
GET /api/orgs/:orgId

GET /api/orgs/:orgId/teams
POST /api/orgs/:orgId/teams
GET /api/teams/:teamId

GET /api/teams/:teamId/projects
POST /api/teams/:teamId/projects
GET /api/projects/:projectId
PATCH /api/projects/:projectId
```

Acceptance:

* org/team/project relationships are enforced;
* cross-org access fails;
* project lifecycle state and derived health are separate fields.

### Tasks

```http
GET /api/projects/:projectId/tasks
POST /api/projects/:projectId/tasks
GET /api/tasks/:taskId
PATCH /api/tasks/:taskId
POST /api/tasks/:taskId/transition
POST /api/tasks/:taskId/assign
POST /api/tasks/:taskId/claim
POST /api/tasks/:taskId/submit
POST /api/tasks/:taskId/complete
```

Task create contract:

```ts
type CreateTaskRequest = {
  title: string;
  description?: string;
  worktype: string;
  initiator_principal_id: string;
  owner_principal_id: string;
  assignee_principal_id?: string;
  taskmaster_drivable?: boolean;
  goal_ids?: string[];
  plan_ids?: string[];
  spec_ids?: string[];
  done_criteria?: DoneCriterion[];
  risk_level?: RiskLevel;
  sensitivity?: SensitivityClass;
  external_side_effects?: ExternalSideEffect[];
  worktype_overlay?: Record<string, unknown>;
};
```

Completion contract:

```ts
type CompleteTaskRequest = {
  completion_actor_principal_id: string;
  submitted_by_principal_id?: string;
  evidence_summary?: string;
  output_artifact_ids?: string[];
  missing_evidence_reason?: string;
};

type CompleteTaskResponse = {
  task: Task;
  receipt: EvidenceArtifact;
  review?: Review;
  human_gate?: HumanGate;
};
```

Completion requirements:

* resolve policy;
* write structured activity event;
* write receipt DB metadata;
* write receipt markdown body;
* verify integrity/hash;
* only then allow `done` when review/human gate policy permits.

If receipt writing fails, task does not become cleanly `done`; it enters explicit `receipt_status = failed` or remains in a non-done state according to implementation policy.

### Planning objects

```http
GET /api/projects/:projectId/goals
POST /api/projects/:projectId/goals
GET /api/goals/:goalId
PATCH /api/goals/:goalId

GET /api/projects/:projectId/plans
POST /api/projects/:projectId/plans
GET /api/plans/:planId
PATCH /api/plans/:planId

GET /api/projects/:projectId/specs
POST /api/projects/:projectId/specs
GET /api/specs/:specId
PATCH /api/specs/:specId
```

Requirements:

* lifecycle state is explicit;
* derived health is computed from linked tasks/artifacts/reviews/blockers;
* tasks can link to zero or more planning objects.

### Documents

```http
GET /api/documents/native
POST /api/documents/native
GET /api/documents/native/:documentId
PATCH /api/documents/native/:documentId
GET /api/documents/native/:documentId/versions

GET /api/documents/external
POST /api/documents/external/link
GET /api/documents/external/:externalRefId
POST /api/documents/external/:externalRefId/refresh-metadata
```

Native document write contract:

```ts
type UpsertNativeDocumentRequest = {
  title: string;
  body_markdown: string;
  linked_object_refs?: ObjectRef[];
  sensitivity?: SensitivityClass;
  mutability?: "editable_versioned" | "immutable";
};
```

External ref link contract:

```ts
type LinkExternalDocumentRequest = {
  connector_type: "google_drive" | "google_docs" | "other";
  external_id?: string;
  external_url?: string;
  linked_object_refs: ObjectRef[];
};
```

V1 external docs:

* read/list/search/link/preview metadata;
* no default mutation.

### Artifacts and receipts

```http
GET /api/artifacts
POST /api/artifacts
GET /api/artifacts/:artifactId
GET /api/tasks/:taskId/receipt
POST /api/tasks/:taskId/receipt/regenerate-metadata
POST /api/artifacts/:artifactId/supersede
```

Raw receipt mutation behavior:

* immutable;
* cannot overwrite body;
* correction creates superseding artifact/event.

Curated report behavior:

* editable versioned;
* references source raw artifacts.

### Activity

```http
GET /api/tasks/:taskId/activity
POST /api/tasks/:taskId/activity
GET /api/activity
```

Direct `POST` to activity should be restricted to service/system paths unless explicitly allowed.

### Review

```http
POST /api/tasks/:taskId/review/request
POST /api/tasks/:taskId/review/accept
POST /api/tasks/:taskId/review/request-fix
POST /api/tasks/:taskId/review/assign
POST /api/tasks/:taskId/review/override-assignment
GET /api/tasks/:taskId/review
```

Review assignment contract:

```ts
type AssignReviewerResult = {
  reviewer_principal_id: string;
  assignment_mode: "policy_auto" | "owner_override" | "team_lead_override" | "admin_override" | "agent_suggested_policy_confirmed";
  assignment_reason: string;
  eligible_pool_summary?: string;
  separation_of_duties_checked: boolean;
  override_actor_principal_id?: string;
  override_reason?: string;
  assigned_at: string;
};
```

Self-review block:

Reviewer must not be `submitted_by`, `created_by`, or `assignee` where separation-of-duties applies. Owner/initiator review is only valid if not disallowed by policy.

### Human gate

```http
POST /api/tasks/:taskId/human-gate/request
POST /api/tasks/:taskId/human-gate/approve
POST /api/tasks/:taskId/human-gate/reject
GET /api/tasks/:taskId/human-gate
```

Human gate requirements:

* approver must be human unless future policy explicitly allows otherwise;
* decision records actor, timestamp, reason, side effects covered;
* gate is separate from review.

### Policy resolution

```http
POST /api/policy/resolve-task
GET /api/tasks/:taskId/policy
GET /api/policies
POST /api/policies
PATCH /api/policies/:policyId
```

Policy resolution output:

```ts
type TaskPolicyResolution = {
  task_id: string;
  review_required: boolean;
  review_reason_chain: PolicyReason[];
  reviewer_assignment?: AssignReviewerResult;

  human_gate_required: boolean;
  human_gate_reason_chain: PolicyReason[];
  approver_principal_id?: string;

  taskmaster_drivable: boolean;
  stall_policy?: StallPolicy;
  auto_reassign_allowed: boolean;

  notification_routes: NotificationRouteDecision[];

  resolved_at: string;
  policy_version: string;
};
```

### Task Master

```http
POST /api/taskmaster/tick
POST /api/taskmaster/tasks/:taskId/claim
POST /api/taskmaster/tasks/:taskId/nudge
POST /api/taskmaster/tasks/:taskId/escalate-owner
POST /api/taskmaster/tasks/:taskId/auto-reassign
GET /api/taskmaster/queues
GET /api/taskmaster/events
```

Claim contract:

```ts
type TaskMasterClaim = {
  task_id: string;
  prior_assignee_principal_id?: string;
  claiming_principal_id: string; // Task Master principal
  policy_reason: string;
  claim_source: "unassigned_policy" | "self_assigned" | "explicit_reassignment_policy";
  claimed_at: string;
};
```

### Search

```http
GET /api/search?q=...&types=...&team_id=...&project_id=...
```

Search result envelope:

```ts
type SearchResult = {
  object_type:
    | "task"
    | "native_document"
    | "evidence_artifact"
    | "external_document_ref"
    | "activity_event"
    | "clickclack_thread"
    | "project"
    | "goal"
    | "plan"
    | "spec"
    | "principal";

  object_id: string;
  title: string;
  snippet?: string;
  source: "entity" | "google_docs" | "google_drive" | "clickclack" | "helm" | "runtime_provider";
  canonical_link: string;
  deep_link?: string;

  org_id: string;
  team_id?: string;
  project_id?: string;

  recency_at: string;
  provenance?: string;
  permission_state: "visible" | "restricted_metadata_only" | "hidden";
  connector_state?: string;
};
```

### Notifications

```http
GET /api/notifications
POST /api/notifications/:notificationId/mark-read
GET /api/notifications/routes
POST /api/notifications/test-route
```

Notification record:

```ts
type NotificationRecord = {
  id: string;
  org_id: string;
  recipient_principal_id: string;
  canonical_event_id: string;
  object_ref: ObjectRef;

  notification_type:
    | "task_nudge"
    | "owner_escalation"
    | "review_request"
    | "human_gate_request"
    | "auto_reassignment_notice"
    | "receipt_failure"
    | "connector_degraded"
    | "policy_warning";

  inbox_state: "unread" | "read" | "archived";
  routes: NotificationDelivery[];

  policy_reason_chain?: PolicyReason[];

  created_at: string;
};
```

External channels are delivery routes, not source of truth.

---

## 8. Policy, permissions, review, receipts, search, notifications

## 8.1 Policy model

Policy is layered.

Inputs:

1. workspace/default policy;
2. org policy;
3. team policy;
4. project policy;
5. worktype/plugin policy;
6. task flags/manual owner overrides;
7. risk detection from metadata/content/evidence/external side effects;
8. agent/runtime trust level where relevant.

Resolution produces one clear decision for:

* review required or not;
* human gate required or not;
* reviewer target;
* approver target;
* Task Master drivability;
* stall thresholds;
* auto-reassignment eligibility;
* notification route;
* reason chain.

Higher-risk layers can escalate requirements. Lower-risk layers cannot silently override mandatory org/workspace gates.

### Policy reason

```ts
type PolicyReason = {
  layer:
    | "workspace_default"
    | "org"
    | "team"
    | "project"
    | "worktype"
    | "task_flag"
    | "risk_detection"
    | "agent_runtime_trust"
    | "manual_override";

  signal: string;
  value: unknown;
  effect:
    | "requires_review"
    | "skips_review"
    | "requires_human_gate"
    | "assigns_reviewer"
    | "assigns_approver"
    | "allows_taskmaster_drive"
    | "blocks_auto_reassign"
    | "allows_auto_reassign"
    | "routes_notification"
    | "raises_sensitivity";

  explanation: string;
};
```

## 8.2 Review model

Review is policy-based by worktype/risk. It is not mandatory for every task and not merely optional by flag.

However, for most agent work, the default review path should preserve the existing `entity-mc review.sh` / Task Master review policy: reviewed by Task Master or another eligible agent with separation of duties.

### Review triggers

Review can be triggered by:

* worktype;
* risk level;
* external side effects;
* owner flag;
* workspace/org/team/project policy;
* customer impact;
* people/HR sensitivity;
* legal/financial exposure;
* production/deployment impact;
* missing/weak evidence;
* agent/runtime trust level.

### Review states

```ts
type Review = {
  id: string;
  task_id: string;
  review_required: boolean;
  reviewer_principal_id?: string;
  decision: "pending" | "accepted" | "request_fix" | "skipped_by_policy";
  decision_reason?: string;
  assigned_by?: string;
  assignment_mode?: string;
  assignment_reason?: string;
  override_actor_principal_id?: string;
  override_reason?: string;
  created_at: string;
  decided_at?: string;
};
```

### Separation of duties

Reviewer must not be the `submitted_by`, `created_by`, or `assignee` when separation-of-duties applies. The policy can also disallow review by owner or initiator if they are too close to the work.

Assignee/agent may suggest a reviewer, but cannot self-approve or silently bypass policy assignment.

## 8.3 Reviewer/approver assignment

Default reviewer assignment is automatic from eligible reviewers based on:

* policy;
* worktype;
* team;
* availability;
* separation of duties;
* required capability;
* risk level;
* reviewer load.

Human owner/team lead/admin may override with audit trail.

For human-initiated/human work, initiator is the default reviewer where appropriate and allowed by separation of duties. Same-team is fallback/context pool.

For agent work, Task Master or eligible peer agent review is default where policy says so.

## 8.4 Human gate model

Human gate is separate from review.

Human gate is required for high-risk classes such as:

* external sends;
* HR/people actions;
* customer commitments;
* CRM/customer-impacting updates;
* legal/financial exposure;
* production/deployment impact;
* security-sensitive work;
* workspace-defined restricted classes.

Human gate fields:

```ts
type HumanGate = {
  id: string;
  task_id: string;
  required: boolean;
  reason_chain: PolicyReason[];
  approver_principal_id?: string;
  decision: "pending" | "approved" | "rejected" | "not_required";
  decision_reason?: string;
  decided_by_principal_id?: string;
  decided_at?: string;
};
```

## 8.5 Receipt policy

Every completed `entity-mc` task creates a minimal canonical markdown receipt automatically.

### Completion invariant

A task cannot become `done` until:

1. receipt metadata is written transactionally in DB;
2. markdown artifact body is written as NativeDocument/EvidenceArtifact file;
3. artifact has stable ID/path;
4. content hash/integrity state is recorded;
5. activity event records receipt creation.

If receipt writing fails:

* completion fails or remains non-done;
* task shows explicit receipt-generation error;
* notification can route to owner/admin according to policy.

### Receipt storage

Hybrid:

* DB stores metadata, integrity state, task linkage, artifact id, version/mutability policy, creation status, availability;
* markdown body lives as NativeDocument/EvidenceArtifact file with stable ID/path and deep link.

## 8.6 Search/indexing model

Entity search is hybrid:

* global workspace search;
* scoped tabs/filters.

Indexed object types:

* tasks;
* NativeDocuments;
* EvidenceArtifacts;
* ExternalDocumentRefs / Google Docs metadata;
* task activity logs;
* ClickClack threads/messages where integrated;
* projects/goals/plans/specs;
* people/agents.

Filters:

* object type;
* source;
* team;
* project;
* worktype;
* owner;
* assignee;
* initiator;
* lifecycle state;
* review state;
* risk;
* sensitivity;
* date;
* connector/auth state.

Permission filtering must happen before or during result rendering so snippets/previews do not leak restricted content.

## 8.7 Permissions/RBAC model

Use layered RBAC + object sensitivity.

### Inheritance

```text
Org role
  → Team role
    → Project role
      → Object permissions
        → Sensitivity / ACL override
```

### Object sensitivity

Sensitive categories include:

* people/HR;
* customer/account-sensitive work;
* legal;
* financial;
* security;
* production;
* confidential strategy;
* workspace-defined restricted classes.

### Permissioned surfaces

Permissions apply to:

* tasks;
* snippets;
* previews;
* activity logs;
* EvidenceArtifacts;
* NativeDocuments;
* ExternalDocumentRefs;
* search results;
* notifications;
* ClickClack-linked content;
* Helm-backed status widgets.

### Google Docs permissions

External access and Entity visibility are related but not identical.

An ExternalDocumentRef needs:

* connector auth state;
* external permission summary where available;
* Entity-side visibility policy;
* degraded/expired/unauthorized states.

Entity must not show external snippets/previews to users who lack Entity permission, even if the connector can technically fetch them.

## 8.8 Notification/escalation model

Entity inbox/activity is canonical.

External channels are routed delivery mechanisms:

* ClickClack;
* email;
* Discord/Slack;
* AgentPush;
* webhooks;
* other configured channels.

Notification routes are policy-driven by:

* worktype;
* urgency;
* user/team preferences;
* risk;
* audit needs;
* channel availability.

Task Master nudges, owner escalations, review requests, human gates, and reassignment notices use the same notification framework.

If an external channel is unavailable, Entity preserves the canonical notification and records delivery failure/degraded state.

---

## 9. Integration contracts: Helm, ClickClack, Google Docs, runtimes/providers

## 9.1 Entity ↔ Helm contract

### Boundary

Entity owns work-plane semantics.

Helm owns runtime/admin control.

### Entity may show

* runtime/agent status;
* current assignment/current work;
* health/readiness;
* last heartbeat;
* schedule/loop summary;
* deep links to Helm;
* safe pause/resume/request-retry only when reversible, policy-permitted, and audited.

### Helm keeps

* credentials/secrets;
* model/provider configuration;
* cron/schedule editing;
* tool permission grants;
* deployment/admin settings;
* destructive runtime actions;
* billing/org-level runtime policy.

### Entity Helm status object

```ts
type HelmRuntimeStatus = {
  provider_ref: string;
  runtime_id: string;
  agent_principal_id?: string;
  display_name: string;
  status: "healthy" | "degraded" | "offline" | "unknown";
  source: "helm";
  current_work_refs?: ObjectRef[];
  last_heartbeat_at?: string;
  schedule_summary?: string;
  loop_summary?: string;
  health_summary?: string;
  helm_deep_link?: string;
  safe_actions?: HelmSafeAction[];
  error?: string;
};
```

### Safe action contract

```ts
type HelmSafeAction = {
  action: "pause" | "resume" | "request_retry";
  reversible: true;
  requires_policy_check: true;
  audit_required: true;
  label: string;
};
```

### Degraded behavior

If Helm is unreachable:

* show degraded/unavailable state;
* preserve Entity work flow;
* do not show fake healthy status;
* do not reveal secrets;
* show setup/config link where applicable.

## 9.2 Entity ↔ ClickClack contract

### Boundary

Entity owns:

* workspace context;
* work objects;
* object permissions/gates;
* object links;
* canonical activity/notifications around work.

ClickClack owns:

* channels;
* threads;
* messages;
* composer;
* bridge/proxy primitives.

### Integration object

```ts
type ClickClackThreadRef = {
  id: string;
  org_id: string;
  clickclack_thread_id: string;
  clickclack_channel_id?: string;
  linked_object_refs: ObjectRef[];
  readiness_state: "live" | "staged" | "degraded" | "unavailable" | "not_configured";
  bridge_status?: "ok" | "error" | "unknown";
  last_checked_at?: string;
  error?: string;
};
```

### Degraded behavior

If ClickClack sidecar/bridge is unavailable:

* Entity shows readiness/setup/link state;
* docs/files/proof/review remain usable;
* chat panel says live/staged/degraded/unavailable;
* object links remain Entity-owned.

## 9.3 Entity ↔ Google Docs/Drive contract

### V1 posture

Read-only / index / link / preview first.

Entity should allow users to:

* authorize connector;
* search/list external docs metadata;
* link external docs to tasks/goals/plans/specs/projects;
* preview metadata/snippets where allowed;
* see auth/readiness/permission state;
* open external doc.

Entity should not by default:

* create Google Docs;
* update Google Docs;
* write to Drive;
* sync markdown to Docs;
* mutate external docs.

Writes/export/sync are later-phase and must have explicit permission gates, audit trail, and user confirmation.

### ExternalDocumentRef canonicality

* Human/company-owned collaborative docs may be externally canonical.
* Low-level `entity-mc` evidence/proof receipts are Entity-native markdown canonical.
* Export/snapshot to Google Docs later is optional and gated; it must not replace the raw Entity receipt.

## 9.4 Entity ↔ runtime/provider contract

Entity must treat runtime/provider as abstract.

Runtime/provider examples from the packet include OpenClaw and Hermes, but they are not the only runtimes.

### Runtime/provider reference

```ts
type RuntimeProviderRef = {
  id: string;
  provider_type: string; // openclaw, hermes, codex, claude_code, other
  display_name: string;
  managed_by: "helm" | "external" | "unknown";
  helm_ref?: string;
  agent_principal_ids?: string[];
  capabilities?: string[];
  trust_level?: "unknown" | "low" | "standard" | "high";
  status?: "healthy" | "degraded" | "offline" | "unknown";
};
```

Entity uses provider refs for:

* agent identity/status;
* current work;
* policy trust signals;
* evidence provenance;
* search/filter context.

Entity does not own provider config.

## 9.5 Entity ↔ `entity-mc` contract

`entity-mc` is the per-agent, cron-driven bundle installed on an agent’s host. The agent pulls assigned work, executes it, and reports proof back.

### Required `entity-mc` outputs

For task submission/completion:

* task id;
* status transition;
* submitted_by;
* assignee/executor;
* evidence;
* output_artifact;
* done_criteria;
* review packet;
* runtime/provider provenance;
* activity events sufficient for receipt.

### Review packet compatibility

Existing proof model:

```ts
type ReviewPacket = {
  evidence?: unknown;
  output_artifact?: unknown;
  done_criteria?: DoneCriterion[];
};
```

Phase 2 should preserve compatibility with `metadata.review_packet = { evidence, output_artifact, done_criteria[] }`, while normalizing it into first-class EvidenceArtifact/Receipt contracts.

---

## 10. Migration/backfill plan

## 10.1 Migration strategy

Use progressive migration.

Do not archive old tasks into a read-only historical pile. Do not block Phase 2 usability on perfect strict migration.

Backfill what can be inferred. Mark unknown/uncertain fields explicitly.

## 10.2 Migration principles

1. **Preserve usability.** Old tasks remain visible and connected where possible.
2. **Do not invent certainty.** Unknown initiator, owner, assignee, receipt linkage, or activity structure must be marked.
3. **Record provenance.** Every inferred field stores source and confidence.
4. **Expose cleanup queues.** Missing owner, unknown initiator, missing receipt, weak activity structure, and missing project should become resolvable work.
5. **No destructive default.** Migration should be dry-runnable and reversible where possible.
6. **No fake receipts.** Historical tasks without receipts should not get fabricated proof. They can get migration notes or backfill artifacts clearly marked as backfilled summaries, not raw original receipts.

## 10.3 Migration status model

```ts
type MigrationStatus = {
  state: "not_migrated" | "migrated" | "partial" | "needs_cleanup" | "blocked";
  confidence: "high" | "medium" | "low" | "unknown";
  warnings: MigrationWarning[];
  inferred_fields: InferredField[];
  migrated_at?: string;
};

type MigrationWarning = {
  code:
    | "missing_owner"
    | "unknown_initiator"
    | "missing_project"
    | "missing_assignee"
    | "missing_receipt"
    | "weak_activity_structure"
    | "unknown_worktype"
    | "ambiguous_team"
    | "permission_mapping_uncertain";

  message: string;
  severity: "info" | "warning" | "blocking_for_execution" | "blocking_for_done";
};

type InferredField = {
  field_name: string;
  inferred_value: unknown;
  source: "created_by" | "assignee" | "project_owner" | "team_default" | "activity_log" | "metadata" | "source_event" | "system_unknown";
  confidence: "high" | "medium" | "low" | "unknown";
};
```

## 10.4 Field backfill rules

### Org/team/project

* Infer from existing project/team context where available.
* If team ambiguous, mark `ambiguous_team`.
* If project missing, place in a migration holding project only if clearly labeled as cleanup state.

### Initiator

Infer from:

1. explicit request metadata;
2. source event;
3. created_by;
4. imported system;
5. `unknown/system`.

Mark confidence.

### Owner

Infer from:

1. existing owner field if present;
2. project owner;
3. task assignee;
4. initiator;
5. created_by;
6. cleanup queue.

Owner must become an individual principal before task is ready for normal execution.

### Assignee/executor

Infer from existing assignee/executor where present.

If missing:

* mark unassigned;
* determine if Task-Master-drivable by policy;
* otherwise mark routing problem.

### Review/receipt

Existing `metadata.review_packet` maps to structured proof fields and EvidenceArtifact links where possible.

Existing completed tasks without canonical receipt:

* mark `missing_receipt`;
* do not pretend they had a synchronous canonical receipt;
* optionally create a clearly labeled backfill summary artifact later, not an original raw receipt.

### Activity log

Map existing task activity log to structured ActivityEvents where possible.

If insufficient structure, mark `weak_activity_structure`.

## 10.5 Migration phases

### Phase M0 — Inventory and dry run

* count existing tasks, projects, docs, review packets, activity logs;
* identify missing fields;
* produce migration report;
* no writes required.

### Phase M1 — Add nullable schema and projections

* add new fields behind feature flags;
* preserve existing reads/writes;
* expose migration warnings in admin/dev views.

### Phase M2 — Backfill inferred fields

* populate org/team/project/initiator/owner/assignee/worktype where possible;
* write confidence/provenance;
* generate cleanup queues.

### Phase M3 — Enforce for new tasks

* new tasks require initiator and owner;
* new executable tasks require individual assignee/executor or Task-Master-drivable unassigned state;
* completed `entity-mc` tasks require receipts.

### Phase M4 — Cleanup and stricter enforcement

* resolve missing owners/initiators/projects;
* fix weak activity structure;
* tighten policy gates;
* do not block old historical visibility.

---

## 11. Edge cases and failure modes

## 11.1 Receipt write failure

### Scenario

Task completion is attempted but receipt metadata or markdown body write fails.

### Required behavior

* task does not cleanly transition to `done`;
* `receipt_status = failed`;
* error is visible;
* activity event records failure;
* owner/admin notification can be routed;
* retry path exists.

## 11.2 Receipt metadata/body drift

### Scenario

DB metadata exists but artifact body is missing or hash mismatches.

### Required behavior

* mark `integrity_state = hash_mismatch` or `missing_body`;
* surface receipt-integrity error;
* do not silently present task as cleanly proven;
* repair/regenerate metadata only when source artifact/activity supports it.

## 11.3 Missing evidence

### Scenario

Agent marks task complete but no evidence/output exists.

### Required behavior

* receipt still created if completion policy permits;
* receipt explicitly says “missing evidence”;
* policy may force review/human gate or block completion depending on worktype/risk;
* UI shows missing evidence, not green state.

## 11.4 Self-review attempt

### Scenario

Reviewer equals submitted_by, created_by, or assignee where separation-of-duties applies.

### Required behavior

* review assignment/action rejected;
* reason shown;
* event recorded;
* Task Master/policy selects eligible reviewer or queues for owner/admin.

## 11.5 Initiator is also owner/reviewer

### Scenario

Initiator is default reviewer for human-initiated work but is also executor or otherwise ineligible.

### Required behavior

* separation-of-duties policy wins;
* same-team/capability fallback used;
* reason chain shown.

## 11.6 Unassigned task without Task Master policy

### Scenario

Task has no assignee and is not Task-Master-drivable.

### Required behavior

* task is marked routing problem;
* cannot enter active execution;
* owner/team lead gets cleanup notification;
* search/filter can show routing problems.

## 11.7 Task Master double-claim race

### Scenario

Task Master and agent pull path attempt to claim same task.

### Required behavior

* atomic claim guard prevents double claim;
* loser receives conflict/no-op;
* activity log records one claim only.

## 11.8 Assigned task stalls

### Scenario

Named assignee/executor does not progress.

### Required behavior

* Task Master nudges first;
* escalates to owner after threshold;
* auto-reassigns only when policy permits and threshold exhausted;
* no default takeover;
* receipt includes routing history if completed after reassignment.

## 11.9 Auto-reassignment not allowed

### Scenario

High-risk task stalls but policy blocks auto-reassignment.

### Required behavior

* owner escalation remains active;
* task marked stalled/escalated;
* no automatic reassignment;
* notification records blocked auto-reassign reason.

## 11.10 Helm unavailable

### Scenario

Helm API unreachable.

### Required behavior

* Entity shows degraded Helm status;
* work plane remains usable;
* no fake runtime health;
* no secrets displayed;
* deep controls unavailable or linked to setup.

## 11.11 ClickClack unavailable

### Scenario

ClickClack bridge/proxy sidecar unavailable.

### Required behavior

* chat panel shows staged/degraded/unavailable state;
* docs/files/proof/review unaffected;
* existing object links remain visible where permissioned.

## 11.12 Google auth expired

### Scenario

Google Docs connector token expired or scope insufficient.

### Required behavior

* ExternalDocumentRef shows expired/insufficient scope;
* metadata/snippets not refreshed;
* linked object remains visible as external ref if Entity policy allows;
* setup/re-auth path shown;
* no mutation attempted.

## 11.13 External doc deleted or permission revoked

### Scenario

Google Doc disappears or connector loses access.

### Required behavior

* readiness state degraded/unavailable;
* last known metadata may show only if policy permits and marked stale;
* no proof is lost because raw receipts are Entity-native.

## 11.14 Sensitive snippet leakage

### Scenario

Search result includes restricted evidence or HR/customer-sensitive snippet.

### Required behavior

* permission filter suppresses result or snippet;
* UI may show restricted placeholder only when allowed;
* audit event for denied access where policy requires.

## 11.15 Task/project moved

### Scenario

Task moves teams/projects or title changes.

### Required behavior

* artifact-id receipt path remains stable;
* virtual paths/deep links update;
* permissions re-evaluate under new hierarchy;
* activity event records move.

## 11.16 Migration uncertainty

### Scenario

Old task lacks owner/initiator/receipt.

### Required behavior

* task remains visible;
* warning shown;
* cannot be treated as fully policy-clean;
* cleanup queue created.

---

## 12. Test/QA/proof gates

## 12.1 Proof philosophy

No fake implementation claims.

Every implementation ticket must produce proof appropriate to the layer:

* schema migration proof;
* API test proof;
* UI screenshot/DOM proof;
* receipt artifact proof;
* search index proof;
* permission denial proof;
* degraded integration proof;
* migration dry-run report;
* rollout/rollback proof.

## 12.2 Required test classes

### Unit tests

* policy resolution;
* review assignment;
* separation of duties;
* receipt template generation;
* receipt path generation;
* permission decisions;
* migration inference;
* search envelope construction;
* notification routing.

### Integration tests

* task completion writes receipt DB metadata + markdown body;
* receipt failure blocks `done`;
* Task Master claim/nudge/escalate/reassign;
* Google Docs read-only connector state;
* Helm status adapter degraded/live states;
* ClickClack bridge/proxy readiness;
* search indexing with permission filtering;
* notification route failures.

### End-to-end tests

Core E2E flows:

1. business-ops task created with initiator/owner.
2. external Google Doc ref linked.
3. Entity-native markdown artifact linked.
4. agent submits proof packet.
5. receipt generated.
6. policy requires review.
7. reviewer accepts or requests fix.
8. human gate required for external send.
9. Task Master handles stalled task path.
10. global search finds receipt/activity with permission filtering.

### Migration tests

* dry run produces counts and warnings;
* inferred owner/initiator has confidence/provenance;
* missing receipt is marked, not fabricated;
* old task remains visible;
* new task enforcement works after feature flag.

### Security/permissions tests

* cross-org access blocked;
* object sensitivity overrides inherited access;
* search snippets suppressed for restricted artifacts;
* ExternalDocumentRef respects both connector and Entity policy;
* Helm secrets never appear in Entity.

### Degraded-mode tests

* Helm down;
* ClickClack down;
* Google auth expired;
* search index lag;
* receipt storage failure;
* notification channel failure.

## 12.3 QA gates before Phase 2 implementation can be called ready

### Spec readiness gate

* all object boundaries are explicit;
* all major policy decisions trace to Q1–Q43;
* all tickets have acceptance criteria and proof requirements;
* open questions are explicit.

### Build readiness gate

* schema changes reviewed;
* API contracts reviewed;
* policy model reviewed;
* migration dry-run plan exists;
* rollback plan exists;
* no destructive default.

### Implementation proof gate

For any claimed implementation slice:

* build/test commands or equivalent CI proofs;
* targeted tests for touched areas;
* browser/API receipts for UI/API paths;
* screenshots/DOM receipts where UI changed;
* migration dry-run report where migration changed;
* security/permission test results where access changed;
* degraded-state proof for integrations.

The input packet mentions existing commands such as `npm run build`, `npm run ctrl:gate`, `npm run ctrl:full`, and ClickClack commands. This spec does not claim they have been run. They are proof candidates for future implementation.

---

## 13. Rollout, observability, and rollback

## 13.1 Rollout principles

* Roll out behind feature flags.
* Start with non-destructive schema additions.
* Preserve existing workflows during migration.
* Enforce stricter invariants for new tasks before old data is fully cleaned.
* Surface incomplete migration states rather than hiding them.
* Keep Helm/ClickClack/Google degraded states non-blocking for core work-plane functionality.

## 13.2 Suggested rollout phases

### Rollout 0 — Internal spec validation

* review object model;
* review integration boundaries;
* review ticket graph;
* identify unresolved questions.

### Rollout 1 — Schema/API behind flags

* add org/team/project/task fields;
* add initiator/owner fields;
* add document/artifact models;
* add policy result fields;
* add activity event structure;
* do not enforce strict migration yet.

### Rollout 2 — New task enforcement

* require initiator and individual owner for new tasks;
* require project;
* require individual assignee/executor or Task-Master-drivable unassigned policy;
* record policy resolution.

### Rollout 3 — Receipt invariant for new `entity-mc` completions

* require synchronous receipt creation for completed `entity-mc` tasks;
* block clean `done` on receipt failure;
* surface receipt errors.

### Rollout 4 — Review/policy/Task Master

* enable policy-based review;
* enable reviewer assignment and override audit;
* enable nudge/escalation/reassignment policies.

### Rollout 5 — Search/permissions/notifications

* index tasks/docs/evidence/activity/external refs;
* enable permission-filtered search;
* enable canonical Entity inbox;
* route external notifications by policy.

### Rollout 6 — Integrations

* Google Docs read/index/link/preview;
* ClickClack staged/live chat readiness;
* Helm status/light controls.

### Rollout 7 — Migration cleanup

* run progressive backfill;
* expose cleanup queues;
* resolve missing owners/initiators/projects;
* tighten enforcement where data quality allows.

## 13.3 Observability

Track:

### Work/task metrics

* task counts by state/worktype/team/project;
* tasks missing owner/initiator/assignee;
* Task-Master-drivable unassigned tasks;
* stalled tasks;
* nudges/escalations/reassignments;
* review pending age;
* human gate pending age.

### Receipt/evidence metrics

* completed tasks with receipt;
* receipt write failures;
* integrity errors;
* missing evidence count;
* receipt generation latency;
* artifacts by kind/mutability.

### Policy metrics

* review_required rate by worktype/risk;
* human_gate_required rate;
* policy override count;
* self-review block count;
* auto-reassignment count;
* policy resolution failures.

### Search/permission metrics

* index lag;
* query errors;
* permission-denied counts;
* restricted snippet suppressions;
* stale external refs.

### Integration metrics

* Helm status fetch success/failure;
* ClickClack readiness/bridge failures;
* Google auth expired/insufficient-scope counts;
* notification delivery success/failure by channel.

### Migration metrics

* migration warnings by type;
* unresolved cleanup queue count;
* inferred field confidence distribution;
* old tasks with missing receipts.

## 13.4 Rollback

Rollback must preserve data integrity.

### Safe rollback strategy

* feature flags disable new UI surfaces;
* API can continue reading new fields;
* receipt artifacts are not deleted;
* migration writes are additive where possible;
* old task views remain accessible;
* external connector mutations are not part of V1, reducing rollback risk.

### Rollback triggers

* cross-org data leak;
* permissioned search leak;
* receipt integrity corruption;
* task completion blocked broadly by receipt writer defect;
* runaway Task Master reassignment/nudge loop;
* connector auth behavior exposing data incorrectly;
* Helm/ClickClack integration degrading core Entity flow.

### Rollback actions

* disable feature flag;
* stop Task Master automation path;
* pause notification external routing;
* disable affected connector adapter;
* revert enforcement while preserving warnings;
* repair or quarantine corrupted receipt records;
* keep audit trail.

---

## 14. Traceability matrix Q1–Q43

|   Q | Decision                                                                                                                                   | Spec trace                                      |
| --: | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
|  Q1 | Entity is agent-native work plane / workspace OS; Mission Control is wedge, not whole product; agent management/work surfaces first-class. | Sections 2, 3, 4, 5, 15 Epics E1/E8/E11/E12     |
|  Q2 | Multi-user, multi-org product; multi-tenant SaaS + enterprise/self-deploy; Curacel first design customer/pilot context.                    | Sections 3.1, 5.3, 7, 10, 13, 15 Epic E1        |
|  Q3 | Product center is human-agent work plane; first trust wedge is proof-backed review; agent management foundational.                         | Sections 2, 4, 5.15, 8.2, 15 Epics E4/E5/E8     |
|  Q4 | Entity and Helm are separate products; Entity work plane, Helm runtime/admin control plane.                                                | Sections 3.3, 9.1, 15 Epic E11                  |
|  Q5 | Entity runtime-agnostic; OpenClaw/Hermes runtimes/providers; Paperclip external competitor/reference.                                      | Sections 1, 3.3, 9.4, 15 Epic E8/E11            |
|  Q6 | MVP slice B + D: agent team workspace + Curacel pilot workflow context; non-greenfield consolidation.                                      | Sections 2, 3, 4, 15 overall ticket graph       |
|  Q7 | Scope Entity with ClickClack + Helm; 2-day and rest-week consolidation; reuse existing surfaces.                                           | Sections 2, 9, 12, 13, 15 Epics E11/E12         |
|  Q8 | Business-ops anchor: sales, people, CS; no default engineering-only tracking.                                                              | Sections 4, 5.8, 8.4, 15 Epic E2/E3             |
|  Q9 | No Curacel demo; BYO doc system; native docs/files/artifact layer; Google Docs human consumption context.                                  | Sections 1, 3.3, 5.11–5.13, 9.3, 15 Epic E3/E13 |
| Q10 | Every completed `entity-mc` task creates minimal canonical markdown receipt.                                                               | Sections 5.15, 8.5, 15 Epic E4                  |
| Q11 | Google Docs starts read-only/index/link/preview; writes later gated.                                                                       | Sections 5.12, 9.3, 15 Epic E13                 |
| Q12 | ClickClack staged-but-real; degraded readiness must not block docs/files/proof/review.                                                     | Sections 9.2, 11.11, 15 Epic E12                |
| Q13 | Entity may show Helm status/light reversible audited controls; deep config remains in Helm.                                                | Sections 9.1, 11.10, 15 Epic E11                |
| Q14 | Separate ExternalDocumentRef, NativeDocument, EvidenceArtifact.                                                                            | Sections 5.11–5.13, 15 Epic E3                  |
| Q15 | EvidenceArtifact mutability hybrid: raw immutable, curated editable versioned.                                                             | Sections 5.13, 8.5, 15 Epic E3/E4               |
| Q16 | Raw receipts task-owned at creation, linkable upward/sideways; curated reports workspace-owned.                                            | Sections 5.13, 5.15, 15 Epic E4                 |
| Q17 | Required hierarchy Org → Team → Project; Task required; Goal/Plan/Spec optional; Plan non-coding, Spec coding.                             | Sections 5.1–5.10, 15 Epic E1/E2                |
| Q18 | Goal/Plan/Spec hybrid first-class planning/container objects owning/linking tasks.                                                         | Sections 5.7–5.10, 7.4, 15 Epic E2              |
| Q19 | Goal/Plan/Spec explicit lifecycle + derived progress/health.                                                                               | Sections 5.10, 7.4, 15 Epic E2                  |
| Q20 | Task lifecycle universal core + worktype overlays.                                                                                         | Sections 5.6, 7.4, 15 Epic E2                   |
| Q21 | Review policy-based by worktype/risk; receipt always for `entity-mc`; human gate separate.                                                 | Sections 8.1–8.5, 15 Epic E5                    |
| Q22 | Layered policy resolution with reason chain.                                                                                               | Sections 8.1, 7.4, 15 Epic E5                   |
| Q23 | Reviewer/approver assignment hybrid: policy default + audited override.                                                                    | Sections 8.2–8.4, 15 Epic E5                    |
| Q24 | Agent work review follows Task Master/`entity-mc review.sh`; human work default reviewer initiator where appropriate.                      | Sections 8.2–8.3, 15 Epic E5                    |
| Q25 | Initiator required first-class field on every task.                                                                                        | Sections 5.6, 10.4, 15 Epic E2/E14              |
| Q26 | Owner required first-class field on every task.                                                                                            | Sections 5.6, 10.4, 15 Epic E2/E14              |
| Q27 | Task owner is individual principal only.                                                                                                   | Sections 5.6, 8.7, 15 Epic E2                   |
| Q28 | Assignee/executor individual principal only.                                                                                               | Sections 5.6, 8.1, 15 Epic E2/E6                |
| Q29 | Unassigned tasks allowed by policy; Task Master handles Task-Master-drivable tasks.                                                        | Sections 5.6, 8.1, 8.4, 15 Epic E6              |
| Q30 | Task Master claim/assignment hybrid; current executor becomes Task Master, original unassigned preserved.                                  | Sections 5.6, 7.4, 15 Epic E6                   |
| Q31 | Assigned stalled work: nudge → owner escalation → policy-based reassignment; no immediate takeover.                                        | Sections 8.8, 11.8, 15 Epic E6                  |
| Q32 | Reassignment automatic after thresholds when policy permits.                                                                               | Sections 8.1, 8.8, 11.9, 15 Epic E6             |
| Q33 | Completed receipt after auto-reassignment names full execution chain.                                                                      | Sections 5.15, 8.5, 15 Epic E4/E6               |
| Q34 | Existing task activity log is event/provenance source if structured enough.                                                                | Sections 5.14, 8.5, 10, 15 Epic E4/E14          |
| Q35 | Receipt generation synchronous at completion.                                                                                              | Sections 5.15, 8.5, 11.1, 15 Epic E4            |
| Q36 | Receipt storage hybrid: DB metadata + markdown artifact body.                                                                              | Sections 5.15, 8.5, 15 Epic E4                  |
| Q37 | Receipt path hybrid: stable artifact-id path + virtual pretty paths.                                                                       | Sections 5.15, 15 Epic E4                       |
| Q38 | Search hybrid: global workspace search + scoped filters.                                                                                   | Sections 8.6, 15 Epic E9                        |
| Q39 | Permissions layered RBAC + object sensitivity.                                                                                             | Sections 8.7, 15 Epic E7                        |
| Q40 | Notifications layered routing; Entity inbox canonical.                                                                                     | Sections 8.8, 15 Epic E10                       |
| Q41 | Progressive migration/backfill; preserve old tasks, mark unknowns.                                                                         | Section 10, 15 Epic E14                         |
| Q42 | Phase 2 deliverable is spec + implementation tickets.                                                                                      | Sections 1, 2, 15                               |
| Q43 | Ticket graph uses hybrid epics: product capability epics with layer-split tickets.                                                         | Section 15                                      |

---

## 15. Implementation ticket graph

## 15.1 Ticket graph conventions

Each epic is organized by product capability. Tickets inside each epic are split by technical layer where relevant: schema/data, API/service, UI/UX, migration/backfill, tests/validation, docs, and rollout.

Ticket status in this artifact: **not implemented by this spec**. These are implementation-ready issues.

Each ticket includes:

* scope;
* dependencies;
* acceptance criteria;
* proof requirements;
* traceability.

---

## Epic E1 — Workspace tenancy, hierarchy, and navigation

### E1.T1 — Schema: org/team/project hierarchy

**Layer:** Schema/data
**Scope:** Add or normalize Org, Team, Project records and required relationships.
**Dependencies:** None.
**Trace:** Q1, Q2, Q17.

**Acceptance criteria**

* Org, Team, and Project objects exist or are normalized according to Section 5.
* Every Project belongs to one Team; every Team belongs to one Org.
* Project lifecycle state is explicit.
* Schema supports multi-tenant SaaS and enterprise/self-deploy deployment mode seam.
* Cross-org object IDs cannot be used to fetch/update unrelated tenant data.

**Proof requirements**

* Migration/schema diff.
* Unit tests for org/team/project relationships.
* API tests showing cross-org access rejection.
* Sample fixture showing Org → Team → Project hierarchy.

---

### E1.T2 — API: org/team/project CRUD and scoping

**Layer:** API/service
**Scope:** Implement org/team/project list/create/read/update APIs with permission checks.
**Dependencies:** E1.T1, E7.T1.
**Trace:** Q2, Q17, Q39.

**Acceptance criteria**

* APIs from Section 7.4 exist or equivalent routes are documented.
* All responses include org-scoped data only.
* Permission denial does not leak restricted project contents.
* Project derived health can be read separately from lifecycle state.

**Proof requirements**

* API test suite.
* Permission test fixture with two orgs.
* Example API responses.
* Error response samples.

---

### E1.T3 — UI: workspace shell and primary navigation

**Layer:** UI/UX
**Scope:** Consolidate Entity navigation into a work-plane shell.
**Dependencies:** E1.T2.
**Trace:** Q1, Q3, Q6, Q7.

**Acceptance criteria**

* Navigation includes Work/Mission Control, Docs & Files, Agents/Activity, Review/Proof, Search, Notifications/Inbox, Chat readiness, Runtime/Helm status.
* UI does not present Entity as only a task board.
* Empty states are honest and non-fake.
* A reviewer can understand Entity as an agent-team workspace from the first screen.

**Proof requirements**

* Browser screenshot or DOM receipt of workspace landing.
* Navigation route map.
* Empty-state screenshots.
* Accessibility smoke check for primary nav labels.

---

### E1.T4 — UI: business-ops workspace mode/context

**Layer:** UI/UX
**Scope:** Provide business-ops-friendly labels and examples for sales, people, and CS.
**Dependencies:** E1.T3, E2.T1.
**Trace:** Q8, Q17, Q20.

**Acceptance criteria**

* UI supports sales/people/CS work without forcing “spec” language.
* Plan/domain labels appear for non-coding planning.
* Worktype overlays can show domain fields near universal task state.
* Synthetic/sanitized examples are used; no Curacel demo wording.

**Proof requirements**

* Screenshot/DOM receipt of business-ops task/project path.
* Copy review confirming no Curacel-demo implication.
* Fixture data showing sales, people, and CS tasks.

---

### E1.T5 — Tests: workspace hierarchy and nav smoke

**Layer:** Tests/validation
**Scope:** Validate hierarchy, routing, and primary navigation.
**Dependencies:** E1.T1–E1.T4.
**Trace:** Q1, Q2, Q17.

**Acceptance criteria**

* Tests cover org/team/project route access.
* Navigation renders without blank/loading-only primary panels.
* Cross-org route attempts fail safely.
* Business-ops mode routes render.

**Proof requirements**

* Test run output.
* Browser screenshots for success and denied access.
* Logged failures if any path is intentionally deferred.

---

### E1.T6 — Docs: workspace hierarchy ADR

**Layer:** Docs
**Scope:** Write ADR defining Org → Team → Project → Task hierarchy and superseding older hierarchy.
**Dependencies:** E1.T1.
**Trace:** Q17, Q18.

**Acceptance criteria**

* ADR states Goal/Plan/Spec are optional.
* ADR states Task is universal execution unit.
* ADR notes older Project → Goal → Spec → Task framing is superseded for Phase 2.
* ADR includes non-engineering Plan semantics.

**Proof requirements**

* ADR file path.
* Reviewer signoff.
* Link from product spec/docs index.

---

## Epic E2 — Task model, worktypes, planning objects, and principals

### E2.T1 — Schema: task required fields and universal lifecycle

**Layer:** Schema/data
**Scope:** Add/normalize Task fields for initiator, owner, assignee/executor, worktype, universal lifecycle, policy result, receipt status.
**Dependencies:** E1.T1.
**Trace:** Q20, Q25, Q26, Q27, Q28, Q29.

**Acceptance criteria**

* Task requires project/org/team scope.
* Task has required initiator and owner fields.
* Owner is individual principal only.
* Executable task requires individual assignee/executor or allowed Task-Master-drivable unassigned state.
* Universal lifecycle states are represented independently from worktype overlays.
* Migration-warning state allows old partial tasks without pretending they are clean.

**Proof requirements**

* Schema diff.
* Unit tests for task validation.
* Fixture tests for missing owner, missing initiator, unassigned Task-Master-drivable, and routing problem.
* Documentation of backward compatibility behavior.

---

### E2.T2 — Schema: Goal/Plan/Spec planning objects

**Layer:** Schema/data
**Scope:** Add first-class optional Goal, Plan, and Spec objects.
**Dependencies:** E1.T1.
**Trace:** Q17, Q18, Q19.

**Acceptance criteria**

* Goal, Plan, and Spec can link to tasks.
* Plan supports non-coding/domain labels.
* Spec supports engineering planning.
* Lifecycle state and derived health are separate fields.
* Tasks can exist without any Goal/Plan/Spec.

**Proof requirements**

* Schema diff.
* Unit tests for linking/unlinking tasks.
* Derived health fixture tests.
* Sample Goal, Plan, Spec records.

---

### E2.T3 — API: task create/update/transition

**Layer:** API/service
**Scope:** Implement task create/update/transition APIs enforcing required fields and universal state.
**Dependencies:** E2.T1, E7.T1.
**Trace:** Q20, Q25–Q30.

**Acceptance criteria**

* New tasks require initiator and individual owner.
* Invalid owner type is rejected.
* Invalid final assignee type is rejected.
* Unassigned tasks require Task-Master-drivable policy or become routing problems.
* State transitions record ActivityEvents.
* Worktype overlays cannot replace universal lifecycle state.

**Proof requirements**

* API tests for success/failure cases.
* Example request/response fixtures.
* Activity event fixture after transition.
* Error message snapshots.

---

### E2.T4 — API: planning object CRUD and task linking

**Layer:** API/service
**Scope:** Implement Goal/Plan/Spec APIs and task link management.
**Dependencies:** E2.T2.
**Trace:** Q17, Q18, Q19.

**Acceptance criteria**

* Create/read/update Goal, Plan, Spec.
* Link/unlink tasks.
* Derived health updates from linked task state.
* Plan supports domain labels for sales/CS/people/ops.

**Proof requirements**

* API tests.
* Derived health test fixture.
* Example plan with sales/CS/people label.

---

### E2.T5 — UI: task detail identity/accountability panel

**Layer:** UI/UX
**Scope:** Show initiator, created_by, owner, assignee, executor, submitted_by, reviewer, approver distinctly.
**Dependencies:** E2.T3.
**Trace:** Q23–Q30.

**Acceptance criteria**

* UI does not collapse initiator/owner/assignee/reviewer.
* Missing owner/initiator states are visible for migrated tasks.
* Task-Master-drivable unassigned tasks are distinct from routing problems.
* Individual accountability is clear.

**Proof requirements**

* Screenshot/DOM receipt for normal assigned task.
* Screenshot/DOM receipt for Task-Master-drivable unassigned task.
* Screenshot/DOM receipt for migration-warning task.
* Copy review for label clarity.

---

### E2.T6 — UI: planning objects and worktype overlays

**Layer:** UI/UX
**Scope:** Show Goal/Plan/Spec containers and domain overlays without engineering-only bias.
**Dependencies:** E2.T4.
**Trace:** Q8, Q17–Q20.

**Acceptance criteria**

* Project can show tasks grouped by optional Goal/Plan/Spec.
* Non-coding Plan labels render for sales/people/CS.
* Universal state remains visible.
* Worktype-specific fields appear as overlays.

**Proof requirements**

* Screenshots for Plan and Spec examples.
* Fixture data for biz-ops worktype.
* UI test for task without planning parent.

---

### E2.T7 — Tests: task model and planning object behavior

**Layer:** Tests/validation
**Scope:** Validate task identity, lifecycle, planning links, and overlays.
**Dependencies:** E2.T1–E2.T6.
**Trace:** Q17–Q30.

**Acceptance criteria**

* Tests cover required fields.
* Tests cover lifecycle transitions.
* Tests cover Plan/Spec optionality.
* Tests cover individual-only owner/assignee.
* Tests cover unassigned policy state.

**Proof requirements**

* Test run output.
* Fixture coverage report.
* Failure injection for invalid owner/assignee.

---

### E2.T8 — Docs: task model and principal semantics

**Layer:** Docs
**Scope:** Document task fields and principal distinctions.
**Dependencies:** E2.T1–E2.T5.
**Trace:** Q20, Q25–Q30.

**Acceptance criteria**

* Docs define created_by, initiator, owner, assignee, executor, submitted_by, reviewer, approver.
* Docs define universal lifecycle and worktype overlays.
* Docs define Task-Master-drivable unassigned behavior.
* Docs include migration-warning semantics.

**Proof requirements**

* Docs path.
* Example diagrams.
* Reviewer signoff from product and engineering.

---

## Epic E3 — Docs/files/artifacts object model

### E3.T1 — Schema: NativeDocument

**Layer:** Schema/data
**Scope:** Implement Entity-owned markdown document model.
**Dependencies:** E1.T1, E7.T1.
**Trace:** Q9, Q14.

**Acceptance criteria**

* NativeDocument stores markdown body reference/path and content hash.
* Supports editable versioned and immutable modes.
* Links to tasks/projects/goals/plans/specs.
* Applies sensitivity/ACL fields.
* Can serve as default/fallback doc layer.

**Proof requirements**

* Schema diff.
* Unit tests for create/update/version behavior.
* Permission fixture.
* Example markdown document.

---

### E3.T2 — Schema: ExternalDocumentRef

**Layer:** Schema/data
**Scope:** Implement externally owned document reference model.
**Dependencies:** E1.T1, E7.T1.
**Trace:** Q9, Q11, Q14.

**Acceptance criteria**

* ExternalDocumentRef tracks connector type, external id/url, title, auth state, readiness state, capabilities, canonicality, sync/check timestamps.
* Can link to tasks/projects/goals/plans/specs.
* No required write capability.
* Entity visibility policy is separate from external permission summary.

**Proof requirements**

* Schema diff.
* Unit tests for auth/readiness/capability states.
* Example Google Docs ref fixture.
* Permission fixture.

---

### E3.T3 — Schema: EvidenceArtifact

**Layer:** Schema/data
**Scope:** Implement evidence artifact model with mutability and provenance.
**Dependencies:** E1.T1, E7.T1.
**Trace:** Q10, Q14, Q15, Q16, Q36, Q37.

**Acceptance criteria**

* Artifact kinds include raw_task_receipt and curated_report/rollup.
* Raw receipts are immutable append-only.
* Curated reports are editable versioned.
* Origin task and generalized links are supported.
* Storage path, content hash, integrity state, source activity refs are stored.

**Proof requirements**

* Schema diff.
* Unit tests for immutable vs versioned mutation.
* Example raw receipt artifact.
* Example curated report artifact.

---

### E3.T4 — API: NativeDocument read/write markdown

**Layer:** API/service
**Scope:** Implement native markdown document create/read/update/version APIs.
**Dependencies:** E3.T1, E7.T2.
**Trace:** Q9, Q14.

**Acceptance criteria**

* Markdown documents can be created and updated where permission permits.
* Version history exists for editable_versioned docs.
* Immutable docs cannot be overwritten.
* Linked object refs are returned.
* Content hash is recorded.

**Proof requirements**

* API tests.
* Example request/response.
* Version history fixture.
* Immutable mutation rejection test.

---

### E3.T5 — API: artifact create/read/link/supersede

**Layer:** API/service
**Scope:** Implement EvidenceArtifact service.
**Dependencies:** E3.T3.
**Trace:** Q15, Q16, Q36, Q37.

**Acceptance criteria**

* Raw receipt artifacts can be created and read.
* Raw receipt body cannot be overwritten.
* Supersession creates new artifact/event.
* Curated artifacts can be edited with version history.
* Artifacts link to tasks and planning objects.

**Proof requirements**

* API tests.
* Supersession fixture.
* Version history fixture.
* Permission denial test.

---

### E3.T6 — UI: docs/files/artifacts distinctions

**Layer:** UI/UX
**Scope:** Display NativeDocument, ExternalDocumentRef, and EvidenceArtifact as separate object types.
**Dependencies:** E3.T1–E3.T5.
**Trace:** Q9, Q14, Q15.

**Acceptance criteria**

* UI labels external docs as external and connector-backed.
* UI labels Entity-native markdown as Entity-owned.
* UI labels raw proof vs curated interpretation.
* Task detail can show external Google Doc ref and native markdown artifact together.
* Missing connector auth/readiness state is visible.

**Proof requirements**

* Screenshots for each object type.
* Screenshot showing all three linked to one task.
* UI test for degraded external doc auth.
* Copy review for canonicality labels.

---

### E3.T7 — Tests: document/artifact permissions and mutability

**Layer:** Tests/validation
**Scope:** Validate object separation, permissioning, and mutation rules.
**Dependencies:** E3.T1–E3.T6, E7.T1.
**Trace:** Q14, Q15, Q39.

**Acceptance criteria**

* Tests prove raw artifacts cannot be overwritten.
* Tests prove curated reports version.
* Tests prove restricted docs/artifacts hide snippets/previews.
* Tests prove external doc refs do not imply Entity can write to external system.

**Proof requirements**

* Test run output.
* Permission denial snapshots.
* Mutation rejection snapshots.

---

### E3.T8 — Docs: document/artifact model ADR

**Layer:** Docs
**Scope:** Document ExternalDocumentRef vs NativeDocument vs EvidenceArtifact.
**Dependencies:** E3.T1–E3.T3.
**Trace:** Q9, Q11, Q14, Q15, Q16.

**Acceptance criteria**

* ADR defines canonicality, mutability, provenance, permissions, and connector posture.
* ADR states Google Docs are read/index/link/preview first.
* ADR states native markdown is canonical for machine/proof receipts.
* ADR states raw proof vs curated interpretation distinction.

**Proof requirements**

* ADR file path.
* Review signoff.
* Link from developer docs.

---

## Epic E4 — Canonical markdown receipts and proof-backed completion

### E4.T1 — Schema: receipt metadata and integrity fields

**Layer:** Schema/data
**Scope:** Add receipt metadata fields to Task and EvidenceArtifact.
**Dependencies:** E3.T3, E5.T1.
**Trace:** Q10, Q35, Q36, Q37.

**Acceptance criteria**

* Task stores receipt_artifact_id and receipt_status.
* EvidenceArtifact stores path, hash, origin task, source activity refs, mutability policy, integrity state.
* Receipt failure and integrity error states are represented.
* Stable artifact-id path is supported.

**Proof requirements**

* Schema diff.
* Unit tests for receipt status transitions.
* Example DB record.

---

### E4.T2 — Service: synchronous receipt writer

**Layer:** API/service
**Scope:** Implement receipt writer invoked during `entity-mc` task completion.
**Dependencies:** E4.T1, E3.T5, E5.T2, E6.T2.
**Trace:** Q10, Q33–Q37.

**Acceptance criteria**

* Completion writes DB metadata and markdown artifact body before `done`.
* Receipt includes required minimal sections.
* Receipt generated from task projection plus activity events.
* Missing evidence is explicit.
* Receipt includes full routing chain for auto-reassigned work.
* Failure blocks clean completion and records explicit error.

**Proof requirements**

* Unit tests for receipt markdown template.
* Integration test for successful completion.
* Failure-injection test for DB write failure.
* Failure-injection test for artifact body write failure.
* Snapshot of generated receipt.

---

### E4.T3 — API: complete task with receipt invariant

**Layer:** API/service
**Scope:** Enforce receipt creation in task completion API.
**Dependencies:** E4.T2, E2.T3, E5.T2.
**Trace:** Q10, Q35, Q36.

**Acceptance criteria**

* Completed `entity-mc` task cannot become `done` without receipt.
* Review/human gate policy is evaluated.
* Completion response includes receipt artifact.
* Receipt failure returns explicit API error/state.
* Activity event records receipt creation/failure.

**Proof requirements**

* API integration tests.
* Response fixtures.
* Activity event fixture.
* Receipt failure response example.

---

### E4.T4 — UI: receipt viewer and proof panel

**Layer:** UI/UX
**Scope:** Render canonical markdown receipt and linked evidence/output artifacts in task detail/review.
**Dependencies:** E4.T3, E3.T6.
**Trace:** Q3, Q10, Q14, Q35–Q37.

**Acceptance criteria**

* Task detail shows receipt status and link.
* Receipt markdown renders readably.
* Missing evidence state is explicit.
* Raw proof vs curated report is visually distinct.
* Integrity errors are visible.
* Review UI can inspect receipt before decision.

**Proof requirements**

* Screenshot/DOM receipt for valid receipt.
* Screenshot/DOM receipt for missing evidence.
* Screenshot/DOM receipt for integrity error.
* UI test for receipt link route.

---

### E4.T5 — Service: receipt path aliases and task move behavior

**Layer:** API/service
**Scope:** Implement stable artifact path plus virtual/deep-link aliases.
**Dependencies:** E4.T1.
**Trace:** Q37.

**Acceptance criteria**

* Canonical storage uses `/artifacts/evidence/<artifact_id>.md`.
* Task/project moves do not change canonical artifact path.
* Virtual paths update or resolve to current object location.
* Direct artifact links remain valid.

**Proof requirements**

* Unit tests for path generation.
* Integration test moving task/project.
* Before/after link resolution proof.

---

### E4.T6 — Tests: receipt invariant and integrity

**Layer:** Tests/validation
**Scope:** Comprehensive receipt tests.
**Dependencies:** E4.T1–E4.T5.
**Trace:** Q10, Q33–Q37.

**Acceptance criteria**

* Tests cover success path.
* Tests cover missing evidence.
* Tests cover auto-reassigned execution chain.
* Tests cover write failure.
* Tests cover hash mismatch/body missing.
* Tests cover immutable raw receipt mutation rejection.

**Proof requirements**

* Test run output.
* Receipt snapshots.
* Failure logs.
* Coverage summary for receipt paths.

---

### E4.T7 — Docs: canonical receipt protocol

**Layer:** Docs
**Scope:** Document receipt generation, storage, template, path, failure behavior.
**Dependencies:** E4.T1–E4.T6.
**Trace:** Q10, Q35–Q37.

**Acceptance criteria**

* Docs state no completed `entity-mc` task without canonical markdown receipt.
* Docs define minimal receipt fields.
* Docs define DB + artifact hybrid storage.
* Docs define failure/integrity behavior.
* Docs define stable path and virtual path rules.

**Proof requirements**

* Docs path.
* Example receipt.
* Reviewer signoff.

---

## Epic E5 — Review, policy resolution, human gates, and reviewer assignment

### E5.T1 — Schema: policy result, review, human gate

**Layer:** Schema/data
**Scope:** Add policy resolution, review, reviewer assignment, override, and human gate fields.
**Dependencies:** E2.T1, E7.T1.
**Trace:** Q21–Q24.

**Acceptance criteria**

* Task stores resolved review/human gate decisions and reason chains.
* Reviewer assignment provenance fields exist.
* Human gate fields are separate from review fields.
* Overrides record actor, time, from/to, and reason.
* Separation-of-duties checks can be represented.

**Proof requirements**

* Schema diff.
* Unit tests for field validation.
* Example records for policy auto assignment and override.

---

### E5.T2 — Service: layered policy resolver

**Layer:** API/service
**Scope:** Implement deterministic layered policy resolver.
**Dependencies:** E5.T1, E7.T2.
**Trace:** Q21, Q22, Q40.

**Acceptance criteria**

* Resolver accepts workspace/org/team/project/worktype/task/risk/agent trust inputs.
* Outputs review_required, human_gate_required, reviewer/approver targets, taskmaster_drivable, stall policy, notification route decisions.
* Reason chain is stored and explainable.
* Higher-risk layers can escalate; lower-risk layers cannot silently bypass mandatory gates.
* Resolution is deterministic for same inputs.

**Proof requirements**

* Unit tests with policy fixtures.
* Snapshot tests for reason chains.
* Conflict/escalation test cases.
* API response fixtures.

---

### E5.T3 — Service: reviewer/approver assignment

**Layer:** API/service
**Scope:** Implement eligible reviewer/approver selection and audited overrides.
**Dependencies:** E5.T2, E7.T2.
**Trace:** Q23, Q24.

**Acceptance criteria**

* Agent work defaults to Task Master/eligible peer-agent review where policy says so.
* Human work can default to initiator where separation-of-duties permits.
* Same-team/capability pool fallback works.
* Self-review is blocked.
* Owner/team lead/admin override records full audit trail.
* Assignee/agent suggestion cannot bypass policy.

**Proof requirements**

* Unit tests for assignment scenarios.
* Self-review rejection test.
* Override audit fixture.
* Load/availability selection fixture if implemented.

---

### E5.T4 — API: review decisions and request-fix flow

**Layer:** API/service
**Scope:** Implement review accept/request-fix APIs.
**Dependencies:** E5.T3, E4.T3.
**Trace:** Q21–Q24.

**Acceptance criteria**

* Reviewer can accept or request fix when authorized.
* Decision records actor, timestamp, reason.
* Request-fix moves task according to policy.
* Review cannot be accepted by ineligible reviewer.
* Receipt/review linkage remains intact.

**Proof requirements**

* API tests.
* Request-fix flow fixture.
* Ineligible reviewer rejection fixture.
* Activity event proof.

---

### E5.T5 — API: human gate approve/reject

**Layer:** API/service
**Scope:** Implement human gate request/approve/reject APIs.
**Dependencies:** E5.T2, E5.T3.
**Trace:** Q21, Q22.

**Acceptance criteria**

* Human gate required tasks cannot bypass gate.
* Approver must be eligible human principal.
* Approval/rejection records decision reason and actor.
* Gate is distinct from peer review.
* External-send/customer/HR/legal/financial triggers can require gate by policy.

**Proof requirements**

* API tests.
* Policy fixture for external send.
* Policy fixture for HR/people task.
* Gate rejection fixture.

---

### E5.T6 — UI: policy reason chain and review panel

**Layer:** UI/UX
**Scope:** Show review requirement, reviewer, gate requirement, and reasons in task detail.
**Dependencies:** E5.T4, E5.T5, E4.T4.
**Trace:** Q21–Q24.

**Acceptance criteria**

* UI explains why review/human gate is required.
* Reviewer/approver assignment reason is visible.
* Accept/request-fix controls appear only when authorized.
* Human gate controls are separate from review controls.
* Self-review path is not presented as valid.

**Proof requirements**

* Screenshot for review-required task.
* Screenshot for human-gated task.
* Screenshot for self-review blocked state.
* UI tests for control visibility.

---

### E5.T7 — Tests: policy/review/gate matrix

**Layer:** Tests/validation
**Scope:** Test policy resolver and review/gate decisions across worktypes/risk.
**Dependencies:** E5.T1–E5.T6.
**Trace:** Q21–Q24.

**Acceptance criteria**

* Tests cover low-risk no-review path where policy allows.
* Tests cover agent work peer review path.
* Tests cover external-send human gate.
* Tests cover people/HR sensitivity gate.
* Tests cover missing evidence review escalation.
* Tests cover override audit.

**Proof requirements**

* Test matrix output.
* Snapshot reason chains.
* Audit event fixtures.

---

### E5.T8 — Docs: policy and review model

**Layer:** Docs
**Scope:** Document layered policy resolution, review, human gate, reviewer assignment.
**Dependencies:** E5.T1–E5.T7.
**Trace:** Q21–Q24.

**Acceptance criteria**

* Docs explain policy layers.
* Docs explain review vs human gate.
* Docs explain default reviewer pools.
* Docs explain initiator default for human workflows.
* Docs explain Task Master/peer-agent path for agent workflows.
* Docs explain override audit.

**Proof requirements**

* Docs path.
* Policy examples.
* Reviewer signoff.

---

## Epic E6 — Task Master routing, nudging, escalation, and reassignment

### E6.T1 — Schema: assignment history and Task Master events

**Layer:** Schema/data
**Scope:** Add structured ActivityEvent payloads for claim, nudge, escalation, reassignment.
**Dependencies:** E2.T1, E5.T1.
**Trace:** Q29–Q34.

**Acceptance criteria**

* Assignment history is distinct from current assignment.
* Claim events record prior assignee, claiming principal, policy reason, timestamp, claim source.
* Nudge events record channel, target, attempt count, policy reason.
* Escalation events record owner target.
* Reassignment events record prior/new assignee, thresholds, policy reason, actor.

**Proof requirements**

* Schema/event payload examples.
* Unit tests for event validation.
* Fixture showing full routing chain.

---

### E6.T2 — Service: Task Master claim for unassigned/self-assigned tasks

**Layer:** API/service
**Scope:** Implement Task Master claim behavior for allowed tasks.
**Dependencies:** E6.T1, E5.T2.
**Trace:** Q29, Q30.

**Acceptance criteria**

* Task Master can claim unassigned Task-Master-drivable task.
* Current executor becomes Task Master.
* Original unassigned state preserved in activity history.
* Atomic claim prevents double-claim.
* Non-drivable unassigned task remains routing problem.

**Proof requirements**

* Unit/integration tests for claim.
* Double-claim race test.
* Activity event fixture.
* API response fixture.

---

### E6.T3 — Service: stalled assigned task nudge

**Layer:** API/service
**Scope:** Implement nudge behavior for stalled assigned tasks.
**Dependencies:** E6.T1, E10.T2.
**Trace:** Q31.

**Acceptance criteria**

* Task Master nudges named assignee/executor first.
* Nudge uses configured channel route.
* Nudge event records target/channel/policy reason.
* Task Master does not execute on behalf of assigned principal.

**Proof requirements**

* Unit tests for stall threshold.
* Notification route fixture.
* Activity event fixture.
* Negative test proving no takeover.

---

### E6.T4 — Service: owner escalation

**Layer:** API/service
**Scope:** Escalate stalled task to owner after nudge threshold.
**Dependencies:** E6.T3.
**Trace:** Q31.

**Acceptance criteria**

* Owner escalation occurs after configured threshold.
* Escalation notification uses canonical Entity notification record.
* Activity event records owner target and reason.
* Escalation respects permissions and sensitivity.

**Proof requirements**

* Integration test.
* Notification fixture.
* Activity event fixture.
* Sensitive task escalation permission test.

---

### E6.T5 — Service: policy-based auto-reassignment

**Layer:** API/service
**Scope:** Auto-reassign stalled tasks after thresholds when policy permits.
**Dependencies:** E6.T4, E5.T2.
**Trace:** Q31, Q32, Q33.

**Acceptance criteria**

* Auto-reassign only when policy permits.
* Owner approval not globally required once policy threshold is met.
* New assignee is eligible individual principal.
* Event records threshold, prior assignee, new assignee, owner escalation history, policy reason, Task Master actor.
* High-risk policy can block auto-reassignment.

**Proof requirements**

* Unit tests for allowed and blocked auto-reassign.
* Activity event fixture.
* Notification fixture.
* Receipt fixture after reassigned completion.

---

### E6.T6 — UI: routing status and history

**Layer:** UI/UX
**Scope:** Display claimed/nudged/escalated/reassigned states and history.
**Dependencies:** E6.T2–E6.T5.
**Trace:** Q30–Q33.

**Acceptance criteria**

* UI distinguishes claimed by Task Master from manually assigned.
* UI shows stalled/nudged/escalated/reassigned states.
* Auto-reassigned explanation is visible.
* Execution chain is compact with expandable audit detail.
* Routing problem state is visible.

**Proof requirements**

* Screenshots for each state.
* UI tests for routing labels.
* Example full execution chain.

---

### E6.T7 — Tests: Task Master routing matrix

**Layer:** Tests/validation
**Scope:** Validate Task Master behavior across assignment states.
**Dependencies:** E6.T1–E6.T6.
**Trace:** Q29–Q34.

**Acceptance criteria**

* Tests cover unassigned drivable claim.
* Tests cover unassigned non-drivable routing problem.
* Tests cover assigned stalled nudge.
* Tests cover owner escalation.
* Tests cover auto-reassignment allowed/blocked.
* Tests cover receipt execution chain after reassignment.

**Proof requirements**

* Test matrix output.
* Activity event snapshots.
* Receipt snapshot for reassigned task.

---

### E6.T8 — Docs: Task Master routing policy

**Layer:** Docs
**Scope:** Document Task Master drive/nudge/escalate/reassign boundaries.
**Dependencies:** E6.T1–E6.T7.
**Trace:** Q29–Q34.

**Acceptance criteria**

* Docs state Task Master is not universal executor.
* Docs define unassigned/self-assigned drive behavior.
* Docs define assigned stalled nudge behavior.
* Docs define owner escalation and auto-reassignment thresholds.
* Docs define receipt execution-chain requirements.

**Proof requirements**

* Docs path.
* Sequence diagrams.
* Reviewer signoff.

---

## Epic E7 — Permissions, RBAC, object sensitivity, and audit

### E7.T1 — Schema: roles, grants, sensitivity, ACL

**Layer:** Schema/data
**Scope:** Implement layered RBAC + object sensitivity fields.
**Dependencies:** E1.T1.
**Trace:** Q2, Q39.

**Acceptance criteria**

* Org/team/project roles exist or are normalized.
* Object-level sensitivity and ACL fields exist for tasks/docs/artifacts/external refs/activity/search/notifications.
* Sensitive categories include people/HR, customer/account-sensitive, legal, financial, security, production, confidential strategy, workspace-defined restricted.
* Object-level restrictions can override inherited access.

**Proof requirements**

* Schema diff.
* Permission fixture records.
* Unit tests for inheritance/override.

---

### E7.T2 — Service: permission evaluator

**Layer:** API/service
**Scope:** Centralize permission checks across objects and snippets/previews.
**Dependencies:** E7.T1.
**Trace:** Q39.

**Acceptance criteria**

* Evaluator handles org/team/project inheritance.
* Evaluator handles object sensitivity/ACL override.
* Evaluator returns decisions for read/write/admin/review/approve/search_preview.
* Denied content does not leak sensitive fields.
* Connector refs combine Entity visibility with external permission state.

**Proof requirements**

* Unit tests for role inheritance.
* Unit tests for sensitivity override.
* Snippet suppression test.
* Cross-org denial test.

---

### E7.T3 — API middleware: enforce permissions consistently

**Layer:** API/service
**Scope:** Apply permission evaluator to core APIs.
**Dependencies:** E7.T2.
**Trace:** Q39.

**Acceptance criteria**

* Tasks, docs, artifacts, external refs, activity, search, notifications, Helm status widgets, ClickClack refs all check permissions.
* Mutation permissions differ from read permissions.
* Review/approve permissions are explicit.
* Errors do not leak restricted content.

**Proof requirements**

* API tests across object types.
* Negative permission tests.
* Error response snapshots.

---

### E7.T4 — UI: restricted access states

**Layer:** UI/UX
**Scope:** Show restricted/degraded access without leaking content.
**Dependencies:** E7.T3.
**Trace:** Q39.

**Acceptance criteria**

* Restricted objects show safe placeholder or are hidden according to policy.
* UI explains access is restricted without exposing sensitive title/snippet if forbidden.
* Search results obey permission state.
* Activity/evidence restricted states are safe.

**Proof requirements**

* Screenshots for restricted artifact/task/doc.
* Search result screenshot with suppressed snippet.
* UI tests.

---

### E7.T5 — Tests: leakage and sensitivity suite

**Layer:** Tests/validation
**Scope:** Prove restricted data cannot leak through search, snippets, previews, activity, refs.
**Dependencies:** E7.T1–E7.T4.
**Trace:** Q39.

**Acceptance criteria**

* Tests cover HR artifact.
* Tests cover customer-sensitive task.
* Tests cover external doc preview denial.
* Tests cover activity log denial.
* Tests cover notification visibility.
* Tests cover ClickClack-linked object permission.

**Proof requirements**

* Security test run output.
* Fixtures with restricted content.
* Denied response snapshots.

---

### E7.T6 — Docs: RBAC and sensitivity model

**Layer:** Docs
**Scope:** Document roles, inheritance, object sensitivity, ACL, search/snippet rules.
**Dependencies:** E7.T1–E7.T5.
**Trace:** Q39.

**Acceptance criteria**

* Docs define role hierarchy.
* Docs define object sensitivity categories.
* Docs define search/snippet permission rules.
* Docs define Google Docs connector visibility semantics.
* Docs define audit expectations.

**Proof requirements**

* Docs path.
* Example policy table.
* Security reviewer signoff.

---

## Epic E8 — Agent identity, runtime/provider abstraction, and agent activity

### E8.T1 — Schema: unified human/agent principals

**Layer:** Schema/data
**Scope:** Normalize principal model for humans, agents, systems/workflows.
**Dependencies:** E1.T1, E7.T1.
**Trace:** Q1, Q2, Q5, Q25–Q30.

**Acceptance criteria**

* Principal can be human, agent, workflow/system/imported source.
* Agent principals are user-added, not hardcoded.
* Task Master is represented as an individual agent/system principal for accountability.
* Principal can link to runtime/provider refs.
* Agent ownership seam supports person-owned/team-owned agents where applicable without making task owner team-based.

**Proof requirements**

* Schema diff.
* Principal fixture set.
* Tests for agent/human/taskmaster principal use.

---

### E8.T2 — Schema/API: runtime provider references

**Layer:** Schema/API
**Scope:** Add runtime/provider abstraction independent of OpenClaw/Hermes.
**Dependencies:** E8.T1.
**Trace:** Q5, Q13.

**Acceptance criteria**

* RuntimeProviderRef supports provider_type without hardcoding only OpenClaw/Hermes.
* managed_by can be Helm/external/unknown.
* Agent principal can link to provider ref.
* Trust level and status can feed policy.
* UI/API labels provider as runtime/provider, not Entity.

**Proof requirements**

* Schema/API tests.
* Fixtures for OpenClaw, Hermes, and a generic provider.
* Review confirming no hardcoded-only logic.

---

### E8.T3 — API: agent registry/status/activity projection

**Layer:** API/service
**Scope:** Expose agent identity, status, current work, capabilities/activity.
**Dependencies:** E8.T1, E8.T2, E11.T2.
**Trace:** Q1, Q5, Q13.

**Acceptance criteria**

* API returns agent identity, runtime/provider identity, status/source, capabilities/current work where available.
* Unknown/offline/degraded states are explicit.
* Does not imply OpenClaw/Hermes are Entity.
* Runtime-admin deep links route to Helm where applicable.

**Proof requirements**

* API tests.
* Fixtures for healthy/degraded/offline/unknown agents.
* Example response with Helm deep link.

---

### E8.T4 — UI: agents/activity surface

**Layer:** UI/UX
**Scope:** Display agents as collaborators/workers inside Entity.
**Dependencies:** E8.T3.
**Trace:** Q1, Q3, Q5, Q13.

**Acceptance criteria**

* Agent rows/cards show identity, provider/runtime, status/source, current work/capabilities.
* Unknown/offline states are honest.
* Agent management surface is first-class but deep runtime admin routes to Helm.
* Skills/recurring loops/current work visibility appears where data available.

**Proof requirements**

* Screenshots for healthy/degraded/offline agent.
* UI test for provider label.
* Copy review for runtime-agnostic wording.

---

### E8.T5 — Tests: runtime-agnostic agent fixtures

**Layer:** Tests/validation
**Scope:** Validate multiple provider types and policy trust use.
**Dependencies:** E8.T1–E8.T4.
**Trace:** Q5.

**Acceptance criteria**

* Tests include OpenClaw, Hermes, and generic provider.
* Tests prove provider-specific logic is adapter-bound, not Entity core.
* Agent trust level can affect policy resolution.
* Offline provider does not break task/doc/review flows.

**Proof requirements**

* Test run output.
* Fixture report.
* Architecture review note.

---

### E8.T6 — Docs: agent/runtime abstraction

**Layer:** Docs
**Scope:** Document agent principal, provider refs, Helm boundary, runtime-agnostic rules.
**Dependencies:** E8.T1–E8.T5.
**Trace:** Q1, Q5, Q13.

**Acceptance criteria**

* Docs state OpenClaw/Hermes are providers/runtimes, not Entity.
* Docs state Entity consumes runtime-backed agents as work-plane collaborators.
* Docs define provider ref contract.
* Docs define agent status/activity ownership.

**Proof requirements**

* Docs path.
* Reviewer signoff.

---

## Epic E9 — Search and indexing

### E9.T1 — Schema/index: unified search envelope

**Layer:** Schema/data
**Scope:** Define index records and unified result envelope.
**Dependencies:** E3.T1–E3.T3, E7.T1.
**Trace:** Q38, Q39.

**Acceptance criteria**

* Index supports tasks, NativeDocuments, EvidenceArtifacts, ExternalDocumentRefs, activity, ClickClack refs, projects/goals/plans/specs, principals.
* Result envelope includes object type, title, snippet, source, link, recency, provenance, permission state.
* Index records carry org/team/project scope and sensitivity.

**Proof requirements**

* Schema/index mapping.
* Sample indexed records.
* Unit tests for envelope construction.

---

### E9.T2 — Service: indexers for Entity objects

**Layer:** API/service
**Scope:** Index tasks, docs, artifacts, activity, planning objects, principals.
**Dependencies:** E9.T1, E7.T2.
**Trace:** Q38.

**Acceptance criteria**

* Index updates on create/update/link events.
* Activity log and evidence receipts are indexed.
* Permission metadata is included.
* Index lag is observable.

**Proof requirements**

* Integration tests.
* Index sample dump.
* Event-to-index proof.

---

### E9.T3 — Service: external and ClickClack indexing adapters

**Layer:** API/service
**Scope:** Index Google Docs metadata/snippets where authorized and ClickClack threads/messages where integrated.
**Dependencies:** E9.T1, E12.T2, E13.T2.
**Trace:** Q12, Q38.

**Acceptance criteria**

* Google Docs indexing is read-only and respects auth state.
* ClickClack indexing only occurs where integrated/authorized.
* Degraded connector state does not break global search.
* External source is clearly labeled.

**Proof requirements**

* Connector indexing tests.
* Degraded connector fixture.
* Search result samples.

---

### E9.T4 — API: global and scoped search

**Layer:** API/service
**Scope:** Implement global search with filters.
**Dependencies:** E9.T2, E9.T3, E7.T2.
**Trace:** Q38, Q39.

**Acceptance criteria**

* Search supports global query.
* Filters include object type, source, team/project, worktype, owner, assignee, initiator, lifecycle state, review state, risk, date, connector/auth state.
* Permission filtering suppresses unauthorized results/snippets.
* Search returns canonical/deep links.

**Proof requirements**

* API tests.
* Permissioned search tests.
* Filter matrix output.
* Example search responses.

---

### E9.T5 — UI: global search and scoped tabs

**Layer:** UI/UX
**Scope:** Build search experience with filters and object-type tabs.
**Dependencies:** E9.T4.
**Trace:** Q38.

**Acceptance criteria**

* Global search is available from workspace shell.
* Scoped tabs/filters exist for tasks/docs/evidence/external refs/activity/chat/projects/plans/specs/people/agents.
* Results clearly show source and object type.
* Restricted snippets are suppressed.
* External connector state is visible where relevant.

**Proof requirements**

* Screenshots of global results.
* Screenshots of filtered evidence search.
* Screenshot of restricted result.
* UI tests for filters.

---

### E9.T6 — Tests: search permission and relevance smoke

**Layer:** Tests/validation
**Scope:** Validate search indexing, filtering, and permission safety.
**Dependencies:** E9.T1–E9.T5.
**Trace:** Q38, Q39.

**Acceptance criteria**

* Tests cover each major object type.
* Tests cover restricted artifact snippet suppression.
* Tests cover external doc auth degraded state.
* Tests cover activity log search.
* Tests cover team/project/worktype filters.

**Proof requirements**

* Test run output.
* Search fixture data.
* Denied snippet snapshots.

---

### E9.T7 — Docs: search/indexing contract

**Layer:** Docs
**Scope:** Document search envelope, indexed sources, filters, permission rules.
**Dependencies:** E9.T1–E9.T6.
**Trace:** Q38, Q39.

**Acceptance criteria**

* Docs define global + scoped search.
* Docs define result envelope.
* Docs define permission filtering.
* Docs define connector indexing states.
* Docs define index lag/observability.

**Proof requirements**

* Docs path.
* Example result envelopes.
* Reviewer signoff.

---

## Epic E10 — Notifications, inbox, escalation routing

### E10.T1 — Schema: canonical notification record

**Layer:** Schema/data
**Scope:** Implement Entity inbox/activity canonical notification record and delivery attempts.
**Dependencies:** E1.T1, E7.T1.
**Trace:** Q40.

**Acceptance criteria**

* Notification stores canonical event, object ref, recipient, notification type, inbox state.
* Delivery routes record channel, status, failure/degraded state, policy reason.
* External notification references Entity object; external channel is not source of truth.

**Proof requirements**

* Schema diff.
* Unit tests for notification record.
* Example delivery attempt records.

---

### E10.T2 — Service: notification routing policy

**Layer:** API/service
**Scope:** Route notifications to Entity inbox and external channels by policy.
**Dependencies:** E10.T1, E5.T2.
**Trace:** Q40.

**Acceptance criteria**

* Entity inbox notification is created first.
* Policy routes to ClickClack/email/Discord/Slack/AgentPush/webhooks where configured.
* Channel failure preserves canonical notification.
* Routes include reason chain.
* Notification types cover Task Master nudges, owner escalations, review requests, human gates, reassignment notices, receipt failures, connector degraded.

**Proof requirements**

* Unit tests for routing.
* Channel failure test.
* Example notification records.
* Policy reason snapshots.

---

### E10.T3 — API: inbox and notification status

**Layer:** API/service
**Scope:** Implement notification list/read/status APIs.
**Dependencies:** E10.T2, E7.T2.
**Trace:** Q40.

**Acceptance criteria**

* User can list their notifications.
* Permission checks hide restricted content.
* Delivery status is visible where allowed.
* Mark-read/archive state works.
* Notifications deep-link to canonical Entity object.

**Proof requirements**

* API tests.
* Permission denial test.
* Example inbox response.

---

### E10.T4 — UI: inbox and escalation states

**Layer:** UI/UX
**Scope:** Show canonical Entity inbox and task-level escalation notices.
**Dependencies:** E10.T3.
**Trace:** Q40, Q31–Q33.

**Acceptance criteria**

* Inbox shows review requests, human gates, nudges/escalations/reassignments, receipt failures.
* Task detail shows related notifications/escalation state.
* External delivery failures are visible without losing canonical notification.
* Deep links route to Entity work object.

**Proof requirements**

* Screenshots of inbox.
* Screenshot of failed external delivery.
* UI test for deep link.
* Screenshot of task escalation notice.

---

### E10.T5 — Tests: notification routing and degradation

**Layer:** Tests/validation
**Scope:** Validate canonical notification and channel failure behavior.
**Dependencies:** E10.T1–E10.T4.
**Trace:** Q40.

**Acceptance criteria**

* Tests cover inbox-first behavior.
* Tests cover ClickClack/email/webhook failure.
* Tests cover restricted object notification.
* Tests cover Task Master nudge and owner escalation.
* Tests cover human gate request.

**Proof requirements**

* Test run output.
* Delivery failure fixtures.
* Notification snapshots.

---

### E10.T6 — Docs: notification/escalation routing

**Layer:** Docs
**Scope:** Document canonical notification model and external route semantics.
**Dependencies:** E10.T1–E10.T5.
**Trace:** Q40.

**Acceptance criteria**

* Docs state Entity inbox/activity is canonical.
* Docs define external channel routing.
* Docs define failure/degraded behavior.
* Docs define notification types and policy reasons.

**Proof requirements**

* Docs path.
* Sequence diagram.
* Reviewer signoff.

---

## Epic E11 — Helm integration and runtime/admin boundary

### E11.T1 — Contract: Entity↔Helm API spec

**Layer:** API/service contract
**Scope:** Define Helm status/light-control contract.
**Dependencies:** E8.T2, E7.T2.
**Trace:** Q4, Q5, Q13.

**Acceptance criteria**

* Contract includes runtime/agent status, current work, health/readiness, heartbeat, schedule/loop summary, deep links.
* Contract excludes credentials, secrets, model/provider config, schedule editing, tool permission grants, deployment/admin settings, destructive actions.
* Safe actions are reversible, policy-checked, and audited.
* Degraded/unavailable behavior defined.

**Proof requirements**

* Contract document.
* Example request/response fixtures.
* Boundary review signoff.

---

### E11.T2 — Service: Helm status adapter

**Layer:** API/service
**Scope:** Implement Entity-side adapter to consume Helm status contract.
**Dependencies:** E11.T1.
**Trace:** Q4, Q13.

**Acceptance criteria**

* Adapter fetches status where Helm reachable.
* Adapter returns degraded state where unreachable.
* Adapter does not expose secrets.
* Adapter maps Helm status to Entity RuntimeProviderRef/Agent status.
* Errors are observable.

**Proof requirements**

* Integration tests with mocked live/degraded Helm.
* Secret-leak negative test.
* Example status response.

---

### E11.T3 — Service: safe light controls

**Layer:** API/service
**Scope:** Implement optional pause/resume/request-retry forwarding where policy permits.
**Dependencies:** E11.T2, E5.T2, E7.T2.
**Trace:** Q13.

**Acceptance criteria**

* Actions are limited to safe reversible controls.
* Policy check required.
* Audit ActivityEvent recorded.
* Denied controls explain reason.
* Deep config remains in Helm.

**Proof requirements**

* API tests for allowed/denied controls.
* Audit event fixture.
* Boundary review confirming no deep admin mutation.

---

### E11.T4 — UI: Helm-backed runtime status panel

**Layer:** UI/UX
**Scope:** Show runtime/agent health summary and deep links to Helm.
**Dependencies:** E11.T2, E11.T3.
**Trace:** Q4, Q13.

**Acceptance criteria**

* Panel shows health/readiness/heartbeat/current work/schedule summary where available.
* Helm unavailable state is clear.
* Deep controls route/open Helm.
* No secrets shown.
* Entity remains visually/product-wise distinct from Helm.

**Proof requirements**

* Screenshots live/degraded states.
* UI test for no secret fields.
* Link/deep-link proof.

---

### E11.T5 — Tests: Helm boundary and degraded behavior

**Layer:** Tests/validation
**Scope:** Validate Entity↔Helm integration.
**Dependencies:** E11.T1–E11.T4.
**Trace:** Q4, Q13.

**Acceptance criteria**

* Tests cover reachable/unreachable Helm.
* Tests cover safe control allowed/denied.
* Tests prove deep admin endpoints not exposed through Entity.
* Tests prove Entity core work flows unaffected by Helm down.

**Proof requirements**

* Test run output.
* Mock Helm fixtures.
* Degraded UI screenshot.

---

### E11.T6 — Docs: Helm boundary ADR

**Layer:** Docs
**Scope:** Document Entity vs Helm product/API boundary.
**Dependencies:** E11.T1–E11.T5.
**Trace:** Q4, Q5, Q13.

**Acceptance criteria**

* Docs define Entity-owned and Helm-owned responsibilities.
* Docs define allowed Entity light controls.
* Docs define excluded Helm admin capabilities.
* Docs define degraded behavior.
* Docs state OpenClaw/Hermes are providers/runtimes, not Entity.

**Proof requirements**

* ADR path.
* Boundary table.
* Reviewer signoff.

---

## Epic E12 — ClickClack integration and degraded collaboration

### E12.T1 — Contract: Entity↔ClickClack boundary

**Layer:** API/service contract
**Scope:** Define chat/thread/channel/object-link readiness contract.
**Dependencies:** E1.T1, E7.T2.
**Trace:** Q12.

**Acceptance criteria**

* Contract states Entity owns work objects/context/permissions/links.
* Contract states ClickClack owns channels/threads/messages/composer/bridge.
* Thread refs can link to Entity objects.
* Readiness states include live/staged/degraded/unavailable/not_configured.
* ClickClack unavailable does not block docs/files/proof/review.

**Proof requirements**

* Contract document.
* Example thread ref payloads.
* Boundary review signoff.

---

### E12.T2 — Service: ClickClack bridge/proxy readiness adapter

**Layer:** API/service
**Scope:** Expose bridge/proxy status and thread refs to Entity.
**Dependencies:** E12.T1.
**Trace:** Q12.

**Acceptance criteria**

* Adapter reports readiness state.
* Adapter can link thread/channel refs to Entity objects where available.
* Failure returns degraded state, not core Entity failure.
* Permission checks apply to object links.

**Proof requirements**

* Integration tests with live/staged/degraded mocks.
* Permission test for linked object.
* Example readiness response.

---

### E12.T3 — UI: embedded/staged chat panel

**Layer:** UI/UX
**Scope:** Render ClickClack chat where stable; otherwise staged readiness panel.
**Dependencies:** E12.T2.
**Trace:** Q12.

**Acceptance criteria**

* Chat panel shows live/staged/degraded/unavailable state.
* Work object links are visible where permissioned.
* If bridge unavailable, docs/files/proof/review remain usable.
* UI does not claim chat is live when staged.

**Proof requirements**

* Screenshots for live/staged/degraded states.
* UI test proving proof/review path works while chat degraded.
* Copy review for readiness wording.

---

### E12.T4 — Tests: ClickClack degraded mode

**Layer:** Tests/validation
**Scope:** Validate bridge/proxy availability and degraded behavior.
**Dependencies:** E12.T1–E12.T3.
**Trace:** Q12.

**Acceptance criteria**

* Tests cover bridge available.
* Tests cover bridge unavailable.
* Tests cover permissioned object link.
* Tests cover core Entity task/proof flow with ClickClack down.

**Proof requirements**

* Test run output.
* Degraded screenshots.
* Bridge/proxy logs or mock receipts.

---

### E12.T5 — Docs: ClickClack integration guide

**Layer:** Docs
**Scope:** Document Entity/ClickClack integration, readiness states, degraded behavior.
**Dependencies:** E12.T1–E12.T4.
**Trace:** Q12.

**Acceptance criteria**

* Docs define ownership boundary.
* Docs define readiness states.
* Docs define link semantics.
* Docs define degraded behavior.
* Docs state chat polish must not block docs/files/proof/review.

**Proof requirements**

* Docs path.
* Integration sequence diagram.
* Reviewer signoff.

---

## Epic E13 — Google Docs/Drive connector V1

### E13.T1 — Contract: Google Docs/Drive read-only connector

**Layer:** API/service contract
**Scope:** Define read/index/link/preview connector contract and scopes.
**Dependencies:** E3.T2, E7.T2.
**Trace:** Q9, Q11, Q14.

**Acceptance criteria**

* Contract supports search/list/link/preview metadata/snippets where authorized.
* Contract does not include default write/update/create/export mutation.
* Auth/readiness/scope states are explicit.
* External permission summary and Entity visibility policy are separate.
* Writes/export are later-phase gated items.

**Proof requirements**

* Contract document.
* Example ExternalDocumentRef payload.
* Security review for no V1 mutation.

---

### E13.T2 — Service: connector metadata/search/link

**Layer:** API/service
**Scope:** Implement or adapt connector service for Google Docs metadata/search/link/preview.
**Dependencies:** E13.T1.
**Trace:** Q9, Q11.

**Acceptance criteria**

* Can list/search authorized docs metadata.
* Can link external doc to Entity object.
* Can refresh metadata.
* Handles unauthorized/expired/insufficient scope/degraded states.
* Does not mutate Google Docs/Drive.

**Proof requirements**

* API tests with mocked connector states.
* No-write negative test.
* Example linked doc response.
* Degraded auth fixture.

---

### E13.T3 — UI: external doc linking and preview state

**Layer:** UI/UX
**Scope:** Allow users to link and inspect Google Docs refs in Entity.
**Dependencies:** E13.T2, E3.T6.
**Trace:** Q9, Q11, Q14.

**Acceptance criteria**

* Task/project/planning object can show linked Google Doc/Drive item.
* UI shows title, source, open action, auth/readiness state, preview/metadata where available.
* UI distinguishes external Google Docs from Entity-native markdown/proof artifacts.
* If auth unavailable, setup/degraded state appears.
* No write/export controls shown as V1 default.

**Proof requirements**

* Screenshots for linked ready doc.
* Screenshot for expired auth.
* Screenshot showing external doc next to native artifact.
* UI test confirming no write controls.

---

### E13.T4 — Tests: Google connector read-only/degraded behavior

**Layer:** Tests/validation
**Scope:** Validate connector posture and permission behavior.
**Dependencies:** E13.T1–E13.T3.
**Trace:** Q11, Q39.

**Acceptance criteria**

* Tests cover authorized metadata read.
* Tests cover expired auth.
* Tests cover insufficient scope.
* Tests cover permissioned preview suppression.
* Tests prove no mutation endpoints are called in V1.

**Proof requirements**

* Test run output.
* Mock call log showing read-only calls.
* Permission denial fixture.

---

### E13.T5 — Docs: Google Docs connector posture

**Layer:** Docs
**Scope:** Document read-only/index/link/preview first; writes later gated.
**Dependencies:** E13.T1–E13.T4.
**Trace:** Q9, Q11.

**Acceptance criteria**

* Docs state Google Docs is external human document system.
* Docs state native markdown remains canonical for `entity-mc` receipts.
* Docs define auth/readiness states.
* Docs define later-phase write/export gates.
* Docs define no Curacel demo dependency.

**Proof requirements**

* Docs path.
* Connector state table.
* Reviewer signoff.

---

## Epic E14 — Progressive migration and backfill

### E14.T1 — Migration: inventory and dry-run report

**Layer:** Migration/backfill
**Scope:** Inventory existing tasks/docs/review packets/activity logs and report gaps.
**Dependencies:** E1.T1, E2.T1, E3.T1–E3.T3.
**Trace:** Q6, Q34, Q41.

**Acceptance criteria**

* Report counts existing tasks/projects/docs/review packets/activity logs.
* Report identifies missing owner/initiator/project/assignee/receipt/activity structure.
* No destructive writes.
* Report includes confidence categories and recommended cleanup queues.

**Proof requirements**

* Dry-run output file.
* Summary table.
* Sample warning records.
* Confirmation no writes occurred.

---

### E14.T2 — Migration: backfill org/team/project/initiator/owner/assignee

**Layer:** Migration/backfill
**Scope:** Progressive backfill for required task fields.
**Dependencies:** E14.T1, E2.T1.
**Trace:** Q25–Q29, Q41.

**Acceptance criteria**

* Inferred fields record source and confidence.
* Unknowns are marked explicitly.
* Owner backfill resolves to individual principal where possible.
* Team/unassigned owner does not become final task owner.
* Tasks without valid owner enter cleanup state.

**Proof requirements**

* Migration dry-run and write-run logs.
* Before/after sample records.
* Warning summary.
* Rollback plan.

---

### E14.T3 — Migration: review packet and evidence artifact mapping

**Layer:** Migration/backfill
**Scope:** Map existing `metadata.review_packet` into structured review/evidence fields where possible.
**Dependencies:** E3.T3, E4.T1, E5.T1.
**Trace:** Q10, Q14, Q34, Q41.

**Acceptance criteria**

* Existing evidence/output/done_criteria map to structured fields/artifact links where possible.
* Missing evidence marked explicitly.
* Historical completed tasks without canonical receipt are marked missing_receipt, not fabricated as original receipts.
* Backfill summaries, if created, are labeled as backfilled/curated, not raw original receipts.

**Proof requirements**

* Mapping report.
* Sample migrated review packet.
* Missing receipt warning sample.
* Tests verifying no fake raw receipt creation.

---

### E14.T4 — Migration: activity log structuring

**Layer:** Migration/backfill
**Scope:** Normalize existing activity log entries into structured ActivityEvents where possible.
**Dependencies:** E6.T1.
**Trace:** Q34, Q41.

**Acceptance criteria**

* Existing assignment/review/completion/artifact events are mapped where possible.
* Weak/ambiguous events are flagged.
* Structured activity becomes receipt source where sufficient.
* No second parallel event truth source is introduced.

**Proof requirements**

* Mapping report.
* Sample structured event conversion.
* Weak activity warning sample.
* Tests for receipt generation from structured events.

---

### E14.T5 — UI: migration warnings and cleanup queues

**Layer:** UI/UX
**Scope:** Surface incomplete migration states in Entity.
**Dependencies:** E14.T2–E14.T4.
**Trace:** Q41.

**Acceptance criteria**

* UI shows missing owner, unknown initiator, missing receipt, weak activity structure, missing assignee/routing problem.
* Cleanup queues are filterable.
* Warnings do not block historical viewing.
* Warnings block execution/completion only where policy requires.

**Proof requirements**

* Screenshots for each warning type.
* UI filter tests.
* Copy review for uncertainty language.

---

### E14.T6 — Tests: migration confidence and non-destructive behavior

**Layer:** Tests/validation
**Scope:** Validate migration dry-run/write-run behavior.
**Dependencies:** E14.T1–E14.T5.
**Trace:** Q41.

**Acceptance criteria**

* Tests prove inferred fields carry confidence/provenance.
* Tests prove unknowns are not invented.
* Tests prove no fake receipt creation.
* Tests prove old task remains visible.
* Tests prove new task enforcement still works.

**Proof requirements**

* Test run output.
* Migration fixture before/after.
* Rollback rehearsal note.

---

### E14.T7 — Docs: migration/backfill runbook

**Layer:** Docs
**Scope:** Document progressive migration strategy, warnings, cleanup queues, rollback.
**Dependencies:** E14.T1–E14.T6.
**Trace:** Q41.

**Acceptance criteria**

* Docs define migration phases M0–M4.
* Docs define inference sources and confidence.
* Docs define cleanup queues.
* Docs define no-destructive default.
* Docs define rollback.

**Proof requirements**

* Runbook path.
* Dry-run example.
* Reviewer signoff.

---

## Epic E15 — Rollout, observability, QA, and release gates

### E15.T1 — Observability: core metrics and logs

**Layer:** Rollout/observability
**Scope:** Add metrics/logs for task, receipt, policy, search, integration, notification, migration health.
**Dependencies:** E4.T3, E5.T2, E9.T4, E10.T2, E11.T2, E12.T2, E13.T2.
**Trace:** Q35–Q41.

**Acceptance criteria**

* Metrics cover receipt failures/integrity, review/gate counts, Task Master nudges/escalations/reassignments, search index lag, permission denials, connector degraded states, notification failures, migration warnings.
* Logs include request_id/org_id where safe.
* Sensitive content is not logged.

**Proof requirements**

* Metrics list/dashboard screenshot or config.
* Log samples with redaction.
* Test event producing metric.

---

### E15.T2 — Feature flags and staged rollout controls

**Layer:** Rollout
**Scope:** Add feature flags for major Phase 2 surfaces and enforcement.
**Dependencies:** E1–E14 relevant schemas/APIs.
**Trace:** Q41, Q42.

**Acceptance criteria**

* Flags can enable/disable new workspace shell, receipt enforcement, policy review, Task Master automation, search indexing, connector panels, Helm panel, ClickClack panel, migration warnings.
* Disabling flags preserves data.
* Enforcement can be staged for new tasks before old tasks.

**Proof requirements**

* Flag list.
* Tests showing flag on/off behavior.
* Rollback note.

---

### E15.T3 — QA: Phase 2 end-to-end proof suite

**Layer:** Tests/validation
**Scope:** Create E2E suite for business-ops work plane flow.
**Dependencies:** E1–E14.
**Trace:** Q1–Q43.

**Acceptance criteria**

* E2E creates business-ops task with initiator/owner.
* Links external doc and native artifact.
* Simulates agent proof submission.
* Generates receipt.
* Runs policy review.
* Runs human gate for external send.
* Tests Task Master stalled path.
* Searches receipt/activity with permission filtering.
* Tests Helm/ClickClack/Google degraded states.

**Proof requirements**

* E2E test output.
* Screenshots/DOM receipts.
* Generated receipt artifact.
* Search result proof.
* Degraded-state proof.

---

### E15.T4 — Security/permission release gate

**Layer:** Tests/validation
**Scope:** Define and run permission leak release gate.
**Dependencies:** E7, E9, E13.
**Trace:** Q39.

**Acceptance criteria**

* Cross-org leakage tests pass.
* Restricted snippets/previews suppressed.
* External doc permission mismatch handled.
* Activity/evidence restricted access safe.
* Helm secrets absent.

**Proof requirements**

* Security test output.
* Negative access fixtures.
* Reviewer signoff.

---

### E15.T5 — Rollback runbook

**Layer:** Docs/rollout
**Scope:** Document rollback triggers/actions.
**Dependencies:** E15.T2.
**Trace:** Q41, Q42.

**Acceptance criteria**

* Runbook covers feature flag rollback.
* Runbook covers receipt writer defect.
* Runbook covers Task Master runaway loop.
* Runbook covers search permission leak.
* Runbook covers connector degradation.
* Runbook preserves receipt artifacts and audit trail.

**Proof requirements**

* Runbook path.
* Rollback rehearsal checklist.
* Reviewer signoff.

---

### E15.T6 — Release checklist

**Layer:** Docs/rollout
**Scope:** Create release checklist for Phase 2 implementation readiness.
**Dependencies:** E1–E15.
**Trace:** Q42, Q43.

**Acceptance criteria**

* Checklist includes schema/API/UI/migration/tests/docs/rollout proof.
* Checklist forbids fake implementation claims.
* Checklist requires no Curacel demo wording.
* Checklist requires Paperclip external-only wording.
* Checklist requires Entity/Helm/ClickClack boundary review.
* Checklist requires receipt proof.

**Proof requirements**

* Checklist path.
* Completed sample checklist for a staging release.
* Reviewer signoff.

---

## 16. Product/engineering critique

## 16.1 Strong product choices

The strongest product decision is treating Entity as a **work plane**, not a task dashboard. That avoids the obvious trap: building yet another Mission Control UI while the actual product value lives in the connective tissue between tasks, agents, docs, proof, review, activity, search, and runtime context.

The second strong decision is making receipts first-class. Agent work without receipts is noise. Status is cheap; proof is expensive. Entity should compete on making proof inspectable, durable, searchable, permissioned, and reviewable.

The third strong decision is preserving boundaries. Entity should not become Helm, ClickClack, Google Docs, or a runtime. A product that tries to own all adjacent surfaces directly will become bloated and brittle. Entity should own the work semantics and integrate with adjacent systems through hard contracts.

The fourth strong decision is business-ops anchoring. If Entity only works for engineering tasks, it is too narrow. Sales, people, and CS force the right abstractions: plans instead of specs, human gates for risky side effects, external docs, customer/HR sensitivity, owner accountability, and proof beyond code diffs.

## 16.2 Product risks in the current direction

### Risk: too many surfaces at once

Entity as workspace OS naturally wants tasks, docs, agents, chat, search, notifications, review, proof, runtime status, and plugins. That is correct strategically, but dangerous tactically. The wedge must stay sharp: proof-backed review of agent work.

Mitigation: Phase 2 tickets should prioritize the receipt/review/task spine first, then layer docs/search/integrations.

### Risk: user confusion between Entity and Helm

If Entity shows too many controls, users will assume Entity is the runtime/admin plane. That creates product confusion and security risk.

Mitigation: Entity shows status/light controls only, labels source as Helm, and deep-links to Helm for admin.

### Risk: evidence model becomes too abstract

ExternalDocumentRef, NativeDocument, EvidenceArtifact are correct separate concepts, but builders may over-generalize into a mushy “File” object.

Mitigation: keep separate backend concepts and separate UI labels. Do not collapse them prematurely.

### Risk: receipt invariant blocks completion too aggressively

Synchronous receipt creation is right for trust, but a brittle receipt writer can block too much work.

Mitigation: receipt writer must be small, deterministic, heavily tested, and observable. Rich enrichment can be async. Minimal receipt must never depend on Google Docs or ClickClack.

### Risk: policy engine becomes opaque

Layered policy can become haunted furniture if users cannot understand why review/gates/reassignment happened.

Mitigation: store reason chains and render them in plain English.

### Risk: migration uncertainty is hidden

If old tasks are silently backfilled with guessed owners/initiators, trust collapses.

Mitigation: confidence/provenance fields and cleanup queues are not optional.

## 16.3 Engineering tradeoffs

### Keep current task state as projection

This is correct. The activity log should hold provenance, while current task fields serve UI/API speed.

### Use stable artifact IDs for receipts

This is correct. Human-friendly paths are useful, but canonical path must survive task moves and title changes.

### Use feature flags for enforcement

This is necessary. Enforcing all new invariants on all old data immediately would stall rollout.

### Avoid Google Docs write scope in V1

This is correct. Read-only/link/preview gets adoption value without inviting mutation/security complexity.

### Treat ClickClack as staged-but-real

This is correct. Chat should improve collaboration, but it must not hold proof/review hostage.

---

## 17. Risk register

| ID    | Risk                                                                            | Severity | Likelihood | Mitigation                                                                                                | Owner              |
| ----- | ------------------------------------------------------------------------------- | -------: | ---------: | --------------------------------------------------------------------------------------------------------- | ------------------ |
| RSK1  | Entity collapses back into Mission Control-only implementation.                 |     High |     Medium | Workspace shell and ticket graph require docs/files/evidence/agents/search/notifications/integrations.    | Product + Eng      |
| RSK2  | Entity/Helm boundary blurs, exposing secrets or admin controls in Entity.       | Critical |     Medium | Helm boundary ADR, no-secret tests, safe controls only.                                                   | Eng + Security     |
| RSK3  | Paperclip mistakenly treated as internal product.                               |   Medium |        Low | Product docs explicitly mark Paperclip external competitor/reference only.                                | Product            |
| RSK4  | Curacel demo wording creates wrong deliverable expectations.                    |   Medium |     Medium | Spec and tickets say Curacel is context/evidence only.                                                    | Product            |
| RSK5  | Receipt writer failure blocks too many completions.                             |     High |     Medium | Minimal deterministic writer, failure observability, staged rollout.                                      | Eng                |
| RSK6  | Completed tasks without receipts leak through due to bypass path.               | Critical |     Medium | Central completion API invariant, tests, audit query.                                                     | Eng                |
| RSK7  | Search leaks restricted HR/customer/evidence snippets.                          | Critical |     Medium | Permission filtering before rendering, leakage test suite.                                                | Security + Eng     |
| RSK8  | Migration fabricates certainty for old tasks.                                   |     High |     Medium | Confidence/provenance fields, cleanup queues, no fake receipts.                                           | Eng                |
| RSK9  | Task Master auto-reassignment annoys users or moves high-risk work incorrectly. |     High |     Medium | Policy thresholds, high-risk exclusions, audit, feature flags.                                            | Product + Eng      |
| RSK10 | Review policy becomes too opaque.                                               |   Medium |       High | Reason chains stored and rendered.                                                                        | Product            |
| RSK11 | Google Docs connector auth/permissions confuse users.                           |   Medium |     Medium | Distinguish external permission from Entity visibility.                                                   | Eng + UX           |
| RSK12 | ClickClack degraded mode blocks workspace.                                      |   Medium |     Medium | Degraded readiness panel and tests.                                                                       | Eng                |
| RSK13 | Runtime/provider abstraction accidentally hardcodes OpenClaw/Hermes.            |   Medium |     Medium | Generic provider fixtures and tests.                                                                      | Eng                |
| RSK14 | Multi-tenant seams are deferred too long.                                       |     High |     Medium | Org/team/project/principal fields foundational in schema.                                                 | Eng                |
| RSK15 | Too many parallel tickets create integration drift.                             |   Medium |       High | Parent integrator, capability epics, proof gates.                                                         | Eng lead           |
| RSK16 | EvidenceArtifact and NativeDocument storage drift from DB metadata.             |     High |     Medium | Hash/integrity checks and error states.                                                                   | Eng                |
| RSK17 | Human gates over-trigger and slow work.                                         |   Medium |     Medium | Policy by risk/worktype, visible reasons, override where authorized.                                      | Product            |
| RSK18 | Human gates under-trigger and allow risky side effects.                         | Critical |     Medium | Default high-risk triggers for external send, HR, legal, financial, customer impact, production/security. | Product + Security |
| RSK19 | Existing activity logs are not structured enough for receipts.                  |     High |     Medium | Structured event migration; receipt generation uses available source and flags weak history.              | Eng                |
| RSK20 | Users cannot distinguish raw proof from curated summaries.                      |   Medium |     Medium | UI labels and mutability rules.                                                                           | UX + Eng           |

---

## 18. Remaining implementation questions

These are unresolved details. Builders should not invent answers silently.

1. **Exact existing schema shape.** The input packet names existing surfaces but does not provide actual current DB schemas. Implementation must inventory before migration.
2. **Policy DSL/storage format.** The spec defines policy behavior, not whether policy is stored as JSON, database rows, code config, or hybrid.
3. **Default risk matrix.** High-risk classes are settled directionally, but exact defaults per worktype need product confirmation.
4. **Reviewer load/availability source.** The assignment model mentions availability and load, but source of availability is not specified.
5. **Agent trust levels.** The policy model allows runtime/agent trust level, but exact trust scoring is undefined.
6. **Task Master per-team vs global.** Supporting doc proposes per-team Task Master with global fallback; Q decisions settle behavior but not final deployment topology.
7. **Nudge channels per agent type.** MCP/webhook/etc. are referenced, but concrete channel mechanism per provider is unresolved.
8. **Exact Google connector scopes.** V1 posture is read/index/link/preview; implementation must choose minimal scopes during connector design.
9. **Native markdown storage backend.** The spec requires stable path/hash but does not dictate filesystem/object store/database blob.
10. **Receipt atomicity mechanism.** The invariant is settled; exact transaction/outbox/write-ahead pattern is implementation choice.
11. **Search backend.** The spec defines behavior/envelope, not the search engine.
12. **ClickClack integration maturity.** The packet names existing bridge/proxy routes/tests, but implementation must verify current readiness.
13. **Helm API shape.** The spec defines desired contract; actual existing Helm endpoints must be inventoried and adapted.
14. **Enterprise/self-deploy packaging.** Deployment seam is required, but packaging details belong to implementation planning.
15. **Billing/plan seams.** Q2 says billing/plan seams foundational, but no detailed billing model is provided.
16. **Desktop/mobile public posture.** Existing shells are noted, but whether they are public v1, beta, or hidden remains to decide.
17. **Domain-specific Plan labels.** Sales/CS/people examples are clear, but exact controlled vocabulary is unresolved.
18. **Historical receipt backfill policy.** The spec says no fake raw receipts; whether to generate curated backfill summaries is a separate product decision.
19. **Human gate override rules.** The spec supports policy/override, but exact override authority for high-risk gates needs definition.
20. **Notification channel priority.** Layered routing is settled, but default channel priority/order by team/worktype is unresolved.

---

## 19. Builder prompt

Build Entity Phase 2 as a consolidation/productization pass over the existing Entity, Helm, and ClickClack systems.

Use this spec as the authority. Do not treat Entity as only Mission Control. Entity is the agent-native work plane for human-agent teams. Preserve the boundaries:

* Entity owns work objects, docs/files/artifacts, receipts, review, permissions, search, notifications, activity, and workspace context.
* Helm owns runtime/admin control.
* ClickClack owns chat primitives where integrated.
* OpenClaw/Hermes are runtime/providers, not Entity.
* Paperclip is an external competitor/reference, not part of the product.
* Curacel is pilot/design-customer context only; do not build or describe this as a Curacel demo.

Implement through hybrid product epics. For each ticket, produce proof: schema diffs, API tests, UI screenshots/DOM receipts, generated receipt artifacts, permission-denial tests, migration dry-run reports, degraded integration tests, and docs links as appropriate.

Preserve the core invariants:

1. Every operational work item maps to a Task under Org → Team → Project.
2. Every task has an initiator and an individual owner.
3. Executable work resolves to an individual assignee/executor or an allowed Task-Master-drivable unassigned state.
4. NativeDocument, ExternalDocumentRef, and EvidenceArtifact are separate backend concepts.
5. Every completed `entity-mc` task gets a synchronous minimal canonical markdown receipt.
6. Receipt metadata lives in DB; receipt body lives as stable markdown artifact.
7. Raw receipts are immutable append-only.
8. Review and human gate decisions are policy-based, reasoned, and auditable.
9. Task Master drives unassigned/self-assigned work, nudges assigned stalled work, escalates to owner, and auto-reassigns only when policy permits.
10. Search, snippets, previews, evidence, activity, external refs, and chat-linked content obey layered RBAC + object sensitivity.
11. Entity inbox/activity is canonical for notifications; external channels are delivery routes.
12. Google Docs V1 is read-only/index/link/preview; no default mutation.

Do not fake green states. Unknown, missing, degraded, unauthorized, expired, failed, and uncertain states must be visible.

---

## 20. Reviewer prompt

Review this implementation against the Phase 2 spec, not against vibes.

Reject the work if it violates any of these boundaries:

* Entity is presented as only Mission Control.
* Helm runtime/admin controls are duplicated inside Entity beyond safe, reversible, audited light controls.
* ClickClack availability blocks docs/files/proof/review.
* OpenClaw or Hermes are treated as Entity instead of providers/runtimes.
* Paperclip is treated as an internal product.
* The work is framed as a Curacel demo.
* Google Docs becomes the canonical store for low-level `entity-mc` proof.
* Completed `entity-mc` tasks can reach `done` without a canonical markdown receipt.
* Missing evidence is hidden.
* Self-review is allowed where separation-of-duties forbids it.
* Old migration data is backfilled with invented certainty.
* Restricted search snippets/previews leak sensitive content.
* External notifications become source of truth instead of Entity inbox/activity.
* Implementation claims are made without proof artifacts.

Require proof for each ticket:

* schema diff or migration output for schema tickets;
* API tests and response fixtures for API tickets;
* screenshots/DOM receipts for UI tickets;
* generated markdown receipt samples for receipt tickets;
* reason-chain snapshots for policy tickets;
* activity event fixtures for Task Master/routing tickets;
* denied-access fixtures for permission tickets;
* search result fixtures for search tickets;
* degraded-state proof for Helm, ClickClack, and Google connector tickets;
* dry-run and warning reports for migration tickets;
* docs/ADR paths for documentation tickets;
* feature flag and rollback proof for rollout tickets.

The standard is simple: Entity must become a coherent, agent-native work plane with durable proof, explicit policy, clean integration boundaries, and no fake operational certainty.
