Entity Google, Microsoft, and Local Office Document Integrations — Product Requirements Document

Derived from Oracle SuperSpec, not a fresh Oracle artifact.

Status and Source Authority
Field	Value
Date	2026-08-09
Status	Implementation-ready derived PRD; production rollout approval-gated
Mode	Product + Technical + Implementation
Owner	Henry Mascot
Repository	https://github.com/h-mascot/entity
Inspected base	origin/main at 91d54e4cc92f6f7bf809c8c13c516c58ab6c481f
Source run	entity-doc-integrations-20260809
Canonical SuperSpec SHA-256	eb8c95439a7ceb563b1642d070376a1e3e5f39262d4da66d45e61151b6bfe61d
Source packet SHA-256	7293fb76483a4aa10beda1182e1e9265e56a55ae6bb4ec8293a6bdc2c7cf6c4b

This PRD is the implementation-facing derivation of the canonical Oracle SuperSpec and controlling Entity Document Integrations Loom Source Packet. It preserves settled decisions, capability honesty, the Google V1 write gate, revision-conflict safety, local bridge security, the clean-worktree constraint, reversible rollout, exact-SHA sandbox proof, and the explicit production approval gate. Unknown provider capabilities, scopes, licensing, repository contracts, file limits, and retention values remain evidence gates or open questions rather than inferred facts.

PRD Navigation

Status, authority, decisions, and assumptions: Sections 1–2

Problem, outcomes, non-goals, users, and workflows: Sections 3–7

Functional requirements and UX states: Sections 8–9

Provider-neutral architecture, data, API, and event contracts: Sections 10–13

Google, Microsoft, and local Office implementation requirements: Sections 14–16

Security, privacy, threat model, and failure handling: Sections 17–18

Acceptance, tests, proof, and cross-provider matrix: Sections 19–21 and 25

Migration, flags, rollout, rollback, telemetry, and diagnostics: Sections 14, 22–24

Downstream implementation issue authority: Sections 26–27, T-001 through T-040

Risks and unresolved product/provider decisions: Sections 28–31

MVP and production approval gates: Sections 21 and 32

1. Source Map
1.1 Controlling evidence

This specification is derived from the Entity Document Integrations Loom Source Packet prepared on 2026-08-09.

The following evidence is treated as authoritative:

Henry Mascot's request:

Google integration.

Microsoft integration.

Local-only Office support.

Settled product decisions in the source packet:

Entity is the durable document workspace and control plane.

Google Workspace, Microsoft 365, and local Office are provider/engine implementations behind a common Entity abstraction.

Entity must not rebuild Word, Excel, PowerPoint, Google Docs, Sheets, or Slides.

Google Workspace remains valid for Curacel and must not be displaced.

Microsoft-heavy customers must receive the same Entity-level document abstraction.

Local-only users must receive actual editable Office files without Google, Microsoft, or cloud identity.

Google editing UI must not be represented as embeddable unless a supported route is proven.

Microsoft Office-for-web/WOPI embedding must not be assumed.

Local desktop editing may use an authenticated Entity desktop bridge.

Browser-only users must receive an explicit bridge-unavailable/install state.

GenOffice is a candidate local engine, not a predetermined architecture.

Human and agent edits are both first-class.

Existing Entity agent receipts remain canonical low-level execution evidence.

External documents may be canonical business artifacts but do not replace execution receipts.

Repository inspection stated in the source packet:

Entity contains React/TypeScript, Express, SQLite, Electron, File Sources, docs routes, indexing/search, plugin seams, task/project links, and document-viewer surfaces.

Current Google integration is deliberately read/index/link/preview-only.

Existing tests reject Google write operations.

Current UI identifies Google documents as externally owned and read-only.

No first-class Microsoft 365 adapter was found.

No local DOCX/XLSX/PPTX editing engine was found.

The existing checkout is dirty and behind origin/main.

The following paths are high-value discovery surfaces and must be inspected before modifying related behavior:

packages/server/src/document-objects.test.ts

packages/server/src/google-docs-metadata.test.ts

packages/app/src/components/mission-control/utils/externalDocumentPreview.ts

packages/db/src/file-sources.ts

packages/server/src/fs/

packages/server/src/routes/docs.ts

packages/app/src/hooks/useFileSources.ts

packages/app/src/components/settings/FileSourcesSettings.tsx

docs/PLUGIN-ARCHITECTURE-SPEC.md

docs/context/entity-phase-2-google-connector-auth-model.md

docs/context/entity-phase-2-google-connector-posture-and-future-write-gates.md

docs/specs/entity-phase-2-prd-canonical-20260620.md

1.2 Authority order

Where evidence conflicts, implementation must resolve the conflict in this order:

Henry's latest explicit request or correction.

Settled decisions, MVP acceptance criteria, and non-goals in the source packet.

Current origin/main behavior and tests.

Canonical Entity context and LIVE documentation.

Current provider documentation and licensing evidence.

Older Entity specifications and issue graphs.

Model or implementer recommendations.

A lower-authority source must never silently override a higher-authority decision.

1.3 Evidence explicitly not available

The following were not supplied as verified evidence and therefore must not be invented:

Current Google API scopes or quota values.

Current Microsoft Graph endpoint availability for every Word, Excel, or PowerPoint mutation.

Current Office-for-web/WOPI commercial or licensing eligibility.

GenOffice's final licensing, fidelity, API, security, or maintenance suitability.

Existing Entity feature-flag implementation details.

Exact current database schema for document objects.

Exact current stable Entity document URL format.

Exact current receipt/event infrastructure APIs.

Existing secret manager implementation.

Supported production desktop platforms.

Provider-specific maximum file sizes.

Existing retention/deletion policy.

Exact production deployment mechanics.

These require implementation-time audit or provider documentation proof.

1.4 Assumptions

The specification makes the following constrained assumptions:

SQLite remains the Entity metadata persistence layer for this feature unless repository audit proves a different canonical store.

Existing docs, File Sources, indexing, associations, and receipt infrastructure should be reused rather than duplicated where their contracts are adequate.

New database structures described below are proposed logical contracts. Exact migration filenames, ORM/query helpers, and table naming must match repository conventions discovered during implementation.

Existing Google V1 behavior must remain read-only until the new write gate has passed its explicit enablement conditions.

Unknown provider capability is equivalent to unsupported for mutation and embedding.

Provider documents can change outside Entity; Entity must therefore model external revisions rather than assuming it exclusively owns writes.

1.5 Locked decisions
ID	Decision
D-001	Entity owns canonical Entity document identity, associations, policy, search, activity, audit, and agent workflow.
D-002	Provider-native editors remain provider-native. Entity does not recreate them.
D-003	All provider-specific behavior is exposed through negotiated capabilities.
D-004	Every managed artifact receives a stable Entity document ID and Entity URL.
D-005	Google remains read-only until an explicit V2 write gate is enabled.
D-006	Full Google human editing opens Google unless a separately proven supported embedding route exists.
D-007	Full Microsoft human editing opens Microsoft 365 unless WOPI/Office-for-web eligibility is separately proven.
D-008	Local Office uses real DOCX/XLSX/PPTX files without Google or Microsoft identity.
D-009	Local editing is behind a provider-neutral engine interface.
D-010	GenOffice is only a candidate pending an ADR-quality spike.
D-011	Local format order is DOCX → XLSX → PPTX.
D-012	Mutation operations use revision preconditions. A stale revision never silently overwrites a newer revision.
D-013	Raw OAuth tokens, refresh tokens, credentials, secrets, and bridge bearer tokens never enter document records, logs, receipts, issues, screenshots, or client-visible diagnostics.
D-014	Existing Entity execution receipts remain canonical proof of agent execution.
D-015	Production promotion remains explicitly approval-gated by Henry.
2. Executive Summary — Executive Decision

Entity will implement a provider-neutral Document Integration Platform with one canonical Entity document object and three provider families:

google_workspace

microsoft_365

local_office

The platform will separate five concerns:

Identity: one stable Entity document record and URL.

Provider storage/editing: Google, Microsoft, or local Office.

Capabilities: an explicit negotiated contract describing what is actually possible for the selected provider, document type, connection, destination, and runtime.

Concurrency: revision-aware writes that reject stale mutations.

Proof: attributable versions, activity, provider metadata, and Entity execution receipts.

Provider equality is not a goal. Contract equality is.

For example, both Google and Microsoft may expose create, preview, open_for_human_edit, and version_history, while only one may expose a proven native structured mutation API for a particular format. The API and UI must expose that difference instead of pretending both providers behave identically.

Local Office follows the same Entity abstraction but uses actual OOXML files and a local engine/desktop bridge rather than a cloud provider.

The architecture therefore becomes:

Human / Agent
|
v
Entity Document API / Agent Tools
|
+---------------------------+
| Document Registry |
| Capability Resolver |
| Destination Policy |
| Revision Coordinator |
| Activity / Receipts |
| Search / Associations |
+---------------------------+
|
Provider Adapter Contract
/ |
v v v
Google WS Microsoft 365 Local Office
Adapter Adapter Adapter
|
Local Engine Contract
|
+--------------+-------------+
| | |
Candidate Candidate Installed
GenOffice editor desktop app

No provider receives special UI behavior based merely on its name where a capability check can express the same decision.

3. Problem Statement

Entity currently has document viewing, indexing, File Sources, search, associations, and a deliberately read-only Google path, but it does not yet provide a unified end-to-end document workflow in which a human or agent can safely create and revise Office-class artifacts across Google Workspace, Microsoft 365, and local-only environments.

Without the new architecture:

document identity is at risk of becoming provider-specific;

agent tools would need Google-, Microsoft-, and local-specific branching;

user-facing actions could imply capabilities that a provider does not actually support;

introducing Google mutation could accidentally break the existing read-only safety contract;

Microsoft document creation and mutation could be overstated relative to actual Graph capabilities;

local editing could expose the filesystem or create unsafe loopback APIs;

concurrent human/provider/agent edits could silently overwrite one another;

provider outages or expired authorization could appear as unexplained failures;

switching or adding providers could require rebuilding document UX;

external documents could become detached from Entity tasks, projects, search, activity, and agent proof.

The product must solve those problems without attempting to build an office suite.

4. Goals
G-001 — Stable Entity document identity

Every integrated artifact has one Entity document object and stable Entity URL regardless of provider.

G-002 — Provider-neutral workflows

Humans and agents can use a consistent create/read/revise/open workflow without depending on provider-specific internal details.

G-003 — Honest capabilities

Entity surfaces only capabilities that have been proven for the selected provider, artifact type, connection, destination, and runtime.

G-004 — Safe writes

All mutations are explicit, idempotent where practical, revision-aware, auditable, and fail safely.

G-005 — Google Workspace write expansion

Add bounded Docs, Sheets, and Slides creation/mutation without weakening the current V1 read-only contract before the write gate is enabled.

G-006 — Microsoft 365 support

Add tenant-aware OneDrive/SharePoint integration and document workflows with capability truth rather than assumed Word/Excel/PowerPoint parity.

G-007 — Local-only Office support

Allow DOCX/XLSX/PPTX workflows without Google, Microsoft, or cloud dependency, beginning with DOCX.

G-008 — Human and agent attribution

Entity records whether relevant changes originated from an Entity human, Entity agent, provider-side user, local editor, or an unknown external actor when finer attribution cannot be proven.

G-009 — Search and work-object integration

Documents remain searchable and associable with Entity workspaces, projects, tasks, and File Sources.

G-010 — Production-operable integration

The feature has diagnostics, rate-limit handling, degraded states, security controls, telemetry, migration/rollback paths, automated tests, browser/Electron proof, and exact-SHA deployment proof.

5. Non-Goals

The following are explicitly excluded unless a later approved specification changes scope:

Rebuilding Google Docs, Sheets, or Slides.

Rebuilding Microsoft Word, Excel, or PowerPoint.

Building a generic collaborative rich-text office editor inside Entity.

Claiming Google authenticated editing UI can be arbitrarily embedded.

Claiming Microsoft WOPI or Office-for-web embedding without proof of technical and licensing eligibility.

Replacing Google Workspace for Curacel.

Making GenOffice mandatory.

Absorbing an entire third-party Electron application solely to gain local editing.

Achieving perfect visual or semantic Office fidelity in MVP.

PDF support in the initial MVP.

DOCM/XLSM/PPTM macro-enabled document support in MVP unless separately reviewed and approved.

Silent last-write-wins conflict handling.

Storing raw cloud credentials in Entity document records.

Turning provider-generated business artifacts into the only evidence of an agent action.

Automatic production deployment.

Deleting or destructively rewriting the existing Google V1 implementation before rollback safety is proven.

Guaranteeing identical mutation granularity across Google, Microsoft, and local engines.

Arbitrary local filesystem browsing through the local bridge.

Generic cross-cloud migration between Google, Microsoft, and local formats in MVP.

Provider-wide permission administration beyond document integration requirements.

6. Users, Jobs, and Workflows
6.1 User classes
Workspace administrator

Jobs:

connect Google or Microsoft;

establish tenant/workspace binding;

select allowed destinations;

configure write authorization;

inspect scopes and health;

enable or disable provider writes;

configure local Office availability;

revoke a provider;

understand degraded conditions.

Human contributor

Jobs:

create an artifact;

find an existing artifact;

preview it;

identify where it is stored and who owns it;

edit it through the correct editor;

see versions/activity;

associate it with work;

recover from authorization, conflict, or local bridge problems.

Agent

Jobs:

create documents, spreadsheets, and presentations;

read current content/structure;

perform supported structured mutations;

identify unsupported capabilities before attempting a write;

use an expected revision;

emit an execution receipt;

return the stable Entity URL.

Reviewer/auditor

Jobs:

establish who or what changed a document;

distinguish Entity activity from provider-side activity;

inspect revision transitions;

confirm the agent acted on the intended artifact;

verify that no raw credentials entered evidence.

Support/operator

Jobs:

distinguish auth, quota, provider, bridge, conflict, indexing, and preview failures;

inspect sanitized diagnostics;

correlate an operation with a request/receipt;

disable unsafe writes without deleting metadata.

7. Core Workflows
W-001 — Agent creates a Google document

Agent requests document.create.

Entity resolves workspace provider policy and destination.

Entity verifies:

connection is healthy;

Google write feature is enabled;

administrator has authorized creation;

required capability is supported;

destination is allowed.

Entity allocates an operation/idempotency identifier.

Google adapter creates the artifact.

Entity creates or finalizes the canonical document record.

Entity stores provider ID, provider URL, current revision metadata, destination, capability snapshot, and activity.

Existing Entity receipt machinery records the low-level agent operation.

Search indexing is queued/performed.

Agent receives the stable Entity document URL.

If any provider create succeeds but Entity persistence fails, reconciliation must discover and repair the orphan rather than creating duplicates on blind retry.

W-002 — Human edits Google document

Human opens the Entity document URL.

Entity shows preview where supported.

Edit in Google is displayed only if the capability resolver permits it.

User opens the provider editor.

Provider-side changes are detected using supported change notifications or polling.

Entity refreshes revision metadata, preview/index state, and activity.

If provider evidence cannot identify the exact human, activity must say external actor rather than fabricate identity.

W-003 — Agent revises a document

Agent reads current Entity document state and revision.

Agent submits a bounded mutation with expectedRevision.

Revision Coordinator compares the expected revision with the current provider/local revision.

If they differ, Entity returns a conflict and performs no mutation.

If they match, adapter performs the mutation.

Entity captures the resulting revision/version.

Activity and execution receipt are linked to the operation.

Search/preview refresh occurs.

W-004 — Microsoft document creation

Entity resolves a Microsoft 365 connection and permitted OneDrive/SharePoint destination.

Capability resolution determines the supported creation route.

Entity creates a valid document, spreadsheet, or presentation through the proven Microsoft lane.

The resulting provider artifact receives one Entity document object.

Entity returns a stable Entity URL and reliable Edit in Microsoft 365 action.

The implementation may use different mechanics per Office format. The API must not claim the mechanics are identical.

W-005 — Local DOCX edit

User creates or opens a local Office document through Entity.

Entity resolves local_office capabilities.

Browser or Electron state determines local bridge availability.

If unavailable, Entity displays install/launch instructions and does not fake an edit action.

If available:

Entity grants an expiring document-scoped bridge token;

the bridge resolves an allowlisted Entity file reference;

the selected local engine/editor opens the DOCX;

external/local modifications are watched.

Before save replacement, Entity verifies the expected local revision.

Save uses a safe atomic replacement strategy appropriate to the platform.

Previous version/recovery evidence is preserved according to configured retention.

Entity records the new revision and activity.

Reopening the resulting DOCX must pass fidelity fixtures.

W-006 — Auth loss

Provider returns revoked/expired/conditional-access failure.

Connection transitions to a degraded or reauthorization state.

Writes fail closed.

Existing Entity records remain accessible to the degree existing cached metadata/preview policy permits.

UI explains the connection problem and next action.

An operator-visible sanitized event is recorded.

Reauthorization may restore capability without creating duplicate document records.

W-007 — Stale mutation

Revision R1 is read.

Another human or agent produces R2.

An actor attempts to mutate using expectedRevision=R1.

Entity detects current revision R2.

Entity returns 409 STALE_REVISION.

No data is overwritten.

UI/agent receives enough sanitized information to reread and retry deliberately.

8. Requirements
R-001 — Canonical document object

Entity must represent every managed document, spreadsheet, or presentation with one provider-neutral document record.

Required logical fields:

Entity document ID;

stable Entity URL or URL derivation key;

provider;

artifact type;

title;

provider/external artifact ID where applicable;

provider URL where applicable;

destination;

workspace;

project/task/File Source associations;

owner or ownership summary;

provider tenant/workspace binding;

permissions summary;

sensitivity label where available;

auth state;

readiness/degraded state;

revision/version/ETag/change token as supported;

provider modified time;

Entity indexed time;

preview/thumbnail state;

conflict state;

negotiated capabilities;

human/agent/external activity;

created/updated timestamps.

Acceptance criteria

Given any supported Google, Microsoft, or local artifact,
when Entity registers it,
then it receives exactly one canonical Entity document ID.

Given an artifact is rediscovered from its provider,
when the external provider identity already maps to an Entity object,
then Entity updates the existing record rather than creating a duplicate.

Given a provider URL changes but provider artifact identity does not,
when Entity synchronizes metadata,
then the Entity document URL remains stable.

Validation

Database uniqueness tests.

Provider rediscovery integration test.

Stable URL regression test.

Duplicate-import concurrency test.

R-002 — Provider-neutral capability negotiation

The backend must expose capabilities rather than forcing the UI, agents, or routes to infer capability from provider name.

Minimum capability vocabulary:

create
read
preview
thumbnail
open_external
human_edit
agent_text_mutation
agent_range_mutation
agent_slide_mutation
version_history
change_tracking
permission_read
permission_write
embed_editor
export

Each resolved capability must have at least:

type CapabilityState =
| "supported"
| "unsupported"
| "degraded"
| "unknown";

interface ResolvedCapability {
name: string;
state: CapabilityState;
reasonCode?: string;
reason?: string;
source: "adapter" | "connection" | "destination" | "runtime" | "policy";
}

unknown must fail closed for mutation and embedding.

Acceptance criteria

No write action is enabled solely because provider === "google_workspace" or equivalent.

Unsupported capabilities result in a typed unsupported-capability response.

A degraded connection can suppress a normally supported capability.

A missing local bridge changes local human_edit readiness without changing the canonical provider type.

Validation

Capability resolver unit matrix.

Static/code review for provider-name branching in shared surfaces.

Browser tests for supported/unsupported/degraded actions.

R-003 — Provider destination and policy model

Entity must model where newly created artifacts are stored and which writes are authorized.

Logical policy must support:

provider;

connection;

artifact type;

allowed destinations;

default destination;

write mode;

optional confirmation policy;

workspace/tenant scope.

Minimum write modes:

disabled
create_only
create_and_update

Default after migration is disabled unless an existing explicit write authorization can be proven.

Acceptance criteria

A workspace cannot create into an unapproved destination.

A read-only connection cannot be converted into write-capable merely because the OAuth token has broad scopes.

Missing destination policy blocks creation with a typed configuration error.

Policy can be disabled without deleting existing document records.

Validation

Policy unit tests.

Negative create tests.

Settings UI tests.

Revocation/disable integration test.

R-004 — Preserve existing Google V1 read-only behavior

Existing Google V1 behavior must remain read/index/link/preview-only until V2 write authorization is explicitly enabled.

Existing negative tests rejecting create/update/write/export/sync must remain semantically valid for the old lane.

Acceptance criteria

Given Google V2 write flag is disabled,
when any new write endpoint, tool, or UI attempts mutation,
then no Google mutation request is sent.

Given legacy Google read-only tests,
when the unified document model is introduced,
then those tests continue to pass until deliberately replaced by an approved migration test covering equivalent safety.

Validation

Existing Google test suite.

Provider fake asserting zero mutation calls while flag disabled.

Browser test confirming no write controls.

Agent-tool negative test.

R-005 — Explicit Google write gate

Google mutation requires all of:

deployment-level feature availability;

valid Google connection;

explicit administrator write authorization;

required provider scopes;

allowed destination;

capability supported;

applicable confirmation policy satisfied;

non-stale revision for updates.

Feature-flag names are implementation details and must follow the repository's actual flag convention after audit.

Acceptance criteria

Removing any one required gate prevents the write.

Validation

Table-driven negative tests covering each missing gate individually.

R-006 — Google Workspace create and mutation lanes

The Google adapter must provide bounded capabilities for:

Docs creation and supported document mutation;

Sheets workbook/range creation and supported range mutation;

Slides presentation creation and supported element/slide mutation.

Mutation contracts must use provider-supported structured operations rather than attempting UI automation.

Acceptance criteria

For each artifact type:

create produces a provider artifact;

Entity registers it;

stable Entity link resolves;

provider link opens;

supported structured mutation changes the intended content;

resulting provider revision is captured;

unsupported mutation shapes are rejected before execution.

Validation

Adapter contract tests.

Sandbox Google integration tests.

Browser open-link proof.

Revision conflict test.

Idempotent create retry test.

R-007 — Google Shared Drive and destination support

Google creation/discovery must support destinations approved by policy, including designated Shared Drive destinations where the authenticated deployment is eligible.

The implementation must not assume My Drive as the universal destination.

Acceptance criteria

Destination picker/configuration distinguishes approved destinations.

Create request resolves one explicit destination.

Unauthorized Shared Drive destination fails without fallback to another location.

Validation

Destination-policy integration tests.

Sandbox proof against at least one supported destination configuration.

R-008 — Google change tracking

Entity must update provider metadata after changes made outside Entity.

Preferred mechanism:

supported provider change notification/watch;

polling reconciliation fallback.

The implementation must tolerate duplicate and delayed notifications.

Acceptance criteria

External edit advances Entity's known revision.

Duplicate notification does not duplicate versions/activity.

Lost notification is recovered by polling/reconciliation.

Change-tracking failure exposes degraded health rather than silently freezing metadata indefinitely.

Validation

Duplicate event test.

Out-of-order event test.

Poll reconciliation test.

Simulated webhook/watch expiration test.

R-009 — Google preview and open behavior

Entity may preview Google artifacts where supported and reliable.

Full human editing uses Edit in Google.

Embedding must remain unsupported unless independently proven.

Acceptance criteria

Preview failure does not remove the provider open action.

Edit action opens the correct provider artifact.

UI never labels a preview as a full Entity-native editor.

Validation

Browser visual proof.

Provider-link test.

Preview failure test.

R-010 — Microsoft tenant-aware authentication

Microsoft integration must support Entra-based user/admin authorization and bind each connection to the intended Microsoft tenant.

Implementation must validate the current provider documentation before fixing exact scopes or consent semantics.

Acceptance criteria

Connection record identifies the tenant binding without storing raw credentials.

Cross-tenant artifact operations are rejected.

Revoked authorization transitions to degraded/reauthorization state.

Admin-consent-required state is visible and actionable.

Validation

Tenant mismatch test.

Revocation test.

Auth callback/CSRF tests.

Sandbox tenant proof.

R-011 — Microsoft OneDrive/SharePoint destination model

The Microsoft adapter must support permitted OneDrive and/or SharePoint document-library destinations according to workspace policy.

Acceptance criteria

Creation always identifies an allowed destination.

SharePoint site/library identity is retained sufficiently for rediscovery.

An artifact moved or renamed does not automatically become a new Entity document if provider identity remains stable.

Validation

Destination fixture tests.

Rename/move synchronization test.

Sandbox OneDrive/SharePoint proof where available.

R-012 — Microsoft capability truth

The implementation must separate:

provider file operations;

format-aware document mutation;

provider-native human editing;

optional embedding.

No Word, Excel, or PowerPoint structured mutation capability may be marked supported solely because Graph can store the file.

Before enabling each Microsoft mutation capability, engineering must record:

exact documented route or engine used;

authentication requirement;

concurrency semantics;

known format limitations;

test fixture proving round-trip behavior.

Acceptance criteria

Unsupported format mutation returns a typed error instead of silently performing an unsafe whole-file overwrite.

Creation and human editing can remain available even when structured agent mutation is unsupported.

Capability responses differ by artifact type where appropriate.

Validation

Microsoft capability ADR.

Contract matrix.

Provider documentation proof captured in implementation evidence.

Negative tests.

R-013 — Microsoft document creation

MVP must support creation of:

one document;

one spreadsheet;

one presentation;

through a Microsoft 365 destination, subject to documented capability truth.

Creation may use different internal format-generation mechanisms by artifact type, but the resulting files must be valid artifacts that open in the corresponding Microsoft editor.

Acceptance criteria

For DOCX/XLSX/PPTX-equivalent Microsoft artifacts:

create succeeds in an approved destination;

file opens in Microsoft 365;

Entity has a stable document object;

metadata, version identity, and provider URL are captured;

no unsupported mutation claim is implied.

Validation

File-open fixture.

Provider sandbox create test.

Browser Edit in Microsoft 365 proof.

R-014 — Microsoft versions, permissions, previews, and changes

Where supported by the authenticated provider APIs, Entity must retrieve and normalize:

version information;

permissions summary;

previews/thumbnails;

change/delta information;

sharing/open links.

Missing support must degrade capability state rather than produce fabricated data.

Acceptance criteria

Version update is reflected in Entity after provider change.

Permissions shown are explicitly a summary, not represented as a full ACL unless Entity has complete evidence.

Preview unavailable state is distinct from document unavailable state.

Validation

Adapter fixtures.

Provider change test.

Visual state proof.

R-015 — Office-for-web/WOPI remains proof-gated

Entity must not expose an embedded Microsoft editor unless technical eligibility and licensing have both been proven and recorded.

Acceptance criteria

Default embed_editor capability is unsupported or unknown.

Absence of embedding does not block Edit in Microsoft 365.

Validation

Capability default test.

Browser action test.

ADR if the capability is ever enabled.

R-016 — Provider-neutral local Office engine

Local editing and structured mutation must use a local engine interface rather than binding Entity's document layer directly to a specific third-party product.

Proposed interface:

interface LocalOfficeEngine {
probe(): Promise<EngineReadiness>;

open(input: OpenArtifactInput): Promise<OpenArtifactResult>;

inspect(input: InspectArtifactInput): Promise<ArtifactStructure>;

mutate(input: MutateArtifactInput): Promise<MutationResult>;

save(input: SaveArtifactInput): Promise<SaveResult>;

close?(input: CloseArtifactInput): Promise<void>;
}

The exact interface may change during implementation but must preserve the adapter boundary.

Acceptance criteria

Local document logic can use a fake engine in tests.

Selected engine can be replaced without changing the canonical document schema.

Engine-specific implementation details do not leak into provider-neutral agent contracts.

Validation

Interface/adapter unit tests.

Fake-engine integration tests.

Architecture review.

R-017 — Local engine spike and ADR

Before selecting the local engine, compare at minimum:

GenOffice local API/desktop bridge;

maintained embeddable/editor candidates such as ONLYOFFICE or Univer where applicable;

installed desktop application bridge strategies.

Evaluate:

DOCX/XLSX/PPTX fidelity;

structured agent mutation;

headless operation;

human editing experience;

save/reopen behavior;

offline operation;

licensing;

distribution model;

supported operating systems;

maintenance status;

security boundary;

file access model;

API stability;

performance;

bundle/runtime cost;

crash recovery;

ability to remain behind an Entity adapter.

Acceptance criteria

ADR records:

candidates;

measured evidence;

rejected candidates and reasons;

selected approach or decision to defer;

unresolved risks;

licensing evidence;

fidelity fixture results.

Validation

Independent review of the ADR before implementation of the production engine.

R-018 — Local bridge security

The local bridge must not be a general filesystem API.

Required controls:

bind only to the intended local interface or approved platform IPC;

authenticated handshake;

short-lived/expiring authorization;

Entity-origin binding or equivalent caller authentication;

request anti-replay protection;

explicit document allowlist;

document IDs/file-source references instead of caller-supplied arbitrary paths;

path canonicalization;

symlink/path-traversal defenses;

operation allowlist;

request size limits;

sanitized logs;

no raw long-lived secret returned to browser JavaScript;

bridge shutdown/revocation;

explicit readiness state.

Acceptance criteria

Attempts to:

open arbitrary filesystem paths;

use expired tokens;

call from an untrusted origin;

escape an allowed directory;

reuse a revoked bridge session;

must fail.

Validation

Dedicated bridge security test suite.

R-019 — Local readiness UX

Local human-edit capability must distinguish at least:

ready
bridge_not_installed
bridge_not_running
engine_unavailable
file_unavailable
permission_denied
version_conflict
degraded

Browser-only users with no usable bridge must see a truthful unavailable/install/launch state.

Acceptance criteria

No local Edit action appears functional when the runtime cannot complete it.

Validation

Browser and Electron E2E state matrix.

R-020 — Local file storage and File Sources

Local Office artifacts must use Entity File Sources or another audited workspace-managed local storage layer.

Entity document APIs must operate on managed file references, not arbitrary client-provided filesystem paths.

Acceptance criteria

local document registration has a managed storage reference;

deleting/moving a file outside Entity produces an explicit unavailable state;

file watcher changes update revision metadata.

Validation

filesystem integration test;

move/delete test;

watcher test;

restart/recovery test.

R-021 — Local save safety

Local writes must use a failure-safe replacement procedure appropriate to the supported OS/filesystem.

Minimum semantics:

inspect current revision;

reject stale write;

produce candidate output separately;

validate candidate file;

retain required recovery state;

replace original atomically where supported;

reopen/reinspect final artifact;

record new revision.

Acceptance criteria

Process interruption before replacement must not corrupt the existing valid artifact.

Process interruption after replacement must leave either the new valid artifact or a recoverable previous version.

Validation

Crash-injection tests at save stages.

R-022 — Local format sequence

Implementation sequence is locked:

DOCX

XLSX

PPTX

DOCX must achieve create/open/edit/save/reopen plus supported agent mutation before XLSX is considered complete.

XLSX must meet equivalent spreadsheet-specific requirements before PPTX is considered complete.

Validation

Release gates corresponding to each format.

R-023 — Agent document tools

Provider-neutral tools must cover at minimum:

document.create
document.read
document.revise
spreadsheet.range.update
presentation.slide.update

Exact registered tool naming may conform to existing Entity conventions.

Each write tool must accept:

target document or creation context;

operation payload;

expected revision for updates;

idempotency key or Entity operation ID;

optional association context;

confirmation evidence when policy requires it.

Each tool returns:

Entity document ID;

stable Entity URL;

provider;

resulting revision;

capability result;

operation/receipt correlation ID;

typed warning or degraded information.

Acceptance criteria

An agent can execute the MVP creation matrix without provider-specific UI automation.

Validation

Agent-tool contract suite and end-to-end fixtures.

R-024 — Revision-aware mutation

All mutations must participate in the Revision Coordinator.

A provider-specific token may be:

revision ID;

ETag;

change token;

content hash/local revision;

another provider-documented concurrency token.

If the adapter cannot establish a safe current revision, write capability must degrade or require a separately proven safe strategy.

Acceptance criteria

A known stale write never succeeds silently.

Validation

Concurrency tests with two independent writers for each implemented mutation lane.

R-025 — Standard conflict response

Provider-neutral API conflict response:

{
"error": {
"code": "STALE_REVISION",
"message": "The document changed after this operation was prepared.",
"documentId": "doc_...",
"expectedRevision": "rev_17",
"currentRevision": "rev_18",
"retryable": true
}
}

No automatic blind retry is allowed.

Acceptance criteria

Conflict response does not contain document secrets or provider credentials and does not overwrite current data.

R-026 — Idempotent creation/retry behavior

Create operations must include an Entity operation or idempotency key.

If provider creation succeeds but Entity times out before final persistence, retry must reconcile before creating another artifact.

Acceptance criteria

Simulated timeout after provider success followed by retry yields one business artifact.

Validation

Fault-injection integration test.

R-027 — Activity and version attribution

Entity must maintain a durable normalized activity trail.

Actor classifications:

human
agent
provider_external_actor
local_external_actor
system
unknown

If exact provider actor identity is unavailable, Entity must use an honest coarse classification.

Acceptance criteria

Activity identifies:

document;

operation type;

actor class;

known actor ID where valid;

old/new revision where applicable;

provider;

timestamp;

success/failure;

correlation/receipt ID where applicable.

Validation

Activity unit/integration tests.

R-028 — Execution receipts

Every agent mutation must produce or link to the canonical Entity low-level execution receipt system.

The provider artifact itself is not sufficient proof.

Acceptance criteria

An auditor can traverse:

Entity task/agent action
->
execution receipt
->
document operation
->
document version/revision
->
provider/local artifact
Validation

Receipt linkage integration test.

R-029 — Search and indexing

Managed documents must participate in existing Entity search/indexing where supported.

Index state must be tracked independently from provider modified time.

Acceptance criteria

successful document changes invalidate or refresh search state;

indexing failure does not falsely mark the provider write as failed;

UI can identify stale/degraded indexing where relevant.

Validation

Search refresh integration test.
Index failure/retry test.

R-030 — Work-object associations

A document may be associated with Entity workspace/project/task/File Source objects using existing association conventions where possible.

Associations are Entity-owned metadata and must not depend on provider folders.

Acceptance criteria

Moving a provider document does not remove its task/project association.

Validation

Move/rename association regression test.

R-031 — Secrets and credentials

Provider tokens and local bridge secrets must use the existing audited secret mechanism or a new dedicated secret-reference layer if none exists.

Document records may hold secret_ref-style opaque references only where required.

Raw secrets must never appear in:

SQLite document metadata;

activity events;

receipts;

logs;

API responses;

error bodies;

screenshots;

Linear issues;

support diagnostics.

Validation

secret-redaction tests;

log snapshot tests;

database inspection test;

API response inspection;

CI grep/check for fixture secrets where appropriate.

R-032 — Least privilege and revocation

Cloud integrations must request only scopes needed for enabled capabilities.

Write authorization must not be required for read-only configurations.

Disconnect/revocation must:

prevent future writes;

preserve Entity metadata according to retention policy;

update connection readiness;

avoid silently deleting business records.

Validation

Read-only auth test.
Revocation test.
Post-revocation write negative test.

R-033 — Rate limiting and provider resilience

Adapters must implement provider-appropriate:

bounded retries;

exponential backoff with jitter or equivalent;

Retry-After handling where available;

concurrency bounds;

idempotency;

retry classification.

Do not retry:

stale-revision conflicts;

authorization denial;

unsupported capability;

invalid requests;

as if they were transient network errors.

Validation

Fault-classification unit suite.

R-034 — Preview and thumbnail state

Preview state is distinct from document readiness.

Minimum states:

not_requested
pending
ready
unsupported
failed
stale
Acceptance criteria

A failed preview does not make a valid document appear deleted or inaccessible.

Validation

UI and API state tests.

R-035 — Provider disconnect and degraded modes

Entity must model connection health separately from artifact existence.

Minimum auth/readiness states:

ready
reauthorization_required
admin_consent_required
permission_denied
rate_limited
provider_unavailable
configuration_required
degraded

Local mode adds bridge/engine-specific readiness.

Validation

Provider error mapping tests and visual state matrix.

R-036 — Database migration safety

The unified model must be introduced without destructively deleting existing Google V1 data during initial rollout.

Migration strategy must provide:

additive schema;

backfill or lazy registration;

compatibility period;

parity validation;

cutover;

rollback path.

Acceptance criteria

Rolling application code back during the compatibility period does not require recovering dropped legacy data.

Validation

Migration-up test.
Application rollback test.
Migration on representative populated fixture.

R-037 — Feature flags

Writes and high-risk provider behavior must be independently reversible.

At minimum the implementation must have equivalent control over:

unified registry rollout;

Google writes;

Microsoft integration;

local bridge;

local XLSX;

local PPTX;

any experimental provider editor embedding.

Exact names must conform to the repository's audited flag framework.

Acceptance criteria

Operations can disable a specific write lane without deleting document records or disabling all reads.

R-038 — Telemetry and diagnostics

Operational telemetry must distinguish:

provider;

artifact type;

operation;

success/failure;

latency;

retry count;

conflict;

auth failure;

quota/throttling;

preview failure;

indexing failure;

bridge readiness;

reconciliation lag.

Telemetry must not contain document bodies or secrets by default.

Validation

Observability test in sandbox and sanitized logging review.

R-039 — Exact-SHA release proof

The sandbox deployment used for release verification must run the exact reviewed commit SHA.

Acceptance criteria

Deployment evidence identifies:

reviewed SHA;

CI result;

sandbox deployed SHA;

live verification result.

Mismatched SHAs block approval.

R-040 — Production approval gate

No production promotion occurs without explicit Henry approval after review, CI, sandbox deployment, and live verification.

This is delivery mechanics, not an end-user product capability.

9. UX and Content States
9.1 Entity document page

The canonical Entity document page should expose:

Header

title;

artifact-type icon;

provider;

ownership/location summary;

readiness;

last modified time;

stable Entity identity.

Primary actions

Capability-driven:

Preview

Edit in Google

Edit in Microsoft 365

Open locally

Launch local bridge

Install local bridge

Retry

Reconnect

Resolve conflict

Do not show a generic Edit action that routes to incompatible behavior without explanation.

9.2 Provider badge

Examples:

Google Workspace
Microsoft 365
Local Office

Provider label communicates storage/editor context, not canonical Entity ownership.

9.3 Permission summary

UI may show:

Private
Workspace-shared
Organization-shared
Link-shared
External sharing detected
Unknown

Only values actually derivable from provider evidence may be displayed.

9.4 Write-disabled state

Example content:

Editing from Entity is disabled for this Google connection. You can still preview or open the document in Google.

The UI must not tell the user the provider itself is read-only when only Entity's integration policy is read-only.

9.5 Provider auth loss

Example:

Microsoft 365 needs to be reconnected before Entity can update this document.

Existing metadata remains visible according to normal permissions.

9.6 Local bridge missing

Example:

Local Office editing requires the Entity desktop bridge on this computer.

Actions:

Install

Launch bridge

Open read-only preview where available

9.7 Conflict

Conflict must interrupt the write workflow.

Example:

This document changed after your edit started. Reload the latest version before saving.

Actions may include:

View latest

Review changes

Retry from latest

Do not provide Overwrite anyway in MVP unless a later approved requirement defines explicit force-write semantics.

9.8 Unsupported capability

Example:

Entity can open this presentation in Microsoft 365, but structured slide editing by agents is not enabled for this connection.

This is preferable to hiding why an action is missing.

9.9 Activity

Activity distinguishes:

Entity human edit;

Entity agent edit;

provider-side change;

local external change;

system reconciliation;

conflict detected;

connection health transition.

9.10 Document settings/provider settings

Settings surface must expose, where applicable:

provider connection;

connection health;

tenant;

authorization mode;

allowed destinations;

default destinations by artifact type if configured;

write mode;

confirmation policy;

granted-capability summary;

reconnect;

disconnect;

diagnostics;

local bridge readiness;

local engine status.

Raw token/scopes detail should be shown only in safe administrative form.

10. Technical Design
10.1 Proposed components
Document Registry

Responsibilities:

canonical Entity identity;

provider identity mapping;

document metadata;

associations;

state transitions.

Provider Adapter Registry

Resolves:

google_workspace
microsoft_365
local_office

to adapter implementations.

Capability Resolver

Combines:

provider baseline;

artifact type;

authenticated connection;

destination;

policy;

runtime;

degraded state.

Destination Policy Service

Resolves where creation is allowed.

Revision Coordinator

Owns mutation preconditions and stale-write rejection.

Preview Service

Normalizes preview/thumbnail readiness without treating preview as authoritative document content.

Change Reconciler

Consumes provider notifications/polls/local file watcher changes and updates metadata idempotently.

Activity/Audit Adapter

Writes normalized document activity and integrates with existing Entity execution receipts.

Search Integration

Invalidates/reindexes changed documents using existing indexing infrastructure.

Local Bridge

Provides constrained local-machine access for approved managed documents.

Local Office Engine Adapter

Encapsulates the chosen editor/generator/mutation implementation.

10.2 Proposed provider adapter contract

interface DocumentProviderAdapter {
provider: "google_workspace" | "microsoft_365" | "local_office";

resolveCapabilities(
context: CapabilityContext
): Promise<ResolvedCapabilitySet>;

discover(
input: DiscoverDocumentsInput
): Promise<DiscoverDocumentsResult>;

getMetadata(
input: GetDocumentMetadataInput
): Promise<ProviderDocumentMetadata>;

create(
input: CreateDocumentInput
): Promise<CreateDocumentResult>;

read(
input: ReadDocumentInput
): Promise<ReadDocumentResult>;

mutate(
input: MutateDocumentInput
): Promise<MutateDocumentResult>;

getVersions?(
input: GetVersionsInput
): Promise<GetVersionsResult>;

getPreview?(
input: GetPreviewInput
): Promise<GetPreviewResult>;

getPermissions?(
input: GetPermissionsInput
): Promise<GetPermissionsResult>;

getOpenTarget(
input: OpenTargetInput
): Promise<OpenTargetResult>;

reconcileChanges(
input: ReconcileChangesInput
): Promise<ReconcileChangesResult>;
}

Not every adapter method implies every capability is supported. Capability resolution remains authoritative.

11. Data Model
11.1 Proposed document_objects

CREATE TABLE document_objects (
id TEXT PRIMARY KEY,

workspace_id TEXT NOT NULL,

provider TEXT NOT NULL
CHECK (provider IN (
'google_workspace',
'microsoft_365',
'local_office'
)),

artifact_type TEXT NOT NULL
CHECK (artifact_type IN (
'document',
'spreadsheet',
'presentation'
)),

title TEXT NOT NULL,

provider_connection_id TEXT,
destination_id TEXT,

external_id TEXT,
provider_url TEXT,

owner_summary TEXT,
tenant_external_id TEXT,

permissions_summary_json TEXT,
sensitivity_label TEXT,

auth_state TEXT NOT NULL,
readiness_state TEXT NOT NULL,
degraded_reason_code TEXT,

current_revision TEXT,
provider_modified_at TEXT,
indexed_at TEXT,

preview_state TEXT NOT NULL DEFAULT 'not_requested',

conflict_state TEXT NOT NULL DEFAULT 'none',

created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
deleted_at TEXT
);

Exact SQLite types/check constraints must follow repository conventions.

Required uniqueness semantics:

(provider_connection_id, external_id)

must be unique when external_id is non-null unless provider identity semantics prove a different compound key is required.

For local artifacts, the durable managed file identity must supply equivalent uniqueness.

11.2 Proposed document_associations

CREATE TABLE document_associations (
document_id TEXT NOT NULL,
object_type TEXT NOT NULL,
object_id TEXT NOT NULL,
created_at TEXT NOT NULL,

PRIMARY KEY (document_id, object_type, object_id)
);

Reuse an existing generic Entity association layer instead if repository audit proves it already provides the required semantics.

11.3 Proposed document_versions

CREATE TABLE document_versions (
id TEXT PRIMARY KEY,
document_id TEXT NOT NULL,

provider_revision TEXT NOT NULL,
provider_version_id TEXT,
etag TEXT,
change_token TEXT,
content_hash TEXT,

actor_type TEXT NOT NULL,
actor_id TEXT,

source TEXT NOT NULL,

snapshot_ref TEXT,

provider_modified_at TEXT,
observed_at TEXT NOT NULL,

metadata_json TEXT
);

document_versions does not require Entity to duplicate every provider byte version. snapshot_ref may be null for cloud versions where the provider is authoritative.

Retention policy remains an open question.

11.4 Proposed document_events

CREATE TABLE document_events (
id TEXT PRIMARY KEY,
document_id TEXT NOT NULL,

event_type TEXT NOT NULL,

actor_type TEXT NOT NULL,
actor_id TEXT,

provider TEXT NOT NULL,

operation_id TEXT,
receipt_id TEXT,
idempotency_key TEXT,

before_revision TEXT,
after_revision TEXT,

status TEXT NOT NULL,

reason_code TEXT,
sanitized_metadata_json TEXT,

created_at TEXT NOT NULL
);

If existing audit/event infrastructure already supports these requirements, adapt to it instead of introducing redundant persistence.

11.5 Proposed provider_connections

Logical requirements:

id
workspace_id
provider
tenant_external_id
auth_mode
status
granted_capabilities/scopes summary
secret_reference
sanitized configuration
created_at
updated_at
revoked_at

Raw credentials are prohibited.

11.6 Proposed provider_destinations

Logical requirements:

id
connection_id
workspace_id
provider
artifact_type or wildcard
destination_kind
external_id or local managed-storage identity
display_name
write_mode
confirmation_policy
enabled

11.7 Capability storage

Capabilities should primarily be resolved, not permanently trusted from an old snapshot.

A cached/snapshotted capability set may be stored for:

UI diagnostics;

audit;

latency;

operation receipts.

Every write must still account for current:

policy;

auth;

destination;

runtime readiness;

known provider degradation.

12. API Contracts

Exact route names must be reconciled with existing Express conventions. The following contracts are normative; route spelling is proposed.

12.1 Get document

GET /api/documents/

Example response:

{
"document": {
"id": "doc_01J...",
"url": "/documents/doc_01J...",
"title": "Q3 Operating Plan",
"provider": "google_workspace",
"artifactType": "document",
"providerUrl": "https://...",
"owner": {
"summary": "Curacel Workspace"
},
"readiness": {
"state": "ready"
},
"revision": "rev-provider-value",
"modifiedAt": "2026-08-09T05:51:20Z",
"indexedAt": "2026-08-09T05:52:02Z",
"preview": {
"state": "ready"
},
"capabilities": {
"read": {
"state": "supported",
"source": "adapter"
},
"human_edit": {
"state": "supported",
"source": "adapter"
},
"agent_text_mutation": {
"state": "unsupported",
"reasonCode": "WRITE_POLICY_DISABLED",
"source": "policy"
}
}
}
}

12.2 Create document

POST /api/documents

Request:

{
"artifactType": "document",
"title": "Q3 Operating Plan",
"provider": "google_workspace",
"destinationId": "dest_01J...",
"idempotencyKey": "op_01J...",
"initialContent": {
"kind": "structured_document",
"blocks": [
{
"type": "heading",
"text": "Q3 Operating Plan"
}
]
},
"associations": [
{
"type": "project",
"id": "project_123"
}
]
}

Response:

{
"documentId": "doc_01J...",
"entityUrl": "/documents/doc_01J...",
"provider": "google_workspace",
"revision": "provider-revision",
"operationId": "op_01J...",
"receiptId": "receipt_01J..."
}

Errors include:

PROVIDER_NOT_CONNECTED
WRITE_DISABLED
DESTINATION_REQUIRED
DESTINATION_NOT_ALLOWED
CAPABILITY_UNSUPPORTED
ADMIN_CONSENT_REQUIRED
AUTHORIZATION_REQUIRED
PROVIDER_RATE_LIMITED
PROVIDER_UNAVAILABLE
CREATE_RECONCILIATION_REQUIRED

12.3 Mutate document

POST /api/documents//mutations

Request:

{
"expectedRevision": "rev_17",
"idempotencyKey": "op_01J...",
"operation": {
"kind": "replace_text",
"target": {
"anchor": "section"
},
"content": "Updated executive summary."
}
}

Response:

{
"documentId": "doc_01J...",
"previousRevision": "rev_17",
"revision": "rev_18",
"operationId": "op_01J...",
"receiptId": "receipt_01J..."
}

Conflict:

409 Conflict
{
"error": {
"code": "STALE_REVISION",
"message": "The document changed after this operation was prepared.",
"documentId": "doc_01J...",
"expectedRevision": "rev_17",
"currentRevision": "rev_18",
"retryable": true
}
}

12.4 Spreadsheet range mutation

{
"expectedRevision": "rev_25",
"idempotencyKey": "op_...",
"operation": {
"kind": "set_range",
"sheet": "Forecast",
"range": "B2",
"values": [
[10, 20, 30],
[40, 50, 60]
]
}
}

The adapter must reject this shape if the active engine cannot safely perform structured range mutation.

12.5 Presentation mutation

{
"expectedRevision": "rev_9",
"idempotencyKey": "op_...",
"operation": {
"kind": "update_slide_text",
"slideRef": "slide_4",
"elementRef": "title",
"text": "Revised market outlook"
}
}

Exact slide/element addressing is adapter/engine dependent and must use stable identifiers whenever supported.

12.6 Capability endpoint

GET /api/documents//capabilities

or an equivalent field on document retrieval.

Responses must include reason codes.

12.7 Versions

GET /api/documents//versions

Response:

{
"versions": [
{
"revision": "rev_18",
"actorType": "agent",
"actorId": "agent_...",
"observedAt": "2026-08-09T06:10:00Z",
"providerModifiedAt": "2026-08-09T06:09:58Z"
}
]
}

13. Events

Normalized internal event names should cover at least:

document.registered
document.created
document.updated
document.external_changed
document.version_observed
document.permissions_changed
document.preview_ready
document.preview_failed
document.indexed
document.index_failed
document.conflict_detected
document.connection_degraded
document.connection_restored
document.bridge_state_changed

Consumers must tolerate at-least-once delivery or repeated reconciliation.

Event ordering from external providers must not be assumed.

14. Google Migration Strategy
14.1 Phase A — Add unified structures

introduce additive unified document persistence;

introduce adapter/capability abstractions;

do not modify Google mutation behavior.

14.2 Phase B — Map existing Google records

Existing Google read/index/link/preview records are mapped into the unified document identity layer.

Mapping must preserve:

provider identity;

provider URL;

title;

read-only state;

preview behavior;

search associations;

existing permissions semantics.

14.3 Phase C — Dual compatibility

During migration:

new reads use unified document object when present;

unmigrated legacy Google data remains readable through a compatibility path;

write capabilities remain disabled.

Do not destructively remove legacy data during this period.

14.4 Phase D — Verify parity

Required proof:

same documents discoverable;

stable links resolve;

preview still works;

search results remain valid;

old negative write tests pass.

14.5 Phase E — Enable Google write lane selectively

Only after:

explicit feature flag;

admin authorization UI;

provider scopes reviewed;

destination configured;

write policies tested;

negative write tests pass;

sandbox proof passes.

14.6 Rollback

Disabling Google writes must immediately restore effective read-only behavior without requiring schema rollback.

Application rollback must remain possible while additive schema remains present.

Destructive cleanup is a later migration and is not part of MVP.

15. Microsoft 365 Design
15.1 Connection

Connection must track:

Entity workspace;

Microsoft tenant;

consent/readiness;

safe capability/scopes summary;

secret reference.

15.2 Storage

Microsoft artifacts use approved OneDrive or SharePoint destinations.

The destination object must retain enough provider identity to safely rediscover and update artifacts.

15.3 Creation

Creation should use the strongest supported route proven for each format.

If a valid OOXML artifact is generated before upload, the generation engine must itself have format/fidelity tests.

15.4 Mutation

Mutation capability is format-specific.

Engineering must explicitly determine:

Capability	Word	Excel	PowerPoint
Create valid file	Proof required	Proof required	Proof required
Read structure	Proof required	Proof required	Proof required
Structured agent mutation	Proof required	Proof required	Proof required
Provider-native human edit	Proof required	Proof required	Proof required
Version retrieval	Proof required	Proof required	Proof required
Change tracking	Proof required	Proof required	Proof required
Preview	Proof required	Proof required	Proof required
Embedded editor	Proof + licensing required	Proof + licensing required	Proof + licensing required

Do not populate this table from memory during implementation. Record current provider evidence.

16. Local Office Design
16.1 Local artifact identity

Local artifact identity consists of:

Entity document ID;

managed File Source/storage reference;

local immutable/managed file identity where available;

current content hash/revision;

metadata.

The public API must not require arbitrary absolute paths.

16.2 Local bridge protocol

Proposed logical handshake:

Browser/Electron
|
| request local-open capability
v
Entity Server
|
| grants short-lived document-scoped authorization
v
Entity Local Bridge
|
| resolves Entity-managed file ref
| verifies allowlist + revision
v
Local Office Engine

The browser must never provide:

/Users/henry/secret/file.docx

and ask the bridge to open it directly.

It provides an Entity document/file reference that the bridge resolves under policy.

16.3 File watcher

Watcher must detect external local edits and:

debounce repeated filesystem noise;

derive new revision/content hash;

avoid creating duplicate versions for the same bytes;

invalidate preview/indexing;

record external activity;

preserve conflict awareness.

16.4 DOCX milestone

Must prove:

create;

open;

human edit;

save;

reopen;

structured agent mutation;

stale revision rejection;

crash recovery;

no cloud dependency.

16.5 XLSX milestone

Adds spreadsheet-specific fixtures:

values;

formulas;

multiple sheets;

formatting subset;

range mutation;

save/reopen.

Formula recalculation behavior must be documented rather than assumed.

16.6 PPTX milestone

Adds presentation fixtures:

multiple slides;

text elements;

images where supported;

ordering;

slide mutation;

save/reopen.

17. Permissions and Security Model
17.1 Cloud identity

Provider identity is not equivalent to Entity identity.

Entity must maintain a mapping or safe attribution boundary between:

Entity actor;

provider connection;

provider tenant;

provider-side user where observable.

17.2 Workspace isolation

A provider connection and destination belong to an Entity workspace/tenant boundary.

A document operation from Workspace A must not use Workspace B's provider connection.

17.3 OAuth flow controls

Implementation must include provider-appropriate:

state validation;

PKCE where required/appropriate;

redirect URI validation;

tenant binding;

secret storage;

token refresh/revocation;

safe callback errors.

Exact provider requirements must be verified against current provider documentation during implementation.

17.4 Service-account/domain delegation

Google user-consent vs service-account/domain-delegation strategy is a deployment-policy decision.

Neither must become an implicit universal default.

17.5 Conditional access

Microsoft conditional-access failure must map to a typed degraded state rather than generic 500.

17.6 External sharing

Entity must not silently expand provider permissions as a side effect of document creation unless an explicit approved product workflow requires it.

17.7 Local path security

Reject:

../;

non-allowlisted paths;

symlink escape;

unexpected schemes;

null-byte/path parsing attacks;

arbitrary protocol execution.

17.8 Document parser risk

Local OOXML processing is an untrusted-file boundary.

Implementation must:

bound archive expansion;

validate archive paths;

reject ZIP traversal;

bound XML/resource sizes;

avoid automatically executing macros;

avoid executing embedded content.

Macro-enabled formats remain outside MVP.

18. Edge Cases and Failure Modes
ID	Failure	Required behavior
F-001	Provider create succeeds, Entity response times out	Reconcile by idempotency/provider identity before retrying creation.
F-002	Entity DB write fails after provider creation	Persist recoverable operation state where possible; reconciliation must find the orphan.
F-003	Provider artifact deleted externally	Mark unavailable/deleted externally; do not silently recreate.
F-004	Provider artifact renamed	Update metadata; Entity ID remains stable.
F-005	Provider artifact moved	Update destination metadata if permitted; preserve Entity associations.
F-006	OAuth revoked	Fail writes closed and request reauthorization.
F-007	OAuth scopes insufficient	Mark capability degraded/unsupported with explicit reason.
F-008	Microsoft tenant mismatch	Reject operation.
F-009	Google Shared Drive inaccessible	Do not silently fall back to another Drive destination.
F-010	Rate limit	Backoff; preserve typed provider-throttled state.
F-011	Provider outage	Preserve document object; expose degraded state.
F-012	Preview generation fails	Document remains usable if read/open capabilities remain available.
F-013	Indexing fails	Provider write remains successful; indexing retries separately.
F-014	Duplicate provider event	Idempotent handling.
F-015	Out-of-order provider events	Never regress known revision blindly. Reconcile current provider state.
F-016	Agent writes stale revision	409 STALE_REVISION; no overwrite.
F-017	Human edits provider while agent prepares mutation	Agent mutation fails stale check.
F-018	Local bridge absent	Explicit unavailable/install state.
F-019	Local bridge dies during edit	Preserve last valid document and surface degraded state.
F-020	Local file manually replaced	New revision detected; validate format before treating it as editable.
F-021	Local file deleted	Mark unavailable; preserve Entity metadata/history.
F-022	Local path escapes managed storage	Reject.
F-023	Engine corrupts candidate output	Candidate fails validation and original remains untouched.
F-024	Local disk full	Abort safely without destroying original.
F-025	Local editor locks file	Surface busy/degraded state; bounded retry only where safe.
F-026	Permission changes externally	Refresh summary and affected capabilities.
F-027	Exact provider actor unavailable	Record external/unknown actor honestly.
F-028	Provider API reports unknown revision	Degrade write capability until safe concurrency strategy exists.
F-029	Capability changes after page load	Server re-resolves on mutation; stale client capability cannot authorize write.
F-030	Feature flag disabled mid-operation	In-flight behavior follows an explicitly defined transaction boundary; subsequent operations fail closed.
F-031	Connection disconnected	Metadata preserved; future provider operations disabled.
F-032	Malformed Office archive	Reject safely without parser resource exhaustion.
19. Tests, Evals, and Proof Requirements
19.1 Unit tests

Required:

capability resolution;

destination policy;

provider error normalization;

conflict detection;

revision comparison;

idempotency;

permissions normalization;

redaction;

readiness state mapping;

local path validation;

archive security;

event dedupe;

activity attribution.

19.2 Provider contract tests

Every adapter must run against the same provider-neutral contract fixture.

Example contract:

register/discover
metadata
create when supported
read when supported
mutate when supported
unsupported mutation rejection
revision capture
stale-write rejection
preview normalization
permission normalization
open target
connection degradation
idempotent reconciliation

Unsupported capability is a valid contract outcome. Lying about support is not.

19.3 Google regression suite

Must retain proof that V1 remains read-only while the write gate is disabled.

Negative cases:

create;

update;

write;

export if prohibited by existing posture;

sync/mutation;

agent mutation;

direct API bypass attempt.

19.4 Microsoft proof suite

Use a non-production test tenant/destination.

Prove independently:

auth;

tenant binding;

storage;

each create format;

each enabled mutation capability;

open-in-Microsoft;

version retrieval;

conflict behavior;

throttling response;

revocation.

19.5 Local fidelity fixtures

Maintain committed safe fixtures covering:

DOCX

paragraphs;

headings;

lists;

tables;

basic styling;

images if MVP engine claims them.

XLSX

values;

formulas;

sheets;

ranges;

basic formats.

PPTX

slides;

text;

basic images/layout where supported.

Tests compare semantic preservation rather than demanding byte identity.

19.6 Crash tests

Inject failure:

before candidate write;

during candidate write;

before replacement;

immediately after replacement;

before metadata update.

At no point may the only valid user copy be silently lost.

19.7 Browser E2E

Required states:

Google ready;

Google writes disabled;

Google reconnect;

Microsoft ready;

Microsoft unsupported mutation;

Microsoft admin consent required;

preview failure;

conflict;

local bridge absent;

local bridge ready.

19.8 Electron E2E

Required:

bridge probe;

open local DOCX;

save;

revision capture;

stale conflict;

file unavailable;

bridge restart.

XLSX/PPTX cases are added before their gates are enabled.

20. Cross-Provider MVP Acceptance Matrix
Workflow	Google	Microsoft	Local Office
Stable Entity identity	Required	Required	Required
Human create	Required	Required	DOCX required; XLSX/PPTX staged
Agent create document	Required	Required	DOCX required
Agent create spreadsheet	Required	Required	Before 3-format completion
Agent create presentation	Required	Required	Before 3-format completion
Preview	Capability-aware	Capability-aware	Capability-aware
Human edit	Open Google	Open M365	Local editor/engine
Structured text mutation	Required bounded lane	Capability-proof-driven	DOCX required
Structured range mutation	Required bounded lane	Capability-proof-driven	XLSX milestone
Structured slide mutation	Required bounded lane	Capability-proof-driven	PPTX milestone
Versions/activity	Required	Required	Required
Conflict rejection	Required	Required	Required
Auth/bridge degraded state	Required	Required	Required
Search/associations	Required	Required	Required
21. Production QA Gate

A release candidate is not production-ready until all applicable gates pass.

Gate 1 — Clean source

Implementation is performed in an isolated clean worktree created from the intended origin/main base.

The dirty /Users/enterprise/Code/Entity checkout must not be absorbed.

Gate 2 — Automated proof

unit tests pass;

adapter contract tests pass;

migrations pass;

existing Google read-only regression tests pass;

security negative tests pass;

browser/Electron tests pass for enabled surfaces.

Gate 3 — Independent review

Reviewer checks:

capability honesty;

auth boundaries;

revision safety;

secret leakage;

migration rollback;

provider-specific assumptions;

local bridge attack surface.

Gate 4 — Exact reviewed SHA

CI identifies the reviewed SHA.

Gate 5 — Sandbox

Sandbox deploys that exact SHA.

Gate 6 — Live verification

Smoke tests run against the deployed SHA.

Gate 7 — Approval

Henry explicitly approves production promotion.

No approval means no production promotion.

22. Rollout
Phase 0 — Audit and architecture

No user-visible mutation change.

Outputs:

clean worktree;

current-state audit;

capability ADR;

database migration plan;

local-engine spike plan;

provider documentation evidence.

Phase 1 — Unified document registry

Introduce:

canonical model;

capability resolver;

provider-neutral APIs;

existing Google read-path mapping;

UI provider/readiness model.

Google remains read-only.

Phase 2 — Google V2 writes

Behind disabled-by-default write gate:

admin authorization;

destination policies;

Docs create/mutate;

Sheets create/range mutate;

Slides create/mutate;

change tracking;

conflict handling.

Phase 3 — Microsoft 365

Introduce:

tenant auth;

destination policies;

OneDrive/SharePoint;

create;

open/edit links;

versions/permissions/change tracking;

only proven structured mutations.

Phase 4 — Local bridge + DOCX

Introduce:

local-engine ADR result;

secure bridge;

File Source integration;

DOCX create/open/edit/save/reopen;

agent mutation;

version capture;

conflict handling.

Phase 5 — Local XLSX

Enable only after format acceptance suite passes.

Phase 6 — Local PPTX

Enable only after format acceptance suite passes.

Phase 7 — Broader rollout

Only after telemetry and operational results show acceptable reliability.

23. Rollback Strategy
23.1 Emergency write rollback

Disable the relevant provider write gate.

Result:

reads remain;

existing document records remain;

stable Entity URLs remain;

mutations stop.

23.2 Google rollback

Return to effective V1 read-only behavior without removing unified registry metadata.

23.3 Microsoft rollback

Disable Microsoft creation/mutation while leaving registered metadata available according to connection/read capability.

23.4 Local rollback

Disable bridge mutation/open functionality while preserving managed files and document metadata.

Never delete user Office files as part of feature rollback.

23.5 Database rollback

Initial migrations are additive.

Do not drop legacy fields/tables required by the previous application version during MVP rollout.

Destructive cleanup requires a later migration after:

production soak;

backup;

parity verification;

explicit approval.

24. Observability
24.1 Metrics

At minimum:

document_operations_total
document_operation_latency
document_operation_failures
document_conflicts_total
provider_auth_failures
provider_throttle_events
provider_retry_count
provider_reconciliation_lag
preview_failures
indexing_failures
local_bridge_ready
local_bridge_failures
local_save_recovery_events

Dimension cardinality must remain bounded.

Safe dimensions include:

provider;

artifact type;

operation type;

result/reason category.

Do not use document title or document body as metric dimensions.

24.2 Logs

Every operation should include:

operation ID;

document ID where available;

provider;

artifact type;

sanitized reason code;

receipt correlation where applicable.

Never include raw document bodies by default.

24.3 Diagnostics

Admin diagnostics should answer:

Is the provider connected?

Which tenant?

Which capability failed?

Is write policy enabled?

Is destination valid?

Was the request throttled?

Is the local bridge reachable?

Is indexing stale?

Is reconciliation lagging?

25. Traceability Matrix
Requirement	Primary design surface	Validation/proof
R-001	Document Registry / DB	uniqueness + rediscovery tests
R-002	Capability Resolver	capability matrix tests
R-003	Destination Policy	policy negative tests
R-004	Google migration	existing Google negative suite
R-005	Google write gate	table-driven gate tests
R-006	Google adapter	sandbox adapter tests
R-007	Google destinations	destination tests
R-008	Change Reconciler	duplicate/lost-event tests
R-009	Document UI	browser proof
R-010	Microsoft auth	tenant/revocation tests
R-011	Microsoft destination	OneDrive/SharePoint tests
R-012	Microsoft capability ADR	provider proof + negative tests
R-013	Microsoft create	Office-open sandbox proof
R-014	Microsoft adapter	version/permission/change tests
R-015	Capability Resolver/UI	embedding-disabled tests
R-016	Local engine interface	fake-engine tests
R-017	Local engine ADR	independent ADR review
R-018	Local Bridge	security suite
R-019	Local UX	browser/Electron matrix
R-020	File Sources	FS integration tests
R-021	Local save coordinator	crash-injection tests
R-022	Release gates	DOCX/XLSX/PPTX suites
R-023	Agent tools	agent contract E2E
R-024	Revision Coordinator	concurrent-writer tests
R-025	API	conflict contract test
R-026	Operation Coordinator	timeout/idempotency test
R-027	Activity	attribution tests
R-028	Receipt integration	receipt traversal test
R-029	Search	reindex/retry test
R-030	Associations	move/rename test
R-031	Secret service	redaction/DB/log tests
R-032	Provider connections	scope/revocation tests
R-033	Adapter retry layer	failure classification tests
R-034	Preview service	preview-state tests
R-035	Connection health	degraded-state matrix
R-036	DB migrations	upgrade/rollback fixtures
R-037	Feature controls	kill-switch E2E
R-038	Observability	sandbox telemetry proof
R-039	Release process	SHA evidence
R-040	Production gate	explicit approval evidence
26. Build Plan and Execution Graph

The task graph below separates product implementation from release mechanics.

Each task must land with code/tests/evidence independently where practical.

T-001 — Create clean implementation worktree and audit base

Goal/value: Prevent accidental incorporation of the known dirty checkout.

Scope:

create clean isolated worktree from current intended origin/main;

record exact SHA;

inspect listed high-value paths;

identify actual DB, flag, auth, receipts, route, File Source, search, and association conventions.

Non-goals: Feature implementation.

Dependencies: None.

Acceptance:

worktree is clean before changes;

audited SHA recorded;

discrepancies with source packet documented.

Automated proof: Existing baseline test suite relevant to docs passes before feature work.

Manual proof: Audit note with path/contract findings.

Security: Do not copy .env/credentials into artifacts.

Not done until: Unknown repository assumptions in this spec are mapped to concrete current code.

Evidence destination: PR/implementation evidence bundle.

T-002 — Write capability architecture ADR

Goal/value: Prevent provider parity assumptions from spreading.

Scope:

provider adapter contract;

capability vocabulary;

capability state semantics;

degraded/unknown behavior;

capability resolution precedence.

Dependencies: T-001.

Acceptance: D-003 and R-002 fully represented.

Automated proof: Capability resolver test plan exists.

Manual proof: ADR review.

Security: Writes fail closed on unknown.

Not done until: Google/Microsoft/local examples are represented.

Evidence: Repository ADR/docs path selected during audit.

T-003 — Define and migrate unified document persistence

Goal/value: Establish stable Entity document identity.

Scope:

additive schema;

provider identity uniqueness;

version/activity requirements;

migration helpers.

Dependencies: T-001, T-002.

Acceptance: R-001 and R-036.

Automated proof: Empty and populated migration fixtures.

Manual proof: Schema review.

Security: No credential fields.

Not done until: rollback with old application semantics is documented.

Evidence: Migration tests + PR.

T-004 — Implement Document Registry

Goal/value: Centralize canonical document identity.

Scope: create/register/get/update/rediscover.

Dependencies: T-003.

Acceptance: Rediscovery does not duplicate.

Automated proof: Registry unit/integration tests.

Security: workspace isolation.

Not done until: concurrent registration test passes.

T-005 — Implement provider adapter contract and fake adapter

Goal/value: Allow provider-independent development/testing.

Dependencies: T-002, T-004.

Scope: interface plus deterministic fake.

Acceptance: shared contract tests can execute against fake.

Security: unsupported mutation fails closed.

T-006 — Implement Capability Resolver

Goal/value: Make API/UI actions truthful.

Dependencies: T-002, T-005.

Acceptance: provider + connection + destination + policy + runtime resolution works.

Automated proof: matrix tests.

Not done until: unknown mutation is rejected.

T-007 — Implement provider destinations and write policy

Goal/value: Prevent uncontrolled write locations.

Dependencies: T-003, T-006.

Acceptance: R-003.

Automated proof: allowed/denied destination tests.

Security: workspace/tenant isolation.

T-008 — Implement provider-neutral Document API

Goal/value: Give humans/agents a stable API.

Dependencies: T-004–T-007.

Scope: get/create/mutate/versions/capabilities.

Non-goal: Provider-specific implementation.

Acceptance: typed errors and revision requirement implemented.

Automated proof: API contract tests.

T-009 — Implement Revision Coordinator

Goal/value: Eliminate silent stale overwrite.

Dependencies: T-008.

Acceptance: R-024/R-025.

Automated proof: concurrent writer tests.

Security: expected/current revisions sanitized.

Not done until: unsafe provider with no concurrency evidence fails closed.

T-010 — Integrate activity and Entity execution receipts

Goal/value: Preserve attributable proof.

Dependencies: T-008, repository receipt audit.

Acceptance: R-027/R-028.

Automated proof: receipt traversal test.

Non-goal: Replace existing receipt system.

T-011 — Integrate search and associations

Goal/value: Preserve Entity workspace value around artifacts.

Dependencies: T-004.

Acceptance: R-029/R-030.

Automated proof: reindex and provider move tests.

T-012 — Migrate existing Google read path into unified document model

Goal/value: Establish compatibility before writes.

Dependencies: T-003–T-011.

Scope:

map existing Google metadata;

preserve read/index/link/preview;

keep write disabled.

Acceptance: R-004.

Automated proof: existing Google tests plus migration parity suite.

Security: zero provider mutation.

Not done until: negative write tests explicitly prove zero mutation calls.

T-013 — Add Google admin write gate and destination UX

Goal/value: Make write authorization explicit.

Dependencies: T-007, T-012.

Scope:

admin authorization;

destination;

write mode;

confirmation policy;

feature flag.

Acceptance: R-005/R-007.

Automated proof: one-negative-test-per-gate.

Security: broad OAuth scope alone does not enable writes.

T-014 — Implement Google Docs create/mutate

Goal/value: Deliver agent document workflow.

Dependencies: T-013.

Acceptance:

create;

stable Entity URL;

bounded mutation;

revision capture;

conflict rejection.

Automated proof: adapter contract + sandbox.

Manual proof: open document in Google.

T-015 — Implement Google Sheets create/range mutate

Same required task contract as T-014, applied to spreadsheet/range semantics.

Dependencies: T-013, T-009.

Not done until: range targeting and revision behavior pass.

T-016 — Implement Google Slides create/mutate

Same required task contract as T-014, applied to presentation/element semantics.

Dependencies: T-013, T-009.

T-017 — Implement Google change tracking and reconciliation

Goal/value: Keep Entity current after provider-side edits.

Dependencies: T-012.

Acceptance: R-008.

Automated proof: duplicate, delayed, missing notification tests.

T-018 — Implement Google preview/open/permissions states

Dependencies: T-012.

Acceptance: R-009 and permissions-summary honesty.

Manual proof: browser capture/proof.

T-019 — Implement Microsoft Entra connection and tenant binding

Goal/value: Establish secure Microsoft identity.

Dependencies: T-001, T-006.

Scope: auth, admin consent state, tenant validation, secret references.

Acceptance: R-010/R-032.

Automated proof: tenant mismatch + revocation tests.

Security: current provider auth docs must be cited in implementation evidence.

T-020 — Implement Microsoft destination discovery/policy

Dependencies: T-019, T-007.

Scope: OneDrive/SharePoint destination identities.

Acceptance: R-011.

T-021 — Microsoft format capability spike/ADR

Goal/value: Prevent false claims about Word/Excel/PowerPoint mutation.

Dependencies: T-019.

Scope:

file create;

format-specific mutation;

versions;

change tracking;

previews;

open links;

WOPI/editor eligibility.

Acceptance: R-012/R-015 evidence matrix complete.

Automated proof: prototype fixtures where applicable.

Manual proof: current provider documentation/licensing evidence.

Not done until: every enabled capability has an evidence source.

T-022 — Implement Microsoft create lanes

Dependencies: T-020, T-021.

Scope: document, spreadsheet, presentation creation.

Acceptance: R-013.

Automated proof: sandbox tests.

Manual proof: artifacts open successfully in Microsoft 365.

T-023 — Implement proven Microsoft structured mutations

Dependencies: T-021, T-022, T-009.

Scope: Only capabilities supported by ADR evidence.

Acceptance: every enabled mutation passes round-trip and stale-write tests.

Non-goal: Forcing all three formats to use identical mutation mechanisms.

T-024 — Implement Microsoft versions/permissions/change tracking/open

Dependencies: T-019, T-022.

Acceptance: R-014.

Automated proof: adapter fixtures + sandbox.

T-025 — Run local engine comparison spike

Goal/value: Select a defensible local editing architecture.

Dependencies: T-001, T-002.

Scope: R-017 candidate matrix.

Acceptance: ADR with fidelity, licensing, security, maintenance, and implementation recommendation.

Manual proof: open/edit/save/reopen fixture results.

Security: bridge/file access model reviewed.

T-026 — Implement local bridge security skeleton

Dependencies: T-025.

Scope: handshake, readiness, auth, document allowlist, path protections.

Acceptance: R-018/R-019.

Automated proof: bridge attack tests.

Not done until: arbitrary path access tests fail.

T-027 — Integrate local managed storage/File Sources

Dependencies: T-026, T-004.

Acceptance: R-020.

Automated proof: move/delete/restart tests.

T-028 — Implement local version watcher and safe save coordinator

Dependencies: T-027, T-009.

Acceptance: R-021.

Automated proof: watcher dedupe + crash injection + stale save tests.

T-029 — Deliver local DOCX milestone

Dependencies: T-025–T-028.

Scope:

create;

open;

human edit;

save;

reopen;

structured agent mutation;

version/activity;

stable Entity link.

Acceptance: full DOCX fixture gate.

Security: malicious/invalid OOXML tests.

Manual proof: browser/Electron → editor → save → reopen.

T-030 — Deliver local XLSX milestone

Dependencies: T-029.

Acceptance: XLSX format gate including range mutation.

Non-goal: Perfect Excel fidelity.

T-031 — Deliver local PPTX milestone

Dependencies: T-030.

Acceptance: PPTX format gate including supported slide mutation.

T-032 — Implement provider-neutral agent tools

Dependencies: T-008 and at least one implemented write adapter.

Scope: R-023.

Acceptance: same tool contract dispatches to Google, Microsoft, local based on document/provider context.

Automated proof: cross-provider tool tests.

Security: no direct provider credential access by agent.

T-033 — Build canonical document UX

Dependencies: T-006, T-008.

Scope:

provider;

preview;

owner;

permissions/readiness;

activity;

versions;

capability-aware actions;

conflict state.

Acceptance: section 9 UX matrix.

Manual proof: browser screenshots/recording.

T-034 — Build provider administration UX

Dependencies: T-007, T-013, T-019, T-026 as relevant.

Scope: connection health, destination, write mode, diagnostics, local readiness.

Acceptance: no ambiguous write activation.

Security: no raw token display.

T-035 — Add observability and redaction proof

Dependencies: provider implementations.

Acceptance: R-031/R-033/R-038.

Automated proof: sanitized log tests.

T-036 — Cross-provider contract/E2E matrix

Dependencies: all enabled provider milestones.

Scope: Section 20.

Acceptance: every required cell has automated or explicit manual proof.

Evidence destination: CI artifacts/release evidence.

T-037 — Independent architecture/security review

Dependencies: T-036.

Acceptance: no unresolved release-blocking findings in:

auth;

stale writes;

bridge security;

secret handling;

migrations;

provider-capability honesty.

T-038 — Exact-SHA CI and sandbox deployment

Dependencies: T-037.

Acceptance:

reviewed SHA recorded;

CI passes that SHA;

sandbox reports same SHA.

T-039 — Live sandbox verification

Dependencies: T-038.

Acceptance: critical Google/Microsoft/local workflows validated against the exact SHA for all enabled release surfaces.

T-040 — Production approval gate

Dependencies: T-039.

Action: Prepare evidence for Henry.

Non-goal: Automatically deploy production.

Acceptance: Production promotion occurs only after explicit approval.

27. Task Dependency Summary

T-001
|
+--> T-002 --> T-005 --> T-006
|
+--> T-003 --> T-004
|
+--> T-008 --> T-009
| |
| +--> T-010
|
+--> T-011
|
+--> T-012 --> T-013
|
| +--> T-014
| +--> T-015
| +--> T-016
|
+--> T-017
+--> T-018

T-006 --> T-019 --> T-020 --> T-022 --> T-023
-> T-021 --------^
--------------------> T-024

T-002 --> T-025 --> T-026 --> T-027 --> T-028 --> T-029 --> T-030 --> T-031

T-008 + provider lanes --> T-032
T-006 + T-008 ----------> T-033
provider settings ------> T-034

all enabled lanes --> T-035 --> T-036 --> T-037 --> T-038 --> T-039 --> T-040

Parallelization is permitted where dependencies allow, particularly Google, Microsoft, and local-provider branches after the shared platform contracts stabilize.

28. Product Critique
PC-001 — MVP scope is very large

The requested surface combines:

three provider families;

three artifact types;

human workflows;

agent workflows;

cloud auth;

provider change tracking;

local desktop integration;

structured mutation;

concurrency;

search;

permissions;

preview;

versions;

production hardening.

Attempting to ship all of this as one undifferentiated release would create a poor probability of proving capability truth.

The staged architecture is therefore not optional project management ceremony. It is necessary to avoid building provider-specific shortcuts.

PC-002 — "Same abstraction" must not become "same feature set"

The product promise should be:

A stable Entity document workflow across providers.

It should not be:

Every provider can perform every operation identically.

The latter is technically false and would force brittle lowest-common-denominator APIs or misleading UI.

PC-003 — Provider selection is underspecified

The source establishes three modes but does not decide the UX for choosing them.

Possible decisions still required include:

workspace default provider;

default by artifact type;

user-selected per creation;

agent-selected from policy;

destination-specific automatic choice.

The implementation can build the policy machinery before finalizing a single default.

PC-004 — External canonical artifact vs Entity identity needs careful wording

A Google Doc can be the canonical business artifact while Entity remains the canonical workspace/control-plane identity.

The UI must avoid implying that Entity owns file bytes that are actually provider-owned.

PC-005 — Human editing experience differs materially

Google and Microsoft likely open external provider editors.

Local Office launches a local editor/bridge.

Trying to hide this difference behind one visually identical Edit interaction may make the product more confusing rather than more unified.

The unification should be at document identity, actions, policy, evidence, and workflow—not at pretending the editor location is identical.

PC-006 — Local-only is effectively a separate product surface

Cloud integrations are mostly remote-provider orchestration.

Local-only Office introduces:

desktop installation;

runtime discovery;

filesystem access;

file locking;

local crashes;

editor licensing/distribution;

operating-system behavior.

It should remain one abstraction but a separately gated execution program.

PC-007 — Import/discovery experience is underspecified

The source requires Drive discovery and provider integration but does not explicitly define whether MVP users:

browse all existing provider documents;

import individual links;

select folders;

sync designated roots;

automatically index a tenant.

This is an important product decision because it radically affects permission and scaling requirements.

29. Engineering Critique
EC-001 — Revision semantics are not naturally portable

Google, Microsoft, and local files expose different concurrency primitives.

The common abstraction must express:

safe expected revision

without assuming that the underlying token has the same format or lifetime.

EC-002 — Whole-file rewrite is dangerous

For Office formats lacking proven fine-grained cloud mutation APIs, downloading, editing, and reuploading a complete file may technically work but can cause:

concurrent edit loss;

version churn;

fidelity changes;

metadata changes;

file lock problems.

Any such lane requires explicit ADR evidence and strict ETag/revision handling.

EC-003 — Microsoft format mutation is the highest capability-truth risk

Graph storage capability must not be confused with Word/PowerPoint document-model editing capability.

This is a major source of potential implementation hallucination and requires current provider evidence before code claims support.

EC-004 — Local bridge is the highest security-risk component

A loopback API that accepts filesystem paths would be unacceptable.

Security design must be completed before the editor integration, not retrofitted afterward.

EC-005 — Provider notifications cannot be the sole source of truth

Cloud watch/delta systems can expire, delay, duplicate, or fail.

Periodic reconciliation is required.

EC-006 — Migration can accidentally weaken Google safety posture

A unified write API could inadvertently expose Google writes before the explicit gate if routing is not fail-closed.

Google negative tests must surround the shared API boundary, not only old endpoints.

EC-007 — Search indexing must remain asynchronous from document truth

A document mutation can succeed while indexing fails.

Do not roll back a valid provider write merely because secondary indexing failed.

EC-008 — External attribution may be incomplete

Provider change feeds may not reliably identify the exact human actor in every configuration.

The schema and UI must allow coarse honest attribution.

EC-009 — Local fidelity requires semantic fixtures

Byte equality is not a useful Office fidelity test because valid editors can rewrite package structures.

Tests must compare meaningful document semantics.

EC-010 — Existing internal seams may already solve part of this

The source states that File Sources, docs routes, indexing, associations, plugins, and receipts exist.

Creating parallel infrastructure without auditing these seams would be architectural debt.

T-001 therefore blocks final schema/API choices.

30. Risk Register
ID	Risk	Likelihood	Impact	Mitigation	Release blocker
RK-001	Google write path accidentally bypasses V1 safety	Medium	Critical	Explicit multi-gate authorization + negative tests	Yes
RK-002	Microsoft mutation capabilities overstated	High	High	Capability ADR and current provider evidence	Yes
RK-003	Local bridge exposes arbitrary filesystem	Medium	Critical	Document-scoped references, origin/auth/path tests	Yes
RK-004	Stale provider writes overwrite collaboration	High	Critical	Revision Coordinator + 409 conflicts	Yes
RK-005	Local engine has poor Office fidelity	Medium	High	Fidelity spike before selection	Yes for affected format
RK-006	Third-party local engine licensing incompatible	Medium	High	License review in ADR	Yes
RK-007	Provider auth model too broad	Medium	High	Least privilege + explicit admin write gate	Yes
RK-008	Change notifications missed	High	Medium	Reconciliation polling fallback	No if bounded
RK-009	Provider throttling causes unreliable agents	Medium	Medium	Backoff, queue/concurrency limits, diagnostics	No if bounded
RK-010	Migration duplicates Google records	Medium	High	Provider identity uniqueness + idempotent backfill	Yes
RK-011	Existing dirty checkout contaminates implementation	Medium	High	Clean worktree requirement	Yes
RK-012	Local save crash corrupts user artifact	Medium	Critical	candidate validation + atomic replacement + recovery	Yes
RK-013	User assumes preview is native editing	Medium	Medium	Explicit action/content model	No
RK-014	Provider permissions drift silently	Medium	High	periodic metadata reconciliation	Yes if writes affected
RK-015	Raw tokens leak into diagnostics	Low/Medium	Critical	centralized redaction + secret tests	Yes
RK-016	Provider create succeeds but retry creates duplicate	Medium	High	idempotency + orphan reconciliation	Yes
RK-017	Large documents create memory/performance failures	Unknown	High	provider/file limits and streaming audit	Depends
RK-018	Local browser bridge behaves differently across OSes	High	Medium	define supported platform matrix	Yes for advertised OS
RK-019	OOXML parser accepts hostile archive	Medium	High	archive limits/path sanitization	Yes
RK-020	Full three-provider scope delays useful first release	High	Medium	staged release gates	No
31. Open Questions
OQ-001 — Provider selection

What is the desired default creation policy?

Possible models:

workspace default;

user chooses each time;

default per artifact type;

destination/project policy;

agent chooses only from an approved list.

Owner: Henry/Product.

OQ-002 — Google deployment authorization

Which Google environments require:

user OAuth consent;

service account;

domain-wide delegation;

a mixture by deployment?

Owner: Product + Security/Engineering.

Requires current auth-model audit.

OQ-003 — Google confirmation policy

Once administrator write authorization is enabled, which agent operations require explicit human confirmation?

The data model supports a confirmation policy but the exact default is not settled.

Owner: Henry/Product.

OQ-004 — Existing Google identity migration

What is the current persisted identity key for Google artifacts, and can it guarantee deterministic mapping into the unified registry?

Owner: Engineering.

Resolution: T-001 audit.

OQ-005 — Stable Entity URL

What existing route is canonical for document objects?

Do not invent a second URL scheme if one already exists.

Owner: Engineering.

OQ-006 — Microsoft mutation support

Which current Microsoft APIs or approved format engines satisfy each Word/Excel/PowerPoint structured mutation requirement?

Owner: Engineering.

Resolution: T-021.

OQ-007 — Office-for-web/WOPI

Is Entity technically and commercially eligible for embedded Microsoft Office editing?

Owner: Product/Legal/Engineering.

Not required for MVP.

OQ-008 — Local engine

Which local engine wins the spike?

Owner: Engineering/Product.

Candidates include but are not limited to the options in R-017.

OQ-009 — Local platform support

Which desktop operating systems are required for the first local Office release?

Owner: Product.

OQ-010 — Local storage policy

Where exactly are workspace-managed local Office files stored, and how does that integrate with existing File Sources?

Owner: Engineering.

OQ-011 — Local version retention

How many previous local Office versions/backups should Entity retain and for how long?

Owner: Product/Engineering.

OQ-012 — Cloud version retention

Does Entity persist provider content snapshots or only provider version identifiers/metadata?

Owner: Product/Engineering.

OQ-013 — Existing-provider discovery

Does MVP require:

one-link import;

selected folder sync;

designated Drive/library sync;

workspace-wide discovery?

Owner: Henry/Product.

OQ-014 — Permission mutation

Is Entity required to alter provider permissions in MVP, or only read/display permission summaries?

The source requires permissions support but does not explicitly require full permission editing.

Owner: Product.

Default implementation should remain read/summary-only unless required.

OQ-015 — File size limits

What limits should apply to:

upload;

local parsing;

previews;

indexing;

local bridge operations?

Owner: Engineering after provider/repository audit.

OQ-016 — Macro files

The specification excludes macro-enabled Office formats from MVP.

Confirm whether any existing customer workflow makes DOCM/XLSM/PPTM mandatory.

Owner: Product.

OQ-017 — Provider sandbox resources

Which Google Workspace and Microsoft 365 non-production tenants/drives/libraries are approved for CI/live integration proof?

Owner: Operations/Engineering.

OQ-018 — Existing feature flag system

Which current Entity feature-flag mechanism should host the write gates?

Owner: Engineering.

OQ-019 — Existing receipt integration

What exact canonical receipt API/schema should document operations attach to?

Owner: Engineering.

T-001 must answer this rather than introducing a competing receipt store.

OQ-020 — Provider disconnect retention

After disconnect, how long may Entity retain:

metadata;

cached preview;

extracted searchable text;

version metadata?

Owner: Product/Security.

32. Definition of MVP Completion

MVP is complete only when all of the following are true:

A human or agent can create a Google document, spreadsheet, and presentation through authorized Entity workflows.

Each receives a stable Entity document link.

Supported Google mutations are bounded, auditable, and revision-aware.

Existing Google V1 remains non-mutating when the write gate is disabled.

A human or agent can create a Microsoft document, spreadsheet, and presentation in approved Microsoft destinations.

Each receives a stable Entity document link.

Edit in Microsoft 365 opens the correct artifact.

Entity does not claim unsupported Word/Excel/PowerPoint structured mutation capability.

Local DOCX supports create/open/edit/save/reopen without Google, Microsoft, or cloud identity.

Local DOCX supports at least one useful structured agent mutation lane.

Local XLSX and PPTX proceed in that order before full local three-format completion.

Every enabled write lane rejects stale revisions.

Human, agent, provider-external, and local-external changes create truthful activity/version evidence.

Every agent mutation links to an Entity execution receipt.

Auth loss and local bridge absence have explicit degraded states.

Preview/open/edit actions are capability-driven and truthful.

Search/indexing and Entity work-object associations work through the unified identity.

Raw credentials do not appear in records, logs, receipts, APIs, screenshots, or evidence.

Provider contract tests pass.

Browser/Electron proof passes for enabled workflows.

Work was performed from a clean isolated worktree.

CI passes the reviewed SHA.

Sandbox runs the exact reviewed SHA.

Live verification passes.

Production remains blocked until Henry explicitly approves promotion.
