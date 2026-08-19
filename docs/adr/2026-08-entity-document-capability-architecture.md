# ADR: Entity Document Integration Capability Architecture

Status: Accepted
Date: 2026-08
Issue: THE-943 (LOOM-DOCS T-002)
Canonical source: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`
Canonical PRD SHA-256 (actual tracked file, matches BUILD-CONTEXT): `c82e82d8379c420946735bf79265895cc3a00937d2d9f2ec95de60979e492470`

> Hash discrepancy note: the live Linear THE-943 contract, `AGENTS.md`, and `ISSUE-MAP.md`
> name SHA-256 `83cacbc5…` as the canonical-source hash, but the file actually tracked in
> this worktree (and the hash named by `BUILD-CONTEXT.md`) is `c82e82d8…`. The `83cac…`
> string is a stale reference. The implementation authority used here is the actual tracked
> `phase2-canonical-prd.md`, verified below as `c82e82d8…`, whose T-002 section is represented
> in this ADR.

## Context

Entity integrates three document provider families — `google_workspace`, `microsoft_365`,
and `local_office` — behind one canonical Entity document object. Each provider exposes a
different surface for create, read, preview, editing, mutation, version history, change
tracking, permissions, and export. Historically there is a real risk that callers hard-code
per-provider behavior ("if provider === google_workspace then …"), which spreads parity
assumptions and couples UI, agents, and routes to provider names.

- **D-003**: "All provider-specific behavior is exposed through negotiated capabilities."
- **R-002**: "The backend must expose capabilities rather than forcing the UI, agents, or
  routes to infer capability from provider name."

This ADR records the capability architecture: the adapter contract, the capability
vocabulary, state semantics, degraded/unknown behavior, and resolution precedence. It is the
decision base that T-005 (adapter contract + fake adapter) and T-006 (Capability Resolver)
implement, and that T-012/T-014..T-018 (Google), T-019..T-024 (Microsoft), and
T-025..T-031 (local Office) consume.

## Decision

### 1. Provider adapter contract

Each provider family exposes a uniform adapter that *reports* what it can do rather than
being asked "are you google?". The adapter contract has two halves:

1. **Capability evidence** — the adapter describes, per capability, its intrinsic state and
   the source of that evidence (`adapter`). It never decides the final state; the Capability
   Resolver owns that.
2. **Operation methods** — create/read/mutate/preview/etc. Each operation is capability-typed
   and is invoked only after the resolver has resolved that capability to a usable state.

The adapter contract lives at `packages/server/src/document-providers/types.ts` (types) and
its concrete interface + fake implementations are added in T-005. Adapters must not live in
`packages/server/src/provider-registry/` (that directory is the inference-oriented provider
registry, not the document provider surface).

### 2. Capability vocabulary

R-002's minimum vocabulary is authoritative and exhaustive at this layer (15 capabilities):

```
create read preview thumbnail open_external human_edit
agent_text_mutation agent_range_mutation agent_slide_mutation
version_history change_tracking permission_read permission_write embed_editor export
```

`AgentType` mutation is split by document surface so text (Docs), range (Sheets), and slide
(Slides) mutations are independently negotiated. `embed_editor` and `open_external` are
distinct: a provider may support opening externally without supporting an embedded editor,
and vice-versa.

### 3. Capability state semantics

Every resolved capability carries `name`, `state`, optional `reasonCode`/`reason`, and
`source`, per R-002:

```ts
type CapabilityState = "supported" | "unsupported" | "degraded" | "unknown";

interface ResolvedCapability {
  name: string;            // one of the vocabulary
  state: CapabilityState;
  reasonCode?: string;
  reason?: string;
  source: "adapter" | "connection" | "destination" | "runtime" | "policy";
}
```

- `supported` — the action is available and ready.
- `unsupported` — the adapter or policy positively reports the action is not available.
- `degraded` — normally available, but a dependency (e.g. connection, local bridge, or
  permission scope) is currently impaired; the action may be suppressed or limited.
- `unknown` — there is no positive evidence either way. This is the fail-closed default.

### 4. Degraded and unknown behavior

Security invariant: **writes fail closed on unknown.**

- For any capability that gates a write, permission mutation, or embedding side effect —
  `create`, `agent_text_mutation`, `agent_range_mutation`, `agent_slide_mutation`,
  `permission_write`, `embed_editor` — the action is enabled **only** when `state ===
  "supported"`. A `degraded` connection suppresses the action even for an adapter that
  reports support; `unsupported` and `unknown` never enable it.
- A degraded *read-like* capability (`read`, `preview`, `thumbnail`, `export`, …) remains
  usable in degraded mode but fails closed both on `unknown` and on `unsupported` (an
  unsupported capability must surface a typed unsupported-capability, non-actionable
  result, per R-002).
- `unknown` mutation or embedding is never actioned. T-006's resolver and every mutation
  route enforce this in code; this ADR fixes the semantic.

Examples:
- **Google**: `agent_text_mutation` is `supported` only after D-005 write gate is enabled and
  the connection/scope is healthy; otherwise `degraded`/`unsupported`/`unknown`. `open_external`
  is `supported` for human editing per D-006.
- **Microsoft**: `read`/`create` are gated on an Entra connection + approved destination;
  `agent_slide_mutation` depends on a separately proven PowerPoint mutation path (T-023) —
  until then it resolves `unsupported` or `unknown` and fails closed.
- **Local**: `human_edit` readiness is driven by the presence/health of the local bridge
  (T-026), *without* changing the canonical provider type `local_office`. A "missing local
  bridge" state makes `human_edit` `degraded`/`unknown` while the provider kind stays
  `local_office` — satisfying R-002's validation that a missing bridge changes local
  `human_edit` readiness without changing the provider type.

### 5. Capability resolution precedence

The Capability Resolver folds evidence in fixed precedence, lowest to highest, so an
optimistic adapter cannot outrank a failing connection and a policy veto cannot be
overridden:

```
adapter < connection < destination < runtime < policy
```

- `adapter` — intrinsic provider support (T-005 fake adapter / real adapters).
- `connection` — auth/connectivity health (e.g. OAuth validity, Entra connection, local bridge).
- `destination` — a chosen provider destination (folder/tenant/drive) may restrict capability.
- `runtime` — live runtime evidence (scope grants, rate/health, feature-flag state).
- `policy` — explicit admin/tenant policy veto; the highest authority.

A lower-precedence `supported` is demoted to `degraded`/`unsupported` when a higher-precedence
source reports impairment. `unknown` at any source is treated conservatively and fails closed
for write/embedding capabilities. Precedence folding is implemented and unit-tested in T-006.

### 6. Provider kind never implies capability (D-003)

A caller must never gate a write on `provider === "google_workspace"` (or equivalent). The
resolved capability report is the only authority. The shared surface exposes a typed
`providerKindEnablesWrite` guard that returns `false` as a permanent sentinel so future
callers cannot "convince" themselves a provider name is write-authoritative.

### 7. Reversibility through the audited feature-flag framework

Capability negotiation is staged and reversible through the audited Phase 2 flag host at
`packages/server/src/phase2-flags.ts` (no competing flag host). The capability resolver and
its wire-up are surfaced behind a Phase 2 capability flag so behavior can be observed and
rolled back without code changes. T-006 registers the flag and the resolution roll-out under
the existing `ENTITY_PHASE2_*` convention. T-001 confirmed the canonical flag host; this ADR
does not add a competing flag store.

## Consequences

- UI and agents negotiate from a `CapabilityReport` instead of branching on provider names;
  new provider families or capability changes need no shared-surface branching.
- Writes and embedding are fail-closed by construction, satisfying the security invariant.
- A degraded connection or missing local bridge is reflected honestly as a capability state,
  not as a broken provider type.
- Provider kinds remain stable and canonical while capability readiness drifts independently.
- Cost: every capability inquiry must run through the resolver (single, uniform path) rather
  than a cheap provider-name check; this is acceptable because resolution is pure and cachable.

## Test expectations

- T-006 implements the resolver and unit-matrixes vocabulary, state folding, precedence, and
  fail-closed behavior; T-002's `capability-resolver.test.ts` is the sanctioned test plan
  locking vocabulary + state + fail-closed semantics.
- Every provider shares a fake/adapter contract test (T-005) proving no shared surface
  branches on provider name.
- Browser tests (T-033/T-036) prove supported/unsupported/degraded actions render and gate
  correctly.
