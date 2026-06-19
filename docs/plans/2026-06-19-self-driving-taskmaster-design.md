# Self-Driving Board & Task Master — Living Design

Date: 2026-06-19
Status: In design (grilling). Decisions captured inline as they crystallize.
Supersedes framing in: `2026-06-18-self-driving-board-design.md` (still valid for the
~80%-already-built inventory; this doc owns the architecture/terminology).

## Glossary (ubiquitous language)

- **Task Master** — the board's orchestration loop (the evolution of the existing
  hygiene-scanner agent). It **routes, gates, and runs the review queue**. It is *not*
  the universal executor. It **drives** only work that is **unassigned** or **assigned to
  Task Master itself**. For work assigned to another agent, it **nudges** that agent if the
  work stalls — it never executes on the agent's behalf. ("humans work *with* agents → Task
  Master shouldn't drive all.")
- **Agent** — a **user-added** principal (e.g. OpenClaw, Hermes, Codex, Claude Code). Not
  hardcoded. **Owns its own execution** via the pull-based `entity-mc` model.
- **`entity-mc`** — per-agent, cron-driven bundle installed on the agent's host. The agent
  auto-pulls *its assigned* work, runs it, reports proof back. This is *how an agent does its
  own job*.
- **Worktype / swarm** — the *kind* of work and its execution backend. Coding worktypes:
  `eforge`, `symphony`. Non-coding worktype in scope: `biz` (biz-ops). Worktypes are
  **plugins/providers**, not core.
- **Human** — a multiplayer principal; a real account with server-verified identity (see
  `2026-06-18-multiplayer-identity-design.md`).
- **Nudge** — Task Master prompting a stalled assigned agent through a per-agent-type channel
  (MCP / webhook / etc.), as opposed to dispatching the work itself.

## Settled decisions

1. **Seam split (plugin vs core).** The **driving loop trends to core**; **work execution
   (worktypes/providers) stays as plugins.** The old all-in-one coding swarm
   (`geordi-swarm`) keeps its plugin shape for *execution*.
2. **Task Master = the evolved conductor**, named **Task Master** (not "conductor").
3. **Trigger = per-task assignment.** Global "Task Master drives everything" is only the
   **fallback when no agents are configured**, not the steady state. The global `autoDispatch`
   flag survives only as a kill switch.
4. **Drive vs nudge boundary.** Task Master drives *unassigned* / *self-assigned* work.
   Assigned agents own their execution (`entity-mc` pull). Stalled assigned work → Task
   Master **nudges** the agent (MCP/webhook per agent type); it does **not** take over.
5. **Agents are user-added, not hardcoded.**
6. **Shared claim primitive.** The pull path and the Task Master loop both honor the atomic
   `claimSwarmJob` guard so they can never double-claim a job.

## Work hierarchy (settled)

```
Project  →  Goal  →  Spec (engineering only)  →  Task (→ subtasks via parent_id)
```

- **Project** — top container / initiative (existing `projects` layer, kept).
- **Goal** — a strategic outcome **under** a project. Distinct from projects (not a rename).
- **Spec** — **engineering-only**, bigger than a task; decomposes a goal into tasks. Other
  worktypes skip it (or get their own bigger-than-a-task unit later, e.g. CS "campaign").
- **Task** — the board's lane unit; the thing assigned / dispatched / proven / reviewed.
  `parent_id` gives subtasks.
- **Worktype** is an orthogonal routing tag, **not** a hierarchy level. "biz-ops" is a
  worktype; "Ops" is a department; they are not the same as a Goal.

## Review & proof model (settled — from `entity-mc` `mc-review-pull.sh`)

This already exists in the agents' review tooling and is the canonical model:

- **Proof = `metadata.review_packet`**: `{ evidence, output_artifact, done_criteria[] }`.
  `done_criteria` is the acceptance checklist; reviewers check **"receipts, not vibes."**
- **Review = assigned peer review.** A task in the `review` column carries
  `metadata.reviewer` (a principal). That reviewer judges it and sets
  `metadata.review_decision`: `pending` → **`accept-review`** or **`request-fix`** (+ reason).
- **Reviewer can be an agent *or* a human** — peer agents review autonomously
  (`mc.sh accept-review` / `request-fix`).
- **Separation of duties (hard rule):** the reviewer must not be the `submitted_by`,
  `created_by`, or `assignee`. No self-review.
- **Watchdog:** stuck/zombie reviewer sessions are killed; the review stays `pending` for
  retry (mirrors the executor stall recovery).
- Columns: `backlog | todo | doing | review | done`.

## Review & proof model (cont.) — settled

- **Two-tier review (decided).** Peer review (agent, separation of duties) **always runs**.
  Whether a **human gate** is *also* required before `done` is a **policy** keyed on
  worktype / risk / value / explicit flag — not always-on, not never. Honors both
  "humans work with agents" and "the board drives itself."

## Open questions (still being grilled)

- **Human-gate policy:** exact dimensions that force a human approver, and the default.
- Who **assigns the reviewer** (Task Master? round-robin within team? producer picks?).
- For **biz-ops**, what fills `done_criteria` / `output_artifact` / `evidence`.
- The **worktype schema** (exact fields defining a worktype).
- Whether each non-eng worktype needs its own "bigger-than-a-task" unit (spec-equivalent).
- **Proof & review for non-code (biz-ops) work**, and **who approves in multiplayer**.
- The 5 owner-decisions in `2026-06-18-self-driving-board-design.md` §7 (trigger lane,
  default provider/fallback, concurrency caps, mandatory-review, channel trust).
- Concrete **nudge channel** mechanism per agent type.

## Org / company-scale model (in design)

The board starts single-user (Henry's own tasks) but the target is a **workspace OS**
for a company: multiple departments (design, engineering, ops, customer success), each
with people **and** their agents.

**Grounding (already specced, reused not reinvented):**
- **Modules** (`pluggable-agents-modules-spec.md`) = the OS surface: `chat`, `tasks`
  (Mission Control), `files`, `docs`, `swarm`, `plugins`. Agents hold **per-module grants**
  (`read`/`write`/`assign`/`admin`).
- **Principals** (`multiplayer-identity-design.md`) = unified humans + agents in one
  identity space. Org/team/multi-tenant was explicitly **deferred** there (non-goal).

**Proposed org layer (the one missing piece):**
```
Org (company / workspace tenant)
 └─ Team / Department  (design · engineering · ops · customer success …)
     ├─ Members = principals (humans + agents)
     ├─ Worktypes the team offers (coding · biz-ops · …)  → plugins
     └─ Work: Goals → Tasks, scoped to the team
```

**Settled here:**
- **Agent ownership = C (both).** Agents can be **person-owned** *or* **team-owned**, via a
  nullable `owner_principal_id` / `owner_team_id` seam. Default usage today is person-owned
  (matches the current `entity-mc` reality); team-owned shared pools turn on with no schema
  change.

**Proposed (pending confirmation):**
- Task Master operates **per-team**: routes a team's *unassigned* work to that team's agents;
  global fallback only when a team has no agents.
- Worktypes are a **team's capabilities** (eng → coding; ops → biz-ops).
- **Design the team seam now, defer the team build** (nullable team/scope on principals +
  work) so single-user stays zero-friction and company scale is a config flip, not a rewrite.

## ADRs

Hard-to-reverse decisions get their own ADR under `docs/adr/`.
