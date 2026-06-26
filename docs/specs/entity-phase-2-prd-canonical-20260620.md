# Entity Phase 2 — Canonical PRD

**Owner:** Book
**Source packet:** Entity Phase 2 input packet (Q1–Q43)
**First pass:** Oracle GPT-5.5 Pro xhigh draft
**Critique pass:** Opus 4.8 xhigh
**Merge pass:** Book deterministic merge applying Opus must-fixes after failed browser merge
**Date:** 2026-06-20

## Problem Statement

Human-agent teams are becoming real operating units, but the software stack still assumes either a human-only workplace or an engineering-only execution board.

Human-only suites such as docs, drives, chat, email, and project spaces are good at collaboration between people, but they are weak at agent accountability. They do not natively answer:

* Which agent did the work?
* What task was it working from?
* What evidence did it produce?
* Which runtime/provider executed it?
* Who reviewed it?
* Was a human gate required?
* What changed after a retry, reassignment, or escalation?
* Can the output be trusted without reconstructing context from chat logs, files, and external tools?

Engineering task boards solve a different problem. They track work items, status, assignees, and sometimes code-linked proof, but they are too narrow for human-agent business operations. Sales, people, customer success, and business operations teams need account plans, customer follow-up, people workflows, research packets, approval gates, external document context, CRM/customer-impacting action controls, and proof for non-code work. Forcing that work into engineering-only “spec” language creates the wrong product.

Entity Phase 2 must solve the missing category: an agent-native work plane for human-agent teams.

The core user pain is not “I need another task board.” The pain is: “I need a shared workspace where humans and agents can do business work together, with durable proof, review, permissions, search, docs, files, activity, notifications, and runtime context in one coherent plane.”

Today, agent work can become fog:

* A task says “done,” but the actual proof is missing or scattered.
* A generated artifact exists, but it is unclear whether it is raw proof, a mutable summary, or an externally owned document.
* A review happens, but the reviewer, policy reason, and separation-of-duties status are unclear.
* A human gate is needed, but the gate is not represented as a first-class state.
* An agent stalls, but routing history, nudges, escalation, and reassignment are not preserved cleanly.
* A workspace links Google Docs, chat, files, and runtime status, but the boundaries between Entity, Helm, ClickClack, and external systems are easy to blur.

Entity Phase 2 exists to turn this into a productized system: one work plane where humans and agents can see work, assign work, attach context, inspect proof, review output, gate risky actions, search across the workspace, and understand runtime readiness without collapsing Entity into Helm, ClickClack, Google Docs, OpenClaw, Hermes, or any other adjacent system.

## Solution

Entity Phase 2 defines Entity as the agent-native work plane / workspace OS for human-agent teams.

Entity is not just Mission Control. Mission Control and task review are the first trust wedge, but Entity must be broader: work hierarchy, tasks, docs, files, artifacts, receipts, review, human gates, agent activity, search, notifications, permissions, ClickClack-integrated collaboration, and Helm-backed runtime visibility.

The first product wedge is proof-backed agent work review.

A human or eligible reviewing agent should be able to open a task and understand:

* what work was requested;
* who or what initiated it;
* who owns the outcome;
* who or what executed it;
* what evidence was produced;
* what output artifacts exist;
* what done criteria were checked;
* what policy required review or a human gate;
* who reviewed or approved it;
* whether missing evidence, degraded integrations, or migration uncertainty exists;
* whether the task can be trusted.

Every completed `entity-mc` task must create a minimal canonical markdown receipt at completion. The receipt is the low-level proof record. Google Docs can be linked, indexed, previewed, and later exported to by explicit gated workflows, but Google Docs must not become the canonical store for low-level task proof in V1.

Entity Phase 2 should support the first workflow contexts of sales, people, customer success, and business operations. These contexts are not a one-off demo. They are the forcing function that prevents Entity from becoming an engineering-only task board. The product must support non-coding plans, customer/account context, people-sensitive work, external-send gates, business review, and proof for operational output.

Entity integrates with adjacent systems through clear boundaries:

* Entity owns the work plane: work objects, tasks, docs/files/artifacts, receipts, review, human gates, activity, search, permissions, notifications, object links, and workspace context.
* Helm owns runtime/admin control: runtimes, models, credentials, schedules/crons/loops, tools, health, deployment settings, operational controls, and deep admin configuration.
* ClickClack owns chat/collaboration primitives where integrated: channels, threads, messages, composer, bridge/proxy behavior. ClickClack availability must not block Entity docs, files, artifacts, proof, or review.
* OpenClaw and Hermes are runtime/providers, not Entity itself. Entity must remain runtime-agnostic.
* Paperclip is an external competitor/reference only.
* Curacel is design-customer/pilot context only. Entity Phase 2 is not a Curacel demo.

Phase 2 output is a PRD/spec and implementation ticket graph. It must not imply that code has been built, tested, deployed, or proven.

## User Stories

1. As a business-ops user, I want one workspace for humans, agents, tasks, docs, files, proof, review, and activity, so that I do not have to reconstruct work from scattered systems.

2. As a sales user, I want account and follow-up work represented as business tasks and plans, so that agent work fits my workflow without being forced into engineering language.

3. As a customer-success user, I want customer-impacting work to show linked context, evidence, and approval state, so that I can trust agent-prepared customer responses.

4. As a people-ops user, I want HR-sensitive tasks and artifacts to carry object sensitivity, so that people workflows are not exposed through search, snippets, previews, or chat links.

5. As a founder or manager, I want Entity to show the state of human-agent work across teams and projects, so that I can see what is happening without opening every task.

6. As a workspace admin, I want Entity to support orgs, teams, and projects as foundational objects, so that the product can support multi-user and multi-org company workspaces.

7. As a team lead, I want every operational work item to map to a task under an org, team, and project, so that work has a consistent execution and accountability model.

8. As a task creator, I want to set the task initiator separately from the creator, so that Entity records who requested the work even when another person, agent, import, or automation created the record.

9. As a work owner, I want every task to have an individual accountable owner, so that responsibility for the outcome is never hidden behind a team queue.

10. As a manager, I want executable tasks to resolve to an individual human or agent assignee/executor unless Task Master policy allows unassigned execution, so that execution accountability is clear.

11. As a business user, I want tasks to optionally belong to goals, plans, or specs, so that lightweight work does not require unnecessary planning overhead.

12. As an engineering user, I want specs available as optional coding planning objects, so that engineering work can still use spec-driven decomposition.

13. As a non-engineering user, I want plans available as optional non-coding planning objects, so that sales, CS, people, and ops work can use domain-appropriate language.

14. As a project owner, I want goals, plans, and specs to have explicit lifecycle state and derived health, so that owner intent and execution reality are not collapsed.

15. As a project owner, I want a plan to be active while derived health can show blocked or at-risk, so that status tells the truth instead of pretending progress is clean.

16. As a task assignee, I want a universal core task state with worktype-specific overlays, so that Entity can route work consistently while still representing domain-specific stages.

17. As a sales lead, I want worktype overlays for sales stage, priority, account context, and external-send risk, so that sales work is represented accurately.

18. As a CS lead, I want worktype overlays for case stage, customer impact, SLA, and escalation status, so that CS work is represented accurately.

19. As a people-ops lead, I want worktype overlays for hiring stage, employee sensitivity, approval needs, and checklist status, so that people work is represented accurately.

20. As an agent, I want assigned tasks to include done criteria and evidence expectations, so that I know what proof I need to return.

21. As an `entity-mc` agent, I want to submit review packet data with evidence, output artifact, and done criteria, so that Entity can normalize my work into receipts and review objects.

22. As a reviewer, I want every completed `entity-mc` task to have a canonical markdown receipt, so that I can review evidence instead of trusting task status.

23. As a reviewer, I want the receipt to include task identity, initiator, owner, assignee, executor, submitted-by, timestamps, worktype, status transition, evidence summary, output links, review state, human gate state, and provenance, so that I can audit the work.

24. As a reviewer, I want missing evidence to be explicitly stated in the receipt and UI, so that incomplete proof is never hidden behind a green status.

25. As a reviewer, I want raw proof receipts to be immutable append-only, so that original proof cannot be quietly rewritten.

26. As a manager, I want curated reports and summaries to be editable versioned artifacts, so that human-readable narratives can improve without corrupting raw proof.

27. As a reviewer, I want raw proof and curated interpretation to be visually distinct, so that I know what is source evidence and what is a later explanation.

28. As a task owner, I want raw receipts to be task-owned at creation but linkable to goals, plans, specs, projects, reviews, and reports, so that proof can be reused without duplication.

29. As a business user, I want Entity-native markdown documents for internal notes, specs, reports, agent outputs, and fallback docs, so that Entity works even when a company has no external doc system.

30. As a workspace user, I want ExternalDocumentRef, NativeDocument, and EvidenceArtifact to be separate object types, so that external docs, native docs, and proof artifacts are not mixed into a vague file bucket.

31. As a Google Workspace user, I want to link Google Docs or Drive items to tasks, plans, specs, goals, and projects, so that existing company documents remain useful inside Entity.

32. As a Google Workspace user, I want Google Docs V1 to support read, index, link, and preview, so that I can use external docs without granting mutation privileges by default.

33. As a workspace admin, I want Google Docs writes, exports, or syncs to require later explicit permission gates and audit trail, so that external documents are not mutated casually.

34. As a reviewer, I want low-level proof to remain Entity-native markdown even when a human-facing Google Doc exists, so that mutable external docs are not the sole proof source.

35. As a task detail user, I want to see external Google Docs and Entity-native proof artifacts side by side, so that I understand which context is external and which proof is canonical.

36. As a user with expired Google auth, I want Entity to show the connector is expired or insufficiently scoped, so that I understand why preview or indexing is degraded.

37. As a user without access to a sensitive external document, I want Entity to suppress restricted snippets and previews, so that external connector access does not leak through Entity.

38. As an agent manager, I want agents to appear as first-class principals and collaborators, so that I can understand which agents exist and what they are doing.

39. As an admin, I want agents to be user-added rather than hardcoded, so that Entity can support many runtimes and providers over time.

40. As a user, I want OpenClaw, Hermes, Codex, Claude Code, and other providers to appear as runtime/provider-backed agents, so that Entity is runtime-agnostic.

41. As a manager, I want agent cards to show identity, provider/runtime, status, current work, capabilities, and readiness where available, so that I can manage work without confusing provider identity with Entity itself.

42. As a user, I want unknown, offline, or degraded agent states to be explicit, so that Entity does not show fake operational certainty.

43. As a workspace admin, I want Helm-backed runtime status inside Entity, so that I can see runtime readiness without using Entity as the deep admin plane.

44. As a workspace admin, I want deep runtime configuration to remain in Helm, so that Entity does not duplicate credentials, secrets, model config, schedule editing, tool grants, deployments, or destructive operations.

45. As an authorized operator, I want Entity to expose only safe, reversible, audited light controls such as pause, resume, or request retry where policy permits, so that urgent work can be nudged without turning Entity into Helm.

46. As a user, I want “open in Helm” deep links for runtime/admin details, so that I can move to the correct control plane when needed.

47. As a user, I want Entity to show Helm unavailable or degraded states honestly, so that work-plane flows can continue without fake runtime health.

48. As a user, I want ClickClack-powered chat where the bridge is ready, so that collaboration can happen near the work.

49. As a user, I want ClickClack thread and channel references linked to Entity work objects, so that chat does not lose task, doc, or proof context.

50. As a user, I want Entity docs, files, artifacts, proof, and review to keep working when ClickClack is unavailable, so that chat readiness does not block core work.

51. As a workspace admin, I want ClickClack readiness states such as live, staged, degraded, unavailable, and not configured, so that integration state is visible.

52. As Task Master, I want to drive unassigned or self-assigned work by policy, so that unassigned work does not sit inert.

53. As Task Master, I want to create a claim event when I pick up an unassigned task, so that the original unassigned state and policy reason are preserved.

54. As a manager, I want Task Master to become the current executor when it claims unassigned work, so that the live board shows who is accountable during execution.

55. As a manager, I want assigned stalled tasks to be nudged before escalation or reassignment, so that Task Master does not take over work that belongs to another human or agent.

56. As an assignee, I want Task Master nudges to route through configured channels, so that I receive recovery prompts where I can act.

57. As a task owner, I want stalled assigned work to escalate to me after policy thresholds, so that accountability remains with the owner before reassignment.

58. As Task Master, I want to auto-reassign stalled tasks only when policy permits and thresholds are exhausted, so that work can recover without arbitrary takeover.

59. As a manager, I want auto-reassignment to be audited with prior assignee, new assignee, owner escalation history, policy reason, and actor, so that reassignment is explainable.

60. As a reviewer, I want completed receipts after reassignment to include the full routing and execution chain, so that the task does not look cleaner than reality.

61. As a reviewer, I want self-review to be blocked where separation-of-duties applies, so that agents and humans cannot approve their own work.

62. As a policy admin, I want review requirements to be resolved by worktype, risk, external side effects, owner flags, workspace policy, org policy, team policy, task flags, evidence quality, and agent trust, so that review is risk-based rather than universally bureaucratic.

63. As a user, I want Entity to explain why review is required, so that review does not feel arbitrary.

64. As a reviewer, I want review controls to show accept and request-fix only when I am eligible, so that invalid review actions are not presented.

65. As an owner, I want reviewer assignment to be automatic by policy but overrideable by authorized users with audit trail, so that default routing is fast but accountable.

66. As a human initiator, I want to be the default reviewer for human-requested work where separation-of-duties permits, so that the accountable requester can judge output.

67. As an agent-work reviewer, I want Task Master or another eligible peer agent to review most agent work where policy allows, so that review can scale without requiring a human for every low-risk action.

68. As a human approver, I want high-risk work to require a separate human gate, so that review and approval are not confused.

69. As a human approver, I want external sends to require a human gate where policy says so, so that agents do not send customer-facing communications without approval.

70. As a people-ops approver, I want HR or people-sensitive actions to require a human gate, so that sensitive people work is controlled.

71. As a sales or CS owner, I want customer commitments and CRM/customer-impacting updates to require human gates where policy says so, so that agents do not create unapproved obligations.

72. As a finance/legal/security owner, I want legal, financial, production, and security-sensitive actions to require human gates where policy says so, so that risky side effects are controlled.

73. As a workspace user, I want global search across tasks, native docs, evidence artifacts, external refs, activity, projects, goals, plans, specs, people, agents, and ClickClack threads where integrated, so that I can find work context without knowing where it lives.

74. As a search user, I want scoped filters by object type, source, team, project, worktype, owner, assignee, initiator, state, review state, risk, sensitivity, date, and connector state, so that search results are useful.

75. As a security-conscious admin, I want search permission filtering before snippets or previews render, so that sensitive content does not leak through search.

76. As a reviewer, I want activity logs and evidence receipts indexed, so that proof and provenance are discoverable.

77. As a user, I want direct links from search results to canonical Entity objects, so that search is actionable.

78. As a workspace admin, I want permissions to use layered RBAC plus object sensitivity, so that org/team/project defaults can be overridden for sensitive work.

79. As a manager, I want sensitivity categories for people/HR, customer/account, legal, financial, security, production, confidential strategy, and workspace-defined restrictions, so that access policy matches real business risk.

80. As a restricted user, I want Entity to explain access is restricted without leaking content, so that permission denials are safe.

81. As an admin, I want Google external permissions and Entity visibility policy to be separate, so that connector access does not automatically grant Entity visibility.

82. As a notification recipient, I want Entity inbox/activity to be the canonical notification record, so that messages are not lost when external channels fail.

83. As a user, I want notifications to deep-link to canonical Entity work objects, so that external messages do not become the source of truth.

84. As a policy admin, I want notifications routed to ClickClack, email, Discord, Slack, AgentPush, webhooks, or other configured channels by policy, so that delivery matches urgency, risk, user preferences, and channel availability.

85. As a user, I want failed notification delivery to be visible in Entity, so that external channel failure does not silently hide work.

86. As a reviewer, I want review requests, human gate requests, nudges, owner escalations, reassignment notices, receipt failures, and connector degradation notices in one notification model, so that I can track work consistently.

87. As a migration operator, I want progressive migration and backfill, so that Phase 2 usability is not blocked by perfect historical data cleanup.

88. As a migration operator, I want old tasks to remain visible and usable, so that historical work is not archived into a dead pile.

89. As a migration operator, I want inferred fields to carry confidence and provenance, so that Entity does not invent certainty.

90. As a migration operator, I want missing owner, unknown initiator, missing project, missing assignee, missing receipt, weak activity structure, unknown worktype, ambiguous team, and uncertain permissions to be surfaced as warnings, so that cleanup is explicit.

91. As a reviewer, I want historical completed tasks without receipts to be marked missing receipt instead of receiving fake raw receipts, so that historical proof is honest.

92. As a manager, I want cleanup queues for migration warnings, so that teams can resolve ambiguity over time.

93. As a builder, I want Phase 2 requirements split into vertical product-capability epics with schema, API, UI, migration, tests, docs, and rollout tickets, so that implementation can proceed without losing product intent.

94. As a reviewer of implementation tickets, I want each ticket to produce proof appropriate to its layer, so that no implementation claim is accepted without evidence.

95. As a product reviewer, I want Entity Phase 2 wording to avoid Curacel-demo framing, so that pilot context does not distort the product spec.

96. As a product reviewer, I want Paperclip mentioned only as an external competitor/reference, so that internal architecture does not accidentally depend on a competitor concept.

97. As a product reviewer, I want Entity, Helm, ClickClack, and runtimes/providers to stay separate, so that the product does not become a blurred monolith.

98. As a workspace buyer, I want the product to support multi-tenant SaaS and enterprise/self-deploy seams, so that Entity can be adopted by companies with different deployment needs.

99. As an enterprise admin, I want tenant isolation, org scoping, RBAC, audit trails, connector authorization state, and deployment seams treated as foundational, so that enterprise readiness is not bolted on later.

100. As a user, I want degraded states to be honest across receipts, search, Helm, ClickClack, Google Docs, notifications, migration, and permissions, so that Entity never presents uncertainty as certainty.

## Implementation Decisions

### Product and scope

* Entity Phase 2 is a consolidation and productization spec over existing Entity, Helm, and ClickClack surfaces. It is not a greenfield rewrite and not a prototype requirement.
* Entity is the agent-native work plane / workspace OS for human-agent teams.
* Mission Control/task review is a major wedge, not the full product.
* The first trust wedge is proof-backed agent work review.
* The first workflow contexts are sales, people, customer success, and business operations.
* Curacel is design-customer / pilot context only. Phase 2 is not a Curacel demo.
* Paperclip is an external competitor/reference only and must not appear as an internal product, module, dependency, or architecture layer.
* Phase 2 output should feed implementation tickets, not claim implementation completion.

### Product boundaries

* Entity owns work-plane semantics:

  * orgs;
  * teams;
  * projects;
  * tasks;
  * goals/plans/specs;
  * docs/files/artifacts;
  * receipts;
  * review;
  * human gates;
  * activity logs;
  * search;
  * permissions;
  * notifications;
  * object links;
  * workspace context.
* Helm owns runtime/admin control:

  * runtimes;
  * models/providers;
  * credentials/secrets;
  * schedules/crons/loops;
  * tools;
  * runtime health;
  * deployment/admin configuration;
  * destructive runtime actions;
  * deep operational controls.
* Entity may show Helm-backed status and policy-allowed safe light controls only:

  * runtime/agent status;
  * current assignment/current work;
  * health/readiness;
  * last heartbeat;
  * schedule/loop summary;
  * deep links to Helm;
  * reversible audited pause/resume/request-retry where policy permits.
* ClickClack owns chat primitives where integrated:

  * channels;
  * threads;
  * messages;
  * composer;
  * bridge/proxy behavior.
* Entity owns ClickClack-linked work context, permissions, object links, and canonical work state.
* ClickClack availability must not block Entity docs, files, artifacts, proof, review, search, or task flows.
* OpenClaw and Hermes are runtime/providers, not Entity. Entity must remain runtime-agnostic.

### Workspace hierarchy

* Required hierarchy:

  * Org;
  * Team;
  * Project;
  * Task.
* Task is the universal execution/tracking unit.
* Every operationally trackable item in Entity becomes or maps to a task.
* Goal, Plan, and Spec are optional first-class planning/container objects.
* Goal is an optional outcome container.
* Plan is an optional non-coding planning object for business workflows.
* Spec is an optional coding/engineering planning object.
* Domain-specific labels can sit on top of Plan semantics, such as account plan, hiring plan, renewal plan, CS escalation plan, campaign, or people process.
* Tasks can exist without a Goal, Plan, or Spec.
* Goal/Plan/Spec objects have explicit lifecycle state and derived health/progress. These must not be collapsed.

### Task model

* Every task must have:

  * org;
  * team;
  * project;
  * title;
  * universal core state;
  * worktype;
  * created_by;
  * initiator;
  * individual owner;
  * assignment/execution state;
  * policy result;
  * activity log;
  * receipt linkage once completed by `entity-mc`.
* Required task principal concepts are distinct:

  * created_by: actor who created the task record;
  * initiator: person, agent, workflow, automation, import, or external event that requested the work;
  * owner: individual principal accountable for the outcome;
  * assignee: individual principal assigned to execute;
  * executor: individual principal that actually executes;
  * submitted_by: principal that submitted for review;
  * reviewer: principal assigned to review;
  * approver: human principal assigned to a human gate.
* Initiator is required on every task.
* Owner is required on every task and must resolve to an individual principal.
* Team ownership is not allowed as final task ownership.
* Assignee/executor must resolve to an individual principal for executable tasks.
* Team queues can exist for intake/routing, but a task is not fully assigned until an individual assignee/executor or allowed Task-Master-drivable state exists.
* Universal core task state:

  * backlog;
  * todo;
  * doing;
  * review;
  * done.
* Cancelled, blocked, and paused are status modifiers or policy states, not replacements for the universal core model.
* Worktype overlays can add domain fields such as sales stage, CS stage, hiring stage, SLA, risk, pipeline state, customer impact, or people sensitivity. They must not replace universal state.

### Principal model

* Entity uses one principal space for humans, agents, systems, workflows, imports, and external events.
* Human principals are verified user accounts.
* Agent principals are user-added workers/collaborators.
* Task Master is represented as an individual agent/system principal for accountability.
* Runtime/provider identity is separate from agent principal identity.
* Agent ownership may support person-owned and team-owned agents where applicable, but task ownership remains individual-principal-only.

### Docs, files, and artifacts

* Entity must maintain separate object concepts:

  * ExternalDocumentRef;
  * NativeDocument;
  * EvidenceArtifact.
* ExternalDocumentRef represents externally owned human/company docs such as Google Docs or Drive items.
* NativeDocument represents Entity-owned markdown documents and files.
* EvidenceArtifact represents machine/proof/audit outputs.
* The UI may present these together in one workspace, but the backend concepts must remain distinct.
* NativeDocument is the default/fallback document layer for companies without an external doc system.
* NativeDocument is also the editable native layer for specs, notes, reports, internal docs, and generated markdown outputs.
* EvidenceArtifact covers:

  * canonical task receipts;
  * review packets;
  * output receipts;
  * generated summaries;
  * agent handoffs;
  * audit trails;
  * curated reports and rollups.
* Raw proof receipts are immutable append-only.
* Corrections, retries, supersessions, or disputes create new artifacts/events.
* Curated reports, summaries, narratives, and rollups are editable/versioned and must reference source raw artifacts.
* UI must distinguish raw proof from curated interpretation.

### Google Docs connector

* Google Docs / Drive V1 posture is read-only / index / link / preview.
* V1 should support:

  * connector authorization state;
  * list/search metadata;
  * link external docs to Entity objects;
  * preview metadata/snippets where authorized;
  * open external doc;
  * show readiness/auth/permission state.
* V1 must not mutate Google Docs or Drive by default.
* V1 must not create Google Docs, update Google Docs, write to Drive, or sync markdown to Docs by default.
* Writes/export/sync belong later behind explicit permission gates, audit trail, and user confirmation.
* Google Docs may be canonical for human-authored/company-owned collaborative docs when a workspace already uses Google Workspace.
* Entity-native markdown remains canonical for low-level `entity-mc` evidence/proof receipts.
* External connector permission and Entity-side visibility are related but not identical. Entity must enforce its own visibility policy before rendering snippets or previews.
* V1 posture, future write/export/sync gates, audit expectations, and security caveats are documented in `docs/context/entity-phase-2-google-connector-posture-and-future-write-gates.md`.

### Receipt and proof model

* Every completed `entity-mc` task must create a minimal canonical markdown receipt automatically.
* Receipt generation is synchronous at task completion.
* A task cannot cleanly transition to `done` until:

  * receipt metadata exists transactionally;
  * receipt markdown body exists as a stable artifact;
  * origin task linkage is recorded;
  * content hash/integrity state is recorded;
  * activity event records receipt creation.
* If receipt writing fails, completion must fail or remain in a non-done explicit error state.
* Minimal receipt must include:

  * task id/title;
  * org/team/project;
  * worktype;
  * created_by;
  * initiator;
  * owner;
  * assignee;
  * executor;
  * submitted_by;
  * timestamps;
  * prior and new status;
  * done criteria when present;
  * evidence summary or explicit missing evidence;
  * output artifact links when present;
  * review state and reviewer;
  * human gate state and approver when applicable;
  * routing/execution history;
  * provenance/source;
  * artifact identity and integrity metadata.
* Canonical receipt storage uses a hybrid model:

  * DB stores metadata, integrity state, linkage, artifact id, mutability policy, creation status, and availability.
  * Markdown body lives as an EvidenceArtifact/NativeDocument-style artifact with stable identity and deep link.
* Stable artifact identity is canonical. Human-friendly paths are virtual aliases.
* Moving a task, project, or team must not break the underlying receipt artifact link.
* Receipts should be generated from current task projection plus structured activity log events, not ad hoc reconstruction.

### Activity log and provenance

* Entity’s per-task activity log is the provenance/event source for routing, review, receipt generation, and audit.
* Current task state is the fast projection.
* Activity log preserves history.
* Required structured event types include:

  * task created/updated;
  * assignment changed;
  * Task Master claimed;
  * nudge sent;
  * owner escalated;
  * auto-reassigned;
  * submission created;
  * review requested;
  * review decision;
  * human gate requested;
  * human gate decision;
  * status changed;
  * artifact linked;
  * receipt created;
  * receipt failed;
  * completion accepted;
  * completion blocked;
  * task cancelled/paused/blocked;
  * connector state changed;
  * notification routed.
* If existing activity logs lack structure, Phase 2 should add structured event payloads/migration rather than invent a parallel event log.

### Review and human gates

* Review is policy-based by worktype/risk, not mandatory for every task and not merely optional by a manual flag.
* All completed `entity-mc` work still gets a canonical receipt regardless of review requirement.
* Review policy resolution must consider:

  * workspace/default policy;
  * org policy;
  * team policy;
  * project policy;
  * worktype/plugin policy;
  * task flags/manual owner overrides;
  * risk detection from metadata/content/evidence/external side effects;
  * agent/runtime trust level.
* Resolution must produce:

  * review required or not;
  * human gate required or not;
  * reviewer target;
  * approver target;
  * reason chain;
  * Task Master drivability;
  * stall thresholds;
  * auto-reassignment eligibility;
  * notification routes.
* Higher-risk layers can escalate requirements.
* Lower-risk layers cannot silently bypass mandatory org/workspace gates.
* Reviewer assignment is automatic by default and can be overridden by authorized owner/team lead/admin with audit trail.
* Agent work should default to Task Master or eligible peer-agent review where policy says so.
* Human-initiated/human work should default to initiator review where separation-of-duties permits.
* Same-team/capability pool is fallback.
* Reviewer must not be submitted_by, created_by, or assignee where separation-of-duties applies.
* Human gate is separate from review.
* Human gates are required by policy for high-risk classes such as:

  * external sends;
  * people/HR actions;
  * customer commitments;
  * CRM/customer-impacting updates;
  * legal/financial exposure;
  * production/deployment impact;
  * security-sensitive work;
  * workspace-defined restricted classes.

### Task Master routing

* Task Master routes, gates, and runs review queues. It is not the universal executor.
* Task Master drives only:

  * unassigned work that policy marks as Task-Master-drivable;
  * work assigned to Task Master itself;
  * work explicitly reassigned/claimed by policy.
* Assigned humans/agents own their own execution.
* For unassigned Task-Master-drivable tasks:

  * Task Master creates a claim/assignment event;
  * current executor becomes Task Master;
  * original unassigned state is preserved in activity history;
  * receipt includes claim and execution details.
* For assigned stalled tasks:

  * Task Master nudges the assigned principal first;
  * escalates to owner after threshold;
  * auto-reassigns after thresholds only when policy permits;
  * does not immediately take over assigned work.
* Auto-reassignment does not require owner approval once configured policy threshold is met, but it must be audited, reasoned, and visible.
* High-risk work can be excluded from auto-reassignment by policy.
* Completed receipts after reassignment must include original assignee, nudges, owner escalation, reassignment event, reassignment reason, final executor, reviewer, approver/human gate when applicable, and final outcome.

### Search and indexing

* Entity search uses a hybrid model:

  * one global workspace search;
  * scoped tabs and filters.
* Search must cover:

  * tasks;
  * NativeDocuments;
  * EvidenceArtifacts;
  * ExternalDocumentRefs and Google Docs metadata where authorized;
  * task activity logs;
  * ClickClack threads/messages where integrated;
  * projects/goals/plans/specs;
  * people/agents.
* Search result envelope must include:

  * object type;
  * title;
  * snippet when permitted;
  * source;
  * canonical/deep link;
  * org/team/project scope;
  * recency;
  * provenance;
  * permission state;
  * connector/auth state when relevant.
* Filters must include:

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
* Permission filtering must occur before snippets/previews render.
* Evidence receipts and activity logs must be indexed so proof can be found without opening every task manually.

### Permissions and RBAC

* Entity permissions use layered RBAC plus object sensitivity.
* Access inherits from org to team to project to object unless overridden.
* Object-level sensitivity/ACL can tighten access beyond defaults.
* Sensitive categories include:

  * people/HR;
  * customer/account-sensitive;
  * legal;
  * financial;
  * security;
  * production;
  * confidential strategy;
  * workspace-defined restricted classes.
* Permissions apply to:

  * tasks;
  * documents;
  * artifacts;
  * external refs;
  * previews;
  * snippets;
  * activity logs;
  * search results;
  * notifications;
  * ClickClack-linked objects;
  * Helm-backed status widgets.
* Denied access must not leak restricted content.
* UI may show restricted placeholders only where object-existence disclosure is permitted.

### Notifications and escalation

* Entity inbox/activity is the canonical notification record.
* External channels are delivery routes, not source of truth.
* Notification routing is policy-based and may use:

  * ClickClack;
  * email;
  * Discord;
  * Slack;
  * AgentPush;
  * webhooks;
  * other configured channels.
* Notification records must include:

  * canonical Entity event;
  * recipient;
  * object reference;
  * notification type;
  * inbox state;
  * delivery routes;
  * delivery status;
  * failure/degraded state;
  * policy reason.
* Notification types must cover:

  * Task Master nudges;
  * owner escalations;
  * review requests;
  * human gate requests;
  * reassignment notices;
  * receipt failures;
  * connector degradation;
  * policy warnings.
* If an external channel fails, Entity preserves the canonical notification and surfaces delivery failure.

### Integrations and degraded states

* Helm unavailable:

  * show degraded/unavailable status;
  * preserve Entity work flow;
  * do not show fake health;
  * do not expose secrets.
* ClickClack unavailable:

  * show staged/degraded/unavailable readiness;
  * preserve docs/files/proof/review;
  * keep Entity-owned object links.
* Google auth expired/insufficient:

  * show auth/readiness state;
  * stop refresh/preview where unauthorized;
  * preserve linked ref where Entity policy allows;
  * do not attempt mutation.
* Receipt body/metadata drift:

  * mark integrity error;
  * show receipt-integrity problem;
  * do not silently present clean proof.
* Search index lag:

  * expose observability;
  * do not claim complete freshness where unavailable.
* Notification channel failure:

  * preserve canonical Entity notification;
  * show delivery failure/degraded state.

### Migration and backfill

* Migration is progressive.
* Do not require perfect strict migration before Phase 2 usability.
* Do not archive old tasks into a dead historical pile.
* Backfill what can be inferred from existing task data, activity logs, metadata, project/team context, and source events.
* Unknown or uncertain fields must be marked explicitly.
* Required new fields needing backfill include:

  * org/team/project;
  * initiator;
  * owner;
  * assignee/executor;
  * worktype;
  * receipt linkage;
  * structured activity provenance.
* Backfilled fields must carry source and confidence.
* Historical completed tasks without canonical receipts must be marked as missing receipt.
* Do not fabricate raw historical receipts.
* Optional later backfilled summaries must be labeled as curated/backfilled summaries, not original raw receipts.
* Migration warnings should generate cleanup queues.
* New tasks can enforce stricter invariants before old tasks are fully cleaned.

### API/service contracts to define or modify

* Org/Team/Project Service:

  * create/read/update/list orgs, teams, projects;
  * enforce scoping and tenant isolation;
  * expose lifecycle and derived health.
* Task Service:

  * create/update/transition/assign/claim/submit/complete;
  * enforce initiator, individual owner, assignment rules, worktype overlays, and state machine.
* Planning Object Service:

  * manage goals, plans, specs, domain plan labels, links to tasks/artifacts/docs, lifecycle, and derived health.
* Document Service:

  * manage NativeDocuments;
  * link ExternalDocumentRefs;
  * expose connector readiness/auth state.
* Artifact/Receipt Service:

  * manage EvidenceArtifacts;
  * enforce immutable raw receipts and versioned curated artifacts;
  * generate and retrieve receipts.
* Activity Log Service:

  * append structured provenance events;
  * expose task activity safely under permissions.
* Policy Resolution Service:

  * resolve review, human gate, Task Master, reassignment, and notification decisions;
  * store reason chains.
* Review Service:

  * assign reviewers;
  * accept review;
  * request fixes;
  * enforce separation of duties.
* Human Gate Service:

  * request/approve/reject human gates;
  * enforce human approver eligibility.
* Task Master Routing Service:

  * claim;
  * nudge;
  * escalate;
  * auto-reassign;
  * record events.
* Search Service:

  * index Entity objects and connector refs;
  * return permission-filtered global/scoped results.
* Permission/Sensitivity Service:

  * evaluate RBAC inheritance, object sensitivity, ACLs, previews, snippets, and mutation grants.
* Notification Service:

  * create canonical inbox records;
  * route external deliveries;
  * record degraded/failure state.
* Connector Service:

  * Google Docs/Drive V1 read/index/link/preview;
  * ClickClack readiness/thread refs;
  * Helm status/light-control adapter.
* Migration/Backfill Service:

  * dry-run inventory;
  * inferred field backfill;
  * activity structuring;
  * review packet mapping;
  * cleanup queue generation.

### Implementation ticket graph shape

* `/to-issues` should use hybrid epics:

  * product capability epics;
  * tickets split by schema/data, API/service, UI/UX, migration/backfill, tests/validation, docs, and rollout.
* Recommended vertical epics:

  * workspace tenancy, hierarchy, and navigation;
  * task model, worktypes, planning objects, and principals;
  * docs/files/artifacts object model;
  * canonical markdown receipts and proof-backed completion;
  * review, policy resolution, human gates, and reviewer assignment;
  * Task Master routing, nudging, escalation, and reassignment;
  * permissions, RBAC, object sensitivity, and audit;
  * agent identity, runtime/provider abstraction, and agent activity;
  * search and indexing;
  * notifications, inbox, and escalation routing;
  * Helm integration and runtime/admin boundary;
  * ClickClack integration and degraded collaboration;
  * Google Docs/Drive connector V1;
  * progressive migration and backfill;
  * rollout, observability, QA, and release gates.

## Testing Decisions

### Testing posture

* Tests must prove behavior, not just implementation shape.
* The standard is proof-backed development: every ticket produces evidence appropriate to its layer.
* No ticket should be accepted on verbal claims.
* Missing, degraded, unauthorized, expired, unknown, failed, and uncertain states must be tested explicitly.
* Tests must enforce product boundaries:

  * Entity is not Mission Control only;
  * Entity is not Helm;
  * ClickClack does not block proof/review/docs/files;
  * Google Docs is not canonical proof storage;
  * OpenClaw/Hermes are not hardcoded as Entity;
  * Paperclip is not internal;
  * Curacel is not demo scope.

### Evidence required per implementation ticket

* Schema/data tickets must produce:

  * schema diff;
  * migration or fixture proof;
  * validation tests;
  * backward compatibility notes where relevant.
* API/service tickets must produce:

  * API tests;
  * request/response fixtures;
  * error-state fixtures;
  * permission-denial tests where relevant.
* UI/UX tickets must produce:

  * screenshots or DOM receipts;
  * empty/degraded/restricted state proof;
  * control visibility tests;
  * copy review for boundary-sensitive labels.
* Receipt/proof tickets must produce:

  * generated markdown receipt samples;
  * snapshot tests;
  * write-failure tests;
  * integrity-error tests;
  * immutable mutation rejection tests.
* Policy/review tickets must produce:

  * reason-chain snapshots;
  * policy matrix tests;
  * self-review rejection tests;
  * human gate tests;
  * override audit fixtures.
* Task Master tickets must produce:

  * claim/nudge/escalation/reassignment event fixtures;
  * double-claim race tests;
  * no-takeover negative tests;
  * reassigned receipt samples.
* Search tickets must produce:

  * index samples;
  * global and scoped query tests;
  * permissioned search tests;
  * restricted snippet suppression proof.
* Permission/RBAC tickets must produce:

  * cross-org denial tests;
  * sensitivity override tests;
  * preview/snippet leakage tests;
  * restricted activity/evidence tests.
* Integration tickets must produce:

  * live/mock success tests where applicable;
  * degraded-state tests;
  * no-secret/no-mutation negative tests;
  * readiness/status fixtures.
* Migration tickets must produce:

  * dry-run reports;
  * before/after samples;
  * inferred-field confidence/provenance proof;
  * warnings and cleanup queue samples;
  * rollback notes.
* Rollout tickets must produce:

  * feature flag proof;
  * observability proof;
  * rollback runbook proof;
  * release checklist proof.

### Schema and data tests

* Validate Org → Team → Project → Task relationships.
* Validate every new task has initiator and individual owner.
* Validate owner cannot be a team.
* Validate executable task assignee/executor is an individual principal or allowed Task-Master-drivable unassigned state.
* Validate tasks can exist without Goal/Plan/Spec.
* Validate Goal/Plan/Spec lifecycle state is separate from derived health.
* Validate universal task state cannot be replaced by worktype overlays.
* Validate NativeDocument, ExternalDocumentRef, and EvidenceArtifact are distinct object concepts.
* Validate raw EvidenceArtifact receipts are immutable append-only.
* Validate curated reports are editable/versioned.
* Validate receipt metadata, artifact identity, content hash, and integrity state exist.
* Validate policy result fields and reason chains are persisted.
* Validate activity events carry structured payloads for routing, review, gates, receipt creation, and completion.
* Validate notification records preserve canonical Entity event and delivery routes.

### API/service tests

* Task create rejects missing initiator on new tasks.
* Task create rejects missing individual owner on new tasks.
* Task create rejects team owner as final task owner.
* Task transition records activity events.
* Task completion writes receipt metadata and markdown artifact body before clean `done`.
* Receipt writer failure blocks clean completion or leaves explicit non-done error state.
* Review assignment blocks self-review.
* Review accept/request-fix requires eligible reviewer.
* Human gate approval requires eligible human approver.
* Task Master claim works for unassigned Task-Master-drivable tasks.
* Task Master claim does not work for unassigned non-drivable routing problems.
* Task Master nudges assigned stalled tasks without taking over.
* Task Master escalates to owner after threshold.
* Task Master auto-reassigns only where policy permits.
* Auto-reassignment selects an eligible individual principal.
* Google Docs V1 connector performs no write/create/update/export mutation.
* Helm adapter never exposes secrets.
* ClickClack degraded state does not fail task/proof/review APIs.
* Notification external channel failure preserves canonical Entity notification.

### UI tests

* Workspace shell presents Entity as a work plane, not only a task board.
* Business-ops mode supports sales, people, and CS labels without forcing “spec” language.
* Task detail distinguishes initiator, owner, assignee, executor, submitted_by, reviewer, and approver.
* Task detail shows receipt status, evidence, missing evidence, output artifacts, review state, human gate state, and provenance.
* UI distinguishes:

  * external docs;
  * Entity-native markdown;
  * raw proof artifacts;
  * curated reports.
* Review panel shows reason chain and eligible controls only.
* Human gate panel is separate from review panel.
* Task Master routing states are visible:

  * unassigned drivable;
  * routing problem;
  * claimed by Task Master;
  * nudged;
  * owner escalated;
  * auto-reassigned.
* Search shows source, object type, permission state, and connector state.
* Restricted snippets/previews are suppressed.
* Helm panel shows live/degraded state without secrets or deep admin duplication.
* ClickClack panel shows live/staged/degraded/unavailable readiness.
* Google Docs panel shows auth/readiness state and no V1 write controls.
* Migration warnings appear without pretending certainty.

### Policy and permissions tests

* Layered policy resolution is deterministic for the same inputs.
* Higher-risk layers escalate review or human gate requirements.
* Lower-risk layers cannot bypass mandatory org/workspace gates.
* External-send work can require human gate.
* People/HR-sensitive work can require human gate and restricted visibility.
* Customer-impacting work can require human gate.
* Missing/weak evidence can force review.
* Agent/runtime trust can affect review policy where configured.
* Reviewer assignment respects separation of duties.
* Initiator default reviewer only applies where eligible.
* Owner/team lead/admin override records audit trail.
* Cross-org access is blocked.
* Object sensitivity overrides inherited access.
* Search, snippets, previews, activity, artifacts, external refs, notifications, and ClickClack-linked content respect permissions.

### Search tests

* Index includes tasks, NativeDocuments, EvidenceArtifacts, ExternalDocumentRefs, activity events, planning objects, people/agents, and ClickClack refs where integrated.
* Evidence receipts are searchable by task, owner, assignee, reviewer, worktype, project, date, and provenance.
* Activity events are searchable where permissioned.
* External Google Docs metadata is indexed only where authorized.
* Search can filter by object type, source, team, project, worktype, owner, assignee, initiator, lifecycle state, review state, risk, sensitivity, date, and connector/auth state.
* Permission filtering prevents restricted snippet leakage.
* Search degraded/index-lag state is observable.

### Integration tests

* Helm reachable state returns runtime/agent status, health, heartbeat, current work, schedule/loop summary, and deep links.
* Helm unreachable state returns degraded/unavailable status and preserves Entity work flows.
* Helm safe light controls are policy-checked, reversible, audited, and limited.
* Helm deep admin controls are not exposed in Entity.
* ClickClack live state can show linked threads/channels where integrated.
* ClickClack unavailable state does not block docs/files/proof/review.
* Google Docs authorized state supports read/index/link/preview.
* Google Docs expired/insufficient-scope state shows degraded/auth error.
* Google Docs deleted/revoked state shows stale/degraded ref without losing Entity-native proof.
* External notification channel failure records delivery failure without losing canonical notification.

### Migration tests

* Dry run counts existing tasks, projects, docs, review packets, activity logs, and gaps.
* Backfill infers org/team/project where possible with confidence/provenance.
* Backfill infers initiator from explicit request metadata, source event, created_by, imported system, or unknown/system with confidence.
* Backfill infers owner from existing owner, project owner, assignee, initiator, created_by, or cleanup queue.
* Owner backfill resolves to an individual principal where possible.
* Missing owner remains warning/cleanup state, not fake certainty.
* Existing review packets map to structured evidence fields where possible.
* Historical completed tasks without receipts are marked missing_receipt, not given fake raw receipts.
* Existing activity logs map to structured ActivityEvents where possible.
* Weak activity structure is flagged.
* Old tasks remain visible.
* New task enforcement works behind feature flags.

### Degraded-state tests

* Receipt writer fails.
* Receipt body missing.
* Receipt hash mismatch.
* Missing evidence.
* Self-review attempt.
* Initiator/reviewer ineligible.
* Unassigned non-drivable task.
* Task Master double-claim race.
* Assigned stalled task.
* Auto-reassignment blocked by policy.
* Helm unavailable.
* ClickClack unavailable.
* Google auth expired.
* External doc permission revoked.
* Sensitive snippet leakage attempt.
* Task/project move with receipt path stability.
* Notification route failure.
* Migration uncertainty.

### Release readiness tests

* No completed `entity-mc` task can reach clean `done` without canonical receipt.
* No raw receipt can be overwritten.
* No self-review path exists where forbidden.
* No Google Docs mutation exists in V1 default path.
* No Helm secrets or deep admin controls appear in Entity.
* No ClickClack outage blocks proof/review/docs/files.
* No restricted content leaks through search/snippets/previews/activity/notifications.
* No migration backfill fabricates certainty.
* No implementation claim is accepted without proof artifacts.

## Out of Scope

* No prototype requirement for Phase 2.
* No production deployment requirement for Phase 2.
* No Curacel demo. Curacel is design-customer / pilot context only.
* No Paperclip internal architecture, module, product, orchestration layer, or dependency.
* No treating Entity as only Mission Control or only a task board.
* No collapsing Helm into Entity.
* No duplicating Helm deep runtime/admin controls inside Entity.
* No exposing credentials, secrets, model/provider config, schedule editing, tool grants, deployment settings, destructive runtime actions, or billing/runtime policy inside Entity.
* No hard-coded OpenClaw/Hermes-only runtime model.
* No treating OpenClaw or Hermes as Entity itself.
* No making ClickClack availability block Entity docs, files, artifacts, receipts, proof, review, search, or core task flows.
* No making Google Docs the canonical store for low-level `entity-mc` proof/evidence.
* No default Google Docs/Drive mutation in V1.
* No Google Docs create/update/export/sync by default in V1.
* No fake historical receipt certainty.
* No creating raw “original” receipts for old completed tasks that did not actually have canonical synchronous receipts.
* No destructive migration.
* No strict migration that blocks Phase 2 usability on perfect historical cleanup.
* No pretending unknown, missing, degraded, unauthorized, expired, failed, or uncertain states are healthy.
* No implementation claims that code has been built, tested, deployed, or proven by this PRD.
* No stale file paths or implementation code snippets in the PRD/ticket output.
* No full enterprise billing model in Phase 2 beyond preserving plan/deployment seams.
* No final search backend choice unless made during implementation planning.
* No final native markdown storage backend choice unless made during implementation planning.
* No final policy DSL/storage format unless made during implementation planning.
* No public desktop/mobile posture decision unless separately confirmed.

## Further Notes

### Unresolved decisions / assumptions needing product confirmation

* Exact current schema shape must be inventoried before migration tickets are finalized.
* Policy storage format remains open: database rows, JSON policy documents, code config, or hybrid.
* Default risk matrix needs product confirmation by worktype, especially for sales, people, CS, and business operations.
* Exact human gate override authority needs confirmation for high-risk classes.
* Reviewer load and availability source is not defined.
* Agent/runtime trust level model is not defined.
* Task Master topology needs confirmation: per-team Task Master, global Task Master, or hybrid with team-scoped queues.
* Nudge channels per agent/provider need definition.
* Google Docs V1 minimal scopes need security review.
* Native markdown storage backend remains implementation choice.
* Receipt atomicity mechanism remains implementation choice.
* Search backend remains implementation choice.
* Actual ClickClack integration maturity must be verified during implementation.
* Actual Helm API shape must be inventoried and mapped to the desired contract.
* Enterprise/self-deploy packaging details remain future implementation work.
* Billing/plan seams are required, but billing product model is not specified.
* Desktop/mobile shell posture remains unresolved.
* Domain-specific Plan label vocabulary for sales, people, CS, and ops remains open.
* Whether to generate curated historical backfill summaries for old tasks without receipts remains a product decision.
* Default notification channel priority/order by team/worktype remains open.

### How this PRD should feed `/to-issues`

Use vertical slices. Do not create one giant schema issue, one giant UI issue, and one giant testing issue detached from product behavior. Each epic should represent a product capability, then split tickets by layer.

Recommended `/to-issues` output shape:

1. Workspace tenancy, hierarchy, and navigation

   * schema/data;
   * API/service;
   * UI/UX;
   * tests;
   * docs/ADR;
   * rollout.

2. Task model, worktypes, planning objects, and principals

   * task required fields;
   * Goal/Plan/Spec objects;
   * universal lifecycle and overlays;
   * principal semantics;
   * UI accountability panel;
   * validation tests;
   * docs.

3. Docs/files/artifacts object model

   * NativeDocument;
   * ExternalDocumentRef;
   * EvidenceArtifact;
   * markdown read/write;
   * artifact mutability;
   * UI distinctions;
   * permission tests;
   * ADR.

4. Canonical markdown receipts and proof-backed completion

   * receipt metadata;
   * synchronous receipt writer;
   * completion invariant;
   * receipt viewer;
   * path/deep-link behavior;
   * integrity tests;
   * receipt protocol docs.

5. Review, policy resolution, human gates, and reviewer assignment

   * policy schema;
   * layered resolver;
   * reviewer/approver assignment;
   * review decisions;
   * human gate decisions;
   * UI reason chains;
   * policy matrix tests;
   * docs.

6. Task Master routing, nudging, escalation, and reassignment

   * assignment history;
   * claim logic;
   * nudge logic;
   * owner escalation;
   * auto-reassignment;
   * routing UI;
   * routing matrix tests;
   * docs.

7. Permissions, RBAC, object sensitivity, and audit

   * roles/grants/sensitivity/ACL;
   * permission evaluator;
   * API enforcement;
   * restricted UI states;
   * leakage test suite;
   * RBAC docs.

8. Agent identity, runtime/provider abstraction, and agent activity

   * unified principals;
   * runtime provider refs;
   * agent registry/status/activity;
   * agent activity UI;
   * provider-agnostic tests;
   * docs.

9. Search and indexing

   * unified search envelope;
   * Entity object indexers;
   * connector/chat indexers;
   * global/scoped search API;
   * search UI;
   * permission/relevance tests;
   * docs.

10. Notifications, inbox, and escalation routing

* canonical notification record;
* routing policy;
* inbox APIs;
* inbox/escalation UI;
* degraded channel tests;
* docs.

11. Helm integration and runtime/admin boundary

* Entity↔Helm contract;
* Helm status adapter;
* safe light controls;
* runtime status UI;
* boundary/degraded tests;
* ADR.

12. ClickClack integration and degraded collaboration

* Entity↔ClickClack contract;
* readiness adapter;
* embedded/staged chat panel;
* degraded-mode tests;
* docs.

13. Google Docs/Drive connector V1

* read-only connector contract;
* metadata/search/link/preview service;
* external doc UI;
* read-only/degraded tests;
* connector posture docs.

14. Progressive migration and backfill

* inventory/dry-run report;
* required field backfill;
* review packet/evidence mapping;
* activity log structuring;
* migration warning UI;
* non-destructive tests;
* runbook.

15. Rollout, observability, QA, and release gates

* metrics/logs;
* feature flags;
* E2E proof suite;
* security/permission release gate;
* rollback runbook;
* release checklist.

Each issue should include:

* product capability;
* layer;
* scope;
* dependencies;
* acceptance criteria;
* proof requirements;
* degraded-state behavior where applicable;
* boundary checks where applicable;
* explicit “not done until proof attached” standard.

The ticket graph should prioritize the receipt/review/task spine first, then docs/artifacts, permissions/search, Task Master, and integrations. The work plane can be broad, but the wedge must stay sharp: proof-backed agent work review inside a coherent human-agent workspace.

---

## Canonical Merge Addendum — Opus 4.8 Must-Fixes Applied

This addendum is part of the canonical PRD. It applies the Opus 4.8 critique to the GPT-5.5 Pro PRD draft and overrides any ambiguous wording in the earlier sections.

### Receipt atomicity and failure contract

Completed `entity-mc` tasks cannot reach `done` unless the canonical markdown receipt exists and is indexed.

The completion contract is:

1. Write the immutable markdown receipt body to a stable artifact path.
2. Compute the receipt body hash.
3. In the same transaction as the `done` transition, write DB receipt metadata referencing the artifact id, stable path, and hash.

Failure handling:

- If the markdown body write fails, the task remains non-done with `receipt_status=failed` and a `receipt_failed` activity event.
- If metadata transaction fails after the markdown body exists, the task remains non-done with `receipt_status=integrity_error` and an orphaned-artifact reconciliation job is queued.
- Receipt metadata can be regenerated from an immutable body for indexing only. Regeneration must never rewrite the receipt body and must not run if the body is missing.

### Gate-before-done ordering

Human gates resolve before `done`.

A task with a required unapproved gate cannot be `done`. It remains in `review` with a `gate_pending` modifier until the gate is approved, rejected, or explicitly overridden by policy. The canonical receipt is written only at the final `done` transition, after the gate decision resolves, so completed receipts always record resolved gate/review decisions and never record a pending gate as if it were done.

### Required Slice 0 inventory dependency

Before implementation slices that rely on current Entity internals, create a hard dependency ticket for current-state inventory:

- current schema inventory;
- activity-log event inventory;
- `review_packet` shape inventory;
- current proof/receipt/review storage inventory;
- gap report against the target `ActivityEvent` enum and receipt/review model.

Receipt generation, Task Master routing, and migration/backfill tickets depend on this Slice 0 inventory.

### Worktype registry and typed overlays

`worktype_overlay` must not be an untyped free-form record. Entity Phase 2 uses a worktype registry.

Each worktype declares:

- overlay schema name and version;
- allowed overlay fields and types;
- allowed values where applicable;
- default risk contribution;
- default DomainPlan label vocabulary;
- which fields are indexable/filterable in search;
- sensitivity defaults.

Examples:

- Sales overlay: account id/name, deal stage, next action, stakeholder map, external-send risk, CRM side-effect type.
- Customer success overlay: customer id/name, health state, renewal/escalation marker, support context, external-response risk.
- People overlay: candidate/employee reference, workflow stage, sensitivity class, HR action side-effect type, approval requirement.

### Agent principal to runtime binding

Entity agent principals are separate from runtimes, but may bind to Helm-managed runtime/provider records.

Agent principal binding fields:

- `runtime_binding_id`;
- `provider_type` as a generic enum, not hard-coded to OpenClaw/Hermes;
- `helm_managed: boolean`;
- `binding_state: bound | unbound | stale | unknown`.

Entity reads runtime status through the Helm adapter keyed by `runtime_binding_id`. If Helm is unreachable or the binding cannot be resolved, Entity renders `unknown`/degraded runtime status without faking health and without blocking docs/files/proof/review flows.

### Separation-of-duties reviewer fallback

Review assignment follows this deterministic chain:

1. initiator;
2. if the initiator is separation-of-duties excluded, same-team capable reviewer pool;
3. if no reviewer pool candidate exists, owner if eligible;
4. if no eligible owner exists, escalate to admin as a routing problem.

The initiator is excluded as reviewer iff the initiator is also the assignee, executor, or submitted_by principal. The policy engine must emit the reason chain for the selected reviewer and for skipped candidates.

### Org-scoping enforcement seam

Multi-org isolation is enforced at a single foundational seam: request-context org binding plus mandatory `org_id` predicates on all service queries. Cross-org access must fail by construction, not by ad hoc per-service checks. All service/API/search/indexing slices depend on this enforcement seam.

### Additional canonical implementation clarifications

- `taskmaster_drivable` is a cached projection of policy resolution, not an independently authoritative task field.
- `ExternalSideEffect` is a load-bearing schema concept and must include side-effect type, target system, sensitivity/risk class, required gate, requested actor, and resolution state. Initial types include email send, CRM update, HR action, financial commitment, legal/contract action, production/security change, and customer commitment.
- `ObjectRef` must be explicit wherever objects are linked: `{ object_type, object_id, link_role }`.
- `DerivedHealth` recomputes event-driven on linked-task state changes and must expose stale/degraded state rather than fake freshness.
- Search can surface Helm/runtime status references only; it must not duplicate Helm's deep runtime/admin object search.
- Agent Management is a named Entity surface distinct from Agent Activity. It shows agent identity, capabilities/skills, current work, recurring crons/loops visibility, and runtime binding status; runtime configuration and spin-up route through Helm.
- Entity includes an owner accountability inbox: owners can see all tasks they are accountable for, including stalled, escalated, review-blocked, and gate-pending tasks.
- Entity preserves the existing `entity-mc review.sh`/agent-review path as a policy-governed review route, subject to separation-of-duties.
- The buyer's first-session spine is: connect/read indexed context, add/register one agent via Helm-backed binding, create one business-ops task, complete it with canonical receipt, review it, and inspect proof/search/activity.

### Testing additions required by the merge

Add explicit tests/proof gates for:

- gate-before-done ordering;
- completed receipts containing resolved gate/review decisions only;
- receipt write failure and metadata integrity failure states;
- worktype overlay validation and search-indexable overlay fields;
- stale/unbound runtime binding degraded display;
- deterministic SoD reviewer fallback chain;
- idempotent migration/backfill that does not overwrite human-corrected values;
- permission-change propagation that suppresses previously indexed restricted snippets;
- org-scoping enforcement at the request/query seam;
- `receipt/regenerate-metadata` never rewriting body and refusing missing-body regeneration.

### Traceability — Opus 4.8 must-fixes

1. Receipt atomicity: applied in “Receipt atomicity and failure contract.”
2. Slice 0 inventory: applied in “Required Slice 0 inventory dependency.”
3. Worktype registry: applied in “Worktype registry and typed overlays.”
4. Runtime binding: applied in “Agent principal to runtime binding.”
5. SoD fallback: applied in “Separation-of-duties reviewer fallback.”
6. Gate-before-done: applied in “Gate-before-done ordering.”
7. Org-scoping seam: applied in “Org-scoping enforcement seam.”
