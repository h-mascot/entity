# Geordi Swarm — Architecture

## Overview

Geordi Swarm is a soft-plugin for Entity that dispatches build jobs to
pluggable execution backends and collects proof of completion.

```
Entity (source of truth) → Swarm Dispatcher → Provider → Execution → Proof
```

## Key Principle: Entity is the Tracker

**Entity tracks work. Providers execute work.**

The Swarm plugin does NOT depend on any external tracker (Linear, Jira, etc.)
as a required intermediary. Providers receive job specs directly from Entity
and report results back.

## Providers

Swarm now uses an extensible provider registry so Entity can route jobs to multiple WorkOS layers without hardcoding them into the tracker. Current engines: ACP, Symphony, eforge, with registry slots prepared for CCP and Flywheel.

### ACP Provider (`acp`)
- Dispatches to Geordi ACP adapter on Mac (Codex/Claude Code)
- Direct HTTP: POST job spec → poll status → collect proof
- Env: `ACP_BASE_URL` (default: `http://100.86.150.96:8100`)

### Symphony Provider (`symphony`)
- Entity-native integration — no Linear dependency
- Two modes:
  1. **Direct**: SYMPHONY_API_URL + SYMPHONY_API_KEY → Symphony's own task API
  2. **OpenClaw fallback**: OPENCLAW_API_TOKEN → session-based dispatch
- Env: `SYMPHONY_API_URL`, `SYMPHONY_API_KEY`, `OPENCLAW_API_URL`, `OPENCLAW_API_TOKEN`

### eforge Provider (`eforge`)
- Entity-native integration for spec-to-code build execution
- Pull-based model like Symphony, but optimized for blind review and isolated git worktrees
- Config: `EFORGE_API_URL` or `EFORGE_QUEUE_DIR`
- Current bridge writes queue-ready PRD markdown files from Entity jobs into `EFORGE_QUEUE_DIR`, so Entity can dispatch directly into eforge without retyping the task

### Future Registry Slots
- `ccp` — delivery control plane / ticket-to-merge automation
- `flywheel` — workstation/environment layer

### Adding a Provider
1. Implement `SwarmProvider` interface from `providers/interface.ts`
2. Register in `dispatcher.ts` providers map
3. Health check → dispatch → status → collectProof lifecycle

## Data Flow
1. Job created (UI or API) → `swarm_jobs` table → status: `draft`
2. Dispatch → provider.dispatch() → status: `dispatched` → `running`
3. Completion → provider.collectProof() → `swarm_proofs` table → status: `review`
4. Human review → accept (`done`) or reject (`queued` + feedback for retry)

## API Routes
All mounted at `/api/swarm/*`:
- `GET /jobs` — list jobs (filter by status, task_id)
- `POST /jobs` — create job
- `GET /jobs/:id` — get job + proofs
- `PATCH /jobs/:id` — update job
- `DELETE /jobs/:id` — delete job
- `POST /jobs/:id/dispatch` — dispatch to provider
- `POST /jobs/:id/check` — check execution status
- `POST /jobs/:id/accept` — accept reviewed job
- `POST /jobs/:id/reject` — reject with feedback
- `POST /jobs/:id/cancel` — cancel running job
- `GET /jobs/:id/proofs` — list proofs
- `GET /providers` — list available providers
- `GET /providers/:name/health` — check provider health
- `GET /stats` — job statistics

## UI Integration
- **SwarmBoard** — main kanban board, accessible via "swarm" tab
- **SwarmJobsSection** — inline widget in TaskDetailPanel showing linked jobs
- **useSwarmBoard** — React hook with auto-polling for active jobs
- **useSwarmJobsForTask** — lightweight hook for task-linked job display
